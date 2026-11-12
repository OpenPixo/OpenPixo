/**
 * The words that introduce a question form belong with the form.
 *
 * Shape taken from the 2026-11-10 beginner audit (hosted DeepSeek V4.1 Flash on
 * the bundled OpenCode, planning a new game): the agent reads a skill file, then
 * writes 「第 1 步 / 共 5 步：玩法」, explains the step, and ends with a
 * `<question-form>`. The form is an implicit done, and the cut used to fall on the
 * form tag itself, so the step label and the explanation were filed into the
 * collapsed 「已完成」 record. The user saw a bare form with no idea which step it
 * was or why it asked. The same happened to a build stage's 「怎么玩」 notes.
 */
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@openpixo/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell, ProseBlock } from '../../../src/runtime/chat/contract';

const KEY = 'b41c7d02e9f35a68';
const FORM = '<question-form id="gameplay" title="玩法">{"questions":[{"id":"loop","label":"核心循环","type":"radio","options":["种地优先","建造优先"]}]}</question-form>';
const LEAD_IN = '第 1 步 / 共 5 步：玩法\n\n先把一分钟的玩法定下来：你在火星上种地、修基地，沙尘暴来之前要收完庄稼。\n\n';

const text = (t: string): PersistedAgentEvent => ({ kind: 'text', text: t });
const thinking = (t: string): PersistedAgentEvent => ({ kind: 'thinking', text: t });
function read(id: string, at: number): PersistedAgentEvent[] {
  return [
    { kind: 'tool_use', id, name: 'read', input: { filePath: 'C:\\skills\\game-design\\SKILL.md' }, startedAt: at },
    { kind: 'tool_result', toolUseId: id, content: 'ok', isError: false, completedAt: at + 50 },
  ];
}

const start: PersistedAgentEvent[] = [
  { kind: 'status', label: 'starting', detail: 'openpixo-agent' },
  { kind: 'done_key', key: KEY },
  { kind: 'status', label: 'running' },
  thinking('The user wants a Mars farming game. Step 1 is gameplay.'),
  ...read('call_00', 1_000),
];

function split(events: PersistedAgentEvent[], runStatus: 'succeeded' | 'running' = 'succeeded') {
  const blocks = buildTurnBlocks({ events, runStatus });
  return {
    prose: blocks.filter((b): b is ProseBlock => b.kind === 'prose').map((b) => b.text).join(''),
    inside: JSON.stringify(blocks.filter((b): b is ExecutionShell => b.kind === 'shell')),
  };
}

describe('the lead-in to a question form', () => {
  it('is shown with the form, not folded into the record', () => {
    const turn = split([...start, text(LEAD_IN + FORM)]);
    expect(turn.prose).toContain('第 1 步 / 共 5 步：玩法');
    expect(turn.prose).toContain('沙尘暴来之前要收完庄稼');
    expect(turn.prose.indexOf('第 1 步')).toBeLessThan(turn.prose.indexOf('<question-form'));
    expect(turn.inside).not.toContain('第 1 步');
  });

  it('also when it streamed in pieces and the form came in its own delta', () => {
    const turn = split([...start, text('第 1 步 / 共 5 步：玩法\n\n'), text('先把一分钟的玩法定下来。\n\n'), text(FORM)]);
    expect(turn.prose).toContain('第 1 步 / 共 5 步：玩法');
    expect(turn.prose).toContain('先把一分钟的玩法定下来');
    expect(turn.inside).not.toContain('第 1 步');
  });

  it('moves out as soon as the form starts, while the run is still going', () => {
    const turn = split([...start, text(LEAD_IN), text('<question-form id="gameplay" title="玩法">{"questions":[')], 'running');
    expect(turn.prose).toContain('第 1 步 / 共 5 步：玩法');
    expect(turn.inside).not.toContain('第 1 步');
  });

  it('stays in the record until a form actually starts', () => {
    const turn = split([...start, text(LEAD_IN)], 'running');
    expect(turn.prose).toBe('');
    expect(turn.inside).toContain('第 1 步');
  });

  it('is only what came after the last tool call: earlier narration stays in the record', () => {
    const turn = split([
      ...start.slice(0, 3),
      text('我先读一下游戏设计的技能文件。'),
      ...read('call_00', 1_000),
      text(LEAD_IN + FORM),
    ]);
    expect(turn.inside).toContain('我先读一下游戏设计的技能文件');
    expect(turn.prose).not.toContain('我先读一下');
    expect(turn.prose).toContain('第 1 步 / 共 5 步：玩法');
  });

  it('never takes the reasoning with it', () => {
    const turn = split([...start, thinking('Now ask about the core loop.'), text(FORM)]);
    expect(turn.inside).toContain('Now ask about the core loop.');
    expect(turn.prose).not.toContain('Now ask about the core loop.');
  });

  it('also leaves an open todo for the form', () => {
    const turn = split([
      ...start,
      { kind: 'tool_use', id: 'todo_1', name: 'TodoWrite', input: { todos: [{ content: '确认玩法', status: 'in_progress' }] } },
      text(LEAD_IN + FORM),
    ]);
    expect(turn.prose).toContain('第 1 步 / 共 5 步：玩法');
    expect(turn.inside).not.toContain('第 1 步');
  });
});
