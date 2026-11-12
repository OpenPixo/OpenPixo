import type { SkillInfo } from '../skills.js';

export interface DefaultProjectSkillInput {
  /** Functional skills only: built-in plus the user's own. */
  catalog: readonly SkillInfo[];
  /** The project's engine. Absent or `unknown` means nothing can be ruled out yet. */
  engine?: string | null | undefined;
  /** Skills the user switched off in Settings. */
  disabledSkills?: readonly string[] | null | undefined;
  /** Skills this project already handles itself: added, switched off, or selected for the turn. */
  excludeIds?: readonly string[];
}

/**
 * The skills a project's agent is told about without anyone enabling them.
 *
 * Only their index lines go into the prompt, and the agent reads a workflow when a
 * task calls for it. A built-in skill must be a plain workflow (`mode: utility`);
 * anything else depends on a tool OpenPixo does not provide. A skill that names its
 * engines (`pixo.engines`) is left out of a project on any other engine.
 */
export function selectDefaultProjectSkills({
  catalog, engine, disabledSkills, excludeIds = [],
}: DefaultProjectSkillInput): SkillInfo[] {
  const off = new Set([...(disabledSkills ?? []), ...excludeIds]);
  const knownEngine = engine && engine !== 'unknown' ? engine : null;
  return catalog.filter((skill) => {
    if (skill.id.includes(':') || off.has(skill.id)) return false;
    if (skill.source !== 'user' && skill.mode !== 'utility') return false;
    return skillFitsEngine(skill, knownEngine);
  });
}

/**
 * Whether a skill belongs in a project on this engine: one that names its engines
 * (`pixo.engines`) fits only those, and an absent or `unknown` engine rules nothing out.
 */
export function skillFitsEngine(skill: Pick<SkillInfo, 'engines'>, engine: string | null | undefined): boolean {
  const knownEngine = engine && engine !== 'unknown' ? engine : null;
  return !knownEngine || !skill.engines?.length || skill.engines.includes(knownEngine);
}
