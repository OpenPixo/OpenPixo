// B11 「引导对话」 on Codex: `turn/steer` adds the user's message to the turn
// that is still running, so the model reads it without losing its work.
//
// Verified against the installed codex-cli 0.160.0 (2026-11-22): the method is
// in `codex app-server generate-json-schema` without `--experimental`
// (`TurnSteerParams { threadId, expectedTurnId, input }`), and a live
// `codex app-server` dispatches it (an unknown thread answers "thread not
// found", not the unknown-method error an unwired name gets). No model turn
// was started for that check.
//
// The session decides two things here: whether a turn is open to take input
// at all, and what codex answered. A steer must never be reported delivered
// unless codex accepted it, because the daemon records the message in the
// transcript only after a delivery.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { attachCodexAppServerSession } from '../src/agent-protocol/codex-app-server/session.js';

type Frame = Record<string, any>;

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  written: string[] = [];
  stdinEnded = 0;
  stdin = {
    write: (chunk: string, cb?: (err?: Error | null) => void) => {
      this.written.push(String(chunk));
      cb?.(null);
      return true;
    },
    end: () => {
      this.stdinEnded += 1;
    },
    destroyed: false,
  };
  say(obj: unknown) {
    this.stdout.emit('data', `${JSON.stringify(obj)}\n`);
  }
  frames(): Frame[] {
    return this.written.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Frame);
  }
  sent(method: string): Frame | undefined {
    return this.frames().filter((f) => f.method === method).at(-1);
  }
}

function harness() {
  const child = new FakeChild();
  const session = attachCodexAppServerSession({
    child: child as any,
    prompt: 'build the level',
    cwd: '/workspace',
    sandboxMode: 'workspace-write',
    resumeSessionId: null,
    onAgentEvent: () => {},
  });
  return { child, session };
}

function startTurn(child: FakeChild) {
  child.say({ id: child.sent('initialize')?.id, result: { userAgent: 'codex/0.160.0' } });
  child.say({ id: child.sent('thread/start')?.id, result: { thread: { id: 'th-1' } } });
  child.say({ id: child.sent('turn/start')?.id, result: { turn: { id: 'tu-1' } } });
}

describe('codex app-server mid-turn steering', () => {
  it('is closed before the turn exists', () => {
    const { session } = harness();
    expect(session.acceptsSteering()).toBe(false);
  });

  it('sends turn/steer for the running turn and reports delivery once codex accepts it', async () => {
    const { child, session } = harness();
    startTurn(child);
    expect(session.acceptsSteering()).toBe(true);

    const outcome = session.steer('make the jump higher');
    const frame = child.sent('turn/steer');
    expect(frame?.params).toEqual({
      threadId: 'th-1',
      expectedTurnId: 'tu-1',
      input: [{ type: 'text', text: 'make the jump higher', text_elements: [] }],
    });
    child.say({ id: frame?.id, result: { turnId: 'tu-1' } });
    await expect(outcome).resolves.toBe('delivered');
    // Steering adds to the turn; it never ends or interrupts it.
    expect(child.sent('turn/interrupt')).toBeUndefined();
    expect(child.stdinEnded).toBe(0);
  });

  it('reports a codex build without turn/steer as unsupported', async () => {
    const { child, session } = harness();
    startTurn(child);
    const outcome = session.steer('make the jump higher');
    child.say({
      id: child.sent('turn/steer')?.id,
      error: { code: -32600, message: 'Invalid request: unknown variant `turn/steer`, expected one of `initialize`' },
    });
    await expect(outcome).resolves.toBe('unsupported');
  });

  it('reports a turn that already moved on as closed, not delivered', async () => {
    const { child, session } = harness();
    startTurn(child);
    const outcome = session.steer('make the jump higher');
    child.say({ id: child.sent('turn/steer')?.id, error: { code: -32600, message: 'no active turn to steer' } });
    await expect(outcome).resolves.toBe('closed');
  });

  it('stops taking input once the turn completed', async () => {
    const { child, session } = harness();
    startTurn(child);
    child.say({ method: 'turn/completed', params: { threadId: 'th-1', turn: { id: 'tu-1', status: 'completed' } } });
    expect(session.acceptsSteering()).toBe(false);
    await expect(session.steer('too late')).resolves.toBe('closed');
    expect(child.sent('turn/steer')).toBeUndefined();
  });

  it('settles a pending steer as closed when the child goes away', async () => {
    const { child, session } = harness();
    startTurn(child);
    const outcome = session.steer('make the jump higher');
    child.emit('close');
    await expect(outcome).resolves.toBe('closed');
  });

  it('gives up on a steer codex never answers', async () => {
    vi.useFakeTimers();
    try {
      const { child, session } = harness();
      startTurn(child);
      const outcome = session.steer('make the jump higher');
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(outcome).resolves.toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  });
});
