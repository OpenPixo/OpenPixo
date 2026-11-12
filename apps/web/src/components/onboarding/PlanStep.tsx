// The subscription path's second step: pick a plan, pay on Stripe's hosted
// checkout in the browser, come back. Credits arrive only through the verified
// webhook, so while the user is away the balance is re-read (on focus, and on a
// slow timer) until the plan or a pack shows up; then the flow moves on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@openpixo/components';
import type { OpenPixoCatalogResponse, OpenPixoCreditsSummary } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { markExternalBillingVisit, refreshOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { createOpenPixoCheckout, fetchOpenPixoCatalog } from '../../providers/openpixo-account';
import { openExternalUrl } from '../../providers/registry';
import { accountErrorMessage, formatCredits, formatMinorAmount, paymentMethodsLabel } from '../account/account-format';
import { Icon } from '../Icon';
import { PLAN_TIER_NAMES, planTier, type PlanTier } from './setup-readiness';
import styles from './Onboarding.module.css';
import setup from './Setup.module.css';

/** How often the balance is re-read while the user pays in the browser. */
export const CHECKOUT_POLL_INTERVAL_MS = 4_000;
/** Stop polling after this long; focus and "Check now" still work. */
export const CHECKOUT_POLL_LIMIT_MS = 15 * 60_000;

const TIER_BLURBS: Record<PlanTier, keyof Dict> = {
  starter: 'onboarding.planStarterBlurb',
  pro: 'onboarding.planProBlurb',
  studio: 'onboarding.planStudioBlurb',
};
const POPULAR_TIER: PlanTier = 'pro';

type Phase =
  | { kind: 'choose' }
  | { kind: 'opening'; sku: string }
  | { kind: 'waiting'; sku: string; url: string; startedAt: number };

export interface PlanStepProps {
  credits: OpenPixoCreditsSummary | null;
}

export function PlanStep({ credits }: PlanStepProps) {
  const { t, locale } = useI18n();
  const [catalog, setCatalog] = useState<OpenPixoCatalogResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<'plans' | 'packs'>('plans');
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(() => {
    const controller = new AbortController();
    setLoadError(false);
    fetchOpenPixoCatalog(controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setCatalog(next);
      setSelected((current) => current ?? next.plans.find((plan) => planTier(plan.sku) === 'starter')?.sku
        ?? next.plans[0]?.sku ?? null);
    }, () => { if (!controller.signal.aborted) setLoadError(true); });
    return controller;
  }, []);
  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, [load]);

  // Poll the balance while the browser checkout is open.
  const waitingSince = phase.kind === 'waiting' ? phase.startedAt : null;
  useEffect(() => {
    if (waitingSince === null) return;
    const timer = window.setInterval(() => {
      if (Date.now() - waitingSince > CHECKOUT_POLL_LIMIT_MS) { window.clearInterval(timer); return; }
      void refreshOpenPixoCredits();
    }, CHECKOUT_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [waitingSince]);

  async function pay(sku: string) {
    if (phase.kind === 'opening') return;
    setError(null);
    setPhase({ kind: 'opening', sku });
    try {
      const { checkoutUrl } = await createOpenPixoCheckout(sku);
      if (!mounted.current) return;
      markExternalBillingVisit();
      await openExternalUrl(checkoutUrl);
      if (mounted.current) setPhase({ kind: 'waiting', sku, url: checkoutUrl, startedAt: Date.now() });
    } catch (err) {
      if (!mounted.current) return;
      setError(accountErrorMessage(err, t));
      setPhase({ kind: 'choose' });
    }
  }

  async function checkNow() {
    setChecking(true);
    try { await refreshOpenPixoCredits(); } finally { if (mounted.current) setChecking(false); }
  }

  if (phase.kind === 'waiting') {
    return (
      <div className={setup.waiting} data-testid="onboarding-checkout-waiting">
        <div className={styles.verify} data-state="running" role="status" aria-live="polite">
          <Icon name="spinner" size={15} className="icon-spin" />
          <div className={styles.verifyCopy}>
            <p className={styles.verifyTitle}>{t('onboarding.checkoutWaitingTitle')}</p>
            <p>{t('onboarding.checkoutWaitingBody')}</p>
          </div>
        </div>
        <div className={setup.rowActions}>
          <Button variant="secondary" size="sm" onClick={() => void openExternalUrl(phase.url)}>
            {t('onboarding.checkoutOpenAgain')}<Icon name="external-link" size={13} />
          </Button>
          <Button variant="secondary" size="sm" disabled={checking} aria-busy={checking || undefined} onClick={() => void checkNow()}>
            {t('onboarding.checkoutCheckNow')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPhase({ kind: 'choose' })}>
            {t('onboarding.checkoutChooseAnother')}
          </Button>
        </div>
        {credits && credits.available > 0 ? null : (
          <p className={styles.verifyNote}><Icon name="info" size={13} /><span>{t('onboarding.checkoutArrivalNote')}</span></p>
        )}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.verify} data-state="error" role="alert">
        <Icon name="alert-triangle" size={15} />
        <div className={styles.verifyCopy}>
          <p>{t('account.catalogLoadFailed')}</p>
          <Button size="sm" variant="secondary" className={setup.inlineButton} onClick={() => void load()}>{t('account.retry')}</Button>
        </div>
      </div>
    );
  }
  if (!catalog) {
    return <p className={styles.aiScanning} role="status"><Icon name="spinner" size={14} className="icon-spin" />{t('account.loading')}</p>;
  }

  const paused = catalog.purchasesPaused;
  const busy = phase.kind === 'opening';
  const options = view === 'plans'
    ? catalog.plans.map((plan) => {
      const tier = planTier(plan.sku);
      return {
        sku: plan.sku,
        title: tier ? t(PLAN_TIER_NAMES[tier]) : t('account.planCredits', { n: formatCredits(plan.monthlyCredits, locale) }),
        price: t('account.perMonth', { price: formatMinorAmount(plan.amountMinor, plan.currency, locale) }),
        detail: t('onboarding.planCreditsMonthly', { n: formatCredits(plan.monthlyCredits, locale) }),
        blurb: tier ? t(TIER_BLURBS[tier]) : null,
        popular: tier === POPULAR_TIER,
      };
    })
    : catalog.topups.map((pack) => ({
      sku: pack.sku,
      title: t('account.topupCredits', { n: formatCredits(pack.credits, locale) }),
      price: formatMinorAmount(pack.amountMinor, pack.currency, locale),
      detail: t('onboarding.packOnce'),
      blurb: null,
      popular: false,
    }));
  const current = options.find((option) => option.sku === selected) ?? null;

  function showView(next: 'plans' | 'packs') {
    if (!catalog || next === view) return;
    setView(next);
    setSelected(next === 'plans'
      ? catalog.plans.find((plan) => planTier(plan.sku) === 'starter')?.sku ?? catalog.plans[0]?.sku ?? null
      : catalog.topups[0]?.sku ?? null);
  }

  // Both kinds of purchase sit side by side, each naming how it can be paid: a
  // first-time tester looking for Alipay never found it behind a link under the button.
  const kinds = catalog.topups.length > 0 && catalog.plans.length > 0 ? ([
    { view: 'plans', title: t('onboarding.planKindMonthly'), methods: paymentMethodsLabel(uniqueMethods(catalog.plans), t) },
    { view: 'packs', title: t('onboarding.planKindPacks'), methods: paymentMethodsLabel(uniqueMethods(catalog.topups), t) },
  ] as const) : null;

  return (
    <div className={setup.plans}>
      {paused ? <p className={styles.panelHint} role="status">{t('account.purchasesPaused')}</p> : null}
      {kinds ? (
        <div className={setup.planKinds} role="tablist" aria-label={t('onboarding.planKindsAria')}>
          {kinds.map((kind) => (
            <button
              key={kind.view}
              type="button"
              role="tab"
              aria-selected={view === kind.view}
              className={setup.planKind}
              data-testid={`onboarding-plan-kind-${kind.view}`}
              onClick={() => showView(kind.view)}
            >
              <strong>{kind.title}</strong>
              {kind.methods ? <span>{kind.methods}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className={setup.planList} role="radiogroup" aria-label={t(view === 'plans' ? 'account.plansHeading' : 'account.topupsHeading')}>
        {options.map((option) => (
          <button
            key={option.sku}
            type="button"
            role="radio"
            aria-checked={selected === option.sku}
            className={setup.planCard}
            data-testid={`onboarding-plan-${option.sku}`}
            onClick={() => setSelected(option.sku)}
          >
            <span className={setup.planHead}>
              <strong>{option.title}</strong>
              {option.popular ? <span className={setup.popular}>{t('onboarding.planPopular')}</span> : null}
              <span className={setup.planPrice}>{option.price}</span>
            </span>
            <span className={setup.planDetail}>{option.detail}</span>
            {option.blurb ? <span className={setup.planBlurb}>{option.blurb}</span> : null}
          </button>
        ))}
      </div>
      {error ? <p role="alert" className={setup.error}>{error}</p> : null}
      <Button size="lg" variant="primary" className={styles.wide} data-testid="onboarding-plan-pay"
        disabled={!current || paused || busy} aria-busy={busy || undefined}
        onClick={() => { if (current) void pay(current.sku); }}>
        {busy ? <Icon name="spinner" size={15} className="icon-spin" /> : null}
        {busy ? t('account.opening') : view === 'plans' ? t('onboarding.planSubscribe') : t('onboarding.packBuy')}
      </Button>
      <p className={setup.fineprint}>{t('onboarding.planFineprint')}</p>
    </div>
  );
}

/** Every payment method any of these products offers, first-seen order. */
function uniqueMethods(products: ReadonlyArray<{ paymentMethods: string[] }>): string[] {
  return [...new Set(products.flatMap((product) => product.paymentMethods.map((method) => method.toLowerCase())))];
}
