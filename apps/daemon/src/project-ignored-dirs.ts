import { readdirSync } from 'node:fs';

// Directory names that should not be listed or watched for folder-backed
// projects. These are generated, installed, or cache trees that add file
// descriptor pressure without adding useful design context.
export const IGNORED_PROJECT_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'vendor',
  '.pixo',
  'debug',
  'dist',
  'build',
  '.build',
  'deriveddata',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.output',
  'out',
  'coverage',
  '.gradle',
  '.swiftpm',
  '.tmp',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.tox',
  '.ruff_cache',
].map((name) => name.toLowerCase()));

export function isIgnoredProjectDirName(name: unknown): boolean {
  const normalized = String(name).toLowerCase();
  return (
    IGNORED_PROJECT_DIR_NAMES.has(normalized) ||
    normalized.startsWith('deriveddata-')
  );
}

// Game-engine cache trees. Names such as `library/` or `logs/` are too common
// to hide in every project, so a cache folder is skipped only when the folder
// holding it is that engine's project root. The check runs at every depth, so a
// Unity project nested in a repository subfolder is covered even though the
// root-level engine profile cannot see it.
const ENGINE_CACHE_DIRS: Readonly<Record<'unity' | 'godot' | 'unreal', {
  names: ReadonlySet<string>;
  isEngineRoot: (siblings: readonly string[]) => boolean;
}>> = {
  unity: {
    names: new Set(['library', 'temp', 'logs', 'obj']),
    isEngineRoot: (siblings) => siblings.includes('projectsettings') && siblings.includes('assets'),
  },
  godot: { names: new Set(['.godot']), isEngineRoot: (siblings) => siblings.includes('project.godot') },
  unreal: {
    names: new Set(['intermediate', 'saved', 'deriveddatacache']),
    isEngineRoot: (siblings) => siblings.some((name) => name.endsWith('.uproject')),
  },
};

/** Cache folder name of an engine already identified by the project's engine profile. */
export function isEngineCacheDirNameFor(engine: string | undefined, name: string): boolean {
  return Object.hasOwn(ENGINE_CACHE_DIRS, engine ?? '')
    && ENGINE_CACHE_DIRS[engine as keyof typeof ENGINE_CACHE_DIRS].names.has(name.toLowerCase());
}

/** `siblings` are the entry names of the folder that contains `name`. */
export function isEngineCacheDirName(name: unknown, siblings: readonly string[]): boolean {
  const normalized = String(name).toLowerCase();
  const engines = Object.values(ENGINE_CACHE_DIRS).filter((engine) => engine.names.has(normalized));
  if (engines.length === 0) return false;
  const lowered = siblings.map((sibling) => sibling.toLowerCase());
  return engines.some((engine) => engine.isEngineRoot(lowered));
}

/** Path form for predicates (file watchers) that have no directory listing in hand. */
export function isEngineCacheDirAt(parentDir: string, name: string): boolean {
  const normalized = name.toLowerCase();
  if (!Object.values(ENGINE_CACHE_DIRS).some((engine) => engine.names.has(normalized))) return false;
  let siblings: string[];
  try {
    siblings = readdirSync(parentDir);
  } catch {
    return false;
  }
  return isEngineCacheDirName(name, siblings);
}

/** Directory walks: generated trees by name, plus engine caches beside their engine root. */
export function isSkippedProjectDir(name: string, siblings: readonly string[]): boolean {
  return isIgnoredProjectDirName(name) || isEngineCacheDirName(name, siblings);
}
