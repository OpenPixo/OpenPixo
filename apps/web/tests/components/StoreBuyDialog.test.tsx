// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { OpenPixoAccountStatus, StoreCatalogItem, StoreItemDetail } from '@openpixo/contracts';
import { StoreView } from '../../src/components/store/StoreView';
import { resetOpenPixoAccountStoreForTests } from '../../src/hooks/useOpenPixoAccount';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetOpenPixoAccountStoreForTests(); });

const pack: StoreCatalogItem = {
  name: 'openpixo/forest-platformer-kit', title: 'Forest platformer kit', description: 'Tiles, props and a hero.', kind: 'asset-pack',
  version: '1.2.0', engines: ['godot', 'phaser'], pricing: { type: 'paid', credits: 600, sku: 'pack_forest' }, license: 'LicenseRef-OpenPixo-Asset',
  tags: ['platformer', 'pixel-art'], assetLicense: { commercialUse: true, attributionRequired: false } as StoreCatalogItem['assetLicense'],
};

const signedOut: OpenPixoAccountStatus = { availability: 'available', signedIn: false, user: null };
const signedIn: OpenPixoAccountStatus = {
  availability: 'available', signedIn: true,
  user: { id: 'u1', email: 'dev@example.com', provider: 'email', displayName: 'Dev', avatarUrl: null },
};

function mockApi({ account = signedIn, balance = 1240, purchase, detail, install }: {
  account?: OpenPixoAccountStatus;
  balance?: number;
  purchase?: () => Response;
  detail?: Partial<StoreItemDetail>;
  install?: (body: unknown) => Response;
} = {}) {
  const request = vi.fn(async (url: string, _init?: RequestInit) => {
    const path = new URL(url, 'http://localhost').pathname;
    if (path === '/api/store/catalog') return Response.json({ items: [pack, { ...pack, name: 'openpixo/free-skill', title: 'Free skill', kind: 'skill', pricing: { type: 'free' } }] });
    if (path.startsWith('/api/store/items/')) return Response.json({ ...pack, previews: [], requires: {}, versions: ['1.2.0'], ...detail });
    if (path === '/api/openpixo/account') return Response.json(account);
    if (path === '/api/openpixo/credits') return Response.json({ available: balance, reserved: 0, subscription: null });
    if (path === '/api/store/install' && install) return install(JSON.parse(String(_init?.body)));
    if (path === '/api/store/purchase') return purchase ? purchase() : Response.json({ error: { code: 'STORE_PURCHASE_UNAVAILABLE', message: 'Purchases open soon' } }, { status: 503 });
    return Response.json({});
  });
  vi.stubGlobal('fetch', request);
  return request;
}

async function openBuyDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'See all Asset packs' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Buy Forest platformer kit' }));
  return within(await screen.findByTestId('workshop-buy-dialog'));
}

describe('Workshop buy dialog', () => {
  it('asks a signed-out visitor to sign in without blocking browsing', async () => {
    mockApi({ account: signedOut });
    render(<StoreView />);
    expect(await screen.findByRole('button', { name: 'Sign in to buy' })).toBeTruthy();
    const dialog = await openBuyDialog();
    expect(dialog.getByRole('heading', { name: 'Forest platformer kit' })).toBeTruthy();
    expect(dialog.getByRole('heading', { name: 'Sign in to buy' })).toBeTruthy();
    expect(dialog.getByRole('textbox', { name: 'Email address' })).toBeTruthy();
    expect(dialog.queryByRole('button', { name: /Buy for/ })).toBeNull();
  });

  it('shows the shortfall and sends a short balance to Get credits', async () => {
    mockApi({ balance: 100 });
    const onOpenAccount = vi.fn();
    render(<StoreView onOpenAccount={onOpenAccount} />);
    const dialog = await openBuyDialog();
    expect(await dialog.findByText('500 short')).toBeTruthy();
    expect(dialog.queryByRole('button', { name: /Buy for/ })).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Get credits' }));
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
  });

  it('turns an unavailable purchase into a reassuring opens-soon state', async () => {
    const request = mockApi();
    render(<StoreView />);
    expect(await screen.findByLabelText('Your balance: 1,240 credits')).toBeTruthy();
    const dialog = await openBuyDialog();
    expect(dialog.getByRole('img', { name: '640 credits' })).toBeTruthy();
    fireEvent.click(await dialog.findByRole('button', { name: 'Buy for 600 credits' }));
    expect(await dialog.findByRole('heading', { name: 'Purchases open soon' })).toBeTruthy();
    expect(dialog.getByText(/nothing was charged/)).toBeTruthy();
    const purchase = request.mock.calls.find(([url]) => url === '/api/store/purchase');
    expect(JSON.parse(String(purchase?.[1]?.body))).toEqual({ name: 'openpixo/forest-platformer-kit', version: '1.2.0' });
    expect(screen.getByRole('button', { name: 'Buy Forest platformer kit' })).toBeTruthy();
  });

  it('keeps the dialog open with an inline error for other failures', async () => {
    mockApi({ purchase: () => Response.json({ error: { code: 'CLOUD_UNAVAILABLE', message: 'Cloud offline' } }, { status: 502 }) });
    render(<StoreView />);
    const dialog = await openBuyDialog();
    fireEvent.click(await dialog.findByRole('button', { name: 'Buy for 600 credits' }));
    expect((await dialog.findByRole('alert')).textContent).toBe('The purchase didn’t go through. Check your connection and try again.');
    expect(dialog.getByRole('button', { name: 'Buy for 600 credits' })).toBeTruthy();
  });

  it.each(['ACCOUNT_LOGIN_EXPIRED', 'ACCOUNT_SIGNED_OUT'])('asks for a new sign-in, not a connection check, on %s', async (code) => {
    mockApi({ purchase: () => Response.json({ error: { code, message: 'Sign in again' } }, { status: 401 }) });
    render(<StoreView />);
    const dialog = await openBuyDialog();
    fireEvent.click(await dialog.findByRole('button', { name: 'Buy for 600 credits' }));
    expect((await dialog.findByRole('alert')).textContent).toBe('Your sign-in has expired. Sign in again, then retry.');
  });

  it('marks the pack owned and refreshes the balance after a purchase', async () => {
    const request = mockApi({ purchase: () => Response.json({ name: pack.name, version: '1.2.0', creditsSpent: 600, balance: 640, entitlementId: 'ent_1' }) });
    render(<StoreView />);
    const dialog = await openBuyDialog();
    fireEvent.click(await dialog.findByRole('button', { name: 'Buy for 600 credits' }));
    expect(await dialog.findByRole('heading', { name: 'It’s yours' })).toBeTruthy();
    expect(dialog.getByText('Forest platformer kit is now yours. 600 credits spent, 640 left.')).toBeTruthy();
    await waitFor(() => expect(request.mock.calls.filter(([url]) => url === '/api/openpixo/credits').length).toBeGreaterThan(1));
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getAllByText('Owned').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Buy Forest platformer kit' })).toBeNull();
    // An owned pack is added to a game from its page, which asks which game.
    expect(screen.queryByRole('button', { name: 'Install Forest platformer kit' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Add to game' }).length).toBeGreaterThan(0);
  });
});

describe('Workshop item page for a paid pack', () => {
  it('shows price, license, a preview lightbox and opens the buy dialog', async () => {
    mockApi({ detail: { previews: ['/api/store/items/openpixo%2Fforest-platformer-kit/previews/0', '/api/store/items/openpixo%2Fforest-platformer-kit/previews/1'] } });
    render(<StoreView itemName={pack.name} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Forest platformer kit' })).toBeTruthy();
    expect(screen.getByText('Allowed in commercial games')).toBeTruthy();
    expect(screen.getByText('No credit needed')).toBeTruthy();
    expect(screen.getByText('#pixel art')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open preview 2 of 2' }));
    const lightbox = within(await screen.findByTestId('workshop-lightbox'));
    expect(lightbox.getByRole('img', { name: 'Preview 2 of 2' })).toBeTruthy();
    fireEvent.click(lightbox.getByRole('button', { name: 'Next image' }));
    expect(lightbox.getByRole('img', { name: 'Preview 1 of 2' })).toBeTruthy();
    fireEvent.click(lightbox.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
    const dialog = within(await screen.findByTestId('workshop-buy-dialog'));
    expect(await dialog.findByRole('button', { name: 'Buy for 600 credits' })).toBeTruthy();
  });
});

describe('Workshop item page for an owned pack', () => {
  const games = [{ id: 'old-game', name: 'Old game', updatedAt: 1 }, { id: 'new-game', name: 'Slime quest', updatedAt: 5 }];

  it('adds the pack to the game chosen, starting on the most recent game, and says where it went', async () => {
    const install = vi.fn((_body: unknown) => Response.json({ name: pack.name, pluginId: pack.name, version: '1.2.0', projectId: 'new-game',
      folder: 'assets/packs/forest-platformer-kit', files: 40, warnings: [] }));
    mockApi({ detail: { owned: true }, install });
    render(<StoreView itemName={pack.name} projects={games} />);
    const add = await screen.findByRole('button', { name: 'Add to game' });
    expect((screen.getByTestId('store-pack-game') as HTMLSelectElement).value).toBe('new-game');
    expect(screen.queryByRole('option', { name: 'This device' })).toBeNull();
    fireEvent.click(add);
    expect(await screen.findByText('Added to Slime quest in assets/packs/forest-platformer-kit. PACK.md there tells your agent what each image is for.')).toBeTruthy();
    expect(install).toHaveBeenCalledWith({ name: pack.name, version: '1.2.0', projectId: 'new-game' });
  });

  it('asks for a game first when there is none', async () => {
    mockApi({ detail: { owned: true } });
    render(<StoreView itemName={pack.name} projects={[]} />);
    expect(await screen.findByText('Create a game first, then add this pack to it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add to game' })).toBeNull();
  });
});
