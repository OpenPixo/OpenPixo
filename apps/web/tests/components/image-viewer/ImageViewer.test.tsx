// @vitest-environment jsdom
import type { ProjectFile } from '@openpixo/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from '../../../src/components/image-viewer/ImageViewer';

vi.mock('../../../src/components/image-editor/ImageEditorDialog', () => ({
  ImageEditorDialog: ({ asset }: { asset: { relPath: string; width?: number } }) => (
    <div data-testid="editor">{`${asset.relPath} ${asset.width}`}</div>
  ),
}));

const file: ProjectFile = {
  name: 'sprites/walk_2.png', size: 2048, mtime: 1, kind: 'image', mime: 'image/png',
};
const names = ['sprites/walk_1.png', 'sprites/walk_2.png', 'sprites/walk_10.png', 'cover.png'];

class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([{ contentRect: { width: 848, height: 648 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  disconnect() {}
  unobserve() {}
}

function loadImage(width: number, height: number) {
  const image = screen.getByRole('img') as HTMLImageElement;
  Object.defineProperty(image, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: height, configurable: true });
  fireEvent.load(image);
  return image;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  // jsdom has no canvas; colour sampling must degrade quietly.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ImageViewer', () => {
  it('fits a small sprite at a whole-number zoom with sharp pixels and shows its size', () => {
    render(<ImageViewer projectId="p1" file={file} />);
    const image = loadImage(16, 16);
    expect(screen.getByText(/16 × 16 px/)).toBeTruthy();
    expect(screen.getByLabelText('Zoom level').textContent).toBe('3700%');
    expect(image.style.width).toBe('592px');
    expect(image.className).toMatch(/pixelated/);
  });

  it('zooms by stops and returns to fit and actual size', () => {
    render(<ImageViewer projectId="p1" file={file} />);
    loadImage(1600, 600);
    const zoom = screen.getByLabelText('Zoom level');
    expect(zoom.textContent).toBe('50%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoom.textContent).toBe('75%');
    fireEvent.click(screen.getByTitle('Actual size, 100% (1)'));
    expect(zoom.textContent).toBe('100%');
    fireEvent.keyDown(screen.getByTestId('image-viewer-viewport'), { key: '0' });
    expect(zoom.textContent).toBe('50%');
  });

  it('steps through the folder with buttons and arrow keys', () => {
    const onStep = vi.fn();
    render(<ImageViewer projectId="p1" file={file} fileNames={names} onStep={onStep} />);
    expect(screen.getByText('2 / 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next image (→)' }));
    expect(onStep).toHaveBeenLastCalledWith('sprites/walk_10.png');
    fireEvent.keyDown(screen.getByTestId('image-viewer-viewport'), { key: 'ArrowLeft' });
    expect(onStep).toHaveBeenLastCalledWith('sprites/walk_1.png');
  });

  it('opens the editor on this file, and offers no edit to a read-only viewer', () => {
    const { unmount } = render(<ImageViewer projectId="p1" file={file} />);
    loadImage(16, 16);
    fireEvent.click(screen.getByTestId('image-viewer-edit'));
    expect(screen.getByTestId('editor').textContent).toBe('sprites/walk_2.png 16');
    unmount();

    render(<ImageViewer projectId="p1" file={file} viewerOnly />);
    loadImage(16, 16);
    expect(screen.queryByTestId('image-viewer-edit')).toBeNull();
  });

  it('says so when the image cannot be decoded', () => {
    render(<ImageViewer projectId="p1" file={file} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('This image could not be shown.')).toBeTruthy();
  });
});
