import { afterAll } from "vitest";
import { parseClientMetricEvent } from '@openpixo/contracts/analytics';
/**
 * Coverage for the packaged main-process startup-failure telemetry
 * (apps/packaged/src/startup-telemetry.ts).
 *
 * Background: when the daemon dies before reporting status (issue #4638:
 * `better-sqlite3` vanished from the bundle → ERR_MODULE_NOT_FOUND), the
 * daemon/web sidecars — which host the PostHog client — never run, so the
 * whole crash class emits ZERO telemetry. This module emits one event from the
 * main process on the fatal-exit path. These tests pin three guarantees:
 *   1. it extracts the real error code / missing module from the #4638 log,
 *   2. it scrubs the user's home dir out of anything it sends,
 *   3. it can NEVER block the exit (timeout wins over a hung fetch) and is a
 *      no-op without a PostHog key.
 *
 * @see apps/packaged/src/startup-telemetry.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reportDaemonExit,
  STARTUP_FAILURE_EVENT,
  captureStartupFailure,
  classifyStartupFailure,
  parseDaemonLogTail,
  reportStartupFailure,
  resolveStartupDistinctId,
  readErrnoFields,
  scrubUserPaths,
  reportLaunchEvent,
  setStartupTelemetryConsentForTest,
  useStartupTelemetryConsent,
} from '../src/startup-telemetry.js';

/**
 * Reads one usage-event batch the launcher sent and returns the event with its
 * envelope folded back into `properties`, so assertions read one object. The
 * envelope is what the ingest Worker stores beside the counts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeUsage(raw: unknown): any {
  const body = JSON.parse(String(raw)) as { schema?: number; events?: Array<Record<string, any>> };
  const event = body.events?.[0] ?? {};
  return {
    schema: body.schema,
    event: event.event,
    distinct_id: event.device_id,
    timestamp: event.occurred_at,
    properties: {
      ...event.properties,
      event_id: event.event_id,
      device_id: event.device_id,
      app_session_id: event.session_id,
      app_version: event.app_version,
      channel: event.channel,
      occurred_at: event.occurred_at,
    },
  };
}

const optedOutRoot = mkdtempSync(join(tmpdir(), 'pixo-startup-consent-'));
// The data root a report names does not decide consent: the launcher's own
// consent reader does. These transport tests run as a user who said yes; the
// consent tests below swap in a real reader.
writeFileSync(join(optedOutRoot, 'app-config.json'), JSON.stringify({ telemetry: { metrics: false } }));
afterAll(() => rmSync(optedOutRoot, { recursive: true, force: true }));
beforeEach(() => setStartupTelemetryConsentForTest(() => true));
afterEach(() => setStartupTelemetryConsentForTest(() => false));

describe('launch timing transport', () => {
  it('preserves occurrence identity/time and does not invent an installation identity', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}'));
    const args = {
      usageEventsUrl: 'https://events.test.invalid',
      installationRoot: null, namespace: 'test', appVersion: '0.25.1', channel: 'beta',
      event: 'client_launch_attempt' as const,
      properties: { metric_schema_version: 1, telemetry_capability: 'supported', startup_type: 'cold', launch_type: 'warm', measurement_boundary: 'process_entry', started_at: '2026-10-16T00:00:00.000Z', event_id: 'event-1', occurred_at: '2026-10-16T00:00:00.000Z', app_session_id: 'session-1', launch_attempt_id: 'launch-1' },
    };
    await reportLaunchEvent(args, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    const root = mkdtempSync(join(tmpdir(), 'pixo-launch-identity-'));
    try {
      writeFileSync(join(root, 'installation.json'), JSON.stringify({ installationId: 'installation-1' }));
      await reportLaunchEvent({ dataRoot: optedOutRoot, ...args, installationRoot: root }, { fetchImpl, now: () => '2026-10-16T00:00:02.000Z' });
      const body = decodeUsage(String(fetchImpl.mock.calls[0]?.[1]?.body));
      expect(body.schema).toBe(1);
      expect(body.properties).toMatchObject({ event_schema_version: 4, client_type: 'desktop' });
      expect(body).toMatchObject({ event: 'client_launch_attempt', distinct_id: 'installation-1', timestamp: args.properties.occurred_at,
        properties: { ...args.properties, reported_at: '2026-10-16T00:00:02.000Z', channel: 'beta', app_version: '0.25.1' } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// Verbatim daemon log tail from issue #4638.
const ISSUE_4638_LOG = `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'better-sqlite3' imported from /Applications/OpenPixo.app/Contents/Resources/app/prebundled/daemon/chunks/server-PULTSXNL.mjs
    at Object.getPackageJSONURL (node:internal/modules/package_json_reader:301:9)
[openpixo packaged] exited app=daemon pid=45305 code=1 signal=none`;

// Verbatim shape of what waitForStatus throws (sidecars.ts:206-208).
const DAEMON_EXIT_MESSAGE =
  'daemon exited before reporting status (code=1, signal=none); see /Users/liudetao/Library/Application Support/OpenPixo/namespaces/release-stable/logs/daemon/latest.log for details';
const WEB_EXIT_MESSAGE =
  'daemon exited before reporting status (code=1, signal=none); see /Users/liudetao/Library/Application Support/OpenPixo/namespaces/release-stable/logs/web/latest.log for details';

describe('parseDaemonLogTail', () => {
  it('extracts the error code and missing module from the #4638 log', () => {
    expect(parseDaemonLogTail(ISSUE_4638_LOG)).toEqual({
      errorCode: 'ERR_MODULE_NOT_FOUND',
      missingModule: 'better-sqlite3',
    });
  });

  it('returns empty when the log carries no recognizable signal', () => {
    expect(parseDaemonLogTail('daemon started ok\nlistening on 17456')).toEqual({});
  });
});

describe('classifyStartupFailure', () => {
  it('classifies a daemon-start failure and pulls code/signal/logPath', () => {
    const c = classifyStartupFailure(new Error(DAEMON_EXIT_MESSAGE), false);
    expect(c.failureKind).toBe('daemon-start');
    expect(c.exitCode).toBe(1);
    expect(c.signal).toBeNull();
    expect(c.logPath).toContain('/logs/daemon/latest.log');
  });

  it('distinguishes a web-start failure by log-path segment, not message text', () => {
    // The thrown message still literally says "daemon" even for the web
    // sidecar; the log path is the only honest discriminator.
    const c = classifyStartupFailure(new Error(WEB_EXIT_MESSAGE), false);
    expect(c.failureKind).toBe('web-start');
  });

  it('classifies a Windows (backslash) web-start log path as web-start', () => {
    // startPackagedSidecars uses path.join, so on Windows the watched log path
    // is backslash-separated. A naive "/web/" check would misreport this as
    // daemon-start — the one platform split this field exists for.
    const winWebMessage =
      'daemon exited before reporting status (code=1, signal=none); see C:\\Users\\Alice\\AppData\\Roaming\\OpenPixo\\namespaces\\release-stable\\logs\\web\\latest.log for details';
    expect(classifyStartupFailure(new Error(winWebMessage), false).failureKind).toBe('web-start');
  });

  it('marks path-access failures without inventing a log path', () => {
    const c = classifyStartupFailure(new Error('whatever'), true);
    expect(c.failureKind).toBe('path-access');
    expect(c.logPath).toBeNull();
  });

  it('falls back to unknown for an unrecognized error', () => {
    expect(classifyStartupFailure(new Error('boom'), false).failureKind).toBe('unknown');
  });

  it('classifies a status-wait timeout as status-timeout, not unknown', () => {
    // waitForStatus throws this when the budget expires with the child still
    // ALIVE (the win32 first-launch AV-scan case) — the pipe never bound in
    // time, so there is no exit code, signal, or daemon log to read. Splitting
    // it out of `unknown` is what makes the win32 budget-raise measurable.
    const winPipe =
      'timed out waiting for sidecar status at \\\\.\\pipe\\openpixo-release-stable-win-daemon (connect ENOENT \\\\.\\pipe\\openpixo-release-stable-win-daemon)';
    const c = classifyStartupFailure(new Error(winPipe), false);
    expect(c.failureKind).toBe('status-timeout');
    expect(c.exitCode).toBeNull();
    expect(c.signal).toBeNull();
    expect(c.logPath).toBeNull();
  });
});

describe('scrubUserPaths', () => {
  it('redacts the user home directory but keeps the rest of the path', () => {
    const scrubbed = scrubUserPaths(
      '/Users/liudetao/Library/Application Support/OpenPixo/namespaces/release-stable/logs/daemon/latest.log',
    );
    expect(scrubbed).not.toContain('liudetao');
    expect(scrubbed).toContain('/Users/<redacted>/Library/Application Support');
  });

  it('redacts Windows user dirs too', () => {
    expect(scrubUserPaths('C:\\Users\\Alice\\AppData\\Roaming')).toBe(
      'C:\\Users\\<redacted>\\AppData\\Roaming',
    );
  });

  it('redacts the FULL Windows profile segment even when it contains spaces', () => {
    // A Windows profile dir can contain whitespace ("John Doe"). The redaction
    // must consume the whole segment up to the next separator, not stop at the
    // first space and leak the surname.
    const scrubbed = scrubUserPaths('C:\\Users\\John Doe\\AppData\\Roaming');
    expect(scrubbed).toBe('C:\\Users\\<redacted>\\AppData\\Roaming');
    expect(scrubbed).not.toContain('Doe');
  });

  it('scrubs a spaced Windows profile embedded in a crash message/stack', () => {
    const raw =
      "Cannot find package 'better-sqlite3' imported from C:\\Users\\John Doe\\App\\Resources\\app\\daemon\\server.mjs";
    const scrubbed = scrubUserPaths(raw);
    expect(scrubbed).not.toContain('John Doe');
    expect(scrubbed).not.toContain('Doe');
    expect(scrubbed).toContain('C:\\Users\\<redacted>\\App\\Resources');
  });

  it('redacts SLASH-separated Windows home paths with spaces (forward-slash form)', () => {
    // JS/Electron/Node diagnostics frequently normalize Windows paths to forward
    // slashes; the profile segment can still contain a literal space. The POSIX
    // "/Users/" rule alone would stop at the space and leak the tail.
    expect(scrubUserPaths('C:/Users/John Doe/AppData/Roaming')).toBe(
      'C:/Users/<redacted>/AppData/Roaming',
    );
  });

  it('scrubs a slash-form spaced Windows profile embedded in a crash message', () => {
    const raw =
      "Cannot find package 'better-sqlite3' imported from C:/Users/John Doe/App/Resources/app/daemon/server.mjs";
    const scrubbed = scrubUserPaths(raw);
    expect(scrubbed).not.toContain('John Doe');
    expect(scrubbed).not.toContain('Doe');
    expect(scrubbed).toContain('C:/Users/<redacted>/App/Resources');
  });

  it('does not over-redact across lines in a multi-line stack', () => {
    const scrubbed = scrubUserPaths('a C:\\Users\\John Doe\\x\nb /Users/bob/y');
    expect(scrubbed).toBe('a C:\\Users\\<redacted>\\x\nb /Users/<redacted>/y');
  });
});

describe('resolveStartupDistinctId', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    delete process.env.PIXO_INSTALLATION_DIR;
  });

  it('reads installationId from an explicit installationRoot (not the child-only env)', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixo-install-'));
    dirs.push(root);
    writeFileSync(join(root, 'installation.json'), JSON.stringify({ installationId: 'inst-abc' }));
    // env is intentionally unset — proving the parent process resolves via the
    // explicit arg, the bug PerishCode flagged.
    expect(resolveStartupDistinctId('release-stable', root)).toBe('inst-abc');
  });

  it('falls back to a synthetic per-namespace id when no installation file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixo-install-'));
    dirs.push(root);
    expect(resolveStartupDistinctId('release-stable', root)).toBe('packaged-release-stable');
  });
});

describe('captureStartupFailure', () => {
  it('is a no-op (zero network) without a PostHog key', async () => {
    const fetchImpl = vi.fn();
    await captureStartupFailure(
      { usageEventsUrl: null, distinctId: 'd', event: 'e', properties: {} },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POSTs one usage-event batch to the ingest Worker', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await captureStartupFailure(
      {
        usageEventsUrl: 'https://events.test.invalid',
        distinctId: 'install-123',
        event: STARTUP_FAILURE_EVENT,
        properties: { failure_kind: 'daemon-start' },
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => '2026-06-23T00:00:00.000Z' },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://events.test.invalid/v1/events');
    const raw = JSON.parse(init.body as string) as { schema: number; events: Array<Record<string, unknown>> };
    expect(raw.schema).toBe(1);
    expect(raw.events).toHaveLength(1);
    expect(raw.events[0]).toMatchObject({ event: STARTUP_FAILURE_EVENT, device_id: 'install-123', client_type: 'desktop',
      properties: expect.objectContaining({ failure_kind: 'daemon-start' }) });
    expect(raw.events[0]!.os).toBeTruthy();
  });

  it('stamps the shared safety-event envelope so dashboards bucket it', async () => {
    // Mirrors captureSafety in apps/daemon/src/analytics.ts. Without these,
    // env/schema-filtered dashboards miss or mis-bucket the event even though
    // PostHog accepts the raw payload (PerishCode review on #4696).
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await captureStartupFailure(
      {
        usageEventsUrl: 'https://events.test.invalid',
        distinctId: 'install-123',
        event: STARTUP_FAILURE_EVENT,
        properties: { failure_kind: 'daemon-start', app_version: '0.11.0' },
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => '2026-06-23T00:00:00.000Z',
        insertId: 'ins-fixed',
      },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const p = (decodeUsage(init.body as string) as { properties: Record<string, unknown> })
      .properties;
    expect(p.event_schema_version).toBe(2);
    expect(p.device_id).toBe('install-123');
    expect(p.process_kind).toBe('packaged_main');
    // Has a slash, like a path, so the counts-only rule leaves it out.
    expect(p.capture_source).toBeUndefined();
    expect(p.ui_version).toBe('0.11.0');
    expect(p.event_id).toBe('ins-fixed');
    expect(typeof p.env).toBe('string');
  });

  it('labels main-process events production (unset NODE_ENV) so they match daemon events', async () => {
    // The packaged main process has no NODE_ENV of its own, while the daemon it
    // spawns runs with NODE_ENV=production. Without this the event reported
    // `development` — 100% of packaged_runtime_failed were mislabeled dev in
    // prod and filtered out of the env=production dashboards.
    const saved = {
      PIXO_TELEMETRY_ENV: process.env.PIXO_TELEMETRY_ENV,
      PIXO_ENV: process.env.PIXO_ENV,
      POSTHOG_ENV: process.env.POSTHOG_ENV,
      LANGFUSE_ENVIRONMENT: process.env.LANGFUSE_ENVIRONMENT,
      NODE_ENV: process.env.NODE_ENV,
    };
    delete process.env.PIXO_TELEMETRY_ENV;
    delete process.env.PIXO_ENV;
    delete process.env.POSTHOG_ENV;
    delete process.env.LANGFUSE_ENVIRONMENT;
    delete process.env.NODE_ENV;
    try {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
      await captureStartupFailure(
        {
          usageEventsUrl: 'https://events.test.invalid',
          distinctId: 'install-123',
          event: STARTUP_FAILURE_EVENT,
          properties: { failure_kind: 'daemon-start' },
        },
        { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => '2026-06-23T00:00:00.000Z' },
      );
      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      const p = (decodeUsage(init.body as string) as { properties: Record<string, unknown> })
        .properties;
      expect(p.env).toBe('production');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('honors an explicit PIXO_TELEMETRY_ENV override (local smoke test can force dev)', async () => {
    const savedOd = process.env.PIXO_TELEMETRY_ENV;
    process.env.PIXO_TELEMETRY_ENV = 'development';
    try {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
      await captureStartupFailure(
        {
          usageEventsUrl: 'https://events.test.invalid',
          distinctId: 'install-123',
          event: STARTUP_FAILURE_EVENT,
          properties: { failure_kind: 'daemon-start' },
        },
        { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => '2026-06-23T00:00:00.000Z' },
      );
      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      const p = (decodeUsage(init.body as string) as { properties: Record<string, unknown> })
        .properties;
      expect(p.env).toBe('development');
    } finally {
      if (savedOd === undefined) delete process.env.PIXO_TELEMETRY_ENV;
      else process.env.PIXO_TELEMETRY_ENV = savedOd;
    }
  });

  it('never blocks past the timeout even if fetch hangs forever', async () => {
    // The critical guarantee for "no startup side-effect": a hung (offline)
    // request must not wedge the exit. Race must resolve via the timeout.
    const hung = new Promise<Response>(() => {
      /* never resolves */
    });
    const fetchImpl = vi.fn().mockReturnValue(hung);
    const start = Date.now();
    await captureStartupFailure(
      { usageEventsUrl: 'https://events.test.invalid', distinctId: 'd', event: 'e', properties: {} },
      { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 30 },
    );
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('swallows a fetch that throws (analytics failure is not a product error)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(
      captureStartupFailure(
        { usageEventsUrl: 'https://events.test.invalid', distinctId: 'd', event: 'e', properties: {} },
        { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 50 },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('reportStartupFailure', () => {
  it('reads the log tail, sends what it names as codes, and never the path', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await reportStartupFailure(
      {
        dataRoot: optedOutRoot,
        error: new Error(DAEMON_EXIT_MESSAGE),
        isPathAccess: false,
        usageEventsUrl: 'https://events.test.invalid',
        distinctId: 'install-123',
        appVersion: '0.11.0',
        namespace: 'release-stable',
        source: 'openpixo-packaged',
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        readLogTail: async () => ISSUE_4638_LOG,
        now: () => '2026-06-23T00:00:00.000Z',
      },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = (decodeUsage(init.body as string) as { properties: Record<string, unknown> })
      .properties;
    expect(props.failure_kind).toBe('daemon-start');
    expect(props.error_code).toBe('ERR_MODULE_NOT_FOUND');
    expect(props.missing_module).toBe('better-sqlite3');
    expect(props.app_version).toBe('0.11.0');
    expect(props.exit_code).toBe(1);
    expect(props.log_path).toBeUndefined();
    expect(init.body as string).not.toContain('liudetao');
  });

  it('never throws even when the log read blows up', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await expect(
      reportStartupFailure(
        {
        dataRoot: optedOutRoot,
          error: new Error(DAEMON_EXIT_MESSAGE),
          isPathAccess: false,
          usageEventsUrl: 'https://events.test.invalid',
          distinctId: 'd',
          appVersion: '0.11.0',
          namespace: 'release-stable',
          source: 'openpixo-packaged',
        },
        {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          readLogTail: async () => {
            throw new Error('disk gone');
          },
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('is a no-op without a PostHog key (fork builds)', async () => {
    const fetchImpl = vi.fn();
    await reportStartupFailure(
      {
        dataRoot: optedOutRoot,
        error: new Error(DAEMON_EXIT_MESSAGE),
        isPathAccess: false,
        usageEventsUrl: null,
        distinctId: 'd',
        appVersion: '0.11.0',
        namespace: 'release-stable',
        source: 'openpixo-packaged',
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, readLogTail: async () => ISSUE_4638_LOG },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Why these exist: the field crash is a SUBSET of machines (verified 2026-07-06
  // — the shipped 0.13.0 DMG's better_sqlite3.node is present, signed, notarized,
  // and resolvable, so it is NOT a build defect). To learn WHY a given machine
  // can't load it, the event must carry on-machine evidence: the scrubbed error
  // message/stack (the only signal for the `unknown` bucket, which has no daemon
  // log to parse) and whether the native module file actually exists there.
  it('sends the native-module probe as counts, and no message, stack or path', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    const error = new Error(
      "Cannot find package 'better-sqlite3' imported from /Users/liudetao/App/Contents/Resources/app/prebundled/daemon/server.mjs",
    );
    error.stack = `${error.message}\n    at file:///Users/liudetao/App/Contents/Resources/app/prebundled/daemon/server.mjs:1:1`;
    await reportStartupFailure(
      {
        dataRoot: optedOutRoot,
        error,
        isPathAccess: false,
        usageEventsUrl: 'https://events.test.invalid',
        distinctId: 'd',
        appVersion: '0.13.0',
        namespace: 'release-stable',
        source: 'openpixo-packaged',
        nativeModulePath:
          '/Users/liudetao/App/Contents/Resources/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        readLogTail: async () => null,
        statNativeModule: (p) => (p.endsWith('better_sqlite3.node') ? { size: 1_234_567 } : null),
      },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = (decodeUsage(init.body as string) as { properties: Record<string, unknown> }).properties;
    // OpenPixo sends counts only: the message, stack and path stay on the machine.
    expect(props.error_message).toBeUndefined();
    expect(props.error_stack).toBeUndefined();
    expect(props.native_module_path).toBeUndefined();
    expect(init.body as string).not.toContain('liudetao');
    // native-module probe answers "is the .node actually on THIS machine".
    expect(props.native_module_present).toBe(true);
    expect(props.native_module_size).toBe(1_234_567);
  });

  it('reports native_module_present=false when the .node is missing on the machine', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await reportStartupFailure(
      {
        dataRoot: optedOutRoot,
        error: new Error('boom'),
        isPathAccess: false,
        usageEventsUrl: 'https://events.test.invalid',
        distinctId: 'd',
        appVersion: '0.13.0',
        namespace: 'release-stable',
        source: 'openpixo-packaged',
        nativeModulePath: '/a/b/better_sqlite3.node',
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        readLogTail: async () => null,
        statNativeModule: () => null,
      },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = (decodeUsage(init.body as string) as { properties: Record<string, unknown> }).properties;
    expect(props.native_module_present).toBe(false);
    // A null is not a count; it is left out.
    expect(props.native_module_size).toBeUndefined();
  });
});

// Attribution guards. Every input below is a VERBATIM field payload pulled from
// the `packaged_runtime_failed` stream (7d window, 2026-07-22) while triaging
// the weekly alert. Each one is a failure the event carried enough evidence to
// name and reported as an opaque `unknown` / `null` anyway:
//
//   - 62 devices: daemon exited(code=1) with the log tail successfully read, but
//     `parseDaemonLogTail` only ever matched `ERR_*`, so any daemon that died of
//     something else (SQLite corruption, EPERM, a plain throw) reported
//     error_code=null AND missing_module=null — evidence in hand, nothing
//     extracted.
//   - 21 devices: Windows CreateProcess failures whose Error carries
//     code/errno/syscall as own properties. The event sent `.message` only and
//     dropped the triplet, so `spawn UNKNOWN` could not be separated from any
//     other opaque failure.
//   - 149 devices: an Error with an empty `.message` AND no `.stack`, which fell
//     through to error_message=null + error_stack=null + failure_kind=unknown —
//     a total black hole with no way to count or name the residue.
describe('startup-failure attribution', () => {
  // Verbatim tail shape of a daemon that threw without an ERR_ code.
  const NON_ERR_CODE_LOG = `[openpixo daemon] starting namespace=release-stable-win
SqliteError: database disk image is malformed
    at Database.prepare (node:sqlite:214:9)
[openpixo packaged] exited app=daemon pid=8123 code=1 signal=none`;

  it('names the daemon crash when the log tail carries no ERR_ code', () => {
    const parsed = parseDaemonLogTail(NON_ERR_CODE_LOG);
    expect(parsed.errorCode).toBeUndefined();
    // The reason is right there in the tail; it must not be dropped.
    expect(parsed.daemonError).toBe('SqliteError: database disk image is malformed');
  });

  it('still prefers the ERR_ code when the log has one', () => {
    expect(parseDaemonLogTail(ISSUE_4638_LOG).errorCode).toBe('ERR_MODULE_NOT_FOUND');
  });

  it('classifies a Windows spawn failure instead of burying it in unknown', () => {
    expect(classifyStartupFailure(new Error('spawn UNKNOWN'), false).failureKind).toBe(
      'spawn-failed',
    );
  });

  it('sends the Node errno triplet off the error object', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    // Exactly how Node shapes a failed CreateProcess on win32.
    const spawnError = Object.assign(new Error('spawn UNKNOWN'), {
      code: 'UNKNOWN',
      errno: -4094,
      syscall: 'spawn',
    });
    await reportStartupFailure(
      {
        dataRoot: optedOutRoot,
        error: spawnError,
        isPathAccess: false,
        usageEventsUrl: 'https://events.test.invalid',
        distinctId: 'd',
        appVersion: '0.15.1',
        namespace: 'release-stable-win',
        source: 'openpixo-packaged',
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = (decodeUsage(init.body as string) as { properties: Record<string, unknown> })
      .properties;
    expect(props.sys_code).toBe('UNKNOWN');
    expect(props.sys_errno).toBe(-4094);
    expect(props.sys_syscall).toBe('spawn');
    expect(props.failure_kind).toBe('spawn-failed');
  });

  it('names an Error that carries no message by its failure kind, never by text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    // The 149-device black hole: instanceof Error, name 'Error', no message, no
    // stack. Whatever we send must be non-null so the residue stays countable.
    const empty = new Error('');
    delete (empty as { stack?: string }).stack;
    await reportStartupFailure(
      {
        dataRoot: optedOutRoot,
        error: empty,
        isPathAccess: false,
        usageEventsUrl: 'https://events.test.invalid',
        distinctId: 'd',
        appVersion: '0.15.1',
        namespace: 'release-stable-win',
        source: 'openpixo-packaged',
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = (decodeUsage(init.body as string) as { properties: Record<string, unknown> })
      .properties;
    expect(props.error_message).toBeUndefined();
    expect(props.failure_kind).toEqual(expect.any(String));
  });

  it('keeps the parsed daemon error text on the machine', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await reportStartupFailure(
      {
        dataRoot: optedOutRoot,
        error: new Error(DAEMON_EXIT_MESSAGE),
        isPathAccess: false,
        usageEventsUrl: 'https://events.test.invalid',
        distinctId: 'd',
        appVersion: '0.15.1',
        namespace: 'release-stable',
        source: 'openpixo-packaged',
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        readLogTail: async () => NON_ERR_CODE_LOG,
      },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = (decodeUsage(init.body as string) as { properties: Record<string, unknown> })
      .properties;
    expect(props.daemon_error).toBeUndefined();
    expect(init.body as string).not.toContain('database disk image');
  });
});

// Privacy guard for the errno triplet (review of PR #5956).
//
// Node does not guarantee `syscall` is only the operation name: a failed
// child_process.spawn sets it to the whole invocation. Verified against real
// Node behaviour — spawning a missing binary yields
// `syscall === 'spawn /Users/<name>/.../tool'`. Forwarding that verbatim would
// put the local username and install path into an event that is retained even
// for opted-out users, while every other path this module sends is scrubbed.
describe('errno triplet privacy', () => {
  it('reduces a path-bearing POSIX syscall to the operation token', () => {
    const err = Object.assign(new Error('spawn /Users/alice/tools/hermes ENOENT'), {
      code: 'ENOENT',
      errno: -2,
      syscall: 'spawn /Users/alice/tools/hermes',
    });
    expect(readErrnoFields(err).syscall).toBe('spawn');
  });

  it('reduces a path-bearing Windows syscall to the operation token', () => {
    const err = Object.assign(new Error('spawn UNKNOWN'), {
      syscall: 'spawn C:\\Users\\Alice Smith\\AppData\\OpenPixo\\hermes.exe',
    });
    expect(readErrnoFields(err).syscall).toBe('spawn');
  });

  it('emits no username anywhere in the payload for a path-bearing spawn failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    const err = Object.assign(new Error('spawn /Users/alice/tools/hermes ENOENT'), {
      code: 'ENOENT',
      errno: -2,
      syscall: 'spawn /Users/alice/tools/hermes',
    });
    await reportStartupFailure(
      {
        dataRoot: optedOutRoot,
        error: err,
        isPathAccess: false,
        usageEventsUrl: 'https://events.test.invalid',
        distinctId: 'd',
        appVersion: '0.15.1',
        namespace: 'release-stable',
        source: 'openpixo-packaged',
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).not.toContain('alice');
  });

  it('classifies a spawn failure whose syscall carries a path', () => {
    // The pre-normalization check compared the raw `syscall` to 'spawn', so a
    // spawn error carrying a path fell through to `unknown` — the exact bucket
    // this PR exists to drain.
    const err = Object.assign(new Error('spawn /Users/alice/tools/hermes ENOENT'), {
      syscall: 'spawn /Users/alice/tools/hermes',
    });
    expect(classifyStartupFailure(err, false).failureKind).toBe('spawn-failed');
  });
});

// The blind bucket (production, 14 days to 2026-08-22): macOS `daemon-start`
// with 968 events across 293 people where the daemon exits code=1, the native
// module IS present, and error_code / missing_module / daemon_error all come
// back empty. `parseDaemonLogTail` only names patterns we already know
// (`ERR_*`, a missing module, an `XError:` headline); when a daemon dies of
// anything else, the reason is sitting in a log tail we ALREADY READ and then
// threw away. These tests pin the recovery: when parsing yields nothing, send
// the tail itself — scrubbed and bounded — so the largest startup-failure
// bucket stops being undiagnosable.
// The daemon's log tail is read to name known failures (ERR_* codes, a missing
// module), and those names are sent. The tail itself is text, so under
// OpenPixo's counts-only rule it never leaves the machine, whatever it holds.
describe('daemon_log_tail stays on the machine', () => {
  it('never sends the tail, even when the log matches no known pattern', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await reportStartupFailure(
      {
        dataRoot: optedOutRoot,
        error: new Error(DAEMON_EXIT_MESSAGE),
        isPathAccess: false,
        usageEventsUrl: 'https://events.test.invalid',
        distinctId: 'd',
        appVersion: '0.20.2',
        namespace: 'release-stable',
        source: 'openpixo-packaged',
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        readLogTail: async () => 'something we have never seen went wrong while binding the port\nC:\\Users\\John Doe\\AppData',
      },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = decodeUsage(init.body as string).properties as Record<string, unknown>;
    expect(props.daemon_log_tail).toBeUndefined();
    expect(init.body as string).not.toContain('binding the port');
    expect(init.body as string).not.toContain('John Doe');
    expect(props.failure_kind).toBe('daemon-start');
  });
});

it.each(['false', 'corrupt', 'unavailable'])('sends no startup report when metrics consent is %s', async state => {
  const root = mkdtempSync(join(tmpdir(), 'pixo-exit-consent-'));
  const fetchImpl = vi.fn();
  try {
    if (state !== 'unavailable') writeFileSync(join(root, 'app-config.json'), state === 'false' ? '{"telemetry":{"metrics":false}}' : '{');
    useStartupTelemetryConsent(root);
    await reportStartupFailure({ dataRoot: root, error: new Error('daemon failed'),
      isPathAccess: false, usageEventsUrl: 'https://events.test.invalid', distinctId: 'installation-1',
      appVersion: '1.0.0', namespace: 'test', source: 'openpixo-packaged' }, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('sends a private-data-free startup report once the user said yes, read at send time', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pixo-exit-consent-'));
  const fetchImpl = vi.fn();
  try {
    useStartupTelemetryConsent(root);
    writeFileSync(join(root, 'app-config.json'), '{"installationId":"installation-1","telemetry":{"metrics":true}}');
    await reportStartupFailure({ dataRoot: root, error: new Error('daemon failed'),
      isPathAccess: false, usageEventsUrl: 'https://events.test.invalid', distinctId: 'installation-1',
      appVersion: '1.0.0', namespace: 'test', source: 'openpixo-packaged' }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const payloads = fetchImpl.mock.calls.map(([, init]) => decodeUsage(init.body));
    const exit = payloads.find(p => p.event === 'client_process_exit');
    expect(exit).toBeDefined();
    for (const key of ['path', 'url', 'content', 'prompt', 'pid', 'error_message']) expect(exit.properties).not.toHaveProperty(key);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each(['daemon', 'web'])('correlates injected %s startup failure with its launch and emits a private-data-free exit metric', async role => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
  await reportStartupFailure({ dataRoot: optedOutRoot,
    error: new Error(`daemon exited before reporting status (code=1, signal=none); see /private/${role}/latest.log for details`),
    isPathAccess: false, usageEventsUrl: 'https://events.test.invalid', distinctId: 'installation-1',
    appVersion: '1.0.0-beta.1', namespace: 'test', source: 'openpixo-packaged',
    launchContext: { app_session_id: 'session-1', launch_attempt_id: 'launch-1' } }, { fetchImpl, readLogTail: async () => null });
  const payloads = fetchImpl.mock.calls.map(([, init]) => decodeUsage((init as RequestInit).body as string));
  const exit = payloads.find(p => p.event === 'client_process_exit');
  expect(exit.properties).toMatchObject({ app_session_id: 'session-1', launch_attempt_id: 'launch-1',
    app_version: '1.0.0-beta.1', reason: 'crash', process_role: role });
  for (const key of ['log_path', 'native_module_path', 'error_stack', 'error_message', 'daemon_log_tail', 'pid']) expect(exit.properties).not.toHaveProperty(key);
});


describe('runtime daemon death safety capture', () => {
  const observation = {
    process_instance_id: '00000000-0000-4000-8000-000000000001',
    app_session_id: 'dead-session', launch_attempt_id: 'dead-launch', app_version: '1.2.3',
    occurred_at: '2026-10-19T01:02:03.000Z', exit_code: null, signal: 'SIGKILL', reason: 'killed' as const,
    delivered: false,
  };
  it.each([200, 503])('persists evidence and acknowledges only successful HTTP (%s)', async status => {
    const root = mkdtempSync(join(tmpdir(), 'pixo-runtime-exit-'));
    try {
      writeFileSync(join(root, 'installation.json'), JSON.stringify({ installationId: 'installation-1' }));
      writeFileSync(join(root, 'app-config.json'), JSON.stringify({ telemetry: { metrics: false } }));
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
      await reportDaemonExit({ dataRoot: root, installationRoot: root, namespace: 'test',
        usageEventsUrl: 'https://events.test.invalid',
        observation: { ...observation, pid: 987654, content: 'private-content', path: '/private/path' } as typeof observation },
        { fetchImpl });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const body = decodeUsage(fetchImpl.mock.calls[0]![1]!.body as string);
      expect(body.properties).toMatchObject({ process_role: 'daemon', reason: 'killed', signal: 'SIGKILL',
        process_instance_id: observation.process_instance_id, app_session_id: 'dead-session', launch_attempt_id: 'dead-launch',
        occurred_at: observation.occurred_at, occurrence_time_source: 'observed', is_backfill: false,
        event_id: `${observation.process_instance_id}-unclean-exit:exit` });
      for (const field of ['pid', 'path', 'content', 'delivered']) expect(body.properties).not.toHaveProperty(field);
      expect(JSON.parse(readFileSync(join(root, 'diagnostics', 'daemon-exit-observation.json'), 'utf8')))
        .toEqual({ ...observation, delivered: status === 200 });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('does not recreate consumed evidence after a delayed acknowledgement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pixo-runtime-exit-'));
    let resolve!: (response: Response) => void;
    try {
      const sending = reportDaemonExit({ dataRoot: root, installationRoot: root, namespace: 'test',
        usageEventsUrl: 'test', observation }, { fetchImpl: () => new Promise(r => { resolve = r; }) });
      const path = join(root, 'diagnostics', 'daemon-exit-observation.json');
      rmSync(path); resolve(new Response('', { status: 200 })); await sending;
      expect(() => readFileSync(path)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});


it('uses explicit same-instance V8 OOM evidence before runtime signal capture', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pixo-runtime-oom-'));
  const instanceId = '00000000-0000-4000-8000-000000000002';
  try {
    mkdirSync(join(root, 'diagnostics', 'fatal-reports'), { recursive: true });
    writeFileSync(join(root, 'diagnostics', 'daemon-health.json'), JSON.stringify({ bootId: instanceId, pid: 987654, startedAt: Date.now() - 1000 }));
    writeFileSync(join(root, 'diagnostics', 'fatal-reports', 'report.json'), JSON.stringify({ header: { processId: 987654, trigger: 'OOMError' } }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 200 }));
    await reportDaemonExit({ dataRoot: root, installationRoot: root, namespace: 'test', usageEventsUrl: 'test',
      observation: { process_instance_id: instanceId, app_session_id: null, launch_attempt_id: null, app_version: '1.2.3',
        occurred_at: new Date().toISOString(), exit_code: null, signal: 'SIGABRT', reason: 'killed', delivered: false } }, { fetchImpl });
    const body = decodeUsage(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.properties).toMatchObject({ reason: 'oom', signal: 'SIGABRT' });
    expect(JSON.stringify(body)).not.toContain('987654');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
