import { z } from 'zod';

// PersistedAgentEvent plugin variants. Phase 1 ships the wire-format only
// (plan F2): web/CLI clients add case branches up front so Phase 2A landing
//
// These events are NOT yet emitted by the daemon — Phase 2A wires the

export const PluginPipelineStageEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind:      z.literal('pipeline_stage_started'),
    runId:     z.string(),
    snapshotId: z.string(),
    stageId:   z.string(),
    iteration: z.number().int().min(0),
    startedAt: z.number(),
  }),
  z.object({
    kind:        z.literal('pipeline_stage_completed'),
    runId:       z.string(),
    snapshotId:  z.string(),
    stageId:     z.string(),
    iteration:   z.number().int().min(0),
    completedAt: z.number(),
    converged:   z.boolean().optional(),
    diffSummary: z.string().optional(),
  }),
]);

export type PluginPipelineStageEvent = z.infer<typeof PluginPipelineStageEventSchema>;

// Joined union of all plugin-system event variants the daemon will append
// to the existing `PersistedAgentEvent` channel. Web/CLI clients should
// switch on the `kind` field first, then the discriminated union narrows.
export const PluginAgentEventSchema = PluginPipelineStageEventSchema;

export type PluginAgentEvent = z.infer<typeof PluginAgentEventSchema>;

export const PLUGIN_AGENT_EVENT_KINDS = [
  'pipeline_stage_started',
  'pipeline_stage_completed',] as const;

export type PluginAgentEventKind = typeof PLUGIN_AGENT_EVENT_KINDS[number];
