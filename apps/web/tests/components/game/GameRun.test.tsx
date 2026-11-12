// @vitest-environment jsdom
// Run in the 游戏 view (specs/current/openpixo-game-panel.md §4): same daemon
// calls as the former Run dialog, rendered inline.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GameRunStatus } from '@openpixo/contracts';
import { callsTo, gameStatus, gameToolbar, renderGameView } from './game-view-harness';

const { openExternalUrl, notifyStarterFactsChanged } = vi.hoisted(() => ({
  openExternalUrl: vi.fn(async () => true), notifyStarterFactsChanged: vi.fn(),
}));
vi.mock('../../../src/providers/registry', () => ({ openExternalUrl }));
vi.mock('../../../src/components/project-start/events', () => ({ notifyStarterFactsChanged }));
vi.mock('../../../src/components/tuning/tuning-api', () => ({ listGameTuning: vi.fn(async () => ({ parameters: [], warnings: [] })) }));
// The Share button's engine read is not a run call; these tests assert the exact fetch order.
vi.mock('../../../src/providers/publish', () => ({ fetchProjectEngine: vi.fn(async () => 'godot') }));

beforeEach(() => { vi.useFakeTimers(); openExternalUrl.mockClear(); notifyStarterFactsChanged.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const flush = async () => { await act(async () => {}); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const result = (value: GameRunStatus) => Response.json(value);
// Run-only: no Verify / Playtest, so the fetch order is exactly the run calls.
const runOnly = { controls: { verifyAvailable: false, startRequest: null } };
const withStart = (nonce: number, kind: 'run-game' | 'verify' = 'run-game') => ({ controls: { verifyAvailable: false, startRequest: { kind, nonce } } });
const runButton = (name: string) => gameToolbar().getByRole('button', { name });

it('shows the dependency install prompt inline, without a dialog, and localizes it in Chinese', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => result({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING',
    message: 'Project dependencies are missing. Install them before running the game.', installCommand: 'pnpm install' })));
  renderGameView(runOnly, 'zh-CN');
  await flush();
  expect(screen.getByRole('button', { name: '安装依赖并运行' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '安装依赖' })).toBeTruthy();
  expect(runButton('运行')).toBeTruthy();
  expect(screen.queryByText('Project dependencies are missing. Install them before running the game.')).toBeNull();
  expect(gameStatus()).toBe('运行失败');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('installs dependencies and starts only after installation succeeds', async () => {
  const installed = deferred<Response>();
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING', installCommand: 'pnpm install' }))
    .mockReturnValueOnce(installed.promise).mockResolvedValueOnce(result({ status: 'running', engine: 'phaser' }));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView(runOnly);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Install and run' }));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1]).toEqual(['/api/projects/game/game/install-deps', expect.objectContaining({ method: 'POST' })]);
  expect(gameStatus()).toBe('Installing dependencies…');
  await act(async () => installed.resolve(Response.json({ status: 'installed', packageManager: 'pnpm', logTail: 'done' })));
  expect(fetchMock.mock.calls[2]).toEqual(['/api/projects/game/game/run', expect.objectContaining({ method: 'POST' })]);
});

it.each(['toolbar', 'checklist'] as const)('auto-installs dependencies once and runs when a start finds them missing (%s)', async source => {
  const installed = deferred<Response>();
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'idle' }))
    .mockResolvedValueOnce(result({ status: 'failed', engine: 'phaser', reasonCode: 'DEPENDENCIES_MISSING', installCommand: 'pnpm install' }))
    .mockResolvedValueOnce(Response.json({ status: 'installing', logTail: 'Resolving packages' }))
    .mockReturnValueOnce(installed.promise)
    .mockImplementation(async () => result({ status: 'running', engine: 'phaser', url: 'http://127.0.0.1:5173/' }));
  vi.stubGlobal('fetch', fetchMock);
  const view = renderGameView(runOnly);
  await flush();
  if (source === 'toolbar') fireEvent.click(runButton('Run'));
  else view.rerenderGame(withStart(1));
  await flush();
  expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
    ['/api/projects/game/game/run', 'GET'], ['/api/projects/game/game/run', 'POST'], ['/api/projects/game/game/install-deps', 'POST'],
  ]);
  expect(gameStatus()).toBe('Installing dependencies…');
  expect(screen.queryByText('Project dependencies are missing.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Install and run' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Install dependencies' })).toBeNull();
  expect(screen.getByText('pnpm install')).toBeTruthy();
  expect(screen.getByText('Resolving packages')).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(750));
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(1);
  await act(async () => installed.resolve(Response.json({ status: 'installed', logTail: 'done' })));
  expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
    ['/api/projects/game/game/run', 'GET'], ['/api/projects/game/game/run', 'POST'], ['/api/projects/game/game/install-deps', 'POST'],
    ['/api/projects/game/game/install-deps', 'GET'], ['/api/projects/game/game/run', 'POST'],
  ]);
  expect(gameStatus()).toBe('Running');
  expect(screen.getByTestId('panel-game-frame').getAttribute('src')).toBe('http://127.0.0.1:5173/');
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(callsTo(fetchMock, '/game/install-deps', 'POST')).toHaveLength(1);
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(2);
});

it('does not loop when the automatic install fails', async () => {
  const missing: GameRunStatus = { status: 'failed', reasonCode: 'DEPENDENCIES_MISSING', installCommand: 'pnpm install' };
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'idle' })).mockResolvedValueOnce(result(missing))
    .mockResolvedValueOnce(Response.json({ status: 'failed', reasonCode: 'INSTALL_FAILED', logTail: 'registry unavailable' }))
    .mockImplementation(async () => result(missing));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView(runOnly);
  await flush();
  fireEvent.click(runButton('Run'));
  await flush();
  expect(callsTo(fetchMock, '/game/install-deps', 'POST')).toHaveLength(1);
  await act(async () => vi.advanceTimersByTimeAsync(4_500));
  expect(callsTo(fetchMock, '/game/install-deps', 'POST')).toHaveLength(1);
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Install and run' }).hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('button', { name: 'Install dependencies' }).hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('alert').textContent).toContain('Dependencies could not be installed');
  expect(screen.getByText('registry unavailable').closest('details')?.open).toBe(true);
});

it('does not auto-install a DEPENDENCIES_MISSING run that was not started by this controller', async () => {
  const fetchMock = vi.fn(async () => result({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING', installCommand: 'pnpm install' }));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView(runOnly);
  await flush();
  await act(async () => vi.advanceTimersByTimeAsync(4_500));
  expect(callsTo(fetchMock, '/game/install-deps', 'POST')).toHaveLength(0);
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Install and run' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Install dependencies' })).toBeTruthy();
});

it('keeps the install log and manual retry when dependencies are still missing after the automatic install', async () => {
  const missing: GameRunStatus = { status: 'failed', reasonCode: 'DEPENDENCIES_MISSING', installCommand: 'pnpm install' };
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'idle' })).mockResolvedValueOnce(result(missing))
    .mockResolvedValueOnce(Response.json({ status: 'installed', logTail: 'Already up to date' })).mockImplementation(async () => result(missing));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView(runOnly);
  await flush();
  fireEvent.click(runButton('Run'));
  await flush();
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(2);
  await act(async () => vi.advanceTimersByTimeAsync(4_500));
  expect(callsTo(fetchMock, '/game/install-deps', 'POST')).toHaveLength(1);
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Install and run' }).hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('button', { name: 'Install dependencies' }).hasAttribute('disabled')).toBe(false);
  expect(screen.getByText('Project dependencies are missing.')).toBeTruthy();
  expect(screen.getByText('Already up to date').closest('details')?.open).toBe(true);
});

it('does not auto-install after stopping a pending start', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'idle' })).mockResolvedValueOnce(result({ status: 'starting' }))
    .mockResolvedValueOnce(result({ status: 'exited' })).mockImplementation(async () => result({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING' }));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView(runOnly);
  await flush();
  fireEvent.click(runButton('Run'));
  await flush();
  fireEvent.click(runButton('Stop'));
  await flush();
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(callsTo(fetchMock, '/game/install-deps', 'POST')).toHaveLength(0);
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Install and run' })).toBeTruthy();
});

it('does not carry an automatic install into another project', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'idle' })).mockResolvedValueOnce(result({ status: 'starting' }))
    .mockImplementation(async () => result({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING' }));
  vi.stubGlobal('fetch', fetchMock);
  const view = renderGameView(runOnly);
  await flush();
  fireEvent.click(runButton('Run'));
  await flush();
  view.rerenderGame({ projectId: 'other' });
  await flush();
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(callsTo(fetchMock, '/game/install-deps', 'POST')).toHaveLength(0);
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Install and run' })).toBeTruthy();
});

it('shows a localized Node installation guide with a download link and no suggested command', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => result({ status: 'failed', reasonCode: 'NODE_MISSING', message: 'Node is missing' })));
  renderGameView(runOnly, 'zh-CN');
  await flush();
  expect(screen.getByRole('link', { name: '下载 Node.js' }).getAttribute('href')).toBe('https://nodejs.org/en/download');
  expect(screen.getByText(/请下载并安装 Node.js 长期支持版/)).toBeTruthy();
  expect(screen.queryByText('Node is missing')).toBeNull();
  expect(screen.queryByText('npm install')).toBeNull();
});

it('keeps unknown errors behind a technical-details disclosure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'failed', reasonCode: 'FUTURE_REASON', message: 'opaque backend detail' })));
  renderGameView(runOnly);
  await flush();
  expect(screen.getByText('The operation could not finish. Open the technical details for more information.')).toBeTruthy();
  expect(screen.getByText('opaque backend detail').closest('details')?.open).toBe(false);
});

it('captures installation failure without starting a game', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING', installCommand: 'pnpm install' }))
    .mockResolvedValueOnce(Response.json({ status: 'failed', reasonCode: 'INSTALL_FAILED', logTail: 'registry unavailable' }));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView(runOnly);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Install and run' })); await flush();
  expect(screen.getByRole('alert').textContent).toContain('Dependencies could not be installed');
  expect(screen.getByText('registry unavailable').closest('details')?.open).toBe(true);
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(0);
});

it('localizes installation authorization errors and collapses backend details', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING' }))
    .mockResolvedValueOnce(Response.json({ error: { code: 'FORBIDDEN', message: 'local origin required' } }, { status: 403 }));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView(runOnly, 'zh-CN');
  await flush();
  fireEvent.click(screen.getByRole('button', { name: '安装依赖' })); await flush();
  expect(screen.getByRole('alert').textContent).toContain('请在本机 OpenPixo 中操作，并确认有权修改这个项目。');
  expect(screen.getByText('local origin required').closest('details')?.open).toBe(false);
});

it('installs dependencies without running when the user chooses install only', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING', installCommand: 'npm install' }))
    .mockResolvedValueOnce(Response.json({ status: 'installed', packageManager: 'npm' }));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView(runOnly);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Install dependencies' })); await flush();
  expect(gameStatus()).toBe('Dependencies installed. Your game is ready to run.');
  expect(screen.queryByRole('button', { name: 'Install and run' })).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('continues to show run errors after a successful dependency installation', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING', installCommand: 'npm install' }))
    .mockResolvedValueOnce(Response.json({ status: 'installed', packageManager: 'npm' }))
    .mockResolvedValueOnce(result({ status: 'failed', reasonCode: 'START_TIMEOUT' }));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView(runOnly);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Install and run' })); await flush();
  expect(screen.getByText('The game server did not become ready. Check the recent output, then try again.')).toBeTruthy();
});

it.each([['en', 'Run', 'Starting…', 'Running in Godot', 'Stop', 'Game stopped', 'The game is running in its own window'],
  ['zh-CN', '运行', '正在启动…', '正在 Godot 中运行', '停止', '游戏已停止', '游戏正在独立窗口中运行']] as const)(
  'starts from the toolbar, shows the native-window stage for Godot, and stops through HTTP (%s)', async (locale, run, starting, running, stop, exited, native) => {
    const started = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'idle' })).mockReturnValueOnce(started.promise)
      .mockResolvedValueOnce(result({ status: 'exited', engine: 'godot' }));
    vi.stubGlobal('fetch', fetchMock);
    renderGameView({ ...runOnly, projectId: 'my game' }, locale);
    await flush();
    fireEvent.click(runButton(run));
    expect(gameStatus()).toBe(starting);
    await act(async () => started.resolve(result({ status: 'running', engine: 'godot' })));
    expect(gameStatus()).toBe(running);
    expect(screen.getByTestId('panel-game-stage').getAttribute('data-stage')).toBe('native');
    expect(screen.getByText(native)).toBeTruthy();
    expect(screen.queryByTestId('panel-game-frame')).toBeNull();
    expect(fetchMock.mock.calls[1]).toEqual(['/api/projects/my%20game/game/run', expect.objectContaining({ method: 'POST' })]);
    fireEvent.click(runButton(stop));
    await flush();
    expect(gameStatus()).toBe(exited);
    expect(runButton(run)).toBeTruthy();
    expect(fetchMock.mock.calls[2]).toEqual(['/api/projects/my%20game/game/run', expect.objectContaining({ method: 'DELETE' })]);
  });

it('plays a running web game inside the stage with the preview sandbox and keeps Open in browser', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => result({ status: 'running', engine: 'phaser', url: 'http://127.0.0.1:5173/' })));
  renderGameView(runOnly);
  await flush();
  const frame = screen.getByTitle('Game preview');
  expect(screen.getByTestId('panel-game-stage').contains(frame)).toBe(true);
  expect(frame.getAttribute('src')).toBe('http://127.0.0.1:5173/');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-pointer-lock');
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(openExternalUrl).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }));
  await flush();
  expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:5173/');
});

it('keeps the same live iframe while the view is hidden and shown again (no game reload)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => result({ status: 'running', engine: 'phaser', url: 'http://127.0.0.1:5173/' })));
  const view = renderGameView(runOnly);
  await flush();
  const frame = screen.getByTestId('panel-game-frame');
  view.rerenderGame({ hidden: true });
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  view.rerenderGame({ hidden: false });
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(screen.getByTestId('panel-game-frame')).toBe(frame);
});

it.each(['https://example.com/', 'http://localhost.example.com/', 'javascript:alert(1)', 'http://user@127.0.0.1/'])(
  'does not frame or offer unsafe preview URL %s', async url => {
    vi.stubGlobal('fetch', vi.fn(async () => result({ status: 'running', engine: 'threejs', url })));
    renderGameView(runOnly);
    await flush();
    expect(screen.queryByTestId('panel-game-frame')).toBeNull();
    expect(screen.getByTestId('panel-game-stage').getAttribute('data-stage')).toBe('native');
    expect(screen.queryByRole('button', { name: 'Open in browser' })).toBeNull();
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

it('shows dependency fix and tool settings guidance inline', async () => {
  const configure = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => result({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING', installCommand: 'npm install',
    missingToolGuidance: [{ tool: 'godot', name: 'Godot', configuration: 'engine-settings', hint: 'CLI hint', installUrl: 'https://godotengine.org/download' }] })));
  renderGameView({ ...runOnly, onOpenEngineSettings: configure });
  await flush();
  expect(gameStatus()).toBe('Run failed');
  expect(screen.getByText('Project dependencies are missing.')).toBeTruthy();
  expect(screen.getByText('npm install')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Download Godot' }).getAttribute('href')).toBe('https://godotengine.org/download');
  fireEvent.click(screen.getByRole('button', { name: 'Open game engine settings' }));
  expect(configure).toHaveBeenCalledOnce();
});

it('polls on the virtual clock and stops polling after unmount', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'idle' })).mockResolvedValue(result({ status: 'running', engine: 'godot' }));
  vi.stubGlobal('fetch', fetchMock);
  const view = renderGameView(runOnly);
  await flush();
  await act(async () => vi.advanceTimersByTimeAsync(1_499));
  expect(fetchMock).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(gameStatus()).toBe('Running in Godot');
  view.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('reads nothing while the project row is held', async () => {
  const fetchMock = vi.fn(async () => result({ status: 'idle' }));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView({ probeHeld: true, controls: { verifyAvailable: true, startRequest: { kind: 'run-game', nonce: 1 } } });
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByRole('toolbar').querySelectorAll('button')).toHaveLength(0);
});

it('ignores a stale GET after a newer start result', async () => {
  const initial = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(initial.promise).mockResolvedValueOnce(result({ status: 'running', engine: 'godot' })));
  renderGameView(runOnly);
  fireEvent.click(runButton('Run'));
  await flush();
  await act(async () => initial.resolve(result({ status: 'idle' })));
  expect(gameStatus()).toBe('Running in Godot');
});

it('ignores results from a previous project', async () => {
  const old = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(result({ status: 'idle' })));
  const view = renderGameView({ ...runOnly, projectId: 'old' });
  view.rerenderGame({ projectId: 'new' });
  await flush();
  await act(async () => old.resolve(result({ status: 'running', engine: 'godot' })));
  expect(runButton('Run')).toBeTruthy();
  expect(gameStatus()).toBe('');
});

it('shows a request failure and lets the user retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(result({ status: 'idle' })).mockRejectedValueOnce(new Error('offline')));
  renderGameView(runOnly);
  await flush();
  fireEvent.click(runButton('Run'));
  await flush();
  expect(screen.getByRole('alert').textContent).toContain("Couldn't reach OpenPixo's local service");
  expect(gameStatus()).toBe('Run failed');
  expect(runButton('Run')).toBeTruthy();
});

it('offers Run from the empty stage', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => result(init?.method === 'POST' ? { status: 'starting' } : { status: 'idle' }));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView(runOnly);
  await flush();
  const stage = screen.getByTestId('panel-game-stage');
  expect(stage.getAttribute('data-stage')).toBe('empty');
  fireEvent.click(stage.querySelector('button')!);
  await flush();
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(1);
});

it.each(['idle', 'exited', 'failed'] as const)('starts an inactive game once for a checklist request (%s)', async status => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => result(
    init?.method === 'POST' ? { status: 'running', engine: 'godot' } : { status },
  ));
  vi.stubGlobal('fetch', fetchMock);
  const view = renderGameView(runOnly);
  await flush();
  view.rerenderGame(withStart(1));
  await flush();
  expect(gameStatus()).toBe('Running in Godot');
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(1);
  view.rerenderGame(withStart(1));
  await flush();
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(1);
  // A verify request with a later nonce does not start the game.
  view.rerenderGame(withStart(2, 'verify'));
  await flush();
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(1);
});

it('consumes an initial checklist request once while its start response is pending', async () => {
  const started = deferred<Response>();
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'idle' })).mockReturnValueOnce(started.promise);
  vi.stubGlobal('fetch', fetchMock);
  const view = renderGameView(withStart(1));
  await flush();
  expect(gameStatus()).toBe('Starting…');
  view.rerenderGame(withStart(1));
  expect(callsTo(fetchMock, '/game/run', 'POST')).toHaveLength(1);
  await act(async () => started.resolve(result({ status: 'running', engine: 'godot' })));
  expect(notifyStarterFactsChanged).toHaveBeenCalledExactlyOnceWith('game');
});

it.each(['starting', 'running'] as const)('does not start an active game again for a checklist request (%s)', async status => {
  const fetchMock = vi.fn(async () => result({ status, engine: 'godot' }));
  vi.stubGlobal('fetch', fetchMock);
  const view = renderGameView(runOnly);
  await flush();
  view.rerenderGame(withStart(1));
  await flush();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('refreshes checklist facts for run transitions without repeating unchanged polls', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(result({ status: 'idle' }))
    .mockResolvedValueOnce(result({ status: 'running', engine: 'godot' }))
    .mockResolvedValueOnce(result({ status: 'running', engine: 'godot' }))
    .mockResolvedValueOnce(result({ status: 'exited', engine: 'godot' }))
    .mockResolvedValueOnce(result({ status: 'exited', engine: 'godot' }));
  vi.stubGlobal('fetch', fetchMock);
  renderGameView(runOnly);
  await flush();
  expect(notifyStarterFactsChanged).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1_499));
  expect(fetchMock).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(notifyStarterFactsChanged).toHaveBeenCalledExactlyOnceWith('game');
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(notifyStarterFactsChanged).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(notifyStarterFactsChanged).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(notifyStarterFactsChanged).toHaveBeenCalledTimes(2);
});

it.each(['starting', 'running', 'exited'] as const)('hides the install command for a game whose dependencies are ready (%s)', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => result({ status, installCommand: 'pnpm install --ignore-workspace' })));
  renderGameView(runOnly);
  await flush();
  expect(screen.queryByText('pnpm install --ignore-workspace')).toBeNull();
});

it('puts the recent run output in the 日志 disclosure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => result({ status: 'exited', engine: 'phaser', logTail: 'vite ready in 300 ms' })));
  renderGameView(runOnly, 'zh-CN');
  await flush();
  const toggle = screen.getByTestId('panel-game-logs-toggle');
  expect(toggle.textContent).toBe('日志');
  expect(screen.queryByText('vite ready in 300 ms')).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByText('vite ready in 300 ms')).toBeTruthy();
});
