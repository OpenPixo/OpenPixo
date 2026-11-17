// Usage-data client for the web app. Starts only after the daemon's
// /api/analytics/config says this build can send and the user said yes, so
// dev builds, forks and users who declined send nothing. Events go to the
// daemon (see usage-client.ts), never to an analytics service directly. All
// entry points are fire-and-forget: capture failures must never propagate to
// product code.

import { getOpenPixoHost } from '@openpixo/host';
import {
  EVENT_SCHEMA_VERSION,
  type AnalyticsClientType,
  type AnalyticsConfigResponse,
  type AnalyticsConfigureGlobals,
} from '@openpixo/contracts/analytics';
import { createWebUsageClient, type WebUsageClient } from './usage-client';
import {
  clearExceptionTrackingContext,
  detectBrowserOsName,
  setExceptionTrackingContext,
} from './error-tracking';
import { pinFirstSessionForCapture } from './identity';
import { coalescedGet } from '../lib/coalesced-get';

interface AnalyticsContext {
  anonymousId: string;
  sessionId: string;
  clientType: AnalyticsClientType;
  locale: string;
  appVersion: string;
  // Whether this is the install's first analytics session (see
  // identity.ts#isFirstSession). Optional so callers that don't care
  // (error tracking) can omit it.
  isFirstSession?: boolean;
}

let client: WebUsageClient | null = null;
let initPromise: Promise<WebUsageClient | null> | null = null;
let resolvedDeviceId: string | null = null;
// Latest configure-state triplet. Re-registered on the usage client as
// soon as it changes so every subsequent event inherits the current values.
let configureGlobals: AnalyticsConfigureGlobals = {
  has_available_configure_cli: false,
  configure_type: 'unknown',
  configure_availability: 'unknown',
  runtime_type: 'none',
  cli_runnable: false,
  byok_runnable: false,
  
};
// Snapshot of the super-property payload sent on the most recent `loaded()`
// init. `reset()` clears the usage client's registered properties as well as
// the distinct_id, so privacy → metrics off → on, or a Delete-my-data
// rotation (applyIdentity()), would otherwise resume capture without
// `event_schema_version`, `device_id`, `session_id`, `locale`, or the
// configure-state globals. We restash this on init and re-register it
// after every reset()/identify() so every subsequent event keeps the
// current schema contract.
let lastRegisterPayload: Record<string, unknown> | null = null;

// Returns the installationId the daemon stamped on /api/analytics/config
// after the user opted in via Privacy → "Share". The provider
// uses this in preference to its locally-generated UUID so the daemon,
// Langfuse, and any future sink share a single anonymous identity.
//
// Kept under the legacy name for callers that still import it; new code
// should prefer `getResolvedDeviceId`.
export function getResolvedAnonymousId(): string | null {
  return resolvedDeviceId;
}

export function getResolvedDeviceId(): string | null {
  return resolvedDeviceId;
}

// Web-side accessor for the daemon header bridge: when the web client POSTs
// to /api/runs the daemon needs to know what device_id to stamp on its
// own server-side captures.
export function getConfigureGlobals(): AnalyticsConfigureGlobals {
  return configureGlobals;
}

// Called from the AnalyticsProvider when the configure-state triplet changes
// (mode switch, BYOK key save, CLI rescan). The values are registered on the
// usage client so every subsequent capture inherits them — no per-event
// boilerplate needed.
export function setConfigureGlobals(next: AnalyticsConfigureGlobals): void {
  configureGlobals = { ...next };
  // Keep the cached register payload aligned so a future reset/identify
  // flow that calls `restoreSuperProperties()` uses the LATEST configure
  // state, not the stale snapshot captured during the initial `loaded()`.
  if (lastRegisterPayload) {
    lastRegisterPayload = {
      ...lastRegisterPayload,
      ...(configureGlobals as unknown as Record<string, unknown>),
    };
  }
  if (!client) return;
  try {
    client.register(configureGlobals as unknown as Record<string, unknown>);
  } catch {
    // best-effort — capture should never throw out of this path.
  }
}

// OpenPixo keeps no person profiles: usage events are counts tied to an
// anonymous installation id, nothing more. Kept as a no-op for its callers.
export function setAnalyticsPersonProperties(
  _properties: Record<string, unknown>,
): void {}

// Fetches `/api/analytics/config` once and wires up the exception-tracking
// module's context — independent of consent state. The error tracker
// installs its `window.error` / `unhandledrejection` listeners at module
// load (see `error-tracking.ts`), but cannot dispatch buffered events
// until the user's yes and the installation id are known. This bootstrap
// step provides those.
//
// Runs in parallel with — and unrelated to — `getAnalyticsClient` above.
// When the user has consented, both paths fetch the same endpoint once
// each; the duplicate fetch is cheap and avoids cross-coupling the
// (consent-gated) analytics init with the (always-on) error tracker.

// Both the always-on exception tracker and the consent-gated analytics init
// read /api/analytics/config at boot; share one request per burst instead of
// issuing two identical GETs (Batch A §4.3). `null` mirrors the endpoint's
// non-ok answer; network failures propagate to each caller's own handler.
function fetchAnalyticsConfigShared(): Promise<AnalyticsConfigResponse | null> {
  // ttl 0: share only genuinely concurrent readers. A later sequential call
  // (e.g. re-init right after the user grants consent) must observe the
  // just-flipped daemon answer, not a sub-second-old disabled snapshot.
  return coalescedGet(
    'analytics-config',
    async () => {
      const res = await fetch('/api/analytics/config');
      if (!res.ok) return null;
      return (await res.json()) as AnalyticsConfigResponse;
    },
    0,
  );
}

/**
 * True when this build has an analytics key, so the app may ask the user for
 * consent. False on development and fork builds, and when the daemon is
 * unreachable: then there is nothing to ask about.
 */
export async function analyticsAvailable(): Promise<boolean> {
  try {
    const cfg = await fetchAnalyticsConfigShared();
    return cfg?.available === true;
  } catch {
    return false;
  }
}

let exceptionBootstrapPromise: Promise<void> | null = null;
export function bootstrapExceptionTracking(context: AnalyticsContext): Promise<void> {
  if (exceptionBootstrapPromise) return exceptionBootstrapPromise;
  exceptionBootstrapPromise = (async () => {
    try {
      const cfg = await fetchAnalyticsConfigShared();
      if (!cfg) {
        clearExceptionTrackingContext();
        return;
      }
      if (!cfg.enabled) {
        clearExceptionTrackingContext();
        return;
      }
      const telemetryEnv = cfg.env || 'unknown';
      const distinctId =
        (typeof cfg.installationId === 'string' && cfg.installationId) ||
        context.anonymousId;
      const hostStartupContext = await getOpenPixoHost()?.startup?.context().catch(() => null);
      setExceptionTrackingContext({
        distinctId,
        clientType: context.clientType,
        osName: detectBrowserOsName(),
        appVersion: context.appVersion,
        sessionId: context.sessionId,
        ...(hostStartupContext ? { appSessionId: hostStartupContext.app_session_id } : {}),
        telemetryEnv,
      });
    } catch {
      // Network failure / endpoint unavailable — leave the buffer in
      // place so a future retry could still flush, but don't crash boot.
    }
  })();
  return exceptionBootstrapPromise;
}

export async function getAnalyticsClient(
  context: AnalyticsContext,
): Promise<WebUsageClient | null> {
  if (client) return client;
  if (initPromise) return initPromise;
  // PR #1428 reviewer (Siri-Ray): the first /api/analytics/config response
  // is cached forever if it resolves to null. On first launch before the
  // user accepts the privacy banner the daemon returns enabled=false, this
  // promise resolves null, and every later track() call returns the cached
  // null without re-fetching the now-enabled config. Clear initPromise
  // whenever the resolution is null so a subsequent setConsent(true) can
  // trigger a fresh init.
  const pending = (async () => {
    try {
      const cfg = await fetchAnalyticsConfigShared();
      if (!cfg) return null;
      if (!cfg.enabled) return null;
      const telemetryEnv = cfg.env || 'unknown';
      const distinctId =
        (typeof cfg.installationId === 'string' && cfg.installationId) ||
        context.anonymousId;
      resolvedDeviceId = distinctId;
      const instance = createWebUsageClient({ distinctId, sessionId: context.sessionId, clientType: context.clientType });
      lastRegisterPayload = {
        event_schema_version: EVENT_SCHEMA_VERSION,
        env: telemetryEnv,
        ui_version: context.appVersion,
        app_version: context.appVersion,
        client_type: context.clientType,
        locale: context.locale,
        session_id: context.sessionId,
        // Onboarding-funnel dimension (spec §11.1 common fields).
        ...(context.isFirstSession !== undefined
          ? { is_first_session: context.isFirstSession }
          : {}),
        device_id: distinctId,
        ...(configureGlobals as unknown as Record<string, unknown>),
      };
      instance.register(lastRegisterPayload);
      // Error reports follow the same consent and go through the same daemon route.
      setExceptionTrackingContext({
        distinctId,
        clientType: context.clientType,
        osName: detectBrowserOsName(),
        appVersion: context.appVersion,
        sessionId: context.sessionId,
        telemetryEnv,
      });
      client = instance;
      // Pin the first-analytics-session marker only now — init returned without
      // throwing and capture is live. This is the single consent gate every
      // caller (mount, locale effect, track(), and the setConsent opt-in
      // re-init) funnels through, so an install that first booted with
      // analytics OFF and opts in later records its real first analytics
      // session as first. Pinning earlier (before import()/init) would burn the
      // marker on a boot where init actually failed and no session was ever
      // captured (see identity.ts#isFirstSession). Idempotent + best-effort.
      pinFirstSessionForCapture();
      return instance;
    } catch {
      // Network failure, missing endpoint, third-party fork without keys —
      // all collapse to the same no-op.
      return null;
    }
  })();
  initPromise = pending;
  // Reopen the read only while a null answer is still PROVISIONAL — that is,
  // until the app has told this module what the user's consent actually is.
  //
  // Clearing it on every null instead made each later `track()` call re-read
  // `/api/analytics/config`, because `track` funnels through this function: on
  // one cold conversation open that was three extra requests, and it is the
  // steady state for every session where analytics is off (a user who declined
  // the privacy toggle, and every dev build, where the daemon answers
  // `enabled:false, key:null`).
  //
  // Nothing that could change the answer is lost: `applyConsent(true)` is the
  // opt-in event, it runs before the provider re-calls this function, and it
  // reopens the read itself. See `applyConsent`.
  void pending.then((result) => {
    if (!result && !consentDecisionApplied) initPromise = null;
  });
  return pending;
}

// Whether the app has told this module what the user's consent is yet, and
// what it last said. Before the first decision arrives a null init is
// provisional (boot ordering: the provider's mount effect calls
// `getAnalyticsClient` before `App`'s effect calls `setConsent`); after it,
// only a fresh GRANT can change the daemon's answer.
let consentDecisionApplied = false;
let lastConsentGranted = false;

// Called from the AnalyticsProvider when the user toggles Privacy →
// metrics off so events stop flowing immediately, before the next
// reload re-reads /api/analytics/config. Subsequent capture() calls are
// no-ops until the user opts back in (the daemon also re-checks consent).
//
// `opt_out_capturing()` stops every capture and drops anything queued;
// `reset()` forgets the registered properties, so a later opt-in after
// Delete my data cannot carry the old identity into the new session.
export function applyConsent(consentGranted: boolean): void {
  // A fresh GRANT is the one event that can turn a null init into a live
  // client, so it — and only it — reopens the `/api/analytics/config` read
  // `getAnalyticsClient` memoised. The provider calls this before it re-calls
  // `getAnalyticsClient`, so the retry that the null-clearing used to provide
  // still happens, once, on the event that warrants it rather than on every
  // `track()`. A client that is already live needs no re-init; `opt_in_capturing`
  // below is the whole of the work.
  const newlyGranted = consentGranted && (!consentDecisionApplied || !lastConsentGranted);
  consentDecisionApplied = true;
  lastConsentGranted = consentGranted;
  if (newlyGranted && !client) initPromise = null;

  if (!client) return;
  try {
    if (consentGranted) {
      client.opt_in_capturing();
      // If the user previously toggled metrics off in this session, the
      // earlier opt-out path called reset() and wiped the persisted
      // super-properties. opt_in_capturing() only flips the consent flag
      // and does not re-run init(), so without this restore the next
      // capture would emit no event_schema_version / device_id /
      // session_id / locale / configure-state. See PR #2285 review
      // 2026-05-20 04:35.
      restoreSuperProperties();
    } else {
      client.opt_out_capturing();
      client.reset();
      resolvedDeviceId = null;
    }
  } catch {
    // best-effort — capture should never throw out of this path.
  }
}

// Called from the AnalyticsProvider when `config.installationId` rotates
// (Delete my data). reset() first, then identify(), so nothing from the old
// installation is sent under the new one.
export function applyIdentity(installationId: string | null): void {
  if (!client || !installationId) return;
  if (resolvedDeviceId === installationId) return;
  try {
    client.reset();
    client.identify(installationId);
    resolvedDeviceId = installationId;
    // reset() also clears the registered properties. Re-register them with the new
    // distinct_id so the rest of this session keeps emitting v2-schema
    // events. See PR #2285 review 2026-05-20 04:35.
    restoreSuperProperties({ device_id: installationId });
  } catch {
    // best-effort — never propagate.
  }
}

// Push the cached super-property payload back onto the usage client. Used
// after reset()/identify() flows; takes an optional override patch so the
// caller can swap fields (e.g. a rotated device_id) without re-deriving the
// rest of the payload.
function restoreSuperProperties(patch?: Record<string, unknown>): void {
  if (!client || !lastRegisterPayload) return;
  const next = patch ? { ...lastRegisterPayload, ...patch } : lastRegisterPayload;
  lastRegisterPayload = next;
  try {
    client.register(next);
  } catch {
    // best-effort.
  }
}

export function capture(
  client: WebUsageClient | null,
  args: {
    event: string;
    properties: Record<string, unknown>;
    insertId: string;
    requestId?: string | null;
  },
): void {
  if (!client) return;
  try {
    client.capture(args.event, {
      ...args.properties,
      event_id: args.insertId,
      // The dedup key. The daemon mirrors result events with
      // the same $insert_id so duplicates from the dual-side capture pattern
      // get coalesced server-side.
      $insert_id: args.insertId,
      ...(args.requestId ? { request_id: args.requestId } : {}),
    });
  } catch {
    // Swallow — analytics failures must not propagate.
  }
}
