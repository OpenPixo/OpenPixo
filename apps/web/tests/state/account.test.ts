// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountDisplayName,
  accountInitial,
  createByokAccount,
  createCloudAccountPreference,
  getAccountPath,
} from '../../src/state/account';
import { DEFAULT_CONFIG, loadConfig, saveConfig, syncConfigToDaemon } from '../../src/state/config';

describe('local account path preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps absent and BYOK preferences on the local path', () => {
    expect(createByokAccount()).toEqual({ mode: 'byok' });
    expect(getAccountPath(DEFAULT_CONFIG)).toBe('byok');
    expect(getAccountPath({ ...DEFAULT_CONFIG, account: createByokAccount() })).toBe('byok');
  });

  it('records the account path without any identity in config', () => {
    const preference = createCloudAccountPreference();
    expect(preference).toEqual({ mode: 'cloud' });
    expect(getAccountPath({ account: preference })).toBe('cloud');
  });

  it('reads the retired simulated sign-in as the account path, never as an identity', () => {
    const legacy = {
      mode: 'mock-login', provider: 'email', email: 'mina@example.com', displayName: 'mina', signedInAt: '2026-10-30T00:00:00Z',
    };
    expect(getAccountPath({ account: legacy })).toBe('cloud');
  });

  it('persists the chosen path only in local config', () => {
    saveConfig({ ...DEFAULT_CONFIG, account: createCloudAccountPreference(), onboardingCompleted: true });

    expect(loadConfig().account).toEqual({ mode: 'cloud' });
    expect(loadConfig().onboardingCompleted).toBe(true);
  });

  it('does not send the UI-only path preference to the daemon', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await syncConfigToDaemon({ ...DEFAULT_CONFIG, account: createCloudAccountPreference(), onboardingCompleted: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).not.toHaveProperty('account');
    expect(body.onboardingCompleted).toBe(true);
  });

  it('names a daemon user by display name, falling back to the email local part', () => {
    expect(accountDisplayName({ displayName: 'Mina Park', email: 'mina@example.com' })).toBe('Mina Park');
    expect(accountDisplayName({ displayName: null, email: 'mina@example.com' })).toBe('mina');
    expect(accountDisplayName({ displayName: '  ', email: 'mina@example.com' })).toBe('mina');
    expect(accountInitial({ displayName: null, email: 'mina@example.com' })).toBe('M');
  });
});
