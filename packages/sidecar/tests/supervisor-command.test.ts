import { describe, expect, it } from "vitest";

import { SIDECAR_SUPERVISOR_TARGET_ENV } from "../src/client.js";
import { sidecarSpawnRequest } from "../src/operations.js";
import type { SidecarStamp } from "../src/index.js";

const stamp: SidecarStamp = { app: "web", channel: "local", mode: "runtime", namespace: "supervisor-command", source: "tools-pack" };
const resources = { dataRoot: "data", ownerPid: null, port: 0, runtimeRoot: "runtime" };

function target(request: ReturnType<typeof sidecarSpawnRequest>): { command: string; args: string[] } {
  return JSON.parse(request.env?.[SIDECAR_SUPERVISOR_TARGET_ENV] ?? "null") as { command: string; args: string[] };
}

describe("sidecar supervisor command", () => {
  it("runs the supervisor on this process's executable by default", () => {
    const request = sidecarSpawnRequest({ args: ["entry.mjs"], command: "electron-as-node", resources, stamp });
    expect(request.command).toBe(process.execPath);
    expect(target(request)).toMatchObject({ args: ["entry.mjs"], command: "electron-as-node" });
  });

  it("runs only the supervisor on a named Node.js, never the target", () => {
    const request = sidecarSpawnRequest({
      args: ["entry.mjs"], command: "electron-as-node", resources, stamp, supervisorCommand: "bundled-node",
    });
    expect(request.command).toBe("bundled-node");
    expect(target(request)).toMatchObject({ args: ["entry.mjs"], command: "electron-as-node" });
    expect(request).not.toHaveProperty("supervisorCommand");
  });
});
