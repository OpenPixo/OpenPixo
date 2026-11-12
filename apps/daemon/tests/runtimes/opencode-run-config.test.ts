import { describe, expect, it } from 'vitest';

import { buildOpenCodeMcpConfigContent } from '../../src/mcp-config.js';
import { openCodeRunExtraConfig } from '../../src/runtimes/opencode-permissions.js';

const PROVIDER = { provider: { x: { name: 'x' } } };

function permissionOf(config: Record<string, unknown> | null): Record<string, unknown> {
  return (config?.permission ?? {}) as Record<string, unknown>;
}

describe('skills on the bundled OpenCode', () => {
  it.each(['byok-opencode', 'openpixo-agent'])('denies OpenCode skills for %s and keeps its provider', (agentId) => {
    const config = openCodeRunExtraConfig(agentId, PROVIDER, false);
    expect(permissionOf(config).skill).toBe('deny');
    expect(config?.provider).toEqual(PROVIDER.provider);
  });

  it('denies them even when the run brings no provider config', () => {
    expect(permissionOf(openCodeRunExtraConfig('openpixo-agent', null, false)).skill).toBe('deny');
  });

  it('keeps the deny and the read-only rules together on a read-only turn', () => {
    const permission = permissionOf(openCodeRunExtraConfig('openpixo-agent', PROVIDER, true));
    expect(permission.skill).toBe('deny');
    expect(permission.edit).toBe('deny');
    expect(Object.entries(permission.bash as Record<string, string>)[0]).toEqual(['*', 'deny']);
  });

  it('survives into the config OpenCode receives, next to the directory grants', () => {
    const extraConfig = openCodeRunExtraConfig('byok-opencode', PROVIDER, false)!;
    const content = JSON.parse(buildOpenCodeMcpConfigContent([], {}, { allowedDirectories: ['/game'], extraConfig })!);
    expect(content.permission.skill).toBe('deny');
    expect(content.permission.external_directory).toBeDefined();
    expect(content.provider).toEqual(PROVIDER.provider);
  });

  it("does not change the user's own OpenCode CLI", () => {
    expect(openCodeRunExtraConfig('opencode', null, false)).toBeNull();
    const readOnly = permissionOf(openCodeRunExtraConfig('opencode', null, true));
    expect(readOnly.edit).toBe('deny');
    expect(readOnly.skill).toBeUndefined();
  });

  it.each(['claude', 'codex'])('adds nothing for %s', (agentId) => {
    expect(openCodeRunExtraConfig(agentId, null, false)).toBeNull();
  });
});
