/**
 * The thin progress bar the chat cards share: the execution record's plan header,
 * the Plan pill's popover and the art budget line. 4px, pill ends, violet fill;
 * `tone` turns it amber (nearly used up) or red (over).
 *
 * Its own module, not `record.module.css`: it has no parent/child selectors with the
 * record family (chat/AGENTS.md §1b), and the budget line lives outside the record.
 */
import type { ReactElement } from 'react';
import styles from './ProgressBar.module.css';

export type ProgressTone = 'default' | 'warn' | 'over';

export interface ProgressBarProps {
  value: number;
  max: number;
  /** The accessible name, in the UI language. */
  label: string;
  /** Drawn only: the same numbers are already said in words next to it (inside a button, say). */
  decorative?: boolean;
  tone?: ProgressTone;
  className?: string;
  'data-testid'?: string;
}

export function ProgressBar({ value, max, label, decorative = false, tone = 'default', className, ...rest }: ProgressBarProps): ReactElement {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const ratio = safeMax > 0 ? Math.min(1, safeValue / safeMax) : 0;
  return (
    <span
      className={[styles.track, className].filter(Boolean).join(' ')}
      {...(decorative
        ? { 'aria-hidden': true }
        : {
            role: 'progressbar',
            'aria-label': label,
            'aria-valuemin': 0,
            'aria-valuemax': safeMax,
            'aria-valuenow': Math.min(safeValue, safeMax),
          })}
      data-tone={tone}
      data-testid={rest['data-testid']}
    >
      <span className={styles.fill} style={{ width: `${ratio * 100}%` }} />
    </span>
  );
}

/** Amber past 80%, red once more is used than the limit. */
export function budgetTone(used: number, limit: number): ProgressTone {
  if (limit <= 0) return 'default';
  if (used > limit) return 'over';
  return used / limit > 0.8 ? 'warn' : 'default';
}
