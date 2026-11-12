// @vitest-environment jsdom
// The Share dialog's online features against the daemon routes in specs/current/online-features.md, stubbed at fetch.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnlineStatusResponse, OnlineUsage, RoomsStatusResponse } from '@openpixo/contracts';

import { nextMonthStart, onlineStateNotice, ShareOnline } from '../../../src/components/game/ShareOnline';
import { SharePlayTogether } from '../../../src/components/game/SharePlayTogether';
import { I18nProvider } from '../../../src/i18n';
import { en } from '../../../src/i18n/locales/en';
import { zhCN } from '../../../src/i18n/locales/zh-CN';
import type { Locale } from '../../../src/i18n/types';

const { openExternalUrl } = vi.hoisted(() => ({ openExternalUrl: vi.fn(async (_url: string) => true) }));
vi.mock('../../../src/providers/registry', () => ({ openExternalUrl }));

const usage = (over: Partial<OnlineUsage> = {}): OnlineUsage => ({
  month: '2026-11', state: 'ok', gameRequests: 1200, gameBytes: 4096, players: 14, accountRequests: 250_000, accountBytes: 31_457_280,
  maxRequests: 1_000_000, maxBytes: 104_857_600, collections: { scores: 14 }, ...over,
});
const online = (over: Partial<OnlineStatusResponse> = {}): OnlineStatusResponse => ({
  sdkInstalled: false, usage: null, local: { players: 0, collections: {} }, ...over,
});

type Route = (method: string, init?: RequestInit) => Response | undefined;
let state: OnlineStatusResponse;
let routes: Record<string, Route>;
let fetchMock: ReturnType<typeof vi.fn>;

const calls = (suffix: string, method = 'GET') => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method);

beforeEach(() => {
  openExternalUrl.mockReset();
  openExternalUrl.mockImplementation(async () => true);
  state = online();
  routes = {};
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const route = Object.entries(routes).find(([suffix]) => path.endsWith(suffix));
    const handled = route?.[1](method, init);
    if (handled) return handled;
    if (path.endsWith('/api/projects/game/online') && method === 'GET') return Response.json(state);
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const flush = async () => { await act(async () => {}); };

function element(props: Partial<Parameters<typeof ShareOnline>[0]> = {}, locale: Locale = 'en') {
  return <I18nProvider initial={locale}>
    <ShareOnline projectId="game" hidden={false} refreshKey={1} published={false} onAskAi={vi.fn()} {...props} />
  </I18nProvider>;
}
async function show(props: Partial<Parameters<typeof ShareOnline>[0]> = {}, locale: Locale = 'en') {
  const view = render(element(props, locale));
  await flush();
  return { ...view, update: (next: Partial<Parameters<typeof ShareOnline>[0]>) => view.rerender(element({ ...props, ...next }, locale)) };
}
const section = () => within(screen.getByTestId('share-online'));

describe('what it is and adding it', () => {
  it('says what online features are and offers three presets for the AI', async () => {
    const onAskAi = vi.fn();
    await show({ onAskAi });
    expect(section().getByRole('heading', { name: 'Online features' })).toBeTruthy();
    expect(section().getByText(/Players don't have to be online at the same time/u)).toBeTruthy();
    expect(screen.getByTestId('share-online-state').textContent).toBe(en['gameOnline.notAdded']);
    expect(screen.queryByTestId('share-online-test')).toBeNull();
    const group = section().getByRole('group', { name: 'Ask the AI to add' });
    fireEvent.click(within(group).getByRole('button', { name: 'A leaderboard' }));
    fireEvent.click(within(group).getByRole('button', { name: 'Racing ghosts' }));
    fireEvent.click(within(group).getByRole('button', { name: 'Async battles' }));
    expect(onAskAi.mock.calls.map(([prompt]) => prompt)).toEqual([en['gameOnline.promptLeaderboard'], en['gameOnline.promptGhosts'], en['gameOnline.promptBattles']]);
    for (const [prompt] of onAskAi.mock.calls) expect(prompt).toMatch(/pixo online seed.*pixo online test/u);
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method)).toHaveLength(0);
  });

  it('reads only while visible, and again when the dialog re-reads', async () => {
    const view = await show({ hidden: true });
    expect(fetchMock).not.toHaveBeenCalled();
    view.update({ hidden: false });
    await flush();
    expect(calls('/online')).toHaveLength(1);
    view.update({ hidden: true });
    await flush();
    view.update({ hidden: false });
    await flush();
    expect(calls('/online')).toHaveLength(1);
    view.update({ hidden: false, refreshKey: 2 });
    await flush();
    expect(calls('/online')).toHaveLength(2);
  });

  it('offers a retry when the status cannot be read', async () => {
    routes['/online'] = () => new Response('down', { status: 500 });
    await show();
    expect(screen.getByTestId('share-online-failed').textContent).toBe("Couldn't check online features.");
    delete routes['/online'];
    fireEvent.click(section().getByRole('button', { name: 'Try again' }));
    await flush();
    expect(screen.getByTestId('share-online-state')).toBeTruthy();
  });
});

describe('testing on this computer', () => {
  it('shows test data counts and opens the local test through the app', async () => {
    state = online({ sdkInstalled: true, sdkPath: 'src/openpixo-online.ts', local: { players: 21, collections: { ghosts: 21, teams: 3 } } });
    const url = 'http://127.0.0.1:5173/?pixoOnline=http%3A%2F%2F127.0.0.1%3A7456%2Fapi%2Fonline%2Flocal%2Fgame';
    routes['/online/test'] = () => Response.json({ url, emulatorUrl: 'http://127.0.0.1:7456/api/online/local/game' });
    await show();
    expect(screen.getByTestId('share-online-state').textContent).toBe('Added to this game.');
    expect(within(screen.getByTestId('share-online-counts')).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Test players: 21', 'ghosts: 21', 'teams: 3']);
    fireEvent.click(screen.getByTestId('share-online-test'));
    await flush();
    expect(calls('/online/test', 'POST')).toHaveLength(1);
    expect(openExternalUrl).toHaveBeenCalledWith(url);
  });

  it('shows the address when the window cannot be opened, and refuses one that is not local', async () => {
    state = online({ sdkInstalled: true });
    routes['/online/test'] = () => Response.json({ url: 'http://localhost:5173/?pixoOnline=x', emulatorUrl: 'x' });
    openExternalUrl.mockResolvedValue(false);
    await show();
    fireEvent.click(screen.getByTestId('share-online-test'));
    await flush();
    expect(screen.getByTestId('share-online-unopened').textContent).toContain('http://localhost:5173/?pixoOnline=x');
    routes['/online/test'] = () => Response.json({ url: 'https://evil.example/', emulatorUrl: 'x' });
    openExternalUrl.mockClear();
    fireEvent.click(screen.getByTestId('share-online-test'));
    await flush();
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(screen.getByTestId('share-online-error').textContent).toBe("That didn't work. Try again.");
  });

  it('adds 20 test players, re-reads the counts and can clear them', async () => {
    routes['/online/seed'] = method => {
      if (method !== 'POST') return undefined;
      state = online({ local: { players: 20, collections: {} } });
      return Response.json({ players: 20, docs: 0 });
    };
    routes['/online/data'] = method => {
      if (method !== 'DELETE') return undefined;
      state = online();
      return Response.json({ players: 0, collections: {} });
    };
    await show();
    expect(screen.queryByTestId('share-online-clear-test')).toBeNull();
    fireEvent.click(screen.getByTestId('share-online-seed'));
    await flush();
    expect(JSON.parse(String((calls('/online/seed', 'POST')[0]![1] as RequestInit).body))).toEqual({ players: 20 });
    expect(screen.getByTestId('share-online-notice').textContent).toBe('Added 20 test players.');
    expect(screen.getByTestId('share-online-counts').textContent).toContain('Test players: 20');
    fireEvent.click(screen.getByTestId('share-online-clear-test'));
    await flush();
    expect(calls('/online/data', 'DELETE')).toHaveLength(1);
    expect(screen.getByText('No test data yet.')).toBeTruthy();
    expect(screen.getByTestId('share-online-notice').textContent).toBe('Test data cleared.');
  });

  it('shows the daemon\'s words when seeding is refused', async () => {
    routes['/online/seed'] = () => Response.json({ error: { code: 'BAD_REQUEST', message: 'A game can have at most 20 collections.' } }, { status: 413 });
    await show();
    fireEvent.click(screen.getByTestId('share-online-seed'));
    await flush();
    expect(screen.getByTestId('share-online-error').textContent).toBe('A game can have at most 20 collections.');
  });
});

describe('the public game', () => {
  it('shows this month against the plan, included in the plan', async () => {
    state = online({ sdkInstalled: true, usage: usage() });
    await show({ published: true });
    const panel = within(screen.getByTestId('share-online-usage'));
    expect(panel.getByText('Requests, all your games').nextSibling?.textContent).toBe('250,000 of 1,000,000');
    expect(panel.getByText('Saved data, all your games').nextSibling?.textContent).toBe('30 MB of 100 MB');
    expect(panel.getByText('Players in this game').nextSibling?.textContent).toBe('14');
    expect(panel.getByText(/never charged per use/u)).toBeTruthy();
    expect(screen.queryByTestId('share-online-state-notice')).toBeNull();
  });

  it.each([
    [{ state: 'read-only', stateReason: 'requests-cap' }, "read-only until December 1, 2026", true],
    [{ state: 'read-only', stateReason: 'no-plan' }, 'has no plan', true],
    [{ state: 'read-only', stateReason: 'storage-cap' }, "reached your plan's storage", true],
    [{ state: 'paused', stateReason: 'paused' }, "aren't open yet", false],
  ] as const)('explains %j in plain words', async (over, words, upgrade) => {
    const onUpgrade = vi.fn();
    state = online({ sdkInstalled: true, usage: usage(over) });
    await show({ published: true, onUpgrade });
    expect(screen.getByTestId('share-online-state-notice').textContent).toContain(words);
    if (upgrade) {
      fireEvent.click(screen.getByTestId('share-online-upgrade'));
      expect(onUpgrade).toHaveBeenCalledTimes(1);
    } else expect(screen.queryByTestId('share-online-upgrade')).toBeNull();
  });

  it('warns before idle data is deleted', async () => {
    state = online({ usage: usage({ idleDeleteAt: '2027-03-09T00:00:00Z' }) });
    await show({ published: true });
    expect(screen.getByTestId('share-online-idle').textContent).toContain('deleted on March 9, 2027');
  });

  it('says it could not ask when signed out or offline', async () => {
    state = online({ cloudUnknown: true });
    await show({ published: true });
    expect(screen.getByTestId('share-online-unknown').textContent).toContain('Sign in and check your connection');
    expect(screen.queryByTestId('share-online-usage')).toBeNull();
  });

  it('clears the public game\'s data only after a confirmation', async () => {
    state = online({ sdkInstalled: true, usage: usage() });
    routes['/online/hosted'] = method => method === 'DELETE' ? Response.json({ ok: true }) : undefined;
    await show({ published: true });
    fireEvent.click(screen.getByTestId('share-online-clear-hosted'));
    await flush();
    const confirm = within(screen.getByRole('alertdialog'));
    expect(confirm.getByText(/deleted for good/u)).toBeTruthy();
    expect(calls('/online/hosted', 'DELETE')).toHaveLength(0);
    fireEvent.click(confirm.getByRole('button', { name: 'Clear online data' }));
    await flush();
    expect(calls('/online/hosted', 'DELETE')).toHaveLength(1);
    expect(screen.getByTestId('share-online-notice').textContent).toBe("Your public game's online data was cleared.");
  });

  it('has nothing to clear before publishing', async () => {
    await show({ published: false });
    expect(screen.queryByTestId('share-online-clear-hosted')).toBeNull();
    expect(screen.queryByTestId('share-online-usage')).toBeNull();
  });
});

describe('inside Play together', () => {
  const rooms: RoomsStatusResponse = { sdkInstalled: false, usage: null, paused: false, maxPlayers: 8, creditsPerPlayerHour: 5 };

  it('mounts beside rooms and hands each preset\'s prompt to the dialog, and none for multiplayer', async () => {
    const onAskAi = vi.fn();
    render(<I18nProvider initial="en">
      <SharePlayTogether projectId="game" rooms={rooms} failed={false} published={false} pausedKnown onRetry={vi.fn()} onSaved={async () => {}} onAskAi={onAskAi} />
    </I18nProvider>);
    await flush();
    const play = within(screen.getByTestId('share-play'));
    expect(play.getByTestId('share-online')).toBeTruthy();
    fireEvent.click(play.getByTestId('share-online-ask-ghosts'));
    fireEvent.click(play.getByTestId('share-ask-ai'));
    expect(onAskAi.mock.calls).toEqual([[en['gameOnline.promptGhosts']], []]);
  });
});

describe('words', () => {
  it('speaks Chinese', async () => {
    state = online({ sdkInstalled: true, usage: usage({ state: 'read-only', stateReason: 'requests-cap' }), local: { players: 2, collections: { scores: 2 } } });
    await show({ published: true }, 'zh-CN');
    expect(section().getByRole('heading', { name: '在线功能' })).toBeTruthy();
    expect(screen.getByTestId('share-online-state-notice').textContent).toContain('2026年12月1日');
    expect(screen.getByTestId('share-online-counts').textContent).toContain('测试玩家：2');
  });

  it('keeps technical words out of what the creator reads', () => {
    for (const dictionary of [en, zhCN]) {
      const copy = Object.entries(dictionary).filter(([key]) => key.startsWith('gameOnline.') && !key.startsWith('gameOnline.prompt'));
      expect(copy.length).toBeGreaterThan(30);
      for (const [, value] of copy) expect(value).not.toMatch(/\b(SDK|emulator|Durable|Worker|backend|API|token|seed|JSON)\b/i);
    }
  });

  it('works out when read-only ends and which notice applies', () => {
    expect(nextMonthStart('2026-12')).toBe('2027-01-01T00:00:00.000Z');
    expect(onlineStateNotice(usage())).toBeNull();
    expect(onlineStateNotice(usage({ state: 'read-only' }))).toEqual({ key: 'gameOnline.requestsCap', upgrade: true });
    expect(onlineStateNotice(usage({ state: 'paused' }))).toEqual({ key: 'gameOnline.paused', upgrade: false });
  });
});
