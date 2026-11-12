import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@openpixo/components';
import { useI18n } from '../../i18n';
import {
  isCloudAccountAvailable,
  setOpenPixoAccountStatus,
  useOpenPixoAccount,
  useOpenPixoCredits,
} from '../../hooks/useOpenPixoAccount';
import { signOutOpenPixo } from '../../providers/openpixo-account';
import { accountDisplayName, accountInitial } from '../../state/account';
import { formatCredits } from '../account/account-format';
import { SignInDialog } from '../account/SignInDialog';
import { CoinGlyph } from '../store/StorePrice';
import styles from './AccountChip.module.css';

interface Props {
  /** Opens Settings; `'account'` lands on Account & credits. */
  onOpenSettings?: (section?: 'account') => void;
  /** The rail's settings gear and help menu. Signed in they sit beside the
   *  balance on the line below the identity; otherwise they ride the identity
   *  row. The sign-in card stays full width above the row. */
  trailing?: ReactNode;
}

/**
 * Nav-rail identity row. Signed in, it names the daemon's account and shows a
 * compact credit balance; signed out, it offers sign-in; without a configured
 * account service it is the plain local-mode chip and shows nothing cloud.
 */
export function AccountChip({ onOpenSettings, trailing }: Props) {
  const { t, locale } = useI18n();
  const { status } = useOpenPixoAccount();
  const available = isCloudAccountAvailable(status);
  const user = available && status?.signedIn ? status.user : null;
  const { credits } = useOpenPixoCredits(user !== null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    firstItemRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);
  useEffect(() => { if (!user) setMenuOpen(false); }, [user]);

  const name = user ? accountDisplayName(user) : t('account.localName');
  const detail = user ? user.email : t('account.byokDetail');
  const initial = user ? accountInitial(user) : Array.from(name)[0]?.toLocaleUpperCase();
  const creditsLabel = credits ? formatCredits(credits.available, locale) : null;

  async function signOut() {
    setMenuOpen(false);
    setSigningOut(true);
    try {
      setOpenPixoAccountStatus(await signOutOpenPixo());
    } catch {
      // The session is still valid; Settings › Account shows the error detail on retry.
      onOpenSettings?.('account');
    } finally {
      setSigningOut(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div className={styles.root} ref={rootRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    }}>
      {/* Signed out with an account service: the account is how hosted
          generation is paid for, so it gets a real call to action, not a
          corner button. */}
      {available && !user ? (
        <div className={styles.promo} data-testid="entry-nav-sign-in-card">
          <strong>{t('account.promoTitle')}</strong>
          <span>{t('account.promoBody')}</span>
          <Button variant="secondary" size="sm" className={styles.promoButton} data-testid="entry-nav-sign-in"
            onClick={() => setSignInOpen(true)}>
            {t('account.signIn')}
          </Button>
        </div>
      ) : null}
      <div className={styles.row}>
        <Button
          ref={triggerRef}
          variant="ghost"
          className={styles.trigger}
          data-testid="entry-nav-local-account"
          aria-label={`${name} · ${detail}`}
          aria-haspopup={user ? 'menu' : undefined}
          aria-expanded={user ? menuOpen : undefined}
          disabled={signingOut}
          onClick={() => user ? setMenuOpen((open) => !open) : onOpenSettings?.()}
          onKeyDown={(event) => {
            if (user && event.key === 'ArrowDown') {
              event.preventDefault();
              setMenuOpen(true);
            }
          }}
        >
          <span className={styles.avatar} aria-hidden="true">{initial}</span>
          <span className={styles.identity}>
            <span className={styles.name}>{name}</span>
            <span className={styles.detail}>{detail}</span>
          </span>
        </Button>
        {user ? null : trailing}
      </div>
      {/* Signed in, the name, the balance and the two controls need more room
          than one rail row has: the balance and controls get their own line,
          present from the first paint so nothing moves when credits arrive. */}
      {user ? (
        <div className={styles.tools}>
          {creditsLabel !== null ? (
            <Button variant="ghost" size="sm" className={styles.credits} data-testid="entry-nav-credits"
              aria-label={t('account.creditsChipAria', { n: creditsLabel })}
              onClick={() => onOpenSettings?.('account')}>
              <CoinGlyph className={styles.coin} />
              <span aria-hidden="true">{t('store.credits', { count: creditsLabel })}</span>
            </Button>
          ) : <span />}
          {trailing}
        </div>
      ) : null}
      <SignInDialog open={signInOpen && available && !user} onClose={() => setSignInOpen(false)} />
      {user ? (
        <div className={styles.menu} role="menu" aria-label={t('account.menuAria')}
          aria-hidden={!menuOpen} data-open={menuOpen}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }}>
          <Button ref={firstItemRef} variant="ghost" role="menuitem" className={styles.menuItem}
            tabIndex={menuOpen ? 0 : -1} onClick={() => {
              setMenuOpen(false);
              onOpenSettings?.('account');
            }}>{t('account.manage')}</Button>
          <Button variant="ghost" role="menuitem" className={styles.menuItem}
            tabIndex={menuOpen ? 0 : -1} onClick={() => void signOut()}>{t('account.signOut')}</Button>
        </div>
      ) : null}
    </div>
  );
}
