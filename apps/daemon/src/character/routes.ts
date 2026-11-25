import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import {
  CHARACTER_BODIES, CHARACTER_GEAR_TYPES, CHARACTER_KINDS, CHARACTER_STYLES, gamePlanIsPending, isSampleCharacter, type AnimatedCharacter, type CharacterBriefRequest, type GameCharactersPromptInput, type CharacterGame, type CharacterSampleResponse, type CharactersResponse, type CharactersStatus, type CharacterSuggestion,
  type CharacterUpdate, type InstalledCharacter, type InstalledCharactersResponse, type LocalCharacter, type Project,
} from '@openpixo/contracts';
import { getProject } from '../db.js';
import { detectEngineProfile } from '../game/engine-detect.js';
import { bearerTokenFromRequest, isAgentToken } from '../http/tool-request-auth.js';
import { sendValidatedFile } from '../http/send-file.js';
import { ensureProject, resolveProjectDir } from '../projects.js';
import { GAME_PLAN_NOT_APPROVED } from '../routes/game-plan.js';
import type { RouteDeps } from '../server-context.js';
import { toolTokenRegistry } from '../tool-tokens.js';
import { CharacterCloud, type CharacterAccount } from './cloud.js';
import { CharacterError, characterError } from './errors.js';
import { installCharacter, installedCharacters, removeCharacter } from './install.js';
import { CharacterPackages, type CharacterFetch } from './packages.js';
import { CharacterRecords } from './records.js';
import { CHARACTER_ID, MOTION_NAME, outfits, PIECE_ID, tuning, wear } from './wire.js';

export interface RegisterCharacterRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'> {
  account: CharacterAccount;
  /** Where `openpixo-character` with the players is. */
  sdkDir: string;
  fetchFile?: CharacterFetch;
  /** Test seam for the wait between looks at a package that is being made. */
  packPollMs?: number;
}

/** Packing takes seconds; the biggest character half a minute, and it may wait for another. */
const PACK_LOOKS = 120;

const MAX_TEXT = 600;
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,200}$/u;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const invalid = (message?: string): never => { throw new CharacterError('CHARACTER_REQUEST_INVALID', message); };
const param = (req: Request, name: string): string => String(req.params[name]);
/** The free sample is nobody's; the cloud would say that there is no such character. */
const notSample = (value: string): string => isSampleCharacter(value) ? invalid('The free sample cannot be changed. Make a character of your own for that.') : value;
const id = (req: Request): string => { const value = param(req, 'id').toLowerCase(); return CHARACTER_ID.test(value) ? value : (() => { throw new CharacterError('CHARACTER_NOT_FOUND'); })(); };
const own = (req: Request): string => notSample(id(req));
const matching = (form: RegExp, value: string): string => form.test(value) ? value : (() => { throw new CharacterError('CHARACTER_NOT_FOUND'); })();
const one = <T extends string>(all: readonly T[], value: unknown): T => all.find(x => x === value) ?? invalid();

function words(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length < 2 || [...text].length > MAX_TEXT ? invalid(`Describe it in 2 to ${MAX_TEXT} characters.`) : text;
}

function title(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value.replace(/\p{C}+/gu, ' ').trim() : '';
  return !text || [...text].length > max ? invalid(`A name has 1 to ${max} characters.`) : text;
}

function briefRequest(value: unknown): CharacterBriefRequest {
  const o = record(value), kind = one(CHARACTER_KINDS, o.kind), flag = (v: unknown): boolean => v === undefined || typeof v === 'boolean' ? v === true : invalid();
  const characterId = kind === 'character' ? undefined : typeof o.characterId === 'string' && CHARACTER_ID.test(o.characterId) ? notSample(o.characterId) : invalid('Say which character it is for.');
  return {
    kind, ...(characterId ? { characterId } : {}), text: words(o.text),
    ...(o.style == null ? {} : { style: one(CHARACTER_STYLES, o.style) }), ...(o.body == null ? {} : { body: one(CHARACTER_BODIES, o.body) }), armor: flag(o.armor), gear: flag(o.gear),
    ...(o.types == null ? {} : { types: Array.isArray(o.types) && o.types.length <= CHARACTER_GEAR_TYPES.length ? [...new Set(o.types.map(type => one(CHARACTER_GEAR_TYPES, type)))] : invalid() }),
  };
}

function update(value: unknown): CharacterUpdate {
  const o = record(value), change: CharacterUpdate = {};
  if (o.name !== undefined) change.name = title(o.name, 60);
  if (o.outfits !== undefined) change.outfits = outfits(o.outfits);
  if (o.gear !== undefined) change.gear = Array.isArray(o.gear) && o.gear.length <= 200 && o.gear.every((g): g is string => typeof g === 'string' && PIECE_ID.test(g)) ? o.gear : invalid();
  return Object.keys(change).length ? change : invalid();
}

/**
 * Animated characters: `/api/characters/*` for the account's, `/api/projects/:id/heroes` for those in a game.
 * The user's own requests do everything. An agent's token reads, changes what is free to change, puts
 * characters into its own game and proposes new ones; it never orders, renames or deletes.
 */
export interface CharacterFacts {
  /** What a run in this game is told about characters. Null: nothing, because the user cannot have them. */
  promptFacts(projectId: string | null | undefined): Promise<GameCharactersPromptInput | null>;
}

export function registerCharacterRoutes(app: Express, ctx: RegisterCharacterRoutesDeps): CharacterFacts {
  const { requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef, sendApiError } = ctx.http;
  const root = path.join(ctx.paths.RUNTIME_DATA_DIR, 'characters'), cloud = new CharacterCloud(ctx.account), records = new CharacterRecords(root);
  const packages = new CharacterPackages(root, cloud, ctx.fetchFile);

  type Access = 'read' | 'free' | 'user';
  /** Sends the refusal itself. */
  function allowed(req: Request, res: Response, access: Access): boolean {
    const refuse = (error: CharacterError): false => { res.status(error.status).json(error.response()); return false; };
    if (isAgentToken(req)) {
      if (access === 'user') return refuse(new CharacterError('CHARACTER_USER_ONLY'));
      // Reading and the free changes go with the right to make art for a game.
      const grant = toolTokenRegistry.validate(bearerTokenFromRequest(req), { operation: 'media:generate', endpoint: '/api/tools/media/generate' });
      return grant.ok || refuse(new CharacterError('CHARACTER_USER_ONLY'));
    }
    return access === 'read' || isLocalSameOrigin(req, resolvedPortRef.current) || refuse(new CharacterError('CHARACTER_USER_ONLY'));
  }

  function on(method: 'get' | 'post' | 'patch' | 'put' | 'delete', route: string, access: Access, handler: (req: Request, res: Response) => Promise<unknown>): void {
    app[method](route, requireLocalDaemonRequest, async (req: Request, res: Response) => {
      try {
        if (!allowed(req, res, access)) return;
        res.setHeader('Cache-Control', 'no-store');
        const result = await handler(req, res);
        // a file answers for itself
        if (result !== undefined) res.json(result);
      } catch (error) {
        const failure = characterError(error);
        if (!res.headersSent) res.status(failure.status).json(failure.response());
      }
    });
  }

  const projectDir = (project: Project): string => resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata) as string;
  const heroesOf = async (project: Project): Promise<InstalledCharacter[]> => {
    const dir = projectDir(project);
    return installedCharacters(dir, detectEngineProfile(dir, { resolveOnPath: () => null }));
  };

  /** Which games have which characters. Only games that one was ever put into are looked at. */
  async function games(): Promise<Map<string, CharacterGame[]>> {
    const found = new Map<string, CharacterGame[]>(), key = (characterId: string): string => isSampleCharacter(characterId) ? 'sample' : characterId;
    for (const projectId of (await records.read()).projects) {
      const project = getProject(ctx.db, projectId) as Project | null;
      if (!project) continue;
      for (const c of await heroesOf(project).catch(() => [])) found.set(key(c.characterId), [...found.get(key(c.characterId)) ?? [], { projectId, projectName: project.name, slug: c.slug, revision: c.revision }]);
    }
    return found;
  }

  async function local<T extends { id: string }>(characters: readonly T[]): Promise<(T & { games: CharacterGame[] })[]> {
    const used = await games();
    return characters.map(c => ({ ...c, games: used.get(isSampleCharacter(c.id) ? 'sample' : c.id) ?? [] }));
  }

  async function suggestions(): Promise<CharacterSuggestion[]> {
    return (await records.read()).suggestions.flatMap(s => {
      const project = getProject(ctx.db, s.projectId) as Project | null;
      return project ? [{ ...s, projectName: project.name }] : [];
    });
  }

  // --- The account's characters

  on('get', '/api/characters/service', 'read', async (): Promise<CharactersStatus> => {
    if (!cloud.available()) return { available: false, signedIn: false, service: null };
    const signedIn = await cloud.signedIn();
    // the page opens without the cloud too, and says what is wrong
    return { available: true, signedIn, service: signedIn ? await cloud.service().catch(() => null) : null };
  });
  on('get', '/api/characters', 'read', async (): Promise<CharactersResponse> => ({ characters: await local(await cloud.list()), suggestions: await suggestions() }));
  // Signed in or not, and it costs nothing: finished clothes, motions and all. It is nobody's, so every change of it is refused by the cloud.
  on('get', '/api/characters/sample', 'read', async (req): Promise<CharacterSampleResponse> => {
    const found = cloud.available() ? await cloud.sample(typeof req.query.language === 'string' ? req.query.language : 'en') : null;
    return { character: found ? (await local([found]))[0]! : null };
  });
  on('get', '/api/characters/gear', 'read', () => cloud.gear());
  on('get', '/api/characters/gear/icons/:file', 'read', async (req, res) => {
    const piece = /^([a-z]+\d+)\.png$/u.exec(param(req, 'file'))?.[1] ?? '', file = await packages.icon(piece);
    if (!file) throw new CharacterError('CHARACTER_NOT_FOUND');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    sendValidatedFile(res, file);
  });
  on('patch', '/api/characters/gear/:piece', 'user', req => cloud.renamePiece(matching(PIECE_ID, param(req, 'piece')), title(record(req.body).label, 40)));
  on('delete', '/api/characters/gear/:piece', 'user', async req => { const left = await cloud.removePiece(matching(PIECE_ID, param(req, 'piece'))); packages.forgetIcons(); return left; });
  on('delete', '/api/characters/gear/motions/:motion', 'user', req => cloud.removeGearMotion(matching(MOTION_NAME, param(req, 'motion'))));
  on('delete', '/api/characters/suggestions/:suggestion', 'user', async req => { await records.dropSuggestion(param(req, 'suggestion')); return { ok: true }; });

  on('post', '/api/characters/briefs', 'user', req => cloud.brief(briefRequest(req.body)));
  // The one way to spend credits here. It takes a price that the user was shown.
  on('post', '/api/characters/orders', 'user', req => {
    const o = record(req.body);
    if (typeof o.briefId !== 'string' || !CHARACTER_ID.test(o.briefId) || typeof o.requestId !== 'string' || !REQUEST_ID.test(o.requestId)) return invalid();
    return cloud.order({ briefId: o.briefId, requestId: o.requestId });
  });
  on('get', '/api/characters/jobs/:id', 'read', async req => {
    const job = await cloud.job(id(req));
    if (job.state === 'succeeded') packages.forgetIcons();
    return job;
  });

  on('get', '/api/characters/:id', 'read', async (req): Promise<LocalCharacter> => (await local([await cloud.get(id(req))]))[0]!);
  on('patch', '/api/characters/:id', 'free', async req => {
    const change = update(req.body);
    if (change.name !== undefined && isAgentToken(req)) throw new CharacterError('CHARACTER_USER_ONLY');
    return (await local([await cloud.update(own(req), change)]))[0];
  });
  on('delete', '/api/characters/:id', 'user', async req => { await cloud.remove(own(req)); await packages.forget(id(req)); return { id: id(req), deleted: true }; });
  on('put', '/api/characters/:id/motions/:motion', 'free', async req => (await local([await cloud.saveMotion(own(req), matching(MOTION_NAME, param(req, 'motion')), tuning(record(req.body).tuning))]))[0]);
  on('delete', '/api/characters/:id/motions/:motion', 'free', async req => (await local([await cloud.removeMotion(own(req), matching(MOTION_NAME, param(req, 'motion')))]))[0]);
  on('post', '/api/characters/:id/pack', 'free', req => {
    const { requestId = randomUUID() } = record(req.body);
    return typeof requestId === 'string' && REQUEST_ID.test(requestId) ? cloud.pack(own(req), requestId) : invalid();
  });
  on('post', '/api/characters/:id/tune', 'free', async (req, res) => {
    const o = record(req.body), gone = new AbortController();
    res.on('close', () => gone.abort());
    const bytes = await cloud.tune(own(req), matching(MOTION_NAME, String(o.motion)), tuning(o.tuning), wear(o.wear), gone.signal);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  });
  on('get', '/api/characters/:id/package/:revision/:file', 'read', async (req, res) => {
    const name = param(req, 'file'), file = await packages.file(id(req), Number(param(req, 'revision')), name);
    if (!file) throw new CharacterError('CHARACTER_NOT_FOUND');
    res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    // a revision never changes
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    sendValidatedFile(res, file);
  });

  // --- Characters in a game

  function onProject(method: 'get' | 'post' | 'delete', route: string, handler: (project: Project, req: Request, write: boolean) => Promise<unknown>): void {
    const write = method !== 'get';
    app[method](`/api/projects/:id/${route}`, requireLocalDaemonRequest, async (req: Request, res: Response) => {
      try {
        const project = getProject(ctx.db, param(req, 'id')) as Project | null;
        if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return; }
        const options = write ? { mode: 'write' as const, capability: 'writeFiles' as const } : { mode: 'read' as const };
        if (isAgentToken(req)) {
          const grant = toolTokenRegistry.validate(bearerTokenFromRequest(req), { operation: 'media:generate', endpoint: '/api/tools/media/generate' });
          if (!grant.ok || grant.grant.projectId !== project.id) { sendApiError(res, 403, 'FORBIDDEN', 'A tool token for this project is required'); return; }
          if (!await ctx.authorizeProjectToolRequest(res, project.id, options)) return;
        } else {
          if (write && !isLocalSameOrigin(req, resolvedPortRef.current)) { sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return; }
          if (!await ctx.authorizeProjectRequest(req, res, project.id, options)) return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json(await handler(project, req, write));
      } catch (error) {
        const failure = characterError(error);
        if (!res.headersSent) res.status(failure.status).json(failure.response());
      }
    });
  }
  /** An agent writes no files into a game whose plan waits for the user. */
  const planned = (project: Project, req: Request): void => { if (isAgentToken(req) && gamePlanIsPending(project.metadata)) throw new CharacterError('CHARACTER_USER_ONLY', `${GAME_PLAN_NOT_APPROVED}: putting characters into the game waits until the user approves the plan.`); };

  /** The character, with what was saved put into a package first: that is free, and a game should get what the user sees. */
  async function upToDate(characterId: string): Promise<AnimatedCharacter> {
    const character = await cloud.get(characterId);
    if (!character.changed) return character;
    const job = await cloud.pack(characterId, randomUUID());
    for (let i = 0; i < PACK_LOOKS; i++) {
      const now = await cloud.job(job.id);
      if (now.state === 'failed') throw new CharacterError(now.errorCode ?? 'CHARACTER_PACKING_FAILED');
      if (now.state === 'succeeded') return cloud.get(characterId);
      await new Promise(r => setTimeout(r, ctx.packPollMs ?? 1_500));
    }
    throw new CharacterError('CHARACTER_BUSY');
  }

  onProject('get', 'heroes', async (project): Promise<InstalledCharactersResponse> => ({ characters: await heroesOf(project) }));
  onProject('post', 'heroes', async (project, req) => {
    planned(project, req);
    const o = record(req.body);
    if (typeof o.characterId !== 'string' || !CHARACTER_ID.test(o.characterId) || (o.slug !== undefined && typeof o.slug !== 'string')) return invalid();
    const character = await upToDate(o.characterId), packed = await packages.newest(character.id), dir = await ensureProject(ctx.paths.PROJECTS_DIR, project.id, project.metadata) as string;
    const installed = await installCharacter({ projectDir: dir, profile: detectEngineProfile(dir, { resolveOnPath: () => null }), sdkDir: ctx.sdkDir, character, package: packed, ...(o.slug ? { slug: o.slug } : {}) });
    await records.addProject(project.id);
    return installed;
  });
  onProject('delete', 'heroes/:slug', async (project, req) => {
    planned(project, req);
    const dir = projectDir(project);
    await removeCharacter(dir, detectEngineProfile(dir, { resolveOnPath: () => null }), param(req, 'slug'));
    return { ok: true };
  });
  /** An agent proposes; the user sees it on the Characters page with its price and orders, or not. */
  onProject('post', 'heroes/suggest', async (project, req): Promise<CharacterSuggestion> => {
    if (!cloud.available()) throw new CharacterError('CHARACTER_NOT_CONFIGURED');
    const o = record(req.body), saved = await records.suggest({ projectId: project.id, text: words(o.text), style: o.style == null ? null : one(CHARACTER_STYLES, o.style), armor: o.armor === true, gear: o.gear === true });
    return { ...saved, projectName: project.name };
  });

  return {
    async promptFacts(projectId) {
      if (!projectId || !cloud.available()) return null;
      const project = getProject(ctx.db, projectId) as Project | null;
      if (!project) return null;
      const account = await cloud.signedIn().catch(() => false), installed = (await heroesOf(project).catch(() => [])).map(({ slug, name, folder, characterId }) => ({ slug, name, folder, ...(isSampleCharacter(characterId) ? { sample: true } : {}) }));
      // someone who is signed out can still have the sample in a game, or a copy of what they made
      return account || installed.length ? { installed, account } : null;
    },
  };
}
