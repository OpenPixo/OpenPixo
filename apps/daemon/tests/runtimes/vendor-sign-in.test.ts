import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { vendorSignInWithoutCli } from '../../src/runtimes/vendor-sign-in.js';

describe('vendorSignInWithoutCli', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function codexHome(signedIn: boolean): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'pixo-codex-home-'));
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    if (signedIn) writeFileSync(path.join(dir, 'auth.json'), '{}');
    return dir;
  }

  it('sees a Codex sign-in left by the desktop app or an editor extension', () => {
    expect(vendorSignInWithoutCli('codex', {}, { CODEX_HOME: codexHome(true) })).toBe(true);
    expect(vendorSignInWithoutCli('codex', {}, { CODEX_HOME: codexHome(false) })).toBe(false);
  });

  it('prefers the CODEX_HOME the user set for Codex in OpenPixo over the process one', () => {
    expect(vendorSignInWithoutCli('codex', { CODEX_HOME: codexHome(true) }, { CODEX_HOME: codexHome(false) })).toBe(true);
    expect(vendorSignInWithoutCli('codex', { CODEX_HOME: codexHome(false) }, { CODEX_HOME: codexHome(true) })).toBe(false);
  });

  it('only knows Codex', () => {
    expect(vendorSignInWithoutCli('claude', {}, { CODEX_HOME: codexHome(true) })).toBe(false);
    expect(vendorSignInWithoutCli('opencode', {}, { CODEX_HOME: codexHome(true) })).toBe(false);
  });
});
