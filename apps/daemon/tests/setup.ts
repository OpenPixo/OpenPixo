import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const daemonRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const daemonCliDist = path.join(daemonRoot, 'dist', 'cli.js');

function pnpmInvocation(): { args: string[]; command: string } {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && /\.(?:cjs|js)$/iu.test(npmExecPath)) {
    return { command: process.execPath, args: [npmExecPath] };
  }
  return { command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args: [] };
}

function ensureDaemonCliBuilt() {
  if (existsSync(daemonCliDist)) return;
  const pnpm = pnpmInvocation();
  execFileSync(pnpm.command, [...pnpm.args, 'run', 'build'], {
    cwd: daemonRoot,
    stdio: 'inherit',
    env: process.env,
  });
}

const TEST_DATA_DIR_SYMBOL = Symbol.for('openpixo.daemon.vitestDataDir');

const globalState = globalThis as typeof globalThis & {
  [TEST_DATA_DIR_SYMBOL]?: string;
};

if (!globalState[TEST_DATA_DIR_SYMBOL]) {
  globalState[TEST_DATA_DIR_SYMBOL] = mkdtempSync(path.join(tmpdir(), 'pixo-daemon-vitest-'));

  process.once('exit', () => {
    rmSync(globalState[TEST_DATA_DIR_SYMBOL]!, { force: true, recursive: true });
  });
}

// Server paths are resolved at module import time. Force every daemon test
// process to use one isolated data directory before any test imports server.ts,
// so tests can never read or overwrite the developer's real repo `.pixo` data.
process.env.PIXO_DATA_DIR = globalState[TEST_DATA_DIR_SYMBOL];
// CLI-backed endpoints shell out through PIXO_NODE_BIN + PIXO_BIN (dist/cli.js).
// Build the CLI artifact once per vitest process so package tests do not depend
// on a prior manual `pnpm --filter @openpixo/daemon build`.
ensureDaemonCliBuilt();
process.env.PIXO_DAEMON_CLI_PATH = daemonCliDist;
