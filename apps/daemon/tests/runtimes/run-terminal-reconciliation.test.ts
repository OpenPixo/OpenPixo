import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileDurableRunTerminals } from '../../src/runtimes/run-terminal-reconciliation.js';
import { createChatRunService } from '../../src/runtimes/runs.js';

describe('durable run terminal reconciliation', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixo-run-reconcile-test-'));
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        run_status TEXT,
        ended_at INTEGER,
        events_json TEXT
      )
    `);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps the app version that started an interrupted run after a newer daemon restarts', async () => {
    const startedWithVersion = {
      version: '0.21.1',
      channel: 'stable',
      packaged: true,
      platform: 'darwin',
      arch: 'arm64',
    };
    const runs = createChatRunService({
      createSseResponse: () => ({ send: vi.fn(), end: vi.fn(), cleanup: vi.fn() }),
      createSseErrorPayload: (code: string, message: string) => ({ error: { code, message } }),
      getAppVersionInfo: () => startedWithVersion,
      runsLogDir: tmpDir,
    } as never);
    const run = runs.create({
      projectId: 'p1',
      conversationId: 'c1',
      assistantMessageId: 'm1',
      agentId: 'claude',
    });
    runs.setAnalyticsRecovery(run, {
      context: {
        deviceId: 'device-1',
        sessionId: 'session-1',
        clientType: 'desktop',
        locale: 'en',
      },
      properties: {
        page_name: 'chat_panel',
        area: 'chat_panel',
        project_id: 'p1',
        conversation_id: 'c1',
        run_id: run.id,
      },
      insertId: 'run-created-version-a',
    });
    run.status = 'running';
    runs.persistState(run);

    const statePath = path.join(tmpDir, run.id, 'state.json');
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8'))).toMatchObject({
      appVersionInfo: startedWithVersion,
    });

    const capture = vi.fn(async () => undefined);
    await reconcileDurableRunTerminals({
      analytics: { capture },
      appVersion: '0.22.0',
      appVersionInfo: {
        version: '0.22.0',
        channel: 'stable',
        packaged: true,
        platform: 'darwin',
        arch: 'arm64',
      },
      db,
      runsLogDir: tmpDir,
    });

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'run_finished',
      appVersion: startedWithVersion.version,
    }));
  });

  it('uses the resolved current version when a legacy durable run has no version snapshot', async () => {
    const runId = 'run-legacy-version';
    const runDir = path.join(tmpDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: runId,
      projectId: 'p1',
      conversationId: 'c1',
      assistantMessageId: 'm1',
      agentId: 'claude',
      status: 'running',
      createdAt: 1_000,
      updatedAt: 2_000,
      analyticsRecovery: {
        context: {},
        properties: { run_id: runId },
        insertId: 'run-created-legacy-version',
      },
    }));
    const currentVersion = {
      version: '0.22.0',
      channel: 'stable',
      packaged: true,
      platform: 'darwin',
      arch: 'arm64',
    };
    const capture = vi.fn(async () => undefined);

    await reconcileDurableRunTerminals({
      analytics: { capture },
      appVersion: currentVersion.version,
      appVersionInfo: currentVersion,
      db,
      runsLogDir: tmpDir,
    });

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      appVersion: currentVersion.version,
    }));
  });

  it('uses explicit unknown or missing semantics when no real version can be resolved', async () => {
    const runId = 'run-version-unknown';
    const runDir = path.join(tmpDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: runId,
      projectId: 'p1',
      conversationId: 'c1',
      assistantMessageId: 'm1',
      agentId: 'claude',
      status: 'running',
      createdAt: 1_000,
      updatedAt: 2_000,
      analyticsRecovery: {
        context: {},
        properties: { run_id: runId },
        insertId: 'run-created-version-unknown',
      },
    }));
    const capture = vi.fn(async () => undefined);

    await reconcileDurableRunTerminals({
      analytics: { capture },
      appVersion: '0.0.0',
      appVersionInfo: {
        version: '0.0.0',
        channel: 'development',
        packaged: false,
        platform: 'darwin',
        arch: 'arm64',
      },
      db,
      runsLogDir: tmpDir,
    });

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      appVersion: 'unknown',
    }));
  });

  it('fails an interrupted run, repairs its message, and emits missing terminal telemetry once', async () => {
    const runId = 'run-interrupted';
    const runDir = path.join(tmpDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: runId,
      projectId: 'p1',
      conversationId: 'c1',
      assistantMessageId: 'm1',
      agentId: 'claude',
      status: 'running',
      createdAt: 1_000,
      updatedAt: 2_000,
      analyticsRecovery: {
        context: {
          deviceId: 'device-1',
          sessionId: 'session-1',
          clientType: 'desktop',
          locale: 'zh-CN',
        },
        properties: {
          page_name: 'chat_panel',
          area: 'chat_panel',
          project_id: 'p1',
          conversation_id: 'c1',
          run_id: runId,
          project_kind: 'prototype',
          has_attachment: false,
          user_query_tokens: 10,
          model_id: 'default',
          agent_provider_id: 'claude_code',
          skill_id: null,
          mcp_id: null,
          token_count_source: 'estimated',
        },
        insertId: 'run-created-1',
      },
    }));
    fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({
      id: 1,
      event: 'agent',
      timestamp: 1_500,
      data: { type: 'status', label: 'working' },
    })}\n`);
    db.prepare(
      `INSERT INTO messages (id, run_id, run_status, events_json)
       VALUES (?, ?, 'running', '[]')`,
    ).run('m1', runId);
    const capture = vi.fn(async () => undefined);

    const first = await reconcileDurableRunTerminals({
      analytics: { capture },
      appVersion: '0.15.1',
      db,
      runsLogDir: tmpDir,
    });

    expect(first).toMatchObject({ interrupted: 1, messagesReconciled: 1, analyticsReplayed: 1 });
    expect(db.prepare(`SELECT run_status AS status, ended_at AS endedAt, events_json AS eventsJson FROM messages WHERE id = 'm1'`).get()).toMatchObject({
      status: 'failed',
      endedAt: expect.any(Number),
      eventsJson: expect.stringContaining('daemon restarted'),
    });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'run_finished',
      insertId: 'run-created-1-finish',
      properties: expect.objectContaining({
        result: 'failed',
        error_code: 'DAEMON_RESTARTED',
        failure_category: 'process_exit',
        failure_detail: 'interrupted',
        failure_stage: 'finalize',
        failure_mechanism: 'unknown',
        failure_domain: 'cross_boundary',
        evidence_level: 'lifecycle_signal',
        repair_owner: 'shared_boundary',
        admission_status: 'unknown',
        admission_phase: 'unknown',
        classifier_version: 'run-failure-v3',
        retryable: true,
        user_action: 'retry',
        terminal_trigger: 'daemon_restart',
        terminal_reconciled: true,
        terminal_integrity: 'reconciled',
        terminal_recovery_reason: 'daemon_restart',
        posthog_delivery_status: 'queued',
        posthog_acknowledgement: 'local_buffer',
        posthog_delivery_attempt_count: 1,
        posthog_error_type: null,
        mature_unfinished_state: 'unknown',
      }),
    }));

    const recoveredState = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
    expect(recoveredState).toMatchObject({
      status: 'failed',
      errorCode: 'DAEMON_RESTARTED',
      analyticsRecovery: { completedAt: expect.any(Number) },
    });

    const second = await reconcileDurableRunTerminals({
      analytics: { capture },
      appVersion: '0.15.1',
      db,
      runsLogDir: tmpDir,
    });
    expect(second.analyticsReplayed).toBe(0);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('keeps a structured PostHog enqueue failure pending across reconciliation boots', async () => {
    const runId = 'run-posthog-retry';
    const runDir = path.join(tmpDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: runId,
      projectId: 'p1',
      conversationId: 'c1',
      assistantMessageId: null,
      agentId: 'amr',
      status: 'failed',
      createdAt: 1_000,
      updatedAt: 2_000,
      errorCode: 'AGENT_EXIT_1',
      analyticsRecovery: {
        context: {},
        properties: { run_id: runId },
        insertId: 'run-created-posthog-retry',
      },
    }));
    const capture = vi.fn(async () => ({
      status: 'failed' as const,
      acknowledgement: 'none' as const,
      errorType: 'enqueue_failed' as const,
    }));
    const options = {
      analytics: { capture },
      appVersion: '0.15.1',
      db,
      runsLogDir: tmpDir,
    };

    const first = await reconcileDurableRunTerminals(options);
    const second = await reconcileDurableRunTerminals(options);

    expect(first.analyticsReplayed).toBe(0);
    expect(second.analyticsReplayed).toBe(0);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')))
      .toMatchObject({
        terminalLifecycle: {
          posthogDelivery: {
            status: 'failed',
            acknowledgement: 'none',
            attemptCount: 2,
            errorType: 'enqueue_failed',
          },
          unfinishedState: 'terminal_persisted_posthog_failed',
        },
      });
    expect(JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')))
      .not.toHaveProperty('analyticsRecovery.completedAt');
  });

  it('treats a readable terminal journal as acknowledged persistence during replay', async () => {
    const runId = 'run-readable-terminal-journal';
    const runDir = path.join(tmpDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: runId,
      projectId: 'p1',
      conversationId: 'c1',
      assistantMessageId: null,
      agentId: 'amr',
      status: 'failed',
      createdAt: 1_000,
      updatedAt: 2_000,
      errorCode: 'AGENT_EXIT_1',
      analyticsRecovery: {
        context: {},
        properties: { run_id: runId },
        insertId: 'run-readable-terminal-journal',
      },
      terminalLifecycle: {
        version: 1,
        runAttempt: 0,
        runtimeGenerationId: null,
        terminationOrigin: 'unknown',
        terminalIntegrity: 'canonical',
        terminalPersistence: {
          status: 'failed',
          errorType: 'storage_full',
        },
        posthogDelivery: {
          status: 'failed',
          acknowledgement: 'none',
          attemptCount: 0,
          errorType: 'enqueue_failed',
        },
        unfinishedState: 'terminated_persistence_missing',
        duplicateTerminalCount: 0,
        lateTerminalCount: 0,
      },
    }));
    const capture = vi.fn(async () => ({
      status: 'queued' as const,
      acknowledgement: 'local_buffer' as const,
      errorType: null,
    }));

    await expect(reconcileDurableRunTerminals({
      analytics: { capture },
      appVersion: '0.15.1',
      db,
      runsLogDir: tmpDir,
    })).resolves.toMatchObject({ analyticsReplayed: 1 });

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      properties: expect.objectContaining({
        terminal_persistence_status: 'acknowledged',
        terminal_persistence_error_type: null,
        mature_unfinished_state: 'unknown',
      }),
    }));
    expect(JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')))
      .toMatchObject({
        terminalLifecycle: {
          terminalPersistence: {
            status: 'acknowledged',
            errorType: null,
          },
          unfinishedState: 'unknown',
        },
      });
  });

  it('repairs legacy queued messages even when no state journal exists', async () => {
    db.prepare(
      `INSERT INTO messages (id, run_id, run_status, events_json)
       VALUES (?, ?, 'queued', '[]')`,
    ).run('legacy-message', 'legacy-run');

    const result = await reconcileDurableRunTerminals({
      analytics: { capture: vi.fn() },
      appVersion: '0.15.1',
      db,
      runsLogDir: tmpDir,
    });

    expect(result.messagesReconciled).toBe(1);
    expect(db.prepare(`SELECT run_status AS status FROM messages WHERE id = 'legacy-message'`).get())
      .toEqual({ status: 'failed' });
  });

  it('re-measures storage for a replayed run_finished without touching the durable state', async () => {
    const runId = 'run-died-with-daemon';
    const runDir = path.join(tmpDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    const statePath = path.join(runDir, 'state.json');
    fs.writeFileSync(statePath, JSON.stringify({
      schemaVersion: 1,
      id: runId,
      projectId: 'p1',
      conversationId: 'c1',
      assistantMessageId: 'm-storage',
      agentId: 'claude',
      status: 'failed',
      createdAt: 1_000,
      updatedAt: 2_000,
      exitCode: 1,
      error: 'daemon restarted',
      analyticsRecovery: {
        context: { deviceId: 'device-1', sessionId: 'session-1', clientType: 'desktop', locale: 'en' },
        properties: { page_name: 'chat_panel', area: 'chat_panel', project_id: 'p1', conversation_id: 'c1', run_id: runId },
        insertId: 'run-created-storage',
      },
    }));
    const storageDb = new Database(':memory:');
    storageDb.exec(`CREATE TABLE messages (
      id TEXT PRIMARY KEY, run_id TEXT, run_status TEXT, ended_at INTEGER, content TEXT NOT NULL DEFAULT '', events_json TEXT)`);
    storageDb.prepare(
      `INSERT INTO messages (id, run_id, run_status, content, events_json) VALUES ('m-storage', ?, 'failed', 'partial', '[]')`,
    ).run(runId);
    const capture = vi.fn(async (_args: { eventName: string; properties: Record<string, unknown> }) => undefined);
    try {
      await reconcileDurableRunTerminals({
        analytics: { capture },
        appVersion: '0.15.1',
        db: storageDb,
        runsLogDir: tmpDir,
      });
      const finished = capture.mock.calls.map(([args]) => args).find((args) => args.eventName === 'run_finished');
      expect(finished?.properties).toMatchObject({
        storage_schema_version: 1,
        storage_content_bytes: 7,
        storage_events_json_bytes: expect.any(Number),
      });
      const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      expect(Object.keys(persisted.analyticsRecovery.properties).filter((key: string) => key.startsWith('storage_'))).toEqual([]);
    } finally {
      storageDb.close();
    }
  });

  it('preserves the real failure taxonomy when replaying incomplete analytics', async () => {
    const runId = 'run-analytics-incomplete';
    const runDir = path.join(tmpDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: runId,
      projectId: 'p1',
      conversationId: 'c1',
      assistantMessageId: 'm1',
      agentId: 'claude',
      status: 'failed',
      createdAt: 1_000,
      updatedAt: 2_000,
      exitCode: 1,
      error: 'Authentication required before starting the session.',
      errorCode: 'AGENT_AUTH_REQUIRED',
      analyticsRecovery: {
        context: {
          deviceId: 'device-1',
          sessionId: 'session-1',
          clientType: 'desktop',
          locale: 'en',
        },
        properties: {
          page_name: 'chat_panel',
          area: 'chat_panel',
          project_id: 'p1',
          conversation_id: 'c1',
          run_id: runId,
          terminal_integrity: 'overwritten',
        },
        insertId: 'run-created-analytics-incomplete',
      },
    }));
    db.prepare(
      `INSERT INTO messages (id, run_id, run_status, events_json)
       VALUES (?, ?, 'running', '[]')`,
    ).run('m1', runId);
    const capture = vi.fn(async () => undefined);

    const result = await reconcileDurableRunTerminals({
      analytics: { capture },
      appVersion: '0.15.1',
      db,
      runsLogDir: tmpDir,
    });

    expect(result).toMatchObject({
      interrupted: 0,
      messagesReconciled: 1,
      analyticsReplayed: 1,
    });
    const message = db.prepare(
      `SELECT run_status AS status, events_json AS eventsJson FROM messages WHERE id = 'm1'`,
    ).get() as { status: string; eventsJson: string };
    expect(message).toMatchObject({
      status: 'failed',
      eventsJson: expect.stringContaining('Authentication required before starting the session.'),
    });
    expect(message.eventsJson).not.toContain('daemon restarted');
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'run_finished',
      properties: expect.objectContaining({
        result: 'failed',
        error_code: 'AGENT_AUTH_REQUIRED',
        failure_category: 'auth',
        failure_detail: 'auth_required',
        failure_stage: 'session_init',
        retryable: false,
        user_action: 'login',
        terminal_reconciled: true,
        terminal_integrity: 'overwritten',
        terminal_recovery_reason: 'analytics_incomplete',
      }),
    }));
  });
});
