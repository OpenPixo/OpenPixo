import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { detectEngineProfile } from '../../src/game/engine-detect.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'pixo-engine-build-')); roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), content);
  }
  return root;
}
it('only offers a Unity build with one unambiguous public static editor build method', async () => {
  const root = await fixture({ 'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.20f1',
    'Assets/Editor/Build.cs': 'namespace Fixture; public static class BuildScript { public static void Build() { BuildPipeline.BuildPlayer(options); } }' });
  const result = detectEngineProfile(root, { resolveOnPath: () => null });
  expect(result.commands.build?.argv).toEqual(['unity', '-batchmode', '-quit', '-projectPath', '.', '-executeMethod', 'Fixture.BuildScript.Build', '-logFile', '-']);
  await writeFile(path.join(root, 'Assets/Editor/Build.cs'), '// public static void Build() { BuildPipeline.BuildPlayer(options); }');
  expect(detectEngineProfile(root).commands.build).toBeUndefined();
  expect(detectEngineProfile(root).unavailableReasons?.build).toContain('static');
});
it('offers the documented Cocos 3 web build, its actual success code, and a resolvable tool id', async () => {
  const root = await fixture({ 'package.json': JSON.stringify({ creator: { version: '3.8.0' } }) });
  const result = detectEngineProfile(root, { resolveOnPath: id => id === 'CocosCreator' ? process.execPath : null });
  expect(result).toMatchObject({ engine: 'cocos-creator', tools: [{ id: 'cocosCreator', resolved: true }] });
  expect(result.commands.build).toMatchObject({ argv: ['cocosCreator', '--project', '.', '--build', 'platform=web-desktop;debug=true'], successExitCodes: [36] });
});
it('keeps Unreal checks unavailable with guidance instead of mutating packages', async () => {
  const root = await fixture({ 'Game.uproject': '{"EngineAssociation":"5.4"}' });
  const result = detectEngineProfile(root);
  expect(result.commands).toEqual({});
  expect(result.unavailableReasons?.check).toContain('project');
});
