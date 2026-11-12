// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfigPrefs } from '@openpixo/contracts';
import { ApprovalModePicker } from '../../../src/components/composer/ApprovalModePicker';

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

async function settle() {
  await act(async () => {});
}

/** The composer chip: its current mode, whether it can be pressed, and picking one. */
const chip = () => screen.getByTestId('approval-mode-chip') as HTMLButtonElement;
const chipValue = () => chip().getAttribute('data-value');
function choose(mode: 'in-app' | 'skip') {
  fireEvent.click(chip());
  fireEvent.click(screen.getByTestId(`approval-mode-chip-${mode}`));
}

describe('composer approval mode', () => {
  it.each(['claude', 'codex'])('loads the saved %s mode from the Settings endpoint', async (agentId) => {
    const fetchMock = serveConfig({ agentApprovalModes: { [agentId]: 'skip' } });
    render(<ApprovalModePicker agentId={agentId} />);
    await settle();
    expect(chipValue()).toBe('skip');
    expect(chip().disabled).toBe(false);
    expect(chip().textContent).toBe('Full auto');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/app-config');
    expect(screen.getByTestId('approval-mode-picker').title).toContain('next turn');
  });

  it('persists only the approval map, preserves other runtimes and synchronizes Settings', async () => {
    const fetchMock = serveConfig({ agentId: 'claude', agentApprovalModes: { claude: 'in-app', codex: 'skip' } });
    const onChange = vi.fn();
    render(<>
      <ApprovalModePicker agentId="claude" />
      <ApprovalModePicker agentId="claude" mode="in-app" variant="settings" onChange={onChange} />
    </>);
    await settle();
    choose('skip');
    await settle();
    const writes = fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]![1]!.body as string)).toEqual({
      agentApprovalModes: { claude: 'skip', codex: 'skip' },
    });
    expect(chipValue()).toBe('skip');
    expect((screen.getByRole('combobox', { name: 'Approval mode' }) as HTMLSelectElement).value).toBe('skip');
    expect(onChange).toHaveBeenCalledWith('skip');
  });

  it('disables unsupported runtimes with an explanatory tooltip and no config request', async () => {
    const fetchMock = serveConfig();
    render(<ApprovalModePicker agentId="opencode" unsupported />);
    await settle();
    expect(chip().disabled).toBe(true);
    expect(screen.getByTestId('approval-mode-picker').title).toContain("can't ask for approval");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the saved mode and reports a failed write', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'PUT'
      ? new Response('{}', { status: 500 })
      : new Response('{"config":{"agentApprovalModes":{"claude":"in-app"}}}', { status: 200 })));
    render(<ApprovalModePicker agentId="claude" />);
    await settle();
    choose('skip');
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('previous mode is still active');
    expect(chipValue()).toBe('in-app');
  });

  it('does not assume an approval mode when the daemon is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ApprovalModePicker agentId="codex" />);
    await settle();
    expect(chip().disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Could not load approval mode');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores an old runtime read after the runtime changes', async () => {
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(new Response('{"config":{"agentApprovalModes":{"codex":"skip"}}}', { status: 200 })));
    const view = render(<ApprovalModePicker agentId="claude" />);
    view.rerender(<ApprovalModePicker agentId="codex" />);
    await settle();
    await act(async () => {
      resolveFirst(new Response('{"config":{"agentApprovalModes":{"claude":"in-app"}}}', { status: 200 }));
    });
    expect(chipValue()).toBe('skip');
  });

  it('does not show a control without a selected runtime', () => {
    render(<ApprovalModePicker agentId={null} />);
    expect(screen.queryByTestId('approval-mode-chip')).toBeNull();
  });

  it('does not let an earlier refresh undo a successfully saved mode', async () => {
    let finishRefresh!: (response: Response) => void;
    const pendingRefresh = new Promise<Response>((resolve) => { finishRefresh = resolve; });
    let reads = 0;
    const config = { agentApprovalModes: { claude: 'in-app' } };
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method !== 'PUT' && ++reads === 2) return pendingRefresh;
      return new Response(JSON.stringify({ config }), { status: 200 });
    }));
    const onChange = vi.fn();
    render(<ApprovalModePicker agentId="claude" onChange={onChange} />);
    await settle();
    act(() => { window.dispatchEvent(new Event('focus')); });
    choose('skip');
    await settle();
    expect(chipValue()).toBe('skip');
    await act(async () => {
      finishRefresh(new Response(JSON.stringify({ config }), { status: 200 }));
    });
    expect(chipValue()).toBe('skip');
    expect(onChange.mock.calls).toEqual([['skip']]);
  });
});
