// Listing a project must cost each persisted run its state.json and nothing
// more. These cases pin the lazy journal behind a hydrated run's `events` and
// `nextEventId`: nothing reads events.jsonl until something needs events, the
// loaded events match what eager hydration produced, and an idle run gives them
// back after `ttlMs`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatRunService } from '../../src/runtimes/runs.js';

type AnyRun = any;

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const RECORDS = [
  { id: 1, event: 'agent', data: { type: 'text_delta', delta: 'first' }, timestamp: 10 },
  { id: 2, event: 'agent', data: { type: 'text_delta', delta: 'second' }, timestamp: 20 },
  { id: 7, event: 'agent', data: { type: 'text_delta', delta: 'last' }, timestamp: 30 },
  { id: 9, event: 'end', data: { status: 'succeeded' }, timestamp: 40 },
];

function fixture(
  { status = 'succeeded', journal, ttlMs = 100 }: { status?: string; journal?: string | null; ttlMs?: number } = {},
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixo-history-efficiency-'));
  cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const id of ['first', 'second']) {
    const dir = path.join(directory, id);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
      schemaVersion: 1, id, projectId: 'project', conversationId: 'conversation',
      status, createdAt: 10, updatedAt: 40, endedWithUnfinishedWork: true,
    }));
    if (journal !== null) {
      fs.writeFileSync(
        path.join(dir, 'events.jsonl'),
        journal ?? RECORDS.map((record) => JSON.stringify(record)).join('\n') + '\n',
      );
    }
  }
  const received: Array<{ id: number; event: string; data: unknown }> = [];
  const makeService = (): AnyRun => {
    const service: AnyRun = createChatRunService({
      runsLogDir: directory as unknown as null,
      ttlMs,
      createSseErrorPayload: (code: string, message: string) => ({ error: { code, message } }),
      createSseResponse: () => ({
        send(event: string, data: unknown, id: number) { received.push({ id, event, data }); return true; },
        end() {},
        cleanup() {},
      }),
    });
    cleanups.push(() => service.shutdownActive());
    return service;
  };
  const read = vi.spyOn(fs, 'readFileSync');
  const journalReads = () =>
    read.mock.calls.filter(([file]) => String(file).endsWith('events.jsonl')).length;
  return { service: makeService(), makeService, received, directory, journalReads };
}

describe('listing a project with persisted runs', () => {
  it('reads no journal, including for the status bodies the route serialises', () => {
    const f = fixture();
    const runs: AnyRun[] = f.service.list({ projectId: 'project' });
    expect(runs.map((run) => run.id)).toEqual(['first', 'second']);
    const statuses = runs.map((run) => f.service.statusBody(run));
    expect(statuses.map((status: AnyRun) => status.status)).toEqual(['succeeded', 'succeeded']);
    expect(JSON.parse(JSON.stringify(statuses))).toHaveLength(2);
    // Every other list consumer folds on these fields, polled on every listing.
    f.service.list({ projectId: 'project', status: 'active' });
    f.service.list({ projectId: 'project', status: 'succeeded' });
    f.service.list();
    expect(f.journalReads()).toBe(0);
  });

  it('replays the complete cursor suffix with the original ids afterwards', async () => {
    const f = fixture();
    const [run] = f.service.list({ projectId: 'project' }) as AnyRun[];
    await f.service.stream(run, { get: () => null, query: { after: '1' } }, new EventEmitter());
    expect(f.received.map((record) => record.id)).toEqual([2, 7, 9]);
    expect(f.received.map((record) => record.data)).toEqual(RECORDS.slice(1).map((record) => record.data));
    expect(run.nextEventId).toBe(10);
    expect(f.journalReads()).toBe(1);
  });

  it('keeps the same durable facts on the run without the journal', () => {
    const f = fixture();
    const [run] = f.service.list({ projectId: 'project' }) as AnyRun[];
    expect(run).toMatchObject({
      id: 'first',
      projectId: 'project',
      status: 'succeeded',
      eventsLogPath: path.join(f.directory, 'first', 'events.jsonl'),
    });
    expect(f.journalReads()).toBe(0);
  });
});

describe('reading a hydrated run by id', () => {
  it('keeps the execution diagnostics a by-id status body has always carried', () => {
    const f = fixture();
    const run = f.service.get('first');
    const diagnostics = f.service.statusBody(run).executionDiagnostics;
    expect(diagnostics?.eventStreamCompleteness).toBe('complete');
    expect(f.journalReads()).toBe(1);
  });

  it('loads a run already listed, because its by-id body needs the events', () => {
    const f = fixture();
    const [listed] = f.service.list({ projectId: 'project' }) as AnyRun[];
    expect(f.service.statusBody(listed).executionDiagnostics).toBeUndefined();
    expect(f.service.get('first')).toBe(listed);
    expect(f.service.statusBody(listed).executionDiagnostics?.eventStreamCompleteness).toBe('complete');
    expect(f.journalReads()).toBe(1);
  });
});

describe('a run the daemon restart interrupted', () => {
  it('writes the verdict at hydrate time and appends identical synthetic events per load', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const f = fixture({ status: 'running' });
    const [run] = f.service.list({ projectId: 'project' }) as AnyRun[];
    expect(run.status).toBe('failed');
    expect(JSON.parse(fs.readFileSync(path.join(f.directory, 'first', 'state.json'), 'utf8'))).toMatchObject({
      status: 'failed', terminalRecoveryReason: 'daemon_restart', terminalAt: 1000,
    });
    expect(f.journalReads()).toBe(0);

    expect(run.events.slice(-2)).toEqual([
      {
        id: 10,
        event: 'error',
        data: { error: { code: 'DAEMON_RESTARTED', message: 'Run interrupted because the daemon restarted.', retryable: true } },
        timestamp: 1000,
      },
      {
        id: 11,
        event: 'end',
        data: { code: 1, signal: null, status: 'failed', terminalAt: 1000, resumable: false, endedWithUnfinishedWork: true },
        timestamp: 1000,
      },
    ]);
    expect(run.nextEventId).toBe(12);
    const expected = run.events.slice();

    // A re-read after the release must not stack a second synthetic pair.
    await vi.advanceTimersByTimeAsync(100);
    expect(run.events).toEqual(expected);
    expect(f.journalReads()).toBe(2);

    // Neither must a later daemon, which finds the verdict already on disk.
    vi.setSystemTime(5000);
    expect(f.makeService().get('first').events).toEqual(expected);
    expect(fs.readFileSync(path.join(f.directory, 'first', 'events.jsonl'), 'utf8')).not.toContain('DAEMON_RESTARTED');
  });
});

describe('releasing an idle hydrated run', () => {
  it('drops the events ttlMs after the last access and re-reads on the next one', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const run = f.service.get('first');
    expect(run.events).toHaveLength(4);
    expect(f.journalReads()).toBe(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(run.events).toHaveLength(4); // Still resident; this access restarts the clock.
    await vi.advanceTimersByTimeAsync(99);
    expect(run.nextEventId).toBe(10);
    expect(f.journalReads()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(run.nextEventId).toBe(10);
    expect(run.events.map((record: AnyRun) => record.id)).toEqual([1, 2, 7, 9]);
    expect(f.journalReads()).toBe(2);
  });

  it('does not let a status poll keep an idle run resident', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const run = f.service.get('first');
    await vi.advanceTimersByTimeAsync(60);
    expect(f.service.statusBody(run).executionDiagnostics).toBeDefined();
    await vi.advanceTimersByTimeAsync(40);
    expect(f.service.statusBody(run).executionDiagnostics).toBeUndefined();
    expect(f.journalReads()).toBe(1);
  });

  it('unrefs the release timer and clears it on shutdown', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const f = fixture({ ttlMs: 123_456 });
    expect(f.service.get('first').events).toHaveLength(4);
    const timers = setTimeoutSpy.mock.calls.flatMap(([, delay], index) =>
      delay === 123_456 ? [setTimeoutSpy.mock.results[index]!.value as NodeJS.Timeout] : []);
    // One per access: each restarts the clock.
    expect(timers.length).toBeGreaterThan(0);
    expect(timers.every((timer) => !timer.hasRef())).toBe(true);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    await f.service.shutdownActive();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timers.at(-1));
  });

  it('leaves no timer behind after shutdown', async () => {
    vi.useFakeTimers();
    const f = fixture();
    expect(f.service.get('first').events).toHaveLength(4);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await f.service.shutdownActive();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never releases an event only memory holds', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const [run] = f.service.list({ projectId: 'project' }) as AnyRun[];
    // The log of a hydrated run is closed, so a late event lives in memory alone.
    expect(f.service.emit(run, 'diagnostic', { type: 'late' })?.id).toBe(10);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.events.at(-1)).toMatchObject({ id: 10, event: 'diagnostic' });
    expect(run.nextEventId).toBe(11);
    expect(f.journalReads()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues the journal when a listed run is resumed, and never releases it', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const [run] = f.service.list({ projectId: 'project' }) as AnyRun[];
    expect(f.service.prepareRestart(run)).toBe(run);
    expect(run.events.map((record: AnyRun) => record.id)).toEqual([1, 2, 7, 9, 10]);
    expect(run.events.at(-1)).toMatchObject({ event: 'run_resume_attempted' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.events).toHaveLength(5);
    expect(f.journalReads()).toBe(1);
    run.status = 'failed';
  });
});

describe('a missing or corrupt journal', () => {
  it.each([
    ['missing', null],
    ['corrupt', 'invalid json\n'],
  ])('reads as an empty event list when %s', (_label, journal) => {
    const f = fixture({ journal });
    const [listed] = f.service.list({ projectId: 'project' }) as AnyRun[];
    expect(listed.events).toEqual([]);
    expect(listed.nextEventId).toBe(1);
    expect(listed.error).toBeUndefined();
    expect(f.service.get('second').events).toEqual([]);
  });

  it('still numbers the restart events from one', () => {
    const f = fixture({ status: 'running', journal: null });
    const [run] = f.service.list({ projectId: 'project' }) as AnyRun[];
    expect(run.events.map((record: AnyRun) => [record.id, record.event])).toEqual([[1, 'error'], [2, 'end']]);
    expect(run.nextEventId).toBe(3);
  });
});
