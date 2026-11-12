import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GAME_ENGINE_BLOCK_HEADING, GAME_PLAN_BLOCK_HEADING, type EngineProfile } from '@openpixo/contracts';
import { detectEngineProfile } from '../../src/game/engine-detect.js';
import { composeGameSystemPrompt, promptEngineProfile } from '../../src/game/prompt.js';

const fixtures = fileURLToPath(new URL('../fixtures/game-projects/', import.meta.url));
const godotFolder = path.join(fixtures, 'godot4');
const found = () => process.execPath;
const missing = () => null;

function blockOf(prompt: string, heading: string): string {
  const start = prompt.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = prompt.indexOf('\n## ', start + heading.length);
  return next < 0 ? prompt.slice(start) : prompt.slice(start, next);
}

describe('the engine a run prompt states', () => {
  // Detected while Godot was installed, then the user removed or never had it on this computer.
  const stored: EngineProfile = detectEngineProfile(godotFolder, { resolveOnPath: found });

  it('resolves a stored profile\'s tools again for every run, keeping its detection', () => {
    expect(stored.tools).toEqual([{ id: 'godot', resolved: true, source: 'path' }]);
    const now = promptEngineProfile({ engineProfile: stored }, godotFolder, { resolveOnPath: missing });
    expect(now).toMatchObject({ engine: 'godot', evidence: stored.evidence, commands: stored.commands });
    expect(now?.tools).toEqual([{ id: 'godot', resolved: false }]);
    // A path set in Settings counts as found.
    expect(promptEngineProfile({ engineProfile: stored }, godotFolder, { enginePaths: { godot: process.execPath }, resolveOnPath: missing })?.tools)
      .toEqual([{ id: 'godot', resolved: true, source: 'settings' }]);
  });

  it('detects a new game from its folder until an engine is recorded', () => {
    const plan = { status: 'planning' as const, startedAt: 1 };
    expect(promptEngineProfile({ gamePlan: plan }, godotFolder, { resolveOnPath: missing }))
      .toMatchObject({ engine: 'godot', tools: [{ id: 'godot', resolved: false }] });
    expect(promptEngineProfile({}, godotFolder, { resolveOnPath: missing })).toBeUndefined();
    expect(promptEngineProfile(null, null)).toBeUndefined();
  });

  it('tells the agent to stop and ask before building for an engine this computer lacks', () => {
    const profile = promptEngineProfile({ engineProfile: stored }, godotFolder, { resolveOnPath: missing });
    const engine = blockOf(composeGameSystemPrompt({ baseDir: godotFolder, engineProfile: profile }), GAME_ENGINE_BLOCK_HEADING);
    expect(engine).toMatch(/Not found on this machine: `godot`/);
    expect(engine).toMatch(/say plainly at the start of your reply that it is not installed/);
    expect(engine).toMatch(/install it .*or to switch to an engine that runs here, and wait for their answer/);

    const ready = blockOf(composeGameSystemPrompt({ baseDir: godotFolder, engineProfile: stored }), GAME_ENGINE_BLOCK_HEADING);
    expect(ready).not.toMatch(/Not found on this machine/);
    expect(ready).not.toMatch(/wait for their answer/);
  });

  it('raises a chosen but missing engine in the planning conversation', () => {
    const profile = promptEngineProfile({ gamePlan: { status: 'planning', startedAt: 1 } }, godotFolder, { resolveOnPath: missing });
    const plan = blockOf(composeGameSystemPrompt({
      baseDir: godotFolder, engineProfile: profile,
      gamePlan: { status: 'planning', engineOptions: [
        { engine: 'godot', name: 'Godot', templates: [], available: false, missingTools: ['godot'] },
        { engine: 'phaser', name: 'Phaser', templates: [], available: true, missingTools: [] },
      ] },
    }), GAME_PLAN_BLOCK_HEADING);
    expect(plan).toMatch(/already chosen: Godot/);
    expect(plan).toMatch(/`godot` is not found on this computer/);
    expect(plan).toMatch(/switch to an engine that runs here \(Phaser\)/);
  });
});
