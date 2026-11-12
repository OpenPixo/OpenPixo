import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreCatalogItem } from '@openpixo/contracts';
import { heroSlides, nameSeed, needsPurchase, quickTags, type WorkshopItem } from '../../../src/components/store/workshop-catalog';
import { purchaseStoreItem, storeErrorCode, StoreRequestError } from '../../../src/state/store';

vi.mock('../../../src/router', () => ({ navigate: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });

function entry(name: string, kind: WorkshopItem['kind'], overrides: Partial<StoreCatalogItem> = {}): WorkshopItem {
  return { name, kind, version: '1.0.0', engines: ['any'], pricing: { type: 'free' }, license: 'MIT', ...overrides } as WorkshopItem;
}

describe('Workshop catalogue helpers', () => {
  it('ranks descriptive tags by frequency and drops catalogue noise', () => {
    expect(quickTags([
      entry('a', 'skill', { tags: ['first-party', 'openpixo', 'godot', 'ui', 'Pixel-Art'] }),
      entry('b', 'asset-pack', { tags: ['pixel-art', 'rpg'] }),
      entry('c', 'asset-pack', { tags: ['pixel-art', 'ui'] }),
    ])).toEqual(['pixel-art', 'ui', 'rpg']);
  });

  it('builds the spotlight as flagship pack, toolkit, template, then a second pack', () => {
    const slides = heroSlides([
      entry('openpixo/retro-bestiary', 'asset-pack', { pricing: { type: 'paid', credits: 900 } }),
      entry('openpixo/pixel-dungeon-kit', 'asset-pack', { pricing: { type: 'paid', credits: 600 } }),
      entry('skill-a', 'skill'), entry('godot', 'project-template'), entry('mcp', 'mcp'),
    ]);
    expect(slides.map(slide => slide.kind === 'toolkit' ? 'toolkit' : slide.item.name))
      .toEqual(['openpixo/pixel-dungeon-kit', 'toolkit', 'godot', 'openpixo/retro-bestiary']);
    expect(heroSlides([entry('mcp', 'mcp')])).toEqual([]);
  });

  it('needs a purchase only for paid items the account does not own', () => {
    expect(needsPurchase({ pricing: { type: 'paid', credits: 5 } })).toBe(true);
    expect(needsPurchase({ pricing: { type: 'paid', credits: 5 }, owned: true })).toBe(false);
    expect(needsPurchase({ pricing: { type: 'free' } })).toBe(false);
  });

  it('seeds fallback art deterministically per name', () => {
    expect(nameSeed('openpixo/a')).toBe(nameSeed('openpixo/a'));
    expect(nameSeed('openpixo/a')).not.toBe(nameSeed('openpixo/b'));
  });
});

describe('purchaseStoreItem', () => {
  it('posts only the name and version and returns the receipt', async () => {
    const fetch = vi.fn(async () => Response.json({ name: 'p', version: '1', creditsSpent: 5, balance: 10, entitlementId: 'e' }));
    vi.stubGlobal('fetch', fetch);
    await expect(purchaseStoreItem({ name: 'p', version: '1' })).resolves.toMatchObject({ balance: 10 });
    expect(fetch).toHaveBeenCalledWith('/api/store/purchase', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'p', version: '1' }) }));
  });

  it('carries the daemon error code for the dialog to branch on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'STORE_PURCHASE_UNAVAILABLE', message: 'Soon' } }, { status: 503 })));
    const error = await purchaseStoreItem({ name: 'p' }).catch(cause => cause);
    expect(error).toBeInstanceOf(StoreRequestError);
    expect(storeErrorCode(error)).toBe('STORE_PURCHASE_UNAVAILABLE');
    expect((error as StoreRequestError).status).toBe(503);
    expect(error.message).toBe('Soon');
  });
});
