import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button, Dialog, DialogFooter, VisuallyHidden } from '@openpixo/components';
import type { StoreCatalogItem, StorePurchaseResponse } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { isCloudAccountAvailable, refreshOpenPixoCredits, useOpenPixoAccount, useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { purchaseStoreItem, storeErrorCode, type WorkshopKind } from '../../state/store';
import { formatCredits, unavailableReasonKey } from '../account/account-format';
import { SignInPanel } from '../account/CloudSignIn';
import { StoreCover } from './StoreCover';
import { CreditAmount } from './StorePrice';
import { itemTitle } from './workshop-catalog';
import styles from './BuyDialog.module.css';

type Phase = 'confirm' | 'buying' | 'success' | 'soon';

/**
 * Spending credits on one paid Workshop item. Every account situation gets
 * its own state (checking, unavailable, signed out, short on credits, ready),
 * and the "purchases open soon" answer is a friendly end state, not an error.
 */
export function BuyDialog({ item, open, onClose, onPurchased, onInstall, onGetCredits }: {
  item: StoreCatalogItem | null;
  open: boolean;
  onClose: () => void;
  onPurchased: (item: StoreCatalogItem, result: StorePurchaseResponse) => void;
  /** Offered after a successful purchase. */
  onInstall?: (item: StoreCatalogItem) => void;
  onGetCredits: () => void;
}) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const account = useOpenPixoAccount();
  const available = isCloudAccountAvailable(account.status);
  const signedIn = available && Boolean(account.status?.signedIn);
  const credits = useOpenPixoCredits(signedIn);
  const [phase, setPhase] = useState<Phase>('confirm');
  const [error, setError] = useState('');
  const [result, setResult] = useState<StorePurchaseResponse>();
  useEffect(() => { if (open) { setPhase('confirm'); setError(''); setResult(undefined); } }, [open, item?.name]);
  if (!item) return null;

  const title = itemTitle(item, locale);
  const price = item.pricing.credits ?? 0;
  const balance = credits.credits?.available;
  const shortfall = balance === undefined ? 0 : Math.max(0, price - balance);
  const busy = phase === 'buying';
  const fmt = (value: number) => formatCredits(value, locale);

  async function buy() {
    if (!item || busy) return;
    setPhase('buying'); setError('');
    try {
      const response = await purchaseStoreItem({ name: item.name, version: item.version });
      setResult(response);
      setPhase('success');
      onPurchased(item, response);
      void refreshOpenPixoCredits();
    } catch (cause) {
      const code = storeErrorCode(cause);
      if (code === 'STORE_PURCHASE_UNAVAILABLE') { setPhase('soon'); return; }
      setPhase('confirm');
      if (code === 'INSUFFICIENT_CREDITS') { setError(t('workshop.buy.insufficientTitle')); void refreshOpenPixoCredits(); return; }
      if (code === 'ACCOUNT_SIGNED_OUT' || code === 'ACCOUNT_LOGIN_EXPIRED') { setError(t('workshop.buy.signInAgain')); return; }
      console.warn('[Store] purchase failed:', cause);
      setError(t('workshop.buy.failed'));
    }
  }

  const getCredits = () => { onClose(); onGetCredits(); };
  const close = <Button variant="ghost" disabled={busy} onClick={onClose}>{t('workshop.buy.close')}</Button>;

  let body: ReactNode;
  let footer: ReactNode;
  if (phase === 'success') {
    body = <div className={styles.outcome} data-state="success">
      <span className={styles.outcomeMark} aria-hidden="true" />
      <h3>{t('workshop.buy.successTitle')}</h3>
      <p>{t('workshop.buy.successBody', { name: title, count: fmt(result?.creditsSpent ?? price), balance: fmt(result?.balance ?? 0) })}</p>
    </div>;
    footer = <>{close}{onInstall && !item.installedVersion ? <Button variant="primary" onClick={() => { onClose(); onInstall(item); }}>{t('workshop.buy.installNow')}</Button> : null}</>;
  } else if (phase === 'soon') {
    body = <div className={styles.outcome} data-state="soon">
      <span className={styles.outcomeMark} aria-hidden="true" />
      <h3>{t('workshop.buy.soonTitle')}</h3>
      <p>{t('workshop.buy.soonBody', { name: title })}</p>
    </div>;
    footer = <Button variant="primary" onClick={onClose}>{t('workshop.buy.gotIt')}</Button>;
  } else if (account.loading) {
    body = <p className={styles.muted} role="status">{t('workshop.buy.checking')}</p>;
    footer = close;
  } else if (!available) {
    body = <p className={styles.muted}>{t(unavailableReasonKey(account.status?.availability ?? null) ?? 'account.unavailableOffline')}</p>;
    footer = close;
  } else if (!signedIn) {
    body = <div className={styles.signIn}>
      <h3>{t('workshop.buy.signedOutTitle')}</h3>
      <p className={styles.muted}>{t('workshop.buy.signedOutBody')}</p>
      <SignInPanel onSignedIn={() => { void refreshOpenPixoCredits(); }} />
    </div>;
    footer = close;
  } else if (credits.loading) {
    body = <p className={styles.muted} role="status">{t('workshop.buy.checking')}</p>;
    footer = close;
  } else if (balance === undefined) {
    body = <div role="alert" className={styles.inlineError}>{t('account.creditsLoadFailed')}</div>;
    footer = <>{close}<Button variant="primary" onClick={() => { void credits.refresh(); }}>{t('account.retry')}</Button></>;
  } else {
    body = <>
      <dl className={styles.ledger}>
        <div><dt>{t('workshop.buy.balance')}</dt><dd><CreditAmount credits={balance} /></dd></div>
        <div><dt>{t('workshop.buy.price')}</dt><dd className={styles.minus}>−&nbsp;<CreditAmount credits={price} /></dd></div>
        <div className={styles.total} data-short={shortfall > 0}><dt>{t('workshop.buy.after')}</dt>
          <dd>{shortfall > 0 ? <span className={styles.short}>{t('workshop.buy.shortfall', { count: fmt(shortfall) })}</span> : <CreditAmount credits={balance - price} />}</dd></div>
      </dl>
      {shortfall > 0 ? <p className={styles.hint}>{t('workshop.buy.insufficientBody')}</p> : null}
      <p className={styles.note}>{t('workshop.buy.note')}</p>
    </>;
    footer = <>
      <Button variant="ghost" disabled={busy} onClick={onClose}>{t('store.action.cancel')}</Button>
      {shortfall > 0 ? <Button variant="primary" onClick={getCredits}>{t('workshop.credits.get')}</Button>
        : <Button variant="primary" disabled={busy} onClick={() => { void buy(); }}>{busy ? t('workshop.buy.buying') : t('workshop.buy.confirm', { count: fmt(price) })}</Button>}
    </>;
  }

  return <Dialog open={open} onClose={onClose} size="sm" ariaLabelledBy={titleId} closeOnBackdrop={!busy} closeOnEscape={!busy}
    className={styles.dialog} data-testid="workshop-buy-dialog">
    <div className={styles.head}>
      <div className={styles.thumb}><StoreCover item={item} eager /></div>
      <div className={styles.headCopy}>
        <span className={styles.kind}>{t('workshop.buy.eyebrow')} · {t(`workshop.kind.${item.kind as WorkshopKind}`)}</span>
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <span className={styles.price}><CreditAmount credits={price} /></span>
      </div>
    </div>
    <div className={styles.body}>
      {body}
      {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
      <VisuallyHidden role="status" aria-live="polite">
        {phase === 'success' ? t('workshop.buy.successTitle') : phase === 'soon' ? t('workshop.buy.soonTitle') : ''}
      </VisuallyHidden>
    </div>
    <DialogFooter className={styles.footer}>{footer}</DialogFooter>
  </Dialog>;
}
