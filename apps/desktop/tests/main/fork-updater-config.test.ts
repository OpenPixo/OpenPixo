import { describe, expect, it } from "vitest";
import { SIDECAR_SOURCES } from "@openpixo/sidecar-proto";
import { resolveDesktopUpdaterConfig } from "../../src/main/updater/config.js";

describe("OpenPixo update isolation", () => {
  const config = (env: NodeJS.ProcessEnv = {}) => resolveDesktopUpdaterConfig({
    env, source: SIDECAR_SOURCES.PACKAGED,
  });

  it("ships with no feed, polling, or automatic updater", () => {
    expect(config()).toMatchObject({ enabled: false, autoCheck: false, metadataUrl: "" });
    expect(config({ PIXO_UPDATE_ENABLED: "1" }).enabled).toBe(false);
  });

  it("uses the packaged feed without requiring an enable flag and honors an explicit opt-out", () => {
    const env = { PIXO_UPDATE_METADATA_URL: "https://updates.example.com/feed.json" };
    expect(config(env)).toMatchObject({ enabled: true, autoCheck: true, metadataUrl: env.PIXO_UPDATE_METADATA_URL });
    expect(config({ ...env, PIXO_UPDATE_ENABLED: "0" })).toMatchObject({ enabled: false, autoCheck: false });
    expect(resolveDesktopUpdaterConfig({ env, source: SIDECAR_SOURCES.TOOLS_DEV }).enabled).toBe(false);
  });

  it("refuses upstream, invalid, credentialed, and plaintext public feeds", () => {
    for (const url of [
      "https://releases.open-design.ai/stable/latest/metadata.json",
      "https://s3.nexu.space/od-releases/betas/latest/metadata.json",
      "https://open-design.ai/metadata.json",
      "https://NEXU.SPACE/metadata.json",
      "https://releases.open-design.ai./metadata.json",
      "https://user:secret@updates.example.com/feed.json",
      "http://updates.example.com/feed.json", "not a url",
    ]) {
      expect(config({ PIXO_UPDATE_ENABLED: "1", PIXO_UPDATE_METADATA_URL: url, PIXO_UPDATE_AUTO_CHECK: "1" }))
        .toMatchObject({ enabled: false, autoCheck: false });
    }
  });

  it("permits an explicitly enabled independent feed and local verification fixtures", () => {
    for (const url of ["https://updates.example.com/feed.json", "http://127.0.0.1:1234/metadata.json"]) {
      expect(config({ PIXO_UPDATE_ENABLED: "1", PIXO_UPDATE_METADATA_URL: url }))
        .toMatchObject({ enabled: true, autoCheck: true, metadataUrl: url });
    }
  });
});
