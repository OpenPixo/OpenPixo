import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectEngineProfile, ENGINE_DETECTOR_VERSION } from '../../src/game/engine-detect.js';

const fixtures = fileURLToPath(new URL('../fixtures/game-projects/', import.meta.url));
const detect = (name: string) => detectEngineProfile(path.join(fixtures, name), { resolveOnPath: () => null });

describe('engine detection (file reads only)', () => {
  it('distinguishes Godot 4 from likely Godot 3 and limits Godot 3 to checking', () => {
    const four = detect('godot4');
    expect(four).toMatchObject({ engine: 'godot', engineVersion: '4.3', confidence: 'certain',
      detectorVersion: ENGINE_DETECTOR_VERSION, importMetadata: 'godot-import', assetRoots: ['.'],
      evidence: ['project.godot'], tools: [{ id: 'godot', resolved: false }] });
    expect(four.commands.check?.argv).toEqual(['godot', '--headless', '--path', '.', '--import', '--quit']);
    expect(four.commands.run?.argv).toEqual(['godot', '--path', '.']);
    const three = detect('godot3');
    expect(three).toMatchObject({ engine: 'godot', engineVersion: '3.5', confidence: 'likely' });
    expect(Object.keys(three.commands)).toEqual(['check']);
  });

  it('reads Unity version and asset metadata and Bevy dependency tables', () => {
    expect(detect('unity')).toMatchObject({ engine: 'unity', engineVersion: '2022.3.20f1', confidence: 'certain',
      assetRoots: ['Assets/'], importMetadata: 'unity-meta', evidence: ['ProjectSettings/ProjectVersion.txt', 'Assets/'],
      commands: { check: { argv: ['unity', '-batchmode', '-quit', '-projectPath', '.'] } } });
    expect(detect('bevy')).toMatchObject({ engine: 'bevy', engineVersion: '0.15', languages: ['Rust'],
      commands: { check: { argv: ['cargo', 'check'] }, run: { argv: ['cargo', 'run'] } } });
  });

  it('uses existing package scripts with lockfile-selected package managers', () => {
    const phaser = detect('phaser-pnpm');
    expect(phaser).toMatchObject({ engine: 'phaser', engineVersion: '^3.90.0', evidence: ['package.json', 'pnpm-lock.yaml'],
      commands: { build: { argv: ['pnpm', 'run', 'build'] }, run: { argv: ['pnpm', 'run', 'dev'] } },
      tools: [{ id: 'pnpm', resolved: false }] });
    expect(phaser.commands.check).toBeUndefined();
    expect(detect('threejs')).toMatchObject({ engine: 'threejs', engineVersion: '^0.170.0',
      commands: { build: { argv: ['yarn', 'run', 'build'] }, run: { argv: ['yarn', 'run', 'preview'] } } });
    expect(detect('web-generic')).toMatchObject({ engine: 'web-generic', commands: { build: { argv: ['npm', 'run', 'build'] } } });
    expect(detect('web-generic').commands.run).toBeUndefined();
  });

  it.each([
    ['unreal', 'unreal', '5.4', ['Content/']],
    ['rpg-maker', 'rpg-maker', 'MZ', ['img/', 'audio/']],
  ])('recognizes %s without offering commands', (fixture, engine, version, roots) => {
    expect(detect(fixture as string)).toMatchObject({ engine, engineVersion: version, assetRoots: roots,
      confidence: 'certain', commands: {}, tools: [] });
  });

  it('recognizes Cocos 3 with a real web build command and its documented success code', () => {
    expect(detect('cocos')).toMatchObject({ engine: 'cocos-creator', engineVersion: '3.8.0', assetRoots: ['assets/'],
      commands: { build: { argv: ['cocosCreator', '--project', '.', '--build', 'platform=web-desktop;debug=true'], successExitCodes: [36] } },
      tools: [{ id: 'cocosCreator', resolved: false }] });
  });

  it('keeps all conflicting evidence and returns unknown for an empty folder', () => {
    expect(detect('conflicting')).toMatchObject({ engine: 'godot', confidence: 'likely',
      evidence: ['project.godot', 'package.json'] });
    expect(detect('empty')).toMatchObject({ engine: 'unknown', confidence: 'unknown', evidence: [], tools: [], commands: {} });
  });

  it('resolves tools from settings before PATH without launching them', () => {
    const resolver = vi.fn(() => process.execPath);
    const folder = path.join(fixtures, 'godot4');
    expect(detectEngineProfile(folder, { resolveOnPath: resolver }).tools)
      .toEqual([{ id: 'godot', resolved: true, source: 'path' }]);
    resolver.mockClear();
    expect(detectEngineProfile(folder, { enginePaths: { godot: process.execPath }, resolveOnPath: resolver }).tools)
      .toEqual([{ id: 'godot', resolved: true, source: 'settings' }]);
    expect(detectEngineProfile(folder, { enginePaths: { godot: folder }, resolveOnPath: resolver }).tools)
      .toEqual([{ id: 'godot', resolved: false, source: 'settings' }]);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('nested engine detection', () => {
  const roots: string[] = [];
  const godot = 'config_version=5\nconfig/features=PackedStringArray("4.3")\n';

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  async function project(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'pixo-engine-nested-'));
    roots.push(root);
    for (const [file, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), content);
    }
    return root;
  }

  it('detects nested Unity with project-relative commands, evidence and asset roots', async () => {
    const root = await project({
      'unity/ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.20f1\n',
      'unity/Assets/fixture.txt': '',
    });
    expect(detectEngineProfile(root, { resolveOnPath: () => null })).toMatchObject({
      engine: 'unity', engineVersion: '2022.3.20f1', confidence: 'certain',
      evidence: ['unity/ProjectSettings/ProjectVersion.txt', 'unity/Assets/'], assetRoots: ['unity/Assets/'],
      commands: { check: { argv: ['unity', '-batchmode', '-quit', '-projectPath', '.'], cwd: 'unity' } },
    });
  });

  it('discovers Unity editor build methods from the nested project directory', async () => {
    const root = await project({
      'unity/ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.20f1\n',
      'unity/Assets/Editor/Build.cs': 'namespace Fixture; public static class BuildScript { public static void Build() { BuildPipeline.BuildPlayer(options); } }',
    });
    const profile = detectEngineProfile(root, { resolveOnPath: () => null });
    expect(profile.commands.build).toMatchObject({ cwd: 'unity',
      argv: ['unity', '-batchmode', '-quit', '-projectPath', '.', '-executeMethod', 'Fixture.BuildScript.Build', '-logFile', '-'] });
    expect(profile.evidence).toContain('unity/Assets/Editor/Build.cs');
  });

  it('detects nested Godot and runs every command from its subdirectory', async () => {
    const root = await project({
      'godot/project.godot': godot,
      'godot/export_presets.cfg': '[preset.0]\nname="Web"\nexport_path="build/game.html"\n',
    });
    const profile = detectEngineProfile(root, { resolveOnPath: () => null });
    expect(profile).toMatchObject({ engine: 'godot', confidence: 'certain',
      evidence: ['godot/project.godot', 'godot/export_presets.cfg'], assetRoots: ['godot'],
      commands: { check: { cwd: 'godot' }, build: { cwd: 'godot' }, run: { cwd: 'godot' } } });
  });

  it('keeps root detection ahead of nested markers without lowering confidence', async () => {
    const root = await project({
      'project.godot': godot,
      'unity/ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.20f1\n',
      'unity/Assets/fixture.txt': '',
    });
    const profile = detectEngineProfile(root, { resolveOnPath: () => null });
    expect(profile).toMatchObject({ engine: 'godot', confidence: 'certain', evidence: ['project.godot'], assetRoots: ['.'],
      commands: { check: { cwd: '.' }, run: { cwd: '.' } } });
  });

  const nativeProjects: Array<{ engine: 'unity' | 'godot'; files: Record<string, string>; assetRoots: string[] }> = [
    { engine: 'unity', files: {
      'native/ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.20f1\n',
      'native/Assets/Editor/Build.cs': 'public static class BuildScript { public static void Build() { BuildPipeline.BuildPlayer(options); } }',
    }, assetRoots: ['native/Assets/'] },
    { engine: 'godot', files: {
      'native/project.godot': godot,
      'native/export_presets.cfg': '[preset.0]\nname="Web"\nexport_path="build/game.html"\n',
    }, assetRoots: ['native'] },
  ];

  describe.each(nativeProjects)('nested $engine with root tooling', ({ engine, files, assetRoots }) => {
    it.each(['manifest only', 'HTML scaffold', 'engine dependency only'])(
      'prefers the native project over %s and scopes all commands to it', async tooling => {
        const root = await project({
          'package.json': JSON.stringify({ devDependencies: { typescript: '5', ...(tooling === 'engine dependency only' ? { three: '0.170' } : {}) },
            scripts: { check: 'tsc --noEmit', build: 'tsc', dev: 'vite' } }),
          ...(tooling === 'HTML scaffold' ? { 'index.html': '<html><body>Tooling</body></html>' } : {}),
          ...files,
        });
        const profile = detectEngineProfile(root, { resolveOnPath: () => null });
        expect(profile).toMatchObject({ engine, confidence: 'certain', assetRoots });
        expect(profile.evidence.every(file => file.startsWith('native/'))).toBe(true);
        expect(profile.commands.check?.cwd).toBe('native');
        expect(profile.commands.build?.cwd).toBe('native');
        expect(Object.values(profile.commands).every(command => command.cwd === 'native')).toBe(true);
        expect(profile.tools).toEqual([{ id: engine, resolved: false }]);
      },
    );
  });

  it.each(['phaser', 'three'])('keeps a real root %s web game ahead of nested native projects', async dependency => {
    const root = await project({
      'package.json': JSON.stringify({ dependencies: { [dependency]: '3' }, devDependencies: { vite: '7' }, scripts: { dev: 'vite', build: 'vite build' } }),
      'index.html': '<script type="module" src="/src/main.ts"></script>',
      'native/project.godot': godot,
    });
    expect(detectEngineProfile(root, { resolveOnPath: () => null })).toMatchObject({
      engine: dependency === 'three' ? 'threejs' : 'phaser', confidence: 'certain',
      commands: { run: { cwd: '.', argv: ['npm', 'run', 'dev'] }, build: { cwd: '.', argv: ['npm', 'run', 'build'] } },
    });
  });

  /*
   * 2026-11-11 Sol roguelike run: Codex edited package.json with Windows PowerShell 5.1,
   * whose `Set-Content -Encoding UTF8` writes a byte-order mark. npm and Vite accept it,
   * but JSON.parse did not, so the Phaser game lost its profile and every
   * `pixo game verify` step answered "No command in the engine profile".
   */
  it('reads a package.json that starts with a UTF-8 byte-order mark', async () => {
    const root = await project({
      'package.json': `﻿${JSON.stringify({ dependencies: { phaser: '3.90.0' }, scripts: { check: 'tsc --noEmit', dev: 'vite', build: 'vite build' }, packageManager: 'pnpm@10.33.2' })}`,
      'index.html': '<script type="module" src="/src/main.ts"></script>',
    });
    expect(detectEngineProfile(root, { resolveOnPath: () => null })).toMatchObject({
      engine: 'phaser', engineVersion: '3.90.0',
      commands: { check: { argv: ['pnpm', 'run', 'check'] }, build: { argv: ['pnpm', 'run', 'build'] }, run: { argv: ['pnpm', 'run', 'dev'] } },
    });
  });

  it('keeps the root web fallback when no nested native engine exists', async () => {
    const root = await project({
      'package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
      'index.html': '<html></html>',
      'nested/package.json': JSON.stringify({ dependencies: { phaser: '3' } }),
    });
    expect(detectEngineProfile(root, { resolveOnPath: () => null })).toMatchObject({
      engine: 'web-generic', confidence: 'certain', evidence: ['package.json', 'index.html'],
      commands: { run: { cwd: '.' } },
    });
  });

  it('prefers a nested native engine over sibling web tooling when the root is generic web', async () => {
    const root = await project({
      'package.json': '{}', 'index.html': '<html></html>',
      'a-web/package.json': JSON.stringify({ dependencies: { phaser: '3' } }),
      'z-godot/project.godot': godot,
    });
    expect(detectEngineProfile(root, { resolveOnPath: () => null })).toMatchObject({
      engine: 'godot', confidence: 'certain', evidence: ['z-godot/project.godot'],
      commands: { run: { cwd: 'z-godot' } },
    });
  });

  it.each(['node_modules', '.git', 'Library', 'Temp', 'obj', 'bin', 'build', 'dist', '.hidden'])(
    'ignores engine markers inside %s', async directory => {
      const root = await project({ [`${directory}/project.godot`]: godot });
      expect(detectEngineProfile(root, { resolveOnPath: () => null })).toMatchObject({
        engine: 'unknown', confidence: 'unknown', evidence: [], assetRoots: [], commands: {},
      });
    },
  );

  it('selects the first matching subdirectory by name and keeps conflicting evidence at likely confidence', async () => {
    const root = await project({
      'z-godot/project.godot': godot,
      'a-unity/ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.20f1\n',
      'a-unity/Assets/fixture.txt': '',
    });
    expect(detectEngineProfile(root, { resolveOnPath: () => null })).toMatchObject({
      engine: 'unity', confidence: 'likely', commands: { check: { cwd: 'a-unity' } }, assetRoots: ['a-unity/Assets/'],
      evidence: ['a-unity/ProjectSettings/ProjectVersion.txt', 'a-unity/Assets/', 'z-godot/project.godot'],
    });
  });

  it('bounds discovery to the first 50 eligible subdirectories in sorted order', async () => {
    const root = await project({ 'z-game/project.godot': godot });
    for (let index = 49; index >= 0; index--) await mkdir(path.join(root, `a-${String(index).padStart(2, '0')}`));
    expect(detectEngineProfile(root, { resolveOnPath: () => null }).engine).toBe('unknown');
    await writeFile(path.join(root, 'a-00', 'project.godot'), godot);
    expect(detectEngineProfile(root, { resolveOnPath: () => null })).toMatchObject({
      engine: 'godot', confidence: 'certain', evidence: ['a-00/project.godot'], commands: { run: { cwd: 'a-00' } },
    });
  });

  it('limits discovery to immediate subdirectories', async () => {
    const root = await project({ 'outer/inner/project.godot': godot });
    expect(detectEngineProfile(root, { resolveOnPath: () => null }).engine).toBe('unknown');
  });
});

it.each(['pnpm', 'yarn', 'bun'])('uses packageManager metadata consistently with dependency installation (%s)', async manager => {
  const root = await mkdtemp(path.join(tmpdir(), 'pixo-t9-manager-'));
  try {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ packageManager: `${manager}@1.0.0`, dependencies: { phaser: '3' }, scripts: { dev: 'vite', build: 'vite build' } }));
    await writeFile(path.join(root, 'package-lock.json'), '{}');
    const profile = detectEngineProfile(root, { resolveOnPath: () => null });
    expect(profile.commands.run?.argv).toEqual([manager, 'run', 'dev']);
    expect(profile.commands.build?.argv).toEqual([manager, 'run', 'build']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
