import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  OPENPIXO_GENERATION_ASPECTS,
  OPENPIXO_GENERATION_RESOLUTIONS,
  OPENPIXO_IMAGE_SIZES,
  openPixoResolutionCredits,
  type OpenPixoGenerationAspect,
  type OpenPixoGenerationResolution,
  type OpenPixoGenerationService,
} from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import styles from './SizePopover.module.css';

/** A shape drawn to its proportions inside an 18px square, so 21:9 reads wider than 16:9 at a glance. */
export function RatioMark({ aspect, size = 18 }: { aspect: string; size?: number }) {
  const [w, h] = aspect.split(':').map(Number);
  const ratio = w && h ? w / h : 1;
  const width = Math.max(6, Math.round(size * Math.min(1, ratio)));
  const height = Math.max(6, Math.round(size * Math.min(1, 1 / ratio)));
  return <span className={styles.ratioBox} style={{ width: size, height: size }} aria-hidden="true">
    <span className={styles.ratio} style={{ width, height }} /></span>;
}

/**
 * A pill that opens a panel of choices under it. The panel lives in the top layer, so the
 * box's own scrolling and glass never clip it; the browser closes it on Escape or a click
 * elsewhere. Without the popover API (a test DOM) it simply shows while open.
 */
export function PillPopover({ trigger, label, testId, children }: {
  trigger: ReactNode;
  /** What the pill is for, read out with its value. */
  label: string;
  testId?: string;
  children: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const anchor = `--pill-${id.replace(/[^a-zA-Z0-9]/gu, '')}`;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  // A click on the pill while open: the browser has already closed it on pointerdown.
  const closedByPress = useRef(false);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onToggle = (event: Event) => setOpen((event as Event & { newState?: string }).newState === 'open');
    panel.addEventListener('toggle', onToggle);
    return () => panel.removeEventListener('toggle', onToggle);
  }, []);
  const panel = () => panelRef.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
  const show = () => { const element = panel(); if (element?.showPopover) element.showPopover(); else setOpen(true); };
  const close = () => { const element = panel(); if (element?.hidePopover && open) element.hidePopover(); else setOpen(false); };
  return <>
    <button type="button" className={styles.trigger} style={{ anchorName: anchor } as CSSProperties} aria-expanded={open} aria-haspopup="dialog"
      aria-label={label} data-testid={testId}
      onPointerDown={() => { closedByPress.current = open; }}
      onClick={() => { if (closedByPress.current) { closedByPress.current = false; return; } if (open) close(); else show(); }}>
      {trigger}<span className={styles.caret} aria-hidden="true" />
    </button>
    <div ref={panelRef} {...{ popover: 'auto' } as Record<string, string>} role="dialog" aria-label={label} className={styles.panel}
      style={{ positionAnchor: anchor } as CSSProperties} data-open={open || undefined} data-testid={testId ? `${testId}-panel` : undefined}>
      {open && children(close)}
    </div>
  </>;
}

/** 比例 · 分辨率: the shape and size of an image, each size with what it adds to the price. */
export function ShapePicker({ aspect, resolution, aspects, resolutions, service, paid, onChange }: {
  aspect: string;
  resolution: OpenPixoGenerationResolution;
  /** What can be picked now; the rest show, greyed. */
  aspects: readonly OpenPixoGenerationAspect[];
  resolutions: readonly OpenPixoGenerationResolution[];
  /** The hosted service it is priced on, for what a larger size adds. */
  service: Pick<OpenPixoGenerationService, 'pricing'> | undefined;
  paid: boolean;
  onChange: (patch: { aspect?: string; resolution?: OpenPixoGenerationResolution }) => void;
}) {
  const { t } = useI18n();
  const size = OPENPIXO_IMAGE_SIZES[resolution][aspect as OpenPixoGenerationAspect];
  return <PillPopover label={t('generate.sizePill')} testId="generate-size"
    trigger={<><RatioMark aspect={aspect} size={16} /><span className={styles.value}>{aspect}</span>
      <span className={styles.dot} aria-hidden="true" /><span className={styles.value}>{resolution.toUpperCase()}</span></>}>
    {() => <div className={styles.sections}>
      <section className={styles.section}>
        <h4 className={styles.heading}>{t('generate.aspectTitle')}</h4>
        <div className={styles.aspects} role="radiogroup" aria-label={t('generate.aspectTitle')}>
          {OPENPIXO_GENERATION_ASPECTS.map(value => {
            const offered = aspects.includes(value);
            return <button key={value} type="button" role="radio" aria-checked={value === aspect} disabled={!offered} className={styles.aspect}
              title={offered ? undefined : t('generate.sizeUnavailable')} onClick={() => onChange({ aspect: value })} data-testid={`generate-aspect-${value}`}>
              <RatioMark aspect={value} /><span>{value}</span></button>;
          })}
        </div>
      </section>
      <section className={styles.section}>
        <h4 className={styles.heading}>{t('generate.resolutionTitle')}</h4>
        <div className={styles.resolutions} role="radiogroup" aria-label={t('generate.resolutionTitle')}>
          {OPENPIXO_GENERATION_RESOLUTIONS.map(value => {
            const offered = resolutions.includes(value);
            const extra = paid ? openPixoResolutionCredits(service, value) : 0;
            return <button key={value} type="button" role="radio" aria-checked={value === resolution} disabled={!offered} className={styles.resolution}
              title={offered ? undefined : t('generate.sizeUnavailable')} onClick={() => onChange({ resolution: value })} data-testid={`generate-resolution-${value}`}>
              <span className={styles.resolutionName}>{value.toUpperCase()}</span>
              {extra > 0 && <span className={styles.extra}>{t('generate.resolutionExtra', { count: extra })}</span>}
            </button>;
          })}
        </div>
        {size && <p className={styles.pixels}>{t('generate.pixelSize', { width: size.width, height: size.height })}</p>}
      </section>
    </div>}
  </PillPopover>;
}

/** 数量: how many to make, as a grid of numbers. */
export function CountPicker({ count, max, onChange }: { count: number; max: number; onChange: (count: number) => void }) {
  const { t } = useI18n();
  const shown = Math.min(count, max);
  return <PillPopover label={t('generate.count')} testId="generate-count"
    trigger={<><span className={styles.stack} aria-hidden="true" /><span className={styles.value}>{t('generate.countValue', { count: shown })}</span></>}>
    {close => <section className={styles.section}>
      <h4 className={styles.heading}>{t('generate.count')}</h4>
      <div className={styles.counts} role="radiogroup" aria-label={t('generate.count')} data-many={max > 4 || undefined}>
        {Array.from({ length: max }, (_, index) => index + 1).map(value => <button key={value} type="button" role="radio" aria-checked={value === shown}
          className={styles.countOption} onClick={() => { onChange(value); close(); }} data-testid={`generate-count-${value}`}>{value}</button>)}
      </div>
    </section>}
  </PillPopover>;
}
