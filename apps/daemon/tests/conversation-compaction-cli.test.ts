import { describe, expect, it } from 'vitest';

import { compactConversation, compactionTranscript } from '../src/conversation-compaction-cli.js';

describe('pixo conversation compact', () => {
  it('renders the transcript from the latest summary on and ends with /compact', () => {
    const transcript = compactionTranscript([
      { id: '1', role: 'user', content: 'old' },
      { id: '2', role: 'assistant', content: 'summary one', compaction: true },
      { id: '3', role: 'user', content: 'newer' },
      { id: '4', role: 'assistant', content: 'reply' },
    ]);
    expect(transcript).not.toContain('old');
    expect(transcript.startsWith('## conversation summary')).toBe(true);
    expect(transcript.endsWith('## user\n/compact')).toBe(true);
  });

  it('posts the same /compact turn as the chat and returns the recorded summary', async () => {
    const posted: Array<Record<string, unknown>> = [];
    let polls = 0;
    const listed = (compacted: boolean) => ({ messages: [
      { id: 'u1', role: 'user', content: 'make a game' },
      { id: 'a1', role: 'assistant', content: 'made it' },
      ...(compacted ? [{ id: 'u2', role: 'user', content: '/compact' }, { id: 'a2', role: 'assistant', content: '## Goal', compaction: true }] : []),
    ] });
    let reads = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/messages')) return ok(listed(reads++ > 0));
      if (url.endsWith('/api/runs')) { posted.push(JSON.parse(String(init?.body))); return ok({ runId: 'r1', assistantMessageId: 'a2' }); }
      return ok({ status: ++polls < 2 ? 'running' : 'succeeded' });
    }) as typeof fetch;
    const result = await compactConversation({ base: 'http://daemon', projectId: 'p1', conversationId: 'c1', fetchImpl, sleep: async () => {} });
    expect(posted[0]).toMatchObject({ projectId: 'p1', conversationId: 'c1', purpose: 'compact', currentPrompt: '/compact' });
    expect(String(posted[0]!.message)).toContain('made it');
    expect(result).toEqual({ runId: 'r1', status: 'succeeded', assistantMessageId: 'a2', compacted: true, summary: '## Goal' });
  });
});
