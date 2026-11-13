import type {
  CreateOpenPixoCheckoutResponse, OpenPixoBillingPortalResponse, OpenPixoCatalogResponse,
  OpenPixoCreditsSummary, OpenPixoEntitlement, OpenPixoLedgerEntry, OpenPixoLedgerResponse,
  OpenPixoPendingDowngrade, OpenPixoPendingUpgrade, OpenPixoPlanChangeOutcome, OpenPixoPlanChangeQuote,
  OpenPixoPlanChangeResponse, OpenPixoStoreDownloadResponse, OpenPixoStorePurchaseResponse, OpenPixoSubscription,
} from '@openpixo/contracts';
import { cloudServiceError } from './errors.js';
import { record } from './supabase.js';

/** Stripe's hosted invoice page, where a customer verifies a payment their bank questioned. */
const INVOICE_HOST = 'invoice.stripe.com';

function invalid(): never { throw cloudServiceError(); }
function text(value: unknown, max = 2048): string {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : invalid();
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function integer(value: unknown, signed = false): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && (signed || value >= 0) ? value : invalid();
}
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function date(value: unknown): string {
  const result = text(value, 64);
  return Number.isFinite(Date.parse(result)) ? result : invalid();
}
function list(value: unknown, max = 100): unknown[] {
  return Array.isArray(value) && value.length <= max ? value : invalid();
}

function currency(value: unknown): string {
  const result = text(value, 3);
  return /^[A-Za-z]{3}$/u.test(result) ? result : invalid();
}

function pendingDowngrade(value: unknown): OpenPixoPendingDowngrade | null {
  if (value === null || value === undefined) return null;
  const item = record(value);
  return { sku: text(item.sku, 128), monthlyCredits: integer(item.monthlyCredits), amountMinor: integer(item.amountMinor),
    currency: currency(item.currency), effectiveAt: date(item.effectiveAt) };
}

function pendingUpgrade(value: unknown): OpenPixoPendingUpgrade | null {
  if (value === null || value === undefined) return null;
  const item = record(value);
  return { sku: text(item.sku, 128), chargeMinor: integer(item.chargeMinor), currency: currency(item.currency),
    credits: integer(item.credits), paymentUrl: stripeUrl(item.paymentUrl, INVOICE_HOST) };
}

function subscription(value: unknown): OpenPixoSubscription | null {
  if (value === null) return null;
  const item = record(value);
  const status = item.status;
  if (status !== 'active' && status !== 'past_due' && status !== 'canceled' && status !== 'incomplete') invalid();
  return { sku: text(item.sku, 128), status, monthlyCredits: integer(item.monthlyCredits),
    // A cloud older than plan changes sends none of these; pending states read as none.
    ...(item.amountMinor === undefined ? {} : { amountMinor: integer(item.amountMinor), currency: currency(item.currency) }),
    currentPeriodEnd: date(item.currentPeriodEnd), cancelAtPeriodEnd: bool(item.cancelAtPeriodEnd),
    pendingDowngrade: pendingDowngrade(item.pendingDowngrade), pendingUpgrade: pendingUpgrade(item.pendingUpgrade) };
}

// Select fields explicitly: a cloud response must never forward session/debug fields to clients.
export function creditsSummary(value: unknown): OpenPixoCreditsSummary {
  const item = record(value);
  // A refund or dispute can take back credits already spent, so the cloud allows available below zero.
  return { available: integer(item.available, true), reserved: integer(item.reserved),
    // A cloud older than expiring plan credits does not send this.
    ...(item.planCredits === undefined ? {} : { planCredits: integer(item.planCredits) }),
    subscription: subscription(item.subscription) };
}

export function creditsLedger(value: unknown): OpenPixoLedgerResponse {
  const item = record(value);
  const entries: OpenPixoLedgerEntry[] = list(item.entries).map((entry) => {
    const row = record(entry);
    const kind = row.kind;
    if (kind !== 'topup' && kind !== 'subscription_grant' && kind !== 'reserve' && kind !== 'settle'
      && kind !== 'release' && kind !== 'refund' && kind !== 'adjustment' && kind !== 'purchase'
      && kind !== 'multiplayer' && kind !== 'plan_expiry' && kind !== 'usage') invalid();
    return { id: text(row.id), kind, amount: integer(row.amount, true), balanceAfter: integer(row.balanceAfter, true),
      createdAt: date(row.createdAt), reference: nullableText(row.reference) };
  });
  return { entries, nextCursor: nullableText(item.nextCursor) };
}

export function creditsCatalog(value: unknown): OpenPixoCatalogResponse {
  const item = record(value);
  const price = (value: unknown) => {
    const row = record(value);
    const currency = text(row.currency, 3);
    if (!/^[A-Za-z]{3}$/u.test(currency)) invalid();
    return { sku: text(row.sku, 128), amountMinor: integer(row.amountMinor), currency,
      paymentMethods: list(row.paymentMethods, 20).map((method) => text(method, 64)) };
  };
  return {
    topups: list(item.topups).map((row) => ({ ...price(row), credits: integer(record(row).credits) })),
    plans: list(item.plans).map((row) => {
      if (record(row).interval !== 'month') invalid();
      return { ...price(row), monthlyCredits: integer(record(row).monthlyCredits), interval: 'month' };
    }),
    purchasesPaused: bool(item.purchasesPaused),
  };
}

function stripeUrl(value: unknown, hostname: string): string {
  const result = text(value, 8192);
  try {
    const url = new URL(result);
    // Stripe-hosted Checkout URLs carry Stripe's own state in the fragment (`#fid…`), so a fragment is allowed.
    if (url.protocol === 'https:' && url.hostname === hostname && !url.username && !url.password
      && !url.searchParams.has('access_token') && !url.searchParams.has('refresh_token')) return result;
  } catch { /* Treat malformed cloud responses like an unavailable service. */ }
  return invalid();
}

export function checkoutResponse(value: unknown): CreateOpenPixoCheckoutResponse {
  const item = record(value);
  return { checkoutUrl: stripeUrl(item.checkoutUrl, 'checkout.stripe.com'), checkoutId: text(item.checkoutId) };
}

export function portalResponse(value: unknown): OpenPixoBillingPortalResponse {
  return { url: stripeUrl(record(value).url, 'billing.stripe.com') };
}

export function planChangeQuote(value: unknown): OpenPixoPlanChangeQuote {
  const item = record(value);
  const kind = item.kind;
  if (kind !== 'upgrade' && kind !== 'downgrade' && kind !== 'undo_downgrade') invalid();
  return { kind, fromSku: text(item.fromSku, 128), toSku: text(item.toSku, 128), chargeNowMinor: integer(item.chargeNowMinor),
    currency: currency(item.currency), creditsNow: integer(item.creditsNow),
    effectiveAt: item.effectiveAt === null ? null : date(item.effectiveAt), nextRenewalAt: date(item.nextRenewalAt),
    nextChargeMinor: integer(item.nextChargeMinor), nextMonthlyCredits: integer(item.nextMonthlyCredits) };
}

const PLAN_CHANGE_OUTCOMES: readonly OpenPixoPlanChangeOutcome[] = ['upgraded', 'downgrade_scheduled', 'downgrade_canceled',
  'payment_failed', 'payment_requires_action', 'payment_processing', 'canceled'];

export function planChangeResponse(value: unknown): OpenPixoPlanChangeResponse {
  const item = record(value);
  const outcome = item.outcome as OpenPixoPlanChangeOutcome;
  if (!PLAN_CHANGE_OUTCOMES.includes(outcome)) invalid();
  return { outcome, paymentUrl: item.paymentUrl === null ? null : stripeUrl(item.paymentUrl, INVOICE_HOST),
    declineCode: item.declineCode === null ? null : text(item.declineCode, 128), credits: creditsSummary(item.credits) };
}

function entitlement(value: unknown): OpenPixoEntitlement {
  const row = record(value);
  return { id: text(row.id, 128), itemName: text(row.itemName, 200), sku: text(row.sku, 128),
    creditsSpent: integer(row.creditsSpent), createdAt: date(row.createdAt) };
}

export function storePurchaseResponse(value: unknown): OpenPixoStorePurchaseResponse {
  const item = record(value);
  const { id, ...owned } = entitlement({ ...item, id: item.entitlementId });
  return { entitlementId: id, ...owned, balance: integer(item.balance, true) };
}

/**
 * The link must be the pack's own folder on an https host (http only for a local Worker), so a broken or
 * hostile answer cannot point the daemon's bearer token at another address.
 */
export function storeDownloadResponse(value: unknown, itemName: string, version: string): OpenPixoStoreDownloadResponse {
  const item = record(value);
  if (item.itemName !== itemName || item.version !== version) invalid();
  const slug = itemName.slice(itemName.indexOf('/') + 1);
  let base: URL;
  try { base = new URL(text(item.baseUrl, 512)); } catch { return invalid(); }
  const local = base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !local) || base.username || base.password || base.search || base.hash
    || base.pathname !== `/__pack/${slug}/${version}`) invalid();
  return { itemName, version, baseUrl: base.href, token: text(item.token, 4096), expiresAt: date(item.expiresAt) };
}

export function entitlementsResponse(value: unknown): OpenPixoEntitlement[] {
  return list(record(value).entitlements, 10_000).map(entitlement);
}
