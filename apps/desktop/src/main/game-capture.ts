import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { parseGamePlaytestRequest, type GameWebCaptureRequest, type GameWebCaptureResult } from '@openpixo/contracts';
import { captureGamePlaytest } from './game-capture-playtest.js';

export type GameCaptureInput = Omit<GameWebCaptureRequest, 'playtest'> & { playtest?: unknown };

/** Isolated, hidden Chromium capture. No preload, Node, shared cookies, or file navigation. */
export async function captureGamePage(input: GameCaptureInput): Promise<GameWebCaptureResult> {
  let url: URL, playtest: ReturnType<typeof parseGamePlaytestRequest> | undefined;
  try {
    url = new URL(input.url);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Game capture requires a loopback HTTP URL');
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 120_000
      || !Number.isInteger(input.waitMs) || input.waitMs < 0 || input.waitMs > 5000) throw new Error('Invalid capture limits');
    if (input.playtest !== undefined) {
      playtest = parseGamePlaytestRequest(input.playtest);
      if (playtest.durationMs >= input.timeoutMs) throw new Error('Capture timeout must exceed playtest duration');
    }
  } catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : String(error) }; }
  // A never-shown window produces no compositor frames on Windows: requestAnimationFrame never
  // fires and WebGL/canvas captures come back black. Offscreen rendering keeps the page painting.
  const window = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, partition: 'game-capture-' + randomUUID() } });
  const contents = window.webContents;
  contents.setFrameRate(60);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guard = (event: Electron.Event, target: string) => {
    try { if (new URL(target).origin === url.origin) return; } catch { /* refuse navigation */ }
    event.preventDefault();
  };
  contents.on('will-navigate', guard); contents.on('will-redirect', guard);
  contents.session.webRequest.onBeforeRequest((details, callback) => {
    try {
      const target = new URL(details.url);
      const safeScheme = ['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:'].includes(target.protocol);
      callback({ cancel: !safeScheme || (details.resourceType === 'mainFrame' && target.origin !== url.origin) });
    } catch { callback({ cancel: true }); }
  });
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const capture = async (): Promise<GameWebCaptureResult> => {
      if (playtest) {
        // CDP commands wait for a renderer; a fresh webContents has none until its first navigation.
        await window.loadURL('about:blank');
        return captureGamePlaytest(contents, playtest, async () => { await window.loadURL(url.href); });
      }
      await window.loadURL(url.href);
      await contents.executeJavaScript("new Promise((resolve, reject) => { let observer; const finish = () => { if (!document.querySelector('canvas')) return; observer?.disconnect(); clearTimeout(timeout); setTimeout(resolve, " + input.waitMs + "); }; const timeout = setTimeout(() => { observer?.disconnect(); reject(new Error('No canvas appeared')); }, " + input.timeoutMs + "); observer = new MutationObserver(finish); observer.observe(document.documentElement, { childList: true, subtree: true }); finish(); })");
      const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      return { status: 'passed', pngBase64: image.toPNG().toString('base64'), ...image.getSize() };
    };
    return await Promise.race([capture(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Game capture timed out')), input.timeoutMs); })]);
  } catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : String(error) }; }
  finally { clearTimeout(timer); if (!window.isDestroyed()) window.destroy(); }
}
