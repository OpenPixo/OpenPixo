// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { accountErrorMessage } from '../../src/components/account/account-format';
import { studioRunErrorMessage } from '../../src/components/studio/RecipeRunner';
import { HostedImageCard } from '../../src/components/studio/HostedImageCard';
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

describe('the credits card when generation opens', () => {
  const service = { id: 'openpixo-image', surface: 'image', label: 'Flare', credits: 4, priceVersion: 2, maxPromptChars: 12000, aspects: ['1:1'], styles: [], references: { min: 0, max: 0 },
    pricing: { longPromptTokens: 2000, longPromptCredits: 1, maxPromptTokens: 3000, extraReferenceCredits: 1 } };
  function api(paused: { value: boolean }) {
    const request = vi.fn(async (url: string) => {
      const path = new URL(url, 'http://localhost').pathname;
      if (path === '/api/openpixo/account') return Response.json({ availability: 'available', signedIn: true,
        user: { id: 'u1', email: 'dev@example.com', provider: 'email', displayName: 'Dev', avatarUrl: null } });
      if (path === '/api/openpixo/credits') return Response.json({ available: 40, reserved: 0, subscription: null });
      if (path === '/api/openpixo/cloud-media/services') return Response.json({ services: [service], generationPaused: paused.value });
      return Response.json({});
    });
    vi.stubGlobal('fetch', request);
    return request;
  }
  const show = () => render(<HostedImageCard projectId="p1" onSaved={async () => {}} onOpenFile={() => {}} />);

  it('notices when the window regains focus', async () => {
    const paused = { value: true };
    api(paused);
    show();
    const card = within(await screen.findByTestId('studio-hosted-image'));
    expect(card.queryByRole('textbox', { name: 'Prompt' })).toBeNull();
    paused.value = false;
    fireEvent(window, new Event('focus'));
    expect(await card.findByRole('textbox', { name: 'Prompt' })).toBeTruthy();
  });

  it('checks again on its own while generation is off, and stops once it opens', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const paused = { value: true };
    const request = api(paused);
    show();
    const card = within(await screen.findByTestId('studio-hosted-image'));
    expect(card.queryByRole('textbox', { name: 'Prompt' })).toBeNull();
    const checks = () => request.mock.calls.filter(call => String(call[0]).includes('cloud-media/services')).length;
    paused.value = false;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await card.findByRole('textbox', { name: 'Prompt' });
    const afterOpen = checks();
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(checks()).toBe(afterOpen);
  });

  it('keeps the card on screen when a recheck fails', async () => {
    const paused = { value: true };
    const request = api(paused);
    show();
    await screen.findByTestId('studio-hosted-image');
    request.mockImplementation(async () => { throw new TypeError('offline'); });
    await act(async () => { fireEvent(window, new Event('focus')); await Promise.resolve(); });
    expect(screen.getByTestId('studio-hosted-image')).toBeTruthy();
  });
});
