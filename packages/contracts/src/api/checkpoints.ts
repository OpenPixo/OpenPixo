/** Local Git snapshots owned by a project, independent of the user's branch and index. */
export interface CheckpointFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface ProjectCheckpoint {
  id: string;
  runId: string | null;
  conversationId: string | null;
  createdAt: string;
  summary: string;
  kind: 'run' | 'before_restore';
  /** Files changed between this snapshot and its predecessor (or HEAD). */
  changedFileCount: number;
  /** Frozen at run completion; null while completion has not been recorded. */
  runChanges: CheckpointFileChange[] | null;
  completedAt: string | null;
}

export type CheckpointUnavailableReason =
  | 'not_git'
  | 'git_unavailable'
  | 'not_project_root'
  | 'unsupported_repository'
  | 'repository_unavailable'
  /** Not its own repository, and too large to snapshot on every run. */
  | 'project_too_large';

export type ListProjectCheckpointsResponse =
  | { status: 'available'; checkpoints: ProjectCheckpoint[]; busy: boolean }
  | { status: 'unavailable'; reason: CheckpointUnavailableReason; checkpoints: [] };

export interface GetProjectCheckpointResponse {
  checkpoint: ProjectCheckpoint;
  /** The complete current difference: restoring can also undo edits made after this run. */
  currentChanges: CheckpointFileChange[];
  busy: boolean;
}

export interface RestoreProjectCheckpointRequest {
  confirmed: true;
}

export interface RestoreProjectCheckpointResponse {
  checkpoint: ProjectCheckpoint;
  backupCheckpoint: ProjectCheckpoint;
  restoredFiles: CheckpointFileChange[];
}

export interface EnableProjectCheckpointsRequest {
  confirmed: true;
}

export type EnableProjectCheckpointsResponse = ListProjectCheckpointsResponse;

/**
 * Which state a checkpoint diff compares the checkpoint against.
 * - `run_end`: the project as the run left it, frozen at run completion.
 * - `working_tree`: the current files, used while the run is still going or
 *   for a checkpoint whose end state was never recorded.
 */
export type CheckpointDiffTarget = 'run_end' | 'working_tree';

export interface CheckpointDiffLine {
  kind: 'context' | 'add' | 'del';
  text: string;
}

export interface CheckpointDiffHunk {
  /** The unified-diff hunk header, e.g. `@@ -1,4 +1,5 @@ function jump()`. */
  header: string;
  lines: CheckpointDiffLine[];
}

/**
 * One file's change made by a checkpoint's run: the checkpoint snapshot (the
 * project when the run started) against the run's end state. Large files and
 * long diffs are cut at a size cap and flagged `truncated`; binary files carry
 * no hunks.
 */
export interface ProjectCheckpointFileDiff {
  path: string;
  status: CheckpointFileChange['status'];
  binary: boolean;
  hunks: CheckpointDiffHunk[];
  truncated: boolean;
  /** Added / deleted line counts; null for binary files. */
  additions: number | null;
  deletions: number | null;
}

/** `GET /api/projects/:id/checkpoints/:checkpointId/diff?path=<rel>` */
export interface GetProjectCheckpointFileDiffResponse extends ProjectCheckpointFileDiff {
  checkpointId: string;
  target: CheckpointDiffTarget;
}

/** `GET /api/projects/:id/checkpoints/:checkpointId/diff` (no `path`): every changed file. */
export interface GetProjectCheckpointDiffResponse {
  checkpointId: string;
  target: CheckpointDiffTarget;
  files: ProjectCheckpointFileDiff[];
  /** True when the changed-file count exceeded the cap and `files` is incomplete. */
  truncated: boolean;
}

/** `side` of `GET /api/projects/:id/checkpoints/:checkpointId/file?path=<rel>&side=` (raw bytes). */
export type CheckpointFileSide = 'before' | 'after';

/** Caps shared by the daemon and its readers; a capped item says `truncated`. */
export const CHECKPOINT_DIFF_LIMITS = {
  /** A side larger than this is not diffed line by line. */
  maxDiffBlobBytes: 512 * 1024,
  /** Diff lines kept per file. */
  maxFileLines: 2_000,
  /** Diff lines kept across one all-files response. */
  maxTotalLines: 8_000,
  /** Characters kept per diff line. */
  maxLineChars: 1_000,
  /** Files listed in one all-files response. */
  maxFiles: 200,
  /** Largest file version served raw by the `file` endpoint. */
  maxRawFileBytes: 20 * 1024 * 1024,
} as const;
