// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RUNTIME_CAPABILITY_MATRIX, type AgentCapabilitiesResponse } from '@openpixo/contracts';
import { AgentCapabilityMatrix } from '../../src/components/AgentCapabilityMatrix';
import { I18nProvider } from '../../src/i18n';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('renders fetched capability states, installed versions, and evidence tooltips', async () => {
  const data: AgentCapabilitiesResponse = {
    matrix: {
      codex: { ...RUNTIME_CAPABILITY_MATRIX.codex, approvals: {
        state: 'implemented', testedVersion: 'codex 0.160.0', note: 'newer CLI version not verified',
      } },
      claude: { ...RUNTIME_CAPABILITY_MATRIX.claude, approvals: { state: 'unknown' } },
      opencode: RUNTIME_CAPABILITY_MATRIX.opencode,
    },
    runtimes: { codex: { installedVersion: 'codex-cli 0.161.0' }, claude: {}, opencode: {} },
  };
  const fetchMock = vi.fn(async () => Response.json(data));
  vi.stubGlobal('fetch', fetchMock);
  render(<I18nProvider initial="en"><AgentCapabilityMatrix /></I18nProvider>);
  const table = await screen.findByRole('table', { name: 'Runtime capabilities' });
  const approvals = within(table).getByRole('row', { name: /In-app approvals/ });
  expect(within(approvals).getByText('Implemented')).toBeTruthy();
  expect(within(approvals).getByText('Unknown')).toBeTruthy();
  expect(within(approvals).getByText('Unsupported')).toBeTruthy();
  expect(within(table).getByText('codex-cli 0.161.0')).toBeTruthy();
  expect(within(approvals).getByText('Implemented').closest('td')?.title).toContain('Tested CLI version: codex 0.160.0');
  expect(fetchMock).toHaveBeenCalledWith('/api/agents/capabilities');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('table', { name: 'Runtime capabilities' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
