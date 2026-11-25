// @vitest-environment jsdom
// One character, with a stage that only remembers what it was told: jsdom draws no WebGL.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterOutfit, LocalCharacter } from '@openpixo/contracts';

const fake = vi.hoisted(() => {
  interface Actor { pack: any; wear: Record<string, string>; motion: string; paused: boolean; info: unknown; play(m: string): boolean; onEnd: unknown }
  const actors: Actor[] = [];
  const tracks = (names: string[]) => new Map(names.map(n => [n, {}]));
  const packOf = (data: any, names: string[]): any => ({
    data, tracks: tracks(names),
    create(this: any) {
      const actor: Actor = { pack: this, wear: { ...data.items.start }, motion: 'idle', paused: false, onEnd: null, get info() { return this.pack.data.motions[this.motion]; }, play(m: string) { if (!this.pack.data.motions[m]) return false; this.motion = m; return true; } };
      actors.push(actor);
      return actor;
    },
    async withMotion(changed: any) { return packOf({ ...data, motions: changed.motions }, changed.names); },
  });
  return { actors, packOf };
});
vi.mock('../../../src/components/characters/stage', () => ({
  loadPack: async () => PACK, run: () => () => {}, paint: () => {}, canShowCharacters: () => false, jumps: () => false, FRAMES: { card: () => ({}), stage: () => () => ({}) },
}));
vi.mock('../../../src/hooks/useOpenPixoAccount', () => ({
  useOpenPixoAccount: () => ({ status: { availability: 'available', signedIn: true, user: null }, loading: false, failed: false }), useOpenPixoCredits: () => ({ credits: null }), isCloudAccountAvailable: () => true,
}));

import { CharactersPage } from '../../../src/components/characters/CharactersPage';
import { wornIn } from '../../../src/components/characters/CharacterDetail';
import { I18nProvider } from '../../../src/i18n';
import { refreshCharactersStatus } from '../../../src/providers/characters';

const PACK = fake.packOf({ items: { head: ['set0'], body: ['set0'], arm: ['set0'], leg: ['set0'], weapon: ['weapon0', 'weapon1'], cape: ['cape0'], start: { weapon: 'weapon0' } }, motions: { idle: {}, run: {}, attack: { hit: 0.3 } } }, ['head', 'bare', 'weapon0', 'armF0', 'weapon1', 'armF1', 'cape0']);
const ID = '11111111-2222-4333-8444-555555555555', at = '2026-11-25T00:00:00.000Z';
const outfit = (name: string, weapon: string): CharacterOutfit => ({ name, wear: { weapon } });
const hero = (change: Partial<LocalCharacter> = {}): LocalCharacter => ({
  id: ID, name: 'Mail Carrier', body: 'angular', style: 'ink', state: 'ready', revision: 1, items: { sets: [{ id: 'set0', label: 'Fur' }], weapons: [{ id: 'weapon0', label: 'Pick' }, { id: 'weapon1', label: 'Net' }], capes: [{ id: 'cape0', label: 'Shawl' }] }, fits: ['armor0'],
  outfits: [outfit('A', 'weapon0'), { name: 'B', wear: { weapon: 'weapon1' } }, { name: 'C', wear: { cape: 'cape0' } }],
  motions: [{ name: 'idle', builtIn: true, shown: '', tuning: {} }, { name: 'run', builtIn: true, shown: '', tuning: {} }, { name: 'attack', builtIn: true, shown: '', tuning: { speed: 1.3 } }], changed: false, job: null, games: [], createdAt: at, updatedAt: at, ...change,
});

let server: LocalCharacter, tuned: { motion: string; tuning: unknown; wear: any }[], patches: any[], gates: (() => void)[], slow: boolean, names: string[], fetchMock: ReturnType<typeof vi.fn>;
function packet(motion: string): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({ motions: { [motion]: {} }, names })), head = new TextEncoder().encode(JSON.stringify({ parts: [['motion.json', json.length], ['motion.bin', 0]] })), out = new Uint8Array(4 + head.length + json.length);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  out.set(json, 4 + head.length);
  return out;
}
const flush = async (ms = 0): Promise<void> => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
/** The one on the stage; the pictures of outfits come after it. */
const actor = () => fake.actors[0]!;

beforeEach(async () => {
  fake.actors.length = 0;
  server = hero(); tuned = []; patches = []; gates = []; slow = false; names = ['bare', 'weapon0', 'armF0'];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input), method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : null;
    if (path === '/api/characters/service') return Response.json({ available: true, signedIn: true, service: { paused: false, priceVersion: 1, prices: { hero: 40, armor: 20, gear: 20, fit: 15, motion: 5 } } });
    if (path === '/api/characters') return Response.json({ characters: [server], suggestions: [] });
    if (path === '/api/characters/gear') return Response.json({ designs: [], motions: [{ name: 'wave', shown: 'Waves', characters: [] }] });
    if (path.endsWith('/tune')) { tuned.push(body); return new Response(packet(body.motion) as Uint8Array<ArrayBuffer>); }
    if (path === `/api/characters/${ID}` && method === 'PATCH') {
      patches.push(body);
      if (slow) await new Promise<void>(r => gates.push(r));
      server = { ...server, ...body, changed: true };
      return Response.json(server);
    }
    if (path.includes('/motions/') && method === 'PUT') { const name = path.split('/').at(-1)!; server = { ...server, changed: true, motions: [...server.motions.filter(m => m.name !== name), { name, builtIn: name !== 'wave', shown: '', tuning: body.tuning }] }; return Response.json(server); }
    if (path === '/api/characters/briefs') return Response.json({ briefId: 'b', kind: 'motion', characterId: ID, name: null, body: null, style: null, shown: { look: '', clothes: '', colours: '', gear: '', note: '' }, parts: [{ part: 'motion', credits: 5 }], credits: 5, available: 100, expiresAt: at });
    if (path === '/api/characters/orders') return Response.json({ id: ID, characterId: ID, kind: 'motion', state: 'waiting', creditsReserved: 5, creditsCharged: null, delivered: null, errorCode: null, createdAt: at, updatedAt: at });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  await refreshCharactersStatus();
  render(<I18nProvider initial="en"><CharactersPage characterId={ID} games={[]} onOpenAccount={() => {}} onOpenProject={() => {}} /></I18nProvider>);
  await flush();
  await flush();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const tab = (name: RegExp | string): void => { fireEvent.click(screen.getByRole('tab', { name })); };
const slide = (what: string, value: string): void => { fireEvent.change(screen.getByTestId(`tune-${what}`), { target: { value } }); };
const chip = (name: string): void => { fireEvent.click(screen.getByTestId(`character-motion-${name}`)); };

describe('the stage', () => {
  it('plays what is packed, and asks for what is not', async () => {
    chip('run');
    expect(actor().motion).toBe('run');
    await flush(20);
    expect(tuned).toEqual([]);
    tab('Motions');
    fireEvent.click(screen.getByTestId('motion-take-wave'));
    await flush();
    chip('wave');
    await flush(20);
    expect(tuned.at(-1)).toMatchObject({ motion: 'wave', tuning: {} });
    expect([actor().motion, Object.keys(actor().pack.data.motions)]).toEqual(['wave', ['wave']]);
    // sliders of it, and back to something else: never a motion that the pack on stage has not got
    slide('speed', '1.2');
    await flush(300);
    chip('run');
    await flush(20);
    expect(actor().pack.data.motions[actor().motion]).toBeDefined();
    expect(actor().motion).toBe('run');
  });

  it('shows what is saved although the package is older, also when it was set back', async () => {
    chip('attack');
    await flush(20);
    expect(tuned).toEqual([]);
    tab('Motions');
    fireEvent.click(screen.getByRole('button', { name: 'As it was' }));
    fireEvent.click(screen.getByTestId('tune-save'));
    await flush(300);
    chip('run');
    chip('attack');
    await flush(20);
    expect(tuned.at(-1)).toMatchObject({ motion: 'attack', tuning: {} });
  });

  it('gets the whole package back when something else is put on, and the preview with it', async () => {
    tab('Motions');
    chip('attack');
    slide('windup', '1.5');
    await flush(300);
    expect(actor().pack).not.toBe(PACK);
    tab(/Wardrobe/u);
    names = ['bare', 'weapon1', 'armF1'];
    fireEvent.click(screen.getByTestId('wear-weapon-weapon1'));
    // at once everything is there
    expect([actor().pack === PACK, actor().wear.weapon]).toEqual([true, 'weapon1']);
    await flush(30);
    expect(tuned.at(-1)).toMatchObject({ motion: 'attack', tuning: { speed: 1.3, windup: 1.5 }, wear: { weapon: 'weapon1' } });
    expect(actor().wear.weapon).toBe('weapon1');
  });

  it('wears in a preview only what the preview holds', () => {
    const pack = { tracks: new Map(['bare', 'weapon1', 'armF1'].map(n => [n, {}])) } as never;
    expect(wornIn(pack, { head: 'set0', body: 'set0', weapon: 'weapon1', cape: 'cape0' })).toEqual({ body: 'set0', weapon: 'weapon1' });
    expect(wornIn(pack, { weapon: 'weapon2' })).toEqual({});
  });
});

describe('saving', () => {
  it('loses no outfit when two changes come fast', async () => {
    slow = true;
    fireEvent.click(screen.getByRole('button', { name: 'Remove A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove B' }));
    expect(screen.queryByRole('button', { name: 'Remove A' })).toBeNull();
    await flush();
    gates.shift()!();
    await flush();
    expect(screen.queryByRole('button', { name: 'Remove A' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove B' })).toBeNull();
    gates.shift()!();
    await flush();
    expect(patches.at(-1).outfits.map((o: CharacterOutfit) => o.name)).toEqual(['C']);
    expect(server.outfits.map(o => o.name)).toEqual(['C']);
    slow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Start in C' }));
    await flush();
    expect(patches.at(-1).outfits).toEqual([{ name: 'C', wear: { cape: 'cape0' }, start: true }]);
  });

  it('keeps moved sliders and typed words while another tab is open, and clears the words with their own order alone', async () => {
    tab('Motions');
    chip('attack');
    slide('power', '1.2');
    fireEvent.change(screen.getByTestId('motion-text'), { target: { value: 'rolls backwards' } });
    tab(/Wardrobe/u);
    tab('Motions');
    expect((screen.getByTestId('tune-power') as HTMLInputElement).value).toBe('1.2');
    expect((screen.getByTestId('motion-text') as HTMLTextAreaElement).value).toBe('rolls backwards');
    // another motion arrives
    fireEvent.click(screen.getByTestId('motion-take-wave'));
    await flush();
    expect((screen.getByTestId('motion-text') as HTMLTextAreaElement).value).toBe('rolls backwards');
    fireEvent.click(screen.getByTestId('motion-price'));
    await flush();
    fireEvent.click(screen.getByTestId('character-order'));
    await flush();
    expect((screen.getByTestId('motion-text') as HTMLTextAreaElement).value).toBe('');
  });

  it('a list that was asked for before a save does not undo it', async () => {
    // the answer is old by the time it comes
    const plain = fetchMock.getMockImplementation() as typeof fetch;
    let release = (): void => {}, held = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/characters' && !held) { held = true; const old = { characters: [server], suggestions: [] }; await new Promise<void>(r => { release = r; }); return Response.json(old); }
      return plain(input, init);
    });
    tab('Motions');
    fireEvent.change(screen.getByTestId('motion-text'), { target: { value: 'rolls backwards' } });
    fireEvent.click(screen.getByTestId('motion-price'));
    await flush();
    fireEvent.click(screen.getByTestId('character-order'));
    await flush();
    expect(held).toBe(true);
    tab(/Wardrobe/u);
    fireEvent.click(screen.getByRole('button', { name: 'Remove A' }));
    await flush();
    release();
    await flush();
    await flush();
    expect(screen.queryByRole('button', { name: 'Remove A' })).toBeNull();
  });
});
