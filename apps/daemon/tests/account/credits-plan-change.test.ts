import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creditsLedger, creditsSummary, planChangeQuote, planChangeResponse } from '../../src/account/credits.js';
import { runCreditsCli } from '../../src/account/credits-cli.js';
import type { OpenPixoAccountService } from '../../src/account/service.js';
import { registerOpenPixoAccountRoutes } from '../../src/routes/openpixo-account.js';
import { accountHarness } from './fixtures.js';

const SUMMARY = { available: 2500, reserved: 0, subscription: {
  sku: 'plan_pro_monthly', status: 'active', monthlyCredits: 2500, amountMinor: 1900, currency: 'usd',
  currentPeriodEnd: '2026-12-01T00:00:00+00:00', cancelAtPeriodEnd: false, pendingDowngrade: null, pendingUpgrade: null,
} };
const QUOTE = { kind: 'upgrade', fromSku: 'plan_starter_monthly_v3', toSku: 'plan_pro_monthly', chargeNowMinor: 1410, currency: 'usd',
  creditsNow: 1900, effectiveAt: null, nextRenewalAt: '2026-12-01T00:00:00.000Z', nextChargeMinor: 1900, nextMonthlyCredits: 2500 };
const UPGRADED = { outcome: 'upgraded', paymentUrl: null, declineCode: null, credits: SUMMARY };
const INVOICE_URL = 'https://invoice.stripe.com/i/acct_test/test_abc?s=ap';

describe('plan change DTOs from the cloud', () => {
  it('reads an account from a cloud older than plan changes as having nothing pending', () => {
    expect(creditsSummary({ available: 1, reserved: 0, subscription: {
      sku: 'plan_pro_monthly', status: 'active', monthlyCredits: 2500, currentPeriodEnd: '2026-12-01T00:00:00Z', cancelAtPeriodEnd: false,
    } }).subscription).toMatchObject({ pendingDowngrade: null, pendingUpgrade: null });
  });

  it('reads how much of the balance is plan credits, and a cloud that does not say', () => {
    expect(creditsSummary({ ...SUMMARY, planCredits: 400 }).planCredits).toBe(400);
    expect('planCredits' in creditsSummary(SUMMARY)).toBe(false);
    expect(creditsLedger({ entries: [{ id: 'e1', kind: 'plan_expiry', amount: -400, balanceAfter: 100, createdAt: '2026-12-01T00:00:00Z', reference: 'in_1' }], nextCursor: null }).entries[0]?.kind).toBe('plan_expiry');
    expect(creditsLedger({ entries: [{ id: 'e2', kind: 'usage', amount: -21, balanceAfter: 79, createdAt: '2026-12-01T00:00:00Z', reference: 'r1' }], nextCursor: null }).entries[0]?.kind).toBe('usage');
  });

  it('forwards only the fields it knows, and only a Stripe invoice page as the payment link', () => {
    const pendingUpgrade = { sku: 'plan_pro_monthly', chargeMinor: 1410, currency: 'usd', credits: 1900, paymentUrl: INVOICE_URL, secret: 'x' };
    const read = creditsSummary({ ...SUMMARY, subscription: { ...SUMMARY.subscription, pendingUpgrade } });
    expect(read.subscription?.pendingUpgrade).toEqual({ sku: 'plan_pro_monthly', chargeMinor: 1410, currency: 'usd', credits: 1900, paymentUrl: INVOICE_URL });
    expect(() => creditsSummary({ ...SUMMARY, subscription: { ...SUMMARY.subscription, pendingUpgrade: { ...pendingUpgrade, paymentUrl: 'https://evil.example/pay' } } })).toThrow();
    expect(() => planChangeResponse({ outcome: 'payment_requires_action', paymentUrl: 'https://evil.example/pay', declineCode: null, credits: SUMMARY })).toThrow();
  });

  it('refuses a quote or outcome it does not know', () => {
    expect(planChangeQuote(QUOTE)).toEqual(QUOTE);
    expect(() => planChangeQuote({ ...QUOTE, kind: 'free_money' })).toThrow();
    expect(() => planChangeResponse({ outcome: 'nonsense', paymentUrl: null, declineCode: null, credits: SUMMARY })).toThrow();
  });
});

describe('who may change plan', () => {
  it('never lets a run agent charge the card or undo a change, while a preview stays open to it', async () => {
    const account = {
      assertConfigured: vi.fn(),
      planChangePreview: vi.fn(async () => QUOTE),
      planChangeApply: vi.fn(async () => UPGRADED),
      planChangeCancel: vi.fn(async () => UPGRADED),
    };
    const app = express();
    app.use(express.json());
    registerOpenPixoAccountRoutes(app, { account: account as unknown as OpenPixoAccountService });
    const server = createServer(app).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    const post = (route: string, body: unknown, token?: string) => fetch(`http://127.0.0.1:${port}/api/openpixo/credits${route}`, {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    try {
      const sku = { sku: 'plan_pro_monthly', expectedChargeMinor: 1410 };
      expect((await post('/plan-change', sku, 'pixott_any-token')).status).toBe(403);
      expect((await post('/plan-change/cancel', {}, 'pixott_any-token')).status).toBe(403);
      expect(account.planChangeApply).not.toHaveBeenCalled();
      expect(account.planChangeCancel).not.toHaveBeenCalled();
      expect((await post('/plan-change/preview', sku, 'pixott_any-token')).status).toBe(200);
      expect((await post('/plan-change', sku)).status).toBe(200);
      expect(account.planChangeApply).toHaveBeenCalledWith('plan_pro_monthly', 1410);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe('plan change through the daemon', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  let initialExitCode: typeof process.exitCode;
  beforeEach(() => {
    initialExitCode = process.exitCode;
    vi.stubEnv('PIXO_API_TOKEN', 'local-test-api-token');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) await close();
    process.exitCode = initialExitCode;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function signedIn(reply: (body: Record<string, unknown>) => unknown) {
    const h = await accountHarness();
    cleanup.push(h.close);
    await h.signIn();
    h.cloud.handlers.set('POST /functions/v1/plan-change', (request) => ({ body: reply(request.body) }));
    const sent = () => h.cloud.requests.filter((request) => request.url.pathname === '/functions/v1/plan-change').map((request) => request.body);
    return { h, sent };
  }

  it('sends the agreed amount to the cloud and refuses a request with no amount', async () => {
    const { h, sent } = await signedIn(() => UPGRADED);
    expect((await h.json('/credits/plan-change', 'POST', { sku: 'plan_pro_monthly', expectedChargeMinor: 1410 })).status).toBe(200);
    expect(sent()).toEqual([{ action: 'apply', sku: 'plan_pro_monthly', expectedChargeMinor: 1410 }]);
    expect((await h.json('/credits/plan-change', 'POST', { sku: 'plan_pro_monthly' })).body.error.code).toBe('BILLING_PLAN_QUOTE_CHANGED');
    expect(sent()).toHaveLength(1);
  });

  it('passes a refusal from the cloud through with its own code', async () => {
    const { h } = await signedIn(() => ({}));
    h.cloud.handlers.set('POST /functions/v1/plan-change', () => ({ status: 409, body: { error: { code: 'BILLING_PLAN_ENDING', message: 'cloud words' } } }));
    expect((await h.json('/credits/plan-change/preview', 'POST', { sku: 'plan_pro_monthly' })).body.error.code).toBe('BILLING_PLAN_ENDING');
  });

  it('says the balance moved after a change, and on the stream the UI listens to', async () => {
    const { h } = await signedIn(() => UPGRADED);
    const response = await h.request('/api/openpixo/credits/events');
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value);
    expect(text).toContain(': connected');
    await h.json('/credits/plan-change', 'POST', { sku: 'plan_pro_monthly', expectedChargeMinor: 1410 });
    while (!text.includes('event: changed')) text += decoder.decode((await reader.read()).value);
    await reader.cancel();
  });

  it('shows the price first in the CLI and charges only with --yes', async () => {
    const { h, sent } = await signedIn((body) => (body.action === 'preview' ? QUOTE : UPGRADED));
    await runCreditsCli(['change-plan', 'plan_pro_monthly', '--daemon-url', h.url]);
    expect(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])).toContain('$14.10');
    expect(sent().map((body) => body.action)).toEqual(['preview']);

    await runCreditsCli(['change-plan', 'plan_pro_monthly', '--yes', '--json', '--no-browser', '--daemon-url', h.url]);
    expect(sent().map((body) => body.action)).toEqual(['preview', 'preview', 'apply']);
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))).toMatchObject({ outcome: 'upgraded' });
  });

  it('exits non-zero in the CLI when the card is declined', async () => {
    const { h } = await signedIn((body) => (body.action === 'preview' ? QUOTE : { ...UPGRADED, outcome: 'payment_failed', declineCode: 'card_declined' }));
    await runCreditsCli(['change-plan', 'plan_pro_monthly', '--yes', '--daemon-url', h.url]);
    expect(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])).toContain('card_declined');
    expect(process.exitCode).toBe(5);
  });
});
