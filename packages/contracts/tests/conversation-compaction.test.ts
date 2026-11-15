import { describe, expect, it } from 'vitest';
import {
  isChatRunPurpose,
  renderCompactedConversationSummary,
  renderConversationCompactionRequest,
  splitAtCompaction,
} from '../src/prompts/conversation-compaction.js';

describe('conversation compaction contract', () => {
  it('cuts at the latest summary and keeps what came after it', () => {
    const messages = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'first summary', compaction: true as const },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'second summary', compaction: true as const },
      { role: 'user', content: 'c' },
    ];
    expect(splitAtCompaction(messages)).toEqual({ summary: 'second summary', after: [{ role: 'user', content: 'c' }] });
  });

  it('leaves a conversation that was never compacted whole', () => {
    const messages = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
    expect(splitAtCompaction(messages)).toEqual({ summary: null, after: messages });
  });

  it('asks for a summary without tools or questions and frames it for later turns', () => {
    const request = renderConversationCompactionRequest();
    expect(request).toContain('Do not use tools');
    expect(request).toContain('no <question-form>');
    expect(renderCompactedConversationSummary('  ## Goal\nA game.  ')).toMatch(/^## conversation summary\n[^\n]+\n\n## Goal\nA game\.$/u);
    expect(isChatRunPurpose('compact')).toBe(true);
    expect(isChatRunPurpose('shrink')).toBe(false);
  });
});
