// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSetup } from '../../../src/components/onboarding/AgentSetup';
import { I18nProvider } from '../../../src/i18n';
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
