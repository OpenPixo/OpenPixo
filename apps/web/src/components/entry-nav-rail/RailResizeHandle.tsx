import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useT } from '../../i18n';
import {
  clampRailWidth,
  getRailWidth,
  RAIL_WIDTH_DEFAULT,
  RAIL_WIDTH_KEYBOARD_STEP,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  railWidthProperties,
  setRailWidth,
  useRailWidth,
} from './rail-width';
import styles from './RailResizeHandle.module.css';

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
  host: HTMLElement | null;
  frame: number | null;
  latestX: number;
  width: number;
}

function paint(host: HTMLElement | null, width: number) {
  if (!host) return;
  for (const [property, value] of Object.entries(railWidthProperties(width))) {
    host.style.setProperty(property, String(value));
  }
}

/**
 * The drag edge of the nav rail. While dragging, the width goes straight onto
 * the shell's custom property, so a pointer move repaints the grid without
 * re-rendering the shell behind it; React learns the width when the drag ends.
 * Pointer capture keeps the moves coming over a game iframe, and the class on
 * the root stops text selection and iframes from reacting underneath.
 */
export function RailResizeHandle() {
  const t = useT();
  const width = useRailWidth();
  const drag = useRef<Drag | null>(null);

  const endDrag = useCallback((commit: boolean) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (active.frame !== null) cancelAnimationFrame(active.frame);
    document.documentElement.classList.remove(styles.resizing!);
    if (active.host) active.host.style.transition = '';
    if (commit) setRailWidth(active.width);
    else paint(active.host, active.startWidth);
  }, []);

  useEffect(() => () => endDrag(false), [endDrag]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startWidth = getRailWidth();
    const host = event.currentTarget.closest<HTMLElement>('[data-rail-host]');
    // The shell eases its track on collapse; easing a drag would make it lag.
    if (host) host.style.transition = 'none';
    document.documentElement.classList.add(styles.resizing!);
    drag.current = {
      pointerId: event.pointerId, startX: event.clientX, startWidth, host, frame: null, latestX: event.clientX, width: startWidth,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    active.latestX = event.clientX;
    active.frame ??= requestAnimationFrame(() => {
      active.frame = null;
      active.width = clampRailWidth(active.startWidth + active.latestX - active.startX);
      paint(active.host, active.width);
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    active.width = clampRailWidth(active.startWidth + event.clientX - active.startX);
    endDrag(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault();
      endDrag(false);
      return;
    }
    const next = event.key === 'ArrowLeft' ? width - RAIL_WIDTH_KEYBOARD_STEP
      : event.key === 'ArrowRight' ? width + RAIL_WIDTH_KEYBOARD_STEP
        : event.key === 'Home' ? RAIL_WIDTH_MIN
          : event.key === 'End' ? RAIL_WIDTH_MAX
            : event.key === 'Enter' ? RAIL_WIDTH_DEFAULT
              : null;
    if (next === null) return;
    event.preventDefault();
    setRailWidth(next);
  };

  return (
    <div
      className={styles.handle}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('entry.railResize')}
      aria-valuemin={RAIL_WIDTH_MIN}
      aria-valuemax={RAIL_WIDTH_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title={t('entry.railResizeHint')}
      data-testid="entry-nav-rail-resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => endDrag(false)}
      onLostPointerCapture={() => endDrag(true)}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setRailWidth(RAIL_WIDTH_DEFAULT)}
    />
  );
}
