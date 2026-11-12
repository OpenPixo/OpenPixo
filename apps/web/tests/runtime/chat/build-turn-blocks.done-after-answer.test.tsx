// @vitest-environment jsdom
/**
 * A read-only question whose done marker came after the answer.
 *
 * Shape taken from a real hosted-agent turn (bundled OpenCode, 2026-11-07): the
 * run has a done key, reads a dozen files over several steps, and its whole
 * answer arrives as one text event at the very end, after `next_steps`. It opens
 * with a `<pixo-title>` marker and ends with `<pixo-done>`: the model finished
 * talking and only then marked the end, where the prompt asks for the marker
 * before the answer. Cut literally, everything was "before done" and folded into
 * the collapsed record; the user saw only 「已完成 40s」, and inside it the raw
 * title tag.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@openpixo/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell, ProseBlock } from '../../../src/runtime/chat/contract';
import { SayBlock } from '../../../src/components/chat/SayBlock';

const KEY = 'e753fcdea60a88eb';

function read(id: string, file: string, at: number): PersistedAgentEvent[] {
  return [
    { kind: 'tool_use', id, name: 'read', input: { pixo_input_streaming: true }, startedAt: at },
    { kind: 'tool_use', id, name: 'read', input: { file_path: `C:\\games\\demo\\src\\${file}` }, startedAt: at },
    { kind: 'tool_use', id, name: 'read', input: { filePath: `C:\\games\\demo\\src\\${file}` }, startedAt: at + 100 },
    { kind: 'tool_result', toolUseId: id, content: `<path>C:\\games\\demo\\src\\${file}</path>`, isError: false, completedAt: at + 101 },
  ];
}

const work: PersistedAgentEvent[] = [
  { kind: 'status', label: 'starting', detail: 'openpixo-agent' },
  { kind: 'done_key', key: KEY },
  { kind: 'status', label: 'running' },
  ...read('call_00', 'ShopScene.ts', 1_000),
  ...read('call_01', 'state.ts', 1_200),
  { kind: 'usage', inputTokens: 100, outputTokens: 10 },
  { kind: 'status', label: 'running' },
  ...read('call_02', 'TitleScene.ts', 6_000),
  { kind: 'usage', inputTokens: 100, outputTokens: 10 },
  { kind: 'status', label: 'running' },
  { kind: 'next_steps', suggestions: ['给开价加上客人反馈', '加上音效'] },
];

const ANSWER = '<pixo-title>评估游戏改进点</pixo-title>\n\n我读了各个场景。按优先级排:\n\n1. **开价是盲猜**\n2. **验货没有取舍**\n';

function split(events: PersistedAgentEvent[], runStatus: 'succeeded' | 'running' = 'succeeded') {
  const blocks = buildTurnBlocks({ events, runStatus });
  return {
    blocks,
    prose: blocks.filter((b): b is ProseBlock => b.kind === 'prose').map((b) => b.text).join(''),
    inside: JSON.stringify(blocks.filter((b): b is ExecutionShell => b.kind === 'shell')),
  };
}

describe('an answer whose done marker came after it', () => {
  const settled = split([...work, { kind: 'text', text: `${ANSWER}\n<pixo-done key="${KEY}"/>\n` }]);

  it('is shown under the record, not folded inside it', () => {
    expect(settled.prose).toContain('开价是盲猜');
    expect(settled.inside).not.toContain('开价是盲猜');
  });

  it('also when the answer streamed in pieces before the marker', () => {
    const streamed = split([
      ...work,
      { kind: 'text', text: '我读了各个场景。按优先级排:\n\n' },
      { kind: 'text', text: '1. **开价是盲猜**\n' },
      { kind: 'text', text: `<pixo-done key="${KEY}"/>` },
    ]);
    expect(streamed.prose).toContain('按优先级排');
    expect(streamed.prose).toContain('开价是盲猜');
    expect(streamed.inside).not.toContain('开价是盲猜');
  });

  it('stays in the record while the run is still going', () => {
    const live = split([...work, { kind: 'text', text: `${ANSWER}<pixo-done key="${KEY}"/>` }], 'running');
    expect(live.prose).toBe('');
  });
});

describe('a marker sent on its own before the answer', () => {
  it('leaves the narration before it in the record', () => {
    const { prose, inside } = split([
      ...work,
      { kind: 'text', text: '看完了,下面总结。' },
      { kind: 'text', text: `<pixo-done key="${KEY}"/>` },
      { kind: 'text', text: '1. **开价是盲猜**' },
    ]);
    expect(prose).toBe('1. **开价是盲猜**');
    expect(inside).toContain('看完了,下面总结。');
  });
});

describe('the title marker inside the record', () => {
  it('is never drawn', () => {
    const { container } = render(<SayBlock text={'<pixo-title>评估游戏改进点</pixo-title>\n\n我先读一下文件。'} />);
    expect(container.textContent).not.toContain('pixo-title');
    expect(container.textContent).not.toContain('评估游戏改进点');
    expect(container.textContent).toContain('我先读一下文件。');
  });
});
