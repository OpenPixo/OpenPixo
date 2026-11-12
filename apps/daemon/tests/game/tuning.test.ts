import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverGameTuning, setGameTuningValue } from '../../src/game/tuning.js';

const roots: string[] = [];
async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'pixo-t8-'));
  roots.push(root);
  for (const [name, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), source);
  }
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('lists nothing for a new project whose folder does not exist yet', async () => {
  const root = await project({});
  await expect(discoverGameTuning(path.join(root, 'not-written-yet'))).resolves.toEqual({ parameters: [], warnings: [] });
});

const player = [
  'class_name Player',
  'extends CharacterBody2D',
  '',
  '## Horizontal movement in pixels per second.',
  '@export var speed: float = 220.0 # keep this comment',
  '@export var acceleration: float = 1400.0',
  '@export var coyote_seconds: float = 0.10',
  '@export var buffer_seconds: float = 0.12',
  '@export_range(0.0, 1.0) var feedback_intensity: float = 1.0',
  '## Number of jumps.',
  '@export_range(1, 4, 1, "or_greater")',
  '\tvar jumps: int = 2',
  '  @export var enabled := true',
  '@export var nickname = "Player #1"',
  '@export var tint: Color = Color(0.2, 0.4, 1.0, 0.5)',
  '@export var accent = Color("#ff8040")',
  '@export var counter = 12',
  '@export var untyped_float = -2.5e1',
  '@export var calculated = speed * 2',
  '@export var resource: Resource = load("res://thing.tres")',
  '# @export var ignored = 123',
  'var private_value = 42',
  '',
].join('\r\n');

describe('game tuning discovery and deterministic writes', () => {
  it('discovers skill/recipe shapes, inferred literals, doc comments and ranges without evaluating code', async () => {
    const root = await project({ 'scripts/player.gd': player, '.godot/ignored.gd': '@export var ignored = 7' });
    const { parameters } = await discoverGameTuning(root);
    expect(parameters).toHaveLength(12);
    expect(parameters.find(p => p.key === 'speed')).toMatchObject({
      type: 'float', value: 220, defaultValue: 220, owner: 'Player', filePath: 'scripts/player.gd', line: 5,
      description: 'Horizontal movement in pixels per second.', source: 'godot-script',
    });
    expect(parameters.find(p => p.key === 'jumps')).toMatchObject({ type: 'int', value: 2, min: 1, max: 4, step: 1, description: 'Number of jumps.' });
    expect(parameters.find(p => p.key === 'feedback_intensity')).toMatchObject({ type: 'float', min: 0, max: 1 });
    expect(parameters.find(p => p.key === 'enabled')).toMatchObject({ type: 'bool', value: true });
    expect(parameters.find(p => p.key === 'nickname')).toMatchObject({ type: 'string', value: 'Player #1' });
    expect(parameters.find(p => p.key === 'tint')).toMatchObject({ type: 'color', value: '#3366ff80' });
    expect(parameters.find(p => p.key === 'accent')).toMatchObject({ type: 'color', value: '#ff8040ff' });
    expect(parameters.find(p => p.key === 'untyped_float')).toMatchObject({ type: 'float', value: -25 });
    expect(parameters.every(p => /^[a-f0-9]{64}$/.test(p.fileHash))).toBe(true);
  });

  it('finds overrides on scripted nodes and on external scene instances, with separate identities', async () => {
    const root = await project({
      'player.gd': '@export_range(0, 600, 10) var speed: float = 220.0\n@export var active = true\n',
      'player.tscn': '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://player.gd" id="1_player"]\n[node name="Player" type="CharacterBody2D"]\nscript = ExtResource("1_player")\nspeed = 240.0 # scene default\n',
      'main.tscn': '[gd_scene load_steps=2 format=3]\n[ext_resource type="PackedScene" path="res://player.tscn" id="1_scene"]\n[node name="Main" type="Node2D"]\n[node name="Hero" parent="." instance=ExtResource("1_scene")]\nspeed = 300.0\nactive = false\n',
    });
    const { parameters } = await discoverGameTuning(root);
    const sceneSpeed = parameters.find(p => p.filePath === 'main.tscn' && p.key === 'speed')!;
    expect(sceneSpeed).toMatchObject({ source: 'godot-scene', nodePath: 'Hero', scriptPath: 'player.gd', value: 300, defaultValue: 240, min: 0, max: 600, step: 10 });
    expect(parameters.find(p => p.filePath === 'player.tscn' && p.key === 'speed')).toMatchObject({ nodePath: '.', value: 240, defaultValue: 220 });
    expect(new Set(parameters.map(p => p.id)).size).toBe(parameters.length);
    await setGameTuningValue(root, { id: sceneSpeed.id, value: 320, fileHash: sceneSpeed.fileHash });
    expect(await readFile(path.join(root, 'main.tscn'), 'utf8')).toContain('speed = 320.0\nactive = false');
    expect(await readFile(path.join(root, 'player.gd'), 'utf8')).toContain('= 220.0');
  });

  it('replaces only the selected literal and preserves CRLF, indentation, annotations and comments', async () => {
    const root = await project({ 'player.gd': player });
    const speed = (await discoverGameTuning(root)).parameters.find(p => p.key === 'speed')!;
    const beforeWrite = vi.fn(async () => ({ id: 'checkpoint-1' }));
    const result = await setGameTuningValue(root, { id: speed.id, value: 260, fileHash: speed.fileHash }, { beforeWrite });
    expect(await readFile(path.join(root, 'player.gd'), 'utf8')).toBe(player.replace('220.0 #', '260.0 #'));
    expect(result.parameter.value).toBe(260);
    expect(result.checkpointId).toBe('checkpoint-1');
    expect(beforeWrite).toHaveBeenCalledOnce();
    expect(result.parameter.fileHash).not.toBe(speed.fileHash);
  });

  it('rejects stale hashes, type/range violations and missing ids without changing files', async () => {
    const root = await project({ 'player.gd': '@export_range(0, 600, 10) var speed: float = 220.0\n@export var count: int = 2\n' });
    const initial = await discoverGameTuning(root);
    const speed = initial.parameters.find(p => p.key === 'speed')!;
    const count = initial.parameters.find(p => p.key === 'count')!;
    await expect(setGameTuningValue(root, { id: speed.id, value: 700, fileHash: speed.fileHash })).rejects.toMatchObject({ code: 'TUNING_INVALID_VALUE' });
    await expect(setGameTuningValue(root, { id: count.id, value: 1.5, fileHash: count.fileHash })).rejects.toMatchObject({ code: 'TUNING_INVALID_VALUE' });
    await expect(setGameTuningValue(root, { id: speed.id, value: '240; quit()', fileHash: speed.fileHash })).rejects.toMatchObject({ code: 'TUNING_INVALID_VALUE' });
    await writeFile(path.join(root, 'player.gd'), '# edited elsewhere\n' + await readFile(path.join(root, 'player.gd'), 'utf8'));
    await expect(setGameTuningValue(root, { id: speed.id, value: 240, fileHash: speed.fileHash })).rejects.toMatchObject({ code: 'TUNING_CONFLICT' });
    await expect(setGameTuningValue(root, { id: '../../outside', value: 240, fileHash: speed.fileHash })).rejects.toMatchObject({ code: 'TUNING_NOT_FOUND' });
    expect(await readFile(path.join(root, 'player.gd'), 'utf8')).toContain('= 220.0');
  });

  it('checks the hash again after the checkpoint and fails closed when checkpoint creation fails', async () => {
    const original = '@export var speed = 220\n';
    const root = await project({ 'player.gd': original });
    const speed = (await discoverGameTuning(root)).parameters[0]!;
    await expect(setGameTuningValue(root, { id: speed.id, value: 240, fileHash: speed.fileHash }, {
      beforeWrite: async () => { throw new Error('checkpoint unavailable'); },
    })).rejects.toMatchObject({ code: 'TUNING_CHECKPOINT_FAILED' });
    expect(await readFile(path.join(root, 'player.gd'), 'utf8')).toBe(original);
    await expect(setGameTuningValue(root, { id: speed.id, value: 240, fileHash: speed.fileHash }, {
      beforeWrite: async () => { await writeFile(path.join(root, 'player.gd'), original + '# user edit\n'); },
    })).rejects.toMatchObject({ code: 'TUNING_CONFLICT' });
    expect(await readFile(path.join(root, 'player.gd'), 'utf8')).toBe(original + '# user edit\n');
  });

  it('reads root/src tuning JSON and edits just value tokens, including escaped keys and repeated numbers', async () => {
    const source = '{\r\n  "speed": { "value": 220, "min": 0, "max": 600, "step": 10, "label": "Speed", "group": "Player" },\r\n  "jump\\\"height": { "value": 220, "min": 0 },\r\n  "enabled": { "value": true },\r\n  "title": { "value": "Ready" }\r\n}\r\n';
    const root = await project({ 'src/tuning.json': source, 'tuning.json': '{"gravity":{"value":1000}}' });
    const initial = await discoverGameTuning(root);
    expect(initial.parameters).toHaveLength(5);
    const speed = initial.parameters.find(p => p.key === 'speed')!;
    expect(speed).toMatchObject({ source: 'web-json', type: 'int', value: 220, label: 'Speed', group: 'Player', line: 2 });
    await setGameTuningValue(root, { id: speed.id, value: 250, fileHash: speed.fileHash });
    expect(await readFile(path.join(root, 'src/tuning.json'), 'utf8')).toBe(source.replace('"value": 220', '"value": 250'));
  });

  it('writes strings as escaped literals and colors with alpha without injecting executable code', async () => {
    const root = await project({ 'player.gd': '@export var title = \'Hello\' # text\n@export var tint = Color(1, 1, 1, 0.5)\n' });
    let list = await discoverGameTuning(root);
    const title = list.parameters.find(p => p.key === 'title')!;
    const text = '\' #\nquit()';
    await setGameTuningValue(root, { id: title.id, value: text, fileHash: title.fileHash });
    list = await discoverGameTuning(root);
    expect(list.parameters.find(p => p.key === 'title')?.value).toBe(text);
    const tint = list.parameters.find(p => p.key === 'tint')!;
    await setGameTuningValue(root, { id: tint.id, value: '#ff804080', fileHash: tint.fileHash });
    expect((await discoverGameTuning(root)).parameters.find(p => p.key === 'tint')?.value).toBe('#ff804080');
    expect(await readFile(path.join(root, 'player.gd'), 'utf8')).toContain(' # text\n');
  });

  it('preserves a UTF-8 BOM when the first line is an exported declaration', async () => {
    const root = await project({ 'player.gd': '\uFEFF@export var speed = 220\r\n' });
    const speed = (await discoverGameTuning(root)).parameters[0]!;
    await setGameTuningValue(root, { id: speed.id, value: 240, fileHash: speed.fileHash });
    expect(await readFile(path.join(root, 'player.gd'), 'utf8')).toBe('\uFEFF@export var speed = 240\r\n');
  });

  it('serializes scene Color overrides with numeric channels accepted by the scene format', async () => {
    const root = await project({
      'player.gd': '@export var tint: Color = Color(1, 1, 1, 1)\n',
      'main.tscn': '[gd_scene format=3]\n[ext_resource type="Script" path="res://player.gd" id="1"]\n[node name="Player" type="Node2D"]\nscript = ExtResource("1")\ntint = Color(1, 0, 0, 1) # keep\n',
    });
    const tint = (await discoverGameTuning(root)).parameters.find(p => p.source === 'godot-scene')!;
    await setGameTuningValue(root, { id: tint.id, value: '#00ff00ff', fileHash: tint.fileHash });
    expect(await readFile(path.join(root, 'main.tscn'), 'utf8')).toContain('tint = Color(0, 1, 0, 1) # keep');
  });

  it('keeps same-named local-class exports distinct and binds scene overrides to root script members', async () => {
    const source = 'class_name Player\nclass EnemySettings:\n\t@export var speed: float = 120.0\n@export var speed: float = 220.0\n';
    const root = await project({
      'player.gd': source,
      'main.tscn': '[gd_scene format=3]\n[ext_resource type="Script" path="res://player.gd" id="1"]\n[node name="Player" type="Node2D"]\nscript = ExtResource("1")\nspeed = 300.0\n',
    });
    const list = await discoverGameTuning(root);
    const scriptValues = list.parameters.filter(p => p.source === 'godot-script');
    expect(scriptValues).toHaveLength(2);
    expect(new Set(scriptValues.map(p => p.id)).size).toBe(2);
    expect(list.parameters.find(p => p.source === 'godot-scene')?.defaultValue).toBe(220);
    const playerSpeed = scriptValues.find(p => p.line === 4)!;
    await setGameTuningValue(root, { id: playerSpeed.id, value: 240, fileHash: playerSpeed.fileHash });
    expect(await readFile(path.join(root, 'player.gd'), 'utf8')).toBe(source.replace('220.0', '240.0'));
  });

  it('keeps HDR Color literals editable without clipping channels or accepting expressions', async () => {
    const script = '@export var glow: Color = Color(2.5, 0.25, 1.0, 1.0) # HDR\n';
    const scene = '[gd_scene format=3]\n[ext_resource type="Script" path="res://player.gd" id="1"]\n[node name="Player" type="Node2D"]\nscript = ExtResource("1")\nglow = Color(4.0, 0.25, 1.0, 1.0) # instance\n';
    const root = await project({ 'player.gd': script, 'main.tscn': scene });
    const list = await discoverGameTuning(root);
    expect(list.parameters).toHaveLength(2);
    const glow = list.parameters.find(p => p.source === 'godot-scene')!;
    expect(glow).toMatchObject({ type: 'color', value: 'Color(4.0, 0.25, 1.0, 1.0)', defaultValue: 'Color(2.5, 0.25, 1.0, 1.0)' });
    await expect(setGameTuningValue(root, { id: glow.id, value: 'Color(3, 1, 1, 1); quit()', fileHash: glow.fileHash }))
      .rejects.toMatchObject({ code: 'TUNING_INVALID_VALUE' });
    await setGameTuningValue(root, { id: glow.id, value: 'Color(3.0, 0.25, 1.0, 1.0)', fileHash: glow.fileHash });
    expect(await readFile(path.join(root, 'main.tscn'), 'utf8')).toBe(scene.replace('Color(4.0', 'Color(3.0'));
    expect(await readFile(path.join(root, 'player.gd'), 'utf8')).toBe(script);
  });
});


it('reads optional locale maps from tuning.json, ignores malformed entries, and preserves them when saving', async () => {
  const source = JSON.stringify({ speed: { value: 220, label: 'Move speed', group: 'Player',
    label_i18n: { 'zh-CN': '移动速度', en: 'Move speed', invalid: 42, empty: '' }, group_i18n: { 'zh-CN': '角色' } },
    jump: { value: -460, label_i18n: ['bad'], group_i18n: 'bad' } }, null, 2);
  const root = await project({ 'src/tuning.json': source });
  const list = await discoverGameTuning(root);
  const speed = list.parameters.find(p => p.key === 'speed')!;
  expect(speed).toMatchObject({ label_i18n: { 'zh-CN': '移动速度', en: 'Move speed' }, group_i18n: { 'zh-CN': '角色' } });
  expect(speed.label_i18n).toEqual({ 'zh-CN': '移动速度', en: 'Move speed' });
  const jump = list.parameters.find(p => p.key === 'jump')!;
  expect(jump.label_i18n).toBeUndefined(); expect(jump.group_i18n).toBeUndefined();
  await setGameTuningValue(root, { id: speed.id, value: 260, fileHash: speed.fileHash });
  expect(await readFile(path.join(root, 'src/tuning.json'), 'utf8')).toBe(source.replace('"value": 220', '"value": 260'));
});
