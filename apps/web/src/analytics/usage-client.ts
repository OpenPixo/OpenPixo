// The web app's usage-events sender. It replaces posthog-js: the browser never
// talks to an analytics service. Events go to the local daemon
// (`POST /api/analytics/events`), which re-checks the user's consent, drops
// every property that is not a count (see `usageEventProperties` in
// contracts), and forwards the rest to OpenPixo's own ingest Worker.
//
// The method names mirror the subset of posthog-js the analytics client was
// written against (`register`, `capture`, `opt_in_capturing`, ...), so the
// consent and identity flows around it stay as they are. There is no
// autocapture, page view, session replay or person profile.

import {
  ANALYTICS_HEADER_CLIENT_TYPE,
  ANALYTICS_HEADER_DEVICE_ID,
  ANALYTICS_HEADER_LOCALE,
  ANALYTICS_HEADER_SESSION_ID,
  USAGE_EVENTS_MAX_BATCH,
  type AnalyticsClientType,
} from '@openpixo/contracts/analytics';

export const WEB_USAGE_EVENTS_ENDPOINT = '/api/analytics/events';
const FLUSH_DELAY_MS = 2_000;
const MAX_QUEUE = 200;

export interface WebUsageClient {
  register(properties: Record<string, unknown>): void;
  capture(event: string, properties?: Record<string, unknown>): void;
  opt_in_capturing(): void;
  opt_out_capturing(): void;
  /** Forgets registered properties and anything not yet sent. */
  reset(): void;
  identify(distinctId: string): void;
  get_session_id(): string | undefined;
  flush(options?: { keepalive?: boolean }): Promise<void>;
}

interface QueuedEvent {
  event: string;
  eventId: string;
  occurredAt: string;
  properties: Record<string, unknown>;
}

export function createWebUsageClient(init: {
  distinctId: string;
  sessionId: string;
  clientType: AnalyticsClientType;
  fetchImpl?: typeof fetch;
}): WebUsageClient {
  let distinctId = init.distinctId;
  let superProperties: Record<string, unknown> = {};
  let optedOut = false;
  let queue: QueuedEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Resolved at call time so a test or the header bridge can replace window.fetch.
  const send = (input: string, requestInit: RequestInit) => (init.fetchImpl ?? fetch)(input, requestInit);

  async function flush(options: { keepalive?: boolean } = {}): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    while (queue.length) {
      const batch = queue.splice(0, USAGE_EVENTS_MAX_BATCH);
      const locale = typeof superProperties.locale === 'string' ? superProperties.locale : 'en';
      try {
        await send(WEB_USAGE_EVENTS_ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [ANALYTICS_HEADER_DEVICE_ID]: distinctId,
            [ANALYTICS_HEADER_SESSION_ID]: init.sessionId,
            [ANALYTICS_HEADER_CLIENT_TYPE]: init.clientType,
            [ANALYTICS_HEADER_LOCALE]: locale,
          },
          body: JSON.stringify({ events: batch }),
          ...(options.keepalive ? { keepalive: true } : {}),
        });
      } catch {
        // Best-effort: a daemon that is restarting loses these counts.
      }
    }
  }

  function schedule(): void {
    if (queue.length >= USAGE_EVENTS_MAX_BATCH) { void flush(); return; }
    if (!timer) timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_DELAY_MS);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush({ keepalive: true });
    });
  }

  return {
    register(properties) {
      superProperties = { ...superProperties, ...properties };
    },
    capture(event, properties = {}) {
      if (optedOut) return;
      const merged = { ...superProperties, ...properties };
      const eventId = typeof merged.$insert_id === 'string' ? merged.$insert_id
        : typeof merged.event_id === 'string' ? merged.event_id
          : randomEventId();
      queue.push({ event, eventId, occurredAt: new Date().toISOString(), properties: merged });
      if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
      schedule();
    },
    opt_in_capturing() { optedOut = false; },
    opt_out_capturing() {
      optedOut = true;
      queue = [];
      if (timer) { clearTimeout(timer); timer = null; }
    },
    reset() {
      superProperties = {};
      queue = [];
    },
    identify(next) { distinctId = next; },
    get_session_id() { return init.sessionId; },
    flush,
  };
}

function randomEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
