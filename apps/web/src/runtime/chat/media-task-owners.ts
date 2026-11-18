/**
 * 这一轮的每条媒体任务是**哪一次调用**做出来的。纯函数,无 DOM。
 *
 * daemon 只知道任务属于哪一轮(`runId`),不知道是哪一次工具调用发的。原来前端只有一条
 * 规矩:按顺序把任务分给命令里写着 `media generate` 的调用(游标)。agent 自己写批量
 * 脚本时(`node scripts/generate-stage-two.mjs a b c …`,脚本里再去调 `pixo media
 * generate`),事件里一次 `media generate` 都没有 —— 那几十条任务没有主人,只剩轮询兜底
 * 那一行,而那一行把每一格都画成「生成中」;游标还会把脚本的任务分给后面一次直接调用。
 * 真机(B6,2026-11-19):「生成配套插图 0/33」33 格全在转,daemon 早已报了几十张 done。
 *
 * 所以这里按证据分,证据强的先说话:
 *
 *  ① **输出里点了名**:调用的输出(结算的结果,或还在跑时的那一段)里出现了任务 id,
 *     或者出现了已完成任务的文件路径。`pixo media generate` 一开头就在 stderr 打
 *     `task <id> queued`,交棒行里也带 `taskId`,所以直接调用和转打输出的脚本都有这条证据。
 *     还要求任务**在这次调用活着的时候**创建 —— 事后 `pixo media wait <id>`、列任务、
 *     `git status` 里出现同一个 id 或路径,都不是创建它的人。
 *  ② **游标**:命令里写着 `media generate`、自己的输出还没点名任何任务时,照旧按顺序从
 *     这一类的队列里取(`takeMediaBatch`)。只取没被别人点名、而且不早于这次调用开始的任务。
 *  ③ **只有它在跑**:剩下的任务,创建时刻落在**恰好一次**命令调用的生命周期里,就归它。
 *     输出看不见的脚本(只在结束时才有输出的运行时,或输出被截在前 2000 字之后)靠这一条。
 *     两次以上的调用同时在跑就不猜:那条任务进兜底行,不拿一次调用的名义说另一次的图。
 *
 * 剩下没有主人的任务由调用方画进兜底行,状态照实画。
 */
import type { MediaSurface, PersistedAgentEvent, ProjectMediaTask } from '@openpixo/contracts';
import { IN_FLIGHT_TOOL_OUTPUT_KEY } from '../tool-events';
import { isHostPlumbing, isMediaGenerateCommand, mediaWaitCall } from './host-calls';
import { commandOf, isCommandTool } from './tool-kind';

type ToolUse = Extract<PersistedAgentEvent, { kind: 'tool_use' }>;
type ToolResult = Extract<PersistedAgentEvent, { kind: 'tool_result' }>;

/** 一条命令里写了几次 `media generate`(查用法的不算,由 `isMediaGenerateCommand` 先拦) */
export function mediaGenerateCount(command: string): number {
  return (command.match(/media\s+generate/g) ?? []).length;
}

/**
 * 这一批生成的是哪一类媒体(OPEND-2625)—— **两个证人,按可信度排队**。
 *
 * 1. `task.surface`:daemon 亲自落盘的那一格(`media_tasks`),
 *    `/api/projects/:id/media/tasks` 逐字回传。这是唯一权威 —— 它说的是这次生成
 *    **实际**打给了哪条渲染路。
 * 2. 命令行上的 `--surface`:任务还没轮询到时的第二证人。这个 flag 是**必填**的
 *    (CLI 拒收缺失或非法值),所以一次真正的 `pixo media generate` 一定带着它。
 *
 * 两个都没有才落到 `'image'`。走到这里意味着命令既是 `media generate` 又没有
 * `--surface`,那样的命令 CLI 根本不会执行 —— 留一个确定值只是为了不让类型多出一档
 * `null` 传染到渲染层。
 *
 * ⚠️ **不许从文件后缀反推**:进行中的格子还没有文件,而进行中恰恰是用户最需要
 * 知道「在生成什么」的那一档。
 */
const MEDIA_SURFACE_FLAG_RE = /--surface[=\s]+(image|video|audio|model3d)\b/;

export function readMediaSurface(tasks: readonly ProjectMediaTask[], command: string): MediaSurface {
  for (const task of tasks) {
    const declared = task.surface;
    if (declared === 'image' || declared === 'video' || declared === 'audio' || declared === 'model3d') return declared;
  }
  const flagged = MEDIA_SURFACE_FLAG_RE.exec(command)?.[1];
  if (flagged === 'image' || flagged === 'video' || flagged === 'audio' || flagged === 'model3d') return flagged;
  return 'image';
}

/**
 * 这次调用按游标取走哪几条任务(从 `available` 的开头取)。
 *
 * 有 `batchId` 时**批就是边界**:一次「生成配套插图」在 daemon 那边已经分好组了,
 * 前端再拿命令行里数出来的次数去切,只会把同一批切成两半(命令写一次 `--count 3`
 * 就是最常见的一种)。没有 `batchId` 才退回按次数切 —— 那是没分组的生产方。
 */
export function takeMediaBatch(available: readonly ProjectMediaTask[], count: number): ProjectMediaTask[] {
  if (count <= 0) return [];
  const first = available[0];
  if (!first) return [];
  const batchId = first.batchId;
  if (batchId == null) return available.slice(0, count);
  let end = 0;
  while (end < available.length && available[end]?.batchId === batchId) end += 1;
  return available.slice(0, end);
}

export interface MediaTaskOwners {
  /** 每次调用(`tool_use.id`)名下的任务,按创建顺序 */
  byCall: Map<string, ProjectMediaTask[]>;
  /** 证明不了是谁做的任务,按创建顺序 */
  unowned: ProjectMediaTask[];
}

interface CommandCall {
  id: string;
  generateCount: number;
  surface: MediaSurface;
  output: string;
  startedAt: number | null;
  /** `null`:还没回来,或者回来了但没带时刻 —— 都当作还开着 */
  endedAt: number | null;
  /**
   * 三条证据各自对它开不开。`media wait` 与管线调用一条都不开:它们只是在等别人的任务。
   * 被重试盖过的生成调用不落行,但它的任务已经用掉了 —— 点名和游标照样从它这里走过,
   * 免得那条失败的任务被后一次取走;「只有它在跑」不开,它不该再收别人的图。
   * 被重试盖过的别的调用一条都不开:它不落行,它名下的图就没处画了。
   */
  byEvidence: boolean;
  byCursor: boolean;
  byRunning: boolean;
}

/**
 * `queues` 是按 surface 分好、按创建顺序排好的任务(调用方的分桶,见 `buildTurnBlocks`)。
 * `retried` 是不落行的失败调用(`supersededRetryIds`)。
 */
export function assignMediaTaskOwners(
  events: readonly PersistedAgentEvent[],
  results: ReadonlyMap<string, ToolResult>,
  retried: ReadonlySet<string>,
  queues: ReadonlyMap<MediaSurface, readonly ProjectMediaTask[]>,
): MediaTaskOwners {
  const tasks = [...queues.values()].flat();
  const owner = new Map<string, string>();
  const byCall = new Map<string, ProjectMediaTask[]>();
  const give = (task: ProjectMediaTask, callId: string): void => {
    owner.set(task.taskId, callId);
    const owned = byCall.get(callId);
    if (owned) owned.push(task);
    else byCall.set(callId, [task]);
  };
  if (tasks.length === 0) return { byCall, unowned: [] };

  const calls = commandCalls(events, results, retried);

  // ① 输出里点了名。一条任务只认第一次点名它、又在它创建时活着的那次调用。
  for (const call of calls) {
    if (!call.byEvidence || !call.output) continue;
    const candidates = tasks.filter((task) => !owner.has(task.taskId) && aliveAt(call, task.startedAt));
    if (candidates.length === 0) continue;
    const text = forwardSlashes(call.output);
    for (const task of candidates) if (mentions(text, task)) give(task, call.id);
  }

  // ② 游标:写着 `media generate`、自己的输出还没点名任何任务的调用
  for (const call of calls) {
    if (call.generateCount === 0 || !call.byCursor || byCall.has(call.id)) continue;
    const queue = queues.get(call.surface) ?? [];
    const available = queue.filter((task) => !owner.has(task.taskId) && aliveAt(call, task.startedAt, true));
    for (const task of takeMediaBatch(available, call.generateCount)) give(task, call.id);
  }

  /*
   * ③ 只有它在跑。一次 `pixo media generate` 只建一条任务,已经拿够的生成调用让给
   * 同时在跑的别的调用;只剩它自己时才收(`for … do pixo media generate; done` 一条命令出 N 张)。
   */
  for (const task of tasks) {
    if (owner.has(task.taskId)) continue;
    let running = calls.filter((call) => call.byRunning && call.startedAt != null && aliveAt(call, task.startedAt));
    if (running.length > 1) {
      running = running.filter((call) => call.generateCount === 0 || (byCall.get(call.id)?.length ?? 0) < call.generateCount);
    }
    if (running.length === 1) give(task, running[0]!.id);
  }

  for (const owned of byCall.values()) owned.sort(byCreation);
  const unowned = tasks.filter((task) => !owner.has(task.taskId)).sort(byCreation);
  return { byCall, unowned };
}

function commandCalls(
  events: readonly PersistedAgentEvent[],
  results: ReadonlyMap<string, ToolResult>,
  retried: ReadonlySet<string>,
): CommandCall[] {
  const calls: CommandCall[] = [];
  for (const event of events) {
    if (event.kind !== 'tool_use' || !isCommandTool(event.name)) continue;
    const command = commandOf(event.input);
    if (!command) continue;
    const result = results.get(event.id);
    const generateCount = isMediaGenerateCommand(command) ? mediaGenerateCount(command) : 0;
    const plumbing = isHostPlumbing(command) || mediaWaitCall(command) != null;
    const superseded = retried.has(event.id);
    calls.push({
      id: event.id,
      generateCount,
      surface: readMediaSurface([], command),
      output: result?.content ?? inFlightOutput(event) ?? '',
      startedAt: typeof event.startedAt === 'number' ? event.startedAt : null,
      endedAt: typeof result?.completedAt === 'number' ? result.completedAt : null,
      byEvidence: !plumbing && (!superseded || generateCount > 0),
      byCursor: !plumbing && generateCount > 0,
      byRunning: !plumbing && !superseded,
    });
  }
  return calls;
}

/**
 * 这次调用在 `at` 那一刻活着吗。没有起点就不知道 —— 点名(①)和游标(②)照旧放行,
 * 那是事件不带时刻的老数据;「只有它在跑」(③)由调用方另外要求有起点。
 *
 * 游标(`open` 为真)只看起点:一条早于这次调用开始的任务不可能是它发的;终点不拦,
 * 因为没有输出的生成调用(结果被打码)本来就靠游标认领它的任务。
 */
function aliveAt(call: CommandCall, at: number, open = false): boolean {
  if (call.startedAt != null && at < call.startedAt) return false;
  if (!open && call.endedAt != null && at > call.endedAt) return false;
  return true;
}

/** 路径一律按 `/` 比:Windows 上的输出(含 JSON 里转义过的 `\\`)也认得出同一个文件 */
function forwardSlashes(text: string): string {
  return text.includes('\\') ? text.replace(/\\\\/g, '/').replace(/\\/g, '/') : text;
}

/**
 * 输出(已经过 `forwardSlashes`)里点了这条任务的名:任务 id,或者已完成任务的文件路径。
 * 路径只认整段:`quick.png` 不命中 `public/cards/quick.png`、`xquick.png`、`quick.png.bak`。
 */
function mentions(text: string, task: ProjectMediaTask): boolean {
  if (task.taskId && text.includes(task.taskId)) return true;
  if (task.status !== 'done') return false;
  const name = forwardSlashes(task.file?.name?.trim() ?? '');
  if (!name) return false;
  const edge = /[\w./-]/;
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    const before = at === 0 ? '' : text[at - 1]!;
    const after = text[at + name.length] ?? '';
    if (!edge.test(before) && !edge.test(after)) return true;
  }
  return false;
}

function inFlightOutput(event: ToolUse): string | null {
  const input = event.input;
  if (typeof input !== 'object' || input === null) return null;
  const value = (input as Record<string, unknown>)[IN_FLIGHT_TOOL_OUTPUT_KEY];
  return typeof value === 'string' && value ? value : null;
}

function byCreation(a: ProjectMediaTask, b: ProjectMediaTask): number {
  return (a.startedAt - b.startedAt) || ((a.sequence ?? 0) - (b.sequence ?? 0));
}
