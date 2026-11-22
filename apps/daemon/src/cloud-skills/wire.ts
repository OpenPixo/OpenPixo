import {
  CLOUD_ITEM_NAME, CLOUD_TOOL_DESCRIPTION_MAX_CHARS,
  type CloudSkillCatalogEntry, type CloudSkillCatalogResponse, type CloudSkillManifest, type CloudToolInfo,
} from '@openpixo/contracts';
import { cloudServiceError } from '../account/errors.js';
import { record } from '../account/supabase.js';

export { CLOUD_ITEM_NAME };

/**
 * Checks on what the cloud sends about cloud skills and tools. A broken or hostile answer must not
 * point the daemon's download token at another address, write outside a skill's folder, or put
 * unbounded text into every hosted run's prompt.
 */

/** `engine=<id>; phase=planning|building`: the only shape the daemon sends as `x-openpixo-context`. */
export const AGENT_CONTEXT = /^engine=[a-z0-9-]{1,32}; phase=(?:planning|building)$/u;

const VERSION = /^[a-z0-9][a-z0-9.-]{0,63}$/u;
/** Markdown only, lowercase folders at most 3 deep, no dot-names. Mirrors the play Worker's rule. */
const SKILL_FILE = /^(?:[a-z0-9][a-z0-9_-]*\/){0,3}[a-zA-Z0-9][a-zA-Z0-9_.-]*\.md$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_SKILLS = 500;
const MAX_TOOLS = 50;
const MAX_FILES = 200;
export const CLOUD_SKILL_MAX_FILE_BYTES = 1024 * 1024;
const MAX_SKILL_BYTES = 5 * 1024 * 1024;
export const CLOUD_SKILL_MANIFEST_BYTES = 256 * 1024;

function invalid(): never { throw cloudServiceError(); }
function text(value: unknown, max: number): string {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : invalid();
}
function name(value: unknown): string {
  return typeof value === 'string' && value.length <= 64 && CLOUD_ITEM_NAME.test(value) ? value : invalid();
}

export function cloudSkillCatalog(value: unknown): CloudSkillCatalogResponse {
  const body = record(value);
  if (!Array.isArray(body.skills) || body.skills.length > MAX_SKILLS) invalid();
  const seen = new Set<string>();
  const skills = (body.skills as unknown[]).map((raw): CloudSkillCatalogEntry => {
    const item = record(raw);
    const entry = {
      name: name(item.name),
      version: typeof item.version === 'string' && VERSION.test(item.version) ? item.version : invalid(),
      title: text(item.title, 200),
      description: text(item.description, 400),
    };
    if (seen.has(entry.name)) invalid();
    seen.add(entry.name);
    return entry;
  });
  let base: URL;
  try { base = new URL(text(body.baseUrl, 512)); } catch { return invalid(); }
  const local = base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !local) || base.username || base.password || base.search || base.hash
    || base.pathname !== '/__skill') invalid();
  const expiresAt = text(body.expiresAt, 64);
  if (Number.isNaN(Date.parse(expiresAt))) invalid();
  return { skills, baseUrl: base.href.replace(/\/+$/u, ''), token: text(body.token, 4096), expiresAt };
}

/** Checked whole before any file is fetched, so a skill with one bad entry downloads nothing. */
export function parseCloudSkillManifest(value: unknown, entry: Pick<CloudSkillCatalogEntry, 'name' | 'version'>,
  fail: (why: string) => Error): CloudSkillManifest {
  const bad = (why: string): never => { throw fail(`The skill's file list is not valid (${why}).`); };
  const manifest = record(value);
  if (manifest.schema !== 1) bad('unknown schema');
  if (manifest.name !== entry.name || manifest.version !== entry.version) bad('it names another skill');
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_FILES) bad('file count');
  const seen = new Set<string>();
  let total = 0;
  const files = (manifest.files as unknown[]).map((raw) => {
    const file = record(raw);
    if (typeof file.path !== 'string' || !SKILL_FILE.test(file.path) || file.path.includes('..')) bad('a file path');
    const filePath = file.path as string;
    if (seen.has(filePath.toLowerCase())) bad('a repeated path');
    seen.add(filePath.toLowerCase());
    if (!Number.isSafeInteger(file.size) || (file.size as number) < 0 || (file.size as number) > CLOUD_SKILL_MAX_FILE_BYTES) bad(`the size of ${filePath}`);
    if (typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) bad(`the hash of ${filePath}`);
    total += file.size as number;
    return { path: filePath, size: file.size as number, sha256: file.sha256 as string };
  });
  if (!seen.has('skill.md') || !files.some((file) => file.path === 'SKILL.md')) bad('no SKILL.md');
  if (total > MAX_SKILL_BYTES) bad('total size');
  const triggers = Array.isArray(manifest.triggers)
    ? manifest.triggers.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
  return {
    schema: 1, name: entry.name, version: entry.version,
    title: typeof manifest.title === 'string' ? manifest.title.slice(0, 200) : entry.name,
    description: typeof manifest.description === 'string' ? manifest.description.slice(0, 400) : '',
    triggers, files,
  };
}

/** Bad entries are dropped rather than failing the list: one tool must not hide the others. */
export function cloudToolList(value: unknown): CloudToolInfo[] {
  const tools = record(value).tools;
  if (!Array.isArray(tools)) invalid();
  const seen = new Set<string>();
  const out: CloudToolInfo[] = [];
  for (const raw of (tools as unknown[]).slice(0, MAX_TOOLS)) {
    const item = record(raw);
    const id = item.id;
    const description = typeof item.description === 'string' ? item.description.replace(/\s+/gu, ' ').trim() : '';
    if (typeof id !== 'string' || id.length > 64 || !CLOUD_ITEM_NAME.test(id) || seen.has(id)) continue;
    if (!description || description.length > CLOUD_TOOL_DESCRIPTION_MAX_CHARS) continue;
    if (item.input !== 'image' && item.input !== 'text') continue;
    seen.add(id);
    out.push({ id, description, input: item.input });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
