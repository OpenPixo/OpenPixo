import path from 'node:path';
import sharp from 'sharp';
import { choiceParam, integerParam, writeNew } from './files.js';
import { image, outputStem, type OpPlan } from './images.js';

export interface PackInput { source: string; file: string; width: number; height: number }
interface Rect { x: number; y: number; w: number; h: number }
const contains = (a: Rect, b: Rect) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

/** MaxRects best-short-side-fit, no rotations; stable ties follow input order. */
export function planPack(inputs: PackInput[], params: Record<string, unknown>, out: string): OpPlan {
  const maxSize = integerParam(params, 'maxSize', 2048, 1);
  const padding = integerParam(params, 'padding', 0, 0, 1024);
  const format = choiceParam(params, 'format', ['texturepacker-json', 'godot-tres'] as const, 'texturepacker-json');
  let free: Rect[] = [{ x: 0, y: 0, w: maxSize, h: maxSize }];
  const placed: (PackInput & Rect)[] = [];
  for (const input of inputs.slice().sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) || b.width * b.height - a.width * a.height)) {
    const w = input.width + 2 * padding, h = input.height + 2 * padding;
    const candidate = free.filter(rect => w <= rect.w && h <= rect.h).sort((a, b) =>
      Math.min(a.w - w, a.h - h) - Math.min(b.w - w, b.h - h) || Math.max(a.w - w, a.h - h) - Math.max(b.w - w, b.h - h))[0];
    if (!candidate) throw new Error(`Atlas exceeds maxSize ${maxSize}; cannot fit ${input.source}`);
    const used = { x: candidate.x, y: candidate.y, w, h };
    placed.push({ ...input, x: used.x + padding, y: used.y + padding, w: input.width, h: input.height });
    free = free.flatMap(rect => {
      if (used.x >= rect.x + rect.w || used.x + used.w <= rect.x || used.y >= rect.y + rect.h || used.y + used.h <= rect.y) return [rect];
      const split: Rect[] = [];
      if (used.x > rect.x) split.push({ ...rect, w: used.x - rect.x });
      if (used.x + used.w < rect.x + rect.w) split.push({ ...rect, x: used.x + used.w, w: rect.x + rect.w - used.x - used.w });
      if (used.y > rect.y) split.push({ ...rect, h: used.y - rect.y });
      if (used.y + used.h < rect.y + rect.h) split.push({ ...rect, y: used.y + used.h, h: rect.y + rect.h - used.y - used.h });
      return split;
    });
    free = free.filter((rect, i) => !free.some((other, j) => i !== j && contains(other, rect) && (!contains(rect, other) || j < i)));
  }
  const width = Math.max(...placed.map(rect => rect.x + rect.w + padding));
  const height = Math.max(...placed.map(rect => rect.y + rect.h + padding));
  const stem = `${outputStem(out, inputs[0]!.source)}.atlas`;
  const atlas = `${stem}.png`, descriptor = `${stem}.${format === 'godot-tres' ? 'tres' : 'json'}`;
  const ordered = inputs.map(input => placed.find(rect => rect.source === input.source)!);
  const frames = Object.fromEntries(ordered.map(rect => [rect.source, { frame: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: rect.w, h: rect.h }, sourceSize: { w: rect.w, h: rect.h } }]));
  // Godot 4 format=3 SpriteFrames: atlas ext_resource plus one AtlasTexture per frame.
  // Relative texture paths keep the pair relocatable (Godot's text resource format).
  const tres = () => `[gd_resource type="SpriteFrames" load_steps=${ordered.length + 2} format=3]\n\n`
    + `[ext_resource type="Texture2D" path=${JSON.stringify(path.posix.basename(atlas))} id="1_atlas"]\n\n`
    + ordered.map((rect, i) => `[sub_resource type="AtlasTexture" id="AtlasTexture_${i}"]\natlas = ExtResource("1_atlas")\nregion = Rect2(${rect.x}, ${rect.y}, ${rect.w}, ${rect.h})\n`).join('\n')
    + `\n[resource]\nanimations = [{\n"frames": [${ordered.map((_, i) => `{ "duration": 1.0, "texture": SubResource("AtlasTexture_${i}") }`).join(', ')}],\n"loop": true,\n"name": &"default",\n"speed": 5.0\n}]\n`;
  return { outputs: [atlas, descriptor], detail: { width, height, frames }, produce: async ([png, description]) => {
    const overlays = [];
    for (const rect of ordered) overlays.push({ input: await image(rect.file).png().toBuffer(), left: rect.x, top: rect.y });
    await writeNew(png!, await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(overlays).png().toBuffer());
    await writeNew(description!, format === 'godot-tres' ? tres() : `${JSON.stringify({ frames, meta: { app: 'OpenPixo', version: '1.0', image: path.posix.basename(atlas), format: 'RGBA8888', size: { w: width, h: height }, scale: '1' } }, null, 2)}\n`);
  } };
}
