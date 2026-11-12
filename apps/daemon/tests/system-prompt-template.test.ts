import { describe, expect, it } from 'vitest';
import { renderConnectedExternalMcpDirective } from '../src/mcp/connected-directive.js';
import { composeGameSystemPrompt } from '../src/game/prompt.js';

describe('game system prompt', () => {
  it('keeps authenticated MCP tools callable without synthetic re-authentication', () => {
    expect(renderConnectedExternalMcpDirective([])).toBe('');
    const directive = renderConnectedExternalMcpDirective([{ id: 'game-tools', label: 'Game tools' }]);
    expect(directive).toContain('game-tools');
    expect(directive).toContain('already authenticated');
    expect(directive).toContain('Do NOT call');
    expect(directive).toContain('Integrations');
  });
  for (const baseDir of [undefined, 'C:/Games/Managed', 'C:/Games/Imported']) {
    it('uses the game composer for ' + (baseDir ?? 'a run without a project'), () => {
      const prompt = composeGameSystemPrompt({ baseDir, agentId: 'codex' });
      expect(prompt).toContain('# OpenPixo game development workbench');
      expect(prompt).toContain('update_plan');
      expect(prompt).toContain('has not identified');
      expect(prompt).not.toContain('Quick brief');
    });
  }
  it('keeps BYOK defaults, model allowlists, disabled policy and text-only limits', () => {
    const prompt = composeGameSystemPrompt({ agentId: 'byok-opencode', byokMediaDefaults: { imageModel: 'gpt-image-2' }, mediaExecution: { mode: 'enabled', allowedModels: ['gpt-image-2'] } });
    expect(prompt).toContain('todowrite');
    expect(prompt).toContain('gpt-image-2');
    expect(prompt).toContain('Models allowed this run');
    expect(composeGameSystemPrompt({ mediaExecution: { mode: 'disabled' } })).toContain('disabled for this run');
    const plain = composeGameSystemPrompt({ streamFormat: 'plain' });
    expect(plain).toContain('no filesystem or tool execution');
    expect(plain).not.toContain('media generate');
    expect(plain).not.toContain('game verify');
  });
  it('preserves Plan mode, instructions, skills, plugin stages and question forms', () => {
    const prompt = composeGameSystemPrompt({ sessionMode: 'plan', locale: 'zh-CN', userInstructions: 'User rule.', projectInstructions: 'Project rule.', skillName: 'Game skill', skillBody: 'Read references first.', pluginBlock: 'Enabled game plugin.', activeStageBlocks: ['Asset stage.'] });
    for (const text of ['wait for the user to request execution', 'zh-CN', 'User rule.', 'Project rule.', 'Game skill', 'Read references first.', 'Enabled game plugin.', 'Asset stage.', '<question-form', '"questions"']) expect(prompt).toContain(text);
  });
});
