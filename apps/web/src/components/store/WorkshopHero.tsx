import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Button, Eyebrow } from '@openpixo/components';
import type { StoreCatalogItem } from '@openpixo/contracts';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useI18n } from '../../i18n';
import { navigate } from '../../router';
import { FeaturedSkillsPack } from './FeaturedSkillsPack';
import { StoreCover } from './StoreCover';
import { CreditAmount } from './StorePrice';
import { itemDescription, itemTitle, needsPurchase, type HeroSlide } from './workshop-catalog';
import styles from './WorkshopHero.module.css';

const AUTOPLAY_MS = 8000;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * The Workshop spotlight carousel. Slides auto-advance until the person
 * touches the carousel in any way (or never, with reduced motion); arrows,
 * dots, Left/Right keys and a pause button stay available throughout.
 */
export function WorkshopHero({ slides, installingName, onInstall, onBuy, examplesOpen, onToggleExamples }: {
  slides: HeroSlide[];
  installingName?: string;
  onInstall: (item: StoreCatalogItem) => Promise<void>;
  onBuy: (item: StoreCatalogItem) => void;
  examplesOpen: boolean;
  onToggleExamples: () => void;
}) {
  const { t, locale } = useI18n();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [hovered, setHovered] = useState(false);
  const root = useRef<HTMLElement>(null);
  const total = slides.length;
  const active = Math.min(index, Math.max(total - 1, 0));

  useEffect(() => {
    if (!playing || hovered || total < 2) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'hidden') setIndex(current => (current + 1) % total);
    }, AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [playing, hovered, total, active]);

  if (!total) return null;
  const go = (next: number) => { setPlaying(false); setIndex((next + total) % total); };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); go(active + 1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); go(active - 1); }
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const node = root.current;
    if (!node || event.pointerType === 'touch') return;
    const box = node.getBoundingClientRect();
    node.style.setProperty('--hero-x', ((event.clientX - box.left) / box.width - 0.5).toFixed(3));
    node.style.setProperty('--hero-y', ((event.clientY - box.top) / box.height - 0.5).toFixed(3));
  };

  return <section ref={root} className={styles.hero} aria-roledescription="carousel" aria-label={t('workshop.hero.label')}
    data-testid="workshop-hero" onKeyDown={onKeyDown} onPointerMove={onPointerMove}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => {
      setHovered(false);
      root.current?.style.setProperty('--hero-x', '0');
      root.current?.style.setProperty('--hero-y', '0');
    }}
    onFocus={() => setPlaying(false)}>
    <div className={styles.stage} aria-live={playing ? 'off' : 'polite'}>
      {slides.map((slide, slideIndex) => {
        const current = slideIndex === active;
        const label = t('workshop.hero.slide', { current: String(slideIndex + 1), total: String(total) });
        return <div key={slideKey(slide)} className={styles.slide} data-active={current} aria-hidden={!current}
          role="group" aria-roledescription="slide" aria-label={label}>
          <SlideBackdrop slide={slide} />
          <div className={styles.copy}>
            {slide.kind === 'toolkit' ? <>
              <Eyebrow className={styles.eyebrow}>{t('workshop.featured')}</Eyebrow>
              <FeaturedSkillsPack skills={slide.skills} onInstall={onInstall} installing={Boolean(installingName)}
                examplesOpen={examplesOpen} onToggleExamples={onToggleExamples} />
            </> : <ItemSlideCopy item={slide.item} eyebrow={t(slide.kind === 'pack' ? 'workshop.hero.flagship' : 'workshop.hero.template')}
              installing={installingName === slide.item.name} disabled={Boolean(installingName)} onInstall={onInstall} onBuy={onBuy} locale={locale} />}
          </div>
          <SlideVisual slide={slide} eager={slideIndex === 0} />
        </div>;
      })}
    </div>
    {total > 1 ? <div className={styles.nav}>
      <Button variant="ghost" size="icon" className={styles.navButton} aria-label={t('workshop.hero.previous')} onClick={() => go(active - 1)}><ChevronLeft size={18} aria-hidden="true" /></Button>
      <div className={styles.dots}>{slides.map((slide, slideIndex) => <button key={slideKey(slide)} type="button" className={styles.dot}
        data-active={slideIndex === active} data-playing={playing && !hovered && slideIndex === active}
        aria-current={slideIndex === active ? 'true' : undefined}
        aria-label={t('workshop.hero.show', { name: slideName(slide, locale, t('workshop.packLead') + t('workshop.packAccent')) })}
        onClick={() => go(slideIndex)}><span /></button>)}</div>
      <Button variant="ghost" size="icon" className={styles.navButton} aria-label={t('workshop.hero.next')} onClick={() => go(active + 1)}><ChevronRight size={18} aria-hidden="true" /></Button>
      <Button variant="ghost" size="icon" className={styles.navButton} aria-label={t(playing ? 'workshop.hero.pause' : 'workshop.hero.play')}
        aria-pressed={!playing} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}</Button>
    </div> : null}
  </section>;
}

function slideKey(slide: HeroSlide) {
  return slide.kind === 'toolkit' ? 'toolkit' : slide.item.name;
}

function slideName(slide: HeroSlide, locale: string, toolkit: string) {
  return slide.kind === 'toolkit' ? toolkit : itemTitle(slide.item, locale);
}

function ItemSlideCopy({ item, eyebrow, installing, disabled, onInstall, onBuy, locale }: {
  item: StoreCatalogItem; eyebrow: string; installing: boolean; disabled: boolean; locale: string;
  onInstall: (item: StoreCatalogItem) => Promise<void>; onBuy: (item: StoreCatalogItem) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const title = itemTitle(item, locale);
  const tags = (item.tags ?? []).filter(tag => !['first-party', 'openpixo'].includes(tag)).slice(0, 4);
  const paid = needsPurchase(item);
  const open = () => navigate({ kind: 'home', view: 'store', storeItemName: item.name });
  return <>
    <Eyebrow className={styles.eyebrow}>{eyebrow}</Eyebrow>
    <h2 className={styles.title}>{title}</h2>
    <p className={styles.description}>{itemDescription(item, locale)}</p>
    {tags.length ? <ul className={styles.tags}>{tags.map(tag => <li key={tag}>#{tag}</li>)}</ul> : null}
    <div className={styles.actions}>
      {item.installedVersion ? <span className={styles.badge} data-state="owned">{t('store.installed')}</span>
        : item.pricing.type === 'paid' && item.owned ? <span className={styles.badge} data-state="owned">{t('workshop.owned')}</span>
          : item.pricing.type === 'paid' ? <span className={styles.badge} data-state="paid">{item.pricing.credits === undefined ? t('store.paid') : <CreditAmount credits={item.pricing.credits} />}</span>
            : <span className={styles.badge} data-state="free">{t('store.free')}</span>}
      {item.installedVersion ? null : paid
        ? <Button variant="primary" size="lg" aria-label={t('workshop.buyItem', { name: title })} onClick={() => onBuy(item)}>{t('workshop.buy')}</Button>
        : <Button variant="primary" size="lg" disabled={disabled} aria-label={t('workshop.installItem', { name: title })} onClick={() => {
          setError('');
          void onInstall(item).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
        }}>{t(installing ? 'store.installing' : 'store.install')}</Button>}
      <Button variant="secondary" size="lg" className={styles.secondary} onClick={open}>{t('workshop.hero.view')}</Button>
    </div>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </>;
}

function SlideBackdrop({ slide }: { slide: HeroSlide }) {
  const item = slide.kind === 'toolkit' ? slide.skills[0] : slide.item;
  if (!item) return null;
  return <div className={styles.backdrop} aria-hidden="true"><StoreCover item={item} className={styles.backdropCover} /></div>;
}

const PIXELS: Array<[number, number, number]> = [[8, 18, 1], [86, 12, 2], [92, 70, 1], [14, 82, 2], [60, 6, 1], [48, 90, 1], [74, 40, 2]];

function SlideVisual({ slide, eager }: { slide: HeroSlide; eager: boolean }) {
  return <div className={styles.visual} aria-hidden="true">
    {PIXELS.map(([x, y, depth], index) => <span key={index} className={styles.pixel}
      style={{ left: `${x}%`, top: `${y}%`, '--depth': depth, animationDelay: `${index * -1.3}s` } as CSSProperties} />)}
    {slide.kind === 'toolkit'
      ? <div className={styles.mosaic}>{slide.skills.slice(0, 5).map(item => <div key={item.name} className={styles.tile}><StoreCover item={item} eager={eager} /></div>)}</div>
      : <div className={styles.frame}><StoreCover item={slide.item} eager={eager} /></div>}
  </div>;
}
