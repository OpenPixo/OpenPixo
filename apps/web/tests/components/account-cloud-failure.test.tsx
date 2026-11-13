// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { accountErrorMessage } from '../../src/components/account/account-format';
import { studioRunErrorMessage } from '../../src/components/studio/RecipeRunner';
import { resetStudioCacheForTests } from '../../src/components/studio/studio-cache';
import { resetOpenPixoAccountStoreForTests } from '../../src/hooks/useOpenPixoAccount';
import { fetchOpenPixoCredits, OpenPixoAccountRequestError } from '../../src/providers/openpixo-account';
import { quoteCloudMedia } from '../../src/providers/openpixo-cloud-media';
import { StudioRequestError } from '../../src/providers/studio';

beforeEach(resetStudioCacheForTests);
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); resetOpenPixoAccountStoreForTests(); });

const t = ((key: string) => key) as Parameters<typeof accountErrorMessage>[1];
const failing = (reason?: string) => vi.stubGlobal('fetch', vi.fn(async () => Response.json(
  { error: { code: 'CLOUD_UNAVAILABLE', message: 'Failed.', ...(reason ? { reason } : {}) } }, { status: 503 })));
const caught = async (run: () => Promise<unknown>) => { try { await run(); } catch (error) { return error; } throw new Error('expected a failure'); };

describe('account failure messages', () => {
  it('blames the connection only when the cloud could not be reached', async () => {
    failing();
    expect(accountErrorMessage(await caught(() => fetchOpenPixoCredits()), t)).toBe('account.error.cloudUnavailable');
  });

  it('says the service failed when the cloud answered with a failure', async () => {
    failing('service');
    expect(accountErrorMessage(await caught(() => fetchOpenPixoCredits()), t)).toBe('account.error.cloudService');
  });

  it('keeps the reason on hosted generation requests too', async () => {
    failing('service');
    const error = await caught(() => quoteCloudMedia('p1', 'openpixo-image', { prompt: 'x', aspect: '1:1' }, []));
    expect(error).toBeInstanceOf(OpenPixoAccountRequestError);
    expect(accountErrorMessage(error, t)).toBe('account.error.cloudService');
  });
});

describe('recipe run failures', () => {
  const codex = (code: string) => `codex:${code}`;
  it('shows what the daemon said went wrong', () => {
    expect(studioRunErrorMessage(new StudioRequestError('Input "items" is required', 'RECIPE_INVALID'), 'generic', codex)).toBe('Input "items" is required');
  });
  it('keeps the Codex wording for Codex failures', () => {
    expect(studioRunErrorMessage(new StudioRequestError('raw', 'CODEX_NOT_INSTALLED'), 'generic', codex)).toBe('codex:CODEX_NOT_INSTALLED');
  });
  it('falls back when there is nothing useful to show', () => {
    expect(studioRunErrorMessage(new StudioRequestError('HTTP 500'), 'generic', codex)).toBe('generic');
    expect(studioRunErrorMessage(new Error('socket hang up'), 'generic', codex)).toBe('generic');
  });
});
