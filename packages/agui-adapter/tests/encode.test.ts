// AG-UI encoder unit test.

import { describe, expect, it } from 'vitest';
import { encodePixoEventForAgui } from '../src/encode.js';

const RUN_ID = 'run-1';
const NOW = 1_700_000_000_000;

describe('encodePixoEventForAgui', () => {
  it('maps message_chunk to agent.message + carries done', () => {
    const out = encodePixoEventForAgui(
      { kind: 'message_chunk', text: 'hello', done: true },
      { runId: RUN_ID, now: NOW },
    );
    expect(out).toEqual({
      kind: 'agent.message',
      runId: RUN_ID,
      ts: NOW,
      text: 'hello',
      done: true,
    });
  });

  it('maps tool_call with status + result', () => {
    const out = encodePixoEventForAgui(
      {
        kind: 'tool_call',
        toolName: 'live-artifacts.create',
        args: { name: 'index.html' },
        callId: 'tc-1',
        status: 'completed',
        result: { ok: true },
      },
      { runId: RUN_ID, now: NOW, seq: 7 },
    );
    expect(out).toEqual({
      kind: 'tool_call',
      runId: RUN_ID,
      ts: NOW,
      seq: 7,
      toolName: 'live-artifacts.create',
      args: { name: 'index.html' },
      callId: 'tc-1',
      status: 'completed',
      result: { ok: true },
    });
  });

  it('maps run lifecycle: run_started → started, end → completed/failed/cancelled', () => {
    expect(encodePixoEventForAgui({ kind: 'run_started' }, { runId: RUN_ID, now: NOW })).toEqual({
      kind: 'run.lifecycle',
      runId: RUN_ID,
      ts: NOW,
      status: 'started',
    });
    expect(encodePixoEventForAgui({ kind: 'end', status: 'succeeded' }, { runId: RUN_ID, now: NOW }))
      .toMatchObject({ status: 'completed' });
    expect(encodePixoEventForAgui({ kind: 'end', status: 'failed' }, { runId: RUN_ID, now: NOW }))
      .toMatchObject({ status: 'failed' });
    expect(encodePixoEventForAgui({ kind: 'end', status: 'canceled' }, { runId: RUN_ID, now: NOW }))
      .toMatchObject({ status: 'cancelled' });
  });

  it('maps pipeline_stage_started/completed onto run.lifecycle stage events', () => {
    const startedEvt = encodePixoEventForAgui(
      {
        kind: 'pipeline_stage_started',
        runId: RUN_ID,
        snapshotId: 'snap-1',
        stageId: 'discovery',
        iteration: 0,
        startedAt: NOW,
      },
      { runId: RUN_ID, now: NOW },
    );
    expect(startedEvt).toMatchObject({
      kind: 'run.lifecycle',
      status: 'pipeline_stage_started',
      stageId: 'discovery',
      iteration: 0,
    });
    const completedEvt = encodePixoEventForAgui(
      {
        kind: 'pipeline_stage_completed',
        runId: RUN_ID,
        snapshotId: 'snap-1',
        stageId: 'discovery',
        iteration: 0,
        completedAt: NOW,
      },
      { runId: RUN_ID, now: NOW },
    );
    expect(completedEvt).toMatchObject({
      kind: 'run.lifecycle',
      status: 'pipeline_stage_completed',
    });
  });

  it('drops events the encoder does not understand', () => {
    const out = encodePixoEventForAgui(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { kind: 'mystery' as any },
      { runId: RUN_ID, now: NOW },
    );
    expect(out).toBeNull();
  });

  it('falls back to Date.now() when ctx.now is not supplied', () => {
    const before = Date.now();
    const out = encodePixoEventForAgui(
      { kind: 'message_chunk', text: 'hi' },
      { runId: RUN_ID },
    );
    const after = Date.now();
    expect(out).not.toBeNull();
    expect(out!.ts).toBeGreaterThanOrEqual(before);
    expect(out!.ts).toBeLessThanOrEqual(after);
  });

  it('substitutes defaults for tool_call when toolName/args/callId are absent', () => {
    const out = encodePixoEventForAgui(
      { kind: 'tool_call' },
      { runId: RUN_ID, now: NOW },
    );
    expect(out).toMatchObject({
      kind: 'tool_call',
      runId: RUN_ID,
      ts: NOW,
      toolName: 'unknown',
      args: null,
    });
    const record = out as unknown as Record<string, unknown>;
    expect(record.callId).toBeUndefined();
    expect(record.status).toBeUndefined();
    expect(record.result).toBeUndefined();
  });

  it('keeps the value key on state_update when the value is explicitly null', () => {
    const out = encodePixoEventForAgui(
      { kind: 'state_update', path: 'genui.x', value: null },
      { runId: RUN_ID, now: NOW },
    );
    expect(out).not.toBeNull();
    const record = out as unknown as Record<string, unknown>;
    expect('value' in record).toBe(true);
    expect(record.value).toBeNull();
    expect(record.path).toBe('genui.x');
  });
});
