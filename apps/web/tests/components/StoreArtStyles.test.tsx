// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StoreItemDetail } from '@openpixo/contracts';
import { StoreView } from '../../src/components/store/StoreView';
import { I18nProvider } from '../../src/i18n';
import { navigate } from '../../src/router';

vi.mock('../../src/router', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/router')>(),
  navigate: vi.fn(),
}));

const generateExplanation = 'Art styles, recipes and character cards now live in your project’s Generate page.';
const projectRequired = 'Open or create a project to choose a style, run a recipe or create a character card.';

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

  it.each(['style', 'recipe', 'character-card'] as const)('redirects a %s item deep link to the latest project Generate tab', async (kind) => {
    const resource = item(kind);
    mockCatalog([resource]);

    render(<I18nProvider initial="en"><StoreView itemName={resource.name} projects={projects} /></I18nProvider>);

    expect(await screen.findByText(generateExplanation)).toBeTruthy();
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        kind: 'project',
        projectId: 'latest',
        fileName: null,
        workspaceTab: 'generate',
      }, { replace: true });
    });
    expect(screen.queryByRole('button', { name: /^Install$/i })).toBeNull();
  });

  it.each(['style', 'recipe', 'character-card'] as const)('redirects the old %s tab to Generate', async (kind) => {
    mockCatalog([item(kind)]);

    render(<I18nProvider initial="en"><StoreView initialTab={kind} projects={projects} /></I18nProvider>);

    expect(await screen.findByText(generateExplanation)).toBeTruthy();
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        kind: 'project',
        projectId: 'latest',
        fileName: null,
        workspaceTab: 'generate',
      }, { replace: true });
    });
  });

  it('explains the move and offers projects when there is no project to open', async () => {
    const resource = item('style');
    mockCatalog([resource]);

    render(<I18nProvider initial="en"><StoreView itemName={resource.name} projects={[]} /></I18nProvider>);

    expect(await screen.findByText(generateExplanation)).toBeTruthy();
    expect(screen.getByText(projectRequired)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Go to projects' }));

    expect(navigate).toHaveBeenCalledWith({ kind: 'home', view: 'projects' });
  });
});

describe('Workshop skill details', () => {
  it.each([
    { locale: 'en' as const, title: 'Battle HUD', prompt: 'Create a compact battle HUD.', action: 'Try in project' },
    { locale: 'zh-CN' as const, title: '战斗界面', prompt: '生成紧凑的战斗界面。', action: '在项目中试试' },
  ])('keeps examples and their project action localized in $locale', async ({ locale, title, prompt, action }) => {
    const resource = {
      ...item('skill', 'game-interface'),
      title: 'Game Interface Skill',
      examples: [{
        title: 'Battle HUD',
        prompt: 'Create a compact battle HUD.',
        title_i18n: { 'zh-CN': '战斗界面' },
        prompt_i18n: { 'zh-CN': '生成紧凑的战斗界面。' },
      }],
    } satisfies StoreItemDetail;
    mockCatalog([resource]);
    const onTryExample = vi.fn();

    render(<I18nProvider initial={locale}><StoreView itemName={resource.name} projects={[]} onTryExample={onTryExample} /></I18nProvider>);

    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByText(prompt)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: action }));

    expect(onTryExample).toHaveBeenCalledTimes(1);
    expect(onTryExample.mock.calls[0]?.[0]).toBe(prompt);
  });

  it('keeps skill installation and license details visible', async () => {
    const resource = item('skill', 'game-interface');
    mockCatalog([resource]);

    render(<I18nProvider initial="en"><StoreView itemName={resource.name} projects={[]} /></I18nProvider>);

    expect(await screen.findByRole('button', { name: /^Install$/i })).toBeTruthy();
    expect(screen.getAllByText(/1\.0\.0/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Apache-2\.0/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/commercial/i).length).toBeGreaterThan(0);
  });
});
