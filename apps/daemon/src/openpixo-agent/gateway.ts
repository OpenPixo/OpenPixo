import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { ApiErrorCode, OpenPixoAgentReasoningEffort, OpenPixoAgentRunUsage, OpenPixoAgentUsageEvent, OpenPixoAccountErrorCode } from '@openpixo/contracts';
import { agentRequestUsage } from '../account/agent-gateway.js';
import { AccountError } from '../account/errors.js';
import { record } from '../account/supabase.js';
import { isLoopbackPeerAddress } from '../http/local-daemon-request.js';
import { fitInlineImages, type FittedImageCache } from './inline-images.js';

/**
 * Daemon-local OpenAI-compatible endpoint for the bundled OpenCode when it runs on
 * the OpenPixo-credits model. OpenCode authenticates with a random per-run token
 * (delivered through its environment, never argv or a file); the daemon swaps it
 * for the user's cloud session, so the session never reaches the agent process.
 * Bodies are relayed, never stored or logged.
 */
export const OPENPIXO_AGENT_PROXY_BASE = '/api/openpixo/agent/v1';
export const OPENPIXO_AGENT_PROXY_PATH = `${OPENPIXO_AGENT_PROXY_BASE}/chat/completions`;
export const OPENPIXO_AGENT_TOKEN_ENV = 'PIXO_OPENPIXO_AGENT_TOKEN';
/** The cloud refuses more. A conversation near a 500k window can pass 2 MB once it is JSON. */
const MAX_REQUEST_BYTES = 4_000_000;
/**
 * What the agent may hand the gateway before its pictures are fitted: every picture it read stays
 * in the conversation at full size. Loopback and run-token only; checked against MAX_REQUEST_BYTES
 * after fitting.
 */
export const MAX_AGENT_REQUEST_BYTES = 64 * 1024 * 1024;
const USAGE_TRAILER_PREFIX = ': openpixo-usage ';
const FINISHED_RUNS_KEPT = 200;
/**
 * A stream that ends with no finish reason was cut (a cloud worker ran out of time), and the agent
 * asks again by itself. That is fine once or twice; an answer too long to ever finish would repeat,
 * and be paid for, until the balance ran out. Measured: five workers in a row on one long answer.
 */
const MAX_CUTS_IN_A_ROW = 3;
const TOO_MANY_CUTS_MESSAGE = 'This answer keeps running past the time limit of one hosted model response. Ask for a smaller step, or use another model.';

export interface AgentCloud {
  agentCompletion(runKey: string, body: Uint8Array, signal: AbortSignal): Promise<globalThis.Response>;
  /** A relayed request or a finished run may have moved the balance. */
  creditsChanged?(): void;
}

export interface RunTerminalError { code: ApiErrorCode; message: string }

interface RunState {
  token: Buffer;
  usage: OpenPixoAgentRunUsage;
  terminalError: RunTerminalError | null;
  onUsage: (event: OpenPixoAgentUsageEvent) => void;
  reasoningEffort: OpenPixoAgentReasoningEffort | null;
  cutsInARow: number;
}

/**
 * Cloud refusals that no retry inside the same run can fix. They are relayed to
 * OpenCode with a non-retryable status (OpenCode retries 429 and 5xx) and become the
 * run's failure code.
 */
const TERMINAL: Partial<Record<OpenPixoAccountErrorCode, { status: number; code: ApiErrorCode; message?: string }>> = {
  INSUFFICIENT_CREDITS: { status: 402, code: 'INSUFFICIENT_CREDITS',
    message: 'You are out of OpenPixo credits. Top up in Settings → Account, or switch the agent to your own API key or a local CLI.' },
  ACCOUNT_SIGNED_OUT: { status: 401, code: 'AGENT_AUTH_REQUIRED',
    message: 'Sign in to your OpenPixo account to use the agent with OpenPixo credits.' },
  ACCOUNT_NOT_CONFIGURED: { status: 403, code: 'HOSTED_AGENT_UNAVAILABLE' },
  ACCOUNT_SECURE_STORAGE_UNAVAILABLE: { status: 403, code: 'HOSTED_AGENT_UNAVAILABLE' },
  AGENT_PAUSED: { status: 403, code: 'HOSTED_AGENT_UNAVAILABLE' },
};

/**
 * The chosen effort, unless this request set its own: the agent asks for its short title
 * on low, and that should not cost what the work does. A body that does not parse is
 * relayed as it is, for the cloud to refuse.
 */
export function withReasoningEffort(body: Buffer, effort: OpenPixoAgentReasoningEffort | null): Buffer {
  if (!effort) return body;
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return body;
    const request = parsed as Record<string, unknown>;
    if (request.reasoning_effort !== undefined && request.reasoning_effort !== null) return body;
    return Buffer.from(JSON.stringify({ ...request, reasoning_effort: effort }));
  } catch { return body; }
}

/** An error the cloud wrote into a stream it had to end; its message is OpenPixo's own. */
export function streamErrorMessage(line: string): string | null {
  if (!line.startsWith('data:') || !line.includes('"error"')) return null;
  try {
    const frame = record(JSON.parse(line.slice(5)));
    const error = record(frame.error);
    return typeof error.message === 'string' && error.message ? error.message.slice(0, 500) : null;
  } catch { return null; }
}

const FINISH_REASON = /"finish_reason":"[^"]+"/u;

function emptyUsage(runKey: string): OpenPixoAgentRunUsage {
  return { runKey, requests: 0, openRequests: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costMicrocredits: 0, creditsCharged: 0 };
}

function bearer(req: Request): Buffer | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(req.get('authorization') ?? '');
  return match ? Buffer.from(match[1]!) : null;
}

/** OpenAI-shaped error body, which every OpenAI-compatible client surfaces as the message. */
function sendError(res: Response, status: number, code: string, message: string): void {
  if (res.headersSent) { res.destroy(); return; }
  res.status(status).set('Cache-Control', 'no-store').json({ error: { message, type: 'openpixo_error', code } });
}

export class OpenPixoAgentGateway {
  private readonly runs = new Map<string, RunState>();
  private readonly finished = new Map<string, OpenPixoAgentRunUsage>();
  /** Every request repeats the conversation's pictures; each is fitted once. */
  private readonly fittedImages: FittedImageCache = new Map();

  constructor(private readonly cloud: AgentCloud) {}

  /** Starts a run's gateway access and returns its token for the agent's environment. */
  open(runId: string, onUsage: (event: OpenPixoAgentUsageEvent) => void, reasoningEffort: OpenPixoAgentReasoningEffort | null = null): string {
    // A retried attempt of the same run keeps its token and running totals.
    const existing = this.runs.get(runId);
    if (existing) { existing.onUsage = onUsage; existing.reasoningEffort = reasoningEffort; return existing.token.toString(); }
    const token = randomBytes(32).toString('base64url');
    this.runs.set(runId, { token: Buffer.from(token), usage: emptyUsage(runId), terminalError: null, onUsage, reasoningEffort, cutsInARow: 0 });
    return token;
  }

  /** Revokes the run's token; its relayed totals stay readable for a while. */
  close(runId: string): void {
    const state = this.runs.get(runId);
    if (!state) return;
    this.runs.delete(runId);
    this.cloud.creditsChanged?.();
    this.finished.set(runId, state.usage);
    while (this.finished.size > FINISHED_RUNS_KEPT) this.finished.delete(this.finished.keys().next().value!);
  }

  runUsage(runId: string): OpenPixoAgentRunUsage | null {
    const state = this.runs.get(runId);
    return state ? { ...state.usage } : this.finished.get(runId) ?? null;
  }

  terminalError(runId: string): RunTerminalError | null {
    return this.runs.get(runId)?.terminalError ?? null;
  }

  /**
   * A run that the gateway refused fails with the gateway's reason, not the agent's
   * generic exit. Applied to the run's `error` stream payloads.
   */
  overrideRunError<T>(runId: string, data: T): T {
    const terminal = this.terminalError(runId);
    if (!terminal || data === null || typeof data !== 'object') return data;
    const payload = data as Record<string, unknown>;
    return { ...payload, message: terminal.message,
      error: { ...record(payload.error), code: terminal.code, message: terminal.message, retryable: false } } as T;
  }

  private runFor(req: Request): [string, RunState] | null {
    const token = bearer(req);
    if (!token) return null;
    for (const entry of this.runs) {
      const expected = entry[1].token;
      if (expected.length === token.length && timingSafeEqual(expected, token)) return entry;
    }
    return null;
  }

  private record(state: RunState, value: unknown): void {
    let usage;
    try { usage = agentRequestUsage(value); } catch { return; }
    const total = state.usage;
    total.requests += 1;
    total.inputTokens += usage.inputTokens;
    total.cachedInputTokens += usage.cachedInputTokens;
    total.outputTokens += usage.outputTokens;
    total.costMicrocredits += usage.costMicrocredits;
    total.creditsCharged += usage.creditsCharged;
    this.cloud.creditsChanged?.();
    try {
      state.onUsage({ type: 'hosted_usage', requests: total.requests, inputTokens: total.inputTokens,
        cachedInputTokens: total.cachedInputTokens, outputTokens: total.outputTokens,
        costMicrocredits: total.costMicrocredits, creditsCharged: total.creditsCharged });
    } catch { /* a closed run sink must not break the relay */ }
  }

  private refuse(state: RunState, res: Response, code: string, message: string, fallbackStatus: number): void {
    const terminal = TERMINAL[code as OpenPixoAccountErrorCode];
    if (terminal) {
      const text = terminal.message ?? message;
      state.terminalError ??= { code: terminal.code, message: text };
      sendError(res, terminal.status, code, text);
      return;
    }
    sendError(res, fallbackStatus, code, message);
  }

  /** Whether a request comes from a running agent: loopback with its run's token. Reads headers only. */
  admits(req: Request): boolean {
    return isLoopbackPeerAddress(req.socket.remoteAddress) && this.runFor(req) !== null;
  }

  /** `POST /api/openpixo/agent/v1/chat/completions`, called only by the run's own agent. */
  async handle(req: Request, res: Response): Promise<void> {
    if (!isLoopbackPeerAddress(req.socket.remoteAddress)) return sendError(res, 403, 'FORBIDDEN', 'Local agents only.');
    const found = this.runFor(req);
    if (!found) return sendError(res, 401, 'UNAUTHORIZED', 'This endpoint serves the OpenPixo agent of a running task only.');
    const [runId, state] = found;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return sendError(res, 400, 'AGENT_REQUEST_INVALID', 'Expected a JSON body.');
    const body = await fitInlineImages(req.body, this.fittedImages, MAX_REQUEST_BYTES);
    if (body.length > MAX_REQUEST_BYTES) return sendError(res, 413, 'AGENT_REQUEST_INVALID', 'Request too large.');

    if (state.cutsInARow >= MAX_CUTS_IN_A_ROW) {
      state.terminalError ??= { code: 'AGENT_EXECUTION_FAILED', message: TOO_MANY_CUTS_MESSAGE };
      return sendError(res, 400, 'AGENT_REQUEST_INVALID', TOO_MANY_CUTS_MESSAGE);
    }
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    let upstream: globalThis.Response;
    try {
      upstream = await this.cloud.agentCompletion(runId, withReasoningEffort(body, state.reasoningEffort), abort.signal);
    } catch (error) {
      const failure = error instanceof AccountError ? error : new AccountError('CLOUD_UNAVAILABLE');
      return this.refuse(state, res, failure.code, failure.message, failure.status);
    }
    if (!upstream.ok) {
      let code = 'CLOUD_UNAVAILABLE';
      let message = 'OpenPixo cloud is temporarily unavailable. Please try again.';
      try {
        const error = record(record(await upstream.json()).error);
        if (typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code)) code = error.code;
        if (typeof error.message === 'string' && error.message) message = error.message.slice(0, 500);
      } catch { /* keep the generic reason */ }
      return this.refuse(state, res, code, message, upstream.status);
    }

    const usageHeader = upstream.headers.get('x-openpixo-usage');
    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    if (!contentType.startsWith('text/event-stream') || !upstream.body) {
      const text = await upstream.text().catch(() => null);
      if (text === null) return sendError(res, 502, 'AGENT_UPSTREAM_FAILED', 'The OpenPixo agent model stopped answering.');
      if (usageHeader) { try { this.record(state, JSON.parse(usageHeader)); } catch { /* not metered locally */ } }
      res.status(200).set({ 'Content-Type': contentType, 'Cache-Control': 'no-store' }).send(text);
      return;
    }

    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const decoder = new TextDecoder();
    let pending = '';
    let finished = false;
    // The cloud appends its settled usage as an SSE comment; strip it here so the
    // agent sees exactly the vendor stream.
    const relay = (chunk: string, final: boolean): string => {
      pending += chunk;
      let out = '';
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline + 1);
        pending = pending.slice(newline + 1);
        if (line.startsWith(USAGE_TRAILER_PREFIX)) {
          try { this.record(state, JSON.parse(line.slice(USAGE_TRAILER_PREFIX.length))); } catch { /* not metered locally */ }
        } else {
          const failure = streamErrorMessage(line);
          if (failure) state.terminalError ??= { code: 'AGENT_EXECUTION_FAILED', message: failure };
          if (FINISH_REASON.test(line)) finished = true;
          out += line;
        }
      }
      if (final && pending && !pending.startsWith(USAGE_TRAILER_PREFIX)) { out += pending; pending = ''; }
      return out;
    };
    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const out = relay(decoder.decode(value, { stream: true }), false);
        if (out && !res.write(out)) await new Promise<void>((resolve) => res.once('drain', resolve));
      }
      const tail = relay(decoder.decode(), true);
      state.cutsInARow = finished ? 0 : state.cutsInARow + 1;
      res.end(tail);
    } catch {
      // Client went away or the cloud stream broke; the cloud settles either way.
      reader.cancel().catch(() => {});
      res.destroy();
    }
  }
}
