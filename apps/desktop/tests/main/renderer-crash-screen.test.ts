import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

vi.mock("@openpixo/contracts", async (importOriginal) => ({
  ...await importOriginal<typeof import("@openpixo/contracts")>(),
  PRODUCT_SUPPORT_EMAIL: "support@example.com",
  PRODUCT_ISSUES_URL: "https://github.com/test-author/game-workbench/issues",
}));

import { createRendererCrashHtml, isSupportMailtoUrl } from "../../src/main/runtime.js";

// The recovery screen the crash-loop breaker parks the window on. Its buttons
// reuse the preload's bridge, which exposes `openExternal` under `shell`
// (`window.__pixo__.shell.openExternal`, preload.cts). The page used to look for
// `host.openExternal`, so "Report a problem" and the email line were always
// hidden.

type FakeElement = {
  id: string;
  disabled: boolean;
  textContent: string;
  style: { display: string };
  listeners: Record<string, Array<(event: { preventDefault(): void }) => void>>;
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => void): void;
  click(): void;
};

function element(id: string): FakeElement {
  const el: FakeElement = {
    id,
    disabled: false,
    textContent: "",
    style: { display: "" },
    listeners: {},
    addEventListener(type, listener) {
      (el.listeners[type] ??= []).push(listener);
    },
    click() {
      for (const listener of el.listeners.click ?? []) listener({ preventDefault() {} });
    },
  };
  return el;
}

function renderCrashScreen() {
  const dataUrl = createRendererCrashHtml({
    appVersion: "1.0.11",
    platform: "win32",
    osVersion: "10.0.26200",
    reason: "crashed",
    exitCode: -1073741819,
  });
  const html = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!script) throw new Error("crash screen has no script");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!);
  const elements = new Map(ids.map((id) => [id, element(id)]));
  const openExternal = vi.fn(async () => ({ ok: true as const }));
  const exportDiagnostics = vi.fn(async () => ({ ok: true as const, path: "x.zip" }));
  // Same shape as the preload's `hostBridge` and diagnostics bridge.
  const window = { __pixo__: { shell: { openExternal } }, openPixoDesktop: { exportDiagnostics } };
  runInNewContext(script, {
    window,
    document: { getElementById: (id: string) => elements.get(id) ?? null },
    Promise,
  });
  return { elements, openExternal };
}

describe("renderer crash screen", () => {
  it("reads openExternal where the preload puts it", () => {
    const preload = readFileSync(new URL("../../src/main/preload.cts", import.meta.url), "utf8");
    expect(preload).toMatch(/const shell = \{\s*openExternal:/);
  });

  it("shows Report a problem and opens the prefilled issue", () => {
    const { elements, openExternal } = renderCrashScreen();
    const report = elements.get("report")!;
    expect(report.style.display).not.toBe("none");
    report.click();
    expect(openExternal).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/github\.com\/test-author\/game-workbench\/issues\/new\?/));
  });

  it("shows the email line and sends a mailto the main process accepts", () => {
    const { elements, openExternal } = renderCrashScreen();
    expect(elements.get("email-line")!.style.display).not.toBe("none");
    elements.get("email")!.click();
    expect(openExternal).toHaveBeenCalledTimes(1);
    const mailto = (openExternal.mock.calls[0] as unknown as [string])[0];
    expect(mailto.startsWith("mailto:support@example.com?")).toBe(true);
    // `shell:open-external` only opens a mailto that passes this check; a body
    // with line breaks is refused there, so the click would do nothing.
    expect(isSupportMailtoUrl(mailto)).toBe(true);
  });
});
