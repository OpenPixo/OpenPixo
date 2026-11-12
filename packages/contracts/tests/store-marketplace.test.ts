import { describe, expect, it } from 'vitest';
import { MarketplacePluginEntrySchema, StoreItemKindSchema } from '../src/plugins/marketplace.js';
import { OPENPIXO_REGISTRY } from '../src/product.js';

const entry = { name: 'openpixo/example', source: './example', version: '0.1.0', license: 'Apache-2.0' };

describe('OpenPixo registry contract', () => {
  it('ships without an invented registry host or key', () => {
    expect(OPENPIXO_REGISTRY).toEqual({ url: null, publicKeys: {} });
  });

  it('types store fields while preserving catalog extensions', () => {
    const extended = {
      ...entry,
      kind: 'recipe',
      engines: ['any'],
      pricing: { type: 'paid', credits: 300, sku: 'item.example', future: true },
      assetLicense: { commercialUse: true, attributionRequired: false },
      archive: { url: 'paid', integrity: 'sha256-example', size: 123 },
      previews: ['previews/example/1.webp'],
      requires: { openpixo: '>=0.4.0', capabilities: ['media-cli'] },
      future: { enabled: true },
    };
    expect(MarketplacePluginEntrySchema.parse(extended)).toEqual(extended);
    expect(StoreItemKindSchema.options).toEqual([
      'skill', 'recipe', 'mcp', 'project-template', 'asset-pack', 'character-card', 'style',
    ]);
    expect(MarketplacePluginEntrySchema.safeParse({ ...extended, pricing: { type: 'subscription' } }).success).toBe(false);
  });

  it('requires a license for OpenPixo entries and asset terms for asset packs', () => {
    expect(MarketplacePluginEntrySchema.safeParse({ ...entry, license: undefined }).success).toBe(false);
    expect(MarketplacePluginEntrySchema.safeParse({ ...entry, license: ' ' }).success).toBe(false);
    expect(MarketplacePluginEntrySchema.safeParse({ ...entry, name: 'vendor/example', kind: 'skill', license: undefined }).success).toBe(false);
    expect(MarketplacePluginEntrySchema.safeParse({ ...entry, kind: 'asset-pack' }).success).toBe(false);
    expect(MarketplacePluginEntrySchema.safeParse({
      ...entry, kind: 'asset-pack', assetLicense: { commercialUse: true, attributionRequired: false },
    }).success).toBe(true);
    expect(MarketplacePluginEntrySchema.safeParse({ name: 'legacy/plugin', source: './legacy', version: '1.0.0' }).success).toBe(true);
  });
});
