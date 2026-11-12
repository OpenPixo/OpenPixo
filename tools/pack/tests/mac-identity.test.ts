import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ToolPackConfig } from "@/config/index.js";
import { resolveMacInstallIdentity } from "@/mac/identity.js";
import { resolveMacPaths } from "@/mac/paths.js";

function makeConfig(root: string, namespace: string): ToolPackConfig {
  return {
    containerized: false,
    electronBuilderCliPath: "/x/electron-builder/cli.js",
    electronDistPath: "/x/electron/dist",
    electronVersion: "41.3.0",
    macCompression: "normal",
    requireOpenCode: false,
    namespace,
    platform: "mac",
    portable: true,
    removeData: false,
    removeLogs: false,
    removeProductUserData: false,
    removeSidecars: false,
    roots: {
      output: {
        appBuilderRoot: join(root, ".tmp", "tools-pack", "out", "mac", "namespaces", namespace, "builder"),
        namespaceRoot: join(root, ".tmp", "tools-pack", "out", "mac", "namespaces", namespace),
        platformRoot: join(root, ".tmp", "tools-pack", "out", "mac"),
        root: join(root, ".tmp", "tools-pack", "out"),
      },
      runtime: {
        namespaceBaseRoot: join(root, ".tmp", "tools-pack", "runtime", "mac", "namespaces"),
        namespaceRoot: join(root, ".tmp", "tools-pack", "runtime", "mac", "namespaces", namespace),
      },
      cacheRoot: join(root, ".tmp", "tools-pack", "cache"),
      toolPackRoot: join(root, ".tmp", "tools-pack"),
    },
    signed: false,
    silent: true,
    to: "dmg",
    webOutputMode: "standalone",
    workspaceRoot: root,
  };
}

describe("resolveMacInstallIdentity", () => {
  it("keeps stable builds on the canonical mac identity", () => {
    expect(resolveMacInstallIdentity(makeConfig("/work", "release-stable"))).toMatchObject({
      appId: "io.openpixo.desktop",
      installerTitle: "OpenPixo",
      productName: "OpenPixo",
      publicAppBundleName: "OpenPixo.app",
      systemAppBundleName: "OpenPixo.app",
    });
  });

  it("uses first-class beta app identity for beta release namespaces", () => {
    const config = makeConfig("/work", "release-beta");

    expect(resolveMacInstallIdentity(config)).toEqual({
      appId: "io.openpixo.desktop.beta",
      executableName: "OpenPixo Beta",
      installerTitle: "OpenPixo Beta",
      productName: "OpenPixo Beta",
      publicAppBundleName: "OpenPixo Beta.app",
      systemAppBundleName: "OpenPixo Beta.app",
    });
    expect(resolveMacPaths(config).appPath).toMatch(/OpenPixo Beta\.app$/);
  });

  it("uses first-class preview app identity for preview release namespaces", () => {
    const config = makeConfig("/work", "release-preview");

    expect(resolveMacInstallIdentity(config)).toEqual({
      appId: "io.openpixo.desktop.preview",
      executableName: "OpenPixo Preview",
      installerTitle: "OpenPixo Preview",
      productName: "OpenPixo Preview",
      publicAppBundleName: "OpenPixo Preview.app",
      systemAppBundleName: "OpenPixo Preview.app",
    });
    expect(resolveMacPaths(config).appPath).toMatch(/OpenPixo Preview\.app$/);
  });

  it("uses first-class prerelease app identity for prerelease release versions and namespaces", () => {
    const prereleaseVersionConfig = {
      ...makeConfig("/work", "release-stable"),
      appVersion: "0.8.0-prerelease.2",
    };
    const prereleaseNamespaceConfig = makeConfig("/work", "release-prerelease");

    expect(resolveMacInstallIdentity(prereleaseVersionConfig)).toEqual({
      appId: "io.openpixo.desktop.prerelease",
      executableName: "OpenPixo Prerelease",
      installerTitle: "OpenPixo Prerelease",
      productName: "OpenPixo Prerelease",
      publicAppBundleName: "OpenPixo Prerelease.app",
      systemAppBundleName: "OpenPixo Prerelease.app",
    });
    expect(resolveMacPaths(prereleaseVersionConfig).appPath).toMatch(/OpenPixo Prerelease\.app$/);
    expect(resolveMacInstallIdentity(prereleaseNamespaceConfig)).toMatchObject({
      productName: "OpenPixo Prerelease",
      publicAppBundleName: "OpenPixo Prerelease.app",
    });
  });
});
