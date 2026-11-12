import type { Express, Request, Response } from 'express';
import { readAppConfig } from '../app-config.js';
import { getProject } from '../db.js';
import { detectEngineProfile } from '../game/engine-detect.js';
import { GameRunManager } from '../game/run.js';
import type { GameInstallDepsResult, GameRunStatus } from '@openpixo/contracts';
import { installGameDependencies, prepareGameDependencyInstall, resolveGameCommandDirectory } from '../game/install-deps.js';
import { recordProjectGameRun } from '../project-start/game-run-record.js';
import { gameToolResolver } from '../game/verify.js';
import { bearerTokenFromRequest } from '../http/tool-request-auth.js';
import { resolveProjectDir } from '../projects.js';
import type { RouteDeps } from '../server-context.js';

export type RegisterGameRunRoutesDeps = RouteDeps<'db' | 'http' | 'paths' | 'authorizeProjectRequest'>;

/** Stops every game process; `control` lets another domain share the same processes as the Run button. */
export interface GameRunRoutesHandle {
  (): Promise<void>;
  control: {
    status(projectId: string): GameRunStatus;
    start(projectId: string): Promise<GameRunStatus>;
    /** Ends the project's game and any dependency install, and waits for both. */
    stop(projectId: string): Promise<void>;
  };
}

export function registerGameRunRoutes(app: Express, ctx: RegisterGameRunRoutesDeps): GameRunRoutesHandle {
  const manager = new GameRunManager(ctx.paths.RUNTIME_DATA_DIR, (id, state) => recordProjectGameRun(ctx.db, id, state));
  const installs = new Map<string, { result: GameInstallDepsResult; controller: AbortController; pending?: Promise<void> }>();
  let disposed = false;
  const { sendApiError, requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  const error = (res: Response, caught: unknown) => sendApiError(res, 400, 'BAD_REQUEST', caught instanceof Error ? caught.message : String(caught));

  async function authorize(req: Request, res: Response, write: boolean): Promise<boolean> {
    // Host-owned game processes must never provide an escape from an agent sandbox.
    if (bearerTokenFromRequest(req)?.startsWith('pixott_')) {
      sendApiError(res, 403, 'FORBIDDEN', 'Game run controls require the local OpenPixo user session'); return false;
    }
    if (write && !isLocalSameOrigin(req, resolvedPortRef.current)) {
      sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return false;
    }
    const id = String(req.params.id);
    if (!getProject(ctx.db, id)) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return false; }
    return ctx.authorizeProjectRequest(req, res, id, write ? { mode: 'write', capability: 'writeFiles' } : { mode: 'read' });
  }

  async function prepare(id: string) {
    const project = getProject(ctx.db, id);
    if (!project) throw new Error('Project no longer exists');
    const projectDir = resolveProjectDir(ctx.paths.PROJECTS_DIR, id, project.metadata);
    const config = await readAppConfig(ctx.paths.RUNTIME_DATA_DIR);
    const toolPaths = config.gameEnginePaths ?? {};
    return { profile: detectEngineProfile(projectDir, { enginePaths: toolPaths }), projectDir, resolveTool: gameToolResolver({ ...toolPaths }) };
  }

  app.get('/api/projects/:id/game/install-deps', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, false)) return;
      res.setHeader('Cache-Control', 'no-store');
      const current = installs.get(String(req.params.id));
      if (current) return res.json(current.result);
      const context = await prepare(String(req.params.id));
      if (!['phaser', 'threejs', 'web-generic'].includes(context.profile.engine)) return res.json({ status: 'failed', reasonCode: 'UNSUPPORTED_ENGINE' });
      const command = context.profile.commands.run ?? context.profile.commands.build ?? context.profile.commands.check;
      const cwd = await resolveGameCommandDirectory(context.projectDir, command?.cwd ?? '.');
      const { executable: _executable, argv: _argv, node: _node, ...result } = await prepareGameDependencyInstall(cwd, context.resolveTool);
      return res.json(result);
    } catch (caught) { error(res, caught); }
  });

  app.post('/api/projects/:id/game/install-deps', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, true)) return;
      if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) {
        throw new Error('Dependency installation does not accept command arguments');
      }
      if (disposed) return res.json({ status: 'failed', reasonCode: 'INSTALL_CANCELLED' });
      const id = String(req.params.id);
      res.setHeader('Cache-Control', 'no-store');
      const current = installs.get(id);
      if (current?.pending) return res.json(current.result);
      if (['starting', 'running'].includes(manager.status(id).status)) return res.json({ status: 'failed', reasonCode: 'INSTALL_BUSY' });
      // Reserve before async preflight so concurrent clicks share one installation.
      const entry: { result: GameInstallDepsResult; controller: AbortController; pending?: Promise<void> } = {
        result: { status: 'installing' }, controller: new AbortController(),
      };
      installs.set(id, entry);
      entry.pending = (async () => {
        const context = await prepare(id);
        if (!['phaser', 'threejs', 'web-generic'].includes(context.profile.engine)) {
          entry.result = { status: 'failed', reasonCode: 'UNSUPPORTED_ENGINE' }; return;
        }
        const command = context.profile.commands.run ?? context.profile.commands.build ?? context.profile.commands.check;
        const cwd = await resolveGameCommandDirectory(context.projectDir, command?.cwd ?? '.');
        entry.result = await installGameDependencies(cwd, ctx.paths.RUNTIME_DATA_DIR, context.resolveTool, {
          signal: entry.controller.signal,
          onOutput: logTail => { entry.result = { ...entry.result, logTail }; },
        });
      })().catch(caught => {
        entry.result = { ...entry.result, status: 'failed', reasonCode: 'INSTALL_FAILED', message: caught instanceof Error ? caught.message : String(caught) };
      }).finally(() => { delete entry.pending; });
      return res.json(entry.result);
    } catch (caught) { error(res, caught); }
  });

  app.get('/api/projects/:id/game/run', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, false)) return;
      res.setHeader('Cache-Control', 'no-store'); res.json(manager.status(String(req.params.id)));
    } catch (caught) { error(res, caught); }
  });

  app.post('/api/projects/:id/game/run', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, true)) return;
      if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) {
        throw new Error('Game run does not accept command arguments');
      }
      const id = String(req.params.id);
      if (installs.get(id)?.pending) return res.json({ status: 'failed', reasonCode: 'INSTALL_BUSY' });
      const result = await manager.start(id, () => prepare(id));
      res.setHeader('Cache-Control', 'no-store'); res.json(result);
    } catch (caught) { error(res, caught); }
  });

  app.delete('/api/projects/:id/game/run', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, true)) return;
      res.setHeader('Cache-Control', 'no-store'); res.json(await manager.stop(String(req.params.id)));
    } catch (caught) { error(res, caught); }
  });

  app.get('/api/projects/:id/game/run/logs/:ref', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, false)) return;
      const log = manager.log(String(req.params.id), String(req.params.ref));
      if (log === null) { sendApiError(res, 404, 'NOT_FOUND', 'Game run log not found'); return; }
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.type('text/plain').send(log);
    } catch (caught) { error(res, caught); }
  });

  const stop = async () => {
    disposed = true;
    for (const entry of installs.values()) entry.controller.abort();
    await Promise.all([manager.dispose(), ...[...installs.values()].map(entry => entry.pending)]);
  };
  return Object.assign(stop, { control: {
    status: (projectId: string) => manager.status(projectId),
    start: async (projectId: string): Promise<GameRunStatus> => installs.get(projectId)?.pending
      ? { status: 'failed', reasonCode: 'INSTALL_BUSY', message: 'Project dependencies are still installing. Try again when they finish.' }
      : manager.start(projectId, () => prepare(projectId)),
    stop: async (projectId: string) => {
      const install = installs.get(projectId);
      install?.controller.abort();
      await Promise.allSettled([manager.stop(projectId), install?.pending]);
    },
  } });
}
