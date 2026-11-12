import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { checkRootPackageManagerLockfiles, checkUpstreamNames, collectUpstreamNameViolationsFromSource, isScriptTestFile } from "../../../scripts/guard.ts";

const temporaryDirectories: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })));
});

async function temporaryRepository(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "openpixo-guard-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("scripts test-free boundary", () => {
  test.each(["scripts/example.test.ts", "scripts/example.test.mts"])("recognizes %s as a test file", (file) => {
    expect(isScriptTestFile(file)).toBe(true);
  });

  test("does not classify a non-test filename as a test file", () => {
    expect(isScriptTestFile("scripts/example.ts")).toBe(false);
  });
});

describe("root package-manager lockfile boundary", () => {
  test("accepts a repository without a Bun lockfile", async () => {
    const repository = await temporaryRepository();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(checkRootPackageManagerLockfiles(repository)).resolves.toBe(true);
  });

  test("rejects a root bun.lock", async () => {
    const repository = await temporaryRepository();
    await writeFile(path.join(repository, "bun.lock"), "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(checkRootPackageManagerLockfiles(repository)).resolves.toBe(false);
  });
});

// Construct rejected spellings so this test file is checked by the same policy
// as product files; it needs no blanket test-directory exception.
const shortPrefix = ['o', 'd'].join('');
const joinedBrand = ['Open', 'Design'].join('');
const slug = ['open', 'design'].join('-');
const namingCases = [
  { family: 'package scope', value: `@${slug}/contracts` },
  { family: 'camel-case brand', value: joinedBrand },
  { family: 'spaced brand', value: ['Open', 'Design'].join(' ') },
  { family: 'product slug', value: slug },
  { family: 'underscore brand', value: ['OPEN', 'DESIGN'].join('_') },
  { family: 'compact brand word', value: joinedBrand.toLowerCase() },
  { family: 'upstream organization', value: ['ne', 'xu'].join('') },
  { family: 'upstream organization', value: ['NEX', 'U_API_KEY'].join('') },
  { family: 'upstream organization', value: ['Nex', 'uRuntime'].join('') },
  { family: 'upstream organization', value: ['myNe', 'xuAdapter'].join('') },
  { family: 'environment/constant prefix', value: `${shortPrefix.toUpperCase()}_DATA_DIR` },
  { family: 'environment/constant prefix', value: `NEXT_PUBLIC_${shortPrefix.toUpperCase()}_MODE` },
  { family: 'owned wire key', value: `${shortPrefix}_input_streaming` },
  { family: 'owned token/continuation prefix', value: `${shortPrefix}tt_token` },
  { family: 'HTTP header', value: `x-${shortPrefix}-token` },
  { family: 'card tag', value: `<${shortPrefix}-card>` },
  { family: 'manifest filename', value: `${slug}.json` },
  { family: 'OS protocol', value: `${shortPrefix}://project` },
  { family: 'quoted event/storage prefix', value: `"${shortPrefix}:event"` },
  { family: 'quoted event/storage prefix', value: `'${shortPrefix}:event'` },
  { family: 'quoted event/storage prefix', value: '`' + shortPrefix + ':event`' },
  { family: 'project directory', value: `./.${shortPrefix}/projects` },
  { family: 'CSS custom property', value: `:root { --${shortPrefix}-accent: red; }`, extension: 'css' },
  { family: 'CSS class/hook', value: `.${shortPrefix}-toolbar { display: flex; }`, extension: 'css' },
  { family: 'retired cloud runtime', value: ['ve', 'la'].join('') },
];

async function trackFixture(file: string, source: string | Uint8Array): Promise<string> {
  const root = await temporaryRepository();
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), source);
  execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['add', '--force', '--', file], { cwd: root, stdio: 'pipe' });
  return root;
}

describe('upstream-name regression boundary', () => {
  test.each(namingCases)('rejects tracked text for $family', async ({ family, value, extension }) => {
    const file = `apps/example/src/fixture.${extension ?? 'ts'}`;
    const source = `// first line\n${value}\n`;
    expect(collectUpstreamNameViolationsFromSource(file, source).map(error => error.pattern)).toContain(family);
    const root = await trackFixture(file, source);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(checkUpstreamNames(root)).resolves.toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(`${file}:2 [${family}]`));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ADR 0011'));
  });

  test.each([`${slug}.ts`, `${joinedBrand.toLowerCase()}.ts`, `${shortPrefix}-helper.ts`, `${shortPrefix}.config.ts`, `${shortPrefix}Helper.ts`])
  ('rejects an old tracked path even when its contents are clean: %s', async name => {
    const root = await trackFixture(`apps/example/src/${name}`, 'export {};\n');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(checkUpstreamNames(root)).resolves.toBe(false);
  });

  test('checks tracked binary filenames without scanning binary payloads', async () => {
    const root = await trackFixture(`assets/${shortPrefix}-image.png`, new Uint8Array([0, 1, 2]));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(checkUpstreamNames(root)).resolves.toBe(false);
    expect(collectUpstreamNameViolationsFromSource('assets/image.png', '')).toEqual([]);
  });

  test('accepts a reviewed historical path', async () => {
    const root = await trackFixture('docs/coordination/fixture.md', joinedBrand);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(checkUpstreamNames(root)).resolves.toBe(true);
  });

  test('checks current documentation and shipped template styles', () => {
    expect(collectUpstreamNameViolationsFromSource('docs/current.md', joinedBrand).length).toBeGreaterThan(0);
    expect(collectUpstreamNameViolationsFromSource('skills/example/SKILL.md', `.${shortPrefix}-hook {}`)
      .map(error => error.pattern)).toContain('CSS class/hook');
  });

  test('does not exempt all root guidance when only its fork line is allowed', async () => {
    const source = await readFile(path.join(repositoryRoot, 'AGENTS.md'), 'utf8');
    expect(collectUpstreamNameViolationsFromSource('AGENTS.md', source)).toEqual([]);
    expect(collectUpstreamNameViolationsFromSource('AGENTS.md', `${source}\n${joinedBrand}\n`).length).toBeGreaterThan(0);
  });

  test('permits unrelated words, natural-language text, suffixes and embedded binary assets', () => {
    const source = 'const odd = "oddities, Odin, Nexus, oder, odczyt, period-value, method://";\n'
      + `<img src="data:image/png;base64,${joinedBrand}" alt="sprite">`;
    expect(collectUpstreamNameViolationsFromSource('apps/example/src/fixture.ts', source)).toEqual([]);
    expect(collectUpstreamNameViolationsFromSource('apps/example/src/fixture.ts', source + joinedBrand).length).toBeGreaterThan(0);
  });

  test('the current tracked tree satisfies the policy', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(checkUpstreamNames(repositoryRoot)).resolves.toBe(true);
  }, 20_000);
});
