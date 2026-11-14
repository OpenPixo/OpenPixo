// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeRun } from '@openpixo/contracts';
import { I18nProvider } from '../../src/i18n';
import { GenerateView, type GenerateSection } from '../../src/components/generate/GenerateView';
import { resetStudioCacheForTests } from '../../src/components/studio/studio-cache';
import { resetOpenPixoAccountStoreForTests } from '../../src/hooks/useOpenPixoAccount';

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
  quoted: Array<Record<string, unknown>>;
  adopted: Array<Record<string, unknown>>;
  recipes: Array<Record<string, unknown>>;
  details: Record<string, Record<string, unknown>>;
  services?: Array<Record<string, unknown>>;
}
let api: Api;

beforeEach(() => {
  resetStudioCacheForTests();
  api = { capabilities: {}, signedIn: true, paused: false, runs: [], started: [], quoted: [], adopted: [], details: {},
    recipes: [{ id: 'image', title: 'Image', description: '', version: '0.1.0', surface: 'image', category: 'plain', engines: ['any'], requires: [] }],
    quote: () => Response.json({ paid: false, model: { provider: 'openai', id: 'gpt-image-1' }, count: 2 }) };
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    switch (url.pathname) {
      case '/api/openpixo/account': return Response.json({ availability: 'available', signedIn: api.signedIn,
        user: api.signedIn ? { id: 'u1', email: 'dev@example.com', provider: 'email', displayName: 'Dev', avatarUrl: null } : null });
      case '/api/openpixo/credits': return Response.json({ available: 40, reserved: 0, subscription: null });
      case '/api/openpixo/cloud-media/services': return Response.json({ services: api.services ?? [imageService], generationPaused: api.paused });
      case '/api/media/capabilities': return Response.json({ capabilities: api.capabilities });
      case '/api/recipes': return Response.json(api.recipes);
      case '/api/styles': return Response.json({ styles: [{ id: 'pixel', title: 'Pixel', description: '', previews: ['/api/styles/pixel/previews/0'], palette: [] }] });
      case '/api/generate/quote': api.quoted.push(body!); return api.quote();
      case '/api/generate/references': return Response.json({ ref: 'references/abc.png', mime: 'image/png', size: 4 });
      case '/api/generate/runs':
        if (init?.method === 'POST') {
          api.started.push(body!);
          const run = readyRun({ id: `run-${api.started.length + 1}`, createdAt: 2_000 + api.started.length, status: 'generating', candidates: [] });
          api.runs = [run, ...api.runs];
          return Response.json(run, { status: 202 });
        }
        return Response.json({ runs: api.runs });
      case '/api/generate/runs/run-1/adopt': {
        api.adopted.push(body!);
        const run = readyRun();
        run.candidates[0]!.adoptedPaths = ['assets/images/a_slime.png'];
        api.runs = [run];
        return Response.json(run);
      }
      default:
        if (url.pathname.startsWith('/api/recipes/')) {
          const detail = api.details[decodeURIComponent(url.pathname.slice('/api/recipes/'.length))];
          return detail ? Response.json(detail) : Response.json({}, { status: 404 });
        }
        return Response.json({}, { status: 404 });
    }
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); resetOpenPixoAccountStoreForTests(); });

const GAMES = [{ id: 'p1', name: 'Slime Game' }, { id: 'p2', name: 'Space Game' }];
type ViewProps = Parameters<typeof GenerateView>[0];
/** The page holds which part is shown; here a little state stands in for it. */
function Harness(props: Omit<ViewProps, 'section' | 'onSection'> & { start?: GenerateSection }) {
  const [section, setSection] = useState<GenerateSection>(props.start ?? 'create');
  return <GenerateView {...props} section={section} onSection={setSection} />;
}
function show(props: Partial<Omit<ViewProps, 'section' | 'onSection'>> & { start?: GenerateSection } = {}) {
  const onFilesChanged = vi.fn(async () => {});
  render(<I18nProvider initial="en"><Harness projectId="p1" files={[{ name: 'art/hero.png' } as never]} games={GAMES}
    initialRecipeId={null} referencePaths={[]} referenceRequest={0} onOpenFile={vi.fn()} onFilesChanged={onFilesChanged}
    onOpenExtensions={vi.fn()} onOpenAccount={vi.fn()} {...props} /></I18nProvider>);
  return { onFilesChanged };
}
const box = () => within(screen.getByTestId('generate-box'));
const library = () => within(screen.getByTestId('generate-library'));
const section = () => screen.getByTestId('generate-view').dataset.section;
/** A preset's catalogue entry and its detail, the way the daemon serves them. */
function iconSet(overrides: Record<string, unknown> = {}) {
  const summary = { id: 'item-icon-set', title: 'Item icon set', description: 'Matching icons on one sheet', version: '0.1.0', surface: 'image', category: 'items',
    engines: ['any'], requires: ['t2i'], examples: [{ title: 'Potions', prompt: 'potions', after: 'examples/potions.webp' }], ...overrides };
  api.details['item-icon-set'] = { ...summary, manifest: { name: 'openpixo/item-icon-set', title: 'Item icon set', version: '0.1.0', pixo: { kind: 'recipe', recipe: {
    surface: 'image', engines: ['any'], generation: { count: { default: 1, max: 2 } },
    inputs: [
      { name: 'items', label: 'Items', type: 'text', required: true, placeholder: 'sword, shield' },
      { name: 'grid', label: 'Grid (columns x rows)', type: 'select', options: ['2x2', '3x3'], default: '3x3' },
      { name: 'setName', label: 'Set name', type: 'string', required: true },
    ] } } } };
  return summary;
}
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
    expect(api.started[0]).toMatchObject({ projectId: 'p1', recipeId: 'image', count: 2, inputs: { prompt: 'a green slime', name: 'a_green_slime' } });
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

  it('picks the shape, the size and how many from the pills, and prices the size', async () => {
    api.services = [{ ...imageService, aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], resolutions: ['1k', '2k', '4k'],
      pricing: { ...pricing, resolutionCredits: { '2k': 2, '4k': 5 } } }];
    api.quote = () => Response.json({ paid: true, quoteId: QUOTE_ID, model: { provider: 'openpixo', id: 'openpixo-image' }, count: 8,
      credits: 48, available: 400, candidates: Array.from({ length: 8 }, () => ({ credits: 6 })), expiresAt: '2030-01-01T00:00:00.000Z', warnings: [] });
    show();
    await waitFor(() => expect(box().getByTestId('generate-estimate').textContent).toBe('About 8 credits'));
    fireEvent.click(box().getByTestId('generate-size'));
    fireEvent.click(box().getByTestId('generate-aspect-16:9'));
    expect(box().getByTestId('generate-resolution-2k').textContent).toBe('2K+2');
    fireEvent.click(box().getByTestId('generate-resolution-2k'));
    expect(box().getByTestId('generate-size').textContent).toContain('16:9');
    expect(box().getByTestId('generate-size').textContent).toContain('2K');
    expect(box().getByTestId('generate-size-panel').textContent).toContain('2560 × 1440 px');
    await waitFor(() => expect(box().getByTestId('generate-estimate').textContent).toBe('About 12 credits'));
    fireEvent.click(box().getByTestId('generate-count'));
    fireEvent.click(box().getByTestId('generate-count-8'));
    await waitFor(() => expect(box().getByTestId('generate-estimate').textContent).toBe('About 48 credits'));
    await describeAndGenerate();
    await waitFor(() => expect(api.started).toHaveLength(1));
    expect(api.started[0]).toMatchObject({ recipeId: 'image', count: 8, quoteId: QUOTE_ID, inputs: { aspect: '16:9', resolution: '2k' } });
  });

  it('greys out a shape or size credits cannot buy yet, and an own tool takes any', async () => {
    show();
    await waitFor(() => expect(box().getByTestId('generate-estimate').textContent).toBe('About 8 credits'));
    fireEvent.click(box().getByTestId('generate-size'));
    expect(box().getByTestId('generate-aspect-1:1')).toBeEnabled();
    expect(box().getByTestId('generate-aspect-16:9')).toBeDisabled();
    expect(box().getByTestId('generate-resolution-2k')).toBeDisabled();
    cleanup();
    resetStudioCacheForTests();
    api.capabilities = { t2i: { configured: true, providers: ['openai'] } };
    show();
    await waitFor(() => expect(box().getByTestId('generate-estimate').textContent).toBe('Made with your own tool, no credits'));
    fireEvent.click(box().getByTestId('generate-size'));
    expect(box().getByTestId('generate-aspect-21:9')).toBeEnabled();
    expect(box().getByTestId('generate-resolution-4k').textContent).toBe('4K');
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
    const { onFilesChanged } = show({ start: 'library' });
    const tile = await library().findByTestId('generate-tile');
    expect(within(library().getByTestId('generate-run')).getByText('AI')).toBeTruthy();
    fireEvent.click(tile);
    const detail = within(await screen.findByTestId('generate-detail'));
    expect(detail.getByTestId('generate-download').getAttribute('href')).toBe('/api/generate/runs/run-1/candidates/c1/files/0');
    expect(detail.getByTestId('generate-download').getAttribute('download')).toBe('a_slime.png');
    await act(async () => { fireEvent.click(detail.getByTestId('generate-save')); });
    await waitFor(() => expect(api.adopted).toEqual([{ projectId: 'p1', candidateIds: ['c1'] }]));
    expect(onFilesChanged).toHaveBeenCalledWith('p1');
    expect(await detail.findByRole('button', { name: 'assets/images/a_slime.png' })).toBeTruthy();
    fireEvent.click(detail.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('generate-detail')).toBeNull());
    expect(screen.getByTestId('generate-box')).toBeTruthy();
  });

  it('puts a result\'s request back in the box with 改一下', async () => {
    api.runs = [readyRun({ recipeId: 'sound-effect', surface: 'audio', inputs: { prompt: 'coin pickup', duration: 2, name: 'coin_pickup' },
      candidates: [{ id: 'c1', index: 0, stagedFiles: [{ role: 'primary', ref: 'C:/x/primary.mp3', mime: 'audio/mpeg' }], checks: [] }] })];
    show({ start: 'library' });
    fireEvent.click(await library().findByTestId('generate-tile'));
    fireEvent.click(await screen.findByTestId('generate-edit'));
    // 改一下 goes back to 创作, with the request in the box.
    expect(section()).toBe('create');
    expect((box().getByTestId('generate-text') as HTMLTextAreaElement).value).toBe('coin pickup');
    expect(box().getByRole('tab', { name: 'Sound effect', selected: true })).toBeTruthy();
  });

  it('takes "generate from" pictures as references', async () => {
    show({ referencePaths: ['art/hero.png'], referenceRequest: 1 });
    expect((await box().findByRole('checkbox', { name: /art\/hero\.png/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('picks a reference from the game\'s pictures panel, which then closes on Esc', async () => {
    show();
    expect(box().queryByRole('checkbox', { name: /art\/hero\.png/ })).toBeNull();
    fireEvent.click(box().getByTestId('generate-add-reference'));
    const panel = within(await screen.findByTestId('generate-reference-panel'));
    fireEvent.click(panel.getByRole('checkbox', { name: /art\/hero\.png/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('generate-reference-panel')).toBeNull());
    expect((box().getByRole('checkbox', { name: /art\/hero\.png/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('makes art with no game from an uploaded picture', async () => {
    api.capabilities = { t2i: { configured: true, providers: ['openai'] }, i2i: { configured: true, providers: ['openai'] } };
    show({ projectId: null, files: [] });
    expect(box().queryByText('No pictures in this project yet.')).toBeNull();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'hero.png', { type: 'image/png' });
    await act(async () => { fireEvent.change(box().getByTestId('generate-upload-input'), { target: { files: [file] } }); });
    expect((await box().findByRole('checkbox', { name: /hero\.png/ }) as HTMLInputElement).checked).toBe(true);
    await describeAndGenerate();
    await waitFor(() => expect(api.started).toHaveLength(1));
    expect(api.quoted[0]).toMatchObject({ projectId: null });
    expect(api.started[0]).toMatchObject({ projectId: null, inputs: { reference: 'references/abc.png' } });
  });

  it('saves a no-game result into the game picked in its detail, and names each run\'s game', async () => {
    api.runs = [readyRun({ projectId: null })];
    const { onFilesChanged } = show({ projectId: null, files: [], start: 'library' });
    expect(await within(await library().findByTestId('generate-run')).findByText('No game')).toBeTruthy();
    fireEvent.click(await library().findByTestId('generate-tile'));
    const detail = within(await screen.findByTestId('generate-detail'));
    fireEvent.change(detail.getByTestId('generate-save-game'), { target: { value: 'p2' } });
    await act(async () => { fireEvent.click(detail.getByTestId('generate-save')); });
    await waitFor(() => expect(api.adopted).toEqual([{ projectId: 'p2', candidateIds: ['c1'] }]));
    expect(onFilesChanged).toHaveBeenCalledWith('p2');
  });

  it('shows presets as pictures: any-engine ones with no game, never code or the box\'s own kinds', async () => {
    api.recipes = [...api.recipes, iconSet(),
      { id: 'godot-only', title: 'Godot tiles', description: '', version: '0.1.0', surface: 'image', category: 'tiles', engines: ['godot'], requires: [] },
      { id: 'feature-inventory', title: 'Inventory', description: '', version: '0.1.0', surface: 'code', category: 'feature', engines: ['any'], requires: [] }];
    show({ projectId: null, files: [] });
    const cards = await screen.findAllByTestId('generate-preset');
    expect(cards.map(card => card.getAttribute('data-recipe-id'))).toEqual(['item-icon-set']);
    expect(cards[0]!.querySelector('img')?.getAttribute('src')).toBe('/api/recipes/item-icon-set/examples/0/after');
    // With no tool of the user's own, the card says what one costs in credits.
    await waitFor(() => expect(cards[0]!.textContent).toContain('From 4 credits'));
  });

  it('puts a preset in the box as a tag: the description fills its text, its settings become pills', async () => {
    api.capabilities = { t2i: { configured: true, providers: ['openai'] } };
    api.recipes = [...api.recipes, iconSet()];
    show({ projectId: null, files: [] });
    const card = await screen.findByTestId('generate-preset');
    // Its price is on the picture: free, since the user's own tool makes it.
    await waitFor(() => expect(card.textContent).toContain('Free'));
    fireEvent.click(card);
    const tag = await box().findByTestId('generate-tag');
    // 做同款: the example's words fill an empty box.
    expect((box().getByTestId('generate-text') as HTMLTextAreaElement).value).toBe('potions');
    expect(tag.textContent).toContain('Item icon set');
    // No dialog: the box is where the request is made.
    expect(screen.queryByRole('dialog')).toBeNull();
    const text = await box().findByPlaceholderText('sword, shield') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(text);
    expect(box().getAllByTestId('generate-setting').map(pill => pill.getAttribute('data-field'))).toEqual(['grid']);
    fireEvent.change(within(box().getByTestId('generate-setting')).getByRole('combobox'), { target: { value: '2x2' } });
    await describeAndGenerate('potion, sword');
    await waitFor(() => expect(api.started).toHaveLength(1));
    expect(api.started[0]).toMatchObject({ recipeId: 'item-icon-set', count: 1, projectId: null,
      inputs: { items: 'potion, sword', grid: '2x2', setName: 'potion_sword' } });
    // Taking the tag off goes back to plain images, keeping the words.
    fireEvent.click(box().getByTestId('generate-tag-remove'));
    expect(box().queryByTestId('generate-tag')).toBeNull();
    expect((box().getByTestId('generate-text') as HTMLTextAreaElement).value).toBe('potion, sword');
  });

  it('opens a preset that needs a character in its own form instead', async () => {
    api.recipes = [...api.recipes,
      { id: 'sprite-walk-8dir', title: '8-direction walk', description: '', version: '0.1.0', surface: 'image', category: 'sprites', engines: ['any'], requires: [], needsGame: true }];
    show();
    fireEvent.click(await screen.findByTestId('generate-preset'));
    expect(within(await screen.findByRole('dialog')).getByTestId('generate-preset-drawer')).toBeTruthy();
    expect(box().queryByTestId('generate-tag')).toBeNull();
  });

  it('is a home: the headline, the box, presets and styles; a new result shows under the same box', async () => {
    api.capabilities = { t2i: { configured: true, providers: ['openai'] }, sfx: { configured: true, providers: ['x'] } };
    api.recipes = [...api.recipes, iconSet()];
    show({ projectId: null, files: [] });
    expect(await screen.findByRole('heading', { name: 'Turn ideas into game assets' })).toBeTruthy();
    expect(screen.queryByTestId('generate-recent')).toBeNull();
    // Presets and styles fill the page; the kinds are the box's own tabs.
    expect(screen.getByTestId('generate-presets')).toBeTruthy();
    expect(screen.queryByTestId('generate-features')).toBeNull();
    fireEvent.click(box().getByRole('tab', { name: 'Audio' }));
    expect(box().getByRole('tab', { name: 'Sound effect', selected: true })).toBeTruthy();
    const textBox = box().getByTestId('generate-text');
    await describeAndGenerate('coin');
    expect(await screen.findByTestId('generate-recent')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Turn ideas into game assets' })).toBeTruthy();
    expect(box().getByTestId('generate-text')).toBe(textBox);
    fireEvent.click(screen.getByTestId('generate-recent-all'));
    expect(section()).toBe('library');
  });

  it('says when nothing has been made yet, and goes back to the box', async () => {
    show({ start: 'library' });
    fireEvent.click(await library().findByRole('button', { name: 'Start creating' }));
    expect(section()).toBe('create');
  });

  it('puts a preset from the box’s 预设 panel in the box, only those of the picked kind', async () => {
    api.recipes = [...api.recipes, iconSet(),
      { id: 'bgm-loop', title: 'Music loop', description: '', version: '0.1.0', surface: 'audio', category: 'audio', engines: ['any'], requires: [] }];
    show({ projectId: null, files: [] });
    fireEvent.click(await box().findByRole('button', { name: 'Presets' }));
    fireEvent.click(box().getByTestId('generate-presets-tile'));
    const panel = within(box().getByTestId('generate-preset-panel'));
    expect(panel.getAllByTestId('generate-preset').map(card => card.getAttribute('data-recipe-id'))).toEqual(['item-icon-set']);
    fireEvent.click(panel.getByTestId('generate-preset'));
    expect(await box().findByTestId('generate-tag')).toBeTruthy();
    expect(box().queryByTestId('generate-preset-panel')).toBeNull();
  });

  it('puts a style picked from the page into the box', async () => {
    api.capabilities = { t2i: { configured: true, providers: ['openai'] } };
    show({ projectId: null, files: [] });
    fireEvent.click(await screen.findByTestId('generate-style-card'));
    expect(screen.getByTestId('generate-style-card').getAttribute('aria-pressed')).toBe('true');
    await describeAndGenerate('a slime');
    await waitFor(() => expect(api.started).toHaveLength(1));
    expect(api.started[0]).toMatchObject({ recipeId: 'image', styleId: 'pixel' });
  });

  it('flips between a run’s results inside the result dialog, and groups 我的作品 by day', async () => {
    const second = { id: 'c2', index: 1, stagedFiles: [{ role: 'primary' as const, ref: 'C:/data/recipe-runs/run-1/c2/primary.png', mime: 'image/png' }], checks: [] };
    const run = readyRun({ createdAt: Date.now() });
    run.candidates.push(second);
    api.runs = [run];
    show({ start: 'library' });
    expect(await library().findByRole('region', { name: 'Today' })).toBeTruthy();
    fireEvent.click((await library().findAllByTestId('generate-tile'))[0]!);
    const detail = within(await screen.findByTestId('generate-detail'));
    expect(detail.getByTestId('generate-download').getAttribute('href')).toContain('/candidates/c1/');
    fireEvent.click(detail.getAllByTestId('generate-sibling')[1]!);
    await waitFor(() => expect(within(screen.getByTestId('generate-detail')).getByTestId('generate-download').getAttribute('href')).toContain('/candidates/c2/'));
  });
});
