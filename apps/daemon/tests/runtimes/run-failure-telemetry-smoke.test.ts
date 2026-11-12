import { type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path, { delimiter } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { claudeAgentDef } from '../../src/runtimes/defs/claude.js';
import { classifyRunFailure } from '../../src/run-failure-classification.js';
import { summarizeRunDiagnosticsForAnalytics } from '../../src/run-diagnostics.js';
import { deriveRunErrorCode, runResultFromStatus } from '../../src/run-result.js';

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type RunStatus = {
  id: string;
  projectId: string;
  conversationId: string;
  assistantMessageId: string;
  agentId: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  errorCode: string | null;
  /** The daemon's own settled verdict, published on the terminal run status. */
  failureCategory: string | null;
  failureDetail: string | null;
  eventsLogPath: string;
};

type RunEvent = {
  event: string;
  data: unknown;
};

describe('run failure telemetry smoke', () => {
  const originalEnv = snapshotEnv();
  let started: StartedServer | null = null;
  let binDir: string | null = null;
  let dataDirs: string[] = [];

  afterEach(async () => {
    await stopDaemon();
    if (binDir) await rm(binDir, { recursive: true, force: true });
    binDir = null;
    for (const root of dataDirs) await removeDataDir(root);
    dataDirs = [];
    restoreEnv(originalEnv);
    vi.resetModules();
  });

  async function stopDaemon(): Promise<void> {
    const current = started;
    started = null;
    if (!current) return;
    await Promise.resolve(current.shutdown?.());
    current.server.closeAllConnections?.();
    current.server.closeIdleConnections?.();
    await new Promise<void>((resolve) => current.server.close(() => resolve()));
  }

  /**
   * Each case owns its daemon data root.
   *
   * `server.ts` resolves `PIXO_DATA_DIR` into `RUNTIME_DATA_DIR` once at module
   * import time, so a fresh root only takes effect behind `vi.resetModules()`
   * plus a dynamic import. Sharing one root across cases let the first case's
   * failures latch the OD Next rollout stop in SQLite, which silently pushed
   * later cases onto the legacy single-Run reporter and made their telemetry
   * assertions pass against a path they were not meant to exercise.
   */
  async function startIsolatedServer(): Promise<StartedServer> {
    await stopDaemon();
    vi.resetModules();
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixo-run-failure-smoke-data-'));
    dataDirs.push(root);
    process.env.PIXO_DATA_DIR = root;
    const serverModule = await import('../../src/server.js') as unknown as {
      startServer(options: { port: number; returnServer: true }): Promise<StartedServer>;
    };
    return await serverModule.startServer({ port: 0, returnServer: true });
  }

  it('reclassifies upstream + install/env failures end-to-end through a real daemon run (#3408 P1)', async () => {
    // End-to-end proof for the reclassification: a real agent process emits the
    // production error text (or fails to spawn), the daemon records it into the
    // run's events.jsonl, and classifyRunFailure (on the REAL recorded events,
    // not a hand-built input) must land it in the correct category instead of
    // the opaque execution_failed bucket. Generous inactivity timeout so the
    // 100ms exit always wins the race (this test is not about timeouts).
    binDir = await mkdtemp(path.join(os.tmpdir(), 'pixo-provider-reclassify-bin-'));
    await writeFakeClaude(
      binDir,
      'provider-balance',
      'Insufficient Balance',
    );
    await writeFakeClaude(binDir, 'provider-ratelimit', '429 您的账户已达到速率限制，请您控制请求频率');
    await writeFakeClaude(binDir, 'provider-model', 'API Error: 400 model deepseek-v4-pro-202606 not in allowed list');
    await writeFakeClaude(
      binDir,
      'env-node-path',
      "'node' is not recognized as an internal or external command, operable program or batch file.",
    );
    // The agent itself reports a missing vendored sub-binary (real codex shape).
    await writeFakeClaude(
      binDir,
      'env-spawn-enoent',
      'Error: spawn /opt/homebrew/lib/node_modules/@openai/codex/codex ENOENT',
    );
    await writeFakeClaude(
      binDir,
      'a-prefill',
      'MLX prefill memory guard rejected this prompt: Prefill context too large for available memory',
    );
    await writeFakeClaude(
      binDir,
      'a-thread-start',
      'Reading prompt from stdin... Error: thread/start: thread/start failed: failed to start session',
    );
    await writeFakeClaude(
      binDir,
      'a-auth',
      "login fail: Please carry the API secret key in the 'Authorization' field of the request header (1004)",
    );
    await writeFakeClaude(
      binDir,
      'a-lmstudio',
      "No models loaded. Please load a model in the developer page or use the 'lms load' command.",
    );
    await writeFakeClaude(
      binDir,
      'a-resume-expired',
      'no conversation found with session id 1d2c3b4a-0000-0000-0000-000000000000',
    );

    process.env.PIXO_CHAT_RUN_INACTIVITY_TIMEOUT_MS = '5000';
    delete process.env.POSTHOG_KEY;
    started = await startIsolatedServer();
    await putConfig(started.url, {
      telemetry: { metrics: true, },
      privacyDecisionAt: Date.now(),
    });

    const cases = [
      { bin: 'provider-balance', category: 'rate_limit', detail: 'hard_quota' },
      { bin: 'provider-ratelimit', category: 'rate_limit', detail: 'rate_limit_429' },
      { bin: 'provider-model', category: 'model_unavailable', detail: 'model_not_found' },
      { bin: 'env-node-path', category: 'process_exit', detail: 'cli_not_installed' },
      { bin: 'env-spawn-enoent', category: 'process_exit', detail: 'cli_not_installed' },
      { bin: 'a-prefill', category: 'prompt_too_large', detail: 'prompt_too_large' },
      { bin: 'a-thread-start', category: 'process_exit', detail: 'agent_protocol_error' },
      { bin: 'a-auth', category: 'auth', detail: 'auth_required' },
      { bin: 'a-lmstudio', category: 'model_unavailable', detail: 'local_model_not_loaded' },
      { bin: 'a-resume-expired', category: 'process_exit', detail: 'session_resume_expired' },
    ] as const;

    for (const item of cases) {
      await putConfig(started.url, {
        agentId: 'claude',
        agentCliEnv: { claude: { CLAUDE_BIN: fixtureBinaryPath(binDir, item.bin) } },
      });
      const run = await createAndWaitForRun(started.url, {
        caseId: item.bin,
        agentId: 'claude',
        message: `pixo-provider-reclassify-${item.bin}`,
      });
      const events = await readCompletedRunEvents(run.eventsLogPath);
      const errorCode = deriveRunErrorCode(run);
      const failure = classifyRunFailure({
        result: runResultFromStatus(run.status),
        status: run,
        ...(errorCode ? { errorCode } : {}),
        agentId: run.agentId,
        events,
      });
      expect(run.status, item.bin).toBe('failed');
      // The reclassification must NOT leave it in the opaque bucket.
      expect(failure?.failure_detail, item.bin).not.toBe('execution_failed');
      expect(failure?.failure_category, item.bin).toBe(item.category);
      expect(failure?.failure_detail, item.bin).toBe(item.detail);
    }
  }, 60_000);
});

/**
 * OD Next freezes its Run input snapshots to 0o555/0o444, so a plain recursive
 * remove of the data root can hit EACCES. Restore write permission on the way
 * down before retrying.
 */
async function removeDataDir(root: string): Promise<void> {
  try {
    await rm(root, { recursive: true, force: true });
    return;
  } catch {
    // fall through to the permission-restoring retry
  }
  const { chmodSync, readdirSync, statSync } = await import('node:fs');
  const restore = (target: string): void => {
    try {
      chmodSync(target, 0o700);
      if (!statSync(target).isDirectory()) return;
      for (const entry of readdirSync(target)) restore(path.join(target, entry));
    } catch {
      // best effort
    }
  };
  restore(root);
  await rm(root, { recursive: true, force: true }).catch(() => {});
}

function snapshotEnv(): Record<string, string | undefined> {
  return {
    PIXO_TELEMETRY_RELAY_URL: process.env.PIXO_TELEMETRY_RELAY_URL,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    PIXO_CHAT_RUN_INACTIVITY_TIMEOUT_MS: process.env.PIXO_CHAT_RUN_INACTIVITY_TIMEOUT_MS,
    PIXO_DATA_DIR: process.env.PIXO_DATA_DIR,
    PATH: process.env.PATH,
  };
}

function restoreEnv(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/**
 * Help text the fake Claude CLI advertises, derived from the runtime def so it
 * can never drift from what the daemon probes for.
 *
 * This is not cosmetic. `detectAgents` parses `claude -p --help` for each flag
 * in `capabilityFlags` and caches the result on `agentCapabilities`. Once a
 * physical Run is mapped to an OD Next strategy task, `buildArgs` sets
 * `observeNativeChildBehavior`, and it THROWS when the probe never saw
 * `--forward-subagent-text`. A fake that omits the flag therefore fails the Run
 * inside the daemon before the agent is ever spawned: the Run reports that
 * host-side TypeError (classified `process_exit`) instead of the auth /
 * rate-limit / timeout failure the case scripted, and whether it does depends
 * on when the task mapping becomes visible to `startChatRun`. Advertising the
 * full probed flag set removes that ordering dependence — the fake always
 * spawns and always produces its intended failure.
 */
const FAKE_CLAUDE_HELP = `Usage: claude -p ${
  Object.keys(claudeAgentDef.capabilityFlags).map((flag) => `[${flag}]`).join(' ')
}`;

function fixtureBinaryPath(dir: string, name: string): string {
  return path.join(dir, process.platform === 'win32' ? `${name}.cmd` : name);
}

async function writeWindowsWrapper(bin: string): Promise<void> {
  if (process.platform === 'win32') {
    await writeFile(`${bin}.cmd`, `@echo off\r\n"${process.execPath}" "${bin}" %*\r\n`);
  }
}

async function writeFakeClaude(dir: string, name: string, stderr: string | null): Promise<void> {
  const bin = path.join(dir, name);
  const body = stderr === null
    ? `setInterval(() => {}, 1000);\n`
    : `process.stderr.write(${JSON.stringify(`${stderr}\n`)});\nsetTimeout(() => process.exit(1), 100);\n`;
  await writeFile(bin, `#!/usr/bin/env node
if (process.argv.includes('--version')) {
  console.log('claude-code 1.0.0-smoke');
  process.exit(0);
}
if (process.argv.includes('--help')) {
  console.log(${JSON.stringify(FAKE_CLAUDE_HELP)});
  process.exit(0);
}
${body}`, 'utf8');
  await chmod(bin, 0o755);
  await writeWindowsWrapper(bin);
}

async function putConfig(url: string, patch: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${url}/api/app-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  expect(response.status).toBe(200);
}

type SmokeProject = { projectId: string; conversationId: string };

async function createSmokeProject(url: string, caseId: string): Promise<SmokeProject> {
  const projectId = `failure_smoke_${caseId}_${randomUUID()}`;
  const projectResponse = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: projectId,
      name: `Failure smoke ${caseId}`,
      metadata: { kind: 'prototype' },
      skipDiscoveryBrief: true,
    }),
  });
  expect(projectResponse.status).toBe(200);
  const projectBody = await projectResponse.json() as { conversationId: string };
  return { projectId, conversationId: projectBody.conversationId };
}

async function createAndWaitForRun(url: string, input: {
  caseId: string;
  agentId: string;
  message: string;
}): Promise<RunStatus> {
  const project = await createSmokeProject(url, input.caseId);
  return await startAndWaitForRun(url, project, input);
}

async function startAndWaitForRun(url: string, project: SmokeProject, input: {
  caseId: string;
  agentId: string;
  message: string;
}): Promise<RunStatus> {
  const { projectId } = project;
  const assistantMessageId = `assistant_${input.caseId}_${randomUUID()}`;
  const runResponse = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      conversationId: project.conversationId,
      assistantMessageId,
      clientRequestId: `client_${input.caseId}_${randomUUID()}`,
      agentId: input.agentId,
      message: input.message,
      currentPrompt: input.message,
    }),
  });
  expect(runResponse.status).toBe(202);
  const runBody = await runResponse.json() as { runId: string };
  return await waitForRun(url, runBody.runId);
}

async function waitForRun(url: string, runId: string): Promise<RunStatus> {
  const started = Date.now();
  // Native Windows wrappers may need both the inactivity timeout and bounded
  // process-tree cleanup before the daemon can publish its terminal verdict.
  while (Date.now() - started < 30_000) {
    const response = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`);
    expect(response.status).toBe(200);
    const run = await response.json() as RunStatus;
    if (run.status === 'failed' || run.status === 'succeeded' || run.status === 'canceled') {
      return run;
    }
    await delay(100);
  }
  throw new Error(`run ${runId} did not finish`);
}

async function readRunEvents(file: string): Promise<RunEvent[]> {
  const raw = await readFile(file, 'utf8');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunEvent);
}

/**
 * Read a Run's durable event log once it is complete.
 *
 * The daemon emits `end` as a Run's final event and only then closes the log
 * write stream, so a log that already carries an `end` record carries every
 * earlier record too. Terminal Run status is published to `GET /api/runs/:id`
 * before that buffered write has necessarily reached disk, so sampling the file
 * the instant the status flips can classify a log whose error record is still
 * in flight. This waits for the log's own completion marker — not for the
 * assertion to pass, and not for a fixed delay.
 */
async function readCompletedRunEvents(file: string): Promise<RunEvent[]> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const events = await readRunEvents(file);
    if (events.some((event) => event.event === 'end')) return events;
    if (Date.now() >= deadline) {
      throw new Error(`run log ${file} never recorded a terminal end event`);
    }
    await delay(25);
  }
}

async function saveAssistantMessage(
  url: string,
  run: RunStatus,
  patch: Record<string, unknown> = {},
  telemetryFinalized = false,
): Promise<void> {
  const response = await fetch(
    `${url}/api/projects/${encodeURIComponent(run.projectId)}/conversations/${encodeURIComponent(run.conversationId)}/messages/${encodeURIComponent(run.assistantMessageId)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: run.assistantMessageId,
        role: 'assistant',
        content: run.error ?? '',
        agentId: run.agentId,
        runId: run.id,
        runStatus: run.status,
        startedAt: run.createdAt,
        endedAt: run.updatedAt,
        ...patch,
        ...(telemetryFinalized ? { telemetryFinalized: true } : {}),
      }),
    },
  );
  expect(response.status).toBe(200);
}

async function finalizeAssistantMessage(
  url: string,
  run: RunStatus,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await saveAssistantMessage(url, run, patch, true);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
