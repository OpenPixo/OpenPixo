import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolPackCache } from "@/cache/index.js";
import type { ToolPackConfig } from "@/config/index.js";
import { BUNDLED_RESOURCE_TREES } from "@/resources/index.js";
import { prepareResourceTree } from "@/win/resources.js";
import type { WinPaths } from "@/win/types.js";
import * as openCodeRuntime from "@/opencode-runtime.js";
import { BUNDLED_NODE_TREE_ENV } from "@/node-runtime.js";

const RESOURCE_TREE_CACHE_TEST_TIMEOUT_MS = 15_000;

let openCodeRoot: string;
beforeEach(async () => {
  openCodeRoot = await mkdtemp(join(tmpdir(), "opencode-cache-witness-"));
  const tree = join(openCodeRoot, "bin");
  await mkdir(tree);
  await writeFile(join(tree, "opencode.exe"), "fixture binary");
  vi.stubEnv(openCodeRuntime.OPEN_CODE_TREE_ENV, tree);
  const nodeTree = join(openCodeRoot, "node");
  await mkdir(join(nodeTree, "node_modules", "npm", "bin"), { recursive: true });
  await writeFile(join(nodeTree, "node.exe"), "fixture node");
  await writeFile(join(nodeTree, "npm.cmd"), "fixture npm shim");
  await writeFile(join(nodeTree, "node_modules", "npm", "bin", "npm-cli.js"), "fixture npm");
  await writeFile(join(nodeTree, "install_tools.bat"), "not shipped");
  vi.stubEnv(BUNDLED_NODE_TREE_ENV, nodeTree);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(openCodeRoot, { recursive: true, force: true });
});

async function createWorkspaceFixture(workspaceRoot: string): Promise<void> {
  await mkdir(join(workspaceRoot, "skills", "sample"), { recursive: true });
  await writeFile(join(workspaceRoot, "LICENSE"), "Apache-2.0\n", "utf8");
  await writeFile(join(workspaceRoot, "NOTICE"), "OpenPixo attribution\n", "utf8");
  await mkdir(join(workspaceRoot, "design-templates", "orbit-general"), {
    recursive: true,
  });
  await mkdir(join(workspaceRoot, "design-systems", "sample"), {
    recursive: true,
  });
  await mkdir(join(workspaceRoot, "game-templates", "sample", "files"), { recursive: true });
  await mkdir(join(workspaceRoot, "game-sdk", "openpixo-rooms"), { recursive: true });
  await mkdir(join(workspaceRoot, "craft", "sample"), { recursive: true });
  await mkdir(join(workspaceRoot, "plugins", "_official", "sample"), {
    recursive: true,
  });
  await writeFile(
    join(workspaceRoot, "plugins", "_official", "sample", "pixo.json"),
    "{\"id\":\"sample\"}\n",
    "utf8",
  );
  await mkdir(join(workspaceRoot, "plugins", "registry", "community"), {
    recursive: true,
  });
  await writeFile(
    join(workspaceRoot, "plugins", "registry", "community", "openpixo-marketplace.json"),
    "{\"plugins\":[]}\n",
    "utf8",
  );
  await mkdir(join(workspaceRoot, "assets", "frames"), { recursive: true });
  await mkdir(join(workspaceRoot, "prompt-templates", "image"), {
    recursive: true,
  });
  await mkdir(join(workspaceRoot, "data", "plugin-previews"), {
    recursive: true,
  });
  await writeFile(
    join(workspaceRoot, "data", "plugin-previews", "manifest.json"),
    "{\"previews\":{}}\n",
    "utf8",
  );
  await mkdir(join(workspaceRoot, "plugins", "registry", "official"), {
    recursive: true,
  });
}

describe("prepareResourceTree", () => {
  it("tracks the OpenCode package identity, binary and notices, ignoring unrelated output", async () => {
    const workspaceRoot = join(openCodeRoot, "workspace");
    const resourceRoot = join(openCodeRoot, "resources");
    await createWorkspaceFixture(workspaceRoot);
    const notice = join(openCodeRoot, "LICENSE");
    await writeFile(notice, "MIT license");
    const distribution: openCodeRuntime.OpenCodeDistribution = {
      source: join(openCodeRoot, "bin"), packageName: "opencode-windows-x64-baseline", version: "1.18.35",
      notices: [{ source: notice, target: "licenses/opencode-ai/LICENSE" }],
    };
    vi.spyOn(openCodeRuntime, "resolveOptionalOpenCodeDistribution").mockResolvedValue(distribution);
    const cache = new ToolPackCache(join(openCodeRoot, "cache"));
    const prepare = () => prepareResourceTree({ workspaceRoot } as ToolPackConfig, { resourceRoot } as WinPaths, cache, { materialize: true });
    let previous = await prepare();
    const changes = [
      async () => { distribution.version = "changed-version"; },
      async () => { distribution.packageName = "changed-target-package"; },
      async () => { await writeFile(join(distribution.source, "opencode.exe"), "changed binary"); },
      async () => { await writeFile(notice, "changed license"); },
      async () => { distribution.notices[0]!.target = "licenses/opencode-ai/NOTICE"; },
    ];
    for (const change of changes) {
      await change();
      const next = await prepare();
      expect(next.key).not.toBe(previous.key);
      previous = next;
    }
    await mkdir(join(workspaceRoot, "dist"));
    await writeFile(join(workspaceRoot, "dist", "generated.js"), "non-input");
    expect((await prepare()).key).toBe(previous.key);
  }, RESOURCE_TREE_CACHE_TEST_TIMEOUT_MS);

  it("ships Node.js for games beside the app and tracks its content", async () => {
    const workspaceRoot = join(openCodeRoot, "workspace");
    const resourceRoot = join(openCodeRoot, "resources");
    await createWorkspaceFixture(workspaceRoot);
    const cache = new ToolPackCache(join(openCodeRoot, "cache"));
    const prepare = () => prepareResourceTree({ workspaceRoot } as ToolPackConfig, { resourceRoot } as WinPaths, cache, { materialize: true });
    const first = await prepare();
    const shipped = join(resourceRoot, "bin", "libexec", "node");
    await expect(readFile(join(shipped, "node.exe"), "utf8")).resolves.toBe("fixture node");
    await expect(readFile(join(shipped, "npm.cmd"), "utf8")).resolves.toBe("fixture npm shim");
    await expect(readFile(join(shipped, "node_modules", "npm", "bin", "npm-cli.js"), "utf8")).resolves.toBe("fixture npm");
    await expect(readFile(join(shipped, "install_tools.bat"), "utf8")).rejects.toThrow();
    await writeFile(join(openCodeRoot, "node", "node.exe"), "changed node");
    const second = await prepare();
    expect(second.key).not.toBe(first.key);
    await expect(readFile(join(shipped, "node.exe"), "utf8")).resolves.toBe("changed node");
  }, RESOURCE_TREE_CACHE_TEST_TIMEOUT_MS);

  it("tracks every bundled resource tree including game templates, while ignoring build output", async () => {
    const root = await mkdtemp(join(tmpdir(), "openpixo-resource-inputs-"));
    const workspaceRoot = join(root, "workspace");
    const resourceRoot = join(root, "materialized", "openpixo");
    const config = { workspaceRoot } as ToolPackConfig;
    const cache = new ToolPackCache(join(root, "cache"));
    const prepare = () => prepareResourceTree(config, { resourceRoot } as WinPaths, cache, { materialize: true });
    try {
      await createWorkspaceFixture(workspaceRoot);
      let previous = await prepare();
      for (const { from, to } of BUNDLED_RESOURCE_TREES) {
        await writeFile(join(workspaceRoot, from, "cache-witness.txt"), "changed\n", "utf8");
        const next = await prepare();
        expect(next.key, from).not.toBe(previous.key);
        await expect(readFile(join(resourceRoot, to, "cache-witness.txt"), "utf8")).resolves.toBe("changed\n");
        previous = next;
      }
      await mkdir(join(workspaceRoot, "dist"), { recursive: true });
      await writeFile(join(workspaceRoot, "dist", "output.js"), "generated\n", "utf8");
      expect((await prepare()).key).toBe(previous.key);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, RESOURCE_TREE_CACHE_TEST_TIMEOUT_MS);


  it("ships attribution and invalidates each notice input without hashing build output", async () => {
    const root = await mkdtemp(join(tmpdir(), "openpixo-win-notices-"));
    const workspaceRoot = join(root, "workspace");
    const resourceRoot = join(root, "materialized", "openpixo");
    const config = { workspaceRoot } as ToolPackConfig;
    const paths = { resourceRoot } as WinPaths;
    const cache = new ToolPackCache(join(root, "cache"));
    const prepare = () => prepareResourceTree(config, paths, cache, { materialize: true });
    try {
      await createWorkspaceFixture(workspaceRoot);
      let previous = await prepare();
      for (const name of ["LICENSE", "NOTICE"]) {
        const content = `updated ${name}\n`;
        await writeFile(join(workspaceRoot, name), content, "utf8");
        const next = await prepare();
        expect(next.key).not.toBe(previous.key);
        await expect(readFile(join(resourceRoot, name), "utf8")).resolves.toBe(content);
        previous = next;
      }
      await mkdir(join(workspaceRoot, "dist"), { recursive: true });
      await writeFile(join(workspaceRoot, "dist", "generated.js"), "generated\n", "utf8");
      expect((await prepare()).key).toBe(previous.key);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, RESOURCE_TREE_CACHE_TEST_TIMEOUT_MS);


  it("invalidates the Windows resource tree cache when design templates change", async () => {
    const root = await mkdtemp(join(tmpdir(), "openpixo-win-resources-"));
    const workspaceRoot = join(root, "workspace");
    const resourceRoot = join(root, "materialized", "openpixo");
    const cache = new ToolPackCache(join(root, "cache"));
    const config = { workspaceRoot } as ToolPackConfig;
    const paths = { resourceRoot } as WinPaths;
    const templatePath = join(
      workspaceRoot,
      "design-templates",
      "orbit-general",
      "SKILL.md",
    );
    const materializedTemplatePath = join(
      resourceRoot,
      "design-templates",
      "orbit-general",
      "SKILL.md",
    );

    try {
      await createWorkspaceFixture(workspaceRoot);
      await writeFile(templatePath, "version one\n", "utf8");

      await prepareResourceTree(config, paths, cache, { materialize: true });

      await expect(readFile(materializedTemplatePath, "utf8")).resolves.toBe(
        "version one\n",
      );

      await writeFile(templatePath, "version two\n", "utf8");

      await prepareResourceTree(config, paths, cache, { materialize: true });

      await expect(readFile(materializedTemplatePath, "utf8")).resolves.toBe(
        "version two\n",
      );
      expect(cache.report().entries.map((entry) => entry.status)).toEqual([
        "miss",
        "miss",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, RESOURCE_TREE_CACHE_TEST_TIMEOUT_MS);

  it("invalidates the Windows resource tree cache when the plugin-preview manifest changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "openpixo-win-previews-"));
    const workspaceRoot = join(root, "workspace");
    const resourceRoot = join(root, "materialized", "openpixo");
    const cache = new ToolPackCache(join(root, "cache"));
    const config = { workspaceRoot } as ToolPackConfig;
    const paths = { resourceRoot } as WinPaths;
    const manifestPath = join(
      workspaceRoot,
      "data",
      "plugin-previews",
      "manifest.json",
    );
    const materializedManifestPath = join(
      resourceRoot,
      "data",
      "plugin-previews",
      "manifest.json",
    );

    try {
      await createWorkspaceFixture(workspaceRoot);
      await writeFile(manifestPath, "{\"previews\":{\"a\":1}}\n", "utf8");

      await prepareResourceTree(config, paths, cache, { materialize: true });

      await expect(readFile(materializedManifestPath, "utf8")).resolves.toBe(
        "{\"previews\":{\"a\":1}}\n",
      );

      await writeFile(manifestPath, "{\"previews\":{\"a\":2}}\n", "utf8");

      await prepareResourceTree(config, paths, cache, { materialize: true });

      await expect(readFile(materializedManifestPath, "utf8")).resolves.toBe(
        "{\"previews\":{\"a\":2}}\n",
      );
      expect(cache.report().entries.map((entry) => entry.status)).toEqual([
        "miss",
        "miss",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, RESOURCE_TREE_CACHE_TEST_TIMEOUT_MS);
});
