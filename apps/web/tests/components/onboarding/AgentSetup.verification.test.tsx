// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSetup } from '../../../src/components/onboarding/AgentSetup';
import { I18nProvider } from '../../../src/i18n';
import { zhCN } from '../../../src/i18n/locales/zh-CN';
import { testAgent } from '../../../src/providers/connection-test';
import { DEFAULT_CONFIG } from '../../../src/state/config';
import type { AppConfig, ConnectionTestResponse } from '../../../src/types';

vi.mock('../../../src/providers/connection-test', () => ({
  testAgent: vi.fn(),
  testApiProvider: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AgentSetup verification cancellation', () => {
  it('finishes with one skip click during verification and ignores a late success', async () => {
    let resolveVerification!: (result: ConnectionTestResponse) => void;
    vi.mocked(testAgent).mockImplementation(() => new Promise((resolve) => {
      resolveVerification = resolve;
    }));
    const onFinish = vi.fn();
    const onConfigPersist = vi.fn();
    const config = {
      mode: 'daemon',
      agentId: 'codex',
      agentModels: {},
      apiProtocol: 'anthropic',
      apiProtocolConfigs: {},
      apiKey: '',
      baseUrl: '',
      model: '',
    } as AppConfig;
    render(
      <I18nProvider initial="en">
        <AgentSetup
          config={config}
          agents={[{
            id: 'codex',
            name: 'Codex',
            bin: 'codex',
            available: true,
            models: [{ id: 'codex-model', label: 'Codex Model' }],
          }]}
          daemonLive
          onModeChange={vi.fn()}
          onAgentChange={vi.fn()}
          onAgentModelChange={vi.fn()}
          onApiProtocolChange={vi.fn()}
          onApiModelChange={vi.fn()}
          onConfigPersist={onConfigPersist}
          onRefreshAgents={vi.fn(() => [])}
          onFinish={onFinish}
        />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByTestId('onboarding-primary'));
    expect(testAgent).toHaveBeenCalledOnce();
    const signal = vi.mocked(testAgent).mock.calls[0]?.[1];
    fireEvent.click(screen.getByTestId('onboarding-continue-unverified'));
    await waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
    expect(onFinish).toHaveBeenCalledWith(false);
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      resolveVerification({ ok: true, kind: 'success', latencyMs: 12, sample: 'ok' });
    });
    expect(onFinish).toHaveBeenCalledOnce();
    expect(onConfigPersist).toHaveBeenCalledOnce();
  });

  it('reports a passed live check as verified', async () => {
    vi.mocked(testAgent).mockResolvedValue({ ok: true, kind: 'success', latencyMs: 12, sample: 'ok' });
    const onFinish = vi.fn();
    render(<I18nProvider initial="en"><AgentSetup
      config={{ ...DEFAULT_CONFIG, mode: 'daemon', agentId: 'codex' }}
      agents={[{ id: 'codex', name: 'Codex', bin: 'codex', available: true }]}
      daemonLive onModeChange={vi.fn()} onAgentChange={vi.fn()} onAgentModelChange={vi.fn()}
      onApiProtocolChange={vi.fn()} onApiModelChange={vi.fn()} onConfigPersist={vi.fn()}
      onRefreshAgents={vi.fn(() => [])} onFinish={onFinish}
    /></I18nProvider>);
    fireEvent.click(await screen.findByTestId('onboarding-primary'));
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith(true));
  });
});

/* 2026-11-19: Codex's default model was not on the user's ChatGPT plan, and onboarding said so in raw English. */
describe('AgentSetup when the CLI default model is not on the plan', () => {
  const refused: ConnectionTestResponse = {
    ok: false, kind: 'agent_model_not_on_plan', latencyMs: 900, model: 'default', resolvedModel: 'gpt-6.2-sol',
    agentName: 'Codex CLI', detail: "The 'gpt-6.2-sol' model is not supported when using Codex with a ChatGPT account.",
  };
  const agents = [{
    id: 'codex', name: 'Codex CLI', bin: 'codex', available: true,
    // Codex lists its newest model first; the CLI default slot comes before them.
    models: [{ id: 'default', label: 'Default' }, { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }, { id: 'gpt-5.5', label: 'gpt-5.5' }],
  }];

  /** Hosts the step the way onboarding does: a model change comes back as new config. */
  function Host({ onFinish }: { onFinish: (verified: boolean) => void }) {
    const [config, setConfig] = useState<AppConfig>({ ...DEFAULT_CONFIG, mode: 'daemon', agentId: 'codex', agentModels: {} });
    return (
      <I18nProvider initial="zh-CN"><AgentSetup
        config={config} agents={agents}
        daemonLive onModeChange={vi.fn()} onAgentChange={vi.fn()}
        onAgentModelChange={(id, choice) => setConfig((current) => ({ ...current, agentModels: { ...current.agentModels, [id]: choice } }))}
        onApiProtocolChange={vi.fn()} onApiModelChange={vi.fn()} onConfigPersist={vi.fn()}
        onRefreshAgents={vi.fn(() => [])} onFinish={onFinish}
      /></I18nProvider>
    );
  }

  it('says so in the user language and re-tests with the newest listed model in one click', async () => {
    vi.mocked(testAgent).mockResolvedValueOnce(refused).mockResolvedValueOnce({ ok: true, kind: 'success', latencyMs: 12, sample: 'ok', agentName: 'Codex CLI' });
    const onFinish = vi.fn();
    render(<Host onFinish={onFinish} />);
    fireEvent.click(await screen.findByTestId('onboarding-primary'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(zhCN['settings.testModelNotOnPlanDefault'].replace('{agentName}', 'Codex CLI').replace('{model}', 'gpt-6.2-sol'));
    expect(alert.textContent).not.toContain('is not supported when using Codex');

    fireEvent.click(screen.getByRole('button', { name: zhCN['onboarding.useModelAndRetest'].replace('{model}', 'gpt-6.1-sol') }));
    await waitFor(() => expect(testAgent).toHaveBeenCalledTimes(2));
    expect(vi.mocked(testAgent).mock.calls[1]![0]).toMatchObject({ agentId: 'codex', model: 'gpt-6.1-sol' });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    // Re-testing is not finishing: the user still continues themselves.
    expect(onFinish).not.toHaveBeenCalled();
  });
});
