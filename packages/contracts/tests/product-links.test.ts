import { describe, expect, it } from 'vitest';

import {
  localizedProductPage,
  PRODUCT_PRIVACY_URL,
  PRODUCT_RELEASES_URL,
  PRODUCT_SITE_URL,
  PRODUCT_SUPPORT_URL,
  isProductSiteUrl,
} from '../src/product.js';

describe('public product pages', () => {
  it('point at pages the site really serves', () => {
    expect(PRODUCT_SUPPORT_URL).toBe('https://openpixo.com/support');
    expect(PRODUCT_RELEASES_URL).toBe('https://openpixo.com/changelog');
    expect(PRODUCT_PRIVACY_URL).toBe('https://openpixo.com/privacy');
  });

  it('use the site suffix for Chinese and leave other languages alone', () => {
    expect(localizedProductPage(PRODUCT_SUPPORT_URL, 'zh-CN')).toBe('https://openpixo.com/support.zh');
    expect(localizedProductPage(PRODUCT_SUPPORT_URL, 'zh')).toBe('https://openpixo.com/support.zh');
    expect(localizedProductPage(PRODUCT_SUPPORT_URL, 'en')).toBe('https://openpixo.com/support');
    expect(localizedProductPage(PRODUCT_SUPPORT_URL, 'ja-JP')).toBe('https://openpixo.com/support');
  });

  // Filling in the site URL would also turn on plugin share links to pages the
  // site does not have, and attribution bridging. Those stay off.
  it('do not switch on the site-wide first-party behavior', () => {
    expect(PRODUCT_SITE_URL).toBe('');
    expect(isProductSiteUrl(PRODUCT_SUPPORT_URL)).toBe(false);
  });
});
