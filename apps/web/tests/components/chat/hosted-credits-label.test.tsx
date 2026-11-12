// @vitest-environment jsdom
//
// Credits used per run on the OpenPixo-credits agent model, and the run-error
// copy when that model refuses a run.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
}));

import { HostedCreditsLabel, latestHostedUsage } from '../../../src/components/chat/HostedCreditsLabel';
import { resolveRunFailureUi } from '../../../src/runtime/failure-guidance';

afterEach(cleanup);

describe('hosted credits label', () => {
  it('reads the latest running total and shows metered credits with two decimals', () => {
    const usage = latestHostedUsage([
      { kind: 'hosted_usage', requests: 1, costMicrocredits: 300_000, inputTokens: 10, cachedInputTokens: 0, outputTokens: 2 },
      { kind: 'text' },
      { kind: 'hosted_usage', requests: 2, costMicrocredits: 1_234_567, inputTokens: 30, cachedInputTokens: 20, outputTokens: 5 },
    ]);
    expect(usage).toMatchObject({ requests: 2, costMicrocredits: 1_234_567 });
    expect(latestHostedUsage([{ kind: 'usage' }])).toBeNull();
    render(<HostedCreditsLabel usage={usage!} />);
    expect(screen.getByTestId('assistant-hosted-credits').textContent).toBe('assistant.hostedCreditsUsed {"credits":"1.23"}');
  });

  it('names out-of-credits and an unavailable hosted agent on the run error card', () => {
    expect(resolveRunFailureUi('INSUFFICIENT_CREDITS', null, 'openpixo-agent')).toMatchObject({
      titleKey: 'chat.runError.title.outOfCredits', messageKey: 'chat.runError.outOfCreditsMessage', primaryAction: 'retry',
    });
    expect(resolveRunFailureUi('HOSTED_AGENT_UNAVAILABLE', null, 'openpixo-agent')).toMatchObject({
      titleKey: 'chat.runError.title.hostedAgentUnavailable', messageKey: 'chat.runError.hostedAgentUnavailableMessage',
    });
  });
});
