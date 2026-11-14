// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { StoreItemDetail } from '@openpixo/contracts';
import { StoreView } from '../../src/components/store/StoreView';
import { I18nProvider } from '../../src/i18n';
import { navigate } from '../../src/router';

vi.mock('../../src/router', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/router')>(),
  navigate: vi.fn(),
}));


function item(kind: StoreItemDetail['kind'], name: string = kind): StoreItemDetail {
  return {
    name,
    title: name,
    description: 'A useful game development resource.',
    version: '1.0.0',
    kind,
    engines: ['any'],
    pricing: { type: 'free' },
    license: 'Apache-2.0',
    previews: [],
    requires: {},
    versions: ['1.0.0'],
    examples: [],
  };
}

function mockCatalog(items: StoreItemDetail[]) {
  const request = vi.fn(async (url: string) => {
    const route = new URL(url, 'http://localhost');
    if (route.pathname === '/api/store/catalog') {
      const kind = route.searchParams.get('kind');
      return Response.json({ items: kind ? items.filter((entry) => entry.kind === kind) : items });
    }
    if (route.pathname.startsWith('/api/store/items/')) {
      const name = decodeURIComponent(route.pathname.slice('/api/store/items/'.length));
      const entry = items.find((candidate) => candidate.name === name);
      return entry ? Response.json(entry) : Response.json({ error: 'Not found' }, { status: 404 });
    }
    return Response.json({});
  });
  vi.stubGlobal('fetch', request);
  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('moved Store content', () => {
  const projects = [
    { id: 'older', name: 'Older project', updatedAt: 100 },
    { id: 'latest', name: 'Latest project', updatedAt: 300 },
  ];

  it.each(['style', 'recipe', 'character-card'] as const)('sends a %s item deep link to 生成', async (kind) => {
    const resource = item(kind);
    mockCatalog([resource]);

    render(<I18nProvider initial="en"><StoreView itemName={resource.name} projects={projects} /></I18nProvider>);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ kind: 'home', view: 'generate' }, { replace: true }));
  });

  it.each(['style', 'recipe', 'character-card'] as const)('sends the old %s tab to 生成, with or without a game', async (kind) => {
    mockCatalog([item(kind)]);

    render(<I18nProvider initial="en"><StoreView initialTab={kind} projects={[]} /></I18nProvider>);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ kind: 'home', view: 'generate' }, { replace: true }));
  });
});
