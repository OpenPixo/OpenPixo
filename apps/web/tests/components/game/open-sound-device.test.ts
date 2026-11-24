// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { openSoundDevice } from '../../../src/components/game/open-sound-device';

afterEach(() => { vi.unstubAllGlobals(); });

function browser(play: () => Promise<void>) {
  const context = vi.fn();
  const sounds: string[] = [];
  vi.stubGlobal('AudioContext', context);
  vi.stubGlobal('Audio', class { constructor(source: string) { sounds.push(source); } play = play; });
  return { context, sounds };
}

it('plays a moment of nothing, without the audio context that would hold up the page', async () => {
  const { context, sounds } = browser(async () => {});
  openSoundDevice();
  expect(sounds).toHaveLength(1);
  const bytes = atob(sounds[0]!.split(',')[1]!);
  expect([bytes.slice(0, 4), bytes.slice(8, 12), bytes.slice(36, 40), bytes.slice(40)]).toEqual(['RIFF', 'WAVE', 'data', '\0\0\0\0']);
  expect(context).not.toHaveBeenCalled();
});

it('does not mind a computer without sound', async () => {
  browser(async () => { throw new DOMException('no device', 'NotSupportedError'); });
  openSoundDevice();
  await new Promise(resolve => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
  expect(() => openSoundDevice()).not.toThrow();
});
