const DEFAULT_CHAT_RUN_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_CHAT_RUN_FIRST_OUTPUT_TIMEOUT_MS = 0;
const MAX_CHAT_RUN_INACTIVITY_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHAT_RUN_ARTIFACT_QUIET_PERIOD_MS = 60 * 1000;

export function resolveChatRunInactivityTimeoutMs() {
  const env = Number(process.env.PIXO_CHAT_RUN_INACTIVITY_TIMEOUT_MS);
  if (Number.isFinite(env)) {
    return Math.min(MAX_CHAT_RUN_INACTIVITY_TIMEOUT_MS, Math.max(0, Math.floor(env)));
  }
  return DEFAULT_CHAT_RUN_INACTIVITY_TIMEOUT_MS;
}

export function resolveChatRunFirstOutputTimeoutMs(): number {
  const env = Number(process.env.PIXO_CHAT_RUN_FIRST_OUTPUT_TIMEOUT_MS);
  if (Number.isFinite(env)) {
    return Math.min(MAX_CHAT_RUN_INACTIVITY_TIMEOUT_MS, Math.max(0, Math.floor(env)));
  }
  return DEFAULT_CHAT_RUN_FIRST_OUTPUT_TIMEOUT_MS;
}

export function resolveChatRunArtifactQuietPeriodMs() {
  const raw = Number(process.env.PIXO_CHAT_RUN_ARTIFACT_QUIET_PERIOD_MS);
  if (!Number.isFinite(raw)) return DEFAULT_CHAT_RUN_ARTIFACT_QUIET_PERIOD_MS;
  return Math.min(MAX_CHAT_RUN_INACTIVITY_TIMEOUT_MS, Math.max(0, Math.floor(raw)));
}

export function resolveActiveInactivityTimeoutMs(params: {
  inactivityTimeoutMs: number;
  artifactQuietPeriodMs: number;
  artifactRegistered: boolean;
}): number {
  if (params.artifactRegistered && params.artifactQuietPeriodMs > 0) {
    return params.artifactQuietPeriodMs;
  }
  return params.inactivityTimeoutMs;
}

export function classifyChatRunCloseStatus(params: {
  cancelRequested: boolean;
  code: number | null;
  signal: NodeJS.Signals | string | null;
  protocolCleanCompletion: boolean;
  /** The daemon began terminating this protocol attempt after its prompt completed. */
  protocolCompletionShutdownRequested?: boolean;
  artifactQuietShutdownRequested: boolean;
  turnCompletedCleanly: boolean;
  artifactProducedThisRun: boolean;
}): 'canceled' | 'succeeded' | 'failed' {
  if (params.cancelRequested) return 'canceled';
  if (params.code === 0) return 'succeeded';
  const protocolForcedShutdown =
    params.protocolCleanCompletion &&
    (
      (params.code === null && params.signal === 'SIGTERM') ||
      (params.code === 130 && params.signal === null)
    );
  if (protocolForcedShutdown) return 'succeeded';
  // Once the daemon itself is shutting down a completed attempt, the exit
  // status reflects that shutdown, not the turn: Windows reports a child
  // killed by pid as code 1 with no signal.
  if (params.protocolCleanCompletion && params.protocolCompletionShutdownRequested) return 'succeeded';
  const artifactQuietShutdown =
    params.artifactQuietShutdownRequested &&
    params.code === null &&
    (params.signal === 'SIGTERM' || params.signal === 'SIGKILL');
  if (artifactQuietShutdown) return 'succeeded';
  if (params.code != null && params.code !== 0 && params.artifactProducedThisRun) {
    return 'succeeded';
  }
  if (params.turnCompletedCleanly) return 'succeeded';
  return 'failed';
}

type ClaudeStreamJsonBookkeepingRun = {
  stdinOpen?: boolean;
  turnCompletedCleanly?: boolean;
  child?: {
    stdin?: {
      destroyed?: boolean;
      end: () => void;
    } | null;
  } | null;
};

export function applyClaudeStreamJsonRunBookkeeping(
  run: ClaudeStreamJsonBookkeepingRun,
  ev: unknown,
) {
  if (!ev || typeof ev !== 'object') return;
  const event = ev as {
    type?: unknown;
    name?: unknown;
    id?: unknown;
    stopReason?: unknown;
    isError?: unknown;
  };

  const terminalTurn =
    (event.type === 'turn_end' && event.stopReason !== 'tool_use') ||
    (event.type === 'usage' && event.stopReason !== 'tool_use');
  if (!terminalTurn) return;

  // An error termination (is_error result frame) ends the turn — stdin must
  // still close — but it is NOT a clean completion: marking it clean lets
  // classifyChatRunCloseStatus translate the CLI's non-zero exit into
  // 'succeeded' and the failure never reaches the user. A SessionEnd-hook
  // non-zero exit after a normal result (#3373) carries no isError flag and
  // keeps taking the clean path.
  const errorTermination = event.type === 'usage' && event.isError === true;
  if (!errorTermination) {
    run.turnCompletedCleanly = true;
  }
  if (run.stdinOpen) {
    if (run.child?.stdin && !run.child.stdin.destroyed) {
      try { run.child.stdin.end(); } catch {}
    }
    run.stdinOpen = false;
  }
}

/**
 * Whether an emission from a runtime adapter counts as *agent progress* for the
 * inactivity clock (`run.lastAgentActivityAt`, exported to analytics as
 * `last_progress_age_ms`).
 *
 * Only bytes the agent produced count. Everything the daemon manufactures while
 * closing out a turn is excluded, because stamping the progress clock from our
 * own bookkeeping means the last recorded "progress" is the very act of giving
 * up — so `last_progress_age_ms` reads near zero on exactly the stalled runs
 * whose contract says it must read "near the inactivity ceiling" (see
 * TrackingRunFinished in packages/contracts). That is what made the 2026-07-28
 * AMR design-system stall (run 14b04dd3, ~30 minutes of silence, reported age
 * 664ms) look like a run that was still working when it was killed.
 *
 * Two kinds of emission are ours, not the agent's:
 *
 * 1. A terminal `error` — the daemon reporting its own verdict.
 * 2. Any emission flagged `hostSynthesized`, which records host bookkeeping
 *    rather than new child output.
 *
 * Agent-originated errors are not lost by this: they arrive on the child's
 * stdout/stderr, and those raw-chunk handlers stamp the clock already.
 *
 * This predicate only covers emissions that reach the daemon BEFORE the verdict
 * — `fail()` flushes open tools and only then sends the error. Everything that
 * arrives after it (the child's shutdown line on stderr, diagnostics promoted
 * from it) is handled by the attempt-scoped freeze in `startChatRun`; see
 * `freezeProgressClock`. The two together are one rule: the progress clock runs
 * from the agent's bytes and stops when the daemon gives up.
 */
export function runtimeEmissionCountsAsAgentProgress(
  channel: string,
  meta?: { hostSynthesized?: boolean },
): boolean {
  if (channel === 'error') return false;
  if (meta?.hostSynthesized === true) return false;
  return true;
}

export function resolveChatRunShutdownGraceMs() {
  const raw = Number(process.env.PIXO_CHAT_RUN_SHUTDOWN_GRACE_MS);
  if (!Number.isFinite(raw)) return 3_000;
  return Math.max(0, Math.floor(raw));
}

/**
 * Whether a runtime reads its whole prompt from stdin (and then waits for
 * EOF). Those runtimes get the plain-text prompt as a complete file-backed
 * stdin at spawn; see
 * `openCompletePromptAsStdin` in `agent-process.ts` and
 * the shared child-spawn implementation.
 *
 * Excluded are the runtimes whose stdin carries a framed protocol instead:
 * Claude's `stream-json` input (stdin stays open for mid-turn messages),
 * Codex app-server JSON-RPC (which sets
 * `promptViaStdin: false`). A frame cut short by a dying daemon does not parse,
 * so they cannot act on a partial prompt the way a plain-text reader does.
 */
export function runtimeReadsPlainTextPromptFromStdin(def: {
  promptViaStdin?: boolean;
  promptInputFormat?: string;
}): boolean {
  return (
    def.promptViaStdin === true
    && (def.promptInputFormat ?? 'text') !== 'stream-json'
  );
}

/**
 * Stdin telemetry for a prompt handed over as the child's file-backed stdin
 * at spawn.
 *
 * The prompt was complete on disk before the child existed, so the daemon's
 * side of the write is finished the moment the child is spawned: it cannot be
 * backpressured (`stdin_backpressure` is false by construction — a child that
 * never reads its stdin now stalls in its own first-token wait, not in a daemon
 * write), and `stdin_write_start`/`stdin_write_end` land together, in their
 * historical position after spawn, so phase math keeps its shape.
 */
export function recordPromptDeliveredAtSpawn(
  run: { stdinBackpressure?: boolean },
  lifecycle: { mark: (mark: 'model_call_start' | 'stdin_write_start' | 'stdin_write_end') => void },
): void {
  lifecycle.mark('model_call_start');
  lifecycle.mark('stdin_write_start');
  lifecycle.mark('stdin_write_end');
  run.stdinBackpressure = false;
}
