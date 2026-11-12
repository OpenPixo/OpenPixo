import type { WebContents } from 'electron';
import { GAME_PLAYTEST_LIMITS, gamePlaytestFps, type GamePlaytestConsole, type GamePlaytestPoint, type ParsedGamePlaytestRequest,
  type GameWebCaptureResult, type GameWebPlaytestFrame } from '@openpixo/contracts';

export const PLAYTEST_FRAME_PROBE = 'window.__openpixoPlaytest = {active:false,times:[]}; requestAnimationFrame(function tick(t) { const s=window.__openpixoPlaytest; if(s.active && s.times.length<10000)s.times.push(t); requestAnimationFrame(tick); });';
/**
 * Installed for new documents once the playtest has started. A game that reloads
 * itself mid-playtest (to prove a save survives) gets a fresh document whose probe
 * starts inactive, so it measured no frames and the daemon failed the whole
 * playtest for missing animation timing. Frames after the reload count instead.
 */
export const PLAYTEST_FRAME_PROBE_RESUME = 'if (window.__openpixoPlaytest) window.__openpixoPlaytest.active = true;';
const PROBE = PLAYTEST_FRAME_PROBE;
const KEY_CODES: Record<string, number> = { ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, Space: 32,
  Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Shift: 16, Control: 17, Alt: 18 };

/** Keep errors visible even if earlier warnings used the entire message budget. */
export function appendGameConsoleMessage(messages: GamePlaytestConsole[], message: GamePlaytestConsole): void {
  const bounded = { ...message, text: message.text.slice(0, GAME_PLAYTEST_LIMITS.messageLength) };
  if (messages.length < GAME_PLAYTEST_LIMITS.consoleMessages) messages.push(bounded);
  else if (message.level === 'error') messages[messages.length - 1] = bounded;
}

/** Encoded frame data one playtest reply may carry back to the daemon. */
export const PLAYTEST_FRAME_BYTES = 16 * 1024 * 1024;

/**
 * Whether one more encoded frame fits the reply. A detailed 1280x720 game frame
 * is about 1 MB of base64 PNG, so a full 24-frame playtest of a painted game
 * passes 16 MiB; that used to throw away the whole playtest. Now a frame that
 * does not fit is dropped instead, and periodic frames stop early enough to
 * leave room (at this frame's size) for the labelled frames the script asked for.
 */
export function playtestFrameFits(usedBytes: number, frameBytes: number, explicit: boolean,
  explicitStillToCome: number, limit = PLAYTEST_FRAME_BYTES): boolean {
  const reserve = explicit ? 0 : frameBytes * explicitStillToCome;
  return usedBytes + frameBytes + reserve <= limit;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, Math.max(0, ms));
    signal?.addEventListener('abort', done, { once: true });
    if (signal?.aborted) done();
  });
}

/** CDP installs diagnostics before page scripts and delivers trusted input to the hidden renderer.
 * The session is private to this capture window; no debugger/preload surface is exposed to the page. */
export async function captureGamePlaytest(contents: WebContents, request: ParsedGamePlaytestRequest,
  load: () => Promise<void>): Promise<GameWebCaptureResult> {
  const consoleMessages: GamePlaytestConsole[] = [], pageErrors: string[] = [], frames: GameWebPlaytestFrame[] = [];
  let started = Date.now(), encodedBytes = 0;
  const atMs = () => Math.min(request.durationMs, Math.max(0, Date.now() - started));
  const debuggerApi = contents.debugger;
  const message = (_event: Electron.Event, method: string, params: Record<string, unknown>) => {
    if (method === 'Runtime.consoleAPICalled') {
      const kind = String(params.type);
      const level: GamePlaytestConsole['level'] = kind === 'error' || kind === 'assert' ? 'error'
        : kind === 'warning' || kind === 'warn' ? 'warning' : kind === 'debug' || kind === 'info' ? kind : 'log';
      const args = Array.isArray(params.args) ? params.args as Array<{ value?: unknown; description?: string }> : [];
      const text = args.map(arg => String(arg.value ?? arg.description ?? '')).join(' ').slice(0, GAME_PLAYTEST_LIMITS.messageLength);
      appendGameConsoleMessage(consoleMessages, { level, text, atMs: atMs() });
    }
    if (method === 'Log.entryAdded') {
      const entry = params.entry as { level?: string; text?: string } | undefined;
      const level = entry?.level === 'error' ? 'error' : entry?.level === 'warning' ? 'warning' : 'info';
      appendGameConsoleMessage(consoleMessages, { level, text: String(entry?.text ?? ''), atMs: atMs() });
    }
    if (method === 'Runtime.exceptionThrown' && pageErrors.length < GAME_PLAYTEST_LIMITS.pageErrors) {
      const detail = params.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
      pageErrors.push(String(detail?.exception?.description ?? detail?.text ?? 'Page exception').slice(0, GAME_PLAYTEST_LIMITS.messageLength));
    }
    if (method === 'Page.javascriptDialogOpening') void debuggerApi.sendCommand('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
  };
  const held = new Set<string>();
  const key = async (name: string, down: boolean) => {
    if (down) held.add(name); else held.delete(name);
    const modifiers = (held.has('Alt') ? 1 : 0) | (held.has('Control') ? 2 : 0) | (held.has('Shift') ? 8 : 0);
    const value = name === 'Space' ? ' ' : name;
    const code = name.length === 1 ? (/\d/.test(name) ? 'Digit' : 'Key') + name.toUpperCase() : name;
    await debuggerApi.sendCommand('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', key: value, code, modifiers,
      windowsVirtualKeyCode: KEY_CODES[name] ?? name.toUpperCase().charCodeAt(0),
      ...(down && value.length === 1 && !held.has('Control') && !held.has('Alt') ? { text: value } : {}) });
  };
  // One left button, tracked so moves during a press report it held and a held button is always released.
  let pointer: GamePlaytestPoint = [0, 0], buttonDown = false;
  const mouse = async (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', [x, y]: GamePlaytestPoint) => {
    pointer = [x, y];
    if (type === 'mousePressed') buttonDown = true; else if (type === 'mouseReleased') buttonDown = false;
    await debuggerApi.sendCommand('Input.dispatchMouseEvent', type === 'mouseMoved'
      ? { type, x, y, button: buttonDown ? 'left' : 'none', buttons: buttonDown ? 1 : 0 }
      : { type, x, y, button: 'left', buttons: buttonDown ? 1 : 0, clickCount: 1 });
  };
  /** Press, move in ~16 ms segments (at most 60) across the gesture duration, release at the target. */
  const drag = async ({ from, to, durationMs = 300 }: { from: GamePlaytestPoint; to: GamePlaytestPoint; durationMs?: number }) => {
    await mouse('mouseMoved', from); await mouse('mousePressed', from);
    const segments = Math.max(1, Math.min(60, Math.round(durationMs / 16)));
    for (let i = 1; i <= segments; i++) {
      await delay(durationMs / segments);
      await mouse('mouseMoved', [from[0] + (to[0] - from[0]) * i / segments, from[1] + (to[1] - from[1]) * i / segments]);
    }
    await mouse('mouseReleased', to);
  };
  let remainingExplicit = request.script.filter(step => 'capture' in step).length + 1;
  let queue: Promise<void> = Promise.resolve();
  const capture = (label?: string, explicit = false) => {
    queue = queue.then(async () => {
      if (explicit) remainingExplicit--;
      if (frames.length >= GAME_PLAYTEST_LIMITS.frames - (explicit ? 0 : remainingExplicit)) return;
      const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      const pngBase64 = image.toPNG().toString('base64');
      if (!playtestFrameFits(encodedBytes, pngBase64.length, explicit, remainingExplicit)) return;
      encodedBytes += pngBase64.length;
      frames.push({ ...image.getSize(), pngBase64, atMs: atMs(), ...(label ? { label } : {}) });
    });
    return queue;
  };
  const periodicAbort = new AbortController();
  let periodic: Promise<void> | undefined;
  debuggerApi.attach('1.3');
  debuggerApi.on('message', message);
  try {
    await debuggerApi.sendCommand('Runtime.enable');
    await debuggerApi.sendCommand('Log.enable');
    await debuggerApi.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    await debuggerApi.sendCommand('Page.enable');
    await debuggerApi.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    await load();
    await contents.executeJavaScript('window.__openpixoPlaytest.times = []; window.__openpixoPlaytest.active = true;');
    await debuggerApi.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: PLAYTEST_FRAME_PROBE_RESUME });
    started = Date.now();
    await capture();
    periodic = (async () => {
      while (!periodicAbort.signal.aborted) {
        await delay(request.captureIntervalMs, periodicAbort.signal);
        if (!periodicAbort.signal.aborted) await capture();
      }
    })();
    // Attach a handler immediately so an asynchronous screenshot failure is never an unhandled rejection.
    const periodicFailure = periodic.then(() => new Promise<never>(() => {}));
    const replay = async () => {
      for (const step of request.script) {
        if (Date.now() - started > request.durationMs) throw new Error('Input script exceeded the playtest duration');
        if ('wait' in step) await delay(Math.min(step.wait, Math.max(0, request.durationMs - (Date.now() - started))));
        else if ('key' in step) {
          if ('down' in step) await key(step.key, step.down);
          else { await key(step.key, true); await delay(step.holdMs ?? 80); await key(step.key, false); }
        } else if ('click' in step) {
          await mouse('mouseMoved', step.click); await mouse('mousePressed', step.click); await mouse('mouseReleased', step.click);
        } else if ('move' in step) await mouse('mouseMoved', step.move);
        else if ('mouseDown' in step) { await mouse('mouseMoved', step.mouseDown); await mouse('mousePressed', step.mouseDown); }
        else if ('mouseUp' in step) { await mouse('mouseMoved', step.mouseUp); await mouse('mouseReleased', step.mouseUp); }
        else if ('drag' in step) await drag(step.drag);
        else await capture(step.capture, true);
      }
      await delay(Math.max(0, request.durationMs - (Date.now() - started)));
    };
    await Promise.race([replay(), periodicFailure]);
    periodicAbort.abort(); await periodic; await capture('final', true);
    const timestamps: unknown = await contents.executeJavaScript('window.__openpixoPlaytest.active = false; window.__openpixoPlaytest.times;');
    const fps = gamePlaytestFps(Array.isArray(timestamps) ? timestamps.slice(0, 10_000) : []);
    const first = frames[0];
    if (!first) throw new Error('No playtest frames captured');
    return { status: 'passed', pngBase64: first.pngBase64, width: first.width, height: first.height,
      playtest: { completed: true, durationMs: Math.max(0, Date.now() - started), frames, console: consoleMessages, pageErrors, fps } };
  } finally {
    periodicAbort.abort(); await periodic?.catch(() => {});
    for (const name of [...held]) await key(name, false).catch(() => {});
    if (buttonDown) await mouse('mouseReleased', pointer).catch(() => {});
    debuggerApi.removeListener('message', message);
    if (debuggerApi.isAttached()) debuggerApi.detach();
  }
}
