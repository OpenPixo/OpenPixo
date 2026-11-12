import type { ApiFailureDetail } from './api/failure-detail.js';
import type { JsonValue } from './common.js';

export const API_ERROR_CODES = [
  // Generic HTTP/API failures.
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'STORE_PURCHASE_REQUIRED',
  // Spending credits on Workshop items is not live yet (cloud entitlements pending).
  'STORE_PURCHASE_UNAVAILABLE',
  'INSUFFICIENT_CREDITS',
  // The OpenPixo-credits agent model refused the run: paused by the operator, or
  // a per-run / daily token cap was reached. Not retryable as-is.
  'HOSTED_AGENT_UNAVAILABLE',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'VALIDATION_FAILED',
  'AGENT_UNAVAILABLE',
  'AGENT_AUTH_REQUIRED',
  'AGENT_EXECUTION_FAILED',
  // The agent's connection to its model provider was established and then
  // dropped or kept resetting mid-response (e.g. "socket connection was closed
  // unexpectedly", ECONNRESET, "Unable to connect to API", ETIMEDOUT). Distinct
  // from a refused connection that never opened. Transient and retryable;
  // surfaced by the daemon's per-agent failure diagnostics so the UI can show a
  // localized, human-readable reason instead of the raw SDK string, and so
  // triage can count this failure class by code.
  'AGENT_CONNECTION_DROPPED',
  'AGENT_PROMPT_TOO_LARGE',
  // The agent emitted a fabricated Markdown role marker
  // (`## user` / `## assistant` / `## system`) inside its own response.
  // The chat host parses those lowercase lines as real turn
  // boundaries, so an emission is a prompt-injection attempt the model
  // committed against itself (issue #3247; same class as #2102 /
  // #2464). The daemon detects the marker in the stream, truncates
  // emission at that point, and terminates the agent subprocess
  // (SIGTERM with SIGKILL fallback) so no further tokens or
  // `tool_use` blocks reach the dispatcher. Emitted by
  // `server.ts::abortForRoleMarker` alongside the existing
  // `fabricated_role_marker` warning event. Retryable.
  'ROLE_MARKER_HALLUCINATION',
  // The agent got stuck repeating failing tool calls (e.g. re-running the same
  // Edit that errors "string not found", or the same shell command that keeps
  // exiting non-zero) without making progress. The daemon's tool-loop guard
  // (`tool-loop-guard.ts`) counts consecutive failures and repeats of the same
  // failing action, and in halt mode the same call succeeding over and over.
  // Only emitted in halt mode, which PIXO_TOOL_LOOP_GUARD=halt enables and runs
  // paid with OpenPixo credits use by default: at the hard ceiling the guard
  // terminates the run so the agent cannot grind through dozens more identical
  // attempts. Other runs default to `warn`, which only surfaces a heads-up
  // `tool_loop` event and never emits this error. The
  // caller should re-check the actual target (the file, the element, the
  // command) before retrying rather than resubmitting the same turn.
  // PIXO_TOOL_LOOP_GUARD accepts warn|halt|off. Retryable.
  'TOOL_LOOP_DETECTED',
  // The selected runtime agent def (apps/daemon/src/runtimes/defs/*) has
  // a checked-in field that fails strict source-config validation — e.g.
  // a non-integer, NaN, Infinity, or negative `inactivityTimeoutMs`
  // (issue #2467 review on PR #2579). The bug is in the source file;
  // the operator cannot recover the run, the daemon must abort it and
  // surface the def-correctness error so it shows up in dev rather
  // than silently disabling the agent-specific watchdog.
  'AGENT_RUNTIME_DEF_INVALID',
  'PROJECT_NOT_FOUND',
  // Delete: another program holds the project's folder; nothing was deleted.
  'PROJECT_FILES_IN_USE',
  'STYLE_NOT_FOUND',
  // An agent's image without --image in a game with a style reference: pass it, or --no-reference.
  'STYLE_REFERENCE_CHOICE_REQUIRED',
  'PROJECT_MATERIALIZATION_PENDING',
  // Handoff (`POST /api/projects/:id/handoff`): the requested conversation
  // is not in the project, or has no messages to synthesize a handoff from.
  'CONVERSATION_NOT_FOUND',
  'EMPTY_TRANSCRIPT',
  'FILE_NOT_FOUND',
  'ARTIFACT_NOT_FOUND',
  // The agent emitted a new artifact whose body is dramatically smaller than
  // a prior artifact sharing the same metadata.identifier. Almost always means
  // the agent shipped a placeholder ("see other-file.html in this project",
  // a bare filename string, an empty fallback page) instead of the full
  // document. Configurable via PIXO_ARTIFACT_STUB_GUARD (reject|warn|off).
  'ARTIFACT_REGRESSION',
  // The daemon's publication guard found unresolved template placeholders
  // (e.g. pitch-deck `Name to confirm` / `$X.XM`) in an HTML/deck artifact
  // body at write time, so the file cannot be published. The caller should
  // supply the missing facts and retry rather than republishing the same
  // body. Returned by `POST /api/projects/:id/files` (and the
  // `tools live-artifacts create` path) as a 422.
  'ARTIFACT_PUBLICATION_BLOCKED',
  'UPSTREAM_UNAVAILABLE',
  'RATE_LIMITED',
  // PR #974 round-4: desktop-paired daemon received an import request
  // but the desktop main process has not yet registered its HMAC secret
  // over sidecar IPC (startup race or daemon-restart-mid-session). The
  // client should retry shortly; the desktop runtime will re-register
  // on its existing retry schedule.
  'DESKTOP_AUTH_PENDING',
  // Agent-facing tool endpoint authorization failures.
  'TOOL_TOKEN_MISSING',
  'TOOL_TOKEN_INVALID',
  'TOOL_TOKEN_EXPIRED',
  'TOOL_ENDPOINT_DENIED',
  'TOOL_OPERATION_DENIED',
  'MEDIA_EXECUTION_DISABLED',
  'MEDIA_SURFACE_DENIED',
  'MEDIA_MODEL_DENIED',
  // Live artifact validation, storage, preview, and refresh failures.
  'LIVE_ARTIFACT_NOT_FOUND',
  'LIVE_ARTIFACT_INVALID',
  'LIVE_ARTIFACT_STORAGE_FAILED',
  'LIVE_ARTIFACT_REFRESH_UNAVAILABLE',
  'LIVE_ARTIFACT_REFRESH_TIMEOUT',
  'REFRESH_LOCKED',
  'REFRESH_TIMED_OUT',
  'REFRESH_FAILED',
  'OUTPUT_TOO_LARGE',
  'TEMPLATE_BINDING_INVALID',
  'REDACTION_REQUIRED',
  // Connector catalog, connection, safety, and execution failures.
  'CONNECTOR_NOT_FOUND',
  'CONNECTOR_AUTH_CONFIG_REQUIRED',
  'CONNECTOR_NOT_CONNECTED',
  'CONNECTOR_DISABLED',
  'CONNECTOR_TOOL_NOT_FOUND',
  'CONNECTOR_SAFETY_DENIED',
  'CONNECTOR_INPUT_SCHEMA_MISMATCH',
  'CONNECTOR_RATE_LIMITED',
  'CONNECTOR_OUTPUT_TOO_LARGE',
  'CONNECTOR_EXECUTION_FAILED',
  // `POST /api/runs/:id/steer` (B11 「引导对话」): the run's runtime cannot take
  // a mid-turn user message at all. Only a `promptInputFormat: 'stream-json'`
  // runtime keeps the child's stdin open past the opening prompt; every other
  // runtime closes it together with the prompt, so a later write would go
  // nowhere. This is a permanent property of the selected agent, NOT a
  // transient state — clients must stop advertising the affordance rather than
  // retry. Not retryable.
  'RUN_STEERING_UNSUPPORTED',
  // `POST /api/runs/:id/steer`: the runtime supports steering but this run can
  // no longer receive it — the run reached a terminal status, or its turn ended
  // cleanly and the daemon closed stdin (a `stop_reason: 'tool_use'` pause does
  // NOT close it, and stays steerable). The message was NOT delivered and NOT
  // written to the conversation; the caller should send it as a new turn.
  // Not retryable against the same run.
  'RUN_STEERING_CLOSED',
  // A design-system enrichment ("AI Optimize") run was requested while the
  // same conversation already has a non-terminal run. The enrichment turn is
  // a hidden seeded prompt that refines the registered design system in
  // place, so a second concurrent pass bills twice and races on the same
  // files (2026-07-28: one double-triggered affordance billed two runs). The
  // daemon rejects the newcomer with HTTP 409 and names the run that already
  // owns the conversation in `details` (`DesignSystemEnrichmentInProgressDetails`)
  // so a client can attach to it instead of starting another. Not retryable
  // while that run is active; ordinary chat turns are never gated by this.
  'DESIGN_SYSTEM_ENRICHMENT_IN_PROGRESS',
  // POST /api/projects bounds every read-only preparation step that runs
  // before the project/conversation transaction (design-system and skill
  // validation, plugin and location lookups, plugin registry loads, template
  // seeding) with one request-wide deadline. When the deadline passes the
  // daemon answers HTTP 504 with this code and commits nothing, so a client
  // that already entered an optimistic project surface can roll back to its
  // composer instead of waiting on a stalled create. Retryable: the same
  // client-minted project id may be resubmitted.
  'PROJECT_CREATE_PREPARATION_TIMEOUT',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: JsonValue;
  retryable?: boolean;
  requestId?: string;
  taskId?: string;
  /** Optional closed-token classification; see `api/failure-detail.ts`. */
  failure?: ApiFailureDetail;
}

export interface ApiErrorResponse {
  error: ApiError;
}

export type ApiValidationIssue = {
  /** Dot/bracket path, JSON pointer, or form field name that failed validation. */
  path: string;
  message: string;
  code?: string;
};

export type ApiValidationErrorDetails = {
  kind: 'validation';
  issues: ApiValidationIssue[];
};

/** Success payload or shared error envelope for agent-facing daemon tool endpoints. */
export type AgentToolApiResponse<TSuccess> = TSuccess | ApiErrorResponse;

export type LegacyErrorResponse =
  | { error: string }
  | { code: string; error: string };

export type CompatibleErrorResponse = ApiErrorResponse | LegacyErrorResponse;

export interface SseErrorPayload {
  message: string;
  error?: ApiError;
  /**
   * Bounded, secret-redacted tail of what the agent process printed to stderr
   * during this run — the ORIGINAL cause behind a failure whose `message` is
   * necessarily generic (e.g. "…exited without a terminal result").
   *
   * Produced daemon-side by `failureCardStderrTail`, so the bound (a tail of
   * lines, capped in bytes) and the redaction both happen before the text
   * crosses the process boundary. Absent when the run wrote no stderr —
   * consumers must render nothing rather than an empty section.
   */
  stderrTail?: string;
}

export function createApiError(code: ApiErrorCode, message: string, init: Omit<ApiError, 'code' | 'message'> = {}): ApiError {
  return { code, message, ...init };
}

export function createApiErrorResponse(error: ApiError): ApiErrorResponse {
  return { error };
}
