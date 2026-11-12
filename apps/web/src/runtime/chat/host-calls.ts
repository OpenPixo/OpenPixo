import type { PersistedAgentEvent } from '@openpixo/contracts';
import { classifyCommand, commandOf, isCommandTool, isSnapshotTool, toolKind, unwrapShell } from './tool-kind';

/**
 * 执行记录里**OpenPixo 自己的管线**:哪些调用换成人话,哪些不落行(纯函数)。
 *
 * 用户 2026-11-04 在真实 codex 运行上的裁决(夹具 `codex-godot-dash.turn0.json`):
 * 执行记录给做游戏的人看,该看到的是「对我的游戏做了什么」——改了哪些文件、
 * 验证过没过、测试过没过。agent 怎么调 OpenPixo 的 CLI、怎么找说明文件、
 * 怎么翻 OpenPixo 的日志,是 OpenPixo 在和自己说话。
 *
 * 判据一律**按命令内容可证明**,和 `tool-kind.ts` 同一条纪律:认错比认不出更糟。
 * 认不出的调用照旧按原规则落行,这里只多出两档:
 *   换人话  `hostActionOf`  —— 行还在,标题换成产品动词,展开仍是原命令与输出
 *   不落行  `isHostPlumbing` / `supersededRetryIds`
 */

export type GameVerifyStep = 'check' | 'build' | 'run';

export type HostAction =
  /** `pixo game verify`;`steps` 为空 = 没传 `--steps`,CLI 按引擎默认跑 */
  | { kind: 'verify'; steps: GameVerifyStep[] }
  /** 读 `.pixo-skills/<技能>-<哈希>/SKILL.md`;名字去掉 daemon 加的 10 位哈希 */
  | { kind: 'skill'; names: string[] }
  /** `godot … --script <文件>`:agent 写的无头测试脚本 */
  | { kind: 'test'; script: string };

const VERIFY_STEPS = new Set<GameVerifyStep>(['check', 'build', 'run']);

/**
 * `pixo` 的三种写法:装好的 `pixo`、daemon 注入的 `$PIXO_BIN`(POSIX)和
 * `$env:PIXO_BIN`(PowerShell)。`npm run game verify` 这类不带这几个记号的不认。
 */
const PIXO_GAME_VERIFY = /(?:^|[\s&;|('"])(?:pixo(?:\.cmd|\.exe)?|\$\{?PIXO_BIN\}?|\$env:PIXO_BIN)["']?\s+game\s+verify\b([^\n;|]*)/i;
const SKILL_FILE = /\.pixo-skills[\\/]+([^\\/'"\s]+)[\\/]+SKILL\.md/gi;
/** `cwd-aliases.ts` 的 `${folder}-${sha256.slice(0, 10)}` */
const SKILL_DIGEST = /-[0-9a-f]{10}$/;
const GODOT_SCRIPT = /(?:^|[\s&;|('"])(?:[^\s'"]*[\\/])?godot[^\s'"\\/]*\s[^\n;|]*?--script\s+("[^"]+"|'[^']+'|\S+)/i;

const MUTATING = new Set(['write', 'edit', 'delete']);

/** 一段命令或一个路径里提到的 `.pixo-skills/<技能>-<哈希>/SKILL.md`,技能名去掉哈希 */
export function skillNamesIn(text: string): string[] {
  return [...new Set([...text.matchAll(SKILL_FILE)].map((m) => (m[1] ?? '').replace(SKILL_DIGEST, '')))].filter(Boolean);
}

export function hostActionOf(command: string): HostAction | null {
  const cmd = unwrapShell(command);

  const verify = cmd.match(PIXO_GAME_VERIFY);
  if (verify) {
    const args = verify[1] ?? '';
    // 查用法不是验证(同 `isMediaGenerateCommand` 拒 `--help` 那条)
    if (/(?:^|\s)(?:--help|-h)\b/.test(args)) return null;
    const raw = args.match(/--steps(?:=|\s+)["']?([\w,]+)/)?.[1] ?? '';
    const steps = raw.split(',').filter((s): s is GameVerifyStep => VERIFY_STEPS.has(s as GameVerifyStep));
    return { kind: 'verify', steps };
  }

  const test = cmd.match(GODOT_SCRIPT);
  if (test) {
    const script = (test[1] ?? '').replace(/^['"]|['"]$/g, '').split(/[\\/]/).pop() ?? '';
    if (script) return { kind: 'test', script };
  }

  if (!MUTATING.has(classifyCommand(command))) {
    const names = skillNamesIn(cmd);
    if (names.length) return { kind: 'skill', names };
  }
  return null;
}

/**
 * 不落行的管线调用。两类,都只在**只读**时成立 —— 往这些地方写东西就不是管线了,照常显示:
 *  · 翻 `artifacts/game-verify/` 下的验证日志:「验证游戏」那一行已经报了结果,
 *    日志是它的底稿,文件名是一串 uuid,对用户没有意义;
 *  · 逐级向上找 `AGENTS.md` / `CLAUDE.md`:agent 开工前的自举。直接读项目里的
 *    `AGENTS.md` 不算,那是读一个具体文件。
 */
export function isHostPlumbing(command: string): boolean {
  if (MUTATING.has(classifyCommand(command))) return false;
  const cmd = unwrapShell(command);
  if (/[\\/]artifacts[\\/]+game-verify[\\/]/i.test(cmd)) return true;
  return /\b(?:AGENTS|CLAUDE)\.md\b/.test(cmd) && /\.Parent\b|\bdirname\b|Split-Path\b[^\n;]*-Parent/i.test(cmd);
}

/**
 * 「原样重跑就好了」的那些失败。
 *
 * 一条命令失败,agent 什么都没改、原样再跑一遍成功了 —— 前一次的「失败」不是这一轮的
 * 结局,留着只会让用户以为出了事(真机:验证日志 EPERM 一次,下一次照跑通过)。
 *
 * 三个条件缺一不吞(同一个输出文件的再次生成另有判据,见函数里):
 *  · 后一次**命令逐字相同**;
 *  · 后一次**已经回来且成功** —— 还在飞的不知道结局,先留着;
 *  · 两次之间**没有改过文件**(写 / 改 / 删,含 Bash 里的)—— 改过的话,那次失败就是
 *    「发现 bug → 修 → 再跑」的证据,用户要看。
 */
export function supersededRetryIds(events: readonly PersistedAgentEvent[]): Set<string> {
  const results = new Map<string, Extract<PersistedAgentEvent, { kind: 'tool_result' }>>();
  for (const e of events) if (e.kind === 'tool_result') results.set(e.toolUseId, e);
  const uses = events.filter((e): e is Extract<PersistedAgentEvent, { kind: 'tool_use' }> =>
    e.kind === 'tool_use' && !isSnapshotTool(e.name));
  const waits = mediaWaitOutcomes(events);
  /** 一次生成失败了吗:命令自己报错,或者它交棒的任务后来等到了失败 */
  const failedCall = (id: string): boolean => {
    const result = results.get(id);
    if (result?.isError) return true;
    const task = mediaHandoffTaskId(result?.content);
    return task != null && waits.get(task)?.state === 'failed';
  };

  const out = new Set<string>();
  uses.forEach((use, i) => {
    if (!isCommandTool(use.name) || !failedCall(use.id)) return;
    const command = commandOf(use.input);
    if (!command) return;
    const output = mediaGenerateOutput(command);
    for (const later of uses.slice(i + 1)) {
      if (isCommandTool(later.name) && output && mediaGenerateOutput(commandOf(later.input)) === output) {
        /*
         * 同一个输出文件的再一次生成 —— 媒体合同让 agent 这么做(`retry-later` 原样重发,
         * `switch-model` 换模型)。用户要的是那张图:这一次还在跑或成功了,前一次的失败
         * 就只是过程,界面不先摆一格红的。这一次也失败就接着往后看,全失败才都留着。
         */
        if (!failedCall(later.id)) { out.add(use.id); return; }
        continue;
      }
      if (isCommandTool(later.name) && commandOf(later.input) === command) {
        const settled = results.get(later.id);
        if (settled && !settled.isError) out.add(use.id);
        return;
      }
      if (MUTATING.has(toolKind(later.name, later.input))) return;
    }
  });
  return out;
}

/* ── 媒体生成的等待 ─────────────────────────────────────────── */

/** 生图判据的**唯一**出处 —— 游标、`readImageCall`、状态行必须问同一个人 */
export function isMediaGenerateCommand(command: string): boolean {
  return /media\s+generate/.test(command) && !/--help\b/.test(command);
}

/** 这次生成写到哪个文件;没有 `--output` 就认不出是不是同一张图 */
function mediaGenerateOutput(command: string): string | null {
  if (!isMediaGenerateCommand(command)) return null;
  return command.match(/--output(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/)?.slice(1).find(Boolean) ?? null;
}

const PIXO_MEDIA_WAIT = /(?:^|[\s&;|('"])(?:[^\s'"]*[\\/])?(?:pixo(?:\.cmd|\.exe)?|cli\.[cm]?js|\$\{?PIXO_BIN\}?|\$env:PIXO_BIN)["']?\s+media\s+wait\b([^\n;|]*)/i;

/**
 * `pixo media wait <taskId>`。`taskId` 是 `null` 表示命令里写的是变量。
 * 和 `media generate` 写在同一条命令里的不算:那一条整条就是一行生图行。
 */
export function mediaWaitCall(command: string): { taskId: string | null } | null {
  if (isMediaGenerateCommand(command)) return null;
  const match = unwrapShell(command).match(PIXO_MEDIA_WAIT);
  if (!match) return null;
  const args = match[1] ?? '';
  if (/(?:^|\s)(?:--help|-h)\b/.test(args)) return null;
  return { taskId: args.match(/^\s+["']?([\w-]+)/)?.[1] ?? null };
}

export type MediaJobOutcome =
  | { state: 'running' }
  | { state: 'done'; path: string | null }
  | { state: 'failed' };

/**
 * 一段 `media generate` / `media wait` 输出说这件事走到哪了:最后一行能读懂的 JSON 算数。
 * 只认 CLI 自己打的 JSON(`pollUntilDoneOrBudget`)—— **不看退出码,也不看文字里有没有
 * `error`**:退出 2 就是「还在跑」,进度行里提到 error 也不等于这次失败了。
 * 什么都读不出来(比如输出被打码)时是 `null`,由调用方退回别的证据。
 */
export function readMediaJobOutcome(content: string | undefined): MediaJobOutcome | null {
  let outcome: MediaJobOutcome | null = null;
  for (const line of (content ?? '').split('\n')) {
    const rec = jsonLine(line);
    if (!rec) continue;
    const file = rec.file;
    if (file && typeof file === 'object') {
      const { name, providerError } = file as Record<string, unknown>;
      outcome = providerError ? { state: 'failed' } : { state: 'done', path: typeof name === 'string' && name ? name : null };
    } else if (rec.status === 'failed' || rec.status === 'interrupted') {
      outcome = { state: 'failed' };
    } else if (typeof rec.taskId === 'string' && (rec.status === 'queued' || rec.status === 'running')) {
      outcome = { state: 'running' };
    }
  }
  return outcome;
}

/**
 * 美术预算让 `media generate` 停下的两种情况:用户定的上限到了(`raise-art-budget`),或者
 * 项目设成「先问我」而用户还没批准这批素材(`approve-art`,智能体接着会给出素材卡片)。
 * 退出码非零,但什么也没失败、什么也没扣。界面不把这件事说成红色的失败。
 */
const ART_BUDGET_STOP_STEPS: ReadonlySet<unknown> = new Set(['raise-art-budget', 'approve-art']);

export function isArtBudgetStop(content: string | undefined): boolean {
  return (content ?? '').split('\n').some((line) => {
    const error = jsonLine(line)?.error;
    return Boolean(error) && typeof error === 'object' && ART_BUDGET_STOP_STEPS.has((error as Record<string, unknown>).nextStep);
  });
}

/** `media generate` 等满 25 秒交棒时打的那一行(`{"taskId":…,"status":"running",…}`)里的任务 id */
export function mediaHandoffTaskId(content: string | undefined): string | null {
  for (const line of (content ?? '').split('\n')) {
    const rec = jsonLine(line);
    if (rec && typeof rec.taskId === 'string' && (rec.status === 'queued' || rec.status === 'running')) return rec.taskId;
  }
  return null;
}

/** 这一轮每个任务等到了什么:后一次覆盖前一次,读不出状态的那次不算数 */
export function mediaWaitOutcomes(events: readonly PersistedAgentEvent[]): Map<string, MediaJobOutcome> {
  const taskByUse = new Map<string, string>();
  const out = new Map<string, MediaJobOutcome>();
  for (const event of events) {
    if (event.kind === 'tool_use' && isCommandTool(event.name)) {
      const task = mediaWaitCall(commandOf(event.input))?.taskId;
      if (task) taskByUse.set(event.id, task);
    } else if (event.kind === 'tool_result') {
      const task = taskByUse.get(event.toolUseId);
      const outcome = task ? readMediaJobOutcome(event.content) : null;
      if (task && outcome) out.set(task, outcome);
    }
  }
  return out;
}

function jsonLine(line: string): Record<string, unknown> | null {
  const text = line.trim();
  if (!text.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
