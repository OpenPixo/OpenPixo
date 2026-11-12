import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaskedConfigResponse } from '../../src/media/config.js';

const readMaskedConfig = vi.hoisted(() => vi.fn<(root: string, options: unknown) => Promise<Pick<MaskedConfigResponse, 'providers'>>>());
vi.mock('../../src/media/config.js', () => ({ readMaskedConfig }));

const { runMediaExecutionForPrompt } = await import('../../src/game/media-contract.js');
const { composeGameSystemPrompt } = await import('../../src/game/prompt.js');

const provider = (over = {}) => ({ configured: false, source: 'unset', apiKeyTail: '', baseUrl: '', ...over });

describe('the media policy a run prompt is composed from', () => {
  let stubs: string | undefined;
  beforeEach(() => {
    stubs = process.env.PIXO_MEDIA_ALLOW_STUBS;
    delete process.env.PIXO_MEDIA_ALLOW_STUBS;
    readMaskedConfig.mockReset();
  });
  afterEach(() => {
    if (stubs === undefined) delete process.env.PIXO_MEDIA_ALLOW_STUBS;
    else process.env.PIXO_MEDIA_ALLOW_STUBS = stubs;
  });

  // The owner's session: Codex signed in with ChatGPT, no API key, no OpenPixo account.
  it('with only a Codex sign-in, the agent is told to use Codex, not the hosted model', async () => {
    readMaskedConfig.mockResolvedValue({ providers: { 'codex-cli': provider({ available: true, keyless: true }), openpixo: provider() } });
    const mediaExecution = await runMediaExecutionForPrompt(undefined, '/root');
    const prompt = composeGameSystemPrompt({ baseDir: '/game', mediaExecution });
    expect(prompt).toContain('- image: `codex-image`');
    expect(prompt).toContain('otherwise `codex-image`');
    expect(prompt).not.toContain('`openpixo-image');
    expect(prompt).not.toContain('`gpt-image-2`');
    // A run about to start must not spend seconds probing the CLI.
    expect(readMaskedConfig).toHaveBeenCalledWith('/root', expect.objectContaining({ cachedAgentDetection: true, refreshCredentials: false }));
  });

  it('with an art budget that can pay, hosted images are offered after own tools', async () => {
    readMaskedConfig.mockResolvedValue({ providers: { 'codex-cli': provider({ available: true, keyless: true }), openpixo: provider() } });
    const prompt = composeGameSystemPrompt({ baseDir: '/game', mediaExecution: await runMediaExecutionForPrompt(undefined, '/root', true) });
    expect(prompt).toContain('- image: `codex-image`, `openpixo-image`, `openpixo-image-edit`');
    expect(prompt).toContain('otherwise `codex-image`');
  });

  it('with only credits and an art budget, the agent is told to use them', async () => {
    readMaskedConfig.mockResolvedValue({ providers: { 'codex-cli': provider({ available: false, keyless: true }) } });
    const prompt = composeGameSystemPrompt({ baseDir: '/game', mediaExecution: await runMediaExecutionForPrompt(undefined, '/root', true) });
    expect(prompt).toContain('otherwise `openpixo-image`');
    expect(prompt).not.toContain('No image model can run right now');
  });

  // The owner's request: a Claude Code run with Codex signed in used Codex images even
  // when the user wanted another model. The Settings pick reaches every run, BYOK or not.
  it('a non-BYOK run uses the image model picked in Settings, and falls back when it cannot run', async () => {
    readMaskedConfig.mockResolvedValue({ providers: { 'codex-cli': provider({ available: true, keyless: true }), openai: provider({ configured: true }) } });
    const mediaExecution = await runMediaExecutionForPrompt(undefined, '/root');
    const picked = composeGameSystemPrompt({ baseDir: '/game', agentId: 'claude', mediaExecution, agentImageModel: 'gpt-image-2' });
    expect(picked).toContain('otherwise `gpt-image-2`, the image model the user picked in Settings');
    const automatic = composeGameSystemPrompt({ baseDir: '/game', agentId: 'claude', mediaExecution });
    expect(automatic).toContain('otherwise `codex-image`.');
    const unusable = composeGameSystemPrompt({ baseDir: '/game', agentId: 'claude', mediaExecution, agentImageModel: 'grok-imagine-image' });
    expect(unusable).toContain('otherwise `codex-image`.');
    expect(unusable).toContain('The user picked `grok-imagine-image` in Settings as the image model, but it cannot run in this run');
  });

  it('a disabled run stays disabled, whatever the budget', async () => {
    expect(await runMediaExecutionForPrompt({ mode: 'disabled' }, '/root', true)).toEqual({ mode: 'disabled' });
  });

  it('with nothing connected, the agent is told not to try', async () => {
    readMaskedConfig.mockResolvedValue({ providers: { 'codex-cli': provider({ available: false, keyless: true }) } });
    const prompt = composeGameSystemPrompt({ baseDir: '/game', mediaExecution: await runMediaExecutionForPrompt(undefined, '/root') });
    expect(prompt).toContain('No image model can run right now');
  });

  it('keeps the run policy, and a disabled run needs no probe', async () => {
    readMaskedConfig.mockResolvedValue({ providers: {} });
    expect(await runMediaExecutionForPrompt({ mode: 'enabled', allowedModels: ['codex-image'] }, '/root'))
      .toEqual({ mode: 'enabled', allowedModels: ['codex-image'], usableProviders: [] });
    readMaskedConfig.mockClear();
    expect(await runMediaExecutionForPrompt({ mode: 'disabled' }, '/root')).toEqual({ mode: 'disabled' });
    expect(readMaskedConfig).not.toHaveBeenCalled();
  });

  it('does not claim nothing works when it could not find out, or when stubs stand in', async () => {
    readMaskedConfig.mockRejectedValue(new Error('unreadable'));
    expect(await runMediaExecutionForPrompt(undefined, '/root')).toBeUndefined();
    process.env.PIXO_MEDIA_ALLOW_STUBS = '1';
    readMaskedConfig.mockClear();
    expect(await runMediaExecutionForPrompt(undefined, '/root')).toBeUndefined();
    expect(readMaskedConfig).not.toHaveBeenCalled();
  });
});
