// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GameTuningParameter } from '@openpixo/contracts';
import { TuningPanel } from '../../../src/components/tuning/TuningPanel';

vi.mock('../../../src/i18n', () => ({ useI18n: () => ({ locale: 'zh-CN', t: (key: string) => key }) }));
const fetchMock = vi.fn<typeof fetch>();
const parameter: GameTuningParameter = {
  id: 'speed', key: 'speed', label: 'Speed', group: 'Player', owner: 'Player', type: 'float', source: 'godot-script',
  value: 220, defaultValue: 220, literal: '220.0', min: 0, max: 600, step: 10, filePath: 'player.gd', line: 5, fileHash: 'a'.repeat(64),
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockImplementation(async (url, init) => {
    if (String(url).endsWith('/game/run')) return response({ status: 'idle' });
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      return response({ parameter: { ...parameter, value: body.value, fileHash: 'b'.repeat(64) } });
    }
    return response({ parameters: [parameter], warnings: [] });
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount(props: Partial<Parameters<typeof TuningPanel>[0]> = {}) {
  await act(async () => { render(<TuningPanel projectId="game" onOpenFile={vi.fn()} {...props} />); });
}
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');

it('renders grouped numeric, boolean, string and alpha-preserving color controls with a source link', async () => {
  fetchMock.mockImplementation(async (url) => String(url).endsWith('/game/run') ? response({ status: 'idle' }) : response({ warnings: [], parameters: [
    parameter,
    { ...parameter, id: 'enabled', label: 'Enabled', key: 'enabled', type: 'bool', value: true, defaultValue: true },
    { ...parameter, id: 'title', label: 'Title', key: 'title', type: 'string', value: 'Hello', defaultValue: 'Hello' },
    { ...parameter, id: 'tint', label: 'Tint', key: 'tint', type: 'color', value: '#3366ff80', defaultValue: '#3366ff80' },
  ] }));
  const open = vi.fn();
  await mount({ onOpenFile: open });
  expect(screen.getByRole('heading', { name: 'Player' })).toBeTruthy();
  expect(screen.getByRole('slider', { name: 'Speed' })).toBeTruthy();
  expect(screen.getByRole('spinbutton', { name: 'Speed' })).toBeTruthy();
  expect((screen.getByRole('checkbox', { name: 'Enabled' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Hello');
  expect(screen.getByLabelText('Tint gameTuning.alpha')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('link', { name: /gameTuning.openCode/ })[0]!);
  expect(open).toHaveBeenCalledWith('player.gd', 5);
});

it('keeps every capability of a parameter on one compact line', async () => {
  fetchMock.mockImplementation(async (url) => String(url).endsWith('/game/run') ? response({ status: 'idle' }) : response({ warnings: [], parameters: [
    { ...parameter, value: 240, description: 'Pixels per second', source: 'godot-scene', nodePath: 'Level/Player' },
  ] }));
  const open = vi.fn();
  await mount({ onOpenFile: open });
  const label = screen.getByText('Speed', { selector: 'label' });
  const row = label.parentElement!;
  // Label, slider, number field and the icon actions share one row; nothing is stacked under it.
  expect(row.children).toHaveLength(3);
  expect(label.getAttribute('title')).toBe('Speed\nPixels per second');
  const field = screen.getByRole('spinbutton', { name: 'Speed' });
  expect(label.getAttribute('for')).toBe(field.id);
  expect(screen.getByRole('slider', { name: 'Speed' }).getAttribute('aria-describedby')).toBe(field.getAttribute('aria-describedby'));
  expect(document.getElementById(field.getAttribute('aria-describedby')!)?.textContent).toBe('Pixels per second');
  const reset = screen.getByRole('button', { name: 'gameTuning.resetTo' });
  expect((reset as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('img', { name: 'gameTuning.scene · Level/Player' })).toBeTruthy();
  const link = screen.getByRole('link', { name: 'gameTuning.openCode · player.gd:5' });
  expect(link.getAttribute('href')).toBe('/projects/game?file=player.gd#L5');
  fireEvent.click(link);
  expect(open).toHaveBeenCalledWith('player.gd', 5);
  // The header is one line: the hint is truncated on screen and whole in its tooltip.
  expect(screen.getByText('gameTuning.hint gameTuning.resetHint').getAttribute('title')).toBe('gameTuning.hint gameTuning.resetHint');
  expect(screen.getByRole('button', { name: 'gameTuning.rescan' })).toBeTruthy();
});

it('debounces a slider drag and resets to the panel default without invoking an agent', async () => {
  await mount();
  fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '240' } });
  fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '260' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(299); });
  expect(writes()).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(writes()).toHaveLength(1);
  expect(JSON.parse(String(writes()[0]![1]?.body))).toEqual({ id: 'speed', value: 260, fileHash: 'a'.repeat(64) });
  fireEvent.click(screen.getByRole('button', { name: 'gameTuning.resetTo' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(JSON.parse(String(writes()[1]![1]?.body))).toEqual({ id: 'speed', value: 220, fileHash: 'b'.repeat(64) });
  expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/chat'))).toBe(true);
});

it('serializes writes to properties in one file using the newest file hash', async () => {
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/game/run')) return response({ status: 'idle' });
    if (init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); return response({ parameter: { ...parameter, id: body.id, value: body.value, fileHash: 'b'.repeat(64) } }); }
    return response({ parameters: [parameter, { ...parameter, id: 'jump', key: 'jump', label: 'Jump' }], warnings: [] });
  });
  await mount();
  fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '240' } });
  fireEvent.change(screen.getByRole('slider', { name: 'Jump' }), { target: { value: '300' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(writes()).toHaveLength(2);
  expect(JSON.parse(String(writes()[1]![1]?.body)).fileHash).toBe('b'.repeat(64));
});

it('shows localized conflicts and stops pending writes instead of exposing raw backend English', async () => {
  await mount();
  fetchMock.mockImplementation(async () => response({ error: { code: 'TUNING_CONFLICT', message: 'Raw backend English' } }, 409));
  fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '240' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(screen.getByRole('alert').textContent).toContain('gameTuning.error.conflict');
  expect(screen.queryByText('Raw backend English')).toBeNull();
});

it('has actionable empty-state instructions and disables edits in a read-only workspace', async () => {
  fetchMock.mockImplementation(async (url) => String(url).endsWith('/game/run') ? response({ status: 'idle' }) : response({ parameters: [], warnings: [] }));
  await mount();
  expect(screen.getByText('gameTuning.emptyGodot')).toBeTruthy();
  expect(screen.getByText('gameTuning.emptyWeb')).toBeTruthy();
  expect(screen.getByText('gameTuning.askAgent')).toBeTruthy();
  cleanup();
  fetchMock.mockImplementation(async (url) => String(url).endsWith('/game/run') ? response({ status: 'idle' }) : response({ parameters: [parameter], warnings: [] }));
  await mount({ viewerOnly: true });
  expect((screen.getByRole('slider', { name: 'Speed' }) as HTMLInputElement).disabled).toBe(true);
});

it('flushes pending values and reloads the running game above instead of opening a second copy', async () => {
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/game/run')) return response({ status: 'running', engine: 'phaser', url: 'http://127.0.0.1:5199/' });
    if (init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); return response({ parameter: { ...parameter, value: body.value, fileHash: 'b'.repeat(64) } }); }
    return response({ parameters: [{ ...parameter, source: 'web-json' }], warnings: [] });
  });
  const reload = vi.fn();
  const { container } = await act(async () => render(<TuningPanel projectId="game" onOpenFile={vi.fn()} onReloadGame={reload} />));
  fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '240' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'gameTuning.applyRefresh' })); });
  expect(writes()).toHaveLength(1);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(container.querySelector('iframe')).toBeNull();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});

it('cancels a pending debounce when the project panel is unmounted', async () => {
  await mount();
  fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '240' } });
  cleanup();
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(writes()).toHaveLength(0);
});

it('lets a numeric field be cleared and typed as a negative value without losing the draft', async () => {
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/game/run')) return response({ status: 'idle' });
    if (init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); return response({ parameter: { ...parameter, value: body.value, fileHash: 'b'.repeat(64) } }); }
    return response({ parameters: [{ ...parameter, min: -800, max: -100, value: -460, defaultValue: -460 }], warnings: [] });
  });
  await mount();
  const field = screen.getByRole('spinbutton', { name: 'Speed' }) as HTMLInputElement;
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: '' } });
  expect(field.value).toBe('');
  fireEvent.change(field, { target: { value: '-300' } });
  fireEvent.blur(field);
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(writes()).toHaveLength(1);
  expect(JSON.parse(String(writes()[0]![1]?.body)).value).toBe(-300);
});

it('gives a float range without an explicit step a continuous slider', async () => {
  const { step: _step, ...withoutStep } = parameter;
  fetchMock.mockImplementation(async (url) => String(url).endsWith('/game/run') ? response({ status: 'idle' })
    : response({ parameters: [{ ...withoutStep, key: 'feedback_intensity', label: 'Feedback', min: 0, max: 1, value: 1, defaultValue: 1 }], warnings: [] }));
  await mount();
  expect((screen.getByRole('slider', { name: 'Feedback' }) as HTMLInputElement).step).toBe('0.01');
});

it('edits an HDR color as a literal without clipping it through an eight-bit picker', async () => {
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/game/run')) return response({ status: 'idle' });
    if (init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); return response({ parameter: { ...parameter, value: body.value, fileHash: 'b'.repeat(64) } }); }
    return response({ parameters: [{ ...parameter, type: 'color', label: 'Glow', value: 'Color(2.5, 1, 1, 1)', defaultValue: 'Color(2.5, 1, 1, 1)' }], warnings: [] });
  });
  await mount();
  const field = screen.getByRole('textbox', { name: 'Glow' });
  fireEvent.focus(field); fireEvent.change(field, { target: { value: 'Color(3, 1, 1, 1)' } }); fireEvent.blur(field);
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(writes()).toHaveLength(1);
  expect(JSON.parse(String(writes()[0]![1]?.body)).value).toBe('Color(3, 1, 1, 1)');
});


it('reloads restored values and cancels edits queued before a checkpoint restore', async () => {
  await mount();
  fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '260' } });
  await act(async () => { window.dispatchEvent(new CustomEvent('pixo:checkpoint-restored', { detail: { projectId: 'other' } })); });
  expect((screen.getByRole('slider', { name: 'Speed' }) as HTMLInputElement).value).toBe('260');
  await act(async () => { window.dispatchEvent(new CustomEvent('pixo:checkpoint-restored', { detail: { projectId: 'game' } })); });
  expect((screen.getByRole('slider', { name: 'Speed' }) as HTMLInputElement).value).toBe('220');
  expect((screen.getByRole('spinbutton', { name: 'Speed' }) as HTMLInputElement).value).toBe('220');
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(writes()).toHaveLength(0);
});

it('reloads tuning values when the window regains focus', async () => {
  await mount();
  fetchMock.mockImplementation(async url => String(url).endsWith('/game/run') ? response({ status: 'idle' })
    : response({ parameters: [{ ...parameter, value: 180, fileHash: 'c'.repeat(64) }], warnings: [] }));
  await act(async () => { fireEvent.focus(window); });
  expect((screen.getByRole('slider', { name: 'Speed' }) as HTMLInputElement).value).toBe('180');
});

it('uses optional localized parameter and group names with a source-label fallback', async () => {
  fetchMock.mockImplementation(async url => String(url).endsWith('/game/run') ? response({ status: 'idle' }) : response({ warnings: [], parameters: [
    { ...parameter, label_i18n: { 'zh-CN': '移动速度' }, group_i18n: { 'zh-CN': '角色' } },
    { ...parameter, id: 'jump', label: 'Jump', label_i18n: { en: 'Jump' } },
  ] }));
  await mount();
  expect(screen.getByRole('heading', { name: '角色' })).toBeTruthy();
  expect(screen.getByRole('slider', { name: '移动速度' })).toBeTruthy();
  expect(screen.getByRole('spinbutton', { name: '移动速度' })).toBeTruthy();
  expect(screen.getByRole('slider', { name: 'Jump' })).toBeTruthy();
});

it('finishes a pending slider edit before refreshing on focus', async () => {
  let current = { ...parameter };
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/game/run')) return response({ status: 'idle' });
    if (init?.method === 'PATCH') { current = { ...current, value: JSON.parse(String(init.body)).value, fileHash: 'd'.repeat(64) }; return response({ parameter: current }); }
    return response({ parameters: [current], warnings: [] });
  });
  await mount();
  fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '260' } });
  await act(async () => { fireEvent.focus(window); });
  expect(writes()).toHaveLength(1);
  expect((screen.getByRole('slider', { name: 'Speed' }) as HTMLInputElement).value).toBe('260');
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(writes()).toHaveLength(1);
});
