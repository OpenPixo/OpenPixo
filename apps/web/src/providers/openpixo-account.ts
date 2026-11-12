import type {
  CreateOpenPixoCheckoutResponse,
  GoogleSignInAttemptResponse,
  OpenPixoAccountErrorCode,
  OpenPixoAccountStatus,
  OpenPixoBillingPortalResponse,
  OpenPixoCatalogResponse,
  OpenPixoCreditsSummary,
  OpenPixoLedgerResponse,
  OpenPixoPlanChangeQuote,
  OpenPixoPlanChangeResponse,
  StartEmailSignInResponse,
  StartGoogleSignInResponse,
} from '@openpixo/contracts';
import { OPENPIXO_ACCOUNT_ERROR_CODES } from '@openpixo/contracts';

/**
 * Daemon client for the OpenPixo account and credits routes. The daemon holds
 * the cloud session; this module only ever sees account status, balances and
 * one-shot URLs to open in the system browser.
 */
export class OpenPixoAccountRequestError extends Error {
  constructor(
    message: string,
    /** Known account error code, or null for transport/unknown failures. */
    readonly code: OpenPixoAccountErrorCode | null,
    readonly status: number,
    readonly retryAfterSec?: number,
    /** The cloud answered with a failure, so the connection is fine. */
    readonly reason?: 'service',
  ) {
    super(message);
    this.name = 'OpenPixoAccountRequestError';
  }
}

const KNOWN_CODES = new Set<string>(OPENPIXO_ACCOUNT_ERROR_CODES);

export function accountErrorCode(error: unknown): OpenPixoAccountErrorCode | null {
  return error instanceof OpenPixoAccountRequestError ? error.code : null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await response.json().catch(() => null) as
    | { error?: { code?: unknown; message?: unknown; retryAfterSec?: unknown; reason?: unknown } }
    | null;
  if (!response.ok) {
    const error = body?.error;
    const code = typeof error?.code === 'string' && KNOWN_CODES.has(error.code)
      ? error.code as OpenPixoAccountErrorCode
      : null;
    const message = typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`;
    const retryAfterSec = typeof error?.retryAfterSec === 'number' && Number.isFinite(error.retryAfterSec)
      ? Math.max(0, Math.ceil(error.retryAfterSec))
      : undefined;
    throw new OpenPixoAccountRequestError(message, code, response.status, retryAfterSec, error?.reason === 'service' ? 'service' : undefined);
  }
  if (body === null) throw new OpenPixoAccountRequestError('Invalid response', null, response.status);
  return body as T;
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body ?? {}),
});

/**
 * Reads account status. A daemon that answers the read itself with
 * `ACCOUNT_NOT_CONFIGURED` / `ACCOUNT_SECURE_STORAGE_UNAVAILABLE` is reporting
 * availability, not failing, so both map onto the status shape.
 */
export async function fetchOpenPixoAccount(signal?: AbortSignal): Promise<OpenPixoAccountStatus> {
  try {
    return await request<OpenPixoAccountStatus>('/api/openpixo/account', { signal });
  } catch (error) {
    const code = accountErrorCode(error);
    if (code === 'ACCOUNT_NOT_CONFIGURED') return { availability: 'not_configured', signedIn: false, user: null };
    if (code === 'ACCOUNT_SECURE_STORAGE_UNAVAILABLE') {
      return { availability: 'secure_storage_unavailable', signedIn: false, user: null };
    }
    throw error;
  }
}

export function startEmailSignIn(email: string) {
  return request<StartEmailSignInResponse>('/api/openpixo/account/email/start', post({ email }));
}

export function verifyEmailSignIn(email: string, code: string) {
  return request<OpenPixoAccountStatus>('/api/openpixo/account/email/verify', post({ email, code }));
}

export function startGoogleSignIn() {
  return request<StartGoogleSignInResponse>('/api/openpixo/account/google/start', post());
}

export function fetchGoogleSignInAttempt(attemptId: string, signal?: AbortSignal) {
  return request<GoogleSignInAttemptResponse>(
    `/api/openpixo/account/google/attempts/${encodeURIComponent(attemptId)}`,
    { signal },
  );
}

export function signOutOpenPixo() {
  return request<OpenPixoAccountStatus>('/api/openpixo/account/sign-out', post());
}

export function fetchOpenPixoCredits(signal?: AbortSignal) {
  return request<OpenPixoCreditsSummary>('/api/openpixo/credits', { signal });
}

export function fetchOpenPixoLedger(options: { limit?: number; cursor?: string | null } = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  const query = params.toString();
  return request<OpenPixoLedgerResponse>(`/api/openpixo/credits/ledger${query ? `?${query}` : ''}`, { signal });
}

export function fetchOpenPixoCatalog(signal?: AbortSignal) {
  return request<OpenPixoCatalogResponse>('/api/openpixo/credits/catalog', { signal });
}

export function createOpenPixoCheckout(sku: string) {
  return request<CreateOpenPixoCheckoutResponse>('/api/openpixo/credits/checkout', post({ sku }));
}

export function createOpenPixoBillingPortal() {
  return request<OpenPixoBillingPortalResponse>('/api/openpixo/credits/portal', post());
}

export function previewOpenPixoPlanChange(sku: string, signal?: AbortSignal) {
  return request<OpenPixoPlanChangeQuote>('/api/openpixo/credits/plan-change/preview', { ...post({ sku }), signal });
}

/** Charges the saved card for an upgrade, so `expectedChargeMinor` must be what the user just agreed to. */
export function applyOpenPixoPlanChange(sku: string, expectedChargeMinor: number) {
  return request<OpenPixoPlanChangeResponse>('/api/openpixo/credits/plan-change', post({ sku, expectedChargeMinor }));
}

/** Abandons an upgrade waiting for verification, or undoes a pending downgrade. */
export function cancelOpenPixoPlanChange() {
  return request<OpenPixoPlanChangeResponse>('/api/openpixo/credits/plan-change/cancel', post());
}
