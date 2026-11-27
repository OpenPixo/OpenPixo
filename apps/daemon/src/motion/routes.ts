import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import multer from 'multer';
import {
  gamePlanIsPending, MOTION_NAME_MAX, MOTION_PICTURE_MAX_BYTES, MOTION_TEXT_MAX,
  type GameMotionPromptInput, type MotionCharactersResponse, type MotionPictureType, type MotionPortraitRequest, type MotionStatus, type MotionSuggestion, type Project,
} from '@openpixo/contracts';
import { getProject } from '../db.js';
import { detectEngineProfile } from '../game/engine-detect.js';
import { bearerTokenFromRequest, isAgentToken } from '../http/tool-request-auth.js';
import { sendValidatedFile } from '../http/send-file.js';
import { ensureProject, resolveProjectDir } from '../projects.js';
import { GAME_PLAN_NOT_APPROVED } from '../routes/game-plan.js';
import type { RouteDeps } from '../server-context.js';
import { toolTokenRegistry } from '../tool-tokens.js';
import { MotionCloud, type MotionAccount } from './cloud.js';
import { MotionError, motionError } from './errors.js';
import { MotionFiles, type MotionFetch } from './files.js';
import { installedMotionCharacters, installMotionCharacter, MOTION_SDK, motionSlug } from './install.js';
import { MotionRecords } from './records.js';
import { MOTION_ID } from './wire.js';

export interface RegisterMotionRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'> {
  account: MotionAccount;
  /** Where `openpixo-motion` with the players is. */
  sdkDir: string;
  fetchFile?: MotionFetch;
}

/** What a run in a game is told about moving characters. Null: nothing, because this build has none. */
export interface MotionFacts { promptFacts(projectId: string | null | undefined): Promise<GameMotionPromptInput | null> }

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,200}$/u;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;
const pictureUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MOTION_PICTURE_MAX_BYTES, files: 1, fields: 4 } }).single('picture');
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const invalid = (message?: string): never => { throw new MotionError('MOTION_REQUEST_INVALID', message); };
const param = (req: Request, name: string): string => String(req.params[name]);
const id = (req: Request): string => { const value = param(req, 'id'); return MOTION_ID.test(value) ? value : (() => { throw new MotionError('MOTION_NOT_FOUND'); })(); };

function words(value: unknown, picture: boolean): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text.length < (picture ? 0 : 2)) || [...text].length > MOTION_TEXT_MAX ? invalid(`Describe it in ${picture ? 0 : 2} to ${MOTION_TEXT_MAX} characters.`) : text;
}

function title(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/\p{C}+/gu, ' ').trim() : '';
  return !text || [...text].length > MOTION_NAME_MAX ? invalid(`A name has 1 to ${MOTION_NAME_MAX} characters.`) : text;
}

/** What the picture is, by what is in it: the name and type a client gives are not believed. */
function pictureType(data: Buffer): MotionPictureType {
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length > 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  throw new MotionError('MOTION_PICTURE_INVALID');
}

function picture(data: Buffer): NonNullable<MotionPortraitRequest['picture']> {
  if (!data.length || data.length > MOTION_PICTURE_MAX_BYTES) throw new MotionError('MOTION_PICTURE_INVALID');
  return { type: pictureType(data), data: data.toString('base64') };
}

/**
 * Pixo Motion: `/api/motion/*`, for the Moving character page and `pixo motion`. The user's own requests do
 * everything. An agent's token reads, downloads, puts characters into its own game and proposes new ones; it never
 * paints a portrait, orders, renames or deletes.
 */
export function registerMotionRoutes(app: Express, ctx: RegisterMotionRoutesDeps): MotionFacts {
  const { requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef, sendApiError } = ctx.http;
  const root = path.join(ctx.paths.RUNTIME_DATA_DIR, 'motion'), cloud = new MotionCloud(ctx.account), files = new MotionFiles(root, cloud, ctx.fetchFile), records = new MotionRecords(root);
  const agentGrant = (req: Request) => toolTokenRegistry.validate(bearerTokenFromRequest(req), { operation: 'media:generate', endpoint: '/api/tools/media/generate' });

  type Access = 'read' | 'user';
  /** Sends the refusal itself. */
  function allowed(req: Request, res: Response, access: Access): boolean {
    const refuse = (): false => { const error = new MotionError('MOTION_USER_ONLY'); res.status(error.status).json(error.response()); return false; };
    // reading goes with the right to make art for a game
    if (isAgentToken(req)) return access === 'read' && agentGrant(req).ok || refuse();
    return access === 'read' || isLocalSameOrigin(req, resolvedPortRef.current) || refuse();
  }

  function on(method: 'get' | 'post' | 'patch' | 'delete', route: string, access: Access, handler: (req: Request, res: Response) => Promise<unknown>): void {
    app[method](route, requireLocalDaemonRequest, async (req: Request, res: Response) => {
      try {
        if (!allowed(req, res, access)) return;
        res.setHeader('Cache-Control', 'no-store');
        const result = await handler(req, res);
        // a file answers for itself
        if (result !== undefined) res.json(result);
      } catch (error) {
        const failure = motionError(error);
        if (!res.headersSent) res.status(failure.status).json(failure.response());
      }
    });
  }

  const sendFile = (res: Response, file: string, type: string): undefined => {
    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    sendValidatedFile(res, file);
    return undefined;
  };

  async function suggestions(): Promise<MotionSuggestion[]> {
    return (await records.read()).flatMap(s => {
      const project = getProject(ctx.db, s.projectId) as Project | null;
      return project ? [{ ...s, projectName: project.name }] : [];
    });
  }

  /** A game that this request may write into: the user's own, or the agent's own one once its plan was approved. */
  async function writableProject(req: Request, res: Response, projectId: unknown): Promise<Project | null> {
    const project = typeof projectId === 'string' ? getProject(ctx.db, projectId) as Project | null : null;
    if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return null; }
    const options = { mode: 'write' as const, capability: 'writeFiles' as const };
    if (isAgentToken(req)) {
      const grant = agentGrant(req);
      if (!grant.ok || grant.grant.projectId !== project.id) { sendApiError(res, 403, 'FORBIDDEN', 'A tool token for this project is required'); return null; }
      if (gamePlanIsPending(project.metadata)) throw new MotionError('MOTION_USER_ONLY', `${GAME_PLAN_NOT_APPROVED}: putting characters into the game waits until the user approves the plan.`);
      return await ctx.authorizeProjectToolRequest(res, project.id, options) ? project : null;
    }
    if (!isLocalSameOrigin(req, resolvedPortRef.current)) { sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return null; }
    return await ctx.authorizeProjectRequest(req, res, project.id, options) ? project : null;
  }

  /** Like `on`, for what an agent may do in its own game; the handler checks the game. */
  function inGame(route: string, handler: (req: Request, res: Response) => Promise<unknown>): void {
    app.post(route, requireLocalDaemonRequest, async (req: Request, res: Response) => {
      try {
        res.setHeader('Cache-Control', 'no-store');
        const result = await handler(req, res);
        if (result !== undefined && !res.headersSent) res.json(result);
      } catch (error) {
        const failure = motionError(error);
        if (!res.headersSent) res.status(failure.status).json(failure.response());
      }
    });
  }

  on('get', '/api/motion/service', 'read', async (): Promise<MotionStatus> => {
    if (!cloud.available()) return { available: false, signedIn: false, service: null };
    const signedIn = await cloud.signedIn();
    // the page opens without the cloud too, and says what is wrong
    return { available: true, signedIn, service: signedIn ? await cloud.service().catch(() => null) : null };
  });

  // The player for the page, the same file a game gets.
  on('get', '/api/motion/player.js', 'read', async (_req, res) => {
    if (!cloud.available()) throw new MotionError('MOTION_NOT_CONFIGURED');
    return sendFile(res, path.join(ctx.sdkDir, MOTION_SDK, 'web', 'pixo-motion.min.js'), 'text/javascript; charset=utf-8');
  });

  // Free within a daily limit; only the user asks for one.
  on('post', '/api/motion/portraits', 'user', async (req, res) => {
    if (req.is('multipart/form-data')) {
      await new Promise<void>((resolve, reject) => pictureUpload(req, res, error => error ? reject(error) : resolve())).catch((error: unknown) => {
        const code = (error as { code?: string }).code;
        throw typeof code === 'string' && code.startsWith('LIMIT_') ? new MotionError(code === 'LIMIT_FILE_SIZE' ? 'MOTION_PICTURE_INVALID' : 'MOTION_REQUEST_INVALID') : error;
      });
    }
    const o = record(req.body), file = (req as Request & { file?: { buffer: Buffer } }).file;
    let given: NonNullable<MotionPortraitRequest['picture']> | undefined;
    if (file) given = picture(file.buffer);
    else if (o.picture !== undefined) {
      const p = record(o.picture);
      if (typeof p.data !== 'string' || !BASE64.test(p.data) || p.data.length > Math.ceil(MOTION_PICTURE_MAX_BYTES / 3) * 4) throw new MotionError('MOTION_PICTURE_INVALID');
      given = picture(Buffer.from(p.data, 'base64'));
    }
    const requestId = o.requestId === undefined || o.requestId === '' ? randomUUID() : typeof o.requestId === 'string' && REQUEST_ID.test(o.requestId) ? o.requestId : invalid();
    return cloud.paint({ text: words(o.text, Boolean(given)), ...(given ? { picture: given } : {}), requestId });
  });
  on('get', '/api/motion/portraits/:id', 'read', req => cloud.portrait(id(req)));
  on('get', '/api/motion/portraits/:id/picture', 'read', async (req, res) => sendFile(res, await files.portrait(id(req)), 'image/png'));

  // The one way to spend credits here, with a portrait the user took and a price they were shown.
  on('post', '/api/motion/jobs', 'user', async req => {
    const o = record(req.body);
    if (typeof o.portraitId !== 'string' || !MOTION_ID.test(o.portraitId) || typeof o.requestId !== 'string' || !REQUEST_ID.test(o.requestId)) return invalid();
    return cloud.order({ portraitId: o.portraitId, name: title(o.name), requestId: o.requestId });
  });
  on('get', '/api/motion/jobs/:id', 'read', req => cloud.job(id(req)));

  on('get', '/api/motion/characters', 'read', async (): Promise<MotionCharactersResponse> => ({ characters: await cloud.list(), suggestions: await suggestions() }));
  on('get', '/api/motion/characters/:id', 'read', req => cloud.get(id(req)));
  on('patch', '/api/motion/characters/:id', 'user', req => cloud.rename(id(req), title(record(req.body).name)));
  on('delete', '/api/motion/characters/:id', 'user', async req => { await cloud.remove(id(req)); await files.forget(id(req)); return { id: id(req), deleted: true }; });
  on('get', '/api/motion/characters/:id/file', 'read', async (req, res) => {
    const folder = await files.character(id(req));
    if (req.query.download === '1') {
      const { name } = await cloud.get(id(req));
      res.attachment(`${motionSlug(name, id(req))}.pxmo`);
    }
    return sendFile(res, path.join(folder, 'character.pxmo'), 'application/octet-stream');
  });
  on('get', '/api/motion/characters/:id/poster', 'read', async (req, res) => sendFile(res, path.join(await files.character(id(req)), 'poster.png'), 'image/png'));

  inGame('/api/motion/characters/:id/install', async (req, res) => {
    const o = record(req.body), project = await writableProject(req, res, o.projectId);
    if (!project) return undefined;
    if (o.slug !== undefined && typeof o.slug !== 'string') return invalid();
    const character = await cloud.get(id(req));
    if (character.state !== 'ready' || !character.file) throw new MotionError(character.state === 'failed' ? 'MOTION_NOT_FOUND' : 'MOTION_BUSY');
    const folder = await files.character(character.id, character), dir = await ensureProject(ctx.paths.PROJECTS_DIR, project.id, project.metadata) as string;
    return installMotionCharacter({ projectDir: dir, profile: detectEngineProfile(dir, { resolveOnPath: () => null }), sdkDir: ctx.sdkDir, character, folder, ...(o.slug ? { slug: o.slug as string } : {}) });
  });

  /** An agent proposes; the user sees it on the Moving character page and makes it there, or not. */
  inGame('/api/motion/suggestions', async (req, res): Promise<MotionSuggestion | undefined> => {
    if (!cloud.available()) throw new MotionError('MOTION_NOT_CONFIGURED');
    const o = record(req.body), project = await writableProject(req, res, o.projectId);
    if (!project) return undefined;
    const saved = await records.suggest(project.id, words(o.text, false));
    return { ...saved, projectName: project.name };
  });
  on('delete', '/api/motion/suggestions/:suggestion', 'user', async req => { await records.drop(param(req, 'suggestion')); return { ok: true }; });

  return {
    async promptFacts(projectId) {
      if (!projectId || !cloud.available()) return null;
      const project = getProject(ctx.db, projectId) as Project | null;
      if (!project) return null;
      // a game that cannot be read has none in it; the run goes on
      const installed = await (async () => {
        const dir = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata) as string;
        return installedMotionCharacters(dir, detectEngineProfile(dir, { resolveOnPath: () => null }));
      })().catch(() => []);
      return { installed: installed.map(({ slug, name, file }) => ({ slug, name, file })) };
    },
  };
}
