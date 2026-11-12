import Database from 'better-sqlite3';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameVerifyArtifactDir } from '../../src/game/verify-store.js';
import { readProjectStarterFacts } from '../../src/project-start/facts.js';

vi.mock('../../src/doctor/probes.js', () => ({ createDoctorProbes: () => ({ agents: async () => [],
  engineTool: async () => ({ available: true, configured: false }), ffmpeg: async () => ({ source: 'bundled' }), providers: async () => ({ image: false, audio: false }) }) }));
const roots: string[] = []; const databases: Database.Database[] = [];
afterEach(async () => { for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'pixo-starter-facts-')); roots.push(root);
  const projectDir = path.join(root, 'selected-game'); const dataDir = path.join(root, 'resolved-daemon-data');
  await Promise.all([mkdir(projectDir), mkdir(dataDir)]); await writeFile(path.join(projectDir, 'project.godot'), 'config_version=5\n');
  const db = new Database(':memory:'); databases.push(db);
  db.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT);
    CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, run_status TEXT);
    CREATE TABLE project_assets (project_id TEXT, rel_path TEXT, kind TEXT);`);
  db.prepare('INSERT INTO conversations VALUES (?, ?)').run('conversation', 'game');
  return { db, root, projectDir, metadata: { kind: 'other' as const, baseDir: projectDir }, paths: { RUNTIME_DATA_DIR: dataDir, ARTIFACTS_DIR: path.join(dataDir, 'artifacts'), PROJECTS_DIR: path.join(dataDir, 'projects'), PROJECT_ROOT: root } };
}

describe('project starter fact reader', () => {
  it('reads current engine, durable succeeded assistant runs and the default media asset index independently per project', async () => {
    const f = await fixture();
    const insertMessage = f.db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?)');
    for (const [id, role, status] of [['failed', 'assistant', 'failed'], ['canceled', 'assistant', 'canceled'], ['user', 'user', 'succeeded']]) {
      insertMessage.run(id, 'conversation', role, status);
    }
    f.db.prepare('INSERT INTO project_assets VALUES (?, ?, ?)').run('game', 'source.json', 'data');
    let facts = await readProjectStarterFacts(f, 'game', f.metadata);
    expect(facts).toMatchObject({ profile: { engine: 'godot' }, hasSucceededAgentRun: false, mediaAssetCount: 0, latestVerify: null });
    insertMessage.run('done', 'conversation', 'assistant', 'succeeded');
    f.db.prepare('INSERT INTO project_assets VALUES (?, ?, ?)').run('game', 'hero.png', 'image');
    f.db.prepare('INSERT INTO project_assets VALUES (?, ?, ?)').run('another', 'other.png', 'image');
    facts = await readProjectStarterFacts(f, 'game', f.metadata);
    expect(facts).toMatchObject({ hasSucceededAgentRun: true, mediaAssetCount: 1 });
    expect((await readProjectStarterFacts(f, 'another', f.metadata)).hasSucceededAgentRun).toBe(false);
  });
  it('treats a new managed project whose folder does not exist yet as having no engine', async () => {
    const f = await fixture();
    const facts = await readProjectStarterFacts(f, 'not-written-yet', { kind: 'other' });
    expect(facts.profile.engine).toBe('unknown');
  });
  it('uses the shared asset service to initialize the media inventory without an Assets panel visit', async () => {
    const f = await fixture(); const mediaAssetCount = vi.fn(async () => 3);
    expect((await readProjectStarterFacts({ ...f, mediaAssetCount }, 'game', f.metadata)).mediaAssetCount).toBe(3);
    expect(mediaAssetCount).toHaveBeenCalledWith('game', f.metadata);
  });
  it('uses the existing persisted verify pointer underneath the supplied resolved artifact root', async () => {
    const f = await fixture(); const result = { status: 'passed', steps: [], screenshots: [], missingTools: [] };
    const dir = gameVerifyArtifactDir(f.paths.ARTIFACTS_DIR, 'game'); await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'latest.json'), JSON.stringify(result));
    expect((await readProjectStarterFacts(f, 'game', f.metadata)).latestVerify).toEqual(result);
    expect((await readProjectStarterFacts(f, 'another', f.metadata)).latestVerify).toBeNull();
  });
});
