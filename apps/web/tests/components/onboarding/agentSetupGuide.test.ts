import { describe, expect, it } from 'vitest';
import {
  agentSetupGuide,
  missingAgentGuides,
  safeAgentUrl,
} from '../../../src/components/onboarding/agentSetupGuide';
import type { AgentInfo } from '../../../src/types';

describe('agent setup guide', () => {
  it('knows install and sign-in commands for every productized local agent', () => {
    expect(agentSetupGuide('codex')).toMatchObject({ signInCommand: 'codex login' });
    expect(agentSetupGuide('claude')?.installCommand).toContain('@anthropic-ai/claude-code');
    expect(agentSetupGuide('opencode')?.installCommand).toContain('opencode-ai');
    expect(agentSetupGuide('unknown-agent')).toBeNull();
    expect(agentSetupGuide(null)).toBeNull();
  });

  it('joins daemon-reported names and vendor links in a stable order', () => {
    const agents: AgentInfo[] = [
      { id: 'opencode', name: 'OpenCode CLI', bin: 'opencode', available: false },
      { id: 'codex', name: 'Codex', bin: 'codex', available: false, installUrl: 'https://github.com/openai/codex' },
    ];
    const guides = missingAgentGuides(agents);
    expect(guides.map((guide) => guide.id)).toEqual(['codex', 'claude', 'opencode']);
    expect(guides[0]).toMatchObject({ name: 'Codex', installUrl: 'https://github.com/openai/codex' });
    expect(guides[1]).toMatchObject({ name: 'Claude Code', installUrl: null });
    expect(guides[2]?.name).toBe('OpenCode CLI');
  });

  it('only lets onboarding open HTTPS vendor pages', () => {
    expect(safeAgentUrl('https://opencode.ai/docs')).toBe('https://opencode.ai/docs');
    expect(safeAgentUrl('http://example.com')).toBeNull();
    expect(safeAgentUrl('javascript:alert(1)')).toBeNull();
    expect(safeAgentUrl(undefined)).toBeNull();
  });
});
