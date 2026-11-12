/**
 * An art card ends a turn the way a question form does: it is handed to the user and
 * carries a button, so it and the words that introduce it sit outside the collapsed
 * record, from the moment the card starts streaming. A card still being written must
 * not show up as raw text inside the record either.
 */
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@openpixo/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell, ProseBlock } from '../../../src/runtime/chat/contract';

const KEY = 'c52d8e13fa046b79';
const CARD = '<art-request credits="32">\n- Hero design: 1 image\n- Hero idle, run, jump, hurt: 4 images\n</art-request>';
const LEAD_IN = 'Stage 2 needs the hero. Here is the art I would make:\n\n';

const text = (t: string): PersistedAgentEvent => ({ kind: 'text', text: t });
const start: PersistedAgentEvent[] = [
  { kind: 'status', label: 'running' },
  { kind: 'done_key', key: KEY },
  { kind: 'tool_use', id: 'call_00', name: 'read', input: { filePath: 'docs/plan.md' }, startedAt: 1_000 },
  { kind: 'tool_result', toolUseId: 'call_00', content: 'ok', isError: false, completedAt: 1_050 },
];

function split(events: PersistedAgentEvent[], runStatus: 'succeeded' | 'running' = 'succeeded') {
  const blocks = buildTurnBlocks({ events, runStatus });
  return {
    prose: blocks.filter((b): b is ProseBlock => b.kind === 'prose').map((b) => b.text).join(''),
    inside: JSON.stringify(blocks.filter((b): b is ExecutionShell => b.kind === 'shell')),
  };
}

describe('an art card at the end of a turn', () => {
  it('is shown outside the record with its lead-in', () => {
    const turn = split([...start, text(LEAD_IN + CARD)]);
    expect(turn.prose).toContain('Here is the art I would make');
    expect(turn.prose).toContain('<art-request credits="32">');
    expect(turn.inside).not.toContain('art-request');
    expect(turn.inside).not.toContain('Here is the art');
  });

  it('moves out as soon as the card starts, while the run is still going', () => {
    const turn = split([...start, text(LEAD_IN), text('<art-request credits="32">\n- Hero des')], 'running');
    expect(turn.prose).toContain('Here is the art I would make');
    expect(turn.inside).not.toContain('art-request');
  });

  it('holds back a half-typed opener instead of putting it in the record', () => {
    const turn = split([...start, text(LEAD_IN), text('<art-re')], 'running');
    expect(turn.inside).not.toContain('<art-re');
  });

  it('is also outside the record when the agent writes the done marker after it', () => {
    const turn = split([...start, text(LEAD_IN + CARD + `<pixo-done key="${KEY}"/>`)]);
    expect(turn.prose).toContain('<art-request credits="32">');
    expect(turn.inside).not.toContain('art-request');
  });
});
