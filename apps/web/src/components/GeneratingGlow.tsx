import type { ReactElement } from 'react';
import styles from './GeneratingGlow.module.css';

/**
 * What a cell shows while the thing in it is still being made: soft colour drifting.
 * It only appears where something is on its way, never where a file simply has no preview.
 * CSS only, so a row of cells costs no script and it stops by itself under reduced motion.
 */
export function GeneratingGlow({ className }: { className?: string }): ReactElement {
  return (
    <span className={className ? `${styles.root} ${className}` : styles.root} data-testid="generating-glow" aria-hidden="true">
      <span className={`${styles.blob} ${styles.violet}`} />
      <span className={`${styles.blob} ${styles.lilac}`} />
      <span className={`${styles.blob} ${styles.lime}`} />
    </span>
  );
}
