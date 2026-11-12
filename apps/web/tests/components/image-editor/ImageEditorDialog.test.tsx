// @vitest-environment jsdom
import type { ProjectAsset } from '@openpixo/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageEditorDialog } from '../../../src/components/image-editor/ImageEditorDialog';
import { editProjectImage } from '../../../src/providers/project-assets';

vi.mock('../../../src/providers/project-assets', () => ({ editProjectImage: vi.fn() }));
vi.mock('../../../src/providers/registry', () => ({
  projectRawUrl: (projectId: string, path: string) => `/api/projects/${projectId}/raw/${path}`,
}));

const source: ProjectAsset = {
  projectId: 'project-1', relPath: 'Sprites/hero.png', kind: 'image', mime: 'image/png',
  size: 128, mtime: 1, width: 16, height: 12, semantics: [], tags: [], indexedAt: 1, origin: 'imported',
};
const result: ProjectAsset = { ...source, relPath: 'Sprites/hero_detail.png', width: 6, height: 4, origin: 'processed' };

class FixtureImage {
  naturalWidth = 16;
  naturalHeight = 12;
  width = 16;
  height = 12;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
}

function renderEditor() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<ImageEditorDialog asset={source} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}

function numberInput(name: string) {
  return screen.getByRole('spinbutton', { name });
}

function changeCrop(x: number, y: number, width: number, height: number) {
  fireEvent.change(numberInput('Crop width'), { target: { value: String(width) } });
  fireEvent.change(numberInput('Crop height'), { target: { value: String(height) } });
  fireEvent.change(numberInput('Crop X'), { target: { value: String(x) } });
  fireEvent.change(numberInput('Crop Y'), { target: { value: String(y) } });
}

beforeEach(() => {
  vi.stubGlobal('Image', FixtureImage);
  vi.stubGlobal('PointerEvent', MouseEvent);
  const context = {
    clearRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(),
    translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(), setTransform: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      width, height, data: new Uint8ClampedArray(width * height * 4).fill(255),
    })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.mocked(editProjectImage).mockResolvedValue(result);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('project image editor', () => {
  it('updates the crop from exact numeric inputs and nudges it with arrow keys', async () => {
    renderEditor();
    await waitFor(() => expect(numberInput('Crop X')).toBeEnabled());
    expect(numberInput('Crop width')).toHaveValue(16);
    expect(numberInput('Crop height')).toHaveValue(12);
    expect(screen.getByLabelText('Result size')).toHaveTextContent('16 × 12 px');
    changeCrop(2, 3, 6, 4);
    expect(screen.getByText('6 × 4 px')).toBeInTheDocument();
    const selection = screen.getByRole('region', { name: 'Crop selection' });
    fireEvent.keyDown(selection, { key: 'ArrowRight' });
    fireEvent.keyDown(selection, { key: 'ArrowDown' });
    expect(numberInput('Crop X')).toHaveValue(3);
    expect(numberInput('Crop Y')).toHaveValue(4);
    expect(numberInput('Crop width')).toHaveValue(6);
    expect(numberInput('Crop height')).toHaveValue(4);
  });

  it('resizes the crop using its drag handle in source pixel coordinates', async () => {
    renderEditor();
    await waitFor(() => expect(numberInput('Crop X')).toBeEnabled());
    const handle = screen.getByRole('button', { name: 'Resize crop bottom right' });
    const selection = screen.getByRole('region', { name: 'Crop selection' });
    changeCrop(0, 0, 8, 6);
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '200' } });
    fireEvent.pointerDown(handle, { clientX: 16, clientY: 12, pointerId: 1, button: 0 });
    fireEvent.pointerMove(selection, { clientX: 24, clientY: 18, pointerId: 1 });
    fireEvent.pointerUp(selection, { clientX: 24, clientY: 18, pointerId: 1 });
    expect(numberInput('Crop width')).toHaveValue(12);
    expect(numberInput('Crop height')).toHaveValue(9);
    expect(screen.getByText('12 × 9 px')).toBeInTheDocument();
  });

  it('saves the pending crop with the editable output name and returns the derived asset', async () => {
    const { onSaved } = renderEditor();
    await waitFor(() => expect(numberInput('Crop X')).toBeEnabled());
    changeCrop(2, 3, 6, 4);
    fireEvent.change(screen.getByRole('textbox', { name: 'Output name' }), { target: { value: 'hero_detail.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as new file' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(result));
    expect(editProjectImage).toHaveBeenCalledExactlyOnceWith('project-1', {
      source: 'Sprites/hero.png', output: 'hero_detail.png',
      ops: [{ op: 'crop', x: 2, y: 3, width: 6, height: 4 }],
    });
  });

  it('applies tools in order and shows the dimensions after rotation', async () => {
    renderEditor();
    await waitFor(() => expect(numberInput('Crop X')).toBeEnabled());
    changeCrop(2, 3, 6, 4);
    fireEvent.click(screen.getByRole('button', { name: 'Apply tool' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90°' }));
    expect(screen.getByText('4 × 6 px')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save as new file' }));
    await waitFor(() => expect(editProjectImage).toHaveBeenCalledOnce());
    expect(vi.mocked(editProjectImage).mock.calls[0]?.[1].ops).toEqual([
      { op: 'crop', x: 2, y: 3, width: 6, height: 4 },
      { op: 'rotate', degrees: 90 },
    ]);
  });

  it('saves with Enter while a crop handle has keyboard focus', async () => {
    const { onSaved } = renderEditor();
    await waitFor(() => expect(numberInput('Crop X')).toBeEnabled());
    changeCrop(0, 0, 8, 6);
    const handle = screen.getByRole('button', { name: 'Resize crop bottom right' });
    handle.focus();
    fireEvent.keyDown(handle, { key: 'Enter' });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(result));
    expect(editProjectImage).toHaveBeenCalledOnce();
  });

  it('keeps a failed save open and shows the error inline for retry', async () => {
    vi.mocked(editProjectImage).mockRejectedValueOnce(new Error('The output already exists'));
    const { onSaved, onClose } = renderEditor();
    await waitFor(() => expect(numberInput('Crop X')).toBeEnabled());
    changeCrop(0, 0, 8, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Save as new file' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The output already exists');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save as new file' })).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Output name' }), { target: { value: 'hero_retry.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as new file' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(result));
  });

  it('keeps a fixed crop ratio while editing dimensions and dragging a corner', async () => {
    renderEditor();
    await waitFor(() => expect(numberInput('Crop X')).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox', { name: 'Crop aspect ratio' }), { target: { value: '1:1' } });
    fireEvent.change(numberInput('Crop width'), { target: { value: '8' } });
    expect(numberInput('Crop height')).toHaveValue(8);
    const selection = screen.getByRole('region', { name: 'Crop selection' });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize crop bottom right' }), { clientX: 8, clientY: 8, button: 0 });
    fireEvent.pointerMove(selection, { clientX: 12, clientY: 10 });
    fireEvent.pointerUp(selection);
    expect(numberInput('Crop width')).toHaveValue(12);
    expect(numberInput('Crop height')).toHaveValue(12);
    expect(screen.getByLabelText('Result size')).toHaveTextContent('12 × 12 px');
  });

  it('locks resize dimensions, allows independent dimensions, and saves percent with nearest resampling', async () => {
    renderEditor();
    await waitFor(() => expect(numberInput('Crop X')).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Resize' }));
    expect(screen.getByRole('checkbox', { name: 'Lock aspect ratio' })).toBeChecked();
    fireEvent.change(numberInput('Resize width'), { target: { value: '8' } });
    expect(numberInput('Resize height')).toHaveValue(6);
    expect(screen.getByLabelText('Result size')).toHaveTextContent('8 × 6 px');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lock aspect ratio' }));
    fireEvent.change(numberInput('Resize height'), { target: { value: '10' } });
    expect(numberInput('Resize width')).toHaveValue(8);
    expect(screen.getByLabelText('Result size')).toHaveTextContent('8 × 10 px');
    fireEvent.change(screen.getByRole('combobox', { name: 'Resize by' }), { target: { value: 'percent' } });
    fireEvent.change(numberInput('Resize percent'), { target: { value: '50' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Resize method' }), { target: { value: 'smooth' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Resize method' }), { target: { value: 'nearest' } });
    expect(screen.getByLabelText('Result size')).toHaveTextContent('8 × 6 px');
    fireEvent.click(screen.getByRole('button', { name: 'Save as new file' }));
    await waitFor(() => expect(editProjectImage).toHaveBeenCalledOnce());
    expect(vi.mocked(editProjectImage).mock.calls[0]?.[1]).toEqual({
      source: 'Sprites/hero.png', output: 'hero_resize.png', ops: [{ op: 'resize', scale: 0.5, filter: 'nearest' }],
    });
  });

  it('previews and saves padding to the next power of two', async () => {
    renderEditor();
    await waitFor(() => expect(numberInput('Crop X')).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Pad canvas' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pad to power of two' }));
    expect(screen.getByLabelText('Result size')).toHaveTextContent('16 × 16 px');
    expect(screen.queryByRole('spinbutton', { name: 'Pad width' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save as new file' }));
    await waitFor(() => expect(editProjectImage).toHaveBeenCalledOnce());
    expect(vi.mocked(editProjectImage).mock.calls[0]?.[1].ops).toEqual([{ op: 'pad', powerOfTwo: true }]);
  });

  it('cancels with Escape without saving', async () => {
    const { onClose, onSaved } = renderEditor();
    await waitFor(() => expect(numberInput('Crop X')).toBeEnabled());
    changeCrop(0, 0, 8, 6);
    vi.useFakeTimers();
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(140));
    vi.useRealTimers();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled();
    expect(editProjectImage).not.toHaveBeenCalled();
  });
});



