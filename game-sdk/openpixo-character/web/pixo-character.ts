// SPDX-License-Identifier: Apache-2.0
/**
 * Plays a character whose gear can be changed: one flat picture per part and ready-made corner
 * positions per frame. Draws with WebGL 1 or 2 into any canvas, and into a Phaser 3 scene.
 *
 *   const pack = await PixoCharacterPack.load('characters/mail-carrier');
 *   const hero = pack.create();
 *   hero.play('attack');
 *   hero.putOn('weapon', 'weapon3');                  // with a bow, attack is the attack of a bow
 *   hero.update(seconds); hero.draw(gl, matrix);      // every frame
 *   hero.addToPhaser(this, 400, 300);                 // or let a Phaser scene do it
 */

/** Where something can be worn. A set of armour has one piece for each of the first four. */
export type PixoSlot = 'head' | 'body' | 'arm' | 'leg' | 'weapon' | 'cape' | 'shield';
export type PixoWear = Partial<Record<PixoSlot, string>>;
/** x' = a*x + c*y + e, y' = b*x + d*y + f, into clip space: -1 to 1, upwards. */
export type PixoMatrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
export type PixoBox = [left: number, top: number, right: number, bottom: number];

export interface PixoMotion { from: number; count: number; seconds: number; loop: boolean; hit?: number }
interface TrackData { at: number; bytes: number; raw: number; rows: number; cols: number; tint: [number, number, number]; uv: number[]; uvs?: Record<string, number[] | null>; off?: Record<string, [number, number]> }
interface PictureData { file: string; x: number; y: number; w: number; h: number }
/** `hero.json` of a package. */
export interface PixoData {
  format: 'pixo-hero';
  version: 1;
  frames: number;
  motions: Record<string, PixoMotion>;
  orders: string[][];
  order: number[];
  face: number[];
  faces: string[];
  tracks: Record<string, TrackData>;
  pics: Record<string, PictureData>;
  /** Grip and tip of every weapon in every frame. */
  blades: Record<string, number[]>;
  /** Weapons that are not swung: spear, staff, bow, launcher. With a bow in the hands `attack` is the motion `bow/attack`, with nothing in them `fists/attack`. */
  types?: Record<string, string>;
  /** Types that leave no hand for a shield, and those the far hand holds. */
  twoHanded?: string[];
  farHand?: string[];
  /** What a weapon shoots: its picture, which points up, where its rear end is, and package pixels for one of its pixels. */
  shots?: Record<string, { picture: string; tail: [number, number]; size: number }>;
  items: Partial<Record<PixoSlot, string[]>> & { start: PixoWear };
  outfits?: { name: string; wear: PixoWear }[];
}
interface Track {
  all: Int16Array; corners: number; rows: number; cols: number; tint: [number, number, number];
  /** Weapons: where on them the hand is, in stored steps along and across the first column of corners. */
  hand?: [number, number];
}

/** Positions are stored in steps of this many to a pixel. */
const STEPS = 8;
/** Seconds a new motion takes to blend in. */
const BLEND = 0.09;
/** Which slot an armour layer belongs to. */
const LAYERS: Record<string, PixoSlot> = { 'head+': 'head', 'torso+': 'body', 'armN+': 'arm', 'armF+': 'arm', 'legN+': 'leg', 'legF+': 'leg', weapon: 'weapon', bow: 'weapon', staff: 'weapon', string: 'weapon', shot: 'weapon', shield: 'shield', cape: 'cape' };
const BODY = ['legF', 'legN', 'torso', 'armN', 'bare', 'head'];

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Frames of one track: every frame is stored as the difference from the one before. */
async function unpack(t: Pick<TrackData, 'at' | 'bytes' | 'raw' | 'rows' | 'cols'>, bin: Uint8Array): Promise<Int16Array> {
  const raw = await inflate(bin.subarray(t.at, t.at + t.bytes)), view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), all = new Int16Array(raw.byteLength / 2), line = t.rows * t.cols * 2;
  for (let i = 0; i < all.length; i++) all[i] = view.getInt16(i * 2, true) + (i < line ? 0 : all[i - line]!);
  return all;
}

/** How far a weapon is turned: the direction of its first column of corners. */
const turned = (t: Track, p: ArrayLike<number>): number => { const end = (t.rows - 1) * t.cols * 2; return Math.atan2(p[end + 1]! - p[1]!, p[end]! - p[0]!); };

/** The moment `k` between two. Corners go straight from one to the other, but a weapon is stiff: it turns about the hand and keeps its shape. */
function mix(out: Float32Array, t: Track, a: ArrayLike<number>, b: ArrayLike<number>, k: number, size: number): void {
  if (!t.hand) {
    for (let i = 0; i < out.length; i++) out[i] = a[i]! + (b[i]! - a[i]!) * k;
    return;
  }
  const from = turned(t, a), to = turned(t, b), full = Math.PI * 2, [along, across] = [t.hand[0] * size, t.hand[1] * size];
  const ax = a[0]! + Math.cos(from) * along - Math.sin(from) * across, ay = a[1]! + Math.sin(from) * along + Math.cos(from) * across;
  const bx = b[0]! + Math.cos(to) * along - Math.sin(to) * across, by = b[1]! + Math.sin(to) * along + Math.cos(to) * across;
  const turn = (to - from - Math.round((to - from) / full) * full) * k, c = Math.cos(turn), s = Math.sin(turn), x = ax + (bx - ax) * k, y = ay + (by - ay) * k;
  for (let i = 0; i < out.length; i += 2) {
    const dx = a[i]! - ax, dy = a[i + 1]! - ay;
    out[i] = x + dx * c - dy * s;
    out[i + 1] = y + dx * s + dy * c;
  }
}

type Gl = WebGLRenderingContext | WebGL2RenderingContext;

/** What one canvas needs to draw characters. */
class Renderer {
  private static readonly all = new WeakMap<Gl, Renderer>();
  static of(gl: Gl): Renderer {
    let found = Renderer.all.get(gl);
    if (!found) Renderer.all.set(gl, found = new Renderer(gl));
    return found;
  }

  private readonly gl: Gl;
  private readonly program: WebGLProgram;
  private readonly matrix: WebGLUniformLocation | null;
  private readonly tint: WebGLUniformLocation | null;
  private readonly positions: WebGLBuffer;
  private readonly grids = new Map<string, { buffer: WebGLBuffer; count: number }>();
  private readonly textures = new Map<ImageBitmap, WebGLTexture>();
  private readonly places = new Map<Float32Array, WebGLBuffer>();

  private constructor(gl: Gl) {
    this.gl = gl;
    const shader = (type: number, text: string): WebGLShader => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, shader(gl.VERTEX_SHADER, 'attribute vec2 p; attribute vec2 t; uniform mat3 m; varying vec2 uv; void main() { uv = t; gl_Position = vec4((m * vec3(p, 1.0)).xy, 0.0, 1.0); }'));
    gl.attachShader(this.program, shader(gl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 uv; uniform sampler2D tex; uniform vec4 tint; void main() { gl_FragColor = texture2D(tex, uv) * tint; }'));
    gl.bindAttribLocation(this.program, 0, 'p');
    gl.bindAttribLocation(this.program, 1, 't');
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? 'program');
    this.matrix = gl.getUniformLocation(this.program, 'm');
    this.tint = gl.getUniformLocation(this.program, 'tint');
    this.positions = gl.createBuffer()!;
  }

  begin(m: PixoMatrix): void {
    const { gl } = this;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.uniformMatrix3fv(this.matrix, false, [m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);
  }

  mesh(picture: ImageBitmap, corners: Float32Array, place: Float32Array, t: Track, alpha: number): void {
    const { gl } = this, grid = this.grid(t.rows, t.cols);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(picture));
    // colours are already multiplied by alpha, so everything fades with it
    gl.uniform4f(this.tint, t.tint[0] * alpha, t.tint[1] * alpha, t.tint[2] * alpha, alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positions);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STREAM_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.place(place));
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid.buffer);
    gl.drawElements(gl.TRIANGLES, grid.count, gl.UNSIGNED_SHORT, 0);
  }

  private place(uv: Float32Array): WebGLBuffer {
    const { gl } = this;
    let buffer = this.places.get(uv);
    if (!buffer) {
      buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
      this.places.set(uv, buffer);
    }
    return buffer;
  }

  private texture(picture: ImageBitmap): WebGLTexture {
    const { gl } = this;
    let t = this.textures.get(picture);
    if (t) return t;
    t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // the bitmap is premultiplied already
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
    // WebGL 1 makes smaller copies only of pictures whose sides are powers of two
    const smaller = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    if (smaller) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smaller ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // folded elbows squeeze a picture in one direction
    const sharp = gl.getExtension('EXT_texture_filter_anisotropic');
    if (sharp && smaller) gl.texParameterf(gl.TEXTURE_2D, sharp.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(sharp.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number));
    this.textures.set(picture, t);
    return t;
  }

  private grid(rows: number, cols: number): { buffer: WebGLBuffer; count: number } {
    const { gl } = this, key = `${rows}x${cols}`;
    let g = this.grids.get(key);
    if (!g) {
      const list: number[] = [];
      for (let r = 0; r < rows - 1; r++) for (let q = 0; q < cols - 1; q++) { const a = r * cols + q; list.push(a, a + 1, a + cols + 1, a, a + cols + 1, a + cols); }
      g = { buffer: gl.createBuffer()!, count: list.length };
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.buffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(list), gl.STATIC_DRAW);
      this.grids.set(key, g);
    }
    return g;
  }

  /** Frees the pictures of a package that is no longer shown. */
  release(pack: PixoCharacterPack): void {
    for (const bitmap of pack.pictures.values()) { const t = this.textures.get(bitmap); if (t) { this.gl.deleteTexture(t); this.textures.delete(bitmap); } }
    for (const uv of pack.knownPlaces()) { const b = this.places.get(uv); if (b) { this.gl.deleteBuffer(b); this.places.delete(uv); } }
  }
}

/** A package that has been read. Any number of characters can be made from it. */
export class PixoCharacterPack {
  readonly data: PixoData;
  readonly tracks: Map<string, Track>;
  readonly pictures: ReadonlyMap<string, ImageBitmap>;
  private readonly places = new Map<string, Float32Array>();
  /** Uv data: that of the package, also while a changed motion is shown. */
  private readonly drawn: PixoData;

  private constructor(data: PixoData, tracks: Map<string, Track>, pictures: ReadonlyMap<string, ImageBitmap>, drawn: PixoData = data) {
    this.data = data;
    this.tracks = tracks;
    this.pictures = pictures;
    this.drawn = drawn;
    for (const [name, grip] of Object.entries(data.blades)) {
      const t = tracks.get(name);
      if (!t || t.rows < 2 || grip.length < 2) continue;
      const a = turned(t, t.all), x = grip[0]! - t.all[0]!, y = grip[1]! - t.all[1]!;
      t.hand = [Math.cos(a) * x + Math.sin(a) * y, Math.cos(a) * y - Math.sin(a) * x];
    }
    // whatever else is stiff turns about its middle
    for (const t of tracks.values()) {
      if (t.rows !== 2 || t.cols !== 2 || t.hand) continue;
      const a = turned(t, t.all), x = (t.all[6]! - t.all[0]!) / 2, y = (t.all[7]! - t.all[1]!) / 2;
      t.hand = [Math.cos(a) * x + Math.sin(a) * y, Math.cos(a) * y - Math.sin(a) * x];
    }
  }

  /** Reads `<folder>/hero.json` and everything it names. */
  static async load(folder: string, options: { fetch?: (url: string) => Promise<Response> } = {}): Promise<PixoCharacterPack> {
    const base = folder.replace(/\/+$/, ''), get = async (file: string): Promise<Response> => {
      const r = await (options.fetch ?? ((url: string) => fetch(url)))(`${base}/${file}`);
      if (!r.ok) throw new Error(`${file}: ${r.status}`);
      return r;
    };
    const [data, bin] = await Promise.all([get('hero.json').then(r => r.json() as Promise<PixoData>), get('hero.bin').then(async r => new Uint8Array(await r.arrayBuffer()))]);
    if (data.format !== 'pixo-hero' || data.version !== 1) throw new Error('not a character package of version 1');
    const pictures = new Map<string, ImageBitmap>();
    await Promise.all(Object.entries(data.pics).map(async ([name, p]) => {
      pictures.set(name, await createImageBitmap(await (await get(p.file)).blob(), { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' }));
    }));
    return new PixoCharacterPack(data, await PixoCharacterPack.read(data.tracks, bin), pictures);
  }

  private static async read(list: Record<string, Pick<TrackData, 'at' | 'bytes' | 'raw' | 'rows' | 'cols' | 'tint'>>, bin: Uint8Array): Promise<Map<string, Track>> {
    const out = new Map<string, Track>();
    await Promise.all(Object.entries(list).map(async ([name, t]) => { out.set(name, { all: await unpack(t, bin), corners: t.rows * t.cols, rows: t.rows, cols: t.cols, tint: t.tint }); }));
    return out;
  }

  /** The same character with one motion as it would be with other sliders: for showing it before it is packed. Where its meshes lie on the pictures comes with it, because that depends on what the character holds by now. */
  async withMotion(changed: Pick<PixoData, 'frames' | 'motions' | 'orders' | 'order' | 'face' | 'faces' | 'blades'> & { tracks: Record<string, Pick<TrackData, 'at' | 'bytes' | 'raw' | 'rows' | 'cols'> & Partial<Pick<TrackData, 'uv' | 'uvs' | 'off'>>> }, bin: Uint8Array): Promise<PixoCharacterPack> {
    const tracks = Object.fromEntries(Object.entries(changed.tracks).filter(([name]) => this.drawn.tracks[name]).map(([name, t]) => [name, { ...this.drawn.tracks[name]!, ...t }])), drawn = { ...this.drawn, tracks: { ...this.drawn.tracks, ...tracks } };
    return new PixoCharacterPack({ ...drawn, ...changed, tracks: drawn.tracks }, await PixoCharacterPack.read(tracks, bin), this.pictures, drawn);
  }

  create(): PixoCharacter { return new PixoCharacter(this); }

  /** How what is in the hands is used: undefined for a weapon that is swung, or in a package that has nothing else. */
  typeOf(wear: PixoWear): string | undefined { return this.data.types && (wear.weapon ? this.data.types[wear.weapon] ?? (wear.shield ? 'shield' : undefined) : 'fists'); }

  /** The motion that is really played with what is in the hands. */
  key(wear: PixoWear, motion: string): string {
    const type = this.typeOf(wear), own = `${type}/${motion}`;
    return type && this.data.motions[own] ? own : motion;
  }

  /** The box around a dressed character in a motion, or in its first frames, in package pixels. It stands on 0, 0. */
  box(wear: PixoWear, motion: string, frames?: number): PixoBox {
    const m = this.data.motions[this.key(wear, motion)]!, box: PixoBox = [Infinity, Infinity, -Infinity, -Infinity];
    for (const name of [...BODY.filter(n => n !== (wear.head ? 'bare' : 'head')), wear.weapon, wear.cape, wear.cape ? undefined : 'hair']) {
      const t = name ? this.tracks.get(name) : undefined;
      if (!t) continue;
      const line = t.corners * 2, end = (m.from + Math.min(m.count, frames ?? m.count)) * line;
      for (let i = m.from * line; i < end; i += 2) {
        const x = t.all[i]! / STEPS, y = t.all[i + 1]! / STEPS;
        if (x < box[0]) box[0] = x;
        if (x > box[2]) box[2] = x;
        if (y < box[1]) box[1] = y;
        if (y > box[3]) box[3] = y;
      }
    }
    return box;
  }

  /** Where the corners lie on a cropped picture. Every expression has its own place in its drawing; helmets follow the calm one. */
  place(track: string, picture: string, expression: string, helmet: boolean): Float32Array {
    const key = `${track}|${picture}|${expression}${helmet ? '+' : ''}`, known = this.places.get(key);
    if (known) return known;
    const t = this.drawn.tracks[track]!, p = this.drawn.pics[picture]!, source = (expression ? t.uvs?.[expression] : null) ?? t.uv, shift = helmet ? t.off?.[expression] : undefined, out = new Float32Array(source.length);
    for (let i = 0; i < source.length; i += 2) {
      out[i] = (source[i]! - p.x - (shift?.[0] ?? 0)) / p.w;
      out[i + 1] = (source[i + 1]! - p.y - (shift?.[1] ?? 0)) / p.h;
    }
    this.places.set(key, out);
    return out;
  }

  knownPlaces(): Iterable<Float32Array> { return this.places.values(); }

  /** Frees what a canvas holds of this package. */
  release(gl: Gl): void { Renderer.of(gl).release(this); }
}

/** The parts of a Phaser 3 scene that are used. */
interface PhaserExtern { render: (renderer: { gl: Gl; width: number; height: number }, camera: unknown, matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number; e?: number; f?: number }) => void; alpha: number; once(event: string, done: () => void): unknown }
interface PhaserScene { add: { extern(): unknown }; events: { on(event: string, f: (time: number, ms: number) => void): unknown; off(event: string, f: (time: number, ms: number) => void): unknown } }

/** One character on screen. It stands on its origin and faces right. */
export class PixoCharacter {
  pack: PixoCharacterPack;
  /** What it wears now, by slot. Change it with putOn and takeOff, or write to it. */
  wear: PixoWear;
  motion: string;
  time = 0;
  speed = 1;
  paused = false;
  /** The moment a blow lands. */
  onHit: (() => void) | null = null;
  /** A motion that does not repeat is over. */
  onEnd: ((motion: string) => void) | null = null;
  private last = new Map<string, Float32Array>();
  private from = new Map<string, Float32Array>();
  private since = 9;
  private toldHit = false;
  private toldEnd = false;
  private played = '';

  constructor(pack: PixoCharacterPack) {
    this.pack = pack;
    this.wear = { ...pack.data.items.start };
    this.motion = pack.data.motions.idle ? 'idle' : Object.keys(pack.data.motions)[0]!;
  }

  /** Puts a piece on. One that this character does not have is refused. */
  putOn(slot: PixoSlot, item: string): boolean {
    if (!this.pack.data.items[slot]?.includes(item)) return false;
    this.wear = { ...this.wear, [slot]: item };
    return true;
  }

  takeOff(slot: PixoSlot): void { const { [slot]: _, ...rest } = this.wear; this.wear = rest; }

  /** Changes into a saved outfit. */
  putOnOutfit(name: string): boolean {
    const found = this.pack.data.outfits?.find(o => o.name === name);
    if (found) this.wear = { ...found.wear };
    return Boolean(found);
  }

  /** Starts a motion from its beginning; `restart: false` lets one that is playing go on. */
  play(motion: string, options: { restart?: boolean } = {}): boolean {
    if (!this.pack.data.motions[motion]) return false;
    if (motion === this.motion && options.restart === false) return true;
    this.motion = motion;
    this.time = 0;
    this.toldHit = this.toldEnd = false;
    this.from = new Map([...this.last].map(([name, corners]) => [name, corners.slice()]));
    this.since = 0;
    return true;
  }

  /** The motion it is in. A package that was changed under it may not have it any more; then the first one it has. */
  get info(): PixoMotion {
    const { motions } = this.pack.data;
    if (!motions[this.motion]) { this.motion = motions.idle ? 'idle' : Object.keys(motions)[0]!; this.time = 0; }
    const key = this.pack.key(this.wear, this.motion), m = motions[key]!;
    if (key !== this.played) {
      // other hands: what is carried changes at once, so nothing is blended
      if (this.played.split('/').pop() === this.motion && this.time > 0) { this.since = 9; if (!m.loop) this.time = 0; }
      this.played = key;
    }
    return m;
  }

  /** Goes on by this many seconds. */
  update(seconds: number): void {
    if (this.paused) return;
    this.since += seconds;
    this.time += seconds * this.speed;
    const m = this.info;
    if (m.loop && this.time >= m.seconds) { this.time %= m.seconds; this.toldHit = false; }
    if (!this.toldHit && m.hit !== undefined && this.time >= m.hit) { this.toldHit = true; this.onHit?.(); }
    if (!this.toldEnd && !m.loop && this.time >= m.seconds) { this.toldEnd = true; this.onEnd?.(this.motion); }
  }

  /** Frame, next frame and how far it is between them. */
  private at(): [number, number, number] {
    const m = this.info, u = m.loop ? this.time % m.seconds / m.seconds * m.count : Math.min(this.time / m.seconds, 1) * (m.count - 1), a = Math.min(Math.floor(u), m.count - 1);
    return [m.from + a, m.from + (m.loop ? (a + 1) % m.count : Math.min(a + 1, m.count - 1)), u - a];
  }

  private corners(name: string, t: Track, [a, b, k]: [number, number, number]): Float32Array {
    const n = t.corners * 2, i0 = a * n, i1 = b * n;
    let out = this.last.get(name);
    if (!out || out.length !== n) this.last.set(name, out = new Float32Array(n));
    mix(out, t, t.all.subarray(i0, i0 + n), t.all.subarray(i1, i1 + n), k, 1);
    for (let i = 0; i < n; i++) out[i]! /= STEPS;
    const before = this.since < BLEND ? this.from.get(name) : undefined;
    if (before && before.length === n) {
      const x = this.since / BLEND;
      mix(out, t, before, out, x * x * (3 - 2 * x), 1 / STEPS);
    }
    return out;
  }

  /** Grip and tip of the weapon now, in package pixels: for hit boxes and trails. Null without a weapon. */
  blade(): { grip: [number, number]; tip: [number, number] } | null {
    const list = this.wear.weapon ? this.pack.data.blades[this.wear.weapon] : undefined, i = this.at()[0] * 4;
    return list ? { grip: [list[i]! / STEPS, list[i + 1]! / STEPS], tip: [list[i + 2]! / STEPS, list[i + 3]! / STEPS] } : null;
  }

  /**
   * What the weapon shoots now, for a game that flies it: the picture points up, `tail` is its rear end on the picture, `size`
   * package pixels for one of its pixels. It leaves from `from` towards `direction`, in package pixels. Null for what is not shot.
   */
  shot(): { picture: ImageBitmap; tail: [number, number]; size: number; from: [number, number]; direction: [number, number] } | null {
    const { data, pictures } = this.pack, s = data.shots?.[this.wear.weapon ?? ''], b = this.blade(), picture = s && pictures.get(s.picture);
    if (!s || !b || !picture) return null;
    const crop = data.pics[s.picture]!, type = this.pack.typeOf(this.wear), dx = b.tip[0] - b.grip[0], dy = b.tip[1] - b.grip[1], far = Math.hypot(dx, dy) || 1;
    // a staff is held upright and what it fires flies forward
    return { picture, tail: [s.tail[0] - crop.x, s.tail[1] - crop.y], size: s.size, from: type === 'bow' ? b.grip : b.tip, direction: type === 'staff' ? [1, 0] : [dx / far, dy / far] };
  }

  /** Draws it. The matrix goes from package pixels (x to the right, y down, standing on 0, 0) to clip space. */
  draw(gl: Gl, matrix: PixoMatrix, alpha = 1): void {
    const { data, tracks, pictures } = this.pack, place = this.at(), frame = place[0], { wear } = this, weapon = wear.weapon ?? '', face = data.faces[data.face[frame]!]!, done = new Map<string, Float32Array>(), renderer = Renderer.of(gl);
    const type = this.pack.typeOf(wear), shield = wear.shield && !(type && data.twoHanded?.includes(type)), hand = weapon.replace('weapon', ''), ahead = Boolean(type && data.farHand?.includes(type));
    renderer.begin(matrix);
    for (const slot of data.orders[data.order[frame]!]!) {
      const part = slot.endsWith('+') ? slot.slice(0, -1) : slot, layer = LAYERS[slot];
      let track = part, picture = part, expression = '';
      if (slot === 'hair' && wear.cape) continue;
      if (slot === 'shield' && !shield) continue;
      if (slot === 'weapon' ? ahead : slot === 'staff' ? type !== 'staff' : (slot === 'bow' || slot === 'string' || slot === 'shot') && type !== 'bow') continue;
      const farArm = part === 'armF' || part === 'creaseF';
      if (farArm) {
        track = part + (shield ? '' : hand);
        // whatever it holds, the far hand is the near one's fist
        picture = part === 'creaseF' ? type ? 'creaseN' : 'creaseF' : type ? 'armN' : 'armF';
      }
      if (slot === 'head') {
        expression = face;
        track = wear.head ? 'head' : 'bare';
        picture = (wear.head ? 'face/' : 'head/') + face;
      } else if (layer) {
        const item = wear[layer];
        if (!item) continue;
        if (slot === 'string' || slot === 'shot') track = picture = slot + hand;
        else if (slot === 'weapon' || slot === 'bow' || slot === 'staff' || slot === 'shield' || slot === 'cape') track = picture = item;
        else { picture = `${item}/${farArm ? picture : part}`; if (slot === 'head+') expression = face; }
      }
      const t = tracks.get(track), bitmap = pictures.get(picture);
      if (!t || !bitmap) continue;
      let corners = done.get(track);
      if (!corners) done.set(track, corners = this.corners(track, t, place));
      renderer.mesh(bitmap, corners, this.pack.place(track, picture, expression, slot === 'head+'), t, alpha);
    }
  }

  /** Adds it to a Phaser 3 scene and keeps it going. What comes back is a game object: move, scale, flip (`setScale(-1, 1)`) and destroy it. */
  addToPhaser(scene: unknown, x: number, y: number): unknown {
    const { add, events } = scene as PhaserScene, extern = add.extern() as PhaserExtern & { setPosition(x: number, y: number): unknown };
    extern.setPosition(x, y);
    extern.render = (renderer, _camera, m) => {
      const { gl, width, height } = renderer, sx = 2 / width, sy = -2 / height, e = m.tx ?? m.e ?? 0, f = m.ty ?? m.f ?? 0;
      this.draw(gl, [m.a * sx, m.b * sy, m.c * sx, m.d * sy, e * sx - 1, f * sy + 1], extern.alpha ?? 1);
    };
    const tick = (_time: number, ms: number): void => this.update(ms / 1000);
    events.on('update', tick);
    extern.once('destroy', () => { events.off('update', tick); });
    return extern;
  }
}
