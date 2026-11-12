import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { OpenPixoAccountStatus, OpenPixoCreditsSummary } from '@openpixo/contracts';
import { fetchOpenPixoAccount, fetchOpenPixoCredits } from '../providers/openpixo-account';

/**
 * One shared view of the daemon's OpenPixo account and credit balance.
 *
 * The daemon is the only source of truth for who is signed in; every surface
 * (nav rail, Settings, onboarding, model switcher) reads the same snapshot so
 * a sign-in or sign-out in one place shows everywhere without a reload.
 */
interface Snapshot<T> {
  value: T | null;
  loading: boolean;
  /** True when the last load failed (old daemon, daemon offline, cloud down). */
  failed: boolean;
}

function createStore<T>(load: () => Promise<T>) {
  let snapshot: Snapshot<T> = { value: null, loading: false, failed: false };
  let inFlight: Promise<T | null> | null = null;
  let readAgain = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const update = (next: Partial<Snapshot<T>>) => {
    snapshot = { ...snapshot, ...next };
    emit();
  };
  /** A read that changed nothing keeps the old object, so nothing downstream re-fetches or re-renders on it. */
  const unchanged = (value: T) => JSON.stringify(value) === JSON.stringify(snapshot.value);
  const refresh = (): Promise<T | null> => {
    if (inFlight) return inFlight;
    const ticket = ++generation;
    update({ loading: true });
    inFlight = load().then(
      (value) => {
        if (ticket === generation) update({ value: unchanged(value) ? snapshot.value : value, loading: false, failed: false });
        return value;
      },
      () => {
        if (ticket === generation) update({ loading: false, failed: true });
        return null;
      },
    ).finally(() => {
      if (ticket !== generation) return;
      inFlight = null;
      if (readAgain) { readAgain = false; void refresh(); }
    });
    return inFlight;
  };
  return {
    get: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh,
    /** For a known change: a read already under way may have missed it, so one more follows it. */
    refreshLatest(): Promise<T | null> {
      if (inFlight) { readAgain = true; return inFlight; }
      return refresh();
    },
    /** A write that already returned fresh data (sign-in, sign-out) wins over any read in flight. */
    set(value: T | null) {
      generation += 1;
      inFlight = null;
      readAgain = false;
      update({ value, loading: false, failed: false });
    },
    reset() {
      generation += 1;
      inFlight = null;
      readAgain = false;
      snapshot = { value: null, loading: false, failed: false };
      emit();
    },
    loaded: () => snapshot.value !== null || snapshot.failed,
  };
}

let lastCreditsReadAt = 0;
const accountStore = createStore(() => fetchOpenPixoAccount());
const creditsStore = createStore(() => {
  lastCreditsReadAt = Date.now();
  return fetchOpenPixoCredits();
});

/** Window during which returning to the app after a checkout/portal visit re-reads the balance. */
export const EXTERNAL_BILLING_RETURN_WINDOW_MS = 30 * 60_000;
/** Reads caused by events never come closer together than this, however fast a run spends. */
export const CREDITS_READ_MIN_INTERVAL_MS = 5_000;
/** Stripe's webhook usually lands within seconds of the payment, after the customer is already back. */
export const EXTERNAL_RETURN_RECHECK_MS: readonly number[] = [3_000, 8_000, 20_000, 45_000];
const CREDITS_EVENTS_URL = '/api/openpixo/credits/events';

let externalBillingOpenedAt: number | null = null;

/** Call right before opening Stripe checkout or the billing portal in the system browser. */
export function markExternalBillingVisit(now = Date.now()) {
  externalBillingOpenedAt = now;
}

function shouldRefreshAfterExternalVisit(now = Date.now()) {
  return externalBillingOpenedAt !== null && now - externalBillingOpenedAt < EXTERNAL_BILLING_RETURN_WINDOW_MS;
}

/**
 * Keeps the balance current while anything shows it, without polling: the daemon says when it did
 * something that moves the balance (a run on credits, a generation, a purchase), the window
 * regaining focus covers what happened elsewhere (another device, a dashboard adjustment), and
 * coming back from a payment re-checks a few times because its webhook can land after the customer.
 */
const creditsLive = (() => {
  let holders = 0;
  let events: EventSource | null = null;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let rechecks: ReturnType<typeof setTimeout>[] = [];

  const readSoon = () => {
    const wait = lastCreditsReadAt + CREDITS_READ_MIN_INTERVAL_MS - Date.now();
    if (wait <= 0) { void creditsStore.refreshLatest(); return; }
    trailing ??= setTimeout(() => {
      trailing = null;
      void creditsStore.refreshLatest();
    }, wait);
  };
  const stopRechecks = () => {
    rechecks.forEach(clearTimeout);
    rechecks = [];
  };
  const recheckAfterReturn = () => {
    if (rechecks.length > 0) return;
    const before = JSON.stringify(creditsStore.get().value);
    void creditsStore.refreshLatest();
    rechecks = EXTERNAL_RETURN_RECHECK_MS.map((delay) => setTimeout(() => {
      if (JSON.stringify(creditsStore.get().value) !== before) { stopRechecks(); return; }
      void creditsStore.refreshLatest();
    }, delay));
  };
  const onReturn = () => {
    if (document.visibilityState === 'hidden') return;
    if (shouldRefreshAfterExternalVisit()) recheckAfterReturn();
    else if (Date.now() - lastCreditsReadAt >= CREDITS_READ_MIN_INTERVAL_MS) readSoon();
  };

  return {
    /** Returns the release; the first holder connects and the last one disconnects. */
    hold(): () => void {
      holders += 1;
      if (holders === 1) {
        window.addEventListener('focus', onReturn);
        document.addEventListener('visibilitychange', onReturn);
        if (typeof EventSource !== 'undefined') {
          events = new EventSource(CREDITS_EVENTS_URL);
          events.addEventListener('changed', readSoon);
        }
      }
      return () => {
        holders -= 1;
        if (holders > 0) return;
        window.removeEventListener('focus', onReturn);
        document.removeEventListener('visibilitychange', onReturn);
        events?.close();
        events = null;
        if (trailing) clearTimeout(trailing);
        trailing = null;
        stopRechecks();
      };
    },
  };
})();

export function refreshOpenPixoAccount() {
  return accountStore.refresh();
}

export function setOpenPixoAccountStatus(status: OpenPixoAccountStatus) {
  accountStore.set(status);
  if (!status.signedIn) creditsStore.reset();
  else void creditsStore.refresh();
}

/** Re-reads now. For a spend or purchase this window just made, which it knows has changed the balance. */
export function refreshOpenPixoCredits() {
  return creditsStore.refreshLatest();
}

/** A write that answered with the account as it now stands (a plan change). */
export function setOpenPixoCredits(credits: OpenPixoCreditsSummary) {
  creditsStore.set(credits);
}

/** Test seam: forget cached account and credits state between cases. */
export function resetOpenPixoAccountStoreForTests() {
  accountStore.reset();
  creditsStore.reset();
  externalBillingOpenedAt = null;
  lastCreditsReadAt = 0;
}

export function isCloudAccountAvailable(status: OpenPixoAccountStatus | null): boolean {
  return status?.availability === 'available';
}

export interface OpenPixoAccountState {
  status: OpenPixoAccountStatus | null;
  loading: boolean;
  failed: boolean;
  refresh: () => Promise<OpenPixoAccountStatus | null>;
}

/**
 * @param options.load `false` reads whatever is already known without asking
 *   the daemon (for chrome that only hides itself once the answer is known).
 */
export function useOpenPixoAccount(options: { load?: boolean } = {}): OpenPixoAccountState {
  const load = options.load !== false;
  const snapshot = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.get);
  useEffect(() => {
    if (load && !accountStore.loaded()) void accountStore.refresh();
  }, [load]);
  const refresh = useCallback(() => accountStore.refresh(), []);
  return { status: snapshot.value, loading: snapshot.loading || !accountStore.loaded(), failed: snapshot.failed, refresh };
}

export interface OpenPixoCreditsState {
  credits: OpenPixoCreditsSummary | null;
  loading: boolean;
  failed: boolean;
  refresh: () => Promise<OpenPixoCreditsSummary | null>;
}

/** Balance for the signed-in account. Loads only when `enabled` (signed in and available). */
export function useOpenPixoCredits(enabled: boolean): OpenPixoCreditsState {
  const snapshot = useSyncExternalStore(creditsStore.subscribe, creditsStore.get, creditsStore.get);
  useEffect(() => {
    if (enabled && !creditsStore.loaded()) void creditsStore.refresh();
  }, [enabled]);
  useEffect(() => (enabled ? creditsLive.hold() : undefined), [enabled]);
  const refresh = useCallback(() => creditsStore.refresh(), []);
  return {
    credits: enabled ? snapshot.value : null,
    loading: enabled && (snapshot.loading || !creditsStore.loaded()),
    failed: enabled && snapshot.failed,
    refresh,
  };
}
