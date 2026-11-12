import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { MarketplacePluginEntry, PluginManifest, StoreCatalogItem, StoreCatalogQuery, StoreItemDetail } from '@openpixo/contracts';
import { adaptAgentSkill, mergeManifests, parseManifest } from '@openpixo/plugin-runtime';
import { listMarketplaces, marketplaceRegistryIdFromUrl, type MarketplaceRow } from '../plugins/marketplaces.js';
import { bundledMarketplaceRegistryDir } from '../plugins/marketplace-seed.js';
import { listInstalledPlugins } from '../plugins/registry.js';
import type { PathDeps } from '../server-context.js';
import { artStyleFromManifest, localizeExamples, localizedText } from '../styles/service.js';

type StoreCatalogPaths = Pick<PathDeps, 'PLUGIN_REGISTRY_DIR'>;

function bundledArtwork(entry: MarketplacePluginEntry, marketplace: MarketplaceRow, paths?: StoreCatalogPaths) {
  if (!paths?.PLUGIN_REGISTRY_DIR || !marketplace.url.startsWith('bundled:')) return null;
  const id = marketplaceRegistryIdFromUrl(marketplace.url);
  const slug = entry.name.slice(entry.name.lastIndexOf('/') + 1);
  if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) return null;
  return { directory: bundledMarketplaceRegistryDir(paths.PLUGIN_REGISTRY_DIR, id), slug };
}

/** Only real files contained by the resolved bundled registry may be exposed. */
function artworkFile(directory: string, ...segments: string[]): string | null {
  try {
    const root = realpathSync(directory);
    const file = realpathSync(path.join(root, ...segments));
    const relative = path.relative(root, file);
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return null;
    return statSync(file).isFile() ? file : null;
  } catch { return null; }
}

function httpsIcon(icon?: string): string | undefined {
  try {
    const url = new URL(icon ?? '');
    return url.protocol === 'https:' ? url.href : undefined;
  } catch { return undefined; }
}

export function resolveStoreCover(db: Database.Database, name: string, paths: StoreCatalogPaths): string | null {
  const found = storeEntries(db).find(({ entry }) => entry.name.toLowerCase() === name.toLowerCase());
  const artwork = found && bundledArtwork(found.entry, found.marketplace, paths);
  return artwork ? artworkFile(artwork.directory, 'covers', `${artwork.slug}.webp`) : null;
}

export function resolveStorePreview(db: Database.Database, name: string, index: number, paths: StoreCatalogPaths): string | null {
  if (!Number.isSafeInteger(index) || index < 0) return null;
  const found = storeEntries(db).find(({ entry }) => entry.name.toLowerCase() === name.toLowerCase());
  const artwork = found && bundledArtwork(found.entry, found.marketplace, paths);
  if (!artwork) return null;
  // The public index addresses the same contiguous sequence shown in item detail.
  for (let current = 0; current <= index; current++) {
    const file = artworkFile(artwork.directory, 'previews', artwork.slug, `${current + 1}.webp`);
    if (!file) return null;
    if (current === index) return file;
  }
  return null;
}

export function storeEntries(db: Database.Database): Array<{ entry: MarketplacePluginEntry; marketplace: MarketplaceRow }> {
  const seen = new Set<string>();
  return listMarketplaces(db).flatMap(marketplace => marketplace.manifest.plugins.flatMap(entry => {
    const key = entry.name.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return entry.kind && entry.license && !entry.yanked ? [{ entry, marketplace }] : [];
  }));
}

/** An entry counts as installed when the store installed it, or when the app ships it as a bundled plugin under the same id. */
export function findInstalledStorePlugin(db: Database.Database, entry: MarketplacePluginEntry) {
  const name = entry.name.toLowerCase();
  return listInstalledPlugins(db).find(plugin =>
    plugin.sourceMarketplaceEntryName?.toLowerCase() === name
    || (plugin.sourceKind === 'bundled' && plugin.id.toLowerCase() === name));
}

/** Bundled skill frontmatter uses the same manifest adapter as plugin discovery. */
function bundledResourceManifest(entry: MarketplacePluginEntry, marketplace: MarketplaceRow): PluginManifest | undefined {
  if (!marketplace.url.startsWith('bundled:') || !['skill', 'style'].includes(entry.kind ?? '') || !path.isAbsolute(entry.source)) return;
  try {
    let sidecar: PluginManifest | undefined;
    try {
      const parsed = parseManifest(readFileSync(path.join(entry.source, 'pixo.json'), 'utf8'));
      if (parsed.ok) sidecar = parsed.manifest;
    } catch { /* Portable skills may omit the sidecar. */ }
    const adapters = entry.kind === 'skill'
      ? [adaptAgentSkill(readFileSync(path.join(entry.source, 'SKILL.md'), 'utf8'), { folderId: entry.name }).manifest] : [];
    return sidecar || adapters.length ? mergeManifests({ sidecar, adapters }) : undefined;
  } catch { return undefined; }
}

/** Registry translations take precedence; bundled resources fill snapshot locale gaps. */
function catalogItem(db: Database.Database, entry: MarketplacePluginEntry, marketplace: MarketplaceRow, locale?: string, paths?: StoreCatalogPaths): StoreCatalogItem {
  const installed = findInstalledStorePlugin(db, entry);
  const bundledManifest = installed?.version === entry.version
    ? installed.manifest : bundledResourceManifest(entry, marketplace);
  const titleI18n = { ...bundledManifest?.title_i18n, ...entry.title_i18n };
  const descriptionI18n = { ...bundledManifest?.description_i18n, ...entry.description_i18n };
  const style = bundledManifest ? artStyleFromManifest(bundledManifest, locale) : null;
  const examples = localizeExamples(entry.examples ?? bundledManifest?.examples, locale);
  const artwork = bundledArtwork(entry, marketplace, paths);
  const coverUrl = marketplace.url.startsWith('bundled:')
    ? artwork && artworkFile(artwork.directory, 'covers', `${artwork.slug}.webp`)
      ? `/api/store/items/${encodeURIComponent(entry.name)}/cover` : undefined
    : httpsIcon(entry.icon);
  return {
    name: entry.name, version: entry.version, kind: entry.kind!, license: entry.license!,
    title: localizedText(entry.title ?? bundledManifest?.title ?? entry.name, titleI18n, locale), title_i18n: bundledManifest?.title_i18n
      ? { ...(entry.title ? { en: entry.title } : {}), ...bundledManifest.title_i18n, ...entry.title_i18n } : entry.title_i18n,
    description: localizedText(entry.description ?? bundledManifest?.description ?? '', descriptionI18n, locale), description_i18n: bundledManifest?.description_i18n
      ? { ...(entry.description ? { en: entry.description } : {}), ...bundledManifest.description_i18n, ...entry.description_i18n } : entry.description_i18n,
    engines: entry.engines ?? ['any'], pricing: entry.pricing ?? { type: 'free' },
    assetLicense: entry.assetLicense,
    ...(entry.tags ? { tags: entry.tags } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(examples ? { examples } : {}),
    ...(style ? { style } : {}),
    ...(installed ? { installedVersion: installed.version } : {}),
  };
}

export function storeCatalog(db: Database.Database, query: StoreCatalogQuery, locale?: string, paths?: StoreCatalogPaths): StoreCatalogItem[] {
  const search = query.q?.trim().toLowerCase();
  return storeEntries(db).map(({ entry, marketplace }) => catalogItem(db, entry, marketplace, locale, paths)).filter(item =>
    (!query.kind || item.kind === query.kind)
    && (!query.pricing || item.pricing.type === query.pricing)
    && (!query.engine || item.engines.includes('any') || item.engines.includes(query.engine))
    && (!search || [item.name, item.title, item.description, ...Object.values(item.title_i18n ?? {}),
      ...Object.values(item.description_i18n ?? {})].some(value => value?.toLowerCase().includes(search))));
}

export function storeItemDetail(db: Database.Database, name: string, locale?: string, paths?: StoreCatalogPaths): StoreItemDetail | null {
  const found = storeEntries(db).find(({ entry }) => entry.name.toLowerCase() === name.toLowerCase());
  if (!found) return null;
  const { entry, marketplace } = found;
  const item = catalogItem(db, entry, marketplace, locale, paths);
  const artwork = bundledArtwork(entry, marketplace, paths);
  const localPreviews: string[] = [];
  if (artwork && !item.style?.previews.length) {
    for (let number = 1; artworkFile(artwork.directory, 'previews', artwork.slug, `${number}.webp`); number++) {
      localPreviews.push(`/api/store/items/${encodeURIComponent(entry.name)}/previews/${number - 1}`);
    }
  }
  return {
    ...item,
    previews: item.style?.previews.length ? item.style.previews : marketplace.url.startsWith('bundled:') ? localPreviews : (entry.previews ?? []).flatMap(preview => {
      try {
        const url = new URL(preview, marketplace.url);
        return url.protocol === 'https:' ? [url.href] : [];
      } catch { return []; }
    }),
    requires: entry.requires ?? {},
    versions: [...new Set([entry.version, ...(entry.versions ?? []).filter(version => !version.yanked).map(version => version.version)])],
  };
}
