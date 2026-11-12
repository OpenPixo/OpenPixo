import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { ApiErrorCode, ArtStyle, InstalledPluginRecord, PluginExample, PluginManifest, ProjectArtStyleResponse } from '@openpixo/contracts';
import { getProject, updateProject } from '../db.js';
import { listInstalledPlugins } from '../plugins/registry.js';
import { projectStyleReference } from './reference.js';

export class ArtStyleError extends Error {
  constructor(message: string, readonly status = 400, readonly code: ApiErrorCode = 'BAD_REQUEST') { super(message); }
}

/** The first requested language wins; English and absent translations use the original text. */
export function catalogLocale(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const language = value.split(',')[0]?.split(';')[0]?.trim();
  return language?.toLowerCase().startsWith('zh') ? 'zh-CN' : language;
}

export function localizedText(text: string, translations: Record<string, string> | undefined, locale?: string): string {
  return locale ? translations?.[locale] ?? text : text;
}

export function localizeExamples(examples: PluginExample[] | undefined, locale?: string): PluginExample[] | undefined {
  return examples?.map(example => ({
    ...example,
    title: localizedText(example.title, example.title_i18n, locale),
    prompt: localizedText(example.prompt, example.prompt_i18n, locale),
  }));
}

export function artStyleFromManifest(manifest: PluginManifest, locale?: string): ArtStyle | null {
  const definition = manifest.pixo?.kind === 'style' ? manifest.pixo.style : undefined;
  if (!definition) return null;
  return {
    ...definition,
    title: localizedText(manifest.title ?? manifest.name, manifest.title_i18n, locale),
    ...(manifest.title_i18n ? { title_i18n: manifest.title_i18n } : {}),
    description: localizedText(manifest.description ?? '', manifest.description_i18n, locale),
    ...(manifest.description_i18n ? { description_i18n: manifest.description_i18n } : {}),
    license: manifest.license ?? 'Apache-2.0',
    examples: localizeExamples(manifest.examples, locale) ?? [],
    previews: definition.previews.map((_, index) => `/api/styles/${encodeURIComponent(definition.id)}/previews/${index}`),
  };
}

/** Saved projects and preview URLs keep working when a style is folded into another family. */
const RETIRED_STYLE_ALIASES = new Map([['monochrome-1-bit', 'pixel-8-bit']]);

function installedStyle(db: Database.Database, id: string): InstalledPluginRecord | undefined {
  const canonicalId = RETIRED_STYLE_ALIASES.get(id) ?? id;
  return listInstalledPlugins(db).find(plugin => plugin.manifest.pixo?.kind === 'style' && plugin.manifest.pixo.style?.id === canonicalId);
}

export function listArtStyles(db: Database.Database, locale?: string): ArtStyle[] {
  return listInstalledPlugins(db).flatMap(plugin => {
    const style = artStyleFromManifest(plugin.manifest, locale);
    return style ? [style] : [];
  }).sort((a, b) => a.title.localeCompare(b.title));
}

export function getArtStyle(db: Database.Database, id: string, locale?: string): ArtStyle | null {
  const plugin = installedStyle(db, id);
  return plugin ? artStyleFromManifest(plugin.manifest, locale) : null;
}

export function getProjectArtStyle(db: Database.Database, _projectRoot: string, projectId: string, locale?: string): ProjectArtStyleResponse {
  const project = getProject(db, projectId);
  if (!project) throw new ArtStyleError('project not found', 404, 'PROJECT_NOT_FOUND');
  const styleId = typeof project.metadata?.artStyleId === 'string' ? project.metadata.artStyleId : null;
  return { styleId, style: styleId ? getArtStyle(db, styleId, locale) : null, referenceImage: projectStyleReference(project.metadata) };
}


const STYLE_REFERENCE_IMAGE = /\.(?:png|jpe?g|webp)$/iu;

/**
 * Records the image new art should match. It must be an image inside the project
 * folder, named by a project-relative path, so a reference can never point outside it.
 */
export async function setProjectStyleReference(db: Database.Database, projectDir: (projectId: string) => string,
  projectId: string, reference: string | null, locale?: string): Promise<ProjectArtStyleResponse> {
  const project = getProject(db, projectId);
  if (!project) throw new ArtStyleError('project not found', 404, 'PROJECT_NOT_FOUND');
  let stored: string | null = null;
  if (reference !== null) {
    const relative = reference.trim().replace(/\\/gu, '/').replace(/^\.\//u, '');
    if (!relative || path.isAbsolute(relative) || /^[a-z]:/iu.test(relative) || relative.split('/').includes('..')) {
      throw new ArtStyleError('The style reference must be a project-relative path');
    }
    if (!STYLE_REFERENCE_IMAGE.test(relative)) throw new ArtStyleError('The style reference must be a PNG, JPEG or WebP image');
    const root = await realpath(projectDir(projectId)).catch(() => null);
    const file = root ? await realpath(path.join(root, relative)).catch(() => null) : null;
    if (!root || !file || (file !== root && !file.startsWith(root + path.sep)) || !(await stat(file)).isFile()) {
      throw new ArtStyleError('The style reference must be an existing image in the project', 404, 'NOT_FOUND');
    }
    stored = relative;
  }
  updateProject(db, projectId, { metadata: { ...project.metadata, styleReference: stored } });
  return getProjectArtStyle(db, '', projectId, locale);
}

export function setProjectArtStyle(db: Database.Database, projectRoot: string, projectId: string, styleId: string | null, locale?: string): ProjectArtStyleResponse {
  const project = getProject(db, projectId);
  if (!project) throw new ArtStyleError('project not found', 404, 'PROJECT_NOT_FOUND');
  if (styleId !== null && !getArtStyle(db, styleId)) throw new ArtStyleError('Art style is not installed', 404, 'STYLE_NOT_FOUND');
  updateProject(db, projectId, { metadata: { ...project.metadata, artStyleId: styleId } });
  return getProjectArtStyle(db, projectRoot, projectId, locale);
}

/** Omission inherits the project default; explicit null disables it for this request. */
export async function resolveArtStyleForGeneration(db: Database.Database, projectRoot: string, projectId?: string, styleId?: string | null): Promise<ArtStyle | null> {
  if (styleId === null) return null;
  if (styleId !== undefined) {
    if (typeof styleId !== 'string' || !styleId.trim()) throw new ArtStyleError('styleId must be a style id or null');
    const style = getArtStyle(db, styleId);
    if (!style) throw new ArtStyleError('Art style is not installed', 400, 'STYLE_NOT_FOUND');
    return style;
  }
  return projectId ? getProjectArtStyle(db, projectRoot, projectId).style : null;
}

/** Only manifest-listed raster images inside the real plugin folder can be served. */
export async function resolveArtStylePreview(db: Database.Database, id: string, index: number): Promise<string | null> {
  const plugin = installedStyle(db, id);
  const relative = plugin?.manifest.pixo?.style?.previews[index];
  if (!plugin || !relative || !Number.isSafeInteger(index) || index < 0
    || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)
    || !/\.(?:png|jpe?g|webp|gif|avif)$/i.test(relative)) return null;
  try {
    const root = await realpath(plugin.fsPath);
    const target = await realpath(path.resolve(root, relative));
    const within = path.relative(root, target);
    if (!within || path.isAbsolute(within) || within === '..' || within.startsWith(`..${path.sep}`)) return null;
    return (await stat(target)).isFile() ? target : null;
  } catch { return null; }
}
