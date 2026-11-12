// What the 改动 view lists (specs/current/openpixo-game-panel.md §5). Pure.
//
// Files come only from the project's checkpoints: a finished run's frozen
// `runChanges`, or — while the run is still going — the live changes the
// checkpoint `show` call reports. Images come from the chat gallery's rule
// (`runtime/chat/turn-assets.ts`); nothing here detects images on its own.

import type { ChatMessage, CheckpointFileChange, ProjectCheckpoint } from '@openpixo/contracts';
import { buildTurnBlocks } from '../../runtime/chat/build-turn-blocks';
import type { RecordFileScope } from '../../runtime/chat/record-file-open';
import { collectTurnAssets, type TurnAsset } from '../../runtime/chat/turn-assets';
import { dedupeToolUsesById, dropSupersededInFlightToolUses } from '../../runtime/tool-events';

export type ChangeScope = 'run' | 'session';

export interface ChangeRow {
  path: string;
  status: CheckpointFileChange['status'];
  /** The checkpoint whose run made the change (in 本会话, the latest run that touched the path). */
  checkpointId: string;
}

/** The conversation's latest run: the last assistant message that carries a run id. */
export function latestRunMessage(messages: readonly ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'assistant' && message.runId) return message;
  }
  return null;
}

export function checkpointForRun(checkpoints: readonly ProjectCheckpoint[], runId: string | null | undefined): ProjectCheckpoint | null {
  if (!runId) return null;
  return checkpoints.find((checkpoint) => checkpoint.runId === runId) ?? null;
}

/** A run's changed files: frozen at completion, otherwise the live list (null while unknown). */
export function runChangeList(checkpoint: ProjectCheckpoint, live: readonly CheckpointFileChange[] | null): readonly CheckpointFileChange[] | null {
  return checkpoint.runChanges ?? live;
}

export function runRows(checkpoint: ProjectCheckpoint | null, live: readonly CheckpointFileChange[] | null): ChangeRow[] {
  if (!checkpoint) return [];
  return (runChangeList(checkpoint, live) ?? []).map((change) => ({ ...change, checkpointId: checkpoint.id }));
}

/**
 * 本会话: every run of the conversation, one row per path. A path's status is
 * its net change across the session — added then edited is still added, added
 * then deleted drops out — and its row opens the latest run that touched it.
 * A run whose completion was never recorded contributes only while it is the
 * live one (`liveCheckpointId`); its later "current" list would mix in edits
 * made after it.
 */
export function sessionRows(
  checkpoints: readonly ProjectCheckpoint[],
  conversationId: string | null | undefined,
  live: { checkpointId: string; changes: readonly CheckpointFileChange[] } | null,
): ChangeRow[] {
  if (!conversationId) return [];
  const runs = checkpoints
    .filter((checkpoint) => checkpoint.kind === 'run' && checkpoint.conversationId === conversationId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const byPath = new Map<string, { first: CheckpointFileChange['status']; last: CheckpointFileChange['status']; checkpointId: string }>();
  for (const checkpoint of runs) {
    const changes = checkpoint.runChanges ?? (live?.checkpointId === checkpoint.id ? live.changes : null);
    for (const change of changes ?? []) {
      const seen = byPath.get(change.path);
      if (seen) { seen.last = change.status; seen.checkpointId = checkpoint.id; }
      else byPath.set(change.path, { first: change.status, last: change.status, checkpointId: checkpoint.id });
    }
  }
  const rows: ChangeRow[] = [];
  for (const [path, { first, last, checkpointId }] of byPath) {
    if (first === 'added' && last === 'deleted') continue;
    const status = first === 'added' ? 'added' : last === 'deleted' ? 'deleted' : first === 'deleted' && last === 'added' ? 'modified' : last;
    rows.push({ path, status, checkpointId });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

/** Images these messages made, by exactly the chat gallery's rule, in order, once each. */
export function changeImages(messages: readonly ChatMessage[], scope: RecordFileScope): TurnAsset[] {
  const out: TurnAsset[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.events?.length) continue;
    const events = dedupeToolUsesById(dropSupersededInFlightToolUses(message.events));
    const blocks = buildTurnBlocks({ events, runStatus: message.runStatus ?? 'succeeded' });
    for (const asset of collectTurnAssets(blocks, scope)) {
      if (asset.kind !== 'image' || seen.has(asset.path)) continue;
      seen.add(asset.path);
      out.push(asset);
    }
  }
  return out;
}

/** Changed paths the user has not seen in 改动 yet: the badge count. */
export function unseenCount(paths: readonly string[], seen: ReadonlySet<string>): number {
  let count = 0;
  for (const path of new Set(paths)) if (!seen.has(path)) count += 1;
  return count;
}

export function changeStatusLetter(status: CheckpointFileChange['status']): 'A' | 'M' | 'D' {
  return status === 'added' ? 'A' : status === 'deleted' ? 'D' : 'M';
}
