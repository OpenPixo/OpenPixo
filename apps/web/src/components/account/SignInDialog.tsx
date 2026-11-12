import { useId } from 'react';
import { Dialog } from '@openpixo/components';
import { useT } from '../../i18n';
import { OpenPixoLogo } from '../OpenPixoLogo';
import { SignInPanel } from './CloudSignIn';
import styles from './SignInDialog.module.css';

/**
 * Signing in from inside the app (the nav "Sign in" button) is a small focused
 * window over the current page, like most desktop apps, not a trip to Settings.
 */
export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} size="sm" ariaLabelledBy={titleId} className={styles.dialog}>
      <div className={styles.body}>
        <OpenPixoLogo />
        <h2 id={titleId} className={styles.title}>{t('onboarding.accountTitle')}</h2>
        <p className={styles.subtitle}>{t('account.signInSubtitle')}</p>
        {open && <SignInPanel onSignedIn={onClose} />}
      </div>
    </Dialog>
  );
}
