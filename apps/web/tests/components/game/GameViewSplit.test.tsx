// @vitest-environment jsdom
// The divider between the 游戏 stage and its bottom area (调参 / 日志): it
// appears while a section is open, moves by keyboard and pointer, resets on
// double-click and is remembered per viewer.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderGameView } from './game-view-harness';
import { GAME_SPLIT_DEFAULT, GAME_SPLIT_KEYBOARD_STEP, GAME_SPLIT_STORAGE_KEY } from '../../../src/components/panel/game-split';

vi.mock('../../../src/components/tuning/tuning-api', () => ({ listGameTuning: vi.fn(async () => ({ parameters: [], warnings: [] })) }));
vi.mock('../../../src/providers/publish', () => ({ fetchProjectEngine: vi.fn(async () => 'godot') }));

const runOnly = { controls: { verifyAvailable: false, startRequest: null } };
const flush = async () => { await act(async () => {}); };

// jsdom has no PointerEvent, so fireEvent's init would lose clientY and pointerId.
function pointer(target: Element, type: string, init: { clientY?: number; pointerId?: number }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY: init.clientY ?? 0 });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  fireEvent(target, event);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => { run(0); return 1; });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'exited', engine: 'phaser', logTail: 'vite ready in 300 ms' })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function openLogs(locale: 'en' | 'zh-CN' = 'en') {
  renderGameView(runOnly, locale);
  await flush();
  expect(screen.queryByRole('separator')).toBeNull();
  fireEvent.click(screen.getByTestId('panel-game-logs-toggle'));
  return screen.getByRole('separator');
}

const bottomHeight = () => screen.getByTestId('panel-game-bottom').parentElement!.style.getPropertyValue('--game-panel-height');

it('shows a labelled horizontal divider only while a bottom section is open', async () => {
  const handle = await openLogs('zh-CN');
  expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
  expect(handle.getAttribute('aria-label')).toBe('调整游戏画面与下方面板的高度');
  expect(handle.getAttribute('tabindex')).toBe('0');
  expect(handle.getAttribute('aria-valuenow')).toBe(String(GAME_SPLIT_DEFAULT));
  expect(screen.getByTestId('panel-game-bottom').getAttribute('data-split')).toBe('true');
  fireEvent.click(screen.getByTestId('panel-game-logs-toggle'));
  expect(screen.queryByRole('separator')).toBeNull();
  expect(screen.getByTestId('panel-game-bottom').getAttribute('data-split')).toBeNull();
});

it('moves with the arrow keys, remembers the height and resets on double-click', async () => {
  const handle = await openLogs();
  fireEvent.keyDown(handle, { key: 'ArrowUp' });
  const raised = GAME_SPLIT_DEFAULT + GAME_SPLIT_KEYBOARD_STEP;
  expect(handle.getAttribute('aria-valuenow')).toBe(String(raised));
  expect(bottomHeight()).toBe(`${raised}px`);
  expect(window.localStorage.getItem(GAME_SPLIT_STORAGE_KEY)).toBe(String(raised));
  fireEvent.doubleClick(handle);
  expect(handle.getAttribute('aria-valuenow')).toBe(String(GAME_SPLIT_DEFAULT));
  expect(window.localStorage.getItem(GAME_SPLIT_STORAGE_KEY)).toBeNull();
});

it('follows a pointer drag, blocks iframes while dragging and commits on release', async () => {
  const handle = await openLogs();
  const rootClasses = document.documentElement.classList.length;
  pointer(handle, 'pointerdown', { clientY: 500 });
  expect(document.documentElement.classList.length).toBe(rootClasses + 1);
  pointer(handle, 'pointermove', { clientY: 400 });
  expect(bottomHeight()).toBe(`${GAME_SPLIT_DEFAULT + 100}px`);
  pointer(handle, 'pointerup', { clientY: 400 });
  expect(document.documentElement.classList.length).toBe(rootClasses);
  expect(handle.getAttribute('aria-valuenow')).toBe(String(GAME_SPLIT_DEFAULT + 100));
  expect(window.localStorage.getItem(GAME_SPLIT_STORAGE_KEY)).toBe(String(GAME_SPLIT_DEFAULT + 100));
});

it('restores a remembered height and still renders when storage throws', async () => {
  window.localStorage.setItem(GAME_SPLIT_STORAGE_KEY, '360');
  const handle = await openLogs();
  expect(handle.getAttribute('aria-valuenow')).toBe('360');
  cleanup();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  const fallback = await openLogs();
  expect(fallback.getAttribute('aria-valuenow')).toBe(String(GAME_SPLIT_DEFAULT));
  fireEvent.keyDown(fallback, { key: 'ArrowUp' });
  expect(fallback.getAttribute('aria-valuenow')).toBe(String(GAME_SPLIT_DEFAULT + GAME_SPLIT_KEYBOARD_STEP));
  vi.restoreAllMocks();
});
