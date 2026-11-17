import { randomUUID } from 'node:crypto';
import {
  USAGE_EVENTS_MAX_BATCH,
  USAGE_EVENTS_PATH,
  USAGE_EVENTS_SCHEMA_VERSION,
  normalizeUsageEvent,
  type UsageEvent,
  type UsageEventBatch,
} from '@openpixo/contracts/analytics';

/**
 * The daemon's sender for OpenPixo usage events: a small batching queue that
 * POSTs to OpenPixo's own ingest Worker (see `usage-events.ts` in contracts).
 *
 * It keeps the call shape the analytics service was written against
 * (`capture({ distinctId, event, properties })`), so the service and its
 * consent checks stay as they are. Every event passes `normalizeUsageEvent`,
 * which drops any property that could hold user text; an event that cannot be
 * made valid is dropped, never sent half-formed.
 *
 * Delivery is best-effort: a batch the Worker could not store (network error,
 * 5xx, 429) is put back once; anything else is dropped. Nothing is written to
 * disk, so a crash loses at most one flush interval (2 s) of counts.
 */
export interface UsageEventsClient {
  capture(args: { distinctId: string; event: string; properties?: Record<string, unknown> }): void;
  /** Kept for the analytics service's call sites; OpenPixo keeps no person or group profiles. */
  groupIdentify(args: unknown): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  flush(): Promise<void>;
  shutdown(timeoutMs?: number): Promise<void>;
}

export interface UsageEventsClientOptions {
  /** Ingest origin, e.g. https://events.openpixo.com. */
  url: string;
  fetchImpl?: typeof fetch;
  flushIntervalMs?: number;
  maxQueue?: number;
  requestTimeoutMs?: number;
  now?: () => Date;
}

const LIFTED = new Set([
  '$insert_id', 'event_id', 'device_id', 'app_session_id', 'session_id', 'occurred_at', 'reported_at',
  'app_version', 'client_version', 'channel', 'client_type', '$os',
]);

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
};

/** Maps the analytics service's PostHog-shaped properties onto the usage event fields. */
export function toUsageEvent(
  args: { distinctId: string; event: string; properties?: Record<string, unknown> },
  now: Date,
): UsageEvent | null {
  const props = args.properties ?? {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) if (!LIFTED.has(key)) rest[key] = value;
  const clientType = firstString(props.client_type);
  return normalizeUsageEvent({
    event: args.event,
    event_id: firstString(props.$insert_id, props.event_id) ?? randomUUID(),
    device_id: firstString(props.device_id, args.distinctId),
    session_id: firstString(props.app_session_id, props.session_id),
    occurred_at: firstString(props.occurred_at, props.reported_at) ?? now.toISOString(),
    app_version: firstString(props.app_version, props.client_version),
    channel: firstString(props.channel),
    client_type: clientType && ['web', 'desktop', 'daemon', 'external_mcp'].includes(clientType) ? clientType : 'daemon',
    os: firstString(props.$os),
    properties: rest,
  });
}

export function createUsageEventsClient(options: UsageEventsClientOptions): UsageEventsClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxQueue = options.maxQueue ?? 1000;
  const timeoutMs = options.requestTimeoutMs ?? 5000;
  const now = options.now ?? (() => new Date());
  const endpoint = `${options.url.replace(/\/+$/u, '')}${USAGE_EVENTS_PATH}`;
  let queue: UsageEvent[] = [];
  let inFlight: Promise<void> | null = null;
  let closed = false;

  async function send(events: UsageEvent[]): Promise<'ok' | 'retry' | 'drop'> {
    const body: UsageEventBatch = { schema: USAGE_EVENTS_SCHEMA_VERSION, events };
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return 'ok';
      return response.status === 429 || response.status >= 500 ? 'retry' : 'drop';
    } catch {
      return 'retry';
    }
  }

  // Events already put back once; a second failed send drops them.
  const retried = new WeakSet<UsageEvent>();

  async function drain(): Promise<void> {
    while (queue.length) {
      const batch = queue.splice(0, USAGE_EVENTS_MAX_BATCH);
      const outcome = await send(batch);
      if (outcome !== 'retry') continue;
      // One more try on the next flush; a second failure drops the batch.
      const again = batch.filter(event => !retried.has(event));
      for (const event of again) retried.add(event);
      if (again.length) queue = [...again, ...queue].slice(0, maxQueue);
      break;
    }
  }

  function flush(): Promise<void> {
    if (!inFlight) inFlight = drain().finally(() => { inFlight = null; });
    return inFlight;
  }

  const timer = setInterval(() => { void flush(); }, options.flushIntervalMs ?? 2_000);
  timer.unref?.();

  return {
    capture(args) {
      if (closed) return;
      const event = toUsageEvent(args, now());
      if (!event) return;
      queue.push(event);
      if (queue.length > maxQueue) queue = queue.slice(queue.length - maxQueue);
      if (queue.length >= USAGE_EVENTS_MAX_BATCH) void flush();
    },
    groupIdentify() {},
    on() {},
    flush,
    async shutdown(shutdownTimeoutMs = 3000) {
      closed = true;
      clearInterval(timer);
      await Promise.race([flush(), new Promise(resolve => setTimeout(resolve, shutdownTimeoutMs).unref?.())]);
    },
  };
}
