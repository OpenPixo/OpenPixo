import path from 'node:path';
import type Database from 'better-sqlite3';
import type { StoreCatalogItem } from '@openpixo/contracts';
import type { SkillInfo } from '../skills.js';
import { storeEntries } from './catalog.js';

/** A skill the agent is offered in every project without anyone adding it. */
export interface BuiltInSkill { id: string; dir: string; enabled: boolean }

/**
 * The skills `selectDefaultProjectSkills` can offer: shipped with the app, plain
 * workflows (`mode: utility`), not namespaced. `enabled` follows the Settings switch.
 * Engine fit is left out on purpose: a Phaser skill is still built in for Phaser games.
 */
export function builtInSkills(catalog: readonly SkillInfo[], disabledSkills: readonly string[] | null | undefined): BuiltInSkill[] {
  const off = new Set(disabledSkills ?? []);
  return catalog
    .filter((skill) => skill.source === 'built-in' && skill.mode === 'utility' && !skill.id.includes(':'))
    .map((skill) => ({ id: skill.id, dir: skill.dir, enabled: !off.has(skill.id) }));
}

const samePath = (value: string) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/**
 * Marks the Workshop's bundled skill entries that are one of those built-in skills,
 * matched by folder, so the Workshop says "built in" instead of offering an install
 * that would change nothing for the agent.
 */
export function withBuiltInSkills<T extends StoreCatalogItem>(
  db: Database.Database,
  items: T[],
  skills: readonly BuiltInSkill[],
): T[] {
  if (!skills.length) return items;
  const byDir = new Map(skills.map((skill) => [samePath(skill.dir), skill]));
  const sources = new Map<string, string>();
  for (const { entry, marketplace } of storeEntries(db)) {
    if (entry.kind === 'skill' && marketplace.url.startsWith('bundled:') && path.isAbsolute(entry.source)) {
      sources.set(entry.name.toLowerCase(), samePath(entry.source));
    }
  }
  return items.map((item) => {
    const source = sources.get(item.name.toLowerCase());
    const skill = source ? byDir.get(source) : undefined;
    return skill ? { ...item, builtIn: { skillId: skill.id, enabled: skill.enabled } } : item;
  });
}
