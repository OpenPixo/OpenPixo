import { describe, expect, it } from 'vitest';
import { FIRST_RUN_GUIDE_STEPS, nextFirstRunGuideStep, parseFirstRunGuide } from '../src/api/first-run-guide.js';

describe('first-login walkthrough state', () => {
  it('keeps what it knows and drops the rest', () => {
    expect(parseFirstRunGuide({ status: 'active', step: 'ask', projectId: 'p1', hintsSeen: ['share', 'plan', 'nope', 'plan'], extra: true }))
      .toEqual({ status: 'active', step: 'ask', projectId: 'p1', hintsSeen: ['plan', 'share'] });
    expect(parseFirstRunGuide({ status: 'done', step: 'make', projectId: '', hintsSeen: 'plan' })).toEqual({ status: 'done', step: 'make' });
    expect(parseFirstRunGuide({ status: 'done', step: 'make', projectId: 'x'.repeat(201) })).toEqual({ status: 'done', step: 'make' });
  });

  it('reads a bare status as shorthand, and nothing else', () => {
    expect(parseFirstRunGuide('skipped')).toEqual({ status: 'skipped', step: 'play' });
    for (const value of ['later', '', null, undefined, 1, [], {}, { status: 'active' }, { step: 'play' }, { status: 'active', step: 'fly' }]) {
      expect(parseFirstRunGuide(value)).toBeNull();
    }
  });

  it('walks the steps in order and ends', () => {
    expect(FIRST_RUN_GUIDE_STEPS.map(nextFirstRunGuideStep)).toEqual(['tune', 'ask', 'make', null]);
  });
});
