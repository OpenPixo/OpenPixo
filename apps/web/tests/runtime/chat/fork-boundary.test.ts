import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@openpixo/contracts';

import { forkBoundaryMessageIndex } from '../../../src/runtime/chat/fork-boundary';

function user(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, sessionMode: 'design' };
}

function plainAssistant(id: string, runId: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: `answer for ${runId}`,
    agentId: 'claude',
    runId,
    runStatus: 'succeeded',
    sessionMode: 'design',
  };
}

describe('forkBoundaryMessageIndex', () => {

  it('普通单 run 回合的边界就是它自己 —— 这种转录压根不折叠', () => {
    const messages: ChatMessage[] = [
      user('u0', '第一问'),
      plainAssistant('a0', 'run-0'),
      user('u1', '第二问'),
      plainAssistant('a1', 'run-1'),
    ];
    expect(forkBoundaryMessageIndex(messages, 'a0')).toBe(1);
    expect(forkBoundaryMessageIndex(messages, 'a1')).toBe(3);
  });

  it('分叉点不在这份转录里时返回 -1,让调用方走没落库那条兜底路', () => {
    const messages: ChatMessage[] = [user('u0', '第一问'), plainAssistant('a0', 'run-0')];
    expect(forkBoundaryMessageIndex(messages, 'a-never-persisted')).toBe(-1);
  });
});
