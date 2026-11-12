import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select } from '@openpixo/components';
import type { AssetGrid, ProjectAsset } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { detectFrameGrid, spriteFrames } from './frame-grid';
import { useIntegerPreviewScale } from './PixelAssetImage';
import { useSpriteDescriptor } from './useSpriteDescriptor';
import styles from './Assets.module.css';

const noFiles: readonly string[] = [];
export function SpritePreview({ asset, source, viewerOnly, busy, onGrid, files = noFiles }: {
  asset: ProjectAsset; source: string; viewerOnly: boolean; busy: boolean; onGrid: (grid: AssetGrid | null) => Promise<void>;
  files?: readonly string[];
}) {
  const { t } = useI18n();
  const declared = asset.semantics.find(semantic => semantic.type === 'grid')?.grid ?? asset.semantics.find(semantic => semantic.grid)?.grid;
  const detected = detectFrameGrid(asset);
  const descriptor = useSpriteDescriptor(asset, files);
  const frames = useMemo(() => descriptor?.frames ?? spriteFrames(asset), [descriptor, asset]);
  const [mode, setMode] = useState<'counts' | 'cells'>(declared && 'cellWidth' in declared ? 'cells' : 'counts');
  const [first, setFirst] = useState(String(declared ? 'cols' in declared ? declared.cols : declared.cellWidth : detected?.cols ?? 1));
  const [second, setSecond] = useState(String(declared ? 'rows' in declared ? declared.rows : declared.cellHeight : detected?.rows ?? 1));
  const [fpsOverride, setFpsOverride] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [overlay, setOverlay] = useState(false);
  const width = asset.width ?? 0, height = asset.height ?? 0;
  const count = frames.length;
  const timed = count > 0 && frames.every(frame => typeof frame.durationMs === 'number'
    && Number.isFinite(frame.durationMs) && frame.durationMs > 0);
  // Authored durations show average FPS; edits force uniform timing until the descriptor reloads.
  const fps = fpsOverride ?? (timed ? 1000 * count / frames.reduce((total, frame) => total + frame.durationMs!, 0)
    : Math.max(1, Math.min(60, descriptor?.fps ?? 12)));
  const frameIndex = count ? index % count : 0;
  const frame = frames[frameIndex];
  const displayedWidth = overlay ? width : frame?.width ?? 1;
  const displayedHeight = overlay ? height : frame?.height ?? 1;
  const { ref, scale } = useIntegerPreviewScale(displayedWidth, displayedHeight, 192, 512);

  useEffect(() => { setFpsOverride(null); }, [descriptor]);

  useEffect(() => {
    if (!playing || count < 2) return;
    const durationMs = fpsOverride === null ? frames[frameIndex]?.durationMs : undefined;
    const delay = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1000 / fps;
    const timer = window.setTimeout(() => setIndex(value => (value + 1) % count), delay);
    return () => window.clearTimeout(timer);
  }, [playing, frames, frameIndex, count, fps, fpsOverride]);

  return <section className={styles.detailSection} aria-label={t('gameAssets.spritePreview')}>
    <h3>{t('gameAssets.spritePreview')}</h3>
    {frame ? <>
      <div className={styles.pixelViewport} ref={ref}>
      <svg className={styles.sprite} viewBox={overlay ? `0 0 ${width} ${height}` : `${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
        width={displayedWidth * scale} height={displayedHeight * scale} role="img"
        aria-label={overlay ? t('gameAssets.frameGrid') : t('gameAssets.frame', { n: frameIndex + 1, total: count })}>
        <image href={source} width={width || undefined} height={height || undefined} />
        {overlay && frames.map((cell, position) => <rect key={position} x={cell.x} y={cell.y} width={cell.width} height={cell.height}
          data-current={position === frameIndex} className={styles.frameCell} />)}
      </svg>
      </div>
      <div className={styles.inline}>
        <Button size="sm" onClick={() => setPlaying(value => !value)} disabled={count < 2}>{t(playing ? 'gameAssets.pause' : 'gameAssets.play')}</Button>
        <label>{t('gameAssets.fps')}<Input type="number" min={1} max={60} step="any" value={fps} onChange={event => setFpsOverride(Math.max(1, Math.min(60, Number(event.target.value) || 1)))} /></label>
        <span>{t('gameAssets.frame', { n: frameIndex + 1, total: count })}</span>
        <Button size="sm" variant="ghost" aria-pressed={overlay} onClick={() => { setOverlay(value => !value); setPlaying(false); }}>{t('gameAssets.frameGrid')}</Button>
      </div>
      {detected?.source === 'dimensions' && <p className={styles.muted}>{t('gameAssets.detectedGrid', { cols: detected.cols, rows: detected.rows })}</p>}
    </> : <p className={styles.muted}>{t('gameAssets.gridHint')}</p>}
    {!viewerOnly && <form className={styles.gridForm} onSubmit={event => {
      event.preventDefault();
      if (!busy) void onGrid(mode === 'counts' ? { cols: Number(first), rows: Number(second) } : { cellWidth: Number(first), cellHeight: Number(second) });
    }}>
      <label>{t('gameAssets.gridMode')}<Select value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
        <option value="counts">{t('gameAssets.gridCounts')}</option><option value="cells">{t('gameAssets.gridCells')}</option>
      </Select></label>
      <div className={styles.inline}>
        <label>{t(mode === 'counts' ? 'gameAssets.cols' : 'gameAssets.cellWidth')}<Input type="number" required min={1} max={65536} value={first} onChange={event => setFirst(event.target.value)} /></label>
        <span>×</span>
        <label>{t(mode === 'counts' ? 'gameAssets.rows' : 'gameAssets.cellHeight')}<Input type="number" required min={1} max={65536} value={second} onChange={event => setSecond(event.target.value)} /></label>
      </div>
      <div className={styles.inline}><Button type="submit" size="sm" disabled={busy}>{t('gameAssets.saveGrid')}</Button>
        {declared && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onGrid(null)}>{t('gameAssets.clearGrid')}</Button>}</div>
    </form>}
  </section>;
}
