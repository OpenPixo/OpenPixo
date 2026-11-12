import { useEffect, useId, useState } from 'react';
import { Button, Select } from '@openpixo/components';
import type { ProjectAsset } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { projectRawUrl } from '../../providers/registry';
import { setProjectStyleReference } from '../../providers/styles';
import styles from './StyleReferencePicker.module.css';

const REFERENCE_IMAGE = /\.(?:png|jpe?g|webp)$/iu;

/**
 * The image new art should match. The agent is reminded of it when it makes an image
 * without a reference; it is never attached for it, so art meant to look different
 * stays free (owner, 2026-11-11).
 */
export function StyleReferencePicker({ projectId, current, assets, disabled }: {
  projectId: string; current: string | null; assets: ProjectAsset[]; disabled?: boolean;
}) {
  const { locale, t } = useI18n();
  const selectId = useId();
  const [choice, setChoice] = useState(current ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setChoice(current ?? ''), [current]);
  const images = assets.filter(asset => asset.kind === 'image' && REFERENCE_IMAGE.test(asset.relPath))
    .map(asset => asset.relPath).sort((a, b) => a.localeCompare(b));

  async function save(path: string | null) {
    if (disabled || pending) return;
    setPending(true); setError('');
    try { await setProjectStyleReference(projectId, path, undefined, locale); }
    catch { setError(t('studio.styleReference.saveFailed')); }
    finally { setPending(false); }
  }

  return <section className={styles.reference} aria-labelledby={`${selectId}-title`}>
    <div className={styles.text}>
      <h4 id={`${selectId}-title`}>{t('studio.styleReference.title')}</h4>
      <p>{t('studio.styleReference.description')}</p>
    </div>
    <div className={styles.row}>
      {current && <img className={styles.thumb} src={projectRawUrl(projectId, current)} alt="" />}
      <label className={styles.field} htmlFor={selectId}>
        <span>{current ? t('studio.styleReference.current') : t('studio.styleReference.none')}</span>
        <Select id={selectId} value={choice} disabled={disabled || pending || images.length === 0}
          onChange={event => setChoice(event.target.value)}>
          <option value="">{t('studio.styleReference.choose')}</option>
          {images.map(path => <option key={path} value={path}>{path}</option>)}
        </Select>
      </label>
      <Button size="sm" variant="secondary" disabled={disabled || pending || !choice || choice === current}
        aria-busy={pending} onClick={() => void save(choice)}>{t('studio.styleReference.set')}</Button>
      {current && <Button size="sm" variant="ghost" disabled={disabled || pending}
        onClick={() => void save(null)}>{t('studio.styleReference.clear')}</Button>}
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
