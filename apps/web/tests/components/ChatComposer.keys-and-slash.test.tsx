// @vitest-environment jsdom
/**
 * The keys and commands Codex and Claude Code users reach for:
 * - Escape stops a running turn, and does nothing while idle;
 * - ↑ in an empty box brings back earlier prompts, ↓ goes forward again, and
 *   once the box holds the user's own text the arrows are left to the caret;
 * - a host slash command runs when picked and leaves no `/…` behind.
 */
import type { ComponentProps } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { KEY_ARROW_DOWN_COMMAND, KEY_ARROW_UP_COMMAND, KEY_ESCAPE_COMMAND, type LexicalCommand } from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from '../../src/components/ChatComposer';
import { composerText, flushMounts, getComposerEditor, pressEnter, typeInComposer } from '../helpers/lexical-composer';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(overrides: Partial<ComponentProps<typeof ChatComposer>> = {}) {
  const props = {
    projectId: 'p1',
    projectFiles: [],
    streaming: false,
    onEnsureProject: vi.fn(async () => 'p1'),
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
  return { ...render(<ChatComposer {...props} />), props };
}

/** Dispatches a key the way Lexical's keydown listener does; true when something handled it. */
function press(command: LexicalCommand<KeyboardEvent>, key: string): boolean {
  let handled = false;
  act(() => {
    handled = getComposerEditor().dispatchCommand(command, new KeyboardEvent('keydown', { key, cancelable: true }));
  });
  return handled;
}

describe('Escape', () => {
  it('stops the running turn', async () => {
    const { props } = setup({ streaming: true });
    await flushMounts();
    expect(press(KEY_ESCAPE_COMMAND, 'Escape')).toBe(true);
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it('does nothing while no turn is running', async () => {
    const { props } = setup();
    await flushMounts();
    expect(press(KEY_ESCAPE_COMMAND, 'Escape')).toBe(false);
    expect(props.onStop).not.toHaveBeenCalled();
  });
});

describe('↑ / ↓ prompt recall', () => {
  const promptHistory = ['add a title screen', 'make the title bigger'];

  it('walks back through earlier prompts and forward to an empty box', async () => {
    setup({ promptHistory });
    await flushMounts();
    expect(press(KEY_ARROW_UP_COMMAND, 'ArrowUp')).toBe(true);
    expect(composerText()).toBe('make the title bigger');
    press(KEY_ARROW_UP_COMMAND, 'ArrowUp');
    expect(composerText()).toBe('add a title screen');
    // At the oldest prompt ↑ stays put rather than moving the caret away.
    expect(press(KEY_ARROW_UP_COMMAND, 'ArrowUp')).toBe(true);
    expect(composerText()).toBe('add a title screen');
    press(KEY_ARROW_DOWN_COMMAND, 'ArrowDown');
    expect(composerText()).toBe('make the title bigger');
    press(KEY_ARROW_DOWN_COMMAND, 'ArrowDown');
    expect(composerText().trim()).toBe('');
  });

  it('leaves the arrows to the caret once the box holds the user’s own text', async () => {
    setup({ promptHistory });
    await flushMounts();
    typeInComposer('half a thought');
    expect(press(KEY_ARROW_UP_COMMAND, 'ArrowUp')).toBe(false);
    expect(composerText()).toBe('half a thought');
    expect(press(KEY_ARROW_DOWN_COMMAND, 'ArrowDown')).toBe(false);
  });
});

describe('host slash commands', () => {
  it('runs the picked command and leaves no /… in the box', async () => {
    const run = vi.fn();
    const { props } = setup({ slashActions: [{ id: 'verify', label: '/verify', descKey: 'composer.slashVerify', icon: 'check', run }] });
    await flushMounts();
    typeInComposer('/veri');
    await flushMounts();
    expect(screen.getByTestId('slash-popover')).toBeInTheDocument();
    pressEnter();
    expect(run).toHaveBeenCalledTimes(1);
    expect(composerText().trim()).toBe('');
    expect(props.onSend).not.toHaveBeenCalled();
  });
});
