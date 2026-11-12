import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { hashPackageSourcePath } from "@/package-source-hash.js";

describe("hashPackageSourcePath", () => {
  it("excludes runtime data and build outputs while tracking source edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "pixo-package-source-inputs-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "entry.ts"), "export const value = 1;");
      const before = await hashPackageSourcePath(root);
      for (const name of [".pixo", "dist", ".next", "out", "node_modules"]) {
        await mkdir(join(root, name));
        await writeFile(join(root, name, "noise"), "runtime bytes");
      }
      expect(await hashPackageSourcePath(root)).toBe(before);
      await writeFile(join(root, "src", "entry.ts"), "export const value = 2;");
      expect(await hashPackageSourcePath(root)).not.toBe(before);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("includes package versions in the source hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "openpixo-package-source-hash-"));
    const packageRoot = join(root, "apps", "packaged");
    try {
      await mkdir(join(packageRoot, "src"), { recursive: true });
      await writeFile(join(packageRoot, "src", "index.ts"), "export const value = 1;\n", "utf8");
      await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name: "@openpixo/packaged", version: "1.0.0" }, null, 2)}\n`, "utf8");
      const firstHash = await hashPackageSourcePath(packageRoot);

      await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name: "@openpixo/packaged", version: "1.0.1" }, null, 2)}\n`, "utf8");
      const secondHash = await hashPackageSourcePath(packageRoot);

      expect(secondHash).not.toBe(firstHash);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
