// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountChip } from '../../../src/components/onboarding/AccountChip';
import { resetOpenPixoAccountStoreForTests } from '../../../src/hooks/useOpenPixoAccount';
import { I18nProvider } from '../../../src/i18n';
import {
  callsTo,
  installAccountFetch,
  NOT_CONFIGURED,
  SIGNED_IN,
  SIGNED_OUT,
} from '../../helpers/account-fetch';

const CREDITS = { available: 1240, reserved: 20, subscription: null };

function renderChip(onOpenSettings = vi.fn()) {
  render(<I18nProvider initial="en"><AccountChip onOpenSettings={onOpenSettings} /></I18nProvider>);
  return onOpenSettings;
}

afterEach(() => {
  cleanup();
  resetOpenPixoAccountStoreForTests();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('nav rail account chip', () => {
  it('stays the plain local chip with nothing cloud when accounts are not configured', async () => {
    const fetchMock = installAccountFetch({ 'GET /api/openpixo/account': NOT_CONFIGURED });
    const onOpenSettings = renderChip();
    await waitFor(() => expect(callsTo(fetchMock, 'GET', '/api/openpixo/account')).toHaveLength(1));

    const trigger = screen.getByRole('button', { name: 'Local mode · Your own key' });
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByTestId('entry-nav-credits')).toBeNull();
    expect(callsTo(fetchMock, 'GET', '/api/openpixo/credits')).toHaveLength(0);
    fireEvent.click(trigger);
    expect(onOpenSettings).toHaveBeenCalledWith();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers sign-in when signed out in a focused window, not Settings', async () => {
    installAccountFetch({ 'GET /api/openpixo/account': SIGNED_OUT });
    const onOpenSettings = renderChip();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    const dialog = await screen.findByRole('dialog', { name: 'Sign in to OpenPixo' });
    expect(within(dialog).getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    expect(within(dialog).getByRole('textbox', { name: 'Email address' })).toBeTruthy();
    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Local mode · Your own key' })).toBeTruthy();
  });

  it('shows the daemon identity with a compact credit balance', async () => {
    installAccountFetch({
      'GET /api/openpixo/account': SIGNED_IN,
      'GET /api/openpixo/credits': CREDITS,
    });
    const onOpenSettings = renderChip();

    const trigger = await screen.findByRole('button', { name: 'mina · mina@example.com' });
    expect(within(trigger).getByText('M')).toBeTruthy();
    const credits = await screen.findByRole('button', { name: '1,240 credits available. Open account & credits' });
    expect(credits.textContent).toBe('1,240 credits');
    fireEvent.click(credits);
    expect(onOpenSettings).toHaveBeenCalledWith('account');
  });

  it('gives the balance and rail controls their own line when signed in, and keeps one row otherwise', async () => {
    installAccountFetch({ 'GET /api/openpixo/account': SIGNED_IN, 'GET /api/openpixo/credits': CREDITS });
    const { unmount } = render(<I18nProvider initial="en"><AccountChip trailing={<button type="button">gear</button>} /></I18nProvider>);
    const trigger = await screen.findByRole('button', { name: 'mina · mina@example.com' });
    const credits = await screen.findByRole('button', { name: '1,240 credits available. Open account & credits' });
    const gear = screen.getByRole('button', { name: 'gear' });
    // Neither shares the identity's row, so a long name and email keep their width.
    expect(trigger.parentElement?.contains(gear)).toBe(false);
    expect(trigger.parentElement?.contains(credits)).toBe(false);
    expect(credits.parentElement?.contains(gear)).toBe(true);
    unmount();
    resetOpenPixoAccountStoreForTests();

    installAccountFetch({ 'GET /api/openpixo/account': NOT_CONFIGURED });
    render(<I18nProvider initial="en"><AccountChip trailing={<button type="button">gear</button>} /></I18nProvider>);
    const local = await screen.findByRole('button', { name: 'Local mode · Your own key' });
    expect(local.parentElement?.contains(screen.getByRole('button', { name: 'gear' }))).toBe(true);
  });

  it('signs out through the menu with the daemon and falls back to the sign-in affordance', async () => {
    const fetchMock = installAccountFetch({
      'GET /api/openpixo/account': SIGNED_IN,
      'GET /api/openpixo/credits': CREDITS,
      'POST /api/openpixo/account/sign-out': SIGNED_OUT,
    });
    renderChip();
    const trigger = await screen.findByRole('button', { name: 'mina · mina@example.com' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const manage = screen.getByRole('menuitem', { name: 'Account & credits' });
    expect(document.activeElement).toBe(manage);
    fireEvent.keyDown(manage, { key: 'ArrowDown' });
    const signOut = screen.getByRole('menuitem', { name: 'Sign out' });
    expect(document.activeElement).toBe(signOut);
    fireEvent.click(signOut);

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(callsTo(fetchMock, 'POST', '/api/openpixo/account/sign-out')).toHaveLength(1);
    expect(screen.queryByTestId('entry-nav-credits')).toBeNull();
  });

  it('closes the menu on Escape and returns focus to the trigger', async () => {
    installAccountFetch({ 'GET /api/openpixo/account': SIGNED_IN, 'GET /api/openpixo/credits': CREDITS });
    renderChip();
    const trigger = await screen.findByRole('button', { name: 'mina · mina@example.com' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Account menu' })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Sign out' }), { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the menu when the user presses outside the chip', async () => {
    installAccountFetch({ 'GET /api/openpixo/account': SIGNED_IN, 'GET /api/openpixo/credits': CREDITS });
    renderChip();
    fireEvent.click(await screen.findByRole('button', { name: 'mina · mina@example.com' }));
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
