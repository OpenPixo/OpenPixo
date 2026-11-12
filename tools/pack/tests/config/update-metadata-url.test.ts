import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveToolPackConfig } from "@/config/index.js";

afterEach(() => vi.unstubAllEnvs());

// Stable builds refuse to package without a cloud (see cloud.test.ts).
function stubCloud(): void {
  vi.stubEnv("PIXO_CLOUD_URL", "https://cloud.example.com");
  vi.stubEnv("PIXO_CLOUD_ANON_KEY", "anon-test-key");
}

describe("OpenPixo packaged update feed", () => {
  it("omits the feed when no URL is injected at build time", () => {
    vi.stubEnv("PIXO_UPDATE_METADATA_URL", undefined);
    expect(resolveToolPackConfig("win").updateMetadataUrl).toBeUndefined();
  });

  it("bakes the supplied feed URL into packaged configuration", () => {
    vi.stubEnv("PIXO_UPDATE_METADATA_URL", " https://downloads.example.com/updates/beta/latest/metadata.json ");
    expect(resolveToolPackConfig("win").updateMetadataUrl)
      .toBe("https://downloads.example.com/updates/beta/latest/metadata.json");
  });

  it.each([
    "https://releases.open-design.ai/beta/latest/metadata.json",
    "https://open-design.ai/metadata.json",
    "https://s3.nexu.space/od-releases/betas/latest/metadata.json",
    "https://NEXU.SPACE/metadata.json",
    "https://releases.open-design.ai./metadata.json",
  ])("refuses to bake an upstream feed (%s)", (url) => {
    vi.stubEnv("PIXO_UPDATE_METADATA_URL", url);
    expect(() => resolveToolPackConfig("win")).toThrow(/upstream update feed/);
  });

  it("bakes the OpenPixo stable feed and stable identity namespace into a stable release build", () => {
    vi.stubEnv("PIXO_UPDATE_METADATA_URL", undefined);
    stubCloud();
    vi.stubEnv("PIXO_NAMESPACE", undefined);
    const config = resolveToolPackConfig("win", { appVersion: "0.2.0", portable: true, releaseChannel: "stable" });
    expect(config.releaseChannel).toBe("stable");
    expect(config.namespace).toBe("release-stable-win");
    expect(config.updateMetadataUrl).toBe("https://downloads.openpixo.com/updates/stable/latest/metadata.json");
  });

  it("lets an explicit feed override the baked release feed for local validation builds", () => {
    vi.stubEnv("PIXO_UPDATE_METADATA_URL", "http://127.0.0.1:4567/stable/latest/metadata.json");
    stubCloud();
    const config = resolveToolPackConfig("win", { appVersion: "0.2.0", namespace: "upd", portable: true, releaseChannel: "stable" });
    expect(config.namespace).toBe("upd");
    expect(config.updateMetadataUrl).toBe("http://127.0.0.1:4567/stable/latest/metadata.json");
  });

  it.each([
    [{ appVersion: "0.2.0", portable: true, releaseChannel: "prerelease" }, /stable or beta/],
    [{ appVersion: "0.2.0", releaseChannel: "stable" }, /requires --portable/],
    [{ appVersion: "0.2.0-beta.1", portable: true, releaseChannel: "stable" }, /MAJOR\.MINOR\.PATCH/],
    [{ appVersion: "0.1.0-alpha.3", portable: true, releaseChannel: "beta" }, /beta\.N/],
    [{ portable: true, releaseChannel: "stable" }, /--app-version/],
  ])("rejects inconsistent release builds %#", (options, message) => {
    vi.stubEnv("PIXO_UPDATE_METADATA_URL", undefined);
    expect(() => resolveToolPackConfig("win", options)).toThrow(message);
  });
});
