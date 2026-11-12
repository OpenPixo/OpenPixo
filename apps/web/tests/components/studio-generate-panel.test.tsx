// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManifestSchema, type RecipeDetail } from '@openpixo/contracts';
import { I18nProvider } from '../../src/i18n';
import { StudioPanel } from '../../src/components/studio/StudioPanel';
import { LibraryView } from '../../src/components/panel/LibraryView';
import { resetStudioCacheForTests } from '../../src/components/studio/studio-cache';
import { resetOpenPixoAccountStoreForTests } from '../../src/hooks/useOpenPixoAccount';

const turnaround: RecipeDetail = {
  id: 'turnaround', title: 'Character turnaround', description: 'Front, side and back.', version: '1.0.0', surface: 'image',
  category: 'character', engines: ['any'], requires: ['t2i'], verified: true,
  manifest: PluginManifestSchema.parse({ specVersion: '1.0.0', name: 'test/turnaround', title: 'Character turnaround', version: '1.0.0', pixo: {
    kind: 'recipe', recipe: { surface: 'image', category: 'character', engines: ['any'],
      inputs: [{ name: 'character', label: 'Character', type: 'character-ref', required: true }],
      prompt: '{{character}}', models: { requires: ['t2i'] }, generation: { count: { default: 1, max: 2 } }, output: { dir: 'art', name: 'turn' } },
  } }),
};
const { manifest: _manifest, ...summary } = turnaround;
const otherSummary = { ...summary, id: 'sprite-sheet', title: 'Sprite sheet', description: 'A row of frames.' };
const other: RecipeDetail = { ...turnaround, ...otherSummary };
let mediaCalls = 0;
let engineStatus = 400;
let capabilities: () => Response | Promise<Response>;
let recipeList: () => Response | Promise<Response>;

beforeEach(() => {
  resetStudioCacheForTests();
  mediaCalls = 0;
  engineStatus = 400;
  capabilities = () => Response.json({ capabilities: { t2i: { configured: true, providers: ['codex'] } } });
  recipeList = () => Response.json([summary, otherSummary]);
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/recipes') return recipeList();
    if (url.pathname === '/api/recipes/turnaround') return Response.json(turnaround);
    if (url.pathname === '/api/recipes/sprite-sheet') return Response.json(other);
    if (url.pathname.endsWith('/characters')) return Response.json([]);
    if (url.pathname === '/api/media/capabilities') {
      mediaCalls += 1;
      return capabilities();
    }
    if (url.pathname === '/api/styles') return Response.json({ styles: [] });
    if (url.pathname.endsWith('/art-style')) return Response.json({ styleId: null, style: null });
    // Managed projects have no engine folder; the daemon answers 400.
    if (url.pathname.endsWith('/engine')) return Response.json({ error: { code: 'BAD_REQUEST' } }, { status: engineStatus });
    if (url.pathname.endsWith('/assets')) return Response.json({ assets: [], nextCursor: null });
    if (url.pathname === '/api/projects/game') return Response.json({ project: { metadata: {} } });
    return Response.json({}, { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetOpenPixoAccountStoreForTests(); });

function show(referencePaths: string[] = [], initialRecipeId?: string) {
  return render(<I18nProvider initial="en"><StudioPanel projectId="game" files={[]} referencePaths={referencePaths} initialRecipeId={initialRecipeId}
    onOpenFile={vi.fn()} onRefreshFiles={vi.fn()} onOpenExtensions={vi.fn()} /></I18nProvider>);
}
const noProviderBanner = /To run recipes, connect your own tool/;

describe('Generate panel', () => {
  it('treats a project without an engine folder as "no engine", not a failed check', async () => {
    show();
    await screen.findByRole('button', { name: /Character turnaround/ });
    expect(screen.queryByText(/project engine could not be checked/)).toBeNull();
    // Every recipe is already listed, so the toggle would do nothing.
    expect(screen.queryByRole('checkbox', { name: 'Show other engines' })).toBeNull();
  });

  it('still reports a real engine check failure', async () => {
    engineStatus = 500;
    show();
    expect(await screen.findByText(/project engine could not be checked/)).toBeInTheDocument();
  });

  it('drops the duplicate title, the intro and the Refresh button', async () => {
    show();
    await screen.findByRole('button', { name: /Character turnaround/ });
    expect(screen.queryByRole('heading', { name: 'Generate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('keeps the last provider answer on screen while a focus refresh is pending', async () => {
    show();
    await screen.findByRole('button', { name: /Character turnaround/ });
    await waitFor(() => expect(mediaCalls).toBe(1));
    capabilities = () => new Promise<Response>(() => {});
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(mediaCalls).toBe(2));
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByText(noProviderBanner)).toBeNull();
  });

  it('says which references came along from "Generate from this"', async () => {
    show(['art/hero.png', 'art/tiles.png']);
    expect(await screen.findByText('References ready: hero.png, tiles.png. Pick a recipe that takes an image.')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Character turnaround/ }));
    await screen.findByRole('region', { name: 'Character turnaround' });
    expect(screen.queryByText(/References ready/)).toBeNull();
  });

  it('offers New character right at a character field when the project has none', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Character turnaround/ }));
    const runner = await screen.findByRole('region', { name: 'Character turnaround' });
    const field = await screen.findByLabelText(/Character/, { selector: 'select' });
    expect(field).toBeDisabled();
    expect(field).toHaveDisplayValue('Add a character to reuse its description and references.');
    fireEvent.click(within(runner).getByRole('button', { name: 'New character' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('Generate panel first paint', () => {
  it('renders recipes synchronously on a second mount, with no loading state', async () => {
    const first = show();
    await screen.findByRole('button', { name: /Character turnaround/ });
    await waitFor(() => expect(mediaCalls).toBe(1));
    first.unmount();

    show();
    expect(screen.getByRole('button', { name: /Character turnaround/ })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('refreshes behind what it shows, and a failed refresh keeps it', async () => {
    const first = show();
    await screen.findByRole('button', { name: /Character turnaround/ });
    await waitFor(() => expect(mediaCalls).toBe(1));
    first.unmount();

    recipeList = () => Response.json({ error: { message: 'nope' } }, { status: 500 });
    capabilities = () => Response.json({}, { status: 503 });
    show();
    await waitFor(() => expect(mediaCalls).toBe(2));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(screen.getByRole('button', { name: /Character turnaround/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows no provider banner or row hint while capabilities are unknown', async () => {
    capabilities = () => new Promise<Response>(() => {});
    show();
    const row = await screen.findByRole('button', { name: /Character turnaround/ });
    expect(within(row).queryByText(/Needs an/)).toBeNull();
    expect(screen.queryByText(noProviderBanner)).toBeNull();
    expect(screen.queryByText(/Could not check/)).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('shows the banner and the hint once capabilities are known and none is configured', async () => {
    capabilities = () => Response.json({ capabilities: { t2i: { configured: false, providers: [] } } });
    show();
    expect(await screen.findByText(noProviderBanner)).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /Character turnaround/ });
    expect(within(row).getByText('Needs an image tool')).toBeInTheDocument();
    // One banner for the section, never one per row.
    expect(screen.getAllByText(noProviderBanner)).toHaveLength(1);
  });

  it('only says Loading when a read with nothing cached is actually slow', async () => {
    recipeList = () => new Promise<Response>(() => {});
    show();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Recipes' })).toBeInTheDocument();
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
  });

  it('offers a retry when the recipe list cannot be read at all', async () => {
    recipeList = () => Response.json({ error: { message: 'nope' } }, { status: 500 });
    show();
    const alert = await screen.findByRole('alert');
    recipeList = () => Response.json([summary]);
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /Character turnaround/ })).toBeInTheDocument();
  });

  it('reads ahead when the project opens, so the first open of the sheet paints at once', async () => {
    const fetchMock = vi.mocked(fetch);
    render(<I18nProvider initial="en"><LibraryView projectId="game" files={[]} hidden active typeFilterRequest={null}
      renderBrowser={() => null} studio={{ open: false, initialRecipeId: null, referencePaths: [] }}
      onOpenStudio={vi.fn()} onCloseStudio={vi.fn()} onOpenFile={vi.fn()} onRefreshFiles={vi.fn()} onOpenExtensions={vi.fn()} /></I18nProvider>);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/recipes')).toBe(false);
    await waitFor(() => expect(mediaCalls).toBe(1));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/assets') || String(url).includes('/assets?'))).toBe(true));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    cleanup();

    show();
    expect(screen.getByRole('button', { name: /Character turnaround/ })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('stays silent when the read-ahead fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const { container } = render(<I18nProvider initial="en"><LibraryView projectId="game" files={[]} hidden={false} active typeFilterRequest={null}
      renderBrowser={() => <div data-testid="browser" />} studio={{ open: false, initialRecipeId: null, referencePaths: [] }}
      onOpenStudio={vi.fn()} onCloseStudio={vi.fn()} onOpenFile={vi.fn()} onRefreshFiles={vi.fn()} onOpenExtensions={vi.fn()} /></I18nProvider>);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(screen.getByTestId('browser')).toBeInTheDocument();
    expect(container.textContent).toBe('');
  });
});

describe('Recipe detail view', () => {
  it('replaces the list in place, moves focus to the heading and back to the row', async () => {
    show();
    const row = await screen.findByRole('button', { name: /Sprite sheet/ });
    fireEvent.click(row);
    const detail = await screen.findByRole('region', { name: 'Sprite sheet' });
    const heading = within(detail).getByRole('heading', { name: 'Sprite sheet' });
    expect(document.activeElement).toBe(heading);
    expect(within(detail).getByText('A row of frames.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Character turnaround/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Recipes' })).toBeNull();

    fireEvent.click(within(detail).getByRole('button', { name: 'Back to recipes' }));
    const restored = screen.getByRole('button', { name: /Sprite sheet/ });
    expect(document.activeElement).toBe(restored);
    expect(screen.queryByRole('region', { name: 'Sprite sheet' })).toBeNull();
  });

  it('keeps a filled form when the user goes back and returns to the same recipe', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Sprite sheet/ }));
    const count = await screen.findByLabelText<HTMLInputElement>('Candidates');
    fireEvent.change(count, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to recipes' }));
    fireEvent.click(screen.getByRole('button', { name: /Sprite sheet/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Candidates').value).toBe('2');
  });

  it('opens straight into the detail view from a deep link', async () => {
    show([], 'turnaround');
    const detail = await screen.findByRole('region', { name: 'Character turnaround' });
    expect(document.activeElement).toBe(within(detail).getByRole('heading', { name: 'Character turnaround' }));
    expect(screen.queryByRole('button', { name: /Sprite sheet/ })).toBeNull();
    fireEvent.click(within(detail).getByRole('button', { name: 'Back to recipes' }));
    expect(await screen.findByRole('button', { name: /Sprite sheet/ })).toBeInTheDocument();
  });

  it('keeps the art style section reachable while a detail is open', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Sprite sheet/ }));
    const detail = await screen.findByRole('region', { name: 'Sprite sheet' });
    fireEvent.click(await within(detail).findByRole('button', { name: /^Style / }));
    const browse = await within(detail).findByRole('button', { name: 'Browse styles' });
    fireEvent.click(browse);
    expect(await screen.findByRole('button', { name: /^Art style/, expanded: true })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sprite sheet' })).toBeInTheDocument();
  });
});
