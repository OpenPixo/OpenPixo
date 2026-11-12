import { useCallback, useEffect, useId, useState } from 'react';
import { Button, Dialog } from '@openpixo/components';
import type { OpenPixoPlanChangeQuote, OpenPixoPlanChangeResponse } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { markExternalBillingVisit, refreshOpenPixoCredits, setOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { accountErrorCode, applyOpenPixoPlanChange, createOpenPixoBillingPortal, previewOpenPixoPlanChange } from '../../providers/openpixo-account';
import { openExternalUrl } from '../../providers/registry';
import { Icon } from '../Icon';
import { accountErrorMessage, formatAccountDate, formatCredits, formatMinorAmount, planDisplayName } from './account-format';
import styles from './PlanChangeDialog.module.css';

type Stage =
  | { name: 'loading' }
  | { name: 'quote'; quote: OpenPixoPlanChangeQuote; stale?: boolean }
  | { name: 'paying'; quote: OpenPixoPlanChangeQuote }
  | { name: 'declined'; quote: OpenPixoPlanChangeQuote }
  | { name: 'verify'; quote: OpenPixoPlanChangeQuote; url: string }
  | { name: 'failed'; message: string };

interface Props {
  /** The plan being chosen; null keeps the dialog closed. */
  sku: string | null;
  onClose: () => void;
  /** The change is done or under way; this sentence says what happened, unless the page already does. */
  onDone: (notice: string | null) => void;
}

/** States what a plan change charges, grants and when, before anything happens, then reports how it went. */
export function PlanChangeDialog({ sku, onClose, onDone }: Props) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!sku) return;
    const controller = new AbortController();
    setStage({ name: 'loading' });
    previewOpenPixoPlanChange(sku, controller.signal).then(
      (quote) => setStage({ name: 'quote', quote }),
      (error) => { if (!controller.signal.aborted) setStage({ name: 'failed', message: accountErrorMessage(error, t) }); },
    );
    return () => controller.abort();
  }, [sku, t]);

  const money = (minor: number, currency: string) => formatMinorAmount(minor, currency, locale);
  const planName = (value: string) => planDisplayName(value, t);

  const finish = useCallback((quote: OpenPixoPlanChangeQuote, result: OpenPixoPlanChangeResponse) => {
    setOpenPixoCredits(result.credits);
    const plan = planDisplayName(quote.toSku, t);
    switch (result.outcome) {
      case 'upgraded':
        onDone(t('account.change.upgraded', { plan, credits: formatCredits(quote.creditsNow, locale) }));
        return;
      case 'downgrade_scheduled':
        // The overview now states this for as long as it is pending.
        onDone(null);
        return;
      case 'downgrade_canceled':
        onDone(t('account.change.downgradeUndone'));
        return;
      case 'payment_failed':
        setStage({ name: 'declined', quote });
        return;
      case 'payment_requires_action':
        setStage({ name: 'verify', quote, url: result.paymentUrl ?? '' });
        return;
      default:
        // The answer arrives by webhook; coming back to the window re-checks.
        markExternalBillingVisit();
        void refreshOpenPixoCredits();
        onDone(t('account.change.processing'));
    }
  }, [locale, onDone, t]);

  async function confirm(quote: OpenPixoPlanChangeQuote) {
    setStage({ name: 'paying', quote });
    try {
      finish(quote, await applyOpenPixoPlanChange(quote.toSku, quote.chargeNowMinor));
    } catch (error) {
      if (accountErrorCode(error) === 'BILLING_PLAN_QUOTE_CHANGED') {
        try { setStage({ name: 'quote', quote: await previewOpenPixoPlanChange(quote.toSku), stale: true }); return; } catch { /* Report the first failure. */ }
      }
      setStage({ name: 'failed', message: accountErrorMessage(error, t) });
    }
  }

  async function openExternal(getUrl: () => Promise<string>, then?: () => void) {
    setOpening(true);
    try {
      const url = await getUrl();
      markExternalBillingVisit();
      await openExternalUrl(url);
      then?.();
    } catch (error) {
      setStage({ name: 'failed', message: accountErrorMessage(error, t) });
    } finally {
      setOpening(false);
    }
  }

  function rows(quote: OpenPixoPlanChangeQuote) {
    const next = t('account.change.nextValue', {
      date: formatAccountDate(quote.nextRenewalAt, locale),
      price: money(quote.nextChargeMinor, quote.currency),
      credits: formatCredits(quote.nextMonthlyCredits, locale),
    });
    if (quote.kind === 'upgrade') {
      return [
        [t('account.change.chargeNow'), money(quote.chargeNowMinor, quote.currency)],
        [t('account.change.creditsNow'), `+${formatCredits(quote.creditsNow, locale)}`],
        [t('account.change.when'), t('account.change.whenNow')],
        [t('account.change.next'), next],
      ];
    }
    if (quote.kind === 'downgrade') {
      return [
        [t('account.change.chargeNow'), t('account.change.noCharge')],
        [t('account.change.when'), formatAccountDate(quote.nextRenewalAt, locale)],
        [t('account.change.yourCredits'), t('account.change.creditsStay')],
        [t('account.change.next'), next],
      ];
    }
    return [
      [t('account.change.chargeNow'), t('account.change.noCharge')],
      [t('account.change.next'), next],
    ];
  }

  function title(): string {
    if (stage.name === 'loading' || stage.name === 'failed') return t('account.change.title');
    const plan = planName(stage.quote.toSku);
    if (stage.quote.kind === 'upgrade') return t('account.change.titleUpgrade', { plan });
    if (stage.quote.kind === 'downgrade') return t('account.change.titleDowngrade', { plan });
    return t('account.change.titleUndo', { plan });
  }

  function hint(quote: OpenPixoPlanChangeQuote): string {
    if (quote.kind === 'upgrade') return t('account.change.hintUpgrade', { from: planName(quote.fromSku), to: planName(quote.toSku) });
    if (quote.kind === 'downgrade') return t('account.change.hintDowngrade', { from: planName(quote.fromSku), date: formatAccountDate(quote.nextRenewalAt, locale) });
    return t('account.change.hintUndo', { date: formatAccountDate(quote.nextRenewalAt, locale) });
  }

  function confirmLabel(quote: OpenPixoPlanChangeQuote): string {
    if (quote.kind === 'upgrade') return t('account.change.confirmUpgrade', { price: money(quote.chargeNowMinor, quote.currency) });
    if (quote.kind === 'downgrade') return t('account.change.confirmDowngrade', { plan: planName(quote.toSku) });
    return t('account.change.confirmUndo');
  }

  const paying = stage.name === 'paying';
  return (
    <Dialog open={sku !== null} onClose={() => { if (!paying) onClose(); }} size="sm" ariaLabelledBy={titleId} className={styles.dialog}>
      <div className={styles.body} data-testid="plan-change-dialog">
        <h2 id={titleId} className={styles.title}>{title()}</h2>

        {stage.name === 'loading' && <p className={styles.muted} aria-busy="true">{t('account.loading')}</p>}

        {(stage.name === 'quote' || stage.name === 'paying') && (
          <>
            {stage.name === 'quote' && stage.stale && <p role="alert" className={styles.warn}>{t('account.error.quoteChanged')}</p>}
            <dl className={styles.rows}>
              {rows(stage.quote).map(([label, value]) => (
                <div key={label} className={styles.row}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
            <p className={styles.muted}>{hint(stage.quote)}</p>
            <div className={styles.actions}>
              <Button variant="secondary" size="sm" disabled={paying} onClick={onClose}>{t('common.cancel')}</Button>
              <Button variant="primary" size="sm" disabled={paying} onClick={() => void confirm(stage.quote)}>
                {paying ? t('account.change.working') : confirmLabel(stage.quote)}
              </Button>
            </div>
          </>
        )}

        {stage.name === 'declined' && (
          <>
            <p role="alert" className={styles.warn}>{t('account.change.declined')}</p>
            <div className={styles.actions}>
              <Button variant="secondary" size="sm" onClick={onClose}>{t('common.close')}</Button>
              <Button variant="primary" size="sm" disabled={opening}
                onClick={() => void openExternal(async () => (await createOpenPixoBillingPortal()).url)}>
                {t('account.change.updateCard')}<Icon name="external-link" size={13} />
              </Button>
            </div>
          </>
        )}

        {stage.name === 'verify' && (
          <>
            <p className={styles.body2}>{t('account.change.verify', { price: money(stage.quote.chargeNowMinor, stage.quote.currency) })}</p>
            <div className={styles.actions}>
              <Button variant="secondary" size="sm" onClick={onClose}>{t('account.change.later')}</Button>
              <Button variant="primary" size="sm" disabled={opening}
                onClick={() => void openExternal(async () => stage.url, onClose)}>
                {t('account.change.verifyNow')}<Icon name="external-link" size={13} />
              </Button>
            </div>
          </>
        )}

        {stage.name === 'failed' && (
          <>
            <p role="alert" className={styles.warn}>{stage.message}</p>
            <div className={styles.actions}>
              <Button variant="secondary" size="sm" onClick={onClose}>{t('common.close')}</Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
