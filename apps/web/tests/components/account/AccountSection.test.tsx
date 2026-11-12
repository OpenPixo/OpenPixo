// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenPixoCatalogResponse, OpenPixoCreditsSummary, OpenPixoLedgerEntry, OpenPixoPlanChangeQuote, OpenPixoPlanChangeResponse } from '@openpixo/contracts';
import { AccountSection, LEDGER_PAGE_SIZE, LEDGER_READ_SIZE } from '../../../src/components/account/AccountSection';
import { formatMinorAmount } from '../../../src/components/account/account-format';
import {
  CREDITS_READ_MIN_INTERVAL_MS,
  EXTERNAL_RETURN_RECHECK_MS,
  markExternalBillingVisit,
  resetOpenPixoAccountStoreForTests,
} from '../../../src/hooks/useOpenPixoAccount';
import { I18nProvider } from '../../../src/i18n';
import { openExternalUrl } from '../../../src/providers/registry';
import {
  accountError,
  callsTo,
  installAccountFetch,
  NOT_CONFIGURED,
  SIGNED_IN,
  SIGNED_OUT,
  type RouteReply,
} from '../../helpers/account-fetch';

vi.mock('../../../src/providers/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/providers/registry')>(),
  openExternalUrl: vi.fn(async () => true),
}));

const CREDITS: OpenPixoCreditsSummary = {
  available: 1240,
  reserved: 35,
  subscription: {
    sku: 'plan_pro_monthly', status: 'active', monthlyCredits: 2500, amountMinor: 1900, currency: 'usd',
    currentPeriodEnd: '2026-12-01T00:00:00Z', cancelAtPeriodEnd: false, pendingDowngrade: null, pendingUpgrade: null,
  },
};

const CATALOG: OpenPixoCatalogResponse = {
  purchasesPaused: false,
  plans: [
    { sku: 'plan_starter_monthly_v3', monthlyCredits: 600, amountMinor: 490, currency: 'usd', interval: 'month', paymentMethods: ['card'] },
    { sku: 'plan_pro_monthly', monthlyCredits: 2500, amountMinor: 1900, currency: 'usd', interval: 'month', paymentMethods: ['card'] },
    { sku: 'plan_studio_monthly', monthlyCredits: 9000, amountMinor: 5900, currency: 'usd', interval: 'month', paymentMethods: ['card'] },
  ],
  topups: [
    { sku: 'pack_500', credits: 500, amountMinor: 500, currency: 'usd', paymentMethods: ['card', 'alipay'] },
  ],
};

const UPGRADE_QUOTE: OpenPixoPlanChangeQuote = {
  kind: 'upgrade', fromSku: 'plan_pro_monthly', toSku: 'plan_studio_monthly', chargeNowMinor: 4000, currency: 'usd', creditsNow: 6500,
  effectiveAt: null, nextRenewalAt: '2026-12-01T00:00:00Z', nextChargeMinor: 5900, nextMonthlyCredits: 9000,
};
const DOWNGRADE_QUOTE: OpenPixoPlanChangeQuote = {
  kind: 'downgrade', fromSku: 'plan_pro_monthly', toSku: 'plan_starter_monthly_v3', chargeNowMinor: 0, currency: 'usd', creditsNow: 0,
  effectiveAt: '2026-12-01T00:00:00Z', nextRenewalAt: '2026-12-01T00:00:00Z', nextChargeMinor: 490, nextMonthlyCredits: 600,
};
const AFTER_UPGRADE: OpenPixoCreditsSummary = {
  available: 7740, reserved: 0,
  subscription: { ...CREDITS.subscription!, sku: 'plan_studio_monthly', monthlyCredits: 9000, amountMinor: 5900 },
};
const WITH_DOWNGRADE: OpenPixoCreditsSummary = {
  ...CREDITS,
  subscription: { ...CREDITS.subscription!, pendingDowngrade: { sku: 'plan_starter_monthly_v3', monthlyCredits: 600, amountMinor: 490, currency: 'usd', effectiveAt: '2026-12-01T00:00:00Z' } },
};
const INVOICE_URL = 'https://invoice.stripe.com/i/test';

function planChanged(outcome: OpenPixoPlanChangeResponse['outcome'], credits: OpenPixoCreditsSummary, extra: Partial<OpenPixoPlanChangeResponse> = {}): OpenPixoPlanChangeResponse {
  return { outcome, paymentUrl: null, declineCode: null, credits, ...extra };
}

function entry(index: number): OpenPixoLedgerEntry {
  return {
    id: `e${index}`, kind: index % 2 ? 'settle' : 'topup', amount: index % 2 ? -10 : 500,
    balanceAfter: 1000 + index, createdAt: '2026-10-30T10:00:00Z', reference: index === 0 ? 'ord_42' : null,
  };
}

function signedInRoutes(overrides: Record<string, RouteReply | RouteReply[]> = {}) {
  return {
    'GET /api/openpixo/account': SIGNED_IN,
    'GET /api/openpixo/credits': CREDITS,
    'GET /api/openpixo/credits/catalog': CATALOG,
    'GET /api/openpixo/credits/ledger': (url: URL) => url.searchParams.get('cursor') === 'page-2'
      ? { entries: [entry(LEDGER_PAGE_SIZE + 1)], nextCursor: null }
      : { entries: Array.from({ length: LEDGER_PAGE_SIZE + 1 }, (_, index) => entry(index)), nextCursor: 'page-2' },
    'POST /api/openpixo/credits/checkout': { checkoutUrl: 'https://checkout.example.test/c1', checkoutId: 'c1' },
    'POST /api/openpixo/credits/portal': { url: 'https://billing.example.test/portal' },
    'POST /api/openpixo/account/sign-out': SIGNED_OUT,
    ...overrides,
  };
}

function renderSection() {
  return render(<I18nProvider initial="en"><AccountSection /></I18nProvider>);
}

afterEach(() => {
  cleanup();
  resetOpenPixoAccountStoreForTests();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Settings › Account & credits', () => {
  it('explains a build without an account service and offers nothing to buy', async () => {
    const fetchMock = installAccountFetch({ 'GET /api/openpixo/account': NOT_CONFIGURED });
    renderSection();

    const card = await screen.findByTestId('account-unavailable');
    expect(card.textContent).toContain("isn't connected to an account service");
    expect(screen.queryByRole('button', { name: /Continue with/ })).toBeNull();
    expect(callsTo(fetchMock, 'GET', '/api/openpixo/credits')).toHaveLength(0);
    expect(callsTo(fetchMock, 'GET', '/api/openpixo/credits/catalog')).toHaveLength(0);
  });

  it('treats an ACCOUNT_NOT_CONFIGURED answer to the status read as not configured', async () => {
    installAccountFetch({ 'GET /api/openpixo/account': accountError(503, 'ACCOUNT_NOT_CONFIGURED') });
    renderSection();

    const card = await screen.findByTestId('account-unavailable');
    expect(card.textContent).toContain("isn't connected to an account service");
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('offers sign-in when signed out and switches to the account once verified', async () => {
    installAccountFetch({
      ...signedInRoutes(),
      'GET /api/openpixo/account': SIGNED_OUT,
      'POST /api/openpixo/account/email/start': { resendAfterSec: 30 },
      'POST /api/openpixo/account/email/verify': SIGNED_IN,
    });
    renderSection();

    expect(await screen.findByRole('heading', { name: 'Sign in to OpenPixo' })).toBeTruthy();
    // One form: Google on top, the email field right below, no provider pre-choice.
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'mina@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Verification code' }), { target: { value: '123456' } });

    expect(await screen.findByTestId('account-signed-in')).toBeTruthy();
    expect(screen.getByText('mina@example.com')).toBeTruthy();
  });

  it('shows identity, balance, subscription and the no-cash note when signed in', async () => {
    installAccountFetch(signedInRoutes());
    renderSection();

    expect(await screen.findByText('mina@example.com')).toBeTruthy();
    expect(screen.getByText('Signed in with email')).toBeTruthy();
    expect((await screen.findByTestId('account-credits-available')).textContent).toBe('1,240');
    expect(screen.getByTestId('account-credits-reserved').textContent).toContain('35');
    expect(await screen.findByText(/can't be withdrawn, transferred or exchanged for cash/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Account overview' })).toBeTruthy();
    expect(screen.getByText('$19.00 / month · 2,500 credits a month')).toBeTruthy();
    expect(screen.getByText('Renews on Dec 1, 2026')).toBeTruthy();
    expect(screen.queryByText(/will not renew/)).toBeNull();
  });

  it('says how many plan credits end, and when', async () => {
    installAccountFetch(signedInRoutes({ 'GET /api/openpixo/credits': { ...CREDITS, planCredits: 800 } }));
    renderSection();
    expect((await screen.findByTestId('account-plan-credits-ending')).textContent)
      .toBe("800 are plan credits, which end on Dec 1, 2026. Credit packs don't expire.");
  });

  it('says nothing about ending credits when there are none', async () => {
    installAccountFetch(signedInRoutes({ 'GET /api/openpixo/credits': { ...CREDITS, planCredits: 0 } }));
    renderSection();
    await screen.findByTestId('account-credits-available');
    expect(screen.queryByTestId('account-plan-credits-ending')).toBeNull();
  });

  it('marks a subscription that ends at the period end', async () => {
    installAccountFetch(signedInRoutes({
      'GET /api/openpixo/credits': { ...CREDITS, subscription: { ...CREDITS.subscription!, cancelAtPeriodEnd: true } },
    }));
    renderSection();

    expect(await screen.findByText('Ends on Dec 1, 2026')).toBeTruthy();
    expect(screen.getByText(/This plan will not renew/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Renew or update card/ })).toBeTruthy();
    // Changing plan waits until it is renewed.
    const upgrade = within(await screen.findByTestId('account-plan-plan_studio_monthly')).getByRole('button') as HTMLButtonElement;
    expect(upgrade.disabled).toBe(true);
  });

  it('opens the billing portal externally', async () => {
    installAccountFetch(signedInRoutes());
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Card, invoices and cancellation' }));

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith('https://billing.example.test/portal'));
  });

  it('lists plans and packs with localized prices and opens checkout for a purchase', async () => {
    const fetchMock = installAccountFetch(signedInRoutes());
    renderSection();

    const pack = await screen.findByTestId('account-topup-pack_500');
    expect(pack.textContent).toContain('500 credits');
    expect(pack.textContent).toContain('$5.00');
    expect(screen.getByText(/paid in your browser \(Card · Alipay\)/)).toBeTruthy();
    const current = screen.getByTestId('account-plan-plan_pro_monthly');
    expect(within(current).getByText('Current plan')).toBeTruthy();
    expect(within(current).queryByRole('button')).toBeNull();
    const higher = screen.getByTestId('account-plan-plan_studio_monthly');
    expect(higher.textContent).toContain('$59.00 / month');
    expect(within(higher).getByRole('button').textContent).toBe('Upgrade');
    expect(within(screen.getByTestId('account-plan-plan_starter_monthly_v3')).getByRole('button').textContent).toBe('Downgrade');
    expect(screen.getByText(/Credits appear here once the payment is confirmed/)).toBeTruthy();

    fireEvent.click(within(pack).getByRole('button', { name: 'Buy · 500 credits · $5.00' }));

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith('https://checkout.example.test/c1'));
    const checkout = callsTo(fetchMock, 'POST', '/api/openpixo/credits/checkout');
    expect(JSON.parse(String(checkout[0]?.[1]?.body))).toEqual({ sku: 'pack_500' });
  });

  it('pauses purchases without hiding the balance', async () => {
    installAccountFetch(signedInRoutes({ 'GET /api/openpixo/credits/catalog': { ...CATALOG, purchasesPaused: true } }));
    renderSection();

    expect(await screen.findByText(/New purchases are paused for now/)).toBeTruthy();
    const buy = within(screen.getByTestId('account-topup-pack_500')).getByRole('button') as HTMLButtonElement;
    expect(buy.disabled).toBe(true);
    expect(screen.getByTestId('account-credits-available').textContent).toBe('1,240');
  });

  it('offers to subscribe, through checkout, to an account with no plan', async () => {
    const fetchMock = installAccountFetch(signedInRoutes({ 'GET /api/openpixo/credits': { available: 50, reserved: 0, subscription: null } }));
    renderSection();

    expect(await screen.findByText('No plan yet')).toBeTruthy();
    expect(screen.getByText(/Next step: choose a monthly plan/)).toBeTruthy();
    const pro = within(await screen.findByTestId('account-plan-plan_pro_monthly')).getByRole('button');
    expect(pro.textContent).toBe('Subscribe');
    fireEvent.click(pro);

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith('https://checkout.example.test/c1'));
    expect(callsTo(fetchMock, 'POST', '/api/openpixo/credits/plan-change/preview')).toHaveLength(0);
  });

  it('states the charge before an upgrade, sends exactly that amount, then shows the new plan and balance', async () => {
    const fetchMock = installAccountFetch(signedInRoutes({
      'POST /api/openpixo/credits/plan-change/preview': UPGRADE_QUOTE,
      'POST /api/openpixo/credits/plan-change': planChanged('upgraded', AFTER_UPGRADE),
    }));
    renderSection();

    fireEvent.click(within(await screen.findByTestId('account-plan-plan_studio_monthly')).getByRole('button'));
    const dialog = await screen.findByTestId('plan-change-dialog');
    await within(dialog).findByText('Upgrade to Max');
    expect(dialog.textContent).toContain('Charged now$40.00');
    expect(dialog.textContent).toContain('Credits added now+6,500');
    expect(dialog.textContent).toContain('Takes effectNow');
    expect(dialog.textContent).toContain('Dec 1, 2026: $59.00, 9,000 credits');
    expect(callsTo(fetchMock, 'POST', '/api/openpixo/credits/plan-change')).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Upgrade and pay $40.00' }));

    expect(await screen.findByText('You are on Max now, and 6,500 credits have been added.')).toBeTruthy();
    const body = callsTo(fetchMock, 'POST', '/api/openpixo/credits/plan-change')[0]?.[1]?.body;
    expect(JSON.parse(String(body))).toEqual({ sku: 'plan_studio_monthly', expectedChargeMinor: 4000 });
    expect(screen.getByTestId('account-credits-available').textContent).toBe('7,740');
    expect(within(screen.getByTestId('account-plan-plan_studio_monthly')).getByText('Current plan')).toBeTruthy();
  });

  it('says nothing changed when the card is declined', async () => {
    installAccountFetch(signedInRoutes({
      'POST /api/openpixo/credits/plan-change/preview': UPGRADE_QUOTE,
      'POST /api/openpixo/credits/plan-change': planChanged('payment_failed', CREDITS, { declineCode: 'insufficient_funds' }),
    }));
    renderSection();

    fireEvent.click(within(await screen.findByTestId('account-plan-plan_studio_monthly')).getByRole('button'));
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade and pay $40.00' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/card was declined.*Nothing was charged/);
    expect(screen.getByTestId('account-credits-available').textContent).toBe('1,240');
    expect(screen.getByRole('button', { name: /Update card/ })).toBeTruthy();
  });

  it('sends the customer to verify a payment, and can abandon it from the overview', async () => {
    const waiting: OpenPixoCreditsSummary = { ...CREDITS, subscription: { ...CREDITS.subscription!,
      pendingUpgrade: { sku: 'plan_studio_monthly', chargeMinor: 4000, currency: 'usd', credits: 6500, paymentUrl: INVOICE_URL } } };
    installAccountFetch(signedInRoutes({
      'POST /api/openpixo/credits/plan-change/preview': UPGRADE_QUOTE,
      'POST /api/openpixo/credits/plan-change': planChanged('payment_requires_action', waiting, { paymentUrl: INVOICE_URL }),
      'POST /api/openpixo/credits/plan-change/cancel': planChanged('canceled', CREDITS),
    }));
    renderSection();

    fireEvent.click(within(await screen.findByTestId('account-plan-plan_studio_monthly')).getByRole('button'));
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade and pay $40.00' }));
    expect(await screen.findByText(/Your bank wants you to confirm this \$40.00 payment/)).toBeTruthy();
    fireEvent.click(within(screen.getByTestId('plan-change-dialog')).getByRole('button', { name: /Verify payment/ }));
    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith(INVOICE_URL));

    const pending = await screen.findByTestId('account-pending-upgrade');
    expect(pending.textContent).toContain('your bank wants to verify the $40.00 payment');
    fireEvent.click(within(pending).getByRole('button', { name: 'Abandon this upgrade' }));

    expect(await screen.findByText('Upgrade abandoned. Nothing was charged.')).toBeTruthy();
    expect(screen.queryByTestId('account-pending-upgrade')).toBeNull();
  });

  it('shows when a downgrade takes effect and lets it be undone', async () => {
    const fetchMock = installAccountFetch(signedInRoutes({
      'POST /api/openpixo/credits/plan-change/preview': DOWNGRADE_QUOTE,
      'POST /api/openpixo/credits/plan-change': planChanged('downgrade_scheduled', WITH_DOWNGRADE),
      'POST /api/openpixo/credits/plan-change/cancel': planChanged('downgrade_canceled', CREDITS),
    }));
    renderSection();

    fireEvent.click(within(await screen.findByTestId('account-plan-plan_starter_monthly_v3')).getByRole('button'));
    const dialog = await screen.findByTestId('plan-change-dialog');
    await within(dialog).findByRole('heading', { name: 'Downgrade to Starter' });
    expect(dialog.textContent).toContain('Charged nowNothing');
    expect(dialog.textContent).toContain('Takes effectDec 1, 2026');
    expect(dialog.textContent).toContain('Your creditsAll stay');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Downgrade to Starter' }));

    const pending = await screen.findByTestId('account-pending-downgrade');
    expect(pending.textContent).toContain('Changes to Starter on Dec 1, 2026');
    expect(within(screen.getByTestId('account-plan-plan_pro_monthly')).getByText('Current plan')).toBeTruthy();
    expect(within(screen.getByTestId('account-plan-plan_starter_monthly_v3')).getByText('From Dec 1, 2026')).toBeTruthy();
    expect(JSON.parse(String(callsTo(fetchMock, 'POST', '/api/openpixo/credits/plan-change')[0]?.[1]?.body))).toEqual({ sku: 'plan_starter_monthly_v3', expectedChargeMinor: 0 });

    fireEvent.click(within(pending).getByRole('button', { name: 'Keep my current plan' }));

    expect(await screen.findByText('Downgrade undone. Your plan stays as it is.')).toBeTruthy();
    expect(screen.queryByTestId('account-pending-downgrade')).toBeNull();
  });

  it('asks again when the price changed after the quote', async () => {
    installAccountFetch(signedInRoutes({
      'POST /api/openpixo/credits/plan-change/preview': [UPGRADE_QUOTE, { ...UPGRADE_QUOTE, chargeNowMinor: 4100 }],
      'POST /api/openpixo/credits/plan-change': accountError(409, 'BILLING_PLAN_QUOTE_CHANGED'),
    }));
    renderSection();

    fireEvent.click(within(await screen.findByTestId('account-plan-plan_studio_monthly')).getByRole('button'));
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade and pay $40.00' }));

    expect(await screen.findByRole('button', { name: 'Upgrade and pay $41.00' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('price of this change has been updated');
  });

  it('warns when credits run low and hides ledger rows that moved nothing', async () => {
    installAccountFetch(signedInRoutes({
      'GET /api/openpixo/credits': { ...CREDITS, available: 12 },
      'GET /api/openpixo/credits/ledger': { nextCursor: null, entries: [
        { id: 'a', kind: 'settle', amount: 0, balanceAfter: 12, createdAt: '2026-10-30T10:00:00Z', reference: null },
        { id: 'b', kind: 'reserve', amount: -4, balanceAfter: 12, createdAt: '2026-10-30T10:00:00Z', reference: null },
      ] },
    }));
    renderSection();

    expect(await screen.findByText(/Credits are running low/)).toBeTruthy();
    const list = await screen.findByRole('list', { name: 'Recent activity' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    // A finished image settles at +0, which is hidden, so this row is all that is left of it.
    expect(within(list).getByText('Image generation')).toBeTruthy();
  });

  it('re-reads when the daemon says the balance moved, however fast it says so', async () => {
    const sources: { listeners: Map<string, () => void>; closed: boolean }[] = [];
    vi.stubGlobal('EventSource', class {
      listeners = new Map<string, () => void>();
      closed = false;
      constructor() { sources.push(this); }
      addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
      close() { this.closed = true; }
    });
    const fetchMock = installAccountFetch(signedInRoutes({
      'GET /api/openpixo/credits': [CREDITS, { ...CREDITS, available: 1236 }, { ...CREDITS, available: 1232 }],
    }));
    const now = vi.spyOn(Date, 'now');
    const start = 1_800_000_000_000;
    now.mockReturnValue(start);
    const view = renderSection();
    await screen.findByTestId('account-credits-available');
    expect(sources).toHaveLength(1);

    now.mockReturnValue(start + CREDITS_READ_MIN_INTERVAL_MS);
    act(() => { sources[0]!.listeners.get('changed')!(); });
    await waitFor(() => expect(screen.getByTestId('account-credits-available').textContent).toBe('1,236'));
    // A burst right after that read waits for the interval instead of reading each time.
    act(() => { sources[0]!.listeners.get('changed')!(); sources[0]!.listeners.get('changed')!(); });
    expect(callsTo(fetchMock, 'GET', '/api/openpixo/credits')).toHaveLength(2);

    view.unmount();
    expect(sources[0]!.closed).toBe(true);
    now.mockRestore();
  });

  it('re-reads when the window regains focus, but not right after a read', async () => {
    const fetchMock = installAccountFetch(signedInRoutes({
      'GET /api/openpixo/credits': [CREDITS, { ...CREDITS, available: 1000 }],
    }));
    const now = vi.spyOn(Date, 'now');
    const start = 1_800_000_000_000;
    now.mockReturnValue(start);
    renderSection();
    await screen.findByTestId('account-credits-available');

    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(callsTo(fetchMock, 'GET', '/api/openpixo/credits')).toHaveLength(1);

    now.mockReturnValue(start + CREDITS_READ_MIN_INTERVAL_MS + 1);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.getByTestId('account-credits-available').textContent).toBe('1,000'));
    now.mockRestore();
  });

  it('keeps re-checking after a payment until the late webhook shows up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const fetchMock = installAccountFetch(signedInRoutes({
        'GET /api/openpixo/credits': [CREDITS, CREDITS, CREDITS, { ...CREDITS, available: 1740 }],
      }));
      renderSection();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      markExternalBillingVisit();
      await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); });
      expect(callsTo(fetchMock, 'GET', '/api/openpixo/credits')).toHaveLength(2);

      await act(async () => { await vi.advanceTimersByTimeAsync(EXTERNAL_RETURN_RECHECK_MS[0]!); });
      await act(async () => { await vi.advanceTimersByTimeAsync(EXTERNAL_RETURN_RECHECK_MS[1]! - EXTERNAL_RETURN_RECHECK_MS[0]!); });
      expect(screen.getByTestId('account-credits-available').textContent).toBe('1,740');
      const reads = callsTo(fetchMock, 'GET', '/api/openpixo/credits').length;
      // The money arrived, so the remaining checks do not run.
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(callsTo(fetchMock, 'GET', '/api/openpixo/credits')).toHaveLength(reads);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-reads the balance when the window regains focus after checkout', async () => {
    const fetchMock = installAccountFetch(signedInRoutes({
      'GET /api/openpixo/credits': [CREDITS, { ...CREDITS, available: 1740 }],
    }));
    renderSection();
    await screen.findByTestId('account-credits-available');

    fireEvent.click(within(await screen.findByTestId('account-topup-pack_500')).getByRole('button'));
    await waitFor(() => expect(openExternalUrl).toHaveBeenCalled());
    act(() => { window.dispatchEvent(new Event('focus')); });

    await waitFor(() => expect(screen.getByTestId('account-credits-available').textContent).toBe('1,740'));
    expect(callsTo(fetchMock, 'GET', '/api/openpixo/credits')).toHaveLength(2);
    // The activity list reloads its first page alongside the new balance.
    await waitFor(() => expect(callsTo(fetchMock, 'GET', '/api/openpixo/credits/ledger')).toHaveLength(2));
  });

  it('pages through recent activity', async () => {
    const fetchMock = installAccountFetch(signedInRoutes());
    renderSection();

    const list = await screen.findByRole('list', { name: 'Recent activity' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(LEDGER_PAGE_SIZE);
    expect(within(list).getAllByText('Credit pack').length).toBeGreaterThan(0);
    expect(within(list).getAllByText('-10').length).toBeGreaterThan(0);
    expect(within(list).getAllByText('+500').length).toBeGreaterThan(0);
    expect(list.textContent).toContain('Ref ord_42');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(LEDGER_PAGE_SIZE + 2));
    const requests = callsTo(fetchMock, 'GET', '/api/openpixo/credits/ledger')
      .map(([input]) => new URL(String(input), 'http://localhost').searchParams.toString());
    expect(requests).toEqual([`limit=${LEDGER_READ_SIZE}`, `limit=${LEDGER_READ_SIZE}&cursor=page-2`]);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows a long hosted session as one row, whole, even when it spans pages', async () => {
    const usage = (id: number, minute: number): OpenPixoLedgerEntry => ({
      id: `u${id}`, kind: 'usage', amount: -1, balanceAfter: 1000 + id,
      createdAt: `2026-11-07T10:${String(minute).padStart(2, '0')}:00Z`, reference: `request-${id}`,
    });
    const fetchMock = installAccountFetch(signedInRoutes({
      'GET /api/openpixo/credits/ledger': (url: URL) => url.searchParams.get('cursor') === 'page-2'
        ? { entries: [usage(1, 1), { id: 'topup', kind: 'topup', amount: 500, balanceAfter: 1000, createdAt: '2026-11-07T09:00:00Z', reference: 'ord_1' }], nextCursor: null }
        : { entries: [usage(4, 4), usage(3, 3), usage(2, 2)], nextCursor: 'page-2' },
    }));
    renderSection();

    const list = await screen.findByRole('list', { name: 'Recent activity' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    expect(within(list).getByText('Hosted model usage')).toBeTruthy();
    // The total counts the charge on the second page: nobody has to press Load more to get it right.
    expect(within(list).getByText('-4')).toBeTruthy();
    expect(within(list).getByText('Balance 1,004')).toBeTruthy();
    expect(list.textContent).toContain('4 charges');
    expect(list.textContent).not.toContain('request-');
    expect(callsTo(fetchMock, 'GET', '/api/openpixo/credits/ledger')).toHaveLength(2);
  });

  it('signs out through the daemon', async () => {
    const fetchMock = installAccountFetch(signedInRoutes());
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByTestId('account-signed-out')).toBeTruthy();
    expect(callsTo(fetchMock, 'POST', '/api/openpixo/account/sign-out')).toHaveLength(1);
  });
});

describe('formatMinorAmount', () => {
  it('formats minor units per currency and locale', () => {
    expect(formatMinorAmount(500, 'usd', 'en')).toBe('$5.00');
    expect(formatMinorAmount(3500, 'CNY', 'zh-CN')).toBe('¥35.00');
    expect(formatMinorAmount(500, 'JPY', 'en')).toBe('¥500');
  });
});
