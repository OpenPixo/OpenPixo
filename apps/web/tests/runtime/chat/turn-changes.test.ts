import type { ProjectCheckpoint } from '@openpixo/contracts';
import { describe, expect, it } from 'vitest';
import type { ToolRow, TurnBlock } from '../../../src/runtime/chat/contract';
import { turnChangeRows, turnChangeTotals } from '../../../src/runtime/chat/turn-changes';
import { withCheckpointAssets } from '../../../src/runtime/chat/turn-assets';

const scope = { projectId: 'p', projectResolvedDir: 'C:/games/demo' };

function tool(overrides: Partial<ToolRow>): ToolRow {
  return {
    kind: 'tool', id: 't', tool: 'edit', name: 'Edit', title: '', rawTitle: false, file: null, pattern: null, hits: null,
    delta: null, elapsedMs: null, pending: false, failed: false, failReason: null, command: null, terminal: null, ...overrides,
  };
}

function shell(...items: ToolRow[]): TurnBlock[] {
  return [{ kind: 'shell', id: 's', status: 'done', stopped: false, thinking: false, elapsedMs: null, quietMs: null, items, segments: [] }];
}

function checkpoint(runChanges: ProjectCheckpoint['runChanges']): ProjectCheckpoint {
  return { id: 'cp-1', runId: 'r', conversationId: 'c', createdAt: '', summary: '', kind: 'run', changedFileCount: 0, runChanges, completedAt: '' };
}

const written = tool({ tool: 'write', file: { path: 'C:/games/demo/src/game.js', label: 'game.js' }, delta: { added: 10, removed: 0 } });

describe('turnChangeRows', () => {
  it('trusts the frozen checkpoint: files a script wrote count, with diff access and real line counts', () => {
    const rows = turnChangeRows({
      blocks: shell(written),
      scope,
      checkpoint: checkpoint([{ path: 'src/game.js', status: 'modified' }, { path: 'gen/table.json', status: 'added' }]),
      counts: new Map([['src/game.js', { additions: 3, deletions: 1 }]]),
    });
    expect(rows).toEqual([
      { path: 'src/game.js', status: 'modified', added: 3, removed: 1, checkpointId: 'cp-1' },
      { path: 'gen/table.json', status: 'added', added: null, removed: null, checkpointId: 'cp-1' },
    ]);
  });

  it('shows the tool rows numbers until the checkpoint counts arrive', () => {
    const rows = turnChangeRows({ blocks: shell(written), scope, checkpoint: checkpoint([{ path: 'src/game.js', status: 'added' }]), counts: new Map() });
    expect(rows[0]).toMatchObject({ added: 10, removed: 0 });
  });

  it('leaves media to the gallery and hides OpenPixo staging', () => {
    const rows = turnChangeRows({
      blocks: [],
      scope,
      checkpoint: checkpoint([
        { path: 'art/hero.png', status: 'added' }, { path: 'audio/jump.wav', status: 'added' },
        { path: 'video/intro.mp4', status: 'added' }, { path: '.pixo-skills/x/SKILL.md', status: 'added' },
        { path: 'src/a.js', status: 'added' },
      ]),
      counts: new Map(),
    });
    expect(rows.map((row) => row.path)).toEqual(['src/a.js']);
  });

  it('says nothing when the run changed nothing', () => {
    expect(turnChangeRows({ blocks: shell(written), scope, checkpoint: checkpoint([]), counts: new Map() })).toEqual([]);
  });

  it('falls back to the record without a checkpoint, and rows then open the file itself', () => {
    const rows = turnChangeRows({
      blocks: shell(written, tool({ id: 't2', file: { path: 'C:/games/demo/src/game.js', label: 'game.js' }, delta: { added: 2, removed: 1 } })),
      scope,
      checkpoint: null,
      counts: new Map(),
      producedPaths: ['./notes.md', 'src/game.js'],
    });
    expect(rows).toEqual([
      { path: 'src/game.js', status: 'added', added: 12, removed: 1, checkpointId: null },
      { path: 'notes.md', status: 'added', added: null, removed: null, checkpointId: null },
    ]);
  });

  it('ignores calls that did not land and files outside the project', () => {
    const rows = turnChangeRows({
      blocks: shell(
        tool({ pending: true, file: { path: 'C:/games/demo/a.js', label: 'a.js' } }),
        tool({ failed: true, file: { path: 'C:/games/demo/b.js', label: 'b.js' } }),
        tool({ file: { path: 'C:/elsewhere/c.js', label: 'c.js' } }),
      ),
      scope,
      checkpoint: null,
      counts: new Map(),
    });
    expect(rows).toEqual([]);
  });
});

describe('turnChangeTotals', () => {
  it('adds the lines, and admits when a file could not be counted', () => {
    const row = (added: number | null, removed: number | null) => ({ path: 'a', status: 'added' as const, added, removed, checkpointId: null });
    expect(turnChangeTotals([row(3, 1), row(2, 0)])).toEqual({ added: 5, removed: 1, complete: true });
    expect(turnChangeTotals([row(3, 1), row(null, null)]).complete).toBe(false);
  });
});

describe('withCheckpointAssets', () => {
  it('adds media only the file system saw, after the evidence from events', () => {
    const fromEvents = [{ path: 'art/a.png', source: 'media' as const, kind: 'image' as const }];
    expect(withCheckpointAssets(fromEvents, [
      { path: 'art/a.png', status: 'added' },
      { path: 'art/b.png', status: 'modified' },
      { path: 'audio/c.ogg', status: 'added' },
      { path: 'art/gone.png', status: 'deleted' },
      { path: '.pixo/cache.png', status: 'added' },
      { path: 'src/d.js', status: 'added' },
    ])).toEqual([
      { path: 'art/a.png', source: 'media', kind: 'image' },
      { path: 'art/b.png', source: 'checkpoint', kind: 'image' },
      { path: 'audio/c.ogg', source: 'checkpoint', kind: 'audio' },
    ]);
  });

  it('hands back the same list when there is nothing to add', () => {
    const assets = [{ path: 'a.png', source: 'write' as const, kind: 'image' as const }];
    expect(withCheckpointAssets(assets, null)).toBe(assets);
    expect(withCheckpointAssets(assets, [{ path: 'a.png', status: 'added' }])).toBe(assets);
  });
});
