// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManifestSchema, type ArtStyle, type RecipeSummary } from '@openpixo/contracts';
import { I18nProvider } from '../../src/i18n';
import { StudioPanel } from '../../src/components/studio/StudioPanel';
import { resetStudioCacheForTests } from '../../src/components/studio/studio-cache';

const recipe = (id: string, extra: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id, title: id, description: `${id} description`, version: '1.0.0', surface: 'image', category: 'character',
  engines: ['any'], requires: [], ...extra,
});
const style = (id: string): ArtStyle => ({
  id, title: id, description: `A ${id} style.`, prompt: id, negativePrompt: '', previews: [], license: 'CC0-1.0',
  dimension: [id.includes('3d') ? '3d' : '2d'], medium: [id.includes('pixel') ? 'pixel' : 'paint'],
});
const detailOf = (summary: RecipeSummary) => ({ ...summary, manifest: PluginManifestSchema.parse({ specVersion: '1.0.0', name: `test/${summary.id}`, version: '1.0.0', pixo:
  summary.surface === 'code' ? { kind: 'recipe', recipe: { surface: 'code', category: summary.category, inputs: [] }, useCase: { query: 'Start' } }
    : { kind: 'recipe', recipe: { surface: 'image', category: summary.category, inputs: [], prompt: 'x', models: { requires: [] }, output: { dir: 'art', name: 'x' } } } }) });
let recipes: RecipeSummary[];
let styles: ArtStyle[];
let available: boolean;

beforeEach(() => {
  resetStudioCacheForTests();
  recipes = [recipe('pixel-character', { verified: true }), recipe('unverified-effect'),
    recipe('jump-sound', { surface: 'audio', category: 'sfx' }),
    recipe('save-system', { surface: 'code', category: 'feature', engines: ['phaser'] }),
    recipe('phaser-starter', { surface: 'code', category: 'code', engines: ['phaser'] }),
    recipe('platformer-godot', { surface: 'code', category: 'code', engines: ['godot'] })];
  styles = [style('pixel-16-bit'), style('hand-painted'), style('low-poly-3d'), style('voxel-3d')];
  available = true;
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/recipes') return Response.json(recipes);
    const match = recipes.find(entry => url.pathname === `/api/recipes/${entry.id}`);
    if (match) return Response.json(detailOf(match));
    if (url.pathname.endsWith('/characters')) return Response.json([]);
    if (url.pathname === '/api/media/capabilities') return Response.json({ capabilities: {
      t2i: { configured: available, providers: available ? ['codex'] : [] },
    } });
    if (url.pathname === '/api/styles') return Response.json({ styles });
    if (url.pathname.endsWith('/art-style')) return Response.json({ styleId: null, style: null });
    if (url.pathname.endsWith('/engine')) return Response.json({ profile: { engine: 'phaser', evidence: ['package.json'], confidence: 'certain' } });
    if (url.pathname.endsWith('/assets')) return Response.json({ assets: [
      { kind: 'image', relPath: 'player.png', width: 192, height: 32, semantics: [], tags: [] },
    ], nextCursor: null });
    if (url.pathname === '/api/projects/game') return Response.json({ project: { metadata: { templateId: 'phaser3-sample-platformer' } } });
    return Response.json({}, { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function show() {
  return render(<I18nProvider initial="en"><StudioPanel projectId="game" files={[]}
    onOpenFile={vi.fn()} onRefreshFiles={vi.fn()} onOpenExtensions={vi.fn()} /></I18nProvider>);
}

describe('project-aware Generate catalogue', () => {
  it('groups recipes by what you are making, offering only the groups that have any', async () => {
    show();
    await screen.findByText('pixel-character');
    const groups = screen.getByRole('group', { name: 'Categories' });
    expect(within(groups).getAllByRole('button').map(button => button.textContent)).toEqual(['Art', 'Audio', 'Gameplay features', 'Starter projects']);
    expect(within(groups).getByRole('button', { name: 'Art' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('jump-sound')).toBeNull();

    fireEvent.click(within(groups).getByRole('button', { name: 'Audio' }));
    expect(within(groups).getByRole('button', { name: 'Audio' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(groups).getByRole('button', { name: 'Art' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('jump-sound')).toBeTruthy();
    expect(screen.queryByText('pixel-character')).toBeNull();
  });

  it('shows compatible recipes by default and lets the user include other engines', async () => {
    show();
    await screen.findByText('pixel-character');
    fireEvent.click(screen.getByRole('button', { name: 'Starter projects' }));
    expect(screen.getByText('phaser-starter')).toBeTruthy();
    expect(screen.queryByText('platformer-godot')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show other engines' }));
    expect(await screen.findByText('platformer-godot')).toBeTruthy();
  });

  it('hides the engine toggle when no recipe is hidden by it', async () => {
    recipes = recipes.filter(entry => entry.id !== 'platformer-godot');
    show();
    await screen.findByText('pixel-character');
    expect(screen.queryByRole('checkbox', { name: 'Show other engines' })).toBeNull();
  });

  it('warns about restructuring only inside the starter group and its detail', async () => {
    show();
    await screen.findByText('pixel-character');
    expect(screen.queryByText(/restructure your game project/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Starter projects' }));
    expect(screen.getByText(/restructure your game project/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /phaser-starter/ }));
    const detail = await screen.findByRole('region', { name: 'phaser-starter' });
    expect(await within(detail).findByText(/restructure your game project/)).toBeTruthy();
  });

  it('uses the preview as the row glyph when it is reachable, and a group icon otherwise', async () => {
    recipes[0]!.preview = 'https://example.org/original-character.png';
    show();
    const withPreview = await screen.findByRole('button', { name: /pixel-character/ });
    expect(withPreview.querySelector('img')?.getAttribute('src')).toBe('https://example.org/original-character.png');
    const without = screen.getByRole('button', { name: /unverified-effect/ });
    expect(without.querySelector('img')).toBeNull();
    expect(without.querySelector('svg')).toBeTruthy();
  });

  it('keeps rows to a title and one line: no tags, type line or capability line', async () => {
    show();
    const row = await screen.findByRole('button', { name: /unverified-effect/ });
    expect(within(row).getByText('unverified-effect')).toBeTruthy();
    expect(within(row).getByText('unverified-effect description')).toBeTruthy();
    expect(row.textContent).toBe('unverified-effectunverified-effect description');
    expect(screen.queryByText('Untested')).toBeNull();
    expect(screen.queryByText(/Model capabilities/)).toBeNull();
    expect(screen.queryByText('Any engine')).toBeNull();
  });

  it('says a recipe is untested once, inside its detail view', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: /unverified-effect/ }));
    const unverified = await screen.findByRole('region', { name: 'unverified-effect' });
    expect(await within(unverified).findByText(/Not yet verified end to end/)).toBeTruthy();
    fireEvent.click(within(unverified).getByRole('button', { name: 'Back to recipes' }));
    fireEvent.click(screen.getByRole('button', { name: /pixel-character/ }));
    const verified = await screen.findByRole('region', { name: 'pixel-character' });
    await within(verified).findByRole('button', { name: 'Generate' });
    expect(within(verified).queryByText(/Not yet verified end to end/)).toBeNull();
  });

  it('warns about a mismatched engine inside the detail view only', async () => {
    show();
    await screen.findByText('pixel-character');
    fireEvent.click(screen.getByRole('button', { name: 'Starter projects' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show other engines' }));
    expect(screen.queryByText(/targets another engine/)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /platformer-godot/ }));
    const detail = await screen.findByRole('region', { name: 'platformer-godot' });
    expect(await within(detail).findByText(/targets another engine/)).toBeTruthy();
  });

  it('groups styles by dimension and suggests pixel art from existing small images', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Art style/, expanded: false }));
    const twoD = await screen.findByRole('region', { name: '2D styles' });
    expect(await within(twoD).findByText('pixel-16-bit')).toBeTruthy();
    expect(within(twoD).queryByText('low-poly-3d')).toBeNull();
    expect(await within(twoD).findByText('Suggested for your art')).toBeTruthy();
    expect(screen.queryByText('voxel-3d')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show 3D styles' }));
    const threeD = screen.getByRole('region', { name: '3D styles' });
    expect(within(threeD).getByText('low-poly-3d')).toBeTruthy();
  });

  it('does not ask for keys when a keyless provider is available', async () => {
    show();
    await screen.findByText('pixel-character');
    expect(screen.queryByText(/To run recipes, connect your own tool/)).toBeNull();
  });
});
