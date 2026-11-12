import { useEffect, useRef, type PointerEvent } from 'react';
import { Input } from '@openpixo/components';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { dragCrop, type CropHandle, type CropRect } from './image-edit-preview';
import styles from './ImageEditor.module.css';

const handles: { handle: CropHandle; label: keyof Dict }[] = [
  { handle: 'nw', label: 'imageEditor.handle.nw' }, { handle: 'n', label: 'imageEditor.handle.n' },
  { handle: 'ne', label: 'imageEditor.handle.ne' }, { handle: 'e', label: 'imageEditor.handle.e' },
  { handle: 'se', label: 'imageEditor.handle.se' }, { handle: 's', label: 'imageEditor.handle.s' },
  { handle: 'sw', label: 'imageEditor.handle.sw' }, { handle: 'w', label: 'imageEditor.handle.w' },
];

export function CropCanvas({ canvas, crop, cropping, aspect, zoom, disabled, onCropChange, onZoomChange }: {
  canvas: HTMLCanvasElement | null; crop: CropRect; cropping: boolean; aspect: number | null; zoom: number; disabled: boolean;
  onCropChange: (crop: CropRect) => void; onZoomChange: (zoom: number) => void;
}) {
  const { t } = useI18n();
  const visible = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ rect: CropRect; handle: CropHandle; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!canvas || !visible.current) return;
    visible.current.width = canvas.width; visible.current.height = canvas.height;
    visible.current.getContext('2d')?.drawImage(canvas, 0, 0);
  }, [canvas]);
  const beginDrag = (event: PointerEvent<HTMLElement>, handle: CropHandle) => {
    if (disabled || !canvas || event.button > 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { rect: crop, handle, x: event.clientX, y: event.clientY };
  };
  return <section className={styles.previewPane}>
    <div className={styles.viewport} aria-busy={!canvas}>
      {canvas ? <div className={styles.stage} style={{ width: canvas.width * zoom, height: canvas.height * zoom }}>
        <canvas ref={visible} aria-label={t('imageEditor.preview')} className={styles.canvas} />
        {cropping && <div role="region" aria-label={t('imageEditor.selection')} tabIndex={disabled ? -1 : 0} className={styles.crop}
          style={{ left: crop.x * zoom, top: crop.y * zoom, width: crop.width * zoom, height: crop.height * zoom }}
          onPointerDown={event => beginDrag(event, 'move')}
          onPointerMove={event => {
            if (!drag.current) return;
            onCropChange(dragCrop(drag.current.rect, drag.current.handle, (event.clientX - drag.current.x) / zoom, (event.clientY - drag.current.y) / zoom, canvas, aspect));
          }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
          onKeyDown={event => {
            const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
            const direction = directions[event.key];
            if (!direction || disabled) return;
            event.preventDefault(); event.stopPropagation();
            const handle = (event.target as HTMLElement).dataset.handle as CropHandle | undefined;
            const step = event.shiftKey ? 10 : 1;
            onCropChange(dragCrop(crop, handle ?? 'move', direction[0] * step, direction[1] * step, canvas, aspect));
          }}>
          {handles.map(({ handle, label }) => <button type="button" key={handle} aria-label={t(label)} disabled={disabled}
            data-handle={handle} className={styles.handle} onPointerDown={event => beginDrag(event, handle)} />)}
        </div>}
      </div> : <p role="status" className={styles.muted}>{t('imageEditor.loading')}</p>}
    </div>
    <div className={styles.zoomBar}>
      <label>{t('imageEditor.zoom')}<Input type="range" min={10} max={800} step={10} value={Math.round(zoom * 100)}
        disabled={!canvas || disabled} onChange={event => onZoomChange(Number(event.target.value) / 100)} /></label>
      <output>{Math.round(zoom * 100)}%</output>
    </div>
    <p className={styles.hint}>{t('imageEditor.keyboardHint')}</p>
  </section>;
}