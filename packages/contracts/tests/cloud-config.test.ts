import { describe, expect, it } from 'vitest';
import { parseOpenPixoCloudConfig, PRODUCT_AGENT_URL, PRODUCT_CLOUD_ANON_KEY, PRODUCT_CLOUD_URL } from '../src/product.js';

describe('production cloud key', () => {
  // Supabase is retiring the JWT anon keys, and an installed app can't change the key it was built with.
  it('is a publishable key', () => {
    expect(PRODUCT_CLOUD_ANON_KEY).toMatch(/^sb_publishable_/u);
  });
});

describe('parseOpenPixoCloudConfig', () => {
  it('gives the production cloud its own gateway', () => {
    expect(parseOpenPixoCloudConfig(PRODUCT_CLOUD_URL, 'anon')).toEqual({ url: PRODUCT_CLOUD_URL, anonKey: 'anon', agentUrl: PRODUCT_AGENT_URL });
  });

  it('serves the gateway from any other cloud unless told otherwise', () => {
    expect(parseOpenPixoCloudConfig('https://test.example.com/', 'anon')?.agentUrl).toBe('https://test.example.com/functions/v1');
    expect(parseOpenPixoCloudConfig('https://test.example.com', 'anon', ' https://api-test.example.com/ ')?.agentUrl).toBe('https://api-test.example.com');
  });

  it('reads back the address it produced, which is how the daemon receives it from a packaged build', () => {
    const baked = parseOpenPixoCloudConfig('https://test.example.com', 'anon')!;
    expect(parseOpenPixoCloudConfig(baked.url, baked.anonKey, baked.agentUrl)).toEqual(baked);
  });

  it('refuses an unsafe gateway address rather than sending sessions to it', () => {
    expect(parseOpenPixoCloudConfig('https://test.example.com', 'anon', 'http://api.example.com')).toBeNull();
    expect(parseOpenPixoCloudConfig('https://test.example.com', 'anon', 'https://user:pass@api.example.com')).toBeNull();
    expect(parseOpenPixoCloudConfig('https://test.example.com', 'anon', 'not a url')).toBeNull();
  });
});
