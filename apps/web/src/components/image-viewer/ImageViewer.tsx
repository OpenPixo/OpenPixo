import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { ProjectFile } from '@openpixo/contracts';
import { Button } from '@openpixo/components';
import { useT } from '../../i18n';
import { appendResourceQuery } from '../../lib/resource-url';
import { copyToClipboard } from '../../lib/copy-to-clipboard';
import { projectFileUrl } from '../../providers/registry';
import { Icon } from '../Icon';
import { ViewerAddToChat } from '../files/ViewerAddToChat';
import { ImageEditorDialog } from '../image-editor/ImageEditorDialog';
import {
  PIXEL_GRID_MIN_SCALE,
  centeredView,
  clampPan,
  fitScale,
  formatHexColor,
  formatZoom,
  pixelAt,
  siblingImages,
  stepZoom,
  zoomAt,
  type ImageView,
  type Point,
  type Size,
} from './image-view';
import styles from './ImageViewer.module.css';

type Background = 'checker' | 'light' | 'dark';
const BACKGROUNDS: Background[] = ['checker', 'light', 'dark'];
const BACKGROUND_KEY = 'openpixo.imageViewer.background';
const GRID_KEY = 'openpixo.imageViewer.grid';
/** Pointer travel below this is a click (copy the colour), above it a drag (pan). */
const DRAG_THRESHOLD = 3;
/** Wheel travel that makes one zoom step, so a trackpad does not race through the stops. */
const WHEEL_STEP = 40;
/** Colour sampling keeps a full copy of the image; skip it for images too large to hold twice. */
const MAX_SAMPLED_PIXELS = 40_000_000;

function readPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePreference(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* per-viewer convenience only */ }
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface HoverPixel extends Point { color: string | null }

export function ImageViewer({
  projectId,
  file,
  viewerOnly = false,
  fileNames,
  onStep,
  onFileSaved,
  onOpenFile,
}: {
  projectId: string;
  file: ProjectFile;
  viewerOnly?: boolean;
  /** Every file name in the project, for stepping through this folder's images. */
  fileNames?: readonly string[];
  /** Show a sibling image in place of this one. */
  onStep?: (name: string) => void;
  /** Refresh the project's file list after an edit wrote a new file. */
  onFileSaved?: () => Promise<void> | void;
  /** Open a file (the edit's result) in the panel. */
  onOpenFile?: (name: string) => void;
}) {
  const t = useT();
  const url = appendResourceQuery(projectFileUrl(projectId, file.name), `v=${Math.round(file.mtime)}`);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const samplerRef = useRef<CanvasRenderingContext2D | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewport, setViewport] = useState<Size | null>(null);
  const [view, setView] = useState<ImageView | null>(null);
  const [fitted, setFitted] = useState(true);
  const [background, setBackground] = useState<Background>(() => readPreference(BACKGROUND_KEY, BACKGROUNDS, 'checker'));
  const [grid, setGrid] = useState<boolean>(() => readPreference(GRID_KEY, ['on', 'off'], 'off') === 'on');
  const [hover, setHover] = useState<HoverPixel | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ start: Point; origin: ImageView; moved: boolean; pointerId: number } | null>(null);
  const wheelTravel = useRef(0);

  // State is per file version: the caller keys this component by name and
  // mtime, so a new file mounts fresh instead of resetting here — a reset
  // effect can land after a cached image's load event and erase its size.
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = (width: number, height: number) => {
      if (width > 0 && height > 0) {
        setViewport((current) => (current && current.width === width && current.height === height ? current : { width, height }));
      }
    };
    measure(element.clientWidth, element.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // While fitted, the image follows the panel's size.
  useEffect(() => {
    if (!natural || !viewport || !fitted) return;
    setView(centeredView(natural, viewport, fitScale(natural, viewport)));
  }, [natural, viewport, fitted]);

  const viewRef = useRef(view);
  viewRef.current = view;

  const applyScale = useCallback((scale: number, anchor?: Point) => {
    const current = viewRef.current;
    if (!natural || !viewport || !current) return;
    const point = anchor ?? { x: viewport.width / 2, y: viewport.height / 2 };
    setFitted(false);
    setView(zoomAt(current, scale, point, natural, viewport));
  }, [natural, viewport]);
  const zoomBy = useCallback((direction: 1 | -1, anchor?: Point) => {
    const current = viewRef.current;
    if (current) applyScale(stepZoom(current.scale, direction), anchor);
  }, [applyScale]);
  const fit = useCallback(() => {
    setFitted(true);
    if (natural && viewport) setView(centeredView(natural, viewport, fitScale(natural, viewport)));
  }, [natural, viewport]);
  const actualSize = useCallback((anchor?: Point) => {
    if (!natural || !viewport) return;
    setFitted(false);
    setView(anchor && viewRef.current
      ? zoomAt(viewRef.current, 1, anchor, natural, viewport)
      : centeredView(natural, viewport, 1));
  }, [natural, viewport]);

  // React registers wheel listeners as passive; zooming must stop the panel from scrolling.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      wheelTravel.current += event.deltaY * unit;
      if (Math.abs(wheelTravel.current) < WHEEL_STEP) return;
      const direction = wheelTravel.current < 0 ? 1 : -1;
      wheelTravel.current = 0;
      const box = element.getBoundingClientRect();
      zoomBy(direction, { x: event.clientX - box.left, y: event.clientY - box.top });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const loaded = useRef(false);
  const onImageLoad = (image: HTMLImageElement) => {
    // A cached image may already be complete when it mounts; read it once.
    if (loaded.current) return;
    loaded.current = true;
    const size = { width: image.naturalWidth, height: image.naturalHeight };
    if (size.width <= 0 || size.height <= 0) { setFailed(true); return; }
    setNatural(size);
    if (size.width * size.height > MAX_SAMPLED_PIXELS) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0);
      samplerRef.current = context;
    } catch {
      samplerRef.current = null;
    }
  };

  const sample = (pixel: Point): string | null => {
    const context = samplerRef.current;
    if (!context) return null;
    try {
      const [r, g, b, a] = context.getImageData(pixel.x, pixel.y, 1, 1).data;
      return formatHexColor(r ?? 0, g ?? 0, b ?? 0, a ?? 255);
    } catch {
      return null;
    }
  };

  const localPoint = (event: ReactPointerEvent<HTMLDivElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const updateHover = (point: Point) => {
    if (!view || !natural) { setHover(null); return; }
    const pixel = pixelAt(view, point, natural);
    setHover(pixel ? { ...pixel, color: sample(pixel) } : null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !view) return;
    // Capture keeps a drag going outside the panel; losing it must not stop the pan.
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* pan without capture */ }
    drag.current = { start: localPoint(event), origin: view, moved: false, pointerId: event.pointerId };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = localPoint(event);
    const active = drag.current;
    if (active && natural && viewport) {
      const dx = point.x - active.start.x, dy = point.y - active.start.y;
      if (!active.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) active.moved = true;
      if (active.moved) {
        setFitted(false);
        setView(clampPan({ ...active.origin, x: active.origin.x + dx, y: active.origin.y + dy }, natural, viewport));
        return;
      }
    }
    updateHover(point);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    drag.current = null;
    if (!active || active.pointerId !== event.pointerId) return;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* not captured */ }
    if (active.moved || !view || !natural) return;
    const pixel = pixelAt(view, localPoint(event), natural);
    const color = pixel ? sample(pixel) : null;
    if (color) void copyToClipboard(color).then((ok) => { if (ok) setCopied(color); });
  };

  const siblings = useMemo(
    () => (fileNames && onStep ? siblingImages(fileNames, file.name) : null),
    [fileNames, onStep, file.name],
  );
  const step = (direction: 'previous' | 'next') => {
    const target = siblings?.[direction];
    if (target && onStep) onStep(target);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || editing) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const handled = (() => {
      switch (event.key) {
        case '+': case '=': zoomBy(1); return true;
        case '-': case '_': zoomBy(-1); return true;
        case '0': fit(); return true;
        case '1': actualSize(); return true;
        case 'g': case 'G': toggleGrid(); return true;
        case 'ArrowLeft': if (siblings?.previous) { step('previous'); return true; } return false;
        case 'ArrowRight': if (siblings?.next) { step('next'); return true; } return false;
        default: return false;
      }
    })();
    if (handled) event.preventDefault();
  };

  const chooseBackground = (value: Background) => { setBackground(value); writePreference(BACKGROUND_KEY, value); };
  const toggleGrid = () => setGrid((value) => { writePreference(GRID_KEY, value ? 'off' : 'on'); return !value; });

  const scale = view?.scale ?? 1;
  const gridVisible = grid && scale >= PIXEL_GRID_MIN_SCALE;
  const placed = view && natural
    ? {
        width: natural.width * view.scale,
        height: natural.height * view.scale,
        transform: `translate(${view.x}px, ${view.y}px)`,
      }
    : undefined;
  const backgroundClass = background === 'checker' ? styles.checker : background === 'light' ? styles.light : styles.dark;
  const canEdit = !viewerOnly && !!natural && !failed;

  return (
    <div className="viewer image-viewer" onKeyDown={onKeyDown}>
      <div className={`viewer-toolbar ${styles.toolbar}`}>
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.imageMeta', { size: humanSize(file.size) })}
            {natural ? <> · {t('fileViewer.imageViewer.dimensions', { width: natural.width, height: natural.height })}</> : null}
          </span>
          {siblings && siblings.total > 1 ? (
            <span className={styles.stepper}>
              <Button variant="ghost" size="icon" className={styles.iconButton} aria-label={t('fileViewer.imageViewer.previous')}
                title={t('fileViewer.imageViewer.previous')} onClick={() => step('previous')}>
                <Icon name="chevron-left" size={14} />
              </Button>
              <span className={styles.counter}>
                {t('fileViewer.imageViewer.counter', { index: siblings.index + 1, total: siblings.total })}
              </span>
              <Button variant="ghost" size="icon" className={styles.iconButton} aria-label={t('fileViewer.imageViewer.next')}
                title={t('fileViewer.imageViewer.next')} onClick={() => step('next')}>
                <Icon name="chevron-right" size={14} />
              </Button>
            </span>
          ) : null}
        </div>
        <div className="viewer-toolbar-actions">
          {canEdit ? (
            <button type="button" className="ghost-link" data-testid="image-viewer-edit"
              title={t('fileViewer.imageViewer.editTitle')} onClick={() => setEditing(true)}>
              <Icon name="crop" size={13} />
              {t('fileViewer.imageViewer.edit')}
            </button>
          ) : null}
          <ViewerAddToChat file={file} />
          <a className="ghost-link" href={projectFileUrl(projectId, file.name)} download={file.name}>
            {t('fileViewer.download')}
          </a>
          <a className="ghost-link" href={projectFileUrl(projectId, file.name)} target="_blank" rel="noreferrer noopener">
            {t('fileViewer.open')}
          </a>
        </div>
      </div>
      <div className={`viewer-body ${styles.body}`}>
        <div
          ref={viewportRef}
          className={`${styles.viewport} ${backgroundClass}`}
          data-testid="image-viewer-viewport"
          role="group"
          tabIndex={0}
          aria-label={t('fileViewer.imageViewer.canvas')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null; }}
          onPointerLeave={() => { if (!drag.current) setHover(null); }}
          onDoubleClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const point = { x: event.clientX - box.left, y: event.clientY - box.top };
            if (fitted) actualSize(point); else fit();
          }}
        >
          {failed ? (
            <div className="viewer-empty">{t('fileViewer.imageViewer.loadFailed')}</div>
          ) : (
            <img
              ref={(node) => { if (node?.complete && node.naturalWidth > 0) onImageLoad(node); }}
              alt={file.name}
              src={url}
              draggable={false}
              className={[styles.image, scale > 1 ? styles.pixelated : '', placed ? '' : styles.pending].filter(Boolean).join(' ')}
              style={placed}
              onLoad={(event) => onImageLoad(event.currentTarget)}
              onError={() => setFailed(true)}
            />
          )}
          {gridVisible && placed ? (
            <div aria-hidden="true" className={styles.grid}
              style={{ ...placed, backgroundSize: `${scale}px ${scale}px` }} />
          ) : null}
        </div>
        <div className={styles.controls} role="toolbar" aria-label={t('fileViewer.imageViewer.tools')}>
          <span className={styles.readout} aria-live="polite">
            {copied ? (
              <span className={styles.copied}>{t('fileViewer.imageViewer.copied', { color: copied })}</span>
            ) : hover ? (
              <>
                <span className={styles.position}>{t('fileViewer.imageViewer.position', { x: hover.x, y: hover.y })}</span>
                {hover.color ? (
                  <span className={styles.color} title={t('fileViewer.imageViewer.copyColor', { color: hover.color })}>
                    <span className={styles.swatch} style={{ background: hover.color }} />
                    {hover.color}
                  </span>
                ) : null}
              </>
            ) : null}
          </span>
          <span className={styles.group} role="radiogroup" aria-label={t('fileViewer.imageViewer.background')}>
            {BACKGROUNDS.map((value) => {
              const label = t(value === 'checker' ? 'fileViewer.imageViewer.bgChecker'
                : value === 'light' ? 'fileViewer.imageViewer.bgLight' : 'fileViewer.imageViewer.bgDark');
              return (
                <Button key={value} variant="ghost" size="icon" role="radio" aria-checked={background === value} aria-label={label} title={label}
                  className={`${styles.iconButton} ${styles.bgChoice}`} onClick={() => chooseBackground(value)}>
                  <span className={`${styles.bgSample} ${styles[`sample_${value}`]}`} />
                </Button>
              );
            })}
          </span>
          <Button variant="ghost" size="icon" className={styles.iconButton} aria-pressed={grid}
            aria-label={t('fileViewer.imageViewer.grid')}
            title={t(scale >= PIXEL_GRID_MIN_SCALE ? 'fileViewer.imageViewer.grid' : 'fileViewer.imageViewer.gridHint')}
            onClick={toggleGrid}>
            <Icon name="grid" size={14} />
          </Button>
          <span className={styles.group}>
            <Button variant="ghost" size="icon" className={styles.iconButton} aria-label={t('fileViewer.imageViewer.zoomOut')}
              title={t('fileViewer.imageViewer.zoomOut')} disabled={!view} onClick={() => zoomBy(-1)}>
              <Icon name="zoom-out" size={14} />
            </Button>
            <output className={styles.zoom} aria-label={t('fileViewer.imageViewer.zoomLevel')}>{formatZoom(scale)}</output>
            <Button variant="ghost" size="icon" className={styles.iconButton} aria-label={t('fileViewer.imageViewer.zoomIn')}
              title={t('fileViewer.imageViewer.zoomIn')} disabled={!view} onClick={() => zoomBy(1)}>
              <Icon name="zoom-in" size={14} />
            </Button>
          </span>
          <span className={styles.group}>
            <Button variant="ghost" size="sm" className={styles.textButton} aria-pressed={fitted} disabled={!view}
              title={t('fileViewer.imageViewer.fitTitle')} onClick={fit}>
              {t('fileViewer.imageViewer.fit')}
            </Button>
            <Button variant="ghost" size="sm" className={styles.textButton} aria-pressed={!fitted && scale === 1} disabled={!view}
              title={t('fileViewer.imageViewer.actualSizeTitle')} onClick={() => actualSize()}>
              1:1
            </Button>
          </span>
        </div>
      </div>
      {editing ? (
        <ImageEditorDialog
          asset={{ projectId, relPath: file.name, mtime: file.mtime, width: natural?.width, height: natural?.height }}
          onClose={() => setEditing(false)}
          onSaved={async (asset) => {
            setEditing(false);
            await onFileSaved?.();
            onOpenFile?.(asset.relPath);
          }}
        />
      ) : null}
    </div>
  );
}
