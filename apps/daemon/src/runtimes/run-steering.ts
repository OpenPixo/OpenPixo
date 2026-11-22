/**
 * B11 「引导对话」 — steer a turn that is still running.
 *
 * Steering is NOT "cancel and resend". It hands one more user message to the
 * turn while it is still executing, so the model reads the new instruction
 * without losing the work it has already done.
 *
 * That only means anything when three things hold at once, and each of them
 * fails silently if we guess:
 *
 *  1. The runtime has a way to put a message into a running turn AND acts on
 *     it in that turn. Today that is Codex over `codex app-server`, through
 *     its `turn/steer` request (present and dispatched in codex-cli 0.160.0;
 *     an older build that lacks it answers with an unknown-method error, which
 *     the session reports as `unsupported`).
 *
 *     Claude Code is deliberately NOT on this list even though its stdin stays
 *     open (`promptInputFormat: 'stream-json'`): measured on the installed
 *     claude 2.1.259, a `user` frame written mid-turn was never acted on (the
 *     process sat for 180 s), and only a frame written after the turn's
 *     `result` started a second turn — by which time the daemon has closed
 *     stdin. Writing there would record a message in the transcript that the
 *     model never read. OpenCode reads its whole prompt at spawn.
 *
 *     This is a permanent property of the agent, so callers stop advertising
 *     the affordance (the web shows 「停止并发送」 instead) rather than retry.
 *  2. The run is still live.
 *  3. The turn is still open to input. For Codex that is the app-server
 *     session's own answer (`acceptsSteering`): codex named the turn and has
 *     not completed, cancelled or failed it.
 *
 * `classifyRunSteering` is the single place that verdict is made; the HTTP
 * route, the CLI, the agent listing (`AgentInfo.midTurnSteering`) and any
 * future caller must go through this module instead of re-deriving the rule.
 */

import { CODEX_APP_SERVER_STREAM_FORMAT, resolveCodexTransport, withCodexTransport } from './defs/codex.js';
import type { RuntimeAgentDef } from './types.js';

export type RunSteeringRefusal =
  | 'runtime_unsupported'
  | 'run_terminal'
  | 'stdin_closed';

export type RunSteeringVerdict =
  | { ok: true }
  | { ok: false; refusal: RunSteeringRefusal };

/**
 * Minimal shape of a runtime def this module needs — keeps it unit-testable.
 * The index signature is deliberate: callers hand us whole `RuntimeAgentDef`
 * objects (closures and all), and a bare optional-only type would trip
 * TypeScript's weak-type check on every one of them.
 */
type StreamFormatBearer = {
  streamFormat?: string;
  [key: string]: unknown;
};

/**
 * Whether this runtime can take a user message into a running turn and act on
 * it there. Pass the def the run actually uses (after
 * `applyCodexTransportOverride`): Codex steers only over app-server.
 */
export function runtimeAcceptsMidTurnInput(
  def: StreamFormatBearer | null | undefined,
): boolean {
  return def?.streamFormat === CODEX_APP_SERVER_STREAM_FORMAT;
}

/**
 * What the agent listing advertises as `AgentInfo.midTurnSteering`, so the web
 * picks the queue row's face from the daemon's answer. Codex's transport is
 * resolved the way a run resolves it (operator switch, then the detected
 * version), without probing the CLI again.
 */
export function agentAdvertisesMidTurnSteering(
  def: RuntimeAgentDef,
  detectedVersion: string | null | undefined,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const effective = def.id === 'codex'
    ? withCodexTransport(def, resolveCodexTransport({ env, version: detectedVersion ?? null }))
    : def;
  return runtimeAcceptsMidTurnInput(effective);
}

export function classifyRunSteering(input: {
  runtimeAccepts: boolean;
  terminal: boolean;
  /** The turn is running and still open to another message. */
  inputOpen: boolean;
}): RunSteeringVerdict {
  // Runtime capability is checked first on purpose: it is permanent, so the
  // caller can disable the affordance instead of showing a "try again" hint.
  if (!input.runtimeAccepts) return { ok: false, refusal: 'runtime_unsupported' };
  if (input.terminal) return { ok: false, refusal: 'run_terminal' };
  if (!input.inputOpen) return { ok: false, refusal: 'stdin_closed' };
  return { ok: true };
}

/** What a runtime answered when asked to take the message. */
export type SteeringDelivery = 'delivered' | 'unsupported' | 'closed';

/**
 * The running turn's input, attached to a run by the spawn branch that owns
 * it (today the Codex app-server session). Absent means nothing can take the
 * message right now.
 */
export interface RunSteeringTarget {
  acceptsInput(): boolean;
  deliver(text: string): Promise<SteeringDelivery>;
}

/**
 * The exact JSONL frame `claude --input-format stream-json` expects for a user
 * message. The opening prompt in `server.ts` writes its frame through this
 * encoder, so the frame shape lives in one place.
 */
export function encodeStreamJsonUserMessage(text: string): string {
  return `${JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  })}\n`;
}
