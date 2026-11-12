// @vitest-environment jsdom
// Verify in the 游戏 view (specs/current/openpixo-game-panel.md §4): the same
// `POST /game/verify` the dialog made, guidance inline under the toolbar,
// and a 上次验证 row that expands to step logs and screenshots.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GameVerifyResult } from '@openpixo/contracts';
import { callsTo, gameStatus, gameToolbar, renderGameView, routeFetch } from './game/game-view-harness';

const { notifyStarterFactsChanged } = vi.hoisted(() => ({ notifyStarterFactsChanged: vi.fn() }));
vi.mock('../../src/components/project-start/events', () => ({ notifyStarterFactsChanged }));
vi.mock('../../src/components/tuning/tuning-api', () => ({ listGameTuning: vi.fn(async () => ({ parameters: [], warnings: [] })) }));

beforeEach(() => notifyStarterFactsChanged.mockClear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const flush = async () => { await act(async () => {}); };
const verifyButton = (name = 'Verify') => gameToolbar().getByRole('button', { name });
const verifyWith = (...responses: Array<() => Response>) => {
  let index = 0;
  return routeFetch((path, method) => {
    if (path.endsWith('/game/verify') && method === 'POST') return responses[Math.min(index++, responses.length - 1)]!();
    return undefined;
  });
};
const passed: GameVerifyResult = { status: 'passed', missingTools: [], screenshots: [], steps: [] };

it.each([
  ['en', 'Verify', 'Game screenshots require the OpenPixo desktop app. Open the desktop app and retry Run + screenshot.', 'The build was verified successfully.'],
  ['zh-CN', '验证', '游戏截图需要 OpenPixo 桌面应用。请打开桌面应用后重试运行并截图。', '构建已验证通过。'],
] as const)('explains unavailable screenshots inline without losing the successful build (%s)', async (locale, verify, hint, build) => {
  vi.stubGlobal('fetch', verifyWith(() => Response.json({ status: 'unavailable', missingTools: [], screenshots: [], steps: [
    { name: 'build', status: 'passed', argv: [], exitCode: 0, durationMs: 1, logRef: 'build', timedOut: false },
    { name: 'run', status: 'unavailable', reasonCode: 'SCREENSHOT_HOST_UNAVAILABLE', message: 'raw host message', argv: [], exitCode: null, durationMs: 0, logRef: 'run', timedOut: false },
  ] })));
  renderGameView({}, locale);
  fireEvent.click(verifyButton(verify));
  const notice = await screen.findByTestId('game-verify-notice');
  expect(within(notice).getByText(hint)).toBeTruthy();
  expect(within(notice).getByText(build)).toBeTruthy();
  expect(screen.queryByText('raw host message')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each([
  ['en', 'godot', 'Godot', 'https://godotengine.org/download', 'engine-settings', 'Download Godot', 'Set the executable path in game engine settings, then verify again.'],
  ['zh-CN', 'godot', 'Godot', 'https://godotengine.org/download', 'engine-settings', '下载 Godot', '安装后，可在游戏引擎设置中填写可执行文件路径，然后重新验证。'],
  ['zh-CN', 'npm', 'Node.js (npm)', 'https://nodejs.org', 'path', '下载 Node.js (npm)', '安装后，请确认该工具已加入 PATH，并重启 OpenPixo 后重新验证。'],
] as const)('shows actionable localized installation guidance inline (%s, %s)', async (locale, tool, name, installUrl, configuration, download, hint) => {
  vi.stubGlobal('fetch', verifyWith(() => Response.json({ status: 'unavailable', missingTools: [tool], steps: [], screenshots: [],
    missingToolGuidance: [{ tool, name, installUrl, configuration, hint: 'CLI guidance' }] })));
  renderGameView({}, locale);
  fireEvent.click(verifyButton(locale === 'en' ? 'Verify' : '验证'));
  expect((await screen.findByRole('link', { name: download })).getAttribute('href')).toBe(installUrl);
  expect(screen.getByText(hint)).toBeTruthy();
  expect(screen.queryByText('CLI guidance')).toBeNull();
});

it('verifies through HTTP, fetches a step log on demand, and links missing tools to settings', async () => {
  const request = routeFetch((path, method) => {
    if (path.endsWith('/game/verify') && method === 'POST') return Response.json({ status: 'unavailable', missingTools: ['godot'], screenshots: [],
      steps: [{ name: 'check', status: 'unavailable', argv: ['godot'], logRef: 'log', timedOut: false, durationMs: 0, exitCode: null }] });
    if (path.endsWith('/game/verify/log')) return new Response('Godot is not installed');
    return undefined;
  });
  vi.stubGlobal('fetch', request);
  const settings = vi.fn();
  renderGameView({ onOpenEngineSettings: settings });
  fireEvent.click(verifyButton());
  expect(await screen.findByText('Missing tools: godot')).toBeTruthy();
  expect(callsTo(request, '/game/verify', 'POST')[0]).toEqual(['/api/projects/game/game/verify', expect.objectContaining({ method: 'POST', body: '{}' })]);
  // An incomplete check run here opens its row on the step details.
  const summary = screen.getByTestId('game-verify-summary');
  expect(within(summary).getByRole('button', { expanded: true })).toBeTruthy();
  const details = within(summary).getAllByText('Check').map(node => node.closest('details')).find(Boolean)!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  expect(await screen.findByText('Godot is not installed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open game engine settings' }));
  expect(settings).toHaveBeenCalledOnce();
});

it('runs inline once per checklist request and verifies again for a new one', async () => {
  const fetchMock = verifyWith(() => Response.json(passed));
  vi.stubGlobal('fetch', fetchMock);
  const start = (nonce: number) => ({ controls: { verifyAvailable: true, startRequest: { kind: 'verify' as const, nonce } } });
  const view = renderGameView({ ...start(1), projectId: 'my game' });
  await flush();
  expect(callsTo(fetchMock, '/game/verify', 'POST')).toEqual([['/api/projects/my%20game/game/verify', expect.objectContaining({ method: 'POST', body: '{}' })]]);
  expect(notifyStarterFactsChanged).toHaveBeenCalledExactlyOnceWith('my game');
  expect(screen.getByTestId('game-verify-summary')).toBeTruthy();
  view.rerenderGame(start(1));
  await flush();
  expect(callsTo(fetchMock, '/game/verify', 'POST')).toHaveLength(1);
  view.rerenderGame(start(2));
  await flush();
  expect(callsTo(fetchMock, '/game/verify', 'POST')).toHaveLength(2);
  expect(notifyStarterFactsChanged).toHaveBeenCalledTimes(2);
  // A run-game request does not verify.
  view.rerenderGame({ controls: { verifyAvailable: true, startRequest: { kind: 'run-game', nonce: 3 } } });
  await flush();
  expect(callsTo(fetchMock, '/game/verify', 'POST')).toHaveLength(2);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('refreshes checklist facts for an unsuccessful verification result but not an HTTP failure', async () => {
  const fetchMock = verifyWith(() => Response.json({ ...passed, status: 'failed' }), () => new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);
  const start = (nonce: number) => ({ controls: { verifyAvailable: true, startRequest: { kind: 'verify' as const, nonce } } });
  const view = renderGameView(start(1));
  await flush();
  expect(notifyStarterFactsChanged).toHaveBeenCalledExactlyOnceWith('game');
  view.rerenderGame(start(2));
  await flush();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(callsTo(fetchMock, '/game/verify', 'POST')).toHaveLength(2);
  expect(notifyStarterFactsChanged).toHaveBeenCalledOnce();
});

it('localizes coded request errors and collapses unknown diagnostics', async () => {
  vi.stubGlobal('fetch', verifyWith(
    () => Response.json({ error: { code: 'MISSING_TOOL', message: 'raw engine lookup failure' } }, { status: 400 }),
    () => Response.json({ error: { code: 'FUTURE_REASON', message: 'opaque failure' } }, { status: 500 }),
  ));
  renderGameView({}, 'zh-CN');
  fireEvent.click(verifyButton('验证'));
  await flush();
  expect(screen.getByRole('alert').textContent).toContain('工具');
  expect(screen.queryByText('raw engine lookup failure')).toBeNull();
  fireEvent.click(verifyButton('验证'));
  await flush();
  expect(screen.getByText('opaque failure').closest('details')?.open).toBe(false);
  expect(screen.getByRole('alert').textContent).not.toContain('opaque failure');
});

it('reports a malformed successful HTTP response instead of silently discarding verification', async () => {
  vi.stubGlobal('fetch', verifyWith(() => new Response('not JSON', { status: 200 })));
  renderGameView();
  fireEvent.click(verifyButton());
  await flush();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(notifyStarterFactsChanged).not.toHaveBeenCalled();
});

it('shows the stored latest result and its screenshot on the stage without verifying', async () => {
  const fetchMock = routeFetch(path => path.endsWith('/game/verify/latest') ? Response.json({
    status: 'passed', missingTools: [], screenshots: [{ ref: 'shot-1', width: 640, height: 360 }],
    steps: [
      { name: 'check', status: 'passed', argv: [], exitCode: 0, durationMs: 1, logRef: 'check', timedOut: false },
      { name: 'run', status: 'failed', argv: [], exitCode: 1, durationMs: 1, logRef: 'run', timedOut: false },
    ],
  }) : undefined);
  vi.stubGlobal('fetch', fetchMock);
  renderGameView({}, 'zh-CN');
  const summary = await screen.findByTestId('game-verify-summary');
  expect(summary.textContent).toContain('上次验证');
  expect(within(summary).getByTitle('检查：通过')).toBeTruthy();
  expect(within(summary).getByTitle('运行：失败')).toBeTruthy();
  // A stored result carries no time; a stored result stays collapsed.
  expect(summary.querySelector('time')).toBeNull();
  expect(within(summary).getByRole('button', { expanded: false })).toBeTruthy();
  const stage = screen.getByTestId('panel-game-stage');
  expect(stage.getAttribute('data-stage')).toBe('shot');
  expect(screen.getByTestId('panel-game-shot').getAttribute('src')).toBe('/api/projects/game/game/verify/shot-1');
  expect(callsTo(fetchMock, '/game/verify', 'POST')).toHaveLength(0);
});

it('shows the last screenshot under the native-window note while Godot runs', async () => {
  vi.stubGlobal('fetch', routeFetch((path, method) => {
    if (path.endsWith('/game/run') && method === 'GET') return Response.json({ status: 'running', engine: 'godot' });
    if (path.endsWith('/game/verify/latest')) return Response.json({ ...passed, screenshots: [{ ref: 'shot-2', width: 1, height: 1 }] });
    return undefined;
  }));
  renderGameView();
  await flush(); await flush();
  expect(screen.getByTestId('panel-game-stage').getAttribute('data-stage')).toBe('native');
  expect(screen.getByText('The game is running in its own window')).toBeTruthy();
  expect(screen.getByTestId('panel-game-shot').getAttribute('src')).toBe('/api/projects/game/game/verify/shot-2');
});

it('captures a screenshot from the playtest menu and times the result', async () => {
  const fetchMock = verifyWith(() => Response.json(passed));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView();
  fireEvent.click(screen.getByTestId('game-playtest-menu'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Run + screenshot' }));
  await flush();
  const [, init] = callsTo(fetchMock, '/game/verify', 'POST')[0] as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toEqual({ steps: ['check', 'build', 'run'], screenshot: true });
  expect(screen.getByTestId('game-verify-summary').querySelector('time')?.textContent).toBe('just now');
  expect(gameStatus()).toBe('');
});

it('shows Verify and Playtest only for a folder-backed project', async () => {
  vi.stubGlobal('fetch', routeFetch());
  renderGameView({ controls: { verifyAvailable: false, startRequest: null } });
  await flush();
  expect(gameToolbar().queryByRole('button', { name: 'Verify' })).toBeNull();
  expect(gameToolbar().queryByRole('button', { name: 'Playtest' })).toBeNull();
  expect(gameToolbar().getByRole('button', { name: 'Run' })).toBeTruthy();
});
