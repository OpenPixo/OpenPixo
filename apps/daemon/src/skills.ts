// Skill registry. Scans one or more on-disk roots for SKILL.md files, parses
// front-matter, returns listing. No watching in this MVP — re-scans on every
// GET /api/skills, which is fine for dozens of skills. An unchanged SKILL.md is
// not re-read (see readSkillDocument); everything else a scan looks at is.
//
// Roots are passed in priority order: the first one wins on `id` collisions
// so user-imported skills under USER_SKILLS_DIR can shadow a built-in skill
// of the same name without erasing the built-in copy.

import type { Dirent } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import { PluginExampleSchema, renderProjectSkillIndex, type PluginExample, type ProjectSkillIndexEntry } from '@openpixo/contracts';
import { parseFrontmatter } from "./services/frontmatter.js";
import { skillCwdAliasSegment, SKILLS_CWD_ALIAS } from "./cwd-aliases.js";

type SqliteDb = Database.Database;

// Persisted skill ids on existing projects can outlive a folder rename.
// listSkills() derives the id from the SKILL.md frontmatter `name`, so once
// a skill is renamed the old id stops resolving and composeOpenPixoGamePrompt
// silently drops the skill body for projects saved against the old id.
// This map forwards deprecated ids to their current canonical id; callers
// resolve through findSkillById() before scanning the listing. Leave entries
// here for at least one stable release after a rename so on-disk projects
// keep composing with the intended skill prompt.
export const SKILL_ID_ALIASES = Object.freeze({
  "taste-skill": "design-taste-frontend",
});

type SkillMode = "utility" | "image" | "video" | "audio" | "deck" | "design-system" | "template" | "prototype";
type SkillSurface = "web" | "image" | "video" | "audio";
type SkillPlatform = "desktop" | "mobile" | null;
type JsonRecord = Record<string, unknown>;

interface SkillFrontmatter extends JsonRecord {
  name?: unknown;
  zh_name?: unknown;
  en_name?: unknown;
  description?: unknown;
  zh_description?: unknown;
  en_description?: unknown;
  triggers?: unknown;
  pixo?: JsonRecord & {
    example_prompt?: unknown;
    example_prompt_i18n?: unknown;
    preview?: JsonRecord;
    category?: unknown;
    engines?: unknown;
  };
}

// Indicates whether a skill came from a user-writable root (the first root
// passed to listSkills) or from a built-in repo root (any later root). The
// UI uses this to render an origin pill and to gate destructive actions:
// only `user` skills can be deleted via /api/skills/:id.
export type SkillSource = "user" | "built-in";

export interface SkillInfo {
  id: string;
  name: string;
  displayName?: Record<string, string>;
  description: string;
  descriptionI18n?: Record<string, string>;
  triggers: unknown[];
  mode: SkillMode;
  surface: SkillSurface;
  source: SkillSource;
  platform: SkillPlatform;
  scenario: string;
  // Optional human-readable category (e.g. "image-generation", "video",
  // "design-systems"). Surfaced as a filter pill in Settings → Skills so a
  // large pre-loaded catalogue (e.g. curated design/creative skills from the
  // upstream awesome-* lists) stays scannable. Not part of system-prompt
  // composition; purely a UI hint.
  category: string | null;
  // Game engines this workflow applies to, from `pixo.engines`. Absent means any.
  engines?: string[];
  previewType: string;
  defaultFor: string[];
  upstream: string | null;
  featured: number | null;
  fidelity: "wireframe" | "high-fidelity" | null;
  speakerNotes: boolean | null;
  animations: boolean | null;
  examplePrompt: string;
  examplePromptI18n?: Record<string, string>;
  examples?: PluginExample[];
  aggregatesExamples: boolean;
  body: string;
  dir: string;
}

interface DerivedExample {
  key: string;
}

/** Use the actual staging result when available; the source file is a readable
 * fallback if copying was refused. Both paths include the companion files. */
export function projectSkillIndexEntry(skill: SkillInfo, stagedDir?: string): ProjectSkillIndexEntry {
  return {
    id: skill.id, name: skill.displayName?.en ?? skill.name, description: skill.description,
    triggers: skill.triggers,
    skillPath: path.join(stagedDir ?? `${SKILLS_CWD_ALIAS}/${skillCwdAliasSegment(skill.dir)}`, 'SKILL.md').replaceAll('\\', '/'),
  };
}

export const PROJECT_SKILL_AUTO_INCLUDE_BYTES = 16 * 1024;
export const PROJECT_SKILL_PLAIN_BYTES = 32 * 1024;
const SKILL_BLOCK_SEPARATOR = '\n\n---\n\n';

function truncateUtf8(value: string, budget: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    bytes += Buffer.byteLength(character, 'utf8');
    if (bytes > budget) break;
    end += character.length;
  }
  return value.slice(0, end);
}

/** Enabled skills contribute a stable index, never an unbounded body append.
 * Literal trigger matches are per-turn context (at most two, 16 KiB including
 * headings). Explicit selections are already in the game prompt and are never
 * duplicated or limited here. Plain providers instead get a bounded inline
 * fallback because they cannot read the staged files.
 *
 * Default skills (`game/default-skills.ts`) only ever add index lines, and only
 * once they are staged, because the agent has to be able to read them. They take
 * no part in trigger matching, where a chance word would load a whole workflow
 * nobody asked for, and text-only providers do not get them at all.
 *
 * `loadedSkillIds` are the skills this function put into the prompt in full.
 */
export function composeProjectSkillContext({
  skills, defaultSkills = [], stagedSkillDirs, selectedSkillDirs = [], selectedSkillIds = [], streamFormat, userMessage,
  autoIncludeByteBudget = PROJECT_SKILL_AUTO_INCLUDE_BYTES, plainByteBudget = PROJECT_SKILL_PLAIN_BYTES,
}: {
  skills: readonly SkillInfo[];
  defaultSkills?: readonly SkillInfo[];
  stagedSkillDirs: ReadonlyMap<string, string>;
  selectedSkillDirs?: readonly string[];
  selectedSkillIds?: readonly string[];
  streamFormat: string;
  userMessage: string;
  autoIncludeByteBudget?: number;
  plainByteBudget?: number;
}): { stablePrompt: string; turnPrompt: string; loadedSkillIds: string[] } {
  const selected = new Set(selectedSkillDirs);
  const selectedIds = new Set(selectedSkillIds.map(id => resolveSkillId(id)));
  const available = skills.filter(skill => !selected.has(skill.dir) && !selectedIds.has(resolveSkillId(skill.id)));
  if (streamFormat === 'plain') {
    if (available.length === 0) return { stablePrompt: '', turnPrompt: '', loadedSkillIds: [] };
    const heading = (skill: SkillInfo) => `### ${skill.name}\n\n`;
    const full = [
      '## Project skills (text-only)\n\nInline workflows; files and companion references are unavailable.',
      ...available.map(skill => `${heading(skill)}${skill.body}`),
    ].join(SKILL_BLOCK_SEPARATOR);
    const budget = Math.max(0, Math.floor(plainByteBudget));
    if (Buffer.byteLength(full, 'utf8') <= budget) {
      return { stablePrompt: full, turnPrompt: '', loadedSkillIds: available.map(skill => skill.id) };
    }
    const note = '\n\n[Project skills truncated for this text-only provider. Request the relevant missing instructions before relying on them.]';
    const noteBytes = Buffer.byteLength(note, 'utf8');
    const stablePrompt = budget >= noteBytes ? truncateUtf8(full, budget - noteBytes) + note : truncateUtf8(note, budget);
    return {
      stablePrompt,
      turnPrompt: '',
      loadedSkillIds: available.filter(skill => stablePrompt.includes(heading(skill))).map(skill => skill.id),
    };
  }
  const indexed = [
    ...skills,
    ...defaultSkills.filter(skill => stagedSkillDirs.has(skill.dir)
      && !selected.has(skill.dir) && !selectedIds.has(resolveSkillId(skill.id))),
  ];
  const stablePrompt = renderProjectSkillIndex(indexed.map(skill => projectSkillIndexEntry(skill, stagedSkillDirs.get(skill.dir) ?? skill.dir)));
  const message = userMessage.toLowerCase();
  const blocks: string[] = [];
  const loadedSkillIds: string[] = [];
  let remaining = Math.max(0, Math.floor(autoIncludeByteBudget));
  for (const skill of available) {
    if (blocks.length === 2) break;
    if (!skill.triggers.some(trigger => typeof trigger === 'string' && Boolean(trigger.trim()) && message.includes(trigger.trim().toLowerCase()))) continue;
    const block = `## Trigger-matched project skill — ${skill.name}\n\n${skill.body}`;
    const bytes = Buffer.byteLength((blocks.length ? SKILL_BLOCK_SEPARATOR : '') + block, 'utf8');
    if (bytes > remaining) continue;
    blocks.push(block);
    loadedSkillIds.push(skill.id);
    remaining -= bytes;
  }
  return { stablePrompt, turnPrompt: blocks.join(SKILL_BLOCK_SEPARATOR), loadedSkillIds };
}

export interface DerivedSkillIdParts {
  parentId: string;
  childKey: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object";
}

function asSkillFrontmatter(value: unknown): SkillFrontmatter {
  return isRecord(value) ? (value as SkillFrontmatter) : {};
}

export function resolveSkillId(id: unknown): unknown {
  if (typeof id !== "string" || id.length === 0) return id;
  return (SKILL_ID_ALIASES as Readonly<Record<string, string>>)[id] ?? id;
}

// Lookup helper that mirrors `skills.find((s) => s.id === id)` but first
// rewrites any deprecated id to its current canonical form. Use this at
// every site that resolves a stored or external skill id; calling
// `.find()` directly will silently miss aliased ids.
export function findSkillById(skills: unknown, id: unknown): SkillInfo | undefined {
  if (!Array.isArray(skills) || typeof id !== "string" || id.length === 0) {
    return undefined;
  }
  const canonical = resolveSkillId(id);
  return (skills as SkillInfo[]).find((s) => s.id === canonical);
}

export interface ListSkillsOptions {
  /** Restrict a parent-root scan to one installed package's root skill. */
  directoryName?: string;
}

interface CachedSkillDocument {
  mtimeMs: number;
  size: number;
  data: unknown;
  body: string;
}

// Only the parse of SKILL.md itself: its side files are not covered by this
// file's stat, so they are looked at on every scan. Bounded because roots can be
// temporary folders, and a folder removed with its root is never seen again.
const SKILL_DOCUMENT_CACHE_LIMIT = 1024;
const skillDocumentCache = new Map<string, CachedSkillDocument>();

/**
 * Read and parse one SKILL.md, or reuse the parse while its mtime and size hold.
 *
 * `stats` must be taken before this call: a write landing in between is then
 * cached under the older stats, and the next scan sees them differ and re-reads.
 * The frontmatter is cloned per call because entries hand parts of it to callers
 * (`triggers`), and a caller's mutation must not reach the next scan.
 */
async function readSkillDocument(
  skillPath: string,
  stats: { mtimeMs: number; size: number },
): Promise<{ data: unknown; body: string }> {
  let cached = skillDocumentCache.get(skillPath);
  if (!cached || cached.mtimeMs !== stats.mtimeMs || cached.size !== stats.size) {
    const raw = await readFile(skillPath, "utf8");
    const { data, body } = parseFrontmatter(raw) as { data: unknown; body: string };
    cached = { mtimeMs: stats.mtimeMs, size: stats.size, data, body };
    if (!skillDocumentCache.has(skillPath) && skillDocumentCache.size >= SKILL_DOCUMENT_CACHE_LIMIT) {
      skillDocumentCache.delete(skillDocumentCache.keys().next().value!);
    }
    skillDocumentCache.set(skillPath, cached);
  }
  return { data: structuredClone(cached.data), body: cached.body };
}

// Accept either a single root path or an array. When given multiple roots,
// the first one wins on id collisions so user-imported skills under
// USER_SKILLS_DIR can shadow a built-in skill of the same name without
// erasing the bundled copy. Each surfaced summary carries a `source`
// (`"user"` for the first root, `"built-in"` for any later root) so the
// UI can render an origin pill and gate the delete control.
export async function listSkills(
  skillsRoots: string | readonly string[],
  options: ListSkillsOptions = {},
): Promise<SkillInfo[]> {
  const roots = Array.isArray(skillsRoots) ? skillsRoots : [skillsRoots];
  const out: SkillInfo[] = [];
  const seenIds = new Set<string>();
  for (let rootIdx = 0; rootIdx < roots.length; rootIdx += 1) {
    const skillsRoot = roots[rootIdx];
    if (!skillsRoot) continue;
    const source: SkillSource = rootIdx === 0 ? "user" : "built-in";
    let entries: Dirent[] = [];
    try {
      entries = await readdir(skillsRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (options.directoryName && entry.name !== options.directoryName) continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const dir = path.join(skillsRoot, entry.name);
      const skillPath = path.join(dir, "SKILL.md");
      try {
        const stats = await stat(skillPath);
        if (!stats.isFile()) continue;
        const { data: parsedData, body } = await readSkillDocument(skillPath, stats);
        const data = asSkillFrontmatter(parsedData);
        const parentId =
          typeof data.name === "string" && data.name ? data.name : entry.name;
        // A hidden user shadow must not consume the id before the built-in
        // root is scanned. Otherwise another member's Personal skill could
        // make the globally shipped skill of the same id disappear.
        // Skip when an earlier root already surfaced this id — the first
        // root wins so user shadows built-in. Done before we read the
        // rest of the frontmatter to keep the shadowed-skill path cheap.
        if (seenIds.has(parentId)) continue;
        seenIds.add(parentId);
        const mode = normalizeMode(data.pixo?.mode, body, data.description);
        const surface = normalizeSurface(data.pixo?.surface, mode);
        const platform = normalizePlatform(
          data.pixo?.platform,
          mode,
          body,
          data.description,
        );
        const scenario = normalizeScenario(
          data.pixo?.scenario,
          body,
          data.description,
        );
        const category = normalizeCategory(data.pixo?.category);
        const engines = Array.isArray(data.pixo?.engines)
          ? data.pixo.engines.filter((engine): engine is string => typeof engine === 'string' && engine.length > 0)
          : [];
        const upstream =
          typeof data.pixo?.upstream === "string" ? data.pixo.upstream : null;
        const previewType =
          typeof data.pixo?.preview?.type === "string"
            ? data.pixo.preview.type
            : "html";
        const description =
          typeof data.description === "string" ? data.description : "";
        const displayName = localizedMapFromFields(data.en_name, data.zh_name);
        const descriptionI18n = localizedMapFromFields(
          data.en_description,
          data.zh_description,
        );
        const examplePromptI18n = localizedMapFromRecord(data.pixo?.example_prompt_i18n);
        const examples = await readSkillExamples(dir, data.examples);
        const parentBody = await skillBodyWithRootPreamble(body, dir);
        // Pre-compute derived examples so the parent entry can advertise
        // `aggregatesExamples` in the same push. The frontend uses that
        // flag to hide the parent card from the gallery (its preview would
        // duplicate one of the derived cards), while the daemon keeps the
        // parent in the listing so `findSkillById` still resolves it for
        // system-prompt composition and id alias lookups.
        const derivedExamples = await collectDerivedExamples(dir);
        const aggregatesExamples = derivedExamples.length > 0;
        out.push({
          id: parentId,
          name: parentId,
          ...(displayName ? { displayName } : {}),
          description,
          ...(descriptionI18n ? { descriptionI18n } : {}),
          triggers: Array.isArray(data.triggers) ? data.triggers : [],
          mode,
          surface,
          source,
          platform,
          scenario,
          category,
          ...(engines.length > 0 ? { engines } : {}),
          previewType,
          defaultFor: normalizeDefaultFor(data.pixo?.default_for),
          upstream,
          featured: normalizeFeatured(data.pixo?.featured),
          // Optional metadata hints used by 'Use this prompt' fast-create
          // so the resulting project mirrors the shipped example.html.
          // Each hint is only consumed when its kind matches the skill
          // mode; missing hints fall back to the new-project defaults.
          fidelity: normalizeFidelity(data.pixo?.fidelity),
          speakerNotes: normalizeBoolHint(data.pixo?.speaker_notes),
          animations: normalizeBoolHint(data.pixo?.animations),
          examplePrompt: derivePrompt(data),
          ...(examplePromptI18n ? { examplePromptI18n } : {}),
          ...(examples ? { examples } : {}),
          aggregatesExamples,
          body: parentBody,
          dir,
        });

        // Surface every example sitting next to a SKILL.md as its own card
        // so a single skill (e.g. live-artifact) can ship a small gallery
        // of hand-crafted samples without needing one SKILL.md per sample.
        // Each derived card inherits the parent's mode/platform/surface/
        // scenario so existing TYPE/SURFACE filters keep working; the
        // synthetic id `<parent>:<child>` lets `/api/skills/:id/example`
        // resolve straight to the matching HTML on disk. We deliberately
        // do not inherit `featured` so derived cards never crowd the
        // magazine row.
        for (const example of derivedExamples) {
          const derivedId = `${parentId}:${example.key}`;
          if (seenIds.has(derivedId)) continue;
          seenIds.add(derivedId);
          out.push({
            id: derivedId,
            name: humanizeExampleName(example.key),
            description,
            ...(descriptionI18n ? { descriptionI18n } : {}),
            triggers: Array.isArray(data.triggers) ? data.triggers : [],
            mode,
            surface,
            source,
            platform,
            scenario,
            category,
            previewType,
            defaultFor: [],
            upstream,
            featured: null,
            fidelity: normalizeFidelity(data.pixo?.fidelity),
            speakerNotes: normalizeBoolHint(data.pixo?.speaker_notes),
            animations: normalizeBoolHint(data.pixo?.animations),
            examplePrompt: derivePrompt(data),
            ...(examplePromptI18n ? { examplePromptI18n } : {}),
          ...(examples ? { examples } : {}),
            aggregatesExamples: false,
            // Inherit the parent's full SKILL.md body so 'Use this prompt'
            // on a derived card seeds the agent with the same workflow
            // the parent describes. Without this, picking a derived card
            // would compose an empty system prompt.
            body: parentBody,
            dir,
          });
        }
      } catch {
        // Skip unreadable entries — this is discovery, not validation.
        skillDocumentCache.delete(skillPath);
      }
    }
  }
  out.sort((a, b) => (a.featured ?? Number.POSITIVE_INFINITY) - (b.featured ?? Number.POSITIVE_INFINITY));
  return out;
}

// Discover example artifacts that live alongside SKILL.md under
// `<dir>/examples/`. Only the single-file layout is surfaced:
//
//   `examples/<name>.html` — pre-baked, self-contained sample.
//
// We deliberately do not surface the subfolder layout (e.g. live-artifact's
// `examples/<name>/template.html` + `data.json`) because those templates
// still hold `{{data.x}}` placeholders that only the daemon-side renderer
// fills in. Showing the raw template would render visible placeholder
// braces in the gallery — worse than not surfacing the example at all.
// To ship a subfolder-style example, place the baked output beside the
// folder as `examples/<name>.html` (the canonical render) and keep the
// subfolder around as agent-readable source.
async function collectDerivedExamples(dir: string): Promise<DerivedExample[]> {
  const examplesDir = path.join(dir, "examples");
  let entries: Dirent[] = [];
  try {
    entries = await readdir(examplesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DerivedExample[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".html")) continue;
    const key = entry.name.replace(/\.html$/i, "");
    if (!isSafeExampleKey(key)) continue;
    out.push({ key });
  }
  // Stable order so the gallery renders the same sequence on every reload.
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

// Reject keys that could escape the examples folder or break the
// `<parent>:<child>` id format. Letters/digits/dash/dot/underscore only,
// and never the dotfile path-traversal patterns.
function isSafeExampleKey(key: string): boolean {
  if (!key || key.startsWith(".")) return false;
  if (key.includes(":")) return false;
  return /^[A-Za-z0-9._-]+$/.test(key);
}

// Turn a basename like `stock-portfolio-live` into a title-cased label
// (`Stock Portfolio Live`) so the gallery card has a readable heading
// without forcing every example to ship its own frontmatter.
function humanizeExampleName(key: string): string {
  return key
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) =>
      word.length === 0
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(" ");
}

// Used by `/api/skills/:id/example` to resolve a derived id back to its
// on-disk file. Returns null when the key is unsafe; the route checks
// `fs.existsSync` against the returned path before reading.
export function resolveDerivedExamplePath(parentDir: string, childKey: string): string | null {
  if (!isSafeExampleKey(childKey)) return null;
  return path.join(parentDir, "examples", `${childKey}.html`);
}

// Split a `<parent>:<child>` synthetic id into its two halves. Returns
// null for non-derived ids so the caller can fall through to the regular
// listing-based lookup.
export function splitDerivedSkillId(id: unknown): DerivedSkillIdParts | null {
  if (typeof id !== "string") return null;
  const idx = id.indexOf(":");
  if (idx <= 0 || idx === id.length - 1) return null;
  const parentId = id.slice(0, idx);
  const childKey = id.slice(idx + 1);
  if (!isSafeExampleKey(childKey)) return null;
  return { parentId, childKey };
}

// Skills that ship side files (e.g. `assets/template.html`, `references/*.md`)
// need the agent to know where the skill lives on disk — relative paths in the
// SKILL.md body would otherwise resolve against the agent's CWD, which is the
// project folder (`.pixo/projects/<id>/`), not the skill folder.
//
// We prepend a short preamble that advertises two paths:
//
//   1. A CWD-relative alias path (`.pixo-skills/<folder>/`) — the primary one.
//      Before spawning the agent the chat handler copies the active skill
//      into `<cwd>/.pixo-skills/<folder>/` (see `cwd-aliases.ts`), so this
//      path is inside the agent's working directory on every CLI and is
//      not blocked by directory-access policies (issue #430).
//   2. The absolute source path is a fallback for environments where
//      staging fails. No-project runs stage into the resolved working
//      directory too. Claude/Copilot are additionally given `--add-dir`
//      for that absolute path so it remains readable under their policies.
//
// Authoring guidance lives in the preamble itself so an agent can pick
// the right form on its own without daemon-side feature detection.
function withSkillRootPreamble(body: string, dir: string): string {
  const referencedFiles = collectReferencedSideFiles(body);
  const folder = skillCwdAliasSegment(dir);
  const skillRootRel = `${SKILLS_CWD_ALIAS}/${folder}`;
  const exampleFile = referencedFiles[0];
  const relativeGuidance = exampleFile
    ? "> below references side files such as `" + exampleFile + "`, prefer the\n" +
      "> relative form rooted at the first path above — e.g. open `" +
      skillRootRel + "/" + exampleFile + "`."
    : "> below references side files, prefer the relative form rooted at the\n" +
      "> first path above.";
  const absoluteGuidance = exampleFile
    ? "> back to the absolute path: `" + path.join(dir, exampleFile) + "`."
    : "> back to the absolute skill root above.";
  const preamble = [
    "> **Skill root (relative to project):** `" + skillRootRel + "/`",
    "> **Skill root (absolute fallback):** `" + dir + "`",
    ">",
    "> This skill ships side files alongside `SKILL.md`. When the workflow",
    relativeGuidance,
    "> If that path is not reachable from your working directory, fall",
    absoluteGuidance,
    "> Either form resolves to the same file; the relative form keeps you",
    "> inside the project working directory, which is preferred.",
    ...(referencedFiles.length > 0
      ? [
          ">",
          "> Known side files in this skill: " +
            referencedFiles.map((file) => "`" + file + "`").join(", ") +
            ".",
        ]
      : []),
    "",
    "",
  ].join("\n");
  return preamble + body;
}

/**
 * Add the same staged-root contract to every file-backed skill source.
 *
 * Global skills already flow through this helper while the registry is
 * scanned. Plugin-local SKILL.md files are loaded through a separate path, so
 * that loader calls this export too; otherwise their companion files are
 * staged correctly but the model is never told where the staged copy lives.
 */
export async function skillBodyWithRootPreamble(body: string, dir: string): Promise<string> {
  return await dirHasAttachments(dir) ? withSkillRootPreamble(body, dir) : body;
}

function collectReferencedSideFiles(body: string): string[] {
  const files = new Set<string>();
  const matches = body.matchAll(/\b(?:assets|references)\/[A-Za-z0-9._-]+\b/g);
  for (const match of matches) files.add(match[0]);
  if (/\bexample\.html\b/.test(body)) files.add("example.html");
  return Array.from(files).sort();
}

async function dirHasAttachments(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.some(
      (e) =>
        e.name !== "SKILL.md" &&
        (e.isDirectory() || /\.(md|html|css|js|json|txt)$/i.test(e.name))
    );
  } catch {
    return false;
  }
}

function normalizeDefaultFor(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

// Optional `pixo.fidelity` hint for prototype skills. Only 'wireframe' and
// 'high-fidelity' are meaningful — anything else collapses to null so the
// caller falls back to the form default ('high-fidelity').
function normalizeFidelity(value: unknown): "wireframe" | "high-fidelity" | null {
  if (value === "wireframe" || value === "high-fidelity") return value;
  return null;
}

// Coerce truthy / falsy strings ("true", "yes", "false", "no") and booleans
// to a real boolean. Returns null for anything we can't interpret so the
// caller knows to fall back to the form default.
function normalizeBoolHint(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "yes" || v === "1") return true;
    if (v === "false" || v === "no" || v === "0") return false;
  }
  return null;
}

function localizedMapFromFields(
  enValue: unknown,
  zhValue: unknown,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  if (typeof enValue === "string" && enValue.trim()) out.en = enValue.trim();
  if (typeof zhValue === "string" && zhValue.trim()) out["zh-CN"] = zhValue.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

function localizedMapFromRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    out[key] = raw.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Coerce `pixo.featured` into a numeric priority. Lower numbers float to the
// top of the Examples gallery; `true` is treated as priority 1; anything
// missing/unrecognised becomes null so non-featured skills keep their
// natural alphabetical order.
function normalizeFeatured(value: unknown): number | null {
  if (value === true) return 1;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Prefer an explicitly authored `pixo.example_prompt`. Fall back to the
// skill description's first sentence — it's already written in actionable
// language ("Admin / analytics dashboard in a single HTML file…") so it
// serves as a passable starter prompt.
function derivePrompt(data: SkillFrontmatter): string {
  const explicit = data.pixo?.example_prompt;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const desc =
    typeof data.description === "string" ? data.description.trim() : "";
  if (!desc) return "";
  const collapsed = desc.replace(/\s+/g, " ").trim();
  const firstSentence = collapsed.match(/^.+?[.!?。！？](?:\s|$)/)?.[0]?.trim();
  return (firstSentence || collapsed).slice(0, 320);
}

function inferMode(body: unknown, description: unknown): SkillMode {
  const hay = `${description ?? ""}\n${body ?? ""}`.toLowerCase();
  if (/\bimage|poster|illustration|photography|图片|海报|插画/.test(hay)) return "image";
  if (/\bvideo|motion|shortform|animation|视频|动效|短片/.test(hay)) return "video";
  if (/\baudio|music|jingle|tts|sound|音频|音乐|配音|音效/.test(hay)) return "audio";
  if (/\bppt|deck|slide|presentation|幻灯|投影/.test(hay)) return "deck";
  if (/\bdesign[- ]system|\bdesign\.md|\bdesign tokens/.test(hay))
    return "design-system";
  if (/\btemplate\b/.test(hay)) return "template";
  return "prototype";
}

function normalizeMode(value: unknown, body: unknown, description: unknown): SkillMode {
  if (
    value === "image" || value === "video" || value === "audio" || value === "deck" ||
    value === "design-system" || value === "template" || value === "prototype" || value === "utility"
  ) return value;
  return inferMode(body, description);
}

const KNOWN_SURFACES = new Set<SkillSurface>(["web", "image", "video", "audio"]);
function normalizeSurface(value: unknown, mode: SkillMode): SkillSurface {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (KNOWN_SURFACES.has(v as SkillSurface)) return v as SkillSurface;
  }
  if (mode === "image" || mode === "video" || mode === "audio") return mode;
  return "web";
}

// Validate platform tag — only desktop / mobile are meaningful for the
// Examples gallery. Falls back to autodetecting "mobile" from descriptions
// so legacy skills sort under the right pill without authoring changes.
function normalizePlatform(value: unknown, mode: SkillMode, body: unknown, description: unknown): SkillPlatform {
  if (value === "desktop" || value === "mobile") return value;
  if (mode !== "prototype") return null;
  const hay = `${description ?? ""}\n${body ?? ""}`.toLowerCase();
  if (/mobile|phone|ios|android|手机|移动端/.test(hay)) return "mobile";
  return "desktop";
}

// Normalise a scenario tag to a small fixed vocabulary so the filter pills
// stay tidy. Unknown values pass through verbatim so authors can experiment;
// missing values default to "general".
const KNOWN_SCENARIOS = new Set([
  "general",
  "engineering",
  "product",
  "design",
  "marketing",
  "sales",
  "finance",
  "hr",
  "operations",
  "support",
  "legal",
  "education",
  "personal",
]);
// Normalise a free-form category tag. Limits the set of accepted characters
// to lowercase letters, digits, and dashes so the value can flow straight
// into the UI as a filter pill class without escaping. Empty / non-string
// values become null so the filter row hides instead of rendering an empty
// pill. We intentionally do not lock down a fixed vocabulary here — the
// curated catalogue under skills/ owns the canonical category set, and
// user-imported skills are free to introduce their own.
function normalizeCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const slug = value.trim().toLowerCase();
  if (!slug) return null;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  return slug.slice(0, 64);
}

function normalizeScenario(value: unknown, body: unknown, description: unknown): string {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v) return v;
  }
  const hay = `${description ?? ""}\n${body ?? ""}`.toLowerCase();
  if (/finance|invoice|expense|budget|p&l|revenue/.test(hay)) return "finance";
  if (/\bhr\b|onboarding|payroll|employee|人事/.test(hay)) return "hr";
  if (/marketing|campaign|brand|landing/.test(hay)) return "marketing";
  if (/runbook|incident|deploy|engineering|sre|api/.test(hay))
    return "engineering";
  if (/spec|prd|roadmap|product manager|product team/.test(hay))
    return "product";
  if (/design system|moodboard|mockup|ui kit/.test(hay)) return "design";
  if (/sales|quote|proposal|lead/.test(hay)) return "sales";
  if (/operations|ops|logistics|inventory/.test(hay)) return "operations";
  return "general";
}
// Surface the vocabulary so callers (frontend filter UI) could mirror it
// later if they want to. Not exported today, kept here for documentation.
void KNOWN_SCENARIOS;

// ---------------------------------------------------------------------------
// User-skill import / delete primitives
// ---------------------------------------------------------------------------
// User-imported skills live under <runtimeData>/user-skills/<slug>/SKILL.md.
// We treat that directory as fully owned by the daemon, so import/delete are
// simple: write or rm the slug folder and let listSkills() pick the change up
// on the next /api/skills request. The slug is derived from the user-supplied
// `name` (alphanumeric + dash) and prefixed with `user-` only when an existing
// built-in skill folder shares the same id, to avoid colliding with a
// repo-shipped folder.

export type SkillImportErrorCode =
  | "BAD_REQUEST"
  | "CONFLICT"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export class SkillImportError extends Error {
  readonly code: SkillImportErrorCode;
  constructor(code: SkillImportErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "SkillImportError";
  }
}

const RESERVED_SLUGS = new Set(["", ".", ".."]);

export function slugifySkillName(name: unknown): string {
  if (typeof name !== "string") return "";
  const lowered = name.trim().toLowerCase();
  const cleaned = lowered
    .replace(/[^a-z0-9\-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  if (!cleaned || RESERVED_SLUGS.has(cleaned)) return "";
  return cleaned.slice(0, 64);
}

function escapeYamlString(value: unknown): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

interface BuildSkillMarkdownInput {
  name: string;
  description: string;
  body: string;
  triggers: string[];
}

function buildSkillMarkdown({
  name,
  description,
  body,
  triggers,
}: BuildSkillMarkdownInput): string {
  // Always emit `name` as a quoted scalar so YAML never coerces it to a
  // number / boolean / null. Without the quotes, parseYamlSubset() would
  // re-read names like '123', 'true', or 'null' as non-string literals,
  // and importUserSkill()'s round-trip ("imported skill could not be
  // re-read") would fail for those ids. See PR #955 review feedback.
  const lines: string[] = ["---", `name: "${escapeYamlString(name)}"`];
  if (description && description.trim().length > 0) {
    lines.push("description: |");
    for (const ln of description.trim().split(/\r?\n/)) {
      lines.push(`  ${ln}`);
    }
  }
  if (triggers.length > 0) {
    lines.push("triggers:");
    for (const t of triggers) {
      const trimmed = typeof t === "string" ? t.trim() : "";
      if (!trimmed) continue;
      lines.push(`  - "${escapeYamlString(trimmed)}"`);
    }
  }
  lines.push("---", "", body.trim(), "");
  return lines.join("\n");
}

export interface SkillImportInput {
  name?: unknown;
  description?: unknown;
  body?: unknown;
  triggers?: unknown;
}

export interface SkillImportResult {
  id: string;
  slug: string;
  dir: string;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return Boolean(err) && typeof err === "object" && "code" in (err as object);
}

export async function importUserSkill(
  userSkillsRoot: string,
  input: SkillImportInput,
): Promise<SkillImportResult> {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const description =
    typeof input?.description === "string" ? input.description : "";
  const body = typeof input?.body === "string" ? input.body : "";
  if (!name) {
    throw new SkillImportError("BAD_REQUEST", "skill name required");
  }
  if (!body || body.trim().length === 0) {
    throw new SkillImportError("BAD_REQUEST", "skill body required");
  }
  const slug = slugifySkillName(name);
  if (!slug) {
    throw new SkillImportError(
      "BAD_REQUEST",
      "skill name must produce a valid slug (a-z, 0-9, dash)",
    );
  }
  const triggersRaw = Array.isArray(input?.triggers) ? input.triggers : [];
  const triggers = triggersRaw
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean);

  await mkdir(userSkillsRoot, { recursive: true });
  const dir = path.join(userSkillsRoot, slug);
  // Refuse to overwrite an existing folder. The caller can DELETE first
  // when intentionally replacing a skill.
  try {
    const existing = await stat(dir);
    if (existing) {
      throw new SkillImportError(
        "CONFLICT",
        `a user skill with slug "${slug}" already exists`,
      );
    }
  } catch (err) {
    if (err instanceof SkillImportError) throw err;
    if (isErrnoException(err) && err.code !== "ENOENT") {
      throw new SkillImportError(
        "INTERNAL_ERROR",
        `could not check skill dir: ${err.message ?? err}`,
      );
    }
  }
  await mkdir(dir, { recursive: true });
  const md = buildSkillMarkdown({ name, description, body, triggers });
  await writeFile(path.join(dir, "SKILL.md"), md, "utf8");
  return { id: name, slug, dir };
}

export interface SkillUpdateInput {
  name: string;
  description?: unknown;
  body?: unknown;
  triggers?: unknown;
  // Original on-disk dir for the skill being edited. When the caller is
  // shadowing a built-in for the first time (i.e. `sourceDir` differs
  // from the user shadow target and the shadow folder does not exist
  // yet), `updateUserSkill` clones every entry except `SKILL.md` from
  // `sourceDir` into the shadow so the bundled side tree (assets/,
  // references/, scripts/, examples/, ...) keeps resolving through the
  // /api/skills/:id/files, /example, and /assets/* routes after the
  // edit. Without this, listSkills() promotes the shadow folder to the
  // active dir but the resolvers see only the user-authored SKILL.md
  // and the rest of the skill silently disappears (mrcfps PR #955
  // review). When omitted (or pointing at the same folder) the call
  // only writes SKILL.md and leaves any previously-cloned side files
  // alone so subsequent edits do not clobber the user's tweaks.
  sourceDir?: string;
}

// Overwrite (or create-on-demand) a user-owned SKILL.md. For built-in
// skills this writes a "shadow" copy under USER_SKILLS_DIR/<slug>/ that
// the next listSkills() pass will surface in place of the bundled copy.
// On the very first shadow-creation we also clone the built-in's side
// files (assets/, references/, scripts/, examples/, ...) so the shadow
// folder is self-contained and downstream resolvers — `/api/skills/:id/
// files`, `/example`, `/assets/*`, the system-prompt preamble, and the
// per-turn cwd staging — keep finding the bundled tree even though the
// user's `SKILL.md` is what we serve.
export async function updateUserSkill(
  userSkillsRoot: string,
  input: SkillUpdateInput,
): Promise<SkillImportResult> {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name) {
    throw new SkillImportError("BAD_REQUEST", "skill name required");
  }
  const description =
    typeof input?.description === "string" ? input.description : "";
  const body = typeof input?.body === "string" ? input.body : "";
  if (!body || body.trim().length === 0) {
    throw new SkillImportError("BAD_REQUEST", "skill body required");
  }
  const slug = slugifySkillName(name);
  if (!slug) {
    throw new SkillImportError(
      "BAD_REQUEST",
      "skill name must produce a valid slug (a-z, 0-9, dash)",
    );
  }
  const triggersRaw = Array.isArray(input?.triggers) ? input.triggers : [];
  const triggers = triggersRaw
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean);
  await mkdir(userSkillsRoot, { recursive: true });
  const dir = path.join(userSkillsRoot, slug);
  const dirExisted = await stat(dir)
    .then(() => true)
    .catch(() => false);
  // Only clone on the very first shadow over a built-in. If `dirExisted`
  // is true, we are editing an already-shadowed skill (or a pure user
  // skill); re-cloning would clobber the user's tweaks under the side
  // tree. If `sourceDir` is missing or already points at the shadow,
  // there is nothing to clone — same dir.
  const shouldCloneSideFiles =
    !dirExisted &&
    typeof input.sourceDir === "string" &&
    input.sourceDir.length > 0 &&
    path.resolve(input.sourceDir) !== path.resolve(dir);
  if (shouldCloneSideFiles) {
    try {
      await cloneSkillSideFiles(input.sourceDir!, dir);
    } catch {
      // Non-fatal: SKILL.md still lands below. Side-file resolvers will
      // 404 individual entries instead of erasing the whole edit, which
      // matches the pre-fix behaviour for unreachable assets.
      await mkdir(dir, { recursive: true });
    }
  } else {
    await mkdir(dir, { recursive: true });
  }
  const md = buildSkillMarkdown({ name, description, body, triggers });
  await writeFile(path.join(dir, "SKILL.md"), md, "utf8");
  return { id: name, slug, dir };
}

// Copy every entry in `sourceDir` into `destDir` except `SKILL.md` and
// dotfiles. Used by `updateUserSkill` to build a self-contained shadow
// folder over a built-in skill on first edit. We dereference symlinks
// for the same reason `stageActiveSkill` does — the shadow lives under
// runtime data and must not link back into a read-only resource tree.
async function cloneSkillSideFiles(
  sourceDir: string,
  destDir: string,
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  let entries: Dirent[] = [];
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "SKILL.md") continue;
    if (entry.name.startsWith(".")) continue;
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(destDir, entry.name);
    await cp(src, dst, {
      recursive: true,
      dereference: true,
      preserveTimestamps: true,
    });
  }
}

export interface SkillFileEntry {
  // Path relative to the skill's on-disk directory. Forward-slashes only.
  path: string;
  // 'file' | 'directory'. We do not surface symlinks or other file types.
  kind: "file" | "directory";
  // Byte size for files; null for directories.
  size: number | null;
}

const SKILL_FILES_MAX_ENTRIES = 500;
const SKILL_FILES_MAX_DEPTH = 6;

// Walk a skill directory and return a flat list of files/folders. Used by
// the Settings → Skills detail panel to render a small file tree next to
// the SKILL.md preview. Skips dotfiles, symlinks, and anything past
// `SKILL_FILES_MAX_DEPTH` so a pathological skill folder cannot stall the
// daemon. The cap on entries protects against large bundled assets folders.
export async function listSkillFiles(skillDir: string): Promise<SkillFileEntry[]> {
  const out: SkillFileEntry[] = [];
  const seen = new Set<string>();
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > SKILL_FILES_MAX_DEPTH) return;
    if (out.length >= SKILL_FILES_MAX_ENTRIES) return;
    let entries: Dirent[] = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= SKILL_FILES_MAX_ENTRIES) return;
      if (entry.name.startsWith(".")) continue;
      // Refuse symlinks defensively — readdir's withFileTypes already
      // returns isSymbolicLink(), but we double-check via the Dirent's
      // kind methods to keep this aligned with the read paths elsewhere.
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(skillDir, abs).split(path.sep).join("/");
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (entry.isDirectory()) {
        out.push({ path: rel, kind: "directory", size: null });
        await walk(abs, depth + 1);
      } else if (entry.isFile()) {
        let size: number | null = null;
        try {
          const s = await stat(abs);
          size = s.size;
        } catch {
          size = null;
        }
        out.push({ path: rel, kind: "file", size });
      }
    }
  }
  await walk(skillDir, 0);
  return out;
}

export async function deleteUserSkill(
  userSkillsRoot: string,
  id: string,
): Promise<void> {
  const slug = slugifySkillName(id);
  if (!slug) {
    throw new SkillImportError("BAD_REQUEST", "invalid skill id");
  }
  const dir = path.join(userSkillsRoot, slug);
  const root = path.resolve(userSkillsRoot);
  const target = path.resolve(dir);
  if (target !== dir || !target.startsWith(root + path.sep)) {
    // Defence-in-depth: refuse to delete anything outside the user-skills
    // root. The slugify above already strips traversal characters.
    throw new SkillImportError("BAD_REQUEST", "invalid skill path");
  }
  try {
    await stat(target);
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      throw new SkillImportError("NOT_FOUND", "user skill not found");
    }
    throw err;
  }
  await rm(target, { recursive: true, force: true });
}

/** Sidecar display metadata takes precedence over portable frontmatter. */
async function readSkillExamples(dir: string, frontmatterExamples: unknown): Promise<PluginExample[] | undefined> {
  let value = frontmatterExamples;
  try {
    const sidecar = JSON.parse(await readFile(path.join(dir, 'pixo.json'), 'utf8')) as { examples?: unknown };
    if (sidecar.examples !== undefined) value = sidecar.examples;
  } catch { /* Portable skills do not require an OpenPixo sidecar. */ }
  const parsed = PluginExampleSchema.array().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
