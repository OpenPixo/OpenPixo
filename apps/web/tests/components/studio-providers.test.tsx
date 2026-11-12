// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PluginManifestSchema, type RecipeDetail } from '@openpixo/contracts';
import { StudioPanel } from '../../src/components/studio/StudioPanel';
import { resetStudioCacheForTests } from '../../src/components/studio/studio-cache';
import { I18nProvider } from '../../src/i18n';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

function recipe(id: string, title: string, surface: 'image' | 'audio' | 'code', requires: string[]): RecipeDetail {
  const category = surface === 'image' ? 'character' : surface === 'audio' ? 'bgm' : 'feature';
  return {
    id, title, description: `${title} recipe`, version: '1.0.0', surface, category, engines: ['any'], requires,
    manifest: PluginManifestSchema.parse({ specVersion: '1.0.0', name: `test/${id}`, version: '1.0.0',
      pixo: { kind: 'recipe', recipe: { surface, category, inputs: [],
        ...(surface === 'code' ? {} : { prompt: 'A game asset', models: { requires }, output: { dir: 'art', name: id } }),
      }, ...(surface === 'code' ? { useCase: { query: 'Add saves' } } : {}) },
    }),
  };
}

const image = recipe('image', 'Fox sprites', 'image', ['i2i']);
const audio = recipe('audio', 'Battle music', 'audio', ['music']);
const code = recipe('code', 'Save system', 'code', []);
const recipes = [image, audio, code];
const media = (imageConfigured = false, audioConfigured = false) => ({ capabilities: {
  i2i: { configured: imageConfigured, providers: imageConfigured ? ['image-provider'] : [] },
  music: { configured: audioConfigured, providers: audioConfigured ? ['audio-provider'] : [] },
} });
const banner = 'To run recipes, connect your own tool (Codex or an API key).';

function mockStudio(capabilities: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/media/capabilities') return capabilities();
    if (url === '/api/recipes') return json(recipes);
    const detail = recipes.find(entry => url === `/api/recipes/${entry.id}`);
    if (detail) return json(detail);
    if (url === '/api/projects/game/characters') return json([]);
    if (url === '/api/projects/game/recipe-runs') return json({ status: 'started', runId: 'code-run' }, 202);
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderStudio(initialRecipeId?: string, locale: 'en' | 'zh-CN' = 'en') {
  return render(<I18nProvider initial={locale}><StudioPanel projectId="game" files={[]} initialRecipeId={initialRecipeId}
    onRefreshFiles={vi.fn()} onOpenFile={vi.fn()} onOpenExtensions={vi.fn()} /></I18nProvider>);
}
const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back to recipes' }));

beforeEach(resetStudioCacheForTests);
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Studio media provider guidance', () => {
  it.each([
    ['en', banner, 'Set up providers', 'Needs an image tool'],
    ['zh-CN', '要运行配方，先连接你自己的工具（Codex 或 API key）。', '设置服务商', '需要图片工具'],
  ] as const)('shows localized setup guidance when no capability is configured (%s)', async (locale, text, setup, missing) => {
    mockStudio(() => json(media()));
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    renderStudio(undefined, locale);
    expect(await screen.findByText(text)).toBeTruthy();
    const row = await screen.findByRole('button', { name: /Fox sprites/ });
    expect(within(row).getByText(missing)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: setup }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'openpixo:open-media-settings' }));
  });

  it('blocks only the missing capability and replaces its runner submit with setup', async () => {
    const fetchMock = mockStudio(() => json(media(true, false)));
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    renderStudio();
    const imageRow = await screen.findByRole('button', { name: /Fox sprites/ });
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    const audioRow = await screen.findByRole('button', { name: /Battle music/ });
    await within(audioRow).findByText('Needs an audio tool');
    expect(within(imageRow).queryByText(/Needs an/)).toBeNull();
    expect(screen.queryByText(banner)).toBeNull();

    fireEvent.click(audioRow);
    const runner = await screen.findByRole('region', { name: audio.title });
    await within(runner).findByText(/recipes need your own audio tool/);
    expect(within(runner).queryByRole('button', { name: 'Generate' })).toBeNull();
    fireEvent.click(within(runner).getByRole('button', { name: 'Set up provider' }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'openpixo:open-media-settings' }));
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/projects/game/recipe-runs')).toBe(false);

    back();
    fireEvent.click(screen.getByRole('button', { name: 'Art' }));
    fireEvent.click(screen.getByRole('button', { name: /Fox sprites/ }));
    const readyRunner = await screen.findByRole('region', { name: image.title });
    await waitFor(() => expect(within(readyRunner).getByRole<HTMLButtonElement>('button', { name: 'Generate' }).disabled).toBe(false));
    expect(within(readyRunner).queryByRole('button', { name: 'Set up provider' })).toBeNull();
  });

  it.each([
    ['en', image.id, /your own image tool \(Codex or an API key\) and can't use credits/],
    ['zh-CN', image.id, '配方暂时要用你自己的图片工具（Codex 或 API key），还不能用积分。'],
    ['en', audio.id, /your own audio tool \(an API key\) and can't use credits/],
    ['zh-CN', audio.id, '配方暂时需要你自己的音频工具（API key），还不能用积分。'],
  ] as const)('says plainly that a recipe needs the user\'s own tool, and shows no credit price (%s %s)', async (locale, id, sentence) => {
    mockStudio(() => json(media()));
    renderStudio(id, locale);
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(screen.queryByText(/\d+ (credits?|积分)/)).toBeNull();
  });

  it('keeps code recipes runnable while capability configuration is still loading', async () => {
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { complete = resolve; });
    const fetchMock = mockStudio(() => pending);
    renderStudio(image.id);
    const runner = await screen.findByRole('region', { name: image.title });
    expect((await within(runner).findByRole<HTMLButtonElement>('button', { name: 'Generate' })).disabled).toBe(true);
    expect(screen.queryByText(banner)).toBeNull();
    expect(screen.queryByText('Needs an image tool')).toBeNull();

    back();
    fireEvent.click(await screen.findByRole('button', { name: 'Gameplay features' }));
    fireEvent.click(screen.getByRole('button', { name: /Save system/ }));
    const codeRunner = await screen.findByRole('region', { name: code.title });
    await waitFor(() => expect(within(codeRunner).getByRole<HTMLButtonElement>('button', { name: 'Generate' }).disabled).toBe(false));
    fireEvent.click(within(codeRunner).getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/projects/game/recipe-runs')).toBe(true));

    await act(async () => { complete(json(media())); });
    await screen.findByText(banner);
    expect(within(codeRunner).queryByRole('button', { name: 'Set up provider' })).toBeNull();
  });

  it('does not report unconfigured providers when checking configuration fails', async () => {
    mockStudio(() => json({ error: 'unavailable' }, 503));
    renderStudio(image.id);
    await screen.findByText(/Could not check media providers/);
    expect(screen.queryByText(banner)).toBeNull();
    expect(screen.queryByText('Needs an image tool')).toBeNull();
    const runner = await screen.findByRole('region', { name: image.title });
    expect((await within(runner).findByRole<HTMLButtonElement>('button', { name: 'Generate' })).disabled).toBe(true);
  });

  it('refreshes provider coverage after returning from settings', async () => {
    let configured = false;
    const fetchMock = mockStudio(() => json(media(configured, configured)));
    renderStudio(image.id);
    await screen.findByText(banner);
    configured = true;
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByText(banner)).toBeNull());
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/media/capabilities')).toHaveLength(2);
    const runner = await screen.findByRole('region', { name: image.title });
    await waitFor(() => expect(within(runner).getByRole<HTMLButtonElement>('button', { name: 'Generate' }).disabled).toBe(false));
  });
});
