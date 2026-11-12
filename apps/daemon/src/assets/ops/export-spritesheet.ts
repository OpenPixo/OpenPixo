import path from 'node:path';
import sharp from 'sharp';
import { choiceParam, integerParam, numberParam, writeNew } from './files.js';
import { image, type OpPlan } from './images.js';
import type { PackInput } from './pack.js';

export type SpriteExportFormat = 'godot' | 'phaser' | 'aseprite';
export const spriteExportFormat = (engine?: string): SpriteExportFormat => engine === 'godot' ? 'godot' : engine === 'phaser' ? 'phaser' : 'aseprite';
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Row-major frames, equal cells, no rotations or interpolation. Each row is one named animation. */
export function planSpritesheet(inputs: PackInput[], params: Record<string, unknown>, out: string, engine?: string): OpPlan {
  const aliases = new Map([['godot-spriteframes', 'godot'], ['phaser-atlas', 'phaser'], ['aseprite-json', 'aseprite']]);
  params = { ...params, format: aliases.get(String(params.format)) ?? params.format };
  const format = params.format === undefined || params.format === 'auto' ? spriteExportFormat(engine)
    : choiceParam(params, 'format', ['godot', 'phaser', 'aseprite'] as const);
  const columns = integerParam(params, 'columns', inputs.length, 1, 512);
  if (!inputs.length || inputs.length % columns) throw new Error('Frame count must be divisible by columns');
  const rows = inputs.length / columns;
  const fps = numberParam(params, 'fps', 8, 0.01, 240);
  const loop = params.loop ?? true;
  if (typeof loop !== 'boolean') throw new Error('loop must be boolean');
  const name = params.name ?? 'spritesheet';
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(name) || name.includes('..')) throw new Error('name must be a plain filename stem');
  const animations = params.animations === undefined ? Array.from({ length: rows }, (_, i) => rows === 1 ? 'default' : `row-${i + 1}`)
    : typeof params.animations === 'string' ? params.animations.split(',').map(value => value.trim()) : params.animations;
  if (!Array.isArray(animations) || animations.length !== rows || animations.some(value => typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value))
    || new Set(animations).size !== rows) throw new Error('animations must contain one unique name per row');
  const names = animations as string[];
  const cell = inputs[0]!;
  if (inputs.some(input => input.width !== cell.width || input.height !== cell.height)) throw new Error('All sprite frames must have equal dimensions');
  const width = cell.width * columns, height = cell.height * rows;
  if (width > 8192 || height > 8192 || width * height > 64 * 1024 * 1024) throw new Error('Sprite sheet exceeds image limits');
  const atlas = path.posix.join(out, `${name}.png`);
  const descriptor = path.posix.join(out, `${name}.${format === 'godot' ? 'tres' : `${format}.json`}`);
  const animationFile = path.posix.join(out, `${name}.animations.json`);
  const ordered = inputs.map((input, index) => ({ ...input, index, key: `${names[Math.floor(index / columns)]}/${String(index % columns).padStart(4, '0')}`,
    x: index % columns * cell.width, y: Math.floor(index / columns) * cell.height }));
  const frames = Object.fromEntries(ordered.map(frame => [frame.key, { frame: { x: frame.x, y: frame.y, w: cell.width, h: cell.height },
    rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: cell.width, h: cell.height }, sourceSize: { w: cell.width, h: cell.height },
    ...(format === 'aseprite' ? { duration: Math.round(1000 / fps) } : {}) }]));
  const meta = { app: 'OpenPixo', version: '1.0', image: path.posix.basename(atlas), format: 'RGBA8888', size: { w: width, h: height }, scale: '1' };
  // https://docs.godotengine.org/en/stable/classes/class_spriteframes.html (Godot 4 text resources, format=3).
  const tres = () => `[gd_resource type="SpriteFrames" load_steps=${inputs.length + 2} format=3]\n\n`
    + `[ext_resource type="Texture2D" path=${JSON.stringify(`res://${atlas}`)} id="1_atlas"]\n\n`
    + ordered.map(frame => `[sub_resource type="AtlasTexture" id="AtlasTexture_${frame.index}"]\natlas = ExtResource("1_atlas")\nregion = Rect2(${frame.x}, ${frame.y}, ${cell.width}, ${cell.height})\n`).join('\n')
    + `\n[resource]\nanimations = [${names.map((animation, row) => `{\n"frames": [${ordered.slice(row * columns, (row + 1) * columns).map(frame => `{ "duration": 1.0, "texture": SubResource("AtlasTexture_${frame.index}") }`).join(', ')}],\n"loop": ${loop},\n"name": &${JSON.stringify(animation)},\n"speed": ${Number.isInteger(fps) ? fps.toFixed(1) : fps}\n}`).join(', ')}]\n`;
  const outputs = [atlas, descriptor, ...(format === 'phaser' ? [animationFile] : [])];
  return { outputs, detail: { width, height, columns, rows, fps, format, animations: names, frameCount: inputs.length }, produce: async targets => {
    const overlays = [];
    for (const frame of ordered) overlays.push({ input: await image(frame.file).png().toBuffer(), left: frame.x, top: frame.y });
    await writeNew(targets[0]!, await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(overlays).png().toBuffer());
    await writeNew(targets[1]!, format === 'godot' ? tres() : json({ frames, meta: { ...meta,
      // Aseprite JSON Hash: inclusive frame tags describe each row's animation.
      ...(format === 'aseprite' ? { frameTags: names.map((animation, row) => ({ name: animation, from: row * columns, to: (row + 1) * columns - 1, direction: 'forward', ...(loop ? {} : { repeat: '1' }) })) } : {}) } }));
    if (format === 'phaser') {
      // Load with scene.load.atlas(texture.key, texture.image, texture.atlas), then scene.anims.fromJSON(config).
      // https://docs.phaser.io/phaser/concepts/animations
      await writeNew(targets[2]!, json({ texture: { key: name, image: path.posix.basename(atlas), atlas: path.posix.basename(descriptor) },
        anims: names.map((animation, row) => ({ key: `${name}-${animation}`, frames: ordered.slice(row * columns, (row + 1) * columns).map(frame => ({ key: name, frame: frame.key })),
          frameRate: fps, repeat: loop ? -1 : 0 })) }));
    }
  } };
}
