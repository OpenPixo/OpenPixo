import { isRetiredOpenPixoAgentModel } from '@openpixo/contracts';
import type {
  OpenPixoAgentInputModality, OpenPixoAgentLimits, OpenPixoAgentModel, OpenPixoAgentModelsResponse, OpenPixoAgentReasoningEffort,
  OpenPixoAgentRequestUsage, OpenPixoAgentRunUsage,
} from '@openpixo/contracts';
import { AccountError, cloudServiceError } from './errors.js';
import { record } from './supabase.js';

export const OPENPIXO_AGENT_MODEL_ID = /^openpixo-agent(?:-[a-z0-9]+)*$/u;
/** Longer than the hour the cloud allows one reply, so the cloud ends it and settles what was written. */
export const AGENT_RESPONSE_TIMEOUT_MS = 61 * 60 * 1000;
/** The daemon run id doubles as the cloud's run key. */
export const AGENT_RUN_KEY = /^[A-Za-z0-9._:-]{8,128}$/u;

function invalid(): never { throw cloudServiceError(); }
function text(value: unknown, max = 200): string {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : invalid();
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}
function rate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1_000_000 ? value : invalid();
}

const EFFORTS: ReadonlySet<string> = new Set<OpenPixoAgentReasoningEffort>(['low', 'medium', 'high']);
const isEffort = (value: unknown): value is OpenPixoAgentReasoningEffort => typeof value === 'string' && EFFORTS.has(value);

/** Text always; image only when the cloud says so. A cloud that predates the field means text only. */
function inputModalities(value: unknown): OpenPixoAgentInputModality[] {
  return Array.isArray(value) && value.includes('image') ? ['text', 'image'] : ['text'];
}

// Cloud responses are re-built field by field; nothing unexpected reaches UI or CLI.
export function agentModels(value: unknown): OpenPixoAgentModelsResponse {
  const item = record(value);
  if (!Array.isArray(item.models) || item.models.length > 20 || typeof item.agentPaused !== 'boolean') invalid();
  // A retired model stays out of every picker and CLI listing while the cloud still lists it.
  const models = item.models.map((entry): OpenPixoAgentModel => {
    const row = record(entry);
    const prices = record(row.creditsPerMillionTokens);
    const id = text(row.id, 64);
    if (!OPENPIXO_AGENT_MODEL_ID.test(id)) invalid();
    const efforts = Array.isArray(row.reasoningEfforts) ? row.reasoningEfforts.filter(isEffort) : [];
    return {
      id, label: text(row.label, 120), priceVersion: count(row.priceVersion),
      creditsPerMillionTokens: { inputCacheMiss: rate(prices.inputCacheMiss), inputCacheHit: rate(prices.inputCacheHit),
        ...(prices.inputCacheWrite === undefined ? {} : { inputCacheWrite: rate(prices.inputCacheWrite) }), output: rate(prices.output) },
      contextTokens: count(row.contextTokens), maxOutputTokens: count(row.maxOutputTokens),
      reasoningEfforts: efforts, defaultReasoningEffort: isEffort(row.defaultReasoningEffort) ? row.defaultReasoningEffort : null,
      inputModalities: inputModalities(row.inputModalities),
    };
  }).filter((model) => !isRetiredOpenPixoAgentModel(model.id));
  const limits = record(item.limits);
  const parsedLimits: OpenPixoAgentLimits = {
    maxConcurrent: count(limits.maxConcurrent), requestsPerMinute: count(limits.requestsPerMinute),
    maxRequestBytes: count(limits.maxRequestBytes),
  };
  return { models, limits: parsedLimits, agentPaused: item.agentPaused };
}

export function agentRequestUsage(value: unknown): OpenPixoAgentRequestUsage {
  const item = record(value);
  if (typeof item.estimated !== 'boolean') invalid();
  return {
    requestId: text(item.requestId, 64), model: text(item.model, 64), estimated: item.estimated,
    inputTokens: count(item.inputTokens), cachedInputTokens: count(item.cachedInputTokens),
    // Absent from a cloud that predates cache writes, which is also what it billed.
    cacheWriteTokens: item.cacheWriteTokens === undefined ? 0 : count(item.cacheWriteTokens), outputTokens: count(item.outputTokens),
    reasoningTokens: count(item.reasoningTokens), costMicrocredits: count(item.costMicrocredits), creditsCharged: count(item.creditsCharged),
  };
}

export function agentRunUsage(value: unknown): OpenPixoAgentRunUsage {
  const item = record(value);
  const runKey = text(item.runKey, 128);
  if (!AGENT_RUN_KEY.test(runKey)) invalid();
  return {
    runKey, requests: count(item.requests), openRequests: count(item.openRequests), inputTokens: count(item.inputTokens),
    cachedInputTokens: count(item.cachedInputTokens), outputTokens: count(item.outputTokens),
    costMicrocredits: count(item.costMicrocredits), creditsCharged: count(item.creditsCharged),
  };
}

export function assertAgentRunKey(value: unknown): string {
  if (typeof value !== 'string' || !AGENT_RUN_KEY.test(value)) throw new AccountError('AGENT_REQUEST_INVALID');
  return value;
}
