// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingView, type OnboardingViewProps } from '../../../src/components/onboarding/OnboardingView';
import { resetOpenPixoAccountStoreForTests } from '../../../src/hooks/useOpenPixoAccount';
import { I18nProvider } from '../../../src/i18n';
import { openExternalUrl } from '../../../src/providers/registry';
import { DEFAULT_CONFIG } from '../../../src/state/config';
import { REMIX_ICON_PATHS } from '../../../src/components/remix-icon-paths';
import type { AgentInfo, AppConfig } from '../../../src/types';
import { callsTo, installAccountFetch, NOT_CONFIGURED, SIGNED_IN, SIGNED_OUT, type RouteReply } from '../../helpers/account-fetch';

vi.mock('../../../src/providers/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/providers/registry')>(),
  openExternalUrl: vi.fn(async () => true),
}));

// Runtime verification has its own tests. This boundary verifies that a
// successful runtime setup persists the selected path before reaching ready.
vi.mock('../../../src/components/onboarding/AgentSetup', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/components/onboarding/AgentSetup')>(),
  AgentSetup: ({ agents, config, onConfigPersist, onFinish }: {
    agents: AgentInfo[];
    config: AppConfig;
    onConfigPersist: (next: AppConfig) => Promise<void> | void;
    onFinish: (verified: boolean) => void;
  }) => (
    <><span data-testid="setup-agents">{agents.map((agent) => agent.id).join(',')}</span><button type="button" onClick={async () => {
      await onConfigPersist({ ...config, mode: 'daemon', agentId: 'codex' });
      onFinish(true);
    }}>
      Finish runtime setup
    </button><button type="button" onClick={async () => {
      await onConfigPersist({ ...config, mode: 'daemon', agentId: 'codex' });
      onFinish(false);
    }}>Skip check</button></>
  ),
}));

const CODEX: AgentInfo = { id: 'codex', name: 'Codex', bin: 'codex', available: true, authStatus: 'ok' };
const CODEX_READY = { providers: { 'codex-cli': { available: true, keyless: true } } };
const CODEX_SIGNED_OUT = { providers: { 'codex-cli': { available: false, keyless: true, reasonCode: 'CODEX_CLI_AUTH_REQUIRED' } } };
const NO_CREDITS = { available: 0, reserved: 0, subscription: null };
const PLAN_CREDITS = {
  available: 600, reserved: 0,
  subscription: {
    sku: 'plan_starter_monthly_v3', status: 'active', monthlyCredits: 600,
    currentPeriodEnd: '2026-12-03T00:00:00Z', cancelAtPeriodEnd: false,
  },
};
const CATALOG = {
  purchasesPaused: false,
  plans: [
    { sku: 'plan_starter_monthly_v3', monthlyCredits: 600, amountMinor: 490, currency: 'usd', interval: 'month', paymentMethods: ['card'] },
    { sku: 'plan_pro_monthly', monthlyCredits: 2500, amountMinor: 1900, currency: 'usd', interval: 'month', paymentMethods: ['card'] },
    { sku: 'plan_studio_monthly', monthlyCredits: 8500, amountMinor: 5900, currency: 'usd', interval: 'month', paymentMethods: ['card'] },
  ],
  topups: [{ sku: 'topup_1000', credits: 1000, amountMinor: 1000, currency: 'usd', paymentMethods: ['card', 'alipay'] }],
};
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_onboarding';

function routes(extra: Record<string, RouteReply | RouteReply[]> = {}) {
  return installAccountFetch({
    'GET /api/openpixo/account': SIGNED_OUT,
    'POST /api/openpixo/account/email/start': { resendAfterSec: 30 },
    'POST /api/openpixo/account/email/verify': SIGNED_IN,
    'GET /api/openpixo/credits': NO_CREDITS,
    'GET /api/openpixo/credits/catalog': CATALOG,
    'POST /api/openpixo/credits/checkout': { checkoutUrl: CHECKOUT_URL, checkoutId: 'cs_test_onboarding' },
    'GET /api/media/config': CODEX_SIGNED_OUT,
    ...extra,
  });
}

/** Holds config like App does, so a persisted key or agent shows on the next render. */
function renderOnboarding(overrides: Partial<OnboardingViewProps> = {}, initial: Partial<AppConfig> = {}) {
  const persisted: AppConfig[] = [];
  const onFinish = vi.fn();
  const onStartSample = vi.fn();
  function Harness() {
    const [config, setConfig] = useState<AppConfig>({ ...DEFAULT_CONFIG, account: null, agentId: null, ...initial });
    const props: OnboardingViewProps = {
      config,
      agents: [],
      daemonLive: true,
      onModeChange: vi.fn(),
      onAgentChange: vi.fn(),
      onAgentModelChange: vi.fn(),
      onApiProtocolChange: vi.fn(),
      onApiModelChange: vi.fn(),
      onConfigPersist: async (next) => { persisted.push(next); setConfig(next); },
      onRefreshAgents: vi.fn(() => []),
      onFinish,
      onStartSample,
      ...overrides,
    };
    return <OnboardingView {...props} />;
  }
  render(<I18nProvider initial="en"><Harness /></I18nProvider>);
  return { persisted, onFinish, onStartSample, last: () => persisted[persisted.length - 1] };
}

async function signInWithEmail() {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Email address' }), { target: { value: 'mina@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Verification code' }), { target: { value: '123456' } });
}

/** Takes the own-tools road, answering its check screen when it is asked. */
async function chooseOwnTools() {
  fireEvent.click(await screen.findByTestId('onboarding-own-tools'));
  const confirm = screen.queryByTestId('onboarding-own-tools-confirm');
  if (confirm) fireEvent.click(confirm);
  await screen.findByRole('heading', { name: 'Set up image generation' });
}

beforeEach(() => {
  routes();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetOpenPixoAccountStoreForTests();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('OnboardingView · welcome', () => {
  it('leads with the subscription sign-in and keeps own tools clearly visible', async () => {
    renderOnboarding();

    expect(screen.getByRole('heading', { name: /Describe a game\.\s+Play it\./ })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Email address' })).toBeTruthy();
    // Each way in says what it costs and what it needs, so a newcomer can tell them apart.
    expect(screen.getByText(/costs a little, and credits pay for all of it/)).toBeTruthy();
    const credits = screen.getByTestId('onboarding-credits-choice');
    expect(credits.textContent).toContain('Recommended');
    expect(credits.textContent).toContain('Nothing to install, no keys');
    expect(within(credits).getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    const ownTools = screen.getByTestId('onboarding-own-tools');
    expect(ownTools.textContent).toContain('Use my own AI accounts');
    // Newcomers read "no OpenPixo credits" as "free"; this road says it is not.
    expect(ownTools.textContent).toMatch(/already pay for ChatGPT, Claude or an AI API\. Not free: those companies bill you instead\. You'll use a terminal\./);
    // The welcome is a choice between two roads, not step one of either.
    expect(screen.queryByRole('list', { name: /Step \d of \d/ })).toBeNull();
  });

  it('shows live prices like a pricing page before sign-in, and starts no checkout', async () => {
    const fetchMock = routes();
    renderOnboarding();
    fireEvent.click(await screen.findByTestId('onboarding-see-prices'));

    const dialog = await screen.findByRole('dialog', { name: 'Choose your plan' });
    const starter = await within(dialog).findByTestId('onboarding-pricing-plan_starter_monthly_v3');
    const pro = within(dialog).getByTestId('onboarding-pricing-plan_pro_monthly');
    const max = within(dialog).getByTestId('onboarding-pricing-plan_studio_monthly');
    // Each plan says what size of game it is for.
    expect(starter.textContent).toContain('Make a small game.');
    expect(pro.textContent).toContain('Make several small games, or one medium-sized game.');
    expect(max.textContent).toContain('Make a large game, or a long-running project.');
    expect(pro.textContent).toContain('Popular');
    // A plain "$", never "US$".
    expect(within(pro).getByLabelText('$19')).toBeTruthy();
    expect(pro.textContent).not.toContain('US$');
    // What the credits buy, at the hosted prices (4 per image, 7 per sound effect, 60 per 3D model).
    const lines = (card: HTMLElement) => [...card.querySelectorAll('li')].map((li) => li.textContent);
    // Credits as "base + bonus": $19 buys 1,900 in packs, and the plan gives 2,500.
    const credits = within(pro).getByTestId('onboarding-pricing-credits');
    expect(credits.textContent).toBe('1,900 credits every month+600 bonus2,500 credits in total');
    expect(within(starter).getByTestId('onboarding-pricing-credits').textContent).toContain('490 credits every month+110 bonus');
    expect(within(max).getByTestId('onboarding-pricing-credits').textContent).toContain('5,900 credits every month+2,600 bonus');
    expect(lines(pro)).toEqual([
      'About 625 art images', 'About 357 sound effects', 'About 41 3D models',
      'Share up to 30 games with a link', 'Multiplayer rooms',
    ]);
    // Starter lists no multiplayer rooms.
    expect(lines(starter)).toEqual([
      'About 150 art images', 'About 85 sound effects', 'About 10 3D models', 'Share up to 10 games with a link',
    ]);
    // Customer-facing: no "cancel anytime" promise.
    expect(dialog.textContent).not.toMatch(/Cancel anytime/);
    // The hosted agent models by name; before sign-in the cloud refuses the live list, so the known list shows.
    const models = within(dialog).getByTestId('onboarding-pricing-models');
    expect(models.textContent).toContain('Every plan and credit pack includes');
    expect([...models.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Claude Sonnet 5.5', 'GPT-6.1 Sol', 'GPT-6.1 Terra', 'GPT-6 Luna',
      'Claude Haiku 5.5', 'DeepSeek V4.1 Flash', 'GLM 5.3 Flash', 'Tencent Hy4',
    ]);
    // Every button leads to logging in.
    for (const card of [starter, pro, max]) expect(within(card).getByRole('button', { name: 'Log in' })).toBeTruthy();
    // An en-US system shows the dollar price alone.
    expect(within(pro).getByTestId('onboarding-pricing-local').textContent?.trim()).toBe('');
    // Max gives 8,500 / $59 = 144 credits per dollar against 100 for packs.
    expect(within(dialog).getByRole('tab', { name: /Monthly plan.*Up to 44% more credits/ })).toBeTruthy();

    // Card plans also take Apple Pay and Google Pay through Stripe Checkout.
    const marks = () => [...within(dialog).getByTestId('payment-marks').querySelectorAll('li')].map((li) => li.getAttribute('data-mark'));
    expect(marks()).toEqual(['card', 'apple-pay', 'google-pay']);
    expect(within(dialog).getByText('Apple Pay')).toBeTruthy();
    expect(within(dialog).getByText('Google Pay')).toBeTruthy();

    // Monthly plans take no Alipay here, so Alipay buyers are pointed at packs in one click.
    const hint = within(dialog).getByTestId('onboarding-pricing-alipay-hint');
    expect(hint.textContent).toContain('Paying with Alipay? Monthly plans take cards only for now.');
    fireEvent.click(within(hint).getByRole('button', { name: 'Buy a credit pack' }));
    expect(within(dialog).getByRole('tab', { name: 'One-time credit pack' }).getAttribute('aria-selected')).toBe('true');
    expect(within(dialog).queryByTestId('onboarding-pricing-alipay-hint')).toBeNull();
    const pack = within(dialog).getByTestId('onboarding-pricing-topup_1000');
    expect(within(pack).getByLabelText('$10')).toBeTruthy();
    // Packs alone cannot publish games, so they list no share links.
    expect(lines(pack)).toEqual(['About 250 art images', 'About 142 sound effects', 'About 16 3D models', 'Credits never expire']);
    expect(marks()).toEqual(['card', 'apple-pay', 'google-pay', 'alipay']);

    // Looking costs nothing: no checkout is started from this window.
    expect(callsTo(fetchMock, 'POST', '/api/openpixo/credits/checkout')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose your plan' })).toBeNull());
  });

  it('lists the live hosted models when the cloud answers, never who serves them', async () => {
    routes({ 'GET /api/openpixo/agent/models': {
      signedIn: false,
      models: [
        { id: 'openpixo-agent-flash', label: 'DeepSeek V4.1 Flash' },
        { id: 'openpixo-agent-claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
        { id: 'openpixo-agent-new', label: 'Brand New 1' },
      ],
    } });
    renderOnboarding();
    fireEvent.click(await screen.findByTestId('onboarding-see-prices'));

    const models = await screen.findByTestId('onboarding-pricing-models');
    await waitFor(() => expect([...models.querySelectorAll('li')].map((li) => li.textContent))
      .toEqual(['Claude Sonnet 5.5', 'DeepSeek V4.1 Flash', 'Brand New 1']));
    expect(models.textContent).not.toMatch(/OpenRouter|openrouter|vendor/);
  });

  it('adds an estimate in the local currency from the daily rates', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-CN', 'en-US']);
    routes({ 'GET /api/exchange-rates': {
      base: 'USD', date: '2026-11-18', fetchedAt: '2026-11-19T08:00:00.000Z', stale: false,
      rates: { USD: 1, CNY: 6.6672 },
    } });
    renderOnboarding();
    fireEvent.click(await screen.findByTestId('onboarding-see-prices'));

    const pro = await screen.findByTestId('onboarding-pricing-plan_pro_monthly');
    await waitFor(() => expect(within(pro).getByTestId('onboarding-pricing-local').textContent).toBe('≈ ¥127 in your currency'));
    expect(within(pro).getByLabelText('$19')).toBeTruthy();
    expect(screen.getByText(/Prices in US dollars; local prices are estimates/)).toBeTruthy();
  });

  it('carries a plan picked from the prices to the plan step after sign-in', async () => {
    renderOnboarding({ agents: [CODEX] });
    fireEvent.click(await screen.findByTestId('onboarding-see-prices'));
    fireEvent.click(await screen.findByTestId('onboarding-pricing-choose-plan_pro_monthly'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose your plan' })).toBeNull());

    await signInWithEmail();
    await screen.findByRole('heading', { name: 'Choose a plan' });
    await waitFor(() => expect(screen.getByTestId('onboarding-plan-plan_pro_monthly').getAttribute('aria-checked')).toBe('true'));
  });

  it('carries a credit pack picked from the prices to the packs list', async () => {
    renderOnboarding({ agents: [CODEX] });
    fireEvent.click(await screen.findByTestId('onboarding-see-prices'));
    fireEvent.click(await screen.findByTestId('onboarding-pricing-tab-packs'));
    fireEvent.click(await screen.findByTestId('onboarding-pricing-choose-topup_1000'));

    await signInWithEmail();
    await waitFor(() => expect(screen.getByTestId('onboarding-plan-topup_1000').getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByTestId('onboarding-plan-kind-packs').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the product at a glance as one described picture, on the welcome step only', async () => {
    renderOnboarding();

    const hero = screen.getByRole('img', { name: /tiny diver/ });
    expect(hero.querySelector('svg')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    await chooseOwnTools();
    expect(screen.queryByTestId('onboarding-hero')).toBeNull();
  });

  it('leaves focus alone on the first screen', async () => {
    renderOnboarding();

    const email = await screen.findByRole('textbox', { name: 'Email address' });
    expect(document.activeElement).not.toBe(email);
  });

  it('starts on own tools when this build has no account service', async () => {
    routes({ 'GET /api/openpixo/account': NOT_CONFIGURED });
    renderOnboarding();
    fireEvent.click(await screen.findByRole('button', { name: 'Get started' }));
    expect(await screen.findByRole('heading', { name: 'Set up image generation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
  });
});

describe('OnboardingView · own tools check', () => {
  it('asks for a paid AI account and a terminal before the own-tools steps begin', async () => {
    renderOnboarding();
    fireEvent.click(await screen.findByTestId('onboarding-own-tools'));

    expect(await screen.findByRole('heading', { name: 'Before you go this way' })).toBeTruthy();
    expect(screen.getByText(/A free ChatGPT or Claude account isn't enough to build a game/)).toBeTruthy();
    expect(screen.getByText('Comfort with a terminal')).toBeTruthy();
    expect(screen.queryByRole('list', { name: /Step \d of \d/ })).toBeNull();

    fireEvent.click(screen.getByTestId('onboarding-own-tools-confirm'));
    expect(await screen.findByRole('heading', { name: 'Set up image generation' })).toBeTruthy();
  });

  it('sends someone without them back to credits and sign-in', async () => {
    renderOnboarding();
    fireEvent.click(await screen.findByTestId('onboarding-own-tools'));
    fireEvent.click(await screen.findByTestId('onboarding-use-credits'));

    expect(await screen.findByRole('heading', { name: /Describe a game\.\s+Play it\./ })).toBeTruthy();
    await signInWithEmail();
    expect(await screen.findByRole('heading', { name: 'Choose a plan' })).toBeTruthy();
  });

  it('skips the check when an agent is already signed in on this computer', async () => {
    renderOnboarding({ agents: [CODEX] });

    expect((await screen.findByTestId('onboarding-own-tools-found')).textContent).toBe('Codex is already set up on this computer');
    fireEvent.click(screen.getByTestId('onboarding-own-tools'));
    expect(await screen.findByRole('heading', { name: 'Set up image generation' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Before you go this way' })).toBeNull();
  });

  it('offers credits to an own-tools user who ends with something missing', async () => {
    renderOnboarding();
    await chooseOwnTools();
    fireEvent.click(screen.getByTestId('onboarding-skip'));
    await screen.findByRole('heading', { name: 'Set up the AI agent' });
    fireEvent.click(screen.getByTestId('onboarding-skip'));
    await screen.findByRole('heading', { name: 'Almost ready' });

    fireEvent.click(screen.getByTestId('onboarding-use-credits'));
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeTruthy();
  });
});

describe('OnboardingView · own tools path', () => {
  it('does not offer the credit-paid agent to someone who cannot pay with credits', async () => {
    const HOSTED: AgentInfo = { id: 'openpixo-agent', name: 'OpenPixo (credits)', bin: 'opencode', available: true, authStatus: 'ok' };
    renderOnboarding({ agents: [CODEX, HOSTED] });
    await chooseOwnTools();
    fireEvent.click(screen.getByTestId('onboarding-skip'));

    expect((await screen.findByTestId('setup-agents')).textContent).toBe('codex');
  });
});

describe('OnboardingView · subscription path', () => {
  it('signs in, picks a plan, hands off to Stripe checkout and moves on when credits arrive', async () => {
    // Credits land only after the browser checkout (the webhook), never before.
    let paid = false;
    const fetchMock = routes({
      'GET /api/openpixo/credits': () => (paid ? PLAN_CREDITS : NO_CREDITS),
      'POST /api/openpixo/credits/checkout': () => ({ checkoutUrl: CHECKOUT_URL, checkoutId: 'cs_test_onboarding' }),
    });
    const flow = renderOnboarding({ agents: [CODEX] });
    await signInWithEmail();

    expect(await screen.findByRole('heading', { name: 'Choose a plan' })).toBeTruthy();
    expect(await screen.findByTestId('onboarding-plan-plan_starter_monthly_v3')).toBeTruthy();
    expect(screen.getByTestId('onboarding-plan-plan_starter_monthly_v3').getAttribute('aria-checked')).toBe('true');
    expect(within(screen.getByTestId('onboarding-plan-plan_pro_monthly')).getByText('Popular')).toBeTruthy();
    expect(screen.getByText('Max')).toBeTruthy();
    // The plan step sends Alipay buyers to packs too.
    fireEvent.click(within(screen.getByTestId('onboarding-plan-alipay-hint')).getByRole('button', { name: 'Buy a credit pack' }));
    expect(screen.getByTestId('onboarding-plan-topup_1000').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /Monthly plan/ }));

    // Monthly plans and one-time packs sit side by side, each saying how it can be paid.
    const monthly = screen.getByRole('tab', { name: /Monthly plan/ });
    const packs = screen.getByRole('tab', { name: /One-time credit pack/ });
    expect(monthly.getAttribute('aria-selected')).toBe('true');
    expect(monthly.textContent).toContain('Card');
    expect(monthly.textContent).not.toContain('Alipay');
    expect(packs.textContent).toContain('Card · Alipay');
    fireEvent.click(packs);
    expect(screen.getByTestId('onboarding-plan-topup_1000').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(monthly);
    expect(screen.getByTestId('onboarding-plan-plan_starter_monthly_v3').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByTestId('onboarding-plan-plan_pro_monthly'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    expect(await screen.findByTestId('onboarding-checkout-waiting')).toBeTruthy();
    const checkout = callsTo(fetchMock, 'POST', '/api/openpixo/credits/checkout');
    expect(JSON.parse(String(checkout[0]?.[1]?.body))).toEqual({ sku: 'plan_pro_monthly' });
    expect(openExternalUrl).toHaveBeenCalledWith(CHECKOUT_URL);

    paid = true;
    fireEvent.click(screen.getByRole('button', { name: "I've paid, check now" }));
    expect(await screen.findByRole('heading', { name: "You're all set" })).toBeTruthy();
    expect(within(screen.getByTestId('onboarding-check-image')).getByText('OpenPixo cloud, paid with credits')).toBeTruthy();
    expect(within(screen.getByTestId('onboarding-check-agent')).getByText('Codex on this computer')).toBeTruthy();
    expect(screen.getByTestId('onboarding-credits').textContent).toBe('600');

    fireEvent.click(screen.getByRole('button', { name: 'Go to home' }));
    await waitFor(() => expect(flow.onFinish).toHaveBeenCalledTimes(1));
    expect(flow.last()).toMatchObject({ account: { mode: 'cloud' }, mode: 'daemon', agentId: 'codex' });
  });

  it('skips the plan step for someone who already has a plan', async () => {
    routes({ 'GET /api/openpixo/account': SIGNED_IN, 'GET /api/openpixo/credits': PLAN_CREDITS });
    renderOnboarding({ agents: [CODEX] });
    expect(await screen.findByText('Signed in as mina@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: "You're all set" })).toBeTruthy();
  });

  it('skips the plan without a second question and ends saying what is missing', async () => {
    const flow = renderOnboarding();
    await signInWithEmail();
    await screen.findByRole('heading', { name: 'Choose a plan' });

    fireEvent.click(screen.getByTestId('onboarding-skip'));

    expect(await screen.findByRole('heading', { name: 'Almost ready' })).toBeTruthy();
    expect(within(screen.getByTestId('onboarding-check-image')).getByText(/no generated art yet/)).toBeTruthy();
    expect(within(screen.getByTestId('onboarding-check-agent')).getByText(/no game-making yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open a sample game' })).toBeNull();
    fireEvent.click(screen.getByTestId('onboarding-finish-anyway'));
    await waitFor(() => expect(flow.onFinish).toHaveBeenCalledTimes(1));
  });

  it('sends a missing agent on the subscription path to the agent step and back', async () => {
    routes({ 'GET /api/openpixo/account': SIGNED_IN, 'GET /api/openpixo/credits': PLAN_CREDITS });
    renderOnboarding();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Almost ready' });

    fireEvent.click(within(screen.getByTestId('onboarding-check-agent')).getByRole('button', { name: 'Set up' }));
    await screen.findByRole('heading', { name: 'Set up the AI agent' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Almost ready' })).toBeTruthy();
  });
});

describe('OnboardingView · own tools', () => {
  it('shows a neutral agent after skipping its check', async () => {
    routes({ 'GET /api/media/config': CODEX_READY });
    renderOnboarding({ agents: [CODEX] });
    await chooseOwnTools();
    fireEvent.click(await screen.findByTestId('onboarding-step-continue'));
    await screen.findByRole('heading', { name: 'Set up the AI agent' });
    // One way past a found agent: its check, not a second skip beside it.
    expect(screen.queryByTestId('onboarding-skip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Skip check' }));
    const row = await screen.findByTestId('onboarding-check-agent');
    expect(within(row).getByText('Found, not tested')).toBeTruthy();
    expect(row.getAttribute('data-ready')).toBe('untested');
    expect(row.querySelector('svg path')?.getAttribute('d')).not.toBe(REMIX_ICON_PATHS.check);
    expect(screen.getByRole('heading', { name: 'Almost ready' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: "You're all set" })).toBeNull();
    const steps = within(screen.getByRole('list', { name: 'Step 3 of 3' })).getAllByRole('listitem');
    expect(steps[1]?.getAttribute('data-state')).not.toBe('done');
  });

  it('walks image generation then the agent, with live Codex status', async () => {
    const fetchMock = routes({ 'GET /api/media/config': [CODEX_SIGNED_OUT, CODEX_READY] });
    const flow = renderOnboarding({ agents: [CODEX] });
    await chooseOwnTools();

    expect(screen.getByRole('list', { name: 'Step 1 of 3' })).toBeTruthy();
    expect(await screen.findByText('codex login')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-step-continue')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByTestId('onboarding-image-codex-ready')).toBeTruthy();
    expect(callsTo(fetchMock, 'GET', '/api/media/config').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByTestId('onboarding-step-continue'));
    await screen.findByRole('heading', { name: 'Set up the AI agent' });
    fireEvent.click(screen.getByRole('button', { name: 'Finish runtime setup' }));

    expect(await screen.findByRole('heading', { name: "You're all set" })).toBeTruthy();
    expect(within(screen.getByTestId('onboarding-check-image')).getByText('Codex with your ChatGPT account')).toBeTruthy();
    expect(screen.getByTestId('onboarding-check-agent').getAttribute('data-ready')).toBe('true');
    expect(screen.queryByText('Found, not tested')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open a sample game' }));
    await waitFor(() => expect(flow.onStartSample).toHaveBeenCalledTimes(1));
    expect(flow.onFinish).toHaveBeenCalledTimes(1);
    expect(flow.last()).toMatchObject({ account: { mode: 'byok' }, agentId: 'codex' });
  });

  it('tells a Codex desktop user that OpenPixo needs the command-line version', async () => {
    routes({ 'GET /api/media/config': { providers: { 'codex-cli': { available: false, keyless: true, reasonCode: 'CODEX_CLI_NOT_FOUND' } } } });
    renderOnboarding({ agents: [{ ...CODEX, available: false, authStatus: undefined, vendorSignInWithoutCli: true }] });
    await chooseOwnTools();

    const note = await screen.findByTestId('onboarding-image-codex-app-without-cli');
    expect(note.textContent).toContain('Codex desktop app');
    expect(note.textContent).toContain('command-line version');
    expect(screen.getByRole('button', { name: 'Copy for your AI: Codex CLI' })).toBeTruthy();
  });

  it('checks an image key for free, then saves it where Settings keeps media keys', async () => {
    const fetchMock = routes({
      'POST /api/provider/models': { ok: true, kind: 'success', latencyMs: 12, models: [{ id: 'gpt-image-2', label: 'gpt-image-2' }] },
    });
    const flow = renderOnboarding();
    await chooseOwnTools();

    fireEvent.click(screen.getByTestId('onboarding-image-key'));
    expect(screen.getByText(/Open platform\.openai\.com and sign in/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-test-onboarding' } });
    fireEvent.click(screen.getByTestId('onboarding-image-key-save'));

    expect(await screen.findByTestId('onboarding-image-key-ready')).toBeTruthy();
    const request = JSON.parse(String(callsTo(fetchMock, 'POST', '/api/provider/models')[0]?.[1]?.body));
    expect(request).toMatchObject({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test-onboarding' });
    expect(flow.last()?.mediaProviders?.openai).toMatchObject({ apiKey: 'sk-test-onboarding', baseUrl: 'https://api.openai.com/v1' });
    expect(flow.last()?.account).toEqual({ mode: 'byok' });
    expect(screen.getByTestId('onboarding-step-continue')).toBeTruthy();
  });

  it('does not save a key the provider refused', async () => {
    routes({ 'POST /api/provider/models': { ok: false, kind: 'auth_failed', latencyMs: 30, status: 401 } });
    const flow = renderOnboarding();
    await chooseOwnTools();
    fireEvent.click(screen.getByTestId('onboarding-image-key'));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-wrong' } });
    fireEvent.click(screen.getByTestId('onboarding-image-key-save'));

    expect(await screen.findByText(/That key was refused/)).toBeTruthy();
    expect(flow.persisted).toHaveLength(0);
    expect(screen.queryByTestId('onboarding-step-continue')).toBeNull();
  });

  it('moves on when image generation is skipped', async () => {
    renderOnboarding();
    await chooseOwnTools();
    fireEvent.click(screen.getByTestId('onboarding-skip'));
    expect(await screen.findByRole('heading', { name: 'Set up the AI agent' })).toBeTruthy();
    // The stepper does not claim a skipped step is done.
    const steps = within(screen.getByRole('list', { name: 'Step 2 of 3' })).getAllByRole('listitem');
    expect(steps[0]?.getAttribute('data-state')).toBe('skipped');
  });
});

describe('OnboardingView · returning users', () => {
  it('finishes by itself for an own-tools user whose tools still work', async () => {
    routes({ 'GET /api/media/config': CODEX_READY });
    const flow = renderOnboarding({ agents: [CODEX] }, { account: { mode: 'byok' }, agentId: 'codex' });
    await waitFor(() => expect(flow.onFinish).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { name: /Describe a game\.\s+Play it\./ })).toBeNull();
  });

  it('still shows the welcome on a first run, even with Codex ready', async () => {
    routes({ 'GET /api/media/config': CODEX_READY });
    const flow = renderOnboarding({ agents: [CODEX] });
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    expect(flow.onFinish).not.toHaveBeenCalled();
  });

  it('asks a signed-out subscriber to sign in again', async () => {
    routes({ 'GET /api/media/config': CODEX_READY });
    const flow = renderOnboarding({ agents: [CODEX] }, { account: { mode: 'cloud' }, agentId: 'codex' });
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    expect(flow.onFinish).not.toHaveBeenCalled();
  });
});
