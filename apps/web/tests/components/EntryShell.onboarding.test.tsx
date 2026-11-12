// @vitest-environment jsdom

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryShell } from '../../src/components/EntryShell';
import { AgentSetup, ONBOARDING_LOCAL_AUTO_TEST_DELAY_MS } from '../../src/components/onboarding/AgentSetup';

import { I18nProvider } from '../../src/i18n';
import { fetchProjectFiles } from '../../src/providers/registry';
import type { AgentInfo, AppConfig } from '../../src/types';
import { setHomeHeroPrompt } from '../helpers/home-hero-lexical';

const analyticsMocks = vi.hoisted(() => ({
  track: vi.fn(),
}));

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return {
    ...actual,
    useAnalytics: () => ({
      newRequestId: vi.fn(() => 'request-1'),
      setConfigureGlobals: vi.fn(),
      setConsent: vi.fn(),
      setIdentity: vi.fn(),
      track: analyticsMocks.track,
    }),
    useAppVersion: () => null,
  };
});

const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function codexAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'codex',
    name: 'Codex',
    bin: 'codex',
    available: true,
    models: [{ id: 'codex-model', label: 'Codex Model' }],
    ...overrides,
  };
}

function cliAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    bin: 'claude',
    available: true,
    version: '1.0.0',
    models: [{ id: 'sonnet', label: 'Sonnet' }],
    ...overrides,
  };
}

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    mode: 'daemon',
    agentId: null,
    agentModels: {},
    apiProtocol: 'anthropic',
    apiProtocolConfigs: {},
    apiKey: '',
    baseUrl: '',
    model: '',
    ...overrides,
  } as AppConfig;
}

function renderOnboarding(
  overrides: Partial<React.ComponentProps<typeof EntryShell>> = {},
) {
  window.history.replaceState(null, '', '/onboarding');
  const props: React.ComponentProps<typeof EntryShell> = {
    skills: [],

    projects: [],

    promptTemplates: [],
    config: baseConfig(),
    agents: [codexAgent(), cliAgent()],
    daemonLive: true,
    onModeChange: vi.fn(),
    onAgentChange: vi.fn(),
    onAgentModelChange: vi.fn(),
    onApiProtocolChange: vi.fn(),
    onApiModelChange: vi.fn(),
    onConfigPersist: vi.fn(),
    onRefreshAgents: vi.fn(() => [codexAgent(), cliAgent()]),
    onCreateProject: vi.fn(),
    onBeginProjectCreation: () => ({ projectId: 'optimistic-project', rollback: () => undefined }),

    onCreatePluginShareProject: vi.fn(),

    onOpenProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onRenameProject: vi.fn(),
    onOpenSettings: vi.fn(),
    onCompleteOnboarding: vi.fn(),
    ...overrides,
  };

  function Harness() {
    const [config, setConfig] = useState(props.config);
    return (
      <I18nProvider initial="en">
        <AgentSetup
          {...props}
          config={config}
          onFinish={() => props.onCompleteOnboarding?.()}
          onConfigPersist={(next) => {
            props.onConfigPersist(next);
            setConfig(next as AppConfig);
          }}
        />
      </I18nProvider>
    );
  }

  render(
    <Harness />,
  );

  return props;
}

function renderHome(
  overrides: Partial<React.ComponentProps<typeof EntryShell>> = {},
  path = '/',
) {
  window.history.replaceState(null, '', path);
  const props: React.ComponentProps<typeof EntryShell> = {
    skills: [],

    projects: [],

    promptTemplates: [],
    config: baseConfig({
      agentId: 'claude-code',
      agentModels: { 'claude-code': { model: 'sonnet' } },
    }),
    agents: [cliAgent()],
    daemonLive: true,
    onModeChange: vi.fn(),
    onAgentChange: vi.fn(),
    onAgentModelChange: vi.fn(),
    onApiProtocolChange: vi.fn(),
    onApiModelChange: vi.fn(),
    onConfigPersist: vi.fn(),
    onRefreshAgents: vi.fn(() => [cliAgent()]),
    onCreateProject: vi.fn(),
    onBeginProjectCreation: () => ({ projectId: 'optimistic-project', rollback: () => undefined }),

    onCreatePluginShareProject: vi.fn(),

    onOpenProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onRenameProject: vi.fn(),
    onOpenSettings: vi.fn(),
    onCompleteOnboarding: vi.fn(),
    ...overrides,
  };

  render(
    <I18nProvider initial="en">
      <EntryShell {...props} />
    </I18nProvider>,
  );

  return props;
}

function trackedEvents(name: string) {
  return analyticsMocks.track.mock.calls.filter(([eventName]) => eventName === name);
}

function latestTrackedEvent<T extends Record<string, unknown>>(name: string): T {
  const calls = trackedEvents(name);
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]?.[1] as T;
}



function chooseOnboardingOption(label: string, option: string | RegExp) {
  const chipField = screen
    .getAllByText(label)
    .map((node) => node.closest('.onboarding-chip-field'))
    .find((node): node is HTMLElement => node instanceof HTMLElement);
  if (chipField) {
    const matcher = option instanceof RegExp ? option : new RegExp(option, 'i');
    const chip = Array.from(chipField.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      matcher.test(button.textContent ?? ''),
    );
    if (!(chip instanceof HTMLButtonElement)) {
      throw new Error(`profile chip not found: ${label} / ${String(option)}`);
    }
    fireEvent.click(chip);
    return;
  }

  const dropdownField = screen
    .getAllByText(label)
    .map((node) => node.closest('.onboarding-view__select-field'))
    .find((node): node is HTMLElement => node instanceof HTMLElement);
  if (!dropdownField) throw new Error(`profile field not found: ${label}`);
  const trigger = dropdownField.querySelector('button');
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new Error(`profile field trigger not found: ${label}`);
  }
  fireEvent.click(trigger);
  fireEvent.click(
    screen.getByRole('option', {
      name: option instanceof RegExp ? option : new RegExp(option, 'i'),
    }),
  );
}



// Setup is one list of AI rows: each detected agent, then "API key".
async function openSetup() {
  await screen.findByRole('radiogroup', { name: 'How OpenPixo runs tasks' });
}

async function openLocalRuntimeSetup() {
  await openSetup();
  expect(await screen.findByTestId('onboarding-local-panel')).toBeTruthy();
}

async function openByokRuntimeSetup() {
  await openSetup();
  const byok = screen.getByRole('radio', { name: 'Use an API key' });
  if (byok.getAttribute('aria-checked') !== 'true') fireEvent.click(byok);
  expect(await screen.findByTestId('onboarding-byok-panel')).toBeTruthy();
}

function verifyButton(): HTMLElement {
  return screen.getByRole('button', { name: /^(Continue|Checking…)$/i });
}

function connectionTestCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/test/connection'));
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.ResizeObserver = originalResizeObserver;
  vi.useRealTimers();
  analyticsMocks.track.mockReset();
  window.sessionStorage.clear();
});

beforeEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  analyticsMocks.track.mockReset();
});

describe('OpenPixo local-first setup', () => {
  it('lists each detected agent and an API-key row in one choice, with the configured agent selected', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({})) as typeof fetch;
    renderOnboarding({ config: baseConfig({ agentId: 'claude-code' }) });
    await openSetup();

    const group = await screen.findByRole('radiogroup', { name: 'How OpenPixo runs tasks' });
    const local = await screen.findByRole('radio', { name: 'Claude Code' });
    const byok = screen.getByRole('radio', { name: 'Use an API key' });
    expect(group.contains(local) && group.contains(byok)).toBe(true);
    expect(local.getAttribute('aria-checked')).toBe('true');
    expect(byok.getAttribute('aria-checked')).toBe('false');
    // Copy does not promise an agent the selection logic did not pick.
    expect(screen.queryByText(/Codex is the default/i)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Getting started' })).toBeNull();
  });

  it('offers the existing API path with its OpenCode limitation', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ loggedIn: false }));
    renderOnboarding({ config: baseConfig({ agentId: 'codex' }), agents: [cliAgent({ id: 'codex', name: 'Codex', bin: 'codex' })] });
    await openByokRuntimeSetup();
    // The OpenCode requirement shows only when it is not met, with the install command.
    expect(await screen.findByText(/OpenCode isn't installed yet/)).toBeTruthy();
    expect(screen.queryByText(/BYOK/)).toBeNull();
  });

  it('shows native provider requirements and blocks setup when Codex is missing', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ loggedIn: false }));
    renderOnboarding({
      config: baseConfig({ mode: 'api', apiProtocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'synthetic-key' }),
      agents: [cliAgent({ id: 'byok-opencode', name: 'BYOK OpenCode', bin: 'opencode' })],
    });
    await openSetup();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('This provider needs Codex CLI installed on this computer.');
    expect(verifyButton().getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: /^Skip check$/i })).toBeNull();
  });
});

describe('EntryShell settings menu', () => {
  it('opens settings from the signed-out rail without duplicating the footer action', async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/community/discord')) {
        return jsonResponse({
          inviteCode: 'mHAjSMV6gz',
          inviteUrl: 'https://discord.gg/mHAjSMV6gz',
          onlineCount: 1234,
          memberCount: 4321,
          fetchedAt: Date.now(),
          stale: false,
        });
      }
      if (url.endsWith('/api/github/openpixo')) {
        return jsonResponse({
          repo: 'example-org/plugin-fixtures',
          stargazers_count: 56100,
          fetchedAt: Date.now(),
          stale: false,
        });
      }
      return jsonResponse({});
    }) as typeof fetch;
    const props = renderHome();

    // The signed-out rail's own settings item (below 扩展) is the single
    // settings entry — the #5517 footer carries none.
    fireEvent.click(await screen.findByTestId('entry-settings-button'));

    expect(props.onOpenSettings).toHaveBeenCalledWith();
    expect(screen.getAllByTestId('entry-settings-button')).toHaveLength(1);
  });
});

describe('EntryShell navigation shortcuts', () => {
  afterEach(() => {
    window.localStorage.removeItem('pixo.entry.railOpen.v2');
  });

  it('leaves the rail unchanged when the composer owns Cmd/Ctrl+B', async () => {
    window.localStorage.setItem('pixo.entry.railOpen.v2', 'false');
    renderHome();

    const entry = document.querySelector('.entry');
    expect(entry).toBeInstanceOf(HTMLElement);
    expect(entry?.classList.contains('entry--rail-open')).toBe(false);

    const editor = await screen.findByTestId('home-hero-input');
    fireEvent.keyDown(editor, {
      key: 'b',
      ...(/Mac|iPod|iPhone|iPad/.test(navigator.platform)
        ? { metaKey: true }
        : { ctrlKey: true }),
    });

    expect(entry?.classList.contains('entry--rail-open')).toBe(false);
  });

  it('opens the rail by default and persists only an explicit toggle', async () => {
    // The old key was written on every mount, so it records the old collapsed
    // default rather than a choice — it must not keep the rail shut.
    window.localStorage.setItem('pixo.entry.railOpen', 'false');
    renderHome();

    const entry = document.querySelector('.entry');
    expect(entry?.classList.contains('entry--rail-open')).toBe(true);
    // Mounting writes nothing: an untouched default stays a default.
    expect(window.localStorage.getItem('pixo.entry.railOpen.v2')).toBeNull();

    fireEvent.click(screen.getByTestId('entry-nav-rail-toggle'));
    expect(entry?.classList.contains('entry--rail-open')).toBe(false);
    expect(window.localStorage.getItem('pixo.entry.railOpen.v2')).toBe('false');

    window.dispatchEvent(new CustomEvent('pixo:entry-rail-toggle'));
    await waitFor(() => expect(entry?.classList.contains('entry--rail-open')).toBe(true));
    expect(window.localStorage.getItem('pixo.entry.railOpen.v2')).toBe('true');
    window.localStorage.removeItem('pixo.entry.railOpen');
  });
});



describe('EntryShell route scroll isolation', () => {
  afterEach(() => {
    window.localStorage.removeItem('pixo.entry.railOpen.v2');
  });

  function entryScrollContainer(): HTMLElement {
    const scrollContainer = document.querySelector('.entry-main--scroll');
    expect(scrollContainer).toBeInstanceOf(HTMLElement);
    if (!(scrollContainer instanceof HTMLElement)) {
      throw new Error('entry scroll container not found');
    }
    return scrollContainer;
  }

  // Store is a rail destination that exists in every state, and the reset
  // it exercises is the same shared `.entry-main--scroll` element.
  it('resets the shared scroll offset when navigating away from Home', async () => {
    window.localStorage.setItem('pixo.entry.railOpen.v2', 'true');
    renderHome();

    const scrollContainer = entryScrollContainer();
    scrollContainer.scrollTop = 280;
    fireEvent.click(screen.getByTestId('entry-nav-store'));

    await waitFor(() => {
      expect(
        screen.getByTestId('entry-view-home').getAttribute('data-active'),
      ).toBe('false');
    });
    expect(window.location.pathname).toBe('/store');
    expect(scrollContainer.scrollTop).toBe(0);
  });

  it('resets the shared scroll offset when navigating from Projects to Home', async () => {
    window.localStorage.setItem('pixo.entry.railOpen.v2', 'true');
    renderHome({}, '/projects');

    const scrollContainer = entryScrollContainer();
    scrollContainer.scrollTop = 360;
    fireEvent.click(screen.getByTestId('entry-nav-home'));

    await waitFor(() => {
      expect(screen.getByTestId('entry-view-home').getAttribute('data-active')).toBe('true');
    });
    expect(scrollContainer.scrollTop).toBe(0);
  });
});

describe('EntryShell project reopen request priority', () => {
  // The catalogue grid — and its background cover scan — lives on the 项目
  // page now that Home carries no grid on either branch (OPEND-2683 /
  // OPEND-3140); the invariant is unchanged, the surface moved.
  it('aborts the 项目 page cover work, keeps hidden Projects idle, and lets the foreground files read finish', async () => {
    const files = [{
      name: 'index.html',
      path: 'index.html',
      kind: 'html' as const,
      mtime: 1,
      size: 1,
      mime: 'text/html',
    }];
    const fileRequests: Array<RequestInit | undefined> = [];
    const fetchMock = vi.fn(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof Request
            ? input.url
            : String(input);
        if (url === '/api/projects/project-reopen/files') {
          // Single-flight (`lib/shared-cancellable-get`) gives every `/files`
          // reader — cancellable or not — one shared request carrying the
          // shared AbortSignal, so "is this the background scan?" is the
          // request ordinal, not the presence of a signal. Request #1 is
          // the 项目 page's cover scan and must hang until it is aborted; the
          // foreground read that follows it must be answered.
          const isBackgroundCoverScan = fileRequests.length === 0;
          fileRequests.push(init);
          if (isBackgroundCoverScan) {
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                'abort',
                () => reject(new DOMException('Aborted', 'AbortError')),
                { once: true },
              );
            });
          }
          return jsonResponse({ files });
        }
        if (url.includes('/api/live-artifacts?projectId=project-reopen')) {
          return jsonResponse({ });
        }
        if (url.endsWith('/api/community/discord')) {
          return jsonResponse({
            inviteCode: 'mHAjSMV6gz',
            inviteUrl: 'https://discord.gg/mHAjSMV6gz',
            onlineCount: 0,
            memberCount: 0,
            fetchedAt: Date.now(),
            stale: false,
          });
        }
        if (url.endsWith('/api/github/openpixo')) {
          return jsonResponse({
            repo: 'example-org/plugin-fixtures',
            stargazers_count: 0,
            fetchedAt: Date.now(),
            stale: false,
          });
        }
        return jsonResponse({});
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const onOpenProject = vi.fn((projectId: string) => {
      expect(projectId).toBe('project-reopen');
      // App leaves EntryShell when it opens ProjectView. Model that boundary
      // directly so the mounted strip must cancel its background probe.
      cleanup();
    });

    renderHome({
      projects: [{
        id: 'project-reopen',
        name: 'Reopen project',
        skillId: null,
        createdAt: 1,
        updatedAt: 2,
        status: { value: 'not_started' },
      }],
      onOpenProject,
    }, '/drafts');

    await waitFor(() => expect(fileRequests).toHaveLength(1));
    const homeSignal = fileRequests[0]?.signal;
    expect(homeSignal).toBeDefined();
    expect(screen.getByTestId('recent-projects-strip')).toBeTruthy();
    // ProjectsPanel is mounted under EntryShell's hidden Projects pane, but its
    // own background files/live-artifact scans must remain dormant.
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/api/live-artifacts?projectId=project-reopen'),
      ),
    ).toHaveLength(0);

    // The rail (open by default) lists the same project; drive the strip's.
    fireEvent.click(within(screen.getByTestId('recent-projects-strip')).getByRole('button', { name: /Reopen project/ }));

    expect(onOpenProject).toHaveBeenCalledTimes(1);
    expect(homeSignal?.aborted).toBe(true);
    await expect(fetchProjectFiles('project-reopen')).resolves.toEqual(files);
    expect(fileRequests).toHaveLength(2);
    // The foreground read must own a live request of its own: it neither joins
    // the abandoned scan's dead entry nor inherits its aborted signal.
    const foregroundSignal = fileRequests[1]?.signal;
    expect(foregroundSignal).toBeDefined();
    expect(foregroundSignal).not.toBe(homeSignal);
    expect(foregroundSignal?.aborted).toBe(false);
  });
});

describe('EntryShell new project rail', () => {
  // The rail's "+ New project" button (`entry-nav-new-project`) is gone in
  // #5517's rail: `EntryShell` still passes `onNewProject` — with its
  // `new_project_plus` ui_click — to `EntryNavRail`, but the rail never renders
  // a control that calls it, so the button and that analytics event are both
  // unreachable. The spec that drove it is therefore removed; opening the
  // new-project modal is still covered by the Projects-view CTA below, which is
  // the surviving entry point.

  it('opens the new project modal from the Projects view new-project button', async () => {
    const fetchMock = vi.fn(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (url === '/api/projects' && init?.method === 'POST') {
          return jsonResponse({
            project: {
              id: 'blank-project-from-projects',
              name: 'Untitled',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            conversationId: 'conversation-2',
          });
        }
        if (url.endsWith('/api/projects/project-existing/files')) {
          return jsonResponse({ files: [] });
        }
        if (url.endsWith('/api/live-artifacts?projectId=project-existing')) {
          return jsonResponse({ });
        }
        if (url.endsWith('/api/community/discord')) {
          return jsonResponse({
            inviteCode: 'mHAjSMV6gz',
            inviteUrl: 'https://discord.gg/mHAjSMV6gz',
            onlineCount: 0,
            memberCount: 0,
            fetchedAt: Date.now(),
            stale: false,
          });
        }
        if (url.endsWith('/api/github/openpixo')) {
          return jsonResponse({
            repo: 'example-org/plugin-fixtures',
            stargazers_count: 0,
            fetchedAt: Date.now(),
            stale: false,
          });
        }
        return jsonResponse({});
      });
    globalThis.fetch = fetchMock as typeof fetch;
    // Start directly on the Projects view (/projects). The nav rail no longer
    // has a single "Projects" button — the projects list is its own route,
    // reachable via /projects or Home's "view all" — so drive the ProjectsPanel's
    // own new-project CTA rather than a removed rail button.
    const props = renderHome({
      projects: [
        {
          id: 'project-existing',
          name: 'Existing project',
          skillId: null,
          createdAt: 1,
          updatedAt: 2,
          status: { value: 'not_started' },
        },
      ],
    }, '/projects');

    fireEvent.click(screen.getByTestId('designs-new-project'));

    await waitFor(() => {
      expect(screen.getByTestId('new-project-modal')).toBeTruthy();
    });
    expect(screen.getByTestId('new-project-panel')).toBeTruthy();
    expect(props.onOpenProject).not.toHaveBeenCalled();
    expect(props.onCreateProject).not.toHaveBeenCalled();
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) => input === '/api/projects' && init?.method === 'POST',
    );
    expect(createCall).toBeUndefined();
    expect(analyticsMocks.track).toHaveBeenCalledWith(
      'ui_click',
      expect.objectContaining({
        page_name: 'projects',
        area: 'list_controls',
        element: 'create_project',
      }),
      undefined,
    );
  });
});

describe('EntryShell Home submit handoff', () => {
  it('keeps the Home run button in sending state until project creation resolves', async () => {
    globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/plugins')) return jsonResponse({ plugins: [] });
      if (url.endsWith('/api/mcp/servers')) return jsonResponse({ servers: [] });
      if (url.endsWith('/api/community/discord')) return jsonResponse({ stale: true });
      if (url.endsWith('/api/github/openpixo')) return jsonResponse({ stale: true });
      return jsonResponse({});
    }) as typeof fetch;
    let resolveCreate: (accepted: boolean) => void = () => undefined;
    const onCreateProject = vi.fn(
      (_input: { pluginId?: string }) => new Promise<boolean>((resolve) => { resolveCreate = resolve; }),
    );
    renderHome({ onCreateProject });

    await screen.findByTestId('home-hero-input');
    setHomeHeroPrompt('Build a landing page');
    const submit = await screen.findByTestId('home-hero-submit') as HTMLButtonElement;
    fireEvent.click(submit);

    await waitFor(() => expect(onCreateProject).toHaveBeenCalledTimes(1));
    expect(onCreateProject).toHaveBeenCalledWith(expect.objectContaining({
      pendingPrompt: 'Build a landing page',
      conversationMode: 'design',
    }));
    // HomeView's hidden default-router identity is provenance, not an
    // explicit user plugin choice on the public create contract.
    expect(onCreateProject.mock.calls[0]?.[0]?.pluginId).toBeUndefined();
    expect(submit.disabled).toBe(true);
    // The arrow stays visually stable while creation is in flight: no spinner,
    // no busy state — the disabled lock above is the whole sending treatment.
    expect(submit.getAttribute('aria-busy')).toBe('false');
    expect(submit.getAttribute('aria-label')).toBe('Run');

    resolveCreate(true);
    await waitFor(() => expect(submit.disabled).toBe(false));
  });
});

describe('EntryShell local CLI and BYOK onboarding', () => {
  it.each([
    ['Local CLI', baseConfig({ mode: 'daemon', agentId: 'claude-code' })],
    ['BYOK', baseConfig({
      mode: 'api',
      agentId: 'codex',
      apiKey: 'persisted-key',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
    })],
  ])('keeps Home available for signed-out %s execution', async (_label, config) => {
    globalThis.fetch = vi.fn(async () => jsonResponse({})) as typeof fetch;

    renderHome({ config });

    expect(await screen.findByTestId('home-hero-input')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
    expect(
      screen.queryByRole('heading', { name: /Describe a game\.\s+Play it\./ }),
    ).toBeNull();
  });

  it('says what verification costs before it runs', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({})) as typeof fetch;
    renderOnboarding({
      config: baseConfig({ agentId: 'claude-code', agentModels: { 'claude-code': { model: 'sonnet' } } }),
    });
    await openLocalRuntimeSetup();
    expect(
      screen.getByText(/Continue sends Claude Code one short test message/i),
    ).toBeTruthy();
  });

  it('verifies the local agent, stays on failure with the reason, and retries', async () => {
    let testCalls = 0;
    const fetchMock = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/test/connection') && init?.method === 'POST') {
        testCalls += 1;
        return testCalls === 1
          ? jsonResponse({
              ok: false,
              kind: 'agent_spawn_failed',
              latencyMs: 12,
              model: 'sonnet',
              agentName: 'Claude Code',
              detail: 'process exited before responding',
            })
          : jsonResponse({
              ok: true,
              kind: 'success',
              latencyMs: 12,
              model: 'sonnet',
              sample: 'pong',
              agentName: 'Claude Code',
            });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const props = renderOnboarding({
      config: baseConfig({
        agentId: 'claude-code',
        agentModels: { 'claude-code': { model: 'sonnet' } },
      }),
    });

    await openLocalRuntimeSetup();
    expect(verifyButton().getAttribute('aria-disabled')).toBeNull();

    fireEvent.click(verifyButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't verify the connection");
    expect(alert.textContent).toMatch(/Could not start Claude Code/i);
    expect(props.onCompleteOnboarding).not.toHaveBeenCalled();

    fireEvent.click(verifyButton());
    await waitFor(() => {
      expect(testCalls).toBe(2);
      expect(props.onCompleteOnboarding).toHaveBeenCalledTimes(1);
    });
    expect(props.onConfigPersist).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'daemon', agentId: 'claude-code' }),
    );
    expect(latestTrackedEvent('onboarding_complete_result')).toMatchObject({
      result: 'completed',
      exit_step_name: 'runtime_setup',
      runtime_type: 'local_cli',
    });
  });

  it('never validates on its own', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    globalThis.fetch = fetchMock as typeof fetch;
    renderOnboarding({
      config: baseConfig({
        agentId: 'claude-code',
        agentModels: { 'claude-code': { model: 'sonnet' } },
      }),
    });

    await openLocalRuntimeSetup();
    await new Promise((resolve) => setTimeout(resolve, ONBOARDING_LOCAL_AUTO_TEST_DELAY_MS + 250));
    expect(connectionTestCalls(fetchMock)).toHaveLength(0);
  });

  it('sends the selected agent, model and environment when verifying', async () => {
    const fetchMock = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/test/connection') && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          kind: 'success',
          latencyMs: 12,
          model: 'sonnet',
          sample: 'pong',
          agentName: 'Claude Code',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const props = renderOnboarding({
      config: baseConfig({
        agentId: 'claude-code',
        agentCliEnv: { 'claude-code': { PIXO_TEST: '1' } },
        agentModels: { 'claude-code': { model: 'sonnet', reasoning: 'high' } },
      }),
      agents: [codexAgent(), cliAgent()],
      onRefreshAgents: vi.fn(() => [codexAgent(), cliAgent()]),
    });

    await openLocalRuntimeSetup();
    fireEvent.click(verifyButton());

    await waitFor(() => {
      expect(props.onCompleteOnboarding).toHaveBeenCalledTimes(1);
    });
    const calls = connectionTestCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({
      mode: 'agent',
      agentId: 'claude-code',
      model: 'sonnet',
      reasoning: 'high',
      agentCliEnv: { 'claude-code': { PIXO_TEST: '1' } },
    });
  });

  it('shows the install command when the verified agent is missing', async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/test/connection') && init?.method === 'POST') {
        return jsonResponse({
          ok: false,
          kind: 'agent_not_installed',
          latencyMs: 0,
          agentName: 'Codex',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    renderOnboarding({
      config: baseConfig({ agentId: 'codex' }),
      agents: [codexAgent()],
      onRefreshAgents: vi.fn(() => [codexAgent()]),
    });

    await openLocalRuntimeSetup();
    fireEvent.click(verifyButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Codex is not installed or not in PATH.');
    expect(alert.textContent).toContain('npm install -g @openai/codex');
  });

  it('shows the sign-in command when the agent needs a login', async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/test/connection') && init?.method === 'POST') {
        return jsonResponse({
          ok: false,
          kind: 'agent_auth_required',
          latencyMs: 0,
          agentName: 'Codex',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    renderOnboarding({
      config: baseConfig({ agentId: 'codex' }),
      agents: [codexAgent()],
      onRefreshAgents: vi.fn(() => [codexAgent()]),
    });

    await openLocalRuntimeSetup();
    fireEvent.click(verifyButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Codex needs you to sign in first.');
    expect(alert.textContent).toContain('codex login');
  });

  it('continues with a detected local agent without verifying it', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    globalThis.fetch = fetchMock as typeof fetch;
    const props = renderOnboarding({
      config: baseConfig({
        agentId: 'claude-code',
        agentModels: { 'claude-code': { model: 'sonnet' } },
      }),
    });

    await openLocalRuntimeSetup();
    fireEvent.click(screen.getByRole('button', { name: /^Skip check$/i }));

    await waitFor(() => {
      expect(props.onCompleteOnboarding).toHaveBeenCalledTimes(1);
    });
    expect(connectionTestCalls(fetchMock)).toHaveLength(0);
    expect(props.onConfigPersist).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'daemon', agentId: 'claude-code' }),
    );
    expect(
      trackedEvents('ui_click')
        .map(([, payload]) => payload as Record<string, unknown>)
        .some((payload) => payload.element === 'continue_unverified'),
    ).toBe(true);
  });

  it('shows elapsed time while verifying and lets the user cancel', async () => {
    let aborted = false;
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/test/connection') && init?.method === 'POST') {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;
    const props = renderOnboarding({
      config: baseConfig({
        agentId: 'claude-code',
        agentModels: { 'claude-code': { model: 'sonnet' } },
      }),
    });

    await openLocalRuntimeSetup();
    fireEvent.click(verifyButton());

    const status = await screen.findByText(/Waiting for Claude Code to reply/i);
    expect(status.textContent).toMatch(/\d+ s/);
    expect(verifyButton().hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(aborted).toBe(true);
      expect(screen.queryByText(/Waiting for Claude Code to reply/i)).toBeNull();
    });
    expect(verifyButton().hasAttribute('disabled')).toBe(false);
    expect(props.onCompleteOnboarding).not.toHaveBeenCalled();
  });

  it('turns a missing agent into install steps, a rescan and an API-key way out', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({})) as typeof fetch;
    const missing = [
      codexAgent({ available: false, installUrl: 'https://github.com/openai/codex' }),
      cliAgent({ id: 'claude', name: 'Claude Code', available: false }),
    ];
    const onRefreshAgents = vi.fn(() => missing);
    renderOnboarding({
      config: baseConfig({ agentId: null }),
      agents: missing,
      onRefreshAgents,
    });

    const panel = await screen.findByTestId('onboarding-missing-agents');
    expect(panel.textContent).toContain('No coding agent found yet');
    expect(panel.textContent).toContain('npm install -g @openai/codex');
    expect(panel.textContent).toContain('npm install -g @anthropic-ai/claude-code');
    expect(panel.textContent).toContain('npm install -g opencode-ai');
    expect(screen.getAllByRole('button', { name: /Install guide/i })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Skip check$/i })).toBeNull();

    // Someone who has never opened a terminal hands the install to an AI app they already have.
    expect(panel.textContent).toContain('Never used a terminal?');
    expect(screen.getAllByRole('button', { name: /^Copy for your AI:/ })).toHaveLength(3);
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Copy for your AI: Claude Code' }));
      expect(await screen.findByRole('button', { name: /^Copied\. Paste it to your AI: Claude Code$/ })).toBeTruthy();
      const copied = String((writeText.mock.calls as unknown as string[][])[0]?.[0]);
      expect(copied).toContain('install and sign in to Claude Code');
      expect(copied).toContain('`npm install -g @anthropic-ai/claude-code`');
    } finally {
      vi.unstubAllGlobals();
    }

    fireEvent.click(screen.getAllByRole('button', { name: /Rescan$/i }).at(-1)!);
    await waitFor(() => {
      expect(onRefreshAgents).toHaveBeenCalled();
    });

    // The API-key row sits right in the same list.
    fireEvent.click(screen.getByRole('radio', { name: 'Use an API key' }));
    expect(await screen.findByTestId('onboarding-byok-panel')).toBeTruthy();
  });

  it('uses provider preferences instead of the first upstream model during BYOK onboarding', async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/provider/models') && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          kind: 'success',
          latencyMs: 10,
          models: [
            { id: 'upstream-first', label: 'Upstream First' },
            { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const props = renderOnboarding({
      config: baseConfig({
        apiProtocol: 'anthropic',
        apiKey: 'test-api-key',
        baseUrl: 'https://api.anthropic.com',
        model: '',
        apiProviderBaseUrl: 'https://api.anthropic.com',
      }),
    });

    await openByokRuntimeSetup();
    fireEvent.click(screen.getByRole('button', { name: /Load models this key can use/i }));

    await waitFor(() => {
      expect(props.onApiModelChange).toHaveBeenCalledWith('claude-sonnet-4-5');
    });
    expect(props.onApiModelChange).not.toHaveBeenCalledWith('upstream-first');
  });

  it('replaces a default model the account does not offer with one it does', async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/provider/models') && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          kind: 'success',
          latencyMs: 10,
          models: [
            { id: 'upstream-first', label: 'Upstream First' },
            { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const props = renderOnboarding({
      config: baseConfig({
        mode: 'api',
        apiProtocol: 'anthropic',
        apiKey: 'test-api-key',
        baseUrl: 'https://api.anthropic.com',
        // The app's initial default, never picked by the user.
        model: 'claude-sonnet-4-5',
        apiProviderBaseUrl: 'https://api.anthropic.com',
      }),
    });

    await openByokRuntimeSetup();
    fireEvent.click(screen.getByRole('button', { name: /Load models this key can use/i }));

    await waitFor(() => {
      expect(props.onApiModelChange).toHaveBeenCalledWith('claude-opus-4-5');
    });
  });

  it('verifies BYOK, stays on a rate limit, offers to continue anyway, and retries', async () => {
    let testCalls = 0;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/provider/models') && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          kind: 'success',
          latencyMs: 10,
          models: [{ id: 'gpt-test', label: 'GPT Test' }],
        });
      }
      if (url.endsWith('/api/test/connection') && init?.method === 'POST') {
        testCalls += 1;
        return testCalls === 1
          ? jsonResponse({
              ok: false,
              kind: 'rate_limited',
              latencyMs: 12,
              model: 'gpt-test',
              status: 429,
            })
          : jsonResponse({
              ok: true,
              kind: 'success',
              latencyMs: 12,
              model: 'gpt-test',
              sample: 'Connected',
            });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const props = renderOnboarding({
      config: baseConfig({
        mode: 'api',
        apiProtocol: 'openai',
        apiKey: 'test-api-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-test',
        apiProviderBaseUrl: 'https://api.openai.com/v1',
      }),
    });

    await openByokRuntimeSetup();
    expect(verifyButton().getAttribute('aria-disabled')).toBeNull();
    // An untested key never finishes onboarding by default.
    expect(screen.queryByRole('button', { name: /^Skip check$/i })).toBeNull();

    fireEvent.click(verifyButton());
    expect(await screen.findByText(/rate-limited the test/i)).toBeTruthy();
    expect(props.onCompleteOnboarding).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Skip check$/i })).toBeTruthy();

    fireEvent.click(verifyButton());
    await waitFor(() => {
      expect(testCalls).toBe(2);
      expect(props.onCompleteOnboarding).toHaveBeenCalledTimes(1);
    });
  });

  it('does not offer to skip verification after the key was rejected', async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/provider/models') && init?.method === 'POST') {
        return jsonResponse({ ok: true, kind: 'success', latencyMs: 10, models: [{ id: 'gpt-test', label: 'GPT Test' }] });
      }
      if (url.endsWith('/api/test/connection') && init?.method === 'POST') {
        return jsonResponse({ ok: false, kind: 'auth_failed', latencyMs: 12, model: 'gpt-test', status: 401 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const props = renderOnboarding({
      config: baseConfig({
        mode: 'api',
        apiProtocol: 'openai',
        apiKey: 'test-api-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-test',
        apiProviderBaseUrl: 'https://api.openai.com/v1',
      }),
    });

    await openByokRuntimeSetup();
    fireEvent.click(verifyButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Check that the API key is correct');
    expect(screen.queryByRole('button', { name: /^Skip check$/i })).toBeNull();
    expect(props.onCompleteOnboarding).not.toHaveBeenCalled();
  });

  it('drops a BYOK validation that lands after its inputs changed', async () => {
    // The inputs stay editable while the check is in flight. A success for the
    // key the user has already replaced must not complete onboarding.
    let releaseTest: ((value: Response) => void) | undefined;
    let testCalls = 0;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/provider/models') && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          kind: 'success',
          latencyMs: 10,
          models: [{ id: 'gpt-test', label: 'GPT Test' }],
        });
      }
      if (url.endsWith('/api/test/connection') && init?.method === 'POST') {
        testCalls += 1;
        return new Promise<Response>((resolve) => {
          releaseTest = resolve;
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const props = renderOnboarding({
      config: baseConfig({
        mode: 'api',
        apiProtocol: 'openai',
        apiKey: 'test-api-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-test',
        apiProviderBaseUrl: 'https://api.openai.com/v1',
      }),
    });

    await openByokRuntimeSetup();
    fireEvent.click(verifyButton());
    await waitFor(() => {
      expect(testCalls).toBe(1);
    });

    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'rotated-api-key' },
    });

    await act(async () => {
      releaseTest?.(
        jsonResponse({
          ok: true,
          kind: 'success',
          latencyMs: 12,
          model: 'gpt-test',
          sample: 'Connected',
        }),
      );
      await Promise.resolve();
    });

    expect(props.onCompleteOnboarding).not.toHaveBeenCalled();
    expect(screen.getByTestId('onboarding-byok-panel')).toBeTruthy();
  });

  it('persists the BYOK config before finishing onboarding', async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/provider/models') && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          kind: 'success',
          latencyMs: 10,
          models: [
            { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
            { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
          ],
        });
      }
      if (url.endsWith('/api/test/connection') && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          kind: 'success',
          latencyMs: 12,
          model: 'claude-opus-4-8',
          sample: 'Connected',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const props = renderOnboarding();

    await openByokRuntimeSetup();
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'test-api-key' } });
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://api.anthropic.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Load models this key can use/i }));
    await waitFor(() => {
      expect(screen.getByText('Fetched 2 models.')).toBeTruthy();
    });
    chooseOnboardingOption('Model', /claude-opus-4-8/i);
    fireEvent.click(verifyButton());

    await waitFor(() => {
      expect(props.onCompleteOnboarding).toHaveBeenCalledTimes(1);
    });
    expect(props.onApiModelChange).toHaveBeenCalledWith('claude-opus-4-8');
    expect((props.onConfigPersist as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toMatchObject({
      mode: 'api',
      apiProtocol: 'anthropic',
      apiKey: 'test-api-key',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-opus-4-8',
      apiProviderBaseUrl: null,
    });
    expect(latestTrackedEvent('onboarding_complete_result')).toMatchObject({
      result: 'completed',
      exit_step_name: 'runtime_setup',
      runtime_type: 'byok',
    });
  });

  it('has no Back step and never completes onboarding on its own', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ loggedIn: false, profile: 'prod', user: null, configPath: '/x' }),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const props = renderOnboarding();
    await act(async () => {});

    // The runtime choice is a radio group, not a back/forward toggle, and the
    // old "Skip for now" exit stays gone: finishing always picks a runtime.
    expect(screen.queryByRole('button', { name: /^Back$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Skip for now/i })).toBeNull();
    expect(props.onCompleteOnboarding).not.toHaveBeenCalled();
    expect(trackedEvents('onboarding_complete_result')).toHaveLength(0);
  });
});
