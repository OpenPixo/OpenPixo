/**
 * 红测:执行记录里不该出现 OpenPixo 自己的管线(用户 2026-11-04「什么该显示,什么不该显示」)。
 *
 * 夹具是本机一次真实 codex 运行(Godot 冲刺 + 冷却,用户中途停止),
 * 由 `/api/projects/:id/conversations/:id/messages` 原样导出,字符串截到 2000,
 * 用户目录换成 `dev`。修之前这一轮的执行记录逐字是:
 *   · `执行 & $env:PIXO_NODE_BIN $env:PIXO_BIN game verify --steps check --json` ×4(第一次还标「失败」)
 *   · `读取 SKILL.md`(其实是读 `.pixo-skills/` 里两份技能)
 *   · `读取 $taskPath = Get-Item -LiteralPath .; while (…)`(codex 逐级找 AGENTS.md)
 *   · `读取 5434547d-….log`(agent 去翻 OpenPixo 自己的验证日志)
 *   · `新建 void:`(GDScript 的 `-> void:` 被当成了输出重定向)
 */
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@openpixo/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell, ShellItem, ToolRow } from '../../../src/runtime/chat/contract';
import { hostActionOf, isHostPlumbing, supersededRetryIds } from '../../../src/runtime/chat/host-calls';
import { classifyCommand, commandFile } from '../../../src/runtime/chat/tool-kind';
import codexGodot from '../../fixtures/chat/codex-godot-dash.turn0.json';

interface Fixture { runStatus: string; events: PersistedAgentEvent[] }

const ps = (body: string): string =>
  `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command '${body}'`;

function rowsOf(fixture: unknown): ToolRow[] {
  const f = fixture as Fixture;
  const blocks = buildTurnBlocks({ events: f.events, runStatus: f.runStatus as 'canceled' });
  const tools = (items: readonly ShellItem[]): ToolRow[] => items.filter((i): i is ToolRow => i.kind === 'tool');
  return blocks
    .filter((b): b is ExecutionShell => b.kind === 'shell')
    .flatMap((shell) => [...tools(shell.items), ...shell.segments.flatMap((s) => tools(s.items))]);
}

describe('真实一轮:codex 在 Godot 项目里加冲刺', () => {
  const rows = rowsOf(codexGodot);
  const shown = rows.map((r) => `${r.title} ${r.file?.label ?? ''}`);

  // 带 `action` 的行由 `ToolRow` 画产品动词,原始命令只在展开里(钉在 `host-action-row.test.tsx`)
  it('按原始命令画标题的行里,不出现 PIXO_BIN / PIXO_NODE_BIN', () => {
    const raw = rows.filter((r) => !r.action).map((r) => r.title);
    expect(raw.filter((s) => /PIXO_(NODE_)?BIN/.test(s))).toEqual([]);
  });

  it('`pixo game verify` 画成「验证游戏」,并带上它跑的步骤', () => {
    const verify = rows.filter((r) => r.action?.kind === 'verify');
    expect(verify.map((r) => (r.action as { steps: string[] }).steps)).toEqual([
      ['check'],
      ['check'],
      ['check', 'build', 'run'],
    ]);
  });

  it('第一次验证撞上 EPERM、随即原样重跑成功 —— 那一行「失败」不留', () => {
    expect(rows.filter((r) => r.action?.kind === 'verify' && r.failed)).toEqual([]);
  });

  it('读 `.pixo-skills/<技能>/SKILL.md` 画成「使用技能」,技能名去掉目录哈希', () => {
    const skill = rows.find((r) => r.action?.kind === 'skill');
    expect(skill?.action).toEqual({ kind: 'skill', names: ['godot-gdscript', 'player-controller-2d'] });
  });

  it('`godot --headless --script res://tests/dash_test.gd` 画成「运行测试」;第一次失败后原样重跑通过,只留一行', () => {
    const tests = rows.filter((r) => r.action?.kind === 'test');
    expect(tests).toHaveLength(1);
    expect(tests[0]?.action).toEqual({ kind: 'test', script: 'dash_test.gd' });
    expect(tests[0]?.failed).toBe(false);
  });

  it('逐级找 AGENTS.md 和翻 OpenPixo 验证日志的调用不落行', () => {
    expect(shown.filter((s) => /\$taskPath|AGENTS\.md|\.log\b|\$verifyLogRoot/.test(s))).toEqual([]);
  });

  it('不再凭空冒出一个叫 `void:` 的新建文件;写测试脚本那一行指向真正的文件', () => {
    expect(shown.filter((s) => /void:/.test(s))).toEqual([]);
    const write = rows.find((r) => r.tool === 'write' && r.file?.label === 'dash_test.gd');
    expect(write).toBeDefined();
  });

  it('项目自己的文件照常显示:三处改写还在', () => {
    const edits = rows.filter((r) => r.tool === 'edit').map((r) => r.file?.label);
    expect(edits).toEqual(['main.tscn', 'player.gd', 'project.godot']);
  });
});

describe('hostActionOf · 只认能证明是 OpenPixo CLI 的写法', () => {
  it.each([
    [ps('& $env:PIXO_NODE_BIN $env:PIXO_BIN game verify --steps check,build --json'), ['check', 'build']],
    ['node "$PIXO_BIN" game verify --steps run --screenshot', ['run']],
    ['pixo game verify --json', []],
  ])('%s', (command, steps) => {
    expect(hostActionOf(command)).toEqual({ kind: 'verify', steps });
  });

  it('查用法不是验证', () => {
    expect(hostActionOf('pixo game verify --help')).toBeNull();
  });

  it('别的程序碰巧带 verify 参数不算', () => {
    expect(hostActionOf('npm run game verify')).toBeNull();
  });

  it('读项目里普通文件不是使用技能', () => {
    expect(hostActionOf("Get-Content -LiteralPath 'docs/SKILL.md'")).toBeNull();
  });

  it('godot 不带 --script 时不是测试', () => {
    expect(hostActionOf('godot --version')).toBeNull();
  });
});

describe('isHostPlumbing · 只藏 OpenPixo 管线,不藏项目里的动作', () => {
  it('读 `artifacts/game-verify` 下的日志是管线', () => {
    expect(isHostPlumbing(ps("Get-Content -LiteralPath 'D:\\data\\artifacts\\game-verify\\abc\\run.log'"))).toBe(true);
    expect(isHostPlumbing('tail -n 50 /data/artifacts/game-verify/abc/run.log')).toBe(true);
  });

  it('逐级向上找 AGENTS.md 是管线', () => {
    expect(isHostPlumbing('d=$PWD; while [ "$d" != / ]; do cat "$d/AGENTS.md"; d=$(dirname "$d"); done')).toBe(true);
  });

  it('直接读项目里的 AGENTS.md 照常显示', () => {
    expect(isHostPlumbing('cat AGENTS.md')).toBe(false);
  });

  it('往验证日志目录里写东西不藏(那就不是只读管线了)', () => {
    expect(isHostPlumbing('rm -rf /data/artifacts/game-verify/abc')).toBe(false);
  });
});

describe('supersededRetryIds · 只吞掉「原样重跑就好了」的那次失败', () => {
  const use = (id: string, command: string): PersistedAgentEvent =>
    ({ kind: 'tool_use', id, name: 'Bash', input: { command } }) as PersistedAgentEvent;
  const result = (id: string, isError: boolean): PersistedAgentEvent =>
    ({ kind: 'tool_result', toolUseId: id, content: isError ? 'boom' : 'ok', isError }) as PersistedAgentEvent;
  const edit = (id: string): PersistedAgentEvent =>
    ({ kind: 'tool_use', id, name: 'Edit', input: { file_path: 'player.gd' } }) as PersistedAgentEvent;

  it('同一条命令紧接着重跑成功:前一次失败被吞', () => {
    const events = [use('a', 'godot --script t.gd'), result('a', true), use('b', 'godot --script t.gd'), result('b', false)];
    expect([...supersededRetryIds(events)]).toEqual(['a']);
  });

  it('中间改过文件:那次失败是「修 bug 的证据」,要留', () => {
    const events = [
      use('a', 'godot --script t.gd'), result('a', true),
      edit('e'), result('e', false),
      use('b', 'godot --script t.gd'), result('b', false),
    ];
    expect([...supersededRetryIds(events)]).toEqual([]);
  });

  it('重跑也失败:两次都留', () => {
    const events = [use('a', 'x'), result('a', true), use('b', 'x'), result('b', true)];
    expect([...supersededRetryIds(events)]).toEqual([]);
  });

  it('重跑还没回来:先不吞(还不知道是不是最终结果)', () => {
    const events = [use('a', 'x'), result('a', true), use('b', 'x')];
    expect([...supersededRetryIds(events)]).toEqual([]);
  });
});

describe('PowerShell here-string 里的内容不是 shell 语法', () => {
  const command = ps([
    'New-Item -ItemType Directory -Path tests -Force | Out-Null',
    "$testSource = @''",
    'func _run() -> void:',
    '\tpass',
    "''@",
    'Set-Content -LiteralPath tests/dash_test.gd -Value $testSource -Encoding utf8',
  ].join('\n'));

  it('`-> void:` 不是输出重定向;Set-Content 才是那次写入', () => {
    expect(classifyCommand(command)).toBe('write');
    expect(commandFile(command)?.path).toBe('tests/dash_test.gd');
  });
});
