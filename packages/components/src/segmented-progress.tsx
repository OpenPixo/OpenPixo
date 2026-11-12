import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

import { joinClassNames } from './class-names';
import styles from './segmented-progress.module.css';

export interface SegmentedProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  total: number;
  done: number;
  /** Accessible name. Use the caller's translated label when one is available. */
  label?: string;
}

export const SegmentedProgress = forwardRef<HTMLDivElement, SegmentedProgressProps>(
  function SegmentedProgress({ total, done, label, className, ...props }, ref) {
    const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
    const completed = Number.isFinite(done) ? Math.min(count, Math.max(0, Math.floor(done))) : 0;

    return (
      <div
        {...props}
        ref={ref}
        className={joinClassNames(styles.progress, className)}
        role="progressbar"
        aria-label={label ?? props['aria-label'] ?? (props['aria-labelledby'] ? undefined : `${completed} / ${count}`)}
        aria-valuemin={0}
        aria-valuemax={count}
        aria-valuenow={completed}
      >
        {Array.from({ length: count }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={styles.segment}
            data-state={index < completed ? 'done' : index === completed ? 'current' : 'pending'}
          />
        ))}
      </div>
    );
  },
);
