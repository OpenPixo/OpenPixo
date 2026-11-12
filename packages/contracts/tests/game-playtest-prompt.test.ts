import { expect, it } from 'vitest';
import { renderGameVerificationBlock } from '../src/prompts/openpixo-game.js';
it('teaches the bounded playtest command while retaining evidence and screenshot honesty', () => {
  const block = renderGameVerificationBlock();
  expect(block.split('\n').filter(line => line.includes('game playtest'))).toEqual([
    '"$PIXO_NODE_BIN" "$PIXO_BIN" game playtest --script playtest.json --duration 8 --json',
    '"$PIXO_NODE_BIN" "$PIXO_BIN" game playtest --preset <id> [--seed <n>] --json',
    '"$PIXO_NODE_BIN" "$PIXO_BIN" game playtest --list-presets --json',
  ]);
  expect(block).toContain('Never say the game builds, runs, or is verified unless a step in this run exited 0 for it.');
  expect(block).toContain('playtest.console');
  expect(block).toContain('playtest.fps');
  expect(block).toContain('playtest.frames');
  expect(block).toMatchSnapshot();
});

// "Open every frame" put 182 full-size frames into one Codex conversation (about 158 MB
// per request) until OpenAI refused every turn; the overview shows the run in one image.
it('opens one overview per playtest and a single frame only for a detail', () => {
  const block = renderGameVerificationBlock();
  expect(block).not.toContain('Open every `playtest.frames[].path`');
  expect(block).toContain('Open `playtest.overview.path`');
  expect(block).toMatch(/Open a single `playtest\.frames\[\]\.path` only/);
  expect(block).toContain('stays in this conversation');
});

// Startup or a still screenshot used to count as done; a stage now ends with its loop driven by input.
it('defines playable as the core loop driven with real input: move, win, lose', () => {
  const block = renderGameVerificationBlock();
  expect(block).toContain('### What "playable" means');
  expect(block).toContain('drove its core loop with real input and the game answered');
  expect(block).toContain('Startup, a menu, a title screen or a still screenshot is not playable.');
  expect(block).toContain('End every build stage with that playtest: script inputs that move, win and lose.');
  expect(block).toContain('say in plain words what you tried and what happened');
  expect(block).toContain('Never call it playable.');
});
