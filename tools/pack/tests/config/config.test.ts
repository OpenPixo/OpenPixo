import { afterEach, describe, expect, it } from "vitest";
import { join, resolve } from "node:path";

import { resolveToolPackConfig, WORKSPACE_ROOT } from "@/config/index.js";

const savedTelemetryRelayUrl = process.env.PIXO_TELEMETRY_RELAY_URL;
const savedPosthogKey = process.env.POSTHOG_KEY;
const savedPosthogHost = process.env.POSTHOG_HOST;

afterEach(() => {
  if (savedTelemetryRelayUrl == null) {
    delete process.env.PIXO_TELEMETRY_RELAY_URL;
  } else {
    process.env.PIXO_TELEMETRY_RELAY_URL = savedTelemetryRelayUrl;
  }
  if (savedPosthogKey == null) {
    delete process.env.POSTHOG_KEY;
  } else {
    process.env.POSTHOG_KEY = savedPosthogKey;
  }
  if (savedPosthogHost == null) {
    delete process.env.POSTHOG_HOST;
  } else {
    process.env.POSTHOG_HOST = savedPosthogHost;
  }
});

describe("resolveToolPackConfig win build target", () => {
  it("accepts the portable zip target and rejects unsupported values", () => {
    expect(resolveToolPackConfig("win", { to: "zip" }).to).toBe("zip");
    expect(resolveToolPackConfig("win", { to: "all" }).to).toBe("all");
    expect(resolveToolPackConfig("win", { to: "nsis" }).to).toBe("nsis");
    expect(() => resolveToolPackConfig("win", { to: "dmg" })).toThrow(/unsupported win --to target: dmg/);
  });
});

describe("resolveToolPackConfig cache root", () => {
  it("keeps the default cache outside custom tools-pack roots", () => {
    const config = resolveToolPackConfig("win", {
      dir: "C:\\pixoqa-release-4ch",
      namespace: "cache-root-test",
    });

    expect(config.roots.toolPackRoot).toBe(resolve("C:\\pixoqa-release-4ch"));
    expect(config.roots.cacheRoot).toBe(resolve(join(WORKSPACE_ROOT, ".tmp", "tools-pack", "cache")));
  });

  it("uses an explicit cache-dir when supplied", () => {
    const config = resolveToolPackConfig("win", {
      cacheDir: "C:\\pixoqa-tools-pack-cache",
      dir: "C:\\pixoqa-release-4ch",
      namespace: "cache-root-test",
    });

    expect(config.roots.toolPackRoot).toBe(resolve("C:\\pixoqa-release-4ch"));
    expect(config.roots.cacheRoot).toBe(resolve("C:\\pixoqa-tools-pack-cache"));
  });
});

describe("resolveToolPackConfig namespace defaults", () => {
  it("keeps ordinary local builds on the default namespace", () => {
    expect(resolveToolPackConfig("mac").namespace).toBe("default");
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0" }).namespace).toBe("default");
  });

  it("defaults prerelease mac builds to their release channel namespace", () => {
    expect(resolveToolPackConfig("mac", { appVersion: "0.8.0-beta.4" }).namespace).toBe("release-beta");
    expect(resolveToolPackConfig("mac", { appVersion: "0.8.0-preview.4" }).namespace).toBe("release-preview");
    expect(resolveToolPackConfig("mac", { appVersion: "0.8.0-prerelease.4" }).namespace).toBe("release-prerelease");
  });

  it("defaults prerelease non-mac builds to platform-specific release channel namespaces", () => {
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0-beta.4" }).namespace).toBe("release-beta-win");
    expect(resolveToolPackConfig("linux", { appVersion: "0.8.0-preview.4" }).namespace).toBe("release-preview-linux");
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0-prerelease.4" }).namespace).toBe("release-prerelease-win");
  });

  it("keeps an explicit namespace ahead of the prerelease channel default", () => {
    expect(resolveToolPackConfig("mac", { appVersion: "0.8.0-beta.4", namespace: "custom-beta" }).namespace).toBe(
      "custom-beta",
    );
  });
});

describe("OpenPixo packaging telemetry isolation", () => {
  it("does not bake inherited telemetry keys or relay endpoints into a fork", () => {
    process.env.PIXO_TELEMETRY_RELAY_URL = "https://telemetry.example.test/api/langfuse";
    process.env.POSTHOG_KEY = "phc_test_abc123";
    process.env.POSTHOG_HOST = "https://us.i.posthog.com";
    const config = resolveToolPackConfig("win", { namespace: "telemetry-test" });
    expect(config.telemetryRelayUrl).toBeUndefined();
    expect(config.posthogKey).toBeUndefined();
    expect(config.posthogHost).toBeUndefined();
    expect(config.posthogCliApiKey).toBeUndefined();
    expect(config.posthogCliProjectId).toBeUndefined();
    expect(config.posthogCliHost).toBeUndefined();
  });
});
