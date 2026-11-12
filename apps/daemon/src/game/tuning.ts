import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GameTuningErrorCode, GameTuningListResponse, GameTuningParameter, GameTuningSetRequest, GameTuningSetResponse, GameTuningValue, GameTuningWarning } from '@openpixo/contracts';
import { godotNumericColorComponents, scanGodotScenes, scanGodotScript, type TuningLocation } from './tuning-godot.js';
import { scanWebTuning } from './tuning-json.js';
import { ProjectCheckpoints } from '../projects/checkpoints.js';
import type { CheckpointStore } from '../projects/checkpoint-store.js';

const SKIP = new Set(['.git', '.godot', '.pixo', '.tmp', '.cache', 'node_modules', 'dist', 'build', 'coverage', '.next', 'Library', 'Temp']);
const MAX_FILES = 5_000; const MAX_BYTES = 2 * 1024 * 1024;
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const locks = new Map<string, Promise<unknown>>();

export class GameTuningError extends Error {
  constructor(readonly code: GameTuningErrorCode, message: string) { super(message); this.name = 'GameTuningError'; }
}
export interface GameTuningWriteOptions {
  /** Project checkpoint adapter. A rejected checkpoint always aborts the edit. */
  beforeWrite?: (input: { projectDir: string; filePath: string; parameter: GameTuningParameter; value: GameTuningValue }) => Promise<{ id?: string } | void>;
  /** Where the default checkpoint lives when the project is not its own repository. */
  checkpointStore?: CheckpointStore;
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function safeFile(root: string, filePath: string): Promise<string> {
  const target = path.resolve(root, filePath);
  if (!contained(root, target)) throw new GameTuningError('TUNING_UNSAFE_PATH', 'Tuning source is outside the project');
  let cursor = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, segment);
    if ((await lstat(cursor)).isSymbolicLink()) throw new GameTuningError('TUNING_UNSAFE_PATH', 'Tuning sources cannot be symbolic links');
  }
  const canonical = await realpath(target);
  if (!contained(root, canonical)) throw new GameTuningError('TUNING_UNSAFE_PATH', 'Tuning source is outside the project');
  return canonical;
}

interface Scanned { parameters: Array<{ parameter: GameTuningParameter; location: TuningLocation }>; sources: Map<string, string>; warnings: GameTuningWarning[]; root: string }
async function scan(projectDir: string): Promise<Scanned> {
  let root: string;
  try { root = await realpath(projectDir); } catch (error) {
    // A project folder that does not exist yet has nothing to tune.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { parameters: [], sources: new Map(), warnings: [], root: projectDir };
    throw new GameTuningError('TUNING_READ_FAILED', 'Project directory is unavailable');
  }
  const sources = new Map<string, string>(); const warnings: GameTuningWarning[] = []; let count = 0; let limited = false;
  async function walk(relative: string, depth: number): Promise<void> {
    if (limited) return;
    if (depth > 32) { warnings.push({ code: 'TUNING_SCAN_LIMIT', filePath: relative }); return; }
    let entries;
    try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); }
    catch { warnings.push({ code: 'TUNING_READ_FAILED', filePath: relative || '.' }); return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && SKIP.has(entry.name)) continue;
      if (!entry.isDirectory() && (!entry.isFile() || (!/\.(gd|tscn)$/i.test(name) && name !== 'tuning.json' && name !== 'src/tuning.json'))) continue;
      // Artwork and audio files do not consume the source-file budget.
      if (++count > MAX_FILES) { limited = true; warnings.push({ code: 'TUNING_SCAN_LIMIT', filePath: relative || '.' }); return; }
      if (entry.isDirectory()) { if (!SKIP.has(entry.name)) await walk(name, depth + 1); continue; }
      try {
        const target = await safeFile(root, name);
        if ((await lstat(target)).size > MAX_BYTES) { warnings.push({ code: 'TUNING_SCAN_LIMIT', filePath: name }); continue; }
        const bytes = await readFile(target);
        const source = bytes.toString('utf8');
        if (!Buffer.from(source, 'utf8').equals(bytes)) { warnings.push({ code: 'TUNING_READ_FAILED', filePath: name }); continue; }
        sources.set(name, source);
      } catch { warnings.push({ code: 'TUNING_READ_FAILED', filePath: name }); }
    }
  }
  await walk('', 0);
  const scripts = new Map<string, TuningLocation[]>(); const scenes = new Map<string, string>(); const locations: TuningLocation[] = [];
  for (const [filePath, source] of sources) {
    if (/\.gd$/i.test(filePath)) { const declarations = scanGodotScript(filePath, source); scripts.set(filePath, declarations); locations.push(...declarations); }
    else if (/\.tscn$/i.test(filePath)) scenes.set(filePath, source);
    else {
      try { locations.push(...scanWebTuning(filePath, source)); }
      catch { warnings.push({ code: 'TUNING_INVALID_JSON', filePath }); }
    }
  }
  locations.push(...scanGodotScenes(scenes, scripts));
  const occurrences = new Map<string, number>();
  const parameters = locations.map(location => {
    const item = location.parameter;
    // Local classes can export the same name. Keep each declaration addressable
    // while retaining its identity when comments move its line number.
    const identity = [item.source, item.filePath, item.nodePath ?? '', item.key];
    const key = JSON.stringify(identity);
    const occurrence = occurrences.get(key) ?? 0; occurrences.set(key, occurrence + 1);
    const id = hash(JSON.stringify([...identity, occurrence]));
    return { parameter: { ...item, id, fileHash: hash(sources.get(item.filePath)!) }, location };
  }).sort((a, b) => a.parameter.filePath.localeCompare(b.parameter.filePath) || a.parameter.line - b.parameter.line);
  return { parameters, sources, warnings, root };
}

export async function discoverGameTuning(projectDir: string): Promise<GameTuningListResponse> {
  // A new managed project has no folder until its first write, so nothing to tune yet.
  const missing = await lstat(projectDir).then(() => false, (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
  if (missing) return { parameters: [], warnings: [] };
  const result = await scan(projectDir);
  return { parameters: result.parameters.map(item => item.parameter), warnings: result.warnings };
}

function replacement(parameter: GameTuningParameter, value: GameTuningValue): string {
  const invalid = () => { throw new GameTuningError('TUNING_INVALID_VALUE', `Invalid literal for ${parameter.key}`); };
  if (parameter.type === 'int' || parameter.type === 'float') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (parameter.type === 'int' && !Number.isSafeInteger(value))) return invalid();
    if ((parameter.min !== undefined && !parameter.allowLess && value < parameter.min) || (parameter.max !== undefined && !parameter.allowGreater && value > parameter.max)) return invalid();
  } else if (parameter.type === 'bool') { if (typeof value !== 'boolean') return invalid(); }
  else if (parameter.type === 'color') {
    if (typeof value !== 'string') return invalid();
    if (!/^#[\da-fA-F]{6}([\da-fA-F]{2})?$/.test(value)) {
      const literal = value.trim();
      const channels = godotNumericColorComponents(literal);
      if (!channels) return invalid();
      if (parameter.source === 'web-json') return JSON.stringify(literal);
      const count = literal.slice(literal.indexOf('(') + 1, -1).split(',').length;
      return parameter.source === 'godot-scene' && count === 3 ? `Color(${channels.join(', ')})` : literal;
    }
  }
  else if (typeof value !== 'string' || value.length > 16_384) return invalid();
  if (parameter.source === 'web-json') return JSON.stringify(value);
  if (parameter.type === 'float') {
    const text = String(value); return /[.eE]/.test(text) ? text : `${text}.0`;
  }
  if (parameter.type === 'color') {
    const hex = String(value).slice(1).padEnd(8, 'f');
    return `Color(${[0, 2, 4, 6].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255).join(', ')})`;
  }
  if (parameter.type === 'string') {
    const escaped = JSON.stringify(value);
    // Keep single-quoted GDScript strings single-quoted, escaping both newlines and quotes.
    return parameter.literal[0] === "'" ? "'" + escaped.slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'") + "'" : escaped;
  }
  return String(value);
}

async function withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(action); locks.set(key, current);
  try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
}

/** Hash checks surround checkpoint creation. Only the literal's byte-equivalent UTF-8 span changes. */
export async function setGameTuningValue(projectDir: string, request: GameTuningSetRequest, options: GameTuningWriteOptions = {}): Promise<GameTuningSetResponse> {
  if (!request || typeof request.id !== 'string' || typeof request.fileHash !== 'string' || !/^[\da-f]{64}$/.test(request.fileHash)) {
    throw new GameTuningError('TUNING_INVALID_REQUEST', 'A parameter id and source file hash are required');
  }
  const root = await realpath(projectDir);
  // Serialize all tuning edits in a project so one file's revision cannot race another control.
  return withLock(root, async () => {
    const result = await scan(root);
    const item = result.parameters.find(candidate => candidate.parameter.id === request.id);
    if (!item) throw new GameTuningError('TUNING_NOT_FOUND', 'Tunable parameter no longer exists');
    const { parameter, location } = item;
    if (parameter.fileHash !== request.fileHash) throw new GameTuningError('TUNING_CONFLICT', 'Source changed; reload the tuning panel before applying');
    const literal = replacement(parameter, request.value);
    const source = result.sources.get(parameter.filePath)!;
    const next = source.slice(0, location.start) + literal + source.slice(location.end);
    if (next === source) return { parameter };
    let checkpoint: { id?: string } | void;
    try {
      // the single checkpoint integration point for every tuning source write.
      checkpoint = options.beforeWrite
        ? await options.beforeWrite({ projectDir: root, filePath: parameter.filePath, parameter, value: request.value })
        : await new ProjectCheckpoints(root, undefined, options.checkpointStore).snapshot({ summary: `Tune ${parameter.key} (${parameter.filePath}:${parameter.line})` }) ?? undefined;
    }
    catch { throw new GameTuningError('TUNING_CHECKPOINT_FAILED', 'Checkpoint creation failed; the source was not changed'); }
    const target = await safeFile(root, parameter.filePath);
    const temporary = path.join(path.dirname(target), `.pixo-tuning-${randomUUID()}.tmp`);
    try {
      const stat = await lstat(target);
      await writeFile(temporary, next, { flag: 'wx', mode: stat.mode });
      // An editor/agent may have written while the checkpoint or temporary file was being created.
      if (await safeFile(root, parameter.filePath) !== target || hash(await readFile(target, 'utf8')) !== request.fileHash) {
        throw new GameTuningError('TUNING_CONFLICT', 'Source changed; no tuning edit was applied');
      }
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => {}); }
    return { parameter: { ...parameter, value: request.value, literal, fileHash: hash(next) }, ...(checkpoint?.id ? { checkpointId: checkpoint.id } : {}) };
  });
}
