import { describe, expect, it } from 'vitest';
import { agentIdToTracking } from '@openpixo/contracts/analytics';
import { SHIPPED_AGENT_DEFS } from '../../src/runtimes/registry.js';

// Every certified adapter has a stable analytics id; unknown saved ids use other.
describe('every shipped agent has its own analytics id', () => {
  it('maps no shipped agent to the catch-all bucket', () => {
    const collapsed = SHIPPED_AGENT_DEFS.map((def) => def.id)
      .filter((id) => agentIdToTracking(id) === 'other')
      .sort();

    expect(collapsed).toEqual([]);
  });

  it('still buckets an unknown id as other', () => {
    expect(agentIdToTracking('my-custom-agent')).toBe('other');
    expect(agentIdToTracking('not-a-shipped-agent')).toBe('other');
    expect(agentIdToTracking(null)).toBe('other');
  });
});
