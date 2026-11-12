import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LAUNCHER_SCHEMA_VERSION, resolveLauncherPaths, selectLauncherRuntimeTarget } from "@openpixo/launcher-proto";
import { DESKTOP_UPDATE_CHANNELS, DESKTOP_UPDATE_STATES, SIDECAR_SOURCES } from "@openpixo/sidecar-proto";

import { createDesktopUpdater, DESKTOP_UPDATE_ENV, requiredUpdateFromMetadata } from "../../../src/main/updater.js";
import { applyDownloadedUpdateOnQuit } from "../../../src/main/updater/apply-on-quit.js";

const FEED = "https://downloads.example.test/updates/beta/latest/metadata.json";
const PAYLOAD_URL = "https://downloads.example.test/payload.7z";
const CURRENT = "1.0.0-beta.1";
const NEXT = "1.0.0-beta.2";
const NAMESPACE = "release-beta-win";
const PAYLOAD_BYTES = "payload bytes";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function feedBody(control?: unknown): Record<string, unknown> {
  return {
    channel: "beta",
    ...(control === undefined ? {} : { control }),
    platforms: {
      win: {
        arch: "x64",
        artifacts: {
          installer: {
            name: "setup.exe",
            sha256: "0".repeat(64),
            size: 1,
            url: "https://downloads.example.test/setup.exe",
          },
          payload: {
            name: "payload.7z",
            sha256: createHash("sha256").update(PAYLOAD_BYTES).digest("hex"),
            size: PAYLOAD_BYTES.length,
            url: PAYLOAD_URL,
          },
        },
        enabled: true,
      },
    },
    releaseVersion: NEXT,
    version: 1,
  };
}

async function installedUpdater(options: {
  control?: unknown;
  currentVersion?: string;
  fetch?: typeof globalThis.fetch;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "pixo-next-launch-"));
  roots.push(root);
  const launcherPaths = resolveLauncherPaths({ channel: "beta", namespace: NAMESPACE, root });
  const launcherLaunchPath = join(root, "installed", "OpenPixo Beta.exe");
  await mkdir(join(root, "installed"), { recursive: true });
  await writeFile(launcherLaunchPath, "");
  await mkdir(launcherPaths.stateRoot, { recursive: true });
  await writeFile(launcherPaths.runtimePath, `${JSON.stringify({
    active: { generation: 1, version: CURRENT },
    channel: "beta",
    lastSuccessful: { generation: 1, version: CURRENT },
    namespace: NAMESPACE,
    schemaVersion: LAUNCHER_SCHEMA_VERSION,
  })}\n`);
  const defaultFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === FEED) return new Response(JSON.stringify(feedBody(options.control)));
    if (url === PAYLOAD_URL) return new Response(PAYLOAD_BYTES);
    return new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  const makeUpdater = () => createDesktopUpdater({
    arch: "x64",
    currentVersion: options.currentVersion ?? CURRENT,
    downloadRoot: join(root, "updates"),
    env: {
      [DESKTOP_UPDATE_ENV.CHANNEL]: DESKTOP_UPDATE_CHANNELS.BETA,
      [DESKTOP_UPDATE_ENV.CURRENT_VERSION]: options.currentVersion ?? CURRENT,
      [DESKTOP_UPDATE_ENV.ENABLED]: "1",
      [DESKTOP_UPDATE_ENV.METADATA_URL]: FEED,
      [DESKTOP_UPDATE_ENV.PLATFORM]: "win32",
    },
    launcherLaunchPath,
    launcherRoot: root,
    launcherRuntimePath: launcherPaths.runtimePath,
    namespace: NAMESPACE,
    source: SIDECAR_SOURCES.PACKAGED,
  }, {
    extractLauncherPayloadArchive: async ({ destinationRoot }) => {
      await mkdir(join(destinationRoot, "payload", "resources", "openpixo"), { recursive: true });
      await writeFile(join(destinationRoot, "payload", "OpenPixo.exe"), "");
      await writeFile(join(destinationRoot, "payload", "resources", "openpixo-config.json"), "{}\n");
      await writeFile(join(destinationRoot, "manifest.json"), `${JSON.stringify({
        channel: "beta",
        entry: { cwd: "payload", executable: "payload/OpenPixo.exe" },
        namespace: NAMESPACE,
        payloadRoot: "payload",
        platform: "win32",
        schemaVersion: LAUNCHER_SCHEMA_VERSION,
        version: NEXT,
      })}\n`);
    },
    fetch: options.fetch ?? defaultFetch,
    launchAppAfterQuit: async () => ({}),
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  });
  return { launcherPaths, makeUpdater, updater: makeUpdater() };
}

async function readJson(path: string): Promise<Record<string, never>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, never>;
}

describe("a downloaded update applies on the next launch", () => {
  it("moves the pointer so the next cold start opens the new version, not a rollback", async () => {
    const { launcherPaths, updater } = await installedUpdater();
    expect((await updater.checkForUpdates()).state).toBe(DESKTOP_UPDATE_STATES.DOWNLOADED);

    await expect(updater.applyOnNextLaunch?.()).resolves.toBe(true);

    const runtime = await readJson(launcherPaths.runtimePath);
    expect(runtime).toMatchObject({
      active: { generation: 2, version: NEXT },
      lastSuccessful: { generation: 1, version: CURRENT },
    });
    // A pre-armed attempt with no delegated launch behind it reads as a failed
    // launch: the launcher would roll back to the old version.
    expect(existsSync(launcherPaths.attemptsPath)).toBe(false);
    expect(selectLauncherRuntimeTarget({ attempted: null, runtime: runtime as never })).toMatchObject({
      pointer: { version: NEXT },
      reason: "active",
    });
  });

  it("does not restart anything and leaves the restart prompt state alone", async () => {
    const { updater } = await installedUpdater();
    await updater.checkForUpdates();

    await updater.applyOnNextLaunch?.();

    expect(updater.snapshot().installResult).toBeUndefined();
    expect(updater.snapshot().state).toBe(DESKTOP_UPDATE_STATES.DOWNLOADED);
  });

  it("does not auto-apply the same release twice, so a crashing update cannot loop", async () => {
    const { makeUpdater, updater } = await installedUpdater();
    await updater.checkForUpdates();
    await expect(updater.applyOnNextLaunch?.()).resolves.toBe(true);

    // The launcher rolled back: the old version opens again with the release still on disk.
    const afterRollback = makeUpdater();
    expect((await afterRollback.status()).state).toBe(DESKTOP_UPDATE_STATES.DOWNLOADED);

    await expect(afterRollback.applyOnNextLaunch?.()).resolves.toBe(false);
    const silent = await afterRollback.installUpdate({ trigger: "silent" });
    expect(silent.installResult).toBeUndefined();
    // Choosing it by hand still works.
    const manual = await afterRollback.installUpdate();
    expect(manual.installResult?.activeVersion).toBe(NEXT);
  });

  it("stays quiet when nothing is downloaded", async () => {
    const { updater } = await installedUpdater();
    await expect(updater.applyOnNextLaunch?.()).resolves.toBe(false);
  });

  it("drops a downloaded release the publisher rolled back, so it is neither offered nor applied", async () => {
    let rolledBack = false;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input) !== FEED) return new Response(PAYLOAD_BYTES);
      return new Response(JSON.stringify({ ...feedBody(), releaseVersion: rolledBack ? CURRENT : NEXT }));
    }) as typeof globalThis.fetch;
    const { launcherPaths, updater } = await installedUpdater({ fetch: fetchImpl });
    expect((await updater.checkForUpdates()).state).toBe(DESKTOP_UPDATE_STATES.DOWNLOADED);

    rolledBack = true;
    const checked = await updater.checkForUpdates();

    expect(checked.state).toBe(DESKTOP_UPDATE_STATES.NOT_AVAILABLE);
    expect(checked.availableVersion).toBeUndefined();
    expect(checked.downloadPath).toBeUndefined();
    await expect(updater.applyOnNextLaunch?.()).resolves.toBe(false);
    expect(await readJson(launcherPaths.runtimePath)).toMatchObject({ active: { version: CURRENT } });
  });

  it("keeps a downloaded release through a failed check", async () => {
    let online = true;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (!online) throw new TypeError("fetch failed");
      return String(input) === FEED ? new Response(JSON.stringify(feedBody())) : new Response(PAYLOAD_BYTES);
    }) as typeof globalThis.fetch;
    const { updater } = await installedUpdater({ fetch: fetchImpl });
    await updater.checkForUpdates();

    online = false;
    const offline = await updater.checkForUpdates();

    expect(offline.state).toBe(DESKTOP_UPDATE_STATES.DOWNLOADED);
    await expect(updater.applyOnNextLaunch?.()).resolves.toBe(true);
  });
});

describe("applyDownloadedUpdateOnQuit", () => {
  const ready = {
    artifact: { platformKey: "win", type: "payload", url: PAYLOAD_URL },
    state: DESKTOP_UPDATE_STATES.DOWNLOADED,
  } as never;

  it("applies by default", async () => {
    const applyOnNextLaunch = vi.fn(async () => true);
    await expect(applyDownloadedUpdateOnQuit({
      readAllowSilentUpdates: async () => undefined,
      updater: { applyOnNextLaunch, snapshot: () => ready },
    })).resolves.toBe(true);
    expect(applyOnNextLaunch).toHaveBeenCalledTimes(1);
  });

  it("honours an explicit opt-out", async () => {
    const applyOnNextLaunch = vi.fn(async () => true);
    await expect(applyDownloadedUpdateOnQuit({
      readAllowSilentUpdates: async () => false,
      updater: { applyOnNextLaunch, snapshot: () => ready },
    })).resolves.toBe(false);
    expect(applyOnNextLaunch).not.toHaveBeenCalled();
  });

  it("treats an unreadable preference as not now, without failing the quit", async () => {
    const applyOnNextLaunch = vi.fn(async () => true);
    await expect(applyDownloadedUpdateOnQuit({
      logger: { error: vi.fn(), warn: vi.fn() },
      readAllowSilentUpdates: async () => { throw new Error("daemon is gone"); },
      updater: { applyOnNextLaunch, snapshot: () => ready },
    })).resolves.toBe(false);
    expect(applyOnNextLaunch).not.toHaveBeenCalled();
  });

  it("never holds up quitting while another update operation is running", async () => {
    await expect(applyDownloadedUpdateOnQuit({
      logger: { error: vi.fn(), warn: vi.fn() },
      readAllowSilentUpdates: async () => true,
      timeoutMs: 5,
      updater: { applyOnNextLaunch: () => new Promise<boolean>(() => undefined), snapshot: () => ready },
    })).resolves.toBe(false);
  });

  it("skips anything that is not a downloaded in-place update", async () => {
    const applyOnNextLaunch = vi.fn(async () => true);
    for (const status of [
      { state: DESKTOP_UPDATE_STATES.DOWNLOADING },
      { artifact: { platformKey: "win", type: "installer", url: "https://x.test/s.exe" }, state: DESKTOP_UPDATE_STATES.DOWNLOADED },
      { artifact: { platformKey: "win", type: "payload", url: PAYLOAD_URL }, installResult: { openedAt: "t", path: "p" }, state: DESKTOP_UPDATE_STATES.DOWNLOADED },
    ]) {
      await applyDownloadedUpdateOnQuit({
        readAllowSilentUpdates: async () => true,
        updater: { applyOnNextLaunch, snapshot: () => status as never },
      });
    }
    expect(applyOnNextLaunch).not.toHaveBeenCalled();
  });
});

describe("minimum usable version", () => {
  const config = { currentVersion: CURRENT };
  const floor = (version: unknown) => ({ control: { app: { version } } });

  it("requires an update only when the running version is below a floor the release clears", () => {
    expect(requiredUpdateFromMetadata(floor({ min: NEXT }), config, NEXT)).toEqual({ minVersion: NEXT });
    expect(requiredUpdateFromMetadata(floor({ min: CURRENT }), config, NEXT)).toBeNull();
  });

  it("never gates on a floor no available release could clear", () => {
    expect(requiredUpdateFromMetadata(floor({ min: "1.0.0-beta.9" }), config, NEXT)).toBeNull();
  });

  it("ignores missing or malformed floors, so a bad feed cannot lock anyone out", () => {
    expect(requiredUpdateFromMetadata({}, config, NEXT)).toBeNull();
    expect(requiredUpdateFromMetadata(floor({ min: 12 }), config, NEXT)).toBeNull();
    expect(requiredUpdateFromMetadata(floor({ min: "not a version" }), config, NEXT)).toBeNull();
    expect(requiredUpdateFromMetadata({ control: "nope" }, config, NEXT)).toBeNull();
  });

  it("keeps the publisher's reason and an https download page only", () => {
    expect(requiredUpdateFromMetadata(floor({
      message: { en: "Data loss bug", fr: 3, "zh-CN": "数据丢失问题" },
      min: NEXT,
      url: "https://openpixo.com/download",
    }), config, NEXT)).toEqual({
      message: { en: "Data loss bug", "zh-CN": "数据丢失问题" },
      minVersion: NEXT,
      url: "https://openpixo.com/download",
    });
    expect(requiredUpdateFromMetadata(floor({ min: NEXT, url: "http://evil.test/x" }), config, NEXT)).toEqual({
      minVersion: NEXT,
    });
  });

  it("reports the requirement on status while the feed says so", async () => {
    const { updater } = await installedUpdater({ control: floor({ min: NEXT }).control });
    const status = await updater.checkForUpdates();
    expect(status.required).toEqual({ minVersion: NEXT });
    expect(status.state).toBe(DESKTOP_UPDATE_STATES.DOWNLOADED);
  });

  it("keeps the requirement through a failed download so the gate can offer a retry", async () => {
    const fetchImpl = (async (input: string | URL | Request) => (String(input) === FEED
      ? new Response(JSON.stringify(feedBody(floor({ min: NEXT }).control)))
      : new Response("nope", { status: 503 }))) as typeof globalThis.fetch;
    const { updater } = await installedUpdater({ fetch: fetchImpl });
    const status = await updater.checkForUpdates();
    expect(status.state).toBe(DESKTOP_UPDATE_STATES.ERROR);
    expect(status.error?.code).toBe("download-failed");
    expect(status.required).toEqual({ minVersion: NEXT });
  });

  it("never gates when the feed cannot be reached, even after it had asked for an update", async () => {
    let online = true;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (!online) throw new TypeError("fetch failed");
      return String(input) === FEED
        ? new Response(JSON.stringify(feedBody(floor({ min: NEXT }).control)))
        : new Response(PAYLOAD_BYTES);
    }) as typeof globalThis.fetch;
    const { updater } = await installedUpdater({ fetch: fetchImpl });
    expect((await updater.checkForUpdates()).required).toBeDefined();

    online = false;
    const offline = await updater.checkForUpdates();

    expect(offline.required).toBeUndefined();
    expect(offline.error?.code).toBe("metadata-unreachable");
  });

  it("does not gate a fresh launch that starts offline", async () => {
    const fetchImpl = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof globalThis.fetch;
    const { updater } = await installedUpdater({ fetch: fetchImpl });
    const offline = await updater.checkForUpdates();
    expect(offline.required).toBeUndefined();
    expect(offline.state).toBe(DESKTOP_UPDATE_STATES.ERROR);
  });
});
