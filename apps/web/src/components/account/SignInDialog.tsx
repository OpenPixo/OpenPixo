import { useId } from 'react';
import { Button, Dialog, DialogDescription, DialogHeader, DialogTitle } from '@openpixo/components';
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
  const descriptionId = useId();
  return (
    <Dialog open={open} onClose={onClose} size="sm" ariaLabelledBy={titleId} ariaDescribedBy={descriptionId} className={styles.dialog}>
      <DialogHeader className={styles.header}>
        <OpenPixoLogo />
        <DialogTitle id={titleId}>{t('onboarding.accountTitle')}</DialogTitle>
        <DialogDescription id={descriptionId}>{t('account.signInSubtitle')}</DialogDescription>
      </DialogHeader>
      {open && <SignInPanel onSignedIn={onClose} />}
      <Button variant="ghost" size="sm" className={styles.later} onClick={onClose}>{t('account.signInLater')}</Button>
    </Dialog>
  );
}
