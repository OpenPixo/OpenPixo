import { PRODUCT_REPOSITORY_URL } from '@openpixo/contracts';
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  asI18nPayload,
  asLocaleMap,
  asNumber,
  asString,
  asStringArray,
  extractAtmosphere,
  extractCategoryBlock,
  extractFirstProseParagraph,
  extractH1,
  extractPalette,
  firstParagraph,
  parseMarkdownWithFrontmatter,
  stripMarkdownInline,
  titleizeSlug,
} from "./markdown.ts";
import {
  CATALOG_SCHEMA_VERSION,
  previewRelativePath,
  type CatalogCraftRecord,
  type CatalogDocument,
  type CatalogPluginRecord,
  type CatalogRecord,
  type CatalogSkillRecord,
  type CatalogSystemRecord,
  type CatalogTemplateRecord,
} from "./schema.ts";

const REPO_TREE = PRODUCT_REPOSITORY_URL ? `${PRODUCT_REPOSITORY_URL}/tree/main` : "";
const REPO_BLOB = PRODUCT_REPOSITORY_URL ? `${PRODUCT_REPOSITORY_URL}/blob/main` : "";

const OFFICIAL_BUCKETS = [
  "examples",
  "image-templates",
  "video-templates",
  "scenarios",
  "atoms",
] as const;

export type ExportCatalogOptions = {
  repoRoot: string;
  sourceCommit: string;
  /** Deterministic source-commit timestamp. */
  generatedAt: string;
};

export type ExportCatalogResult = {
  catalog: CatalogDocument;
  warnings: string[];
};

function listDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => !name.startsWith("_") && !name.startsWith("."))
    .filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b));
}

function listFiles(root: string, ext: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.endsWith(ext) && !name.startsWith("_") && !name.startsWith("."))
    .sort((a, b) => a.localeCompare(b));
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function pluginDetailSlug(id: string): string {
  const parts = id.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? id;
}

function snapshotEntryPath(
  bucket: "skills" | "templates" | "plugins",
  stableId: string,
  entry: string,
): string {
  const clean = entry.replace(/^\.\//, "").replaceAll("\\", "/");
  if (clean.startsWith("/") || clean.split("/").includes("..")) {
    throw new Error(`preview entry must stay inside its source root: ${entry}`);
  }
  return `entries/${bucket}/${stableId}/${clean}`;
}

function exportSkills(repoRoot: string): CatalogSkillRecord[] {
  const root = join(repoRoot, "skills");
  const out: CatalogSkillRecord[] = [];
  for (const folder of listDirs(root)) {
    const skillPath = join(root, folder, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const raw = readText(skillPath);
    const { body, data } = parseMarkdownWithFrontmatter(raw);
    const pixo = (data.pixo ?? {}) as Record<string, unknown>;
    const hasExample = existsSync(join(root, folder, "example.html"));
    const name = asString(data.name) ?? folder;
    const description = asString(data.description) ?? firstParagraph(body) ?? "";
    out.push({
      id: folder,
      type: "skill",
      name,
      description,
      sourceUrl: REPO_TREE ? `${REPO_TREE}/skills/${folder}` : "",
      body,
      kind: hasExample ? "template" : "instruction",
      triggers: asStringArray(data.triggers),
      mode: asString(pixo.mode),
      platform: asString(pixo.platform),
      scenario: asString(pixo.scenario),
      category: asString(pixo.category),
      featured: asNumber(pixo.featured),
      upstream: asString(pixo.upstream),
      examplePrompt: asString(pixo.example_prompt) ?? asString(pixo.examplePrompt),
      preview: {
        path: previewRelativePath("skills", folder),
        entryPath: hasExample ? snapshotEntryPath("skills", folder, "example.html") : undefined,
      },
      i18n: asI18nPayload(data.i18n),
    });
  }
  return out;
}

function exportCraft(repoRoot: string): CatalogCraftRecord[] {
  const root = join(repoRoot, "craft");
  const out: CatalogCraftRecord[] = [];
  for (const file of listFiles(root, ".md")) {
    const slug = file.replace(/\.md$/i, "");
    if (slug.toLowerCase() === "readme") continue;
    const raw = readText(join(root, file));
    const { body, data } = parseMarkdownWithFrontmatter(raw);
    const h1 = extractH1(body);
    const cleanH1 = h1 ? stripMarkdownInline(h1).replace(/\s+craft rules?$/i, "").trim() : "";
    const name = asString(data.name) ?? (cleanH1 || titleizeSlug(slug));
    const summary = asString(data.summary) ?? extractFirstProseParagraph(body);
    out.push({
      id: slug,
      type: "craft",
      name,
      description: summary,
      sourceUrl: REPO_BLOB ? `${REPO_BLOB}/craft/${file}` : "",
      body,
      summary,
      i18n: asI18nPayload(data.i18n),
    });
  }
  return out;
}

function exportDesignTemplates(repoRoot: string): CatalogTemplateRecord[] {
  const root = join(repoRoot, "design-templates");
  const out: CatalogTemplateRecord[] = [];
  for (const folder of listDirs(root)) {
    const skillPath = join(root, folder, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const raw = readText(skillPath);
    const { body, data } = parseMarkdownWithFrontmatter(raw);
    const pixo = (data.pixo ?? {}) as Record<string, unknown>;
    const name = asString(data.name) ?? titleizeSlug(folder);
    const summary =
      asString(data.description) ||
      extractFirstProseParagraph(body) ||
      "OpenPixo renderable design template.";
    out.push({
      id: folder,
      type: "template",
      name,
      description: summary,
      sourceUrl: REPO_TREE ? `${REPO_TREE}/design-templates/${folder}` : "",
      body,
      origin: "design-template",
      mode: asString(pixo.mode),
      platform: asString(pixo.platform),
      scenario: asString(pixo.scenario),
      featured: asNumber(pixo.featured),
      detailHref: `/templates/${folder}/`,
      preview: {
        path: previewRelativePath("templates", folder),
        entryPath: existsSync(join(root, folder, "example.html"))
          ? snapshotEntryPath("templates", folder, "example.html")
          : undefined,
      },
      i18n: asI18nPayload(data.i18n),
    });
  }
  return out;
}

function exportLiveArtifacts(repoRoot: string): CatalogTemplateRecord[] {
  const root = join(repoRoot, "templates/live-artifacts");
  const out: CatalogTemplateRecord[] = [];
  for (const folder of listDirs(root)) {
    const readme = join(root, folder, "README.md");
    if (!existsSync(readme)) continue;
    const raw = readText(readme);
    const { body, data } = parseMarkdownWithFrontmatter(raw);
    const h1 = extractH1(body);
    let cleanH1 = h1 ? stripMarkdownInline(h1) : "";
    cleanH1 = cleanH1.replace(/\s*[·•]\s*live[\s-]artifact\s+template$/i, "").trim();
    const summary = extractFirstProseParagraph(body) || "OpenPixo Live Artifact template.";
    const liveId = `live-${folder}`;
    out.push({
      id: liveId,
      type: "template",
      name: asString(data.name) ?? (cleanH1 || titleizeSlug(folder)),
      description: asString(data.summary) ?? summary,
      sourceUrl: REPO_TREE ? `${REPO_TREE}/templates/live-artifacts/${folder}` : "",
      body,
      origin: "live-artifact",
      mode: "template",
      scenario: "live-artifacts",
      detailHref: `/templates/${liveId}/`,
      preview: {
        path: previewRelativePath("templates", liveId),
        entryPath: existsSync(join(root, folder, "index.html"))
          ? snapshotEntryPath("templates", liveId, "index.html")
          : undefined,
      },
      i18n: asI18nPayload(data.i18n),
    });
  }
  return out;
}

function loadPlugin(
  opts: {
    manifestPath: string;
    slug: string;
    bucket: string;
    sourceUrl: string;
    sourceDir: string;
    routeId?: string;
    baked: Map<string, { video: string; poster: string; holdMs?: number }>;
  },
): CatalogPluginRecord | null {
  if (!existsSync(opts.manifestPath)) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readText(opts.manifestPath)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const pixo = (raw.pixo ?? {}) as Record<string, unknown>;
  const kind = asString(pixo.kind);

  const manifestId = asString(raw.name) ?? opts.slug;
  const slugBasis = opts.routeId ?? manifestId;
  const detailSlug = pluginDetailSlug(slugBasis);
  const preview = (pixo.preview ?? {}) as Record<string, unknown>;
  const authoredPoster = asString(preview.poster);
  const authoredVideo = asString(preview.video);
  const authoredType = asString(preview.type);
  const baked = authoredVideo ? undefined : opts.baked.get(manifestId);
  const previewVideo = authoredVideo ?? baked?.video;
  const previewPoster = authoredPoster ?? baked?.poster;
  const previewType = previewVideo ? "video" : authoredType;
  const authoredEntry = authoredType === "html" ? asString(preview.entry) : undefined;
  const entryPath = authoredEntry && existsSync(join(opts.sourceDir, authoredEntry))
    ? snapshotEntryPath("plugins", `${opts.bucket}/${opts.slug}`, authoredEntry)
    : undefined;

  return {
    id: manifestId,
    type: "plugin",
    name: asString(raw.title) ?? manifestId,
    description: asString(raw.description) ?? "",
    sourceUrl: opts.sourceUrl,
    body: "",
    slug: opts.slug,
    bucket: opts.bucket,
    tags: asStringArray(raw.tags),
    authorName: asString((raw.author as { name?: unknown } | undefined)?.name),
    authorUrl: asString((raw.author as { url?: unknown } | undefined)?.url),
    homepage: asString(raw.homepage),
    mode: asString(pixo.mode),
    scenario: asString(pixo.scenario),
    platform: asString(pixo.platform),
    surface: asString(pixo.surface),
    kind,
    discoverable: kind === "atom" ? false : undefined,
    detailSlug,
    detailHref: `/plugins/${detailSlug}/`,
    preview: {
      path: previewRelativePath("plugins", manifestId),
      remotePoster: previewPoster,
      remoteVideo: previewVideo,
      holdMs: baked?.holdMs,
      previewType,
      entryPath,
    },
    titleI18n: asLocaleMap(raw.title_i18n),
    descriptionI18n: asLocaleMap(raw.description_i18n),
  };
}

function exportPlugins(repoRoot: string): CatalogPluginRecord[] {
  const baked = new Map<string, { video: string; poster: string; holdMs?: number }>();
  const out: CatalogPluginRecord[] = [];
  const officialRoot = join(repoRoot, "plugins/_official");
  for (const bucket of OFFICIAL_BUCKETS) {
    const dir = join(officialRoot, bucket);
    for (const name of listDirs(dir)) {
      const record = loadPlugin({
        manifestPath: join(dir, name, "pixo.json"),
        slug: name,
        bucket,
        sourceUrl: REPO_TREE ? `${REPO_TREE}/plugins/_official/${bucket}/${name}` : "",
        sourceDir: join(dir, name),
        baked,
      });
      if (record) out.push(record);
    }
  }

  const communityRoot = join(repoRoot, "plugins/community");
  for (const name of listDirs(communityRoot)) {
    const record = loadPlugin({
      manifestPath: join(communityRoot, name, "pixo.json"),
      slug: name,
      bucket: "community",
      routeId: `community/${name}`,
      sourceUrl: REPO_TREE ? `${REPO_TREE}/plugins/community/${name}` : "",
      sourceDir: join(communityRoot, name),
      baked,
    });
    if (record) out.push(record);
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Walk product content roots and emit a schemaVersion=1 catalog document.
 * Entry asset copying happens in the render/staging phase.
 */
export function exportCatalog(options: ExportCatalogOptions): ExportCatalogResult {
  const { repoRoot, sourceCommit } = options;
  if (!existsSync(repoRoot)) {
    throw new Error(`repo root does not exist: ${repoRoot}`);
  }

  const records: CatalogRecord[] = [
    ...exportSkills(repoRoot),
    ...exportCraft(repoRoot),
    ...exportDesignTemplates(repoRoot),
    ...exportLiveArtifacts(repoRoot),
    ...exportPlugins(repoRoot),
  ];

  const catalog: CatalogDocument = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    sourceCommit: sourceCommit.toLowerCase(),
    generatedAt: options.generatedAt,
    records,
  };

  return { catalog, warnings: [] };
}
