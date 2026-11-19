import { describe, expect, it } from 'vitest';
import { conversationAgentConfig, latestConversationRun, modelNotOnPlanMessage, newestListedAgentModel, selectedAssistantIdentity } from '../../src/components/agentModelSelection';
import { en } from '../../src/i18n/locales/en';
import type { AgentInfo, AppConfig, ChatMessage } from '../../src/types';

const codexAgent: AgentInfo = {
  id: 'codex',
  name: 'Codex',
  bin: 'codex',
  available: true,
  version: '1.0.0',
  models: [{ id: 'default', label: 'Default' }],
};

describe('agent model selection', () => {
  const saved = { mode: 'daemon', agentId: 'claude', agentModels: {} } as AppConfig;
  it('uses the conversation runtime for both the composer and submitted config without changing the global preference', () => {
    const config = conversationAgentConfig(saved, [codexAgent], 'codex');
    expect(config.agentId).toBe('codex');
    expect(selectedAssistantIdentity(config, [codexAgent]).agentId).toBe('codex');
    expect(saved.agentId).toBe('claude');
    expect(conversationAgentConfig(saved, [codexAgent], 'codex', 'opencode').agentId).toBe('opencode');
    expect(conversationAgentConfig(saved, [codexAgent]).agentId).toBe('claude');
    expect(conversationAgentConfig(saved, [codexAgent], 'pi').agentId).toBe('claude');
  });
  it('keeps a temporarily unavailable conversation runtime selected and leaves API mode unchanged', () => {
    expect(conversationAgentConfig(saved, [], 'codex').agentId).toBe('codex');
    const api = { ...saved, mode: 'api' } as AppConfig;
    expect(conversationAgentConfig(api, [codexAgent], 'codex')).toBe(api);
  });
  it('takes the latest run before inspecting identity, rather than reviving an older agent', () => {
    const messages = [{ role: 'assistant', runStatus: 'succeeded', agentId: 'codex' },
      { role: 'assistant', runStatus: 'failed' }, { role: 'user', agentId: 'claude' }] as ChatMessage[];
    expect(latestConversationRun(messages)?.agentId).toBeUndefined();
    expect(latestConversationRun(messages.slice(0, 1))?.agentId).toBe('codex');
  });
  it('keeps a native-provider API identity editable in Settings while showing Codex execution', () => {
    const identity = selectedAssistantIdentity({ mode: 'api', apiProtocol: 'openai', apiKey: 'synthetic-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', agentId: null, skillId: null, }, [codexAgent]);
    expect(identity).toEqual({ agentId: 'openai-api', agentName: 'DeepSeek via Codex · deepseek-flash' });
  });

  
});

describe('a model the plan does not include', () => {
  const t = (key: keyof typeof en, vars: Record<string, string>) =>
    Object.entries(vars).reduce((text, [name, value]) => text.replace(`{${name}}`, value), en[key]);
  const agent = { id: 'codex', models: [{ id: 'default' }, { id: 'gpt-6.2-sol' }, { id: 'gpt-6.1-sol', enabled: false }, { id: 'gpt-5.5' }] };

  it('offers the first listed model that is not the default slot, refused or turned off', () => {
    expect(newestListedAgentModel(agent, ['default', 'gpt-6.2-sol'])).toBe('gpt-5.5');
    expect(newestListedAgentModel({ id: 'codex', models: [{ id: 'default' }, { id: 'gpt-6.2-sol' }] }, ['gpt-6.2-sol'])).toBeNull();
  });

  it('names the CLI default model, or the model the user picked', () => {
    expect(modelNotOnPlanMessage(t, { model: 'default', resolvedModel: 'gpt-6.2-sol' }, 'Codex CLI'))
      .toBe("Codex CLI's default model (gpt-6.2-sol) isn't included in your ChatGPT plan.");
    expect(modelNotOnPlanMessage(t, { model: 'gpt-6.2-sol', resolvedModel: 'gpt-6.2-sol' }, 'Codex CLI'))
      .toBe("gpt-6.2-sol isn't included in your ChatGPT plan.");
  });
});
