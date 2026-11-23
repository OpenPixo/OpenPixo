// Prices a newcomer can read before signing in, laid out the way pricing pages
// usually are: a short headline, then per plan who it is for, the price, one
// button and a short list of what it buys, and a single line of fine print.
// Plans and packs are the live public catalogue; what the credits buy is worked
// out from the hosted prices (live where the cloud lists them). Each dollar
// price carries an estimate in the user's own currency. Nothing here charges
// anyone: the button closes the window and hands the choice to sign-in, and
// the plan step opens on it afterwards.

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Button, Dialog } from '@openpixo/components';
import type { ExchangeRatesResponse, OpenPixoCatalogResponse } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { fetchExchangeRates, fetchOpenPixoAgentModels, fetchOpenPixoCatalog } from '../../providers/openpixo-account';
import { fetchCloudMediaServices } from '../../providers/openpixo-cloud-media';
import { formatCredits } from '../account/account-format';
import { Icon } from '../Icon';
import { localCurrency, localEstimate, systemLanguages } from './local-price';
import { alipayOnlyOnPacks, PaymentMarks } from './PaymentMarks';
import { POPULAR_TIER, TIER_BLURBS } from './PlanStep';
import { PLAN_TIER_NAMES, planTier, type PlanTier } from './setup-readiness';
import styles from './PricingDialog.module.css';

/**
 * Credits per generation, from the cloud's hosted service list
 * (`openpixo-image`, `openpixo-sfx`, `openpixo-model3d`). These are the
 * fallbacks for a cloud that does not list a service; a listed price wins.
 */
export const HOSTED_PRICE_FALLBACK = { image: 4, sfx: 7, model3d: 60 } as const;
type HostedPrices = { image: number; sfx: number; model3d: number };

/**
 * Games each plan may keep published as playable links. Mirrors the cloud's
 * `publish_plan_limits` table (migration 202611170001); credit packs alone
 * cannot publish.
 */
export const PLAN_SHARED_GAMES: Record<PlanTier, number> = { starter: 10, pro: 30, studio: 50 };
/**
 * The hosted agent models by their real names, in the order the window lists
 * them. Mirrors the cloud's agent catalogue (2026-11-23) for when the live list
 * cannot be read, which is usual before sign-in; a live list wins. Who serves a
 * model is never shown.
 */
export const HOSTED_AGENT_MODELS_FALLBACK: readonly string[] = [
  'Claude Sonnet 5.5', 'GPT-6.1 Sol', 'GPT-6.1 Terra', 'GPT-6 Luna',
  'Claude Haiku 5.5', 'DeepSeek V4.1 Flash', 'GLM 5.3 Flash', 'Tencent Hy4', 'Tencent Hy4 Flash',
];

/** Multiplayer rooms are listed from Pro up. */
const ROOM_TIERS: ReadonlySet<PlanTier> = new Set(['pro', 'studio']);

export interface PricingDialogProps {
  open: boolean;
  onClose: () => void;
  /** The user picked a plan or pack; sign-in comes next. */
  onChoose: (sku: string) => void;
  /** System language tags that decide the local currency; defaults to the browser's. */
  languages?: readonly string[];
}

type View = 'plans' | 'packs';

interface Offer {
  sku: string;
  tier: PlanTier | null;
  title: string;
  blurb: string;
  amountMinor: number;
  currency: string;
  monthly: boolean;
  credits: number;
  popular: boolean;
}

export function PricingDialog({ open, onClose, onChoose, languages }: PricingDialogProps) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const [catalog, setCatalog] = useState<OpenPixoCatalogResponse | null>(null);
  const [rates, setRates] = useState<ExchangeRatesResponse | null>(null);
  const [prices, setPrices] = useState<HostedPrices>(HOSTED_PRICE_FALLBACK);
  const [models, setModels] = useState<readonly string[]>(HOSTED_AGENT_MODELS_FALLBACK);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>('plans');
  const currency = useMemo(() => localCurrency(languages ?? systemLanguages()), [languages]);

  const load = useCallback((signal?: AbortSignal) => {
    setFailed(false);
    fetchOpenPixoCatalog(signal).then((next) => {
      if (!signal?.aborted) setCatalog(next);
    }, () => { if (!signal?.aborted) setFailed(true); });
  }, []);

  useEffect(() => {
    if (!open || catalog) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [open, catalog, load]);

  // Rates and hosted prices only refine the numbers; without them the page still reads.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    if (currency && !rates) {
      fetchExchangeRates(controller.signal).then((next) => {
        if (!controller.signal.aborted) setRates(next);
      }, () => {});
    }
    fetchCloudMediaServices(controller.signal).then((list) => {
      if (controller.signal.aborted) return;
      const credits = (id: string) => list.services.find((service) => service.id === id)?.credits;
      setPrices({
        image: credits('openpixo-image') ?? HOSTED_PRICE_FALLBACK.image,
        sfx: credits('openpixo-sfx') ?? HOSTED_PRICE_FALLBACK.sfx,
        model3d: credits('openpixo-model3d') ?? HOSTED_PRICE_FALLBACK.model3d,
      });
    }, () => {});
    fetchOpenPixoAgentModels(controller.signal).then((catalog) => {
      if (controller.signal.aborted) return;
      const labels = [...new Set(catalog.models.map((model) => model.label.trim()).filter(Boolean))];
      if (labels.length > 0) setModels(orderModels(labels));
    }, () => {});
    return () => controller.abort();
    // Once per opening; the rates are kept for the session.
  }, [open]);

  const plans: Offer[] = (catalog?.plans ?? []).map((plan) => {
    const tier = planTier(plan.sku);
    return {
      sku: plan.sku,
      tier,
      title: tier ? t(PLAN_TIER_NAMES[tier]) : t('account.planCredits', { n: formatCredits(plan.monthlyCredits, locale) }),
      blurb: tier ? t(TIER_BLURBS[tier]) : '',
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      monthly: true,
      credits: plan.monthlyCredits,
      popular: tier === POPULAR_TIER,
    };
  });
  const packs: Offer[] = (catalog?.topups ?? []).map((pack) => ({
    sku: pack.sku,
    tier: null,
    title: t('account.topupCredits', { n: formatCredits(pack.credits, locale) }),
    blurb: t('onboarding.pricingPackBlurb'),
    amountMinor: pack.amountMinor,
    currency: pack.currency,
    monthly: false,
    credits: pack.credits,
    popular: false,
  }));
  const shownView: View = view === 'packs' && packs.length > 0 ? 'packs' : plans.length > 0 ? 'plans' : 'packs';
  const offers = shownView === 'plans' ? plans : packs;
  const methods = shownView === 'plans'
    ? catalog?.plans.flatMap((p) => p.paymentMethods) ?? []
    : catalog?.topups.flatMap((p) => p.paymentMethods) ?? [];
  const bonus = planBonusPercent(plans, packs);
  const packRate = packCreditsPerMinor(packs);

  /**
   * A plan's credits as "base + bonus": the base is what the same money buys in
   * credit packs, so the bonus is exactly what the plan gives on top.
   */
  function renderCredits(offer: Offer) {
    const extra = offer.monthly && packRate ? planExtraCredits(offer, packRate) : 0;
    if (extra <= 0) {
      return (
        <p className={styles.creditsLine}>
          {offer.monthly
            ? t('onboarding.planCreditsMonthly', { n: formatCredits(offer.credits, locale) })
            : t('onboarding.pricingPackCredits', { n: formatCredits(offer.credits, locale) })}
        </p>
      );
    }
    return (
      <div className={styles.creditsBlock} data-testid="onboarding-pricing-credits">
        <p className={styles.creditsLine}>
          {t('onboarding.planCreditsMonthly', { n: formatCredits(offer.credits - extra, locale) })}
          <span className={styles.extra}>{t('onboarding.pricingExtra', { n: formatCredits(extra, locale) })}</span>
        </p>
        <p className={styles.creditsTotal}>{t('onboarding.pricingCreditsTotal', { n: formatCredits(offer.credits, locale) })}</p>
      </div>
    );
  }

  function features(offer: Offer): string[] {
    const n = (value: number) => formatCredits(Math.floor(value), locale);
    const lines = [
      t('onboarding.pricingArt', { n: n(offer.credits / prices.image) }),
      t('onboarding.pricingSfx', { n: n(offer.credits / prices.sfx) }),
      t('onboarding.pricingModels', { n: n(offer.credits / prices.model3d) }),
    ];
    if (offer.tier) lines.push(t('onboarding.pricingShare', { n: PLAN_SHARED_GAMES[offer.tier] }));
    if (offer.tier && ROOM_TIERS.has(offer.tier)) lines.push(t('onboarding.pricingRooms'));
    if (!offer.monthly) lines.push(t('onboarding.pricingPackNoExpire'));
    return lines;
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg" ariaLabelledBy={titleId} className={styles.dialog} data-testid="onboarding-pricing">
      <Button variant="ghost" size="sm" className={styles.close} aria-label={t('common.close')} onClick={onClose}>
        <Icon name="close" size={16} />
      </Button>
      <header className={styles.hero}>
        <h2 id={titleId} className={styles.title}>{t('onboarding.pricingTitle')}</h2>
        <p className={styles.intro}>{t('onboarding.pricingIntro')}</p>
        {plans.length > 0 && packs.length > 0 ? (
          <div className={styles.toggle} role="tablist" aria-label={t('onboarding.planKindsAria')}>
            {(['plans', 'packs'] as const).map((kind) => (
              <button key={kind} type="button" role="tab" aria-selected={shownView === kind}
                className={styles.toggleOption} data-testid={`onboarding-pricing-tab-${kind}`} onClick={() => setView(kind)}>
                {t(kind === 'plans' ? 'onboarding.planKindMonthly' : 'onboarding.planKindPacks')}
                {kind === 'plans' && bonus > 0 ? <span className={styles.bonus}>{t('onboarding.pricingBonus', { n: bonus })}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {failed ? (
        <div className={styles.status} role="alert">
          <span>{t('account.catalogLoadFailed')}</span>
          <Button size="sm" variant="secondary" onClick={() => load()}>{t('account.retry')}</Button>
        </div>
      ) : !catalog ? (
        <p className={styles.status} role="status"><Icon name="spinner" size={14} className="icon-spin" />{t('account.loading')}</p>
      ) : (
        <ul className={styles.cards} data-count={offers.length} data-featured={offers.some((offer) => offer.popular) || undefined}>
          {offers.map((offer) => {
            const price = priceParts(offer.amountMinor, offer.currency, locale);
            const local = localEstimate(offer.amountMinor, offer.currency, currency, rates, locale);
            return (
              <li key={offer.sku} className={styles.card} data-popular={offer.popular || undefined} data-testid={`onboarding-pricing-${offer.sku}`}>
                <div className={styles.cardHead}>
                  <h3 className={styles.cardTitle}>{offer.title}</h3>
                  {offer.popular ? <span className={styles.popular}>{t('onboarding.planPopular')}</span> : null}
                </div>
                <p className={styles.blurb}>{offer.blurb}</p>
                <p className={styles.price} aria-label={price.text}>
                  <span className={styles.symbol} aria-hidden="true">{price.symbol}</span>
                  <span className={styles.amount} aria-hidden="true">{price.number}</span>
                  <span className={styles.per}>{offer.monthly ? t('onboarding.pricingPerMonth') : t('onboarding.pricingOnce')}</span>
                </p>
                <p className={styles.local} data-testid="onboarding-pricing-local">
                  {local ? t('onboarding.pricingLocal', { amount: local }) : ' '}
                </p>
                <Button variant={offer.popular ? 'primary' : 'secondary'} size="lg" className={styles.cta}
                  disabled={catalog.purchasesPaused} data-testid={`onboarding-pricing-choose-${offer.sku}`}
                  onClick={() => onChoose(offer.sku)}>
                  {t('onboarding.pricingLogin')}
                </Button>
                {renderCredits(offer)}
                <ul className={styles.features}>
                  {features(offer).map((line) => (
                    <li key={line}><span className={styles.tick} aria-hidden="true"><Icon name="check" size={11} /></span>{line}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {catalog && models.length > 0 ? (
        <section className={styles.models} aria-labelledby={`${titleId}-models`} data-testid="onboarding-pricing-models">
          <h3 id={`${titleId}-models`} className={styles.modelsTitle}>{t('onboarding.pricingModelsTitle')}</h3>
          <ul className={styles.modelChips}>
            {models.map((model) => <li key={model}>{model}</li>)}
          </ul>
        </section>
      ) : null}

      {catalog?.purchasesPaused ? <p className={styles.paused} role="status">{t('account.purchasesPaused')}</p> : null}

      <footer className={styles.foot}>
        <div className={styles.payRow}>
        {catalog && shownView === 'plans' && alipayOnlyOnPacks(catalog) ? (
          <p className={styles.alipayHint} data-testid="onboarding-pricing-alipay-hint">
            <span>{t('onboarding.alipayHint')}</span>
            <Button variant="ghost" size="sm" className={styles.alipayLink} onClick={() => setView('packs')}>
              {t('onboarding.alipaySeePacks')}<Icon name="chevron-right" size={13} />
            </Button>
          </p>
        ) : null}
        <PaymentMarks methods={methods.length > 0 ? methods : ['card']} />
        </div>
        <p className={styles.fineprint}>{t('onboarding.pricingFineprint')}</p>
      </footer>
    </Dialog>
  );
}

/** Live labels in the window's order: known models first, new ones after. */
function orderModels(labels: string[]): string[] {
  const rank = (label: string) => {
    const index = HOSTED_AGENT_MODELS_FALLBACK.indexOf(label);
    return index === -1 ? HOSTED_AGENT_MODELS_FALLBACK.length : index;
  };
  return [...labels].sort((a, b) => rank(a) - rank(b));
}

/** "$19" split into its symbol and number, without cents when the amount is whole. */
function priceParts(amountMinor: number, currency: string, locale: string): { symbol: string; number: string; text: string } {
  const whole = amountMinor % 100 === 0;
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency', currency: currency.toUpperCase(), currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
    });
    const parts = formatter.formatToParts(amountMinor / 100);
    const symbol = parts.filter((part) => part.type === 'currency').map((part) => part.value).join('');
    const number = parts.filter((part) => part.type !== 'currency' && part.type !== 'literal').map((part) => part.value).join('');
    return { symbol, number, text: formatter.format(amountMinor / 100) };
  } catch {
    const number = (amountMinor / 100).toFixed(whole ? 0 : 2);
    return { symbol: '', number, text: `${number} ${currency.toUpperCase()}` };
  }
}

/** Credits per minor currency unit at the best pack rate, or null with no packs. */
function packCreditsPerMinor(packs: Offer[]): number | null {
  const rates = packs.filter((pack) => pack.amountMinor > 0).map((pack) => pack.credits / pack.amountMinor);
  return rates.length > 0 ? Math.max(...rates) : null;
}

/** What a plan gives beyond the same money spent on packs; never negative. */
export function planExtraCredits(offer: { credits: number; amountMinor: number }, packRate: number): number {
  return Math.max(0, offer.credits - Math.round(offer.amountMinor * packRate));
}

/** How many more credits per dollar the best plan gives than the packs, in percent. */
function planBonusPercent(plans: Offer[], packs: Offer[]): number {
  const rate = (offer: Offer) => offer.credits / offer.amountMinor;
  if (plans.length === 0 || packs.length === 0) return 0;
  const best = Math.max(...plans.map(rate));
  const pack = Math.max(...packs.map(rate));
  return Math.max(0, Math.floor((best / pack - 1) * 100));
}
