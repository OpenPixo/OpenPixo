// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PluginManifestSchema, type RecipeDetail, type RecipeRun, type RecipeSummary } from '@openpixo/contracts';
import { StudioPanel } from '../../src/components/studio/StudioPanel';
import { resetStudioCacheForTests } from '../../src/components/studio/studio-cache';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/components/studio/media-capabilities', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/components/studio/media-capabilities')>(),
  getStudioMediaCapabilities: vi.fn(async () => ({
    capabilities: { i2i: { configured: true, providers: ['test'] } },
  })),
}));

const reason = 'No configured image model supports i2i.';
function detail(id: string, title: string): RecipeDetail {
  return { id, title, description: 'A game asset recipe', version: '1.0.0', surface: 'image', category: 'character', engines: ['any'], requires: ['i2i'],
    manifest: PluginManifestSchema.parse({ specVersion: '1.0.0', name: `test/${id}`, title, version: '1.0.0', pixo: {
      kind: 'recipe', recipe: { surface: 'image', category: 'character', engines: ['any'],
        inputs: [{ name: 'prompt', label: 'Prompt', type: 'string', required: true },
          { name: 'reference', label: 'Reference', type: 'image-ref' },
          { name: 'character', label: 'Character', type: 'character-ref' },
          { name: 'aspect', label: 'Aspect', type: 'aspect', default: '1:1' },
          { name: 'variants', label: 'Variants', type: 'count', default: 2 }],
        prompt: '{{prompt}}', models: { requires: ['i2i'], recommended: ['image-model'] },
        generation: { count: { default: 2, max: 4 } }, output: { dir: 'art', name: 'fox' } },
    } }),
  };
}
const good = detail('good', 'Fox sprites');
const blocked = detail('blocked', 'Unavailable recipe');
const summaries = [good, blocked].map(({ manifest: _manifest, ...summary }) => summary);
const ready: RecipeRun = {
  id: 'run-1', projectId: 'game', recipeId: 'good', recipeVersion: '1.0.0', inputs: {}, model: { provider: 'test', id: 'image-model' },
  status: 'ready', createdAt: 1, updatedAt: 2, candidates: [
    { id: 'candidate-1', index: 0, stagedFiles: [{ role: 'primary', ref: 'C:/staging/1.png', mime: 'image/png' }], checks: [{ check: 'has-alpha', ok: true }] },
    { id: 'candidate-2', index: 1, stagedFiles: [{ role: 'primary', ref: 'C:/staging/2.png', mime: 'image/png' }], checks: [{ check: 'has-alpha', ok: false, detail: 'Opaque background' }] },
  ],
};
const characters = [{ slug: 'fox', name: 'Fox', description: 'An orange fox', references: ['art/ref.png'], style: 'pixel', notes: '' }];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(resetStudioCacheForTests);
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Studio', () => {
  it.each([
    ['en', 'Art', 'Audio'],
    ['zh-CN', '美术', '音频'],
  ] as const)('localizes the recipe groups (%s)', async (locale, art, audio) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/recipes') return json([
        { ...summaries[0], requires: ['t2i', 'i2i'] },
        { ...summaries[0], id: 'music', title: 'Loop', surface: 'audio', category: 'bgm', requires: ['music'] },
      ]);
      if (url.endsWith('/characters')) return json([]);
      throw new Error(url);
    }));
    render(<I18nProvider initial={locale}><StudioPanel projectId="game" files={[]}
      onRefreshFiles={vi.fn()} onOpenFile={vi.fn()} onOpenExtensions={vi.fn()} /></I18nProvider>);
    await screen.findByRole('button', { name: /Fox sprites/ });
    expect(screen.getByRole('button', { name: art }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: audio }));
    expect(screen.getByRole('button', { name: /Loop/ })).toBeTruthy();
  });

  it('uses manifest translations for recipe list names, descriptions and runner details', async () => {
    const localized = {
      ...good,
      title_i18n: { en: good.title, 'zh-CN': '循环背景音乐' },
      description_i18n: { en: good.description, 'zh-CN': '适合游戏场景的循环音乐。' },
      manifest: { ...good.manifest,
        title_i18n: { en: good.title, 'zh-CN': '循环背景音乐' },
        description_i18n: { en: good.description, 'zh-CN': '适合游戏场景的循环音乐。' } },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/recipes') return json([localized]);
      if (url === '/api/recipes/good') return json(localized);
      if (url.endsWith('/characters')) return json([]);
      throw new Error(url);
    }));
    render(<I18nProvider initial="zh-CN"><StudioPanel projectId="game" files={[]}
      onRefreshFiles={vi.fn()} onOpenFile={vi.fn()} onOpenExtensions={vi.fn()} /></I18nProvider>);
    const recipe = await screen.findByRole('button', { name: /循环背景音乐/ });
    expect(within(recipe).getByText('适合游戏场景的循环音乐。')).toBeTruthy();
    fireEvent.click(recipe);
    const runner = await screen.findByRole('region', { name: '循环背景音乐' });
    expect(within(runner).getByText('适合游戏场景的循环音乐。')).toBeTruthy();
  });

  it('keeps canonical English recipe copy when a manifest only supplies a Chinese translation', async () => {
    const localized = { ...good,
      title_i18n: { 'zh-CN': '循环背景音乐' }, description_i18n: { 'zh-CN': '适合游戏场景的循环音乐。' },
      manifest: { ...good.manifest,
        title_i18n: { 'zh-CN': '循环背景音乐' }, description_i18n: { 'zh-CN': '适合游戏场景的循环音乐。' } },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/recipes') return json([localized]);
      if (url === '/api/recipes/good') return json(localized);
      if (url.endsWith('/characters')) return json([]);
      throw new Error(url);
    }));
    render(<I18nProvider initial="en"><StudioPanel projectId="game" files={[]}
      onRefreshFiles={vi.fn()} onOpenFile={vi.fn()} onOpenExtensions={vi.fn()} /></I18nProvider>);
    const recipe = await screen.findByRole('button', { name: /Fox sprites/ });
    expect(within(recipe).getByText(good.description)).toBeTruthy();
    fireEvent.click(recipe);
    const runner = await screen.findByRole('region', { name: good.title });
    expect(within(runner).getByText(good.description)).toBeTruthy();
  });

  it('loads the gallery, shows backend model rejection, submits inputs, polls, and adopts only selected candidates', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/recipes') return json(summaries);
      if (url === '/api/projects/game/characters') return json(characters);
      if (url === '/api/recipes/good') return json(good);
      if (url === '/api/recipes/blocked') return json(blocked);
      if (url === '/api/projects/game/recipe-runs') {
        const body = JSON.parse(String(init?.body));
        return body.recipeId === 'blocked' ? json({ error: { code: 'RECIPE_NO_MODEL', message: reason } }, 409)
          : json({ ...ready, status: 'queued', candidates: [] }, 202);
      }
      if (url === '/api/projects/game/recipe-runs/run-1') return json(ready);
      if (url === '/api/projects/game/recipe-runs/run-1/adopt') return json({ ...ready,
        candidates: ready.candidates.map(candidate => candidate.id === 'candidate-2' ? { ...candidate, adoptedPaths: ['art/fox-2.png'] } : candidate) });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn(async () => {});
    const openFile = vi.fn();
    render(<I18nProvider initial="en"><StudioPanel projectId="game" files={[]}
      referencePaths={['art/ref.png']} onRefreshFiles={refresh} onOpenFile={openFile} onOpenExtensions={vi.fn()} /></I18nProvider>);

    fireEvent.click(await screen.findByRole('button', { name: /Unavailable recipe/ }));
    fireEvent.change(await screen.findByLabelText(/Prompt/), { target: { value: 'fox' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const blockedDetail = await screen.findByRole('region', { name: 'Unavailable recipe' });
    await within(blockedDetail).findByText(/No model can run this recipe yet/);
    expect(within(blockedDetail).queryByText(reason)).toBeNull();
    expect(within(blockedDetail).queryByRole('button', { name: 'Generate' })).toBeNull();
    expect(within(blockedDetail).getByRole('button', { name: 'Set up provider' })).toBeTruthy();

    fireEvent.click(within(blockedDetail).getByRole('button', { name: 'Back to recipes' }));
    expect(within(screen.getByRole('button', { name: /Unavailable recipe/ })).getByText('Needs a media tool')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Fox sprites/ }));
    fireEvent.change(await screen.findByLabelText(/Prompt/), { target: { value: 'A walking fox' } });
    fireEvent.change(screen.getByLabelText('Character'), { target: { value: 'fox' } });
    fireEvent.change(screen.getByLabelText('Variants'), { target: { value: '3' } });
    expect(screen.getByLabelText<HTMLSelectElement>('Reference').value).toBe('art/ref.png');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await screen.findByText(/has-alpha: Failed/);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/game/recipe-runs', expect.objectContaining({ method: 'POST', body: JSON.stringify({
      recipeId: 'good', inputs: { aspect: '1:1', variants: 3, reference: 'art/ref.png', prompt: 'A walking fox', character: 'fox' },
    }) }));
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/game/recipe-runs/run-1', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge Candidate 2' }));
    expect(screen.getByRole('dialog', { name: 'Candidate 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Candidate 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adopt selected' }));
    await screen.findByRole('button', { name: 'art/fox-2.png' });
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/game/recipe-runs/run-1/adopt', expect.objectContaining({ method: 'POST', body: '{"candidateIds":["candidate-2"]}' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'art/fox-2.png' }));
    expect(openFile).toHaveBeenCalledWith('art/fox-2.png');
    expect(screen.getByRole('button', { name: 'Generate again' })).toBeTruthy();
  });

  it('shows missing skills from a code recipe 409 with a route to project extensions', async () => {
    const code: RecipeDetail = { ...good, id: 'code', title: 'Save system', surface: 'code', category: 'feature', requires: [],
      manifest: PluginManifestSchema.parse({ specVersion: '1.0.0', name: 'test/code', version: '1.0.0',
        pixo: { kind: 'recipe', recipe: { surface: 'code', category: 'feature', inputs: [] }, useCase: { query: 'Add saves' } } }) };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/recipes') return json([code]);
      if (url === '/api/recipes/code') return json(code);
      if (url.endsWith('/characters')) return json([]);
      if (url.endsWith('/recipe-runs')) return json({ status: 'missing-skills', query: 'Add saves', missingSkills: ['godot-gdscript'] }, 409);
      throw new Error(url);
    }));
    const extensions = vi.fn();
    render(<I18nProvider initial="en"><StudioPanel projectId="game" files={[]} initialRecipeId="code"
      onRefreshFiles={vi.fn()} onOpenFile={vi.fn()} onOpenExtensions={extensions} /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    await screen.findByText('godot-gdscript');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Manage extensions' }));
    expect(extensions).toHaveBeenCalledOnce();
  });

  it('creates and edits a character without sending its slug in the update body', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/recipes') return json([] satisfies RecipeSummary[]);
      if (url.endsWith('/characters') && !init?.method) return json([]);
      if (init?.method === 'POST') return json(characters[0], 201);
      if (init?.method === 'PUT') return json({ ...characters[0], style: 'ink' });
      throw new Error(url);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<I18nProvider initial="en"><StudioPanel projectId="game" files={[]}
      onRefreshFiles={vi.fn()} onOpenFile={vi.fn()} onOpenExtensions={vi.fn()} /></I18nProvider>);
    await screen.findByText('No recipes for this project yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Character cards 0 saved', expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'New character' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Slug'), { target: { value: 'fox' } });
    fireEvent.change(dialog.getByLabelText('Name'), { target: { value: 'Fox' } });
    fireEvent.change(dialog.getByLabelText('Description'), { target: { value: 'An orange fox' } });
    fireEvent.change(dialog.getByLabelText(/Reference image paths/), { target: { value: 'art/ref.png' } });
    fireEvent.change(dialog.getByLabelText('Style'), { target: { value: 'pixel' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit character: Fox' }));
    const edit = within(screen.getByRole('dialog'));
    expect(edit.getByLabelText<HTMLInputElement>('Slug').disabled).toBe(true);
    fireEvent.change(edit.getByLabelText('Style'), { target: { value: 'ink' } });
    fireEvent.click(edit.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/game/characters', expect.objectContaining({ method: 'POST', body: JSON.stringify(characters[0]) }));
    const { slug: _slug, ...update } = { ...characters[0], style: 'ink' };
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/game/characters/fox', expect.objectContaining({ method: 'PUT', body: JSON.stringify(update) }));
  });
});
