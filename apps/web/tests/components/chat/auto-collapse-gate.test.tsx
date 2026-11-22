// @vitest-environment jsdom
/**
 * A fold the reader did not ask for must not move the chat under them.
 *
 * During a run the execution record folds finished work: a tool row when its
 * call returns, a step drawer when the next step starts, the whole record when
 * the run concludes. Each fold makes the chat shorter. Measured in a real
 * browser with a reader a few hundred pixels above the bottom: one notch of the
 * wheel DOWN moved the view about 370px UP, because the chat became shorter
 * than the reader's position and the browser clamped it.
 *
 * So while the chat panel's gate is closed (the reader is not following the
 * bottom) an automatic fold waits, and it runs once the gate opens. Opening,
 * the user's own toggles and every caller outside a chat panel are unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { ChatMessage, PersistedAgentEvent } from '@openpixo/contracts';
import { I18nProvider } from '../../../src/i18n';
import { AssistantMessage } from '../../../src/components/AssistantMessage';
import { Foldable } from '../../../src/components/chat/primitives/Foldable';
import {
  AutoCollapseGateContext,
  createAutoCollapseGate,
} from '../../../src/components/chat/primitives/auto-collapse-gate';

afterEach(cleanup);

function makeGate(initiallyOpen: boolean) {
  let open = initiallyOpen;
  const gate = createAutoCollapseGate(() => open);
  return {
    gate,
    set(next: boolean) {
      open = next;
      act(() => gate.notify());
    },
  };
}

const fold = (): HTMLDetailsElement => {
  const el = document.querySelector<HTMLDetailsElement>('details');
  if (!el) throw new Error('Foldable did not render');
  return el;
};

/** The toggle the browser fires when React writes `open` back — not a click. */
const echoToggle = (el: HTMLDetailsElement): void => {
  fireEvent(el, new Event('toggle', { bubbles: false }));
};

const step = (gate: ReturnType<typeof makeGate>['gate'], running: boolean): ReactElement => (
  <AutoCollapseGateContext.Provider value={gate}>
    <Foldable summary={<span>Build part 1</span>} lifecycleOpen={running}>
      <p>tool output</p>
    </Foldable>
  </AutoCollapseGateContext.Provider>
);

describe('automatic folds wait for the reader', () => {
  it('a finished step stays open while the reader is away from the bottom', () => {
    const g = makeGate(false);
    const { rerender } = render(step(g.gate, true));
    echoToggle(fold());
    expect(fold().open).toBe(true);

    rerender(step(g.gate, false));
    expect(fold().open, 'folding now would pull the reader up').toBe(true);
  });

  it('the held fold runs once the reader is back at the bottom', () => {
    const g = makeGate(false);
    const { rerender } = render(step(g.gate, true));
    echoToggle(fold());
    rerender(step(g.gate, false));
    expect(fold().open).toBe(true);

    g.set(true);
    expect(fold().open).toBe(false);
  });

  it('folds at once while the reader follows the bottom, as before', () => {
    const g = makeGate(true);
    const { rerender } = render(step(g.gate, true));
    echoToggle(fold());
    rerender(step(g.gate, false));
    expect(fold().open).toBe(false);
  });

  it('opening a newly running step never waits', () => {
    const g = makeGate(false);
    const { rerender } = render(step(g.gate, false));
    rerender(step(g.gate, true));
    expect(fold().open).toBe(true);
  });

  it('a step the user opened by hand stays open when the gate opens', () => {
    const g = makeGate(false);
    const { rerender } = render(step(g.gate, false));
    // A real click: the DOM flips first, then the browser fires toggle.
    fold().open = true;
    echoToggle(fold());
    rerender(step(g.gate, false));
    g.set(true);
    expect(fold().open).toBe(true);
  });

  it('a held fold the user toggles by hand stops waiting', () => {
    const g = makeGate(false);
    const { rerender } = render(step(g.gate, true));
    echoToggle(fold());
    rerender(step(g.gate, false));
    // The user closes and reopens it themselves; their choice wins.
    fold().open = false;
    echoToggle(fold());
    fold().open = true;
    echoToggle(fold());
    g.set(true);
    expect(fold().open).toBe(true);
  });

  it('outside a chat panel there is no gate and folds behave as before', () => {
    const { rerender } = render(
      <Foldable summary={<span>step</span>} lifecycleOpen>
        <p>body</p>
      </Foldable>,
    );
    echoToggle(fold());
    rerender(
      <Foldable summary={<span>step</span>} lifecycleOpen={false}>
        <p>body</p>
      </Foldable>,
    );
    expect(fold().open).toBe(false);
  });
});

describe('the whole record waits too', () => {
  const T0 = 1_800_000_000_000;
  const KEY = 'a7f3c91ed2b40561';
  const BEFORE_DONE: PersistedAgentEvent[] = [
    { kind: 'done_key', key: KEY },
    { kind: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' }, startedAt: T0 + 1_000 },
    { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false, completedAt: T0 + 2_000 },
    { kind: 'text', text: 'Building the page.' },
  ];
  const AFTER_DONE: PersistedAgentEvent[] = [
    ...BEFORE_DONE,
    { kind: 'text', text: `<pixo-done key="${KEY}"/>Delivered page.html` },
  ];
  const live = (gate: ReturnType<typeof makeGate>['gate'], events: PersistedAgentEvent[]): ReactElement => {
    const message: ChatMessage = {
      id: 'm1', role: 'assistant', content: '', createdAt: T0, runStatus: 'running', events,
    };
    return (
      <I18nProvider initial="en">
        <AutoCollapseGateContext.Provider value={gate}>
          <AssistantMessage message={message} streaming />
        </AutoCollapseGateContext.Provider>
      </I18nProvider>
    );
  };
  const shellCard = (root: HTMLElement): HTMLDetailsElement => {
    const el = root.querySelector<HTMLDetailsElement>('details[class*="flat"]');
    if (!el) throw new Error('execution record did not render');
    return el;
  };

  it('stays open at done while the reader is away, and folds when they return', () => {
    const g = makeGate(false);
    const { container, rerender } = render(live(g.gate, BEFORE_DONE));
    echoToggle(shellCard(container));
    rerender(live(g.gate, AFTER_DONE));
    expect(shellCard(container).open).toBe(true);

    g.set(true);
    expect(shellCard(container).open).toBe(false);
  });

  it('folds at done while the reader follows the bottom, as before', () => {
    const g = makeGate(true);
    const { container, rerender } = render(live(g.gate, BEFORE_DONE));
    echoToggle(shellCard(container));
    rerender(live(g.gate, AFTER_DONE));
    expect(shellCard(container).open).toBe(false);
  });
});
