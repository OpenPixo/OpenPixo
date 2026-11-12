import { useEffect, useMemo, useState } from 'react';
import type { AssetWaveform, ProjectAsset } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { fetchAssetWaveform } from '../../providers/project-assets';
import styles from './Assets.module.css';

export function AssetWaveformPreview({ asset }: { asset: ProjectAsset }) {
  const { locale, t } = useI18n();
  const [waveform, setWaveform] = useState<AssetWaveform | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchAssetWaveform(asset.projectId, asset.relPath, controller.signal)
      .then(value => { if (!controller.signal.aborted) setWaveform(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(locale === 'zh-CN' ? t('gameAssets.loadFailed') : cause instanceof Error ? cause.message : t('gameAssets.loadFailed')); });
    return () => controller.abort();
  }, [asset.projectId, asset.relPath, asset.mtime, t]);
  const path = useMemo(() => {
    const peaks = waveform?.peaks ?? [], count = Math.min(600, peaks.length);
    return Array.from({ length: count }, (_, index) => {
      let peak = 0;
      for (let i = Math.floor(index * peaks.length / count); i < Math.floor((index + 1) * peaks.length / count); i++) peak = Math.max(peak, Math.abs(peaks[i] ?? 0));
      const height = Math.min(1, peak) * 46;
      return `M${(index + 0.5) * 600 / count},${50 - height}v${2 * height || 1}`;
    }).join(' ');
  }, [waveform]);
  if (error) return <p role="alert" className={styles.error}>{error}</p>;
  if (!waveform) return <p role="status">{t('gameAssets.loading')}</p>;
  return <svg className={styles.waveform} viewBox="0 0 600 100" role="img" aria-label={t('gameAssets.waveform')}><path d={path} /></svg>;
}
