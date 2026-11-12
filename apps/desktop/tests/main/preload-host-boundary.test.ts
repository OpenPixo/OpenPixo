import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("desktop preload host boundary", () => {
  it("exposes the canonical OpenPixo host global and diagnostics bridge", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "../../src/main/preload.cts"), "utf8");
    const exposedGlobals = Array.from(source.matchAll(/contextBridge\.exposeInMainWorld\(([^,\n]+)/g))
      .map((match) => match[1]?.trim());
    const runtimeRequires = Array.from(source.matchAll(/require\((['"][^'"]+['"])\)/g))
      .map((match) => match[1]);

    expect(exposedGlobals).toEqual(["OPENPIXO_HOST_GLOBAL", "'openPixoDesktop'"]);
    expect(runtimeRequires).toEqual(["'electron'"]);
    expect(source).toContain("OPENPIXO_HOST_GLOBAL");
    expect(source).toContain("exportDiagnostics");
    expect(source).toContain("satisfies OpenPixoHostBridge");
    expect(source).toContain("browser");
    expect(source).toContain("browser:clear-data");
    expect(source).toContain("updater");
    // OS locale forwarded from main via webPreferences.additionalArguments
    // is mirrored onto __pixo__.client.osLocale. Pin the literal prefix
    // here so it can't drift away from `applyOsLocaleSwitch`/runtime's
    // additionalArguments without the test going red.
    expect(source).toContain("'--pixo-os-locale='");
    expect(source).toContain("osLocale");
    expect(source).toContain("invokeUpdater('install'");
    expect(source).toContain("invokeUpdater('clear-cache'");
    expect(source).toContain("pixo:update:quit");
    expect(source).toContain("pixo:update:status-changed");
    expect(source).toContain("pixo:update:open-dialog");
    expect(source).toContain("pixo:update:set-menu-labels");
    expect(source).toContain("subscribeOpenDialog");
    expect(source).toContain("pixo:app-config-changed");
    expect(source).toContain("pixo:app-config-changed");
    expect(source).toContain("window.dispatchEvent(new CustomEvent(APP_CONFIG_CHANGED_EVENT))");
    expect(source).not.toContain("@openpixo/contracts");
    expect(source).not.toContain("exposeInMainWorld('electronAPI'");
    expect(source).not.toContain('exposeInMainWorld("__pixoDesktop"');
    expect(source).not.toContain("exposeInMainWorld('__pixoDesktop'");
  });

  it("mirrors the host import contract by accepting a null entryFile", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "../../src/main/preload.cts"), "utf8");

    expect(source).toContain("response.entryFile === null");
    expect(source).toContain("entryFile === undefined");
  });
});
