import { useEffect, useRef, useState } from 'react';
import { Button, Input, Select } from '@openpixo/components';
import { ASSET_OP_NAMES, type AssetOpName, type AssetOpReport, type EngineProfileResponse } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { processProjectAssets } from '../../providers/project-assets';
import { AssetDialog } from './AssetDialog';
import styles from './Assets.module.css';

interface Field {
  name: string; label: keyof Dict; boolean?: boolean; value?: string; options?: string[]; required?: boolean; min?: number; max?: number; step?: number;
}
const fields: Record<AssetOpName, Field[]> = {
  resize: [
    { name: 'width', label: 'gameAssets.param.width', min: 1, max: 8192 },
    { name: 'height', label: 'gameAssets.param.height', min: 1, max: 8192 },
    { name: 'filter', label: 'gameAssets.param.filter', options: ['nearest', 'lanczos'] },
  ],
  trim: [{ name: 'padding', label: 'gameAssets.param.padding', value: '0', min: 0 }],
  slice: [
    { name: 'grid', label: 'gameAssets.param.grid', value: '4x4', required: true },
    { name: 'margin', label: 'gameAssets.param.margin', value: '0', min: 0 },
    { name: 'spacing', label: 'gameAssets.param.spacing', value: '0', min: 0 },
  ],
  pack: [
    { name: 'maxSize', label: 'gameAssets.param.maxSize', value: '2048', min: 1, max: 8192 },
    { name: 'padding', label: 'gameAssets.param.padding', value: '0', min: 0 },
    { name: 'format', label: 'gameAssets.param.format', options: ['texturepacker-json', 'godot-tres'] },
  ],
  'export-spritesheet': [
    { name: 'columns', label: 'gameAssets.cols', required: true, min: 1, max: 512 },
    { name: 'fps', label: 'gameAssets.fps', value: '8', min: 0.01, max: 240, step: 0.01 },
    { name: 'format', label: 'gameAssets.param.format', options: ['godot-spriteframes', 'phaser-atlas', 'aseprite-json'] },
    { name: 'name', label: 'gameAssets.export.name', value: 'spritesheet', required: true },
    { name: 'animations', label: 'gameAssets.export.animations' },
    { name: 'loop', label: 'gameAssets.export.loop', options: ['true', 'false'] },
  ],
  pixelate: [
    { name: 'size', label: 'gameAssets.param.pixelSize', required: true, min: 1, max: 8192 },
    { name: 'palette', label: 'gameAssets.param.palette', options: ['', 'gameboy', 'pico8', 'grayscale'] },
    { name: 'dither', label: 'gameAssets.param.dither', options: ['none', 'ordered'] },
  ],
  palette: [{ name: 'colors', label: 'gameAssets.param.colors', required: true, min: 1, max: 256, value: '16' },
    { name: 'apply', label: 'gameAssets.param.applyPalette', boolean: true }],
  'seamless-check': [],
  'remove-bg': [
    { name: 'color', label: 'gameAssets.param.color', value: '#00ff00', required: true },
    { name: 'tolerance', label: 'gameAssets.param.tolerance', min: 0, max: 255, value: '0' },
  ],
  'frames-check': [],
  'frames-align': [
    { name: 'canvas', label: 'gameAssets.param.canvas' },
    { name: 'padding', label: 'gameAssets.param.padding', value: '0', min: 0 },
    { name: 'matchHeight', label: 'gameAssets.param.matchHeight', boolean: true },
    { name: 'filter', label: 'gameAssets.param.filter', options: ['lanczos', 'nearest'] },
  ],
  'audio-normalize': [{ name: 'lufs', label: 'gameAssets.param.lufs', required: true, min: -70, max: -5, step: 0.1 }],
  'audio-trim': [{ name: 'silenceThreshold', label: 'gameAssets.param.silenceThreshold', required: true, min: -100, max: 0, step: 0.1 }],
  'audio-loop': [{ name: 'crossfadeMs', label: 'gameAssets.param.crossfadeMs', required: true, min: 0, max: 60000 }],
  'audio-convert': [
    { name: 'format', label: 'gameAssets.param.format', options: ['wav', 'ogg', 'mp3'] },
    { name: 'sampleRate', label: 'gameAssets.param.sampleRate', min: 8000, max: 192000, value: '48000' },
  ],
};

const isFramesOp = (op: AssetOpName): boolean => op === 'frames-check' || op === 'frames-align';

export function AssetProcessingDialog({ projectId, paths, onClose, onProcessed }: {
  projectId: string; paths: string[]; onClose: () => void; onProcessed: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [op, setOp] = useState<AssetOpName>('resize');
  const [exportFormat, setExportFormat] = useState('aseprite-json');
  const formatChosen = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    formatChosen.current = false;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/engine`, { signal: controller.signal })
      .then(async response => response.ok ? response.json() as Promise<EngineProfileResponse> : null)
      .then(result => {
        if (controller.signal.aborted || formatChosen.current) return;
        setExportFormat(result?.profile.engine === 'godot' ? 'godot-spriteframes' : result?.profile.engine === 'phaser' ? 'phaser-atlas' : 'aseprite-json');
      }).catch(() => {});
    return () => controller.abort();
  }, [projectId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AssetOpReport | null>(null);

  return <AssetDialog title={t('gameAssets.process')} busy={busy} onClose={onClose}>
    <p>{t('gameAssets.processingCount', { n: paths.length })}</p>
    <p className={styles.muted}>{t('gameAssets.processingHint')}</p>
    <form className={styles.operationForm} onSubmit={event => {
      event.preventDefault();
      if (busy) return;
      const data = new FormData(event.currentTarget), params: Record<string, unknown> = {};
      for (const field of fields[op]) {
        if (field.boolean) { params[field.name] = data.has(field.name); continue; }
        const value = String(data.get(field.name) ?? '').trim();
        if (value) params[field.name] = op === 'export-spritesheet' && field.name === 'loop' ? value === 'true' : field.min !== undefined ? Number(value) : value;
      }
      if (op === 'resize' && !params.width && !params.height) { setError(t('gameAssets.resizeRequired')); return; }
      if (op === 'remove-bg') params.mode = 'chroma';
      const out = String(data.get('out') ?? '').trim();
      setBusy(true); setError(null); setReport(null);
      // Frames play in name order (walk-1, walk-2, … walk-10), not in the order they were picked.
      const inputs = isFramesOp(op) ? [...paths].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : paths;
      void processProjectAssets(projectId, { op, inputs, params, ...(out ? { out } : {}) })
        .then(async result => { setReport(result); await onProcessed(); })
        .catch(cause => setError(locale === 'zh-CN' ? t('gameAssets.processFailed') : cause instanceof Error ? cause.message : t('gameAssets.processFailed')))
        .finally(() => setBusy(false));
    }}>
      <label>{t('gameAssets.operation')}<Select value={op} disabled={busy} onChange={event => { setOp(event.target.value as AssetOpName); setError(null); }}>
        {ASSET_OP_NAMES.map(value => <option value={value} key={value}>{t(`gameAssets.op.${value}`)}</option>)}
      </Select></label>
      {op === 'export-spritesheet' && <p className={styles.muted}>{t('gameAssets.export.hint')}</p>}
      {isFramesOp(op) && <p className={styles.muted}>{t('gameAssets.frames.hint')}</p>}
      <fieldset key={op} className={styles.operationFields} disabled={busy}>
        {fields[op].map(field => <label key={field.name}>{t(field.label)}
          {field.boolean ? <Input name={field.name} type="checkbox" /> : field.options ? <Select name={field.name} {...(op === 'export-spritesheet' && field.name === 'format' ? { value: exportFormat, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { formatChosen.current = true; setExportFormat(event.target.value); } } : { defaultValue: field.options[0] })}>{field.options.map(value => <option key={value} value={value}>{op === 'export-spritesheet' && field.name === 'format' ? t(value === 'godot-spriteframes' ? 'gameAssets.export.godot' : value === 'phaser-atlas' ? 'gameAssets.export.phaser' : 'gameAssets.export.aseprite') : op === 'export-spritesheet' && field.name === 'loop' ? t(value === 'true' ? 'gameAssets.export.looped' : 'gameAssets.export.once') : value || t('gameAssets.none')}</option>)}</Select>
            : <Input name={field.name} type={field.min !== undefined ? 'number' : 'text'} defaultValue={op === 'export-spritesheet' && field.name === 'columns' ? String(paths.length) : field.value ?? ''} min={field.min} max={field.max} step={field.step ?? 1} required={field.required} />}
        </label>)}
      </fieldset>
      <label>{t('gameAssets.outputDir')}<Input name="out" disabled={busy} placeholder={`derived/${op}/`} /></label>
      <Button type="submit" variant="primary" disabled={busy}>{t(busy ? 'gameAssets.processing' : 'gameAssets.runProcessing')}</Button>
    </form>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {report && <section className={styles.detailSection} aria-label={t('gameAssets.report')}>
      <h3>{t('gameAssets.report')}</h3>
      <p role="status">{t('gameAssets.reportCounts', report.counts)}</p>
      {report.summary && <div role="status">
        <p>{t('gameAssets.frames.summary', { baseline: report.summary.baselineSpreadPx, feetX: report.summary.feetXSpreadPx, height: report.summary.heightDriftPercent })}</p>
        {report.summary.emptyFrames.length > 0 && <p className={styles.warning}>{t('gameAssets.frames.empty', { frames: report.summary.emptyFrames.join(', ') })}</p>}
        <p className={report.summary.ok ? styles.muted : styles.warning}>{t(report.summary.ok ? 'gameAssets.frames.ok' : 'gameAssets.frames.unsteady')}</p>
        {locale !== 'zh-CN' && report.summary.issues.length > 0 && <ul>{report.summary.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      </div>}
      <p className={report.originalsPreserved ? styles.muted : styles.warning}>{t(report.originalsPreserved ? 'gameAssets.originalsPreserved' : 'gameAssets.originalsChanged')}</p>
      <ul className={styles.reportList}>{report.results.map((item, index) => <li key={index}>
        <strong>{item.source}</strong><span>{t(`gameAssets.status.${item.status}`)}</span>
        {item.output && <code>{item.output}</code>}
        {item.extraOutputs?.map(output => <code key={output}>{output}</code>)}
        {item.error && <span className={styles.error}>{locale === 'zh-CN' ? t('gameAssets.processFailed') : item.error}</span>}
      </li>)}</ul>
    </section>}
  </AssetDialog>;
}
