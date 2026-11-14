import { describe, expect, it } from 'vitest';
import { olderTurnsWindow } from '../../../src/runtime/chat/older-turns';

type Role = 'user' | 'assistant';
const items = (roles: Role[]) => roles.map((role, index) => ({ key: `m${index}`, message: { role } }));
const turns = (n: number) => items(Array.from({ length: n }, () => ['user', 'assistant'] as Role[]).flat());

describe('olderTurnsWindow', () => {
  it('keeps a short conversation whole', () => {
    const all = turns(4);
    const window = olderTurnsWindow(all, 10);
    expect(window.hiddenTurns).toBe(0);
    expect(window.visible).toBe(all);
  });

  it('keeps the latest turns and starts the slice at a user message', () => {
    const window = olderTurnsWindow(turns(14), 10);
    expect(window.hiddenTurns).toBe(4);
    expect(window.visible).toHaveLength(20);
    expect(window.visible[0]).toMatchObject({ key: 'm8', message: { role: 'user' } });
  });

  it('counts a turn with several replies as one', () => {
    const all = items(['user', 'assistant', 'assistant', 'user', 'assistant', 'user', 'assistant', 'assistant']);
    const window = olderTurnsWindow(all, 2);
    expect(window.hiddenTurns).toBe(1);
    expect(window.visible.map((item) => item.key)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7']);
  });

  it('does not fold a greeting that comes before the first user message', () => {
    const all = items(['assistant', 'user', 'assistant', 'user', 'assistant']);
    expect(olderTurnsWindow(all, 2)).toEqual({ visible: all, hiddenTurns: 0 });
  });

  it('shows everything once the user has revealed past the start', () => {
    const all = turns(12);
    expect(olderTurnsWindow(all, 20).hiddenTurns).toBe(0);
    expect(olderTurnsWindow(all, Infinity).visible).toBe(all);
  });
});
