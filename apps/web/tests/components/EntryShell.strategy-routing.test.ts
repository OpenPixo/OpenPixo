import { describe, expect, it } from 'vitest';
import { entryStrategyRoutingFields } from '../../src/components/entry-strategy-routing';
describe('ordinary project creation inputs', () => {
  it('keeps the selected skill and ordinary plugin inputs', () => {
    expect(entryStrategyRoutingFields({ skillId: 'asset-check', pluginInputs: { subject: 'Game assets' } }, { kind: 'other', baseDir: '/game' })).toEqual({ skillId: 'asset-check', pluginInputs: { subject: 'Game assets' } });
  });
  it('does not synthesize a skill or plugin inputs', () => {
    expect(entryStrategyRoutingFields({}, { kind: 'prototype' })).toEqual({ skillId: null });
  });
});
