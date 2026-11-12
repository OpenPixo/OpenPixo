import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_WHATS_NEW_URL,
  createWhatsNewService,
  parseWhatsNewDocument,
  whatsNewSourceUrl,
} from '../src/services/whats-new.js';

const DOC = {
  id: '0.13.0',
  title: 'Design system sync',
  body: 'Import, edit and sync design systems.',
  imageUrl: 'https://downloads.example.com/0.13.0.png',
  linkUrl: 'https://openpixo.example.com/changelog',
  locales: { 'zh-CN': { title: '设计系统同步' } },
};

const UPSTREAM_URLS = [
  'https://whatsnew.open-design.ai/whats-new.json',
  'https://open-design.ai/whats-new.json',
  'https://s3.nexu.space/whats-new.json',
  'https://NEXU.SPACE/whats-new.json',
  'https://whatsnew.open-design.ai./whats-new.json',
];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('whatsNewSourceUrl', () => {
  it('has no hosted document by default on release channels', () => {
    expect(DEFAULT_WHATS_NEW_URL).toBeNull();
    expect(whatsNewSourceUrl({}, 'stable')).toBe(DEFAULT_WHATS_NEW_URL);
    expect(whatsNewSourceUrl({}, 'beta')).toBe(DEFAULT_WHATS_NEW_URL);
  });

  it('resolves to null on non-release channels (development/CI show no card)', () => {
    expect(whatsNewSourceUrl({}, 'development')).toBeNull();
    expect(whatsNewSourceUrl({}, '')).toBeNull();
  });

  it('honors PIXO_WHATS_NEW_URL for fixtures and tests regardless of channel', () => {
    expect(whatsNewSourceUrl({ PIXO_WHATS_NEW_URL: 'https://fixture.local/whats-new.json' }, 'development')).toBe(
      'https://fixture.local/whats-new.json',
    );
  });

  it('permits a loopback fixture URL', () => {
    const url = 'http://127.0.0.1:1234/whats-new.json';
    expect(whatsNewSourceUrl({ PIXO_WHATS_NEW_URL: url }, 'stable')).toBe(url);
  });

  it.each([
    'not a url',
    'https://user:secret@fixture.local/whats-new.json',
    'http://public.example.com/whats-new.json',
    ...UPSTREAM_URLS,
  ])('rejects an upstream or unsafe document source (%s)', (url) => {
    expect(whatsNewSourceUrl({ PIXO_WHATS_NEW_URL: url }, 'stable')).toBeNull();
  });
});

describe('parseWhatsNewDocument', () => {
  it('parses a well-formed document', () => {
    const { id, content } = parseWhatsNewDocument(DOC);
    expect(id).toBe('0.13.0');
    expect(content?.title).toBe('Design system sync');
    expect(content?.imageUrl).toBe(DOC.imageUrl);
    expect(content?.locales?.['zh-CN']?.title).toBe('设计系统同步');
  });

  it('preserves and trims configured CTA labels through the document parser', () => {
    const { content } = parseWhatsNewDocument({
      ...DOC,
      ctaLabel: ' View Arena ',
      locales: { 'zh-CN': { ctaLabel: ' 查看评测站 ' } },
    });
    expect(content).toMatchObject({
      ctaLabel: 'View Arena',
      locales: { 'zh-CN': { ctaLabel: '查看评测站' } },
    });
  });

  it.each(['', '   ', 42, null])('drops an invalid optional CTA label (%j) without hiding content', (ctaLabel) => {
    const { content } = parseWhatsNewDocument({
      ...DOC, ctaLabel, locales: { 'zh-CN': { title: '设计系统同步', ctaLabel } },
    });
    expect(content?.title).toBe(DOC.title);
    expect(content).not.toHaveProperty('ctaLabel');
    expect(content?.locales?.['zh-CN']).toEqual({ title: '设计系统同步' });
  });

  it('rejects a document without an id (no show-once key)', () => {
    const { id, content } = parseWhatsNewDocument({ ...DOC, id: '' });
    expect(id).toBeNull();
    expect(content).toBeNull();
  });

  it('drops malformed documents instead of propagating shape errors', () => {
    expect(parseWhatsNewDocument({ id: 'x', title: 'only-title' }).content).toBeNull();
    expect(parseWhatsNewDocument('not-an-object').content).toBeNull();
    expect(parseWhatsNewDocument(null).content).toBeNull();
  });

  it('strips non-HTTPS urls but keeps the copy', () => {
    const { content } = parseWhatsNewDocument({ ...DOC, imageUrl: 'http://insecure.example/x.png' });
    expect(content?.imageUrl).toBeUndefined();
    expect(content?.title).toBe('Design system sync');
  });

});

describe('createWhatsNewService', () => {
  it('caches the parsed result and reuses it within the TTL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(DOC));
    const service = createWhatsNewService({
      env: { PIXO_WHATS_NEW_URL: 'https://fixture.local/whats-new.json' },
      fetchImpl,
    });
    const first = await service.readWhatsNew('stable');
    const second = await service.readWhatsNew('stable');
    expect(first.id).toBe('0.13.0');
    expect(first.content?.title).toBe('Design system sync');
    expect(second.content?.title).toBe('Design system sync');
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith('https://fixture.local/whats-new.json', expect.any(Object));
  });

  it.each(['stable', 'beta', 'development', ''])('performs no fetch without an environment URL (%s)', async (channel) => {
    const fetchImpl = vi.fn(async () => jsonResponse(DOC));
    const service = createWhatsNewService({
      env: {},
      fetchImpl,
    });
    const result = await service.readWhatsNew(channel);
    expect(result.id).toBeNull();
    expect(result.content).toBeNull();
    expect(result.stale).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(UPSTREAM_URLS)('performs no fetch for an upstream environment URL (%s)', async (url) => {
    const fetchImpl = vi.fn(async () => jsonResponse(DOC));
    const service = createWhatsNewService({ env: { PIXO_WHATS_NEW_URL: url }, fetchImpl });
    expect(await service.readWhatsNew('stable')).toMatchObject({ id: null, content: null, stale: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resolves to null content instead of failing when the document is unreachable', async () => {
    const service = createWhatsNewService({
      env: { PIXO_WHATS_NEW_URL: 'https://fixture.local/whats-new.json' },
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    const result = await service.readWhatsNew('stable');
    expect(result.id).toBeNull();
    expect(result.content).toBeNull();
    expect(result.stale).toBe(true);
  });

  it('resolves to null content on a non-OK response', async () => {
    const service = createWhatsNewService({
      env: { PIXO_WHATS_NEW_URL: 'https://fixture.local/whats-new.json' },
      fetchImpl: async () => jsonResponse({ error: 'nope' }, 404),
    });
    const result = await service.readWhatsNew('stable');
    expect(result.content).toBeNull();
    expect(result.stale).toBe(true);
  });
});
