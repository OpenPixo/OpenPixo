/**
 * 输入框上方那一行「现在整体在干什么」—— 判据。纯函数,不碰 DOM。
 *
 * 用户原话:「希望能有一个地方一直展示当前整体在干什么,因为有些小白用户可能看不太懂
 * 整体的运行状态」。执行记录回答的是「做了哪些事」(给愿意展开看的人),Plan 药丸回答
 * 「第几步」,这一行回答**此刻**:一句人话,不带工具名、不带命令。
 *
 * 输出只有结论(`activity` + 几个可选细节),文案由组件按 `activity` 查 i18n。
 *
 * ── 判据的先后(前面的压住后面的)───────────────────────────────────────
 *
 *   1. 轮次已经停了
 *        · 最后一条助手消息里有还没回答的 `<question-form>` → `awaitingAnswer`
 *        · 成功 → `done`;失败 → `failed`;用户停 / 取消 → `stopped`
 *        · 整个会话还一条助手消息都没有 → `idle`
 *   2. 轮次在跑(`streaming` 或 `runStatus` 为 queued / running)
 *        · 等审批(Codex 的执行确认) → `awaitingApproval`
 *        · 断线重连中 → `reconnecting`
 *        · 有调用发出去还没回来 → 按那一次调用归类(见 `activityForTool`);
 *          同时在途的不止一个时,取**最后发出**的那个 —— 那是 agent 最新的动作
 *        · 本轮媒体任务还有没结束的(异步生成:命令早回来了,图还在出) → `generating`
 *        · 都没有:最后一个事件是正文 → `replying`;其余 → `thinking`
 *          (工具结果刚回来、agent 在想下一步,对用户就是「在思考」)
 *        · 一个事件都还没有 → `starting`
 *
 * 当前 todo 不改变 `activity`,只当细节(`step`):「正在编写代码 · 实现跳跃手感」。
 * 优先用 Claude TodoWrite 的 `activeForm`(它本来就是进行时的人话),其次 `content`。
 */
import { isTodoWriteToolName, type ChatRunStatus, type PersistedAgentEvent, type ProjectMediaTask } from '@openpixo/contracts';
import { splitOnQuestionForms } from '../../artifacts/question-form';
import { isMediaGenerateCommand } from './build-turn-blocks';
import { mediaWaitCall } from './host-calls';
import { commandOf, fileOf, isCommandTool, toolKind, unwrapShell } from './tool-kind';

export type RunActivity =
  | 'idle'
  | 'starting'
  | 'thinking'
  | 'planning'
  | 'reading'
  | 'searching'
  | 'browsing'
  | 'coding'
  | 'writing'
  | 'generating'
  | 'installing'
  | 'testing'
  | 'previewing'
  | 'running'
  | 'working'
  | 'replying'
  | 'awaitingAnswer'
  | 'awaitingApproval'
  | 'reconnecting'
  | 'done'
  | 'failed'
  | 'stopped';

/** 这一行用哪种语气:跑着(扫光)/ 要你动手 / 结束了 / 出错了 / 闲着 */
export type RunStatusTone = 'busy' | 'attention' | 'success' | 'error' | 'idle';

export type RunMediaSurface = 'image' | 'audio' | 'video' | 'model3d';

export interface RunStatusLine {
  activity: RunActivity;
  tone: RunStatusTone;
  /** `generating` 时生成的是哪一类媒体 */
  surface?: RunMediaSurface;
  /**
   * `generating` 时这一批的进度。`done` 不知道(只数得出总数)时省略,界面写「共 N 张」;
   * 总数只有 1 时整个省略 —— 「1/1」不提供信息。
   */
  progress?: { done?: number; total: number };
  /** 当前那一步的人话(TodoWrite 的 activeForm / content) */
  step?: string;
}

export interface RunStatusTodo {
  content: string;
  status: string;
  activeForm?: string;
}

export interface RunStatusInput {
  /**
   * 这一轮的助手消息:最后一条用户消息**之后**的最后一条助手消息。用户刚发出、助手消息
   * 还没建出来时给 null —— 不能拿上一轮的消息顶上,否则会把上一轮的事件当成「此刻」。
   */
  latest: {
    runStatus?: ChatRunStatus;
    events?: readonly PersistedAgentEvent[];
  } | null;
  /** 本地流式旗标(刷新后仍在跑的那一路由 `runStatus` 兜住) */
  streaming: boolean;
  /** 最后一条助手消息里有没有还没回答的问题表单 */
  awaitingAnswer?: boolean;
  /** 当前轮次有没有等用户批准的操作 */
  awaitingApproval?: boolean;
  /** 传输层在重连 */
  reconnecting?: boolean;
  /** 这一轮(`latest`)自己的清单 —— agent 本轮没重发就是空的 */
  todos?: readonly RunStatusTodo[];
  /** 这一轮(按 `runId` 归属)的媒体任务 */
  mediaTasks?: readonly ProjectMediaTask[];
}

const isActive = (status: ChatRunStatus | undefined) => status === 'queued' || status === 'running';

/**
 * 会话是不是停在「等你回答」上。
 *
 * 判据:从末尾往前、在碰到下一条用户消息之前,有没有一条助手消息带着**完整的**
 * `<question-form>`。用户的回答本身就是下一条用户消息(`formatFormAnswers` →
 * `POST /api/chat`),所以「后面还没有用户消息」就是「还没答」。往前多看几条,是因为
 * 宿主会在一轮之后自己补发助手消息(记忆卡等),它们不改变「表单还没人答」这个事实。
 */
export function conversationAwaitsAnswer(
  messages: ReadonlyArray<{ role: string; content: string }>,
): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role === 'user') return false;
    if (message.role !== 'assistant') continue;
    if (splitOnQuestionForms(message.content).some((segment) => segment.kind === 'form')) return true;
  }
  return false;
}

export function deriveRunStatusLine(input: RunStatusInput): RunStatusLine {
  const { latest } = input;
  if (!latest) return input.streaming ? { activity: 'starting', tone: 'busy' } : { activity: 'idle', tone: 'idle' };
  const running = input.streaming || isActive(latest.runStatus);
  if (!running) return settledLine(latest.runStatus, input.awaitingAnswer === true);

  const step = currentStep(input.todos);
  const base = (activity: RunActivity, tone: RunStatusTone = 'busy'): RunStatusLine => ({
    activity,
    tone,
    ...(step ? { step } : {}),
  });

  if (input.awaitingApproval) return base('awaitingApproval', 'attention');
  if (input.reconnecting) return base('reconnecting');

  const events = latest.events ?? [];
  const tool = latestOpenToolUse(events);
  if (tool) {
    const activity = activityForTool(tool.name, tool.input);
    if (activity === 'generating') return { ...base('generating'), ...mediaDetail(tool.input, input.mediaTasks) };
    return base(activity);
  }
  const liveMedia = (input.mediaTasks ?? []).filter((task) => task.status === 'queued' || task.status === 'running');
  if (liveMedia.length > 0) return { ...base('generating'), ...mediaDetail(undefined, input.mediaTasks) };

  const last = lastMeaningfulEvent(events);
  if (!last) return base('starting');
  if (last.kind === 'text') return base('replying');
  return base('thinking');
}

function settledLine(status: ChatRunStatus | undefined, awaitingAnswer: boolean): RunStatusLine {
  if (awaitingAnswer) return { activity: 'awaitingAnswer', tone: 'attention' };
  if (status === 'failed') return { activity: 'failed', tone: 'error' };
  if (status === 'canceled') return { activity: 'stopped', tone: 'idle' };
  if (status === 'succeeded') return { activity: 'done', tone: 'success' };
  // 没有 runStatus 的老消息 / 宿主自己补发的消息:没有一轮可讲,就当闲着
  return { activity: 'idle', tone: 'idle' };
}

/** 当前那一步:显式 in_progress 优先,没有就取第一条没做完的(D36 同一条规则) */
function currentStep(todos: readonly RunStatusTodo[] | undefined): string | undefined {
  if (!todos?.length) return undefined;
  const current = todos.find((todo) => todo.status === 'in_progress')
    ?? todos.find((todo) => todo.status === 'pending');
  if (!current) return undefined;
  const text = (current.status === 'in_progress' && current.activeForm?.trim()) || current.content.trim();
  return text || undefined;
}

/** 最后发出、还没有结果的那次调用 */
function latestOpenToolUse(events: readonly PersistedAgentEvent[]):
  Extract<PersistedAgentEvent, { kind: 'tool_use' }> | null {
  const answered = new Set<string>();
  for (const event of events) if (event.kind === 'tool_result') answered.add(event.toolUseId);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.kind === 'tool_use' && !answered.has(event.id)) return event;
  }
  return null;
}

/** 只看会改变「此刻在干什么」的事件;用量、诊断、标题这些不算 */
function lastMeaningfulEvent(events: readonly PersistedAgentEvent[]): PersistedAgentEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    if (event.kind === 'text' && !event.text.trim()) continue;
    if (event.kind === 'text' || event.kind === 'thinking' || event.kind === 'thinking_tokens'
      || event.kind === 'tool_use' || event.kind === 'tool_result') return event;
  }
  return null;
}

const CODE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|gd|cs|lua|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|glsl|wgsl|shader|hlsl|css|scss|html?|vue|svelte|json|ya?ml|toml|tscn|tres|godot|unity|prefab)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg|psd|aseprite|ase)$/i;

/*
 * 命令归类只认「对用户有意义、又能从命令行正面认出来」的几类。认不出来的回落
 * `running`(「正在执行命令」),不猜 —— 归错比说得笼统更糟。
 */
/* 每条都从「命令开头 / 连接符之后」起认,免得 `npx vitest` 里的 `vite` 被当成预览 */
const AT = String.raw`(?:^|[\s;&|(])`;
const END = String.raw`(?![\w-])`;
const TEST_RE = new RegExp(`${AT}(?:(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:test|build|lint|typecheck|check)|(?:npx\\s+)?(?:vitest|jest|tsc|eslint|pytest)|vite\\s+build|playwright\\s+test|cargo\\s+(?:build|test|check)|dotnet\\s+(?:build|test)|go\\s+(?:build|test|vet))${END}`, 'i');
const INSTALL_RE = new RegExp(`${AT}(?:(?:npm|pnpm|bun)\\s+(?:install|i|add|ci)|yarn(?:\\s+(?:install|add))?|pip3?\\s+install|poetry\\s+(?:install|add)|cargo\\s+add|dotnet\\s+add\\s+package)${END}`, 'i');
const PREVIEW_RE = new RegExp(`${AT}(?:(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:dev|start|serve|preview)|(?:npx\\s+)?(?:vite|serve|http-server|live-server)|python3?\\s+-m\\s+http\\.server|godot4?(?:\\.exe)?|pixo\\s+preview|love\\s+\\.)${END}`, 'i');
const WEB_TOOL_RE = /^(webfetch|web_fetch|websearch|web_search|fetch|read_url)$/i;

/** 一次调用对用户来说是在干什么 */
export function activityForTool(name: string, input: unknown): RunActivity {
  if (isTodoWriteToolName(name)) return 'planning';
  if (WEB_TOOL_RE.test(String(name ?? ''))) return 'browsing';
  if (isCommandTool(name)) {
    const command = commandOf(input);
    if (isMediaGenerateCommand(command) || mediaWaitCall(command)) return 'generating';
    const inner = unwrapShell(command);
    // 先认构建 / 测试:`vite build` 和 `vite` 只差一个词,预览那条放最后
    if (TEST_RE.test(inner)) return 'testing';
    if (INSTALL_RE.test(inner)) return 'installing';
    if (PREVIEW_RE.test(inner)) return 'previewing';
  }
  const kind = toolKind(name, input);
  if (kind === 'read') return 'reading';
  if (kind === 'search') return 'searching';
  if (kind === 'write' || kind === 'edit' || kind === 'delete') {
    const path = fileOf(input)?.path ?? '';
    if (IMAGE_EXT.test(path)) return 'generating';
    return CODE_EXT.test(path) || !path ? 'coding' : 'writing';
  }
  if (kind === 'exec') return 'running';
  return 'working';
}

const SURFACE_FLAG_RE = /--surface[=\s]+(image|video|audio|model3d)\b/;

/**
 * 生成中的「哪一类 / 第几张」。
 *
 * 进度只信 daemon 的媒体任务(`batchSize` 是 M、已完成的格数是 N),和执行记录的
 * 生图行同一个证人;任务还没轮询到时只数命令里 `media generate` 出现几次当总数,
 * 不编一个 N。
 */
function mediaDetail(
  toolInput: unknown,
  tasks: readonly ProjectMediaTask[] | undefined,
): Pick<RunStatusLine, 'surface' | 'progress'> {
  const command = toolInput === undefined ? '' : commandOf(toolInput);
  const batch = currentMediaBatch(tasks ?? []);
  const declared = batch.find((task) => task.surface === 'image' || task.surface === 'audio' || task.surface === 'video' || task.surface === 'model3d')?.surface;
  const flagged = SURFACE_FLAG_RE.exec(command)?.[1];
  const out: Pick<RunStatusLine, 'surface' | 'progress'> = {
    surface: (declared ?? flagged ?? 'image') as RunMediaSurface,
  };

  if (batch.length > 0) {
    const total = Math.max(batch.length, ...batch.map((task) => task.batchSize ?? 0));
    const done = batch.filter((task) => task.status === 'done').length;
    if (total > 1) out.progress = { done: Math.min(done, total), total };
    return out;
  }
  const count = (command.match(/media\s+generate/g) ?? []).length;
  if (count > 1) out.progress = { total: count };
  return out;
}

/**
 * 「这一批」= 最新那个还没结束的任务所在的 `batchId`。生产方不分组时(没有 `batchId`),
 * 一轮里所有没失败的任务当一批 —— 和生图行「没有分组信息就按次数切」是同一种退路。
 */
function currentMediaBatch(tasks: readonly ProjectMediaTask[]): ProjectMediaTask[] {
  if (tasks.length === 0) return [];
  const open = tasks.filter((task) => task.status === 'queued' || task.status === 'running');
  const anchor = open.at(-1) ?? tasks.at(-1)!;
  if (anchor.batchId != null) return tasks.filter((task) => task.batchId === anchor.batchId);
  return tasks.filter((task) => task.batchId == null && task.status !== 'failed' && task.status !== 'interrupted');
}
