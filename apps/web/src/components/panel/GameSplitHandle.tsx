import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useT } from '../../i18n';
import { gameSplitBounds, gameSplitForDrag, gameSplitForKey } from './game-split';
import styles from './GameView.module.css';

/** The custom property the bottom area of the 游戏 view reads for its height. */
export const GAME_SPLIT_PROPERTY = '--game-panel-height';

interface Drag {
  pointerId: number;
  startY: number;
  startHeight: number;
  available: number;
  frame: number | null;
  latestY: number;
  height: number;
}

/**
 * The divider between the 游戏 stage and its bottom area, built like the nav
 * rail's drag edge (RailResizeHandle): while dragging, the height goes straight
 * onto the body's custom property, so a pointer move repaints without
 * re-rendering a running game; the view learns the height when the drag ends.
 * Pointer capture keeps the moves coming over the game iframe, and the class
 * on the root stops text selection and every iframe from taking the pointer.
 */
export function GameSplitHandle({ host, height, available, measure, onCommit, onReset }: {
  /** The element whose custom property sizes the bottom area. */
  host: RefObject<HTMLElement | null>;
  /** The bottom area's current height, already clamped. */
  height: number;
  /** The body's last measured height, for the separator's range. */
  available: number;
  /** The body's current height, read fresh at the start of a drag or key press. */
  measure: () => number;
  onCommit: (height: number) => void;
  onReset: () => void;
}) {
  const t = useT();
  const drag = useRef<Drag | null>(null);

  const paint = useCallback((value: number) => {
    host.current?.style.setProperty(GAME_SPLIT_PROPERTY, `${value}px`);
  }, [host]);

  const endDrag = useCallback((commit: boolean) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (active.frame !== null) cancelAnimationFrame(active.frame);
    document.documentElement.classList.remove(styles.splitResizing!);
    if (commit) onCommit(active.height);
    else paint(active.startHeight);
  }, [onCommit, paint]);

  useEffect(() => () => endDrag(false), [endDrag]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add(styles.splitResizing!);
    drag.current = {
      pointerId: event.pointerId, startY: event.clientY, startHeight: height, available: measure(),
      frame: null, latestY: event.clientY, height,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    active.latestY = event.clientY;
    active.frame ??= requestAnimationFrame(() => {
      active.frame = null;
      active.height = gameSplitForDrag(active.startHeight, active.startY, active.latestY, active.available);
      paint(active.height);
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    active.height = gameSplitForDrag(active.startHeight, active.startY, event.clientY, active.available);
    endDrag(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault();
      endDrag(false);
      return;
    }
    const next = gameSplitForKey(event.key, height, measure());
    if (next === null) return;
    event.preventDefault();
    if (event.key === 'Enter') onReset();
    else onCommit(next);
  };

  const { min, max } = gameSplitBounds(available);
  return (
    <div
      className={styles.splitHandle}
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('panel.game.splitResize')}
      aria-valuemin={min}
      aria-valuemax={Number.isFinite(max) ? max : undefined}
      aria-valuenow={height}
      tabIndex={0}
      title={t('panel.game.splitResizeHint')}
      data-testid="panel-game-split"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => endDrag(false)}
      onLostPointerCapture={() => endDrag(true)}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    />
  );
}
