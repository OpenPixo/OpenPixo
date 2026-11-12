// Default scenario plugin bindings (plan §3.3 of plugin-driven-flow-plan).
//
// Both the web client (`EntryShell.handleCreate`) and the daemon
// (`/api/projects` + `/api/runs`) need to know which bundled scenario
// plugin to bind when the caller didn't pick one explicitly. Keeping
// the mapping in contracts lets both sides import the same table so the
// client and the server never disagree about what counts as the
// "default" plugin for a given project kind or creation intent.
//
// Bind only retained bundled workflows. Other project kinds and retired
// creation intents have no automatic plugin; an explicit user selection
// remains independent of this fallback table.

import type {
  ProjectKind,
  ProjectMetadata,
  ProjectScenarioTaskProfile,
} from '../api/projects.js';

// Kept as a string-literal union so both hosts can bind only retained defaults.
export type DefaultScenarioPluginId =
  | 'pixo-media-generation'
  | 'pixo-plugin-authoring'
  | 'example-hyperframes';

export const DEFAULT_SCENARIO_PLUGIN_BY_KIND: Record<ProjectKind, DefaultScenarioPluginId | null> = {
  prototype: null,
  deck:      null,
  template:  null,
  brand:     null,
  image:     'pixo-media-generation',
  video:     'pixo-media-generation',
  audio:     'pixo-media-generation',
  other:     null,
};

export function defaultScenarioPluginIdForKind(
  kind: ProjectKind | undefined,
): DefaultScenarioPluginId | null {
  if (!kind) return null;
  return DEFAULT_SCENARIO_PLUGIN_BY_KIND[kind] ?? null;
}

export function defaultScenarioPluginIdForProjectMetadata(
  metadata: Pick<ProjectMetadata, 'kind' | 'intent'> | null | undefined,
): DefaultScenarioPluginId | null {
  if (
    metadata?.intent === 'live-artifact'
    || metadata?.intent === 'web-clone'
    || metadata?.intent === 'motion-design'
    || metadata?.intent === 'marketing'
    || metadata?.intent === 'webgl-experience'
  ) return null;
  if (metadata?.intent === 'hyperframes') return 'example-hyperframes';
  return defaultScenarioPluginIdForKind(metadata?.kind);
}

/** Attach the retained HyperFrames profile only to its exact automatic binding. */
export function defaultScenarioTaskProfileForProjectMetadata(
  metadata: Pick<ProjectMetadata, 'kind' | 'intent' | 'fidelity' | 'platform' | 'platformTargets'>
    | null
    | undefined,
  pluginId: string,
): ProjectScenarioTaskProfile | null {
  return metadata?.kind === 'video'
    && metadata.intent === 'hyperframes'
    && pluginId === 'example-hyperframes'
    ? 'hyperframes'
    : null;
}
