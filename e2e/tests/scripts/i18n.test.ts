import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function withLocaleFixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpixo-i18n-"));
  try {
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await mkdir(path.join(root, "apps/web/src/i18n/locales"), { recursive: true });
    await mkdir(path.join(root, "docs/i18n"), { recursive: true });
    await writeFile(path.join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(path.join(root, "apps/web/src/i18n/types.ts"), [
      "export type Locale = 'en' | 'zh-CN';",
      "export const LOCALES: Locale[] = ['en', 'zh-CN'];",
      "export const LOCALE_LABEL = { 'en': 'English', 'zh-CN': '简体中文' };",
    ].join("\n"));
    await writeFile(path.join(root, "apps/web/src/i18n/index.tsx"), [
      "const DICTS: LocaleDicts = {",
      "  'en': en,",
      "  'zh-CN': zhCN,",
      "};",
    ].join("\n"));
    await writeFile(path.join(root, "apps/web/src/i18n/locales/en.ts"), [
      "export const en = {",
      "  'greeting': 'Hello',",
      "  'technical': 'API',",
      "};",
    ].join("\n"));
    await writeFile(path.join(root, "apps/web/src/i18n/locales/zh-CN.ts"), [
      "export const zhCN = {",
      "  'greeting': '你好',",
      "  'technical': 'API',",
      "};",
    ].join("\n"));
    const switcher = '[English](README.md) · [简体中文](README.zh-CN.md)\n';
    await writeFile(path.join(root, "README.md"), switcher);
    await writeFile(path.join(root, "README.zh-CN.md"), switcher);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runScript(root: string, name: string) {
  const destination = path.join(root, "scripts", name);
  await copyFile(path.join(repoRoot, "scripts", name), destination);
  return spawnSync(process.execPath, [destination], { cwd: root, encoding: "utf8" });
}

test.each(["LocaleDicts", "Record<Locale, Dict>"])("i18n check accepts the maintained dictionaries registered as %s", async (annotation) => {
  await withLocaleFixture(async (root) => {
    await writeFile(path.join(root, "apps/web/src/i18n/index.tsx"), [
      `const DICTS: ${annotation} = {`,
      "  'en': en,",
      "  'zh-CN': zhCN,",
      "};",
    ].join("\n"));
    const result = await runScript(root, "i18n-check.ts");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("i18n P0 check passed");
  });
});

test("i18n check reports missing maintained registrations and retired locale files", async () => {
  await withLocaleFixture(async (root) => {
    await writeFile(path.join(root, "apps/web/src/i18n/index.tsx"), "const DICTS: LocaleDicts = { 'en': en };\n");
    await writeFile(path.join(root, "apps/web/src/i18n/locales/de.ts"), "export const de = {};\n");
    const result = await runScript(root, "i18n-check.ts");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("zh-CN is listed in LOCALES but DICTS has no entry");
    expect(result.stderr).toContain("de.ts exists but de is not listed in LOCALES");
    expect(result.stderr).not.toContain("en is listed in LOCALES but DICTS has no entry");
  });
});

test("i18n check rejects broken root README switcher links", async () => {
  await withLocaleFixture(async (root) => {
    await writeFile(path.join(root, "README.zh-CN.md"),
      '[English](../README.md) · [简体中文](README.zh-CN.md)\n');
    const result = await runScript(root, "i18n-check.ts");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("README.zh-CN.md links to missing README ../README.md");
  });
});

test("i18n check retains localized core-document checks for root Chinese README", async () => {
  await withLocaleFixture(async (root) => {
    await writeFile(path.join(root, "README.zh-CN.md"), [
      '[English](README.md) · [简体中文](README.zh-CN.md)',
      '[Contributing](CONTRIBUTING.md)',
    ].join("\n"));
    await writeFile(path.join(root, "CONTRIBUTING.md"), "English guide\n");
    await writeFile(path.join(root, "docs/i18n/CONTRIBUTING.zh-CN.md"), "中文指南\n");
    const result = await runScript(root, "i18n-check.ts");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("README.zh-CN.md links to CONTRIBUTING.md, but CONTRIBUTING.zh-CN.md exists");
  });
});

test("i18n coverage reports both maintained locales and their English key parity", async () => {
  await withLocaleFixture(async (root) => {
    const result = await runScript(root, "i18n-coverage-report.ts");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^en\s+English\s+keys=\s*2 missing=\s*0 orphan=\s*0/m);
    expect(result.stdout).toMatch(/^zh-CN\s+简体中文\s+keys=\s*2 missing=\s*0 orphan=\s*0 untranslated=\s*1 coverage=100%/m);
    expect(result.stdout).toContain("zh-CN: all English keys present");
  });
});
