// Marketplace registry — plan §3.B4 / spec §6 / §7 / §11.5 / §16 Phase 3
// (entry slice).
//
// Stores user-configured federated catalog indexes in
// `plugin_marketplaces`. The actual `pixo plugin install <name>` resolution
// through these catalogs lands in Phase 3 alongside the trust UI; this
// module is the storage + refresh half so the desktop / CLI can already
// register and inspect catalogs.
//
// We intentionally treat the catalog body as opaque JSON in v1 — Zod
// validation lives in `@openpixo/plugin-runtime`'s parser and we only
// store what the parser returns. Trust default mirrors §9: a freshly
// added user-supplied marketplace is `restricted` (discovery only)
// unless `--trust` is passed.

import { randomUUID } from 'node:crypto';
import { safeExternalFetch } from './plugin-asset-cache.js';
import { OFFICIAL_MARKETPLACE_ID } from './marketplace-seed.js';
import { REGISTRY_CONFIGURATION, verifyRegistrySignature } from './registry-signature.js';
import type Database from 'better-sqlite3';
import {
  parseMarketplace,
  type MarketplaceParseResult,
} from '@openpixo/plugin-runtime';
import {
  OPENPIXO_PLUGIN_SPEC_VERSION,
  type MarketplaceManifest,
} from '@openpixo/contracts';
import {
  parsePluginSpecifier,
  resolveMarketplaceEntryVersion,
} from '../registry/versioning.js';

type SqliteDb = Database.Database;

export type MarketplaceTrustTier = 'official' | 'trusted' | 'restricted';

export interface MarketplaceRow {
  id: string;
  url: string;
  specVersion: string;
  version: string;
  trust: MarketplaceTrustTier;
  manifest: MarketplaceManifest;
  addedAt: number;
  refreshedAt: number;
}

export interface AddMarketplaceInput {
  url: string;
  // Pluggable HTTPS fetcher; tests inject a stub. Production injects the
  // global fetch.
  fetcher?: (url: string) => Promise<{
    ok: boolean;
    status: number;
    text: () => Promise<string>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  }>;
  trust?: MarketplaceTrustTier;
}

export interface AddMarketplaceResult {
  ok: true;
  row: MarketplaceRow;
  warnings: string[];
}

export interface AddMarketplaceFailure {
  ok: false;
  status: number;
  message: string;
  errors?: string[];
}

export interface EnsureMarketplaceManifestInput {
  id: string;
  url: string;
  trust: MarketplaceTrustTier;
  manifestText: string;
  now?: number;
}

const HTTPS_RE = /^https:\/\//i;
export function marketplaceRegistryBaseUrl(): string | null {
  return REGISTRY_CONFIGURATION.url;
}

export function marketplaceManifestUrlForRegistry(id: string): string {
  const registryId = id.trim();
  if (registryId === 'official' || registryId === OFFICIAL_MARKETPLACE_ID) {
    const base = marketplaceRegistryBaseUrl();
    return base ? `${base}/v1/marketplace.json` : `bundled:${OFFICIAL_MARKETPLACE_ID}`;
  }
  return `bundled:openpixo-${registryId}`;
}

export function marketplaceRegistryIdFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed === marketplaceManifestUrlForRegistry('official') || trimmed === `bundled:${OFFICIAL_MARKETPLACE_ID}`) return 'official';
  if (trimmed === marketplaceManifestUrlForRegistry('community')) return 'community';
  return null;
}

export function resolveMarketplaceFetchUrl(url: string): string {
  const trimmed = url.trim();
  const registryId = marketplaceRegistryIdFromUrl(trimmed);
  return registryId ? marketplaceManifestUrlForRegistry(registryId) : trimmed;
}

function normalizeMarketplaceTrust(value: unknown): MarketplaceTrustTier {
  return value === 'official' || value === 'trusted' ? value : 'restricted';
}

function signatureFailure(): AddMarketplaceFailure {
  return { ok: false, status: 422, message: 'catalog signature verification failed' };
}

function isOfficialRegistryUrl(url: string): boolean {
  return REGISTRY_CONFIGURATION.url !== null && url === marketplaceManifestUrlForRegistry('official');
}

async function fetchMarketplaceManifest(
  url: string,
  fetcher: NonNullable<AddMarketplaceInput['fetcher']>,
  signed: boolean,
): Promise<{ ok: true; text: string } | AddMarketplaceFailure> {
  let response;
  try {
    response = await fetcher(url);
  } catch (err) {
    return { ok: false, status: 502, message: `Fetch failed: ${(err as Error).message ?? String(err)}` };
  }
  if (!response.ok) return { ok: false, status: 502, message: `Marketplace fetch returned ${response.status}` };
  try {
    if (!signed) return { ok: true, text: await response.text() };
    if (!response.arrayBuffer) return signatureFailure();
    const bytes = Buffer.from(await response.arrayBuffer());
    const signature = await fetcher(`${url}.sig`);
    if (!signature.ok || !verifyRegistrySignature(bytes, await signature.text())) return signatureFailure();
    return { ok: true, text: bytes.toString('utf8') };
  } catch (err) {
    return signed ? signatureFailure() : { ok: false, status: 502, message: `Fetch failed: ${(err as Error).message ?? String(err)}` };
  }
}

export async function addMarketplace(
  db: SqliteDb,
  input: AddMarketplaceInput,
): Promise<AddMarketplaceResult | AddMarketplaceFailure> {
  const url = resolveMarketplaceFetchUrl(input.url);
  if (!HTTPS_RE.test(url)) {
    return {
      ok: false,
      status: 400,
      message: 'marketplace url must use https://',
    };
  }
  const signed = isOfficialRegistryUrl(url) || input.trust === 'official';
  const fetched = await fetchMarketplaceManifest(url, input.fetcher ?? defaultFetcher, signed);
  if (!fetched.ok) return fetched;
  const text = fetched.text;
  const parsed: MarketplaceParseResult = parseMarketplace(text);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 422,
      message: 'marketplace manifest failed validation',
      errors: parsed.errors,
    };
  }
  const id = isOfficialRegistryUrl(url) ? OFFICIAL_MARKETPLACE_ID : randomUUID();
  const now = Date.now();
  const addedAt = getMarketplace(db, id)?.addedAt ?? now;
  const trust = signed ? 'official' : normalizeMarketplaceTrust(input.trust);
  db.prepare(
    `INSERT INTO plugin_marketplaces (id, url, spec_version, version, trust, manifest_json, added_at, refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET url = excluded.url, spec_version = excluded.spec_version,
       version = excluded.version, trust = excluded.trust, manifest_json = excluded.manifest_json,
       refreshed_at = excluded.refreshed_at`,
  ).run(id, url, parsed.manifest.specVersion, parsed.manifest.version, trust, text, addedAt, now);
  return {
    ok: true,
    row: {
      id,
      url,
      specVersion: parsed.manifest.specVersion,
      version: parsed.manifest.version,
      trust,
      manifest: parsed.manifest,
      addedAt,
      refreshedAt: now,
    },
    warnings: [],
  };
}

export function ensureMarketplaceManifest(
  db: SqliteDb,
  input: EnsureMarketplaceManifestInput,
): AddMarketplaceResult | AddMarketplaceFailure {
  const parsed = parseMarketplace(input.manifestText);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 422,
      message: 'marketplace manifest failed validation',
      errors: parsed.errors,
    };
  }
  const id = input.id === 'official' ? OFFICIAL_MARKETPLACE_ID : input.id;
  const now = input.now ?? Date.now();
  const bundledOfficial = id === OFFICIAL_MARKETPLACE_ID && input.url === `bundled:${OFFICIAL_MARKETPLACE_ID}`;
  // Only the app-bundled official snapshot carries build provenance without a signature.
  const trust = input.trust === 'official' && !bundledOfficial ? 'restricted' : normalizeMarketplaceTrust(input.trust);
  const existing = getMarketplace(db, id);
  if (id === OFFICIAL_MARKETPLACE_ID && !bundledOfficial && existing?.trust === 'official' && existing.url === input.url) {
    return { ok: true, row: existing, warnings: [] };
  }
  db.prepare(`
    INSERT INTO plugin_marketplaces (id, url, spec_version, version, trust, manifest_json, added_at, refreshed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      spec_version = excluded.spec_version,
      version = excluded.version,
      trust = excluded.trust,
      manifest_json = excluded.manifest_json,
      refreshed_at = excluded.refreshed_at
  `).run(
    id,
    input.url,
    parsed.manifest.specVersion,
    parsed.manifest.version,
    trust,
    input.manifestText,
    existing?.addedAt ?? now,
    now,
  );
  return {
    ok: true,
    row: {
      id,
      url: input.url,
      specVersion: parsed.manifest.specVersion,
      version: parsed.manifest.version,
      trust,
      manifest: parsed.manifest,
      addedAt: existing?.addedAt ?? now,
      refreshedAt: now,
    },
    warnings: [],
  };
}

export function listMarketplaces(db: SqliteDb): MarketplaceRow[] {
  const rows = db
    .prepare(`SELECT id, url, spec_version, version, trust, manifest_json, added_at, refreshed_at FROM plugin_marketplaces ORDER BY added_at ASC`)
    .all() as Array<{
      id: string;
      url: string;
      spec_version: string;
      version: string;
      trust: MarketplaceTrustTier;
      manifest_json: string;
      added_at: number;
      refreshed_at: number;
    }>;
  return rows.map((r) => {
    const manifest = safeParseManifest(r.manifest_json);
    return {
      id: r.id,
      url: r.url,
      specVersion: r.spec_version || manifest.specVersion,
      version: r.version === '0.0.0' ? manifest.version : r.version,
      trust: normalizeMarketplaceTrust(r.trust),
      manifest,
      addedAt: r.added_at,
      refreshedAt: r.refreshed_at,
    };
  });
}

export function getMarketplace(db: SqliteDb, id: string): MarketplaceRow | null {
  const row = db
    .prepare(`SELECT id, url, spec_version, version, trust, manifest_json, added_at, refreshed_at FROM plugin_marketplaces WHERE id = ?`)
    .get(id) as
      | undefined
      | {
          id: string;
          url: string;
          spec_version: string;
          version: string;
          trust: MarketplaceTrustTier;
          manifest_json: string;
          added_at: number;
          refreshed_at: number;
        };
  if (!row) return null;
  const manifest = safeParseManifest(row.manifest_json);
  return {
    id: row.id,
    url: row.url,
    specVersion: row.spec_version || manifest.specVersion,
    version: row.version === '0.0.0' ? manifest.version : row.version,
    trust: normalizeMarketplaceTrust(row.trust),
    manifest,
    addedAt: row.added_at,
    refreshedAt: row.refreshed_at,
  };
}

export function removeMarketplace(db: SqliteDb, id: string): boolean {
  const info = db.prepare(`DELETE FROM plugin_marketplaces WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function setMarketplaceTrust(
  db: SqliteDb,
  id: string,
  trust: MarketplaceTrustTier,
): MarketplaceRow | null {
  if (trust === 'official' && getMarketplace(db, id)?.trust !== 'official') {
    throw new Error('catalog signature verification failed');
  }
  const info = db.prepare(`UPDATE plugin_marketplaces SET trust = ? WHERE id = ?`).run(trust, id);
  if (info.changes === 0) return null;
  return getMarketplace(db, id);
}

export interface RefreshMarketplaceResult {
  ok: true;
  row: MarketplaceRow;
}

export async function refreshMarketplace(
  db: SqliteDb,
  id: string,
  fetcher?: AddMarketplaceInput['fetcher'],
): Promise<RefreshMarketplaceResult | AddMarketplaceFailure> {
  const existing = getMarketplace(db, id);
  if (!existing) {
    return { ok: false, status: 404, message: `marketplace ${id} not found` };
  }
  const url = resolveMarketplaceFetchUrl(existing.url);
  if (url.startsWith('bundled:')) {
    return { ok: false, status: 503, message: 'registry is not configured; using bundled offline catalog' };
  }
  const signed = isOfficialRegistryUrl(url) || existing.trust === 'official';
  const fetched = await fetchMarketplaceManifest(url, fetcher ?? defaultFetcher, signed);
  if (!fetched.ok) return fetched;
  const text = fetched.text;
  const parsed = parseMarketplace(text);
  if (!parsed.ok) {
    return { ok: false, status: 422, message: 'marketplace manifest failed validation', errors: parsed.errors };
  }
  const now = Date.now();
  const trust = signed ? 'official' : existing.trust;
  db.prepare(`UPDATE plugin_marketplaces SET url = ?, spec_version = ?, version = ?, trust = ?, manifest_json = ?, refreshed_at = ? WHERE id = ?`)
    .run(url, parsed.manifest.specVersion, parsed.manifest.version, trust, text, now, id);
  return {
    ok: true,
    row: {
      ...existing,
      url,
      trust,
      specVersion: parsed.manifest.specVersion,
      version: parsed.manifest.version,
      manifest: parsed.manifest,
      refreshedAt: now,
    },
  };
}

async function defaultFetcher(url: string) {
  const response = await safeExternalFetch(url);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
    arrayBuffer: () => response.arrayBuffer(),
  };
}

function safeParseManifest(raw: string): MarketplaceManifest {
  try {
    const parsed = parseMarketplace(raw);
    if (parsed.ok) return parsed.manifest;
  } catch {
    // fall through
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('legacy marketplace manifest is not an object');
    }
    const legacy = parsed as Record<string, unknown>;
    const metadata = typeof legacy['metadata'] === 'object' && legacy['metadata'] !== null
      ? legacy['metadata'] as Record<string, unknown>
      : {};
    const plugins = Array.isArray(legacy?.['plugins'])
      ? (legacy['plugins'] as unknown[]).flatMap((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
          const obj = entry as Record<string, unknown>;
          const name = typeof obj['name'] === 'string' ? obj['name'] : '';
          const source = typeof obj['source'] === 'string' ? obj['source'] : '';
          if (!name || !source) return [];
          return [{
            ...obj,
            name,
            source,
            version: typeof obj['version'] === 'string' && obj['version'].length > 0
              ? obj['version']
              : '0.0.0',
          }];
        })
      : [];
    return {
      ...legacy,
      specVersion: typeof legacy['specVersion'] === 'string'
        ? legacy['specVersion'] as string
        : OPENPIXO_PLUGIN_SPEC_VERSION,
      name: typeof legacy['name'] === 'string' ? legacy['name'] as string : 'unknown',
      version: typeof legacy['version'] === 'string' && (legacy['version'] as string).length > 0
        ? legacy['version'] as string
        : typeof metadata['version'] === 'string' && metadata['version'].length > 0
          ? metadata['version']
          : '0.0.0',
      plugins,
    } as MarketplaceManifest;
  } catch {
    // fall through
  }
  // Last-resort fallback: return a minimal shape so the caller doesn't
  // explode if a database row was stored before a schema patch.
  return {
    specVersion: OPENPIXO_PLUGIN_SPEC_VERSION,
    name: 'unknown',
    version: '0.0.0',
    plugins: [],
  } as MarketplaceManifest;
}

// Plan §3.F3 / spec §7.2 + §6 — resolve a bare plugin name through
// every configured marketplace. Returns the first match (marketplace
// scan order matches `listMarketplaces` output, which is sorted by
// `added_at` ASC). The match carries the marketplace id (so audit
// trails record which catalog the install came from) and the resolved
// `source` string the installer can re-feed into `installPlugin()`.
//
// `restricted` marketplaces still resolve names — the plugin install
// path does NOT auto-trust the resulting plugin (it stays
// `restricted` per spec §9 unless the marketplace was explicitly
// `trusted` at add-time).
export interface ResolvedPluginEntry {
  marketplaceId: string;
  marketplaceUrl: string;
  marketplaceTrust: MarketplaceTrustTier;
  marketplaceSpecVersion: string;
  marketplaceVersion: string;
  pluginName: string;
  pluginVersion: string;
  source: string;
  ref?: string;
  manifestDigest?: string;
  archiveIntegrity?: string;
  description?: string;
}

export function resolvePluginInMarketplaces(
  db: SqliteDb,
  pluginName: string,
): ResolvedPluginEntry | null {
  const rows = listMarketplaces(db);
  const specifier = parsePluginSpecifier(pluginName);
  const target = specifier.name.trim().toLowerCase();
  if (!target) return null;
  for (const row of rows) {
    const entries = row.manifest.plugins ?? [];
    for (const entry of entries) {
      if (entry.name && entry.name.toLowerCase() === target) {
        const resolvedVersion = resolveMarketplaceEntryVersion(entry, specifier.range);
        if (!resolvedVersion) continue;
        const result: ResolvedPluginEntry = {
          marketplaceId:    row.id,
          marketplaceUrl:   row.url,
          marketplaceTrust: row.trust,
          marketplaceSpecVersion: row.specVersion,
          marketplaceVersion: row.version,
          pluginName:       entry.name,
          pluginVersion:    resolvedVersion.version,
          source:           resolvedVersion.source,
        };
        if (resolvedVersion.ref) result.ref = resolvedVersion.ref;
        if (resolvedVersion.manifestDigest) result.manifestDigest = resolvedVersion.manifestDigest;
        if (resolvedVersion.archiveIntegrity) result.archiveIntegrity = resolvedVersion.archiveIntegrity;
        if (entry.description) result.description = entry.description;
        return result;
      }
    }
  }
  return null;
}
