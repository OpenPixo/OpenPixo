// @vitest-environment jsdom
// First run for someone this installation never offered the walkthrough: they see
// a game work before being asked to pay. A re-run of setup keeps the plans step
// (OnboardingView.flow.test.tsx, where `offerGuide` is off).
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingView, type OnboardingViewProps } from '../../../src/components/onboarding/OnboardingView';
import { resetOpenPixoAccountStoreForTests } from '../../../src/hooks/useOpenPixoAccount';
import { I18nProvider } from '../../../src/i18n';
import { DEFAULT_CONFIG } from '../../../src/state/config';
import { readFirstRunGuide, resetFirstRunGuideForTests } from '../../../src/state/first-run-guide';
import type { AppConfig } from '../../../src/types';
import { callsTo, installAccountFetch, SIGNED_IN, SIGNED_OUT, type RouteReply } from '../../helpers/account-fetch';

const CATALOG = {
  purchasesPaused: false,
  plans: [{ sku: 'plan_starter_monthly_v3', monthlyCredits: 600, amountMinor: 490, currency: 'usd', interval: 'month', paymentMethods: ['card'] }],
  topups: [{ sku: 'topup_1000', credits: 1000, amountMinor: 1000, currency: 'usd', paymentMethods: ['card', 'alipay'] }],
};
let fetchMock: ReturnType<typeof installAccountFetch>;

function routes(extra: Record<string, RouteReply | RouteReply[]> = {}) {
  fetchMock = installAccountFetch({
    'GET /api/openpixo/account': SIGNED_OUT,
    'POST /api/openpixo/account/email/start': { resendAfterSec: 30 },
    'POST /api/openpixo/account/email/verify': SIGNED_IN,
    'GET /api/openpixo/credits': { available: 0, reserved: 0, subscription: null },
    'GET /api/openpixo/credits/catalog': CATALOG,
    'GET /api/media/config': { providers: { 'codex-cli': { available: false, keyless: true } } },
    'PUT /api/app-config': (_url: URL, init?: RequestInit) => ({ config: JSON.parse(String(init?.body)) }),
    ...extra,
  });
}

function renderNewUser(overrides: Partial<OnboardingViewProps> = {}) {
  const persisted: AppConfig[] = [];
  const handlers = { onFinish: vi.fn(), onStartSample: vi.fn(), onStartGuide: vi.fn() };
  function Harness() {
    const [config, setConfig] = useState<AppConfig>({ ...DEFAULT_CONFIG, account: null, agentId: null });
    return <OnboardingView config={config} agents={[]} daemonLive onModeChange={vi.fn()} onAgentChange={vi.fn()}
      onAgentModelChange={vi.fn()} onApiProtocolChange={vi.fn()} onApiModelChange={vi.fn()} onRefreshAgents={vi.fn(() => [])}
      onConfigPersist={async (next) => { persisted.push(next); setConfig(next); }} offerGuide {...handlers} {...overrides} />;
  }
  render(<I18nProvider initial="en"><Harness /></I18nProvider>);
  return { ...handlers, last: () => persisted[persisted.length - 1] };
}

async function signIn() {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Email address' }), { target: { value: 'mina@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Verification code' }), { target: { value: '123456' } });
}

beforeEach(() => {
  localStorage.clear();
  resetFirstRunGuideForTests();
  resetOpenPixoAccountStoreForTests();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  routes();
});
afterEach(() => { cleanup(); resetFirstRunGuideForTests(); resetOpenPixoAccountStoreForTests(); vi.unstubAllGlobals(); });

describe('a new user on credits', () => {
  it('is asked one question after signing in, never to pay', async () => {
    renderNewUser();
    await signIn();
    expect(await screen.findByRole('heading', { name: 'Have you made a game before?' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Choose a plan' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Step 2 of 2' })).toBeTruthy();
    expect(callsTo(fetchMock, 'POST', '/api/openpixo/credits/checkout')).toHaveLength(0);
  });

  it.each(['first', 'some'] as const)('walks "%s" through the sample and remembers the answer', async (level) => {
    const view = renderNewUser();
    await signIn();
    fireEvent.click(await screen.findByTestId(`onboarding-experience-${level}`));
    await waitFor(() => expect(view.onStartGuide).toHaveBeenCalledOnce());
    expect(view.onFinish).toHaveBeenCalledOnce();
    expect(view.onStartSample).not.toHaveBeenCalled();
    expect(view.last()).toMatchObject({ gameExperience: level, account: { mode: 'cloud' } });
  });

  it('takes an experienced user Home, with no walkthrough or hints to come', async () => {
    const view = renderNewUser();
    await signIn();
    fireEvent.click(await screen.findByTestId('onboarding-experience-experienced'));
    await waitFor(() => expect(view.onFinish).toHaveBeenCalledOnce());
    expect(view.onStartGuide).not.toHaveBeenCalled();
    expect(view.last()).toMatchObject({ gameExperience: 'experienced' });
    expect(readFirstRunGuide()).toMatchObject({ status: 'skipped', hintsSeen: ['plan', 'art', 'stage', 'share'] });
  });

  it('can go Home without answering, leaving the question and the walkthrough for later', async () => {
    const view = renderNewUser();
    await signIn();
    fireEvent.click(await screen.findByTestId('onboarding-experience-skip'));
    await waitFor(() => expect(view.onFinish).toHaveBeenCalledOnce());
    expect(view.last()?.gameExperience ?? null).toBeNull();
    expect(readFirstRunGuide()).toBeUndefined();
  });

  it('still pays first when a plan was already picked, and can put that off', async () => {
    renderNewUser();
    fireEvent.click(await screen.findByTestId('onboarding-see-prices'));
    fireEvent.click(await screen.findByTestId('onboarding-pricing-choose-plan_starter_monthly_v3'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await signIn();
    expect(await screen.findByRole('heading', { name: 'Choose a plan' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Step 2 of 3' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('onboarding-skip'));
    expect(await screen.findByRole('heading', { name: 'Have you made a game before?' })).toBeTruthy();
  });

  it('goes on to pay for a plan picked in the prices window when already signed in', async () => {
    routes({ 'GET /api/openpixo/account': SIGNED_IN });
    renderNewUser();
    await screen.findByRole('button', { name: 'Continue' });
    fireEvent.click(screen.getByTestId('onboarding-see-prices'));
    fireEvent.click(await screen.findByTestId('onboarding-pricing-choose-plan_starter_monthly_v3'));
    expect(await screen.findByRole('heading', { name: 'Choose a plan' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Have you made a game before?' })).toBeNull();
  });

  it('asks the same of a paying customer on a new computer', async () => {
    routes({
      'GET /api/openpixo/account': SIGNED_IN,
      'GET /api/openpixo/credits': { available: 600, reserved: 0, subscription: null },
    });
    renderNewUser();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Have you made a game before?' })).toBeTruthy();
  });
});

describe('a new user on their own tools', () => {
  it('is offered the walkthrough at the end, even with nothing set up: half of it needs no AI', async () => {
    const view = renderNewUser();
    fireEvent.click(await screen.findByTestId('onboarding-own-tools'));
    fireEvent.click(await screen.findByTestId('onboarding-own-tools-confirm'));
    await screen.findByRole('heading', { name: 'Set up image generation' });
    fireEvent.click(screen.getByTestId('onboarding-skip'));
    await screen.findByRole('heading', { name: 'Set up the AI agent' });
    fireEvent.click(screen.getByTestId('onboarding-skip'));
    await screen.findByRole('heading', { name: 'Almost ready' });
    expect(screen.getByTestId('onboarding-finish-anyway')).toBeTruthy();
    fireEvent.click(screen.getByTestId('onboarding-ready-start'));
    await waitFor(() => expect(view.onStartGuide).toHaveBeenCalledOnce());
  });
});
