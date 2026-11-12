import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ files: new Map<string, string>(), read: vi.fn(), write: vi.fn(), mkdir: vi.fn(),
  getToken: vi.fn(), resolveBearer: vi.fn(), expired: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: state.read, writeFile: state.write, mkdir: state.mkdir, rename: vi.fn(), unlink: vi.fn() }));
vi.mock('../../src/integrations/xai-credentials.js', () => ({ resolveXAIBearer: state.resolveBearer }));
vi.mock('../../src/integrations/xai-tokens.js', () => ({ getXAIToken: state.getToken, isXAITokenExpired: state.expired }));
vi.mock('../../src/sandbox-mode.js', () => ({ isSandboxModeEnabled: () => true }));

import { readMaskedConfig } from '../../src/media/config.js';

beforeEach(() => {
  vi.clearAllMocks();
  state.files.clear();
  state.read.mockImplementation(async (file: string) => {
    const text = state.files.get(String(file));
    if (text !== undefined) return text;
    throw Object.assign(new Error('missing fixture'), { code: 'ENOENT' });
  });
  state.getToken.mockResolvedValue({ accessToken: 'private-access', refreshToken: 'private-refresh', expiresAt: 1 });
  state.expired.mockReturnValue(true);
  state.resolveBearer.mockRejectedValue(new Error('doctor must never refresh credentials'));
  for (const key of ['PIXO_MEDIA_CONFIG_DIR', 'PIXO_GROK_API_KEY', 'XAI_API_KEY', 'PIXO_MEDIA_MODEL_ALIASES']) vi.stubEnv(key, '');
  vi.stubEnv('PIXO_DATA_DIR', path.resolve('.tmp/unrelated-env-root'));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('doctor media configuration reads', () => {
  it('uses the daemon-resolved data root and cached OAuth without refreshing or writing', async () => {
    const dataDir = path.resolve('.tmp/doctor-config-fixture');
    const file = path.join(dataDir, 'media-config.json');
    state.files.set(file, JSON.stringify({ providers: { senseaudio: { apiKey: 'private-api-key' } }, aliases: { fixture: 'model' } }));
    const result = await readMaskedConfig(path.resolve('.tmp/unrelated-project'), { dataDir, refreshCredentials: false });
    expect(result.providers.senseaudio?.configured).toBe(true);
    expect(result.providers.grok?.configured).toBe(true);
    expect(result.aliases.stored).toEqual({ fixture: 'model' });
    expect(state.read.mock.calls.every(call => call[0] === file)).toBe(true);
    expect(state.getToken).toHaveBeenCalledWith(dataDir);
    expect(state.resolveBearer).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
    expect(state.mkdir).not.toHaveBeenCalled();
  });

  it('preserves the sanctioned media-only override when an explicit daemon root is supplied', async () => {
    const mediaDir = path.resolve('.tmp/doctor-media-override-fixture');
    vi.stubEnv('PIXO_MEDIA_CONFIG_DIR', mediaDir);
    const file = path.join(mediaDir, 'media-config.json');
    state.files.set(file, JSON.stringify({ providers: { elevenlabs: { apiKey: 'private-voice-key' } } }));
    const dataDir = path.resolve('.tmp/doctor-config-fixture');
    const result = await readMaskedConfig(path.resolve('.tmp/unrelated-project'), {
      dataDir, refreshCredentials: false,
    });
    expect(result.providers.elevenlabs?.configured).toBe(true);
    expect(state.read.mock.calls.every(call => call[0] === file)).toBe(true);
    expect(state.getToken).toHaveBeenCalledWith(dataDir);
    expect(state.resolveBearer).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
  });
});
