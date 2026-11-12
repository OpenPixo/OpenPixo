import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createJsonEventStreamHandler } from '../../src/runtimes/json-event-stream.js';
import { createToolLoopGuard, type ToolLoopVerdict } from '../../src/tool-loop-guard.js';

type JsonStreamEvent = Record<string, unknown>;

function collectEvents(kind: string) {
  const events: JsonStreamEvent[] = [];
  const handler = createJsonEventStreamHandler(kind, (event) => events.push(event));
  return { events, handler };
}

test('opencode json stream emits text and usage events', () => {
  const { events, handler } = collectEvents('opencode');

  handler.feed(
    '{"type":"step_start","sessionID":"ses-1","part":{"type":"step-start"}}\n' +
    '{"type":"text","sessionID":"ses-1","part":{"type":"text","text":"hello"}}\n' +
    '{"type":"step_finish","sessionID":"ses-1","part":{"type":"step-finish","tokens":{"input":11,"output":7,"reasoning":3,"cache":{"read":5,"write":2}},"cost":0}}\n',
  );

  assert.deepEqual(events, [
    { type: 'status', label: 'running', sessionId: 'ses-1' },
    { type: 'text_delta', delta: 'hello' },
    {
      type: 'usage',
      usage: {
        input_tokens: 11,
        output_tokens: 7,
        thought_tokens: 3,
        cached_read_tokens: 5,
        cached_write_tokens: 2,
      },
      costUsd: 0,
    },
    { type: 'context_usage', usedTokens: 25, freshInputTokens: 11, cachedInputTokens: 5, cacheWriteTokens: 2, outputTokens: 7, reasoningTokens: 3 },
  ]);
});

test('opencode step_start surfaces the session id as the status sessionId (capture-style resume handle)', () => {
  const { events, handler } = collectEvents('opencode');
  handler.feed('{"type":"step_start","sessionID":"ses_4af9c2","part":{"type":"step-start"}}\n');
  assert.deepEqual(events, [
    { type: 'status', label: 'running', sessionId: 'ses_4af9c2' },
  ]);
});

test('opencode step_start without a session id reports a null sessionId (no spurious capture)', () => {
  const { events, handler } = collectEvents('opencode');
  handler.feed('{"type":"step_start","part":{"type":"step-start"}}\n');
  assert.deepEqual(events, [
    { type: 'status', label: 'running', sessionId: null },
  ]);
});

test('opencode json stream emits tool events', () => {
  const { events, handler } = collectEvents('opencode');

  handler.feed(
    JSON.stringify({
      type: 'tool_use',
      part: {
        tool: 'read',
        callID: 'call-1',
        state: {
          input: JSON.stringify({ file: 'foo.txt' }),
          output: 'done',
          status: 'completed',
        },
      },
    }) + '\n',
  );

  assert.deepEqual(events, [
    { type: 'tool_use', id: 'call-1', name: 'read', input: { file: 'foo.txt' } },
    { type: 'tool_result', toolUseId: 'call-1', content: 'done', isError: false },
  ]);
});

test('opencode json stream marks structured tool failures as errors', () => {
  const cases = [
    {
      name: 'completed tool with a non-zero metadata exit',
      state: { status: 'completed', output: 'command failed', metadata: { exit: 1 } },
      content: 'command failed',
    },
    {
      name: 'completed tool with a direct non-zero exitCode',
      state: { status: 'completed', output: 'command failed', exitCode: 2 },
      content: 'command failed',
    },
    {
      name: 'completed tool with a direct non-zero exit',
      state: { status: 'completed', output: 'command failed', exit: 3 },
      content: 'command failed',
    },
    {
      name: 'completed tool with an explicit error',
      state: { status: 'completed', output: 'partial output', error: 'tool failed' },
      content: 'tool failed',
    },
    {
      name: 'official error state',
      state: { status: 'error', output: 'partial output', error: 'permission denied' },
      content: 'permission denied',
    },
    {
      name: 'legacy failed state',
      state: { status: 'failed', output: 'process failed' },
      content: 'process failed',
    },
    {
      name: 'PowerShell non-terminating ErrorRecord with exit zero',
      state: {
        status: 'completed',
        output:
          "Get-Content : Cannot find path 'missing.txt' because it does not exist.\r\n" +
          '    + CategoryInfo          : ObjectNotFound: (missing.txt:String) [Get-Content], ItemNotFoundException\r\n' +
          '    + FullyQualifiedErrorId : PathNotFound,Microsoft.PowerShell.Commands.GetContentCommand',
        metadata: { exit: 0 },
      },
      content:
        "Get-Content : Cannot find path 'missing.txt' because it does not exist.\r\n" +
        '    + CategoryInfo          : ObjectNotFound: (missing.txt:String) [Get-Content], ItemNotFoundException\r\n' +
        '    + FullyQualifiedErrorId : PathNotFound,Microsoft.PowerShell.Commands.GetContentCommand',
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const { events, handler } = collectEvents('opencode');
    handler.feed(
      JSON.stringify({
        type: 'tool_use',
        part: {
          tool: 'bash',
          callID: `call-${index}`,
          state: {
            input: { command: 'exit 1' },
            ...testCase.state,
          },
        },
      }) + '\n',
    );

    assert.deepEqual(
      events.at(-1),
      {
        type: 'tool_result',
        toolUseId: `call-${index}`,
        content: testCase.content,
        isError: true,
      },
      testCase.name,
    );
  }
});

test('opencode json stream preserves successful and non-terminal tool states', () => {
  const { events, handler } = collectEvents('opencode');

  for (const [callID, state] of [
    ['success', { status: 'completed', output: 'done', metadata: { exit: 0 } }],
    ['false-error', { status: 'completed', output: 'done', error: false }],
    ['zero-error', { status: 'completed', output: 'done', error: 0 }],
    ['pending', { status: 'pending', input: { command: 'pwd' } }],
    ['running', { status: 'running', input: { command: 'pwd' } }],
  ] as const) {
    handler.feed(
      JSON.stringify({ type: 'tool_use', part: { tool: 'bash', callID, state } }) + '\n',
    );
  }

  assert.deepEqual(events, [
    { type: 'tool_use', id: 'success', name: 'bash', input: null },
    { type: 'tool_result', toolUseId: 'success', content: 'done', isError: false },
    { type: 'tool_use', id: 'false-error', name: 'bash', input: null },
    { type: 'tool_result', toolUseId: 'false-error', content: 'done', isError: false },
    { type: 'tool_use', id: 'zero-error', name: 'bash', input: null },
    { type: 'tool_result', toolUseId: 'zero-error', content: 'done', isError: false },
    { type: 'tool_use', id: 'pending', name: 'bash', input: { command: 'pwd' } },
    { type: 'tool_use', id: 'running', name: 'bash', input: { command: 'pwd' } },
  ]);
});

test('opencode json stream emits a terminal tool result only once per call', () => {
  const { events, handler } = collectEvents('opencode');
  const terminal = JSON.stringify({
    type: 'tool_use',
    sessionID: 'session-1',
    part: {
      tool: 'bash',
      callID: 'call-1',
      state: { status: 'completed', output: 'failed', metadata: { exit: 1 } },
    },
  });

  handler.feed(`${terminal}\n${terminal}\n`);

  assert.deepEqual(events, [
    { type: 'tool_use', id: 'call-1', name: 'bash', input: null },
    { type: 'tool_result', toolUseId: 'call-1', content: 'failed', isError: true },
  ]);
});

test('opencode PowerShell signatures stay narrow to canonical shell ErrorRecords', () => {
  const { events, handler } = collectEvents('opencode');
  const errorRecord =
    '+ CategoryInfo : ObjectNotFound: (missing.txt:String) [Get-Content], ItemNotFoundException\n' +
    '+ FullyQualifiedErrorId : PathNotFound,Microsoft.PowerShell.Commands.GetContentCommand';
  const documentation =
    'CategoryInfo : copied from a troubleshooting document\n' +
    'FullyQualifiedErrorId : copied-example';

  for (const [tool, callID, output] of [
    ['read', 'read-error-record', errorRecord],
    ['bash', 'bash-documentation', documentation],
  ] as const) {
    handler.feed(
      JSON.stringify({
        type: 'tool_use',
        part: {
          tool,
          callID,
          state: { status: 'completed', output, metadata: { exit: 0 } },
        },
      }) + '\n',
    );
  }

  assert.deepEqual(events, [
    { type: 'tool_use', id: 'read-error-record', name: 'read', input: null },
    {
      type: 'tool_result',
      toolUseId: 'read-error-record',
      content: errorRecord,
      isError: false,
    },
    { type: 'tool_use', id: 'bash-documentation', name: 'bash', input: null },
    {
      type: 'tool_result',
      toolUseId: 'bash-documentation',
      content: documentation,
      isError: false,
    },
  ]);
});

test('opencode structured failures reach the repeated-failure tool-loop halt', () => {
  const guard = createToolLoopGuard({ mode: 'halt' });
  const verdicts: ToolLoopVerdict[] = [];
  const handler = createJsonEventStreamHandler('opencode', (event) => {
    if (event.type === 'tool_use') {
      guard.observeToolUse(String(event.id), String(event.name), event.input);
    }
    if (event.type === 'tool_result') {
      const verdict = guard.observeToolResult(
        String(event.toolUseId),
        event.isError === true,
        typeof event.content === 'string' ? event.content : undefined,
      );
      if (verdict) verdicts.push(verdict);
    }
  });

  for (let index = 0; index < 8; index += 1) {
    handler.feed(
      JSON.stringify({
        type: 'tool_use',
        part: {
          tool: 'bash',
          callID: `call-${index}`,
          state: {
            status: 'completed',
            input: { command: 'Get-Content -LiteralPath missing.txt' },
            output:
              "Get-Content : Cannot find path 'missing.txt' because it does not exist.\r\n" +
              '    + CategoryInfo          : ObjectNotFound: (missing.txt:String) [Get-Content], ItemNotFoundException\r\n' +
              '    + FullyQualifiedErrorId : PathNotFound,Microsoft.PowerShell.Commands.GetContentCommand',
            metadata: { exit: 0 },
          },
        },
      }) + '\n',
    );
  }

  assert.deepEqual(
    verdicts.map(({ reason, action, count }) => ({ reason, action, count })),
    [
      { reason: 'repeated-failure', action: 'warn', count: 4 },
      { reason: 'repeated-failure', action: 'halt', count: 8 },
    ],
  );
});

test('opencode json stream emits structured errors as error events', () => {
  const { events, handler } = collectEvents('opencode');

  const errorLine = JSON.stringify({
    type: 'error',
    error: { data: { message: 'OpenCode auth failed: login required' } },
  });
  handler.feed(errorLine + '\n');

  assert.deepEqual(events, [
    { type: 'error', message: 'OpenCode auth failed: login required', raw: errorLine },
  ]);
});

test('opencode json stream preserves nested error messages', () => {
  const { events, handler } = collectEvents('opencode');

  const errorLine = JSON.stringify({
    type: 'error',
    error: { message: 'model not found: openai/nope' },
  });
  handler.feed(errorLine + '\n');

  assert.deepEqual(events, [
    { type: 'error', message: 'model not found: openai/nope', raw: errorLine },
  ]);
});

test('opencode json stream falls back to error name when data has no message', () => {
  const { events, handler } = collectEvents('opencode');

  const errorLine = JSON.stringify({
    type: 'error',
    error: { name: 'AuthError', data: {} },
  });
  handler.feed(errorLine + '\n');

  assert.deepEqual(events, [
    { type: 'error', message: 'AuthError', raw: errorLine },
  ]);
});

test('unknown json stream lines become raw events', () => {
  const { events, handler } = collectEvents('opencode');

  handler.feed('not-json\n');
  handler.flush();

  assert.deepEqual(events, [{ type: 'raw', line: 'not-json' }]);
});

// Regression coverage for #691: OpenCode emits structured error frames on
// stdout while still exiting 0. The parser must surface them as proper
// `error` events (matching the qoder-stream contract) so server.ts's
// `sendAgentEvent` flips the run to `failed` and forwards a visible SSE
// error to the chat. Previously these were downgraded to `type:'raw'`,
// which the chat UI doesn't render — the run looked like a fast clean
// success while the user actually got nothing back.
test('opencode json stream surfaces error frames as proper error events (regression of #691)', () => {
  const { events, handler } = collectEvents('opencode');

  const errorLine = JSON.stringify({
    type: 'error',
    error: {
      name: 'ProviderError',
      data: { message: 'Authentication expired — please re-login.' },
    },
  });
  handler.feed(errorLine + '\n');

  assert.deepEqual(events, [
    {
      type: 'error',
      message: 'Authentication expired — please re-login.',
      raw: errorLine,
    },
  ]);
});

test('opencode json stream falls back to error.name when error.data.message is absent', () => {
  const { events, handler } = collectEvents('opencode');

  const errorLine = JSON.stringify({
    type: 'error',
    error: { name: 'NetworkError' },
  });
  handler.feed(errorLine + '\n');

  assert.deepEqual(events, [
    {
      type: 'error',
      message: 'NetworkError',
      raw: errorLine,
    },
  ]);
});

test('opencode json stream falls back to a generic message when error has no usable detail', () => {
  const { events, handler } = collectEvents('opencode');

  const errorLine = JSON.stringify({ type: 'error', error: {} });
  handler.feed(errorLine + '\n');

  assert.deepEqual(events, [
    {
      type: 'error',
      message: 'OpenCode error',
      raw: errorLine,
    },
  ]);
});

test('codex json stream emits status text and usage events', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({ type: 'thread.started', thread_id: 'thr-1' }) + '\n' +
    JSON.stringify({ type: 'turn.started' }) + '\n' +
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'item-1', type: 'agent_message', text: 'hello' },
    }) +
    '\n' +
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 12, cached_input_tokens: 4, output_tokens: 3 },
    }) +
    '\n',
  );

  assert.deepEqual(events, [
    { type: 'status', label: 'initializing', sessionId: 'thr-1' },
    { type: 'status', label: 'thinking' },
    { type: 'text_delta', delta: 'hello' },
    { type: 'usage', usage: { input_tokens: 12, output_tokens: 3, cached_read_tokens: 4 } },
  ]);
});

test('codex thread.started surfaces the thread id as the status sessionId (capture-style resume handle)', () => {
  const { events, handler } = collectEvents('codex');
  handler.feed(
    JSON.stringify({ type: 'thread.started', thread_id: '019eef4f-7409-7c82-bebe-30504eed3959' }) + '\n',
  );
  assert.deepEqual(events, [
    { type: 'status', label: 'initializing', sessionId: '019eef4f-7409-7c82-bebe-30504eed3959' },
  ]);
});

test('codex thread.started without a thread id reports a null sessionId (no spurious capture)', () => {
  const { events, handler } = collectEvents('codex');
  handler.feed(JSON.stringify({ type: 'thread.started' }) + '\n');
  assert.deepEqual(events, [
    { type: 'status', label: 'initializing', sessionId: null },
  ]);
});

test('codex json stream emits thinking status and reasoning token usage', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({ type: 'turn.started' }) + '\n' +
    JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 12,
        cached_input_tokens: 4,
        output_tokens: 3,
        reasoning_output_tokens: 8,
      },
    }) +
    '\n',
  );

  assert.deepEqual(events, [
    { type: 'status', label: 'thinking' },
    {
      type: 'usage',
      usage: {
        input_tokens: 12,
        output_tokens: 3,
        thought_tokens: 8,
        cached_read_tokens: 4,
      },
    },
  ]);
});

test('codex json stream emits thinking deltas from reasoning items (regression: codex thinking had no content to expand)', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({ type: 'turn.started' }) + '\n' +
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_0', type: 'reasoning', text: '**Scoping the deck**\nPick 10 slides.' },
    }) + '\n' +
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_2', type: 'reasoning', text: '**Choosing a palette**' },
    }) + '\n',
  );

  assert.deepEqual(events, [
    { type: 'status', label: 'thinking' },
    { type: 'thinking_delta', delta: '**Scoping the deck**\nPick 10 slides.' },
    // A new reasoning item starts a new summary paragraph; the web folds all
    // thinking deltas into one block, so the parser owns the separation.
    { type: 'thinking_delta', delta: '\n\n**Choosing a palette**' },
  ]);
});

test('codex json stream emits only the unseen suffix when a reasoning item repeats across lifecycle events', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({ type: 'item.started', item: { id: 'item_0', type: 'reasoning', text: '' } }) + '\n' +
    JSON.stringify({ type: 'item.updated', item: { id: 'item_0', type: 'reasoning', text: 'Reading the brief' } }) + '\n' +
    JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'Reading the brief, then drafting.' } }) + '\n',
  );

  assert.deepEqual(events, [
    { type: 'thinking_delta', delta: 'Reading the brief' },
    { type: 'thinking_delta', delta: ', then drafting.' },
  ]);
});

test('codex json stream surfaces non-fatal error items as a warning status, not raw noise (skills budget notice)', () => {
  const { events, handler } = collectEvents('codex');

  const message =
    'Skill descriptions were shortened to fit the 2% skills context budget. ' +
    'Codex can still see every skill, but some descriptions are shorter.';
  handler.feed(
    JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'error', message } }) + '\n',
  );

  // Must stay a visible non-fatal warning: two sibling runs in the incident
  // bundle carried this exact item and completed successfully, so a fatal
  // `error` event here would wrongly kill healthy runs.
  assert.deepEqual(events, [
    { type: 'status', label: 'warning', detail: message },
  ]);
});

test('codex json stream preserves line boundaries between assistant message items', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({ type: 'turn.started' }) + '\n' +
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'item-1', type: 'agent_message', text: 'English: one' },
    }) +
    '\n' +
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'item-2', type: 'agent_message', text: 'Chinese: 一' },
    }) +
    '\n' +
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'item-3', type: 'agent_message', text: 'English: two' },
    }) +
    '\n',
  );

  const text = events
    .filter((event) => event.type === 'text_delta')
    .map((event) => event.delta)
    .join('');

  assert.equal(text, 'English: one\nChinese: 一\nEnglish: two');
});

test('codex json stream does not duplicate existing assistant message newlines', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'item-1', type: 'agent_message', text: 'English: one\n' },
    }) +
    '\n' +
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'item-2', type: 'agent_message', text: 'Chinese: 一' },
    }) +
    '\n' +
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'item-3', type: 'agent_message', text: '\nEnglish: two' },
    }) +
    '\n',
  );

  const text = events
    .filter((event) => event.type === 'text_delta')
    .map((event) => event.delta)
    .join('');

  assert.equal(text, 'English: one\nChinese: 一\nEnglish: two');
});

test('codex json stream emits structured errors once', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({
      type: 'error',
      message: JSON.stringify({
        detail: "The 'gpt-5.5' model requires a newer version of Codex.",
      }),
    }) +
    '\n' +
    JSON.stringify({
      type: 'turn.failed',
      error: { message: 'plain failure' },
    }) +
    '\n',
  );

  assert.deepEqual(events, [
    {
      type: 'error',
      message: "The 'gpt-5.5' model requires a newer version of Codex.",
    },
  ]);
});

test('codex json stream emits command execution tool events', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({
      type: 'item.started',
      item: {
        id: 'item-1',
        type: 'command_execution',
        command: "/bin/zsh -lc 'echo hello-from-codex'",
        aggregated_output: '',
        exit_code: null,
        status: 'in_progress',
      },
    }) +
    '\n' +
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item-1',
        type: 'command_execution',
        command: "/bin/zsh -lc 'echo hello-from-codex'",
        aggregated_output: 'hello-from-codex\n',
        exit_code: 0,
        status: 'completed',
      },
    }) +
    '\n',
  );

  assert.deepEqual(events, [
    {
      type: 'tool_use',
      id: 'item-1',
      name: 'Bash',
      input: { command: "/bin/zsh -lc 'echo hello-from-codex'" },
    },
    {
      type: 'tool_result',
      toolUseId: 'item-1',
      content: 'hello-from-codex\n',
      isError: false,
    },
  ]);
});

/*
 * The `file_change` fixtures below are copied verbatim out of recorded runs
 * under `.pixo/runs/<id>/events.jsonl`, where they were passed through as
 * `{"type":"raw",...}` because the parser had no branch for the item type.
 * Do not "tidy" the field names — the whole point is that they are codex's.
 */
const CODEX_FILE_CHANGE_ADD_STARTED =
  '{"type":"item.started","item":{"id":"item_3","type":"file_change","changes":[{"path":"/Users/elian/Documents/pixo-wt-chat-panel/.pixo/projects/c6893efa-5f78-43c8-82da-19a2b7acf65c/ai-design-judgment.html","kind":"add"},{"path":"/Users/elian/Documents/pixo-wt-chat-panel/.pixo/projects/c6893efa-5f78-43c8-82da-19a2b7acf65c/brand-spec.md","kind":"add"}],"status":"in_progress"}}';
const CODEX_FILE_CHANGE_ADD_COMPLETED =
  '{"type":"item.completed","item":{"id":"item_3","type":"file_change","changes":[{"path":"/Users/elian/Documents/pixo-wt-chat-panel/.pixo/projects/c6893efa-5f78-43c8-82da-19a2b7acf65c/ai-design-judgment.html","kind":"add"},{"path":"/Users/elian/Documents/pixo-wt-chat-panel/.pixo/projects/c6893efa-5f78-43c8-82da-19a2b7acf65c/brand-spec.md","kind":"add"}],"status":"completed"}}';
const CODEX_FILE_CHANGE_UPDATE_STARTED =
  '{"type":"item.started","item":{"id":"item_9","type":"file_change","changes":[{"path":"/Users/elian/Documents/pixo-wt-chat-panel/.pixo/projects/2ba97aa7-24ce-424a-8923-437cf4fcd5b5/trustworthy-design-one-pager.html","kind":"update"}],"status":"in_progress"}}';
const CODEX_FILE_CHANGE_UPDATE_COMPLETED =
  '{"type":"item.completed","item":{"id":"item_9","type":"file_change","changes":[{"path":"/Users/elian/Documents/pixo-wt-chat-panel/.pixo/projects/2ba97aa7-24ce-424a-8923-437cf4fcd5b5/trustworthy-design-one-pager.html","kind":"update"}],"status":"completed"}}';
const ADDED_HTML =
  '/Users/elian/Documents/pixo-wt-chat-panel/.pixo/projects/c6893efa-5f78-43c8-82da-19a2b7acf65c/ai-design-judgment.html';
const ADDED_MD =
  '/Users/elian/Documents/pixo-wt-chat-panel/.pixo/projects/c6893efa-5f78-43c8-82da-19a2b7acf65c/brand-spec.md';
const UPDATED_HTML =
  '/Users/elian/Documents/pixo-wt-chat-panel/.pixo/projects/2ba97aa7-24ce-424a-8923-437cf4fcd5b5/trustworthy-design-one-pager.html';

test('codex json stream emits a Write tool row per added file (regression: codex file writes never appeared in the chat)', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(`${CODEX_FILE_CHANGE_ADD_STARTED}\n${CODEX_FILE_CHANGE_ADD_COMPLETED}\n`);

  assert.deepEqual(events, [
    { type: 'tool_use', id: 'item_3#0', name: 'Write', input: { file_path: ADDED_HTML } },
    { type: 'tool_use', id: 'item_3#1', name: 'Write', input: { file_path: ADDED_MD } },
    { type: 'tool_result', toolUseId: 'item_3#0', content: '', isError: false },
    { type: 'tool_result', toolUseId: 'item_3#1', content: '', isError: false },
  ]);
});

test('codex json stream emits an Edit tool row for an updated file', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(`${CODEX_FILE_CHANGE_UPDATE_STARTED}\n${CODEX_FILE_CHANGE_UPDATE_COMPLETED}\n`);

  assert.deepEqual(events, [
    { type: 'tool_use', id: 'item_9#0', name: 'Edit', input: { file_path: UPDATED_HTML } },
    { type: 'tool_result', toolUseId: 'item_9#0', content: '', isError: false },
  ]);
});

/*
 * The `tool_use` must leave the parser at `item.started`, not be held back
 * until `item.completed`. `tool-timing.ts` stamps `startedAt` at the single
 * event exit, so a `tool_use` that arrives together with its `tool_result`
 * gives the row a near-zero span the web reads as "unknown" rather than a
 * duration. Feeding the started line alone is the only way to observe that,
 * since a completed-only stream emits the same events in the same order.
 */
test('codex json stream emits the file_change tool_use at item.started, before the result exists', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(`${CODEX_FILE_CHANGE_UPDATE_STARTED}\n`);

  assert.deepEqual(events, [
    { type: 'tool_use', id: 'item_9#0', name: 'Edit', input: { file_path: UPDATED_HTML } },
  ]);
});

/*
 * A file_change ends the current assistant message the same way a
 * command_execution does, so the next agent_message must not be glued to the
 * previous one with a synthetic newline — the tool row already separates them.
 */
test('codex file_change clears the agent_message boundary state like command_execution does', () => {
  const { events, handler } = collectEvents('codex');

  const agentMessage = (id: string, text: string): string =>
    JSON.stringify({ type: 'item.completed', item: { id, type: 'agent_message', text } });

  handler.feed(
    `${agentMessage('item_8', 'rewriting the page')}\n` +
    `${CODEX_FILE_CHANGE_UPDATE_STARTED}\n` +
    `${CODEX_FILE_CHANGE_UPDATE_COMPLETED}\n` +
    `${agentMessage('item_10', 'done')}\n`,
  );

  assert.deepEqual(events, [
    { type: 'text_delta', delta: 'rewriting the page' },
    { type: 'tool_use', id: 'item_9#0', name: 'Edit', input: { file_path: UPDATED_HTML } },
    { type: 'tool_result', toolUseId: 'item_9#0', content: '', isError: false },
    { type: 'text_delta', delta: 'done' },
  ]);
});

test('codex json stream still emits a file_change tool pair when only item.completed arrives', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(`${CODEX_FILE_CHANGE_UPDATE_COMPLETED}\n`);

  assert.deepEqual(events, [
    { type: 'tool_use', id: 'item_9#0', name: 'Edit', input: { file_path: UPDATED_HTML } },
    { type: 'tool_result', toolUseId: 'item_9#0', content: '', isError: false },
  ]);
});

test('codex json stream marks a failed file_change item as an errored tool result', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    `${JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_9',
        type: 'file_change',
        changes: [{ path: UPDATED_HTML, kind: 'update' }],
        status: 'failed',
      },
    })}\n`,
  );

  assert.deepEqual(events, [
    { type: 'tool_use', id: 'item_9#0', name: 'Edit', input: { file_path: UPDATED_HTML } },
    { type: 'tool_result', toolUseId: 'item_9#0', content: '', isError: true },
  ]);
});

test('codex json stream leaves an unrecognized file_change kind as raw instead of guessing a verb', () => {
  const { events, handler } = collectEvents('codex');

  const line = JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'item_9',
      type: 'file_change',
      changes: [{ path: UPDATED_HTML, kind: 'delete' }],
      status: 'completed',
    },
  });
  handler.feed(`${line}\n`);

  assert.deepEqual(events, [{ type: 'raw', line }]);
});

test('codex file_change handling leaves other json-event-stream runtimes untouched', () => {
  const { events, handler } = collectEvents('opencode');

  handler.feed(`${CODEX_FILE_CHANGE_ADD_COMPLETED}\n`);

  assert.deepEqual(events, [{ type: 'raw', line: CODEX_FILE_CHANGE_ADD_COMPLETED }]);
});

test('codex file_change rows do not disturb neighbouring reasoning and agent_message items', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    `${JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_2', type: 'reasoning', text: 'weighing the layout' },
    })}\n` +
    `${CODEX_FILE_CHANGE_UPDATE_STARTED}\n` +
    `${CODEX_FILE_CHANGE_UPDATE_COMPLETED}\n` +
    `${JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_10', type: 'agent_message', text: 'done rewriting the page' },
    })}\n`,
  );

  assert.deepEqual(events, [
    { type: 'thinking_delta', delta: 'weighing the layout' },
    { type: 'tool_use', id: 'item_9#0', name: 'Edit', input: { file_path: UPDATED_HTML } },
    { type: 'tool_result', toolUseId: 'item_9#0', content: '', isError: false },
    { type: 'text_delta', delta: 'done rewriting the page' },
  ]);
});

test('codex json stream emits TodoWrite events from todo_list items', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({
      type: 'item.started',
      item: {
        id: 'item-0',
        type: 'todo_list',
        items: [
          { text: 'Inspect workspace', completed: false },
          { text: 'Write prototype', completed: false },
        ],
      },
    }) +
    '\n' +
    JSON.stringify({
      type: 'item.updated',
      item: {
        id: 'item-0',
        type: 'todo_list',
        items: [
          { text: 'Inspect workspace', completed: true },
          { text: 'Write prototype', completed: false },
        ],
      },
    }) +
    '\n',
  );

  assert.deepEqual(events, [
    {
      type: 'tool_use',
      id: 'item-0',
      name: 'TodoWrite',
      input: {
        todos: [
          { content: 'Inspect workspace', status: 'pending' },
          { content: 'Write prototype', status: 'pending' },
        ],
      },
    },
    {
      type: 'tool_use',
      id: 'item-0',
      name: 'TodoWrite',
      input: {
        todos: [
          { content: 'Inspect workspace', status: 'completed' },
          { content: 'Write prototype', status: 'pending' },
        ],
      },
    },
  ]);
});

test('unhandled structured events fall back to raw', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(JSON.stringify({ type: 'unhandled.event', foo: 'bar' }) + '\n');

  assert.deepEqual(events, [{ type: 'raw', line: '{"type":"unhandled.event","foo":"bar"}' }]);
});
test('codex json stream treats reconnect errors as status warnings not fatal (regression of #1471)', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({ type: 'thread.started', thread_id: 'thr-1' }) + '\n' +
    JSON.stringify({ type: 'turn.started' }) + '\n' +
    JSON.stringify({ type: 'error', message: 'Reconnecting... 2/5 (timeout waiting for child process to exit)' }) + '\n' +
    JSON.stringify({ type: 'item.completed', item: { id: 'item-0', type: 'agent_message', text: 'OK' } }) + '\n' +
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 2, cached_input_tokens: 0 } }) + '\n',
  );

  assert.deepEqual(events, [
    { type: 'status', label: 'initializing', sessionId: 'thr-1' },
    { type: 'status', label: 'thinking' },
    { type: 'status', label: 'agent_reconnecting', detail: '2/5' },
    { type: 'text_delta', delta: 'OK' },
    { type: 'usage', usage: { input_tokens: 5, output_tokens: 2, cached_read_tokens: 0 } },
  ]);
});

test('codex json stream treats stream disconnect reconnect errors as status warnings not fatal', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({ type: 'thread.started', thread_id: 'thr-1' }) + '\n' +
    JSON.stringify({ type: 'turn.started' }) + '\n' +
    JSON.stringify({
      type: 'error',
      message: 'Reconnecting... 2/5 (stream disconnected before completion: Connection reset by peer (os error 54))',
    }) + '\n' +
    JSON.stringify({ type: 'item.completed', item: { id: 'item-0', type: 'agent_message', text: 'OK' } }) + '\n' +
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 2, cached_input_tokens: 0 } }) + '\n',
  );

  assert.deepEqual(events, [
    { type: 'status', label: 'initializing', sessionId: 'thr-1' },
    { type: 'status', label: 'thinking' },
    { type: 'status', label: 'agent_reconnecting', detail: '2/5' },
    { type: 'text_delta', delta: 'OK' },
    { type: 'usage', usage: { input_tokens: 5, output_tokens: 2, cached_read_tokens: 0 } },
  ]);
});

test('codex json stream still treats real errors as fatal after reconnect warnings', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({ type: 'error', message: 'Reconnecting... 2/5 (timeout waiting for child process to exit)' }) + '\n' +
    JSON.stringify({ type: 'error', message: 'Authentication failed: invalid API key' }) + '\n',
  );

  assert.deepEqual(events, [
    { type: 'status', label: 'agent_reconnecting', detail: '2/5' },
    { type: 'error', message: 'Authentication failed: invalid API key' },
  ]);
});

test('codex json stream does not downgrade non-reconnect errors that mention reconnect text', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    JSON.stringify({
      type: 'error',
      message: 'Authentication failed after Reconnecting... stream disconnected before completion',
    }) + '\n',
  );

  assert.deepEqual(events, [
    {
      type: 'error',
      message: 'Authentication failed after Reconnecting... stream disconnected before completion',
    },
  ]);
});

/*
 * ── codex `mcp_tool_call` / `web_search` ────────────────────────────────
 *
 * Both fixtures below are copied VERBATIM out of live `codex exec --json`
 * captures taken with the daemon's own flags (codex-cli 0.149.1). Do not
 * normalise them — the oddities are codex's and the tests exist to pin them:
 *
 *  · `mcp_tool_call` carries `server` / `tool` / `arguments` already on
 *    `item.started`, and reports failure through BOTH `status:"failed"` and a
 *    populated `error` object.
 *  · `web_search` serialises `id` TWICE in the same object — the item id first,
 *    then an `exec-…` id. `JSON.parse` keeps the LAST one, so the tool id the
 *    parser sees is the `exec-…` value, not `item_2`. It is stable across the
 *    started/completed pair, so the pairing still holds.
 *  · `web_search`'s started frame has an EMPTY `query` and `action.type:"other"`;
 *    the real query only exists on `item.completed`.
 *
 * Both item types fell through to `{"type":"raw"}` before this family existed,
 * and `build-turn-blocks.ts` skips `raw` outright — so a codex turn that
 * searched the web or called a connected MCP server showed NO row at all.
 */
const CODEX_MCP_TOOL_CALL_STARTED =
  '{"type":"item.started","item":{"id":"item_2","type":"mcp_tool_call","server":"echofacts","tool":"echo_fact","arguments":{"topic":"orbital-mechanics"},"result":null,"error":null,"status":"in_progress"}}';
const CODEX_MCP_TOOL_CALL_FAILED =
  '{"type":"item.completed","item":{"id":"item_2","type":"mcp_tool_call","server":"echofacts","tool":"echo_fact","arguments":{"topic":"orbital-mechanics"},"result":null,"error":{"message":"MCP tool call requires approval, but approval policy is never"},"status":"failed"}}';
const CODEX_WEB_SEARCH_STARTED =
  '{"type":"item.started","item":{"id":"item_2","type":"web_search","id":"exec-9fb8985e-4163-4af2-82a2-d499ab71d18b","query":"","action":{"type":"other"}}}';
const CODEX_WEB_SEARCH_COMPLETED =
  '{"type":"item.completed","item":{"id":"item_2","type":"web_search","id":"exec-9fb8985e-4163-4af2-82a2-d499ab71d18b","query":"OpenAI Codex CLI release notes","action":{"type":"search","query":"OpenAI Codex CLI release notes"}}}';
/** Duplicate `id` key: `JSON.parse` keeps the last, so this is the tool id. */
const CODEX_WEB_SEARCH_ID = 'exec-9fb8985e-4163-4af2-82a2-d499ab71d18b';
const MCP_TOOL_NAME = 'mcp__echofacts__echo_fact';

test('codex json stream emits a tool row for an mcp_tool_call (regression: connected MCP servers were invisible)', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(`${CODEX_MCP_TOOL_CALL_STARTED}\n${CODEX_MCP_TOOL_CALL_FAILED}\n`);

  assert.deepEqual(events, [
    {
      type: 'tool_use',
      id: 'item_2',
      name: MCP_TOOL_NAME,
      input: { topic: 'orbital-mechanics' },
    },
    {
      type: 'tool_result',
      toolUseId: 'item_2',
      content: 'MCP tool call requires approval, but approval policy is never',
      isError: true,
    },
  ]);
});

/*
 * The `tool_use` must leave the parser at `item.started` — every field the row
 * needs (server, tool, arguments) is already there, so holding it back would
 * cost the row its duration for nothing. Feeding the started line alone is the
 * only way to observe that; it must also NOT produce a `tool_result`, because
 * an unpaired `tool_use` is exactly what B8 relies on to keep the row off
 * screen until the call returns (D3: no 「执行中」 state for tool rows).
 */
test('codex json stream emits the mcp_tool_call tool_use at item.started, with no result yet', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(`${CODEX_MCP_TOOL_CALL_STARTED}\n`);

  assert.deepEqual(events, [
    {
      type: 'tool_use',
      id: 'item_2',
      name: MCP_TOOL_NAME,
      input: { topic: 'orbital-mechanics' },
    },
  ]);
});

test('codex json stream still emits an mcp_tool_call pair when only item.completed arrives', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(`${CODEX_MCP_TOOL_CALL_FAILED}\n`);

  assert.deepEqual(events, [
    {
      type: 'tool_use',
      id: 'item_2',
      name: MCP_TOOL_NAME,
      input: { topic: 'orbital-mechanics' },
    },
    {
      type: 'tool_result',
      toolUseId: 'item_2',
      content: 'MCP tool call requires approval, but approval policy is never',
      isError: true,
    },
  ]);
});

test('codex mcp_tool_call clears the agent_message boundary state like command_execution does', () => {
  const { events, handler } = collectEvents('codex');

  const agentMessage = (id: string, text: string): string =>
    JSON.stringify({ type: 'item.completed', item: { id, type: 'agent_message', text } });

  handler.feed(
    `${agentMessage('item_1', 'calling the tool')}\n` +
    `${CODEX_MCP_TOOL_CALL_STARTED}\n` +
    `${CODEX_MCP_TOOL_CALL_FAILED}\n` +
    `${agentMessage('item_3', 'that is what it said')}\n`,
  );

  assert.deepEqual(events, [
    { type: 'text_delta', delta: 'calling the tool' },
    {
      type: 'tool_use',
      id: 'item_2',
      name: MCP_TOOL_NAME,
      input: { topic: 'orbital-mechanics' },
    },
    {
      type: 'tool_result',
      toolUseId: 'item_2',
      content: 'MCP tool call requires approval, but approval policy is never',
      isError: true,
    },
    { type: 'text_delta', delta: 'that is what it said' },
  ]);
});

test('codex mcp_tool_call handling leaves other json-event-stream runtimes untouched', () => {
  const { events, handler } = collectEvents('opencode');

  handler.feed(`${CODEX_MCP_TOOL_CALL_STARTED}\n${CODEX_MCP_TOOL_CALL_FAILED}\n`);

  assert.deepEqual(events, [
    { type: 'raw', line: CODEX_MCP_TOOL_CALL_STARTED },
    { type: 'raw', line: CODEX_MCP_TOOL_CALL_FAILED },
  ]);
});

test('codex json stream emits a search tool row for a completed web_search', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(`${CODEX_WEB_SEARCH_STARTED}\n${CODEX_WEB_SEARCH_COMPLETED}\n`);

  assert.deepEqual(events, [
    // The early form, from `item.started` — see the note on the next test.
    { type: 'tool_in_flight', id: CODEX_WEB_SEARCH_ID, name: 'web_search', input: {} },
    {
      type: 'tool_use',
      id: CODEX_WEB_SEARCH_ID,
      name: 'web_search',
      input: { query: 'OpenAI Codex CLI release notes' },
    },
    { type: 'tool_result', toolUseId: CODEX_WEB_SEARCH_ID, content: '', isError: false },
  ]);
});

/*
 * ⚠️ This test used to assert the OPPOSITE — that `item.started` produces
 * nothing at all. The product overruled that on 2026-09-03, verbatim: 「调用前
 * (流式传输时)就要显示在界面上并开始计时,绝对不能调用完了才出现在界面上」.
 *
 * The old reasoning is worth keeping, because it names a trap this change had
 * to get around rather than one it disproved:
 *
 *   `web_search`'s started frame carries `query:""`, and the query IS the row
 *   (`toolTitle` and `searchPattern` both read it). Emitting the `tool_use`
 *   there would lock in a blank 「搜索」 row — the `codexToolUses` guard would
 *   then make `item.completed` a no-op and the real query would never arrive.
 *
 * All of that is still true, which is exactly why the early frame emits
 * `tool_in_flight` and not `tool_use`. That event does not touch
 * `codexToolUses`, so `item.completed` still emits the real pair with the real
 * query (asserted above), and the client retires the early row into the settled
 * one by shared id — one row, one clock, and the term fills itself in.
 */
test('codex web_search item.started emits the early row, so the clock starts when the call does', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(`${CODEX_WEB_SEARCH_STARTED}\n`);

  assert.deepEqual(events, [
    { type: 'tool_in_flight', id: CODEX_WEB_SEARCH_ID, name: 'web_search', input: {} },
  ]);
});

/*
 * codex's web_search `action` taxonomy has more members than `search` — the
 * started frame above shows `other`. We have only ever captured `search`, so
 * anything else must stay `raw` rather than be labelled 「搜索」: calling a page
 * fetch a search is the same class of lie as calling a file deletion 「新建」
 * (see the file_change `kind` fallback above).
 */
test('codex json stream leaves a non-search web_search action as raw instead of calling it a search', () => {
  const { events, handler } = collectEvents('codex');

  const line = JSON.stringify({
    type: 'item.completed',
    item: {
      id: CODEX_WEB_SEARCH_ID,
      type: 'web_search',
      query: 'OpenAI Codex CLI release notes',
      action: { type: 'other' },
    },
  });
  handler.feed(`${line}\n`);

  assert.deepEqual(events, [{ type: 'raw', line }]);
});

test('codex web_search handling leaves other json-event-stream runtimes untouched', () => {
  const { events, handler } = collectEvents('opencode');

  handler.feed(`${CODEX_WEB_SEARCH_STARTED}\n${CODEX_WEB_SEARCH_COMPLETED}\n`);

  assert.deepEqual(events, [
    { type: 'raw', line: CODEX_WEB_SEARCH_STARTED },
    { type: 'raw', line: CODEX_WEB_SEARCH_COMPLETED },
  ]);
});

/*
 * A half-named MCP call must not become a row labelled `mcp____` — the same
 * discipline the file_change `kind` fallback follows. The frame below is the
 * verbatim capture minus its `tool` field; it pins OUR fallback, not codex's
 * wording, and no captured frame has ever been missing one.
 */
test('codex json stream leaves a half-named mcp_tool_call as raw instead of naming it blank', () => {
  const { events, handler } = collectEvents('codex');

  const line = JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'item_2',
      type: 'mcp_tool_call',
      server: 'echofacts',
      arguments: { topic: 'orbital-mechanics' },
      result: null,
      error: null,
      status: 'completed',
    },
  });
  handler.feed(`${line}\n`);

  assert.deepEqual(events, [{ type: 'raw', line }]);
});

/*
 * The success path. RECONSTRUCTED, not captured: `codex exec` runs with
 * approval policy `never` and refuses every MCP call before it reaches the
 * server, so no successful frame could be recorded. Every field value here is
 * verbatim from the captured frames (`status:"completed"` is codex's own
 * completion vocabulary, shared with command_execution and file_change;
 * `result:null` appears in both captures), and the assertion is deliberately
 * limited to what is structurally certain — a non-failed call is not an error.
 * The payload shape of a populated `result` is NOT pinned here on purpose.
 */
test('codex json stream does not mark a non-failed mcp_tool_call as an error', () => {
  const { events, handler } = collectEvents('codex');

  handler.feed(
    `${JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_2',
        type: 'mcp_tool_call',
        server: 'echofacts',
        tool: 'echo_fact',
        arguments: { topic: 'orbital-mechanics' },
        result: null,
        error: null,
        status: 'completed',
      },
    })}\n`,
  );

  assert.deepEqual(events, [
    {
      type: 'tool_use',
      id: 'item_2',
      name: MCP_TOOL_NAME,
      input: { topic: 'orbital-mechanics' },
    },
    { type: 'tool_result', toolUseId: 'item_2', content: '', isError: false },
  ]);
});
