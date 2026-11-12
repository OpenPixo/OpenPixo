/**
 * `/api/projects/:id/game/export`: the web game as one HTML file that plays offline.
 * See `game/export-playable.ts` for why it has to be one file.
 *
 * GET says whether the project can be exported and which HTML file is the game, so
 * the export menu offers it there. POST builds (unless the caller already did),
 * reads the build output and answers with the file itself. The daemon never writes
 * the export anywhere: the UI saves it where the user picks, the CLI where it is told.
 * An agent builds inside its own CLI process first, like publishing.
 */
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Express, Response } from 'express';
import {
  GAME_EXPORT_FILES_HEADER, GAME_EXPORT_LIMITS, PRODUCT_CLI_NAME, gameExportFileName,
  type GameExportErrorCode, type GameExportRequest, type GameExportStatusResponse,
} from '@openpixo/contracts';
import { buildPlayableHtml, GameExportError } from '../game/export-playable.js';
import { PublishBuildError } from '../publish/build.js';
import { findBuildOutput, PublishBundleError } from '../publish/bundle.js';
import { authorizePublishCaller, sendPublishFailure, type PublishRouteAuthDeps } from '../publish/route-auth.js';
import { PublishRequestError, type PublishService } from '../publish/service.js';
import { isWebProject, unsupportedEngineMessage, webProjectCwd } from '../publish/web-project.js';

export interface RegisterGameExportRoutesDeps extends PublishRouteAuthDeps {
  publish: PublishService;
}

/** Folders a build output never needs, and dot segments, which are private by convention. */
const SKIPPED = new Set(['node_modules']);

/** Every file under the build output, by its path relative to it. Links that leave it are skipped. */
export async function readBuildFiles(rootDir: string): Promise<Map<string, Buffer>> {
  const root = await realpath(rootDir);
  const files = new Map<string, Buffer>();
  let total = 0;
  const tooLarge = () => new GameExportError('GAME_EXPORT_TOO_LARGE',
    `This game is too big for one offline file (more than ${GAME_EXPORT_LIMITS.totalBytes / (1024 * 1024)} MB or ${GAME_EXPORT_LIMITS.files} files). Remove unused assets from the build, then export again.`);
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = await lstat(absolute);
      let target = absolute;
      if (info.isSymbolicLink()) {
        const real = await realpath(absolute).catch(() => null);
        if (!real || (real !== root && !real.startsWith(root + path.sep))) continue;
        target = real;
      }
      const resolved = target === absolute ? info : await lstat(target);
      if (resolved.isDirectory()) { await walk(target, relative); continue; }
      if (!resolved.isFile()) continue;
      total += resolved.size;
      if (files.size >= GAME_EXPORT_LIMITS.files || total > GAME_EXPORT_LIMITS.totalBytes) throw tooLarge();
      files.set(relative, await readFile(target));
    }
  };
  await walk(root, '');
  return files;
}

function parseRequest(body: unknown): GameExportRequest | null {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) return null;
  const { skipBuild } = body as Record<string, unknown>;
  if (skipBuild !== undefined && typeof skipBuild !== 'boolean') return null;
  return skipBuild ? { skipBuild: true } : {};
}

function entryOf(cwd: string): string {
  return path.posix.join(cwd === '.' ? '' : cwd, 'index.html');
}

export function registerGameExportRoutes(app: Express, ctx: RegisterGameExportRoutesDeps): void {
  const { sendApiError, requireLocalDaemonRequest } = ctx.http;
  const running = new Set<string>();
  const fail = (res: Response, status: number, code: GameExportErrorCode, message: string) => sendApiError(res, status, code, message);

  app.get('/api/projects/:id/game/export', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorizePublishCaller(ctx, req, res, { write: false, operation: 'game:export' })) return;
      const context = await ctx.publish.context(String(req.params.id));
      res.setHeader('Cache-Control', 'no-store');
      const status: GameExportStatusResponse = isWebProject(context.profile, context.projectDir)
        ? { available: true, entry: entryOf(webProjectCwd(context.profile)) }
        : { available: false, message: unsupportedEngineMessage(context.profile, 'be exported as an offline web page') };
      res.json(status);
    } catch (error) { sendPublishFailure(ctx, res, error); }
  });

  app.post('/api/projects/:id/game/export', requireLocalDaemonRequest, async (req, res) => {
    const id = String(req.params.id);
    let locked = false;
    try {
      const caller = await authorizePublishCaller(ctx, req, res, { write: true, operation: 'game:export' });
      if (!caller) return;
      const request = parseRequest(req.body);
      if (!request) { sendApiError(res, 400, 'BAD_REQUEST', 'That export request could not be read.'); return; }
      // The daemon's build runs outside the agent's sandbox, so an agent builds in its own CLI process first.
      if (caller.agent && !request.skipBuild) {
        sendApiError(res, 403, 'FORBIDDEN', `Agent exports must build inside the ${PRODUCT_CLI_NAME} CLI process; run ${PRODUCT_CLI_NAME} game export`);
        return;
      }
      if (running.has(id)) { fail(res, 409, 'GAME_EXPORT_BUSY', 'An export of this game is already running. Wait for it to finish.'); return; }
      running.add(id);
      locked = true;
      let context;
      try { context = await ctx.publish.webContext(id, 'be exported as an offline web page'); }
      catch (error) {
        if (error instanceof PublishRequestError && error.status === 422) { fail(res, 422, 'GAME_EXPORT_UNSUPPORTED', error.message); return; }
        throw error;
      }
      if (!request.skipBuild) {
        try { await ctx.publish.build(context, 'export again'); }
        catch (error) {
          if (error instanceof PublishBuildError) { fail(res, 422, 'GAME_EXPORT_BUILD_FAILED', error.message); return; }
          throw error;
        }
      }
      let output;
      try { output = await findBuildOutput(context.projectDir, webProjectCwd(context.profile), Boolean(context.profile.commands.build)); }
      catch (error) {
        if (error instanceof PublishBundleError) { fail(res, 422, 'GAME_EXPORT_NO_OUTPUT', error.message.replace(/publish/giu, 'export')); return; }
        throw error;
      }
      const files = await readBuildFiles(output.rootDir);
      const index = files.get('index.html');
      if (!index) { fail(res, 422, 'GAME_EXPORT_NO_OUTPUT', 'The build folder has no index.html at its root.'); return; }
      const { html, embedded } = buildPlayableHtml(index.toString('utf8'), files);
      const name = gameExportFileName(context.title);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="game.html"; filename*=UTF-8''${encodeURIComponent(name)}`);
      res.setHeader(GAME_EXPORT_FILES_HEADER, String(embedded));
      res.send(html);
    } catch (error) {
      if (error instanceof GameExportError) { fail(res, 422, error.code, error.message); return; }
      sendPublishFailure(ctx, res, error);
    } finally {
      if (locked) running.delete(id);
    }
  });
}
