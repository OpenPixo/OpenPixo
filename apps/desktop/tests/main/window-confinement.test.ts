import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  allowChildWindow,
  decideChildWindowNavigation,
  decideMainWindowNavigation,
  guardChildWindow,
  guardWebContents,
  isHostMainFrameSender,
  type GuardedWebContents,
} from "../../src/main/window-confinement.js";

// Review 2.6: only the main window's top frame may hold the preload
// (`window.__pixo__`), so its page must not navigate itself to content the app
// does not serve, popups must open without the preload or `<webview>`, and
// privileged host IPC must refuse every other sender.

type Listener = (...args: any[]) => void;

function fakeContents(input: { id?: number; type?: string; url?: string } = {}) {
  const listeners = new Map<string, Listener[]>();
  let openHandler: ((details: { url: string }) => { action: string }) | null = null;
  const contents = {
    id: input.id ?? 7,
    url: input.url ?? "about:blank",
    getType: () => input.type ?? "window",
    getURL: () => contents.url,
    isDestroyed: () => false,
    close: vi.fn(),
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return contents;
    },
    setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
      openHandler = handler;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    open(url: string) {
      return openHandler?.({ url });
    },
  };
  return contents;
}

function navigation() {
  return { preventDefault: vi.fn() };
}

describe("main window navigation", () => {
  it("keeps the app's own origin, packaged and dev", () => {
    expect(decideMainWindowNavigation("openpixo://app/projects/1", "openpixo://app/")).toBe("allow");
    expect(decideMainWindowNavigation("http://127.0.0.1:17573/home", "http://127.0.0.1:17573/")).toBe("allow");
  });

  it("sends other web pages to the user's browser", () => {
    expect(decideMainWindowNavigation("https://example.com/", "openpixo://app/")).toBe("external");
    expect(decideMainWindowNavigation("http://127.0.0.1:9999/", "http://127.0.0.1:17573/")).toBe("external");
  });

  it("cancels everything else instead of letting it load beside the preload", () => {
    // Electron 41 follows these from the page and keeps `window.__pixo__`.
    expect(decideMainWindowNavigation("blob:openpixo://app/2f1c", "openpixo://app/")).toBe("block");
    expect(decideMainWindowNavigation("openpixo://other/", "openpixo://app/")).toBe("block");
    expect(decideMainWindowNavigation("file:///C:/Windows/win.ini", "openpixo://app/")).toBe("block");
    expect(decideMainWindowNavigation("data:text/html,<p>x</p>", "openpixo://app/")).toBe("block");
    expect(decideMainWindowNavigation("javascript:alert(1)", "openpixo://app/")).toBe("block");
    // No app loaded yet (or the crash screen is up): nothing but the browser hand-off.
    expect(decideMainWindowNavigation("openpixo://app/", null)).toBe("block");
    expect(decideMainWindowNavigation("https://example.com/", null)).toBe("external");
  });
});

describe("popups", () => {
  it("open with no preload, no webview and the sandbox on", () => {
    const answer = allowChildWindow();
    expect(answer.action).toBe("allow");
    const prefs = answer.overrideBrowserWindowOptions.webPreferences;
    expect(prefs).toHaveProperty("preload", undefined);
    expect(prefs).toMatchObject({ webviewTag: false, sandbox: true, contextIsolation: true, nodeIntegration: false });
  });

  it("stay on blob, openpixo and blank pages; a web page opens in the browser", () => {
    expect(decideChildWindowNavigation("blob:openpixo://app/1")).toBe("allow");
    expect(decideChildWindowNavigation("openpixo://app/api/x")).toBe("allow");
    expect(decideChildWindowNavigation("about:blank")).toBe("allow");
    expect(decideChildWindowNavigation("https://x.com/intent")).toBe("external");
    expect(decideChildWindowNavigation("file:///C:/")).toBe("block");
  });

  it("hand the share flow's web page to the browser and close the empty popup", () => {
    const child = fakeContents({ url: "about:blank" });
    const openExternal = vi.fn();
    guardChildWindow(child as unknown as GuardedWebContents, openExternal);

    const share = navigation();
    child.emit("will-navigate", share, "https://x.com/intent/post");
    expect(share.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith("https://x.com/intent/post");
    expect(child.close).toHaveBeenCalled();

    const local = navigation();
    child.emit("will-navigate", local, "file:///C:/Windows/win.ini");
    expect(local.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledTimes(1);

    const preview = navigation();
    child.emit("will-navigate", preview, "blob:openpixo://app/1");
    expect(preview.preventDefault).not.toHaveBeenCalled();

    const redirect = { ...navigation(), url: "file:///C:/", isMainFrame: true };
    child.emit("will-redirect", redirect);
    expect(redirect.preventDefault).toHaveBeenCalled();

    expect(child.open("https://example.com/")).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenLastCalledWith("https://example.com/");
    expect(child.open("openpixo://app/x")).toEqual({ action: "deny" });
  });
});

describe("guards on every WebContents", () => {
  it("lets only the main window attach a webview", () => {
    const main = fakeContents({ id: 1 });
    const popup = fakeContents({ id: 2 });
    const options = { canHostWebviews: (c: GuardedWebContents) => c.id === 1 };
    guardWebContents(main as unknown as GuardedWebContents, options);
    guardWebContents(popup as unknown as GuardedWebContents, options);

    const fromMain = navigation();
    main.emit("will-attach-webview", fromMain);
    expect(fromMain.preventDefault).not.toHaveBeenCalled();
    const fromPopup = navigation();
    popup.emit("will-attach-webview", fromPopup);
    expect(fromPopup.preventDefault).toHaveBeenCalled();
  });

  it("opens no window until the owner says otherwise and never navigates to an unserved scheme", () => {
    const contents = fakeContents();
    guardWebContents(contents as unknown as GuardedWebContents, { canHostWebviews: () => false });
    expect(contents.open("openpixo://app/")).toEqual({ action: "deny" });
    for (const url of ["file:///C:/", "data:text/html,x", "javascript:alert(1)", "chrome://gpu"]) {
      const event = navigation();
      contents.emit("will-navigate", event, url);
      expect(event.preventDefault, url).toHaveBeenCalled();
    }
    const game = navigation();
    contents.emit("will-navigate", game, "http://127.0.0.1:5173/");
    expect(game.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves DevTools and other internal WebContents alone", () => {
    const devtools = fakeContents({ type: "remote" });
    guardWebContents(devtools as unknown as GuardedWebContents, { canHostWebviews: () => false });
    const event = navigation();
    devtools.emit("will-navigate", event, "devtools://devtools/bundled/inspector.html");
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(devtools.open("https://example.com/")).toBeUndefined();
  });
});

describe("host IPC senders", () => {
  const mainFrame = { name: "main" };
  const sender = { id: 1, isDestroyed: () => false, mainFrame };
  const owns = (id: number) => id === 1;

  it("accepts only the main window's top frame", () => {
    expect(isHostMainFrameSender({ sender, senderFrame: mainFrame }, owns)).toBe(true);
    expect(isHostMainFrameSender({ sender, senderFrame: { name: "iframe" } }, owns)).toBe(false);
    expect(isHostMainFrameSender({ sender, senderFrame: null }, owns)).toBe(false);
    expect(isHostMainFrameSender({ sender: { ...sender, id: 2 }, senderFrame: mainFrame }, owns)).toBe(false);
    expect(isHostMainFrameSender({ sender: { ...sender, isDestroyed: () => true }, senderFrame: mainFrame }, owns)).toBe(false);
  });
});

describe("runtime wiring", () => {
  const runtime = readFileSync(new URL("../../src/main/runtime.ts", import.meta.url), "utf8").replace(/\r\n?/g, "\n");

  function handlerBodies(pattern: RegExp): Array<{ channel: string; body: string }> {
    const starts = [...runtime.matchAll(pattern)];
    return starts.map((match, index) => {
      const end = index + 1 < starts.length ? starts[index + 1]!.index! : runtime.length;
      return { channel: match[1]!, body: runtime.slice(match.index!, Math.min(end, match.index! + 1200)) };
    });
  }

  it("checks the sender in every privileged handler before it does anything", () => {
    const handlers = handlerBodies(/ipcMain\.(?:handle|on)\(\s*['"]([^'"]+)['"]/g);
    expect(handlers.map((h) => h.channel)).toEqual(expect.arrayContaining([
      "shell:open-external", "shell:open-path", "shell:show-item-in-folder",
      "dialog:pick-and-import", "dialog:pick-and-replace-working-dir", "dialog:pick-working-dir",
      "dialog:authorize-game-parent", "pixo:print-pdf", "pixo:capture-page", "browser:clear-data",
    ]));
    for (const { channel, body } of handlers) {
      const firstStatement = body.slice(body.indexOf("=>") + 2).trim().slice(0, 200);
      expect(firstStatement, channel).toMatch(/^\{\s*(?:\/\/[^\n]*\n\s*)*(?:requireHostSender\(event\)|if \(!isHostSender\(event\))/);
    }
  });

  it("guards every WebContents and opens popups without the preload", () => {
    expect(runtime).toContain('app.on("web-contents-created"');
    const openHandler = runtime.slice(runtime.indexOf("window.webContents.setWindowOpenHandler("));
    expect(openHandler.slice(0, 300)).toContain("allowChildWindow()");
    expect(runtime).toContain('window.webContents.on("did-create-window"');
  });

  it("decides every main-window navigation and redirect by the allowlist", () => {
    const leave = runtime.slice(runtime.indexOf("const leaveMainWindow = "));
    expect(leave.slice(0, 400)).toContain('decideMainWindowNavigation(url, currentUrl ?? pendingUrl) === "allow"');
    const willNavigate = runtime.slice(runtime.indexOf('window.webContents.on("will-navigate"'));
    expect(willNavigate.slice(0, 1200)).toContain("leaveMainWindow(event, url)");
    expect(willNavigate.slice(0, 1200)).not.toContain("if (!isHttpUrl(url)");
    const willRedirect = runtime.slice(runtime.indexOf('window.webContents.on("will-redirect"'));
    expect(willRedirect.slice(0, 200)).toContain("leaveMainWindow(details, details.url)");
  });
});
