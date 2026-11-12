import fs from 'node:fs';
import { safeExternalFetch } from './plugin-asset-cache.js';
import path from 'node:path';

export const OFFICIAL_MARKETPLACE_ID = 'openpixo-official';

/** The directory beside the bundled manifest also owns its covers and previews. */
export function bundledMarketplaceRegistryDir(pluginRegistryDir: string, id: string): string {
  return path.resolve(pluginRegistryDir, id === OFFICIAL_MARKETPLACE_ID ? 'official' : id);
}

export interface MarketplaceSeedEntry {
  name: string;
  [key: string]: unknown;
}

export interface MarketplaceSeedConfig {
  trust: 'official' | 'restricted';
  url: string;
}

export interface MarketplaceSeedFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
}

export interface MarketplaceSeedHelpers {
  defaultMarketplaceSeedConfig(id: string): MarketplaceSeedConfig;
  bundledPluginRegistrySource(sourcePath: string): string;
  marketplaceSeedManifestText(id: string, bundledMarketplaceEntries: readonly MarketplaceSeedEntry[]): Promise<string | null>;
  createMarketplaceFetcher(
    seedId: string | null | undefined,
    bundledMarketplaceEntries: readonly MarketplaceSeedEntry[],
  ): (url: string) => Promise<MarketplaceSeedFetchResponse>;
}

export interface MarketplaceSeedHelperDeps {
  bundledPluginsDir: string;
  projectRoot: string;
  pluginRegistryDir: string;
  marketplaceManifestUrlForRegistry(id: string): string;
  marketplaceRegistryIdFromUrl(url: string): string | null;
  fetchImpl?: typeof fetch;
}

export function createMarketplaceSeedHelpers(deps: MarketplaceSeedHelperDeps): MarketplaceSeedHelpers {
  const fetchImpl = deps.fetchImpl ?? fetch;

  function defaultMarketplaceSeedConfig(id: string): MarketplaceSeedConfig {
    const url = deps.marketplaceManifestUrlForRegistry(id);
    return {
      trust: (id === 'official' || id === OFFICIAL_MARKETPLACE_ID) && url === `bundled:${OFFICIAL_MARKETPLACE_ID}`
        ? 'official' : 'restricted',
      url,
    };
  }

  function bundledPluginRegistrySource(sourcePath: string): string {
    return sourcePath;
  }

  async function marketplaceSeedManifestText(
    id: string,
    _bundledMarketplaceEntries: readonly MarketplaceSeedEntry[],
  ): Promise<string | null> {
    const manifestPath = path.join(bundledMarketplaceRegistryDir(deps.pluginRegistryDir, id), 'openpixo-marketplace.json');
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')) as { plugins?: MarketplaceSeedEntry[] };
    const resourceRoot = path.resolve(deps.pluginRegistryDir, '../..');
    for (const entry of manifest.plugins ?? []) {
      if (typeof entry.source === 'string' && entry.source.startsWith('./')) {
        entry.source = path.resolve(resourceRoot, entry.source);
      }
    }
    return JSON.stringify(manifest);
  }

  function createMarketplaceFetcher(
    seedId: string | null | undefined,
    bundledMarketplaceEntries: readonly MarketplaceSeedEntry[],
  ): (url: string) => Promise<MarketplaceSeedFetchResponse> {
    return async (url) => {
      const registryId = url.startsWith('bundled:') ? deps.marketplaceRegistryIdFromUrl(url) : null;
      if (registryId && (!seedId || registryId === seedId)) {
        const manifestText = await marketplaceSeedManifestText(registryId, bundledMarketplaceEntries);
        if (manifestText != null) {
          return {
            ok: true,
            status: 200,
            text: async () => manifestText,
          };
        }
      }
      const response = await safeExternalFetch(url, {}, fetchImpl);
      return {
        ok: response.ok,
        status: response.status,
        text: () => response.text(),
        arrayBuffer: () => response.arrayBuffer(),
      };
    };
  }

  return {
    defaultMarketplaceSeedConfig,
    bundledPluginRegistrySource,
    marketplaceSeedManifestText,
    createMarketplaceFetcher,
  };
}
