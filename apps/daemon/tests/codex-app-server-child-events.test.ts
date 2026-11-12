import { describe, expect, it } from 'vitest';
import { createCodexAppServerNormalizer } from '../src/agent-protocol/codex-app-server/normalize.js';

type Event = Record<string, unknown>;

describe('Codex child task projection', () => {
  it('keeps one child row from real activity notifications and retains its parent', () => {
    const events: Event[] = [];
    const normalizer = createCodexAppServerNormalizer((event) => events.push(event));
    for (const kind of ['started', 'interacted', 'completed']) {
      normalizer.handleNotification('item/completed', {
        threadId: 'parent',
        item: { id: `activity-${kind}`, type: 'subAgentActivity', agentThreadId: 'child', agentPath: '/root/check', kind },
      });
    }
    expect(events).toEqual([
      {
        type: 'tool_in_flight', id: 'codex-agent:parent:child', name: 'Task', startedAt: expect.any(Number),
        input: { description: '/root/check', threadId: 'child', parentThreadId: 'parent', status: 'running' },
      },
      {
        type: 'tool_use', id: 'codex-agent:parent:child', name: 'Task',
        input: { description: '/root/check', threadId: 'child', parentThreadId: 'parent', status: 'completed' },
      },
      { type: 'tool_result', toolUseId: 'codex-agent:parent:child', content: 'completed', isError: false },
    ]);
    expect(normalizer.stats()).toEqual({ unknownNotifications: 0, unknownItems: 0 });
  });

  it('uses child states rather than a completed spawn tool as task completion', () => {
    const events: Event[] = [];
    const normalizer = createCodexAppServerNormalizer((event) => events.push(event));
    const item = {
      id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: 'parent',
      receiverThreadIds: ['child'], status: 'completed', agentsStates: { child: { status: 'running', nickname: 'Verifier' } },
    };
    normalizer.handleNotification('item/completed', { threadId: 'parent', item });
    expect(events).toEqual([
      {
        type: 'tool_in_flight', id: 'codex-agent:parent:child', name: 'Task', startedAt: expect.any(Number),
        input: { description: 'Verifier', threadId: 'child', parentThreadId: 'parent', status: 'running' },
      },
    ]);
    normalizer.handleNotification('item/completed', {
      threadId: 'parent', item: { ...item, id: 'wait', tool: 'wait', agentsStates: { child: { status: 'errored' } } },
    });
    expect(events.at(-1)).toEqual({ type: 'tool_result', toolUseId: 'codex-agent:parent:child', content: 'failed', isError: true });
  });

  it('deduplicates activity and collaboration reports of the same child', () => {
    const events: Event[] = [];
    const normalizer = createCodexAppServerNormalizer((event) => events.push(event));
    normalizer.handleNotification('item/completed', {
      threadId: 'parent', item: { id: 'activity-start', type: 'subAgentActivity', agentThreadId: 'child', kind: 'started' },
    });
    normalizer.handleNotification('item/completed', {
      threadId: 'parent', item: { id: 'spawn', type: 'collabAgentToolCall', senderThreadId: 'parent', receiverThreadIds: ['child'], agentsStates: { child: { status: 'running' } } },
    });
    expect(events).toHaveLength(1);
  });

  it('keeps two normalizer instances and their task identities independent', () => {
    const eventsA: Event[] = [];
    const eventsB: Event[] = [];
    const a = createCodexAppServerNormalizer((event) => eventsA.push(event));
    const b = createCodexAppServerNormalizer((event) => eventsB.push(event));
    for (const [normalizer, parent] of [[a, 'project-a'], [b, 'project-b']] as const) {
      normalizer.handleNotification('item/completed', {
        threadId: parent, item: { id: 'activity', type: 'subAgentActivity', agentThreadId: 'child', kind: 'started' },
      });
    }
    expect(eventsA[0]).toMatchObject({ id: 'codex-agent:project-a:child', input: { parentThreadId: 'project-a' } });
    expect(eventsB[0]).toMatchObject({ id: 'codex-agent:project-b:child', input: { parentThreadId: 'project-b' } });
  });

  it('shows a new child task when a completed child is interacted with again', () => {
    const events: Event[] = [];
    const normalizer = createCodexAppServerNormalizer((event) => events.push(event));
    for (const kind of ['started', 'completed', 'interacted', 'completed']) {
      normalizer.handleNotification('item/completed', {
        threadId: 'parent', item: { id: `activity-${events.length}`, type: 'subAgentActivity', agentThreadId: 'child', kind },
      });
    }
    expect(events.filter((event) => event.type === 'tool_in_flight').map((event) => event.id))
      .toEqual(['codex-agent:parent:child', 'codex-agent:parent:child:2']);
    expect(events.filter((event) => event.type === 'tool_result').map((event) => event.toolUseId))
      .toEqual(['codex-agent:parent:child', 'codex-agent:parent:child:2']);
  });

  it('does not mix child messages, usage or turn status into a bound parent stream', () => {
    const events: Event[] = [];
    const normalizer = createCodexAppServerNormalizer((event) => events.push(event), Date.now, undefined, () => 'parent');
    normalizer.handleNotification('thread/started', { thread: { id: 'child' } });
    normalizer.handleNotification('turn/started', { threadId: 'child', turn: { id: 'child-turn' } });
    normalizer.handleNotification('item/agentMessage/delta', { threadId: 'child', itemId: 'message', delta: 'private child output' });
    normalizer.handleNotification('item/reasoning/textDelta', { threadId: 'child', itemId: 'reasoning', delta: 'private reasoning' });
    normalizer.handleNotification('thread/tokenUsage/updated', { threadId: 'child', tokenUsage: { total: { inputTokens: 50 } } });
    normalizer.handleNotification('turn/completed', { threadId: 'child', turn: { status: 'failed', error: { message: 'child failed' } } });
    normalizer.handleNotification('item/agentMessage/delta', { threadId: 'parent', itemId: 'message', delta: 'parent output' });
    expect(events).toEqual([{ type: 'text_delta', delta: 'parent output' }]);
  });
});
