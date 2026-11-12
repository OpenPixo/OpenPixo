// @vitest-environment jsdom
/**
 * OpenPixo 自己的动作在执行记录里画产品动词,不画 `$env:PIXO_BIN …`(用户 2026-11-04)。
 *
 * 行数据来自真实 codex 那一轮(`codex-godot-dash.turn0.json`)经 `buildTurnBlocks` 落出来的行,
 * 不是手搓的 `ToolRow` —— 判据和画法两头一起验。
 *
 * 防假绿:断言的是**屏幕上的文字**;原始命令要在展开之后才出现,所以既验摘要里没有,
 * 也验展开以后还在(用户要排查时仍然拿得到原文)。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { PersistedAgentEvent } from '@openpixo/contracts';
import { I18nProvider } from '../../../src/i18n';
import { ToolRow } from '../../../src/components/chat/primitives/ToolRow';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell, ShellItem, ToolRow as ToolRowData } from '../../../src/runtime/chat/contract';
import codexGodot from '../../fixtures/chat/codex-godot-dash.turn0.json';

afterEach(cleanup);

const rows = ((): ToolRowData[] => {
  const f = codexGodot as unknown as { events: PersistedAgentEvent[] };
  const tools = (items: readonly ShellItem[]): ToolRowData[] => items.filter((i): i is ToolRowData => i.kind === 'tool');
  return buildTurnBlocks({ events: f.events, runStatus: 'canceled' })
    .filter((b): b is ExecutionShell => b.kind === 'shell')
    .flatMap((s) => [...tools(s.items), ...s.segments.flatMap((seg) => tools(seg.items))]);
})();

const summaryOf = (row: ToolRowData, locale: 'zh-CN' | 'en' = 'zh-CN') => {
  const view = render(<I18nProvider initial={locale}><ToolRow row={row} deferBody={false} /></I18nProvider>);
  return view;
};

describe('OpenPixo 动作行', () => {
  it('验证:「验证游戏 · 检查、构建、运行」,摘要里没有 PIXO_BIN', () => {
    const row = rows.filter((r) => r.action?.kind === 'verify').at(-1)!;
    const { container } = summaryOf(row);
    const summary = container.querySelector('summary')!;
    expect(summary.textContent).toContain('验证游戏 · 检查、构建、运行');
    expect(summary.textContent).not.toMatch(/PIXO_BIN/);
  });

  it('展开之后原命令还在', () => {
    const row = rows.filter((r) => r.action?.kind === 'verify').at(-1)!;
    const { container } = summaryOf(row);
    fireEvent.click(container.querySelector('summary')!);
    expect(container.textContent).toMatch(/game verify --steps check,build,run/);
  });

  it('技能:「使用技能 · godot-gdscript、player-controller-2d」', () => {
    const { container } = summaryOf(rows.find((r) => r.action?.kind === 'skill')!);
    expect(container.querySelector('summary')!.textContent).toContain('使用技能 · godot-gdscript、player-controller-2d');
  });

  it('测试:英文界面是「Ran test · dash_test.gd」', () => {
    const { container } = summaryOf(rows.find((r) => r.action?.kind === 'test')!, 'en');
    expect(container.querySelector('summary')!.textContent).toContain('Ran test · dash_test.gd');
  });

  it('验证输出顶层 status 是 failed 时,即使退出码为 0 也标「失败」', () => {
    const base = rows.filter((r) => r.action?.kind === 'verify').at(-1)!;
    const events = [
      { kind: 'tool_use', id: 'v', name: 'Bash', input: { command: 'pixo game verify --steps check --json' } },
      { kind: 'tool_result', toolUseId: 'v', content: '{\n  "status": "failed",\n  "steps": []\n}', isError: false },
    ] as unknown as PersistedAgentEvent[];
    const [shell] = buildTurnBlocks({ events, runStatus: 'succeeded' }) as ExecutionShell[];
    const row = shell!.items.find((i): i is ToolRowData => i.kind === 'tool')!;
    expect(base.failed).toBe(false);
    expect(row.failed).toBe(true);
    const { container } = summaryOf(row);
    expect(container.querySelector('summary')!.textContent).toContain('失败');
  });
});
