// @vitest-environment jsdom
// 角色 against /api/characters/*, stubbed at fetch. jsdom draws no WebGL, so what moves is tested in the engine and in browsers.
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterBrief, CharacterGear, CharactersResponse, CharactersStatus, LocalCharacter } from '@openpixo/contracts';

import { CharactersPage } from '../../../src/components/characters/CharactersPage';
import { slidersFor } from '../../../src/components/characters/MotionsPanel';
import { same } from '../../../src/components/characters/Wardrobe';
import { I18nProvider } from '../../../src/i18n';
import type { Locale } from '../../../src/i18n/types';
import { readPacket, refreshCharactersStatus } from '../../../src/providers/characters';
import { buildPath, parseRoute } from '../../../src/router';

vi.mock('../../../src/hooks/useOpenPixoAccount', () => ({
  useOpenPixoAccount: () => ({ status: { availability: 'available', signedIn: true, user: null }, loading: false, failed: false }),
  useOpenPixoCredits: () => ({ credits: { available: 100, reserved: 0, subscription: null } }),
  isCloudAccountAvailable: () => true,
}));

const ID = '11111111-2222-4333-8444-555555555555', OTHER = '22222222-2222-4333-8444-555555555555', at = '2026-11-25T00:00:00.000Z';
const hero = (change: Partial<LocalCharacter> = {}): LocalCharacter => ({
  id: ID, name: 'Mail Carrier', body: 'angular', style: 'ink', state: 'ready', revision: 2, items: { sets: [], weapons: [{ id: 'weapon0', label: 'Pick' }], capes: [] }, fits: [], outfits: [],
  motions: [{ name: 'idle', builtIn: true, shown: '', tuning: {} }, { name: 'dodge', builtIn: false, shown: 'Rolls away', tuning: {} }], changed: false, job: null, games: [], createdAt: at, updatedAt: at, ...change,
});
const job = (state: NonNullable<LocalCharacter['job']>['state'], change = {}): LocalCharacter['job'] => ({ id: OTHER, characterId: ID, kind: 'character', state, creditsReserved: 80, creditsCharged: null, delivered: null, errorCode: null, createdAt: at, updatedAt: at, ...change });
const brief = (change: Partial<CharacterBrief> = {}): CharacterBrief => ({
  briefId: 'b', kind: 'character', characterId: null, name: 'Beekeeper', body: 'round', style: 'cute', shown: { look: 'A round beekeeper', clothes: '', colours: 'honey', gear: '', note: 'Another hat.' },
  parts: [{ part: 'hero', credits: 40 }, { part: 'armor', credits: 20 }], credits: 60, available: 100, expiresAt: at, ...change,
});
const GEAR: CharacterGear = {
  designs: [
    { id: 'gear0', kind: 'gear', style: 'cute', madeFor: OTHER, sets: [], weapons: [{ id: 'weapon1', label: 'Net' }, { id: 'weapon2', label: 'Smoker' }], capes: [{ id: 'cape0', label: 'Shawl' }], fits: [], createdAt: at },
    { id: 'armor0', kind: 'armor', style: 'ink', madeFor: OTHER, sets: [{ id: 'set0', label: 'Wax' }], weapons: [], capes: [], fits: [OTHER], createdAt: at },
  ], motions: [{ name: 'dodge', shown: 'Rolls away', characters: [ID] }, { name: 'wave', shown: 'Waves', characters: [] }],
};

let status: CharactersStatus, answer: CharactersResponse, priced: CharacterBrief | { error: string }, fetchMock: ReturnType<typeof vi.fn>;
const sent = (path: string, method: string): unknown[] => fetchMock.mock.calls.filter(([url, init]) => String(url) === path && (init?.method ?? 'GET') === method).map(([, init]) => init?.body ? JSON.parse(String(init.body)) as unknown : null);
const flush = async (): Promise<void> => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };

beforeEach(async () => {
  status = { available: true, signedIn: true, service: { paused: false, priceVersion: 1, prices: { hero: 40, armor: 20, gear: 20, fit: 15, motion: 5 } } };
  answer = { characters: [hero()], suggestions: [] };
  priced = brief();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input), method = init?.method ?? 'GET';
    if (path === '/api/characters/service') return Response.json(status);
    if (path === '/api/characters') return Response.json(answer);
    if (path === '/api/characters/gear') return Response.json(GEAR);
    if (path === '/api/characters/briefs') return 'error' in priced ? Response.json({ error: { code: priced.error, message: 'x' } }, { status: 402 }) : Response.json(priced);
    if (path === '/api/characters/orders') return Response.json(job('waiting'));
    if (path === `/api/characters/${ID}` && method === 'PATCH') { const change = JSON.parse(String(init!.body)) as Partial<LocalCharacter>; return Response.json(hero({ ...(change.outfits ? { outfits: change.outfits } : {}), changed: true })); }
    if (path.endsWith('/pack')) return Response.json(job('waiting', { kind: 'pack' }));
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  await refreshCharactersStatus();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function show(props: Partial<Parameters<typeof CharactersPage>[0]> = {}, locale: Locale = 'en') {
  const onOpenAccount = vi.fn(), onOpenProject = vi.fn();
  render(<I18nProvider initial={locale}><CharactersPage characterId={undefined} games={[{ id: 'game', name: 'Frostline' }]} onOpenAccount={onOpenAccount} onOpenProject={onOpenProject} {...props} /></I18nProvider>);
  await flush();
  await flush();
  return { onOpenAccount, onOpenProject };
}

describe('the list', () => {
  it('shows what there is, what is being made and what did not work out', async () => {
    answer.characters = [hero({ games: [{ projectId: 'game', projectName: 'Frostline', slug: 'mail', revision: 1 }] }), hero({ id: OTHER, name: 'Cook', state: 'making', job: job('drawing') }), hero({ id: '33333333-2222-4333-8444-555555555555', name: 'Lost', state: 'failed', job: job('failed', { errorCode: 'CHARACTER_DRAWING_FAILED' }) })];
    await show();
    const cards = screen.getAllByTestId('character-card');
    expect(cards.map(c => c.dataset.state)).toEqual(['ready', 'making', 'failed']);
    expect(cards[0]!.textContent).toContain('Update available');
    expect(within(cards[1]!).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expect(cards[2]!.textContent).toContain('Nothing was charged');
    expect(cards[0]!.querySelector('img')!.getAttribute('src')).toBe(`/api/characters/${ID}/package/2/portrait.png`);
  });

  it('looks again only while something is being made', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    answer.characters = [hero({ state: 'making', job: job('drawing') })];
    await show();
    const reads = (): number => sent('/api/characters', 'GET').length, before = reads();
    await act(async () => { vi.advanceTimersByTime(3_000); });
    await flush();
    expect(reads()).toBe(before + 1);
    answer.characters = [hero()];
    await act(async () => { vi.advanceTimersByTime(3_000); });
    await flush();
    const ended = reads();
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await flush();
    expect(reads()).toBe(ended);
    // what ended may have brought gear
    expect(sent('/api/characters/gear', 'GET').length).toBeGreaterThan(1);
  });

  it('asks to sign in, and shows nothing of a build without the service', async () => {
    status = { available: true, signedIn: false, service: null };
    await refreshCharactersStatus();
    const { onOpenAccount } = await show();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onOpenAccount).toHaveBeenCalled();
    cleanup();
    status = { available: false, signedIn: false, service: null };
    await refreshCharactersStatus();
    await show({}, 'zh-CN');
    expect(screen.getByText('这个版本没有角色功能。')).toBeTruthy();
    expect(sent('/api/characters', 'GET')).toEqual([]);
  });
});

describe('ordering', () => {
  it('shows the price as it is put together, then what was understood, and spends on the last click alone', async () => {
    await show();
    const button = (): HTMLElement => screen.getByTestId('character-price');
    expect(button().textContent).toContain('80');
    fireEvent.click(screen.getByLabelText(/8 weapons and 4 capes/u));
    expect(button().textContent).toContain('60');
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('character-text'), { target: { value: ' a beekeeper ' } });
    fireEvent.click(button());
    await flush();
    expect(sent('/api/characters/briefs', 'POST')).toEqual([{ kind: 'character', text: 'a beekeeper', armor: true, gear: false }]);
    const dialog = screen.getByRole('dialog');
    for (const text of ['Beekeeper', 'A round beekeeper', 'honey', 'Another hat.', '60 credits', 'not charged']) expect(dialog.textContent).toContain(text);
    expect(sent('/api/characters/orders', 'POST')).toEqual([]);
    fireEvent.click(screen.getByTestId('character-order'));
    await flush();
    expect(sent('/api/characters/orders', 'POST')).toEqual([{ briefId: 'b', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u) }]);
    expect((screen.getByTestId('character-text') as HTMLTextAreaElement).value).toBe('');
  });

  it('asks again under the same id when an order got no answer', async () => {
    await show();
    fireEvent.change(screen.getByTestId('character-text'), { target: { value: 'a beekeeper' } });
    fireEvent.click(screen.getByTestId('character-price'));
    await flush();
    const plain = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('lost'); });
    fireEvent.click(screen.getByTestId('character-order'));
    await flush();
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('never ordered twice');
    // it may have been placed, so the list is read again and shows it
    expect(sent('/api/characters', 'GET').length).toBeGreaterThan(1);
    fetchMock.mockImplementation(plain);
    fireEvent.click(screen.getByTestId('character-order'));
    await flush();
    const ids = sent('/api/characters/orders', 'POST').map(b => (b as { requestId: string }).requestId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
  });

  it('keeps what was typed and what was priced while the gear or a character is looked at', async () => {
    let release = (): void => {};
    const plain = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => { if (String(input) === '/api/characters/briefs') await new Promise<void>(r => { release = r; }); return plain(input, init); });
    await show();
    fireEvent.change(screen.getByTestId('character-text'), { target: { value: 'a long story about a beekeeper' } });
    fireEvent.click(screen.getByTestId('character-price'));
    fireEvent.click(screen.getByRole('tab', { name: /Gear/u }));
    release();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Characters' }));
    expect(screen.getByRole('dialog').textContent).toContain('Beekeeper');
    fireEvent.click(screen.getByRole('button', { name: 'Change the words' }));
    expect((screen.getByTestId('character-text') as HTMLTextAreaElement).value).toBe('a long story about a beekeeper');
  });

  it('asks for the prices again when they did not come at first', async () => {
    const full = status;
    status = { ...status, service: null };
    await refreshCharactersStatus();
    // the list comes, so the service is there too by now
    status = full;
    await show();
    expect(screen.getByTestId('character-price').textContent).toContain('80');
  });

  it('offers credits instead of an order that cannot be paid', async () => {
    priced = brief({ available: 10 });
    const { onOpenAccount } = await show();
    fireEvent.change(screen.getByTestId('character-text'), { target: { value: 'a beekeeper' } });
    fireEvent.click(screen.getByTestId('character-price'));
    await flush();
    expect(screen.queryByTestId('character-order')).toBeNull();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Top up' }));
    expect(onOpenAccount).toHaveBeenCalled();
    cleanup();
    priced = { error: 'CHARACTER_TEXT_REFUSED' };
    await show();
    fireEvent.change(screen.getByTestId('character-text'), { target: { value: 'a known plumber' } });
    fireEvent.click(screen.getByTestId('character-price'));
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('original character');
  });

  it('takes over what an agent suggested, and orders nothing by that', async () => {
    answer.suggestions = [{ id: 's1', projectId: 'game', projectName: 'Frostline', text: 'a grumpy beekeeper', style: 'cute', armor: false, gear: true, createdAt: at }];
    await show();
    expect(screen.getByText('Suggested while working on Frostline')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect((screen.getByTestId('character-text') as HTMLTextAreaElement).value).toBe('a grumpy beekeeper');
    expect(screen.getByTestId('character-price').textContent).toContain('60');
    expect(sent('/api/characters/orders', 'POST')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'No, thanks' }));
    await flush();
    expect(sent('/api/characters/suggestions/s1', 'DELETE')).toHaveLength(1);
  });
});

describe('gear', () => {
  it('belongs to the account: the shelf says who uses what', async () => {
    answer.characters = [hero({ items: { sets: [], weapons: [{ id: 'weapon0', label: '' }, { id: 'weapon1', label: 'Net' }], capes: [] } }), hero({ id: OTHER, name: 'Cook' })];
    await show();
    fireEvent.click(screen.getByRole('tab', { name: /Gear/u }));
    expect(screen.getByTestId('shelf-weapon1').textContent).toContain('Used by Mail Carrier');
    expect(screen.getByTestId('shelf-weapon2').textContent).toContain('Not used');
    fireEvent.click(screen.getByRole('tab', { name: /Armour/u }));
    expect(screen.getByRole('heading', { name: /Fits Cook/u })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: ID } });
    await flush();
    expect(sent('/api/characters/briefs', 'POST')).toEqual([{ kind: 'fit', characterId: ID, design: 'armor0' }]);
  });

  it('is renamed and thrown away only when that was confirmed', async () => {
    await show();
    fireEvent.click(screen.getByRole('tab', { name: /Gear/u }));
    fireEvent.click(screen.getByTestId('shelf-weapon1'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fine net' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(sent('/api/characters/gear/weapon1', 'PATCH')).toEqual([{ label: 'Fine net' }]);
    fireEvent.click(screen.getByRole('tab', { name: /Motions/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Throw Waves away?' }));
    expect(sent('/api/characters/gear/motions/wave', 'DELETE')).toEqual([]);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Throw away' }));
    await flush();
    expect(sent('/api/characters/gear/motions/wave', 'DELETE')).toHaveLength(1);
  });
});

describe('small rules', () => {
  it('a character has an address of its own', () => {
    for (const path of ['/characters', `/characters/${ID}`]) expect(buildPath(parseRoute(path))).toBe(path);
    expect(parseRoute(`/characters/${ID}`)).toEqual({ kind: 'home', view: 'characters', characterId: ID });
  });

  it('a previewed motion is read from its packet, and nothing else is taken for one', () => {
    const head = new TextEncoder().encode(JSON.stringify({ parts: [['motion.json', 2], ['motion.bin', 3]] })), bytes = new Uint8Array(4 + head.length + 5);
    new DataView(bytes.buffer).setUint32(0, head.length, true);
    bytes.set(head, 4);
    bytes.set([123, 125, 7, 8, 9], 4 + head.length);
    expect([...readPacket(bytes)].map(([n, b]) => [n, [...b]])).toEqual([['motion.json', [123, 125]], ['motion.bin', [7, 8, 9]]]);
    for (const bad of [new Uint8Array(2), bytes.subarray(0, bytes.length - 1), new Uint8Array([255, 255, 255, 255, 0])]) expect(() => readPacket(bad)).toThrow();
  });

  it('outfits are the same when they look the same', () => {
    expect(same({ head: 'set0', weapon: 'weapon1' }, { weapon: 'weapon1', head: 'set0' })).toBe(true);
    expect(same({ head: 'set0' }, { head: 'set1' })).toBe(false);
  });

  it('only sliders that change something are shown', () => {
    const still = Int16Array.from({ length: 2 * 2 * 4 }, () => 0), leap = Int16Array.from([0, 0, 0, 0, 0, -400, 0, -400, 0, 0, 0, 0, 0, 0, 0, 0]);
    const pack = (legs: Int16Array, hit?: number) => ({ data: { motions: { m: { from: 0, count: 4, seconds: 1, loop: false, ...(hit === undefined ? {} : { hit }) } } }, tracks: new Map(['legF', 'legN'].map(n => [n, { all: legs, corners: 2, rows: 1, cols: 2, tint: [1, 1, 1] }])) }) as never;
    expect(slidersFor(pack(still), 'm')).toEqual(['speed']);
    expect(slidersFor(pack(still, 0.3), 'm')).toEqual(['speed', 'windup', 'power', 'stop']);
    expect(slidersFor(pack(leap), 'm')).toEqual(['speed', 'jump']);
    expect(slidersFor(null, 'm')).toEqual(['speed']);
  });

  it('the page plays characters with the very player that games get', () => {
    const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/gu, '\n');
    expect(read('../../../src/lib/characters/pixo-character.ts')).toBe(read('../../../../../game-sdk/openpixo-character/web/pixo-character.ts'));
  });
});
