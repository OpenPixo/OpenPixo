// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratePage } from '../../src/components/generate/GeneratePage';
import { queueGenerateHandoff } from '../../src/components/studio/entry';
import { resetOpenPixoAccountStoreForTests } from '../../src/hooks/useOpenPixoAccount';
import { I18nProvider } from '../../src/i18n';
import { navigate } from '../../src/router';

const view = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock('../../src/components/generate/GenerateView', () => ({
  GenerateView: (props: Record<string, unknown>) => { view.props.push(props); return <div data-testid="generate-view">{String(props.projectId)}</div>; },
}));
vi.mock('../../src/providers/registry', () => ({ fetchProjectFiles: vi.fn(async (id: string) => [{ name: `${id}/hero.png` }]) }));
vi.mock('../../src/router', async (importOriginal) => ({ ...await importOriginal<typeof import('../../src/router')>(), navigate: vi.fn() }));

const GAMES = [{ id: 'old', name: 'Old game', updatedAt: 1 }, { id: 'new', name: 'New game', updatedAt: 2 }];
const show = (routeProjectId?: string, onOpenAccount = vi.fn()) => render(<I18nProvider initial="en">
  <GeneratePage routeProjectId={routeProjectId} games={GAMES} onOpenAccount={onOpenAccount} onOpenExtensions={vi.fn()} /></I18nProvider>);
const last = () => view.props.at(-1)!;

beforeEach(() => { view.props = []; window.localStorage.clear(); window.sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); resetOpenPixoAccountStoreForTests(); });

describe('生成 page', () => {
  it('starts with no game, lists games newest first, and a pick reads that game\'s files', async () => {
    show();
    expect(last().projectId).toBeNull();
    const select = screen.getByTestId('generate-game') as HTMLSelectElement;
    expect([...select.options].map(option => option.text)).toEqual(['No game', 'New game', 'Old game']);
    fireEvent.change(select, { target: { value: 'old' } });
    await waitFor(() => expect(last()).toMatchObject({ projectId: 'old', files: [{ name: 'old/hero.png' }] }));
    expect(navigate).toHaveBeenCalledWith({ kind: 'home', view: 'generate', generateProjectId: 'old' }, { replace: true });
    expect(window.localStorage.getItem('pixo:generate:game')).toBe('old');
  });

  it('opens for the game an entry point named, with the pictures it handed over', async () => {
    queueGenerateHandoff({ projectId: 'new', references: ['art/hero.png'] });
    show('new');
    await waitFor(() => expect(last()).toMatchObject({ projectId: 'new', referencePaths: ['art/hero.png'], referenceRequest: 1 }));
    expect(window.sessionStorage.getItem('openpixo:generate-handoff')).toBeNull();
  });

  it('forgets a remembered game that no longer exists', () => {
    window.localStorage.setItem('pixo:generate:game', 'gone');
    show();
    expect(last().projectId).toBeNull();
  });

  it('shows a signed-in balance, one click from topping up', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input, 'http://localhost').pathname;
      if (path === '/api/openpixo/account') return Response.json({ availability: 'available', signedIn: true,
        user: { id: 'u1', email: 'dev@example.com', provider: 'email', displayName: 'Dev', avatarUrl: null } });
      if (path === '/api/openpixo/credits') return Response.json({ available: 120, reserved: 0, subscription: null });
      return Response.json({}, { status: 404 });
    }));
    const onOpenAccount = vi.fn();
    show(undefined, onOpenAccount);
    const credits = await screen.findByTestId('generate-credits');
    expect(credits.textContent).toContain('120 credits');
    fireEvent.click(credits);
    expect(onOpenAccount).toHaveBeenCalled();
  });
});
