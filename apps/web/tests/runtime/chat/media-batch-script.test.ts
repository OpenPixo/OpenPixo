/**
 * B6(真机 2026-11-19):agent 自己写批量脚本生图,聊天里的进度一张都不动。
 *
 * Codex 写了 `scripts/generate-stage-two.mjs`,每个任务调一次 `generate-stage-one.mjs`,
 * 后者再去跑 `pixo media generate … --output <file>`,交棒后循环 `pixo media wait`。
 * agent 跑的是 `& $env:PIXO_NODE_BIN scripts/generate-stage-two.mjs a b c …`,有时两条并行。
 * 聊天里:「生成配套插图 0/33」33 格全是「配图生成中」,daemon 早已报了几十张 done;
 * 串行的那一段每一步只有「· 1 张」,做完的图一张不显示,直到轮末快照。
 *
 * 下面的命令、输出和任务 id 逐字取自那一轮的事件(`b6-events-sample.jsonl`)。
 */
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent, ProjectMediaTask } from '@openpixo/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { BuildTurnInput, ExecutionShell, ImageRow, ShellItem } from '../../../src/runtime/chat/contract';
import { assignMediaTaskOwners } from '../../../src/runtime/chat/media-task-owners';
import { collectTurnAssets } from '../../../src/runtime/chat/turn-assets';
import { IN_FLIGHT_TOOL_INPUT_MARKER, IN_FLIGHT_TOOL_OUTPUT_KEY } from '../../../src/runtime/tool-events';

const POWERSHELL = String.raw`"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command`;
const PRISONER_CMD = `${POWERSHELL} '& $env:PIXO_NODE_BIN scripts/generate-stage-two.mjs prisoner-design prisoner-idle prisoner-attack prisoner-hurt prisoner-death arbalist-design arbalist-idle arbalist-attack arbalist-hurt arbalist-death'`;
const GRAVEDIGGER_CMD = `${POWERSHELL} '& $env:PIXO_NODE_BIN scripts/generate-stage-two.mjs gravedigger-design gravedigger-idle gravedigger-attack gravedigger-hurt gravedigger-death monk-design monk-idle monk-attack monk-hurt monk-death'`;
const DIRECT_CMD = `${POWERSHELL} '& $env:PIXO_NODE_BIN $env:PIXO_BIN media generate --project $env:PIXO_PROJECT_ID --surface image --model codex-image --image concept/style-1.png --image public/characters/ash-wraith/design.png --output public/characters/ash-wraith/attack-v2-sheet.png --size 384x512 --transparent --sheet 2x2 --frames --prompt-file art/prompts/ash-wraith-attack-v2.txt --json'`;

const P0 = 1795041797971; // prisoner 脚本开工
const G0 = 1795041808677; // gravedigger 脚本开工(prisoner 还在跑)

const PRISONER_DESIGN = '18685472-21a6-4acb-ae1a-eb4186e1e367';
const GRAVEDIGGER_DESIGN = '11e87211-edde-46b4-95ca-891cdfb19b25';

const lines = (...rows: unknown[]): string => rows.map((row) => `${JSON.stringify(row)}\n`).join('');
const finished = (task: string, name: string) => ({
  task,
  file: { name, width: 384, height: 512, size: 235087, transparent: true, note: 'rendered 1086x1448, resized to 384x512.', warnings: [], provider: 'codex-cli', model: 'codex-image' },
});

/** 一条还在跑的命令,形状与 `providers/daemon.ts` 翻译 `tool_in_flight` 之后一致 */
const inFlight = (id: string, command: string, startedAt: number, output: string): PersistedAgentEvent => ({
  kind: 'tool_use',
  id,
  name: 'Bash',
  input: { command, [IN_FLIGHT_TOOL_OUTPUT_KEY]: output, [IN_FLIGHT_TOOL_INPUT_MARKER]: true },
  startedAt,
} as PersistedAgentEvent);

const settled = (id: string, command: string, startedAt: number, content: string, completedAt: number): PersistedAgentEvent[] => [
  { kind: 'tool_use', id, name: 'Bash', input: { command }, startedAt } as PersistedAgentEvent,
  { kind: 'tool_result', toolUseId: id, content, isError: false, completedAt } as PersistedAgentEvent,
];

const task = (over: Partial<ProjectMediaTask> & { taskId: string; startedAt: number }): ProjectMediaTask => ({
  runId: 'run',
  surface: 'image',
  status: 'running',
  endedAt: null,
  elapsed: 0,
  progress: [],
  progressCount: 0,
  ...over,
});
const doneTask = (taskId: string, startedAt: number, endedAt: number, name: string, over: Partial<ProjectMediaTask> = {}) =>
  task({ taskId, startedAt, endedAt, status: 'done', file: { name }, ...over });

function imageRows(input: BuildTurnInput): ImageRow[] {
  const out: ImageRow[] = [];
  const visit = (items: readonly ShellItem[]) => {
    for (const item of items) {
      if (item.kind === 'image') out.push(item);
      else if (item.kind === 'todo') visit(item.segment.items);
    }
  };
  for (const block of buildTurnBlocks(input)) if (block.kind === 'shell') visit((block as ExecutionShell).items);
  return out;
}
const cellsOf = (rows: readonly ImageRow[]) => rows.flatMap((row) => row.cells ?? []);
const galleryOf = (input: BuildTurnInput) => collectTurnAssets(buildTurnBlocks(input)).map((asset) => asset.path);

/** 真机 stage 2:两个脚本并行,daemon 把重叠的任务分进同一批 */
function parallelScripts(): BuildTurnInput {
  const batch = (index: number) => ({ batchId: PRISONER_DESIGN, batchIndex: index, batchSize: 4, sequence: index });
  return {
    events: [
      inFlight('exec-1138c0c0', PRISONER_CMD, P0, lines(
        { progress: 1, total: 10, task: 'prisoner-design' },
        { task: 'prisoner-design', output: 'public/characters/prisoner/design.png', status: 'starting', parentPid: 53692 },
        { taskId: PRISONER_DESIGN, status: 'running', nextSince: 1, elapsed: 25 },
        finished('prisoner-design', 'public/characters/prisoner/design.png'),
        { progress: 2, total: 10, task: 'prisoner-idle' },
        { task: 'prisoner-idle', output: 'public/characters/prisoner/idle-sheet.png', status: 'starting', parentPid: 53692 },
      )),
      inFlight('exec-2354eb84', GRAVEDIGGER_CMD, G0, lines(
        { progress: 1, total: 10, task: 'gravedigger-design' },
        { task: 'gravedigger-design', output: 'public/characters/gravedigger/design.png', status: 'starting', parentPid: 52716 },
        { taskId: GRAVEDIGGER_DESIGN, status: 'running', nextSince: 1, elapsed: 25 },
        finished('gravedigger-design', 'public/characters/gravedigger/design.png'),
        { progress: 2, total: 10, task: 'gravedigger-idle' },
        { task: 'gravedigger-idle', output: 'public/characters/gravedigger/idle-sheet.png', status: 'starting', parentPid: 52716 },
      )),
    ],
    mediaTasks: [
      doneTask(PRISONER_DESIGN, P0 + 1_600, P0 + 77_000, 'public/characters/prisoner/design.png', batch(1)),
      doneTask(GRAVEDIGGER_DESIGN, G0 + 1_600, G0 + 77_000, 'public/characters/gravedigger/design.png', batch(2)),
      task({ taskId: 'prisoner-idle-task', startedAt: P0 + 78_000, ...batch(3) }),
      task({ taskId: 'gravedigger-idle-task', startedAt: G0 + 78_000, ...batch(4) }),
    ],
    runStatus: 'running',
    nowMs: G0 + 80_000,
  };
}

describe('B6 · 批量脚本生图:做完的就是做完了', () => {
  it('两个脚本并行:daemon 报 done 的格子是 done,不是「生成中」', () => {
    const cells = cellsOf(imageRows(parallelScripts()));
    const byTask = new Map(cells.map((cell) => [cell.taskId, cell.status]));
    expect(byTask.get(PRISONER_DESIGN)).toBe('done');
    expect(byTask.get(GRAVEDIGGER_DESIGN)).toBe('done');
    expect(byTask.get('prisoner-idle-task')).toBe('pending');
    expect(byTask.get('gravedigger-idle-task')).toBe('pending');
  });

  it('两个脚本并行:格子数就是任务数,一条任务只出一格', () => {
    const rows = imageRows(parallelScripts());
    expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(4);
    expect(rows.reduce((sum, row) => sum + row.done, 0)).toBe(2);
    expect(cellsOf(rows).map((cell) => cell.taskId).sort()).toEqual(
      [GRAVEDIGGER_DESIGN, PRISONER_DESIGN, 'gravedigger-idle-task', 'prisoner-idle-task'].sort(),
    );
  });

  it('两个脚本并行:做完的图在这一轮还在跑时就进消息里那排图', () => {
    expect(galleryOf(parallelScripts()).sort()).toEqual([
      'public/characters/gravedigger/design.png',
      'public/characters/prisoner/design.png',
    ]);
  });

  it('脚本输出点了名的任务记在那个脚本名下', () => {
    const rows = imageRows(parallelScripts());
    const rowOf = (taskId: string) => rows.find((row) => row.cells?.some((cell) => cell.taskId === taskId));
    expect(rowOf(PRISONER_DESIGN)).not.toBe(rowOf(GRAVEDIGGER_DESIGN));
  });

  it('一个脚本串行跑(stage 1):每张做完就亮,总数是真的', () => {
    /*
     * 进行中的输出只带前 2000 个字(`COMMAND_OUTPUT_LIMIT`),后面几张的 taskId 看不见;
     * 但这时只有这一条命令在跑,它们只能是它做的。串行时每条任务自成一批(batchSize 1)。
     */
    const S0 = 1795041565514;
    const input: BuildTurnInput = {
      events: [
        inFlight('exec-182bc7ec', `${POWERSHELL} '& $env:PIXO_NODE_BIN scripts/generate-stage-two.mjs'`, S0, lines(
          { progress: 1, total: 59, task: 'ash-wraith-design' },
          { task: 'ash-wraith-attack', output: 'public/characters/ash-wraith/attack-sheet.png', status: 'starting' },
          { taskId: '9d810c2d-45d8-42c8-b761-7ccd703df5c0', status: 'running', nextSince: 1, elapsed: 25 },
        )),
      ],
      mediaTasks: [
        doneTask('9d810c2d-45d8-42c8-b761-7ccd703df5c0', S0 + 3_300, S0 + 96_000, 'public/characters/ash-wraith/attack-sheet.png', { batchId: '9d810c2d-45d8-42c8-b761-7ccd703df5c0', batchIndex: 1, batchSize: 1, sequence: 1 }),
        doneTask('35cc565d-c19e-4632-83db-2f1b0dff17f2', S0 + 97_000, S0 + 189_000, 'public/characters/ash-wraith/hurt-sheet.png', { batchId: '35cc565d-c19e-4632-83db-2f1b0dff17f2', batchIndex: 1, batchSize: 1, sequence: 2 }),
        task({ taskId: 'death-task', startedAt: S0 + 190_000, batchId: 'death-task', batchIndex: 1, batchSize: 1, sequence: 3 }),
      ],
      runStatus: 'running',
      nowMs: S0 + 200_000,
    };
    const rows = imageRows(input);
    expect(rows).toHaveLength(1);
    expect([rows[0]!.total, rows[0]!.done, rows[0]!.pending]).toEqual([3, 2, true]);
    expect(rows[0]!.cells?.map((cell) => cell.status)).toEqual(['done', 'done', 'pending']);
    expect(galleryOf(input)).toEqual([
      'public/characters/ash-wraith/attack-sheet.png',
      'public/characters/ash-wraith/hurt-sheet.png',
    ]);
  });

  it('脚本在跑时的一次直接生成,只拿它自己的任务,不拿脚本的', () => {
    const D0 = 1795041896487;
    const input: BuildTurnInput = {
      events: [
        inFlight('exec-8dc69fd1', `${POWERSHELL} '& $env:PIXO_NODE_BIN scripts/generate-stage-two.mjs coffin-knight-design'`, D0 - 77_000, lines(
          { progress: 1, total: 10, task: 'coffin-knight-design' },
        )),
        inFlight('exec-796bb1cf', DIRECT_CMD, D0, 'task 2c9a8726-a45d-4374-8b0e-b06f07dc0a3a queued (running)\n'),
      ],
      mediaTasks: [
        // 脚本那张还没打出 taskId,排在队列最前面 —— 原来的游标就把它分给了直接调用
        task({ taskId: '637a0ede-4507-4ce5-a13e-edd006fd85ab', startedAt: D0 - 76_000, sequence: 1 }),
        task({ taskId: '2c9a8726-a45d-4374-8b0e-b06f07dc0a3a', startedAt: D0 + 1_500, sequence: 2 }),
      ],
      runStatus: 'running',
      nowMs: D0 + 5_000,
    };
    const rows = imageRows(input);
    const direct = rows.find((row) => row.id === 'exec-796bb1cf');
    expect(direct?.cells?.map((cell) => cell.taskId)).toEqual(['2c9a8726-a45d-4374-8b0e-b06f07dc0a3a']);
    expect(cellsOf(rows).filter((cell) => cell.taskId === '637a0ede-4507-4ce5-a13e-edd006fd85ab')).toHaveLength(1);
  });

  it('轮次结束后:两个脚本各自那一行,图都还在', () => {
    const input: BuildTurnInput = {
      events: [
        ...settled('exec-1138c0c0', PRISONER_CMD, P0, lines(
          { taskId: PRISONER_DESIGN, status: 'running', nextSince: 1, elapsed: 25 },
          finished('prisoner-design', 'public/characters/prisoner/design.png'),
          finished('prisoner-idle', 'public/characters/prisoner/idle-sheet.png'),
        ), P0 + 200_000),
        ...settled('exec-2354eb84', GRAVEDIGGER_CMD, G0, lines(
          { taskId: GRAVEDIGGER_DESIGN, status: 'running', nextSince: 1, elapsed: 25 },
          finished('gravedigger-design', 'public/characters/gravedigger/design.png'),
          finished('gravedigger-idle', 'public/characters/gravedigger/idle-sheet.png'),
        ), G0 + 200_000),
      ],
      mediaTasks: [
        doneTask(PRISONER_DESIGN, P0 + 1_600, P0 + 77_000, 'public/characters/prisoner/design.png', { sequence: 1 }),
        doneTask(GRAVEDIGGER_DESIGN, G0 + 1_600, G0 + 77_000, 'public/characters/gravedigger/design.png', { sequence: 2 }),
        doneTask('prisoner-idle-task', P0 + 78_000, P0 + 150_000, 'public/characters/prisoner/idle-sheet.png', { sequence: 3 }),
        doneTask('gravedigger-idle-task', G0 + 78_000, G0 + 150_000, 'public/characters/gravedigger/idle-sheet.png', { sequence: 4 }),
      ],
      runStatus: 'succeeded',
      endedAtMs: G0 + 210_000,
    };
    const rows = imageRows(input);
    expect(rows.map((row) => [row.total, row.done, row.pending])).toEqual([[2, 2, false], [2, 2, false]]);
    expect(rows[0]!.thumbs).toEqual(['public/characters/prisoner/design.png', 'public/characters/prisoner/idle-sheet.png']);
    expect(galleryOf(input)).toHaveLength(4);
  });
});

describe('assignMediaTaskOwners · 谁做的这张图', () => {
  const owners = (events: PersistedAgentEvent[], tasks: ProjectMediaTask[]) => {
    const results = new Map<string, Extract<PersistedAgentEvent, { kind: 'tool_result' }>>();
    for (const e of events) if (e.kind === 'tool_result') results.set(e.toolUseId, e);
    const { byCall, unowned } = assignMediaTaskOwners(events, results, new Set(), new Map([['image', tasks]]));
    return {
      of: (callId: string) => (byCall.get(callId) ?? []).map((t) => t.taskId),
      unowned: unowned.map((t) => t.taskId),
    };
  };

  it('事后等它、提到它的 `media wait` 不是它的主人', () => {
    const { of } = owners([
      ...settled('s', `${POWERSHELL} 'node scripts/gen.mjs'`, 1_000, '', 9_000),
      ...settled('w', `${POWERSHELL} '& $env:PIXO_NODE_BIN $env:PIXO_BIN media wait t1 --since 1'`, 10_000, lines({ taskId: 't1', file: { name: 'a.png' } }), 20_000),
    ], [doneTask('t1', 2_000, 15_000, 'a.png')]);
    expect(of('s')).toEqual(['t1']);
    expect(of('w')).toEqual([]);
  });

  it('文件路径只认整段:`quick.png` 不认领 `public/cards/quick.png`', () => {
    const { of, unowned } = owners([
      ...settled('a', 'node a.mjs', 1_000, 'wrote public/cards/quick.png\n', 9_000),
      ...settled('b', 'node b.mjs', 1_000, 'nothing here\n', 9_000),
    ], [doneTask('t1', 2_000, 5_000, 'quick.png')]);
    expect(of('a')).toEqual([]);
    expect(unowned).toEqual(['t1']);
  });

  it('两条命令同时在跑、输出又没点名:不猜', () => {
    const { unowned } = owners([
      inFlight('a', 'node a.mjs', 1_000, ''),
      inFlight('b', 'node b.mjs', 2_000, ''),
    ], [task({ taskId: 't1', startedAt: 3_000 })]);
    expect(unowned).toEqual(['t1']);
  });

  it('早于命令开始的任务不是它做的', () => {
    const { of, unowned } = owners([inFlight('a', 'node a.mjs', 5_000, '')], [task({ taskId: 't1', startedAt: 3_000 })]);
    expect(of('a')).toEqual([]);
    expect(unowned).toEqual(['t1']);
  });
});

describe('B6 · 认不出是谁做的任务:兜底那一行也照实画', () => {
  it('轮询先到时,做完的格子是 done,带着它的图', () => {
    const rows = imageRows({
      events: [],
      mediaTasks: [
        doneTask('m1', 100, 400, 'a.png', { batchId: 'b1', batchIndex: 1, batchSize: 2 }),
        task({ taskId: 'm2', startedAt: 200, batchId: 'b1', batchIndex: 2, batchSize: 2, sequence: 2 }),
      ],
      runStatus: 'running',
    });
    expect(rows).toHaveLength(1);
    expect([rows[0]!.total, rows[0]!.done, rows[0]!.pending]).toEqual([2, 1, true]);
    expect(rows[0]!.cells).toEqual([
      { taskId: 'm1', status: 'done', path: 'a.png' },
      { taskId: 'm2', status: 'pending' },
    ]);
    expect(rows[0]!.thumbs).toEqual(['a.png']);
  });
});
