import type { Express, Request, Response } from 'express';
import {
  PRODUCT_CLI_NAME, type GameRunStatus, type OnlineDataResponse, type OnlineSeedRequest, type OnlineStatusResponse,
  type OnlineTestRequest, type OnlineTestResponse,
} from '@openpixo/contracts';
import { AccountError, PublishCloudError } from '../account/errors.js';
import type { OpenPixoAccountService } from '../account/service.js';
import { gameLocalUrl } from '../game/verify-process.js';
import { OnlineRefusal, type OnlineEmulator } from '../online/emulator.js';
import { findInstalledOnlineSdk, installOnlineSdk, OnlineSdkEditedError } from '../online/sdk-install.js';
import { authorizePublishCaller, sendPublishFailure } from '../publish/route-auth.js';
import { PublishRequestError, type PublishService } from '../publish/service.js';
import { webProjectCwd } from '../publish/web-project.js';
import { findInstalledRoomsSdk } from '../rooms/sdk-install.js';
import type { RouteDeps } from '../server-context.js';
import { localOnlineEmulatorUrl } from './online-local.js';
import { LOCAL_ROOMS_RELAY_PATH } from './rooms-local.js';

/** The daemon-owned game process, the same one the Run button controls. */
export interface OnlineGameRuns {
  status(projectId: string): GameRunStatus;
  start(projectId: string): Promise<GameRunStatus>;
}

export type OnlineCloudAccount = Pick<OpenPixoAccountService, 'assertConfigured' | 'hasSession' | 'onlineStatus' | 'onlineReset'>;

export interface RegisterOnlineRoutesDeps extends RouteDeps<'db' | 'http' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'> {
  publish: PublishService;
  gameRuns: OnlineGameRuns;
  sdkDir: string;
  emulator: OnlineEmulator;
  /** Absent when the build has no cloud. */
  account?: OnlineCloudAccount | undefined;
  /** Test seam for the wait between dev-server status reads. */
  runPollMs?: number;
}

/** The dev server has this long to print its URL; the run service enforces its own startup timeout inside it. */
const RUN_WAIT_MS = 60_000;
const ACTION = 'use OpenPixo online features';

const REFUSAL_STATUS: Partial<Record<OnlineRefusal['code'], number>> = { 'too-large': 413, 'not-found': 404 };

function parseSeed(body: unknown): OnlineSeedRequest | null {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) return null;
  const { players, collection, key, data } = body as Record<string, unknown>;
  if (players !== undefined && typeof players !== 'number') return null;
  if ((collection !== undefined && typeof collection !== 'string') || (key !== undefined && typeof key !== 'string')) return null;
  return { ...(players !== undefined ? { players } : {}), ...(collection !== undefined ? { collection } : {}),
    ...(key !== undefined ? { key } : {}), ...(data !== undefined ? { data } : {}) };
}

export function registerOnlineRoutes(app: Express, ctx: RegisterOnlineRoutesDeps): void {
  const { sendApiError, requireLocalDaemonRequest, resolvedPortRef } = ctx.http;

  function sendFailure(res: Response, error: unknown): void {
    if (error instanceof OnlineSdkEditedError) { sendApiError(res, 409, 'CONFLICT', error.message); return; }
    if (error instanceof OnlineRefusal) { sendApiError(res, REFUSAL_STATUS[error.code] ?? 400, 'BAD_REQUEST', error.message); return; }
    sendPublishFailure(ctx, res, error);
  }

  /** The creator's session or this project's run token; `write` also covers local test data. */
  const authorize = (req: Request, res: Response, write: boolean) =>
    authorizePublishCaller(ctx, req, res, { write, operation: write ? 'online:write' : 'online:read' });

  async function usage(shareId: string | undefined): Promise<Pick<OnlineStatusResponse, 'usage' | 'cloudUnknown'>> {
    if (!shareId || !ctx.account) return { usage: null };
    try { ctx.account.assertConfigured(); }
    catch { return { usage: null }; }
    if (!await ctx.account.hasSession()) return { usage: null, cloudUnknown: true };
    try { return { usage: await ctx.account.onlineStatus(shareId) }; }
    catch (error) {
      // A link the cloud no longer knows has no online data; publish status forgets it.
      if (error instanceof PublishCloudError && error.code === 'SHARE_NOT_FOUND') return { usage: null };
      // Offline, signed out or a cloud without online features yet: local facts still help.
      if (error instanceof AccountError) return { usage: null, cloudUnknown: true };
      throw error;
    }
  }

  async function status(projectId: string): Promise<OnlineStatusResponse> {
    const context = await ctx.publish.context(projectId);
    const sdkPath = await findInstalledOnlineSdk(context.projectDir, webProjectCwd(context.profile));
    return { sdkInstalled: sdkPath !== null, ...(sdkPath ? { sdkPath } : {}), ...await usage(context.shareId), local: ctx.emulator.summary(projectId) };
  }

  /** Waits for the dev server to report its URL, starting it first when it is not running. */
  async function runningGameUrl(projectId: string): Promise<string> {
    let run = ctx.gameRuns.status(projectId);
    if (run.status !== 'running' && run.status !== 'starting') run = await ctx.gameRuns.start(projectId);
    const deadline = Date.now() + RUN_WAIT_MS;
    while (run.status === 'starting' || (run.status === 'running' && !run.url)) {
      if (Date.now() >= deadline) throw new PublishRequestError(409, 'CONFLICT', 'The game did not report a local URL in time. Check its log, then run the test again.');
      await new Promise(resolve => setTimeout(resolve, ctx.runPollMs ?? 250));
      run = ctx.gameRuns.status(projectId);
    }
    if (run.status !== 'running' || !run.url) {
      throw new PublishRequestError(409, 'CONFLICT', `The game could not start for an online test. ${run.message ?? 'Run the game once and check its log.'}`);
    }
    return run.url;
  }

  app.get('/api/projects/:id/online', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, false)) return;
      res.setHeader('Cache-Control', 'no-store');
      res.json(await status(String(req.params.id)));
    } catch (error) { sendFailure(res, error); }
  });

  app.post('/api/projects/:id/online/install', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, true)) return;
      const context = await ctx.publish.webContext(String(req.params.id), ACTION);
      res.setHeader('Cache-Control', 'no-store');
      res.json(await installOnlineSdk({ sdkDir: ctx.sdkDir, projectDir: context.projectDir, cwd: webProjectCwd(context.profile) }));
    } catch (error) { sendFailure(res, error); }
  });

  app.post('/api/projects/:id/online/test', requireLocalDaemonRequest, async (req, res) => {
    try {
      const caller = await authorize(req, res, true);
      if (!caller) return;
      const id = String(req.params.id);
      const context = await ctx.publish.webContext(id, ACTION);
      const requested = (req.body as OnlineTestRequest | undefined)?.gameUrl;
      if (requested !== undefined && (typeof requested !== 'string' || !gameLocalUrl(requested))) {
        sendApiError(res, 400, 'BAD_REQUEST', 'gameUrl must be a local http URL of the running game'); return;
      }
      let gameUrl = requested;
      if (!gameUrl) {
        const run = ctx.gameRuns.status(id);
        if (caller.agent && !(run.status === 'running' && run.url)) {
          // Starting the project's command from the daemon would run it outside the agent's sandbox.
          sendApiError(res, 409, 'CONFLICT', `The game is not running. Start its dev server yourself, then run ${PRODUCT_CLI_NAME} online test --url <its local URL>.`); return;
        }
        gameUrl = await runningGameUrl(id);
      }
      // Ports change between runs, so these URLs are built fresh and never saved.
      const emulatorUrl = localOnlineEmulatorUrl(resolvedPortRef.current, id);
      const url = new URL(gameUrl);
      url.searchParams.set('pixoOnline', emulatorUrl);
      if (await findInstalledRoomsSdk(context.projectDir, webProjectCwd(context.profile))) {
        url.searchParams.set('pixoRooms', `http://127.0.0.1:${resolvedPortRef.current}${LOCAL_ROOMS_RELAY_PATH}`);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ url: url.href, emulatorUrl } satisfies OnlineTestResponse);
    } catch (error) { sendFailure(res, error); }
  });

  app.post('/api/projects/:id/online/seed', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, true)) return;
      const request = parseSeed(req.body);
      if (!request) { sendApiError(res, 400, 'BAD_REQUEST', 'That seed request could not be read.'); return; }
      res.setHeader('Cache-Control', 'no-store');
      res.json(ctx.emulator.seed(String(req.params.id), request));
    } catch (error) { sendFailure(res, error); }
  });

  app.get('/api/projects/:id/online/data', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, false)) return;
      const collection = typeof req.query.collection === 'string' && req.query.collection ? req.query.collection : undefined;
      res.setHeader('Cache-Control', 'no-store');
      res.json(ctx.emulator.data(String(req.params.id), collection) satisfies OnlineDataResponse);
    } catch (error) { sendFailure(res, error); }
  });

  app.delete('/api/projects/:id/online/data', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, true)) return;
      const id = String(req.params.id);
      ctx.emulator.reset(id);
      res.setHeader('Cache-Control', 'no-store');
      res.json(ctx.emulator.data(id) satisfies OnlineDataResponse);
    } catch (error) { sendFailure(res, error); }
  });

  app.delete('/api/projects/:id/online/hosted', requireLocalDaemonRequest, async (req, res) => {
    try {
      const caller = await authorize(req, res, true);
      if (!caller) return;
      // Every player's saves on the public link go, and nothing brings them back.
      if (caller.agent) { sendApiError(res, 403, 'FORBIDDEN', `Only the creator can clear the public game's online data: the Share dialog, or ${PRODUCT_CLI_NAME} online reset --hosted in their own terminal.`); return; }
      const { shareId } = await ctx.publish.context(String(req.params.id));
      if (!shareId) { sendApiError(res, 409, 'CONFLICT', 'This game has no public link, so it has no online data to clear.'); return; }
      if (!ctx.account) throw new AccountError('ACCOUNT_NOT_CONFIGURED');
      await ctx.account.onlineReset(shareId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true });
    } catch (error) { sendFailure(res, error); }
  });
}
