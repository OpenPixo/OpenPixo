import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineProfile } from '@openpixo/contracts';
import { getProject, updateProject } from '../../src/db.js';
import { GameRunManager } from '../../src/game/run.js';
import { recordProjectGameRun } from '../../src/project-start/game-run-record.js';

const fakeProcess = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: fakeProcess.spawn }));
const roots: string[] = []; const databases: Database.Database[] = [];
afterEach(async () => { vi.useRealTimers(); fakeProcess.spawn.mockReset(); for (const db of databases.splice(0)) db.close(); for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true }); });
function database() {
  const db = new Database(':memory:'); databases.push(db);
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, skill_id TEXT, design_system_id TEXT,
    pending_prompt TEXT, metadata_json TEXT, applied_plugin_snapshot_id TEXT, custom_instructions TEXT,
    created_at INTEGER, updated_at INTEGER)`);
  db.prepare('INSERT INTO projects(id, name, metadata_json, created_at, updated_at) VALUES (?, ?, ?, 0, 0)')
    .run('game', 'Game', JSON.stringify({ imageModel: 'existing-model' }));
  return db;
}
async function processFixture(engine: 'phaser' | 'godot' = 'phaser', callback?: ConstructorParameters<typeof GameRunManager>[1]) {
  const root = await mkdtemp(path.join(tmpdir(), 'pixo-ready-')); roots.push(root);
  await mkdir(path.join(root, 'node_modules'));
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  fakeProcess.spawn.mockImplementation(() => { queueMicrotask(() => child.emit('spawn')); return child; });
  const profile: EngineProfile = { engine, detectorVersion: 1, confidence: 'certain', evidence: [], languages: [], assetRoots: [], tools: [],
    importMetadata: 'none', detectedAt: 1, commands: { run: { argv: [engine === 'godot' ? 'godot' : 'npm', 'run', 'dev'], cwd: '.', timeoutMs: 100 } } };
  const runs = new GameRunManager(root, callback);
  return { root, child, runs, prepared: { profile, projectDir: root, resolveTool: () => process.execPath } };
}

describe('observed successful game-run evidence', () => {
  it('ignores unready or failed states and merges readiness with current metadata once', () => {
    const db = database();
    for (const status of ['idle', 'starting', 'failed', 'exited'] as const) recordProjectGameRun(db, 'game', { status });
    expect(getProject(db, 'game')!.metadata.gameRunSucceededAt).toBeUndefined();
    updateProject(db, 'game', { metadata: { ...getProject(db, 'game')!.metadata, audioModel: 'new-model' } });
    recordProjectGameRun(db, 'game', { status: 'running', startedAt: 42 });
    recordProjectGameRun(db, 'game', { status: 'running', startedAt: 90 });
    recordProjectGameRun(db, 'deleted-project', { status: 'running' });
    expect(getProject(db, 'game')!.metadata).toEqual({ imageModel: 'existing-model', audioModel: 'new-model', gameRunSucceededAt: 42 });
  });
  it('records web readiness only after starting transitions to running, and retains it after stop/reload', async () => {
    const db = database(); const observed = vi.fn((id, state) => recordProjectGameRun(db, id, state));
    const f = await processFixture('phaser', observed);
    try {
      expect((await f.runs.start('game', async () => f.prepared)).status).toBe('starting');
      expect(observed).not.toHaveBeenCalled(); expect(getProject(db, 'game')!.metadata.gameRunSucceededAt).toBeUndefined();
      const args = fakeProcess.spawn.mock.calls[0]![1] as string[]; const port = args[args.indexOf('--port') + 1];
      f.child.stdout.write(`Local: http://127.0.0.1:${port}/\n`);
      expect(f.runs.status('game').status).toBe('running'); expect(observed).toHaveBeenCalledOnce();
      const recorded = getProject(db, 'game')!.metadata.gameRunSucceededAt;
      expect(recorded).toBeTypeOf('number');
      f.child.stdout.write(`Local: http://127.0.0.1:${port}/\n`);
      await f.runs.start('game', async () => { throw new Error('must not prepare twice'); });
      expect(observed).toHaveBeenCalledOnce();
      f.child.emit('close', 0); await f.runs.stop('game');
      expect(getProject(db, 'game')!.metadata.gameRunSucceededAt).toBe(recorded);
      const reloaded = new GameRunManager(f.root); expect(reloaded.status('game').status).toBe('idle'); await reloaded.dispose();
      expect(getProject(db, 'game')!.metadata.gameRunSucceededAt).toBe(recorded);
    } finally { f.child.emit('close', 0); await f.runs.dispose(); }
  });
  it('does not emit readiness on a web startup timeout', async () => {
    const observed = vi.fn(); const f = await processFixture('phaser', observed);
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await f.runs.start('game', async () => f.prepared);
      await vi.advanceTimersByTimeAsync(100);
      expect(f.runs.status('game')).toMatchObject({ status: 'failed', reasonCode: 'START_TIMEOUT' }); expect(observed).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); f.child.emit('close', 0); await f.runs.dispose(); }
  });
  it('contains callback failures without failing or interrupting a healthy game process', async () => {
    const f = await processFixture('godot', () => { throw new Error('storage unavailable'); });
    try {
      expect(await f.runs.start('game', async () => f.prepared)).toMatchObject({ status: 'running' });
      expect(f.runs.status('game').logTail).toContain('Could not save the game readiness record.');
    } finally { f.child.emit('close', 0); await f.runs.dispose(); }
  });
});
