import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// The release feed crosses tools-release (writer), tools-pack (baked URL) and
// the desktop updater (reader); no package owns all three, so the contract is
// pinned here against each side's real source.
type ToolsReleaseMetadataModule = {
  generateMetadata: (options: {
    artifactsDir: string;
    channel: string;
    minimumVersion?: { message?: Record<string, string>; min: string; url?: string };
    verifySignature: (path: string) => Promise<{ signed: boolean; status: string }>;
    version: string;
  }) => Promise<Record<string, unknown>>;
};
type ReleaseModule = { publicUpdateFeedUrl: (channel: 'stable' | 'beta') => string };
type DesktopConfigModule = {
  resolveDesktopUpdaterConfig: (input: Record<string, unknown>) => { channel: string; enabled: boolean; metadataUrl: string } & Record<string, unknown>;
};
type DesktopFeedModule = {
  requiredUpdateFromMetadata: (
    metadata: Record<string, unknown>,
    config: { currentVersion: string },
    candidateVersion: string,
  ) => Record<string, unknown> | null;
  selectUpdateCandidateWithFallback: (
    metadata: Record<string, unknown>,
    config: Record<string, unknown>,
    preferPayload: boolean,
  ) => { ok: true; candidate: { artifact: { type: string; url: string }; checksum: { algorithm: string; url?: string; value?: string }; version: string } }
    | { ok: false; error: { code: string } };
};

const load = async <T>(path: string): Promise<T> => await import(new URL(path, import.meta.url).href) as T;

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { force: true, recursive: true });
});

async function publishedStableMetadata(version: string): Promise<Record<string, unknown>> {
  const { generateMetadata } = await load<ToolsReleaseMetadataModule>('../../../tools/release/src/openpixo/metadata.ts');
  const artifactsDir = await mkdtemp(join(tmpdir(), 'openpixo-release-feed-'));
  dirs.push(artifactsDir);
  await writeFile(join(artifactsDir, `OpenPixo-${version}-win-x64-setup.exe`), `installer ${version}`);
  await writeFile(join(artifactsDir, `OpenPixo-${version}-win-x64-payload.7z`), `payload ${version}`);
  return await generateMetadata({
    artifactsDir,
    channel: 'stable',
    verifySignature: async () => ({ signed: true, status: 'Valid' }),
    version,
  });
}

describe('OpenPixo stable release feed', () => {
  it('is enabled by default in a packaged release build and accepted by the desktop updater', async () => {
    const { publicUpdateFeedUrl } = await load<ReleaseModule>('../../../packages/release/src/index.ts');
    const { resolveDesktopUpdaterConfig } = await load<DesktopConfigModule>('../../../apps/desktop/src/main/updater/config.ts');
    const { selectUpdateCandidateWithFallback } = await load<DesktopFeedModule>('../../../apps/desktop/src/main/updater/feed.ts');

    // What `tools-pack win build --release-channel stable` bakes, as packaged/index.ts exports it.
    const config = resolveDesktopUpdaterConfig({
      appVersion: '0.2.0',
      arch: 'x64',
      env: { PIXO_UPDATE_METADATA_URL: publicUpdateFeedUrl('stable') },
      platform: 'win32',
      runtimeBase: tmpdir(),
      source: 'openpixo-packaged',
    });
    expect(config).toMatchObject({ channel: 'stable', enabled: true, metadataUrl: 'https://downloads.openpixo.com/updates/stable/latest/metadata.json' });

    const metadata = await publishedStableMetadata('0.2.1');
    const payload = selectUpdateCandidateWithFallback(metadata, config, true);
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;
    expect(payload.candidate).toMatchObject({
      artifact: { type: 'payload', url: 'https://downloads.openpixo.com/releases/0.2.1/OpenPixo-0.2.1-win-x64-payload.7z' },
      checksum: { algorithm: 'sha256' },
      version: '0.2.1',
    });
    expect(payload.candidate.checksum.value).toMatch(/^[a-f0-9]{64}$/);

    const installer = selectUpdateCandidateWithFallback(metadata, config, false);
    expect(installer.ok && installer.candidate.artifact.type).toBe('installer');
  });

  it('turns a minimum version written by tools-release into the requirement the desktop updater enforces', async () => {
    const { generateMetadata } = await load<ToolsReleaseMetadataModule>('../../../tools/release/src/openpixo/metadata.ts');
    const { requiredUpdateFromMetadata } = await load<DesktopFeedModule>('../../../apps/desktop/src/main/updater/feed.ts');
    const artifactsDir = await mkdtemp(join(tmpdir(), 'openpixo-release-feed-'));
    dirs.push(artifactsDir);
    await writeFile(join(artifactsDir, 'OpenPixo-0.2.1-win-x64-setup.exe'), 'installer');
    const metadata = await generateMetadata({
      artifactsDir,
      channel: 'stable',
      minimumVersion: { message: { en: 'Saving is broken' }, min: '0.2.1', url: 'https://openpixo.com/download' },
      verifySignature: async () => ({ signed: true, status: 'Valid' }),
      version: '0.2.1',
    });

    expect(requiredUpdateFromMetadata(metadata, { currentVersion: '0.2.0' }, '0.2.1')).toEqual({
      message: { en: 'Saving is broken' },
      minVersion: '0.2.1',
      url: 'https://openpixo.com/download',
    });
    expect(requiredUpdateFromMetadata(metadata, { currentVersion: '0.2.1' }, '0.2.1')).toBeNull();
  });

  it('keeps upstream feeds disabled even when injected into a packaged build', async () => {
    const { resolveDesktopUpdaterConfig } = await load<DesktopConfigModule>('../../../apps/desktop/src/main/updater/config.ts');
    for (const url of ['https://releases.open-design.ai/stable/latest/metadata.json', 'https://s3.nexu.space/stable/latest/metadata.json']) {
      const config = resolveDesktopUpdaterConfig({
        appVersion: '0.2.0', env: { PIXO_UPDATE_METADATA_URL: url }, runtimeBase: tmpdir(), source: 'openpixo-packaged',
      });
      expect(config.enabled).toBe(false);
    }
  });
});
