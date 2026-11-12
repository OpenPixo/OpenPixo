// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetGallery } from '../../../src/components/chat/AssetGallery';
import { AudioArtifact } from '../../../src/components/chat/AudioArtifact';
import { VideoArtifact } from '../../../src/components/chat/VideoArtifact';
import type { TurnAsset } from '../../../src/runtime/chat/turn-assets';
import { peaksToWave } from '../../../src/runtime/chat/audio-wave';

afterEach(cleanup);

const asset = (path: string, kind: TurnAsset['kind']): TurnAsset => ({ path, source: 'media', kind });
const gallery = (assets: TurnAsset[], onOpenFile = vi.fn()) => (
  <AssetGallery assets={assets} projectId="p" imageSrc={(path) => `/raw/${path}`} onOpenFile={onOpenFile} />
);

function audioElement(): HTMLAudioElement {
  return document.querySelector('audio') as HTMLAudioElement;
}

function loaded(duration: number): HTMLAudioElement {
  const el = audioElement();
  Object.defineProperty(el, 'duration', { configurable: true, value: duration });
  fireEvent.loadedMetadata(el);
  return el;
}

describe('AudioArtifact', () => {
  it('shows the name and the duration once it is known', () => {
    render(<AudioArtifact src="/raw/sfx/jump.wav" name="sfx/jump.wav" />);
    expect(screen.getByText('jump.wav')).toBeInTheDocument();
    loaded(65);
    expect(screen.getByTestId('chat-audio-artifact')).toHaveTextContent('1:05');
  });

  it('seeks from the keyboard, inside the track', () => {
    render(<AudioArtifact src="/raw/a.wav" name="a.wav" />);
    const el = loaded(20);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuemax', '20');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(el.currentTime).toBe(5);
    expect(slider).toHaveAttribute('aria-valuenow', '5');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(el.currentTime).toBe(20);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(el.currentTime).toBe(20);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(el.currentTime).toBe(0);
  });

  it('seeks to where the waveform was pressed', () => {
    render(<AudioArtifact src="/raw/a.wav" name="a.wav" />);
    const el = loaded(100);
    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () => ({ left: 10, width: 200, top: 0, right: 210, bottom: 30, height: 30, x: 10, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(slider, { clientX: 60, pointerId: 1 });
    expect(el.currentTime).toBe(25);
  });

  it('says so when it cannot play, instead of leaving a waveform that does nothing', () => {
    render(<AudioArtifact src="/raw/missing.wav" name="missing.wav" />);
    fireEvent.error(audioElement());
    expect(screen.getByRole('status')).toHaveTextContent('Could not play this');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(screen.getByText('missing.wav')).toBeInTheDocument();
  });

  it('opens its file from the name', () => {
    const onOpenFile = vi.fn();
    render(<AudioArtifact src="/raw/a.wav" name="sfx/a.wav" onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText('a.wav'));
    expect(onOpenFile).toHaveBeenCalled();
  });
});

describe('peaksToWave', () => {
  it('follows the loudness of the audio within the bar range', () => {
    const samples = Array.from({ length: 400 }, (_, i) => (i < 200 ? 0.1 : -1));
    const wave = peaksToWave(samples, 4);
    expect(wave).toHaveLength(4);
    expect(wave[0]).toBeLessThan(wave[3]!);
    expect(Math.max(...wave)).toBe(43);
    expect(Math.min(...wave)).toBeGreaterThanOrEqual(3);
  });

  it('draws silence as a flat line, not amplified noise', () => {
    expect(new Set(peaksToWave(new Float32Array(100), 4))).toEqual(new Set([3]));
  });
});

describe('VideoArtifact', () => {
  it('plays inline, starting from its first frame as the cover', () => {
    render(<VideoArtifact src="/raw/intro.mp4" name="video/intro.mp4" />);
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('/raw/intro.mp4#t=0.1');
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(screen.getByText('intro.mp4')).toBeInTheDocument();
  });

  it('says so when the file is gone', () => {
    render(<VideoArtifact src="/raw/gone.mp4" name="gone.mp4" />);
    fireEvent.error(document.querySelector('video')!);
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Could not play this');
  });
});

describe('AssetGallery', () => {
  it('draws each kind with its own player', () => {
    render(gallery([asset('art/a.png', 'image'), asset('a.wav', 'audio'), asset('a.mp4', 'video')]));
    expect(screen.getByTestId('chat-asset-art/a.png')).toBeInTheDocument();
    expect(screen.getByTestId('chat-audio-artifact')).toBeInTheDocument();
    expect(screen.getByTestId('chat-video-artifact')).toBeInTheDocument();
  });

  it('shows a clear state for an image that will not load, not a broken picture', () => {
    render(gallery([asset('art/gone.png', 'image')]));
    const tile = screen.getByTestId('chat-asset-art/gone.png');
    fireEvent.error(tile.querySelector('img')!);
    expect(tile).toBeDisabled();
    expect(tile).toHaveAttribute('data-failed', 'true');
    expect(tile.querySelector('img')).not.toBeVisible();
    expect(tile).toHaveTextContent('gone.png');
    expect(tile).toHaveTextContent('Could not load');
  });

  it('enlarges an image, sharp when it is pixel art, and opens the file it came from', () => {
    const onOpenFile = vi.fn();
    render(gallery([asset('art/hero.png', 'image')], onOpenFile));
    fireEvent.click(screen.getByTestId('chat-asset-art/hero.png'));
    const viewer = screen.getByTestId('chat-asset-viewer');
    const image = within(viewer).getByRole('img', { name: 'art/hero.png' }) as HTMLImageElement;
    Object.defineProperty(image, 'naturalWidth', { value: 32 });
    Object.defineProperty(image, 'naturalHeight', { value: 32 });
    fireEvent.load(image);
    expect(viewer).toHaveTextContent('32 × 32');
    expect(image.className).toMatch(/pixel/);
    fireEvent.click(within(viewer).getByRole('button', { name: 'Open in files' }));
    expect(onOpenFile).toHaveBeenCalledWith('art/hero.png');
  });

  it('says so when the enlarged image cannot load', () => {
    render(gallery([asset('art/hero.png', 'image')]));
    fireEvent.click(screen.getByTestId('chat-asset-art/hero.png'));
    const viewer = screen.getByTestId('chat-asset-viewer');
    fireEvent.error(within(viewer).getByRole('img', { name: 'art/hero.png' }));
    expect(within(viewer).getByRole('status')).toHaveTextContent('could not be loaded');
  });

  it('keeps a turn that wrote hundreds of files from flooding the chat', () => {
    const many = Array.from({ length: 40 }, (_, index) => asset(`art/${index}.png`, 'image'));
    render(gallery(many));
    expect(screen.getByTestId('chat-asset-art/23.png')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-asset-art/24.png')).toBeNull();
    expect(screen.getByText('16 more in Changes and Files')).toBeInTheDocument();
  });
});
