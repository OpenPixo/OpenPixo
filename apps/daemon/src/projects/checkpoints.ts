import { initializeProjectGit, runProjectGit, runProjectGitBytes } from './git.js';
import { checkpointRelativePath, literalPathspec, parseUnifiedDiff, splitFileDiffs } from './checkpoint-diff.js';
import { checkpointStoreExcludes, exceedsCheckpointStoreLimits, type CheckpointStore } from './checkpoint-store.js';
import { isReservedProjectFilePath, RESERVED_PROJECT_FILE_SEGMENTS } from '../project-reserved-paths.js';
import { randomUUID } from 'node:crypto';
import { access, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHECKPOINT_DIFF_LIMITS } from '@openpixo/contracts';
import type {
  CheckpointDiffTarget,
  CheckpointFileChange,
  CheckpointFileSide,
  CheckpointUnavailableReason,
  GetProjectCheckpointResponse,
  ListProjectCheckpointsResponse,
  ProjectCheckpoint,
  ProjectCheckpointFileDiff,
  RestoreProjectCheckpointResponse,
} from '@openpixo/contracts';

const REF_PREFIX = 'refs/openpixo/checkpoints/';
/**
 * The tree a run left behind, recorded at completion. A checkpoint's own tree
 * is the project when its run started; this is the other side of the run's
 * change, so a diff of a finished run never picks up later edits.
 */
const RESULT_REF_PREFIX = 'refs/openpixo/checkpoint-results/';
const MESSAGE_PREFIX = 'OpenPixo checkpoint ';
const RETENTION = 50;
const locks = new Map<string, Promise<unknown>>();
const activeRuns = new Map<string, number>();

/**
 * A checkpoint describes the user's files, not OpenPixo's bookkeeping in the same
 * folder (`.file-versions`, reserved at any depth). So a run never reports that
 * bookkeeping as changed, and undoing a run never rewinds it.
 *
 * This holds for a store and for the project's own repository, and must not rely
 * on a store's `info/exclude`, which is written only when the store is created.
 * Checkpoints from before this rule keep those paths in their trees and frozen
 * lists, so everything read back from one is filtered too.
 */
const RESERVED_PATH_EXCLUSIONS = [...RESERVED_PROJECT_FILE_SEGMENTS].flatMap(name => [`:(exclude,glob)**/${name}`, `:(exclude,glob)**/${name}/**`]);

/** Drops reserved paths from `ls-files --stage -z` or `ls-tree -r -z` output. */
function withoutReservedEntries(listing: string): string {
  return listing.split('\0').filter(entry => entry && !isReservedProjectFilePath(entry.slice(entry.indexOf('\t') + 1))).map(entry => `${entry}\0`).join('');
}

function projectKey(folder: string): string {
  const resolved = path.resolve(folder);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Hold until the physical run and its completion snapshot have both settled. */
export async function markCheckpointRunActive(folder: string): Promise<() => void> {
  const key = projectKey(await realpath(folder));
  activeRuns.set(key, (activeRuns.get(key) ?? 0) + 1);
  return () => {
    const count = (activeRuns.get(key) ?? 1) - 1;
    if (count > 0) activeRuns.set(key, count);
    else activeRuns.delete(key);
  };
}

export type CheckpointErrorCode =
  | 'CHECKPOINT_NOT_FOUND' | 'CHECKPOINT_UNAVAILABLE' | 'CHECKPOINT_BUSY' | 'CHECKPOINT_WORKTREE_CONFLICT'
  | 'CHECKPOINT_PATH_INVALID' | 'CHECKPOINT_FILE_NOT_CHANGED' | 'CHECKPOINT_FILE_ABSENT' | 'CHECKPOINT_FILE_TOO_LARGE';

export class CheckpointError extends Error {
  constructor(readonly code: CheckpointErrorCode, message: string) {
    super(message);
  }
}

interface SnapshotInput {
  runId?: string | null;
  conversationId?: string | null;
  summary: string;
  kind?: ProjectCheckpoint['kind'];
}

interface RecordEntry {
  checkpoint: ProjectCheckpoint;
  oid: string;
  tree: string;
  parent: string;
}

/** `empty`: checkpoints can be taken, but none has been yet (no store, or no folder, so far). */
type Availability = { status: 'available'; folder: string; empty?: true } | { status: 'unavailable'; reason: CheckpointUnavailableReason };

async function pathExists(target: string): Promise<boolean> {
  try { await access(target); return true; } catch { return false; }
}

/**
 * Only private refs and a disposable index are written for snapshots/restores.
 * Metadata is the checkpoint commit's message. Completion replaces that private
 * ref with the same tree/parent and frozen run changes; no branch is rewritten.
 *
 * A folder that is its own repository root uses that repository. With a `store`,
 * any other folder uses the store (see checkpoint-store.ts). A store that exists
 * keeps winning: a run that scaffolds a repository mid-way must still find the
 * checkpoint it started from.
 */
export class ProjectCheckpoints {
  constructor(readonly folder: string, private readonly signal?: AbortSignal, private readonly store?: CheckpointStore) {}
  private scopeId?: Promise<string>;
  private storeGitDir?: Promise<string | undefined>;

  /** The store's directory when this project's checkpoints live there. */
  private gitDir(): Promise<string | undefined> {
    this.storeGitDir ??= (async () => {
      const dir = this.store?.dir;
      if (!dir) return undefined;
      if (await pathExists(path.join(dir, 'HEAD'))) return dir;
      return await this.isOwnRepositoryRoot() ? undefined : dir;
    })();
    return this.storeGitDir;
  }

  private async isOwnRepositoryRoot(): Promise<boolean> {
    try {
      const root = await realpath((await runProjectGit(this.folder, ['rev-parse', '--show-toplevel'], { signal: this.signal })).trim());
      return projectKey(root) === projectKey(await realpath(this.folder));
    } catch { return false; }
  }

  private async initializeStore(gitDir: string): Promise<void> {
    await mkdir(path.dirname(gitDir), { recursive: true });
    await runProjectGit(this.folder, ['init', '--quiet'], { gitDir, signal: this.signal });
    // Record exact bytes, whatever the user's global Git settings, so a restore is exact.
    for (const [key, value] of [['core.autocrlf', 'false'], ['core.safecrlf', 'false'], ['core.longpaths', 'true']] as const) {
      await runProjectGit(this.folder, ['config', key, value], { gitDir, signal: this.signal });
    }
    await mkdir(path.join(gitDir, 'info'), { recursive: true });
    await writeFile(path.join(gitDir, 'info', 'exclude'), checkpointStoreExcludes());
  }

  private scope(): Promise<string> {
    this.scopeId ??= (async () => {
      const [gitDir, commonDir] = await Promise.all([
        this.git(['rev-parse', '--absolute-git-dir']), this.git(['rev-parse', '--git-common-dir']),
      ]);
      return path.relative(await realpath(path.resolve(this.folder, commonDir.trim())), await realpath(gitDir.trim())).split(path.sep).join('/') || 'main';
    })();
    return this.scopeId;
  }

  private async git(args: string[], index?: string, input?: string): Promise<string> {
    return runProjectGit(this.folder, args, { index, input, signal: this.signal, gitDir: await this.gitDir() });
  }

  /** With `prepare`, a store that does not exist yet is created (a snapshot is about to need it). */
  private async availability(prepare = false): Promise<Availability> {
    // A managed project has no folder until its first file; git would call that ENOENT.
    if (!await pathExists(this.folder)) {
      return this.store ? { status: 'available', folder: this.folder, empty: true } : { status: 'unavailable', reason: 'repository_unavailable' };
    }
    try {
      const gitDir = await this.gitDir();
      if (gitDir) {
        if (await exceedsCheckpointStoreLimits(this.folder, this.store?.limits)) return { status: 'unavailable', reason: 'project_too_large' };
        if (!await pathExists(path.join(gitDir, 'HEAD'))) {
          if (!prepare) {
            await runProjectGit(this.folder, ['--version'], { signal: this.signal });
            return { status: 'available', folder: this.folder, empty: true };
          }
          await this.initializeStore(gitDir);
        }
      } else {
        if ((await this.git(['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') return { status: 'unavailable', reason: 'repository_unavailable' };
        const root = await realpath((await this.git(['rev-parse', '--show-toplevel'])).trim());
        // Never restore a parent repository's unrelated files through a child project.
        if (projectKey(root) !== projectKey(await realpath(this.folder))) return { status: 'unavailable', reason: 'not_project_root' };
      }
      const folder = await realpath(this.folder);
      const [tracked, untracked] = await Promise.all([
        this.git(['ls-files', '--stage', '-z']), this.git(['ls-files', '--others', '--exclude-standard', '-z']),
      ]);
      if (tracked.split('\0').some(entry => entry.startsWith('160000 ')) || untracked.split('\0').some(entry => entry.endsWith('/'))) {
        return { status: 'unavailable', reason: 'unsupported_repository' };
      }
      return { status: 'available', folder };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stderr?: string };
      const reason = failure.code === 'ENOENT' ? 'git_unavailable'
        : failure.stderr?.includes('not a git repository') ? 'not_git' : 'repository_unavailable';
      return { status: 'unavailable', reason };
    }
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const key = projectKey(await realpath(this.folder));
    const previous = locks.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(work);
    locks.set(key, pending);
    try { return await pending; }
    finally { if (locks.get(key) === pending) locks.delete(key); }
  }

  private async busy(): Promise<boolean> {
    return (activeRuns.get(projectKey(await realpath(this.folder))) ?? 0) > 0;
  }

  private async requireAvailable(): Promise<void> {
    const available = await this.availability();
    if (available.status !== 'available') throw new CheckpointError('CHECKPOINT_UNAVAILABLE', available.reason);
    if (available.empty) throw new CheckpointError('CHECKPOINT_NOT_FOUND', 'Checkpoint not found');
  }

  private async records(): Promise<RecordEntry[]> {
    const expectedScope = await this.scope();
    const raw = await this.git(['for-each-ref', '--format=%(objectname)%00%(tree)%00%(parent)%00%(refname)%00%(contents:subject)', REF_PREFIX]);
    const records: RecordEntry[] = [];
    for (const line of raw.split('\n')) {
      const [oid, tree, parent, ref, message] = line.split('\0');
      if (!message?.startsWith(MESSAGE_PREFIX) || !oid || !tree || !ref?.startsWith(REF_PREFIX)) continue;
      try {
        const { scope, ...checkpoint } = JSON.parse(message.slice(MESSAGE_PREFIX.length)) as ProjectCheckpoint & { scope?: string };
        if (scope !== expectedScope || !checkpoint || typeof checkpoint.id !== 'string' || ref !== `${REF_PREFIX}${checkpoint.id}`
          || typeof checkpoint.createdAt !== 'string' || typeof checkpoint.summary !== 'string') continue;
        if (Array.isArray(checkpoint.runChanges)) checkpoint.runChanges = checkpoint.runChanges.filter(change => !isReservedProjectFilePath(change.path));
        records.push({ checkpoint, oid, tree, parent: parent ?? '' });
      } catch { /* Unrelated/corrupt refs are never interpreted as restore targets. */ }
    }
    return records.sort((a, b) => b.checkpoint.createdAt.localeCompare(a.checkpoint.createdAt) || b.checkpoint.id.localeCompare(a.checkpoint.id));
  }

  private async record(id: string): Promise<RecordEntry> {
    if (!/^[a-z0-9-]{10,100}$/u.test(id)) throw new CheckpointError('CHECKPOINT_NOT_FOUND', 'Checkpoint not found');
    const entry = (await this.records()).find(record => record.checkpoint.id === id);
    if (!entry) throw new CheckpointError('CHECKPOINT_NOT_FOUND', 'Checkpoint not found');
    return entry;
  }

  private async withIndex<T>(work: (index: string) => Promise<T>): Promise<T> {
    const gitDir = (await this.git(['rev-parse', '--absolute-git-dir'])).trim();
    const index = path.join(gitDir, `openpixo-index-${randomUUID()}`);
    try { return await work(index); }
    finally {
      await rm(index, { force: true });
      await rm(`${index}.lock`, { force: true });
    }
  }

  private async workingTree(index: string): Promise<string> {
    // Rebuild the disposable index from tracked entries, discarding stat-cache,
    // assume-unchanged and skip-worktree bits. Tracked ignored files stay tracked.
    const tracked = withoutReservedEntries(await this.git(['ls-files', '--stage', '-z']));
    await this.git(['update-index', '-z', '--index-info'], index, tracked);
    await this.git(['add', '-A', '--', '.', ...RESERVED_PATH_EXCLUSIONS], index);
    const tree = (await this.git(['write-tree'], index)).trim();
    if ((await this.git(['ls-tree', '-r', tree])).split('\n').some(entry => entry.startsWith('160000 '))) {
      throw new CheckpointError('CHECKPOINT_UNAVAILABLE', 'unsupported_repository');
    }
    return tree;
  }

  private async changes(from: string, to: string): Promise<CheckpointFileChange[]> {
    const tokens = (await this.git(['diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', '-z', from, to, '--'])).split('\0');
    const changes: CheckpointFileChange[] = [];
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      if (!tokens[i] || !tokens[i + 1] || isReservedProjectFilePath(tokens[i + 1])) continue;
      changes.push({ path: tokens[i + 1]!, status: tokens[i] === 'A' ? 'added' : tokens[i] === 'D' ? 'deleted' : 'modified' });
    }
    return changes;
  }

  /** The tree an undo may write: an older checkpoint's, minus the reserved paths it still holds. */
  private async withoutReservedPaths(tree: string): Promise<string> {
    const listed = await this.git(['ls-tree', '-r', '-z', tree]);
    const kept = withoutReservedEntries(listed);
    if (kept === listed) return tree;
    return this.withIndex(async index => {
      await this.git(['update-index', '-z', '--index-info'], index, kept);
      return (await this.git(['write-tree'], index)).trim();
    });
  }

  private async assertIgnoredFilesSafe(tree: string, index: string): Promise<void> {
    const [ignoredRaw, targetRaw, ignoreCaseRaw] = await Promise.all([
      this.git(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], index),
      this.git(['ls-tree', '-r', '-z', '--name-only', tree]),
      this.git(['config', '--bool', '--get', 'core.ignorecase']).catch(error => {
        if ((error as { code?: number }).code === 1) return '';
        throw error;
      }),
    ]);
    const ignoreCase = ignoreCaseRaw.trim() ? ignoreCaseRaw.trim() === 'true' : ['win32', 'darwin'].includes(process.platform);
    const comparisonPath = (name: string): string => ignoreCase ? name.normalize('NFC').toLowerCase() : name;
    const ignored = ignoredRaw.split('\0').filter(Boolean).map(name => name.replace(/\/$/u, ''));
    const targets = targetRaw.split('\0').filter(Boolean);
    const hasAncestor = (name: string, candidates: Set<string>): boolean => {
      for (let current = comparisonPath(name); current; current = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '') {
        if (candidates.has(current)) return true;
      }
      return false;
    };
    const targetSet = new Set(targets.map(comparisonPath));
    const ignoredSet = new Set(ignored.map(comparisonPath));
    if (ignored.some(name => hasAncestor(name, targetSet)) || targets.some(name => hasAncestor(name, ignoredSet))) {
      throw new CheckpointError('CHECKPOINT_WORKTREE_CONFLICT', 'An ignored file blocks the snapshot; the pre-restore checkpoint is retained');
    }
  }

  private async writeCheckpoint(tree: string, parent: string, checkpoint: ProjectCheckpoint, oldOid?: string): Promise<void> {
    const oid = (await this.git(['commit-tree', tree, ...(parent ? ['-p', parent] : [])], undefined,
      `${MESSAGE_PREFIX}${JSON.stringify({ ...checkpoint, scope: await this.scope() })}\n`)).trim();
    await this.git(['update-ref', `${REF_PREFIX}${checkpoint.id}`, oid, ...(oldOid ? [oldOid] : [])]);
  }

  private async prune(): Promise<void> {
    const records = await this.records();
    const old = records.slice(RETENTION);
    if (old.length) await this.git(['update-ref', '--stdin'], undefined,
      old.map(entry => `delete ${REF_PREFIX}${entry.checkpoint.id} ${entry.oid}\n`).join(''));
    // End-state refs live exactly as long as their checkpoint.
    const kept = new Set(records.slice(0, RETENTION).map(entry => entry.checkpoint.id));
    const results = (await this.git(['for-each-ref', '--format=%(refname)', RESULT_REF_PREFIX])).split('\n')
      .filter(ref => ref.startsWith(RESULT_REF_PREFIX) && !kept.has(ref.slice(RESULT_REF_PREFIX.length)));
    if (results.length) await this.git(['update-ref', '--stdin'], undefined, results.map(ref => `delete ${ref}\n`).join(''));
  }

  private async resultTree(id: string): Promise<string | null> {
    try { return (await this.git(['rev-parse', '--verify', '--quiet', `${RESULT_REF_PREFIX}${id}^{tree}`])).trim() || null; }
    catch { return null; }
  }

  /** The run's other side: its recorded end state, or the current files while it has none. */
  private async withRunEnd<T>(entry: RecordEntry, work: (tree: string, target: CheckpointDiffTarget) => Promise<T>): Promise<T> {
    const end = entry.checkpoint.completedAt ? await this.resultTree(entry.checkpoint.id) : null;
    if (end) return work(end, 'run_end');
    return this.withIndex(async index => work(await this.workingTree(index), 'working_tree'));
  }

  private async treeDiff(from: string, to: string, relative?: string): Promise<{ files: ProjectCheckpointFileDiff[]; truncated: boolean }> {
    const pathspec = relative === undefined ? [] : [literalPathspec(relative)];
    const quiet = ['-c', 'core.quotePath=false'];
    const [rawOutput, numstatOutput] = await Promise.all([
      this.git([...quiet, 'diff-tree', '-r', '-z', '--no-renames', '--no-commit-id', '--raw', '--no-abbrev', from, to, '--', ...pathspec]),
      this.git([...quiet, 'diff-tree', '-r', '-z', '--no-renames', '--no-commit-id', '--numstat', from, to, '--', ...pathspec]),
    ]);
    const entries: { path: string; status: CheckpointFileChange['status']; oids: string[] }[] = [];
    const rawTokens = rawOutput.split('\0');
    for (let i = 0; i + 1 < rawTokens.length; i += 2) {
      const meta = rawTokens[i]!;
      const filePath = rawTokens[i + 1]!;
      if (!meta.startsWith(':') || !filePath || isReservedProjectFilePath(filePath)) continue;
      const [, , oldOid = '', newOid = '', letter = ''] = meta.slice(1).split(' ');
      const status = letter.startsWith('A') ? 'added' : letter.startsWith('D') ? 'deleted' : 'modified';
      const existing = entries.find(item => item.path === filePath);
      if (existing) existing.oids.push(oldOid, newOid);
      else entries.push({ path: filePath, status, oids: [oldOid, newOid] });
    }
    const counts = new Map<string, { additions: number | null; deletions: number | null }>();
    for (const record of numstatOutput.split('\0')) {
      const match = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/u.exec(record);
      if (!match) continue;
      const binary = match[1] === '-' || match[2] === '-';
      const previous = counts.get(match[3]!);
      counts.set(match[3]!, binary || (previous && previous.additions === null) ? { additions: null, deletions: null }
        : { additions: (previous?.additions ?? 0) + Number(match[1]), deletions: (previous?.deletions ?? 0) + Number(match[2]) });
    }
    const truncated = entries.length > CHECKPOINT_DIFF_LIMITS.maxFiles;
    const listed = entries.slice(0, CHECKPOINT_DIFF_LIMITS.maxFiles);
    const objects = [...new Set(listed.flatMap(item => item.oids).filter(oid => /^[0-9a-f]+$/u.test(oid) && !/^0+$/u.test(oid)))];
    const sizes = new Map<string, number>();
    if (objects.length) {
      for (const line of (await this.git(['cat-file', '--batch-check'], undefined, `${objects.join('\n')}\n`)).split('\n')) {
        const [oid, type, size] = line.split(' ');
        if (oid && type === 'blob') sizes.set(oid, Number(size));
      }
    }
    const files: ProjectCheckpointFileDiff[] = listed.map(item => {
      const count = counts.get(item.path);
      return { path: item.path, status: item.status, binary: count?.additions === null,
        hunks: [], truncated: false, additions: count?.additions ?? null, deletions: count?.deletions ?? null };
    });
    // Diff only text files whose sides fit the cap, and only while the
    // response's line budget can still hold them.
    const eligible: ProjectCheckpointFileDiff[] = [];
    let estimate = 0;
    for (const [index, file] of files.entries()) {
      if (file.binary) continue;
      const oversized = listed[index]!.oids.some(oid => (sizes.get(oid) ?? 0) > CHECKPOINT_DIFF_LIMITS.maxDiffBlobBytes);
      if (oversized || estimate >= CHECKPOINT_DIFF_LIMITS.maxTotalLines) { file.truncated = true; continue; }
      estimate += (file.additions ?? 0) + (file.deletions ?? 0);
      eligible.push(file);
    }
    let budget: number = CHECKPOINT_DIFF_LIMITS.maxTotalLines;
    const byPath = new Map(eligible.map(file => [file.path, file]));
    for (const batch of pathspecBatches(eligible.map(file => file.path))) {
      const output = await this.git([...quiet, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames',
        '--unified=3', from, to, '--', ...batch.map(literalPathspec)]);
      const sections = splitFileDiffs(output);
      sections.forEach((section, ordinal) => {
        const file = byPath.get(diffSectionPath(section) ?? '') ?? (sections.length === batch.length ? byPath.get(batch[ordinal]!) : undefined);
        if (!file) return;
        const room = Math.max(0, Math.min(CHECKPOINT_DIFF_LIMITS.maxFileLines - countLines(file), budget));
        const parsed = parseUnifiedDiff(section, room);
        file.hunks.push(...parsed.hunks);
        file.truncated ||= parsed.truncated;
        budget -= parsed.lines;
      });
    }
    return { files, truncated };
  }

  private async snapshotInner(input: SnapshotInput): Promise<ProjectCheckpoint> {
    return this.withIndex(async index => {
      const tree = await this.workingTree(index);
      const previous = (await this.records())[0];
      let head = '';
      if (!previous) {
        try { head = (await this.git(['rev-parse', '--verify', 'HEAD'])).trim(); } catch { /* Unborn branch. */ }
      }
      const parent = previous?.oid ?? head;
      const emptyTree = !parent ? (await this.git(['hash-object', '-t', 'tree', '--stdin'], undefined, '')).trim() : '';
      const checkpoint: ProjectCheckpoint = {
        id: `${Date.now().toString(36)}-${randomUUID()}`,
        runId: input.runId ?? null, conversationId: input.conversationId ?? null,
        createdAt: new Date().toISOString(), summary: input.summary.replace(/\s+/gu, ' ').trim().slice(0, 240),
        kind: input.kind ?? 'run', changedFileCount: (await this.changes(parent || emptyTree, tree)).length,
        runChanges: null, completedAt: null,
      };
      await this.writeCheckpoint(tree, parent, checkpoint);
      await this.prune();
      return checkpoint;
    });
  }

  async list(): Promise<ListProjectCheckpointsResponse> {
    const available = await this.availability();
    if (available.status !== 'available') return { ...available, checkpoints: [] };
    if (available.empty) return { status: 'available', checkpoints: [], busy: false };
    return { status: 'available', checkpoints: (await this.records()).map(entry => entry.checkpoint), busy: await this.busy() };
  }

  async snapshot(input: SnapshotInput): Promise<ProjectCheckpoint | null> {
    return this.exclusive(async () => {
      const available = await this.availability(true);
      if (available.status !== 'available') {
        if (available.reason === 'not_git') return null;
        throw new CheckpointError('CHECKPOINT_UNAVAILABLE', available.reason);
      }
      return this.snapshotInner(input);
    });
  }

  async finish(id: string): Promise<ProjectCheckpoint> {
    return this.exclusive(async () => {
      const entry = await this.record(id);
      if (entry.checkpoint.completedAt) return entry.checkpoint;
      return this.withIndex(async index => {
        const tree = await this.workingTree(index);
        const checkpoint = { ...entry.checkpoint, runChanges: await this.changes(entry.tree, tree), completedAt: new Date().toISOString() };
        await this.git(['update-ref', `${RESULT_REF_PREFIX}${checkpoint.id}`, tree]);
        await this.writeCheckpoint(entry.tree, entry.parent, checkpoint, entry.oid);
        return checkpoint;
      });
    });
  }

  async show(id: string): Promise<GetProjectCheckpointResponse> {
    return this.exclusive(async () => {
      await this.requireAvailable();
      const entry = await this.record(id);
      return this.withIndex(async index => ({ checkpoint: entry.checkpoint,
        currentChanges: await this.changes(entry.tree, await this.workingTree(index)), busy: await this.busy() }));
    });
  }

  /**
   * The run's own change: the checkpoint (the project when the run started)
   * against the run's end state — or, while the run has none yet, the current
   * files. With `relative`, only that file, which must be one the run changed.
   */
  async diff(id: string, relative?: string): Promise<{ target: CheckpointDiffTarget; files: ProjectCheckpointFileDiff[]; truncated: boolean }> {
    const filePath = relative === undefined ? undefined : requireRelativePath(relative);
    return this.exclusive(async () => {
      await this.requireAvailable();
      const entry = await this.record(id);
      return this.withRunEnd(entry, async (end, target) => {
        const result = await this.treeDiff(entry.tree, end, filePath);
        if (filePath !== undefined && result.files.length === 0) {
          throw new CheckpointError('CHECKPOINT_FILE_NOT_CHANGED', 'This run did not change that file');
        }
        return { target, ...result };
      });
    });
  }

  /** One file as it was before the run (`before`) or after it (`after`, the same end state as `diff`). */
  async fileVersion(id: string, relative: string, side: CheckpointFileSide): Promise<{ path: string; bytes: Buffer; target: CheckpointDiffTarget }> {
    const filePath = requireRelativePath(relative);
    return this.exclusive(async () => {
      await this.requireAvailable();
      const entry = await this.record(id);
      return this.withRunEnd(entry, async (end, target) => {
        const tree = side === 'before' ? entry.tree : end;
        const [oid, type, size] = (await this.git(['cat-file', '--batch-check'], undefined, `${tree}:${filePath}\n`)).trim().split(' ');
        if (type !== 'blob' || !oid) throw new CheckpointError('CHECKPOINT_FILE_ABSENT', 'That file does not exist on this side of the run');
        if (Number(size) > CHECKPOINT_DIFF_LIMITS.maxRawFileBytes) throw new CheckpointError('CHECKPOINT_FILE_TOO_LARGE', 'That file is too large to show');
        const bytes = await runProjectGitBytes(this.folder, ['cat-file', 'blob', oid], { maxBuffer: CHECKPOINT_DIFF_LIMITS.maxRawFileBytes + 1, signal: this.signal, gitDir: await this.gitDir() });
        return { path: filePath, bytes, target };
      });
    });
  }

  async restore(id: string): Promise<RestoreProjectCheckpointResponse> {
    return this.exclusive(async () => {
      await this.requireAvailable();
      if (await this.busy()) throw new CheckpointError('CHECKPOINT_BUSY', 'Wait for the project agent runs to finish');
      const entry = await this.record(id);
      const target = await this.withoutReservedPaths(entry.tree);
      const backupCheckpoint = await this.snapshotInner({ summary: entry.checkpoint.summary,
        conversationId: entry.checkpoint.conversationId, kind: 'before_restore' });
      const backup = await this.record(backupCheckpoint.id);
      const restoredFiles = await this.changes(backup.tree, target);
      await this.withIndex(async index => {
        if (await this.workingTree(index) !== backup.tree) {
          throw new CheckpointError('CHECKPOINT_WORKTREE_CONFLICT', 'Files changed after the pre-restore snapshot; no files were restored');
        }
        try {
          // read-tree permits overwriting ignored paths; explicitly protect
          // them before the merge, including file/directory prefix collisions.
          await this.assertIgnoredFilesSafe(target, index);
          await this.git(['read-tree', '-n', '-m', '-u', backup.tree, target], index);
          if (await this.busy()) throw new CheckpointError('CHECKPOINT_BUSY', 'Wait for the project agent runs to finish');
          await this.git(['read-tree', '-m', '-u', backup.tree, target], index);
        } catch (error) {
          if (error instanceof CheckpointError) throw error;
          throw Object.assign(new CheckpointError('CHECKPOINT_WORKTREE_CONFLICT', 'Files changed during restore or an ignored file blocks the snapshot; the pre-restore checkpoint is retained'), { cause: error });
        }
      });
      return { checkpoint: entry.checkpoint, backupCheckpoint, restoredFiles };
    });
  }

  /** Explicitly opted-in initialization is the only operation allowed to create HEAD/index. */
  async enable(): Promise<ListProjectCheckpointsResponse> {
    return this.exclusive(async () => {
      if (await this.busy()) throw new CheckpointError('CHECKPOINT_BUSY', 'Wait for the project agent runs to finish');
      const available = await this.availability();
      if (available.status === 'available') return this.list();
      if (available.reason !== 'not_git') throw new CheckpointError('CHECKPOINT_UNAVAILABLE', available.reason);
      await initializeProjectGit((args, input) => this.git(args, undefined, input), 'OpenPixo: enable version protection');
      return this.list();
    });
  }
}

function requireRelativePath(raw: string): string {
  const relative = checkpointRelativePath(raw);
  if (relative === null) throw new CheckpointError('CHECKPOINT_PATH_INVALID', 'Use a path inside the project, relative to its folder');
  return relative;
}

function countLines(file: ProjectCheckpointFileDiff): number {
  return file.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
}

/** The path a `diff --git a/<p> b/<p>` header names (no renames, so both sides match); null when Git quoted it. */
function diffSectionPath(section: string): string | null {
  const newline = section.indexOf('\n');
  const body = section.slice('diff --git '.length, newline === -1 ? section.length : newline);
  if (!body.startsWith('a/')) return null;
  const length = (body.length - 'a/'.length - ' b/'.length) / 2;
  if (!Number.isInteger(length) || length <= 0) return null;
  const left = body.slice(2, 2 + length);
  return body.slice(2 + length) === ` b/${left}` ? left : null;
}

/** Keep each `git diff` argv well under Windows' command-line limit. */
function pathspecBatches(paths: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const item of paths) {
    if (current.length && length + item.length > 16_000) { batches.push(current); current = []; length = 0; }
    current.push(item);
    length += item.length + 12;
  }
  if (current.length) batches.push(current);
  return batches;
}
