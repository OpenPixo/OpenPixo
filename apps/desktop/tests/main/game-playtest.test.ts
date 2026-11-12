import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: mocks.create }));
import { captureGamePage } from '../../src/main/game-capture.js';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); mocks.create.mockReset(); });
it('replays trusted keyboard/mouse input, captures labels, records early console/errors and measured fps, then disposes', async () => {
  vi.useFakeTimers();
  const events: string[] = [];
  let message!: (_event: unknown, method: string, params: unknown) => void;
  const debuggerApi = { attach: vi.fn(() => { events.push('attach'); }), detach: vi.fn(), isAttached: () => true, removeListener: vi.fn(),
    on: vi.fn((_event: string, callback: typeof message) => { message = callback; }), sendCommand: vi.fn(async () => ({})) };
  const contents = { debugger: debuggerApi, setFrameRate: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn(),
    session: { webRequest: { onBeforeRequest: vi.fn() }, setPermissionRequestHandler: vi.fn() },
    executeJavaScript: vi.fn(async (script: string) => script.includes('.active = false') ? [0, 10, 30, 50] : undefined),
    capturePage: vi.fn(async () => ({ getSize: () => ({ width: 1, height: 1 }), toPNG: () => Buffer.from('png') })) };
  const destroy = vi.fn();
  mocks.create.mockImplementation(function () { return { webContents: contents, isDestroyed: () => false, destroy,
    loadURL: async (url: string) => {
      events.push(url);
      if (url === 'about:blank') { await Promise.resolve(); events.push('renderer-ready'); return; }
      message({}, 'Runtime.consoleAPICalled', { type: 'warning', args: [{ value: 'fixture warning' }] });
      message({}, 'Runtime.exceptionThrown', { exceptionDetails: { text: 'Uncaught fixture error' } });
    } }; });
  const promise = captureGamePage({ url: 'http://localhost:5199/', timeoutMs: 1000, waitMs: 0,
    playtest: { durationMs: 100, script: [{ key: 'ArrowRight', down: true }, { wait: 20 }, { key: 'Space', press: true, holdMs: 10 },
      { click: [10, 20] }, { capture: 'jump' }] } });
  await vi.runAllTimersAsync();
  const result = await promise;
  expect(events).toEqual(['about:blank', 'renderer-ready', 'attach', 'http://localhost:5199/']);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ webPreferences: expect.objectContaining({ offscreen: true }) }));
  expect(contents.setFrameRate).toHaveBeenCalledExactlyOnceWith(60);
  expect(result).toMatchObject({ status: 'passed', playtest: { completed: true, fps: { min: 50, avg: 60 },
    console: [{ level: 'warning', text: 'fixture warning' }], pageErrors: ['Uncaught fixture error'],
    frames: expect.arrayContaining([expect.objectContaining({ label: 'jump' })]) } });
  expect(debuggerApi.sendCommand).toHaveBeenCalledWith('Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyDown', key: 'ArrowRight' }));
  expect(debuggerApi.sendCommand).toHaveBeenCalledWith('Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyUp', key: 'ArrowRight' }));
  expect(debuggerApi.sendCommand).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({ type: 'mousePressed', x: 10, y: 20 }));
  expect(destroy).toHaveBeenCalledOnce(); expect(debuggerApi.detach).toHaveBeenCalledOnce();
});
it('rejects invalid scripts and malformed or remote URLs before creating a window', async () => {
  for (const url of ['not a URL', 'file:///tmp/game', 'http://example.com/']) {
    expect(await captureGamePage({ url, timeoutMs: 1000, waitMs: 0, playtest: {} })).toMatchObject({ status: 'failed' });
  }
  expect(await captureGamePage({ url: 'http://localhost:5199/', timeoutMs: 1000, waitMs: 0, playtest: { durationMs: 30_001 } }))
    .toMatchObject({ status: 'failed' });
  expect(mocks.create).not.toHaveBeenCalled();
});
it('drives mouse move, hold and smooth drag gestures with the left button state, and releases a held button', async () => {
  vi.useFakeTimers();
  const debuggerApi = { attach: vi.fn(), detach: vi.fn(), isAttached: () => true, removeListener: vi.fn(), on: vi.fn(),
    sendCommand: vi.fn(async (_method: string, _params?: Record<string, unknown>) => ({})) };
  const contents = { debugger: debuggerApi, setFrameRate: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn(),
    session: { webRequest: { onBeforeRequest: vi.fn() }, setPermissionRequestHandler: vi.fn() },
    executeJavaScript: vi.fn(async (script: string) => script.includes('.active = false') ? [0, 16, 32] : undefined),
    capturePage: vi.fn(async () => ({ getSize: () => ({ width: 1, height: 1 }), toPNG: () => Buffer.from('png') })) };
  mocks.create.mockImplementation(function () { return { webContents: contents, isDestroyed: () => false, destroy: vi.fn(), loadURL: async () => {} }; });
  const promise = captureGamePage({ url: 'http://localhost:5199/', timeoutMs: 5000, waitMs: 0,
    playtest: { durationMs: 1000, script: [{ move: [5, 6] }, { drag: { from: [100, 100], to: [200, 300], durationMs: 160 } },
      { mouseDown: [50, 50] }, { move: [60, 70] }, { mouseUp: [60, 70] }, { mouseDown: [7, 8] }] } });
  await vi.runAllTimersAsync();
  expect(await promise).toMatchObject({ status: 'passed' });
  const mouse = debuggerApi.sendCommand.mock.calls.filter(([method]) => method === 'Input.dispatchMouseEvent').map(([, params]) => params!);
  expect(mouse[0]).toEqual({ type: 'mouseMoved', x: 5, y: 6, button: 'none', buttons: 0 });
  const drag = mouse.slice(1, mouse.findIndex(event => event.type === 'mouseReleased') + 1);
  expect(drag[0]).toMatchObject({ type: 'mouseMoved', x: 100, y: 100 });
  expect(drag[1]).toMatchObject({ type: 'mousePressed', x: 100, y: 100, button: 'left', buttons: 1 });
  expect(drag.slice(2, -1)).toHaveLength(10);
  expect(drag.slice(2, -1).every(event => event.type === 'mouseMoved' && event.buttons === 1)).toBe(true);
  expect(drag.at(-2)).toMatchObject({ x: 200, y: 300 });
  expect(drag.at(-1)).toMatchObject({ type: 'mouseReleased', x: 200, y: 300, buttons: 0 });
  expect(mouse).toContainEqual({ type: 'mouseMoved', x: 60, y: 70, button: 'left', buttons: 1 });
  // The script ended with the button held; teardown must release it at the last pointer position.
  expect(mouse.at(-1)).toMatchObject({ type: 'mouseReleased', x: 7, y: 8 });
});
