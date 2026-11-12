// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudSignIn, GOOGLE_POLL_INTERVAL_MS, normalizeOtp, SignInPanel } from '../../../src/components/account/CloudSignIn';
import { resetOpenPixoAccountStoreForTests } from '../../../src/hooks/useOpenPixoAccount';
import { I18nProvider } from '../../../src/i18n';
import { openExternalUrl } from '../../../src/providers/registry';
import { accountError, callsTo, installAccountFetch, SIGNED_IN } from '../../helpers/account-fetch';

vi.mock('../../../src/providers/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/providers/registry')>(),
  openExternalUrl: vi.fn(async () => true),
}));

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function renderSignIn(provider: 'email' | 'google', onCancel = vi.fn()) {
  const onSignedIn = vi.fn();
  render(<I18nProvider initial="en"><CloudSignIn provider={provider} onSignedIn={onSignedIn} onCancel={onCancel} /></I18nProvider>);
  return { onSignedIn, onCancel };
}

describe('SignInPanel focus', () => {
  it('focuses the address by default, and only after the first step when told not to', async () => {
    const { unmount } = render(<I18nProvider initial="en"><SignInPanel onSignedIn={vi.fn()} /></I18nProvider>);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email address' }));
    unmount();

    installAccountFetch({ 'POST /api/openpixo/account/email/start': { resendAfterSec: 30 } });
    render(<I18nProvider initial="en"><StrictMode><SignInPanel onSignedIn={vi.fn()} autoFocus={false} /></StrictMode></I18nProvider>);
    const email = screen.getByRole('textbox', { name: 'Email address' });
    expect(document.activeElement).not.toBe(email);
    fireEvent.change(email, { target: { value: 'mina@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await advance(0);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Verification code' }));
  });
});

function pasteInto(element: HTMLElement, text: string) {
  fireEvent.paste(element, { clipboardData: { getData: () => text } });
}

async function sendCodeTo(email: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetOpenPixoAccountStoreForTests();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('normalizeOtp', () => {
  it('keeps only the first six digits of pasted text', () => {
    expect(normalizeOtp('Code: 123-456')).toBe('123456');
    expect(normalizeOtp(' 12 34 5678 ')).toBe('123456');
    expect(normalizeOtp('abc')).toBe('');
  });
});

describe('email sign-in', () => {
  it('shows a send failure and re-enables the button under StrictMode remounts', async () => {
    installAccountFetch({ 'POST /api/openpixo/account/email/start': accountError(503, 'CLOUD_UNAVAILABLE') });
    render(<StrictMode><I18nProvider initial="en"><CloudSignIn provider="email" onSignedIn={vi.fn()} onCancel={vi.fn()} /></I18nProvider></StrictMode>);

    await sendCodeTo('mina@example.com');

    expect(screen.getByRole('alert')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send code' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('rejects a malformed address before contacting the daemon', async () => {
    const fetchMock = installAccountFetch({});
    renderSignIn('email');

    await sendCodeTo('not-an-email');

    expect(screen.getByRole('alert').textContent).toBe('Enter a valid email address.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a code, counts down the resend, and resends once allowed', async () => {
    const fetchMock = installAccountFetch({ 'POST /api/openpixo/account/email/start': { resendAfterSec: 30 } });
    renderSignIn('email');

    await sendCodeTo('mina@example.com');

    expect(JSON.parse(String(callsTo(fetchMock, 'POST', '/api/openpixo/account/email/start')[0]?.[1]?.body)))
      .toEqual({ email: 'mina@example.com' });
    expect(screen.getByText('We sent a 6-digit code to mina@example.com.')).toBeTruthy();
    expect(screen.getByText(/check your spam or promotions folder/i)).toBeTruthy();
    const code = screen.getByRole('textbox', { name: 'Verification code' });
    expect(document.activeElement).toBe(code);
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    const waiting = screen.getByRole('button', { name: 'Resend code in 30s' }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);

    await advance(1_000);
    expect(screen.getByRole('button', { name: 'Resend code in 29s' })).toBeTruthy();
    await advance(29_000);

    const resend = screen.getByRole('button', { name: 'Resend code' }) as HTMLButtonElement;
    expect(resend.disabled).toBe(false);
    fireEvent.click(resend);
    await flush();

    expect(callsTo(fetchMock, 'POST', '/api/openpixo/account/email/start')).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toBe('A new code is on its way.');
    expect(screen.getByRole('button', { name: 'Resend code in 30s' })).toBeTruthy();
  });

  it('explains an invalid code, then signs in with a pasted code', async () => {
    const fetchMock = installAccountFetch({
      'POST /api/openpixo/account/email/start': { resendAfterSec: 60 },
      'POST /api/openpixo/account/email/verify': [accountError(400, 'ACCOUNT_OTP_INVALID'), SIGNED_IN],
    });
    const { onSignedIn } = renderSignIn('email');
    await sendCodeTo('mina@example.com');
    const code = screen.getByRole('textbox', { name: 'Verification code' }) as HTMLInputElement;

    fireEvent.change(code, { target: { value: '111111' } });
    await flush();

    expect(screen.getByRole('alert').textContent).toBe("That code isn't right. Check the latest email and try again.");
    expect(code.value).toBe('');
    expect(code.getAttribute('aria-invalid')).toBe('true');
    expect(onSignedIn).not.toHaveBeenCalled();

    pasteInto(code, 'Your code: 482 913');
    await flush();

    const verifies = callsTo(fetchMock, 'POST', '/api/openpixo/account/email/verify');
    expect(verifies).toHaveLength(2);
    expect(JSON.parse(String(verifies[1]?.[1]?.body))).toEqual({ email: 'mina@example.com', code: '482913' });
    expect(onSignedIn).toHaveBeenCalledWith(SIGNED_IN);
  });

  it('lets the user request a fresh code when the old one expired', async () => {
    installAccountFetch({
      'POST /api/openpixo/account/email/start': { resendAfterSec: 60 },
      'POST /api/openpixo/account/email/verify': accountError(400, 'ACCOUNT_LOGIN_EXPIRED'),
    });
    renderSignIn('email');
    await sendCodeTo('mina@example.com');

    pasteInto(screen.getByRole('textbox', { name: 'Verification code' }), '123456');
    await flush();

    expect(screen.getByRole('alert').textContent).toBe('That code has expired. Request a new one.');
    expect((screen.getByRole('button', { name: 'Resend code' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the rate-limit wait from the daemon', async () => {
    installAccountFetch({
      'POST /api/openpixo/account/email/start': accountError(429, 'ACCOUNT_OTP_RATE_LIMITED', 42),
    });
    renderSignIn('email');

    await sendCodeTo('mina@example.com');

    expect(screen.getByRole('alert').textContent).toBe('Too many attempts. Try again in 42s.');
    expect(screen.getByRole('textbox', { name: 'Email address' })).toBeTruthy();
  });
});

describe('Google sign-in', () => {
  const ATTEMPT = { attemptId: 'att 1', authorizeUrl: 'https://accounts.example.test/authorize?x=1', expiresAt: '2026-11-01T00:10:00Z' };

  it('opens the browser, polls until completed, and reports the account', async () => {
    const fetchMock = installAccountFetch({
      'POST /api/openpixo/account/google/start': ATTEMPT,
      'GET /api/openpixo/account/google/attempts/att%201': [
        { state: 'pending', error: null, account: null },
        { state: 'pending', error: null, account: null },
        { state: 'completed', error: null, account: SIGNED_IN },
      ],
    });
    const { onSignedIn } = renderSignIn('google');
    await flush();

    expect(openExternalUrl).toHaveBeenCalledWith(ATTEMPT.authorizeUrl);
    expect(screen.getByText(/Finish signing in with Google in your browser/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the sign-in page again' }));
    expect(openExternalUrl).toHaveBeenCalledTimes(2);

    await advance(GOOGLE_POLL_INTERVAL_MS);
    await advance(GOOGLE_POLL_INTERVAL_MS);
    expect(onSignedIn).not.toHaveBeenCalled();
    await advance(GOOGLE_POLL_INTERVAL_MS);

    expect(callsTo(fetchMock, 'GET', '/api/openpixo/account/google/attempts/att%201')).toHaveLength(3);
    expect(onSignedIn).toHaveBeenCalledWith(SIGNED_IN);
    await advance(GOOGLE_POLL_INTERVAL_MS * 3);
    expect(callsTo(fetchMock, 'GET', '/api/openpixo/account/google/attempts/att%201')).toHaveLength(3);
  });

  it('explains an expired attempt and starts a new one on retry', async () => {
    const fetchMock = installAccountFetch({
      'POST /api/openpixo/account/google/start': ATTEMPT,
      'GET /api/openpixo/account/google/attempts/att%201': { state: 'expired', error: null, account: null },
    });
    renderSignIn('google');
    await flush();
    await advance(GOOGLE_POLL_INTERVAL_MS);

    expect(screen.getByRole('alert').textContent).toBe('The Google sign-in timed out. Try again.');
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(document.activeElement).toBe(retry);
    fireEvent.click(retry);
    await flush();

    expect(callsTo(fetchMock, 'POST', '/api/openpixo/account/google/start')).toHaveLength(2);
    expect(openExternalUrl).toHaveBeenCalledTimes(2);
  });

  it('maps a failed attempt to its error code', async () => {
    installAccountFetch({
      'POST /api/openpixo/account/google/start': ATTEMPT,
      'GET /api/openpixo/account/google/attempts/att%201': { state: 'failed', error: 'CLOUD_UNAVAILABLE', account: null },
    });
    renderSignIn('google');
    await flush();
    await advance(GOOGLE_POLL_INTERVAL_MS);

    expect(screen.getByRole('alert').textContent).toContain("Can't reach the OpenPixo account service");
  });

  it('stops polling when cancelled', async () => {
    const fetchMock = installAccountFetch({
      'POST /api/openpixo/account/google/start': ATTEMPT,
      'GET /api/openpixo/account/google/attempts/att%201': { state: 'pending', error: null, account: null },
    });
    const { onCancel, onSignedIn } = renderSignIn('google');
    await flush();
    await advance(GOOGLE_POLL_INTERVAL_MS);
    expect(callsTo(fetchMock, 'GET', '/api/openpixo/account/google/attempts/att%201')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await advance(GOOGLE_POLL_INTERVAL_MS * 4);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(callsTo(fetchMock, 'GET', '/api/openpixo/account/google/attempts/att%201')).toHaveLength(1);
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
