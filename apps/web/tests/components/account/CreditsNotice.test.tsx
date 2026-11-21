// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreditsNotice } from '../../../src/components/account/CreditsNotice';
import { resetOpenPixoAccountStoreForTests } from '../../../src/hooks/useOpenPixoAccount';
import { I18nProvider } from '../../../src/i18n';

afterEach(() => {
  cleanup();
  resetOpenPixoAccountStoreForTests();
});

describe('CreditsNotice', () => {
  it('shows how far short the balance is and offers both ways on', () => {
    const onTopUp = vi.fn();
    const onUseOwnKey = vi.fn();
    render(<I18nProvider initial="en"><CreditsNotice needed={120} balance={45} onTopUp={onTopUp} onUseOwnKey={onUseOwnKey} /></I18nProvider>);

    const notice = screen.getByTestId('credits-notice');
    expect(notice.textContent).toContain("You're out of credits");
    expect(notice.textContent).toContain('This needs 120 credits and you have 45.');
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('45');
    expect(meter.getAttribute('aria-valuemax')).toBe('120');
    expect(screen.getByText('75 short')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Top up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use my own key' }));
    expect(onTopUp).toHaveBeenCalledTimes(1);
    expect(onUseOwnKey).toHaveBeenCalledTimes(1);
  });

  it('draws no meter when the refusal did not say what was needed, and no key button without a place to set one', () => {
    render(<I18nProvider initial="en"><CreditsNotice needed={null} balance={3} onTopUp={() => undefined} /></I18nProvider>);

    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('Your balance: 3 credits')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use my own key' })).toBeNull();
  });
});
