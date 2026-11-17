// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSetup } from '../../../src/components/onboarding/AgentSetup';
import { I18nProvider } from '../../../src/i18n';
import { DEFAULT_CONFIG } from '../../../src/state/config';

vi.mock('../../../src/providers/connection-test', () => ({
  testAgent: vi.fn(),
  testApiProvider: vi.fn(),
}));

afterEach(() => cleanup());

// Seen 2026-11-18 in the zh-CN first run: the model dropdown under 「设置 AI」 said
// "Default (CLI config)", the daemon's English row label, in an otherwise Chinese page.
describe('AgentSetup model picker', () => {
  it('names the CLI default model row in the user language', async () => {
    render(<I18nProvider initial="zh-CN"><AgentSetup
      config={{ ...DEFAULT_CONFIG, mode: 'daemon', agentId: 'codex' }}
      agents={[{ id: 'codex', name: 'Codex', bin: 'codex', available: true,
        models: [{ id: 'default', label: 'Default (CLI config)' }, { id: 'gpt-5', label: 'gpt-5' }] }]}
      daemonLive onModeChange={vi.fn()} onAgentChange={vi.fn()} onAgentModelChange={vi.fn()}
      onApiProtocolChange={vi.fn()} onApiModelChange={vi.fn()} onConfigPersist={vi.fn()}
      onRefreshAgents={vi.fn(() => [])} onFinish={vi.fn()}
    /></I18nProvider>);
    await screen.findByTestId('onboarding-primary');
    expect(document.body.textContent).not.toContain('Default (CLI config)');
    expect(document.body.textContent).toContain('CLI 默认设置');
  });
});
