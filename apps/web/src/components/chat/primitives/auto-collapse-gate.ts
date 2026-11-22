/**
 * When an automatic collapse may run without moving what the reader is looking at.
 *
 * During a run the execution record folds itself as work finishes: a tool row
 * when its call returns, a step drawer when the next step starts, the whole
 * record when the run concludes. Each fold makes the chat shorter. A reader
 * who is following the newest output does not notice, because the bottom pin
 * keeps them at the bottom. A reader who has scrolled even a little way up
 * does: once the chat gets shorter than their position, the browser clamps
 * `scrollTop` to the new bottom, and the view snaps upward — often while they
 * are scrolling down. Measured in a real browser: one notch down moved the
 * view about 370px up, and a real step with long tool output moves it far more.
 *
 * So a fold the reader did not ask for waits until it cannot move their view:
 * the chat panel opens the gate while the reader follows the bottom (or the
 * new turn is pinned to the top, where the reserved space absorbs the change),
 * and the waiting folds run then. A fold the user makes by hand is never held.
 *
 * Outside a chat panel there is no reader to protect, so the default gate is
 * always open and every caller behaves as it did before.
 */
import { createContext, useContext, useEffect } from 'react';

export interface AutoCollapseGate {
  /** May an automatic collapse run now? */
  allows(): boolean;
  /** Called whenever `allows()` may have changed. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export const ALWAYS_ALLOW_AUTO_COLLAPSE: AutoCollapseGate = {
  allows: () => true,
  subscribe: () => () => undefined,
};

export const AutoCollapseGateContext = createContext<AutoCollapseGate>(ALWAYS_ALLOW_AUTO_COLLAPSE);

/**
 * A gate backed by a predicate the owner re-reads. The owner calls `notify()`
 * after anything that can change the answer. Waiting folds unsubscribe as
 * soon as they run, so with nothing waiting a call costs one predicate read.
 */
export function createAutoCollapseGate(
  allows: () => boolean,
): AutoCollapseGate & { notify(): void } {
  const listeners = new Set<() => void>();
  return {
    allows,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify() {
      if (listeners.size === 0 || !allows()) return;
      for (const listener of [...listeners]) listener();
    },
  };
}

/**
 * Follows a lifecycle-driven open state: opens at once, folds only when the
 * gate allows it. `userToggled` ends the following for good, as before.
 */
export function useLifecycleOpen(
  lifecycleOpen: boolean | null | undefined,
  userToggled: boolean,
  setOpen: (open: boolean) => void,
): void {
  const gate = useContext(AutoCollapseGateContext);
  useEffect(() => {
    if (lifecycleOpen == null || userToggled) return undefined;
    if (lifecycleOpen || gate.allows()) {
      setOpen(lifecycleOpen);
      return undefined;
    }
    const unsubscribe = gate.subscribe(() => {
      if (!gate.allows()) return;
      unsubscribe();
      setOpen(false);
    });
    return unsubscribe;
  }, [gate, lifecycleOpen, setOpen, userToggled]);
}
