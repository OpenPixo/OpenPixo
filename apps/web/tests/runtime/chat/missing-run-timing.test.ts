import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@openpixo/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import { formatShellElapsed } from '../../../src/runtime/chat/format';
import type { BuildTurnInput, ExecutionShell, TurnBlock } from '../../../src/runtime/chat/contract';
const shellsOf = (blocks: TurnBlock[]): ExecutionShell[] => blocks.filter((b): b is ExecutionShell => b.kind === 'shell');
const headText = (shell: ExecutionShell): string | null => formatShellElapsed(shell.elapsedMs);
describe('反向锚点 · 真的没有计时数据时,展示规则保持一致', () => {
  /** 一个带时刻的事件都没有、轮次自己的起止也没有 —— 这时候「不知道」就是不知道。 */
  const NOTHING: PersistedAgentEvent[] = [
    { kind: 'status', label: 'starting' },
    { kind: 'thinking', text: '先看看要改哪里。' },
    { kind: 'text', text: '按你说的改好了。' },
  ];

  const build = (input: Partial<BuildTurnInput>): ExecutionShell[] =>
    shellsOf(buildTurnBlocks({ events: NOTHING, runStatus: 'succeeded', ...input }));

  it('两头都取不到:壳头不显示耗时,而不是编一个 0s,也不抛', () => {
    const shells = build({});
    expect(shells).toHaveLength(1);
    expect(shells[0]!.elapsedMs).toBeNull();
    expect(headText(shells[0]!)).toBeNull();
  });

  it('只缺一头也一样 —— 缺就是缺,不拿另一头顶上', () => {
    expect(headText(build({ startedAtMs: 1_000_000 })[0]!)).toBeNull();
    expect(headText(build({ endedAtMs: 1_042_000 })[0]!)).toBeNull();
  });

  it('两头都有就必须报出来 —— 同一批数据不许一会儿有一会儿没有', () => {
    expect(headText(build({ startedAtMs: 1_000_000, endedAtMs: 1_042_000 })[0]!)).toBe('42s');
  });
});
