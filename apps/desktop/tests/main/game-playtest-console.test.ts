import { expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { appendGameConsoleMessage, playtestFrameFits, PLAYTEST_FRAME_PROBE, PLAYTEST_FRAME_PROBE_RESUME } from '../../src/main/game-capture-playtest.js';
import type { GamePlaytestConsole } from '@openpixo/contracts';
it('keeps a late console error even after the message budget was filled by warnings', () => {
  const messages: GamePlaytestConsole[] = [];
  for (let i=0;i<220;i++) appendGameConsoleMessage(messages, { level:'warning',text:'warning',atMs:0 });
  appendGameConsoleMessage(messages, { level:'error',text:'late error',atMs:1 });
  expect(messages).toHaveLength(200);
  expect(messages.some(message=>message.level==='error' && message.text==='late error')).toBe(true);
});

// 2026-11-11 Sol roguelike run: a painted 1280x720 game made each frame about 1 MB of
// base64 PNG, and the playtest threw "Playtest frame data exceeds 16 MiB" with no result.
it('drops frames past the reply budget and keeps room for the labelled ones', () => {
  const mb = 1024 * 1024;
  // Periodic frames stop while three labelled frames are still to come.
  expect(playtestFrameFits(12 * mb, mb, false, 3)).toBe(true);
  expect(playtestFrameFits(13 * mb, mb, false, 3)).toBe(false);
  // A labelled frame uses the reserve; one that cannot fit is dropped, not thrown.
  expect(playtestFrameFits(15 * mb, mb, true, 0)).toBe(true);
  expect(playtestFrameFits(15.5 * mb, mb, true, 0)).toBe(false);
});

// 2026-11-11 Sol roguelike run: a playtest that reloaded the game to check its save was
// failed by the daemon for "no animation frame timing", because the reloaded document's
// probe started inactive.
it('keeps timing frames in a document the game reloads after the playtest started', () => {
  const callbacks: Array<(t: number) => void> = [];
  const window: Record<string, unknown> = {};
  const context = { window, requestAnimationFrame: (fn: (t: number) => void) => { callbacks.push(fn); return callbacks.length; } };
  // A new document after the start: the probe, then the resume script, in registration order.
  runInNewContext(PLAYTEST_FRAME_PROBE, context);
  runInNewContext(PLAYTEST_FRAME_PROBE_RESUME, context);
  for (let t = 16; t <= 64; t += 16) callbacks.shift()!(t);
  expect((window.__openpixoPlaytest as { times: number[] }).times).toEqual([16, 32, 48, 64]);
});
