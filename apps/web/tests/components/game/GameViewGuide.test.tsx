// @vitest-environment jsdom
// What the 游戏 view does for the first-login walkthrough: says how the run is
// going, opens 调参 for a step, and tells playing from a game that merely started.
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GameRunStatus, GameTuningParameter } from '@openpixo/contracts';
import type { GameViewGuide } from '../../../src/components/first-run/ProjectGuide';
import { renderGameView, routeFetch } from './game-view-harness';

const parameter = (key: string) => ({ id: key, key, label: key, group: 'Player', owner: '', type: 'int', source: 'web-json', value: 460,
  defaultValue: 460, literal: '460', min: 100, max: 800, step: 10, filePath: 'src/tuning.json', line: 1, fileHash: 'h' }) as unknown as GameTuningParameter;
const { updateGameTuning } = vi.hoisted(() => ({ updateGameTuning: vi.fn() }));
vi.mock('../../../src/components/tuning/tuning-api', () => ({
  listGameTuning: vi.fn(async () => ({ parameters: [parameter('playerSpeed'), parameter('jumpPower')], warnings: [] })),
  updateGameTuning,
  readTuningGameRun: vi.fn(async () => ({ status: 'idle' })),
  tuningPreviewUrl: () => null,
  TuningRequestError: class extends Error { code = 'x'; },
}));
vi.mock('../../../src/providers/publish', () => ({ fetchProjectEngine: vi.fn(async () => 'phaser') }));

let run: GameRunStatus;
const renderGuide = vi.fn((state: string) => <p data-testid="guide">{state}</p>);
const onPlayed = vi.fn();
const onTuned = vi.fn();
const controls = (guide: Partial<GameViewGuide> = {}) => ({ controls: { verifyAvailable: false, startRequest: null,
  guide: { render: renderGuide, stageRing: null, tuning: null, onPlayed, onTuned, ...guide } } });

beforeEach(() => {
  run = { status: 'running', engine: 'phaser', url: 'http://127.0.0.1:5173/' };
  vi.stubGlobal('fetch', routeFetch((path, method) => path.endsWith('/game/run') && method === 'GET' ? Response.json(run) : undefined));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('tells the card how the run is going and rings only a game that can be played', async () => {
  run = { status: 'starting', engine: 'phaser' };
  const view = renderGameView(controls({ stageRing: 'ring' }));
  await waitFor(() => expect(screen.getByTestId('guide').textContent).toBe('starting'));
  expect(screen.getByTestId('panel-game-stage').className).not.toContain('ring');
  cleanup();

  run = { status: 'failed', engine: 'phaser', reasonCode: 'START_FAILED' };
  renderGameView(controls());
  await waitFor(() => expect(screen.getByTestId('guide').textContent).toBe('failed'));
  cleanup();

  run = { status: 'running', engine: 'phaser', url: 'http://127.0.0.1:5173/' };
  renderGameView(controls({ stageRing: 'ring' }));
  await waitFor(() => expect(screen.getByTestId('guide').textContent).toBe('running'));
  expect(screen.getByTestId('panel-game-stage').className).toContain('ring');
  void view;
});

it('counts as playing only after the game has held the focus for a while', async () => {
  vi.useFakeTimers();
  renderGameView(controls());
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const frame = screen.getByTestId('panel-game-frame') as HTMLIFrameElement;
  // Many engines take the focus when they start: that moment is not playing.
  act(() => frame.focus());
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
  expect(onPlayed).not.toHaveBeenCalled();
  // Time spent elsewhere does not count.
  act(() => frame.blur());
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(onPlayed).not.toHaveBeenCalled();
  act(() => frame.focus());
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(onPlayed).toHaveBeenCalled();
});

it('opens 调参 for the step, rings its setting and reports a saved change', async () => {
  updateGameTuning.mockResolvedValue({ parameter: { ...parameter('jumpPower'), value: 700, fileHash: 'h2' } });
  renderGameView(controls({ tuning: { key: 'jumpPower', ring: 'ring' } }));
  const sliders = await screen.findAllByRole('slider');
  expect(screen.getByTestId('panel-game-tuning-toggle').getAttribute('aria-expanded')).toBe('true');
  const rows = [...document.querySelectorAll('[data-type="int"]')];
  expect(rows.map((row) => row.className.includes('ring'))).toEqual([false, true]);
  fireEvent.change(sliders[1]!, { target: { value: '700' } });
  expect(onTuned).not.toHaveBeenCalled();
  await waitFor(() => expect(onTuned).toHaveBeenCalledOnce(), { timeout: 3_000 });
  // The user may close it; the step does not force it open again.
  fireEvent.click(screen.getByTestId('panel-game-tuning-toggle'));
  expect(screen.getByTestId('panel-game-tuning-toggle').getAttribute('aria-expanded')).toBe('false');
});
