import { describe, expect, it } from "vitest";

import {
  formatReleaseVersion,
  compareReleaseBaseVersions,
  parseReleaseBaseVersion,
  parseReleaseVersion,
  releaseChannelDescriptor,
  releaseChannelFromNamespace,
  releaseChannelFromVersion,
  releaseInstallIdentity,
  releaseMetadataVersionFields,
  releaseNamespace,
  isReleaseChannel,
  isPublicReleaseVersion,
  OPENPIXO_DOWNLOADS_ORIGIN,
  publicUpdateFeedUrl,
} from "../src/index.js";

describe("@openpixo/release", () => {
  it("formats and parses counted release versions", () => {
    expect(formatReleaseVersion("prerelease", "1.2.3", 4)).toBe("1.2.3-prerelease.4");
    expect(parseReleaseVersion("1.2.3-prerelease.4", "prerelease")).toEqual({
      baseVersion: "1.2.3",
      channel: "prerelease",
      number: 4,
      releaseVersion: "1.2.3-prerelease.4",
    });
  });

  it("parses and compares stable base versions", () => {
    expect(parseReleaseBaseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseReleaseBaseVersion("1.2")).toBeNull();
    expect(compareReleaseBaseVersions([1, 2, 4], [1, 2, 3])).toBe(1);
    expect(compareReleaseBaseVersions([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(compareReleaseBaseVersions([1, 2, 3], [1, 3, 0])).toBe(-1);
  });

  it("derives metadata fields from the channel descriptor", () => {
    expect(releaseMetadataVersionFields("stable", "1.2.3")).toEqual({
      baseVersion: "1.2.3",
      releaseVersion: "1.2.3",
      stableVersion: "1.2.3",
    });
    expect(releaseMetadataVersionFields("preview", "1.2.3-preview.5")).toMatchObject({
      baseVersion: "1.2.3",
      releaseNumber: 5,
      releaseVersion: "1.2.3-preview.5",
    });
  });

  it("centralizes release identity and namespace derivation", () => {
    expect(releaseChannelDescriptor("prerelease").productName).toBe("OpenPixo Prerelease");
    expect(releaseInstallIdentity("prerelease")).toEqual({
      appId: "io.openpixo.desktop.prerelease",
      executableName: "OpenPixo Prerelease",
      productName: "OpenPixo Prerelease",
    });
    expect(releaseNamespace("prerelease")).toBe("release-prerelease");
    expect(releaseNamespace("prerelease", "win")).toBe("release-prerelease-win");
    expect(releaseNamespace("prerelease", "macIntel")).toBe("release-prerelease-intel");
    expect(releaseChannelDescriptor("qa2")).toMatchObject({
      appId: "io.openpixo.desktop.qa2",
      channel: "qa2",
      productName: "OpenPixo Qa2",
      storagePrefix: "qa2",
    });
  });

  it("limits exact names to 1-12 lowercase letters or digits", () => {
    expect(isReleaseChannel("beta")).toBe(true);
    expect(isReleaseChannel("qa1234567890")).toBe(true);
    expect(isReleaseChannel("local")).toBe(false);
    expect(isReleaseChannel("qa-2")).toBe(false);
    expect(isReleaseChannel("Beta")).toBe(false);
    expect(isReleaseChannel("qa12345678901")).toBe(false);
  });

  it("infers release channels from versions and namespaces", () => {
    expect(releaseChannelFromVersion("1.2.3-beta.1")).toBe("beta");
    expect(releaseChannelFromVersion("1.2.3-beta-internal.1")).toBe("beta");
    expect(releaseChannelFromVersion("1.2.3-prerelease.1")).toBe("prerelease");
    expect(releaseChannelFromNamespace("release-preview-linux")).toBe("preview");
    expect(releaseChannelFromNamespace("openpixo")).toBe("stable");
    expect(releaseChannelFromNamespace("beta-local-flow")).toBeNull();
    expect(releaseChannelFromNamespace("release-local")).toBeNull();
  });


  it("defines the OpenPixo-owned public feeds for stable and beta only", () => {
    expect(OPENPIXO_DOWNLOADS_ORIGIN).toBe("https://downloads.openpixo.com");
    expect(publicUpdateFeedUrl("stable")).toBe("https://downloads.openpixo.com/updates/stable/latest/metadata.json");
    expect(publicUpdateFeedUrl("beta", "https://downloads.example.test/")).toBe("https://downloads.example.test/updates/beta/latest/metadata.json");
    expect(() => publicUpdateFeedUrl("prerelease" as never)).toThrow(/no public update feed/);
    expect(isPublicReleaseVersion("0.2.0", "stable")).toBe(true);
    expect(isPublicReleaseVersion("0.2.0-beta.1", "stable")).toBe(false);
    expect(isPublicReleaseVersion("0.2.0-beta.1", "beta")).toBe(true);
    expect(isPublicReleaseVersion("0.1.0-alpha.3", "beta")).toBe(false);
  });
});
