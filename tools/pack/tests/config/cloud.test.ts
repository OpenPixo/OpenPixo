import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveToolPackCloud, resolveToolPackConfig } from "@/config/index.js";

afterEach(() => vi.unstubAllEnvs());

const PRODUCTION = { url: "https://prod.example.com", anonKey: "anon-production" };
const NONE = { url: "", anonKey: "" };

describe("OpenPixo cloud baked into packaged builds", () => {
  it("bakes nothing into a local build without an override", () => {
    expect(resolveToolPackCloud({}, undefined, PRODUCTION)).toBeUndefined();
  });

  it("bakes the production cloud into public release channels", () => {
    expect(resolveToolPackCloud({}, "stable", PRODUCTION)).toEqual({ ...PRODUCTION, agentUrl: "https://prod.example.com/functions/v1" });
    expect(resolveToolPackCloud({}, "beta", PRODUCTION)).toEqual({ ...PRODUCTION, agentUrl: "https://prod.example.com/functions/v1" });
  });

  it("refuses a stable build when no production cloud is configured", () => {
    expect(() => resolveToolPackCloud({}, "stable", NONE)).toThrow(/stable builds must ship the production cloud/);
    expect(resolveToolPackCloud({}, "beta", NONE)).toBeUndefined();
  });

  it("lets PIXO_CLOUD_URL and PIXO_CLOUD_ANON_KEY point a build at another cloud", () => {
    const env = { PIXO_CLOUD_URL: " https://test.example.com/ ", PIXO_CLOUD_ANON_KEY: " anon-test " };
    expect(resolveToolPackCloud(env, "stable", NONE)).toEqual({ url: "https://test.example.com", anonKey: "anon-test", agentUrl: "https://test.example.com/functions/v1" });
  });

  it("carries PIXO_AGENT_URL with the cloud it belongs to", () => {
    const env = { PIXO_CLOUD_URL: "https://test.example.com", PIXO_CLOUD_ANON_KEY: "anon-test", PIXO_AGENT_URL: "https://api-test.example.com" };
    expect(resolveToolPackCloud(env, "stable", NONE)?.agentUrl).toBe("https://api-test.example.com");
  });

  it.each([
    [{ PIXO_CLOUD_URL: "https://test.example.com" }],
    [{ PIXO_CLOUD_ANON_KEY: "anon-test" }],
    [{ PIXO_CLOUD_URL: "http://test.example.com", PIXO_CLOUD_ANON_KEY: "anon-test" }],
    [{ PIXO_CLOUD_URL: "https://test.example.com/path", PIXO_CLOUD_ANON_KEY: "anon-test" }],
  ])("rejects an incomplete or unsafe override %#", (env) => {
    expect(() => resolveToolPackCloud(env, undefined, PRODUCTION)).toThrow(/must both be set/);
  });

  it("carries the override into the resolved pack config", () => {
    vi.stubEnv("PIXO_CLOUD_URL", "https://test.example.com");
    vi.stubEnv("PIXO_CLOUD_ANON_KEY", "anon-test");
    expect(resolveToolPackConfig("win").cloud).toEqual({ url: "https://test.example.com", anonKey: "anon-test", agentUrl: "https://test.example.com/functions/v1" });
  });
});
