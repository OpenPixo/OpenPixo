/**
 * What may load in an OpenPixo window, what may open one, and who may call the
 * privileged host IPC.
 *
 * Only the main window's main frame runs the preload (`window.__pixo__`, the
 * diagnostics bridge). Everything here keeps it that way: the main window
 * stays on the app's own origin, popups and `<webview>` guests get no preload,
 * and host IPC refuses any other sender. The policies are pure so tests pin
 * them without Electron; `runtime.ts` wires them.
 */

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isAllowedChildWindowUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // `blob:` covers in-renderer generated previews / object URLs.
    // `openpixo:` is the packaged Electron entry's privileged scheme
    // registered by `apps/packaged/src/protocol.ts` and proxied to the local
    // web sidecar: an in-app `<a target="_blank" href="/api/...">` resolves to
    // `openpixo://app/...` in packaged builds and must open in a child window
    // (#911, "Open artifact"). Dev links resolve to `http://127.0.0.1:...` and
    // go to the user's browser through the `isHttpUrl` branch instead.
    // `about:blank` is the share flow's and PDF fallback's empty window, which
    // is then pointed at its real address.
    // The child window gets no preload and no `<webview>` (see
    // `CHILD_WINDOW_WEB_PREFERENCES`), so what loads there cannot reach host IPC.
    return (
      parsed.protocol === "blob:" ||
      parsed.protocol === "openpixo:" ||
      (parsed.protocol === "about:" && parsed.pathname === "blank")
    );
  } catch {
    return false;
  }
}

/**
 * Same scheme and host (host includes the port). Compared by hand because the
 * WHATWG `origin` of a non-special scheme such as `openpixo://app/` is the
 * opaque `"null"`, which would make every packaged URL "same origin".
 */
export function isSameAppOrigin(url: string, appUrl: string | null): boolean {
  if (appUrl == null) return false;
  try {
    const next = new URL(url);
    const app = new URL(appUrl);
    return next.protocol === app.protocol && next.host === app.host && next.host !== "";
  } catch {
    return false;
  }
}

export type NavigationDecision = "allow" | "external" | "block";

/**
 * A navigation the main window's page starts itself (a link, `location = …`,
 * a server redirect). Only the app's own origin loads there, because whatever
 * loads there gets the preload. Another http(s) page goes to the user's
 * browser; everything else (`blob:`, another `openpixo://` host, `file:`,
 * `data:`, custom schemes) is cancelled. First-party `mailto:` is handled
 * before this by the caller.
 */
export function decideMainWindowNavigation(url: string, appUrl: string | null): NavigationDecision {
  if (isSameAppOrigin(url, appUrl)) return "allow";
  return isHttpUrl(url) ? "external" : "block";
}

/** A navigation inside a popup the main window opened. */
export function decideChildWindowNavigation(url: string): NavigationDecision {
  if (isAllowedChildWindowUrl(url)) return "allow";
  return isHttpUrl(url) ? "external" : "block";
}

/**
 * The web preferences every popup is created with. Electron 41 already gives a
 * `window.open` child neither the opener's preload nor `<webview>`, and ignores
 * those keys in window features; stating them here keeps that true if a future
 * Electron or a new `BrowserWindow` default changes it. `preload: undefined`
 * overrides anything inherited.
 */
export const CHILD_WINDOW_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  preload: undefined,
  sandbox: true,
  webviewTag: false,
} as const;

/** The answer `setWindowOpenHandler` gives a popup the main window may open. */
export function allowChildWindow(): {
  action: "allow";
  overrideBrowserWindowOptions: { webPreferences: typeof CHILD_WINDOW_WEB_PREFERENCES };
} {
  return {
    action: "allow",
    overrideBrowserWindowOptions: { webPreferences: { ...CHILD_WINDOW_WEB_PREFERENCES } },
  };
}

type NavigationEvent = { preventDefault(): void };
type RedirectDetails = NavigationEvent & { url: string; isMainFrame: boolean };

/** The part of `WebContents` the guards touch. */
export interface GuardedWebContents {
  readonly id: number;
  getType(): string;
  getURL(): string;
  isDestroyed(): boolean;
  close?(): void;
  on(event: "will-attach-webview", listener: (event: NavigationEvent) => void): unknown;
  on(event: "will-navigate", listener: (event: NavigationEvent, url: string) => void): unknown;
  on(event: "will-redirect", listener: (details: RedirectDetails) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
}

export interface WebContentsGuardOptions {
  /** Only the main window hosts `<webview>`; its own handler vets the guest. */
  canHostWebviews(contents: GuardedWebContents): boolean;
}

/** Popups open nothing themselves; a web link goes to the user's browser. */
function denyWindowOpen(openExternal: (url: string) => unknown) {
  return ({ url }: { url: string }): { action: "deny" } => {
    if (isHttpUrl(url)) void Promise.resolve(openExternal(url)).catch(() => undefined);
    return { action: "deny" };
  };
}

/**
 * Applied to every WebContents the app creates (`app.on("web-contents-created")`),
 * before any page script runs:
 * - only the main window may attach a `<webview>`;
 * - nothing may open a window unless its owner says otherwise (the main window,
 *   the capture windows and the design-browser guests all install their own
 *   handler after this one);
 * - no page may navigate its window to `file:`, `data:`, `javascript:` or a
 *   scheme the app does not serve. Owners narrow this further.
 */
export function guardWebContents(contents: GuardedWebContents, options: WebContentsGuardOptions): void {
  // Pages live in windows and webview guests; DevTools and other internal
  // WebContents load Chromium's own schemes and are left alone.
  const type = contents.getType();
  if (type !== "window" && type !== "webview") return;
  contents.on("will-attach-webview", (event) => {
    if (!options.canHostWebviews(contents)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!isServedScheme(url)) event.preventDefault();
  });
}

const SERVED_SCHEMES = new Set(["http:", "https:", "openpixo:", "blob:", "about:", "mailto:"]);

function isServedScheme(url: string): boolean {
  try {
    return SERVED_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * The navigation policy of a popup the main window opened (`did-create-window`).
 * It stays on blob/openpixo/about:blank content; a web page it is pointed at
 * (the share flow opens `about:blank`, then sets its address) opens in the
 * user's browser, and a popup left empty by that is closed.
 */
export function guardChildWindow(contents: GuardedWebContents, openExternal: (url: string) => unknown): void {
  const handle = (event: NavigationEvent, url: string): void => {
    const decision = decideChildWindowNavigation(url);
    if (decision === "allow") return;
    event.preventDefault();
    if (decision !== "external") return;
    void Promise.resolve(openExternal(url)).catch(() => undefined);
    const current = contents.getURL();
    if ((current === "" || current === "about:blank") && !contents.isDestroyed()) contents.close?.();
  };
  contents.on("will-navigate", handle);
  contents.on("will-redirect", (details) => {
    if (details.isMainFrame) handle(details, details.url);
  });
  contents.setWindowOpenHandler(denyWindowOpen(openExternal));
}

/** The part of an IPC event the sender check reads. */
export interface HostIpcEvent {
  sender: { id: number; isDestroyed(): boolean; mainFrame: unknown };
  senderFrame?: unknown;
}

/**
 * Privileged host IPC answers only the main window's top frame. Subframes never
 * get the preload, but `ipcRenderer` traffic is checked here anyway: a frame
 * that is gone (`senderFrame` null) or is not the top frame is refused, and so
 * is any other WebContents (splash, popups, capture windows, webview guests).
 */
export function isHostMainFrameSender(event: HostIpcEvent, ownsWebContents: (id: number) => boolean): boolean {
  const sender = event.sender;
  if (sender.isDestroyed() || !ownsWebContents(sender.id)) return false;
  return event.senderFrame != null && event.senderFrame === sender.mainFrame;
}
