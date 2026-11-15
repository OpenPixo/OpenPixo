import { describe, expect, it } from 'vitest';

import { buildDaemonTranscript } from '../../src/providers/daemon';

describe('transcript after /compact', () => {
  it('starts from the summary and keeps only the messages after it', () => {
    const transcript = buildDaemonTranscript(
      [
        { id: '1', role: 'user', content: 'OLD_REQUEST_7f2' },
        { id: '2', role: 'assistant', content: 'OLD_REPLY_7f2', agentId: 'opencode' },
        { id: '3', role: 'user', content: '/compact' },
        { id: '4', role: 'assistant', content: '## Goal\nA dodge game.', agentId: 'opencode', compaction: true },
        { id: '5', role: 'user', content: 'add a boss' },
      ],
      'opencode',
    );
    expect(transcript).not.toContain('OLD_REQUEST_7f2');
    expect(transcript).not.toContain('OLD_REPLY_7f2');
    expect(transcript.startsWith('## conversation summary')).toBe(true);
    expect(transcript).toContain('A dodge game.');
    expect(transcript.indexOf('A dodge game.')).toBeLessThan(transcript.indexOf('add a boss'));
  });

  it('sends the whole conversation when there is no summary', () => {
    const transcript = buildDaemonTranscript(
      [
        { id: '1', role: 'user', content: 'first' },
        { id: '2', role: 'assistant', content: 'reply', agentId: 'opencode' },
        { id: '3', role: 'user', content: 'second' },
      ],
      'opencode',
    );
    expect(transcript).not.toContain('## conversation summary');
    expect(transcript).toContain('first');
  });
});
