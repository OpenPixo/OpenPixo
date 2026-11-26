// @vitest-environment jsdom
// 动态角色 against /api/motion/*, stubbed at fetch. jsdom draws no WebGL, so the player is a stand-in here.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MotionCharacter, MotionCharactersResponse, MotionJob, MotionPortrait, MotionStatus } from '@openpixo/contracts';

import { MotionPage } from '../../../src/components/motion/MotionPage';
import { I18nProvider } from '../../../src/i18n';
import type { Locale } from '../../../src/i18n/types';
import { refreshMotionStatus } from '../../../src/providers/motion';
import { buildPath, parseRoute } from '../../../src/router';

vi.mock('../../../src/hooks/useOpenPixoAccount', () => ({
  useOpenPixoAccount: () => ({ status: { availability: 'available', signedIn: true, user: null }, loading: false, failed: false }),
  useOpenPixoCredits: () => ({ credits: { available: 100, reserved: 0, subscription: null } }),
  isCloudAccountAvailable: () => true,
}));
const actor = { canvas: null as unknown as HTMLCanvasElement, moods: ['calm', 'happy'], update: vi.fn(), mood: vi.fn((name: string) => name), talk: vi.fn(), lookAt: vi.fn(), lookAway: vi.fn() };
const player = { createPixoMotion: vi.fn(async () => actor) };
vi.mock('../../../src/components/motion/motion-player', () => ({ loadMotionPlayer: async () => player, canShowMotion: () => true }));

const PORTRAIT = '11111111-2222-4333-8444-555555555555', ID = '22222222-2222-4333-8444-555555555555', OTHER = '33333333-2222-4333-8444-555555555555', at = '2026-11-27T00:00:00.000Z';
const portrait = (change: Partial<MotionPortrait> = {}): MotionPortrait => ({ id: PORTRAIT, state: 'painting', text: 'a fox knight', fromPicture: false, used: false, errorCode: null, createdAt: at, expiresAt: at, ...change });
const job = (change: Partial<MotionJob> = {}): MotionJob => ({ id: 'job-00000001', characterId: ID, state: 'building', progress: 0.5, creditsReserved: 60, creditsCharged: null, errorCode: null, createdAt: at, updatedAt: at, ...change });
const fox = (change: Partial<MotionCharacter> = {}): MotionCharacter => ({ id: ID, name: 'Fox Knight', state: 'ready', portraitId: PORTRAIT, file: { bytes: 4, sha256: 'a'.repeat(64) }, job: null, createdAt: at, updatedAt: at, ...change });

let status: MotionStatus, answer: MotionCharactersResponse, painted: MotionPortrait, fetchMock: ReturnType<typeof vi.fn>;
const sent = (path: string, method: string): unknown[] => fetchMock.mock.calls.filter(([url, init]) => String(url) === path && (init?.method ?? 'GET') === method).map(([, init]) => init?.body ?? null);
const flush = async (): Promise<void> => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };

beforeEach(async () => {
  actor.canvas = document.createElement('canvas');
  status = { available: true, signedIn: true, service: { paused: false, priceVersion: 1, price: 60, portraitsPerDay: 10, portraitsLeft: 7 } };
  answer = { characters: [fox()], suggestions: [] };
  painted = portrait({ state: 'ready' });
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input), method = init?.method ?? 'GET';
    if (path === '/api/motion/service') return Response.json(status);
    if (path === '/api/motion/characters') return Response.json(answer);
    if (path === '/api/motion/portraits' && method === 'POST') return Response.json(portrait());
    if (path === `/api/motion/portraits/${PORTRAIT}`) return Response.json(painted);
    if (path === '/api/motion/jobs' && method === 'POST') return Response.json(job({ state: 'waiting', progress: 0 }));
    if (path === `/api/motion/characters/${ID}/file`) return new Response(new Uint8Array([1, 2, 3, 4]));
    if (path === `/api/motion/characters/${ID}/install`) return Response.json({ characterId: ID, slug: 'fox-knight', name: 'Fox Knight', file: 'public/assets/characters/fox-knight.pxmo', engine: 'phaser', player: [], playerState: 'written', usage: 'await addPixoMotion(this, x, y, \'fox-knight\')' });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  await refreshMotionStatus();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

async function show(props: Partial<Parameters<typeof MotionPage>[0]> = {}, locale: Locale = 'en') {
  const onOpenAccount = vi.fn(), onOpenProject = vi.fn();
  render(<I18nProvider initial={locale}><MotionPage characterId={undefined} games={[{ id: 'game', name: 'Foxhole' }]} onOpenAccount={onOpenAccount} onOpenProject={onOpenProject} {...props} /></I18nProvider>);
  await flush();
  await flush();
  return { onOpenAccount, onOpenProject };
}

describe('the page', () => {
  it('has an address of its own', () => {
    expect(parseRoute('/motion')).toEqual({ kind: 'home', view: 'motion' });
    expect(parseRoute(`/motion/${ID}`)).toEqual({ kind: 'home', view: 'motion', motionId: ID });
    expect(buildPath({ kind: 'home', view: 'motion', motionId: ID })).toBe(`/motion/${ID}`);
  });

  it('shows nothing of a build without the service, and asks to sign in', async () => {
    status = { available: false, signedIn: false, service: null };
    await refreshMotionStatus();
    await show({}, 'zh-CN');
    expect(screen.getByText('这个版本没有动态角色功能。')).toBeTruthy();
    expect(sent('/api/motion/characters', 'GET')).toEqual([]);
    cleanup();
    status = { available: true, signedIn: false, service: null };
    await refreshMotionStatus();
    const { onOpenAccount } = await show();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onOpenAccount).toHaveBeenCalled();
  });

  it('lists what there is, what is being made with its steps, and what did not work out', async () => {
    answer.characters = [fox(), fox({ id: OTHER, name: 'Owl', state: 'making', file: null, job: job() }), fox({ id: '44444444-2222-4333-8444-555555555555', name: 'Lost', state: 'failed', file: null, job: job({ state: 'failed', errorCode: 'MOTION_BUILD_FAILED' }) })];
    await show();
    const cards = screen.getAllByTestId('motion-card');
    expect(cards.map(c => c.dataset.state)).toEqual(['ready', 'making', 'failed']);
    expect(cards[0]!.querySelector('img')!.getAttribute('src')).toBe(`/api/motion/characters/${ID}/poster`);
    expect(within(cards[1]!).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    expect(cards[1]!.textContent).toContain('Putting it together');
    expect(cards[2]!.textContent).toContain('could not be put together');
    expect(cards[2]!.textContent).toContain('Your credits were returned.');
  });
});

describe('making one', () => {
  it('paints a portrait, takes it, shows the price and orders with one request id', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await show();
    expect(screen.getByText('7 portraits left today')).toBeTruthy();
    fireEvent.change(screen.getByTestId('motion-text'), { target: { value: 'a fox knight' } });
    await act(async () => { fireEvent.click(screen.getByTestId('motion-paint')); });
    await flush();
    const form = sent('/api/motion/portraits', 'POST')[0] as FormData;
    expect(form.get('text')).toBe('a fox knight');
    expect(String(form.get('requestId'))).toMatch(/\w{8}/u);
    expect(screen.getByTestId('motion-painting')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(2_000); });
    await flush();
    const shown = screen.getByTestId('motion-portrait');
    expect(within(shown).getByRole('img').getAttribute('src')).toBe(`/api/motion/portraits/${PORTRAIT}/picture`);
    expect(within(shown).getByTestId('motion-again').textContent).toContain('7 left today');

    fireEvent.click(screen.getByTestId('motion-use'));
    expect(screen.getByText('Price: 60 credits')).toBeTruthy();
    const make = screen.getByTestId('motion-make') as HTMLButtonElement;
    expect(make.textContent).toBe('Make it (60 credits)');
    expect(make.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('motion-name'), { target: { value: ' Fox Knight ' } });
    await act(async () => { fireEvent.click(make); });
    await flush();
    const [order] = sent('/api/motion/jobs', 'POST').map(body => JSON.parse(String(body)) as { portraitId: string; name: string; requestId: string });
    expect(order).toMatchObject({ portraitId: PORTRAIT, name: 'Fox Knight', requestId: expect.stringMatching(/\w{8}/u) });
    expect(window.location.pathname).toBe(`/motion/${ID}`);
  });

  it('says why a portrait did not work out, and starts over', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    painted = portrait({ state: 'failed', errorCode: 'MOTION_CONTENT_BLOCKED' });
    await show();
    fireEvent.change(screen.getByTestId('motion-text'), { target: { value: 'a fox knight' } });
    await act(async () => { fireEvent.click(screen.getByTestId('motion-paint')); });
    await flush();
    await act(async () => { vi.advanceTimersByTime(2_000); });
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('Describe it in other words');
    expect(screen.getByTestId('motion-describe')).toBeTruthy();
  });
});

describe('one moving character', () => {
  it('moves, tries moods and talking, downloads and goes into a game', async () => {
    const { onOpenProject } = await show({ characterId: ID });
    await flush();
    const stage = screen.getByTestId('motion-stage');
    expect(stage.dataset.state).toBe('shown');
    expect(player.createPixoMotion).toHaveBeenCalledWith(expect.any(ArrayBuffer), { width: 512, height: 640 });
    expect(stage.contains(actor.canvas)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Happy' }));
    expect(actor.mood).toHaveBeenCalledWith('happy');
    fireEvent.click(screen.getByTestId('motion-talk'));
    expect(actor.talk).toHaveBeenCalled();
    expect(screen.getByTestId('motion-download').getAttribute('href')).toBe(`/api/motion/characters/${ID}/file?download=1`);
    await act(async () => { fireEvent.click(screen.getByTestId('motion-install')); });
    await flush();
    expect(sent(`/api/motion/characters/${ID}/install`, 'POST').map(body => JSON.parse(String(body)) as unknown)).toEqual([{ projectId: 'game' }]);
    expect(screen.getByText(/await addPixoMotion/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open game' }));
    expect(onOpenProject).toHaveBeenCalledWith('game');
  });

  it('shows the steps while it is made', async () => {
    answer.characters = [fox({ state: 'making', file: null, job: job({ state: 'checking', progress: 0.3 }) })];
    await show({ characterId: ID });
    const progress = screen.getByTestId('motion-progress');
    expect([...progress.querySelectorAll('li')].map(li => li.textContent)).toEqual(['Portrait', 'Painting', 'Checking', 'Putting it together', 'Finishing']);
    expect(within(progress).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('30');
    expect(player.createPixoMotion).not.toHaveBeenCalled();
  });
});
