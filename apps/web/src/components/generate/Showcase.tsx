import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ArtStyle } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { FadeImage, loadingFrame } from './FadeImage';
import styles from './Showcase.module.css';

/** A style's own cover, served by the daemon, or null when it has none. */
export function stylePreviewUrl(style: Pick<ArtStyle, 'previews'>): string | null {
  return style.previews.find(path => /^\/api\/styles\/[^/]+\/previews\/\d+$/u.test(path)) ?? null;
}

/**
 * The wall behind the headline: games made in each installed style, drifting past in
 * two rows, so the page opens on what can be made rather than on a form. Decorative:
 * the same styles are offered as cards further down.
 */
export function StyleWall({ items }: { items: readonly ArtStyle[] }) {
  const covers = items.map(stylePreviewUrl).filter((url): url is string => Boolean(url));
  if (covers.length < 4) return <div className={styles.wall} aria-hidden="true" data-empty />;
  const half = Math.ceil(covers.length / 2);
  // Both rows show every style, the second starting halfway, so neither runs short on a wide window.
  const rows = [covers, [...covers.slice(half), ...covers.slice(0, half)]];
  return <div className={styles.wall} aria-hidden="true" data-testid="generate-style-wall">
    {rows.map((row, index) => <div key={index} className={styles.wallRow} data-reverse={index === 1 || undefined}>
      {/* Twice over, so the drift loops without a seam. */}
      {[...row, ...row].map((url, position) => <FadeImage key={`${url}-${position}`} src={url} loading="lazy" draggable={false} />)}
    </div>)}
  </div>;
}

/**
 * A row of cards across the page that scrolls sideways, with arrows at the ends and the
 * ends fading out: it never leaves a half-empty row, whatever the width. 预设 and 画风
 * both use it.
 */
export function Strip({ children, listClassName, testId, count }: { children: ReactNode; listClassName?: string; testId?: string; count: number }) {
  const { t } = useI18n();
  const list = useRef<HTMLUListElement | null>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const measure = useCallback(() => {
    const element = list.current;
    if (!element) return;
    setEdges({ start: element.scrollLeft <= 2, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, count]);
  const page = (direction: 1 | -1) => list.current?.scrollBy({ left: direction * list.current.clientWidth * 0.85, behavior: 'smooth' });
  return <div className={styles.strip} data-start={edges.start || undefined} data-end={edges.end || undefined}>
    <ul ref={list} className={`${styles.stripList}${listClassName ? ` ${listClassName}` : ''}`} onScroll={measure} data-testid={testId}>{children}</ul>
    <button type="button" className={styles.arrow} data-side="start" aria-label={t('generate.scrollBack')} onClick={() => page(-1)} tabIndex={-1}>‹</button>
    <button type="button" className={styles.arrow} data-side="end" aria-label={t('generate.scrollOn')} onClick={() => page(1)} tabIndex={-1}>›</button>
  </div>;
}

/**
 * 画风: every installed style as a picture of a game made in it, in a strip across the
 * page. A click puts the style in the box (and switches it to images); the one in the box
 * is marked.
 */
export function StyleCards({ items, activeId, onPick }: { items: readonly ArtStyle[]; activeId: string | null | undefined; onPick: (style: ArtStyle) => void }) {
  const { t } = useI18n();
  const usable = items.filter(style => stylePreviewUrl(style));
  if (!usable.length) return null;
  return <Strip listClassName={styles.styles} testId="generate-styles" count={usable.length}>
    {usable.map(style => {
      const active = style.id === activeId;
      return <li key={style.id}>
        <button type="button" className={`${styles.style} ${loadingFrame}`} aria-pressed={active} onClick={() => onPick(style)} data-testid="generate-style-card" data-style-id={style.id}>
          <FadeImage src={stylePreviewUrl(style)!} loading="lazy" draggable={false} />
          <span className={styles.styleShade} aria-hidden="true" />
          <span className={styles.styleName}>{style.title}</span>
          <span className={styles.styleUse} aria-hidden="true">{active ? t('generate.styleInBox') : t('generate.styleUse')}</span>
        </button>
      </li>;
    })}
  </Strip>;
}
