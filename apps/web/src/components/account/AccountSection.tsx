import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Tag } from '@openpixo/components';
import type {
  OpenPixoCatalogResponse,
  OpenPixoCreditsSummary,
  OpenPixoLedgerEntry,
  OpenPixoLedgerKind,
  OpenPixoSubscriptionStatus,
  OpenPixoUser,
} from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import {
  isCloudAccountAvailable,
  markExternalBillingVisit,
  setOpenPixoAccountStatus,
  setOpenPixoCredits,
  useOpenPixoAccount,
  useOpenPixoCredits,
} from '../../hooks/useOpenPixoAccount';
import {
  cancelOpenPixoPlanChange,
  createOpenPixoBillingPortal,
  createOpenPixoCheckout,
  fetchOpenPixoCatalog,
  fetchOpenPixoLedger,
  signOutOpenPixo,
} from '../../providers/openpixo-account';
import { openExternalUrl } from '../../providers/registry';
import { accountDisplayName, accountInitial } from '../../state/account';
import { Icon } from '../Icon';
import { planTier, type PlanTier } from '../onboarding/setup-readiness';
import {
  accountErrorMessage,
  formatAccountDate,
  formatAccountDateTime,
  formatAccountDateTimeRange,
  formatCredits,
  formatMinorAmount,
  formatSignedCredits,
  paymentMethodsLabel,
  planDisplayName,
  unavailableReasonKey,
} from './account-format';
import { ledgerRows } from './ledger-rows';
import { SignInPanel } from './CloudSignIn';
import { PlanChangeDialog } from './PlanChangeDialog';
import styles from './AccountSection.module.css';

const PLAN_BLURBS: Record<PlanTier, keyof Dict> = {
  starter: 'onboarding.planStarterBlurb',
  pro: 'onboarding.planProBlurb',
  studio: 'onboarding.planStudioBlurb',
};

function planBlurbKey(sku: string): keyof Dict | null {
  const tier = planTier(sku);
  return tier ? PLAN_BLURBS[tier] : null;
}

/** Rows shown at first, and added by each Load more. */
export const LEDGER_PAGE_SIZE = 10;
/** The most the account API returns at once: hosted usage merges, so a screenful can take many entries. */
export const LEDGER_READ_SIZE = 100;
const LEDGER_MAX_READS = 3;

const LEDGER_KIND_KEYS = {
  topup: 'account.ledger.topup',
  subscription_grant: 'account.ledger.subscriptionGrant',
  reserve: 'account.ledger.reserve',
  settle: 'account.ledger.settle',
  release: 'account.ledger.release',
  refund: 'account.ledger.refund',
  adjustment: 'account.ledger.adjustment',
  purchase: 'account.ledger.purchase',
  multiplayer: 'account.ledger.multiplayer',
  plan_expiry: 'account.ledger.planExpiry',
  usage: 'account.ledger.usage',
} satisfies Record<OpenPixoLedgerKind, keyof Dict>;

const SUBSCRIPTION_STATUS_KEYS = {
  active: 'account.subStatus.active',
  past_due: 'account.subStatus.pastDue',
  canceled: 'account.subStatus.canceled',
  incomplete: 'account.subStatus.incomplete',
} satisfies Record<OpenPixoSubscriptionStatus, keyof Dict>;

/** Settings › Account & credits. */
export function AccountSection() {
  const { t } = useI18n();
  const { status, loading, failed, refresh } = useOpenPixoAccount();

  if (!status && loading) {
    return <section className={styles.section} aria-busy="true"><p className={styles.muted}>{t('account.loading')}</p></section>;
  }
  if (!status || failed || !isCloudAccountAvailable(status)) {
    const reason = unavailableReasonKey(status && !failed ? status.availability : null) ?? 'account.unavailableOffline';
    return (
      <section className={styles.section}>
        <Card className={styles.card} data-testid="account-unavailable">
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle}>{t('account.unavailableTitle')}</h3>
            <Tag className={styles.mutedTag}>{t('account.unavailableTag')}</Tag>
          </div>
          <p className={styles.body}>{t(reason)}</p>
          {(failed || !status) && (
            <Button variant="secondary" size="sm" onClick={() => void refresh()}>{t('account.retry')}</Button>
          )}
        </Card>
      </section>
    );
  }
  if (!status.signedIn || !status.user) return <SignedOutPanel />;
  return <SignedInPanel user={status.user} />;
}

function SignedOutPanel() {
  const { t } = useI18n();
  return (
    <section className={styles.section} data-testid="account-signed-out">
      <Card className={styles.card}>
        <h3 className={styles.cardTitle}>{t('account.signedOutTitle')}</h3>
        <p className={styles.body}>{t('account.signedOutBody')}</p>
        <div className={styles.signIn}>
          <SignInPanel onSignedIn={() => undefined} />
        </div>
        <p className={styles.note}><Icon name="lock" size={14} />{t('account.localStillWorks')}</p>
      </Card>
    </section>
  );
}

function SignedInPanel({ user }: { user: OpenPixoUser }) {
  const { credits, failed, loading, refresh } = useOpenPixoCredits(true);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section className={styles.section} data-testid="account-signed-in">
      <OverviewCard credits={credits} failed={failed} loading={loading} refresh={refresh} notice={notice} setNotice={setNotice} />
      <CatalogCards credits={credits} setNotice={setNotice} />
      <ActivityCard credits={credits} />
      <IdentityCard user={user} />
    </section>
  );
}

function IdentityCard({ user }: { user: OpenPixoUser }) {
  const { t } = useI18n();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      setOpenPixoAccountStatus(await signOutOpenPixo());
    } catch (err) {
      setSignOutError(accountErrorMessage(err, t));
      setSigningOut(false);
    }
  }

  return (
    <Card className={styles.card}>
      <div className={styles.identity}>
        <span className={styles.avatar} aria-hidden="true">{accountInitial(user)}</span>
        <div className={styles.identityCopy}>
          <strong className={styles.identityName}>{accountDisplayName(user)}</strong>
          <span className={styles.identityEmail}>{user.email}</span>
          <span className={styles.muted}>{t('account.signedInWith', {
            provider: t(user.provider === 'google' ? 'account.provider.google' : 'account.provider.email'),
          })}</span>
        </div>
        <Button variant="secondary" size="sm" disabled={signingOut} onClick={() => void signOut()}>
          <Icon name="log-out" size={14} />{t('account.signOut')}
        </Button>
      </div>
      {signOutError && <p role="alert" className={styles.error}>{signOutError}</p>}
    </Card>
  );
}

function useExternalBillingAction() {
  const { t } = useI18n();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (key: string, getUrl: () => Promise<string>) => {
    setPending(key);
    setError(null);
    try {
      const url = await getUrl();
      markExternalBillingVisit();
      await openExternalUrl(url);
    } catch (err) {
      setError(accountErrorMessage(err, t));
    } finally {
      setPending(null);
    }
  }, [t]);
  return { pending, error, run };
}

/** Below this many credits the page says so and points at what to do about it. */
const LOW_BALANCE_CREDITS = 100;

interface OverviewProps {
  credits: OpenPixoCreditsSummary | null;
  failed: boolean;
  loading: boolean;
  refresh: () => Promise<OpenPixoCreditsSummary | null>;
  notice: string | null;
  setNotice: (notice: string | null) => void;
}

/** What the account has now and the one thing to do next. Everything else on the page supports this card. */
function OverviewCard({ credits, failed, loading, refresh, notice, setNotice }: OverviewProps) {
  const { t, locale } = useI18n();
  const portal = useExternalBillingAction();
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  if (!credits) {
    return (
      <Card className={styles.card}>
        {failed ? (
          <div className={styles.inlineError}>
            <p role="alert" className={styles.error}>{t('account.creditsLoadFailed')}</p>
            <Button variant="secondary" size="sm" onClick={() => void refresh()}>{t('account.retry')}</Button>
          </div>
        ) : <p className={styles.muted} aria-busy={loading}>{t('account.loading')}</p>}
      </Card>
    );
  }

  const subscription = credits.subscription;
  const live = subscription && subscription.status !== 'canceled' ? subscription : null;
  const ending = live?.cancelAtPeriodEnd === true;
  const openPortal = () => void portal.run('portal', async () => (await createOpenPixoBillingPortal()).url);

  async function undo(which: 'downgrade' | 'upgrade') {
    setUndoing(true);
    setUndoError(null);
    try {
      const result = await cancelOpenPixoPlanChange();
      setOpenPixoCredits(result.credits);
      setNotice(which === 'downgrade' ? t('account.change.downgradeUndone') : t('account.change.upgradeAbandoned'));
    } catch (err) {
      setUndoError(accountErrorMessage(err, t));
    } finally {
      setUndoing(false);
    }
  }

  const nextStep = !live ? t('account.next.noPlan')
    : credits.available < LOW_BALANCE_CREDITS && !ending && live.status === 'active' ? t('account.next.lowBalance')
      : null;

  return (
    <Card className={styles.card} aria-labelledby="account-overview-title">
      <h3 id="account-overview-title" className={styles.visuallyHidden}>{t('account.overviewTitle')}</h3>
      <div className={styles.overview}>
        <div className={styles.overviewBalance}>
          <span className={styles.label}>{t('account.available')}</span>
          <span className={styles.balanceValue} data-testid="account-credits-available">{formatCredits(credits.available, locale)}</span>
          {credits.reserved > 0 && (
            <span className={styles.muted} data-testid="account-credits-reserved">
              {t('account.reservedLine', { n: formatCredits(credits.reserved, locale) })}
            </span>
          )}
          {live && (credits.planCredits ?? 0) > 0 && (
            <span className={styles.muted} data-testid="account-plan-credits-ending">
              {t('account.planCreditsEnding', { n: formatCredits(credits.planCredits ?? 0, locale), date: formatAccountDate(live.currentPeriodEnd, locale) })}
            </span>
          )}
        </div>
        <div className={styles.overviewPlan}>
          <span className={styles.label}>{t('account.planLabel')}</span>
          {live ? (
            <>
              <span className={styles.planName}>
                {planDisplayName(live.sku, t)}
                {live.status !== 'active' && <Tag className={styles.warnTag}>{t(SUBSCRIPTION_STATUS_KEYS[live.status])}</Tag>}
              </span>
              <span className={styles.muted}>
                {live.amountMinor !== undefined && live.currency ? `${t('account.perMonth', { price: formatMinorAmount(live.amountMinor, live.currency, locale) })} · ` : ''}
                {t('account.planCredits', { n: formatCredits(live.monthlyCredits, locale) })}
              </span>
              <span className={styles.muted}>
                {t(ending ? 'account.endsOn' : 'account.renewsOn', { date: formatAccountDate(live.currentPeriodEnd, locale) })}
              </span>
            </>
          ) : <span className={styles.planNone}>{t('account.noSubscription')}</span>}
        </div>
      </div>

      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {nextStep && <p className={styles.nextStep}>{nextStep}</p>}

      {live?.pendingUpgrade && (
        <div className={styles.callout} data-testid="account-pending-upgrade">
          <p>{t('account.pendingUpgrade', {
            plan: planDisplayName(live.pendingUpgrade.sku, t),
            price: formatMinorAmount(live.pendingUpgrade.chargeMinor, live.pendingUpgrade.currency, locale),
          })}</p>
          <div className={styles.actions}>
            <Button variant="primary" size="sm" disabled={portal.pending !== null}
              onClick={() => void portal.run('verify', async () => live.pendingUpgrade!.paymentUrl)}>
              {t('account.change.verifyNow')}<Icon name="external-link" size={13} />
            </Button>
            <Button variant="secondary" size="sm" disabled={undoing} onClick={() => void undo('upgrade')}>{t('account.abandonUpgrade')}</Button>
          </div>
        </div>
      )}
      {live?.pendingDowngrade && !ending && (
        <div className={styles.callout} data-testid="account-pending-downgrade">
          <p>{t('account.pendingDowngrade', {
            date: formatAccountDate(live.pendingDowngrade.effectiveAt, locale),
            plan: planDisplayName(live.pendingDowngrade.sku, t),
            price: formatMinorAmount(live.pendingDowngrade.amountMinor, live.pendingDowngrade.currency, locale),
            credits: formatCredits(live.pendingDowngrade.monthlyCredits, locale),
          })}</p>
          <div className={styles.actions}>
            <Button variant="secondary" size="sm" disabled={undoing} onClick={() => void undo('downgrade')}>{t('account.undoDowngrade')}</Button>
          </div>
        </div>
      )}
      {ending && <p className={styles.callout}>{t('account.endingNote')}</p>}
      {live && live.status !== 'active' && <p className={styles.callout}>{t('account.pastDueNote')}</p>}
      {undoError && <p role="alert" className={styles.error}>{undoError}</p>}

      {live && (
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" disabled={portal.pending !== null} onClick={openPortal}>
            {portal.pending === 'portal' ? t('account.opening') : t(ending ? 'account.renewInPortal' : 'account.manageSubscription')}<Icon name="external-link" size={13} />
          </Button>
        </div>
      )}
      {portal.error && <p role="alert" className={styles.error}>{portal.error}</p>}
    </Card>
  );
}

function CatalogCards({ credits, setNotice }: { credits: OpenPixoCreditsSummary | null; setNotice: (notice: string | null) => void }) {
  const { t, locale } = useI18n();
  const [catalog, setCatalog] = useState<OpenPixoCatalogResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const checkout = useExternalBillingAction();
  const load = useCallback(() => {
    const controller = new AbortController();
    setLoadError(false);
    fetchOpenPixoCatalog(controller.signal).then(setCatalog, () => {
      if (!controller.signal.aborted) setLoadError(true);
    });
    return controller;
  }, []);
  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, [load]);

  const closeDialog = useCallback(() => setChanging(null), []);
  const onChanged = useCallback((notice: string | null) => { setNotice(notice); setChanging(null); }, [setNotice]);

  if (loadError) {
    return (
      <Card className={styles.card}>
        <div className={styles.inlineError}>
          <p role="alert" className={styles.error}>{t('account.catalogLoadFailed')}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>{t('account.retry')}</Button>
        </div>
      </Card>
    );
  }
  if (!catalog) return <Card className={styles.card}><p className={styles.muted}>{t('account.loading')}</p></Card>;

  const paused = catalog.purchasesPaused;
  const subscription = credits?.subscription && credits.subscription.status !== 'canceled' ? credits.subscription : null;
  const current = subscription ? catalog.plans.find((plan) => plan.sku === subscription.sku) ?? null : null;
  // An ending or unpaid plan is sorted out in the portal first; the overview says so.
  const locked = subscription !== null && (subscription.cancelAtPeriodEnd || subscription.status !== 'active' || Boolean(subscription.pendingUpgrade));
  const buy = (sku: string) => void checkout.run(sku, async () => (await createOpenPixoCheckout(sku)).checkoutUrl);

  return (
    <>
      {paused && <p className={styles.pausedNote} role="status">{t('account.purchasesPaused')}</p>}
      {catalog.plans.length > 0 && (
        <Card className={styles.card} aria-labelledby="account-plans-title">
          <div className={styles.cardHead}>
            <h3 id="account-plans-title" className={styles.cardTitle}>{t('account.plansHeading')}</h3>
          </div>
          <ul className={styles.plans} aria-label={t('account.plansHeading')}>
            {catalog.plans.map((plan) => {
              const isCurrent = plan.sku === subscription?.sku;
              const isPending = plan.sku === subscription?.pendingDowngrade?.sku;
              const isUpgrade = !current || plan.amountMinor > current.amountMinor;
              const name = planDisplayName(plan.sku, t);
              const price = t('account.perMonth', { price: formatMinorAmount(plan.amountMinor, plan.currency, locale) });
              const action = !subscription ? t('account.subscribe') : isUpgrade ? t('account.upgrade') : t('account.downgrade');
              return (
                <li key={plan.sku} className={`${styles.plan} ${isCurrent ? styles.planCurrent : ''}`} data-testid={`account-plan-${plan.sku}`}>
                  <strong className={styles.planTitle}>{name}</strong>
                  <span className={styles.planPrice}>{price}</span>
                  <span className={styles.planCredits}>{t('account.planCredits', { n: formatCredits(plan.monthlyCredits, locale) })}</span>
                  {planBlurbKey(plan.sku) && <span className={styles.muted}>{t(planBlurbKey(plan.sku)!)}</span>}
                  <div className={styles.planAction}>
                    {isCurrent ? <Tag className={styles.okTag}>{t('account.currentPlan')}</Tag>
                      : isPending ? <Tag className={styles.mutedTag}>{t('account.pendingTag', { date: formatAccountDate(subscription!.pendingDowngrade!.effectiveAt, locale) })}</Tag>
                      : (
                        <Button variant={!subscription || isUpgrade ? 'primary' : 'secondary'} size="sm"
                          disabled={locked || checkout.pending !== null || (paused && isUpgrade)}
                          aria-label={`${action} · ${name} · ${price}`}
                          onClick={() => { setNotice(null); if (subscription) setChanging(plan.sku); else buy(plan.sku); }}>
                          {checkout.pending === plan.sku ? t('account.opening') : action}
                        </Button>
                      )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className={styles.muted}>{t(subscription ? 'account.plansNoteChange' : 'account.plansNoteNew')}</p>
          {checkout.error && <p role="alert" className={styles.error}>{checkout.error}</p>}
        </Card>
      )}
      {catalog.topups.length > 0 && (
        <Card className={styles.card} aria-labelledby="account-topups-title">
          <div className={styles.cardHead}>
            <h3 id="account-topups-title" className={styles.cardTitle}>{t('account.topupsHeading')}</h3>
          </div>
          <ul className={styles.packs} aria-label={t('account.topupsHeading')}>
            {catalog.topups.map((pack) => {
              const amount = t('account.topupCredits', { n: formatCredits(pack.credits, locale) });
              const price = formatMinorAmount(pack.amountMinor, pack.currency, locale);
              return (
                <li key={pack.sku} className={styles.pack} data-testid={`account-topup-${pack.sku}`}>
                  <div className={styles.productCopy}>
                    <strong>{amount}</strong>
                    <span className={styles.price}>{price}</span>
                  </div>
                  <Button variant="secondary" size="sm" disabled={paused || checkout.pending !== null}
                    aria-label={`${t('account.buy')} · ${amount} · ${price}`}
                    onClick={() => buy(pack.sku)}>
                    {checkout.pending === pack.sku ? t('account.opening') : t('account.buy')}
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className={styles.note}><Icon name="info" size={14} />{t('account.checkoutNote', { methods: paymentMethodsLabel(catalog.topups[0]!.paymentMethods, t) })}</p>
          <p className={styles.muted}>{t('account.creditsNote')}</p>
        </Card>
      )}
      <PlanChangeDialog sku={changing} onClose={closeDialog} onDone={onChanged} />
    </>
  );
}

interface LedgerRead {
  entries: OpenPixoLedgerEntry[];
  cursor: string | null;
}

/**
 * Reads until `wanted` rows are final. Merged usage can continue on the next
 * page, so a row's total only holds once another row follows it. The read limit
 * bounds a very long session: its row grows on the next Load more instead.
 */
async function readLedgerRows(wanted: number, from?: LedgerRead): Promise<LedgerRead> {
  let read = from;
  let reads = 0;
  if (!read) {
    const page = await fetchOpenPixoLedger({ limit: LEDGER_READ_SIZE });
    read = { entries: page.entries, cursor: page.nextCursor };
    reads = 1;
  }
  while (read.cursor && ledgerRows(read.entries).length <= wanted && reads < LEDGER_MAX_READS) {
    const page = await fetchOpenPixoLedger({ limit: LEDGER_READ_SIZE, cursor: read.cursor });
    read = { entries: [...read.entries, ...page.entries], cursor: page.nextCursor };
    reads += 1;
  }
  return read;
}

function ActivityCard({ credits }: { credits: OpenPixoCreditsSummary | null }) {
  const { t, locale } = useI18n();
  const [read, setRead] = useState<LedgerRead | null>(null);
  const [shown, setShown] = useState(LEDGER_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const rows = useMemo(() => (read ? ledgerRows(read.entries) : null), [read]);

  // Reload from the top whenever the balance snapshot changes (initial load,
  // or a focus re-fetch after a checkout), so new grants show up in the list.
  useEffect(() => {
    if (!credits) return;
    const ticket = ++generation.current;
    setError(false);
    readLedgerRows(LEDGER_PAGE_SIZE).then((next) => {
      if (ticket !== generation.current) return;
      setRead(next);
      setShown(LEDGER_PAGE_SIZE);
    }, () => { if (ticket === generation.current) setError(true); });
  }, [credits]);

  async function loadMore() {
    if (!read || loadingMore) return;
    const ticket = generation.current;
    const wanted = shown + LEDGER_PAGE_SIZE;
    setLoadingMore(true);
    setError(false);
    try {
      const next = await readLedgerRows(wanted, read);
      if (ticket !== generation.current) return;
      setRead(next);
      setShown(wanted);
    } catch {
      if (ticket === generation.current) setError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Card className={styles.card} aria-labelledby="account-activity-title">
      <div className={styles.cardHead}>
        <h3 id="account-activity-title" className={styles.cardTitle}>{t('account.activityTitle')}</h3>
      </div>
      {rows === null && !error ? <p className={styles.muted}>{t('account.loading')}</p> : null}
      {rows !== null && rows.length === 0 ? <p className={styles.muted}>{t('account.activityEmpty')}</p> : null}
      {rows !== null && rows.length > 0 && (
        <ul className={styles.ledger} aria-label={t('account.activityTitle')}>
          {rows.slice(0, shown).map((row) => (
            <li key={row.id} className={styles.ledgerRow}>
              <div className={styles.ledgerCopy}>
                <span className={styles.ledgerKind}>{t(LEDGER_KIND_KEYS[row.kind] ?? 'account.ledger.adjustment')}</span>
                <span className={styles.muted}>
                  {row.count > 1 ? formatAccountDateTimeRange(row.oldestAt, row.newestAt, locale) : formatAccountDateTime(row.newestAt, locale)}
                  {row.count > 1 ? ` · ${t('account.ledger.usageCharges', { n: formatCredits(row.count, locale) })}` : ''}
                  {row.reference ? ` · ${t('account.reference', { ref: row.reference })}` : ''}
                </span>
              </div>
              <div className={styles.ledgerAmounts}>
                <span className={row.amount >= 0 ? styles.amountUp : styles.amountDown}>{formatSignedCredits(row.amount, locale)}</span>
                <span className={styles.muted}>{t('account.balanceAfter', { n: formatCredits(row.balanceAfter, locale) })}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className={styles.error}>{t('account.activityLoadFailed')}</p>}
      {read && rows && (read.cursor || rows.length > shown) && (
        <Button variant="ghost" size="sm" className={styles.loadMore} disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? t('account.loading') : t('account.loadMore')}
        </Button>
      )}
    </Card>
  );
}
