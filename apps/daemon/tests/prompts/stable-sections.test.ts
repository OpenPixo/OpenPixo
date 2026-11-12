import { describe, expect, it } from 'vitest';

import {
  computeStableSectionHashes,
  describeChangedStableSections,
  diffStableSections,
  parseStableSections,
  serializeStableSections,
  STABLE_SECTION_NAMES,
} from '../../src/runtimes/stable-prompt-sections.js';

// A minimal set of inputs standing in for one turn's stable prefix. Only the
// keys a section actually reads matter; everything else is ignored by design so
// adding an unrelated composer argument cannot silently join a section.
const BASE = {
  agentId: 'claude',
  userInstructions: '## Personal memory\n\n- prefers terse copy',
  sessionMode: 'design',
  skillBody: '# Skill\n\nbuild a deck',
  locale: 'en',
  runtimeToolPrompt: '## Tools\n\n- pixo_read',
  clientSystemPrompt: 'be helpful',
};

describe('computeStableSectionHashes', () => {
  it('is deterministic for the same inputs', () => {
    expect(computeStableSectionHashes(BASE)).toEqual(computeStableSectionHashes({ ...BASE }));
  });

  it('ignores the order keys were built in', () => {
    const reordered = Object.fromEntries(Object.entries(BASE).reverse());
    expect(computeStableSectionHashes(reordered)).toEqual(computeStableSectionHashes(BASE));
  });

  it('hashes nested objects by value, not by key insertion order', () => {
    const a = { ...BASE, engineProfile: { engine: 'phaser', confidence: 'certain' } };
    const b = { ...BASE, engineProfile: { confidence: 'certain', engine: 'phaser' } };
    expect(computeStableSectionHashes(a).project).toBe(computeStableSectionHashes(b).project);
  });

  it('omits a section whose inputs are all absent rather than hashing it as empty', () => {
    const hashes = computeStableSectionHashes({ userInstructions: 'x' });
    expect(hashes.instructions).toBeTypeOf('string');
    expect(hashes).not.toHaveProperty('design-system');
    expect(hashes).not.toHaveProperty('critique');
  });

  it('leaves the mcp section dormant: #5336 removed that input from the prefix', () => {
    // The section exists to catch a live-OAuth input being re-admitted to the
    // cached prefix. Nothing passes `connectedExternalMcp` today, so it must
    // stay absent — a hash here would mean the mistake is back.
    expect(computeStableSectionHashes(BASE)).not.toHaveProperty('mcp');
    expect(computeStableSectionHashes({ ...BASE, connectedExternalMcp: [{ id: 'github' }] }))
      .not.toHaveProperty('mcp');
  });
});

describe('diffStableSections', () => {
  it('names only the section whose input moved', () => {
    const before = computeStableSectionHashes(BASE);
    const after = computeStableSectionHashes({ ...BASE, userInstructions: `${BASE.userInstructions}\n- likes dark mode` });
    expect(diffStableSections(before, after)).toEqual(['instructions']);
  });

  it('names every section that moved, in declaration order', () => {
    const before = computeStableSectionHashes(BASE);
    const after = computeStableSectionHashes({
      ...BASE,
      userInstructions: 'changed',
      sessionMode: 'plan',
    });
    expect(diffStableSections(before, after)).toEqual(['mode', 'instructions']);
  });

  it('treats a section appearing for the first time as a change', () => {
    const before = computeStableSectionHashes({ agentId: 'claude' });
    const after = computeStableSectionHashes({ agentId: 'claude', userInstructions: 'first fact' });
    expect(diffStableSections(before, after)).toEqual(['instructions']);
  });

  it('treats a section disappearing as a change', () => {
    const before = computeStableSectionHashes({ agentId: 'claude', userInstructions: 'a fact' });
    const after = computeStableSectionHashes({ agentId: 'claude' });
    expect(diffStableSections(before, after)).toEqual(['instructions']);
  });

  it('reports nothing when the inputs are unchanged', () => {
    const hashes = computeStableSectionHashes(BASE);
    expect(diffStableSections(hashes, hashes)).toEqual([]);
  });

  it('treats a missing baseline as everything-changed', () => {
    expect(diffStableSections(null, computeStableSectionHashes(BASE)).length).toBeGreaterThan(0);
  });
});

describe('describeChangedStableSections', () => {
  it('reports the changed section for an attributable drift', () => {
    const before = computeStableSectionHashes(BASE);
    const after = computeStableSectionHashes({ ...BASE, skillBody: 'a different skill' });
    expect(describeChangedStableSections(before, after)).toEqual(['skill']);
  });

  it('reports `unattributed` when the prefix drifted but no tracked section did', () => {
    // The caller only asks once the overall hash already moved, so "nothing
    // changed" can only mean the input that moved is missing from the section
    // table — a coverage gap that has to be visible, not silently clean.
    const hashes = computeStableSectionHashes(BASE);
    expect(describeChangedStableSections(hashes, hashes)).toEqual(['unattributed']);
  });
});

describe('serializeStableSections / parseStableSections', () => {
  it('round-trips', () => {
    const hashes = computeStableSectionHashes(BASE);
    expect(parseStableSections(serializeStableSections(hashes))).toEqual(hashes);
  });

  it('reads a legacy row with no stored sections as null', () => {
    expect(parseStableSections(null)).toBeNull();
    expect(parseStableSections('')).toBeNull();
  });

  it('degrades to null on malformed JSON instead of throwing', () => {
    // A row written by another daemon build must never break the turn.
    expect(parseStableSections('{not json')).toBeNull();
    expect(parseStableSections('[]')).toBeNull();
    expect(parseStableSections('"a string"')).toBeNull();
  });

  it('drops entries that are not known sections with string digests', () => {
    const parsed = parseStableSections(
      JSON.stringify({ instructions: 'abc123', unknownSection: 'def', mode: 42 }),
    );
    expect(parsed).toEqual({ instructions: 'abc123' });
  });
});

describe('section table', () => {
  it('covers the sections the drift investigation asked for', () => {
    // Minimum split agreed in the 0.14.1 drift investigation, so telemetry can
    // answer "which part moved" without a hand diff of Langfuse prompts.
    for (const name of ['instructions', 'project', 'mode', 'skill', 'runtime']) {
      expect(STABLE_SECTION_NAMES).toContain(name);
    }
  });
});
