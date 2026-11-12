import { accessSync, constants, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { GAME_PACKAGE_LOCKS, gamePackageManager } from './package-manager.js';
import type { EngineCommand, EngineProfile, EngineToolStatus, GameEnginePaths } from '@openpixo/contracts';
import { resolveOnPath } from '../runtimes/executables.js';
import { discoverUnityBuild } from './verify-unity-build.js';

export const ENGINE_DETECTOR_VERSION = 4;
const MAX_ENGINE_SUBDIRECTORIES = 50;
const SKIPPED_ENGINE_DIRECTORIES = new Set(['node_modules', '.git', 'library', 'temp', 'obj', 'bin', 'build', 'dist']);

type Candidate = Pick<EngineProfile, 'engine' | 'engineVersion' | 'confidence' | 'evidence' | 'languages' | 'assetRoots' | 'importMetadata' | 'commands' | 'unavailableReasons'>;

export interface EngineDetectOptions {
  enginePaths?: GameEnginePaths;
  /** File discovery only: this resolver must never launch a tool. */
  resolveOnPath?: (id: string) => string | null;
}

function executableFile(file: string): boolean {
  if (!path.isAbsolute(file)) return false;
  try {
    if (!statSync(file).isFile()) return false;
    if (process.platform === 'win32') return /\.(exe|cmd|bat|com)$/i.test(file);
    accessSync(file, constants.X_OK);
    return true;
  } catch { return false; }
}

function toolStatus(id: string, opts: EngineDetectOptions): EngineToolStatus {
  const configured = (id === 'godot' || id === 'unity' || id === 'cocosCreator') ? opts.enginePaths?.[id]?.trim() : undefined;
  if (configured) return { id, resolved: executableFile(configured), source: 'settings' };
  const resolved = Boolean((opts.resolveOnPath ?? resolveOnPath)(id === 'cocosCreator' ? 'CocosCreator' : id));
  return { id, resolved, ...(resolved ? { source: 'path' as const } : {}) };
}

function command(argv: string[], timeoutMs = 120_000): EngineCommand {
  return { argv, cwd: '.', timeoutMs };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * Project JSON as package managers read it. Windows PowerShell 5.1's
 * `Set-Content -Encoding UTF8` (which agents on Windows use to edit files)
 * starts the file with a byte-order mark; npm and Vite accept that, JSON.parse
 * does not, and the whole engine profile used to vanish with it.
 */
function jsonObject(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text.replace(/^﻿/u, ''));
    return object(parsed);
  } catch { return undefined; }
}

/** A new managed project has no folder until its first write, which is the same as an empty one. */
function readProjectEntries(projectDir: string) {
  try { return readdirSync(projectDir, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function detectCandidates(projectDir: string): Candidate[] {
  const entries = readProjectEntries(projectDir);
  const read = (relative: string): string | undefined => {
    try { return readFileSync(path.join(projectDir, relative), 'utf8'); }
    catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return undefined;
      throw error;
    }
  };
  const has = (relative: string, directory = false): boolean => {
    try {
      const stat = statSync(path.join(projectDir, relative));
      return directory ? stat.isDirectory() : stat.isFile();
    } catch { return false; }
  };
  const candidates: Candidate[] = [];
  const godot = read('project.godot');
  if (godot !== undefined) {
    const godot4 = /^\s*config_version\s*=\s*5\s*(?:;.*)?$/m.test(godot);
    const engineVersion = godot.match(/^\s*config\/features\s*=\s*\w+\(\s*"([\d.]+)"/m)?.[1];
    const commands: EngineProfile['commands'] = {
      check: command(godot4
        ? ['godot', '--headless', '--path', '.', '--import', '--quit']
        : ['godot', '--no-window', '--path', '.', '--editor', '--quit']),
    };
    const evidence = ['project.godot'];
    if (godot4) {
      commands.run = command(['godot', '--path', '.'], 30_000);
      const presets = read('export_presets.cfg');
      if (presets !== undefined) {
        evidence.push('export_presets.cfg');
        // An export needs a named preset with an output configured by the project.
        const preset = presets.split(/(?=^\[preset\.\d+\]$)/m).find((block) =>
          /^\[preset\.\d+\]$/m.test(block) && /^export_path\s*=\s*"[^"\r\n]+"/m.test(block));
        const name = preset?.match(/^name\s*=\s*"([^"\r\n]+)"/m)?.[1];
        if (name) commands.build = command(['godot', '--headless', '--path', '.', '--export-debug', name]);
      }
    }
    candidates.push({ engine: 'godot', ...(engineVersion ? { engineVersion } : {}), confidence: godot4 ? 'certain' : 'likely',
      evidence, languages: ['GDScript', ...(/"C#"/.test(godot) ? ['C#'] : [])],
      assetRoots: ['.'], importMetadata: 'godot-import', commands });
  }

  const unity = read('ProjectSettings/ProjectVersion.txt');
  if (unity !== undefined && has('Assets', true)) {
    const engineVersion = unity.match(/^m_EditorVersion:\s*(\S+)/m)?.[1];
    const build = discoverUnityBuild(projectDir);
    candidates.push({ engine: 'unity', ...(engineVersion ? { engineVersion } : {}),
      confidence: 'certain', evidence: ['ProjectSettings/ProjectVersion.txt', 'Assets/', ...(build ? [build.file] : [])], languages: ['C#'],
      assetRoots: ['Assets/'], importMetadata: 'unity-meta',
      commands: { check: command(['unity', '-batchmode', '-quit', '-projectPath', '.'], 600_000),
        ...(build ? { build: command(['unity', '-batchmode', '-quit', '-projectPath', '.', '-executeMethod', build.method, '-logFile', '-'], 600_000) } : {}) },
      ...(!build ? { unavailableReasons: { build: 'No unambiguous public static parameterless Build/BuildWindows/BuildGame/BuildPlayer method calling BuildPipeline.BuildPlayer was found under Assets/Editor. Add a project-owned editor build method or use the project build script.' } } : {}) });
  }

  const unrealFiles = entries.filter((entry) => entry.isFile() && /\.uproject$/i.test(entry.name)).map((entry) => entry.name).sort();
  if (unrealFiles.length) {
    const association = jsonObject(read(unrealFiles[0]!))?.EngineAssociation;
    candidates.push({ engine: 'unreal', ...(typeof association === 'string' ? { engineVersion: association } : {}),
      confidence: 'certain', evidence: unrealFiles, languages: ['C++', 'Blueprints'], assetRoots: ['Content/'],
      importMetadata: 'none', commands: {}, unavailableReasons: { check: 'Unreal checks need project-specific tooling. Use the project build script or the editor; generic commandlets can modify project packages.', build: 'Use the project Unreal build/automation script and its installed toolchain.' } });
  }

  const cocos = jsonObject(read('project.json'));
  const cocosSettings = jsonObject(read('settings/project.json'));
  const cocosPackage = jsonObject(read('package.json'));
  if (cocos?.creator || cocosSettings || cocosPackage?.creator) {
    const creator = cocos?.creator ?? cocosPackage?.creator;
    const creatorRecord = creator && typeof creator === 'object' ? creator as Record<string, unknown> : undefined;
    const version = creatorRecord?.version ?? creator ?? cocosSettings?.engine ?? cocosSettings?.version;
    candidates.push({ engine: 'cocos-creator', ...(typeof version === 'string' ? { engineVersion: version } : {}),
      confidence: 'certain', evidence: [...(cocos?.creator ? ['project.json'] : []), ...(cocosSettings ? ['settings/project.json'] : []), ...(cocosPackage?.creator ? ['package.json'] : [])],
      languages: ['TypeScript', 'JavaScript'], assetRoots: ['assets/'], importMetadata: 'none',
      commands: typeof version === 'string' && /^3\./.test(version) ? { build: {
        ...command(['cocosCreator', '--project', '.', '--build', 'platform=web-desktop;debug=true'], 600_000), successExitCodes: [36],
      } } : {}, unavailableReasons: { check: 'Cocos Creator has no generic read-only check. Use a project-owned check script.',
        ...(typeof version === 'string' && /^3\./.test(version) ? {} : { build: 'Automatic CLI builds require a detected Cocos Creator 3 project. Use this project version\'s editor build configuration.' }) } });
  }

  const cargo = read('Cargo.toml');
  if (cargo !== undefined) {
    // Restrict matches to dependency tables; package names and comments are not evidence.
    const dependencyTables = cargo.split(/(?=^\[)/m).map(block => ({
      name: block.match(/^\[([^\]\r\n]+)\]/)?.[1] ?? '',
      body: block.slice(block.indexOf('\n') + 1),
    })).filter(table => /(?:^|\.)(?:dependencies|dev-dependencies|build-dependencies)(?:\.bevy)?$/.test(table.name));
    let bevy: string | undefined;
    let found = false;
    for (const table of dependencyTables) {
      const body = table.body;
      const line = table.name.endsWith('.bevy') ? body : body.match(/^\s*bevy\s*=\s*(.+)$/m)?.[1];
      if (line === undefined) continue;
      found = true;
      bevy = line.match(/^\s*["']([^"']+)["']/)?.[1] ?? line.match(/\bversion\s*=\s*["']([^"']+)["']/)?.[1];
      break;
    }
    if (found) candidates.push({ engine: 'bevy', ...(bevy ? { engineVersion: bevy } : {}), confidence: 'certain', evidence: ['Cargo.toml'],
      languages: ['Rust'], assetRoots: ['assets/'], importMetadata: 'none',
      commands: { check: command(['cargo', 'check']), run: command(['cargo', 'run'], 120_000) } });
  }

  const rpgFiles = entries.filter((entry) => entry.isFile() && /^(game\.rmmzproject|game\.rpgproject)$/i.test(entry.name)).map((entry) => entry.name).sort();
  if (rpgFiles.length) candidates.push({ engine: 'rpg-maker', engineVersion: rpgFiles.some((name) => /\.rmmzproject$/i.test(name)) ? 'MZ' : 'MV',
    confidence: 'certain', evidence: rpgFiles, languages: ['JavaScript'], assetRoots: ['img/', 'audio/'], importMetadata: 'none', commands: {} });

  const pkg = jsonObject(read('package.json'));
  if (pkg) {
    const deps = { ...object(pkg.devDependencies), ...object(pkg.dependencies) };
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts as Record<string, unknown> : {};
    const lock = GAME_PACKAGE_LOCKS.find(([file]) => has(file))?.[0];
    const manager = gamePackageManager(pkg.packageManager, has);
    const commands: EngineProfile['commands'] = {};
    if (typeof scripts.check === 'string') commands.check = command([manager, 'run', 'check']);
    if (typeof scripts.build === 'string') commands.build = command([manager, 'run', 'build']);
    const run = typeof scripts.dev === 'string' ? 'dev' : typeof scripts.preview === 'string' ? 'preview' : undefined;
    if (run) commands.run = command([manager, 'run', run], 30_000);
    const engines = (['phaser', 'three'] as const).filter((dep) => typeof deps[dep] === 'string');
    for (const dep of engines) candidates.push({ engine: dep === 'three' ? 'threejs' : dep, engineVersion: deps[dep] as string,
      confidence: 'certain', evidence: ['package.json', ...(lock ? [lock] : [])], languages: ['TypeScript', 'JavaScript'],
      assetRoots: ['public/', 'assets/', 'src/assets/'], importMetadata: 'none', commands });
    if (!engines.length && has('index.html')) candidates.push({ engine: 'web-generic', confidence: 'certain',
      evidence: ['package.json', 'index.html', ...(lock ? [lock] : [])], languages: ['JavaScript', 'HTML', 'CSS'],
      assetRoots: ['public/', 'assets/', 'src/assets/'], importMetadata: 'none', commands });
  }

  return candidates;
}

/** Package-only web markers are tooling until a game dependency has a root HTML entry. */
function hasRootGameProject(projectDir: string, candidates: Candidate[]): boolean {
  if (candidates.some(candidate => !['web-generic', 'phaser', 'threejs'].includes(candidate.engine))) return true;
  if (!candidates.some(candidate => candidate.engine === 'phaser' || candidate.engine === 'threejs')) return false;
  try { return statSync(path.join(projectDir, 'index.html')).isFile(); }
  catch { return false; }
}

/**
 * A stored profile with its tools resolved again now. Detection is kept; only
 * whether each tool can be found changes, as the user installs, locates or
 * removes an engine. Never launches tools.
 */
export function withCurrentToolStatus(profile: EngineProfile, opts: EngineDetectOptions = {}): EngineProfile {
  return { ...profile, tools: (profile.tools ?? []).map((tool) => toolStatus(tool.id, opts)) };
}

/** Reads root markers first, then at most one level of subdirectories. Never launches tools. */
export function detectEngineProfile(projectDir: string, opts: EngineDetectOptions = {}): EngineProfile {
  let candidates = detectCandidates(projectDir);
  if (!hasRootGameProject(projectDir, candidates)) {
    const nestedCandidates: Candidate[] = [];
    const directories = readProjectEntries(projectDir)
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.')
        && !SKIPPED_ENGINE_DIRECTORIES.has(entry.name.toLowerCase()))
      .map(entry => entry.name).sort().slice(0, MAX_ENGINE_SUBDIRECTORIES);
    for (const directory of directories) {
      let nested: Candidate[];
      try { nested = detectCandidates(path.join(projectDir, directory)); }
      catch (error) {
        if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) continue;
        throw error;
      }
      const prefix = (relative: string): string => relative === '.' ? directory : `${directory}/${relative}`;
      for (const candidate of nested) {
        // Only native engine markers can displace a root web fallback.
        if (candidates.length && candidate.engine !== 'unity' && candidate.engine !== 'godot') continue;
        nestedCandidates.push({ ...candidate,
          evidence: candidate.evidence.map(prefix), assetRoots: candidate.assetRoots.map(prefix),
          commands: Object.fromEntries(Object.entries(candidate.commands).map(([name, cmd]) => [name, { ...cmd, cwd: directory }])),
        });
      }
    }
    if (nestedCandidates.length) candidates = nestedCandidates;
  }
  const selected: Candidate = candidates[0] ?? { engine: 'unknown', confidence: 'unknown', evidence: [],
    languages: [], assetRoots: [], importMetadata: 'none', commands: {} };
  const toolIds = [...new Set(Object.values(selected.commands).map((cmd) => cmd.argv[0]!))];
  return { ...selected, detectorVersion: ENGINE_DETECTOR_VERSION,
    confidence: candidates.length > 1 ? 'likely' : selected.confidence,
    evidence: [...new Set(candidates.flatMap((candidate) => candidate.evidence))],
    tools: toolIds.map((id) => toolStatus(id, opts)), detectedAt: Date.now() };
}
