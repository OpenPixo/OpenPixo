import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { spawnAgentProcess } from '../../src/runtimes/agent-process.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The packaged daemon has no console, so without this Windows opens a window per agent CLI.
it('starts an agent CLI without a console window', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pixo-agent-console-'));
  dirs.push(runDir);
  const { child } = spawnAgentProcess({
    command: process.execPath, args: ['-e', ''], env: process.env, cwd: runDir, stdin: 'ignore', runDir, runId: 'console-test',
  });
  await new Promise((resolve) => child.once('close', resolve));
  expect(vi.mocked(spawn).mock.calls[0]?.[2]).toMatchObject({ windowsHide: true });
});
