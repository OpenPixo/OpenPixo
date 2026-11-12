import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: mocks.create }));
import { captureGamePage } from '../../src/main/game-capture.js';

afterEach(() => { vi.restoreAllMocks(); mocks.create.mockReset(); });

it('uses a hidden sandboxed window, waits for canvas, captures, and destroys it', async () => {
  const events: string[] = [];
  const contents = {
    setFrameRate: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn(),
    session: { webRequest: { onBeforeRequest: vi.fn() }, setPermissionRequestHandler: vi.fn() },
    executeJavaScript: vi.fn(async (_script: string) => { events.push('canvas'); }),
    capturePage: vi.fn(async () => { events.push('capture'); return { getSize: () => ({ width: 1280, height: 720 }), toPNG: () => Buffer.from('png') }; }),
  };
  mocks.create.mockImplementation(function () { return {
    webContents: contents, loadURL: async () => { events.push('load'); }, isDestroyed: () => false, destroy: () => { events.push('destroy'); },
  }; });
  expect(await captureGamePage({ url: 'http://localhost:5199/', timeoutMs: 1000, waitMs: 10 }))
    .toEqual({ status: 'passed', width: 1280, height: 720, pngBase64: Buffer.from('png').toString('base64') });
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ show: false, webPreferences: expect.objectContaining({ offscreen: true, sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false }) }));
  expect(contents.setFrameRate).toHaveBeenCalledExactlyOnceWith(60);
  expect(contents.executeJavaScript.mock.calls[0]?.[0]).toContain("document.querySelector('canvas')");
  expect(events).toEqual(['load', 'canvas', 'capture', 'destroy']);
});

it('refuses non-local targets without creating a window', async () => {
  expect(await captureGamePage({ url: 'https://example.com/', timeoutMs: 1000, waitMs: 10 })).toMatchObject({ status: 'failed' });
  expect(mocks.create).not.toHaveBeenCalled();
});
