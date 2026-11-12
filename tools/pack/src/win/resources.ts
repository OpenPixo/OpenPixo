import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { hashJson, hashPath, ToolPackCache } from "../cache/index.js";
import type { ToolPackConfig } from "../config/index.js";
import { BUNDLED_RESOURCE_TREES, copyBundledResourceTrees, winResources } from "../resources/index.js";
import {
  copyOptionalOpenCodeTree,
  resolveOptionalOpenCodeDistribution,
} from "../opencode-runtime.js";
import {
  BUNDLED_NODE_ENTRIES,
  copyBundledNodeTree,
  resolveBundledNodeDistribution,
  type BundledNodeDistribution,
} from "../node-runtime.js";
import type { WinPaths, ResourceTreeCacheMetadata } from "./types.js";

const RESOURCE_TREE_CACHE_SCHEMA_VERSION = 14;
const BUNDLED_NOTICES = ["LICENSE", "NOTICE"] as const;

function resolveWinBundledNode(config: ToolPackConfig): Promise<BundledNodeDistribution> {
  return resolveBundledNodeDistribution({
    cacheRoot: config.roots?.cacheRoot ?? "",
    sevenZipExe: winResources.sevenZipExe,
  });
}

async function createResourceTreeCacheKey(
  config: ToolPackConfig,
  workspaceBuildKey: string,
  bundledNode: BundledNodeDistribution,
): Promise<string> {
  const openCode = await resolveOptionalOpenCodeDistribution({
    platform: "win32", arch: "x64", requireBundled: config.requireOpenCode,
  });
  return hashJson({
    node: "win.resource-tree",
    resourceTrees: await Promise.all(BUNDLED_RESOURCE_TREES.map(async ({ from, to }) => [
      to, await hashPath(join(config.workspaceRoot, from)),
    ])),
    notices: await Promise.all(BUNDLED_NOTICES.map(async (name) => [
      name, await hashPath(join(config.workspaceRoot, name)),
    ])),
    schemaVersion: RESOURCE_TREE_CACHE_SCHEMA_VERSION,
    sevenZipDll: await hashPath(winResources.sevenZipDll),
    sevenZipExe: await hashPath(winResources.sevenZipExe),
    requireOpenCode: config.requireOpenCode,
    openCode: openCode ? {
      packageName: openCode.packageName,
      version: openCode.version,
      tree: await hashPath(openCode.source),
      notices: await Promise.all(openCode.notices.map(async ({ source, target }) => [target, await hashPath(source)])),
    } : null,
    // An official build is identified by its pinned checksum; an override tree by its content.
    bundledNode: {
      version: bundledNode.version,
      sha256: bundledNode.sha256,
      entries: [...BUNDLED_NODE_ENTRIES],
      tree: bundledNode.sha256 == null ? await hashPath(bundledNode.source) : null,
    },
    workspaceBuildKey,
  });
}

export type ResourceTreeResult = {
  key: string;
  resourceRoot: string;
};

export async function prepareResourceTree(
  config: ToolPackConfig,
  paths: WinPaths,
  cache: ToolPackCache,
  options: { materialize: boolean },
  workspaceBuildKey = "workspace-build-not-provided",
): Promise<ResourceTreeResult> {
  const bundledNode = await resolveWinBundledNode(config);
  const key = await createResourceTreeCacheKey(config, workspaceBuildKey, bundledNode);
  const node = {
    id: "win.resource-tree",
    key,
    outputs: ["openpixo"],
    invalidate: async () => null,
    build: async ({ entryRoot }: { entryRoot: string }): Promise<ResourceTreeCacheMetadata> => {
      const resourceRoot = join(entryRoot, "openpixo");
      await mkdir(resourceRoot, { recursive: true });
      await copyBundledResourceTrees({
        workspaceRoot: config.workspaceRoot,
        resourceRoot,
      });
      for (const name of BUNDLED_NOTICES) {
        await cp(join(config.workspaceRoot, name), join(resourceRoot, name));
      }
      await mkdir(join(resourceRoot, "bin"), { recursive: true });
      await cp(winResources.sevenZipExe, join(resourceRoot, "bin", "7z.exe"));
      await cp(winResources.sevenZipDll, join(resourceRoot, "bin", "7z.dll"));
      await copyOptionalOpenCodeTree({
        platform: "win32",
        arch: "x64",
        requireBundled: config.requireOpenCode,
        resourceRoot,
      });
      await copyBundledNodeTree(bundledNode, resourceRoot);
      return { resourceName: "openpixo" };
    },
  };
  const manifest = await cache.acquire({
    materialize: options.materialize ? [{ from: "openpixo", to: paths.resourceRoot }] : [],
    node,
  });
  return {
    key,
    resourceRoot: options.materialize ? paths.resourceRoot : join(manifest.entryPath, "openpixo"),
  };
}

export async function copyWinIcon(paths: WinPaths): Promise<void> {
  await mkdir(dirname(paths.winIconPath), { recursive: true });
  await cp(winResources.icon, paths.winIconPath);
}
