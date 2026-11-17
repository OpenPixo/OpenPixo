import { describe, expect, it } from 'vitest';
import { buildOpenPixoAgentOpenCodeConfig } from '../../src/openpixo-agent/runtime.js';
import {
  OPENCODE_BUILD_AGENT_STEPS,
  OPENPIXO_OPENCODE_AGENT_PROMPT,
  openCodeBuildAgentConfig,
  openCodeUsesDefaultPrompt,
} from '../../src/runtimes/opencode-build-agent.js';

const buildAgent = (model: string) => (buildOpenPixoAgentOpenCodeConfig('http://127.0.0.1:1', model).agent as Record<string, any>).build;

describe('bundled OpenCode build agent', () => {
  it('replaces the terminal default prompt only where OpenCode 1.18.35 would use it', () => {
    // No family OpenCode knows: its default prompt, the one that says to stay silent.
    for (const model of ['openpixo-agent-flash', 'openpixo-agent-glm-5-3-flash', 'deepseek-chat', 'qwen3-coder']) {
      expect(openCodeUsesDefaultPrompt(model), model).toBe(true);
    }
    // Families with their own prompt, which already asks GPT-6 for progress updates.
    for (const model of ['openpixo-agent-gpt-6-luna', 'openpixo-agent-claude-sonnet-5-5', 'gemini-3-pro', 'Kimi-K3', 'arcee-trinity', 'o3-mini']) {
      expect(openCodeUsesDefaultPrompt(model), model).toBe(false);
    }
    expect(openCodeUsesDefaultPrompt('k2', 'moonshotai')).toBe(false);
  });

  it('gives every hosted run the step limit, and the OpenPixo prompt in place of the default one', () => {
    expect(buildAgent('openpixo-agent-flash')).toEqual({ steps: OPENCODE_BUILD_AGENT_STEPS, prompt: OPENPIXO_OPENCODE_AGENT_PROMPT });
    expect(buildAgent('openpixo-agent-gpt-6-luna')).toEqual({ steps: OPENCODE_BUILD_AGENT_STEPS });
    expect(buildAgent('openpixo-agent-claude-sonnet-5-5')).toEqual({ steps: OPENCODE_BUILD_AGENT_STEPS });
    expect(openCodeBuildAgentConfig('openpixo-agent-flash')).toEqual(buildAgent('openpixo-agent-flash'));
  });

  it('asks for progress in the chat and a reply once the request is done, not terminal silence', () => {
    expect(OPENPIXO_OPENCODE_AGENT_PROMPT).toContain('Before your first tool call');
    expect(OPENPIXO_OPENCODE_AGENT_PROMPT).toContain('Never make more than about 8 tool calls in a row without a line to the user');
    expect(OPENPIXO_OPENCODE_AGENT_PROMPT).toContain('Stop and reply as soon as the request is done');
    expect(OPENPIXO_OPENCODE_AGENT_PROMPT).toContain('step limit');
    // OpenCode's default prompt limits proactiveness; leaving that out let Flash add petals and hotkeys to a menu redo.
    expect(OPENPIXO_OPENCODE_AGENT_PROMPT).toContain('You may be proactive only within what the user asked for.');
    expect(OPENPIXO_OPENCODE_AGENT_PROMPT).toContain('Test the part you changed.');
    // Flash ran three playtests to measure enemy speed before changing anything (2026-11-16).
    expect(OPENPIXO_OPENCODE_AGENT_PROMPT).toContain('To find a cause or answer a question, read the code instead of playing the game.');
    // A walk turn printed whole manifests and folder trees and spent 29 credits on reading (2026-11-16).
    expect(OPENPIXO_OPENCODE_AGENT_PROMPT).toContain('Keep output small: list one folder, not a whole tree');
    expect(OPENPIXO_OPENCODE_AGENT_PROMPT).toContain('Old attempts, logs and derived files are not a reason to audit the project.');
    expect(OPENPIXO_OPENCODE_AGENT_PROMPT).toContain('Do not save screenshots, test scripts or reports into the project unless the user asks.');
    for (const terminal of ['fewer than 4 lines', 'One word answers', 'preamble', 'just stop']) {
      expect(OPENPIXO_OPENCODE_AGENT_PROMPT).not.toContain(terminal);
    }
  });
});
