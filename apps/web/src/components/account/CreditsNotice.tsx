import { Button, Tag } from '@openpixo/components';
import { useI18n } from '../../i18n';
import { useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { formatCredits } from './account-format';
import styles from './CreditsNotice.module.css';

/** Balance against what a request needs, as a bar with "have / need" beside it. */
export function CreditsMeter({ have, need }: { have: number; need: number }) {
  const { t, locale } = useI18n();
  const short = Math.max(0, need - have);
  const fill = need > 0 ? Math.min(100, Math.max(0, (have / need) * 100)) : 100;
  return (
    <div className={styles.meterRow}>
      <div className={styles.meter} role="meter" aria-label={t('account.creditsNotice.meter')}
        aria-valuemin={0} aria-valuemax={need} aria-valuenow={Math.max(0, Math.min(have, need))}
        aria-valuetext={`${formatCredits(have, locale)} / ${formatCredits(need, locale)}`}
        data-short={short > 0}>
        <span className={styles.meterFill} style={{ width: `${fill}%` }} />
      </div>
      <span className={styles.meterLabel} aria-hidden="true">{formatCredits(have, locale)} / {formatCredits(need, locale)}</span>
      {short > 0 && <span className={styles.short}>{t('account.creditsNotice.short', { n: formatCredits(short, locale) })}</span>}
    </div>
  );
}

export interface CreditsNoticeProps {
  /** Credits the request needs, when the refusal said so. */
  needed?: number | null;
  /** The balance to compare with. Left out, the notice reads the account's own balance. */
  balance?: number | null;
  /** Opens the existing top-up path (Settings › Account & credits). */
  onTopUp: () => void;
  /** Opens the settings where the user's own keys are set; left out, the button is not shown. */
  onUseOwnKey?: () => void;
  className?: string;
}

/**
 * What a user sees when a request needs more credits than they have, in chat
 * or on the generate page: how far short they are and the two ways on.
 */
export function CreditsNotice({ needed, balance, onTopUp, onUseOwnKey, className }: CreditsNoticeProps) {
  const { t, locale } = useI18n();
  const live = useOpenPixoCredits(balance === undefined);
  const have = balance === undefined ? live.credits?.available ?? null : balance;
  const need = typeof needed === 'number' && needed > 0 ? needed : null;

  return (
    <section className={[styles.notice, className ?? ''].filter(Boolean).join(' ')} role="alert" data-testid="credits-notice">
      <div className={styles.head}>
        <h3 className={styles.title}>{t('account.creditsNotice.title')}</h3>
        <Tag className={styles.tag}>{t('account.creditsNotice.tag')}</Tag>
      </div>
      <p className={styles.body}>
        {need !== null && have !== null
          ? t('account.creditsNotice.body', { need: formatCredits(need, locale), have: formatCredits(have, locale) })
          : t('account.creditsNotice.bodyUnknown')}
      </p>
      {need !== null && have !== null ? <CreditsMeter have={have} need={need} />
        : have !== null ? <p className={styles.balance}>{t('account.creditsNotice.balance', { n: formatCredits(have, locale) })}</p> : null}
      <div className={styles.actions}>
        {onUseOwnKey && <Button variant="secondary" size="sm" onClick={onUseOwnKey}>{t('account.creditsNotice.ownKey')}</Button>}
        <Button variant="primary" size="sm" onClick={onTopUp}>{t('account.creditsNotice.topUp')}</Button>
      </div>
    </section>
  );
}
