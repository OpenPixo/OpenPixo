/**
 * 输入框上方那一行「现在整体在干什么」的判据(`runtime/chat/run-status.ts`)。
 *
 * 每一例都是一个用户会遇到的时刻:刚发出去、在想、在跑某个工具、在等你、跑完了。
 * 断言的是 `activity` / `tone` 这些结论,文案由组件查 i18n,不在这里钉。
 */
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent, ProjectMediaTask } from '@openpixo/contracts';
import {
  activityForTool,
  conversationAwaitsAnswer,
  deriveRunStatusLine,
  type RunStatusInput,
} from '../../../src/runtime/chat/run-status';

const use = (id: string, name: string, input: unknown): PersistedAgentEvent => ({ kind: 'tool_use', id, name, input });
const result = (toolUseId: string): PersistedAgentEvent => ({ kind: 'tool_result', toolUseId, content: 'ok', isError: false });
const bash = (command: string) => ({ command });

function running(events: PersistedAgentEvent[], extra: Partial<RunStatusInput> = {}): RunStatusInput {
  return { latest: { runStatus: 'running', events }, streaming: true, ...extra };
}

function task(partial: Partial<ProjectMediaTask>): ProjectMediaTask {
  return {
    taskId: partial.taskId ?? 't',
    status: 'running',
    startedAt: 1,
    endedAt: null,
    elapsed: 0,
    progress: [],
    progressCount: 0,
    ...partial,
  };
}

describe('deriveRunStatusLine — no run to speak of', () => {
  it('an empty conversation is idle', () => {
    expect(deriveRunStatusLine({ latest: null, streaming: false })).toEqual({ activity: 'idle', tone: 'idle' });
  });

  it('a turn that was just sent and has no assistant message yet is starting', () => {
    expect(deriveRunStatusLine({ latest: null, streaming: true })).toEqual({ activity: 'starting', tone: 'busy' });
  });

  it('a message without any run status (host-authored) is idle, not "done"', () => {
    expect(deriveRunStatusLine({ latest: { events: [] }, streaming: false }).activity).toBe('idle');
  });
});

describe('deriveRunStatusLine — the run has stopped', () => {
  it('succeeded → done', () => {
    expect(deriveRunStatusLine({ latest: { runStatus: 'succeeded' }, streaming: false }))
      .toEqual({ activity: 'done', tone: 'success' });
  });

  it('failed → failed with the error tone', () => {
    expect(deriveRunStatusLine({ latest: { runStatus: 'failed' }, streaming: false }))
      .toEqual({ activity: 'failed', tone: 'error' });
  });

  it('canceled → stopped', () => {
    expect(deriveRunStatusLine({ latest: { runStatus: 'canceled' }, streaming: false }).activity).toBe('stopped');
  });

  it('an unanswered question form outranks "done": the user has to act', () => {
    expect(deriveRunStatusLine({ latest: { runStatus: 'succeeded' }, streaming: false, awaitingAnswer: true }))
      .toEqual({ activity: 'awaitingAnswer', tone: 'attention' });
  });

  it('a form that is still streaming in does not claim "waiting for you" yet', () => {
    const line = deriveRunStatusLine(running([{ kind: 'text', text: '<question-form' }], { awaitingAnswer: true }));
    expect(line.activity).toBe('replying');
  });
});

describe('deriveRunStatusLine — the run is live', () => {
  it('no event yet → starting', () => {
    expect(deriveRunStatusLine(running([]))).toEqual({ activity: 'starting', tone: 'busy' });
  });

  it('a refreshed page with no local stream still counts as live via runStatus', () => {
    const line = deriveRunStatusLine({ latest: { runStatus: 'queued', events: [] }, streaming: false });
    expect(line.activity).toBe('starting');
  });

  it('thinking → thinking; text → replying', () => {
    expect(deriveRunStatusLine(running([{ kind: 'thinking', text: '…' }])).activity).toBe('thinking');
    expect(deriveRunStatusLine(running([{ kind: 'text', text: '好的，' }])).activity).toBe('replying');
  });

  it('a tool result that just came back means the agent is deciding the next step', () => {
    const events = [use('a', 'Read', { file_path: 'src/main.js' }), result('a')];
    expect(deriveRunStatusLine(running(events)).activity).toBe('thinking');
  });

  it('usage / diagnostic events do not change what the line says', () => {
    const events: PersistedAgentEvent[] = [{ kind: 'text', text: '先看看' }, { kind: 'usage', outputTokens: 3 }];
    expect(deriveRunStatusLine(running(events)).activity).toBe('replying');
  });

  it('the newest open call wins when several are in flight', () => {
    const events = [use('a', 'Read', { file_path: 'a.js' }), use('b', 'Write', { file_path: 'src/player.js' })];
    expect(deriveRunStatusLine(running(events)).activity).toBe('coding');
  });

  it('approval and reconnect outrank the tool that is waiting on them', () => {
    const events = [use('a', 'Bash', bash('rm -rf build'))];
    expect(deriveRunStatusLine(running(events, { awaitingApproval: true }))).toMatchObject({ activity: 'awaitingApproval', tone: 'attention' });
    expect(deriveRunStatusLine(running(events, { reconnecting: true })).activity).toBe('reconnecting');
  });

  it('carries the current step: activeForm first, then content', () => {
    const todos = [
      { content: '了解项目', status: 'completed' },
      { content: '生成角色立绘', status: 'in_progress', activeForm: '正在生成角色立绘' },
    ];
    expect(deriveRunStatusLine(running([], { todos })).step).toBe('正在生成角色立绘');
    expect(deriveRunStatusLine(running([], { todos: [{ content: '编写代码', status: 'in_progress' }] })).step).toBe('编写代码');
  });

  it('with no explicit in_progress the first pending step is the current one (D36)', () => {
    const todos = [{ content: '做完了', status: 'completed' }, { content: '下一步', status: 'pending' }];
    expect(deriveRunStatusLine(running([], { todos })).step).toBe('下一步');
  });

  it('a finished plan contributes no step', () => {
    expect(deriveRunStatusLine(running([], { todos: [{ content: 'x', status: 'completed' }] })).step).toBeUndefined();
  });
});

describe('deriveRunStatusLine — media generation', () => {
  it('a running `pixo media generate` reads as generating an image', () => {
    const events = [use('g', 'Bash', bash('pixo media generate --surface image --prompt hero --output assets/hero.png'))];
    expect(deriveRunStatusLine(running(events))).toMatchObject({ activity: 'generating', surface: 'image' });
  });

  it('`--surface audio` is said as audio, not as an image', () => {
    const events = [use('g', 'Bash', bash('pixo media generate --surface audio --prompt jump'))];
    expect(deriveRunStatusLine(running(events)).surface).toBe('audio');
  });

  it('without media tasks the total comes from the command, N is never invented', () => {
    const command = ['a', 'b', 'c'].map((n) => `pixo media generate --surface image --prompt ${n}`).join(' && ');
    expect(deriveRunStatusLine(running([use('g', 'Bash', bash(command))])).progress).toEqual({ total: 3 });
  });

  it('a single image carries no progress: "1/1" says nothing', () => {
    const events = [use('g', 'Bash', bash('pixo media generate --surface image --prompt hero'))];
    expect(deriveRunStatusLine(running(events)).progress).toBeUndefined();
  });

  it('media tasks give N/M for the batch that is still open', () => {
    const mediaTasks = [
      task({ taskId: 'old', batchId: 'b0', batchSize: 1, status: 'done' }),
      task({ taskId: '1', batchId: 'b1', batchIndex: 1, batchSize: 5, status: 'done', surface: 'image' }),
      task({ taskId: '2', batchId: 'b1', batchIndex: 2, batchSize: 5, status: 'done', surface: 'image' }),
      task({ taskId: '3', batchId: 'b1', batchIndex: 3, batchSize: 5, status: 'running', surface: 'image' }),
    ];
    const events = [use('g', 'Bash', bash('pixo media generate --surface image --prompt x'))];
    expect(deriveRunStatusLine(running(events, { mediaTasks }))).toMatchObject({
      activity: 'generating',
      surface: 'image',
      progress: { done: 2, total: 5 },
    });
  });

  it('async tasks still rendering after the command returned keep the line on generating', () => {
    const events = [use('g', 'Bash', bash('pixo media generate --surface image --prompt x')), result('g')];
    const mediaTasks = [task({ batchId: 'b', batchSize: 2, status: 'running' }), task({ taskId: 'u', batchId: 'b', batchSize: 2, status: 'done' })];
    expect(deriveRunStatusLine(running(events, { mediaTasks }))).toMatchObject({ activity: 'generating', progress: { done: 1, total: 2 } });
  });

  it('finished tasks do not hold the line on generating', () => {
    const events = [use('g', 'Bash', bash('pixo media generate --surface image')), result('g')];
    const mediaTasks = [task({ status: 'done' })];
    expect(deriveRunStatusLine(running(events, { mediaTasks })).activity).toBe('thinking');
  });
});

describe('activityForTool', () => {
  it.each([
    ['TodoWrite', {}, 'planning'],
    ['todowrite', {}, 'planning'],
    ['Read', { file_path: 'src/main.js' }, 'reading'],
    ['Grep', { pattern: 'jump' }, 'searching'],
    ['Glob', { pattern: '**/*.js' }, 'searching'],
    ['WebSearch', { query: 'phaser tween' }, 'browsing'],
    ['Write', { file_path: 'src/player.ts' }, 'coding'],
    ['Edit', { file_path: 'scenes/level.tscn' }, 'coding'],
    ['Write', { file_path: 'docs/design.md' }, 'writing'],
    ['Write', { file_path: 'assets/hero.png' }, 'generating'],
    ['Bash', bash('npm run dev -- --port 5173'), 'previewing'],
    ['Bash', bash('pnpm dev'), 'previewing'],
    ['Bash', bash('npx vite'), 'previewing'],
    ['Bash', bash('python3 -m http.server 8000'), 'previewing'],
    ['Bash', bash('godot --path . --editor'), 'previewing'],
    ['Bash', bash('npm install phaser'), 'installing'],
    ['Bash', bash('pnpm add howler'), 'installing'],
    ['Bash', bash('pip install pygame'), 'installing'],
    ['Bash', bash('npm run build'), 'testing'],
    ['Bash', bash('npx vitest run'), 'testing'],
    ['Bash', bash('npx tsc --noEmit'), 'testing'],
    ['Bash', bash("bash -lc 'npm test'"), 'testing'],
    ['Bash', bash('npx vite build'), 'testing'],
    ['Bash', bash('cd game && npm run dev'), 'previewing'],
    ['Bash', bash('npm run devtools-check'), 'running'],
    ['Bash', bash('cat src/main.js'), 'reading'],
    ['Bash', bash('rg jump src'), 'searching'],
    ['Bash', bash('git status'), 'running'],
    ['Bash', bash('pixo media generate --help'), 'running'],
    ['mcp__browser__screenshot', {}, 'working'],
  ])('%s %j → %s', (name, input, expected) => {
    expect(activityForTool(name, input)).toBe(expected);
  });
});

describe('conversationAwaitsAnswer', () => {
  const form = '<question-form id="q" title="t">\n{"questions":[{"id":"a","type":"text","label":"A","required":true}]}\n</question-form>';

  it('a trailing assistant form with no user reply after it is waiting', () => {
    expect(conversationAwaitsAnswer([{ role: 'user', content: 'hi' }, { role: 'assistant', content: `问一下\n\n${form}` }])).toBe(true);
  });

  it('a user message after the form means it was answered', () => {
    expect(conversationAwaitsAnswer([{ role: 'assistant', content: form }, { role: 'user', content: '[form answers — q]' }])).toBe(false);
  });

  it('host-authored assistant messages after the form do not hide it', () => {
    expect(conversationAwaitsAnswer([{ role: 'assistant', content: form }, { role: 'assistant', content: '记住了你的偏好' }])).toBe(true);
  });

  it('plain prose is not a question', () => {
    expect(conversationAwaitsAnswer([{ role: 'assistant', content: '你想要什么颜色？' }])).toBe(false);
  });
});
