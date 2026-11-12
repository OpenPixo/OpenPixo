import { useEffect, useId, useState } from 'react';
import { Button, Dialog } from '@openpixo/components';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import styles from './PreviewGallery.module.css';

/** Sample images for an asset pack, with a lightbox that steps through them by button or arrow key. */
export function PreviewGallery({ previews, title }: { previews: string[]; title: string }) {
  const { t } = useI18n();
  const titleId = useId();
  const [open, setOpen] = useState<number>();
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const shown = previews.filter(url => !broken.has(url));
  const total = shown.length;
  const current = open === undefined ? undefined : Math.min(open, total - 1);
  useEffect(() => {
    if (current === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') setOpen(value => ((value ?? 0) + 1) % total);
      else if (event.key === 'ArrowLeft') setOpen(value => ((value ?? 0) - 1 + total) % total);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current === undefined, total]);
  if (!total) return null;
  const label = (index: number) => t('workshop.detail.preview', { current: String(index + 1), total: String(total) });
  return <section className={styles.gallery} aria-label={t('workshop.detail.previews')}>
    <ul className={styles.grid} data-count={Math.min(total, 5)}>
      {shown.map((url, index) => <li key={url}>
        <button type="button" className={styles.thumb} aria-label={t('workshop.detail.openPreview', { current: String(index + 1), total: String(total) })}
          onClick={() => setOpen(index)}>
          <img src={url} alt="" loading="lazy" decoding="async" onError={() => setBroken(set => new Set(set).add(url))} />
        </button>
      </li>)}
    </ul>
    <Dialog open={current !== undefined} onClose={() => setOpen(undefined)} size="lg" ariaLabelledBy={titleId} className={styles.lightbox}
      data-testid="workshop-lightbox">
      {current !== undefined ? <>
        <div className={styles.lightboxHead}>
          <h2 id={titleId}>{title} · {label(current)}</h2>
          <Button variant="ghost" size="icon" aria-label={t('workshop.buy.close')} onClick={() => setOpen(undefined)}><X size={18} aria-hidden="true" /></Button>
        </div>
        <div className={styles.stage}>
          <img src={shown[current]} alt={label(current)} />
          {total > 1 ? <>
            <Button variant="secondary" size="icon" className={styles.prev} aria-label={t('workshop.detail.previousImage')}
              onClick={() => setOpen((current - 1 + total) % total)}><ChevronLeft size={18} aria-hidden="true" /></Button>
            <Button variant="secondary" size="icon" className={styles.next} aria-label={t('workshop.detail.nextImage')}
              onClick={() => setOpen((current + 1) % total)}><ChevronRight size={18} aria-hidden="true" /></Button>
          </> : null}
        </div>
      </> : null}
    </Dialog>
  </section>;
}
