// Plan §3.3 of plugin-driven-flow-plan — kind → bundled scenario plugin
// mapping. Web (`EntryShell`) and daemon (`/api/projects`, `/api/runs`)
// share this resolver; the test pins the table so a drift between the
// two surfaces is impossible.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENARIO_PLUGIN_BY_KIND,
  defaultScenarioPluginIdForKind,
  defaultScenarioPluginIdForProjectMetadata,
  defaultScenarioTaskProfileForProjectMetadata,
} from '../src/plugins/scenario-defaults.js';

describe('defaultScenarioPluginIdForKind', () => {
  it('binds media kinds and leaves retired catalogue kinds unbound', () => {
    const expected: Record<string, string | null> = {
      prototype: null,
      deck:      null,
      template:  null,
      brand:     null,
      image:     'pixo-media-generation',
      video:     'pixo-media-generation',
      audio:     'pixo-media-generation',
      other:     null,
    };
    for (const [kind, pluginId] of Object.entries(expected)) {
      expect(defaultScenarioPluginIdForKind(kind as never)).toBe(pluginId);
      expect(DEFAULT_SCENARIO_PLUGIN_BY_KIND[kind as never]).toBe(pluginId);
    }
  });

  it('returns null for an undefined kind so the daemon can skip the fallback', () => {
    expect(defaultScenarioPluginIdForKind(undefined)).toBeNull();
  });

  it('keeps HyperFrames explicit while ordinary media stays generic', () => {
    expect(defaultScenarioPluginIdForProjectMetadata({
      kind: 'prototype',
      intent: 'marketing',
    })).toBeNull();
    expect(defaultScenarioPluginIdForProjectMetadata({
      kind: 'video',
      intent: 'hyperframes',
    })).toBe('example-hyperframes');
    expect(defaultScenarioPluginIdForProjectMetadata({ kind: 'image' }))
      .toBe('pixo-media-generation');
    expect(defaultScenarioPluginIdForProjectMetadata({ kind: 'video' }))
      .toBe('pixo-media-generation');
  });

  it('attaches an automatic task profile only to the retained HyperFrames route', () => {
    expect(defaultScenarioTaskProfileForProjectMetadata(
      { kind: 'video', intent: 'hyperframes' },
      'example-hyperframes',
    )).toBe('hyperframes');
    expect(defaultScenarioTaskProfileForProjectMetadata(
      { kind: 'video', intent: 'hyperframes' },
      'pixo-media-generation',
    )).toBeNull();
    expect(defaultScenarioTaskProfileForProjectMetadata(
      { kind: 'prototype', intent: 'hyperframes' },
      'example-hyperframes',
    )).toBeNull();
    expect(defaultScenarioTaskProfileForProjectMetadata(
      { kind: 'video' },
      'example-hyperframes',
    )).toBeNull();
    expect(defaultScenarioTaskProfileForProjectMetadata(
      undefined,
      'example-hyperframes',
    )).toBeNull();
  });

  it('does not bind a deleted free-form fallback or creation intent', () => {
    expect(DEFAULT_SCENARIO_PLUGIN_BY_KIND.other).toBeNull();
    for (const intent of [
      'live-artifact', 'web-clone', 'motion-design', 'marketing', 'webgl-experience',
    ] as const) {
      expect(defaultScenarioPluginIdForProjectMetadata({ kind: 'video', intent })).toBeNull();
      expect(defaultScenarioPluginIdForProjectMetadata({ kind: 'prototype', intent })).toBeNull();
    }
  });
});
