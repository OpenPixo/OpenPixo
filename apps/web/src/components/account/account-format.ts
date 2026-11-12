import type { OpenPixoAccountAvailability, OpenPixoAccountErrorCode } from '@openpixo/contracts';
import type { Dict } from '../../i18n/types';
import { accountErrorCode, OpenPixoAccountRequestError } from '../../providers/openpixo-account';
import { PLAN_TIER_NAMES, planTier } from '../onboarding/setup-readiness';

/** Formats a price given in the currency's minor unit (e.g. cents) for the UI locale. */
export function formatMinorAmount(amountMinor: number, currency: string, locale: string): string {
  const code = currency.toUpperCase();
  try {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: code });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / 10 ** digits);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${code}`;
  }
}

export function formatCredits(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

export function formatSignedCredits(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(value);
}

export function formatAccountDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

export function formatAccountDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

/** Reads like formatAccountDateTime, repeating the date only when the range crosses a day. */
export function formatAccountDateTimeRange(startIso: string, endIso: string, locale: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return endIso;
  const sameDay = start.toDateString() === end.toDateString();
  const endText = sameDay
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(end)
    : formatAccountDateTime(endIso, locale);
  return `${formatAccountDateTime(startIso, locale)} – ${endText}`;
}

/** Why the account path cannot be used, for a short explanation next to it. */
export function unavailableReasonKey(
  availability: OpenPixoAccountAvailability | null,
): keyof Dict | null {
  if (availability === 'not_configured') return 'account.unavailableNotConfigured';
  if (availability === 'secure_storage_unavailable') return 'account.unavailableSecureStorage';
  if (availability === null) return 'account.unavailableOffline';
  return null;
}

const ERROR_KEYS: Record<OpenPixoAccountErrorCode, keyof Dict> = {
  ACCOUNT_NOT_CONFIGURED: 'account.unavailableNotConfigured',
  ACCOUNT_SECURE_STORAGE_UNAVAILABLE: 'account.unavailableSecureStorage',
  ACCOUNT_SIGNED_OUT: 'account.error.signedOut',
  ACCOUNT_EMAIL_INVALID: 'account.error.emailInvalid',
  ACCOUNT_OTP_INVALID: 'account.error.codeInvalid',
  ACCOUNT_OTP_RATE_LIMITED: 'account.error.rateLimited',
  ACCOUNT_LOGIN_EXPIRED: 'account.error.codeExpired',
  ACCOUNT_LOGIN_FAILED: 'account.error.loginFailed',
  CLOUD_UNAVAILABLE: 'account.error.cloudUnavailable',
  BILLING_SKU_UNKNOWN: 'account.error.skuUnknown',
  BILLING_PAUSED: 'account.error.billingPaused',
  BILLING_ALREADY_SUBSCRIBED: 'account.error.alreadySubscribed',
  BILLING_NOT_SUBSCRIBED: 'account.error.notSubscribed',
  BILLING_PLAN_ENDING: 'account.error.planEnding',
  BILLING_PLAN_PAST_DUE: 'account.error.planPastDue',
  BILLING_PLAN_CHANGE_PENDING: 'account.error.planChangePending',
  BILLING_PLAN_QUOTE_CHANGED: 'account.error.quoteChanged',
  INSUFFICIENT_CREDITS: 'workshop.buy.insufficientTitle',
  STORE_PURCHASE_UNAVAILABLE: 'workshop.buy.soonTitle',
  GENERATION_PAUSED: 'cloudMedia.error.paused',
  GENERATION_SERVICE_UNKNOWN: 'cloudMedia.error.serviceUnknown',
  GENERATION_PARAMS_INVALID: 'cloudMedia.error.paramsInvalid',
  GENERATION_QUOTE_INVALID: 'cloudMedia.error.quoteInvalid',
  GENERATION_QUOTE_EXPIRED: 'cloudMedia.error.quoteExpired',
  GENERATION_IDEMPOTENCY_CONFLICT: 'cloudMedia.error.idempotencyConflict',
  GENERATION_RATE_LIMITED: 'cloudMedia.error.rateLimited',
  GENERATION_JOB_NOT_FOUND: 'cloudMedia.error.jobNotFound',
  GENERATION_CONFIRMATION_REQUIRED: 'cloudMedia.error.confirmationRequired',
  AGENT_PAUSED: 'hostedAgent.error.paused',
  AGENT_RATE_LIMITED: 'hostedAgent.error.rateLimited',
  AGENT_REQUEST_INVALID: 'hostedAgent.error.requestInvalid',
  AGENT_UPSTREAM_FAILED: 'hostedAgent.error.upstreamFailed',
};

export type Translate = (key: keyof Dict, vars?: Record<string, string | number>) => string;

/** The name people know a plan by; a SKU this build has never heard of is called just "plan". */
export function planDisplayName(sku: string, t: Translate): string {
  const tier = planTier(sku);
  return t(tier ? PLAN_TIER_NAMES[tier] : 'account.planUnknown');
}

/** User-facing text for a failed account or billing request. */
export function accountErrorMessage(error: unknown, t: Translate): string {
  const code = accountErrorCode(error);
  if (code === 'ACCOUNT_OTP_RATE_LIMITED') {
    const wait = error instanceof OpenPixoAccountRequestError ? error.retryAfterSec : undefined;
    return wait ? t('account.error.rateLimitedFor', { n: wait }) : t('account.error.rateLimited');
  }
  if (code === 'CLOUD_UNAVAILABLE' && error instanceof OpenPixoAccountRequestError && error.reason === 'service') {
    return t('account.error.cloudService');
  }
  return t(code ? ERROR_KEYS[code] : 'account.error.generic');
}

export function accountErrorCodeMessage(code: OpenPixoAccountErrorCode | null, t: Translate): string {
  return t(code ? ERROR_KEYS[code] : 'account.error.generic');
}

const PAYMENT_METHOD_KEYS: Record<string, keyof Dict> = {
  card: 'account.payment.card',
  alipay: 'account.payment.alipay',
};

/** Names the payment methods a product offers, in the catalogue's order, e.g. "Card · Alipay". */
export function paymentMethodsLabel(methods: string[], t: (key: keyof Dict) => string): string {
  return methods.map((method) => {
    const key = PAYMENT_METHOD_KEYS[method.toLowerCase()];
    return key ? t(key) : method;
  }).join(' · ');
}
