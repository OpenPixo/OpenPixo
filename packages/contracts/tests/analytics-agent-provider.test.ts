import { describe, expect, it } from 'vitest';

import {
  agentIdToTracking,
} from '../src/analytics/events.js';

describe('agentIdToTracking', () => {

  it('keeps mapping known CLI agents and falls back to other for unknowns', () => {
    expect(agentIdToTracking('claude')).toBe('claude_code');
    expect(agentIdToTracking('codex')).toBe('codex_cli');
    expect(agentIdToTracking('opencode')).toBe('opencode');
    expect(agentIdToTracking('byok-opencode')).toBe('byok_opencode');
    expect(agentIdToTracking('openpixo-agent')).toBe('openpixo_agent');
    expect(agentIdToTracking('totally-unknown-agent')).toBe('other');
    expect(agentIdToTracking(null)).toBe('other');
    expect(agentIdToTracking(undefined)).toBe('other');
  });

  it.each([
    'aider', 'amp', 'antigravity', 'atomcode', 'codebuddy', 'copilot',
    'cursor-agent', 'deepseek', 'deepseek-harness', 'devin', 'gemini',
    'grok-build', 'hermes', 'kilo', 'kimi', 'kiro', 'mimo', 'pi',
    'qoder', 'qwen', 'reasonix', 'trae-cli', 'vibe',
  ])('buckets a retired saved runtime id as other: %s', (agentId) => {
    expect(agentIdToTracking(agentId)).toBe('other');
  });
});
