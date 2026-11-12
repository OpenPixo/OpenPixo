/** Mirrored by openpixo-cloud supabase/functions/_shared/agent-contract.ts. Keep DTOs synchronized. */
/**
 * Hosted agent model paid with OpenPixo credits.
 *
 * The in-app agent (bundled OpenCode) talks to a daemon-local OpenAI-compatible
 * endpoint; the daemon forwards each chat-completions request to the cloud
 * `agent-chat` function with the signed-in user's session. The cloud reserves
 * credits per request, meters the vendor's reported token usage, settles it and
 * releases the rest. Token costs are fractions of a credit, so they are reported
 * in microcredits (1 credit = 1,000,000 microcredits = US$0.01) and the unbilled
 * remainder carries over to the next request.
 */

/** Agent id of the bundled-OpenCode runtime that uses the hosted model. */
export const OPENPIXO_AGENT_ID = 'openpixo-agent';
export const MICROCREDITS_PER_CREDIT = 1_000_000;

export type OpenPixoAgentReasoningEffort = 'low' | 'medium' | 'high';

/** What a hosted model reads. Every model reads text; `image` means the agent may send it pictures. */
export type OpenPixoAgentInputModality = 'text' | 'image';

export interface OpenPixoAgentModel {
  /** OpenPixo model id, e.g. `openpixo-agent-flash`; never the vendor's id. */
  id: string;
  /** The model's real name. Who serves it is never exposed to a client. */
  label: string;
  priceVersion: number;
  /** Credits per million tokens, which equals microcredits per token. inputCacheWrite only where it is billed separately. */
  creditsPerMillionTokens: { inputCacheMiss: number; inputCacheHit: number; inputCacheWrite?: number; output: number };
  contextTokens: number;
  maxOutputTokens: number;
  /** Efforts this model really supports; empty when it has no such control. */
  reasoningEfforts: OpenPixoAgentReasoningEffort[];
  defaultReasoningEffort: OpenPixoAgentReasoningEffort | null;
  /** What the model reads. A cloud that predates this field sends none, which means text only. */
  inputModalities?: OpenPixoAgentInputModality[];
}

export interface OpenPixoAgentLimits {
  maxConcurrent: number;
  requestsPerMinute: number;
  maxRequestBytes: number;
}

export interface OpenPixoAgentModelsResponse {
  models: OpenPixoAgentModel[];
  limits: OpenPixoAgentLimits;
  /** True while the operator has paused the hosted agent. */
  agentPaused: boolean;
}

/** One metered request, as the cloud settled it. */
export interface OpenPixoAgentRequestUsage {
  requestId: string;
  model: string;
  /** True when the vendor reported no usage (cancelled stream) and tokens were estimated. */
  estimated: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costMicrocredits: number;
  /** Whole credits settled from the reservation; the remainder is carried. */
  creditsCharged: number;
}

/** Totals for one agent run; `runKey` is the daemon's run id. */
export interface OpenPixoAgentRunUsage {
  runKey: string;
  requests: number;
  openRequests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costMicrocredits: number;
  creditsCharged: number;
}

// --- Daemon-local API (UI and `pixo agent` CLI) -------------------------------

/** `GET /api/openpixo/agent/models`: the cloud catalogue plus local sign-in state. */
export interface OpenPixoAgentCatalogResponse extends OpenPixoAgentModelsResponse {
  signedIn: boolean;
}

/**
 * `GET /api/openpixo/agent/runs/:runId/usage`. `local` is what this daemon relayed
 * for the run (available while the daemon is up); `cloud` is the cloud's settled
 * total for the same run, null when the cloud could not be asked.
 */
export interface OpenPixoAgentRunUsageResponse {
  runId: string;
  local: OpenPixoAgentRunUsage;
  cloud: OpenPixoAgentRunUsage | null;
}

/** Run SSE `agent` event emitted after each metered request, carrying running totals. */
export interface OpenPixoAgentUsageEvent {
  type: 'hosted_usage';
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costMicrocredits: number;
  creditsCharged: number;
}

/** Credits with two decimals, from microcredits. */
export function formatAgentCredits(microcredits: number): string {
  return (Math.max(0, microcredits) / MICROCREDITS_PER_CREDIT).toFixed(2);
}
