import { describe, expect, it } from 'vitest';
import type { ToolRow } from '../../../src/runtime/chat/contract';
import type { GroupedShellItem } from '../../../src/runtime/chat/group-thinking';
import { foldedStepCounts, segmentRecord } from '../../../src/runtime/chat/fold-steps';

function tool(id: string, kind: ToolRow['tool'], extra: Partial<ToolRow> = {}): ToolRow {
  return {
    kind: 'tool', id, tool: kind, name: 'Bash', title: id, rawTitle: false, file: null,
    pattern: null, hits: null, delta: null, elapsedMs: 100, pending: false, failed: false,
    failReason: null, command: null, terminal: null, ...extra,
  };
}
const onFile = (id: string, kind: ToolRow['tool'], path: string) => tool(id, kind, { file: { path, label: path } });
const thoughts = (live = false): GroupedShellItem => ({ kind: 'thoughts', texts: ['hm'], elapsedMs: 10, ...(live ? { live: true } : {}) });
const text = (value: string): GroupedShellItem => ({ kind: 'text', text: value });

describe('folding routine steps', () => {
  it('folds reads, edits, searches and commands between narration, keeping each index', () => {
    const items: GroupedShellItem[] = [
      text('looking'), onFile('r1', 'read', 'menu.ts'), onFile('e1', 'edit', 'menu.ts'), thoughts(),
      onFile('r2', 'read', 'menu.ts'), onFile('e2', 'edit', 'menu.ts'), onFile('w1', 'write', 'title-ui.ts'),
      tool('s1', 'search'), tool('c1', 'exec'), text('done'),
    ];
    expect(segmentRecord(items)).toEqual([
      { kind: 'item', index: 0 },
      {
        kind: 'fold', indices: [1, 2, 3, 4, 5, 6, 7, 8],
        counts: { read: 1, changed: 2, searches: 1, commands: 1, elapsedMs: 700 },
      },
      { kind: 'item', index: 9 },
    ]);
  });

  it('never folds OpenPixo steps, images or thinking still being written', () => {
    const verify = tool('v1', 'exec', { action: { kind: 'verify', steps: [] } });
    const items: GroupedShellItem[] = [
      onFile('r1', 'read', 'a.ts'), verify, onFile('r2', 'read', 'b.ts'), tool('i1', 'image'),
      onFile('r3', 'read', 'c.ts'), thoughts(true), onFile('r4', 'read', 'd.ts'),
    ];
    expect(segmentRecord(items).every((segment) => segment.kind === 'item')).toBe(true);
  });

  it('leaves thinking at the edge of a run outside it', () => {
    const items: GroupedShellItem[] = [thoughts(), onFile('r1', 'read', 'a.ts'), onFile('r2', 'read', 'b.ts'), thoughts()];
    expect(segmentRecord(items)).toEqual([
      { kind: 'item', index: 0 },
      { kind: 'fold', indices: [1, 2], counts: expect.objectContaining({ read: 2, changed: 0 }) },
      { kind: 'item', index: 3 },
    ]);
  });

  it('gives no total when a step has no time', () => {
    expect(foldedStepCounts([onFile('r1', 'read', 'a.ts'), tool('c1', 'exec', { elapsedMs: null })]))
      .toEqual({ read: 1, changed: 0, searches: 0, commands: 1, elapsedMs: null });
  });

  it('keeps a step that is still running out of the fold (D3)', () => {
    const items: GroupedShellItem[] = [onFile('r1', 'read', 'a.ts'), onFile('r2', 'read', 'b.ts'), tool('w1', 'write', { pending: true })];
    expect(segmentRecord(items)).toEqual([
      { kind: 'fold', indices: [0, 1], counts: expect.objectContaining({ read: 2 }) },
      { kind: 'item', index: 2 },
    ]);
  });
});
