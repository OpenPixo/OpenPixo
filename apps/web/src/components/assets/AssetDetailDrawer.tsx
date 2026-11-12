import { useEffect, useState } from 'react';
import { Button, Input } from '@openpixo/components';
import type { AssetGrid, AssetProvenance, ProjectAsset } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { assetThumbnailUrl, fetchAssetDetail, fetchAssetRun, updateAssetGrid, updateAssetTags } from '../../providers/project-assets';

import { projectRawUrl } from '../../providers/registry';
import { AssetDialog } from './AssetDialog';
import { AssetWaveformPreview } from './AssetWaveformPreview';
import { SpritePreview } from './SpritePreview';
import { PixelAssetImage } from './PixelAssetImage';
import { isPixelAsset } from './frame-grid';
import styles from './Assets.module.css';


export function assetDimensions(asset: ProjectAsset): string {
  return asset.width && asset.height ? `${asset.width} × ${asset.height}` : asset.durationMs !== undefined ? `${(asset.durationMs / 1000).toFixed(1)} s` : '—';
}

function AssetRunLink({ runId }: { runId: string }) {
  const fallback = `/api/runs/${encodeURIComponent(runId)}`;
  const [href, setHref] = useState(fallback);
  useEffect(() => {
    const controller = new AbortController();
    void fetchAssetRun(runId, controller.signal).then(run => {
      if (!controller.signal.aborted && run.projectId && run.conversationId) {
        setHref(`/projects/${encodeURIComponent(run.projectId)}/conversations/${encodeURIComponent(run.conversationId)}`);
      }
    }).catch(() => { /* Historical runs may no longer be in the live run registry. */ });
    return () => controller.abort();
  }, [runId]);
  return <a href={href} target="_blank" rel="noreferrer">{runId}</a>;
}

interface Props {
  initial: ProjectAsset;
  files?: readonly string[];
  viewerOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOpenFile: (path: string) => void;
  onOpenExternal: (path: string) => void;
  onEdit?: (asset: ProjectAsset) => void;
  onAddToChat?: (asset: ProjectAsset) => void;
}

export function AssetDetailDrawer({ initial, files, viewerOnly, onClose, onChanged, onOpenFile, onOpenExternal, onEdit, onAddToChat }: Props) {
  const { locale, t } = useI18n();
  const [asset, setAsset] = useState(initial);
  const [provenance, setProvenance] = useState<AssetProvenance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetchAssetDetail(initial.projectId, initial.relPath, controller.signal).then(([info, history]) => {
      if (controller.signal.aborted) return;
      setAsset(info); setProvenance(history.provenance);
    }).catch(cause => { if (!controller.signal.aborted) { console.warn('[Assets] detail load failed:', cause); setError(t('gameAssets.loadFailed')); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initial.projectId, initial.relPath, t]);

  async function save(change: () => Promise<ProjectAsset | undefined>) {
    if (viewerOnly || busy) return;
    setBusy(true); setError(null);
    try { const updated = await change(); if (updated) setAsset(updated); onChanged(); }
    catch (cause) { console.warn('[Assets] save failed:', cause); setError(t('gameAssets.saveFailed')); }
    finally { setBusy(false); }
  }
  const changeTag = (value: string, remove = false) => save(async () => {
    const result = await updateAssetTags(asset.projectId, { paths: [asset.relPath], ...(remove ? { remove: [value] } : { add: [value] }) });
    if (!remove) setTag('');
    return result.assets[0];
  });
  const changeGrid = (grid: AssetGrid | null) => save(() => updateAssetGrid(asset.projectId, { path: asset.relPath, grid }));
  const source = `${projectRawUrl(asset.projectId, asset.relPath)}?v=${asset.mtime}`;
  const modified = asset.modifiedSinceProvenance || provenance.some(item => item.modifiedSinceProvenance);

  return <AssetDialog title={t('gameAssets.details')} drawer onClose={onClose}>
    <p className={styles.detailPath}>{asset.relPath}</p>
    <div className={styles.inline}>
      {!viewerOnly && onAddToChat && <Button size="sm" variant="primary" onClick={() => onAddToChat(asset)}>{t('filesPanel.addToChat')}</Button>}
      <Button size="sm" variant="ghost" onClick={() => { onOpenFile(asset.relPath); onClose(); }}>{t('gameAssets.preview')}</Button>
      {!viewerOnly && <Button size="sm" variant="ghost" onClick={() => onOpenExternal(asset.relPath)}>{t('gameAssets.openExternal')}</Button>}
      {!viewerOnly && asset.kind === 'image' && onEdit && <Button size="sm" disabled={loading || busy} onClick={() => onEdit(asset)}>{t('imageEditor.title')}</Button>}
    </div>
    {loading ? <p role="status">{t('gameAssets.loading')}</p> : null}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {asset.kind === 'image' ? (isPixelAsset(asset)
      ? <PixelAssetImage className={styles.largePreview} source={source} name={asset.relPath} width={asset.width} height={asset.height} maxHeight={360} />
      : <img className={styles.largePreview} src={assetThumbnailUrl(asset.projectId, asset, 1024)} alt={asset.relPath} />)
      : asset.kind === 'audio' ? <><AssetWaveformPreview asset={asset} /><audio className={styles.audio} controls preload="none" src={source} aria-label={asset.relPath} /></>
      : asset.kind === 'video' ? <video className={styles.largePreview} controls preload="none" src={source} aria-label={asset.relPath} /> : null}
    <p className={styles.muted}>{assetDimensions(asset)} · {new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(asset.size / 1024)} KB · {t(`gameAssets.origin.${asset.origin}`)}</p>
    <section className={styles.detailSection}>
      <h3>{t('gameAssets.engineMeta')}</h3>
      {asset.engineMeta ? <>
        {asset.engineMeta.pairMissing && <p role="alert" className={styles.warning}>{t('gameAssets.pairMissing')}</p>}
        <dl className={styles.facts}>
          <dt>{t('gameAssets.engine')}</dt><dd>{asset.engineMeta.engine}</dd>
          <dt>{t('gameAssets.evidence')}</dt><dd>{asset.engineMeta.source}</dd>
          {asset.engineMeta.guid && <><dt>GUID</dt><dd>{asset.engineMeta.guid}</dd></>}
          {asset.engineMeta.uid && <><dt>UID</dt><dd>{asset.engineMeta.uid}</dd></>}
          {asset.engineMeta.importer && <><dt>{t('gameAssets.importer')}</dt><dd>{asset.engineMeta.importer}</dd></>}
        </dl>
      </> : <p className={styles.muted}>{t('gameAssets.noEngineMeta')}</p>}
    </section>
    <section className={styles.detailSection}><h3>{t('gameAssets.semantics')}</h3>
      {asset.semantics.length ? <ul className={styles.semanticList}>{asset.semantics.map((semantic, index) => <li key={index}>
        <strong>{t(`gameAssets.semantic.${semantic.type}`)}</strong><span className={styles.muted}>{semantic.source}</span>
        {semantic.frames && <span>{t('gameAssets.frames', { n: semantic.frames.length })}</span>}
        {semantic.border && <code>{JSON.stringify(semantic.border)}</code>}
        {semantic.loop && <code>{JSON.stringify(semantic.loop)}</code>}
      </li>)}</ul> : <p className={styles.muted}>{t('gameAssets.noSemantics')}</p>}
    </section>
    <section className={styles.detailSection}><h3>{t('gameAssets.tags')}</h3>
      <div className={styles.inline}>{asset.tags.map(value => <span className={styles.tag} key={value}>{value}
        {!viewerOnly && <Button size="sm" variant="ghost" disabled={busy} aria-label={t('gameAssets.removeTag', { tag: value })} onClick={() => void changeTag(value, true)}>×</Button>}
      </span>)}</div>
      {!viewerOnly && <form className={styles.inline} onSubmit={event => { event.preventDefault(); if (tag.trim()) void changeTag(tag.trim()); }}>
        <Input aria-label={t('gameAssets.newTag')} placeholder={t('gameAssets.newTag')} value={tag} maxLength={100} onChange={event => setTag(event.target.value)} />
        <Button type="submit" size="sm" disabled={busy || loading || !tag.trim()}>{t('gameAssets.addTag')}</Button>
      </form>}
    </section>
    {asset.kind === 'image' && !loading && <SpritePreview asset={asset} files={files} source={source} viewerOnly={viewerOnly} busy={busy} onGrid={changeGrid} />}
    <section className={styles.detailSection}><h3>{t('gameAssets.provenance')}</h3>
      {modified && <p className={styles.warning}>{t('gameAssets.modified')}</p>}
      {!loading && !provenance.length && <p className={styles.muted}>{t('gameAssets.noProvenance')}</p>}
      {provenance.map(item => <article className={styles.provenance} key={item.id}>
        <div className={styles.meta}><strong>{t(`gameAssets.origin.${item.origin}`)}</strong><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString(locale)}</time></div>
        <dl className={styles.facts}>
          {item.promptText && <><dt>{t('gameAssets.prompt')}</dt><dd className={styles.prompt}>{item.promptText}</dd></>}
          {item.model && <><dt>{t('gameAssets.model')}</dt><dd>{item.model}</dd></>}
          {item.provider && <><dt>{t('gameAssets.provider')}</dt><dd>{item.provider}</dd></>}
          {item.seed && <><dt>{t('gameAssets.seed')}</dt><dd>{item.seed}</dd></>}
          {item.referenceHashes?.length ? <><dt>{t('gameAssets.referenceHashes')}</dt><dd>{item.referenceHashes.map(hash => <code className={styles.hash} key={hash}>{hash}</code>)}</dd></> : null}
          {item.parentHashes?.length ? <><dt>{t('gameAssets.parentHashes')}</dt><dd>{item.parentHashes.map(hash => <code className={styles.hash} key={hash}>{hash}</code>)}</dd></> : null}
          {item.runId && <><dt>{t('gameAssets.run')}</dt><dd><AssetRunLink runId={item.runId} /></dd></>}
        </dl>
      </article>)}
    </section>
  </AssetDialog>;
}
