import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

function readPackageJson(): {
  exports?: Record<string, { default?: string; types?: string }>;
  files?: string[];
  main?: string;
  types?: string;
} {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
}

function packagePath(target: string): string {
  return join(packageRoot, target.replace(/^\.\//, ''));
}

describe('@openpixo/contracts package runtime shape', () => {
  it('exports built JavaScript instead of TypeScript source files', () => {
    const pkg = readPackageJson();

    expect(pkg.main).toBe('./dist/index.mjs');
    expect(pkg.types).toBe('./dist/index.d.ts');
    expect(pkg.files).toEqual(['dist']);
    expect(pkg.exports?.['.']?.default).toBe('./dist/index.mjs');
    expect(pkg.exports?.['.']?.types).toBe('./dist/index.d.ts');
    expect(pkg.exports?.['./api/connectionTest']?.default).toBe('./dist/api/connectionTest.mjs');
    expect(pkg.exports?.['./api/connectionTest']?.types).toBe('./dist/api/connectionTest.d.ts');
    expect(pkg.exports?.['./api/research']?.default).toBe('./dist/api/research.mjs');
    expect(pkg.exports?.['./api/research']?.types).toBe('./dist/api/research.d.ts');
    expect(pkg.exports?.['./runtime/deck-stage-fallback']?.default).toBe(
      './dist/runtime/deck-stage-fallback.mjs',
    );
    expect(pkg.exports?.['./runtime/deck-stage-fallback']?.types).toBe(
      './dist/runtime/deck-stage-fallback.d.ts',
    );
    expect(pkg.exports?.['./runtime/deck-protocol']?.default).toBe(
      './dist/runtime/deck-protocol.mjs',
    );
    expect(pkg.exports?.['./runtime/deck-protocol']?.types).toBe(
      './dist/runtime/deck-protocol.d.ts',
    );
  });

  it('points every runtime export at generated files', async () => {
    const pkg = readPackageJson();
    const exports = Object.entries(pkg.exports ?? {});

    expect(exports.length).toBeGreaterThan(0);
    for (const [_name, target] of exports) {
      expect(target.default).toMatch(/^\.\/dist\/.+\.mjs$/);
      expect(target.types).toMatch(/^\.\/dist\/.+\.d\.ts$/);
      await expect(access(packagePath(target.default!))).resolves.toBeUndefined();
      await expect(access(packagePath(target.types!))).resolves.toBeUndefined();
    }
  });

  it('makes runtime exports importable through package exports', async () => {
    // Exercise Node's actual package export resolution. Vite re-transforms the
    // built barrel and its dependency graph under full-suite load (>5s), while
    // native imports take milliseconds and cannot mask missing ESM exports.
    await execFileAsync(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      const contracts = await import('@openpixo/contracts');
      const connectionTest = await import('@openpixo/contracts/api/connectionTest');
      const research = await import('@openpixo/contracts/api/research');
      const deckStageFallback = await import('@openpixo/contracts/runtime/deck-stage-fallback');
      const deckProtocol = await import('@openpixo/contracts/runtime/deck-protocol');

      assert.equal(typeof contracts.composeOpenPixoGamePrompt, 'function');
      assert.deepEqual(contracts.exampleHealthResponse, { ok: true, service: 'daemon' });
      assert.equal(typeof connectionTest.validateBaseUrl, 'function');
      assert.equal(typeof connectionTest.isLoopbackApiHost, 'function');
      assert.equal(typeof connectionTest.isBlockedExternalApiHostname, 'function');
      assert.equal(research.RESEARCH_DEFAULT_MAX_SOURCES.shallow, 5);
      assert.equal(typeof deckStageFallback.injectDeckStageFallback, 'function');
      assert.equal(deckProtocol.DECK_PROTOCOL_VERSION, 1);
      assert.deepEqual(deckProtocol.DECK_PROTOCOL_V1_CAPABILITIES, ['absolute-navigation', 'state-events']);
    `], { cwd: packageRoot, windowsHide: true, timeout: 5_000 });
  });
});
