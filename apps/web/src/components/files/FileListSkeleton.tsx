import { VisuallyHidden } from '@openpixo/components';
import { useT } from '../../i18n';
import styles from './FileListSkeleton.module.css';

export function FileListSkeleton() {
  const t = useT();
  return (
    <div className={styles.list} role="status" aria-busy="true" data-testid="file-list-loading">
      <VisuallyHidden>{t('common.loading')}</VisuallyHidden>
      <div aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div className={styles.row} key={index}>
            <span className={styles.icon} />
            <span className={styles.name} />
            <span className={styles.meta} />
          </div>
        ))}
      </div>
    </div>
  );
}
