import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cac } from "cac";
import { describe, expect, it } from "vitest";

import { exportSiteData, registerSiteCommand, writeSiteData } from "../src/site/cli.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function fixtureRepo(): { root: string; write: (path: string, value: string) => void } {
  const root = mkdtempSync(join(tmpdir(), "openpixo-site-export-"));
  const write = (path: string, value: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  return { root, write };
}

describe("site export", () => {
  it("exports release notes, recipes only and the Store snapshot with empty fields dropped", () => {
    const { root, write } = fixtureRepo();
    try {
      write("CHANGELOG.md", "# Changelog\r\n\r\n## 1.0.0\r\n");
      write("plugins/_official/recipes/walk/pixo.json", JSON.stringify({
        name: "openpixo/walk", title: "Walk cycle", description: "Sheet.", title_i18n: { "zh-CN": "行走" },
        pixo: { kind: "recipe", recipe: { surface: "image", category: "sprites" } },
      }));
      write("plugins/_official/recipes/skill/pixo.json", JSON.stringify({ name: "openpixo/skill", pixo: { kind: "skill" } }));
      mkdirSync(join(root, "plugins/_official/recipes/empty-folder"), { recursive: true });
      write("plugins/registry/official/openpixo-marketplace.json", JSON.stringify({ plugins: [
        { name: "openpixo/free", title: "Free kit", license: "MIT", source: "./x", kind: "skill", version: "1.0.0" },
        { name: "openpixo/paid", title: "Pack", pricing: { type: "paid", credits: 300 } },
      ] }));
      const data = exportSiteData(root);
      expect(data).toEqual({
        schema: 1,
        changelog: "# Changelog\n\n## 1.0.0\n",
        recipes: [{ name: "openpixo/walk", title: "Walk cycle", description: "Sheet.", title_i18n: { "zh-CN": "行走" }, surface: "image", category: "sprites" }],
        marketplace: { plugins: [
          { name: "openpixo/free", title: "Free kit", license: "MIT", kind: "skill" },
          { name: "openpixo/paid", title: "Pack", pricing: { type: "paid", credits: 300 } },
        ] },
      });
      const out = join(root, "site/data/app.json");
      writeSiteData(root, out);
      expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(data);
      expect(readFileSync(out, "utf8").endsWith("}\n")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a Store snapshot the website could not parse", () => {
    const { root, write } = fixtureRepo();
    try {
      write("CHANGELOG.md", "# Changelog\n");
      mkdirSync(join(root, "plugins/_official/recipes"), { recursive: true });
      write("plugins/registry/official/openpixo-marketplace.json", JSON.stringify({ plugins: [{ name: "x", pricing: { type: "paid", credits: -1 } }] }));
      expect(() => exportSiteData(root)).toThrow(/credit price/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exports this repository's real recipes and Store snapshot", () => {
    const data = exportSiteData(repoRoot);
    expect(data.recipes.length).toBeGreaterThan(0);
    expect(data.marketplace.plugins.length).toBeGreaterThan(0);
    expect(data.changelog).toMatch(/^# /);
  });

  it("registers site export with an output path", () => {
    const cli = cac("test-release");
    registerSiteCommand(cli);
    const parsed = cli.parse(["node", "test-release", "site", "export", "--out", "x/app.json"], { run: false });
    expect(parsed.args).toEqual(["export"]);
    expect(parsed.options.out).toBe("x/app.json");
  });
});
