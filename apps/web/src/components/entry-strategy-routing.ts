import type { ProjectMetadata } from '@openpixo/contracts';
interface EntryStrategyRoutingInput { skillId?: string | null; pluginInputs?: Record<string, unknown> | null; }
export type EntryStrategyRoutingFields = { skillId: string | null; pluginInputs?: Record<string, unknown> };
export function entryStrategyRoutingFields(input: EntryStrategyRoutingInput, _metadata: ProjectMetadata): EntryStrategyRoutingFields {
  return { skillId: input.skillId ?? null, ...(input.pluginInputs ? { pluginInputs: input.pluginInputs } : {}) };
}
