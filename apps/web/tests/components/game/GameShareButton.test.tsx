// @vitest-environment jsdom
// The Share button in the 游戏 toolbar: web games only, and focus comes back to it.
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GameEngineId } from '@openpixo/contracts';
import { gameToolbar, renderGameView, routeFetch } from './game-view-harness';

vi.mock('../../../src/providers/registry', () => ({ openExternalUrl: vi.fn(async () => true) }));
vi.mock('../../../src/components/account/SignInDialog', () => ({ SignInDialog: () => null }));
vi.mock('../../../src/components/tuning/tuning-api', () => ({ listGameTuning: vi.fn(async () => ({ parameters: [], warnings: [] })) }));

const flush = async () => { await act(async () => {}); };
function serveEngine(engine: GameEngineId | null, publishAvailable = true) {
  const mock = routeFetch((path, method) => {
    if (path.endsWith('/next-steps')) return engine ? Response.json({ projectId: 'game', engine, dismissed: false, steps: [] }) : new Response('down', { status: 500 });
    if (path.endsWith('/publish') && method === 'GET') {
      return Response.json(publishAvailable
        ? { available: true, game: null, job: null, termsAccepted: true, termsUrl: '' }
        : { available: false, unavailableReason: 'engine_unsupported', game: null, job: null, termsAccepted: false, termsUrl: '' });
    }
    if (path.endsWith('/rooms') && method === 'GET') return Response.json({ sdkInstalled: false, usage: null, paused: false, maxPlayers: 8, creditsPerPlayerHour: 5 });
    return undefined;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => { serveEngine('phaser'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['phaser', 'threejs', 'web-generic'] as const)('offers Share for a %s game', async engine => {
  serveEngine(engine);
  renderGameView();
  await flush();
  expect(gameToolbar().getByRole('button', { name: 'Share' })).toBeTruthy();
});

it.each(['godot', 'unity', 'unreal', 'cocos-creator'] as const)('has no Share button for %s, without asking the cloud', async engine => {
  const mock = serveEngine(engine);
  renderGameView();
  await flush();
  expect(gameToolbar().queryByRole('button', { name: 'Share' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mock.mock.calls.filter(([url]) => String(url).endsWith('/publish'))).toHaveLength(0);
});

it('lets the publish route decide for a folder with no detected engine', async () => {
  serveEngine('unknown', false);
  const view = renderGameView({ refreshKey: 1 });
  await flush();
  expect(screen.queryByTestId('game-share')).toBeNull();
  serveEngine('unknown', true);
  view.rerenderGame({ refreshKey: 2 });
  await flush();
  expect(screen.getByTestId('game-share')).toBeTruthy();
});

it('has no Share button when the engine cannot be read', async () => {
  serveEngine(null);
  renderGameView();
  await flush();
  expect(screen.queryByTestId('game-share')).toBeNull();
});

it('keeps Share when the files change, without reading again', async () => {
  const view = renderGameView({ refreshKey: 1 });
  await flush();
  expect(screen.getByTestId('game-share')).toBeTruthy();
  const mock = serveEngine(null);
  view.rerenderGame({ refreshKey: 2 });
  await flush();
  expect(screen.getByTestId('game-share')).toBeTruthy();
  expect(mock.mock.calls.filter(([url]) => String(url).endsWith('/next-steps'))).toHaveLength(0);
});

it('appears once the files become a web game', async () => {
  serveEngine('godot');
  const view = renderGameView({ refreshKey: 1 });
  await flush();
  expect(screen.queryByTestId('game-share')).toBeNull();
  serveEngine('phaser');
  view.rerenderGame({ refreshKey: 2 });
  await flush();
  expect(screen.getByTestId('game-share')).toBeTruthy();
});

it('reads nothing and offers nothing for a viewer or a held project', async () => {
  const mock = serveEngine('phaser');
  renderGameView({ viewerOnly: true });
  await flush();
  expect(screen.queryByTestId('game-share')).toBeNull();
  expect(mock.mock.calls.filter(([url]) => String(url).endsWith('/next-steps'))).toHaveLength(0);
  cleanup();
  renderGameView({ probeHeld: true });
  await flush();
  expect(screen.queryByTestId('game-share')).toBeNull();
});

it('opens the dialog in the Chinese label and uses the project name for the title', async () => {
  renderGameView({ projectName: '史莱姆冲刺' }, 'zh-CN');
  await flush();
  fireEvent.click(gameToolbar().getByRole('button', { name: '分享' }));
  await flush();
  expect(screen.getByRole('dialog').querySelector('input')?.value).toBe('史莱姆冲刺');
});

it('returns focus to Share when the dialog closes', async () => {
  renderGameView();
  await flush();
  const share = screen.getByTestId('game-share');
  share.focus();
  fireEvent.click(share);
  await flush();
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(share));
  expect(screen.queryByRole('dialog')).toBeNull();
});
