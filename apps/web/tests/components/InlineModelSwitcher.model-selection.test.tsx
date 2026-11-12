// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineModelSwitcher } from '../../src/components/InlineModelSwitcher';
import { fetchProviderModels } from '../../src/providers/provider-models';
import type { AgentInfo, AppConfig, ProviderModelsResponse } from '../../src/types';

const accountState = vi.hoisted(() => ({
  status: { availability: 'available', signedIn: false, user: null } as import('@openpixo/contracts').OpenPixoAccountStatus,
}));

vi.mock('../../src/hooks/useOpenPixoAccount', () => ({
  useOpenPixoAccount: () => ({ status: accountState.status, loading: false, failed: false, refresh: vi.fn() }),
  isCloudAccountAvailable: (status: { availability?: string } | null) => status?.availability === 'available',
}));

vi.mock('../../src/providers/provider-models', () => ({
  fetchProviderModels: vi.fn(async (): Promise<ProviderModelsResponse> => ({
    ok: false, kind: 'unknown', latencyMs: 0, models: [],
  })),
}));

const config: AppConfig = {
  mode: 'daemon',
  apiKey: '',
  apiProtocol: 'openai',
  apiVersion: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-2.5-flash',
  apiProviderBaseUrl: 'https://openrouter.ai/api/v1',
  apiProtocolConfigs: {},
  agentId: 'claude',
  skillId: null,
  onboardingCompleted: true,
  mediaProviders: {},
  agentModels: { claude: { model: 'first', serviceTier: 'fast' } },
  agentCliEnv: {},
};

const agents: AgentInfo[] = [{
  id: 'claude',
  name: 'Claude Code',
  available: true,
  models: [
    { id: 'first', label: 'First' },
    { id: 'next', label: 'Next' },
  ],
} as AgentInfo];

function renderPicker(overrides: Partial<Parameters<typeof InlineModelSwitcher>[0]> = {}) {
  const callbacks = {
    onModeChange: vi.fn(),
    onAgentChange: vi.fn(),
    onAgentModelChange: vi.fn(),
    onApiProtocolChange: vi.fn(),
    onApiModelChange: vi.fn(),
    onOpenSettings: vi.fn(),
    onSignIn: vi.fn(),
  };
  const view = render(
    <InlineModelSwitcher
      compact
      config={config}
      agents={agents}
      daemonLive
      {...callbacks}
      {...overrides}
    />,
  );
  return { ...view, ...callbacks };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  accountState.status = { availability: 'available', signedIn: false, user: null };
});

describe('InlineModelSwitcher model selection', () => {
  it('explicitly clears the previous model service tier when selecting a compact model row', () => {
    const { onAgentModelChange } = renderPicker();
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
    fireEvent.click(screen.getByTestId('inline-model-switcher-compact-model-next'));

    expect(onAgentModelChange).toHaveBeenCalledTimes(1);
    // mergeAgentModelChoice retains omitted fields; an own undefined property
    // is required to remove a tier selected for the previous model.
    expect(onAgentModelChange.mock.calls[0]).toStrictEqual([
      'claude',
      { model: 'next', serviceTier: undefined },
    ]);
  });

  it('opens above a bottom composer in a viewport portal outside composer overflow', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 120, y: 680, left: 120, top: 680, right: 280, bottom: 710,
      width: 160, height: 30, toJSON: () => ({}),
    });
    const { container } = renderPicker();
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));

    const menu = screen.getByTestId('inline-model-switcher-popover');
    expect(container.contains(menu)).toBe(false);
    expect(menu.style.position).toBe('fixed');
    expect(menu.getAttribute('data-placement')).toBe('up');
  });

  it('groups account credits separately from local models and offers sign-in', () => {
    const { onSignIn } = renderPicker();
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));

    expect(screen.getByRole('group', { name: 'OpenPixo' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Local' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign in to use account credits' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('shows hosted availability for a signed-in account without inventing hosted model choices', () => {
    accountState.status = {
      availability: 'available',
      signedIn: true,
      user: { id: 'u1', email: 'test@example.com', provider: 'email', displayName: null, avatarUrl: null },
    };
    renderPicker();
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));

    const account = screen.getByRole('group', { name: 'OpenPixo' });
    expect(account.querySelector('[role="menuitemradio"]')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Hosted models are not available yet');
    expect(screen.queryByRole('menuitem', { name: 'Sign in to use account credits' })).toBeNull();
  });

  it('offers the OpenPixo-credits agent models to a signed-in account and selects that agent', () => {
    accountState.status = {
      availability: 'available',
      signedIn: true,
      user: { id: 'u1', email: 'test@example.com', provider: 'email', displayName: null, avatarUrl: null },
    };
    const hosted = { id: 'openpixo-agent', name: 'OpenPixo', available: true, models: [
      { id: 'openpixo-agent-flash', label: 'DeepSeek V4.1 Flash' },
      { id: 'openpixo-agent-gpt-6-1-sol', label: 'GPT-6.1 Sol' },
    ] } as AgentInfo;
    const { onAgentChange, onAgentModelChange } = renderPicker({ agents: [...agents, hosted] });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));

    const account = screen.getByRole('group', { name: 'OpenPixo' });
    expect(within(account).getAllByRole('menuitemradio').map((row) => row.textContent))
      .toEqual(['DeepSeek V4.1 Flash', 'GPT-6.1 Sol']);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByTestId('inline-model-switcher-model-openpixo-agent-openpixo-agent-flash'));
    expect(onAgentChange).toHaveBeenCalledWith('openpixo-agent');
    expect(onAgentModelChange).toHaveBeenCalledWith('openpixo-agent', { model: 'openpixo-agent-flash', serviceTier: undefined });
  });

  it('shows only the efforts the selected hosted model has, and hides the control when it has none', () => {
    accountState.status = {
      availability: 'available',
      signedIn: true,
      user: { id: 'u1', email: 'test@example.com', provider: 'email', displayName: null, avatarUrl: null },
    };
    const efforts = (ids: string[]) => ids.map((id) => ({ id, label: id }));
    const hosted = { id: 'openpixo-agent', name: 'OpenPixo', available: true, models: [
      { id: 'openpixo-agent-flash', label: 'DeepSeek V4.1 Flash', reasoningOptions: efforts(['low', 'high']) },
      { id: 'openpixo-agent-gpt-6-1-sol', label: 'GPT-6.1 Sol', reasoningOptions: efforts(['low', 'medium', 'high']) },
      { id: 'openpixo-agent-none', label: 'No effort' },
    ] } as AgentInfo;
    const show = (model: string) => {
      const view = renderPicker({
        agents: [...agents, hosted],
        config: { ...config, mode: 'daemon', agentId: 'openpixo-agent', agentModels: { 'openpixo-agent': { model } } },
      } as never);
      fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
      return view;
    };
    const effortIds = () => {
      fireEvent.click(screen.getByTestId('inline-model-switcher-reasoning'));
      return Array.from(screen.getByTestId('inline-model-switcher-reasoning-menu')
        .querySelectorAll('[role="menuitemradio"]')).map((item) => item.getAttribute('data-testid')?.replace('inline-model-switcher-reasoning-', ''));
    };
    const first = show('openpixo-agent-gpt-6-1-sol');
    expect(effortIds()).toEqual(['low', 'medium', 'high']);
    fireEvent.click(screen.getByTestId('inline-model-switcher-reasoning-high'));
    expect(first.onAgentModelChange).toHaveBeenCalledWith('openpixo-agent', { reasoning: 'high', model: 'openpixo-agent-gpt-6-1-sol' });
    expect(screen.queryByTestId('inline-model-switcher-reasoning-menu')).toBeNull();
    first.unmount();
    show('openpixo-agent-flash');
    expect(effortIds()).toEqual(['low', 'high']);
    cleanup();
    show('openpixo-agent-none');
    expect(screen.queryByTestId('inline-model-switcher-reasoning')).toBeNull();
  });

  it('keeps reasoning effort on the composer row, in the user’s words, without opening the model menu', () => {
    const hosted = { id: 'codex', name: 'Codex', available: true, models: [{ id: 'default', label: 'Default (CLI config)' }],
      reasoningOptions: [{ id: 'default', label: 'Default' }, { id: 'xhigh', label: 'XHigh' }] } as AgentInfo;
    renderPicker({ agents: [hosted], config: { ...config, mode: 'daemon', agentId: 'codex' } } as never);
    const trigger = screen.getByTestId('inline-model-switcher-reasoning');
    expect(trigger.closest('[aria-hidden="true"]')).toBeNull();
    expect(trigger.textContent).toBe('Default');
    fireEvent.click(trigger);
    expect(Array.from(screen.getByTestId('inline-model-switcher-reasoning-menu')
      .querySelectorAll('[role="menuitemradio"]')).map((item) => item.textContent)).toEqual(['Default', 'Extra high']);
    expect(screen.getByTestId('inline-model-switcher-chip').textContent).not.toContain('CLI config');
  });

  it('leaves OpenCode out when no provider of the user is connected, and shows it once one is', () => {
    const opencode = (models: AgentInfo['models']) => ({ id: 'opencode', name: 'OpenCode', available: true, models } as AgentInfo);
    const first = renderPicker({ agents: [...agents.filter((agent) => agent.id !== 'opencode'), opencode([{ id: 'default', label: 'Default' }])] });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
    expect(screen.queryByRole('group', { name: 'OpenCode' })).toBeNull();
    expect(screen.queryByTestId('inline-model-switcher-agent-opencode')).toBeNull();
    first.unmount();
    renderPicker({ agents: [...agents.filter((agent) => agent.id !== 'opencode'), opencode([{ id: 'default', label: 'Default' }, { id: 'openai/gpt-5', label: 'openai/gpt-5' }])] });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
    expect(screen.getByTestId('inline-model-switcher-model-opencode-openai/gpt-5')).toBeTruthy();
  });

  it('hides account credits entirely when this build has no account service', () => {
    accountState.status = { availability: 'not_configured', signedIn: false, user: null };
    renderPicker();
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));

    expect(screen.queryByRole('group', { name: 'OpenPixo' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Local' })).toBeTruthy();
  });

  it('leaves out local CLIs that are not installed, and all of them while the daemon is down', () => {
    const missing = [
      { id: 'codex', name: 'Codex', available: false },
      { id: 'opencode', name: 'OpenCode', available: false },
    ] as AgentInfo[];
    const first = renderPicker({ agents: [...agents, ...missing] });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
    const local = screen.getByRole('group', { name: 'Local' });
    expect(within(local).queryByText('Codex')).toBeNull();
    expect(within(local).queryByText('OpenCode')).toBeNull();
    expect(within(local).queryByText('Install')).toBeNull();
    expect(screen.queryByTestId('inline-model-switcher-agent-codex')).toBeNull();
    expect(within(local).getByRole('group', { name: 'Claude Code' })).toBeTruthy();
    first.unmount();

    renderPicker({ agents: [...agents, ...missing], daemonLive: false });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
    expect(screen.queryByRole('group', { name: 'Local' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Claude Code' })).toBeNull();
  });

  it('drops the Local heading when nothing local can run, but keeps own keys and settings', () => {
    const none = [{ id: 'codex', name: 'Codex', available: false }, { id: 'claude', name: 'Claude Code', available: false }] as AgentInfo[];
    const first = renderPicker({ agents: none, config: { ...config, agentId: null, agentModels: {} } });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
    const menu = screen.getByTestId('inline-model-switcher-popover');
    expect(screen.queryByRole('group', { name: 'Local' })).toBeNull();
    expect(within(menu).queryByText('Local')).toBeNull();
    expect(screen.getByRole('group', { name: 'OpenPixo' })).toBeTruthy();
    expect(screen.getByTestId('inline-model-switcher-open-settings')).toBeTruthy();
    first.unmount();

    // An own key still lists its models under Local.
    renderPicker({ agents: none, config: { ...config, agentId: null, agentModels: {}, apiKey: 'local-user-key' } });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
    const local = screen.getByRole('group', { name: 'Local' });
    expect(within(local).getByRole('group', { name: 'Your own key' })).toBeTruthy();
  });

  it('shows each hosted model’s estimated cost against DeepSeek V4.1 Flash, and nothing without prices', () => {
    accountState.status = {
      availability: 'available',
      signedIn: true,
      user: { id: 'u1', email: 'test@example.com', provider: 'email', displayName: null, avatarUrl: null },
    };
    const hosted = { id: 'openpixo-agent', name: 'OpenPixo', available: true, models: [
      { id: 'openpixo-agent-flash', label: 'DeepSeek V4.1 Flash', creditsPerMillionTokens: { inputCacheMiss: 60, inputCacheHit: 1.2, output: 240 } },
      { id: 'openpixo-agent-gpt-6-luna', label: 'GPT-6 Luna',
        creditsPerMillionTokens: { inputCacheMiss: 20, inputCacheHit: 2, inputCacheWrite: 25, output: 100 } },
      { id: 'openpixo-agent-hy4', label: 'Tencent Hy4', creditsPerMillionTokens: { inputCacheMiss: 166.8, inputCacheHit: 8.4, output: 500.2 } },
      { id: 'openpixo-agent-new', label: 'New model' },
    ] } as AgentInfo;
    renderPicker({ agents: [...agents, hosted] });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));

    expect(screen.getByTestId('inline-model-switcher-cost-openpixo-agent-flash').textContent).toBe('1×');
    expect(screen.getByTestId('inline-model-switcher-cost-openpixo-agent-gpt-6-luna').textContent).toBe('0.5×');
    const hy4 = screen.getByTestId('inline-model-switcher-cost-openpixo-agent-hy4');
    expect(hy4.textContent).toBe('2.6×');
    expect(hy4.getAttribute('title')).toBe('Estimated use on a typical coding task, relative to DeepSeek V4.1 Flash');
    expect(screen.queryByTestId('inline-model-switcher-cost-openpixo-agent-new')).toBeNull();
    // Model rows read the model's name first.
    expect(screen.getByTestId('inline-model-switcher-model-openpixo-agent-openpixo-agent-hy4').textContent).toBe('Tencent Hy42.6×');
  });

  it('shows the daemon’s default hosted model when the user has not picked one, whatever the catalogue order', () => {
    accountState.status = {
      availability: 'available',
      signedIn: true,
      user: { id: 'u1', email: 'test@example.com', provider: 'email', displayName: null, avatarUrl: null },
    };
    const hosted = { id: 'openpixo-agent', name: 'OpenPixo', available: true, models: [
      { id: 'openpixo-agent-gpt-6-luna', label: 'GPT-6 Luna' },
      { id: 'openpixo-agent-flash', label: 'DeepSeek V4.1 Flash', default: true },
    ] } as AgentInfo;
    renderPicker({ agents: [hosted], config: { ...config, agentId: 'openpixo-agent', agentModels: {} } });
    expect(screen.getByTestId('inline-model-switcher-chip').getAttribute('aria-label')).toBe('OpenPixo · DeepSeek V4.1 Flash');
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
    expect(screen.getByRole('menuitemradio', { checked: true }).textContent).toBe('DeepSeek V4.1 Flash');
  });

  it('selects the agent together with a model from another local CLI', () => {
    const { onAgentChange, onAgentModelChange } = renderPicker({ agents: [
      ...agents,
      {
        id: 'codex', name: 'Codex', bin: 'codex', available: true,
        models: [{ id: 'codex-next', label: 'Codex Next' }],
      } as AgentInfo,
    ] });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
    fireEvent.click(screen.getByTestId('inline-model-switcher-model-codex-codex-next'));

    expect(onAgentChange).toHaveBeenCalledWith('codex');
    expect(onAgentModelChange.mock.calls[0]).toStrictEqual([
      'codex', { model: 'codex-next', serviceTier: undefined },
    ]);
  });

  it('marks the CLI default selected when an installed agent exposes no model catalogue', () => {
    renderPicker({
      config: { ...config, agentModels: {} },
      agents: [{ ...agents[0]!, models: [] }],
    });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));

    const local = screen.getByRole('group', { name: 'Local' });
    expect(within(local).getAllByRole('menuitemradio')).toHaveLength(1);
    expect(within(local).getByRole('menuitemradio', { checked: true })).toBeTruthy();
  });

  it('keeps the reasoning effort control reachable by keyboard outside the model menu', () => {
    const { onAgentModelChange } = renderPicker({ agents: [{
      ...agents[0]!,
      reasoningOptions: [
        { id: 'low', label: 'Low', default: true },
        { id: 'high', label: 'High' },
      ],
    }] });

    const effort = screen.getByTestId('inline-model-switcher-reasoning') as HTMLButtonElement;
    expect(effort.tabIndex).toBe(0);
    expect(screen.getByTestId('inline-model-switcher-popover').contains(effort)).toBe(false);
    effort.focus();
    expect(document.activeElement).toBe(effort);
    // Arrow keys open the level menu on the selected level; Enter on the next one picks it.
    fireEvent.keyDown(effort, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('inline-model-switcher-reasoning-low'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('inline-model-switcher-reasoning-high'));
    fireEvent.click(document.activeElement!);
    expect(onAgentModelChange).toHaveBeenCalledWith('claude', expect.objectContaining({ reasoning: 'high' }));
    expect(document.activeElement).toBe(effort);
  });

  it('discovers own-key models without a parent cache setter', async () => {
    vi.mocked(fetchProviderModels).mockResolvedValueOnce({
      ok: true,
      kind: 'success',
      latencyMs: 0,
      models: [{ id: 'fetched-extra', label: 'Fetched model' }],
    });
    renderPicker({
      config: { ...config, mode: 'api', apiKey: 'local-user-key' },
      providerModelsCache: undefined,
      onProviderModelsCacheChange: undefined,
    });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));

    expect(await screen.findByRole('menuitemradio', { name: 'Fetched model' })).toBeTruthy();
  });
});

describe('InlineModelSwitcher local lists', () => {
  const longOpenCode = {
    id: 'opencode', name: 'OpenCode', available: true,
    models: [{ id: 'default', label: 'Default' },
      ...Array.from({ length: 40 }, (_, index) => ({ id: `openrouter/vendor/model-${index}`, label: `openrouter/vendor/model-${index}` })),
      { id: 'openrouter/anthropic/claude-sonnet-5.5', label: 'openrouter/anthropic/claude-sonnet-5.5' }],
  } as AgentInfo;

  it('leaves out a CLI that reports it is signed out, unless it is the one chosen', () => {
    const signedOut = { id: 'codex', name: 'Codex CLI', available: true, authStatus: 'missing', models: [{ id: 'gpt-x', label: 'gpt-x' }] } as AgentInfo;
    renderPicker({ agents: [...agents, signedOut] });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
    expect(screen.queryByTestId('inline-model-switcher-model-codex-gpt-x')).toBeNull();
    cleanup();
    const chosenButSignedOut = { ...agents[0]!, authStatus: 'missing' } as AgentInfo;
    renderPicker({ agents: [chosenButSignedOut] });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
    expect(screen.getByTestId('inline-model-switcher-compact-model-next')).toBeTruthy();
  });

  it('shows a long OpenCode list as its default and a search, and finds the rest by name', () => {
    renderPicker({ agents: [...agents, longOpenCode] });
    fireEvent.click(screen.getByTestId('inline-model-switcher-chip'));
    expect(screen.getByTestId('inline-model-switcher-model-opencode-default')).toBeTruthy();
    expect(screen.queryByTestId('inline-model-switcher-model-opencode-openrouter/vendor/model-3')).toBeNull();
    const search = screen.getByTestId('inline-model-switcher-search-opencode');
    expect(search.getAttribute('placeholder')).toBe('Search 42 OpenCode models');
    fireEvent.change(search, { target: { value: 'sonnet' } });
    expect(screen.getByTestId('inline-model-switcher-model-opencode-openrouter/anthropic/claude-sonnet-5.5')).toBeTruthy();
    expect(screen.queryByTestId('inline-model-switcher-model-opencode-default')).toBeNull();
    fireEvent.change(search, { target: { value: 'nothing-like-this' } });
    expect(screen.getByText('No model matches.')).toBeTruthy();
    // Short lists are shown whole, with no search box.
    expect(screen.queryByTestId('inline-model-switcher-search-claude')).toBeNull();
  });
});
