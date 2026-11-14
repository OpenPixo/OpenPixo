// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { StoreCatalogItem, StoreInstallRequest } from '@openpixo/contracts';
import { StoreView } from '../../src/components/store/StoreView';
import { resetOpenPixoAccountStoreForTests } from '../../src/hooks/useOpenPixoAccount';
import { buildPath, parseRoute } from '../../src/router';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetOpenPixoAccountStoreForTests(); });

function item(name: string, kind: StoreCatalogItem['kind'] = 'skill', overrides: Partial<StoreCatalogItem> = {}): StoreCatalogItem {
  return { name: `openpixo/${name}`, title: name, description: `${name} description`, kind, version: '1.0.0', engines: ['godot'], pricing: { type: 'free' }, license: 'MIT', ...overrides };
}

function mockCatalog(items: StoreCatalogItem[], install?: (body: StoreInstallRequest) => Response | Promise<Response>) {
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (new URL(url, 'http://localhost').pathname === '/api/store/catalog') return new Response(JSON.stringify({ items }));
    if (url === '/api/store/install') {
      const body = JSON.parse(String(init?.body)) as StoreInstallRequest;
      return install ? install(body) : installed(body.name);
    }
    return new Response('{}');
  });
  vi.stubGlobal('fetch', request);
  return request;
}

function installed(name: string) {
  return new Response(JSON.stringify({ name, pluginId: name, version: '1.0.0', warnings: [] }));
}

const tabLabels = () => within(screen.getByRole('tablist', { name: 'Categories' })).getAllByRole('tab').map(tab => tab.textContent);

it('keeps Workshop item routes available', () => {
  expect(parseRoute('/store')).toEqual({ kind: 'home', view: 'store' });
  const route = { kind: 'home', view: 'store', storeItemName: 'openpixo/free' } as const;
  expect(parseRoute(buildPath(route))).toEqual(route);
});

it('opens on Discover shelves and leaves Generate kinds out of the Workshop', async () => {
  mockCatalog([
    item('Game feel'), item('Levels'), item('Godot connection', 'mcp'), item('Platformer template', 'project-template'),
    item('Forest pack', 'asset-pack', { pricing: { type: 'paid', credits: 800 }, title_i18n: { 'zh-CN': '森林素材包' } }),
    item('Pixel style', 'style'), item('Sprite recipe', 'recipe'), item('Hero character', 'character-card'),
  ]);
  render(<StoreView />);
  await screen.findByRole('heading', { name: /Skills for your Agent/ });
  expect(tabLabels()).toEqual(['Discover', 'Asset packs 1', 'Skills 2', 'Project templates 1', 'MCP connections 1']);
  expect(screen.getByText('WORKSHOP · 5 ITEMS')).toBeTruthy();
  for (const shelf of [/^Asset packs/, /Skills for your Agent/, /Start from a template/, /Connect your tools/]) {
    expect(screen.getByRole('heading', { level: 2, name: shelf })).toBeTruthy();
  }
  expect(screen.getByRole('region', { name: 'Featured in the Workshop' })).toBeTruthy();
  expect(screen.queryByText('Pixel style')).toBeNull();
  expect(screen.queryByText('Sprite recipe')).toBeNull();
  expect(screen.queryByText('Hero character')).toBeNull();
});

it('switches a shelf\'s See all to its category grid', async () => {
  mockCatalog([item('Game feel'), item('Levels'), item('Godot connection', 'mcp'), item('Platformer template', 'project-template')]);
  render(<StoreView />);
  fireEvent.click(await screen.findByRole('button', { name: 'See all Connect your tools' }));
  const selected = within(screen.getByRole('tablist', { name: 'Categories' })).getByRole('tab', { selected: true });
  expect(selected.textContent).toBe('MCP connections 1');
  const panel = within(screen.getByRole('tabpanel'));
  expect(panel.getByRole('heading', { level: 2, name: 'MCP connections' })).toBeTruthy();
  expect(panel.getByRole('button', { name: 'Godot connection' })).toBeTruthy();
  expect(panel.queryByRole('button', { name: 'Game feel' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Featured in the Workshop' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Discover' }));
  expect(screen.getByRole('heading', { name: /Skills for your Agent/ })).toBeTruthy();
});

it('searches titles, translations and tags into one result grid with live tab counts', async () => {
  const request = mockCatalog([
    item('Game feel', 'skill', { tags: ['effects'] }), item('Levels', 'skill', { tags: ['level-design'] }),
    item('Forest pack', 'asset-pack', { title_i18n: { 'zh-CN': '森林素材包' }, tags: ['platformer', 'pixel-art'] }),
  ]);
  render(<StoreView />);
  const search = await screen.findByRole('searchbox', { name: 'Search Workshop' });
  fireEvent.change(search, { target: { value: '森林' } });
  expect(tabLabels()).toEqual(['Discover', 'Asset packs 1', 'Skills 0', 'Project templates 0', 'MCP connections 0']);
  const panel = within(screen.getByRole('tabpanel'));
  expect(panel.getByRole('heading', { name: 'Results' })).toBeTruthy();
  expect(panel.getByRole('button', { name: 'Forest pack' })).toBeTruthy();
  fireEvent.change(search, { target: { value: 'level design' } });
  expect(panel.getByRole('button', { name: 'Levels' })).toBeTruthy();
  expect(panel.queryByRole('button', { name: 'Forest pack' })).toBeNull();
  fireEvent.click(panel.getByRole('button', { name: 'Clear filters' }));
  expect((search as HTMLInputElement).value).toBe('');
  expect(request.mock.calls.filter(([url]) => url.startsWith('/api/store/catalog'))).toHaveLength(1);
});

it('filters by a quick tag chip and toggles it off again', async () => {
  mockCatalog([
    item('Game feel', 'skill', { tags: ['effects', 'first-party'] }),
    item('Forest pack', 'asset-pack', { tags: ['pixel-art'] }), item('Dungeon pack', 'asset-pack', { tags: ['pixel-art'] }),
  ]);
  render(<StoreView />);
  const chips = within(await screen.findByRole('group', { name: 'Quick filters' }));
  expect(chips.getAllByRole('button').map(chip => chip.textContent)).toEqual(['#pixel art', '#effects']);
  fireEvent.click(chips.getByRole('button', { name: '#pixel art' }));
  const panel = within(screen.getByRole('tabpanel'));
  expect(panel.getByRole('button', { name: 'Forest pack' })).toBeTruthy();
  expect(panel.queryByRole('button', { name: 'Game feel' })).toBeNull();
  fireEvent.click(chips.getByRole('button', { name: '#pixel art' }));
  expect(screen.getByRole('heading', { name: /Skills for your Agent/ })).toBeTruthy();
});

it('installs each free uninstalled skill once and reports progress', async () => {
  let resolveFirst!: (value: Response) => void;
  const firstResponse = new Promise<Response>(resolve => { resolveFirst = resolve; });
  const request = mockCatalog([
    item('First skill'), item('Second skill', 'skill', { engines: ['phaser'] }),
    item('Installed skill', 'skill', { installedVersion: '1.0.0' }), item('Paid skill', 'skill', { pricing: { type: 'paid', credits: 300 } }),
    item('MCP tool', 'mcp'), item('Art style', 'style'), item('Recipe', 'recipe'),
  ], body => body.name.endsWith('First skill') ? firstResponse : installed(body.name));
  render(<StoreView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install all' }));
  const progressButton = await screen.findByRole('button', { name: 'Installing 0 / 2' });
  expect((progressButton as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toBe('Installing 0 / 2');
  expect(screen.getByRole('button', { name: 'Install Second skill' }).textContent).toBe('Install');
  fireEvent.click(progressButton);
  resolveFirst(installed('openpixo/First skill'));
  await waitFor(() => expect(screen.getAllByText('Installed')).toHaveLength(3));
  const calls = request.mock.calls.filter(([url]) => url === '/api/store/install');
  expect(calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
    { name: 'openpixo/First skill', version: '1.0.0' }, { name: 'openpixo/Second skill', version: '1.0.0' },
  ]);
  expect(screen.getByRole('button', { name: 'Buy Paid skill' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Install Paid skill' })).toBeNull();
});

it('continues after a failed skill and retries only the missing install', async () => {
  let attempts = 0;
  const request = mockCatalog([item('First skill'), item('Second skill')], body => {
    if (body.name.endsWith('First skill') && attempts++ === 0) return new Response(JSON.stringify({ error: { message: 'Disk unavailable' } }), { status: 500 });
    return installed(body.name);
  });
  render(<StoreView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install all' }));
  expect((await screen.findByRole('alert')).textContent).toContain('First skill');
  expect(screen.getByText('Installed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Install all' }));
  await screen.findByRole('button', { name: 'All installed' });
  expect(request.mock.calls.filter(([url]) => url === '/api/store/install')).toHaveLength(3);
});

it('keeps card installation and runnable skill examples available', async () => {
  const onTryExample = vi.fn();
  const request = mockCatalog([item('Game feel', 'skill', { examples: [{ title: 'Screen shake', prompt: 'Add screen shake to my game' }] })]);
  render(<StoreView onTryExample={onTryExample} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install Game feel' }));
  expect((await screen.findByRole('status')).textContent).toBe('Game feel installed.');
  expect(screen.getByText('Installed')).toBeTruthy();
  expect(request.mock.calls.find(([url]) => url === '/api/store/install')?.[1]?.body).toBe(JSON.stringify({ name: 'openpixo/Game feel', version: '1.0.0' }));
  fireEvent.click(screen.getByRole('button', { name: 'See examples' }));
  expect(screen.getByRole('heading', { name: 'Screen shake' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Try in project' }));
  expect(onTryExample).toHaveBeenCalledWith('Add screen shake to my game');
});

it('leads the spotlight with a paid pack and steps through slides by button, dot and arrow key', async () => {
  mockCatalog([
    item('Game feel'), item('Godot 2D', 'project-template'),
    item('Pixel dungeon kit', 'asset-pack', { name: 'openpixo/pixel-dungeon-kit', pricing: { type: 'paid', credits: 600 } }),
  ]);
  render(<StoreView />);
  const hero = within(await screen.findByRole('region', { name: 'Featured in the Workshop' }));
  expect(hero.getByRole('group', { name: 'Slide 1 of 3' })).toBeTruthy();
  expect(hero.getByRole('heading', { name: 'Pixel dungeon kit' })).toBeTruthy();
  expect(hero.getByRole('img', { name: '600 credits' })).toBeTruthy();
  expect(hero.queryByRole('button', { name: 'Install all' })).toBeNull();
  fireEvent.click(hero.getByRole('button', { name: 'Next slide' }));
  expect(hero.getByRole('button', { name: 'Install all' })).toBeTruthy();
  expect(hero.queryByRole('heading', { name: 'Pixel dungeon kit' })).toBeNull();
  fireEvent.keyDown(hero.getByRole('button', { name: 'Install all' }), { key: 'ArrowRight' });
  expect(hero.getByRole('heading', { name: 'Godot 2D' })).toBeTruthy();
  fireEvent.click(hero.getByRole('button', { name: 'Show Pixel dungeon kit' }));
  expect(hero.getByRole('button', { name: 'Show Pixel dungeon kit' }).getAttribute('aria-current')).toBe('true');
  expect(hero.getByRole('button', { name: 'Play slideshow' })).toBeTruthy();
});

it('paints designed fallback art when a cover is missing or fails to load', async () => {
  mockCatalog([
    item('No cover pack', 'asset-pack'),
    item('Cover pack', 'asset-pack', { coverUrl: '/api/store/items/openpixo%2Fcover/cover' }),
  ]);
  render(<StoreView />);
  await screen.findByRole('button', { name: 'See all Asset packs' });
  fireEvent.click(screen.getByRole('button', { name: 'See all Asset packs' }));
  const card = (name: string) => screen.getByRole('button', { name }).closest('article') as HTMLElement;
  const missing = card('No cover pack');
  expect(within(missing).getByTestId('store-cover-fallback')).toBeTruthy();
  expect(missing.querySelector('img')).toBeNull();
  expect(missing.querySelector('[data-cover-state]')?.getAttribute('data-cover-state')).toBe('fallback');
  const covered = card('Cover pack');
  const image = covered.querySelector('img') as HTMLImageElement;
  expect(image.getAttribute('src')).toBe('/api/store/items/openpixo%2Fcover/cover');
  expect(image.getAttribute('loading')).toBe('lazy');
  expect(within(covered).getByTestId('store-cover-fallback')).toBeTruthy();
  fireEvent.error(image);
  expect(covered.querySelector('img')).toBeNull();
  expect(covered.querySelector('[data-cover-state]')?.getAttribute('data-cover-state')).toBe('fallback');
});

it('links the Generate note to the 生成 page, game or not', async () => {
  mockCatalog([item('Game feel')]);
  render(<StoreView projects={[]} />);
  const link = await screen.findByRole('link', { name: 'Open Generate →' });
  expect(link.getAttribute('href')).toBe('/generate');
});
