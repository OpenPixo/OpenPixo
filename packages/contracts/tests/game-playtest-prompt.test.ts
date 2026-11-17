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

it('sizes the checking to the request: one verify and one look for a small change, then reply', () => {
  const block = renderGameVerificationBlock();
  // A one-line menu request ran 18 minutes polishing what nobody asked for (2026-11-15).
  expect(block).toContain('Size the checking to the request.');
  expect(block).toContain('Do not hunt for more to polish: put further ideas in the reply and let the user choose.');
  // Small requests stop early; a build stage keeps its playtest.
  expect(block).toContain('A build stage still ends with the playtest below.');
});

it('tests only the changed part and keeps one-off scripts and screenshots out of the game folder', () => {
  const block = renderGameVerificationBlock();
  // A menu redo replayed battle and pause and saved scripts and screenshots into the project (2026-11-16).
  expect(block).toContain('Test the part you changed (for a menu, open the menu and use it), not the rest of the game unless your change can affect it.');
  expect(block).toContain('Give a one-off playtest script on stdin (`--script -`) instead of saving it');
  expect(block).toContain('do not copy screenshots into the project unless the user asks');
});

it('says what a playtest costs, confirms changes with it and diagnoses from the code', () => {
  const block = renderGameVerificationBlock();
  // Flash ran three 50-second playtests to measure enemy speed before changing anything (2026-11-16).
  expect(block).toContain('takes 30 to 60 seconds that the user sits waiting, so plan for one per change.');
  expect(block).toContain('A playtest confirms a change; it is not how you find out what the code does.');
  expect(block).toContain('do not playtest before you have changed anything unless only running the game can tell');
  expect(block).toContain('Keep `--duration` as short as the script needs.');
  // Only a stage or a game must drive the whole loop; a fix playtests what it changed.
  expect(block).toContain('A stage or a game is playable only when');
  expect(block).toContain('A fix or a change to one part needs only the playtest of the part it changed, not this whole loop.');
});
