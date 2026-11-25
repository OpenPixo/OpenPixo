import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reach } from '../../src/components/characters/stage';
import { PixoCharacterPack, type PixoData, type PixoWear } from '../../src/lib/characters/pixo-character';

/** One frame of a mesh with two corners. */
const corners = (...v: number[]): Buffer => { const raw = Buffer.alloc(v.length * 2); v.forEach((n, i) => raw.writeInt16LE(n, i * 2)); return deflateSync(raw); };

describe('a motion that is shown before it is packed', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lies on the pictures where the cloud says, because that changes with what the character holds', async () => {
    const bin = corners(8, 16, 24, 32), track = { at: 0, bytes: bin.length, raw: 8, rows: 1, cols: 2, tint: [1, 1, 1], uv: [10, 10, 30, 30] };
    const data = {
      format: 'pixo-hero', version: 1, frames: 1, motions: { idle: { from: 0, count: 1, seconds: 1, loop: true } }, orders: [['torso']], order: [0], face: [0], faces: ['n'], blades: {}, items: { head: [], body: [], arm: [], leg: [], weapon: [], cape: [], start: {} },
      tracks: { torso: track, armN: { ...track, uv: [0, 0, 40, 40] } }, pics: { torso: { file: 'torso.png', x: 0, y: 0, w: 100, h: 100 }, armN: { file: 'armN.png', x: 0, y: 0, w: 100, h: 100 } },
    } as unknown as PixoData;
    vi.stubGlobal('createImageBitmap', async () => ({ close() {} }));
    const pack = await PixoCharacterPack.load('folder', { fetch: async url => url.endsWith('.json') ? Response.json(data) : new Response(url.endsWith('.bin') ? new Uint8Array(bin) : new Uint8Array(1)) });
    expect([...pack.place('torso', 'torso', '', false)]).toEqual([10, 10, 30, 30].map(v => Math.fround(v / 100)));

    const { tint: _, ...moving } = track, changed = { ...data, motions: { attack: { from: 0, count: 1, seconds: 1, loop: false } }, tracks: { torso: { ...moving, uv: [5, 5, 60, 60] }, unknown: moving } };
    const shown = await pack.withMotion(changed as unknown as Parameters<PixoCharacterPack['withMotion']>[0], new Uint8Array(bin));
    expect([...shown.place('torso', 'torso', '', false)]).toEqual([5, 5, 60, 60].map(v => Math.fround(v / 100)));
    // what did not come with it stays as it was packed, and so does the package itself
    expect([...shown.place('armN', 'armN', '', false)]).toEqual([0, 0, 40, 40].map(v => Math.fround(v / 100)));
    expect([...pack.place('torso', 'torso', '', false)]).toEqual([10, 10, 30, 30].map(v => Math.fround(v / 100)));
    expect([Object.keys(shown.data.motions), shown.tracks.get('torso')?.tint, shown.tracks.has('unknown')]).toEqual([['attack'], [1, 1, 1], false]);

    // it keeps the size it has on the stage, although it holds one motion only
    const actor = shown.create();
    actor.wear = {};
    const small = new Uint8Array(corners(0, 0, 8, 8)), tiny = await pack.withMotion({ ...changed, tracks: { torso: { ...moving, bytes: small.length } } } as unknown as Parameters<PixoCharacterPack['withMotion']>[0], small), other = tiny.create();
    other.wear = {};
    expect(reach(other, pack)).toEqual([0, 0, 3, 4]);
    expect(reach(other)).toEqual([0, 0, 1, 1]);

    // an answer without places is shown as before
    const old = await pack.withMotion({ ...changed, tracks: { torso: { at: 0, bytes: bin.length, raw: 8, rows: 1, cols: 2 } } } as unknown as Parameters<PixoCharacterPack['withMotion']>[0], new Uint8Array(bin));
    expect([...old.place('torso', 'torso', '', false)]).toEqual([10, 10, 30, 30].map(v => Math.fround(v / 100)));
  });
});

describe('a weapon', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Corners of a 4 wide, 50 long weapon that is held 10 from its lower end: where the hand is, and how far it is turned. Package pixels. */
  const held = (x: number, y: number, degrees: number): number[] => {
    const c = Math.cos(degrees * Math.PI / 180), n = Math.sin(degrees * Math.PI / 180);
    return [[-2, -40], [2, -40], [-2, 10], [2, 10]].flatMap(([a, b]) => [x + a! * c - b! * n, y + a! * n + b! * c]);
  };
  const tip = (x: number, y: number, degrees: number): number[] => [x, y, x + 40 * Math.sin(degrees * Math.PI / 180), y - 40 * Math.cos(degrees * Math.PI / 180)];

  it('turns about the hand and keeps its shape, between two frames and while one motion goes over into another', async () => {
    const poses: [number, number, number][] = [[0, 0, 66], [10, -6, -60], [-30, -20, 170]], steps = (v: number): number => Math.round(v * 8);
    const frames = poses.map(p => held(...p).map(steps)), raw = frames.flatMap((f, i) => f.map((v, k) => v - (i ? frames[i - 1]![k]! : 0))), bin = corners(...raw);
    const data = {
      format: 'pixo-hero', version: 1, frames: 3, motions: { swing: { from: 0, count: 2, seconds: 1, loop: false }, other: { from: 2, count: 1, seconds: 1, loop: true } }, orders: [['weapon']], order: [0, 0, 0], face: [0, 0, 0], faces: ['n'],
      blades: { weapon1: poses.flatMap(p => tip(...p).map(steps)) }, items: { head: [], body: [], arm: [], leg: [], weapon: ['weapon1'], cape: [], start: { weapon: 'weapon1' } },
      tracks: { weapon1: { at: 0, bytes: bin.length, raw: raw.length * 2, rows: 2, cols: 2, tint: [1, 1, 1], uv: [0, 0, 4, 0, 0, 50, 4, 50] } }, pics: { weapon1: { file: 'weapon1.png', x: 0, y: 0, w: 16, h: 64 } },
    } as unknown as PixoData;
    vi.stubGlobal('createImageBitmap', async () => ({ close() {} }));
    const pack = await PixoCharacterPack.load('folder', { fetch: async url => url.endsWith('.json') ? Response.json(data) : new Response(url.endsWith('.bin') ? new Uint8Array(bin) : new Uint8Array(1)) });
    const actor = pack.create(), shown = (place: [number, number, number]): number[] => [...(actor as unknown as { corners(name: string, t: unknown, place: [number, number, number]): Float32Array }).corners('weapon1', pack.tracks.get('weapon1'), place)];
    const far = (v: number[], i: number, j: number): number => Math.hypot(v[i * 2]! - v[j * 2]!, v[i * 2 + 1]! - v[j * 2 + 1]!);
    /** The hand, seen from the weapon: 2 to the right and 40 down from its first corner. */
    const hand = (v: number[]): [number, number] => [0, 1].map(k => v[k]! + (v[2 + k]! - v[k]!) / 2 + (v[4 + k]! - v[k]!) * 0.8) as [number, number];
    const stiff = (v: number[]): void => { expect([far(v, 0, 1), far(v, 0, 2), far(v, 1, 3), far(v, 0, 3)].map(d => Math.round(d * 2) / 2)).toEqual([4, 50, 50, 50]); };
    for (const k of [0, 0.2, 0.5, 0.8, 1]) {
      const v = shown([0, 1, k]);
      stiff(v);
      expect(Math.hypot(hand(v)[0] - 10 * k, hand(v)[1] + 6 * k)).toBeLessThan(0.4);
    }
    // half way between 66 and -60 degrees it points almost straight up
    const half = shown([0, 1, 0.5]);
    expect(Math.atan2(half[0]! - half[4]!, half[5]! - half[1]!) * 180 / Math.PI).toBeCloseTo(3, 0);

    actor.play('swing');
    actor.update(9);
    shown([0, 1, 0]);
    actor.play('other');
    for (let i = 0; i < 5; i++) { stiff(shown([2, 2, 0])); actor.update(0.02); }
    expect(hand(shown([2, 2, 0])).map(v => Math.round(v))).toEqual([-30, -20]);
  });
});

describe('weapons of many types', () => {
  afterEach(() => vi.unstubAllGlobals());

  const NAMES = ['legF', 'torso', 'armN', 'armF', 'armF1', 'armF2', 'armF3', 'creaseF', 'creaseF1', 'creaseF2', 'creaseF3', 'bare', 'weapon1', 'weapon2', 'weapon3', 'string2', 'shot2', 'shield0'];
  /** Eleven frames: idle 0, attack 1, bow/attack 2 to 5, shield/idle 6, fists/idle 7, staff/idle 8, guard 9, bow/idle 10. */
  const MOTIONS = { idle: [0, 1], attack: [1, 1], 'bow/attack': [2, 4], 'shield/idle': [6, 1], 'fists/idle': [7, 1], 'staff/idle': [8, 1], guard: [9, 1], 'bow/idle': [10, 1] } as Record<string, [number, number]>;
  async function load(): Promise<PixoCharacterPack> {
    const frames = 11, one = corners(...Array.from({ length: frames * 8 }, (_, i) => i < 8 ? [0, 0, 32, 0, 0, 400, 32, 400][i]! : 0));
    const data = {
      format: 'pixo-hero', version: 1, frames, motions: Object.fromEntries(Object.entries(MOTIONS).map(([name, [from, count]]) => [name, { from, count, seconds: 1, loop: !name.includes('attack'), ...(name === 'bow/attack' ? { hit: 0.4 } : {}) }])),
      orders: [['armF', 'armF+', 'creaseF', 'shield', 'bow', 'string', 'legF', 'torso', 'shot', 'head', 'weapon', 'staff', 'armN']], order: Array(frames).fill(0), face: Array(frames).fill(0), faces: ['n'],
      types: { weapon2: 'bow', weapon3: 'staff' }, twoHanded: ['bow', 'staff', 'launcher', 'spear'], farHand: ['bow', 'staff'], shots: { weapon2: { picture: 'shot2', tail: [30, 90], size: 0.5 } },
      blades: Object.fromEntries(['weapon1', 'weapon2', 'weapon3'].map(n => [n, Array.from({ length: frames * 4 }, (_, i) => [0, 0, 80, 0][i % 4])])),
      items: { head: [], body: [], arm: ['set0'], leg: [], weapon: ['weapon1', 'weapon2', 'weapon3'], cape: [], shield: ['shield0'], start: { weapon: 'weapon2' } },
      tracks: Object.fromEntries(NAMES.map(n => [n, { at: 0, bytes: one.length, raw: frames * 16, rows: 2, cols: 2, tint: [1, 1, 1], uv: [0, 0, 4, 0, 0, 50, 4, 50] }])),
      pics: Object.fromEntries([...NAMES.filter(n => !/F\d|bare/u.test(n)), 'creaseN', 'head/n', 'set0/armF', 'set0/armN'].map(n => [n, { file: `${n.replace('/', '-')}.png`, x: 10, y: 20, w: 100, h: 100 }])),
    } as unknown as PixoData;
    vi.stubGlobal('createImageBitmap', async () => ({ close() {} }));
    return PixoCharacterPack.load('folder', { fetch: async url => url.endsWith('.json') ? Response.json(data) : new Response(url.endsWith('.bin') ? new Uint8Array(one) : new Uint8Array(1)) });
  }
  it('are played the way they are used', async () => {
    const actor = (await load()).create();
    expect(actor.pack.typeOf(actor.wear)).toBe('bow');
    expect(actor.play('attack')).toBe(true);
    expect(actor.info).toMatchObject({ from: 2, count: 4, hit: 0.4 });
    expect(actor.motion).toBe('attack');
    // what has no version of its own is the same for everything
    expect(actor.pack.key(actor.wear, 'guard')).toBe('guard');
    const key = (wear: PixoWear): string => actor.pack.key(wear, 'idle');
    expect([key({ weapon: 'weapon1' }), key({ weapon: 'weapon1', shield: 'shield0' }), key({}), key({ shield: 'shield0' }), key({ weapon: 'weapon3', shield: 'shield0' })]).toEqual(['idle', 'shield/idle', 'fists/idle', 'fists/idle', 'staff/idle']);
  });

  it('tell when the blow lands with what is held, and start a blow again when the weapon is changed in it', async () => {
    const actor = (await load()).create(), hits: string[] = [];
    actor.onHit = () => hits.push(actor.pack.key(actor.wear, actor.motion));
    actor.play('attack');
    actor.update(0.3);
    expect(hits).toEqual([]);
    actor.update(0.2);
    expect(hits).toEqual(['bow/attack']);
    expect(actor.putOn('shield', 'shield9')).toBe(false);
    actor.putOn('weapon', 'weapon1');
    actor.update(0.01);
    expect([actor.motion, actor.info.from, actor.time]).toEqual(['attack', 1, 0]);
  });

  it('give what they shoot, where it leaves and in which direction', async () => {
    const actor = (await load()).create();
    expect(actor.shot()).toEqual({ picture: expect.anything(), tail: [20, 70], size: 0.5, from: [0, 0], direction: [1, 0] });
    actor.putOn('weapon', 'weapon1');
    expect(actor.shot()).toBeNull();
    actor.takeOff('weapon');
    expect(actor.shot()).toBeNull();
  });

  it('keep shields and arrows stiff, which nothing holds by a handle', async () => {
    const pack = await load();
    // the middle, seen along the first column of corners
    expect(pack.tracks.get('shield0')?.hand?.map(Math.round)).toEqual([200, -16]);
    expect(pack.tracks.get('weapon1')?.hand).toEqual([0, 0]);
  });
});
