import { useEffect, useId, useState } from 'react';
import { Button, Card, Eyebrow, Input, Tag, VisuallyHidden } from '@openpixo/components';
import type { ProjectAsset } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { setProjectArtStyle } from '../../providers/styles';
import { StyleThumbnail } from './StylePicker';
import { StyleReferencePicker } from './StyleReferencePicker';
import { useProjectArtPalette } from './useProjectArtPalette';
import { useArtStyles } from './useArtStyles';
import { suggestedArtStyle, type ProjectArtDimension } from './project-catalog';
import styles from './ProjectStyleGallery.module.css';

export function ProjectStyleGallery({ projectId, viewerOnly, dimension = null, assets = [], projectLoading = false, embedded = false, onCurrentStyle }: {
  projectId: string; viewerOnly?: boolean; dimension?: ProjectArtDimension | null; assets?: ProjectAsset[]; projectLoading?: boolean;
  /** Inside a Generate disclosure whose summary already names the section. */
  embedded?: boolean;
  /** Reports the project style's title (or null) whenever it changes. */
  onCurrentStyle?: (title: string | null) => void;
}) {
  const { locale, t } = useI18n();
  const catalog = useArtStyles(projectId);
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [otherDimension, setOtherDimension] = useState(false);
  const groupId = useId();
  useEffect(() => setOtherDimension(false), [projectId, dimension]);
  const currentId = catalog.projectStyle?.styleId ?? null;
  const currentTitle = catalog.projectStyle?.style?.title ?? null;
  // Only a finished read reports: "no project style" must not flash while the answer is on its way.
  useEffect(() => { if (!catalog.loading) onCurrentStyle?.(currentTitle); }, [catalog.loading, currentTitle, onCurrentStyle]);
  const colorCount = useProjectArtPalette(projectId, assets, dimension !== '3d');
  const suggestedId = suggestedArtStyle(catalog.styles, assets, dimension, colorCount);
  const groups: ProjectArtDimension[] = dimension ? [dimension, dimension === '2d' ? '3d' : '2d'] : ['2d', '3d'];

  async function save(styleId: string | null) {
    if (viewerOnly || pending !== undefined || catalog.loading || catalog.failed) return;
    setPending(styleId); setError('');
    try { await setProjectArtStyle(projectId, styleId, undefined, locale); }
    catch { setError(t('studio.style.saveFailed')); }
    finally { setPending(undefined); }
  }

  return <section id="studio-art-styles" className={styles.section} aria-labelledby="studio-art-styles-title">
    <header className={styles.header}>
      <div>{!embedded && <Eyebrow>{t('studio.sections.stylesEyebrow')}</Eyebrow>}
        <h3 id="studio-art-styles-title" className={embedded ? styles.embeddedTitle : undefined}>{embedded
          ? <VisuallyHidden>{t('studio.sections.styles')}</VisuallyHidden> : t('studio.sections.styles')}</h3>
        <p>{t('studio.sections.stylesDescription')}</p></div>
      {currentId && <Button size="sm" variant="ghost" disabled={viewerOnly || catalog.loading || catalog.failed || pending !== undefined}
        aria-busy={pending === null} onClick={() => void save(null)}>{t('studio.style.clearDefault')}</Button>}
    </header>
    {catalog.loading && <p role="status" className={styles.status}>{t('studio.style.loading')}</p>}
    {catalog.failed && <div className={styles.status} role="status"><span>{t('studio.style.loadFailed')}</span>
      <Button size="sm" variant="secondary" onClick={catalog.retry}>{t('studio.style.retry')}</Button></div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!catalog.loading && !catalog.failed && !catalog.styles.length && <p className={styles.status}>{t('studio.style.empty')}</p>}
    {!catalog.loading && !catalog.failed && catalog.projectStyle && <StyleReferencePicker projectId={projectId}
      current={catalog.projectStyle.referenceImage ?? null} assets={assets} disabled={viewerOnly || projectLoading} />}
    {dimension && <label className={styles.toggle}><Input type="checkbox" checked={otherDimension}
      onChange={event => setOtherDimension(event.target.checked)} />{t(dimension === '2d' ? 'studio.styles.show3D' : 'studio.styles.show2D')}</label>}
    {!projectLoading && groups.filter(group => !dimension || group === dimension || otherDimension).map(group => <section
      key={group} aria-labelledby={`${groupId}-${group}`} className={styles.group}>
      <h4 id={`${groupId}-${group}`}>{t(group === '2d' ? 'studio.styles.twoD' : 'studio.styles.threeD')}</h4>
      <div className={styles.grid}>
      {catalog.styles.filter(style => style.dimension.includes(group)).map(style => <Card key={style.id} interactive className={styles.card}
        data-selected={currentId === style.id} data-suggested={suggestedId === style.id}>
        <div className={styles.cover}><StyleThumbnail style={style} />
          {currentId === style.id && <Tag className={styles.defaultTag}>{t('studio.style.projectDefault')}</Tag>}</div>
        <div className={styles.info}><h4>{style.title}</h4><p>{style.description}</p>
          {suggestedId === style.id && <Tag className={styles.suggestedTag} title={t('studio.styles.suggestionHint')}>{t('studio.styles.suggested')}</Tag>}
          <Button size="sm" variant={currentId === style.id ? 'ghost' : 'secondary'}
            disabled={viewerOnly || catalog.loading || catalog.failed || pending !== undefined || currentId === style.id}
            aria-busy={pending === style.id} onClick={() => void save(style.id)}>{currentId === style.id
              ? t('studio.style.projectDefault') : t('studio.style.setDefault')}</Button></div>
      </Card>)}
      </div>
    </section>)}
  </section>;
}
