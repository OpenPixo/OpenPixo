/**
 * 用户原话:「生成图片的时候 先显示失败」。
 *
 * `media wait` 退出码 2 的意思是「还在跑」,而 agent 运行时把任何非零退出码都记成
 * `isError`(Codex 见 `json-event-stream.ts`:`exit_code !== 0`)。于是一张慢图的流水是:
 * generate 过 25 秒交棒 → wait 等满 120 秒退出 2 → 执行记录里一行红的「失败」→ 图出来了。
 *
 * 这里钉住的是:生成还在进行时界面说「进行中」,只有真正到终态的失败才说失败。
 */
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent, ProjectMediaTask } from '@openpixo/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell, ImageRow, ShellItem, ToolRow } from '../../../src/runtime/chat/contract';
import { collectTurnAssets } from '../../../src/runtime/chat/turn-assets';
import { activityForTool } from '../../../src/runtime/chat/run-status';

const use = (id: string, command: string, startedAt = 100): PersistedAgentEvent =>
  ({ kind: 'tool_use', id, name: 'Bash', input: { command }, startedAt } as PersistedAgentEvent);
const result = (toolUseId: string, content: string, isError = false): PersistedAgentEvent =>
  ({ kind: 'tool_result', toolUseId, content, isError } as PersistedAgentEvent);

const GENERATE = '"$PIXO_NODE_BIN" "$PIXO_BIN" media generate --surface image --model codex-image --output assets/hero.png --prompt hero';
const wait = (since = 0) => `"$PIXO_NODE_BIN" "$PIXO_BIN" media wait t1 --since ${since}`;
/** 真实的交棒输出:stdout 一行 JSON + stderr 的提示,运行时把两路合在一起给我们 */
const HANDOFF = 'task t1 queued (queued)\n{"taskId":"t1","status":"running","nextSince":3,"elapsed":25}\n'
  + 'task t1 still running after 25s. Run `"$PIXO_NODE_BIN" "$PIXO_BIN" media wait t1 --since 3` to continue in an agent runtime '
  + '(This is a successful queued/running handoff, not a failure.).';
const STILL_RUNNING = '{"taskId":"t1","status":"running","nextSince":9,"elapsed":120}\n'
  + 'task t1 still running after 120s. Run `"$PIXO_NODE_BIN" "$PIXO_BIN" media wait t1 --since 9` to continue in an agent runtime '
  + '(exit code 2 = still running.).';
const DONE = '{"file":{"name":"assets/hero.png","size":100}}';
const FAILED = 'task failed: provider refused\n{"taskId":"t1","status":"failed","error":{"message":"provider refused","nextStep":"retry-later"}}';

const task = (over: Partial<ProjectMediaTask> = {}): ProjectMediaTask => ({
  taskId: 't1', runId: 'run', surface: 'image', status: 'running', startedAt: 100, endedAt: null,
  elapsed: 0, progress: [], progressCount: 0, ...over,
});

function flatten(items: readonly ShellItem[]): ShellItem[] {
  return items.flatMap((item) => (item.kind === 'todo' ? flatten(item.segment.items) : [item]));
}
function rows(events: PersistedAgentEvent[], extra: { mediaTasks?: ProjectMediaTask[]; runStatus?: 'running' | 'succeeded' } = {}) {
  const blocks = buildTurnBlocks({ events, runStatus: extra.runStatus ?? 'running', ...(extra.mediaTasks ? { mediaTasks: extra.mediaTasks } : {}) });
  const items = blocks.filter((b): b is ExecutionShell => b.kind === 'shell').flatMap((shell) => flatten(shell.items));
  return {
    blocks,
    images: items.filter((i): i is ImageRow => i.kind === 'image'),
    tools: items.filter((i): i is ToolRow => i.kind === 'tool'),
  };
}
const scope = { projectId: 'p1', projectResolvedDir: '/work/knight', projectFileNames: new Set<string>() };

describe('一张慢图:`media wait` 退出 2 不是失败', () => {
  it('有媒体任务时:整段只有一行进行中的生图行,没有一行是红的', () => {
    const { images, tools } = rows([
      use('g', GENERATE), result('g', HANDOFF),
      use('w1', wait(3)), result('w1', STILL_RUNNING, true),
      use('w2', wait(9)),
    ], { mediaTasks: [task()] });
    expect(tools.filter((row) => row.failed)).toEqual([]);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ total: 1, done: 0, failed: 0, pending: true });
    expect(images[0]!.cells).toEqual([{ taskId: 't1', status: 'pending' }]);
  });

  it('`media wait` 是管线,不单独落行 —— 用户看的是那一行生图', () => {
    const { tools } = rows([
      use('g', GENERATE), result('g', HANDOFF),
      use('w1', wait(3)), result('w1', STILL_RUNNING, true),
      use('w2', wait(9)), result('w2', DONE),
    ], { mediaTasks: [task({ status: 'done', file: { name: 'assets/hero.png' } as ProjectMediaTask['file'] })], runStatus: 'succeeded' });
    expect(tools).toEqual([]);
  });

  it('图出来之后:生图行完成,缩略图出现', () => {
    const { blocks, images } = rows([
      use('g', GENERATE), result('g', HANDOFF),
      use('w1', wait(3)), result('w1', STILL_RUNNING, true),
      use('w2', wait(9)), result('w2', DONE),
    ], { mediaTasks: [task({ status: 'done', file: { name: 'assets/hero.png' } as ProjectMediaTask['file'] })], runStatus: 'succeeded' });
    expect(images[0]).toMatchObject({ done: 1, failed: 0, pending: false });
    expect(collectTurnAssets(blocks, scope).map((asset) => asset.path)).toEqual(['assets/hero.png']);
  });

  it('真失败:任务到了 failed 终态才说失败', () => {
    const { images } = rows([
      use('g', GENERATE), result('g', HANDOFF),
      use('w1', wait(3)), result('w1', FAILED, true),
    ], { mediaTasks: [task({ status: 'failed' })] });
    expect(images[0]).toMatchObject({ done: 0, failed: 1, pending: false });
  });
});

describe('媒体任务读不到时(还没轮询到 / 重开老会话):读命令输出', () => {
  it('交棒之后还在跑 → 进行中,不是普通命令行', () => {
    const { images, tools } = rows([use('g', GENERATE), result('g', HANDOFF)]);
    expect(tools).toEqual([]);
    expect(images[0]).toMatchObject({ total: 1, done: 0, failed: 0, pending: true });
  });

  it('输出里带「failed / error」字样的进度行,不把还在跑的任务判成失败', () => {
    const { images } = rows([use('g', GENERATE), result('g', `# retrying after upstream error\n${HANDOFF}`)]);
    expect(images[0]).toMatchObject({ failed: 0, pending: true });
  });

  it('等到了图 → 完成,而且图进缩略图', () => {
    const { blocks, images } = rows([
      use('g', GENERATE), result('g', HANDOFF),
      use('w1', wait(3)), result('w1', STILL_RUNNING, true),
      use('w2', wait(9)), result('w2', DONE),
    ], { runStatus: 'succeeded' });
    expect(images[0]).toMatchObject({ total: 1, done: 1, failed: 0, pending: false, thumbs: ['assets/hero.png'] });
    expect(collectTurnAssets(blocks, scope).map((asset) => asset.path)).toEqual(['assets/hero.png']);
  });

  it('等到了失败 → 失败', () => {
    const { images } = rows([
      use('g', GENERATE), result('g', HANDOFF),
      use('w1', wait(3)), result('w1', FAILED, true),
    ]);
    expect(images[0]).toMatchObject({ total: 1, done: 0, failed: 1, pending: false });
  });

  it('同一条命令里自己循环等:退出 2 收尾也是还在跑,不是失败', () => {
    const { images } = rows([use('g', `${GENERATE}; ${wait(3)}`), result('g', `${HANDOFF}\n${STILL_RUNNING}`, true)]);
    expect(images[0]).toMatchObject({ failed: 0, pending: true });
  });

  it('轮次结束了也没等到结局:不画一颗转不停的格子,也不说失败', () => {
    const { images, tools } = rows([use('g', GENERATE), result('g', HANDOFF)], { runStatus: 'succeeded' });
    expect(images).toEqual([]);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.failed).toBe(false);
  });
});

describe('这一轮之外的任务:行还在,但退出 2 不画红', () => {
  it('上一轮交棒、这一轮接着等', () => {
    const { tools } = rows([use('w', wait(3)), result('w', STILL_RUNNING, true)]);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.failed).toBe(false);
  });

  it('真失败照样是红的', () => {
    const { tools } = rows([use('w', wait(3)), result('w', FAILED, true)]);
    expect(tools[0]!.failed).toBe(true);
  });

  it('输出被打码、读不出状态时,媒体任务说还在跑就不算失败', () => {
    const { tools } = rows([use('w', wait(3)), result('w', '[REDACTED:output]', true)], { mediaTasks: [task({ startedAt: 50 })] });
    expect(tools.filter((row) => row.failed)).toEqual([]);
  });
});

describe('各家运行时写命令的样子', () => {
  it.each([
    ['Codex 包的 PowerShell', `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command '& $env:PIXO_NODE_BIN $env:PIXO_BIN media wait t1 --since 3'`],
    ['Bash 变量', '"$PIXO_NODE_BIN" "$PIXO_BIN" media wait t1 --since 3'],
    ['装好的命令', 'pixo media wait t1'],
    ['展开后的绝对路径', '"C:\\node\\node.exe" "C:\\app\\apps\\daemon\\dist\\cli.js" media wait t1 --since 3'],
  ])('%s', (_label, command) => {
    const { images, tools } = rows([
      use('g', GENERATE), result('g', HANDOFF),
      use('w', command), result('w', STILL_RUNNING, true),
    ], { mediaTasks: [task()] });
    expect(tools).toEqual([]);
    expect(images[0]).toMatchObject({ failed: 0, pending: true });
  });
});

describe('别的命令不沾光', () => {
  it('只是提到 media wait 的命令,失败照旧', () => {
    const { tools } = rows([use('s', 'grep "media wait" notes.md'), result('s', 'grep: notes.md: not found', true)]);
    expect(tools[0]!.failed).toBe(true);
  });

  it('`media wait --help` 是查用法', () => {
    const { tools } = rows([use('h', '"$PIXO_BIN" media wait --help'), result('h', 'usage: pixo media wait')]);
    expect(tools).toHaveLength(1);
  });
});

describe('agent 自己重试成功:失败只是过程', () => {
  const failedTask = task({ taskId: 'm1', status: 'failed', startedAt: 100, endedAt: 200 });
  const doneTask = task({ taskId: 'm2', status: 'done', startedAt: 300, endedAt: 400, file: { name: 'assets/hero.png' } as ProjectMediaTask['file'] });
  const failure = '{"taskId":"m1","status":"failed","error":{"nextStep":"retry-later"}}';

  it('原样重跑(retry-later)成功:那一行是成功的,图还在', () => {
    const { blocks, images } = rows([
      use('g1', GENERATE), result('g1', failure, true),
      use('g2', GENERATE), result('g2', DONE),
    ], { mediaTasks: [failedTask, doneTask], runStatus: 'succeeded' });
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ total: 1, done: 1, failed: 0, pending: false });
    expect(collectTurnAssets(blocks, scope).map((asset) => asset.path)).toEqual(['assets/hero.png']);
  });

  it('换模型(switch-model)写同一个文件成功:同样不留红格', () => {
    const other = GENERATE.replace('codex-image', 'gpt-image-2');
    const { images } = rows([
      use('g1', GENERATE), result('g1', failure, true),
      use('g2', other), result('g2', DONE),
    ], { mediaTasks: [failedTask, doneTask], runStatus: 'succeeded' });
    expect(images[0]).toMatchObject({ total: 1, done: 1, failed: 0, pending: false });
  });

  it('慢图先交棒、等到失败、再重试成功:同样不留红格', () => {
    const { images, tools } = rows([
      use('g1', GENERATE), result('g1', HANDOFF.replaceAll('t1', 'm1')),
      use('w1', wait(3).replace('t1', 'm1')), result('w1', failure, true),
      use('g2', GENERATE), result('g2', DONE),
    ], { mediaTasks: [failedTask, doneTask], runStatus: 'succeeded' });
    expect(tools).toEqual([]);
    expect(images[0]).toMatchObject({ total: 1, done: 1, failed: 0, pending: false });
  });

  it('重试还在跑:只显示进行中,不先摆一格失败', () => {
    const { images } = rows([
      use('g1', GENERATE), result('g1', failure, true),
      use('g2', GENERATE),
    ], { mediaTasks: [failedTask, task({ taskId: 'm2', startedAt: 300 })] });
    expect(images[0]).toMatchObject({ total: 1, done: 0, failed: 0, pending: true });
  });

  it('重试也失败:失败是真的,两格都在', () => {
    const { images } = rows([
      use('g1', GENERATE), result('g1', failure, true),
      use('g2', GENERATE), result('g2', failure.replace('m1', 'm2'), true),
    ], { mediaTasks: [failedTask, task({ taskId: 'm2', status: 'failed', startedAt: 300, endedAt: 400 })], runStatus: 'succeeded' });
    expect(images[0]).toMatchObject({ total: 2, done: 0, failed: 2, pending: false });
  });

  it('换了输出文件就是另一张图:前一张的失败要留着', () => {
    const { images } = rows([
      use('g1', GENERATE), result('g1', failure, true),
      use('g2', GENERATE.replace('hero.png', 'villain.png')), result('g2', DONE),
    ], { mediaTasks: [failedTask, doneTask], runStatus: 'succeeded' });
    expect(images[0]).toMatchObject({ total: 2, done: 1, failed: 1 });
  });
});

describe('状态行', () => {
  it('在 `media wait` 上等着的时候,说的是正在生成', () => {
    expect(activityForTool('Bash', { command: wait(3) })).toBe('generating');
  });
});
