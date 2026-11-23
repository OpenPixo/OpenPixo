import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_HEADER_DEVICE_ID, type GameVerifyResult, type RecipeRun } from '@openpixo/contracts';
import {
  createGameFunnelRecorder,
  firstRunGuideProperties,
  gameCreatedProperties,
  gameFunnelProperties,
  gameVerifiedProperties,
  recipeCandidatesAdoptedProperties,
  type GameFunnelRecorder,
} from '../../src/game/game-funnel.js';
import { registerGamePlanRoutes } from '../../src/routes/game-plan.js';

const PRIVATE = ['一个关于猫的平台跳跃游戏', 'My secret pitch', 'C:\\Users\\me\\game\\hero.png', 'Super Cat Quest'] as const;

function sent(properties: Record<string, unknown>): string {
  return JSON.stringify(gameFunnelProperties(properties));
}

describe('what the game funnel may send', () => {
  it('keeps booleans, numbers and identifiers, and drops anything that could be user text', () => {
    expect(gameFunnelProperties({
      scope: 'quick', count: 3, ok: true, players: ['single', 'local-coop'],
      genre: '平台跳跃', title: 'Super Cat Quest', path: 'assets/hero.png ', spaced: 'two words',
      long: 'x'.repeat(65), nested: { scope: 'quick' }, mixed: ['ok', 'not ok'], nan: Number.NaN, nothing: undefined,
      BadKey: 'quick',
    })).toEqual({ scope: 'quick', count: 3, ok: true, players: ['single', 'local-coop'] });
  });

  it('counts a walkthrough move once, without the game it ran in, and nothing for other writes', () => {
    const play = { status: 'active', step: 'play', projectId: '7c0e9a52-private-game-id' } as const;
    expect(firstRunGuideProperties(undefined, play)).toEqual({ status: 'active', step: 'play', started: true });
    expect(firstRunGuideProperties(play, { ...play, step: 'tune' })).toMatchObject({ step: 'tune' });
    expect(firstRunGuideProperties(play, { ...play, status: 'skipped' })).toMatchObject({ status: 'skipped', step: 'play' });
    // A closed hint, the same state again, and a cleared state are not moves.
    expect(firstRunGuideProperties(play, { ...play, hintsSeen: ['plan'] })).toBeNull();
    expect(firstRunGuideProperties(play, { ...play })).toBeNull();
    expect(firstRunGuideProperties(play, undefined)).toBeNull();
    expect(sent(firstRunGuideProperties(undefined, play)!)).not.toContain('private-game-id');
  });

  it('describes a new game by its answers, never by what the user wrote', () => {
    const payload = sent(gameCreatedProperties({
      projectKind: 'other', experience: 'new', fromTemplate: false, ownFolder: true,
      setup: { title: PRIVATE[3], genre: PRIVATE[0], pitch: PRIVATE[1], comparables: ['Celeste'], scope: 'quick', perspective: 'side',
        players: ['single'], notes: PRIVATE[1], art: { styleId: 'pixel-16', palette: ['#FF0000'] } } as never,
    }));
    for (const text of [...PRIVATE, 'Celeste']) expect(payload).not.toContain(text);
    expect(JSON.parse(payload)).toMatchObject({ scope: 'quick', perspective: 'side', has_genre: true, has_pitch: true,
      has_comparables: true, has_style: true, has_palette: true, own_folder: true, experience: 'new' });
  });

  it('reports a verification by outcome only, without commands, logs or messages', () => {
    const result: GameVerifyResult = {
      status: 'failed', missingTools: ['godot'], screenshots: [],
      steps: [
        { name: 'check', argv: ['npm', 'run', PRIVATE[2]!], exitCode: 0, durationMs: 120, logRef: 'logs/check.log', timedOut: false },
        { name: 'build', argv: ['npm', 'run', 'build'], exitCode: 1, durationMs: 300, logRef: 'logs/build.log', timedOut: false, message: PRIVATE[1] },
      ],
    };
    const payload = sent(gameVerifiedProperties({ result, engine: 'phaser', actor: 'agent', mode: 'verify' }));
    for (const text of [...PRIVATE, 'logs/']) expect(payload).not.toContain(text);
    expect(JSON.parse(payload)).toEqual({ mode: 'verify', actor: 'agent', engine: 'phaser', status: 'failed',
      step_check: 'passed', step_build: 'failed', duration_ms: 420, screenshot_count: 0, missing_tool_count: 1 });
  });

  it('reports kept candidates by position, not by file', () => {
    const run = {
      id: 'run-1', projectId: 'p', recipeId: 'pixel-sprite', recipeVersion: '1.0.0', surface: 'image', origin: 'user',
      inputs: { prompt: PRIVATE[1] }, model: { provider: 'media-gateway', id: 'image-fast' }, status: 'ready', createdAt: 0, updatedAt: 0,
      candidates: [0, 1, 2].map(index => ({ id: `c${index}`, index, stagedFiles: [{ role: 'primary', ref: PRIVATE[2]!, mime: 'image/png' }], checks: [] })),
    } as RecipeRun;
    const payload = sent(recipeCandidatesAdoptedProperties(run, ['c2', 'c1'], 5 * 60_000));
    for (const text of PRIVATE) expect(payload).not.toContain(text);
    expect(JSON.parse(payload)).toMatchObject({ recipe_id: 'pixel-sprite', candidate_count: 3, adopted_count: 2,
      adopted_first_index: 1, adopted_all: false, minutes_since_run: 5, model_provider: 'media-gateway' });
  });
});

describe('whose event it is', () => {
  let dataDir: string;
  beforeEach(async () => { dataDir = await mkdtemp(path.join(tmpdir(), 'pixo-funnel-')); });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  function recorder() {
    const capture = vi.fn(async (_args: unknown) => ({ status: 'queued' as const, acknowledgement: 'local_buffer' as const, errorType: null }));
    const funnel = createGameFunnelRecorder({ analytics: { capture }, dataDir, appVersion: () => '1.0.5', newInsertId: () => 'insert-1' });
    return { capture, funnel };
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));

  it('uses the app\'s identity when the request carries one', async () => {
    const { capture, funnel } = recorder();
    funnel.record({ headers: { [ANALYTICS_HEADER_DEVICE_ID]: 'device-1' } } as unknown as Request, 'game_plan_approved', { scope: 'quick', pitch: PRIVATE[1] });
    await settle();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]?.[0]).toMatchObject({ eventName: 'game_plan_approved', context: { deviceId: 'device-1' }, properties: { scope: 'quick' } });
    expect(JSON.stringify(capture.mock.calls[0]?.[0])).not.toContain(PRIVATE[1]);
  });

  it('counts a pixo request under the installation id, and sends nothing without one', async () => {
    const { capture, funnel } = recorder();
    funnel.record(null, 'recipe_run_settled', { status: 'ready' });
    await settle();
    expect(capture).not.toHaveBeenCalled();
    await writeFile(path.join(dataDir, 'app-config.json'), JSON.stringify({ installationId: 'install-1', telemetry: { metrics: true } }));
    funnel.record({ headers: {} } as unknown as Request, 'recipe_run_settled', { status: 'ready' });
    await settle();
    expect(capture.mock.calls[0]?.[0]).toMatchObject({ context: { deviceId: 'install-1', entrySurface: 'pixo_cli' } });
  });

  it('never throws into the request it observes', async () => {
    const funnel = createGameFunnelRecorder({ analytics: { capture: async () => { throw new Error('down'); } }, dataDir,
      appVersion: () => { throw new Error('no version'); }, newInsertId: () => 'x' });
    expect(() => funnel.record(null, 'game_created', {})).not.toThrow();
    await settle();
  });
});

describe('plan approval in the funnel', () => {
  it('records the first approval only, and never one the route refused', async () => {
    const store = new Map<string, { id: string; metadata: unknown }>();
    const record = vi.fn<GameFunnelRecorder['record']>();
    const app = express();
    app.use(express.json());
    registerGamePlanRoutes(app, {
      db: {} as never,
      http: {
        sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }),
        requireLocalDaemonRequest: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
        isLocalSameOrigin: () => true,
        resolvedPortRef: { current: 0 },
      } as never,
      paths: { PROJECTS_DIR: '', RUNTIME_DATA_DIR: '' } as never,
      authorizeProjectRequest: (async () => true) as never,
      authorizeProjectToolRequest: (async () => true) as never,
      templatesRoot: '',
      isProjectBusy: () => false,
      artBudget: {} as never,
      gameFunnel: { record },
      store: {
        get: (id) => store.get(id) as never,
        update: (id, patch) => { store.set(id, { id, metadata: patch.metadata }); return store.get(id) as never; },
        forgetAgentSessions: () => {},
        latestAgentMessage: () => '阶段 1：做一个能跳的猫',
        conversationAgentMessages: () => null,
        createConversation: () => { throw new Error('not used by this test'); },
      },
    });
    store.set('p1', { id: 'p1', metadata: { kind: 'other', gameSetup: { scope: 'quick', genre: PRIVATE[0] }, gamePlan: { status: 'planning', startedAt: Date.now() - 3_600_000 } } });
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const approve = (headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}/api/projects/p1/game-plan/approve`, { method: 'POST', headers });
      expect((await approve({ Authorization: 'Bearer pixott_not-a-real-token' })).status).toBe(403);
      expect(record).not.toHaveBeenCalled();
      expect((await approve()).status).toBe(200);
      expect((await approve()).status).toBe(200);
      expect(record).toHaveBeenCalledTimes(1);
      const [, event, properties] = record.mock.calls[0]!;
      expect(event).toBe('game_plan_approved');
      expect(gameFunnelProperties(properties)).toMatchObject({ scope: 'quick', plan_recorded: true, art_budget_set: false, hours_planning: 1 });
      expect(JSON.stringify(properties)).not.toContain('猫');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
