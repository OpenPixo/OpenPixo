import type { Express, Response } from 'express';
import { PRODUCT_CLI_NAME, type GameRunStatus, type RoomsLimitRequest, type RoomsStatusResponse, type RoomsTestRequest, type RoomsTestResponse } from '@openpixo/contracts';
import { AccountError } from '../account/errors.js';
import { gameLocalUrl } from '../game/verify-process.js';
import { authorizePublishCaller, sendPublishFailure } from '../publish/route-auth.js';
import { PublishRequestError, type PublishService } from '../publish/service.js';
import { webProjectCwd } from '../publish/web-project.js';
import { findInstalledRoomsSdk, installRoomsSdk, RoomsSdkEditedError } from '../rooms/sdk-install.js';
import type { RouteDeps } from '../server-context.js';
import { LOCAL_ROOMS_RELAY_PATH } from './rooms-local.js';
import { LOCAL_RELAY_LIMITS } from '../rooms/relay.js';

/** The daemon-owned game process, the same one the Run button controls. */
export interface RoomsGameRuns {
  status(projectId: string): GameRunStatus;
  start(projectId: string): Promise<GameRunStatus>;
}

export interface RegisterRoomsRoutesDeps extends RouteDeps<'db' | 'http' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'> {
  publish: PublishService;
  gameRuns: RoomsGameRuns;
  sdkDir: string;
  /** Test seam for the wait between dev-server status reads. */
  runPollMs?: number;
}

/** The cloud refuses more, and would only say it is unavailable. */
const MONTHLY_LIMIT_MAX = 10_000_000;
/** The dev server has this long to print its URL; the run service enforces its own startup timeout inside it. */
const RUN_WAIT_MS = 60_000;
/** Shown until the cloud can answer. The cloud's config row is the real source of these numbers. */
const FALLBACK_CREDITS_PER_PLAYER_HOUR = 5;

function roomsTestUrl(gameUrl: string, relayUrl: string): string {
  const url = new URL(gameUrl);
  url.searchParams.set('pixoRooms', relayUrl);
  return url.href;
}

export function registerRoomsRoutes(app: Express, ctx: RegisterRoomsRoutesDeps): void {
  const { sendApiError, requireLocalDaemonRequest, resolvedPortRef } = ctx.http;

  function sendFailure(res: Response, error: unknown): void {
    if (error instanceof RoomsSdkEditedError) { sendApiError(res, 409, 'CONFLICT', error.message); return; }
    sendPublishFailure(ctx, res, error);
  }

  async function status(projectId: string): Promise<RoomsStatusResponse> {
    const context = await ctx.publish.context(projectId);
    const sdkPath = await findInstalledRoomsSdk(context.projectDir, webProjectCwd(context.profile));
    const base = { sdkInstalled: sdkPath !== null, ...(sdkPath ? { sdkPath } : {}) };
    let share;
    try { share = await ctx.publish.shareStatus(projectId, context.shareId); }
    catch (error) {
      // Offline or signed out: what is installed locally is still worth showing.
      if (!(error instanceof AccountError)) throw error;
      return { ...base, usage: null, paused: true, cloudUnknown: true, maxPlayers: LOCAL_RELAY_LIMITS.maxPlayers, creditsPerPlayerHour: FALLBACK_CREDITS_PER_PLAYER_HOUR };
    }
    return { ...base, usage: context.shareId ? share.usage : null, paused: share.paused.rooms,
      maxPlayers: share.limits.maxPlayers, creditsPerPlayerHour: share.limits.creditsPerPlayerHour };
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
      throw new PublishRequestError(409, 'CONFLICT', `The game could not start for a rooms test. ${run.message ?? 'Run the game once and check its log.'}`);
    }
    return run.url;
  }

  app.get('/api/projects/:id/rooms', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorizePublishCaller(ctx, req, res, { write: false, operation: 'rooms:read' })) return;
      res.setHeader('Cache-Control', 'no-store');
      res.json(await status(String(req.params.id)));
    } catch (error) { sendFailure(res, error); }
  });

  app.patch('/api/projects/:id/rooms', requireLocalDaemonRequest, async (req, res) => {
    try {
      const caller = await authorizePublishCaller(ctx, req, res, { write: true, operation: 'rooms:write' });
      if (!caller) return;
      // This is how much of the creator's money the game may spend.
      if (caller.agent) { sendApiError(res, 403, 'FORBIDDEN', `Only the creator can change the spending limit: the Share dialog, or ${PRODUCT_CLI_NAME} rooms limit in their own terminal.`); return; }
      const limit = (req.body as Partial<RoomsLimitRequest> | undefined)?.monthlyCreditLimit;
      if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0 || limit > MONTHLY_LIMIT_MAX) {
        sendApiError(res, 400, 'BAD_REQUEST', 'The limit must be a whole number of credits, from 0 to 10,000,000.'); return;
      }
      const id = String(req.params.id);
      await ctx.publish.setRoomsLimit(id, limit);
      res.setHeader('Cache-Control', 'no-store');
      res.json(await status(id));
    } catch (error) { sendFailure(res, error); }
  });

  app.post('/api/projects/:id/rooms/install', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorizePublishCaller(ctx, req, res, { write: true, operation: 'rooms:write' })) return;
      const context = await ctx.publish.webContext(String(req.params.id), 'use OpenPixo rooms');
      res.setHeader('Cache-Control', 'no-store');
      res.json(await installRoomsSdk({ sdkDir: ctx.sdkDir, projectDir: context.projectDir, cwd: webProjectCwd(context.profile) }));
    } catch (error) { sendFailure(res, error); }
  });

  app.post('/api/projects/:id/rooms/test', requireLocalDaemonRequest, async (req, res) => {
    try {
      const caller = await authorizePublishCaller(ctx, req, res, { write: true, operation: 'rooms:write' });
      if (!caller) return;
      const id = String(req.params.id);
      await ctx.publish.webContext(id, 'use OpenPixo rooms');
      const requested = (req.body as RoomsTestRequest | undefined)?.gameUrl;
      if (requested !== undefined && (typeof requested !== 'string' || !gameLocalUrl(requested))) {
        sendApiError(res, 400, 'BAD_REQUEST', 'gameUrl must be a local http URL of the running game'); return;
      }
      let gameUrl = requested;
      if (!gameUrl) {
        const run = ctx.gameRuns.status(id);
        if (caller.agent && !(run.status === 'running' && run.url)) {
          // Starting the project's command from the daemon would run it outside the agent's sandbox.
          sendApiError(res, 409, 'CONFLICT', `The game is not running. Start its dev server yourself, then run ${PRODUCT_CLI_NAME} rooms test --url <its local URL>.`); return;
        }
        gameUrl = await runningGameUrl(id);
      }
      // Ports change between runs, so these URLs are built fresh and never saved.
      const relayUrl = `http://127.0.0.1:${resolvedPortRef.current}${LOCAL_ROOMS_RELAY_PATH}`;
      const url = roomsTestUrl(gameUrl, relayUrl);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ urls: [url, url], relayUrl } satisfies RoomsTestResponse);
    } catch (error) { sendFailure(res, error); }
  });
}
