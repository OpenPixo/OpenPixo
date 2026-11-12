// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfigPrefs } from '@openpixo/contracts';
import { AgentApprovalSettings } from '../../src/components/AgentApprovalSettings';

vi.mock('../../src/providers/agent-capabilities', () => ({ fetchAgentCapabilities: async () => ({ matrix: {}, runtimes: {} }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serveConfig(initial: AppConfigPrefs = {}) {
  let config = initial;
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') config = { ...config, ...JSON.parse(options.body as string) };
    return new Response(JSON.stringify({ config }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('runtime approval settings', () => {
  it('hands the selection to Settings autosave before switching runtimes without a separate PUT', async () => {
    const fetchMock = serveConfig({ agentApprovalModes: { claude: 'in-app', codex: 'skip' } });
    const change = vi.fn();
    const view = render(<AgentApprovalSettings agentId="claude" onChange={change} />);
    await act(async () => {});
    const select = screen.getByRole('combobox', { name: 'Approval mode' }) as HTMLSelectElement;
    expect(select.value).toBe('in-app');
    expect(select.disabled).toBe(false);
    expect(screen.getByRole('note').textContent).toContain('Asks you in OpenPixo before the agent edits files or runs commands.');
    fireEvent.change(select, { target: { value: 'skip' } });
    expect(change).toHaveBeenCalledWith('skip');

    view.rerender(<AgentApprovalSettings agentId="codex" mode="skip" onChange={change} />);
    await act(async () => {});
    expect(change).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('combobox', { name: 'Approval mode' }) as HTMLSelectElement).value).toBe('skip');
    expect(screen.getByRole('note').textContent).toContain('The agent will edit files and run commands without asking. Best for projects under version control.');
    expect(fetchMock.mock.calls.every(([url]) => url === '/api/app-config')).toBe(true);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
  });

  it('uses the daemon mode for Codex even when the Settings draft is stale', async () => {
    serveConfig({ agentApprovalModes: { codex: 'skip' } });
    const change = vi.fn();
    render(<AgentApprovalSettings agentId="codex" mode="in-app" onChange={change} />);
    await act(async () => {});
    expect((screen.getByRole('combobox', { name: 'Approval mode' }) as HTMLSelectElement).value).toBe('skip');
    expect(change).toHaveBeenCalledWith('skip');
  });

  it('explains unsupported approvals in place of a picker', async () => {
    const fetchMock = serveConfig();
    render(<AgentApprovalSettings agentId="opencode" onChange={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByText("This runtime can't ask for approval.")).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
