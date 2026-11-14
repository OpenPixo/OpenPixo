import type { Express, Request, Response } from 'express';
import multer from 'multer';
import { GenerateAdoptRequestSchema, GenerateQuoteRequestSchema, GenerateRunRequestSchema, type RecipeRun } from '@openpixo/contracts';
import { sendValidatedFile } from '../http/send-file.js';
import { ALL_GAMES } from './executor.js';
import { GENERATE_REFERENCE_MAX_BYTES, saveGenerateReference, sweepGenerateReferences } from './generate-area.js';
import type { RecipeRunHandlers, RunTarget } from './routes.js';

const referenceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: GENERATE_REFERENCE_MAX_BYTES, files: 1 } }).single('file');

/**
 * The 生成 page's surface: every run on this machine, with the game in the body instead of
 * the path, so the same page makes art for a game or for none. These are the same runs,
 * quotes and rules as `/api/projects/:id/recipe-runs` (one set of handlers serves both); an
 * agent's token reaches only its own game here too.
 */
export function registerGenerateRoutes(app: Express, handlers: RecipeRunHandlers): void {
  const { executor, http, fail, game, noGame, agentGrant } = handlers;
  const { requireLocalDaemonRequest, sendApiError } = http;
  void sweepGenerateReferences(handlers.generateRoot).catch(() => {});

  const targetFor = (req: Request, res: Response, write: boolean, projectId: string | null | undefined): Promise<RunTarget | null> =>
    projectId ? game(req, res, write, projectId) : noGame(req, res, write);
  /** A run by id, and the target its game (or no game) grants this request. */
  async function runTarget(req: Request, res: Response, write: boolean): Promise<{ run: RecipeRun; target: RunTarget } | null> {
    const run = await executor.get(ALL_GAMES, String(req.params.runId));
    const target = await targetFor(req, res, write, run.projectId);
    return target ? { run, target } : null;
  }

  app.get('/api/generate/runs', requireLocalDaemonRequest, async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : null;
      const noGameOnly = req.query.noGame === '1' || req.query.noGame === 'true';
      if (projectId) { if (!await game(req, res, false, projectId)) return; }
      else {
        const grant = agentGrant(req, res); if (grant === null) return;
        if (grant) { sendApiError(res, 403, 'FORBIDDEN', 'An agent\'s token lists only its own game\'s runs.'); return; }
      }
      const body = await handlers.list(projectId ?? (noGameOnly ? null : ALL_GAMES), req.query);
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (error) { fail(res, error); }
  });
  app.post('/api/generate/quote', requireLocalDaemonRequest, async (req, res) => {
    try {
      const { projectId, ...request } = GenerateQuoteRequestSchema.parse(req.body);
      const target = await targetFor(req, res, true, projectId); if (!target) return;
      await handlers.quote(target, request, res);
    } catch (error) { fail(res, error); }
  });
  app.post('/api/generate/runs', requireLocalDaemonRequest, async (req, res, next) => {
    try {
      const { projectId, ...request } = GenerateRunRequestSchema.parse(req.body);
      const target = await targetFor(req, res, true, projectId); if (!target) return;
      await handlers.run(target, request, req, res, next);
    } catch (error) { fail(res, error); }
  });
  app.get('/api/generate/runs/:runId', requireLocalDaemonRequest, async (req, res) => {
    try {
      const found = await runTarget(req, res, false); if (!found) return;
      res.setHeader('Cache-Control', 'no-store');
      res.json(found.run);
    } catch (error) { fail(res, error); }
  });
  app.get('/api/generate/runs/:runId/candidates/:candidateId/files/:index', requireLocalDaemonRequest, async (req, res) => {
    try {
      const found = await runTarget(req, res, false); if (!found) return;
      const staged = await executor.stagedFile(found.run.projectId, found.run.id, String(req.params.candidateId), Number(req.params.index));
      res.setHeader('Cache-Control', 'no-store');
      sendValidatedFile(res.type(staged.mime), staged.file);
    } catch (error) { fail(res, error); }
  });
  app.post('/api/generate/runs/:runId/cancel', requireLocalDaemonRequest, async (req, res) => {
    try {
      const found = await runTarget(req, res, true); if (!found) return;
      res.json(await executor.cancel(found.run.projectId, found.run.id));
    } catch (error) { fail(res, error); }
  });
  // Saves into the game in the body: the run's own, or any game for a run made with no game.
  app.post('/api/generate/runs/:runId/adopt', requireLocalDaemonRequest, async (req, res) => {
    try {
      const request = GenerateAdoptRequestSchema.parse(req.body);
      const run = await executor.get(ALL_GAMES, String(req.params.runId));
      if (run.projectId === null) {
        const grant = agentGrant(req, res); if (grant === null) return;
        if (grant) { sendApiError(res, 403, 'FORBIDDEN', 'An agent\'s token saves only its own game\'s runs.'); return; }
      }
      const target = await game(req, res, true, request.projectId); if (!target) return;
      const result = await executor.adopt(ALL_GAMES, run.id, request.candidateIds,
        { projectId: request.projectId, root: target.root, engine: target.value?.metadata?.engineProfile });
      res.json(result);
    } catch (error) { fail(res, error); }
  });
  // A picture for a run with no game to use as a reference; a game's runs use the game's files.
  app.post('/api/generate/references', requireLocalDaemonRequest, async (req, res) => {
    try {
      const target = await noGame(req, res, true); if (!target) return;
      await new Promise<void>((resolve, reject) => referenceUpload(req, res, error => error ? reject(error) : resolve()));
      const file = (req as Request & { file?: { buffer: Buffer } }).file;
      if (!file) { sendApiError(res, 400, 'RECIPE_INVALID', 'Send one picture in the "file" field.'); return; }
      res.json(await saveGenerateReference(target.root, file.buffer));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'UNSUPPORTED' || code === 'LIMIT_FILE_SIZE' || code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
        sendApiError(res, 400, 'RECIPE_INVALID', code === 'LIMIT_FILE_SIZE' ? 'A reference picture can be at most 16 MB.' : error instanceof Error ? error.message : 'Unsupported file');
        return;
      }
      fail(res, error);
    }
  });
}
