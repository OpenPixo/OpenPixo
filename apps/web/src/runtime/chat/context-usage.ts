import { contextUsageParts, type ContextUsageParts, type PersistedAgentEvent } from '@openpixo/contracts';

/** How full the conversation's context is, as the runtime last reported it. */
export interface ContextUsageView {
  usedTokens: number;
  limitTokens: number;
  percent: number;
  autoCompactAtTokens: number | null;
  autoCompactPercent: number | null;
  /** How much further the context can grow before the runtime compacts; null when it did not say where. */
  untilCompactTokens: number | null;
  /** What the latest model call was made of, as far as the runtime said. */
  parts: ContextUsageParts;
  /** Times the runtime compacted this conversation so far. */
  compactions: number;
}

interface MessageLike {
  role: string;
  agentId?: string | null;
  events?: readonly PersistedAgentEvent[];
}

const percentOf = (part: number, whole: number) => Math.min(100, Math.round((part / whole) * 100));

/**
 * The reading for the composer, from the newest report backwards. A runtime may state its
 * limit less often than its usage (Claude Code only at the end of a turn), so the limit can
 * come from an earlier report by the same agent. Null means there is nothing true to show:
 * no report, no limit, another agent's numbers, or a compaction with no reading since.
 */
export function latestContextUsage(messages: readonly MessageLike[], agentId: string | null | undefined): ContextUsageView | null {
  let used: number | null = null;
  for (let m = messages.length - 1; m >= 0; m -= 1) {
    const message = messages[m]!;
    if (message.role !== 'assistant') continue;
    const events = message.events ?? [];
    if (agentId && message.agentId && message.agentId !== agentId && events.some((event) => event.kind === 'context_usage')) return null;
    for (let e = events.length - 1; e >= 0; e -= 1) {
      const event = events[e]!;
      if (event.kind === 'context_compacted' && used === null) return null;
      if (event.kind !== 'context_usage') continue;
      used ??= event.usedTokens;
      if (event.limitTokens) {
        const at = event.autoCompactAtTokens ?? null;
        return { usedTokens: used, limitTokens: event.limitTokens, percent: percentOf(used, event.limitTokens),
          autoCompactAtTokens: at, autoCompactPercent: at ? percentOf(at, event.limitTokens) : null,
          untilCompactTokens: at ? Math.max(0, at - used) : null, parts: latestParts(messages), compactions: countCompactions(messages) };
      }
    }
  }
  return null;
}

/** Claude Code's end-of-turn report repeats only the total, so the newest report that says more wins. */
function latestParts(messages: readonly MessageLike[]): ContextUsageParts {
  for (let m = messages.length - 1; m >= 0; m -= 1) {
    const events = messages[m]!.events ?? [];
    for (let e = events.length - 1; e >= 0; e -= 1) {
      const event = events[e]!;
      if (event.kind !== 'context_usage') continue;
      const parts = contextUsageParts(event as unknown as Record<string, unknown>);
      if (Object.keys(parts).length > 0) return parts;
    }
  }
  return {};
}

function countCompactions(messages: readonly MessageLike[]): number {
  return messages.reduce((total, message) =>
    total + (message.events ?? []).filter((event) => event.kind === 'context_compacted').length, 0);
}

/** `43k`, `183.6k`, `1.05M`: short enough for the composer row. */
export function formatContextTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(2))}M`;
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1))}k`;
  return String(tokens);
}
