import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSidecarClientEndpoint } from "@openpixo/sidecar";
import { SIDECAR_SOURCES } from "@openpixo/sidecar-proto";

import {
  DAEMON_STARTUP_TIMEOUT_MS,
  waitForDaemonRuntime,
  waitForDesktopRuntime,
  waitForWebRuntime,
} from "../src/sidecar-client.js";

describe("sidecar startup waits", () => {
  it("allows daemon initialization to continue past the legacy 35 second deadline", () => {
    assert.equal(DAEMON_STARTUP_TIMEOUT_MS, 120_000);
  });

  it("fails immediately when a spawned app exits before publishing status", async () => {
    const waits = [
      ["daemon", waitForDaemonRuntime],
      ["web", waitForWebRuntime],
      ["desktop", waitForDesktopRuntime],
    ] as const;

    for (const [appName, waitForRuntime] of waits) {
      const startedAt = Date.now();
      await assert.rejects(
        waitForRuntime(
          { base: "unused", namespace: `exited-${appName}-${process.pid}` },
          5_000,
          () => false,
        ),
        new RegExp(`${appName} exited before exposing status`),
      );
      assert.ok(Date.now() - startedAt < 1_000);
    }
  });
});


describe("OpenPixo sidecar isolation", () => {
  it("never shares upstream endpoints even with the same namespace and channel", () => {
    const shared = { app: "desktop", channel: "stable", mode: "runtime", namespace: "default" };
    for (const [source, upstream] of [
      [SIDECAR_SOURCES.PACKAGED, "packaged"],
      [SIDECAR_SOURCES.TOOLS_DEV, "tools-dev"],
      [SIDECAR_SOURCES.TOOLS_PACK, "tools-pack"],
    ] as const) {
      assert.notEqual(
        resolveSidecarClientEndpoint({ ...shared, source }),
        resolveSidecarClientEndpoint({ ...shared, source: upstream }),
      );
    }
  });
});
