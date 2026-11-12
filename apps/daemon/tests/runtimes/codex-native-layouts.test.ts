import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { resolveAgentLaunch } from '../../src/runtimes/launch.js';
import { codexAgentDef } from '../../src/runtimes/defs/codex.js';
import { withEnvSnapshot } from './helpers/test-helpers.js';

const winTest = process.platform === 'win32' ? test : test.skip;

winTest.each(['nested', 'hoisted', 'legacy'])('resolves the Windows Codex %s npm vendor/bin layout without launching a shim', (layout) => {
  const root = mkdtempSync(join(tmpdir(), 'openpixo-codex-layout-'));
  try {
    withEnvSnapshot(['PATH', 'PATHEXT', 'PIXO_AGENT_HOME', 'CODEX_BIN'], () => {
      const wrapper = join(root, 'codex.CMD');
      const packageRoot = join(root, 'node_modules', '@openai', 'codex');
      const platformPackage = `codex-win32-${process.arch}`;
      const nativeRoot = layout === 'nested'
        ? join(packageRoot, 'node_modules', '@openai', platformPackage)
        : layout === 'hoisted' ? join(root, 'node_modules', '@openai', platformPackage) : packageRoot;
      const target = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
      const nativeDir = join(nativeRoot, 'vendor', target, 'bin');
      const native = join(nativeDir, 'codex.exe');
      mkdirSync(nativeDir, { recursive: true });
      writeFileSync(wrapper, '@echo off\r\nnode @openai/codex/bin/codex.js\r\n');
      writeFileSync(native, 'fixture native executable');
      process.env.PATH = root;
      process.env.PATHEXT = '.EXE;.CMD;.BAT';
      process.env.PIXO_AGENT_HOME = root;
      delete process.env.CODEX_BIN;
      expect(resolveAgentLaunch(codexAgentDef)).toMatchObject({
        selectedPath: wrapper, launchPath: native, launchKind: 'codex-native', diagnostic: null,
      });
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
