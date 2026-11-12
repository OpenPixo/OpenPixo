import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { createCommandInvocation, type CommandInvocation } from '@openpixo/platform';
import type { RuntimeExecOptions } from './types.js';

const execFileP = promisify(execFile);

// Agent probes (model-list / version / help / auth-status) are short read-only
// metadata calls that never need the caller's project files. Default them to a
// neutral working directory instead of inheriting the daemon process cwd.
//
// This matters because some agent CLIs are bun-based (OpenCode) and run a
// `bun install` on startup in their cwd to set up local plugins. When the daemon
// is launched from a pnpm workspace (e.g. a dev checkout), inheriting that cwd
// let an `opencode models` probe drop a workspace `bun.lock` + `node_modules/.bun`
// over the repo, wiping its pnpm store and breaking `next dev`. A probe writing a
// stray lockfile under the OS temp dir is harmless. Actual agent runs spawn
// elsewhere with an explicit project cwd and are unaffected.
export function execAgentFile(
  command: string,
  args: string[],
  options: RuntimeExecOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  // Resolve cmd.exe here: Windows process.env is case-sensitive in workers,
  // unlike the main thread, so its ComSpec lookup could lose a COMSPEC key.
  const invocation = createCommandInvocation(options.env ? { command, args, env: options.env } : { command, args });
  // Windows CreateProcess blocks inside even asynchronous execFile (measured
  // at seconds per scan). Keep process creation off the HTTP event loop too.
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { agentProbe: true, invocation, options },
    });
    worker.once('message', (result: ProbeResult) => {
      if ('error' in result) reject(Object.assign(new Error(result.error.message), result.error));
      else resolve(result);
    });
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`Agent probe worker exited before returning a result (code ${code})`)));
  });
}

type ProbeResult = { stdout: string; stderr: string } | {
  error: { message: string; code?: string | number | undefined; killed?: boolean | undefined;
    signal?: string | undefined; stdout?: string | undefined; stderr?: string | undefined;
    path?: string | undefined; syscall?: string | undefined };
};

async function execAgentFileInWorker(invocation: CommandInvocation, options: RuntimeExecOptions) {
  return execFileP(invocation.command, invocation.args, {
    // `timeout` alone is not a settle guarantee. execFile only *signals* on
    // expiry, and the promise settles on 'close' — which needs the child to
    // actually exit. A CLI that traps SIGTERM therefore leaves a probe pending
    // forever, and callers that await one before a Run can start park with it.
    // These are read-only metadata probes, so there is nothing to flush: kill
    // them outright. Listed before the spread so a caller can still choose.
    killSignal: 'SIGKILL',
    // Probes run every time the agent list refreshes; none of them may flash a console.
    windowsHide: true,
    ...options,
    cwd: options.cwd ?? os.tmpdir(),
    encoding: 'utf8',
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
}

if (!isMainThread && workerData?.agentProbe) {
  const { invocation, options } = workerData;
  try {
    const { stdout, stderr } = await execAgentFileInWorker(invocation, options);
    parentPort!.postMessage({ stdout, stderr } satisfies ProbeResult);
  } catch (error) {
    const failure = error as Error & { code?: string | number; killed?: boolean;
      signal?: string; stdout?: string; stderr?: string; path?: string; syscall?: string };
    parentPort!.postMessage({ error: {
      message: failure.message, code: failure.code, killed: failure.killed,
      signal: failure.signal, stdout: failure.stdout, stderr: failure.stderr,
      path: failure.path, syscall: failure.syscall,
    } } satisfies ProbeResult);
  }
}
