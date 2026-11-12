import type { AgentInfo } from '../types';

type ModelOption = NonNullable<AgentInfo['models']>[number];

/** A local tool with more models than this lists only its default and the chosen one until the user searches. */
export const LOCAL_MODEL_SEARCH_THRESHOLD = 12;
/** The most rows one search shows, so a broad query on hundreds of models stays a short menu. */
export const LOCAL_MODEL_SEARCH_RESULTS = 30;

/**
 * Whether the picker offers a local tool's models. Its CLI has to be found, and a CLI that
 * reports it is signed out (`authStatus: 'missing'`) cannot run them, so it is left out, unless
 * it is the tool already chosen, which stays visible so the user can see and change it.
 */
export function localAgentOffered(agent: AgentInfo | undefined, currentAgentId: string | undefined): agent is AgentInfo {
  if (!agent?.available) return false;
  return agent.authStatus !== 'missing' || agent.id === currentAgentId;
}

export interface LocalModelView {
  rows: ModelOption[];
  /** True when the list is long enough to need the search box. */
  searchable: boolean;
  /** How many models match the query, which can be more than `rows` shows. */
  matches: number;
}

/**
 * The rows the picker shows for one local tool. A short list shows whole. A long one (OpenCode
 * reports every model of every provider the user connected, hundreds with OpenRouter) shows the
 * default and the chosen model, and a query searches ids and labels, capped at
 * LOCAL_MODEL_SEARCH_RESULTS. Each word of the query must appear somewhere, so "sonnet 5.5" finds
 * `openrouter/anthropic/claude-sonnet-5.5`.
 */
export function localModelView(models: readonly ModelOption[], currentModelId: string | null, query: string): LocalModelView {
  if (models.length <= LOCAL_MODEL_SEARCH_THRESHOLD) return { rows: [...models], searchable: false, matches: models.length };
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (!words.length) {
    const rows = models.filter((model) => model.id === 'default' || model.id === currentModelId);
    return { rows, searchable: true, matches: rows.length };
  }
  const found = models.filter((model) => {
    const text = `${model.id} ${model.label ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  return { rows: found.slice(0, LOCAL_MODEL_SEARCH_RESULTS), searchable: true, matches: found.length };
}
