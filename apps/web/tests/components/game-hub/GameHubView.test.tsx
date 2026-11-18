// @vitest-environment jsdom
// 游戏管理 against GET/DELETE/PATCH /api/published-games, stubbed at fetch.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnlineUsage, PublishedGameEntry, PublishedGamesResponse, RoomsUsage } from '@openpixo/contracts';

import { GameHubView } from '../../../src/components/game-hub/GameHubView';
import { filterGames, hoursLeft, isMultiplayerGame, onlineUsedPercent, parseLimit, playerHours, summarize, tileLetter, tileTone } from '../../../src/components/game-hub/game-hub-state';
import { I18nProvider } from '../../../src/i18n';
import { buildPath, parseRoute } from '../../../src/router';
import type { Locale } from '../../../src/i18n/types';

const { openExternalUrl } = vi.hoisted(() => ({ openExternalUrl: vi.fn(async (_url: string) => true) }));
vi.mock('../../../src/providers/registry', () => ({ openExternalUrl }));

const rooms = (over: Partial<RoomsUsage> = {}): RoomsUsage => ({
  month: '2026-11', freeMinutesTotal: 600, freeMinutesUsed: 90, playerMinutes: 0, creditsCharged: 0, monthlyCreditLimit: 500, openRooms: 0, ...over });
const online = (over: Partial<OnlineUsage> = {}): OnlineUsage => ({
  month: '2026-11', state: 'ok', gameRequests: 0, gameBytes: 0, players: 0, accountRequests: 1200, accountBytes: 4096,
  maxRequests: 1_000_000, maxBytes: 104_857_600, collections: {}, ...over });
const entry = (shareId: string, over: Partial<PublishedGameEntry> = {}): PublishedGameEntry => ({
  game: { shareId, url: `https://superpixo.example/${shareId}`, title: `Game ${shareId}`, version: 2, state: 'live',
    publishedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z', playsThisMonth: 7 },
  rooms: rooms(), online: online(), project: { id: `project-${shareId}`, name: `Project ${shareId}` }, ...over });

const SOLO = entry('solo');
const RACER = entry('racer', { online: online({ players: 12, gameRequests: 1200, collections: { laps: 12 } }) });
const ORPHAN = entry('orphan', { project: null, rooms: rooms({ playerMinutes: 90, creditsCharged: 3, openRooms: 1 }) });
const list = (games: PublishedGameEntry[] = [SOLO, RACER, ORPHAN], roomsPaused = false): PublishedGamesResponse => ({
  available: true, games,
  account: { paused: { publish: false, rooms: roomsPaused, online: false }, limits: { maxPlayers: 8, creditsPerPlayerHour: 5 },
    publishPlan: { planRequired: false, sku: 'plan_starter', maxLiveGames: 10, maxGameBytes: 104_857_600, liveGames: 3 },
    onlineAccount: { month: '2026-11', state: 'ok', requests: 1200, bytes: 4096, maxRequests: 1_000_000, maxBytes: 104_857_600 },
    // Includes a removed game's 2 credits, which no listed game shows.
    roomsAccount: { month: '2026-11', freeMinutesTotal: 600, freeMinutesUsed: 90, creditsCharged: 5, openRooms: 1 } } });

let answer: PublishedGamesResponse;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (path: string, method: string) => fetchMock.mock.calls.filter(([url, init]) => String(url) === path && ((init as RequestInit | undefined)?.method ?? 'GET') === method);

beforeEach(() => {
  answer = list();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    if (path === '/api/published-games' && method === 'GET') return Response.json(answer);
    if (path.startsWith('/api/published-games/') && method === 'DELETE') return Response.json({ ok: true });
    if (path.endsWith('/rooms') && method === 'PATCH') return Response.json({ usage: rooms() });
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const flush = async () => { await act(async () => {}); };
async function show(locale: Locale = 'en', props: Partial<Parameters<typeof GameHubView>[0]> = {}) {
  const onOpenProject = vi.fn();
  const onOpenAccount = vi.fn();
  render(<I18nProvider initial={locale}><GameHubView onOpenProject={onOpenProject} onOpenAccount={onOpenAccount} {...props} /></I18nProvider>);
  await flush();
  return { onOpenProject, onOpenAccount };
}
const rowOf = (title: string) => screen.getByRole('heading', { name: title }).closest('li') as HTMLElement;

describe('the game hub page', () => {
  it('lists every shared game in plain words, without link ids, versions or request counts', async () => {
    await show();
    expect(screen.getAllByTestId('game-hub-row')).toHaveLength(3);
    expect(within(rowOf('Game orphan')).getByText(/project is not on this computer anymore/u)).toBeTruthy();
    expect(within(rowOf('Game solo')).getByText('Plays this month: 7 · updated November 10')).toBeTruthy();
    expect(within(rowOf('Game racer')).getByText('Players with a saved score or progress: 12')).toBeTruthy();
    expect(within(rowOf('Game orphan')).getByText('Played together: 1.5 h')).toBeTruthy();
    expect(within(rowOf('Game orphan')).getByText('Rooms playing now: 1')).toBeTruthy();
    const page = screen.getByTestId('game-hub-view').textContent ?? '';
    for (const technical of ['Version', 'requests', '1,200', 'KB', 'Link id']) expect(page).not.toContain(technical);
    expect(screen.getByText('Games shared: 3')).toBeTruthy();
    expect(screen.getByText('Plays this month: 21')).toBeTruthy();
    expect(screen.getByText('Free hours of playing together left: 8')).toBeTruthy();
  });

  it('copies the link and opens the game to play', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await show();
    const row = rowOf('Game racer');
    fireEvent.click(within(row).getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(writeText).toHaveBeenCalledWith('https://superpixo.example/racer');
    expect(within(row).getByRole('button', { name: 'Copied, send it to a friend' })).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Play it' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://superpixo.example/racer');
  });

  it('filters to games played with others and to links with no project here', async () => {
    await show();
    fireEvent.click(screen.getByRole('tab', { name: /Played with others/u }));
    expect(screen.getAllByTestId('game-hub-row').map(row => within(row).getByRole('heading').textContent)).toEqual(['Game racer', 'Game orphan']);
    fireEvent.click(screen.getByRole('tab', { name: /Project not on this computer/u }));
    expect(screen.getAllByTestId('game-hub-row')).toHaveLength(1);
  });

  it('opens the game of a local project', async () => {
    const { onOpenProject } = await show();
    fireEvent.click(within(rowOf('Game solo')).getByRole('button', { name: 'Open game' }));
    expect(onOpenProject).toHaveBeenCalledWith('project-solo');
    expect(within(rowOf('Game orphan')).queryByRole('button', { name: 'Open game' })).toBeNull();
  });

  it('keeps stopping a share in Settings, and removes the link only after the creator confirms', async () => {
    await show();
    const row = rowOf('Game orphan');
    expect(within(row).queryByRole('button', { name: /Remove link/u })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Settings' }));
    fireEvent.click(within(row).getByRole('button', { name: /Remove link/u }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/cannot be shared again from here/u)).toBeTruthy();
    answer = list([SOLO, RACER]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove link' }));
    await flush();
    expect(calls('/api/published-games/orphan', 'DELETE')).toHaveLength(1);
    expect(calls('/api/published-games', 'GET')).toHaveLength(2);
    expect(screen.getAllByTestId('game-hub-row')).toHaveLength(2);
  });

  it('saves the monthly spending limit for playing together and refuses one the cloud would not take', async () => {
    await show();
    const row = rowOf('Game orphan');
    fireEvent.click(within(row).getByRole('button', { name: 'Settings' }));
    const input = within(row).getByRole('textbox', { name: 'Most to spend on playing together each month' });
    expect(within(row).getByText(/Spent this month: 3 credits/u)).toBeTruthy();
    fireEvent.change(input, { target: { value: '1.5' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(within(row).getByText(/whole number/u)).toBeTruthy();
    fireEvent.change(input, { target: { value: '900' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await flush();
    const patch = calls('/api/published-games/orphan/rooms', 'PATCH');
    expect(patch).toHaveLength(1);
    expect(JSON.parse(String((patch[0]![1] as RequestInit).body))).toEqual({ monthlyCreditLimit: 900 });
  });

  it('says playing together is coming soon while rooms are off, and hides live rooms', async () => {
    answer = list(undefined, true);
    await show();
    expect(screen.getByText('Playing together is coming soon')).toBeTruthy();
    expect(screen.queryByText('Rooms playing now: 1')).toBeNull();
  });

  it('speaks up about the online allowance only when it is nearly used, and about free time when it is gone', async () => {
    await show();
    expect(screen.queryByText(/allowance for leaderboards and saves/u)).toBeNull();
    expect(screen.queryByText(/free time for playing together is used up/u)).toBeNull();
    cleanup();
    answer = list();
    answer.account!.onlineAccount = { ...answer.account!.onlineAccount!, requests: 850_000 };
    answer.account!.roomsAccount = { ...answer.account!.roomsAccount, freeMinutesUsed: 600 };
    await show();
    expect(screen.getByText(/85% of this month's allowance/u)).toBeTruthy();
    expect(screen.getByText(/free time for playing together is used up/u)).toBeTruthy();
  });

  it('asks the creator to sign in, and offers a retry when the list fails', async () => {
    answer = { available: false, unavailableReason: 'signed_out', games: [] };
    const { onOpenAccount } = await show();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onOpenAccount).toHaveBeenCalled();
    cleanup();
    fetchMock.mockImplementationOnce(async () => new Response('down', { status: 503 }));
    await show();
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
  });

  it('shows the empty state in Chinese', async () => {
    answer = list([]);
    await show('zh-CN');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('你分享出去的游戏');
    expect(screen.getByText(/你还没有分享过游戏/u)).toBeTruthy();
  });
});

describe('game hub decisions', () => {
  it('counts a game as multiplayer only once players used it', () => {
    expect(isMultiplayerGame(SOLO)).toBe(false);
    expect(isMultiplayerGame(RACER)).toBe(true);
    expect(isMultiplayerGame(ORPHAN)).toBe(true);
    expect(filterGames([SOLO, RACER, ORPHAN], 'orphans')).toEqual([ORPHAN]);
  });

  it('takes room totals from the account, not the listed games, and rounds free time down', () => {
    expect(summarize(list())).toMatchObject({ plan: { live: 3, max: 10, extra: 0 }, roomsCredits: 5, openRooms: 1, totalPlays: 21,
      roomsFree: { usedMinutes: 90, totalMinutes: 600 } });
    expect(hoursLeft(90, 600)).toEqual({ left: 8, total: 10 });
    expect(hoursLeft(700, 600)).toEqual({ left: 0, total: 10 });
  });

  it('warns from 80% of the larger allowance, gives every game a stable tile, and rounds hours', () => {
    expect(onlineUsedPercent({ requests: 10, bytes: 90, maxRequests: 100, maxBytes: 100 })).toBe(90);
    expect(onlineUsedPercent({ requests: 0, bytes: 0, maxRequests: 0, maxBytes: 0 })).toBe(0);
    expect(tileTone('racer')).toBe(tileTone('racer'));
    expect(tileLetter('  sky hop')).toBe('S');
    expect(tileLetter('勇者')).toBe('勇');
    expect(playerHours(90)).toBe(1.5);
    expect(playerHours(5)).toBe(0.1);
  });

  it('accepts only whole limits the cloud takes', () => {
    expect(parseLimit(' 900 ')).toBe(900);
    expect(parseLimit('10000000')).toBe(10_000_000);
    for (const text of ['', '-1', '1.5', '10000001', 'abc']) expect(parseLimit(text)).toBeNull();
  });

  it('has its own address', () => {
    expect(parseRoute('/game-hub')).toEqual({ kind: 'home', view: 'game-hub' });
    expect(buildPath({ kind: 'home', view: 'game-hub' })).toBe('/game-hub');
  });
});
