import { describe, expect, it } from 'vitest';

import { buildOpenCodeMcpConfigContent } from '../../src/mcp-config.js';
import { OPENCODE_TOOL_OUTPUT_LIMITS, openCodeRunExtraConfig } from '../../src/runtimes/opencode-permissions.js';

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

  it.each(['byok-opencode', 'openpixo-agent'])('turns off file snapshots for %s, on every kind of turn', (agentId) => {
    // Two whole-folder git snapshots per model step cost about 2.5 s of a 4 to 5 s Flash step.
    expect(openCodeRunExtraConfig(agentId, PROVIDER, false)?.snapshot).toBe(false);
    expect(openCodeRunExtraConfig(agentId, null, true)?.snapshot).toBe(false);
    expect(openCodeRunExtraConfig(agentId, PROVIDER, false, ['AGENTS.md'])?.snapshot).toBe(false);
    const content = JSON.parse(buildOpenCodeMcpConfigContent([], {}, {
      allowedDirectories: ['/game'], extraConfig: openCodeRunExtraConfig(agentId, PROVIDER, false)!,
    })!);
    expect(content.snapshot).toBe(false);
  });

  it.each(['byok-opencode', 'openpixo-agent'])('caps what one tool call adds to the conversation for %s', (agentId) => {
    // OpenCode's own 50 KB let one folder listing add about 15k tokens, paid again on every later request.
    for (const readOnly of [false, true]) {
      expect(openCodeRunExtraConfig(agentId, PROVIDER, readOnly)?.tool_output).toEqual(OPENCODE_TOOL_OUTPUT_LIMITS);
    }
    expect(OPENCODE_TOOL_OUTPUT_LIMITS.max_bytes).toBeLessThanOrEqual(16 * 1024);
    expect(openCodeRunExtraConfig('opencode', null, false)).toBeNull();
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
