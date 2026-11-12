// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssetProcessingDialog } from '../../../src/components/assets/AssetProcessingDialog';
import { I18nProvider } from '../../../src/i18n';
const api = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock('../../../src/providers/project-assets', () => ({ processProjectAssets: api.process }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('exports equal-size frames with engine format and animation settings through the shared operation API', async () => {
  api.process.mockReturnValue(new Promise<never>(() => {}));
  render(<I18nProvider initial="en"><AssetProcessingDialog projectId="game" paths={['1.png', '2.png', '3.png', '4.png']}
    onClose={vi.fn()} onProcessed={vi.fn()} /></I18nProvider>);
  expect(screen.getByRole('option', { name: 'Export sprite sheet' })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Operation' }), { target: { value: 'export-spritesheet' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Columns' }), { target: { value: '2' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Output format' }), { target: { value: 'godot-spriteframes' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Playback' }), { target: { value: 'false' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Animation names (one per row, comma-separated)' }), { target: { value: 'idle,run' } });
  fireEvent.submit(screen.getByRole('combobox', { name: 'Operation' }).closest('form')!);
  await waitFor(() => expect(api.process).toHaveBeenCalledWith('game', {
    op: 'export-spritesheet', inputs: ['1.png', '2.png', '3.png', '4.png'],
    params: { columns: 2, fps: 8, format: 'godot-spriteframes', name: 'spritesheet', animations: 'idle,run', loop: false },
  }));
});

it.each([['godot', 'godot-spriteframes'], ['phaser', 'phaser-atlas'], ['unknown', 'aseprite-json']])('defaults export format from the project engine %s', async (engine, format) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ profile: { engine } })));
  render(<I18nProvider initial="en"><AssetProcessingDialog projectId="game" paths={['1.png']} onClose={vi.fn()} onProcessed={vi.fn()} /></I18nProvider>);
  fireEvent.change(screen.getByRole('combobox', { name: 'Operation' }), { target: { value: 'export-spritesheet' } });
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Output format' }) as HTMLSelectElement).value).toBe(format));
});
it('can apply the extracted palette to a derived image', async () => {
  render(<I18nProvider initial="en"><AssetProcessingDialog projectId="game" paths={['1.png']} onClose={vi.fn()} onProcessed={vi.fn()} /></I18nProvider>);
  fireEvent.change(screen.getByRole('combobox', { name: 'Operation' }), { target: { value: 'palette' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Apply palette to image' }));
  fireEvent.submit(screen.getByRole('combobox', { name: 'Operation' }).closest('form')!);
  await waitFor(() => expect(api.process).toHaveBeenCalledWith('game', expect.objectContaining({ params: { colors: 16, apply: true } })));
});

it('checks animation frames in name order and shows the drift in plain words', async () => {
  api.process.mockResolvedValue({ op: 'frames-check', params: {}, tool: 'sharp', dryRun: false, originalsPreserved: true,
    counts: { succeeded: 3, failed: 0, skipped: 0 }, results: [],
    summary: { frames: 3, sameCanvas: true, emptyFrames: [3], edgeFrames: [], baselineSpreadPx: 6, feetXSpreadPx: 2, heightDriftPercent: 4,
      widthDriftPercent: 0, issues: ['Frame 3 is empty.'], ok: false } });
  render(<I18nProvider initial="en"><AssetProcessingDialog projectId="game" paths={['run-10.png', 'run-2.png', 'run-1.png']}
    onClose={vi.fn()} onProcessed={vi.fn(async () => {})} /></I18nProvider>);
  fireEvent.change(screen.getByRole('combobox', { name: 'Operation' }), { target: { value: 'frames-check' } });
  fireEvent.submit(screen.getByRole('combobox', { name: 'Operation' }).closest('form')!);
  await waitFor(() => expect(api.process).toHaveBeenCalledWith('game', { op: 'frames-check', inputs: ['run-1.png', 'run-2.png', 'run-10.png'], params: {} }));
  expect(await screen.findByText('Feet move 6 px up and down and 2 px sideways; height changes 4%.')).toBeTruthy();
  expect(screen.getByText('Empty frames: 3')).toBeTruthy();
  expect(screen.getByText('Frame 3 is empty.')).toBeTruthy();
});

it('aligns frames on one canvas with the chosen options', async () => {
  api.process.mockReturnValue(new Promise<never>(() => {}));
  render(<I18nProvider initial="en"><AssetProcessingDialog projectId="game" paths={['b.png', 'a.png']} onClose={vi.fn()} onProcessed={vi.fn()} /></I18nProvider>);
  fireEvent.change(screen.getByRole('combobox', { name: 'Operation' }), { target: { value: 'frames-align' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Canvas, WxH (optional)' }), { target: { value: '64x64' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Even out height drift' }));
  fireEvent.submit(screen.getByRole('combobox', { name: 'Operation' }).closest('form')!);
  await waitFor(() => expect(api.process).toHaveBeenCalledWith('game', { op: 'frames-align', inputs: ['a.png', 'b.png'],
    params: { canvas: '64x64', padding: 0, matchHeight: true, filter: 'lanczos' } }));
});
