/** @module agent-protocol/codex-app-server/session
 *
 * Drives one codex turn over the `codex app-server` stdio JSON-RPC transport.
 *
 * Shape of a turn, from spawn to close:
 *
 *   initialize            -> capabilities handshake
 *   initialized           -> (notification)
 *   thread/start | thread/resume
 *   turn/start            -> the user prompt travels here, not on stdin
 *   …notifications…       -> normalized and handed to the agent-event channel
 *   turn/completed        -> turn is over; the daemon closes the child
 *
 * The daemon still spawns one child per turn and resumes by thread id, so this
 * is a transport swap, not an architecture change: `getDurableSessionId()`
 * returns the same capture-style handle the `exec --json` path reads off
 * `thread.started`.
 *
 * Three defects the ACP transport carries are avoided here BY CONSTRUCTION,
 * and each has a named test:
 *
 *   1. Langfuse's `stdin-write` / `agent-call` spans exist only when the run
 *      records prompt-send marks. ACP never records them because the marks are
 *      wired to the stdin branch, so its tool spans hang off `agent-run`. This
 *      module calls `onPromptSendStart` / `onPromptSendEnd` around the
 *      `turn/start` write, which is this transport's real prompt boundary.
 *   2. ACP files per-step usage under `diagnostic`, where the analytics scan
 *      cannot reach it. Usage here is a plain `usage` agent event — the exact
 *      channel `exec --json` uses.
 *   3. ACP raises `fatal_rpc_error` instead of the `stream_error` failure
 *      detail the Langfuse triage practice queries on. Every failure here,
 *      including a JSON-RPC error response, is emitted as an `error` AGENT
 *      event so it flows through `sendAgentEvent`'s classifier.
 *
 * OpenPixo-owned threads opt into experimentalApi for persistent paginated history.
 * Codex 0.146.0 only locks paginated histories across processes when archiving;
 * its default legacy history can be archived while another process writes it.
 * Streaming itself does not require the experimental capability.
 */
import { createCodexAppServerNormalizer } from './normalize.js';
import { codexHistoryCapabilities } from './thread-cleanup.js';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { AgentApprovalMode, CodexApprovalDecision, CodexApprovalRequest } from '@openpixo/contracts';

type JsonObject = Record<string, unknown>;

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

const closedThreadProof = Symbol('closed owned Codex thread');

/** Issued only by this session after its child closes; never reconstructed from a user ID. */
export interface CodexClosedThreadCleanup {
  readonly threadId: string;
  readonly historyMode: 'paginated' | 'legacy';
  readonly [closedThreadProof]: true;
}

export interface CodexAppServerSessionOptions {
  child: {
    once?(event: 'close', listener: () => void): unknown;
    stdout: { on(event: 'data', listener: (chunk: unknown) => void): unknown };
    stdin: {
      write(chunk: string, cb?: (err?: Error | null) => void): unknown;
      end(): unknown;
      destroyed?: boolean;
    } | null;
    killed?: boolean;
  };
  prompt: string;
  cwd: string;
  model?: string | null;
  modelProvider?: string;
  suppressReasoningSummary?: boolean;
  config?: JsonObject;
  reasoning?: string | null;
  serviceTier?: string | null;
  sandboxMode: CodexSandboxMode;
  approvalMode?: AgentApprovalMode;
  resumeSessionId?: string | null;
  /** Internal daemon policy; never infer ownership from a thread title. */
  manageThreadVisibility?: boolean;
  /** The daemon validated this resume handle against its captured session record. */
  resumeSessionOwned?: boolean;
  imagePaths?: string[];
  clientVersion?: string;
  onAgentEvent: (event: JsonObject) => void;
  onCliReady?: () => void;
  onSessionReady?: () => void;
  onPromptSendStart?: () => void;
  onPromptSendEnd?: () => void;
  onTurnComplete?: () => void;
}

export interface CodexAppServerSession {
  abort(): void;
  listApprovals(): CodexApprovalRequest[];
  respondApproval(requestId: string, decision: CodexApprovalDecision): boolean;
  /**
   * True once codex reported a turn that ended without failing. The run's close
   * classifier reads this so a shutdown that produces no exit code (a signalled
   * kill during teardown) is still recorded as a success.
   */
  completedSuccessfully(): boolean;
  getDurableSessionId(): string | null;
  getLastSessionPath(): string | null;
  /** Once-only cleanup authority, unavailable until this exact child has closed. */
  takeClosedThreadCleanup(): CodexClosedThreadCleanup | null;
  stats(): { unknownNotifications: number; unknownItems: number };
}

const APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'execCommandApproval',
  'applyPatchApproval',
]);

/**
 * Codex's embedded model catalog ships `default_reasoning_summary = "none"`,
 * so without this the turn reasons but reports nothing. The `exec` path sets
 * the same value through `-c model_reasoning_summary="detailed"`; on this
 * transport it is a typed per-turn parameter.
 */
const REASONING_SUMMARY = 'detailed';

/**
 * How long restoring an archived owned thread may take before the turn fails.
 * Unarchive scans the user's whole Codex history: 3,063 ms on a 72 GB
 * `sessions` folder with codex-cli 0.160.0 (2026-11-11), where the old 1.5 s
 * bound failed the second turn of every conversation. A turn is about to spend
 * minutes anyway, so wait generously; the bound only catches a hung server.
 */
const UNARCHIVE_TIMEOUT_MS = 30_000;

/** `default` is the daemon's synthetic "user did not choose" sentinel. */
function chosen(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'default') return null;
  return trimmed;
}

function isRecord(value: unknown): value is JsonObject {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * PatchUpdated reached app-server in rust-v0.123.0 (upstream #18289).
 * 0.122.0 already had the internal event but did not forward it to clients.
 * Read the running server's version, not another `codex` found on PATH. The
 * first user-agent token is client-name/CODEX_VERSION; later tokens include
 * OS and client versions and must not be mistaken for the server version.
 * Unknown and prerelease builds keep the existing completion-only behavior.
 */
function supportsPatchStreaming(userAgent: unknown): boolean {
  if (typeof userAgent !== 'string') return false;
  const match = /^[^/\s]+\/(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?(?:\s|$)/u.exec(userAgent);
  if (!match) return false;
  return Number(match[1]) > 0 || Number(match[2]) >= 123;
}

export function attachCodexAppServerSession(
  opts: CodexAppServerSessionOptions,
): CodexAppServerSession {
  const {
    child,
    prompt,
    cwd,
    sandboxMode,
    resumeSessionId,
    onAgentEvent,
    onCliReady,
    onSessionReady,
    onPromptSendStart,
    onPromptSendEnd,
    onTurnComplete,
  } = opts;

  const normalizer = createCodexAppServerNormalizer(onAgentEvent, Date.now, cwd, () => threadId);
  const pending = new Map<number, (frame: JsonObject) => void>();
  const approvals = new Map<string, { rpcId: string | number; request: CodexApprovalRequest; permissions?: JsonObject }>();
  const decoder = new StringDecoder('utf8');
  const filePathsByItem = new Map<string, string[]>();
  let nextId = 1;
  let buffer = '';
  let threadId: string | null = null;
  let turnId: string | null = null;
  let rolloutPath: string | null = null;
  let cliReadySeen = false;
  let promptSent = false;
  let aborted = false;
  let fatalReported = false;
  let turnEnded = false;
  let turnSucceeded = false;
  let handleReported = false;
  let terminalReceived = false;
  let childClosed = false;
  let cleanupThread: CodexClosedThreadCleanup | null = null;
  let canArchiveSafely = false;
  let supportsPaginatedHistory = false;
  let protectsLegacyHistory = false;
  let archiveTimer: ReturnType<typeof setTimeout> | undefined;
  const ownsThread = !resumeSessionId || opts.resumeSessionOwned === true;
  let patchStreaming = false;

  function write(frame: JsonObject, onWritten?: () => void): boolean {
    const stdin = child.stdin;
    if (!stdin || stdin.destroyed || childClosed) return false;
    try {
      stdin.write(`${JSON.stringify(frame)}\n`, () => onWritten?.());
      return true;
    } catch {
      // A child that exited before reading stdin surfaces through the daemon's
      // exit/close handlers; a throw here would take the daemon with it.
      return false;
    }
  }

  function respondApproval(requestId: string, decision: CodexApprovalDecision): boolean {
    const approval = approvals.get(requestId);
    if (!approval || turnEnded || childClosed || !['accept', 'decline', 'cancel'].includes(decision)) return false;
    if (approval.request.availableDecisions && !approval.request.availableDecisions.includes(decision)) return false;
    const legacy = approval.request.method === 'execCommandApproval' || approval.request.method === 'applyPatchApproval';
    const result = approval.permissions
      ? { permissions: decision === 'accept' ? approval.permissions : {}, scope: 'turn' }
      : { decision: legacy ? { accept: 'approved', decline: 'denied', cancel: 'abort' }[decision] : decision };
    if (!write({ jsonrpc: '2.0', id: approval.rpcId, result })) return false;
    approvals.delete(requestId);
    onAgentEvent({ type: 'approval_resolved', requestId, decision });
    if (approval.permissions && decision === 'cancel' && !aborted) interruptTurn();
    return true;
  }

  function clearApprovals(cancel: boolean): void {
    for (const requestId of approvals.keys()) {
      if (!cancel || !respondApproval(requestId, 'cancel')) {
        approvals.delete(requestId);
        onAgentEvent({ type: 'approval_resolved', requestId, decision: 'cancel' });
      }
    }
  }

  function interruptTurn(): void {
    if (threadId && turnId) {
      write({ jsonrpc: '2.0', id: nextId++, method: 'turn/interrupt', params: { threadId, turnId } });
    }
  }

  function receiveApproval(rpcId: string | number, method: string, params: JsonObject): void {
    if ([...approvals.values()].some((entry) => entry.rpcId === rpcId)) return;
    const requestThread = typeof params.threadId === 'string' ? params.threadId
      : typeof params.conversationId === 'string' ? params.conversationId : null;
    if (requestThread && threadId && requestThread !== threadId) {
      write({ jsonrpc: '2.0', id: rpcId, error: { code: -32602, message: 'approval does not belong to this thread' } });
      return;
    }
    if (typeof params.turnId === 'string' && turnId && params.turnId !== turnId) {
      write({ jsonrpc: '2.0', id: rpcId, error: { code: -32602, message: 'approval does not belong to this turn' } });
      return;
    }
    const profile = isRecord(params.permissions) ? params.permissions : null;
    if (method === 'item/permissions/requestApproval' && !profile) {
      write({ jsonrpc: '2.0', id: rpcId, error: { code: -32602, message: 'permission profile missing' } });
      return;
    }
    const text = (key: string): string | null => typeof params[key] === 'string' ? params[key] as string : null;
    const changes = isRecord(params.fileChanges) ? Object.keys(params.fileChanges) : [];
    const paths = Array.isArray(params.changes)
      ? params.changes.flatMap((change) => isRecord(change) && typeof change.path === 'string' ? [change.path] : [])
      : changes.length > 0 ? changes : [...(filePathsByItem.get(text('itemId') ?? '') ?? [])];
    if (text('grantRoot')) paths.push(text('grantRoot')!);
    const request: CodexApprovalRequest = {
      requestId: randomUUID(), method, threadId: requestThread ?? threadId,
      turnId: text('turnId') ?? turnId, itemId: text('itemId') ?? text('callId'),
      reason: text('reason'),
      createdAt: Date.now(),
      command: text('command') ?? (Array.isArray(params.command) && params.command.every((arg) => typeof arg === 'string') ? JSON.stringify(params.command) : null),
      cwd: text('cwd'), paths,
      ...(profile || params.additionalPermissions || params.networkApprovalContext ? {
        details: JSON.stringify({
          ...(profile ? { permissions: profile, scope: 'turn' } : {}),
          ...(params.additionalPermissions ? { additionalPermissions: params.additionalPermissions } : {}),
          ...(params.networkApprovalContext ? { networkApprovalContext: params.networkApprovalContext } : {}),
        }, null, 2),
      } : {}),
      ...(Array.isArray(params.availableDecisions) ? {
        availableDecisions: params.availableDecisions.filter((value): value is CodexApprovalDecision =>
          value === 'accept' || value === 'decline' || value === 'cancel'),
      } : {}),
    };
    turnId ??= request.turnId;
    const permissions = profile ? Object.fromEntries(Object.entries(profile).filter(([key, value]) =>
      (key === 'network' || key === 'fileSystem') && value !== null)) : null;
    approvals.set(request.requestId, { rpcId, request, ...(permissions ? { permissions } : {}) });
    onAgentEvent({ type: 'approval_request', ...request });
  }

  function request(
    method: string,
    params: JsonObject,
    onResult: (result: JsonObject) => void,
    onWritten?: () => void,
    onError?: (error: unknown) => void,
  ): void {
    const id = nextId++;
    pending.set(id, (frame) => {
      if (frame.error !== undefined) {
        if (onError) onError(frame.error);
        else reportFatal(rpcErrorText(method, frame.error));
        return;
      }
      onResult(isRecord(frame.result) ? frame.result : {});
    });
    write({ jsonrpc: '2.0', id, method, params }, onWritten);
  }

  function notify(method: string, params: JsonObject): void {
    write({ jsonrpc: '2.0', method, params });
  }

  function rpcErrorText(method: string, error: unknown): string {
    const detail = isRecord(error) ? error : {};
    const message =
      typeof detail.message === 'string' && detail.message
        ? detail.message
        : `json-rpc error from ${method}`;
    const code = typeof detail.code === 'number' ? ` (${detail.code})` : '';
    return `codex app-server ${method}${code}: ${message}`;
  }

  /**
   * Surface a transport failure on the AGENT event channel so it reaches
   * `sendAgentEvent` and becomes a `stream_error` failure detail, rather than a
   * transport-private error shape no triage query knows about.
   */
  function reportFatal(message: string): void {
    if (fatalReported || aborted) return;
    fatalReported = true;
    onAgentEvent({ type: 'error', message });
  }

  function startTurn(): void {
    if (!threadId || promptSent || aborted || childClosed) return;
    promptSent = true;
    const params: JsonObject = {
      threadId,
      input: [
        { type: 'text', text: prompt, text_elements: [] },
        ...(opts.imagePaths ?? []).map((path) => ({ type: 'localImage', path })),
      ],
      summary: opts.suppressReasoningSummary === true ? 'none' : REASONING_SUMMARY,
    };
    const model = chosen(opts.model);
    if (model) params.model = model;
    const effort = chosen(opts.reasoning);
    if (effort) params.effort = effort;
    const serviceTier = chosen(opts.serviceTier);
    if (serviceTier) params.serviceTier = serviceTier;
    // The prompt-send boundary for this transport. Marked here, not around a
    // stdin write that never happens, so the Langfuse `stdin-write` and
    // `agent-call` spans exist on app-server runs too.
    onPromptSendStart?.();
    request(
      'turn/start',
      params,
      (result) => {
        const turn = isRecord(result.turn) ? result.turn : {};
        if (typeof turn.id === 'string') turnId = turn.id;
        if (aborted) interruptTurn();
        // `turn/start` resolves when the turn is accepted; completion arrives
        // as the `turn/completed` notification.
      },
      () => onPromptSendEnd?.(),
    );
  }

  function openThread(): void {
    if (aborted || childClosed) return;
    const shared: JsonObject = {
      cwd,
      sandbox: sandboxMode,
      approvalPolicy: opts.approvalMode === 'skip' ? 'never' : 'on-request',
      ...(opts.modelProvider ? { modelProvider: opts.modelProvider } : {}),
      ...(opts.config || patchStreaming ? { config: { ...opts.config, ...(patchStreaming ? { 'features.apply_patch_streaming_events': true } : {}) } } : {}),
    };
    const onThread = (result: JsonObject) => {
      const thread = isRecord(result.thread) ? result.thread : null;
      const id = typeof thread?.id === 'string' ? thread.id : null;
      if (id) {
        threadId = id;
        canArchiveSafely = opts.manageThreadVisibility === true
          && (protectsLegacyHistory || (supportsPaginatedHistory && thread?.historyMode === 'paginated'));
        if (canArchiveSafely && ownsThread && id.trim()
          && (!resumeSessionId || id === resumeSessionId)) {
          cleanupThread = Object.freeze({ threadId: id,
            historyMode: thread?.historyMode === 'paginated' ? 'paginated' : 'legacy',
            [closedThreadProof]: true as const });
        }
        const path = typeof thread?.path === 'string' ? thread.path : '';
        if (path) rolloutPath = path;
        // `thread/start` is followed by a `thread/started` notification, but
        // `thread/resume` answers only with this result. Capture-style resume
        // persists whatever handle the run reported THIS turn, so a resumed
        // turn that reported none would let the stored handle go stale and the
        // next turn would start a cold thread.
        reportSessionHandle(id);
        onSessionReady?.();
        startTurn();
        return;
      }
      reportFatal('codex app-server returned no thread id');
    };
    if (resumeSessionId) {
      request(
        'thread/resume', { ...shared, threadId: resumeSessionId }, onThread,
        undefined,
        (error) => {
          const message = rpcErrorText('thread/resume', error);
          if (opts.manageThreadVisibility !== true || !ownsThread || !/\bis archived\b/u.test(message)) {
            reportFatal(message);
            return;
          }
          archiveTimer = setTimeout(() => {
            reportFatal('codex app-server thread/unarchive timed out');
            shutdown();
          }, UNARCHIVE_TIMEOUT_MS);
          request('thread/unarchive', { threadId: resumeSessionId }, () => {
            clearTimeout(archiveTimer);
            archiveTimer = undefined;
            request('thread/resume', { ...shared, threadId: resumeSessionId }, onThread);
          }, undefined, (unarchiveError) => {
            onAgentEvent({ type: 'diagnostic', name: 'codex_thread_unarchive_failed',
              message: rpcErrorText('thread/unarchive', unarchiveError) });
            // Do not feed a cleanup error's "no rollout" wording into the
            // daemon's stale-resume detector, which would clear the cursor.
            reportFatal('codex app-server thread/unarchive failed');
            shutdown();
          });
        },
      );
      return;
    }
    request('thread/start', supportsPaginatedHistory ? { ...shared, historyMode: 'paginated' } : shared, onThread);
  }

  /** Emit the thread id on the session-capture channel, at most once. */
  function reportSessionHandle(id: string): void {
    if (handleReported || !id) return;
    handleReported = true;
    onAgentEvent({ type: 'status', label: 'initializing', sessionId: id });
  }

  function handleFrame(frame: JsonObject): void {
    // Preserve archive replies after a terminal event, but never reopen a canceled turn.
    if (turnEnded || childClosed) return;
    if (!cliReadySeen) {
      cliReadySeen = true;
      onCliReady?.();
    }
    const id = typeof frame.id === 'number' || typeof frame.id === 'string' ? frame.id : null;
    if (id !== null && typeof frame.method !== 'string') {
      const resolver = typeof id === 'number' ? pending.get(id) : undefined;
      if (typeof id === 'number') pending.delete(id);
      resolver?.(frame);
      return;
    }
    if (typeof frame.method !== 'string') return;
    if (id !== null) {
      if (APPROVAL_METHODS.has(frame.method)) {
        if (aborted || fatalReported) {
          const legacy = frame.method === 'execCommandApproval' || frame.method === 'applyPatchApproval';
          write({ jsonrpc: '2.0', id, result: frame.method === 'item/permissions/requestApproval'
            ? { permissions: {}, scope: 'turn' } : { decision: legacy ? 'abort' : 'cancel' } });
        } else receiveApproval(id, frame.method, isRecord(frame.params) ? frame.params : {});
        return;
      }
      write({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `unsupported request: ${frame.method}` },
      });
      return;
    }
    if ((aborted || fatalReported) && !terminalReceived && frame.method !== 'turn/completed') return;
    if (frame.method === 'thread/started') {
      const params = isRecord(frame.params) ? frame.params : {};
      const thread = isRecord(params.thread) ? params.thread : null;
      const path = typeof thread?.path === 'string' ? thread.path : '';
      const startedId = typeof thread?.id === 'string' ? thread.id : '';
      if (startedId === threadId) {
        if (path) rolloutPath = path;
        reportSessionHandle(startedId);
      }
      return;
    }
    const params = isRecord(frame.params) ? frame.params : {};
    const rootThread = typeof params.threadId !== 'string' || params.threadId === threadId;
    if (frame.method === 'item/started' && rootThread && isRecord(params.item)
      && params.item.type === 'fileChange' && typeof params.item.id === 'string' && Array.isArray(params.item.changes)) {
      filePathsByItem.set(params.item.id, params.item.changes.flatMap((change) =>
        isRecord(change) && typeof change.path === 'string' ? [change.path] : []));
    }
    if (frame.method === 'turn/started' && rootThread) {
      const turn = isRecord(params.turn) ? params.turn : {};
      if (typeof turn.id === 'string') turnId = turn.id;
      else if (typeof params.turnId === 'string') turnId = params.turnId;
    }
    if (frame.method === 'turn/completed' && terminalReceived) return;
    normalizer.handleNotification(frame.method, frame.params);
    if (frame.method === 'turn/completed' && rootThread) {
      terminalReceived = true;
      const turn = isRecord(params.turn) ? params.turn : null;
      turnSucceeded = turn?.status !== 'failed';
      onTurnComplete?.();
      if (canArchiveSafely && ownsThread && threadId
        && (!resumeSessionId || threadId === resumeSessionId)) {
        // The upstream archive operation checks its cross-process writer lock.
        // A competing resume therefore refuses cleanup instead of losing history.
        archiveTimer = setTimeout(shutdown, 1_500);
        request('thread/archive', { threadId }, shutdown, undefined, (error) => {
          onAgentEvent({ type: 'diagnostic', name: 'codex_thread_archive_failed',
            message: rpcErrorText('thread/archive', error) });
          shutdown();
        });
      } else shutdown();
    }
  }

  /**
   * End the turn by closing the child's stdin.
   *
   * This is the one lifecycle difference between the two transports, and it is
   * not optional: `codex exec` runs a turn and exits, while `codex app-server`
   * is a server that keeps listening. Without this the child never exits, the
   * daemon's close handler never fires, and the run sits in `running` forever
   * with its answer already delivered. Measured on codex-cli 0.149.1, stdin EOF
   * shuts the server down with exit code 0 in roughly 250ms — a normal clean
   * exit, so nothing downstream needs a special case for it.
   */
  function shutdown(): void {
    if (turnEnded) return;
    clearApprovals(false);
    turnEnded = true;
    if (archiveTimer) clearTimeout(archiveTimer);
    const stdin = child.stdin;
    if (!stdin || stdin.destroyed) return;
    try {
      stdin.end();
    } catch {
      // The child already went away; its exit handler owns the run from here.
    }
  }

  child.stdout.on('data', (chunk) => {
    buffer += Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        // codex writes structured frames only; a non-JSON line is noise from a
        // wrapper script, not a protocol failure. Dropping it keeps a chatty
        // shim from failing an otherwise healthy run.
        continue;
      }
      if (isRecord(frame)) handleFrame(frame);
    }
  });

  child.once?.('close', () => {
    childClosed = true;
    clearApprovals(false);
    if (archiveTimer) clearTimeout(archiveTimer);
    pending.clear();
  });

  request(
    'initialize',
    {
      clientInfo: {
        name: 'openpixo',
        title: 'OpenPixo',
        version: opts.clientVersion ?? '0.0.0',
      },
      capabilities: { experimentalApi: opts.manageThreadVisibility === true, requestAttestation: false },
    },
    (result) => {
      // Verified with the official 0.146.0 and 0.153.4 binaries: paginated
      // history has cross-process archive locks in both; legacy only in the
      // latter. Never convert an existing legacy history or archive it on an
      // older server. Unknown servers retain the existing resumable behavior.
      const capabilities = codexHistoryCapabilities(result.userAgent);
      supportsPaginatedHistory = opts.manageThreadVisibility === true && capabilities.paginated;
      protectsLegacyHistory = opts.manageThreadVisibility === true && capabilities.legacy;
      patchStreaming = supportsPatchStreaming(result.userAgent);
      notify('initialized', {});
      openThread();
    },
  );

  return {
    abort(): void {
      if (aborted) return;
      aborted = true;
      clearApprovals(true);
      // Cancel the turn rather than only signalling the process: codex keeps
      // the thread alive and reports `turn/completed` with status
      // `interrupted`, so a later resume still finds it.
      interruptTurn();
      if (!promptSent) shutdown();
    },
    listApprovals(): CodexApprovalRequest[] {
      return [...approvals.values()].map(({ request }) => ({ ...request, paths: [...request.paths] }));
    },
    respondApproval,
    completedSuccessfully(): boolean {
      return turnEnded && turnSucceeded && !fatalReported;
    },
    getDurableSessionId(): string | null {
      return threadId;
    },
    getLastSessionPath(): string | null {
      return rolloutPath;
    },
    takeClosedThreadCleanup(): CodexClosedThreadCleanup | null {
      if (!childClosed || terminalReceived) return null;
      const receipt = cleanupThread;
      cleanupThread = null;
      return receipt;
    },
    stats() {
      return normalizer.stats();
    },
  };
}
