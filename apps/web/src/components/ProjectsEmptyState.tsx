import { Button } from '@openpixo/components';
import { useT } from '../i18n';
import styles from './ProjectsEmptyState.module.css';

/** A search that matched nothing: say so, and offer to clear it. */
export function ProjectsNoMatch({ query, onClear }: { query: string; onClear: () => void }) {
  const t = useT();
  return <div className={styles.noMatch}>
    <p className={styles.title}>{t('designs.emptyNoMatch')}</p>
    <p className={styles.lede}>{t('designs.emptyNoMatchHint', { query: query.trim() })}</p>
    <Button variant="secondary" size="sm" className={styles.cta} data-testid="designs-clear-search" onClick={onClear}>
      {t('designs.clearSearch')}
    </Button>
  </div>;
}
