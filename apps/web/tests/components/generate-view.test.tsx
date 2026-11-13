// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeRun } from '@openpixo/contracts';
import { I18nProvider } from '../../src/i18n';
import { GenerateView } from '../../src/components/generate/GenerateView';
import { resetStudioCacheForTests } from '../../src/components/studio/studio-cache';
import { resetOpenPixoAccountStoreForTests } from '../../src/hooks/useOpenPixoAccount';

vi.mock('../../src/components/studio/StudioPanel', () => ({ StudioPanel: () => <div>Presets list</div> }));
vi.mock('../../src/components/Model3dViewer', () => ({ Model3dViewer: () => <div>3D viewer</div> }));

const pricing = { longPromptTokens: 2000, longPromptCredits: 1, maxPromptTokens: 3000, extraReferenceCredits: 1 };
const imageService = { id: 'openpixo-image', surface: 'image', label: 'Image', credits: 4, priceVersion: 2, maxPromptChars: 12000,
  aspects: ['1:1'], styles: [], references: { min: 0, max: 0 }, pricing };
const QUOTE_ID = '0b7c1f9e-6a3d-4a8e-9f1b-2c3d4e5f6a7b';

function readyRun(overrides: Partial<RecipeRun> = {}): RecipeRun {
  return { id: 'run-1', projectId: 'p1', recipeId: 'image', recipeVersion: '0.1.0', surface: 'image', origin: 'user',
    inputs: { prompt: 'a slime', aspect: '1:1', transparent: false, name: 'a_slime' }, model: { provider: 'openpixo', id: 'openpixo-image' },
    status: 'ready', candidates: [{ id: 'c1', index: 0, stagedFiles: [{ role: 'primary', ref: 'C:/data/recipe-runs/run-1/c1/primary.png', mime: 'image/png' }], checks: [] }],
    createdAt: 1_000, updatedAt: 1_000, ...overrides };
}

interface Api {
  capabilities: Record<string, { configured: boolean; providers: string[] }>;
  signedIn: boolean;
  paused: boolean;
  runs: RecipeRun[];
  quote: () => Response;
  started: Array<Record<string, unknown>>;
  adopted: Array<Record<string, unknown>>;
}
let api: Api;

beforeEach(() => {
  resetStudioCacheForTests();
  api = { capabilities: {}, signedIn: true, paused: false, runs: [], started: [], adopted: [],
    quote: () => Response.json({ paid: false, model: { provider: 'openai', id: 'gpt-image-1' }, count: 2 }) };
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    switch (url.pathname) {
      case '/api/openpixo/account': return Response.json({ availability: 'available', signedIn: api.signedIn,
        user: api.signedIn ? { id: 'u1', email: 'dev@example.com', provider: 'email', displayName: 'Dev', avatarUrl: null } : null });
      case '/api/openpixo/credits': return Response.json({ available: 40, reserved: 0, subscription: null });
      case '/api/openpixo/cloud-media/services': return Response.json({ services: [imageService], generationPaused: api.paused });
      case '/api/media/capabilities': return Response.json({ capabilities: api.capabilities });
      case '/api/recipes': return Response.json([{ id: 'image', title: 'Image', description: '', version: '0.1.0', surface: 'image', category: 'plain', engines: ['any'], requires: [] }]);
      case '/api/projects/p1/recipe-runs/quote': return api.quote();
      case '/api/projects/p1/recipe-runs':
        if (init?.method === 'POST') {
          api.started.push(body!);
          const run = readyRun({ id: `run-${api.started.length + 1}`, createdAt: 2_000 + api.started.length, status: 'generating', candidates: [] });
          api.runs = [run, ...api.runs];
          return Response.json(run, { status: 202 });
        }
        return Response.json({ runs: api.runs });
      case '/api/projects/p1/recipe-runs/run-1/adopt': {
        api.adopted.push(body!);
        const run = readyRun();
        run.candidates[0]!.adoptedPaths = ['assets/images/a_slime.png'];
        api.runs = [run];
        return Response.json(run);
      }
      default: return Response.json({}, { status: 404 });
    }
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); resetOpenPixoAccountStoreForTests(); });

function show(props: Partial<Parameters<typeof GenerateView>[0]> = {}) {
  const onRefreshFiles = vi.fn(async () => {});
  render(<I18nProvider initial="en"><GenerateView projectId="p1" files={[{ name: 'art/hero.png' } as never]} hidden={false} active
    initialRecipeId={null} referencePaths={[]} referenceRequest={0} onOpenFile={vi.fn()} onRefreshFiles={onRefreshFiles}
    onOpenExtensions={vi.fn()} onOpenAccount={vi.fn()} {...props} /></I18nProvider>);
  return { onRefreshFiles };
}
const box = () => within(screen.getByTestId('generate-box'));
async function describeAndGenerate(text = 'a green slime') {
  fireEvent.change(box().getByTestId('generate-text'), { target: { value: text } });
  await act(async () => { fireEvent.click(box().getByTestId('generate-submit')); });
}

describe('生成', () => {
  it('runs with an own tool at once, without a price', async () => {
    api.capabilities = { t2i: { configured: true, providers: ['openai'] } };
    show();
    await waitFor(() => expect(box().getByTestId('generate-estimate').textContent).toBe('Made with your own tool, no credits'));
    await describeAndGenerate();
    await waitFor(() => expect(api.started).toHaveLength(1));
    expect(api.started[0]).toMatchObject({ recipeId: 'image', count: 2, inputs: { prompt: 'a green slime', name: 'a_green_slime' } });
    expect(api.started[0]).not.toHaveProperty('quoteId');
  });

  it('spends a price at or below the button\'s number in the same click', async () => {
    api.quote = () => Response.json({ paid: true, quoteId: QUOTE_ID, model: { provider: 'openpixo', id: 'openpixo-image' }, count: 2,
      credits: 8, available: 40, candidates: [{ credits: 4 }, { credits: 4 }], expiresAt: '2030-01-01T00:00:00.000Z', warnings: [] });
    show();
    await waitFor(() => expect(box().getByTestId('generate-estimate').textContent).toBe('About 8 credits'));
    await describeAndGenerate();
    await waitFor(() => expect(api.started).toHaveLength(1));
    expect(api.started[0]).toMatchObject({ recipeId: 'image', count: 2, quoteId: QUOTE_ID });
  });

  it('never spends more than the button showed: a higher price stops and asks', async () => {
    api.quote = () => Response.json({ paid: true, quoteId: QUOTE_ID, model: { provider: 'openpixo', id: 'openpixo-image' }, count: 2,
      credits: 10, available: 40, candidates: [{ credits: 5 }, { credits: 5 }], expiresAt: '2030-01-01T00:00:00.000Z', warnings: [] });
    show();
    await waitFor(() => expect(box().getByTestId('generate-estimate').textContent).toBe('About 8 credits'));
    await describeAndGenerate();
    expect(await box().findByText('This one costs 10 credits.')).toBeTruthy();
    expect(api.started).toHaveLength(0);
    await act(async () => { fireEvent.click(box().getByTestId('generate-confirm')); });
    await waitFor(() => expect(api.started).toHaveLength(1));
    expect(api.started[0]).toMatchObject({ quoteId: QUOTE_ID });
  });

  it('stops on a short balance and offers credits', async () => {
    api.quote = () => Response.json({ paid: true, quoteId: QUOTE_ID, model: { provider: 'openpixo', id: 'openpixo-image' }, count: 2,
      credits: 8, available: 3, candidates: [{ credits: 4 }, { credits: 4 }], expiresAt: '2030-01-01T00:00:00.000Z', warnings: [] });
    show();
    await describeAndGenerate();
    expect(await box().findByText("You don't have enough credits for this.")).toBeTruthy();
    expect(box().getByRole('button', { name: 'Get credits' })).toBeTruthy();
    expect(api.started).toHaveLength(0);
  });

  it('says how to get a tool when nothing can make it', async () => {
    api.quote = () => Response.json({ error: { code: 'RECIPE_NO_MODEL', message: 'No usable model' } }, { status: 409 });
    show();
    await describeAndGenerate();
    expect(await box().findByText('Nothing set up can make this yet.')).toBeTruthy();
    expect(box().getByRole('button', { name: 'Set up tools' })).toBeTruthy();
  });

  it('notices when cloud generation opens again', async () => {
    api.paused = true;
    show();
    expect(await box().findByText(/Cloud generation is paused/)).toBeTruthy();
    api.paused = false;
    await act(async () => { fireEvent(window, new Event('focus')); });
    await waitFor(() => expect(box().queryByText(/Cloud generation is paused/)).toBeNull());
  });

  it('lists the agent\'s results with the user\'s, and saves one into the game from its detail', async () => {
    api.runs = [readyRun({ origin: 'agent' })];
    const { onRefreshFiles } = show();
    const tile = await screen.findByTestId('generate-tile');
    expect(within(screen.getByTestId('generate-run')).getByText('AI')).toBeTruthy();
    fireEvent.click(tile);
    const detail = within(await screen.findByTestId('generate-detail'));
    expect(detail.getByTestId('generate-download').getAttribute('href')).toBe('/api/projects/p1/recipe-runs/run-1/candidates/c1/files/0');
    await act(async () => { fireEvent.click(detail.getByTestId('generate-save')); });
    await waitFor(() => expect(api.adopted).toEqual([{ candidateIds: ['c1'] }]));
    expect(onRefreshFiles).toHaveBeenCalled();
    expect(await detail.findByRole('button', { name: 'assets/images/a_slime.png' })).toBeTruthy();
    fireEvent.click(detail.getByRole('button', { name: /Results/ }));
    expect(await screen.findByTestId('generate-box')).toBeTruthy();
  });

  it('puts a result\'s request back in the box with 改一下', async () => {
    api.runs = [readyRun({ recipeId: 'sound-effect', surface: 'audio', inputs: { prompt: 'coin pickup', duration: 2, name: 'coin_pickup' },
      candidates: [{ id: 'c1', index: 0, stagedFiles: [{ role: 'primary', ref: 'C:/x/primary.mp3', mime: 'audio/mpeg' }], checks: [] }] })];
    show();
    fireEvent.click(await screen.findByTestId('generate-tile'));
    fireEvent.click(await screen.findByTestId('generate-edit'));
    expect((box().getByTestId('generate-text') as HTMLTextAreaElement).value).toBe('coin pickup');
    expect(box().getByRole('tab', { name: 'Sound effect', selected: true })).toBeTruthy();
  });

  it('takes "generate from" pictures as references', async () => {
    show({ referencePaths: ['art/hero.png'], referenceRequest: 1 });
    expect((await box().findByRole('checkbox', { name: /art\/hero\.png/ }) as HTMLInputElement).checked).toBe(true);
  });
});
