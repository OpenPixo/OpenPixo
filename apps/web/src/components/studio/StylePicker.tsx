import type { ArtStyle } from '@openpixo/contracts';
import { useState } from 'react';
import { Button } from '@openpixo/components';
import { useI18n } from '../../i18n';
import { useArtStyles } from './useArtStyles';
import type { ProjectArtDimension } from './project-catalog';
import { StudioDisclosure } from './StudioDisclosure';
import styles from './StylePicker.module.css';

export function StyleThumbnail({ style }: { style?: ArtStyle | null }) {
  const { t } = useI18n();
  const preview = style?.previews.find(path => /^\/api\/styles\/[^/]+\/previews\/\d+$/.test(path));
  // A preview that fails to load falls back to the palette card instead of a broken-image glyph.
  const [failed, setFailed] = useState<string | null>(null);
  if (preview && failed !== preview) return <img className={styles.thumbnail} src={preview} alt="" loading="lazy" onError={() => setFailed(preview)} />;
  const palette = style?.palette?.filter(color => /^#[0-9a-f]{6}$/i.test(color)) ?? [];
  return <div className={styles.palettePreview} aria-hidden="true">
    {palette.length > 0 && <span className={styles.swatches} aria-hidden="true">{palette.map((color, index) => <span key={`${color}:${index}`} style={{ backgroundColor: color }} />)}</span>}
    <small>{t(palette.length ? 'studio.styles.paletteOnly' : 'studio.styles.noPreview')}</small>
  </div>;
}

export function StyleChoices({ items, value, onChange, disabled, firstLabel, firstStyle, firstValue, includeNone, layout = 'row' }: {
  items: ArtStyle[]; value: string | null | undefined; onChange: (id: string | null | undefined) => void;
  disabled?: boolean; firstLabel: string; firstStyle?: ArtStyle | null; firstValue: null | undefined;
  includeNone?: boolean;
  /** A scrolling row (the default), or a wrapping grid of larger pictures. */
  layout?: 'row' | 'grid';
}) {
  const { t } = useI18n();
  const choices = [{ id: firstValue, label: firstLabel, style: firstStyle },
    ...(includeNone ? [{ id: null, label: t('studio.style.none'), style: null }] : []),
    ...items.map(style => ({ id: style.id, label: style.title, style }))];
  return <div className={styles.choices} data-layout={layout} role="group" aria-label={t('studio.style.title')}>
    {choices.map(choice => <Button key={choice.id === undefined ? 'project-default' : choice.id === null ? 'no-style' : 'style:' + choice.id} type="button" variant="ghost" className={styles.choice}
      disabled={disabled} aria-pressed={value === choice.id} title={choice.style?.description}
      onClick={() => onChange(choice.id)}>
      <span className={styles.art}><StyleThumbnail style={choice.style} />
        <span className={styles.check} aria-hidden="true">✓</span></span>
      <span className={styles.choiceLabel}>{choice.label}</span>
      {choice.id === firstValue && firstStyle && <span className={styles.defaultName}>{firstStyle.title}</span>}
    </Button>)}
  </div>;
}

export function RecipeStylePicker({ projectId, value, onChange, disabled, onBrowseStyles, dimension }: {
  projectId: string | null; value: string | null | undefined; onChange: (id: string | null | undefined) => void;
  disabled?: boolean; onBrowseStyles?: () => void;
  dimension?: ProjectArtDimension | null;
}) {
  const { t } = useI18n();
  const catalog = useArtStyles(projectId);
  const [otherDimension, setOtherDimension] = useState(false);
  const items = catalog.styles.filter(style => !dimension || otherDimension || style.dimension.includes(dimension));
  const projectStyle = catalog.projectStyle?.style;
  const current = value === undefined
    ? projectStyle ? `${t('studio.style.projectDefault')} · ${projectStyle.title}` : t('studio.style.projectDefault')
    : value === null ? t('studio.style.none') : catalog.styles.find(style => style.id === value)?.title ?? value;
  // The project style already applies by default, so the picker is an option
  // the user opens, not a wall of thumbnails above the form.
  return <StudioDisclosure title={t('studio.style.title')} meta={current}>
  <section className={styles.root} aria-label={t('studio.style.title')}>
    {onBrowseStyles && <header className={styles.header}><span />
      <Button type="button" size="sm" variant="ghost" onClick={onBrowseStyles}>{t('studio.style.browse')}</Button></header>}
    {dimension && <Button size="sm" variant="ghost" aria-pressed={otherDimension} onClick={() => setOtherDimension(value => !value)}>
      {t(dimension === '2d' ? 'studio.styles.show3D' : 'studio.styles.show2D')}</Button>}
    <StyleChoices items={items} value={value} onChange={onChange} disabled={disabled || catalog.loading}
      firstLabel={t('studio.style.projectDefault')} firstStyle={catalog.projectStyle?.style} firstValue={undefined} includeNone />
    {catalog.loading && <p className={styles.status} role="status">{t('studio.style.loading')}</p>}
    {catalog.failed && <div className={styles.status} role="status"><span>{t('studio.style.loadFailed')}</span>
      <Button type="button" size="sm" variant="ghost" onClick={catalog.retry}>{t('studio.style.retry')}</Button></div>}
  </section>
  </StudioDisclosure>;
}
