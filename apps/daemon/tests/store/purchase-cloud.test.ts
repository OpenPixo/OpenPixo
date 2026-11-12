import path from 'node:path';
import { tmpdir } from 'node:os';
import type { MarketplacePluginEntry } from '@openpixo/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { OpenPixoAccountService } from '../../src/account/service.js';
import { ownedStoreItems, purchaseStoreItem, StorePurchaseError } from '../../src/store/purchase.js';
import { ACCESS, ANON, fakeSupabase, MemorySecretStore, USER } from '../account/fixtures.js';

// The real account client against a fake Supabase: request shape, parsing and error codes end to end.
const ENTRY = { name: 'openpixo/pixel-dungeon-kit', version: '1.0.0', source: 'bundled', kind: 'asset-pack',
  license: 'OpenPixo-Asset-1.0', pricing: { type: 'paid', credits: 600, sku: 'workshop.pixel-dungeon-kit' } } as MarketplacePluginEntry;
const PURCHASE = { entitlementId: 'ent-1', itemName: ENTRY.name, sku: 'workshop.pixel-dungeon-kit', creditsSpent: 600,
  balance: 400, createdAt: '2026-11-02T00:00:00.000Z', debug: 'never forwarded' };

let cloud: Awaited<ReturnType<typeof fakeSupabase>>;
let account: OpenPixoAccountService;
let owned: Array<Record<string, unknown>>;

beforeEach(async () => {
  cloud = await fakeSupabase();
  owned = [];
  cloud.handlers.set('POST /functions/v1/store-purchase', () => {
    owned = [{ id: 'ent-1', itemName: ENTRY.name, sku: PURCHASE.sku, creditsSpent: 600, createdAt: PURCHASE.createdAt }];
    return { body: PURCHASE };
  });
  cloud.handlers.set('GET /functions/v1/store-entitlements', () => ({ body: { entitlements: owned } }));
  account = new OpenPixoAccountService({ dataRoot: path.join(tmpdir(), 'pixo-store-test'), port: () => 0,
    config: { url: cloud.url, anonKey: ANON, agentUrl: `${cloud.url}/functions/v1` }, secretStore: new MemorySecretStore() });
  await account.verifyEmail(USER.email, '123456');
});

afterEach(async () => {
  account.close();
  await cloud.close();
});

const calls = (pathname: string) => cloud.requests.filter(request => request.url.pathname === pathname);

it('posts only the SKU with the user token and returns the parsed purchase', async () => {
  const result = await purchaseStoreItem(account, ENTRY, { name: ENTRY.name });
  expect(result).toEqual({ name: ENTRY.name, version: '1.0.0', creditsSpent: 600, balance: 400, entitlementId: 'ent-1' });
  const [request] = calls('/functions/v1/store-purchase');
  expect(request!.body).toEqual({ sku: 'workshop.pixel-dungeon-kit' });
  expect(request!.headers.authorization).toBe(`Bearer ${ACCESS}`);
});

it('passes INSUFFICIENT_CREDITS and paused purchases through as store errors', async () => {
  for (const [code, status] of [['INSUFFICIENT_CREDITS', 402], ['STORE_PURCHASE_UNAVAILABLE', 503]] as const) {
    cloud.handlers.set('POST /functions/v1/store-purchase', () => ({ status, body: { error: { code, message: 'cloud text' } } }));
    const error = await purchaseStoreItem(account, ENTRY, { name: ENTRY.name }).catch(cause => cause);
    expect(error).toBeInstanceOf(StorePurchaseError);
    expect(error).toMatchObject({ status, code });
    expect(error.message).not.toBe('cloud text');
  }
});

it('rejects a malformed cloud purchase instead of reporting success', async () => {
  cloud.handlers.set('POST /functions/v1/store-purchase', () => ({ body: { ...PURCHASE, balance: 'lots' } }));
  await expect(purchaseStoreItem(account, ENTRY, { name: ENTRY.name })).rejects.toMatchObject({ status: 503, code: 'UPSTREAM_UNAVAILABLE' });
});

it('caches ownership briefly and refreshes it after a purchase', async () => {
  expect(await ownedStoreItems(account)).toEqual(new Set());
  expect(await ownedStoreItems(account)).toEqual(new Set());
  expect(calls('/functions/v1/store-entitlements')).toHaveLength(1);
  await purchaseStoreItem(account, ENTRY, { name: ENTRY.name });
  expect(await ownedStoreItems(account)).toEqual(new Set([ENTRY.name]));
  expect(calls('/functions/v1/store-entitlements')).toHaveLength(2);
});

it('reports unknown ownership and a sign-in error once signed out', async () => {
  await account.signOut();
  expect(await ownedStoreItems(account)).toBeNull();
  await expect(purchaseStoreItem(account, ENTRY, { name: ENTRY.name })).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  expect(calls('/functions/v1/store-purchase')).toHaveLength(0);
});
