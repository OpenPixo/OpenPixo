import { generateKeyPairSync, sign } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migratePlugins } from '../../src/plugins/persistence.js';

const registryUrl = 'https://registry.example/v1/marketplace.json';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const keys = { test: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
const oldText = JSON.stringify({ name: 'openpixo-official', version: '0.1.0', plugins: [] });
const newText = JSON.stringify({
  name: 'openpixo-official', version: '0.2.0',
  plugins: [{ name: 'openpixo/example', source: './example', version: '0.2.0', kind: 'skill', license: 'Apache-2.0', pricing: { type: 'free' }, title: 'ゲーム' }],
}) + '\r\n';

function signature(text: string, keyId = 'test') {
  return JSON.stringify({ alg: 'ed25519', keyId, signature: sign(null, Buffer.from(text), privateKey).toString('base64') });
}

function fetcher(text: string, envelope: string | null) {
  return vi.fn(async (url: string) => new Response(url.endsWith('.sig') ? envelope : text, {
    status: url.endsWith('.sig') && envelope === null ? 404 : 200,
  }));
}

let db: Database.Database;
let marketplaces: typeof import('../../src/plugins/marketplaces.js');

beforeEach(async () => {
  vi.stubEnv('PIXO_REGISTRY_URL', 'https://registry.example/');
  vi.stubEnv('PIXO_REGISTRY_PUBLIC_KEYS', JSON.stringify(keys));
  vi.resetModules();
  marketplaces = await import('../../src/plugins/marketplaces.js');
  db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, title TEXT);');
  migratePlugins(db);
  const seeded = marketplaces.ensureMarketplaceManifest(db, {
    id: 'official', url: registryUrl, trust: 'restricted', manifestText: oldText, now: 123,
  });
  if (!seeded.ok) throw new Error('seed failed');
});

afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('verified registry refresh', () => {
  it('fetches the configured registry and signature, then promotes trust', async () => {
    const fetch = fetcher(newText, signature(newText));
    const refreshed = await marketplaces.refreshMarketplace(db, 'openpixo-official', fetch);
    expect(refreshed).toMatchObject({ ok: true, row: { version: '0.2.0', trust: 'official', url: registryUrl } });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([registryUrl, `${registryUrl}.sig`]);
    expect(db.prepare('SELECT manifest_json FROM plugin_marketplaces').get()).toEqual({ manifest_json: newText });
    const seeded = marketplaces.ensureMarketplaceManifest(db, {
      id: 'official', url: registryUrl, trust: 'restricted', manifestText: oldText,
    });
    expect(seeded).toMatchObject({ ok: true, row: { version: '0.2.0', trust: 'official' } });
  });

  it.each([
    ['tampered bytes', newText.replace('0.2.0', '0.3.0'), signature(newText)],
    ['unknown key', newText, signature(newText, 'unknown')],
    ['missing signature', newText, null],
    ['malformed signature', newText, '{bad json'],
  ])('preserves every cached column on %s', async (_name, text, envelope) => {
    const before = db.prepare('SELECT * FROM plugin_marketplaces').get();
    const result = await marketplaces.refreshMarketplace(db, 'openpixo-official', fetcher(text!, envelope!));
    expect(result).toEqual({ ok: false, status: 422, message: 'catalog signature verification failed' });
    expect(db.prepare('SELECT * FROM plugin_marketplaces').get()).toEqual(before);
  });

  it('verifies adds and refuses unsigned official trust for user-added sources', async () => {
    const unsigned = await marketplaces.addMarketplace(db, { url: 'https://user.example/catalog.json', trust: 'official', fetcher: fetcher(newText, null) });
    expect(unsigned).toEqual({ ok: false, status: 422, message: 'catalog signature verification failed' });
    expect(marketplaces.listMarketplaces(db)).toHaveLength(1);
    const added = await marketplaces.addMarketplace(db, { url: registryUrl, fetcher: fetcher(newText, signature(newText)) });
    expect(added).toMatchObject({ ok: true, row: { id: 'openpixo-official', trust: 'official', addedAt: 123 } });
    expect(marketplaces.listMarketplaces(db)).toHaveLength(1);
  });

  it('resolves configuration once and never uses the bundled snapshot for a remote refresh', async () => {
    vi.stubEnv('PIXO_REGISTRY_URL', 'https://changed.example');
    expect(marketplaces.marketplaceManifestUrlForRegistry('official')).toBe(registryUrl);
    const { createMarketplaceSeedHelpers } = await import('../../src/plugins/marketplace-seed.js');
    const { fileURLToPath } = await import('node:url');
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const fetchImpl = vi.fn(async () => new Response(newText));
    const helpers = createMarketplaceSeedHelpers({
      projectRoot: root, bundledPluginsDir: `${root}/plugins/_official`, pluginRegistryDir: `${root}/plugins/registry`,
      marketplaceManifestUrlForRegistry: marketplaces.marketplaceManifestUrlForRegistry,
      marketplaceRegistryIdFromUrl: marketplaces.marketplaceRegistryIdFromUrl,
      fetchImpl,
    });
    const response = await helpers.createMarketplaceFetcher('official', [])(registryUrl);
    expect(await response.text()).toBe(newText);
    expect(fetchImpl).toHaveBeenCalled();
  });
});
