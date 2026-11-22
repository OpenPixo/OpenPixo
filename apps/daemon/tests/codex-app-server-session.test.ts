import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { attachCodexAppServerSession } from '../src/agent-protocol/codex-app-server/session.js';

type Frame = Record<string, any>;

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  written: string[] = [];
  killed = false;
  stdinEnded = 0;
  stdin = {
    write: (chunk: string, _enc?: unknown, cb?: (err?: Error | null) => void) => {
      this.written.push(String(chunk));
      if (typeof _enc === 'function') (_enc as (e?: Error | null) => void)(null);
      else cb?.(null);
      return true;
    },
    end: () => {
      this.stdinEnded += 1;
    },
    on: () => {},
    destroyed: false,
  };
  kill(signal?: string) {
    this.killed = true;
    this.emit('killed', signal);
    return true;
  }
  /** Feed a raw line (possibly split) from the agent's stdout. */
  say(obj: unknown) {
    this.stdout.emit('data', `${JSON.stringify(obj)}\n`);
  }
  frames(): Frame[] {
    return this.written
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Frame);
  }
  sent(method: string): Frame | undefined {
    return this.frames().find((f) => f.method === method);
  }
}

function harness(overrides: Record<string, unknown> = {}) {
  const child = new FakeChild();
  const agentEvents: Record<string, any>[] = [];
  const marks: string[] = [];
  const session = attachCodexAppServerSession({
    child: child as any,
    prompt: 'hello codex',
    cwd: '/workspace',
    model: 'gpt-5.4-mini',
    reasoning: 'high',
    serviceTier: null,
    sandboxMode: 'workspace-write',
    resumeSessionId: null,
    onAgentEvent: (ev) => agentEvents.push(ev),
    onCliReady: () => marks.push('cli-ready'),
    onSessionReady: () => marks.push('session-ready'),
    onPromptSendStart: () => marks.push('prompt-send-start'),
    onPromptSendEnd: () => marks.push('prompt-send-end'),
    onTurnComplete: () => marks.push('turn-complete'),
    ...overrides,
  });
  return { child, agentEvents, marks, session };
}

/** Walk the handshake up to (and including) the `turn/start` request. */
function completeHandshake(child: FakeChild, threadId = 'th-1') {
  const init = child.sent('initialize');
  child.say({ jsonrpc: '2.0', id: init?.id, result: { userAgent: 'codex/0.149.1' } });
  const start = child.sent('thread/start') ?? child.sent('thread/resume');
  child.say({
    jsonrpc: '2.0',
    id: start?.id,
    result: { thread: { id: threadId, cwd: '/workspace', path: '/CODEX_HOME/rollout.jsonl' } },
  });
  child.say({ id: child.sent('turn/start')?.id, result: { turn: { id: 'tu-1' } } });
  return threadId;
}

describe('OpenPixo Codex permissions', () => {
  function approval(child: FakeChild, id: string | number = 'approval-1', threadId = 'th-1', method = 'item/commandExecution/requestApproval') {
    child.say({ id, method, params: { threadId, turnId: 'tu-1', itemId: 'cmd-1', command: 'git status', cwd: '/workspace', reason: 'permission needed' } });
  }

  it.each(['accept', 'decline', 'cancel'] as const)('waits for the correlated %s decision', (decision) => {
    const h = harness();
    completeHandshake(h.child);
    approval(h.child);
    expect(h.child.frames().some((frame) => frame.id === 'approval-1')).toBe(false);
    const request = h.session.listApprovals()[0]!;
    expect(request).toMatchObject({ command: 'git status', reason: 'permission needed', threadId: 'th-1', turnId: 'tu-1' });
    expect(h.session.respondApproval('unrelated-id', decision)).toBe(false);
    expect(h.session.respondApproval(request.requestId, decision)).toBe(true);
    expect(h.child.frames().find((frame) => frame.id === 'approval-1')?.result).toEqual({ decision });
    expect(h.session.listApprovals()).toEqual([]);
    expect(h.session.respondApproval(request.requestId, decision)).toBe(false);
  });

  it('keeps identical RPC ids isolated between concurrent roots', () => {
    const first = harness();
    const second = harness();
    completeHandshake(first.child, 'root-a');
    completeHandshake(second.child, 'root-b');
    approval(first.child, 8, 'root-a');
    approval(second.child, 8, 'root-b');
    const request = first.session.listApprovals()[0]!;
    expect(second.session.respondApproval(request.requestId, 'accept')).toBe(false);
    expect(first.session.respondApproval(request.requestId, 'accept')).toBe(true);
    expect(second.session.listApprovals()).toHaveLength(1);
    expect(second.child.frames().some((frame) => frame.id === 8)).toBe(false);
  });

  it('cancels pending permission requests before interrupting the actual turn', () => {
    const h = harness();
    completeHandshake(h.child);
    approval(h.child);
    h.session.abort();
    expect(h.session.listApprovals()).toEqual([]);
    expect(h.child.frames().find((frame) => frame.id === 'approval-1')?.result).toEqual({ decision: 'cancel' });
    expect(h.child.sent('turn/interrupt')?.params).toEqual({ threadId: 'th-1', turnId: 'tu-1' });
  });

  it('interrupts an accepted turn when cancellation raced its start response', () => {
    const h = harness();
    h.child.say({ id: h.child.sent('initialize')?.id, result: {} });
    h.child.say({ id: h.child.sent('thread/start')?.id, result: { thread: { id: 'th-1' } } });
    h.session.abort();
    expect(h.child.sent('turn/interrupt')).toBeUndefined();
    h.child.say({ id: h.child.sent('turn/start')?.id, result: { turn: { id: 'raced-turn' } } });
    expect(h.child.sent('turn/interrupt')?.params).toEqual({ threadId: 'th-1', turnId: 'raced-turn' });
  });

  it('does not let a child thread complete or replace the parent session', () => {
    const h = harness();
    completeHandshake(h.child);
    h.child.say({ method: 'thread/started', params: { thread: { id: 'child-thread', path: '/wrong-path' } } });
    h.child.say({ method: 'turn/completed', params: { threadId: 'child-thread', turn: { id: 'child-turn', status: 'completed' } } });
    expect(h.session.getDurableSessionId()).toBe('th-1');
    expect(h.session.getLastSessionPath()).toBe('/CODEX_HOME/rollout.jsonl');
    expect(h.child.stdinEnded).toBe(0);
    expect(h.marks).not.toContain('turn-complete');
  });

  it('clears pending requests on process death without accepting them', () => {
    const h = harness();
    completeHandshake(h.child);
    approval(h.child);
    const requestId = h.session.listApprovals()[0]!.requestId;
    h.child.emit('close');
    expect(h.session.listApprovals()).toEqual([]);
    expect(h.session.respondApproval(requestId, 'accept')).toBe(false);
    expect(h.child.frames().some((frame) => frame.id === 'approval-1')).toBe(false);
  });

  it('decodes fragmented UTF-8 without corrupting Chinese model text', () => {
    const h = harness();
    completeHandshake(h.child);
    const bytes = Buffer.from(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'th-1', itemId: 'm1', delta: '游戏素材' } }) + '\n');
    const split = bytes.indexOf(Buffer.from('游')) + 1;
    h.child.stdout.emit('data', bytes.subarray(0, split));
    h.child.stdout.emit('data', bytes.subarray(split));
    expect(h.agentEvents).toContainEqual({ type: 'text_delta', delta: '游戏素材' });
  });

  it('reapplies on-request approval when resuming a stored thread', () => {
    const h = harness({ resumeSessionId: 'th-previous' });
    h.child.say({ id: h.child.sent('initialize')?.id, result: {} });
    expect(h.child.sent('thread/resume')?.params).toMatchObject({ sandbox: 'workspace-write', approvalPolicy: 'on-request' });
  });

  it.each([null, 'th-previous'])('applies the selected approval mode without changing the sandbox (resume %s)', (resumeSessionId) => {
    for (const [approvalMode, approvalPolicy] of [['in-app', 'on-request'], ['skip', 'never']] as const) {
      const h = harness({ resumeSessionId, approvalMode });
      h.child.say({ id: h.child.sent('initialize')?.id, result: {} });
      const thread = h.child.sent('thread/start') ?? h.child.sent('thread/resume');
      expect(thread?.params).toMatchObject({ sandbox: 'workspace-write', approvalPolicy });
    }
  });

  it.each(['accept', 'decline', 'cancel'] as const)('answers native permission profiles with a turn-scoped %s grant', (decision) => {
    const h = harness();
    completeHandshake(h.child);
    const permissions = { network: { enabled: true }, fileSystem: { read: null, write: ['/approved-output'] } };
    h.child.say({ id: 'permissions-1', method: 'item/permissions/requestApproval', params: { threadId: 'th-1', turnId: 'tu-1', itemId: 'permissions-item', cwd: '/workspace', permissions } });
    const request = h.session.listApprovals()[0]!;
    expect(JSON.parse(request.details!)).toEqual({ permissions, scope: 'turn' });
    h.session.respondApproval(request.requestId, decision);
    expect(h.child.frames().find((frame) => frame.id === 'permissions-1')?.result).toEqual({ permissions: decision === 'accept' ? permissions : {}, scope: 'turn' });
    expect(Boolean(h.child.sent('turn/interrupt'))).toBe(decision === 'cancel');
  });

  it('displays legacy command vectors and uses the legacy response enum', () => {
    const h = harness();
    completeHandshake(h.child);
    h.child.say({ id: 700, method: 'execCommandApproval', params: { conversationId: 'th-1', callId: 'legacy-command', command: ['node', 'asset script.js'], cwd: '/workspace' } });
    const request = h.session.listApprovals()[0]!;
    expect(request.command).toBe('["node","asset script.js"]');
    expect(request.itemId).toBe('legacy-command');
    h.session.respondApproval(request.requestId, 'decline');
    expect(h.child.frames().find((frame) => frame.id === 700)?.result).toEqual({ decision: 'denied' });
  });

  it('shows paths from a file-change item when its approval carries only the item id', () => {
    const h = harness();
    completeHandshake(h.child);
    h.child.say({ method: 'item/started', params: { threadId: 'th-1', item: { id: 'patch-1', type: 'fileChange', changes: [{ path: '/workspace/assets/player.png', kind: { type: 'update' } }] } } });
    h.child.say({ id: 'patch-approval', method: 'item/fileChange/requestApproval', params: { threadId: 'th-1', turnId: 'tu-1', itemId: 'patch-1', grantRoot: null } });
    expect(h.session.listApprovals()[0]?.paths).toEqual(['/workspace/assets/player.png']);
  });

  it('refuses foreign turns and decisions the runtime did not offer', () => {
    const h = harness();
    completeHandshake(h.child);
    h.child.say({ id: 701, method: 'item/commandExecution/requestApproval', params: { threadId: 'th-1', turnId: 'old-turn', command: 'bad' } });
    expect(h.session.listApprovals()).toEqual([]);
    expect(h.child.frames().find((frame) => frame.id === 701)?.error.code).toBe(-32602);
    h.child.say({ id: 702, method: 'item/commandExecution/requestApproval', params: { threadId: 'th-1', turnId: 'tu-1', command: 'good', availableDecisions: ['decline', 'cancel'] } });
    const request = h.session.listApprovals()[0]!;
    expect(h.session.respondApproval(request.requestId, 'accept')).toBe(false);
    expect(h.session.respondApproval(request.requestId, 'decline')).toBe(true);
  });
});

describe('codex app-server session', () => {
  describe('handshake', () => {
    it.each([
      ['openpixo/0.122.0 (macOS 26.0; arm64) openpixo/9.9.9', false],
      ['openpixo/0.123.0 (macOS 26.0; arm64)', true],
      ['codex/0.149.1', true],
      ['openpixo/0.153.4', true],
      ['codex/1.0.0', true],
      ['codex/0.123.0-alpha.1', false],
      ['codex/unknown client/9.9.9', false],
      ['', false],
      [undefined, false],
    ])('gates patch preview using the running server version %s', (userAgent, enabled) => {
      for (const resumeSessionId of [null, 'existing-thread']) {
        const { child, agentEvents } = harness({ resumeSessionId });
        child.say({ id: child.sent('initialize')?.id, result: { userAgent } });
        const thread = child.sent('thread/start') ?? child.sent('thread/resume');
        expect(thread?.params.config).toEqual(enabled ? { 'features.apply_patch_streaming_events': true } : undefined);
        child.say({ id: thread?.id, result: { thread: { id: 'existing-thread' } } });
        expect(child.sent('turn/start')).toBeDefined();
        expect(agentEvents.some(e => e.type === 'error')).toBe(false);
      }
    });

    it('does not start a turn when cancellation races the handshake', () => {
      const { child, session } = harness();
      session.abort();
      child.say({ id: child.sent('initialize')?.id, result: { userAgent: 'codex/0.153.4' } });
      expect(child.sent('thread/start')).toBeUndefined();
    });

    it('drops buffered patch previews after cancellation', () => {
      const { child, session, agentEvents } = harness();
      completeHandshake(child);
      session.abort();
      child.say({ method: 'item/fileChange/patchUpdated', params: { itemId: 'p', changes: [{path:'/w/late.html',kind:{type:'add'},diff:'late'}] } });
      expect(agentEvents.some(e => e.type === 'tool_in_flight')).toBe(false);
    });
    it('opens with initialize before anything else', () => {
      const { child } = harness();
      const frames = child.frames();
      expect(frames[0]?.method).toBe('initialize');
      expect(frames[0]?.params?.clientInfo?.name).toBeTruthy();
    });

    it('does NOT opt into the experimental API surface', () => {
      // Measured on codex-cli 0.149.1: `item/agentMessage/delta` and
      // `item/reasoning/summaryTextDelta` both arrive with experimentalApi
      // false, so opting in buys nothing and exposes us to the least stable
      // part of the protocol. See codex-app-server/session.ts for the data.
      const { child } = harness();
      expect(child.sent('initialize')?.params?.capabilities?.experimentalApi).toBe(false);
    });

    it('starts a thread only after initialize resolves', () => {
      const { child } = harness();
      expect(child.sent('thread/start')).toBeUndefined();
      const init = child.sent('initialize');
      child.say({ jsonrpc: '2.0', id: init?.id, result: { userAgent: 'codex/0.149.1' } });
      expect(child.sent('initialized')).toBeDefined();
      expect(child.sent('thread/start')).toBeDefined();
    });

    it('carries the sandbox mode and an explicit on-request approval policy onto the thread', () => {
      const { child } = harness();
      const init = child.sent('initialize');
      child.say({ jsonrpc: '2.0', id: init?.id, result: {} });
      const params = child.sent('thread/start')?.params;
      expect(params.cwd).toBe('/workspace');
      expect(params.sandbox).toBe('workspace-write');
      expect(params.approvalPolicy).toBe('on-request');
    });

    it('passes danger-full-access straight through when that is the resolved mode', () => {
      const { child } = harness({ sandboxMode: 'danger-full-access' });
      const init = child.sent('initialize');
      child.say({ jsonrpc: '2.0', id: init?.id, result: {} });
      expect(child.sent('thread/start')?.params?.sandbox).toBe('danger-full-access');
    });

    it('resumes an existing thread instead of starting a new one', () => {
      const { child } = harness({ resumeSessionId: 'th-prev' });
      const init = child.sent('initialize');
      child.say({ jsonrpc: '2.0', id: init?.id, result: {} });
      expect(child.sent('thread/start')).toBeUndefined();
      expect(child.sent('thread/resume')?.params?.threadId).toBe('th-prev');
    });
  });

  describe('turn/start', () => {
    it('sends the prompt as turn input once the thread exists', () => {
      const { child } = harness();
      completeHandshake(child);
      const params = child.sent('turn/start')?.params;
      expect(params.threadId).toBe('th-1');
      expect(params.input).toEqual([{ type: 'text', text: 'hello codex', text_elements: [] }]);
    });

    it('asks for detailed reasoning summaries, the way the exec path does', () => {
      const { child } = harness();
      completeHandshake(child);
      expect(child.sent('turn/start')?.params?.summary).toBe('detailed');
    });

    it('carries model and reasoning effort as typed turn params, not argv', () => {
      const { child } = harness();
      completeHandshake(child);
      const params = child.sent('turn/start')?.params;
      expect(params.model).toBe('gpt-5.4-mini');
      expect(params.effort).toBe('high');
    });

    it('omits model and effort when the run did not pin them', () => {
      const { child } = harness({ model: null, reasoning: null });
      completeHandshake(child);
      const params = child.sent('turn/start')?.params;
      expect('model' in params).toBe(false);
      expect('effort' in params).toBe(false);
    });

    it("treats the synthetic 'default' selection as no selection", () => {
      const { child } = harness({ model: 'default', reasoning: 'default', serviceTier: 'default' });
      completeHandshake(child);
      const params = child.sent('turn/start')?.params;
      expect('model' in params).toBe(false);
      expect('effort' in params).toBe(false);
      expect('serviceTier' in params).toBe(false);
    });
  });

  describe('lifecycle marks (the ACP transport loses these)', () => {
    it('brackets the turn/start write with prompt-send marks', () => {
      const { child, marks } = harness();
      expect(marks).not.toContain('prompt-send-start');
      completeHandshake(child);
      expect(marks).toContain('prompt-send-start');
      expect(marks).toContain('prompt-send-end');
      expect(marks.indexOf('prompt-send-start')).toBeLessThan(marks.indexOf('prompt-send-end'));
    });

    it('marks the prompt send exactly once per turn', () => {
      const { child, marks } = harness();
      completeHandshake(child);
      child.say({ method: 'turn/started', params: { threadId: 'th-1', turnId: 'tu-1' } });
      expect(marks.filter((m) => m === 'prompt-send-start')).toHaveLength(1);
    });

    it('marks cli-ready on the first decoded frame and session-ready on the thread', () => {
      const { child, marks } = harness();
      const init = child.sent('initialize');
      child.say({ jsonrpc: '2.0', id: init?.id, result: {} });
      expect(marks).toContain('cli-ready');
      expect(marks).not.toContain('session-ready');
      const start = child.sent('thread/start');
      child.say({ jsonrpc: '2.0', id: start?.id, result: { thread: { id: 'th-1' } } });
      expect(marks).toContain('session-ready');
    });

    it('signals turn completion', () => {
      const { child, marks } = harness();
      completeHandshake(child);
      child.say({
        method: 'turn/completed',
        params: { threadId: 'th-1', turnId: 'tu-1', turn: { id: 'tu-1', status: 'completed', items: [] } },
      });
      expect(marks).toContain('turn-complete');
    });
  });

  describe('shutdown', () => {
    // `codex app-server` is a SERVER: unlike `codex exec` it does not exit when
    // the turn ends, so nothing would ever close the run. Measured on
    // codex-cli 0.149.1, it exits with code 0 roughly 250ms after stdin EOF,
    // which is the cleanest available shutdown — no signal, no null exit code,
    // and no special-casing in the run's close classifier.
    it('closes stdin once the turn completes so the server exits', () => {
      const { child, marks } = harness();
      completeHandshake(child);
      expect(child.stdinEnded).toBe(0);
      child.say({
        method: 'turn/completed',
        params: {
          threadId: 'th-1',
          turnId: 'tu-1',
          turn: { id: 'tu-1', status: 'completed', items: [] },
        },
      });
      expect(child.stdinEnded).toBe(1);
      child.say({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
      expect(child.stdinEnded).toBe(1);
      expect(marks.filter(mark => mark === 'turn-complete')).toHaveLength(1);
    });

    it('keeps stdin open while the turn is still running', () => {
      const { child } = harness();
      completeHandshake(child);
      child.say({
        method: 'item/agentMessage/delta',
        params: { threadId: 'th-1', turnId: 'tu-1', itemId: 'm1', delta: 'hi' },
      });
      expect(child.stdinEnded).toBe(0);
    });

    it('closes stdin on an interrupted turn too', () => {
      const { child, session } = harness();
      completeHandshake(child);
      session.abort();
      child.say({
        method: 'turn/completed',
        params: {
          threadId: 'th-1',
          turnId: 'tu-1',
          turn: { id: 'tu-1', status: 'interrupted', items: [] },
        },
      });
      expect(child.stdinEnded).toBe(1);
    });

    it('reports clean completion so a signalled exit is not read as failure', () => {
      const { child, session } = harness();
      completeHandshake(child);
      expect(session.completedSuccessfully()).toBe(false);
      child.say({
        method: 'turn/completed',
        params: {
          threadId: 'th-1',
          turnId: 'tu-1',
          turn: { id: 'tu-1', status: 'completed', items: [] },
        },
      });
      expect(session.completedSuccessfully()).toBe(true);
    });

    it('does not report clean completion for a failed turn', () => {
      const { child, session } = harness();
      completeHandshake(child);
      child.say({
        method: 'turn/completed',
        params: {
          threadId: 'th-1',
          turnId: 'tu-1',
          turn: { id: 'tu-1', status: 'failed', items: [], error: { message: 'boom' } },
        },
      });
      expect(session.completedSuccessfully()).toBe(false);
    });
  });

  describe('event routing', () => {
    it('forwards normalized notifications on the agent-event channel', () => {
      const { child, agentEvents } = harness();
      completeHandshake(child);
      child.say({
        method: 'item/agentMessage/delta',
        params: { threadId: 'th-1', turnId: 'tu-1', itemId: 'm1', delta: 'hi' },
      });
      expect(agentEvents).toContainEqual({ type: 'text_delta', delta: 'hi' });
    });

    it('reports the thread id on the session-capture status channel', () => {
      const { child, agentEvents } = harness();
      const init = child.sent('initialize');
      child.say({ jsonrpc: '2.0', id: init?.id, result: {} });
      child.say({ method: 'thread/started', params: { thread: { id: 'th-9' } } });
      child.say({ id: child.sent('thread/start')?.id, result: { thread: { id: 'th-9' } } });
      expect(agentEvents).toContainEqual({
        type: 'status',
        label: 'initializing',
        sessionId: 'th-9',
      });
    });

    it('routes token usage as a real usage event, never as a diagnostic', () => {
      // The ACP transport drops per-step usage into `diagnostic`, where the
      // analytics scan cannot see it. This one must land on the same channel
      // exec --json uses.
      const { child, agentEvents } = harness();
      completeHandshake(child);
      child.say({
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: 'th-1',
          turnId: 'tu-1',
          tokenUsage: {
            total: {
              totalTokens: 300,
              inputTokens: 200,
              cachedInputTokens: 50,
              cacheWriteInputTokens: 7,
              outputTokens: 100,
              reasoningOutputTokens: 25,
            },
            last: {
              totalTokens: 1,
              inputTokens: 1,
              cachedInputTokens: 0,
              cacheWriteInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
            },
            modelContextWindow: null,
          },
        },
      });
      const usage = agentEvents.find((e) => e.type === 'usage');
      expect(usage).toBeDefined();
      expect(usage?.usage).toEqual({
        input_tokens: 200,
        output_tokens: 100,
        thought_tokens: 25,
        cached_read_tokens: 50,
        cached_write_tokens: 7,
        total_tokens: 300,
      });
      expect(agentEvents.some((e) => e.type === 'diagnostic')).toBe(false);
    });

    it('routes a turn failure as an agent error event, not a bespoke rpc failure', () => {
      // `failure_detail: 'stream_error'` is derived from the agent-event error
      // channel. The ACP path emits `fatal_rpc_error` instead and drops off
      // that Langfuse query entirely.
      const { child, agentEvents } = harness();
      completeHandshake(child);
      child.say({
        method: 'error',
        params: {
          threadId: 'th-1',
          turnId: 'tu-1',
          willRetry: false,
          error: { message: 'upstream 500' },
        },
      });
      expect(agentEvents).toContainEqual({ type: 'error', message: 'upstream 500' });
    });

    it('routes a JSON-RPC error response as an agent error event too', () => {
      const { child, agentEvents } = harness();
      const init = child.sent('initialize');
      child.say({
        jsonrpc: '2.0',
        id: init?.id,
        error: { code: -32600, message: 'Invalid request: missing field `text`' },
      });
      const error = agentEvents.find((e) => e.type === 'error');
      expect(error).toBeDefined();
      expect(String(error?.message)).toContain('missing field');
    });
  });

  describe('resume handle', () => {
    // Capture-style resume: the daemon persists whatever thread id it sees on
    // the session-capture status channel THIS turn. `thread/start` is followed
    // by a `thread/started` notification, but `thread/resume` answers with the
    // thread in its RPC result and (measured on codex-cli 0.149.1) sends no
    // such notification — so a resumed turn would report no handle at all and
    // the stored one would go stale.
    it('reports the handle on a resumed turn, where no notification arrives', () => {
      const { child, agentEvents } = harness({ resumeSessionId: 'th-prev' });
      const init = child.sent('initialize');
      child.say({ jsonrpc: '2.0', id: init?.id, result: {} });
      const resume = child.sent('thread/resume');
      child.say({
        jsonrpc: '2.0',
        id: resume?.id,
        result: { thread: { id: 'th-prev', path: '/CODEX_HOME/rollout.jsonl' } },
      });
      expect(agentEvents).toContainEqual({
        type: 'status',
        label: 'initializing',
        sessionId: 'th-prev',
      });
    });

    it('reports the handle exactly once on a fresh thread', () => {
      const { child, agentEvents } = harness();
      const init = child.sent('initialize');
      child.say({ jsonrpc: '2.0', id: init?.id, result: {} });
      child.say({ method: 'thread/started', params: { thread: { id: 'th-1' } } });
      const start = child.sent('thread/start');
      child.say({ jsonrpc: '2.0', id: start?.id, result: { thread: { id: 'th-1' } } });
      const captures = agentEvents.filter(
        (e) => e.type === 'status' && e.label === 'initializing',
      );
      expect(captures).toHaveLength(1);
    });

    it('exposes the codex-minted thread id', () => {
      const { child, session } = harness();
      completeHandshake(child, 'th-durable');
      expect(session.getDurableSessionId()).toBe('th-durable');
    });

    it('exposes the rollout path codex reported for the thread', () => {
      const { child, session } = harness();
      completeHandshake(child);
      expect(session.getLastSessionPath()).toBe('/CODEX_HOME/rollout.jsonl');
    });
  });

  describe('cancellation', () => {
    it('interrupts the turn instead of killing the process outright', () => {
      const { child, session } = harness();
      completeHandshake(child);
      session.abort();
      expect(child.sent('turn/interrupt')?.params?.threadId).toBe('th-1');
      expect(child.sent('turn/interrupt')?.params?.turnId).toBe('tu-1');
    });

    it('is idempotent', () => {
      const { child, session } = harness();
      completeHandshake(child);
      session.abort();
      session.abort();
      expect(child.frames().filter((f) => f.method === 'turn/interrupt')).toHaveLength(1);
    });

    it('still terminates when abort lands before a thread exists', () => {
      const { child, session } = harness();
      expect(() => session.abort()).not.toThrow();
      expect(child.sent('turn/interrupt')).toBeUndefined();
    });
  });

  describe('forward compatibility', () => {
    it('ignores an unknown notification rather than failing the run', () => {
      const { child, agentEvents } = harness();
      completeHandshake(child);
      child.say({ method: 'thread/telepathy/updated', params: { brainWaves: 12 } });
      expect(agentEvents.some((e) => e.type === 'error')).toBe(false);
    });

    it('answers an unknown server-to-client request instead of hanging', () => {
      const { child } = harness();
      completeHandshake(child);
      child.say({
        jsonrpc: '2.0',
        id: 9001,
        method: 'mcpServer/elicitation/request',
        params: { message: 'may I?' },
      });
      const reply = child.frames().find((f) => f.id === 9001);
      expect(reply).toBeDefined();
      expect(reply?.error?.code).toBe(-32601);
    });

    it('tolerates a frame split across two stdout chunks', () => {
      const { child, agentEvents } = harness();
      completeHandshake(child);
      const line = JSON.stringify({
        method: 'item/agentMessage/delta',
        params: { threadId: 'th-1', turnId: 'tu-1', itemId: 'm1', delta: 'split' },
      });
      child.stdout.emit('data', line.slice(0, 20));
      child.stdout.emit('data', `${line.slice(20)}\n`);
      expect(agentEvents).toContainEqual({ type: 'text_delta', delta: 'split' });
    });

    it('does not crash on a non-JSON stdout line', () => {
      const { child, agentEvents } = harness();
      completeHandshake(child);
      expect(() => child.stdout.emit('data', 'not json at all\n')).not.toThrow();
      expect(agentEvents.some((e) => e.type === 'error')).toBe(false);
    });
  });

  describe('image inputs', () => {
    it('attaches staged local images alongside the prompt text', () => {
      const { child } = harness({ imagePaths: ['/tmp/a.png'] });
      completeHandshake(child);
      expect(child.sent('turn/start')?.params?.input).toEqual([
        { type: 'text', text: 'hello codex', text_elements: [] },
        { type: 'localImage', path: '/tmp/a.png' },
      ]);
    });
  });
});


describe('OpenPixo-owned Codex threads', () => {
  function ready(overrides: Record<string, unknown> = {}, version = '0.153.4') {
    const h = harness({ manageThreadVisibility: true, ...overrides });
    const init = h.child.sent('initialize')!;
    h.child.say({ id: init.id, result: { userAgent: `openpixo/${version}` } });
    const open = h.child.sent('thread/start') ?? h.child.sent('thread/resume');
    return { ...h, open: open! };
  }
  function opened(h: ReturnType<typeof ready>) {
    h.child.say({ id: h.open.id, result: { thread: { id: 'owned-1' } } });
  }
  function completed(child: FakeChild, status = 'completed') {
    child.say({ method: 'turn/completed', params: { threadId: 'owned-1', turn: { status } } });
  }
  function archivedResume(h: ReturnType<typeof ready>) {
    h.child.say({ id: h.open.id, error: { code: -32600, message: 'session owned-1 is archived. Run `codex unarchive owned-1` to unarchive it first.' } });
    return h.child.sent('thread/unarchive')!;
  }

  // C6 (2026-11-22): archiving after every turn meant every next turn began with
  // `thread/unarchive`, which on a large Codex history outlasted its bound, so
  // each resumed turn failed once and was retried. A thread stays where it is.
  it.each(['completed', 'failed', 'interrupted'])('leaves its owned thread in place after %s', (status) => {
    const h = ready();
    opened(h);
    if (status === 'interrupted') h.session.abort();
    completed(h.child, status);
    expect(h.child.sent('thread/archive')).toBeUndefined();
    expect(h.child.stdinEnded).toBe(1);
    expect(h.session.completedSuccessfully()).toBe(status !== 'failed');
    expect(h.session.getDurableSessionId()).toBe('owned-1');
  });

  it('resumes an owned thread directly, without unarchiving it', () => {
    const h = ready({ resumeSessionId: 'owned-1', resumeSessionOwned: true });
    opened(h);
    expect(h.child.sent('thread/unarchive')).toBeUndefined();
    expect(h.child.sent('turn/start')?.params.threadId).toBe('owned-1');
    completed(h.child);
    expect(h.child.sent('thread/archive')).toBeUndefined();
    expect(h.child.stdinEnded).toBe(1);
  });

  it('ends a turn once even when a completion notification is duplicated', () => {
    const h = ready(); opened(h); completed(h.child); completed(h.child);
    expect(h.child.stdinEnded).toBe(1);
    expect(h.child.sent('thread/archive')).toBeUndefined();
  });

  it('keeps unknown resume handles outside its unarchive policy', () => {
    const h = ready({ resumeSessionId: 'owned-1' });
    h.child.say({ id: h.open.id, error: { message: 'session owned-1 is archived' } });
    expect(h.child.sent('thread/unarchive')).toBeUndefined();
    expect(h.agentEvents.filter(e => e.type === 'error')).toHaveLength(1);
  });

  it('restores a thread an earlier version archived, then leaves it restored', () => {
    const h = ready({ resumeSessionId: 'owned-1', resumeSessionOwned: true });
    const unarchive = archivedResume(h);
    expect(h.child.sent('turn/start')).toBeUndefined();
    expect(unarchive.params).toEqual({ threadId: 'owned-1' });
    h.child.say({ id: unarchive.id, result: { thread: { id: 'owned-1' } } });
    const resumes = h.child.frames().filter(f => f.method === 'thread/resume');
    expect(resumes).toHaveLength(2);
    h.child.say({ id: resumes[1]!.id, result: { thread: { id: 'owned-1' } } });
    expect(h.child.sent('turn/start')?.params.threadId).toBe('owned-1');
    completed(h.child);
    expect(h.child.sent('thread/archive')).toBeUndefined();
    expect(h.child.stdinEnded).toBe(1);
    expect(h.session.getDurableSessionId()).toBe('owned-1');
  });

  it('can restore an archived owned thread on an older CLI', () => {
    const h = ready({ resumeSessionId: 'owned-1', resumeSessionOwned: true }, '0.146.0');
    const restore = archivedResume(h);
    h.child.say({ id: restore.id, result: {} });
    const resume = h.child.frames().filter(f => f.method === 'thread/resume').at(-1)!;
    h.child.say({ id: resume.id, result: { thread: { id: 'owned-1' } } });
    expect(h.child.sent('turn/start')?.params.threadId).toBe('owned-1');
  });

  it('keeps unarchive failure retryable without forwarding a stale-session signal', () => {
    const h = ready({ resumeSessionId: 'owned-1', resumeSessionOwned: true });
    const restore = archivedResume(h);
    h.child.say({ id: restore.id, error: { message: 'no rollout found while restoring archived session' } });
    expect(h.child.sent('turn/start')).toBeUndefined();
    expect(h.child.sent('thread/start')).toBeUndefined();
    expect(h.child.stdinEnded).toBe(1);
    expect(h.agentEvents.filter(e => e.type === 'error')).toEqual([
      { type: 'error', message: 'codex app-server thread/unarchive failed' },
    ]);
  });

  // 2026-11-11: 3,063 ms on a 72 GB Codex `sessions` folder failed every second
  // turn under a 1.5 s bound. 2026-11-22: on ~77 GB / 1,100+ rollouts it took
  // longer than the 30 s bound, so every resumed turn failed once and retried.
  it('waits for an unarchive that takes minutes on a large Codex history', () => {
    vi.useFakeTimers();
    try {
      const h = ready({ resumeSessionId: 'owned-1', resumeSessionOwned: true });
      const restore = archivedResume(h);
      vi.advanceTimersByTime(3 * 60_000);
      expect(h.agentEvents.filter(e => e.type === 'error')).toEqual([]);
      expect(h.child.stdinEnded).toBe(0);
      h.child.say({ id: restore.id, result: {} });
      const resume = h.child.frames().filter(f => f.method === 'thread/resume').at(-1)!;
      h.child.say({ id: resume.id, result: { thread: { id: 'owned-1' } } });
      expect(h.child.sent('turn/start')?.params.threadId).toBe('owned-1');
      expect(h.agentEvents).toContainEqual(expect.objectContaining({
        type: 'diagnostic', name: 'codex_thread_unarchived', durationMs: 3 * 60_000,
      }));
    } finally { vi.useRealTimers(); }
  });

  it('still fails a hung unarchive after the generous bound', () => {
    vi.useFakeTimers();
    try {
      const h = ready({ resumeSessionId: 'owned-1', resumeSessionOwned: true });
      archivedResume(h);
      vi.advanceTimersByTime(5 * 60_000 - 1);
      expect(h.agentEvents.filter(e => e.type === 'error')).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(h.agentEvents.filter(e => e.type === 'error')).toEqual([
        { type: 'error', message: 'codex app-server thread/unarchive timed out' },
      ]);
      expect(h.child.stdinEnded).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it('ignores a late unarchive response after cancellation', () => {
    vi.useFakeTimers();
    try {
      const h = ready({ resumeSessionId: 'owned-1', resumeSessionOwned: true });
      const restore = archivedResume(h);
      h.session.abort();
      vi.advanceTimersByTime(1500);
      h.child.say({ id: restore.id, result: {} });
      expect(h.child.sent('turn/start')).toBeUndefined();
      expect(h.child.stdinEnded).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it('uses persistent paginated history for new threads on 0.146.0', () => {
    const h = ready({}, '0.146.0');
    expect(h.child.sent('initialize')?.params.capabilities.experimentalApi).toBe(true);
    expect(h.open.params.historyMode).toBe('paginated');
    h.child.say({ id: h.open.id, result: { thread: { id: 'owned-1', historyMode: 'paginated' } } });
    h.child.say({ method: 'item/agentMessage/delta', params: { itemId: 'm1', delta: 'visible progress' } });
    expect(h.agentEvents).toContainEqual({ type: 'text_delta', delta: 'visible progress' });
    completed(h.child);
    expect(h.child.sent('thread/archive')).toBeUndefined();
    expect(h.child.stdinEnded).toBe(1);
  });

  it('resumes an existing history without converting it', () => {
    const h = ready({ resumeSessionId: 'owned-1', resumeSessionOwned: true }, '0.146.0');
    expect(h.open.params.historyMode).toBeUndefined();
    h.child.say({ id: h.open.id, result: { thread: { id: 'owned-1', historyMode: 'legacy' } } });
    expect(h.child.sent('turn/start')?.params.threadId).toBe('owned-1');
  });

  it.each(['0.145.0', 'unknown'])('keeps the default history mode on %s', (version) => {
    const h = ready({}, version);
    expect(h.open.params.historyMode).toBeUndefined();
    opened(h); completed(h.child);
    expect(h.session.completedSuccessfully()).toBe(true);
  });
});
