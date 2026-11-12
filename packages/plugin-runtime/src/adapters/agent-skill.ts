import {
  OPENPIXO_PLUGIN_SPEC_VERSION,
  PluginExampleSchema,
  type InputField,
  type PluginManifest,
} from '@openpixo/contracts';
import { parseFrontmatter, type FrontmatterObject, type FrontmatterValue } from '../parsers/frontmatter.js';

// Adapter from a portable SKILL.md (with optional `pixo:` frontmatter, see
// docs/skills-protocol.md) to a synthesized PluginManifest. Spec invariant
// I1 demands this synthesizer always produce a schema-valid manifest for
// any SKILL.md that already carries the `pixo:` frontmatter we use today.
//
// Inputs:
//   - rawSkillMd: full SKILL.md file body (frontmatter + markdown).
//   - folderId: the folder/install id that the registry will use ("blog-post").
//   - opts.compatPath: relative path placed into `compat.agentSkills[].path`
//     so the daemon resolver can re-locate the SKILL.md from the manifest
//     alone. Defaults to "./SKILL.md".
//
// Output: { manifest, warnings } — warnings carry unmappable frontmatter
// fields (e.g. pixo.parameters live sliders that v1 manifest does not surface).

export interface AgentSkillAdapterOptions {
  folderId: string;
  compatPath?: string;
}

export interface AgentSkillAdapterResult {
  manifest: PluginManifest;
  warnings: string[];
  bodyMarkdown: string;
}

const ROLE_PARAMETER_KEYS = ['pixo.parameters'];

export function adaptAgentSkill(
  rawSkillMd: string,
  opts: AgentSkillAdapterOptions,
): AgentSkillAdapterResult {
  const { data: frontmatter, body } = parseFrontmatter(rawSkillMd);
  const pixo = isObject(frontmatter['pixo']) ? frontmatter['pixo'] : {};
  const warnings: string[] = [];

  const name = stringOr(frontmatter['name'], opts.folderId).trim() || opts.folderId;
  const titleI18n = localizedMapFromFields(frontmatter['en_name'], frontmatter['zh_name']);
  const title = stringOr(frontmatter['en_name'], '') || humanizeName(name);
  const descriptionI18n = localizedMapFromFields(
    frontmatter['en_description'],
    frontmatter['zh_description'],
  );
  const description = stringOr(frontmatter['en_description'], '') || stringOr(frontmatter['description'], '');
  const version = stringOr(frontmatter['version'], '0.0.0');
  const compatPath = opts.compatPath ?? './SKILL.md';
  const tags = stringArray(frontmatter['tags']);

  const designSystemFm = isObject(pixo['design_system']) ? pixo['design_system'] : null;
  const designSystem = designSystemFm
    ? {
        ref: stringOr(designSystemFm['ref'], '') || undefined,
        primary: typeof designSystemFm['primary'] === 'boolean' ? (designSystemFm['primary'] as boolean) : undefined,
      }
    : undefined;

  const inputs: InputField[] | undefined = mapInputs(pixo['inputs'], warnings);

  // pixo.parameters are deferred to Phase 4 per spec §5.4; record a warning so
  // doctor surfaces them instead of silently dropping.
  for (const key of ROLE_PARAMETER_KEYS) {
    const [namespace, sub] = key.split('.');
    if (namespace === 'pixo' && sub && Array.isArray(pixo[sub])) {
      warnings.push(`SKILL.md ${key} is preserved as adapter metadata; v1 manifest does not expose live sliders`);
    }
  }

  const previewFm = isObject(pixo['preview']) ? pixo['preview'] : null;
  const preview = previewFm
    ? {
        type: stringOr(previewFm['type'], '') || undefined,
        entry: stringOr(previewFm['entry'], '') || undefined,
      }
    : undefined;

  const manifest: PluginManifest = {
    specVersion: OPENPIXO_PLUGIN_SPEC_VERSION,
    name,
    title,
    title_i18n: titleI18n,
    version,
    description: description || undefined,
    description_i18n: descriptionI18n,
    examples: mapExamples(frontmatter['examples'], warnings),
    tags,
    compat: { agentSkills: [{ path: compatPath }] },
    pixo: {
      kind: 'skill',
      taskKind: stringOr(pixo['taskKind'], 'new-generation') as PluginManifest['pixo'] extends infer T ? T extends { taskKind?: infer K } ? K : never : never,
      mode: stringOr(pixo['mode'], '') || undefined,
      platform: stringOr(pixo['platform'], '') || undefined,
      scenario: stringOr(pixo['scenario'], '') || undefined,
      preview,
      useCase: { query: examplePromptFromFrontmatter(frontmatter, body) },
      context: {
        designSystem: designSystem ?? undefined,
      },
      inputs,
    },
  };

  return { manifest, warnings, bodyMarkdown: body };
}

function isObject(value: FrontmatterValue | undefined): value is FrontmatterObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOr(value: FrontmatterValue | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function localizedMapFromFields(
  enValue: FrontmatterValue | undefined,
  zhValue: FrontmatterValue | undefined,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  if (typeof enValue === 'string' && enValue.trim()) out.en = enValue.trim();
  if (typeof zhValue === 'string' && zhValue.trim()) out['zh-CN'] = zhValue.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

function stringArray(value: FrontmatterValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  return out.length > 0 ? out : undefined;
}

function humanizeName(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

function mapExamples(
  value: FrontmatterValue | undefined,
  warnings: string[],
): PluginManifest['examples'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    warnings.push('SKILL.md examples must be an array');
    return undefined;
  }
  const examples: NonNullable<PluginManifest['examples']> = [];
  for (const [index, raw] of value.entries()) {
    const parsed = PluginExampleSchema.safeParse(raw);
    if (parsed.success) examples.push(parsed.data);
    else warnings.push(`SKILL.md examples[${index}] is invalid and was omitted`);
  }
  return examples;
}

function mapInputs(value: FrontmatterValue | undefined, warnings: string[]): InputField[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: InputField[] = [];
  for (const raw of value) {
    if (!isObject(raw)) continue;
    const name = stringOr(raw['name'], '').trim();
    if (!name) continue;
    const t = stringOr(raw['type'], 'string');
    let mappedType: InputField['type'];
    if (t === 'integer') mappedType = 'number';
    else if (t === 'enum') mappedType = 'select';
    else if (t === 'upload') mappedType = 'file';
    else if (t === 'string' || t === 'text' || t === 'select' || t === 'number' || t === 'boolean' || t === 'file') mappedType = t;
    else {
      warnings.push(`SKILL.md inputs[${name}].type='${t}' is not in the v1 input vocabulary; falling back to 'string'`);
      mappedType = 'string';
    }
    const optionsSrc = raw['options'] ?? raw['values'];
    const options = Array.isArray(optionsSrc)
      ? optionsSrc.filter((v): v is string => typeof v === 'string')
      : undefined;
    const field: InputField = {
      name,
      label: stringOr(raw['label'], '') || undefined,
      type: mappedType,
      required: typeof raw['required'] === 'boolean' ? (raw['required'] as boolean) : undefined,
      options: options && options.length > 0 ? options : undefined,
      placeholder: stringOr(raw['placeholder'], '') || undefined,
      default: raw['default'] ?? undefined,
    };
    out.push(field);
  }
  return out.length > 0 ? out : undefined;
}

function examplePromptFromFrontmatter(fm: FrontmatterObject, body: string): string {
  const pixo = isObject(fm['pixo']) ? fm['pixo'] : {};
  const direct = stringOr(pixo['example_prompt'], '').trim();
  if (direct) return direct;
  const desc = stringOr(fm['description'], '').trim();
  if (desc) {
    const firstLine = desc.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? '';
    if (firstLine) return firstLine;
  }
  // Last resort — use the first non-frontmatter heading from the body.
  const heading = /^#\s+(.+)$/m.exec(body);
  return heading?.[1]?.trim() ?? '';
}
