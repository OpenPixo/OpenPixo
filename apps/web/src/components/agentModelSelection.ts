import { resolveAvailableAgentId } from '../utils/visibleAgents';
import type { AgentInfo, AgentModelChoice, AppConfig, ChatMessage, ConnectionTestResponse } from '../types';
import { agentModelDisplayName } from '../utils/agentLabels';
import { apiProtocolAgentId, apiProtocolModelLabel } from '../utils/apiProtocol';
import { nativeCodexProviderForConfig, resolveConversationAgentId } from '@openpixo/contracts';

/** Keep the composer label and the submitted run on the conversation's runtime. */
export function conversationAgentConfig(
  config: AppConfig,
  agents: readonly AgentInfo[],
  latestRunAgentId?: string,
  selectedAgentId?: string,
): AppConfig {
  if (config.mode !== 'daemon') return config;
  const preferred = resolveConversationAgentId(selectedAgentId, latestRunAgentId, config.agentId);
  const agentId = resolveAvailableAgentId(preferred, agents);
  return agentId === config.agentId ? config : { ...config, agentId };
}

export function latestConversationRun(messages: readonly ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === 'assistant' && message.runStatus) return message;
  }
  return undefined;
}

type AgentModelSource =
  | {
      id: AgentInfo['id'];
      models?: Array<{ id: string; enabled?: boolean; default?: boolean }>;
    }
  | null
  | undefined;

export function defaultAgentModelId(agent: AgentModelSource): string | null {
  const models = agent?.models ?? [];
  return (
    models.find((model) => model.default === true && model.enabled !== false)?.id ??
    models.find((model) => model.enabled !== false)?.id ??
    null
  );
}

/**
 * The model to offer when the CLI refused one on the user's plan
 * (`agent_model_not_on_plan`): the first listed model that is neither the CLI
 * default slot nor a refused one. Codex lists its newest model first, so this
 * is the newest model it offers.
 */
export function newestListedAgentModel(
  agent: AgentModelSource,
  refused: ReadonlyArray<string | undefined>,
): string | null {
  const skip = new Set(['default', ...refused.filter((id): id is string => Boolean(id))]);
  return agent?.models?.find((model) => model.enabled !== false && !skip.has(model.id))?.id ?? null;
}

type ModelNotOnPlanKey = 'settings.testModelNotOnPlanDefault' | 'settings.testModelNotOnPlan';

/** Onboarding and Settings say a plan refusal the same way: the CLI default, or the model the user picked. */
export function modelNotOnPlanMessage(
  t: (key: ModelNotOnPlanKey, vars: Record<string, string>) => string,
  result: Pick<ConnectionTestResponse, 'model' | 'resolvedModel'>,
  agentName: string,
): string {
  const picked = result.model && result.model !== 'default' ? result.model : null;
  const model = result.resolvedModel ?? picked ?? '';
  return picked
    ? t('settings.testModelNotOnPlan', { model })
    : t('settings.testModelNotOnPlanDefault', { agentName, model });
}

export function effectiveAgentModelId(
  agent: AgentModelSource,
  choice: AgentModelChoice | undefined,
): string | null {
  const configuredModel = choice?.model?.trim();
  return configuredModel && configuredModel !== 'default'
    ? configuredModel
    : defaultAgentModelId(agent);
}

/**
 * Who a turn sent right now would be answered by: the identity stamped on the
 * assistant placeholder of a real turn and of the optimistic first turn a
 * Home send draws (OPEND-3334). One resolution, so the role row reads the
 * same on both sides of that hand-off.
 */
export function selectedAssistantIdentity(
  config: AppConfig,
  agents: readonly AgentInfo[],
): { agentId: string | undefined; agentName: string | undefined } {
  if (config.mode === 'daemon' && config.agentId) {
    const agentId = resolveAvailableAgentId(config.agentId, agents);
    if (agentId !== config.agentId) config = { ...config, agentId };
  }
  const legacyNativeByok = config.agentId === 'byok-opencode'
    && nativeCodexProviderForConfig({ protocol: config.apiProtocol, baseUrl: config.baseUrl });
  if (config.mode === 'daemon' && !legacyNativeByok) {
    const selectedAgent = config.agentId
      ? agents.find((agent) => agent.id === config.agentId) ?? null
      : null;
    const selectedChoice = config.agentId ? config.agentModels?.[config.agentId] : undefined;
    return {
      agentId: config.agentId ?? undefined,
      agentName: agentModelDisplayName(config.agentId, selectedAgent?.name, selectedChoice?.model, selectedAgent?.models),
    };
  }
  return {
    agentId: apiProtocolAgentId(config.apiProtocol),
    agentName: apiProtocolModelLabel(config.apiProtocol, config.model, config.baseUrl),
  };
}
