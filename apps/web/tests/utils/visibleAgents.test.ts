import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../src/types';
import {
  availableVisibleAgentCount,
  resolveAvailableAgentId,
  isVisibleLocalCliAgent,
} from '../../src/utils/visibleAgents';

function agent(partial: Partial<AgentInfo> & { id: string }): AgentInfo {
  return {
    name: partial.id,
    bin: partial.id,
    models: [],
    modelsSource: 'fallback',
    available: false,
    ...partial,
  } as AgentInfo;
}

describe('availableVisibleAgentCount', () => {
  // The rescan notice and the list underneath it must agree. `byok-opencode`
  // is available whenever OpenCode is installed but is never rendered, so
  // counting the raw detection list announced one more CLI than the user
  // could see — "3 available" sitting above a two-row list.
  it('excludes agents that are hidden from the picker', () => {
    const agents = [
      agent({ id: 'amr', available: true }),
      agent({ id: 'deepseek', available: true }),
      agent({ id: 'byok-opencode', available: true }),
    ];

    expect(agents.filter((a) => a.available).length).toBe(3);
    expect(availableVisibleAgentCount(agents)).toBe(2);
  });

  it('ignores unavailable agents', () => {
    const agents = [
      agent({ id: 'amr', available: true }),
      agent({ id: 'codex', available: false }),
    ];

    expect(availableVisibleAgentCount(agents)).toBe(1);
  });

  it('counts nothing when every agent is hidden or unavailable', () => {
    expect(
      availableVisibleAgentCount([
        agent({ id: 'byok-opencode', available: true }),
        agent({ id: 'codex', available: false }),
      ]),
    ).toBe(0);
  });
});

describe('isVisibleLocalCliAgent', () => {
  it('hides only the internal BYOK OpenCode runtime', () => {
    expect(isVisibleLocalCliAgent({ id: 'byok-opencode' })).toBe(false);
    expect(isVisibleLocalCliAgent({ id: 'opencode' })).toBe(true);
  });
});

describe('resolveAvailableAgentId', () => {
  it('falls back from a retired saved runtime without mutating its input', () => {
    const savedId = 'deepseek-harness';
    const agents = [agent({ id: 'claude', available: true }), agent({ id: 'codex', available: true })];
    expect(resolveAvailableAgentId(savedId, agents)).toBe('codex');
    expect(savedId).toBe('deepseek-harness');
    expect(agents.map((candidate) => candidate.id)).toEqual(['claude', 'codex']);
  });
  it('uses another available kept CLI when Codex is unavailable', () => {
    expect(resolveAvailableAgentId('gemini', [agent({ id: 'codex' }), agent({ id: 'claude', available: true })])).toBe('claude');
    expect(resolveAvailableAgentId('gemini', [agent({ id: 'opencode', available: true })])).toBe('opencode');
  });
  it('returns the normal no-agent state when no runtime is available', () => {
    expect(resolveAvailableAgentId('gemini', [agent({ id: 'codex' })])).toBeNull();
  });
  it.each(['codex', 'claude', 'opencode', 'byok-opencode', 'mock'])('preserves the selected kept runtime %s during a probe', (id) => {
    expect(resolveAvailableAgentId(id, [])).toBe(id);
  });
  it('preserves authoritative test-agent entries from the daemon', () => {
    const agents = [agent({ id: 'mock-agent', available: true })];
    expect(resolveAvailableAgentId('mock-agent', agents)).toBe('mock-agent');
    expect(resolveAvailableAgentId('gemini', agents)).toBe('mock-agent');
  });
});
