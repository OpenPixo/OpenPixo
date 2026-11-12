// @vitest-environment jsdom
// Playtest in the 游戏 view (specs/current/openpixo-game-panel.md §4): presets
// run straight from 试玩 ▾, the script editor is a sheet, the report lives in
// the 上次试玩 row.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GAME_PLAYTEST_PRESETS, gamePlaytestPreset, parseGamePlaytestRequest } from '@openpixo/contracts';
import { callsTo, gameToolbar, renderGameView, routeFetch } from './game/game-view-harness';

vi.mock('../../src/components/tuning/tuning-api', () => ({ listGameTuning: vi.fn(async () => ({ parameters: [], warnings: [] })) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type Body = Record<string, unknown>;
const report = (extra: Record<string, unknown> = {}) => ({ completed: true, durationMs: 5000, inputSupported: true, frames: [], console: [], pageErrors: [], fps: null, ...extra });
function playtestFetch(reply: (body: Body) => Response) {
  return routeFetch((path, method, init) => path.endsWith('/game/playtest') && method === 'POST' ? reply(JSON.parse(String(init?.body))) : undefined);
}
const bodies = (mock: ReturnType<typeof routeFetch>) => callsTo(mock, '/game/playtest', 'POST').map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Body);
// Preset items also read their duration ("… 10 s"), so match on the name's start.
const menuItem = (name: string) => screen.getByRole('menuitem', { name: (accessible) => accessible.startsWith(name) });
function openMenu(name = 'Playtest') { fireEvent.click(gameToolbar().getByRole('button', { name })); }
function openEditor(open = 'Playtest', edit = 'Edit script…') {
  openMenu(open);
  fireEvent.click(screen.getByRole('menuitem', { name: edit }));
  return screen.getByTestId('panel-playtest-sheet');
}
async function start(name = 'Start playtest') {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

it('opens the script editor as a sheet, sends a bounded script, then reports frames, errors and fps inline', async () => {
  const request = playtestFetch(() => Response.json({ status: 'failed', steps: [], screenshots: [], missingTools: [],
    playtest: report({ frames: [{ ref: 'frame', width: 1280, height: 720, atMs: 100, label: 'jump' }],
      console: [{ level: 'error', text: 'fixture console error', atMs: 10 }], pageErrors: ['fixture page error'], fps: { min: 50, avg: 60, samples: 300 } }) }));
  vi.stubGlobal('fetch', request);
  renderGameView({ projectId: 'my game' });
  const sheet = openEditor();
  expect(sheet).toHaveAttribute('data-open');
  fireEvent.click(within(sheet).getByText('Advanced: edit input script'));
  fireEvent.change(within(sheet).getByLabelText('Input script (JSON)'), { target: { value: '[{"key":"Space","press":true},{"capture":"jump"}]' } });
  await start();
  // Sending closes the sheet; the report opens in the 上次试玩 row.
  expect(sheet).not.toHaveAttribute('data-open');
  const summary = await screen.findByTestId('game-playtest-summary');
  expect(within(summary).getByText('fixture page error')).toBeTruthy();
  expect(within(summary).getByText(/fixture console error/)).toBeTruthy();
  expect(within(summary).getByText(/60.0/)).toBeTruthy();
  expect(callsTo(request, '/game/playtest', 'POST')[0]).toEqual(['/api/projects/my%20game/game/playtest', expect.objectContaining({ method: 'POST',
    body: expect.stringContaining('"key":"Space"') })]);
  // The stage shows the last recorded frame.
  expect(screen.getByTestId('panel-game-shot').getAttribute('src')).toBe('/api/projects/my%20game/game/verify/frame');
});

it('uses localized unavailability guidance and keeps raw backend errors out of Chinese copy', async () => {
  vi.stubGlobal('fetch', playtestFetch(() => Response.json({ status: 'unavailable', steps: [{ message: 'raw backend error' }], screenshots: [], missingTools: [],
    playtest: report({ completed: false, durationMs: 0, reasonCode: 'SCREENSHOT_HOST_UNAVAILABLE' }) })));
  renderGameView({}, 'zh-CN');
  openEditor('试玩', '编辑脚本…');
  await start('开始试玩');
  expect(await within(screen.getByTestId('game-playtest-notice')).findByText('网页试玩需要 OpenPixo 桌面应用。请打开桌面应用后重试。')).toBeTruthy();
  expect(screen.queryByText('raw backend error')).toBeNull();
});

it('localizes HTTP failures with the shared game error mapper and keeps unknown details collapsed', async () => {
  let calls = 0;
  vi.stubGlobal('fetch', playtestFetch(() => ++calls === 1
    ? Response.json({ error: { code: 'MISSING_TOOL', message: 'raw tool failure' } }, { status: 400 })
    : Response.json({ error: { code: 'FUTURE_REASON', message: 'raw future reason' } }, { status: 500 })));
  renderGameView({}, 'zh-CN');
  openMenu('试玩');
  fireEvent.click(menuItem('只观察 5 秒'));
  expect((await screen.findByRole('alert')).textContent).toContain('工具');
  expect(screen.queryByText('raw tool failure')).toBeNull();
  openMenu('试玩');
  fireEvent.click(menuItem('只观察 5 秒'));
  expect((await screen.findByText('raw future reason')).closest('details')?.open).toBe(false);
});

it.each([
  ['en', 'Playtest', 'Observe for 5 seconds', 'Run right and jump', 'Random keys for 10 seconds', 'Edit script…', 'Advanced: edit input script'],
  ['zh-CN', '试玩', '只观察 5 秒', '向右跑并跳跃', '随机按键 10 秒', '编辑脚本…', '高级设置：编辑输入脚本'],
] as const)('runs bounded presets straight from the menu without JSON (%s)', async (locale, open, observe, runJump, random, edit, advanced) => {
  const request = playtestFetch(() => Response.json({ status: 'passed', steps: [], screenshots: [], missingTools: [], playtest: report() }));
  vi.stubGlobal('fetch', request);
  renderGameView({}, locale);
  openMenu(open);
  expect(screen.getAllByRole('menuitem')).toHaveLength(GAME_PLAYTEST_PRESETS.length + 2);
  for (const [preset, durationMs] of [[random, 10000], [runJump, 5000], [observe, 5000]] as const) {
    if (!screen.queryByRole('menu')) openMenu(open);
    await act(async () => { fireEvent.click(menuItem(preset)); });
    const parsed = parseGamePlaytestRequest(bodies(request).at(-1));
    expect(parsed.durationMs).toBe(durationMs);
    if (preset === observe) expect(parsed).toMatchObject({ script: [], preset: 'observe' });
    else expect(parsed.script).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'Space' })]));
    if (preset === runJump) expect(parsed.script).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'ArrowRight', down: true })]));
    if (preset === random) expect(parsed).toMatchObject({ preset: 'random', seed: expect.any(Number) });
  }
  // The editor shows what ran last.
  const sheet = openEditor(open, edit);
  expect((within(sheet).getByRole('radio', { name: observe }) as HTMLInputElement).checked).toBe(true);
  expect(within(sheet).getByText(advanced).closest('details')?.open).toBe(false);
  fireEvent.click(within(sheet).getByText(advanced));
  expect(within(sheet).getByRole('textbox', { name: /JSON/ })).toBeTruthy();
});

it('explains each preset in plain language and sends the matching keyboard or mouse script', async () => {
  const request = playtestFetch(() => Response.json({ status: 'passed', steps: [], screenshots: [], missingTools: [], playtest: report() }));
  vi.stubGlobal('fetch', request);
  renderGameView();
  let sheet = openEditor();
  expect(within(sheet).getAllByRole('radio')).toHaveLength(GAME_PLAYTEST_PRESETS.length);
  for (const [name, id] of [['Walk with WASD', 'wasd'], ['Click a grid', 'clickGrid'], ['Drag and swap', 'drag']] as const) {
    if (!sheet.hasAttribute('data-open')) sheet = openEditor();
    const radio = within(sheet).getByRole('radio', { name });
    expect(document.getElementById(radio.getAttribute('aria-describedby')!)?.textContent).toMatch(/For .*games/);
    fireEvent.click(radio);
    await start();
    expect(bodies(request).at(-1)).toEqual(parseGamePlaytestRequest(gamePlaytestPreset(id)));
  }
  expect(bodies(request)[1]?.script).toEqual(expect.arrayContaining([{ click: [360, 160] }]));
  expect(bodies(request)[2]?.script).toEqual(expect.arrayContaining([expect.objectContaining({ drag: expect.any(Object) })]));
});

it('shows, edits and copies the seed of seeded presets, and the same seed sends the identical script', async () => {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const request = playtestFetch(() => Response.json({ status: 'passed', steps: [], screenshots: [], missingTools: [], playtest: report({ durationMs: 15000 }) }));
  vi.stubGlobal('fetch', request);
  renderGameView();
  let sheet = openEditor();
  fireEvent.click(within(sheet).getByRole('radio', { name: 'Monkey test for 15 seconds' }));
  const seed = within(sheet).getByLabelText('Seed') as HTMLInputElement;
  expect(Number.isInteger(Number(seed.value))).toBe(true);
  fireEvent.change(seed, { target: { value: '31337' } });
  await start();
  sheet = openEditor();
  fireEvent.click(within(sheet).getByRole('button', { name: 'New seed' }));
  expect(seed.value).not.toBe('31337');
  fireEvent.change(seed, { target: { value: '31337' } });
  await start();
  const [first, second] = bodies(request);
  expect(first).toEqual(second);
  expect(first).toEqual(parseGamePlaytestRequest(gamePlaytestPreset('monkey', { seed: 31337 })));
  sheet = openEditor();
  await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Copy seed' })); });
  expect(writeText).toHaveBeenCalledWith('31337');
  expect(within(sheet).getByText('Seed copied')).toBeTruthy();
  fireEvent.change(seed, { target: { value: '4294967296' } });
  expect(within(sheet).getByText('Enter a whole number from 0 to 4294967295.')).toBeTruthy();
  expect((within(sheet).getByRole('button', { name: 'Start playtest' }) as HTMLButtonElement).disabled).toBe(true);
});

it('replays a finished run with the seed recorded in its report', async () => {
  const request = playtestFetch(body => Response.json({ status: 'passed', steps: [], screenshots: [], missingTools: [],
    playtest: report({ durationMs: 10000, preset: body.preset, seed: body.seed }) }));
  vi.stubGlobal('fetch', request);
  renderGameView();
  let sheet = openEditor();
  fireEvent.click(within(sheet).getByRole('radio', { name: 'Random keys for 10 seconds' }));
  fireEvent.change(within(sheet).getByLabelText('Seed'), { target: { value: '77' } });
  await start();
  const summary = screen.getByTestId('game-playtest-summary');
  expect(await within(summary).findByText('Seed 77')).toBeTruthy();
  expect(within(summary).getByText('Preset: Random keys for 10 seconds')).toBeTruthy();
  // Switching the editor to another preset must not change what the replay sends.
  sheet = openEditor();
  fireEvent.click(within(sheet).getByRole('radio', { name: 'Click a grid' }));
  fireEvent.keyDown(within(sheet).getByRole('button', { name: 'Close' }), { key: 'Escape' });
  await act(async () => { fireEvent.click(within(summary).getByRole('button', { name: 'Replay with this seed' })); });
  expect(bodies(request).at(-1)).toEqual(parseGamePlaytestRequest(gamePlaytestPreset('random', { seed: 77 })));
  sheet = openEditor();
  expect((within(sheet).getByRole('radio', { name: 'Random keys for 10 seconds' }) as HTMLInputElement).checked).toBe(true);
});

it('drops preset provenance once the script is edited by hand', async () => {
  const request = playtestFetch(() => Response.json({ status: 'passed', steps: [], screenshots: [], missingTools: [], playtest: report() }));
  vi.stubGlobal('fetch', request);
  renderGameView();
  let sheet = openEditor();
  fireEvent.click(within(sheet).getByRole('radio', { name: 'Random keys for 10 seconds' }));
  fireEvent.click(within(sheet).getByText('Advanced: edit input script'));
  fireEvent.change(within(sheet).getByLabelText('Input script (JSON)'), { target: { value: '[{"move":[10,10]}]' } });
  await start();
  const body = bodies(request).at(-1)!;
  expect(body).not.toHaveProperty('preset'); expect(body).not.toHaveProperty('seed');
  expect(body.script).toEqual([{ move: [10, 10] }]);
  sheet = openEditor();
  expect(within(sheet).getAllByRole('radio').some(radio => (radio as HTMLInputElement).checked)).toBe(false);
});

it('keeps an invalid script in the open editor', async () => {
  const request = playtestFetch(() => Response.json({ status: 'passed', steps: [], screenshots: [], missingTools: [], playtest: report() }));
  vi.stubGlobal('fetch', request);
  renderGameView();
  const sheet = openEditor();
  fireEvent.click(within(sheet).getByText('Advanced: edit input script'));
  fireEvent.change(within(sheet).getByLabelText('Input script (JSON)'), { target: { value: 'not json' } });
  await start();
  expect(sheet).toHaveAttribute('data-open');
  expect(within(sheet).getByRole('alert').textContent).toContain('Check the JSON steps');
  expect(bodies(request)).toHaveLength(0);
});

it('lets the user select filmstrip frames, shows the pick on the stage, and shows fps and a console summary', async () => {
  vi.stubGlobal('fetch', playtestFetch(() => Response.json({ status: 'passed', steps: [], screenshots: [], missingTools: [],
    playtest: report({ frames: [{ ref: 'first.png', width: 32, height: 32, atMs: 0 }, { ref: 'last.png', width: 32, height: 32, atMs: 5000 }],
      console: [{ level: 'warning', text: 'fixture warning', atMs: 10 }], fps: { avg: 60, min: 50, samples: 300 } }) })));
  renderGameView();
  openMenu();
  await act(async () => { fireEvent.click(menuItem('Observe for 5 seconds')); });
  const summary = screen.getByTestId('game-playtest-summary');
  expect(summary.textContent).toContain('2 frames');
  const strip = await within(summary).findByRole('group', { name: 'Recorded frames' });
  const buttons = strip.querySelectorAll('button');
  expect(screen.getByTestId('panel-game-shot').getAttribute('src')).toContain('last.png');
  fireEvent.click(buttons[0]!);
  expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('panel-game-shot').getAttribute('src')).toContain('first.png');
  fireEvent.click(buttons[1]!);
  expect(screen.getAllByAltText('Playtest frame 2')[0]?.getAttribute('src')).toContain('last.png');
  expect(within(summary).getByText('Console: 0 errors, 1 warnings')).toBeTruthy();
  expect(within(summary).getByText(/60.0/)).toBeTruthy();
});
