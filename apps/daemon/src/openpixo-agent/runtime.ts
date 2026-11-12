import {
  isRetiredOpenPixoAgentModel, OPENPIXO_AGENT_DEFAULT_MODEL, OPENPIXO_AGENT_ID, type OpenPixoAgentModel, type OpenPixoAgentPrices,
  type OpenPixoAgentReasoningEffort,
} from '@openpixo/contracts';
import { AGENT_RESPONSE_TIMEOUT_MS, OPENPIXO_AGENT_MODEL_ID } from '../account/agent-gateway.js';
import type { RuntimeModelOption } from '../runtimes/types.js';
import { OPENPIXO_AGENT_PROXY_BASE, OPENPIXO_AGENT_TOKEN_ENV } from './gateway.js';

export { OPENPIXO_AGENT_ID };
export const OPENPIXO_AGENT_OPENCODE_PROVIDER_ID = 'openpixo';
export const DEFAULT_OPENPIXO_AGENT_MODEL = OPENPIXO_AGENT_DEFAULT_MODEL;
/**
 * For a model the cloud has not described yet, and for a cloud that predates per-model
 * windows. Advertised to OpenCode so it compacts before the cloud's context guard refuses.
 */
const FALLBACK_CONTEXT_TOKEN_LIMIT = 200_000;
/** Must not exceed the gateway's own cap, which is the one that counts. */
const FALLBACK_OUTPUT_TOKEN_LIMIT = 32_000;
/** OpenCode 1.18 reserves at most this much of the window for the reply. */
const OPENCODE_MAX_RESERVED_OUTPUT = 32_000;
const CATALOG_TIMEOUT_MS = 5_000;

const EFFORT_LABELS: Record<OpenPixoAgentReasoningEffort, string> = { low: 'Low', medium: 'Medium', high: 'High' };

function effortOptions(efforts: readonly OpenPixoAgentReasoningEffort[], fallback: OpenPixoAgentReasoningEffort | null): RuntimeModelOption[] {
  return efforts.map(id => ({ id, label: EFFORT_LABELS[id], ...(id === fallback ? { default: true } : {}) }));
}

/**
 * The default model is marked so that web, CLI and a run without a model all pick it,
 * whatever order the cloud lists its models in.
 */
function pickerModel(id: string, label: string, efforts: readonly OpenPixoAgentReasoningEffort[], fallback: OpenPixoAgentReasoningEffort | null,
  prices?: OpenPixoAgentPrices): RuntimeModelOption {
  return { id, label, ...(id === DEFAULT_OPENPIXO_AGENT_MODEL ? { default: true } : {}),
    reasoningOptions: effortOptions(efforts, fallback), ...(prices ? { creditsPerMillionTokens: { ...prices } } : {}) };
}

/** For when the cloud cannot be asked. The cloud refuses what it no longer offers. */
export const OPENPIXO_AGENT_FALLBACK_MODELS: RuntimeModelOption[] = [
  pickerModel(DEFAULT_OPENPIXO_AGENT_MODEL, 'DeepSeek V4.1 Flash', ['low', 'high'], 'high'),
];

/** Set once at startup; detection cannot import the account service without a cycle. */
let readCatalog: (() => Promise<{ models: OpenPixoAgentModel[] }>) | null = null;
/** The window of each model the cloud last described; the cloud sets it per model. */
const modelWindows = new Map<string, { context: number; output: number }>();
/** The models the cloud last said read pictures. A model it has not described reads text only. */
const modelsReadingImages = new Set<string>();
export function setOpenPixoAgentCatalogReader(reader: () => Promise<{ models: OpenPixoAgentModel[] }>): void {
  readCatalog = reader;
}

/** The cloud's catalogue as picker options; null falls back to the static list. */
export async function fetchOpenPixoAgentModels(): Promise<RuntimeModelOption[] | null> {
  if (!readCatalog) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const catalog = await Promise.race([readCatalog(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('catalogue timeout')), CATALOG_TIMEOUT_MS);
    })]);
    for (const model of catalog.models) {
      modelWindows.set(model.id, { context: model.contextTokens, output: model.maxOutputTokens });
      if (model.inputModalities?.includes('image')) modelsReadingImages.add(model.id);
      else modelsReadingImages.delete(model.id);
    }
    return catalog.models.map(model => pickerModel(model.id, model.label, model.reasoningEfforts, model.defaultReasoningEffort,
      model.creditsPerMillionTokens));
  } catch { return null; }
  finally { clearTimeout(timer); }
}

/**
 * A picker value of `default`, empty, a retired model or anything not an OpenPixo agent
 * model selects the default, so a choice saved before a model was retired still runs.
 */
export function openpixoAgentModel(model: string | null | undefined): string {
  const trimmed = typeof model === 'string' ? model.trim().replace(/^openpixo\//u, '') : '';
  return OPENPIXO_AGENT_MODEL_ID.test(trimmed) && !isRetiredOpenPixoAgentModel(trimmed) ? trimmed : DEFAULT_OPENPIXO_AGENT_MODEL;
}

export function openpixoAgentModelArg(model: string | null | undefined): string {
  return `${OPENPIXO_AGENT_OPENCODE_PROVIDER_ID}/${openpixoAgentModel(model)}`;
}

/** The user's effort for this run. Whether the model has that level is the cloud's call. */
export function openpixoAgentEffort(reasoning: unknown): OpenPixoAgentReasoningEffort | null {
  return reasoning === 'low' || reasoning === 'medium' || reasoning === 'high' ? reasoning : null;
}

function modelWindow(model: string | null | undefined): { context: number; output: number } {
  return modelWindows.get(openpixoAgentModel(model)) ?? { context: FALLBACK_CONTEXT_TOKEN_LIMIT, output: FALLBACK_OUTPUT_TOKEN_LIMIT };
}

/** The limits this run's OpenCode was given, which is what it compacts against. */
export function openpixoAgentContextLimits(model: string | null | undefined): { limitTokens: number; autoCompactAtTokens: number } {
  const { context, output } = modelWindow(model);
  return { limitTokens: context, autoCompactAtTokens: context - Math.min(output, OPENCODE_MAX_RESERVED_OUTPUT) };
}

/**
 * Run-scoped OpenCode provider pointing at the daemon's local gateway. The token is
 * only referenced (`{env:…}`); its value travels in the child's environment.
 */
export function buildOpenPixoAgentOpenCodeConfig(daemonUrl: string, model: string | null | undefined): Record<string, unknown> {
  const id = openpixoAgentModel(model);
  const window = modelWindow(id);
  return {
    // OpenCode names each session with an extra call on the chosen model. OpenPixo never shows
    // that name, and on a dear model it cost about a quarter of a short turn (measured on Sol).
    agent: { title: { disable: true } },
    provider: {
      [OPENPIXO_AGENT_OPENCODE_PROVIDER_ID]: {
        name: 'OpenPixo',
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: `${daemonUrl.replace(/\/+$/u, '')}${OPENPIXO_AGENT_PROXY_BASE}`,
          apiKey: `{env:${OPENPIXO_AGENT_TOKEN_ENV}}`,
          includeUsage: true,
          // A reply may run for an hour. The gateway enforces that and ends a reply that goes quiet.
          timeout: AGENT_RESPONSE_TIMEOUT_MS,
        },
        models: {
          [id]: {
            name: id,
            tool_call: true,
            reasoning: true,
            // Earlier turns' thinking goes back on tool turns. The cloud gives every model
            // this one field name and translates it for whichever vendor serves the model.
            interleaved: { field: 'reasoning_content' },
            // OpenCode believes this. Declared text only, it drops every picture the agent reads and
            // tells the model it cannot read images, so the agent could not look at its own game.
            modalities: { input: modelsReadingImages.has(id) ? ['text', 'image'] : ['text'], output: ['text'] },
            limit: window,
          },
        },
      },
    },
  };
}
