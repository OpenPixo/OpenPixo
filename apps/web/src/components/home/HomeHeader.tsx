import { AccentText, Button } from '@openpixo/components';
import { FolderOpen, Plus } from 'lucide-react';
import { useI18n } from '../../i18n';
import styles from './HomeDashboard.module.css';

/**
 * One main action per screen. A new user's is New game; a returning user's is
 * Continue on the card below, so here New game steps back to a secondary.
 */
export function HomeHeader({ state, importing, canImport, canCreate, onOpenFolder, onCreateGame, onOpenDoctor }: {
  state: 'first' | 'returning' | 'loading';
  importing: boolean;
  canImport: boolean;
  canCreate: boolean;
  onOpenFolder: () => void;
  onCreateGame: () => void;
  onOpenDoctor?: () => void;
}) {
  const { t } = useI18n();
  if (state === 'loading') return <header className={`${styles.header} ${styles.headerLoading}`} />;
  const first = state === 'first';
  const newGame = <Button variant={first ? 'primary' : 'secondary'} size={first ? 'lg' : undefined} disabled={!canCreate} onClick={onCreateGame}>
    <Plus size={15} aria-hidden="true" />{t('home.dashboard.newGame')}
  </Button>;
  const quiet = <>
    <Button variant="ghost" disabled={!canImport || importing} onClick={onOpenFolder}>
      <FolderOpen size={15} aria-hidden="true" />{t(importing ? 'home.dashboard.openingFolder' : 'home.dashboard.openFolder')}
    </Button>
    {onOpenDoctor && <Button variant="ghost" className={styles.doctor} onClick={onOpenDoctor}>{t('home.dashboard.environment')}</Button>}
  </>;
  if (first) return <header className={styles.header}>
    <h1 className={styles.title}>{t('home.dashboard.headingBefore')}<AccentText>{t('home.dashboard.headingAccent')}</AccentText>{t('home.dashboard.headingAfter')}</h1>
    <p className={styles.lede}>{t('home.dashboard.lede')}</p>
    <div className={styles.actions}>{newGame}{quiet}</div>
  </header>;
  return <header className={`${styles.header} ${styles.headerReturning}`}>
    <h1 className={styles.title}>{t('home.dashboard.welcomeBack')}</h1>
    <div className={styles.actions}>{quiet}{newGame}</div>
  </header>;
}
