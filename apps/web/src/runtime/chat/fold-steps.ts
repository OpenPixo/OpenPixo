/**
 * Folding the agent's routine steps into one line (owner, 2026-11-15).
 *
 * A turn on a real project spends dozens of steps reading, searching, running small
 * commands and making small edits; one row each pushed everything else screens down.
 * The owner's words: "its outputting too much stuff". Consecutive routine steps now
 * share one expandable line that says what they added up to ("查看了 12 个文件、改了
 * 2 个文件、运行了 6 条命令"); opening it shows every row as before. The changes card
 * under the turn (`TurnChanges`) already lists each changed file with its totals, so
 * folding the edits hides nothing the user has to review.
 *
 * What folds: reading, searching and listing, plain commands, and writes, edits and
 * deletes, once they have come back. What never folds: a step still running (decision
 * D3: the call in flight is visible at once, so the user sees what is happening now),
 * OpenPixo's own steps such as verifying or playtesting the game or using a skill
 * (`row.action`), generated images, narration and to-do steps.
 * Thinking between two folded steps folds with them, so a run is not broken up by
 * every pause to think; thinking still being written does not.
 *
 * Grouping is by position only: the caller keeps each item's own index, because the
 * live-text and muted-thoughts markers are indices into the unfolded list.
 */
import type { ToolKind, ToolRow } from './contract';
import type { GroupedShellItem } from './group-thinking';

/** Fewer steps than this stay as they are: folding one row saves nothing. */
export const MIN_FOLDED_STEPS = 2;

const FOLDED_KINDS: ReadonlySet<ToolKind> = new Set(['read', 'search', 'exec', 'write', 'edit', 'delete']);
const CHANGE_KINDS: ReadonlySet<ToolKind> = new Set(['write', 'edit', 'delete']);

export interface FoldedStepCounts {
  /** Distinct files read; a read with no single file counts once. */
  read: number;
  /** Distinct files written, edited or deleted; a change with no single file counts once. */
  changed: number;
  searches: number;
  commands: number;
  /** Total time of the folded steps, or null when any step has no time (a partial sum would understate it). */
  elapsedMs: number | null;
}

export type RecordSegment =
  | { kind: 'item'; index: number }
  | { kind: 'fold'; indices: number[]; counts: FoldedStepCounts };

export function isFoldedStep(row: ToolRow): boolean {
  return !row.action && !row.pending && FOLDED_KINDS.has(row.tool);
}

function isFoldedItem(item: GroupedShellItem): item is ToolRow {
  return item.kind === 'tool' && isFoldedStep(item);
}

function foldsBetweenSteps(item: GroupedShellItem): boolean {
  return item.kind === 'thoughts' && item.live !== true;
}

export function foldedStepCounts(rows: readonly ToolRow[]): FoldedStepCounts {
  const read = new Set<string>();
  const changed = new Set<string>();
  let unnamedReads = 0;
  let unnamedChanges = 0;
  let searches = 0;
  let commands = 0;
  let elapsedMs: number | null = 0;
  for (const row of rows) {
    if (row.tool === 'read') {
      if (row.file?.path) read.add(row.file.path);
      else unnamedReads += 1;
    } else if (CHANGE_KINDS.has(row.tool)) {
      if (row.file?.path) changed.add(row.file.path);
      else unnamedChanges += 1;
    } else if (row.tool === 'search') searches += 1;
    else commands += 1;
    elapsedMs = elapsedMs !== null && row.elapsedMs !== null ? elapsedMs + row.elapsedMs : null;
  }
  return { read: read.size + unnamedReads, changed: changed.size + unnamedChanges, searches, commands, elapsedMs };
}

/** The items of one execution record, with runs of routine steps folded. */
export function segmentRecord(items: readonly GroupedShellItem[]): RecordSegment[] {
  const out: RecordSegment[] = [];
  let i = 0;
  while (i < items.length) {
    if (!isFoldedItem(items[i]!)) {
      out.push({ kind: 'item', index: i });
      i += 1;
      continue;
    }
    // Extend over steps and the thinking between them; stop at anything else.
    let end = i;
    let j = i + 1;
    while (j < items.length && (isFoldedItem(items[j]!) || foldsBetweenSteps(items[j]!))) {
      if (isFoldedItem(items[j]!)) end = j;
      j += 1;
    }
    const indices = Array.from({ length: end - i + 1 }, (_, k) => i + k);
    const rows = indices.map((index) => items[index]!).filter(isFoldedItem);
    if (rows.length >= MIN_FOLDED_STEPS) {
      out.push({ kind: 'fold', indices, counts: foldedStepCounts(rows) });
    } else {
      for (const index of indices) out.push({ kind: 'item', index });
    }
    i = end + 1;
  }
  return out;
}
