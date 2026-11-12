import { describe, expect, it } from 'vitest';
import { isUpstreamHost, mentionsUpstream } from '../src/upstream-policy.js';

describe('upstream infrastructure policy', () => {
  it.each([
    'open-design.ai', 'releases.open-design.ai', 'a.b.open-design.ai',
    'OPEN-DESIGN.AI', 'WhAtSnEw.Open-Design.Ai.', 'open-design.ai.',
    'nexu.space', 's3.nexu.space', 'NEXU.SPACE.', 'a.b.nexu.space',
  ])('rejects the upstream domain and its subdomains: %s', host => {
    for (const policy of ['feed', 'release', 'site'] as const) {
      expect(isUpstreamHost(host, policy)).toBe(true);
    }
  });

  it.each(['localhost', '127.0.0.1', '[::1]', 'downloads.example.test', 'openpixo.test'])
  ('allows independent and loopback hosts: %s', host => {
    for (const policy of ['feed', 'release', 'site'] as const) {
      expect(isUpstreamHost(host, policy)).toBe(false);
    }
  });

  it.each(['my-nexu.example.test', 'nexu.space.example.test', 'nexusexample.test'])
  ('preserves the broader release/site organization rejection: %s', host => {
    expect(isUpstreamHost(host)).toBe(false);
    expect(isUpstreamHost(host, 'release')).toBe(true);
    expect(isUpstreamHost(host, 'site')).toBe(true);
  });

  it.each(['not-open-design.ai', 'open-design.ai.example.test'])
  ('preserves the site-only domain substring filter: %s', host => {
    expect(isUpstreamHost(host)).toBe(false);
    expect(isUpstreamHost(host, 'release')).toBe(false);
    expect(isUpstreamHost(host, 'site')).toBe(true);
  });

  it('preserves release normalization of multiple trailing dots', () => {
    expect(isUpstreamHost('OPEN-DESIGN.AI..')).toBe(false);
    expect(isUpstreamHost('OPEN-DESIGN.AI..', 'release')).toBe(true);
    expect(isUpstreamHost('OPEN-DESIGN.AI..', 'site')).toBe(true);
  });

  it.each(['OpenDesign', 'open-design', 'NEXU', '/docs/opendesign/setup', 'https://example.test/nexu'])
  ('rejects decoded upstream link text: %s', text => {
    expect(mentionsUpstream(text)).toBe(true);
  });

  it('lets the site caller decode before checking and handles independent text', () => {
    expect(mentionsUpstream(decodeURIComponent('/%6f%70%65%6e-design'))).toBe(true);
    expect(mentionsUpstream('/docs/openpixo/setup')).toBe(false);
    expect(mentionsUpstream('')).toBe(false);
  });
});
