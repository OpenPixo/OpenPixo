import { useState } from 'react';
import { Button } from '@openpixo/components';
import { useI18n } from '../../i18n';
import { isCloudAccountAvailable, useOpenPixoAccount, useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { formatCredits } from '../account/account-format';
import { SignInDialog } from '../account/SignInDialog';
import { CoinGlyph } from './StorePrice';
import styles from './CreditsChip.module.css';

/**
 * Header balance for the Workshop. Browsing never waits on it: without an
 * account service it renders nothing, signed out it offers sign-in.
 */
export function CreditsChip({ onGetCredits }: { onGetCredits: () => void }) {
  const { t, locale } = useI18n();
  const { status } = useOpenPixoAccount();
  const available = isCloudAccountAvailable(status);
  const signedIn = available && Boolean(status?.signedIn);
  const { credits } = useOpenPixoCredits(signedIn);
  const [signInOpen, setSignInOpen] = useState(false);
  if (!available) return null;
  if (!signedIn) return <div className={styles.chip} data-testid="workshop-credits">
    <CoinGlyph className={styles.coin} />
    <Button variant="ghost" size="sm" className={styles.action} onClick={() => setSignInOpen(true)}>{t('workshop.credits.signIn')}</Button>
    <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
  </div>;
  const balance = credits ? formatCredits(credits.available, locale) : null;
  return <div className={styles.chip} data-testid="workshop-credits">
    <CoinGlyph className={styles.coin} />
    <span className={styles.balance} aria-label={balance === null ? undefined : t('workshop.credits.aria', { n: balance })}>
      {balance === null ? <span className={styles.placeholder} aria-hidden="true" /> : <span aria-hidden="true">{t('store.credits', { count: balance })}</span>}
    </span>
    <Button variant="primary" size="sm" className={styles.action} onClick={onGetCredits}>{t('workshop.credits.get')}</Button>
  </div>;
}
