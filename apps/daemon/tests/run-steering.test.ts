// B11 "steer the running turn" (`引导对话`) — the invariant that decides whether a
// mid-turn user message can actually reach the model.
//
// Steering is the opposite of "stop and send": the turn keeps running and the
// message is added to it. Three things have to hold for that to mean anything,
// and each of them fails silently if we only guess:
//   1. the runtime must take a message into a running turn and act on it
//      there — Codex over app-server (`turn/steer`). Claude Code keeps stdin
//      open but does not act on a frame written mid-turn (claude 2.1.259), so
//      it is not a steering runtime; OpenCode reads its prompt once at spawn.
//   2. the run must still be live.
//   3. the turn must still be open to input (the Codex session's own answer).

import { describe, expect, it } from 'vitest';

import { claudeAgentDef } from '../src/runtimes/defs/claude.js';
import { codexAgentDef, withCodexTransport } from '../src/runtimes/defs/codex.js';
import { opencodeAgentDef } from '../src/runtimes/defs/opencode.js';
import {
  agentAdvertisesMidTurnSteering,
  classifyRunSteering,
  encodeStreamJsonUserMessage,
  runtimeAcceptsMidTurnInput,
} from '../src/runtimes/run-steering.js';

describe('runtimeAcceptsMidTurnInput', () => {
  it('accepts Codex over app-server, which has turn/steer', () => {
    expect(runtimeAcceptsMidTurnInput(withCodexTransport(codexAgentDef, 'app-server'))).toBe(true);
  });

  it('refuses Codex over exec --json, which has no input channel mid-turn', () => {
    expect(runtimeAcceptsMidTurnInput(withCodexTransport(codexAgentDef, 'exec-json'))).toBe(false);
  });

  it('refuses Claude Code: an open stdin is not steering', () => {
    expect(claudeAgentDef.promptInputFormat).toBe('stream-json');
    expect(runtimeAcceptsMidTurnInput(claudeAgentDef)).toBe(false);
  });

  it('refuses OpenCode and an unknown / missing runtime def rather than guessing', () => {
    expect(runtimeAcceptsMidTurnInput(opencodeAgentDef)).toBe(false);
    expect(runtimeAcceptsMidTurnInput(null)).toBe(false);
    expect(runtimeAcceptsMidTurnInput(undefined)).toBe(false);
  });
});

describe('agentAdvertisesMidTurnSteering', () => {
  it('advertises Codex on the shipping app-server transport', () => {
    expect(agentAdvertisesMidTurnSteering(codexAgentDef, 'codex-cli 0.160.0', {})).toBe(true);
  });

  it('follows the operator rollback to exec --json', () => {
    expect(agentAdvertisesMidTurnSteering(codexAgentDef, 'codex-cli 0.160.0', { PIXO_CODEX_TRANSPORT: 'exec-json' })).toBe(false);
  });

  it('follows auto mode down to exec --json on a codex below the app-server floor', () => {
    expect(agentAdvertisesMidTurnSteering(codexAgentDef, 'codex-cli 0.80.0', { PIXO_CODEX_TRANSPORT: 'auto' })).toBe(false);
  });

  it('never advertises Claude Code or OpenCode', () => {
    expect(agentAdvertisesMidTurnSteering(claudeAgentDef, '2.1.259', {})).toBe(false);
    expect(agentAdvertisesMidTurnSteering(opencodeAgentDef, '1.18.35', {})).toBe(false);
  });
});

describe('classifyRunSteering', () => {
  it('admits a live run whose turn is open to input', () => {
    expect(
      classifyRunSteering({ runtimeAccepts: true, terminal: false, inputOpen: true }),
    ).toEqual({ ok: true });
  });

  it('refuses a runtime that cannot take mid-turn input, before anything else', () => {
    expect(
      classifyRunSteering({ runtimeAccepts: false, terminal: false, inputOpen: true }),
    ).toEqual({ ok: false, refusal: 'runtime_unsupported' });
    // Permanent property of the runtime: it wins over the transient reasons so
    // the caller can disable the affordance instead of showing a retry hint.
    expect(
      classifyRunSteering({ runtimeAccepts: false, terminal: true, inputOpen: false }),
    ).toEqual({ ok: false, refusal: 'runtime_unsupported' });
  });

  it('refuses a terminal run', () => {
    expect(
      classifyRunSteering({ runtimeAccepts: true, terminal: true, inputOpen: false }),
    ).toEqual({ ok: false, refusal: 'run_terminal' });
  });

  it('refuses a live run whose turn already stopped taking input', () => {
    // The child can still be alive here (it exits a beat later). The message
    // must be refused loudly, not recorded as said to a turn that is over.
    expect(
      classifyRunSteering({ runtimeAccepts: true, terminal: false, inputOpen: false }),
    ).toEqual({ ok: false, refusal: 'stdin_closed' });
  });
});

describe('encodeStreamJsonUserMessage', () => {
  it('produces exactly the JSONL frame the opening prompt uses', () => {
    const line = encodeStreamJsonUserMessage('tighten the hero copy');
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'tighten the hero copy' }],
      },
    });
  });

  it('keeps newlines inside the text on one JSONL line', () => {
    const line = encodeStreamJsonUserMessage('one\ntwo');
    expect(line.split('\n').filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(line).message.content[0].text).toBe('one\ntwo');
  });
});
