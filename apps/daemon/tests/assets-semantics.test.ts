import { describe, expect, it } from 'vitest';
import { parseAssetEvidence } from '../src/assets/semantics.js';

const frame = { frame: { x: 0, y: 0, w: 16, h: 16 } };
const wav = Buffer.alloc(80);
wav.write('RIFF'); wav.writeUInt32LE(72, 4); wav.write('WAVE', 8); wav.write('smpl', 12);
wav.writeUInt32LE(60, 16); wav.writeUInt32LE(1, 48); wav.writeUInt32LE(10, 64); wav.writeUInt32LE(99, 68);

describe('evidence-based asset semantics', () => {
  it.each([
    ['TexturePacker hash', 'sheet.json', JSON.stringify({ frames: { idle: frame }, meta: { image: 'sheet.png' } }), 'sheet.png', 'atlas'],
    ['TexturePacker array', 'sheet.json', JSON.stringify({ frames: [{ filename: 'idle', ...frame }], meta: { image: 'sheet.png' } }), 'sheet.png', 'atlas'],
    ['Aseprite', 'sheet.json', JSON.stringify({ frames: { idle: { ...frame, duration: 100 } }, meta: { image: 'sheet.png', app: 'https://www.aseprite.org/' } }), 'sheet.png', 'sprite-sheet'],
    ['libGDX atlas', 'sheet.atlas', 'sheet.png\nsize: 16, 16\nformat: RGBA8888\nidle\n  xy: 0, 0\n  size: 16, 16\n', 'sheet.png', 'atlas'],
    ['Spine atlas', 'sheet.atlas', 'sheet.png\nsize: 16,16\npma: false\nidle\n bounds: 0,0,16,16\n', 'sheet.png', 'atlas'],
    ['Godot SpriteFrames', 'anim.tres', '[gd_resource type="SpriteFrames" load_steps=2 format=3]\n[ext_resource type="Texture2D" path="res://sheet.png" id="1"]', 'sheet.png', 'sprite-sheet'],
    ['Godot AtlasTexture', 'anim.tres', '[gd_resource type="AtlasTexture" format=3]\n[ext_resource type="Texture2D" path="res://sheet.png" id="1"]', 'sheet.png', 'atlas'],
    ['Godot TileSet', 'tiles.tres', '[gd_resource type="TileSet" format=3]\n[ext_resource type="Texture2D" path="res://tiles.png" id="1"]', 'tiles.png', 'tileset'],
    ['Godot NinePatchRect', 'ui.tscn', '[ext_resource type="Texture2D" path="res://panel.png" id="1"]\n[node name="Panel" type="NinePatchRect"]\ntexture = ExtResource("1")', 'panel.png', 'nine-slice'],
    ['Tiled TSX', 'tiles.tsx', '<tileset><image source="tiles.png" width="16" height="16"/></tileset>', 'tiles.png', 'tileset'],
    ['Tiled TMX', 'tiles.tmx', '<map><tileset><image source="tiles.png"/></tileset></map>', 'tiles.png', 'tileset'],
    ['Unity sprites', 'sheet.png.meta', 'guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nTextureImporter:\n  spriteMode: 2\n  spriteSheet:\n    sprites: []', 'sheet.png', 'sprite-sheet'],
    ['Unity border', 'panel.png.meta', 'TextureImporter:\n  spriteBorder: {x: 2, y: 3, z: 4, w: 5}', 'panel.png', 'nine-slice'],
    ['Godot loop', 'loop.ogg.import', '[remap]\nimporter="oggvorbisstr"\nuid="uid://music"\n[params]\nloop=true', 'loop.ogg', 'loop'],
    ['WAV smpl', 'loop.wav', wav, 'loop.wav', 'loop'],
    ['OGG comment', 'loop.ogg', Buffer.from('OggS\x00vorbis\x00LOOPSTART=32\x00LOOPEND=99'), 'loop.ogg', 'loop'],
  ])('%s', (_name, source, bytes, target, type) => {
    const evidence = parseAssetEvidence(source as string, bytes as string | Buffer);
    expect(evidence.find(item => item.target === target)?.semantics).toEqual(expect.arrayContaining([expect.objectContaining({ type, source })]));
  });

  it('preserves frame durations, loop sample positions and paired engine identifiers', () => {
    const animation = parseAssetEvidence('sheet.json', JSON.stringify({ frames: { idle: { ...frame, duration: 80 } }, meta: { image: 'sheet.png', frameTags: [] } }));
    expect(animation[0]?.semantics[0]?.frames?.[0]?.durationMs).toBe(80);
    expect(parseAssetEvidence('loop.wav', wav)[0]?.semantics[0]?.loop).toEqual({ start: 10, end: 99 });
    expect(parseAssetEvidence('a.png.meta', 'guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nTextureImporter:')[0]?.engineMeta)
      .toMatchObject({ engine: 'unity', guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', importer: 'TextureImporter' });
    expect(parseAssetEvidence('a.png.import', 'uid="uid://abc"\nimporter="texture"')[0]?.engineMeta)
      .toMatchObject({ engine: 'godot', uid: 'uid://abc', importer: 'texture' });
  });

  it('does not infer semantics without evidence or follow escaping descriptor references', () => {
    for (const source of ['sprite.png', 'atlas.json', 'grid.png', 'music.ogg', 'bad.wav']) expect(parseAssetEvidence(source, Buffer.from('unrelated bytes'))).toEqual([]);
    expect(parseAssetEvidence('x.json', JSON.stringify({ frames: { idle: frame }, meta: { image: '../../outside.png' } }))).toEqual([]);
    expect(parseAssetEvidence('x.png.meta', 'spriteMode: 1\nspriteBorder: {x: 0, y: 0, z: 0, w: 0}')[0]?.semantics).toEqual([]);
  });
});
