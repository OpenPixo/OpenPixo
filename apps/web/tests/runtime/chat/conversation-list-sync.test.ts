import { describe, expect, it } from 'vitest';

import { mergeConversationList } from '../../../src/runtime/chat/conversation-list-sync';
import type { Conversation } from '../../../src/types';

const c = (id: string, title: string | null, extra: Partial<Conversation> = {}): Conversation => ({
  id, title, projectId: 'game', createdAt: 1, updatedAt: 1, ...extra,
});

describe('mergeConversationList', () => {
  it('keeps the same list when nothing changed', () => {
    const local = [c('a', 'A'), c('b', 'B')];
    expect(mergeConversationList(local, [c('b', 'B'), c('a', 'A')])).toBe(local);
  });

  it('takes a renamed title and drops a deleted conversation, in the local order', () => {
    const local = [c('a', 'A'), c('b', 'B'), c('x', 'X')];
    expect(mergeConversationList(local, [c('x', 'X'), c('a', 'Renamed')]).map((item) => [item.id, item.title]))
      .toEqual([['a', 'Renamed'], ['x', 'X']]);
  });

  it('puts a conversation made elsewhere first', () => {
    const local = [c('a', 'A')];
    expect(mergeConversationList(local, [c('a', 'A'), c('fork', 'A (fork)')]).map((item) => item.id)).toEqual(['fork', 'a']);
  });

  it('does not let a read undo state this view keeps itself', () => {
    const local = [c('a', 'A', { sessionMode: 'plan' })];
    const merged = mergeConversationList(local, [c('a', 'B', { sessionMode: undefined })]);
    expect(merged[0]).toMatchObject({ title: 'B', sessionMode: 'plan' });
  });
});
