import type {
  ApiErrorCode, MarketplacePluginEntry, OpenPixoAccountErrorCode, StoreCatalogItem, StorePurchaseRequest, StorePurchaseResponse,
} from '@openpixo/contracts';
import { AccountError } from '../account/errors.js';
import type { OpenPixoAccountService } from '../account/service.js';

/** The cloud account surface the Workshop needs: spending credits and reading what the user owns. */
export type StoreAccount = Pick<OpenPixoAccountService, 'storePurchase' | 'entitlements'>;

export class StorePurchaseError extends Error {
  constructor(readonly status: number, readonly code: ApiErrorCode, message: string) { super(message); }
}

const UNAVAILABLE = 'Buying Workshop items with credits opens soon.';
// Account messages are already sanitized; only the status and code are translated to the store API.
const ACCOUNT_ERRORS: Partial<Record<OpenPixoAccountErrorCode, [number, ApiErrorCode]>> = {
  ACCOUNT_SIGNED_OUT: [401, 'UNAUTHORIZED'],
  INSUFFICIENT_CREDITS: [402, 'INSUFFICIENT_CREDITS'],
  BILLING_SKU_UNKNOWN: [404, 'NOT_FOUND'],
  STORE_PURCHASE_UNAVAILABLE: [503, 'STORE_PURCHASE_UNAVAILABLE'],
  ACCOUNT_NOT_CONFIGURED: [503, 'STORE_PURCHASE_UNAVAILABLE'],
  ACCOUNT_SECURE_STORAGE_UNAVAILABLE: [503, 'STORE_PURCHASE_UNAVAILABLE'],
};

/**
 * Spends credits on a paid Workshop item through the cloud entitlement endpoint.
 * Only the catalogue SKU leaves the daemon; the cloud prices it and charges an
 * item the account already owns only once.
 */
export async function purchaseStoreItem(account: StoreAccount | undefined, entry: MarketplacePluginEntry,
  request: StorePurchaseRequest): Promise<StorePurchaseResponse> {
  const sku = entry.pricing?.type === 'paid' ? entry.pricing.sku : undefined;
  if (!account || !sku) throw new StorePurchaseError(503, 'STORE_PURCHASE_UNAVAILABLE', UNAVAILABLE);
  let result: Awaited<ReturnType<StoreAccount['storePurchase']>>;
  try {
    result = await account.storePurchase(sku);
  } catch (error) {
    const known = error instanceof AccountError ? ACCOUNT_ERRORS[error.code] : undefined;
    if (known) throw new StorePurchaseError(known[0], known[1], (error as AccountError).message);
    throw new StorePurchaseError(503, 'UPSTREAM_UNAVAILABLE', new AccountError('CLOUD_UNAVAILABLE').message);
  }
  if (result.itemName.toLowerCase() !== entry.name.toLowerCase()) {
    throw new StorePurchaseError(502, 'UPSTREAM_UNAVAILABLE', `The cloud catalogue maps ${sku} to a different item.`);
  }
  return { name: entry.name, version: request.version ?? entry.version, creditsSpent: result.creditsSpent,
    balance: result.balance, entitlementId: result.entitlementId };
}

const OWNED_TIMEOUT_MS = 4000;

/**
 * Lower-cased names of the items the signed-in account owns, or null when that
 * is unknown (signed out, no cloud, offline). The catalogue never waits long on it.
 */
export async function ownedStoreItems(account: StoreAccount | undefined): Promise<Set<string> | null> {
  if (!account) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const entitlements = await Promise.race([
      account.entitlements(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), OWNED_TIMEOUT_MS); }),
    ]);
    return new Set(entitlements.map(item => item.itemName.toLowerCase()));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** `owned` is set on paid items only, and only when ownership is known. */
export function withOwnership<T extends StoreCatalogItem>(item: T, owned: Set<string> | null): T {
  return owned && item.pricing.type === 'paid' ? { ...item, owned: owned.has(item.name.toLowerCase()) } : item;
}
