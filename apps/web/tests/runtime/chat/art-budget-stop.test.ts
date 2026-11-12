/**
 * Owner: a budget that ran out is not a red error. The dispatcher exits non-zero, which
 * the runtime records as `isError`, but no image failed: the limit the user set was
 * reached. A real failure next to it must still read as one.
 */
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@openpixo/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell, ImageRow, ShellItem, ToolRow } from '../../../src/runtime/chat/contract';
import { isArtBudgetStop } from '../../../src/runtime/chat/host-calls';

const GENERATE = '"$PIXO_NODE_BIN" "$PIXO_BIN" media generate --surface image --model openpixo-image --output assets/hero.png --prompt hero';
const STOP = '{"error":{"code":"ART_BUDGET_EXHAUSTED","message":"Art budget: 100 of 100 credits used.","nextStep":"raise-art-budget"}}';
const ASK = '{"error":{"code":"ART_APPROVAL_REQUIRED","message":"This project asks before spending credits on art.","nextStep":"approve-art"}}';
const REFUSED = '{"error":{"code":"CLOUD_UNAVAILABLE","message":"cloud down","nextStep":"retry-later"}}';

const use = (id: string): PersistedAgentEvent => ({ kind: 'tool_use', id, name: 'Bash', input: { command: GENERATE }, startedAt: 100 } as PersistedAgentEvent);
const result = (toolUseId: string, content: string): PersistedAgentEvent => ({ kind: 'tool_result', toolUseId, content, isError: true } as PersistedAgentEvent);

function flatten(items: readonly ShellItem[]): ShellItem[] {
  return items.flatMap((item) => (item.kind === 'todo' ? flatten(item.segment.items) : [item]));
}
function rows(events: PersistedAgentEvent[]) {
  const blocks = buildTurnBlocks({ events, runStatus: 'succeeded' });
  const items = blocks.filter((block): block is ExecutionShell => block.kind === 'shell').flatMap((shell) => flatten(shell.items));
  return {
    images: items.filter((item): item is ImageRow => item.kind === 'image'),
    tools: items.filter((item): item is ToolRow => item.kind === 'tool'),
  };
}

describe('a used-up art budget in the execution record', () => {
  it('recognises only the budget stop', () => {
    expect(isArtBudgetStop(`some stderr\n${STOP}`)).toBe(true);
    expect(isArtBudgetStop(REFUSED)).toBe(false);
    expect(isArtBudgetStop('raise-art-budget')).toBe(false);
    expect(isArtBudgetStop(undefined)).toBe(false);
  });

  it('reads an unapproved request in ask mode the same way: nothing failed, nothing was charged', () => {
    expect(isArtBudgetStop(ASK)).toBe(true);
    expect(isArtBudgetStop('approve-art')).toBe(false);
    const { images, tools } = rows([use('a'), result('a', ASK)]);
    expect(images).toHaveLength(0);
    expect(tools[0]!.failed).toBe(false);
    expect(tools[0]!.failReason ?? null).toBeNull();
  });

  it('shows no failed image and no failed step', () => {
    const { images, tools } = rows([use('a'), result('a', STOP)]);
    expect(images).toHaveLength(0);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.failed).toBe(false);
    expect(tools[0]!.failReason ?? null).toBeNull();
  });

  it('still shows a real failure as a failure', () => {
    const { images } = rows([use('a'), result('a', REFUSED)]);
    expect(images[0]?.failed).toBe(1);
  });
});
