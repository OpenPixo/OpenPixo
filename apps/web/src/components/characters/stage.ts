import type { LocalCharacter } from '@openpixo/contracts';
import { characterFile } from '../../providers/characters';
import { PixoCharacterPack, type PixoBox, type PixoCharacter, type PixoWear } from '../../lib/characters/pixo-character';

/**
 * Characters on the page. One hidden WebGL canvas draws every one of them and each view copies its
 * part, so a page full of cards does not run out of canvases.
 */
let shared: { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null | undefined;

function context(): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  if (shared !== undefined && !shared?.gl.isContextLost()) return shared;
  const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  shared = gl ? { canvas, gl } : null;
  return shared;
}

export const canShowCharacters = (): boolean => context() !== null;

/** Packages that were read, newest last. Decoded they take some 15 MB each. */
const KEEP = 8;
const packs = new Map<string, Promise<PixoCharacterPack>>();

/** The newest package of a character. A revision never changes, so it is read once. */
export function loadPack(character: Pick<LocalCharacter, 'id' | 'revision'>): Promise<PixoCharacterPack> {
  const key = `${character.id}/${character.revision}`;
  let pack = packs.get(key);
  if (pack) packs.delete(key);
  else {
    pack = PixoCharacterPack.load(characterFile(character.id, character.revision, ''));
    pack.catch(() => { if (packs.get(key) === pack) packs.delete(key); });
  }
  packs.set(key, pack);
  while (packs.size > KEEP) {
    const [oldest, gone] = packs.entries().next().value!;
    packs.delete(oldest);
    void gone.then(p => { if (shared) p.release(shared.gl); }, () => { /* it never came */ });
  }
  return pack;
}

export interface Placed { scale: number; x: number; y: number }
/** Where the character stands in a box of this size: pixels per package pixel, and the point under its feet. */
export type Frame = (width: number, height: number, actor: PixoCharacter) => Placed;

const boxes = new WeakMap<PixoCharacterPack, Map<string, PixoBox>>();
function box(pack: PixoCharacterPack, wear: PixoWear, motion: string, frames?: number): PixoBox {
  let known = boxes.get(pack);
  if (!known) boxes.set(pack, known = new Map());
  const key = `${JSON.stringify(wear)}${motion}${frames ?? ''}`;
  let found = known.get(key);
  if (!found) known.set(key, found = pack.box(wear, motion, frames));
  return found;
}

/** How far the character reaches in any of its motions, with what it wears. */
function reach(actor: PixoCharacter): PixoBox {
  const all = Object.keys(actor.pack.data.motions).map(m => box(actor.pack, actor.wear, m));
  return [Math.min(...all.map(b => b[0])), Math.min(...all.map(b => b[1])), Math.max(...all.map(b => b[2])), Math.max(...all.map(b => b[3]))];
}

export const FRAMES = {
  /** The standing character fills the box. */
  card: (w: number, h: number, a: PixoCharacter): Placed => {
    const b = box(a.pack, a.wear, a.pack.data.motions.idle ? 'idle' : a.motion, 1), scale = Math.min(w * 0.84 / (b[2] - b[0]), h * 0.84 / (b[3] - b[1]));
    return { scale, x: w / 2 - (b[0] + b[2]) / 2 * scale, y: h * 0.93 - b[3] * scale };
  },
  /** Room for every motion; `zoom` comes closer. */
  stage: (zoom: number) => (w: number, h: number, a: PixoCharacter): Placed => {
    const r = reach(a), ground = h * 0.86, fit = Math.min((ground - 8) / -r[1], (w - 20) / (r[2] - r[0]), 1.7), scale = fit * zoom;
    return { scale, x: w / 2 - (zoom > 1 ? 40 : (r[0] + r[2]) / 2) * scale, y: ground };
  },
} as const;

/** Draws an actor into a canvas of its own size. */
export function paint(target: HTMLCanvasElement, actor: PixoCharacter, frame: Frame): void {
  const c = context(), ctx = target.getContext('2d'), w = target.clientWidth, h = target.clientHeight;
  if (!c || !ctx || !w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (target.width !== W || target.height !== H) { target.width = W; target.height = H; }
  const { scale, x, y } = frame(w, h, actor), s = scale * dpr;
  if (c.canvas.width < W || c.canvas.height < H) { c.canvas.width = Math.max(c.canvas.width, W); c.canvas.height = Math.max(c.canvas.height, H); }
  const { gl } = c;
  gl.viewport(0, 0, W, H);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, W, H);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  actor.draw(gl, [2 * s / W, 0, 0, -2 * s / H, 2 * x * dpr / W - 1, 1 - 2 * y * dpr / H]);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(c.canvas, 0, c.canvas.height - H, W, H, 0, 0, W, H);
}

/** Moves and draws while the canvas is on screen. Returns the stop. */
export function run(target: HTMLCanvasElement, actor: PixoCharacter, frame: () => Frame, tick?: () => void): () => void {
  let before = performance.now(), handle = 0;
  const step = (now: number): void => {
    const seconds = Math.min((now - before) / 1000, 0.05);
    before = now;
    const box = target.getBoundingClientRect();
    actor.update(seconds);
    if (box.bottom > 0 && box.top < window.innerHeight) paint(target, actor, frame());
    tick?.();
    handle = requestAnimationFrame(step);
  };
  handle = requestAnimationFrame(step);
  return () => cancelAnimationFrame(handle);
}

/** Whether both feet leave the ground in a motion: only then is there a jump to make higher. */
export function jumps(pack: PixoCharacterPack, motion: string): boolean {
  const m = pack.data.motions[motion];
  if (!m) return false;
  const low = (frame: number): number => {
    let y = -Infinity;
    for (const name of ['legF', 'legN']) { const t = pack.tracks.get(name); if (t) for (let i = frame * t.corners * 2 + 1, end = (frame + 1) * t.corners * 2; i < end; i += 2) y = Math.max(y, t.all[i]! / 8); }
    return y;
  };
  const ground = low(m.from);
  for (let f = m.from; f < m.from + m.count; f++) if (low(f) < ground - 14) return true;
  return false;
}
