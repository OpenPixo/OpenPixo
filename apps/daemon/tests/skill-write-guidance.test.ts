import { describe, expect, it } from 'vitest';
import { composeGameSystemPrompt } from '../src/game/prompt.js';

describe('game skill write boundary', () => {
  it('keeps enabled skills read-only and explains the staged-copy boundary and handover', () => {
    const prompt = composeGameSystemPrompt({ skillBody: '# Game skill' });
    for (const text of ['## Editing skills', 'read-only instructions', '.pixo-skills/', 'replaced on later turns', 'Do not bypass write restrictions', 'new Markdown file in the project', 'Integrations view\'s Skills tab', 'Do not invent sandbox or approval settings']) expect(prompt).toContain(text);
  });

  it('keeps the boundary when project extension skills are appended after composition', () => {
    const prompt = composeGameSystemPrompt({});
    expect(prompt).toContain('Enabled skill directories are read-only instructions');
    expect(prompt).toContain('replaced on later turns');
    expect(prompt).toContain("Integrations view's Skills tab");
  });
});
