import { describe, expect, it, vi } from "vitest";

import { APP_KEYS } from "@openpixo/sidecar-proto";

import { lookupPackagedSystemProxyEnv, packagedSidecarSystemProxyEnv } from "../src/sidecars.js";

// Each `reg query` is a process start on the launcher's main thread: three in
// a row held it for about 100 ms per sidecar on Windows, the same three side
// by side about 18 ms (measured 2026-11-28).
describe("system proxy for packaged sidecars", () => {
  it("does not look the proxy up for the daemon, which reads its own", async () => {
    const lookup = vi.fn(async () => ({ HTTPS_PROXY: "http://127.0.0.1:7890" }));
    await expect(packagedSidecarSystemProxyEnv(APP_KEYS.DAEMON, lookup)).resolves.toEqual({});
    expect(lookup).not.toHaveBeenCalled();
  });

  it("hands the web the proxy it looked up", async () => {
    const lookup = vi.fn(async () => ({ HTTPS_PROXY: "http://127.0.0.1:7890" }));
    await expect(packagedSidecarSystemProxyEnv(APP_KEYS.WEB, lookup)).resolves.toEqual({ HTTPS_PROXY: "http://127.0.0.1:7890" });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("asks for the three Windows registry values at the same time", async () => {
    const started: string[] = [];
    const release: Array<(value: string) => void> = [];
    const runCommand = (_command: string, args: string[]) => new Promise<string>((resolve) => {
      started.push(args[3]!);
      release.push(resolve);
    });
    const pending = lookupPackagedSystemProxyEnv({ platform: "win32", runCommand });
    await Promise.resolve();
    expect(started.sort()).toEqual(["ProxyEnable", "ProxyOverride", "ProxyServer"]);
    for (const resolve of release) resolve("");
    await expect(pending).resolves.toEqual({});
  });

  it("treats a failed lookup as no proxy", async () => {
    const runCommand = () => Promise.reject(new Error("reg.exe missing"));
    await expect(lookupPackagedSystemProxyEnv({ platform: "win32", runCommand })).resolves.toEqual({});
  });
});
