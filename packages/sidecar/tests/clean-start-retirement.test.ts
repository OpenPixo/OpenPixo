import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SidecarStamp } from "../src/stamp.js";

// Each process-table snapshot is a PowerShell + WMI query on Windows: about
// 0.6 s idle and 1.3–1.7 s while the packaged app starts (measured
// 2026-11-28). A packaged start retires both sidecars before it spawns them,
// so every snapshot there is on the path to the first window.
const snapshotCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("../src/process-tree.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/process-tree.js")>();
  return {
    ...actual,
    captureSidecarGenerationSetSnapshot: vi.fn(async (stamps: readonly SidecarStamp[]) => {
      snapshotCalls.count += 1;
      return stamps.map((stamp) => ({ matches: [], processes: [], roots: [], stamp }));
    }),
  };
});

const { stopSidecars } = await import("../src/operations.js");

function stampFor(app: string): SidecarStamp {
  return { app, channel: "local", mode: "runtime", namespace: `clean-start-${process.pid}`, source: "packaged" };
}

describe("retiring sidecars when nothing is running", () => {
  beforeEach(() => {
    snapshotCalls.count = 0;
  });

  it("takes one process-table snapshot for the whole set", async () => {
    const result = await stopSidecars([
      { stamp: stampFor("daemon"), options: { gracefulRequestTimeoutMs: 50 } },
      { stamp: stampFor("web"), options: { gracefulRequestTimeoutMs: 50 } },
    ]);

    expect(result.alreadyStopped).toBe(true);
    expect(result.remainingPids).toEqual([]);
    expect(snapshotCalls.count).toBe(1);
  });
});
