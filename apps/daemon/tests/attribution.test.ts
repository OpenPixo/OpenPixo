import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AnalyticsService } from '../src/analytics.js';
import { createAttributionService } from '../src/routes/attribution.js';
import { readInstallationFile, writeInstallationFile } from '../src/installation.js';
import { readAppConfig, type AppConfigPrefs, writeAppConfig } from '../src/app-config.js';

function analyticsStub(): AnalyticsService {
  return {
    capture: vi.fn(),
    captureSafety: vi.fn(async () => undefined),
    mergeAnonymousPerson: vi.fn(async () => undefined),
    identifyGroup: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  };
}

async function withTempData<T>(fn: (dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(join(tmpdir(), 'pixo-attribution-'));
  try {
    return await fn(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

describe('download attribution service', () => {
  it('stores a pending token before telemetry consent', async () => {
    await withTempData(async (dataDir) => {
      const analytics = analyticsStub();
      const service = createAttributionService({
        analytics,
        appConfig: { readAppConfig: async () => ({ telemetry: { metrics: false } }) },
        paths: { RUNTIME_DATA_DIR: dataDir },
        now: () => new Date('2026-07-10T00:00:00.000Z'),
      });

      const result = await service.claim({
        source: 'mac_where_froms',
        token: 'pixotoken_123456',
        rawUrl: 'https://download.example.test/mac/arm64/pixotoken_123456/Open.dmg',
        platform: 'macos',
      });

      expect(result.status).toBe('pending_consent');
      const installation = await readInstallationFile(dataDir);
      expect(installation.pendingAttribution?.token).toBe('pixotoken_123456');
      expect(analytics.mergeAnonymousPerson).not.toHaveBeenCalled();
    });
  });

  it('does not claim pre-delete attribution after metrics are re-enabled', async () => {
    await withTempData(async (dataDir) => {
      await writeInstallationFile(dataDir, {
        installationId: 'install-before-delete',
        pendingAttribution: {
          token: 'pixotoken_predelete',
          source: 'mac_where_froms',
          capturedAt: '2026-07-10T00:00:00.000Z',
        },
        attributionClaimedAt: '2026-07-10T00:00:01.000Z',
        attributionClaimResultAt: '2026-07-10T00:00:02.000Z',
      });
      await writeAppConfig(dataDir, {
        installationId: 'install-after-delete',
        telemetry: { metrics: false },
      });
      expect(await readInstallationFile(dataDir)).toEqual({ installationId: 'install-after-delete' });

      await writeAppConfig(dataDir, { telemetry: { metrics: true } });
      const analytics = analyticsStub();
      const fetchImpl = vi.fn();
      const service = createAttributionService({
        analytics,
        appConfig: { readAppConfig },
        env: { PIXO_ATTRIBUTION_LEDGER_URL: 'https://ledger.test/api/attribution' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        paths: { RUNTIME_DATA_DIR: dataDir },
      });

      await expect(service.processPending()).resolves.toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(analytics.mergeAnonymousPerson).not.toHaveBeenCalled();
    });
  });

  it('consumes a pending token and merges the landing person after consent', async () => {
    await withTempData(async (dataDir) => {
      await writeInstallationFile(dataDir, {
        installationId: 'install-123',
        pendingAttribution: {
          token: 'pixotoken_abcdef',
          source: 'mac_where_froms',
          capturedAt: '2026-07-10T00:00:00.000Z',
        },
      });
      const analytics = analyticsStub();
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
        status: 'consumed',
        webDistinctId: 'web-anon-1',
        properties: { pixo_utm_source: 'twitter', pixo_referrer: 'https://example.com' },
      }), { status: 200 }));
      const service = createAttributionService({
        analytics,
        appConfig: { readAppConfig: async () => ({ installationId: 'install-123', telemetry: { metrics: true } }) },
        env: { PIXO_ATTRIBUTION_LEDGER_URL: 'https://ledger.test/api/attribution' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        paths: { RUNTIME_DATA_DIR: dataDir },
        now: () => new Date('2026-07-10T00:01:00.000Z'),
      });

      const result = await service.processPending();

      expect(result?.status).toBe('claimed');
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://ledger.test/api/attribution/consume',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(analytics.mergeAnonymousPerson).toHaveBeenCalledWith(expect.objectContaining({
        anonymousDistinctId: 'web-anon-1',
        distinctId: 'install-123',
      }));
      const installation = await readInstallationFile(dataDir);
      expect(installation.pendingAttribution).toBeUndefined();
      expect(installation.attributionClaimedAt).toBe('2026-07-10T00:01:00.000Z');
    });
  });

  it('rejects a token already consumed by another installation as a shared installer', async () => {
    await withTempData(async (dataDir) => {
      await writeInstallationFile(dataDir, {
        installationId: 'install-123',
        pendingAttribution: {
          token: 'pixotoken_shared',
          source: 'windows_zone_identifier',
          capturedAt: '2026-07-10T00:00:00.000Z',
        },
      });
      const analytics = analyticsStub();
      const service = createAttributionService({
        analytics,
        appConfig: { readAppConfig: async (): Promise<AppConfigPrefs> => ({ installationId: 'install-123', telemetry: { metrics: true } }) },
        env: { PIXO_ATTRIBUTION_LEDGER_URL: 'https://ledger.test/api/attribution' },
        fetchImpl: vi.fn(async () => new Response(JSON.stringify({ status: 'already_consumed_other' }), { status: 200 })) as unknown as typeof fetch,
        paths: { RUNTIME_DATA_DIR: dataDir },
      });

      const result = await service.processPending();

      expect(result?.status).toBe('shared_installer');
      expect(analytics.mergeAnonymousPerson).not.toHaveBeenCalled();
      expect(analytics.captureSafety).toHaveBeenCalledWith(expect.objectContaining({
        eventName: 'attribution_shared_installer',
        distinctId: 'install-123',
      }));
    });
  });

  it('does not mint a browser bridge without a configured product site', async () => {
    await withTempData(async (dataDir) => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
        url: 'https://product.example/help?bridge=fixture',
      }), { status: 200 }));
      const service = createAttributionService({
        analytics: analyticsStub(),
        appConfig: { readAppConfig: async () => ({ installationId: 'install-123', telemetry: { metrics: true } }) },
        env: { PIXO_ATTRIBUTION_LEDGER_URL: 'https://ledger.test/api/attribution', PIXO_ATTRIBUTION_LEDGER_TOKEN: 'secret' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        paths: { RUNTIME_DATA_DIR: dataDir },
      });

      await expect(service.bridgeUrl('https://product.example/help')).resolves.toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  it('replays an idempotent merge when the same-installation ledger retry carries the recovered browser identity', async () => {
    await withTempData(async (dataDir) => {
      const analytics = analyticsStub();
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'consumed', webDistinctId: 'web-1' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'already_consumed_same', webDistinctId: 'web-1' }), { status: 200 }));
      const service = createAttributionService({
        analytics,
        appConfig: { readAppConfig: async () => ({ installationId: 'install-123', telemetry: { metrics: true } }) },
        env: { PIXO_ATTRIBUTION_LEDGER_URL: 'https://ledger.test/api/attribution' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        paths: { RUNTIME_DATA_DIR: dataDir },
      });

      await expect(service.claim({ token: 'pixotoken_repeat', source: 'manual' })).resolves.toMatchObject({ status: 'claimed', merged: true });
      await expect(service.claim({ token: 'pixotoken_repeat', source: 'manual' })).resolves.toMatchObject({ status: 'already_claimed', merged: true });
      expect(analytics.mergeAnonymousPerson).toHaveBeenCalledTimes(2);
      expect(analytics.captureSafety).toHaveBeenCalledTimes(2);
    });
  });

  it('merges a pending token when its first visible ledger response is already_consumed_same', async () => {
    await withTempData(async (dataDir) => {
      await writeInstallationFile(dataDir, {
        installationId: 'install-recovered',
        pendingAttribution: {
          token: 'pixotoken_recovered', source: 'mac_where_froms', capturedAt: '2026-07-10T00:00:00.000Z',
        },
      });
      const analytics = analyticsStub();
      const service = createAttributionService({
        analytics,
        appConfig: { readAppConfig: async () => ({ installationId: 'install-recovered', telemetry: { metrics: true } }) },
        env: { PIXO_ATTRIBUTION_LEDGER_URL: 'https://ledger.test/api/attribution' },
        fetchImpl: vi.fn(async () => new Response(JSON.stringify({
          status: 'already_consumed_same', webDistinctId: 'web-recovered', properties: { pixo_utm_source: 'retry' },
        }), { status: 200 })) as unknown as typeof fetch,
        paths: { RUNTIME_DATA_DIR: dataDir },
      });

      await expect(service.processPending()).resolves.toMatchObject({ status: 'already_claimed', merged: true });
      expect(analytics.mergeAnonymousPerson).toHaveBeenCalledWith(expect.objectContaining({
        anonymousDistinctId: 'web-recovered', distinctId: 'install-recovered',
      }));
      expect((await readInstallationFile(dataDir)).pendingAttribution).toBeUndefined();
    });
  });
});
