import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@openpixo/components';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../i18n';
import styles from './StoreShelf.module.css';

/** One Discover shelf: a titled, horizontally scrolling rail with snap points and arrow buttons. */
export function StoreShelf({ title, subtitle, count, onSeeAll, size = 'default', children }: {
  title: string;
  subtitle?: string;
  count: number;
  onSeeAll: () => void;
  size?: 'default' | 'feature';
  children: ReactNode;
}) {
  const { t } = useI18n();
  const headingId = useId();
  const rail = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const node = rail.current;
    if (!node) return;
    const start = Math.abs(node.scrollLeft) < 4;
    const end = Math.abs(node.scrollLeft) + node.clientWidth >= node.scrollWidth - 4;
    setEdges(current => current.start === start && current.end === end ? current : { start, end });
  }, []);
  useEffect(() => {
    measure();
    const node = rail.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure, count]);
  const scroll = (direction: 1 | -1) => {
    const node = rail.current;
    if (!node) return;
    const rtl = getComputedStyle(node).direction === 'rtl' ? -1 : 1;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollBy({ left: direction * rtl * node.clientWidth * 0.85, behavior: reduced ? 'auto' : 'smooth' });
  };
  return <section className={styles.shelf} aria-labelledby={headingId} data-size={size}>
    <div className={styles.head}>
      <div className={styles.copy}>
        <h2 id={headingId}>{title}<span className={styles.count}>{count}</span></h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className={styles.controls}>
        <Button variant="ghost" size="sm" className={styles.seeAll} aria-label={t('workshop.seeAllAria', { name: title })} onClick={onSeeAll}>{t('workshop.seeAll')}</Button>
        <Button variant="secondary" size="icon" className={styles.arrow} aria-label={t('workshop.scrollPrev')} disabled={edges.start} onClick={() => scroll(-1)}><ChevronLeft size={16} aria-hidden="true" /></Button>
        <Button variant="secondary" size="icon" className={styles.arrow} aria-label={t('workshop.scrollNext')} disabled={edges.end} onClick={() => scroll(1)}><ChevronRight size={16} aria-hidden="true" /></Button>
      </div>
    </div>
    <ul ref={rail} className={styles.rail} onScroll={measure}>{children}</ul>
  </section>;
}
