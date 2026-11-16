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
    const host = acquireProbeWorker();
    const id = nextProbeId++;
    host.pending.set(id, {
      resolve: (result) => {
        if ('error' in result) reject(Object.assign(new Error(result.error.message), result.error));
        else resolve(result);
      },
      reject,
    });
    holdProbeWorker(host);
    // A long-lived worker's process.env is a copy from when it started; send
    // the environment as it is now, as a per-probe Worker would have seen it.
    const probeOptions = options.env ? options : { ...options, env: { ...process.env } };
    try {
      host.worker.postMessage({ id, invocation, options: probeOptions } satisfies ProbeRequest);
    } catch (error) {
      host.pending.delete(id);
      releaseProbeWorker(host);
      reject(error);
    }
  });
}

// Probes share a few long-lived workers; a probe never starts its own isolate.
// One Worker per probe meant thousands of isolates created and torn down beside
// the main thread during an image batch (each codex-image generation re-runs
// the version, models, help and sign-in probes), and on Node 24.22.1 that load
// is where the daemon died natively (see probe-worker-reuse.test.ts). A few
// workers let slow spawns overlap; an idle one is unref'd so it never keeps the
// process alive, and retires after a while.
const PROBE_WORKER_LIMIT = 4;
const PROBE_WORKER_IDLE_MS = 10 * 60_000;

type ProbeRequest = { id: number; invocation: CommandInvocation; options: RuntimeExecOptions };
type ProbeResponse = { id: number; result: ProbeResult };
type ProbeWorker = {
  worker: Worker;
  pending: Map<number, { resolve: (result: ProbeResult) => void; reject: (error: unknown) => void }>;
  idleTimer: NodeJS.Timeout | null;
};

const probeWorkers: ProbeWorker[] = [];
let nextProbeId = 0;

function acquireProbeWorker(): ProbeWorker {
  const idle = probeWorkers.find(host => host.pending.size === 0);
  if (idle) return idle;
  if (probeWorkers.length < PROBE_WORKER_LIMIT) return startProbeWorker();
  return probeWorkers.reduce((least, host) => (host.pending.size < least.pending.size ? host : least));
}

function startProbeWorker(): ProbeWorker {
  const worker = new Worker(new URL(import.meta.url), { workerData: { agentProbeHost: true } });
  const host: ProbeWorker = { worker, pending: new Map(), idleTimer: null };
  probeWorkers.push(host);
  worker.on('message', ({ id, result }: ProbeResponse) => {
    const waiter = host.pending.get(id);
    if (!waiter) return;
    host.pending.delete(id);
    releaseProbeWorker(host);
    waiter.resolve(result);
  });
  const fail = (error: unknown) => {
    retireProbeWorker(host);
    const waiters = [...host.pending.values()];
    host.pending.clear();
    for (const waiter of waiters) waiter.reject(error);
  };
  worker.once('error', fail);
  worker.once('exit', (code) => fail(new Error(`Agent probe worker exited before returning a result (code ${code})`)));
  worker.unref();
  return host;
}

function holdProbeWorker(host: ProbeWorker): void {
  if (host.idleTimer) clearTimeout(host.idleTimer);
  host.idleTimer = null;
  // A pending probe keeps the process alive, as a per-probe Worker did.
  if (host.pending.size === 1) host.worker.ref();
}

function releaseProbeWorker(host: ProbeWorker): void {
  if (host.pending.size > 0 || !probeWorkers.includes(host)) return;
  host.worker.unref();
  host.idleTimer = setTimeout(() => {
    if (host.pending.size > 0) return;
    retireProbeWorker(host);
    void host.worker.terminate();
  }, PROBE_WORKER_IDLE_MS);
  host.idleTimer.unref();
}

function retireProbeWorker(host: ProbeWorker): void {
  if (host.idleTimer) clearTimeout(host.idleTimer);
  host.idleTimer = null;
  const index = probeWorkers.indexOf(host);
  if (index >= 0) probeWorkers.splice(index, 1);
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

async function runProbe({ invocation, options }: ProbeRequest): Promise<ProbeResult> {
  try {
    const { stdout, stderr } = await execAgentFileInWorker(invocation, options);
    return { stdout, stderr };
  } catch (error) {
    const failure = error as Error & { code?: string | number; killed?: boolean;
      signal?: string; stdout?: string; stderr?: string; path?: string; syscall?: string };
    return { error: {
      message: failure.message, code: failure.code, killed: failure.killed,
      signal: failure.signal, stdout: failure.stdout, stderr: failure.stderr,
      path: failure.path, syscall: failure.syscall,
    } };
  }
}

if (!isMainThread && workerData?.agentProbeHost) {
  parentPort!.on('message', (request: ProbeRequest) => {
    void runProbe(request).then(result => parentPort!.postMessage({ id: request.id, result } satisfies ProbeResponse));
  });
}
