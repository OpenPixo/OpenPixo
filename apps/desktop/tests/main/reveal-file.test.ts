import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveProjectFileForReveal } from "../../src/main/reveal-file.js";

describe("resolveProjectFileForReveal", () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pixo-reveal-"));
    project = join(root, "game");
    await mkdir(join(project, "art"), { recursive: true });
    await writeFile(join(project, "art", "hero.png"), "png");
    await writeFile(join(root, "secret.txt"), "outside");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves a file inside the project", async () => {
    const result = await resolveProjectFileForReveal(project, "art/hero.png");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolved.toLowerCase()).toContain(join("art", "hero.png").toLowerCase());
  });

  it("accepts Windows separators", async () => {
    const result = await resolveProjectFileForReveal(project, "art\\hero.png");
    expect(result.ok).toBe(true);
  });

  it.each([
    ["parent segments", "../secret.txt"],
    ["nested parent segments", "art/../../secret.txt"],
    ["a POSIX absolute path", "/etc/passwd"],
    ["a drive path", "C:/Windows/win.ini"],
    ["an empty path", ""],
    ["a NUL byte", "art/hero.png\0.txt"],
  ])("refuses %s", async (_label, relPath) => {
    const result = await resolveProjectFileForReveal(project, relPath);
    expect(result.ok).toBe(false);
  });

  it("refuses a value that is not a string", async () => {
    expect((await resolveProjectFileForReveal(project, 42)).ok).toBe(false);
  });

  it("refuses a file that does not exist", async () => {
    const result = await resolveProjectFileForReveal(project, "art/missing.png");
    expect(result).toEqual({ ok: false, reason: "file does not exist" });
  });

  it("refuses a link that points outside the project", async (context) => {
    try {
      await symlink(join(root, "secret.txt"), join(project, "link.txt"));
    } catch {
      // Creating symlinks needs Developer Mode or admin rights on Windows.
      context.skip();
      return;
    }
    const result = await resolveProjectFileForReveal(project, "link.txt");
    expect(result).toEqual({ ok: false, reason: "file path must stay inside the project" });
  });
});
