/**
 * What is on screen, for playtests: `window.storyKit.state()` in the browser
 * console, or from a Playwright script. Read-only; it never changes the game.
 */
export interface InspectState {
  screen: 'title' | 'story' | 'pause' | 'settings';
  [key: string]: unknown;
}

const providers = new Map<string, () => Record<string, unknown>>();

export function provide(screen: InspectState['screen'], state: () => Record<string, unknown>): void {
  providers.set(screen, state);
}

export function withdraw(screen: InspectState['screen']): void {
  providers.delete(screen);
}

declare global {
  interface Window { storyKit: { state(): InspectState[] } }
}

/** One entry per screen showing, the topmost last. */
window.storyKit = {
  state: () => [...providers].map(([screen, state]) => ({ screen, ...state() }) as InspectState),
};
