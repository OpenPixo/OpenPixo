/**
 * 消息里那排缩略图收哪些图(`runtime/chat/turn-assets.ts`)。
 *
 * 用真实的 `buildTurnBlocks` 产出喂进去 —— 生图行的完成判据住在那一层,这里要证明的是
 * 「它判出来的完成格,原样出现在缩略图里」,而不是另写一份判据。
 */
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent, ProjectMediaTask } from '@openpixo/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import {
  collectTurnAssets,
  isGalleryImagePath,
  isTurnMediaPath,
  withoutGalleryImages,
} from '../../../src/runtime/chat/turn-assets';

const use = (id: string, name: string, input: unknown): PersistedAgentEvent => ({ kind: 'tool_use', id, name, input });
const result = (toolUseId: string, content = 'ok', isError = false): PersistedAgentEvent => ({ kind: 'tool_result', toolUseId, content, isError });
const scope = { projectId: 'p1', projectResolvedDir: '/work/knight', projectFileNames: new Set<string>() };

function assets(events: PersistedAgentEvent[], extra: { mediaTasks?: ProjectMediaTask[]; runStatus?: 'running' | 'succeeded' } = {}) {
  const blocks = buildTurnBlocks({
    events,
    runStatus: extra.runStatus ?? 'succeeded',
    ...(extra.mediaTasks ? { mediaTasks: extra.mediaTasks } : {}),
  });
  return collectTurnAssets(blocks, scope);
}

describe('3D models', () => {
  it('counts a GLB as something a turn made', () => {
    expect(isTurnMediaPath('models/chest.glb')).toBe(true);
    expect(isTurnMediaPath('models/chest.obj')).toBe(false);
  });
});

describe('collectTurnAssets — `pixo media generate` output', () => {
  it('reads the JSON lines of a finished batch, in cell order', () => {
    const command = 'pixo media generate --surface image --prompt a && pixo media generate --surface image --prompt b';
    const lines = [
      JSON.stringify({ status: 'done', file: { name: 'assets/hero-run.png' } }),
      JSON.stringify({ status: 'done', file: { name: 'assets/grass-tile.png' } }),
    ].join('\n');
    expect(assets([use('g', 'Bash', { command }), result('g', lines)])).toEqual([
      { path: 'assets/hero-run.png', source: 'media', kind: 'image' },
      { path: 'assets/grass-tile.png', source: 'media', kind: 'image' },
    ]);
  });

  it('only finished cells: a failed line stays in the record with its retry', () => {
    const command = 'pixo media generate --surface image --prompt a && pixo media generate --surface image --prompt b';
    const lines = [
      JSON.stringify({ status: 'done', file: { name: 'assets/a.png' } }),
      JSON.stringify({ status: 'failed', error: { message: 'quota' } }),
    ].join('\n');
    expect(assets([use('g', 'Bash', { command }), result('g', lines)]).map((a) => a.path)).toEqual(['assets/a.png']);
  });

  it('a call still in flight contributes nothing yet', () => {
    const command = 'pixo media generate --surface image --prompt a';
    expect(assets([use('g', 'Bash', { command })], { runStatus: 'running' })).toEqual([]);
  });

  it('media tasks are authoritative over the command output', () => {
    const command = 'pixo media generate --surface image --prompt a';
    const mediaTasks: ProjectMediaTask[] = [{
      taskId: 't1', status: 'done', startedAt: 1, endedAt: 900, elapsed: 899, progress: [], progressCount: 0,
      surface: 'image', file: { name: 'assets/from-task.png' },
    }];
    expect(assets([use('g', 'Bash', { command }), result('g', '')], { mediaTasks }).map((a) => a.path))
      .toEqual(['assets/from-task.png']);
  });

  it('audio and video generations come through as what they are', () => {
    const command = 'pixo media generate --surface audio --prompt jump';
    const line = JSON.stringify({ status: 'done', file: { name: 'audio/jump.mp3' } });
    expect(assets([use('g', 'Bash', { command }), result('g', line)]).map((asset) => asset.kind)).toEqual(['audio']);
    const video = JSON.stringify({ status: 'done', file: { name: 'video/intro.mp4' } });
    expect(assets([use('g', 'Bash', { command: 'pixo media generate --surface video --prompt intro' }), result('g', video)]).map((asset) => asset.kind)).toEqual(['video']);
  });

  it('absolute output paths are kept only with positive project-root evidence', () => {
    const command = 'pixo media generate --surface image --prompt a && pixo media generate --surface image --prompt b';
    const lines = [
      JSON.stringify({ status: 'done', path: '/work/knight/assets/in.png' }),
      JSON.stringify({ status: 'done', path: '/tmp/elsewhere/out.png' }),
    ].join('\n');
    expect(assets([use('g', 'Bash', { command }), result('g', lines)]).map((a) => a.path)).toEqual(['assets/in.png']);
  });
});

describe('collectTurnAssets — tools that write image files', () => {
  it('a finished Write of an image file inside the project is shown', () => {
    expect(assets([use('w', 'Write', { file_path: '/work/knight/assets/icon.svg', content: '<svg/>' }), result('w')]))
      .toEqual([{ path: 'assets/icon.svg', source: 'write', kind: 'image' }]);
  });

  it('failed writes, code files and writes outside the project are not', () => {
    const events = [
      use('a', 'Write', { file_path: '/work/knight/assets/bad.png' }), result('a', 'denied', true),
      use('b', 'Write', { file_path: '/work/knight/src/player.js' }), result('b'),
      use('c', 'Write', { file_path: '/tmp/scratch.png' }), result('c'),
    ];
    expect(assets(events)).toEqual([]);
  });

  it('the same path appears once even when generated and then edited', () => {
    const command = 'pixo media generate --surface image --prompt a';
    const events = [
      use('g', 'Bash', { command }), result('g', JSON.stringify({ status: 'done', file: { name: 'assets/hero.svg' } })),
      use('e', 'Edit', { file_path: '/work/knight/assets/hero.svg' }), result('e'),
    ];
    expect(assets(events)).toEqual([{ path: 'assets/hero.svg', source: 'media', kind: 'image' }]);
  });

  it('a turn that only read images shows nothing', () => {
    expect(assets([use('r', 'Read', { file_path: '/work/knight/assets/hero.png' }), result('r')])).toEqual([]);
  });
});

describe('collectTurnAssets — assets inside todo segments', () => {
  it('images produced while a todo was open are still collected', () => {
    const todos = (status: string) => ({ todos: [{ content: '生成角色', status, activeForm: '正在生成角色' }] });
    const command = 'pixo media generate --surface image --prompt hero';
    const events = [
      use('t1', 'TodoWrite', todos('in_progress')), result('t1'),
      use('g', 'Bash', { command }), result('g', JSON.stringify({ status: 'done', file: { name: 'assets/hero.png' } })),
      use('t2', 'TodoWrite', todos('completed')), result('t2'),
    ];
    expect(assets(events).map((a) => a.path)).toEqual(['assets/hero.png']);
  });
});

describe('withoutGalleryImages', () => {
  const entry = (path: string) => ({ path, name: path });

  it('drops only the images the gallery already shows', () => {
    const entries = [entry('assets/hero.png'), entry('index.html'), entry('assets/other.png')];
    const kept = withoutGalleryImages(entries, [{ path: 'assets/hero.png', source: 'media', kind: 'image' }]);
    expect(kept.map((e) => e.path)).toEqual(['index.html', 'assets/other.png']);
  });

  it('returns the same array when nothing overlaps', () => {
    const entries = [entry('index.html')];
    expect(withoutGalleryImages(entries, [{ path: 'assets/hero.png', source: 'media', kind: 'image' }])).toBe(entries);
    expect(withoutGalleryImages(entries, [])).toBe(entries);
  });
});

describe('isGalleryImagePath', () => {
  it.each(['a.png', 'A.PNG', 'b.jpeg', 'c.webp', 'd.gif', 'e.svg', 'f.png?v=2'])('%s is an image', (p) => {
    expect(isGalleryImagePath(p)).toBe(true);
  });
  it.each(['a.psd', 'b.aseprite', 'c.json', 'd.mp3', 'e'])('%s is not', (p) => {
    expect(isGalleryImagePath(p)).toBe(false);
  });
});
