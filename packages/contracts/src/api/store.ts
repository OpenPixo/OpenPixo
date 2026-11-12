import type { MarketplacePluginEntry, StoreItemKind } from '../plugins/marketplace.js';
import type { PluginExample } from '../plugins/manifest.js';
import type { ArtStyle } from './styles.js';

export interface StoreCatalogQuery {
  kind?: StoreItemKind;
  engine?: string;
  q?: string;
  pricing?: 'free' | 'paid';
}

export interface StoreCatalogItem extends Pick<MarketplacePluginEntry,
  'name' | 'version' | 'title' | 'title_i18n' | 'description' | 'description_i18n' | 'assetLicense'> {
  kind: StoreItemKind;
  engines: string[];
  pricing: NonNullable<MarketplacePluginEntry['pricing']>;
  license: string;
  installedVersion?: string;
  examples?: PluginExample[];
  style?: ArtStyle;
  /** Daemon-served cover artwork (`/api/store/items/:name/cover`), absent when the item ships none. */
  coverUrl?: string;
  /** Catalogue tags (genre, contents, mood) used for Workshop shelves and search. */
  tags?: string[];
  /** True once the signed-in account owns this paid item. Always absent for free items. */
  owned?: boolean;
  /**
   * Present when this skill ships with OpenPixo and the agent already reads it
   * whenever a task calls for it, in every project on a matching engine: there
   * is nothing to install. `enabled` is false when the user switched it off
   * (app config `disabledSkills`); `skillId` is the id that switch uses.
   */
  builtIn?: { skillId: string; enabled: boolean };
}

export interface StoreCatalogResponse { items: StoreCatalogItem[] }

export interface StoreItemDetail extends StoreCatalogItem {
  previews: string[];
  requires: NonNullable<MarketplacePluginEntry['requires']>;
  versions: string[];
}

export interface StoreInstallRequest {
  name: string;
  version?: string;
  projectId?: string;
}

export interface StoreInstallResponse {
  pluginId: string;
  name: string;
  version: string;
  projectId?: string;
  warnings: string[];
}

/** Spend credits on a paid Workshop item. The cloud prices it by SKU; the client never sends an amount. */
export interface StorePurchaseRequest {
  name: string;
  version?: string;
}

export interface StorePurchaseResponse {
  name: string;
  version: string;
  creditsSpent: number;
  /** Available credits after the purchase. */
  balance: number;
  entitlementId: string;
}
