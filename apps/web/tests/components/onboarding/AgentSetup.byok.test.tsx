// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSetup } from '../../../src/components/onboarding/AgentSetup';
import { I18nProvider } from '../../../src/i18n';
import type { AgentInfo, AppConfig } from '../../../src/types';

vi.mock('../../../src/providers/connection-test', () => ({
  testAgent: vi.fn(),
  testApiProvider: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const OPENCODE: AgentInfo = { id: 'opencode', name: 'OpenCode', bin: 'opencode', available: true };

function renderByok(config: Partial<AppConfig>, agents: AgentInfo[] = [OPENCODE]) {
  const onConfigPersist = vi.fn();
  render(
    <I18nProvider initial="en">
      <AgentSetup
        config={{
          mode: 'api',
          agentId: null,
          agentModels: {},
          apiProtocol: 'anthropic',
          apiProtocolConfigs: {},
          apiKey: '',
          baseUrl: 'https://api.anthropic.com',
          apiProviderBaseUrl: 'https://api.anthropic.com',
          model: '',
          ...config,
        } as AppConfig}
        agents={agents}
        daemonLive
        onModeChange={vi.fn()}
        onAgentChange={vi.fn()}
        onAgentModelChange={vi.fn()}
        onApiProtocolChange={vi.fn()}
        onApiModelChange={vi.fn()}
        onConfigPersist={onConfigPersist}
        onRefreshAgents={vi.fn(() => agents)}
        onFinish={vi.fn()}
      />
    </I18nProvider>,
  );
  return onConfigPersist;
}

describe('AgentSetup API key panel', () => {
  it('asks for a provider, not a protocol or address, when the provider is known', () => {
    renderByok({});

    expect(screen.getByRole('button', { name: 'Anthropic (Claude)' })).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: 'API protocol' })).toBeNull();
    expect(screen.queryByText('Base URL')).toBeNull();
    expect(screen.queryByText(/BYOK/)).toBeNull();
  });

  it('switches protocol together with a provider from another protocol', () => {
    const onConfigPersist = renderByok({});

    fireEvent.click(screen.getByRole('button', { name: 'Anthropic (Claude)' }));
    fireEvent.click(screen.getByRole('option', { name: /DeepSeek — OpenAI/ }));

    expect(onConfigPersist).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: 'api',
      apiProtocol: 'openai',
      baseUrl: 'https://api.deepseek.com',
      apiProviderBaseUrl: 'https://api.deepseek.com',
    }));
  });

  it('shows protocol and address only for a custom provider', () => {
    renderByok({ baseUrl: '', apiProviderBaseUrl: null });

    expect(screen.getByRole('button', { name: 'Custom provider' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'API protocol' })).toBeTruthy();
    expect(screen.getByText('Base URL')).toBeTruthy();
  });

  it('says OpenCode is required and how to install it when it is missing', () => {
    renderByok({}, []);

    expect(screen.getByText(/OpenCode isn't installed yet/)).toBeTruthy();
    expect(screen.getByText('npm install -g opencode-ai')).toBeTruthy();
  });
});
