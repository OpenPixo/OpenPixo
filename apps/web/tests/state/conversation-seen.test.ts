// @vitest-environment jsdom
/**
 * The sidebar's "new reply" dot: a reply that ended after the user last had
 * the conversation open. A conversation never opened here gets no dot, so
 * upgrading does not light up every old chat at once.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { conversationHasNewReply, conversationSeenTimes, markConversationSeen } from '../../src/state/conversation-seen';
import { lastTurnFirstRunId } from '../../src/runtime/chat/last-turn-run';
import type { ChatMessage, Conversation } from '../../src/types';

const conversation = (latestRun: Conversation['latestRun']): Conversation =>
  ({ id: 'c1', projectId: 'p1', title: 'C', createdAt: 0, updatedAt: 0, latestRun }) as Conversation;

afterEach(() => window.localStorage.clear());

describe('new reply', () => {
  it('marks a reply that ended after the conversation was last open', () => {
    markConversationSeen('c1', 1_000);
    expect(conversationHasNewReply(conversation({ status: 'succeeded', endedAt: 2_000 }), conversationSeenTimes())).toBe(true);
    expect(conversationHasNewReply(conversation({ status: 'failed', endedAt: 2_000 }), conversationSeenTimes())).toBe(true);
  });

  it('leaves a reply the user has seen, one still running, and a conversation never opened here', () => {
    markConversationSeen('c1', 3_000);
    expect(conversationHasNewReply(conversation({ status: 'succeeded', endedAt: 2_000 }), conversationSeenTimes())).toBe(false);
    expect(conversationHasNewReply(conversation({ status: 'running', startedAt: 4_000 }), conversationSeenTimes())).toBe(false);
    window.localStorage.clear();
    expect(conversationHasNewReply(conversation({ status: 'succeeded', endedAt: 2_000 }), conversationSeenTimes())).toBe(false);
  });

  it('never moves the seen time backwards', () => {
    markConversationSeen('c1', 5_000);
    markConversationSeen('c1', 1_000);
    expect(conversationSeenTimes().c1).toBe(5_000);
  });
});

describe('the last reply’s first run', () => {
  const m = (id: string, role: 'user' | 'assistant', runId?: string) => ({ id, role, content: id, runId }) as ChatMessage;

  it('is the first run that answered the last user message', () => {
    expect(lastTurnFirstRunId([m('u1', 'user'), m('a1', 'assistant', 'r1'), m('u2', 'user'), m('a2', 'assistant', 'r2'), m('a3', 'assistant', 'r3')])).toBe('r2');
  });

  it('is null when the last message has no answer yet', () => {
    expect(lastTurnFirstRunId([m('u1', 'user'), m('a1', 'assistant', 'r1'), m('u2', 'user')])).toBeNull();
    expect(lastTurnFirstRunId([])).toBeNull();
  });
});
