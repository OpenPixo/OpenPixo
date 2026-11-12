import { openpixoAgentContextLimits, OPENPIXO_AGENT_ID } from '../openpixo-agent/runtime.js';
import { BYOK_OPENCODE_AGENT_ID, DEFAULT_CONTEXT_TOKEN_LIMIT, DEFAULT_OUTPUT_TOKEN_LIMIT } from './byok-opencode.js';
import { findKnownModel } from './models.js';
import type { RuntimeAgentDef } from './types.js';

export interface RunContextLimits { limitTokens: number; autoCompactAtTokens?: number }

/**
 * The limits a run's OpenCode compacts against, where they are known before it starts:
 * the two configs the daemon writes itself, and what `opencode models` said about a model
 * the user picked. Claude Code and Codex report their own limit in the stream. Null means
 * the UI shows nothing rather than a guess.
 */
export function contextLimitsForRun(def: RuntimeAgentDef, model: string | null | undefined): RunContextLimits | null {
  if (def.id === OPENPIXO_AGENT_ID) return openpixoAgentContextLimits(model);
  if (def.id === BYOK_OPENCODE_AGENT_ID) {
    return { limitTokens: DEFAULT_CONTEXT_TOKEN_LIMIT, autoCompactAtTokens: DEFAULT_CONTEXT_TOKEN_LIMIT - DEFAULT_OUTPUT_TOKEN_LIMIT };
  }
  if (def.id !== 'opencode') return null;
  const metadata = findKnownModel(def, model)?.metadata;
  if (!metadata?.contextWindowTokens) return null;
  return { limitTokens: metadata.contextWindowTokens,
    ...(metadata.autoCompactAtTokens ? { autoCompactAtTokens: metadata.autoCompactAtTokens } : {}) };
}
