// OpenPixo deterministic asset processing (`pixo asset <op>`).
// Spec: specs/current/openpixo-phase3-assets.md §3.5. Report fields match skills/game-assets-batch.

export const ASSET_OP_NAMES = [
  'resize',
  'trim',
  'slice',
  'pack',
  'export-spritesheet',
  'pixelate',
  'palette',
  'seamless-check',
  'remove-bg',
  'frames-check',
  'frames-align',
  'audio-normalize',
  'audio-trim',
  'audio-loop',
  'audio-convert',
] as const;
export type AssetOpName = (typeof ASSET_OP_NAMES)[number];

/** POST /api/projects/:id/asset-ops */
export interface AssetOpRequest {
  op: AssetOpName;
  /** Project-relative input paths (POSIX separators). */
  inputs: string[];
  /** Op-specific parameters, e.g. `{ width: 64, filter: 'nearest' }` or `{ grid: '6x8' }`. */
  params?: Record<string, unknown>;
  /** Project-relative output directory. Defaults to `derived/<op>/`. */
  out?: string;
  dryRun?: boolean;
}

export type AssetOpItemStatus = 'succeeded' | 'failed' | 'skipped';

export interface AssetOpItemResult {
  source: string;
  sourceSha256: string | null;
  /** Hash observed after the batch, when the source could be read. */
  sourceSha256After?: string;
  /** Primary project-relative output (planned in dry runs), or null on failure/skip. */
  output: string | null;
  outputSha256?: string;
  /** Additional outputs (frames, atlas descriptor, manifest, preview). */
  extraOutputs?: string[];
  /** Hashes of all files actually produced (including additional outputs). */
  outputHashes?: Record<string, string>;
  status: AssetOpItemStatus;
  exitCode?: number;
  /** Failure or skip reason. */
  error?: string;
  /** Op-specific facts, e.g. seamless score or extracted palette. */
  detail?: Record<string, unknown>;
  /** All contributing originals; pack has multiple parents. */
  parentHashes?: string[];
}

export interface AssetOpReport {
  op: AssetOpName;
  params: Record<string, unknown>;
  /** Tool identity, e.g. `sharp 0.35.3` or `ffmpeg 7.1`. */
  tool: string;
  dryRun: boolean;
  results: AssetOpItemResult[];
  /** True when every original hashed identically before and after the batch. */
  originalsPreserved: boolean;
  /** Project-relative report file, absent for dry runs. */
  reportPath?: string;
  counts: Record<AssetOpItemStatus, number>;
  /** Facts about the inputs as one set; `frames-check` and `frames-align` report `FramesCheckSummary`. */
  summary?: FramesCheckSummary;
}

/**
 * Whether a set of animation frames plays as one steady animation, in numbers a model
 * that cannot see images can judge, and one plain sentence per problem in `issues`.
 * Frame numbers are 1-based, in input order.
 */
export interface FramesCheckSummary {
  frames: number;
  sameCanvas: boolean;
  emptyFrames: number[];
  edgeFrames: number[];
  baselineSpreadPx: number;
  feetXSpreadPx: number;
  heightDriftPercent: number;
  widthDriftPercent: number;
  issues: string[];
  ok: boolean;
}
