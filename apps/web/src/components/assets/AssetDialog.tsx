import { useState, type ReactNode } from 'react';
import { Button, Dialog } from '@openpixo/components';
import { useI18n } from '../../i18n';
import styles from './Assets.module.css';

export function AssetDialog({ title, drawer = false, busy = false, className, onClose, children }: { title: string; drawer?: boolean; busy?: boolean; className?: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  return <Dialog open={open} ariaLabel={title} size={drawer ? 'side-sheet' : 'md'} layout="sectioned"
    onClose={onClose} onAfterClose={() => { if (!open) onClose(); }} closeOnEscape={!busy} closeOnBackdrop={!busy}
    className={className}>
    <div className={styles.dialogContent}>
      <header className={styles.dialogHeader}><h2>{title}</h2><Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>{t('gameAssets.close')}</Button></header>
      <div className={styles.dialogBody}>{children}</div>
    </div>
  </Dialog>;
}
