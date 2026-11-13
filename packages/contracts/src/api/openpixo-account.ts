/**
 * OpenPixo platform account and credits, as served by the local daemon under
 * `/api/openpixo/account/*` and `/api/openpixo/credits/*`.
 *
 * The daemon is the only holder of the cloud session: UI and `pixo` CLI call
 * these routes and never see refresh tokens, Stripe secrets or cloud keys.
 * Local features never require an account; only cloud features do.
 */

export type OpenPixoAuthProvider = 'email' | 'google';

export interface OpenPixoUser {
  /** Cloud user id; every order, wallet entry and job is bound to it. */
  id: string;
  email: string;
  provider: OpenPixoAuthProvider;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * - `not_configured`: this build has no cloud endpoint configured.
 * - `secure_storage_unavailable`: no OS-encrypted session store, so sign-in is refused
 *   instead of writing a plaintext session.
 */
export type OpenPixoAccountAvailability = 'available' | 'not_configured' | 'secure_storage_unavailable';

export interface OpenPixoAccountStatus {
  availability: OpenPixoAccountAvailability;
  signedIn: boolean;
  user: OpenPixoUser | null;
}

export interface StartEmailSignInRequest {
  email: string;
}

export interface StartEmailSignInResponse {
  /** Seconds before another code may be requested for this address. */
  resendAfterSec: number;
}

export interface VerifyEmailSignInRequest {
  email: string;
  /** One-time code from the sign-in email. */
  code: string;
}

/** Google sign-in runs in the system browser and returns to the daemon's loopback callback. */
export interface StartGoogleSignInResponse {
  attemptId: string;
  /** Open this in the system browser. */
  authorizeUrl: string;
  expiresAt: string;
}

export type GoogleSignInAttemptState = 'pending' | 'completed' | 'failed' | 'expired';

export interface GoogleSignInAttemptResponse {
  state: GoogleSignInAttemptState;
  /** Present when `state` is `failed`. */
  error: OpenPixoAccountErrorCode | null;
  /** Present when `state` is `completed`. */
  account: OpenPixoAccountStatus | null;
}

export const OPENPIXO_ACCOUNT_ERROR_CODES = [
  'ACCOUNT_NOT_CONFIGURED',
  'ACCOUNT_SECURE_STORAGE_UNAVAILABLE',
  'ACCOUNT_SIGNED_OUT',
  'ACCOUNT_EMAIL_INVALID',
  'ACCOUNT_OTP_INVALID',
  'ACCOUNT_OTP_RATE_LIMITED',
  'ACCOUNT_LOGIN_EXPIRED',
  'ACCOUNT_LOGIN_FAILED',
  'CLOUD_UNAVAILABLE',
  'BILLING_SKU_UNKNOWN',
  'BILLING_PAUSED',
  'BILLING_ALREADY_SUBSCRIBED',
  'BILLING_NOT_SUBSCRIBED',
  'BILLING_PLAN_ENDING',
  'BILLING_PLAN_PAST_DUE',
  'BILLING_PLAN_CHANGE_PENDING',
  'BILLING_PLAN_QUOTE_CHANGED',
  'INSUFFICIENT_CREDITS',
  'STORE_PURCHASE_UNAVAILABLE',
  'GENERATION_PAUSED',
  'GENERATION_SERVICE_UNKNOWN',
  'GENERATION_PARAMS_INVALID',
  'GENERATION_QUOTE_INVALID',
  'GENERATION_QUOTE_EXPIRED',
  'GENERATION_IDEMPOTENCY_CONFLICT',
  'GENERATION_RATE_LIMITED',
  'GENERATION_JOB_NOT_FOUND',
  'GENERATION_CONFIRMATION_REQUIRED',
  'AGENT_PAUSED',
  'AGENT_RATE_LIMITED',
  'AGENT_REQUEST_INVALID',
  'AGENT_UPSTREAM_FAILED',
  'STORE_ITEM_NOT_OWNED',
] as const;

export type OpenPixoAccountErrorCode = (typeof OPENPIXO_ACCOUNT_ERROR_CODES)[number];

export interface OpenPixoAccountErrorResponse {
  error: {
    code: OpenPixoAccountErrorCode;
    message: string;
    retryAfterSec?: number;
    /**
     * With CLOUD_UNAVAILABLE: `service` means the cloud answered with a failure, so the
     * connection is fine. Absent means it could not be reached. Retries key on the code alone.
     */
    reason?: 'service';
  };
}

// --- Credits ---------------------------------------------------------------

export type OpenPixoSubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete';

/** A lower plan that replaces this one at the next renewal. Credits already held stay. */
export interface OpenPixoPendingDowngrade {
  sku: string;
  monthlyCredits: number;
  amountMinor: number;
  currency: string;
  effectiveAt: string;
}

/** An upgrade the customer must still verify on Stripe's page. Nothing changes until it is paid. */
export interface OpenPixoPendingUpgrade {
  sku: string;
  chargeMinor: number;
  currency: string;
  credits: number;
  paymentUrl: string;
}

export interface OpenPixoSubscription {
  /** The plan in effect now, which a pending downgrade does not change until it takes effect. */
  sku: string;
  status: OpenPixoSubscriptionStatus;
  monthlyCredits: number;
  /** Price of the plan in effect. Absent from a cloud older than plan changes. */
  amountMinor?: number;
  currency?: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  pendingDowngrade?: OpenPixoPendingDowngrade | null;
  pendingUpgrade?: OpenPixoPendingUpgrade | null;
}

/** Credits are whole integers. Purchased credits are never withdrawable or convertible to cash. */
export interface OpenPixoCreditsSummary {
  available: number;
  /** Held by generation jobs that have not settled yet. */
  reserved: number;
  /** The part of `available` from a plan, which ends at the next renewal. Absent from an older cloud. */
  planCredits?: number;
  subscription: OpenPixoSubscription | null;
}

export type OpenPixoLedgerKind =
  | 'topup'
  | 'subscription_grant'
  | 'reserve'
  | 'settle'
  | 'release'
  | 'refund'
  | 'adjustment'
  | 'purchase'
  | 'multiplayer'
  | 'plan_expiry'
  | 'usage';

export interface OpenPixoLedgerEntry {
  id: string;
  kind: OpenPixoLedgerKind;
  /** Signed change to available credits. */
  amount: number;
  balanceAfter: number;
  createdAt: string;
  /** Order, job or invoice reference to quote to support. */
  reference: string | null;
}

export interface OpenPixoLedgerResponse {
  entries: OpenPixoLedgerEntry[];
  nextCursor: string | null;
}

export interface OpenPixoTopupProduct {
  sku: string;
  credits: number;
  /** Price in the currency's minor unit (cents). */
  amountMinor: number;
  currency: string;
  /** Payment methods offered for this product, e.g. `card`, `alipay`. */
  paymentMethods: string[];
}

export interface OpenPixoPlanProduct {
  sku: string;
  monthlyCredits: number;
  amountMinor: number;
  currency: string;
  interval: 'month';
  paymentMethods: string[];
}

export interface OpenPixoCatalogResponse {
  topups: OpenPixoTopupProduct[];
  plans: OpenPixoPlanProduct[];
  /** True when new purchases are paused by the operator. */
  purchasesPaused: boolean;
}

export interface CreateOpenPixoCheckoutRequest {
  sku: string;
}

/** Open `checkoutUrl` in the system browser; credits arrive only via the verified Stripe webhook. */
export interface CreateOpenPixoCheckoutResponse {
  checkoutUrl: string;
  checkoutId: string;
}

/** Stripe customer portal for managing or cancelling a subscription. */
export interface OpenPixoBillingPortalResponse {
  url: string;
}

/**
 * Changing plan. An upgrade takes effect now and charges the difference between the two plans,
 * whatever the day of the month; a downgrade waits for the next renewal and keeps all credits.
 */
export interface OpenPixoPlanChangeRequest {
  sku: string;
  /** The `chargeNowMinor` the customer agreed to; a different current price is refused. */
  expectedChargeMinor: number;
}

export interface OpenPixoPlanChangeQuote {
  kind: 'upgrade' | 'downgrade' | 'undo_downgrade';
  fromSku: string;
  toSku: string;
  /** Charged to the saved card now. Zero for a downgrade or undoing one. */
  chargeNowMinor: number;
  currency: string;
  /** Added to the balance as soon as the charge succeeds. */
  creditsNow: number;
  /** When the change happens; null means now. */
  effectiveAt: string | null;
  nextRenewalAt: string;
  nextChargeMinor: number;
  nextMonthlyCredits: number;
}

export type OpenPixoPlanChangeOutcome =
  /** Paid; the plan and the credits have changed. */
  | 'upgraded'
  | 'downgrade_scheduled'
  | 'downgrade_canceled'
  /** The card was declined. Nothing changed and nothing was charged. */
  | 'payment_failed'
  /** The bank wants the customer to verify: open `paymentUrl`. Nothing changes until then. */
  | 'payment_requires_action'
  /** The result is not known yet; it settles on its own and the balance shows it. */
  | 'payment_processing'
  /** A waiting payment was abandoned, or there was nothing to abandon. */
  | 'canceled';

export interface OpenPixoPlanChangeResponse {
  outcome: OpenPixoPlanChangeOutcome;
  /** Stripe's hosted invoice page, for `payment_requires_action`. */
  paymentUrl: string | null;
  /** Stripe's reason, for `payment_failed` (for example `insufficient_funds`). */
  declineCode: string | null;
  /** The account as it stands after this request. */
  credits: OpenPixoCreditsSummary;
}

// --- Workshop entitlements --------------------------------------------------

/** Spend credits on one Workshop item. The cloud prices it by SKU; the request carries no amount. */
export interface OpenPixoStorePurchaseRequest {
  sku: string;
}

/** Buying an owned item again returns the original entitlement and charges nothing. */
export interface OpenPixoStorePurchaseResponse {
  entitlementId: string;
  itemName: string;
  sku: string;
  /** Credits this entitlement cost when it was granted. */
  creditsSpent: number;
  /** Available credits after the purchase. */
  balance: number;
  createdAt: string;
}

/**
 * A short-lived link to an owned Workshop pack's files. The daemon reads `${baseUrl}/pack.json`, then each
 * file it lists, sending `Authorization: Bearer <token>`.
 */
export interface OpenPixoStoreDownloadResponse {
  itemName: string;
  version: string;
  baseUrl: string;
  token: string;
  expiresAt: string;
}

export interface OpenPixoEntitlement {
  id: string;
  itemName: string;
  sku: string;
  creditsSpent: number;
  createdAt: string;
}

export interface OpenPixoEntitlementsResponse {
  entitlements: OpenPixoEntitlement[];
}
