/**
 * OpenPixo usage events: the one wire format the app sends to OpenPixo's own
 * ingest Worker (`POST <ingest>/v1/events`), which keeps a permanent copy in
 * OpenPixo's R2 and a three-month working copy in Workers Analytics Engine.
 *
 * Invariant: no usage event carries user text. Every property value is a
 * boolean, a finite number, an identifier-shaped string (or a short list of
 * them). Prompts, titles, genres, messages, paths, URLs and logs cannot pass
 * `usageEventProperties`, so a caller that passes one loses it instead of
 * sending it. The ingest Worker applies the same rule again (its mirror of this
 * file lives in the cloud repository).
 *
 * Nothing here decides consent; senders check the user's yes before sending.
 */

export const USAGE_EVENTS_SCHEMA_VERSION = 1 as const;
export const USAGE_EVENTS_PATH = '/v1/events';
export const USAGE_EVENTS_MAX_BATCH = 50;
export const USAGE_EVENTS_MAX_BODY_BYTES = 64 * 1024;
export const USAGE_EVENT_MAX_PROPERTIES = 64;
export const USAGE_EVENT_MAX_LIST = 16;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const PROPERTY_KEY = /^[a-z][a-z0-9_]{0,63}$/u;

export type UsageEventValue = string | number | boolean | string[];
export type UsageEventClientType = 'web' | 'desktop' | 'daemon' | 'external_mcp';

export interface UsageEvent {
  /** Event name, snake_case. */
  event: string;
  /** Unique per occurrence; the dedup key. */
  event_id: string;
  /** The anonymous installation id the user's yes created. */
  device_id: string;
  session_id: string | null;
  /** RFC 3339, when it happened on the user's machine. */
  occurred_at: string;
  app_version: string | null;
  channel: string | null;
  client_type: UsageEventClientType;
  /** win32 / darwin / linux or a browser OS name, identifier-shaped. */
  os: string | null;
  properties: Record<string, UsageEventValue>;
}

export interface UsageEventBatch {
  schema: typeof USAGE_EVENTS_SCHEMA_VERSION;
  events: UsageEvent[];
}

export interface UsageEventBatchResponse {
  accepted: number;
  rejected: number;
}

export function isUsageIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

/** Keeps only values that cannot carry user text; see the module invariant. */
export function usageEventProperties(input: Record<string, unknown>): Record<string, UsageEventValue> {
  const out: Record<string, UsageEventValue> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= USAGE_EVENT_MAX_PROPERTIES) break;
    if (!PROPERTY_KEY.test(key)) continue;
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (isUsageIdentifier(value)) out[key] = value;
    else if (Array.isArray(value) && value.length <= USAGE_EVENT_MAX_LIST && value.every(isUsageIdentifier)) out[key] = [...value];
    else continue;
    count += 1;
  }
  return out;
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;
const CLIENT_TYPES: ReadonlySet<string> = new Set(['web', 'desktop', 'daemon', 'external_mcp']);

const optionalIdentifier = (value: unknown): string | null => (isUsageIdentifier(value) ? value : null);

// The legacy PostHog OS names some senders still produce; their spaces fail
// the identifier rule, which left every macOS event with no OS at all.
const SPACED_OS_NAMES: Record<string, string> = { 'Mac OS X': 'macOS', 'Chrome OS': 'ChromeOS' };
const usageOsName = (value: unknown): string | null =>
  optionalIdentifier(typeof value === 'string' && Object.hasOwn(SPACED_OS_NAMES, value) ? SPACED_OS_NAMES[value] : value);

/**
 * Builds a valid event or returns null. Used by every sender before queueing,
 * and by the Worker on receipt.
 */
export function normalizeUsageEvent(input: {
  event: unknown;
  event_id: unknown;
  device_id: unknown;
  session_id?: unknown;
  occurred_at: unknown;
  app_version?: unknown;
  channel?: unknown;
  client_type: unknown;
  os?: unknown;
  properties?: unknown;
}): UsageEvent | null {
  if (typeof input.event !== 'string' || !PROPERTY_KEY.test(input.event)) return null;
  if (!isUsageIdentifier(input.event_id) || !isUsageIdentifier(input.device_id)) return null;
  if (typeof input.occurred_at !== 'string' || !RFC3339.test(input.occurred_at) || Number.isNaN(Date.parse(input.occurred_at))) return null;
  if (typeof input.client_type !== 'string' || !CLIENT_TYPES.has(input.client_type)) return null;
  const properties = input.properties && typeof input.properties === 'object' && !Array.isArray(input.properties)
    ? usageEventProperties(input.properties as Record<string, unknown>)
    : {};
  return {
    event: input.event,
    event_id: input.event_id,
    device_id: input.device_id,
    session_id: optionalIdentifier(input.session_id),
    occurred_at: input.occurred_at,
    app_version: optionalIdentifier(input.app_version),
    channel: optionalIdentifier(input.channel),
    client_type: input.client_type as UsageEventClientType,
    os: usageOsName(input.os),
    properties,
  };
}
