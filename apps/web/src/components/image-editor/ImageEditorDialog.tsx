import { useEffect, useMemo, useState } from 'react';
import { Button, Input } from '@openpixo/components';
import type { ImageEditOp, ProjectAsset } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { editProjectImage } from '../../providers/project-assets';
import { projectRawUrl } from '../../providers/registry';
import { AssetDialog } from '../assets/AssetDialog';
import { CropCanvas } from './CropCanvas';
import { ImageEditorControls, aspectValue, initialSettings, pendingImageEdit, type EditorTool } from './ImageEditorControls';
import { defaultImageOutput, imageEditSize, imageToCanvas, renderImageEdit } from './image-edit-preview';
import styles from './ImageEditor.module.css';

const tools: { tool: EditorTool; label: keyof Dict }[] = [
  { tool: 'crop', label: 'imageEditor.crop' }, { tool: 'resize', label: 'imageEditor.resize' },
  { tool: 'trim', label: 'imageEditor.trim' }, { tool: 'pad', label: 'imageEditor.pad' },
  { tool: 'flip-h', label: 'imageEditor.flipH' }, { tool: 'flip-v', label: 'imageEditor.flipV' },
  { tool: 'rotate', label: 'imageEditor.rotate' },
];
const suffix = (tool: EditorTool): ImageEditOp['op'] => tool.startsWith('flip-') ? 'flip' : tool as ImageEditOp['op'];

export function ImageEditorDialog({ asset, onClose, onSaved }: {
  asset: ProjectAsset; onClose: () => void; onSaved: (asset: ProjectAsset) => void;
}) {
  const { t } = useI18n();
  const [original, setOriginal] = useState<HTMLCanvasElement | null>(null);
  const [ops, setOps] = useState<ImageEditOp[]>([]);
  const [settings, setSettings] = useState(() => initialSettings({ width: asset.width ?? 1, height: asset.height ?? 1 }));
  const [zoom, setZoom] = useState(1);
  const [output, setOutput] = useState(() => defaultImageOutput(asset.relPath));
  const [outputEdited, setOutputEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const image = new Image();
    image.onload = () => {
      if (!current) return;
      try {
        const source = imageToCanvas(image);
        setOriginal(source); setSettings(initialSettings(source));
      } catch { setLoadError(t('imageEditor.previewFailed')); }
    };
    image.onerror = () => { if (current) setLoadError(t('imageEditor.loadFailed')); };
    image.src = `${projectRawUrl(asset.projectId, asset.relPath)}?v=${asset.mtime}`;
    return () => { current = false; image.onload = null; image.onerror = null; };
  }, [asset.projectId, asset.relPath, asset.mtime, t]);
  const base = useMemo(() => original ? ops.reduce(renderImageEdit, original) : null, [original, ops]);
  const pending = base ? pendingImageEdit(settings, base) : null;
  const preview = useMemo(() => {
    if (!base) return { canvas: null, error: null };
    const op = pendingImageEdit(settings, base);
    if (!op) return { canvas: base, error: null };
    const size = imageEditSize(base, op);
    const invalidSize = !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1 || size.width > 8192 || size.height > 8192 || size.width * size.height > 64_000_000;
    const invalidPad = op.op === 'pad' && (size.width < base.width || size.height < base.height);
    const invalidScale = op.op === 'resize' && op.scale !== undefined && (!Number.isFinite(op.scale) || op.scale <= 0);
    if (invalidSize || invalidPad || invalidScale) return { canvas: null, error: t('imageEditor.invalidSize') };
    try { return { canvas: renderImageEdit(base, op), error: null }; }
    catch { return { canvas: null, error: t('imageEditor.previewFailed') }; }
  }, [base, settings, t]);
  const count = ops.length + (pending ? 1 : 0);
  const canSave = !!preview.canvas && count > 0 && count <= 64 && !busy && !loadError;
  const apply = () => {
    if (!pending || !preview.canvas || count >= 64) return;
    setOps([...ops, pending]); setSettings(initialSettings(preview.canvas)); setError(null);
  };
  const chooseTool = (tool: EditorTool) => {
    if (tool === settings.tool || !base || !preview.canvas || busy) return;
    if (pending) {
      if (count >= 64) return;
      setOps([...ops, pending]);
    }
    setSettings({ ...initialSettings(preview.canvas), tool }); setError(null);
    if (!outputEdited) setOutput(defaultImageOutput(asset.relPath, suffix(tool)));
  };
  const save = async () => {
    if (!canSave) return;
    if (!output.trim() || /[\\/]/.test(output) || !/\.png$/i.test(output.trim())) { setError(t('imageEditor.invalidName')); return; }
    setBusy(true); setError(null);
    try {
      const result = await editProjectImage(asset.projectId, { source: asset.relPath, ops: pending ? [...ops, pending] : ops, output: output.trim() });
      onSaved(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('imageEditor.saveFailed')); }
    finally { setBusy(false); }
  };
  return <AssetDialog title={t('imageEditor.title')} className={styles.dialog} busy={busy} onClose={onClose}>
    <form className={styles.editor} onSubmit={event => { event.preventDefault(); void save(); }}
      onKeyDown={event => {
        if (event.key !== 'Enter' || !(event.target instanceof HTMLElement) || event.target.closest('button:not([data-handle])') || event.target.tagName === 'SELECT') return;
        event.preventDefault(); void save();
      }}>
      <p className={styles.source}>{asset.relPath}</p>
      <div role="toolbar" aria-label={t('imageEditor.tools')} className={styles.toolbar}>
        {tools.map(({ tool, label }) => <Button type="button" key={tool} size="sm" variant="ghost" aria-pressed={settings.tool === tool}
          disabled={!base || busy || !!preview.error} onClick={() => chooseTool(tool)}>{t(label)}</Button>)}
      </div>
      <div className={styles.workspace}>
        <CropCanvas canvas={settings.tool === 'crop' ? base : preview.canvas ?? base} crop={settings.crop} cropping={settings.tool === 'crop'}
          aspect={aspectValue(settings.aspect)} zoom={zoom} disabled={!base || busy}
          onZoomChange={setZoom} onCropChange={crop => { setSettings({ ...settings, crop }); setError(null); }} />
        <aside className={styles.sidebar}>
          <ImageEditorControls settings={settings} size={base ?? { width: asset.width ?? 1, height: asset.height ?? 1 }}
            disabled={!base || busy} onChange={next => { setSettings(next); setError(null); }} />
          <div className={styles.result}><span>{t('imageEditor.resultSize')}</span><output aria-label={t('imageEditor.resultSize')}>
            {preview.canvas ? `${preview.canvas.width} × ${preview.canvas.height} px` : '—'}
          </output></div>
          <div className={styles.history}>
            <Button type="button" size="sm" onClick={apply} disabled={!pending || !preview.canvas || busy || count >= 64}>{t('imageEditor.apply')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={ops.length === 0 || busy} onClick={() => {
              const next = ops.slice(0, -1), canvas = original ? next.reduce(renderImageEdit, original) : null;
              setOps(next); if (canvas) setSettings(initialSettings(canvas)); setError(null);
              if (!outputEdited) setOutput(defaultImageOutput(asset.relPath, next.at(-1)?.op ?? 'crop'));
            }}>{t('imageEditor.undo')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={!original || busy || count === 0} onClick={() => {
              setOps([]); if (original) setSettings(initialSettings(original)); setError(null);
              if (!outputEdited) setOutput(defaultImageOutput(asset.relPath));
            }}>{t('imageEditor.reset')}</Button>
          </div>
          <p className={styles.hint}>{t('imageEditor.orderHint', { n: count })}</p>
          {count >= 64 && <p role="status" className={styles.hint}>{t('imageEditor.operationLimit')}</p>}
        </aside>
      </div>
      {(loadError || preview.error || error) && <p role="alert" className={styles.error}>{loadError ?? preview.error ?? error}</p>}
      <footer className={styles.footer}>
        <label className={styles.output}>{t('imageEditor.outputName')}<Input value={output} disabled={busy} onChange={event => {
          setOutput(event.target.value); setOutputEdited(true); setError(null);
        }} /></label>
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t('imageEditor.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={!canSave}>{t(busy ? 'imageEditor.saving' : 'imageEditor.save')}</Button>
      </footer>
      <p className={styles.hint}>{t('imageEditor.preserveHint')}</p>
    </form>
  </AssetDialog>;
}