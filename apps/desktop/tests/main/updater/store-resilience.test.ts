import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopUpdaterConfig } from "../../../src/main/updater/config.js";
import { ensureOwnedUpdateRoot, OWNERSHIP_SENTINEL, UPDATE_ROOT_VERSION } from "../../../src/main/updater/store.js";
import { renameWithRetry, replaceDirectory, writeJson } from "../../../src/main/updater/support.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pixo-updater-store-"));
  roots.push(root);
  return root;
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

function configFor(downloadRoot: string): DesktopUpdaterConfig {
  return { downloadRoot, source: "packaged" } as unknown as DesktopUpdaterConfig;
}

const quietLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

async function ownedStore(): Promise<string> {
  const root = join(makeRoot(), "updates");
  const opened = await ensureOwnedUpdateRoot(configFor(root), quietLogger);
  expect(opened.ok).toBe(true);
  return root;
}

describe("updater JSON writes on Windows", () => {
  it("retries a rename that antivirus or the indexer briefly holds", async () => {
    let calls = 0;
    const rename = async () => {
      calls += 1;
      if (calls < 3) throw errno(calls === 1 ? "EPERM" : "EBUSY");
    };
    await renameWithRetry("a", "b", { delaysMs: [0, 0, 0], rename });
    expect(calls).toBe(3);
  });

  it("gives up after a bounded number of tries and never retries a missing source", async () => {
    let calls = 0;
    const busy = async () => {
      calls += 1;
      throw errno("EPERM");
    };
    await expect(renameWithRetry("a", "b", { delaysMs: [0, 0], rename: busy })).rejects.toMatchObject({ code: "EPERM" });
    expect(calls).toBe(3);

    calls = 0;
    const missing = async () => {
      calls += 1;
      throw errno("ENOENT");
    };
    await expect(renameWithRetry("a", "b", { delaysMs: [0, 0], rename: missing })).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls).toBe(1);
  });

  it("removes its temporary file when the rename cannot complete", async () => {
    const root = makeRoot();
    const target = join(root, "metadata.json");
    // A directory in the way makes the rename fail on every platform.
    await mkdir(join(target, "child"), { recursive: true });
    await expect(writeJson(target, { version: 1 }, { delaysMs: [0] })).rejects.toBeTruthy();
    expect(readdirSync(root)).toEqual(["metadata.json"]);
  });

  it("lands the file after a transient rename failure", async () => {
    const root = makeRoot();
    const target = join(root, "metadata.json");
    let calls = 0;
    const { rename } = await import("node:fs/promises");
    await writeJson(target, { version: 1 }, {
      delaysMs: [0, 0],
      rename: async (from, to) => {
        calls += 1;
        if (calls === 1) throw errno("EPERM");
        await rename(from, to);
      },
    });
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ version: 1 });
    expect(readdirSync(root)).toEqual(["metadata.json"]);
  });
});

describe("replacing a payload directory", () => {
  async function dirs() {
    const root = makeRoot();
    const source = join(root, "staging", "prepare-x");
    const target = join(root, "versions", "1.0.1");
    const backup = join(root, "staging", "replaced-x");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "marker"), "new");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "marker"), "old");
    return { backup, root, source, target };
  }

  it("keeps the old directory when the new one cannot be moved in", async () => {
    const { backup, source, target } = await dirs();
    const { rename } = await import("node:fs/promises");
    await expect(replaceDirectory(source, target, backup, {
      delaysMs: [0, 0],
      rename: async (from, to) => {
        if (from === source) throw errno("EPERM");
        await rename(from, to);
      },
    })).rejects.toMatchObject({ code: "EPERM" });
    expect(await readFile(join(target, "marker"), "utf8")).toBe("old");
    expect(await readFile(join(source, "marker"), "utf8")).toBe("new");
    expect(existsSync(backup)).toBe(false);
  });

  it("swaps after a transient lock and removes the old copy", async () => {
    const { backup, source, target } = await dirs();
    const { rename } = await import("node:fs/promises");
    let sourceTries = 0;
    await replaceDirectory(source, target, backup, {
      delaysMs: [0, 0],
      rename: async (from, to) => {
        if (from === source && sourceTries++ === 0) throw errno("EBUSY");
        await rename(from, to);
      },
    });
    expect(await readFile(join(target, "marker"), "utf8")).toBe("new");
    expect(existsSync(source)).toBe(false);
    expect(existsSync(backup)).toBe(false);
  });

  it("moves the new directory in when there is nothing to replace", async () => {
    const { backup, source, target } = await dirs();
    rmSync(target, { force: true, recursive: true });
    await replaceDirectory(source, target, backup);
    expect(await readFile(join(target, "marker"), "utf8")).toBe("new");
  });
});

describe("update store shape", () => {
  it("ignores Explorer and Finder metadata files in the store root", async () => {
    const root = await ownedStore();
    for (const name of ["Thumbs.db", "desktop.ini", ".DS_Store"]) await writeFile(join(root, name), "");
    const opened = await ensureOwnedUpdateRoot(configFor(root), quietLogger);
    expect(opened).toMatchObject({ ok: true });
  });

  it("ignores a temporary file left by an interrupted JSON write", async () => {
    const root = await ownedStore();
    await writeFile(join(root, "metadata.json.1234.1700000000000.tmp"), "{");
    await writeFile(join(root, `${OWNERSHIP_SENTINEL}.1234.1700000000001.tmp`), "{");
    const opened = await ensureOwnedUpdateRoot(configFor(root), quietLogger);
    expect(opened).toMatchObject({ ok: true });
  });

  it("claims a new folder that holds only OS metadata", async () => {
    const root = join(makeRoot(), "updates");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "desktop.ini"), "");
    const opened = await ensureOwnedUpdateRoot(configFor(root), quietLogger);
    expect(opened).toMatchObject({ ok: true });
    expect(JSON.parse(await readFile(join(root, OWNERSHIP_SENTINEL), "utf8"))).toMatchObject({ version: UPDATE_ROOT_VERSION });
  });

  it("writes missing store metadata when only OS files sit beside the sentinel", async () => {
    const root = await ownedStore();
    rmSync(join(root, "metadata.json"));
    await writeFile(join(root, "Thumbs.db"), "");
    const opened = await ensureOwnedUpdateRoot(configFor(root), quietLogger);
    expect(opened).toMatchObject({ ok: true });
    expect(existsSync(join(root, "metadata.json"))).toBe(true);
  });

  it("does not wave through a directory squatting on an OS metadata name", async () => {
    const root = await ownedStore();
    await mkdir(join(root, "Thumbs.db"));
    const opened = await ensureOwnedUpdateRoot(configFor(root), quietLogger);
    expect(opened.ok).toBe(false);
  });

  it("still refuses a store with entries that are not OS metadata", async () => {
    const root = await ownedStore();
    await writeFile(join(root, "notes.txt"), "");
    await writeFile(join(root, "metadata.json.tmp"), "");
    const opened = await ensureOwnedUpdateRoot(configFor(root), quietLogger);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.error.code).toBe("update-store-invalid-shape");
      const unexpected = (opened.error.details as { details: { unexpected: string[] } }).details.unexpected;
      expect([...unexpected].sort()).toEqual(["metadata.json.tmp", "notes.txt"]);
    }
  });
});
