// Plan §3.B4 — marketplaces add / list / refresh / remove / trust unit tests.
//
// Locks the storage half of the federated catalog story. The Phase 3
// follow-up will layer on `pixo plugin install <name>` resolution +
// trust UI, but the storage layout here is the contract that lookup
// will read against.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migratePlugins } from '../src/plugins/persistence.js';
import { MarketplaceManifestSchema } from '@openpixo/contracts';
import { createMarketplaceSeedHelpers, OFFICIAL_MARKETPLACE_ID } from '../src/plugins/marketplace-seed.js';
import {
  addMarketplace,
  ensureMarketplaceManifest,
  getMarketplace,
  listMarketplaces,
  marketplaceManifestUrlForRegistry,
  marketplaceRegistryIdFromUrl,
  refreshMarketplace,
  removeMarketplace,
  resolvePluginInMarketplaces,
  resolveMarketplaceFetchUrl,
  setMarketplaceTrust,
} from '../src/plugins/marketplaces.js';
import { getInstalledPlugin, upsertInstalledPlugin } from '../src/plugins/registry.js';

let db: Database.Database;
let tmpDir: string;

const VALID_MANIFEST = JSON.stringify({
  specVersion: '1.0.0',
  name: 'test-marketplace',
  version: '1.0.0',
  metadata: { description: 'fixture', version: '1.0.0' },
  plugins: [
    { name: 'sample-plugin', source: 'github:example-org/sample-plugin', version: '0.1.0' },
  ],
});

function fixtureFetcher(text: string, ok = true) {
  return async () => ({
    ok,
    status: ok ? 200 : 502,
    text: async () => text,
  });
}

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'pixo-mp-'));
  db = new Database(path.join(tmpDir, 'test.sqlite'));
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, title TEXT);
  `);
  migratePlugins(db);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('marketplaces', () => {
  it('addMarketplace fetches, validates, stores, and returns the row', async () => {
    const result = await addMarketplace(db, {
      url: 'https://example.com/marketplace.json',
      fetcher: fixtureFetcher(VALID_MANIFEST),
    });
    if (!result.ok) {
      throw new Error(`expected ok: ${JSON.stringify(result)}`);
    }
    expect(result.row.url).toBe('https://example.com/marketplace.json');
    expect(result.row.specVersion).toBe('1.0.0');
    expect(result.row.version).toBe('1.0.0');
    expect(result.row.trust).toBe('restricted');
    expect(result.row.manifest.plugins).toHaveLength(1);
    expect(listMarketplaces(db)).toHaveLength(1);
  });

  it('resolves marketplace names with exact versions, dist-tags, ranges, and yanks', async () => {
    const manifest = JSON.stringify({
      specVersion: '1.0.0',
      name: 'versions',
      version: '1.0.0',
      plugins: [
        {
          name: 'vendor/ranged',
          source: 'github:vendor/ranged@v1.2.0/plugin',
          version: '1.2.0',
          distTags: { latest: '1.2.0', beta: '2.0.0' },
          versions: [
            { version: '1.0.0', source: 'github:vendor/ranged@v1.0.0/plugin', integrity: 'sha256:one' },
            { version: '1.1.0', source: 'github:vendor/ranged@v1.1.0/plugin', integrity: 'sha256:two' },
            { version: '1.2.0', source: 'github:vendor/ranged@v1.2.0/plugin', integrity: 'sha256:three' },
            { version: '2.0.0', source: 'github:vendor/ranged@v2.0.0/plugin', yanked: true },
          ],
        },
      ],
    });
    const seeded = ensureMarketplaceManifest(db, {
      id: 'versions',
      url: 'https://example.com/versions.json',
      trust: 'trusted',
      manifestText: manifest,
    });
    if (!seeded.ok) throw new Error('seed failed');

    expect(resolvePluginInMarketplaces(db, 'vendor/ranged')?.pluginVersion).toBe('1.2.0');
    expect(resolvePluginInMarketplaces(db, 'vendor/ranged@1.0.0')).toMatchObject({
      pluginVersion: '1.0.0',
      source: 'github:vendor/ranged@v1.0.0/plugin',
      archiveIntegrity: 'sha256:one',
    });
    expect(resolvePluginInMarketplaces(db, 'vendor/ranged@^1.0.0')?.pluginVersion).toBe('1.2.0');
    expect(resolvePluginInMarketplaces(db, 'vendor/ranged@beta')).toBeNull();
  });

  it('addMarketplace rejects non-https urls', async () => {
    const result = await addMarketplace(db, {
      url: 'http://example.com/marketplace.json',
      fetcher: fixtureFetcher(VALID_MANIFEST),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toMatch(/https/);
    }
  });

  it('addMarketplace surfaces parse failures', async () => {
    const result = await addMarketplace(db, {
      url: 'https://example.com/marketplace.json',
      fetcher: fixtureFetcher('{}'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
    }
  });

  it('uses bundled catalogs by default and leaves custom destinations unchanged', () => {
    expect(marketplaceManifestUrlForRegistry('official')).toBe('bundled:openpixo-official');
    expect(marketplaceManifestUrlForRegistry(OFFICIAL_MARKETPLACE_ID)).toBe('bundled:openpixo-official');
    expect(resolveMarketplaceFetchUrl('https://catalog.example/marketplace.json')).toBe('https://catalog.example/marketplace.json');
  });

  it('requires a raw openpixo-marketplace.json document, not a GitHub tree page', async () => {
    const result = await addMarketplace(db, {
      url: 'https://github.com/example-org/plugin-fixtures/tree/garnet-hemisphere/plugins/registry/community',
      fetcher: fixtureFetcher('<!doctype html><html><body>GitHub tree page</body></html>'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.message).toMatch(/validation/i);
    }
  });

  it('refresh re-fetches and updates refreshed_at', async () => {
    const added = await addMarketplace(db, {
      url: 'https://example.com/marketplace.json',
      fetcher: fixtureFetcher(VALID_MANIFEST),
    });
    if (!added.ok) throw new Error('add failed');
    const updatedManifest = JSON.parse(VALID_MANIFEST);
    updatedManifest.plugins.push({
      name: 'new-plugin',
      source: 'github:example-org/new-plugin',
      version: '0.2.0',
    });
    updatedManifest.version = '1.0.1';
    const refreshed = await refreshMarketplace(
      db,
      added.row.id,
      fixtureFetcher(JSON.stringify(updatedManifest)),
    );
    if (!refreshed.ok) throw new Error('refresh failed');
    expect(refreshed.row.version).toBe('1.0.1');
    expect(refreshed.row.manifest.plugins).toHaveLength(2);
    expect(refreshed.row.refreshedAt).toBeGreaterThanOrEqual(added.row.refreshedAt);
  });

  it('does not remotely refresh an unconfigured default source', async () => {
    const seeded = ensureMarketplaceManifest(db, {
      id: 'community',
      url: 'bundled:openpixo-community',
      trust: 'restricted',
      manifestText: VALID_MANIFEST,
    });
    if (!seeded.ok) throw new Error('seed failed');
    const fetcher = vi.fn(fixtureFetcher(VALID_MANIFEST));
    expect(await refreshMarketplace(db, 'community', fetcher)).toMatchObject({ ok: false, status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(getMarketplace(db, 'community')).toEqual(seeded.row);

    const offline = ensureMarketplaceManifest(db, {
      id: 'official', url: marketplaceManifestUrlForRegistry('official'), trust: 'restricted', manifestText: VALID_MANIFEST,
    });
    if (!offline.ok) throw new Error('offline seed failed');
    expect(await refreshMarketplace(db, offline.row.id, fetcher)).toMatchObject({ ok: false, status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('setMarketplaceTrust updates the trust tier and remove deletes the row', async () => {
    const added = await addMarketplace(db, {
      url: 'https://example.com/marketplace.json',
      fetcher: fixtureFetcher(VALID_MANIFEST),
    });
    if (!added.ok) throw new Error('add failed');
    const trusted = setMarketplaceTrust(db, added.row.id, 'trusted');
    expect(trusted?.trust).toBe('trusted');
    expect(removeMarketplace(db, added.row.id)).toBe(true);
    expect(getMarketplace(db, added.row.id)).toBeNull();
  });

  it('upserts a fixed built-in marketplace manifest', () => {
    const result = ensureMarketplaceManifest(db, {
      id: 'official',
      url: marketplaceManifestUrlForRegistry('official'),
      trust: 'official',
      manifestText: VALID_MANIFEST,
      now: 123,
    });
    if (!result.ok) throw new Error('seed failed');
    expect(result.row.id).toBe(OFFICIAL_MARKETPLACE_ID);
    expect(result.row.trust).toBe('official');
    expect(setMarketplaceTrust(db, result.row.id, 'official')?.trust).toBe('official');

    const updatedManifest = JSON.stringify({
      specVersion: '1.0.0',
      name: 'test-marketplace',
      version: '1.0.1',
      plugins: [],
    });
    const updated = ensureMarketplaceManifest(db, {
      id: 'official',
      url: marketplaceManifestUrlForRegistry('official'),
      trust: 'official',
      manifestText: updatedManifest,
      now: 456,
    });
    if (!updated.ok) throw new Error('update failed');
    expect(listMarketplaces(db)).toHaveLength(1);
    expect(updated.row.addedAt).toBe(123);
    expect(updated.row.refreshedAt).toBe(456);
    expect(updated.row.version).toBe('1.0.1');
  });

  it('trusts only the bundled OpenPixo official seed without a remote signature', () => {
    const deps = {
      projectRoot: tmpDir,
      pluginRegistryDir: path.join(tmpDir, 'plugins/registry'),
      bundledPluginsDir: path.join(tmpDir, 'plugins/_official'),
      marketplaceManifestUrlForRegistry,
      marketplaceRegistryIdFromUrl,
    };
    const helpers = createMarketplaceSeedHelpers(deps);
    const configured = helpers.defaultMarketplaceSeedConfig('official');
    expect(configured).toEqual({ trust: 'official', url: `bundled:${OFFICIAL_MARKETPLACE_ID}` });
    expect(helpers.defaultMarketplaceSeedConfig(OFFICIAL_MARKETPLACE_ID)).toEqual(configured);
    expect(helpers.defaultMarketplaceSeedConfig('community').trust).toBe('restricted');

    const seeded = ensureMarketplaceManifest(db, {
      id: 'official', ...configured, manifestText: VALID_MANIFEST,
    });
    expect(seeded).toMatchObject({ ok: true, row: { id: OFFICIAL_MARKETPLACE_ID, trust: 'official' } });
    expect(resolvePluginInMarketplaces(db, 'sample-plugin')?.marketplaceTrust).toBe('official');

    const remoteUrl = 'https://registry.example/v1/marketplace.json';
    const remoteHelpers = createMarketplaceSeedHelpers({
      ...deps, marketplaceManifestUrlForRegistry: () => remoteUrl,
    });
    expect(remoteHelpers.defaultMarketplaceSeedConfig('official')).toEqual({ trust: 'restricted', url: remoteUrl });
    const remote = ensureMarketplaceManifest(db, {
      id: OFFICIAL_MARKETPLACE_ID, url: remoteUrl, trust: 'official', manifestText: VALID_MANIFEST,
    });
    expect(remote).toMatchObject({ ok: true, row: { trust: 'restricted' } });
    const community = ensureMarketplaceManifest(db, {
      id: 'community', url: `bundled:${OFFICIAL_MARKETPLACE_ID}`, trust: 'official', manifestText: VALID_MANIFEST,
    });
    expect(community).toMatchObject({ ok: true, row: { trust: 'restricted' } });
  });

  it('ships an empty community snapshot without upstream items', async () => {
    const communityManifest = await readFile(
      new URL('../../../plugins/registry/community/openpixo-marketplace.json', import.meta.url),
      'utf8',
    );

    const seeded = ensureMarketplaceManifest(db, {
      id: 'community',
      url: marketplaceManifestUrlForRegistry('community'),
      trust: 'restricted',
      manifestText: communityManifest,
      now: 123,
    });
    if (!seeded.ok) throw new Error('community seed failed');

    expect(seeded.row.trust).toBe('restricted');
    expect(seeded.row.manifest.plugins).toEqual([]);
  });

  it('ships licensed game entries backed by local content, MCP presets or cloud entitlements', async () => {
    const officialManifestText = await readFile(
      new URL('../../../plugins/registry/official/openpixo-marketplace.json', import.meta.url),
      'utf8',
    );
    const officialManifest = MarketplaceManifestSchema.parse(JSON.parse(officialManifestText));
    expect(officialManifest.name).toBe(OFFICIAL_MARKETPLACE_ID);
    expect(officialManifest.plugins.length).toBeGreaterThan(0);
    expect(officialManifest.metadata?.bundledPreinstallCount).toBe(
      officialManifest.plugins.filter(entry => entry.source.startsWith('./') || entry.kind === 'mcp').length,
    );
    const mcpPresets = await readFile(new URL('../src/mcp-config.ts', import.meta.url), 'utf8');
    for (const entry of officialManifest.plugins) {
      expect(entry.name).toMatch(/^openpixo\//);
      expect(entry.license?.trim()).toBeTruthy();
      if (entry.pricing?.type === 'paid') {
        expect(entry.kind).toBe('asset-pack');
        expect(entry.source).toBe('openpixo-cloud:' + entry.name.split('/').at(-1));
        continue;
      }
      expect(entry.pricing).toEqual({ type: 'free' });
      if (entry.kind === 'mcp') {
        expect(mcpPresets).toContain(`id: '${entry.mcpTemplateId}'`);
        expect(mcpPresets).toContain(entry.source.replace('github:', 'https://github.com/'));
      } else {
        expect((await stat(new URL(`../../../${entry.source}`, import.meta.url))).isDirectory()).toBe(true);
      }
      if (entry.kind === 'recipe') {
        const source = JSON.parse(await readFile(new URL(`../../../${entry.source}/pixo.json`, import.meta.url), 'utf8'));
        expect(entry.version).toBe(source.version);
        expect(entry.license).toBe(source.license);
      }
    }

    const seeded = ensureMarketplaceManifest(db, {
      id: 'official',
      url: marketplaceManifestUrlForRegistry('official'),
      trust: 'restricted',
      manifestText: officialManifestText,
      now: 123,
    });
    if (!seeded.ok) throw new Error('official seed failed');

    const resolved = resolvePluginInMarketplaces(db, 'openpixo/sprite-walk-8dir');
    expect(resolved?.marketplaceId).toBe(OFFICIAL_MARKETPLACE_ID);
    expect(resolved?.marketplaceTrust).toBe('restricted');
  });

  it('keeps the curated seed local and does not merge inherited bundled entries', async () => {
    const { fileURLToPath } = await import('node:url');
    const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const helpers = createMarketplaceSeedHelpers({
      projectRoot,
      pluginRegistryDir: path.join(projectRoot, 'plugins/registry'),
      bundledPluginsDir: path.join(projectRoot, 'plugins/_official'),
      marketplaceManifestUrlForRegistry,
      marketplaceRegistryIdFromUrl,
    });
    const text = await helpers.marketplaceSeedManifestText('official', [{ name: 'openpixo/unwanted' }]);
    const seed = MarketplaceManifestSchema.parse(JSON.parse(text!));
    expect(seed.plugins.every(entry => entry.name.startsWith('openpixo/'))).toBe(true);
    expect(seed.plugins.find(entry => entry.name === 'openpixo/pixel-dungeon-kit')).toMatchObject({
      source: 'openpixo-cloud:pixel-dungeon-kit', pricing: { type: 'paid', credits: 20, sku: 'workshop.pixel-dungeon-kit' },
      assetLicense: { commercialUse: true, attributionRequired: false }, tags: ['pixel', 'tileset', 'dungeon', 'roguelike'],
    });
    expect(seed.plugins.find(entry => entry.name === 'openpixo/godot-gdscript')?.source)
      .toBe(path.join(projectRoot, 'skills/godot-gdscript'));
    expect(helpers.bundledPluginRegistrySource(path.join(projectRoot, 'plugins/_official/recipes/sprite-walk-8dir')))
      .toBe(path.join(projectRoot, 'plugins/_official/recipes/sprite-walk-8dir'));
    expect(helpers.defaultMarketplaceSeedConfig('official')).toEqual({ trust: 'official', url: 'bundled:openpixo-official' });
  });
});

describe('resolvePluginInMarketplaces', () => {
  it('returns the canonical source string for a known plugin name', async () => {
    await addMarketplace(db, {
      url: 'https://example.com/marketplace.json',
      fetcher: fixtureFetcher(VALID_MANIFEST),
    });
    const resolved = resolvePluginInMarketplaces(db, 'sample-plugin');
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe('github:example-org/sample-plugin');
    expect(resolved!.pluginVersion).toBe('0.1.0');
    expect(resolved!.marketplaceVersion).toBe('1.0.0');
    expect(resolved!.marketplaceTrust).toBe('restricted');
  });

  it('matches case-insensitively', async () => {
    await addMarketplace(db, {
      url: 'https://example.com/marketplace.json',
      fetcher: fixtureFetcher(VALID_MANIFEST),
    });
    const resolved = resolvePluginInMarketplaces(db, 'SAMPLE-PLUGIN');
    expect(resolved?.pluginName).toBe('sample-plugin');
  });

  it('returns null when no marketplace knows the name', async () => {
    expect(resolvePluginInMarketplaces(db, 'mystery')).toBeNull();
    await addMarketplace(db, {
      url: 'https://example.com/marketplace.json',
      fetcher: fixtureFetcher(VALID_MANIFEST),
    });
    expect(resolvePluginInMarketplaces(db, 'mystery')).toBeNull();
  });

  it('walks marketplaces in registration order, first hit wins', async () => {
    const otherManifest = JSON.stringify({
      specVersion: '1.0.0',
      name: 'other',
      version: '1.0.0',
      plugins: [{ name: 'sample-plugin', source: 'github:other/sample', version: '0.9.0' }],
    });
    const first = await addMarketplace(db, {
      url: 'https://first.example/marketplace.json',
      fetcher: fixtureFetcher(otherManifest),
    });
    const second = await addMarketplace(db, {
      url: 'https://second.example/marketplace.json',
      fetcher: fixtureFetcher(VALID_MANIFEST),
    });
    if (!first.ok || !second.ok) throw new Error('setup failed');
    const resolved = resolvePluginInMarketplaces(db, 'sample-plugin');
    expect(resolved?.source).toBe('github:other/sample');
  });
});

it('parses every paid Workshop pack and keeps existing skill, MCP and template tags', async () => {
  const manifest = MarketplaceManifestSchema.parse(JSON.parse(await readFile(
    new URL('../../../plugins/registry/official/openpixo-marketplace.json', import.meta.url), 'utf8',
  )));
  // Mirrors the cloud's workshop_items prices; change both together.
  const expectedCredits: Record<string, number> = {
    'pixel-dungeon-kit': 20, 'forest-platformer-kit': 25, 'retro-bestiary': 25, 'cozy-farm-village': 20,
    'sci-fi-hud-kit': 15, 'fantasy-item-icons': 20, 'chiptune-sfx-pack': 15, 'topdown-hero-creator': 30,
    'space-shooter-kit': 20, 'match3-gem-pack': 15, 'fantasy-ui-kit': 20, 'card-game-frames': 15,
    'tower-defense-kit': 25, 'magic-vfx-pack': 20,
    'pixel-rpg-ui-kit': 20,
    'cozy-ui-kit': 15,
    'horror-ui-kit': 20,
    'mobile-casual-ui': 20,
    'cyberpunk-ui-kit': 20,
    'strategy-ui-kit': 25,
    'visual-novel-ui': 20,
    'arcade-hud-pack': 15,
    'dialogue-portrait-frames': 15,
    'game-cursor-pack': 15,
    'desert-ruins-tileset': 20,
    'snow-mountain-tileset': 20,
    'haunted-graveyard-tileset': 20,
    'pirate-island-kit': 25,
    'cyber-city-tileset': 25,
    'isometric-town-kit': 30,
    'underwater-reef-tileset': 20,
    'lava-cavern-tileset': 20,
    'sci-fi-station-tileset': 25,
    'japanese-village-kit': 25,
    'fantasy-hero-party': 25,
    'platformer-hero-pack': 20,
    'slime-monster-pack': 15,
    'undead-army-pack': 20,
    'robot-mech-pack': 25,
    'animal-companions': 20,
    'boss-monster-pack': 30,
    'townsfolk-npc-pack': 20,
    'skill-ability-icons': 20,
    'food-cooking-icons': 15,
    'sci-fi-loot-icons': 15,
    'crafting-resource-icons': 15,
    'gem-currency-icons': 15,
    'parallax-sky-backgrounds': 20,
    'weather-effects-pack': 15,
    'explosion-impact-vfx': 15,
    'vehicle-racing-pack': 25,
    'interior-furniture-kit': 20,
    'retro-music-loops': 20,
    'ui-sound-pack': 15,
  };
  const paid = manifest.plugins.filter(entry => entry.pricing?.type === 'paid');
  expect(paid.map(entry => entry.name).sort()).toEqual(Object.keys(expectedCredits).map(slug => 'openpixo/' + slug).sort());
  for (const entry of paid) {
    const slug = entry.name.split('/').at(-1)!;
    expect(entry).toMatchObject({
      kind: 'asset-pack', version: '1.0.0', engines: ['any'], license: 'LicenseRef-OpenPixo-Asset',
      source: 'openpixo-cloud:' + slug, assetLicense: { commercialUse: true, attributionRequired: false },
      pricing: { type: 'paid', credits: expectedCredits[slug], sku: 'workshop.' + slug },
    });
    expect(typeof entry.pricing?.credits).toBe('number');
    expect(entry.title_i18n?.['zh-CN']).toBeTruthy();
    expect(entry.description_i18n?.['zh-CN']).toBeTruthy();
    expect(entry.description).toContain('Godot and Phaser ready');
    expect(entry.tags?.length).toBeGreaterThan(0);
    // A paid pack is sold on its artwork: the store page needs a cover and at least two previews.
    for (const file of [`covers/${slug}.webp`, `previews/${slug}/1.webp`, `previews/${slug}/2.webp`]) {
      expect((await stat(new URL(`../../../plugins/registry/official/${file}`, import.meta.url))).isFile(), file).toBe(true);
    }
  }
  for (const entry of manifest.plugins.filter(entry => ['skill', 'mcp', 'project-template'].includes(entry.kind ?? ''))) {
    expect(entry.tags?.length).toBeGreaterThanOrEqual(2);
    expect(entry.tags?.every(tag => tag === tag.toLowerCase())).toBe(true);
  }
  const seeded = ensureMarketplaceManifest(db, { id: 'official', url: 'bundled:openpixo-official', trust: 'official',
    manifestText: JSON.stringify(manifest) });
  expect(seeded.ok).toBe(true);
  if (!seeded.ok) throw new Error(seeded.message);
  expect(seeded.row.manifest.plugins.filter(entry => entry.kind === 'asset-pack')).toHaveLength(54);
});
