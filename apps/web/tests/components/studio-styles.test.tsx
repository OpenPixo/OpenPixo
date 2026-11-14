// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PluginManifestSchema, type ArtStyle, type RecipeDetail, type RecipeRun } from '@openpixo/contracts';
import { RecipeRunner } from '../../src/components/studio/RecipeRunner';
import { StudioPanel } from '../../src/components/studio/StudioPanel';
import { resetStudioCacheForTests } from '../../src/components/studio/studio-cache';
import { I18nProvider } from '../../src/i18n';

const pixelStyle: ArtStyle = {
  id: 'pixel-16', title: '16-bit pixel', description: 'Crisp pixel sprites with a compact palette.',
  dimension: ['2d'], medium: ['pixel'], prompt: 'Crisp pixel art.', negativePrompt: 'Blurred edges.',
  palette: ['#182840', '#e9c46a'], previews: [], license: 'Apache-2.0',
};

function imageRecipe(): RecipeDetail {
  return {
    id: 'good', title: 'Fox sprites', description: 'A game asset recipe', version: '1.0.0',
    surface: 'image', category: 'character', engines: ['any'], requires: [],
    manifest: PluginManifestSchema.parse({
      specVersion: '1.0.0', name: 'test/good', title: 'Fox sprites', version: '1.0.0',
      pixo: { kind: 'recipe', recipe: {
        surface: 'image', category: 'character', engines: ['any'], inputs: [], prompt: 'fox',
        models: { requires: ['t2i'], recommended: ['image-model'] },
        generation: { count: { default: 1, max: 4 } }, output: { dir: 'art', name: 'fox' },
      } },
    }),
  };
}

function codeRecipe(): RecipeDetail {
  return {
    id: 'code', title: 'Save games', description: 'Add local saves', version: '1.0.0',
    surface: 'code', category: 'feature', engines: ['any'], requires: [],
    manifest: PluginManifestSchema.parse({
      specVersion: '1.0.0', name: 'test/code', version: '1.0.0',
      pixo: { kind: 'recipe', recipe: { surface: 'code', category: 'feature', inputs: [] },
        useCase: { query: 'Add saves' } },
    }),
  };
}

function readyRun(): RecipeRun {
  return {
    id: 'run-1', projectId: 'game', recipeId: 'good', recipeVersion: '1.0.0', inputs: {},
    model: { provider: 'test', id: 'image-model' }, status: 'ready', createdAt: 1, updatedAt: 2,
    candidates: [],
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

function mockStyleApi(initialStyle: ArtStyle | null = null) {
  let projectStyle = initialStyle;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/styles') return json({ styles: [pixelStyle] });
    if (url === '/api/recipes' || url === '/api/projects/game/characters') return json([]);
    if (url === '/api/media/capabilities') return json({ capabilities: { t2i: { configured: true, providers: ['test'] } } });
    if (url === '/api/projects/game/art-style') {
      if (init?.method === 'PUT') {
        const { styleId } = JSON.parse(String(init.body)) as { styleId: string | null };
        projectStyle = styleId === pixelStyle.id ? pixelStyle : null;
      }
      return json({ styleId: projectStyle?.id ?? null, style: projectStyle });
    }
    if (url === '/api/generate/runs' && init?.method === 'POST') return json(readyRun());
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Generate folds optional sections; open one by its summary (title, then current value). */
async function openSection(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title} `), expanded: false }));
}

function renderRecipe(detail = imageRecipe(), locale: 'en' | 'zh-CN' = 'en') {
  const onBrowseStyles = vi.fn();
  render(<I18nProvider initial={locale}><RecipeRunner
    projectId="game" detail={detail} files={[]} characters={[]} referencePaths={[]}
    onUnavailable={vi.fn()} onAdopted={vi.fn(async () => {})} onOpenFile={vi.fn()}
    onOpenExtensions={vi.fn()} onBrowseStyles={onBrowseStyles}
  /></I18nProvider>);
  return { onBrowseStyles };
}

beforeEach(resetStudioCacheForTests);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Studio art styles', () => {
  it.each([
    ['en', 'Art styles', 'Recipes', 'Characters', 'Art style', 'Character cards', 'Project style: 16-bit pixel'],
    ['zh-CN', '美术风格', '配方', '角色卡', '美术风格', '角色卡', '项目风格：16-bit pixel'],
  ] as const)('keeps recipes open and folds styles and characters under summaries (%s)', async (locale, styles, recipes, characters, stylesSummary, charactersSummary, current) => {
    mockStyleApi(pixelStyle);
    render(<I18nProvider initial={locale}><StudioPanel projectId="game" files={[]}
      onRefreshFiles={vi.fn(async () => {})} onOpenFile={vi.fn()} onOpenExtensions={vi.fn()} /></I18nProvider>);

    expect(await screen.findByRole('heading', { name: recipes })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: characters })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: `${stylesSummary} ${current}`, expanded: false })).toBeInTheDocument();
    await openSection(stylesSummary);
    await openSection(charactersSummary);
    expect(await screen.findByRole('heading', { name: styles })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: recipes })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: characters })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: pixelStyle.title })).toBeInTheDocument();
  });

  it('sets a gallery preset as the project style and marks the saved default', async () => {
    const fetchMock = mockStyleApi();
    render(<I18nProvider initial="en"><StudioPanel projectId="game" files={[]}
      onRefreshFiles={vi.fn(async () => {})} onOpenFile={vi.fn()} onOpenExtensions={vi.fn()} /></I18nProvider>);
    await openSection('Art style');
    const gallery = within(screen.getByRole('region', { name: 'Art styles' }));
    const setStyle = await gallery.findByRole('button', { name: 'Set as project style' });
    await waitFor(() => expect(setStyle).toBeEnabled());
    expect(gallery.queryByText('Project default')).not.toBeInTheDocument();
    fireEvent.click(setStyle);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/projects/game/art-style', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ styleId: pixelStyle.id }),
    })));
    expect(await gallery.findByRole('button', { name: 'Project default' })).toBeDisabled();
  });

  it('puts Project default first and sends an explicitly selected style with an image run', async () => {
    const fetchMock = mockStyleApi();
    const { onBrowseStyles } = renderRecipe();
    await openSection('Style');
    const style = await screen.findByRole('button', { name: '16-bit pixel' });
    const choices = screen.getByRole('group', { name: 'Style' });
    expect(within(choices).getAllByRole('button')[0]).toHaveTextContent('Project default');
    expect(within(choices).getByRole('button', { name: /Project default/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(style);
    expect(style).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Browse styles' }));
    expect(onBrowseStyles).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/generate/runs', expect.objectContaining({ method: 'POST' })));
    const request = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/api/generate/runs') && init?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ styleId: pixelStyle.id });
  });

  it('omits styleId when Project default is selected so the daemon resolves the current project style', async () => {
    const fetchMock = mockStyleApi(pixelStyle);
    renderRecipe();
    // Folded by default, and its summary already names what applies.
    expect(await screen.findByRole('button', { name: 'Style Project default · 16-bit pixel', expanded: false })).toBeInTheDocument();
    await openSection('Style');
    await screen.findByRole('button', { name: '16-bit pixel' });
    expect(screen.getByRole('button', { name: /^Project default/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/generate/runs', expect.objectContaining({ method: 'POST' })));
    const request = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/api/generate/runs') && init?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body))).not.toHaveProperty('styleId');
  });

  it('does not load or show art styles for code recipes', async () => {
    const fetchMock = mockStyleApi();
    renderRecipe(codeRecipe());
    await act(async () => {});
    expect(screen.queryByRole('group', { name: 'Style' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Browse styles' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends an explicit null style when No style overrides the project default', async () => {
    const fetchMock = mockStyleApi(pixelStyle);
    renderRecipe();
    await openSection('Style');
    const noStyle = await screen.findByRole('button', { name: 'No style' });
    await waitFor(() => expect(noStyle).toBeEnabled());
    fireEvent.click(noStyle);
    expect(noStyle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/generate/runs', expect.objectContaining({ method: 'POST' })));
    const request = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/api/generate/runs') && init?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body))).toHaveProperty('styleId', null);
  });

  it('localizes the picker and requests localized style data', async () => {
    const fetchMock = mockStyleApi();
    renderRecipe(imageRecipe(), 'zh-CN');
    await openSection('风格');
    await screen.findByRole('button', { name: '16-bit pixel' });
    const choices = screen.getByRole('group', { name: '风格' });
    expect(within(choices).getAllByRole('button')[0]).toHaveTextContent('项目默认');
    expect(screen.getByRole('button', { name: '浏览美术风格' })).toBeInTheDocument();
    const styleRequest = fetchMock.mock.calls.find(([url]) => String(url) === '/api/styles');
    expect(new Headers(styleRequest?.[1]?.headers).get('Accept-Language')).toBe('zh-CN');
  });

});
