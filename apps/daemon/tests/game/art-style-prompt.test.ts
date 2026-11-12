import { describe, expect, it } from 'vitest';
import { composeGameSystemPrompt } from '../../src/game/prompt.js';
import { computeStableSectionHashes, diffStableSections } from '../../src/runtimes/stable-prompt-sections.js';

const artStyle = {
  id: 'test-ink-style',
  title: 'Ink silhouettes',
  prompt: 'Broad ink silhouettes with carved white highlights.',
  negativePrompt: 'smooth gradients',
  palette: ['#171717', '#F2EDD8'],
  constraints: { background: 'transparent' as const },
};

describe('project art style in daemon prompts', () => {
  it('forwards the explicit project style through the shared game composer', () => {
    const styled = composeGameSystemPrompt({ baseDir: '/game', artStyle });
    const unstyled = composeGameSystemPrompt({ baseDir: '/game' });

    expect(styled).toContain(artStyle.title);
    expect(styled).toContain(artStyle.id);
    expect(styled).toContain(artStyle.prompt);
    expect(styled).toContain(artStyle.negativePrompt);
    expect(unstyled).not.toContain(artStyle.prompt);
  });

  it('attributes style changes, selection and removal to media prefix drift', () => {
    const base = { baseDir: '/game', locale: 'en' };
    const unstyled = computeStableSectionHashes(base);
    const selected = computeStableSectionHashes({ ...base, artStyle });
    const changed = computeStableSectionHashes({
      ...base,
      artStyle: { ...artStyle, prompt: 'Fine ink hatching and pale paper.' },
    });

    expect(diffStableSections(unstyled, selected)).toEqual(['media']);
    expect(diffStableSections(selected, changed)).toEqual(['media']);
    expect(diffStableSections(selected, unstyled)).toEqual(['media']);
    expect(diffStableSections(selected, computeStableSectionHashes({ ...base, artStyle }))).toEqual([]);
  });
});