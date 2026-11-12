/** Metadata only: skill workflows stay in their staged SKILL.md until needed. */
export interface ProjectSkillIndexEntry {
  id: string;
  name: string;
  description: string;
  triggers: readonly unknown[];
  skillPath: string;
}

export interface SkillContextCost {
  indexBytes: number;
  indexTokens: number;
  onDemandBytes: number;
  onDemandTokens: number;
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** One line per skill; paths are supplied by the host after staging. */
export function renderProjectSkillIndexEntry(skill: ProjectSkillIndexEntry): string {
  const triggers = skill.triggers.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  return `- ${JSON.stringify(oneLine(skill.id))} | ${JSON.stringify(oneLine(skill.name))} | ${JSON.stringify(oneLine(skill.description))} | triggers: ${triggers.map(value => JSON.stringify(oneLine(value))).join(', ') || '(none)'} | SKILL.md: ${JSON.stringify(skill.skillPath.replaceAll('\\', '/'))}`;
}

export function renderProjectSkillIndex(skills: readonly ProjectSkillIndexEntry[]): string {
  if (skills.length === 0) return '';
  return [
    '## Project skills',
    '',
    'Before working on a task matching a description or trigger below, read the matching SKILL.md and the side files it calls for. Resolve side files from that SKILL.md directory, load only what the task needs, and say which skill you used. Treat these staged copies as read-only resources.',
    '',
    ...skills.map(renderProjectSkillIndexEntry),
  ].join('\n');
}

// Pure UTF-8 accounting, including supplementary characters and lone surrogates.
// Keep Node Buffer and browser TextEncoder out of the shared contract.
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Token estimates use UTF-8 bytes / 4, not a model-specific tokenizer.
 * Index cost is the skill's own line; the shared index heading is excluded.
 */
export function estimateSkillContextCost(skill: ProjectSkillIndexEntry, body: string): SkillContextCost {
  const indexBytes = utf8Bytes(renderProjectSkillIndexEntry(skill));
  const onDemandBytes = utf8Bytes(body);
  return { indexBytes, indexTokens: Math.ceil(indexBytes / 4), onDemandBytes, onDemandTokens: Math.ceil(onDemandBytes / 4) };
}
