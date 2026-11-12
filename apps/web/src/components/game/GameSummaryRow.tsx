import { useId, useState, type ReactNode } from 'react';
import type { GameVerifyStep } from '@openpixo/contracts';
import { CircleAlert, CircleCheck, CircleMinus, LoaderCircle } from 'lucide-react';

import { VisuallyHidden } from '@openpixo/components';
import { useT } from '../../i18n';
import { relativeTimeLong } from '../../utils/chatTime';
import { Icon } from '../Icon';
import styles from './GameSummaryRow.module.css';

export type GameResultStatus = 'passed' | 'failed' | 'unavailable' | 'skipped';

export function stepStatus(step: GameVerifyStep): GameResultStatus {
  return step.status ?? (step.exitCode === 0 ? 'passed' : 'failed');
}

export function GameStatusIcon({ status, size = 13 }: { status: GameResultStatus; size?: number }) {
  if (status === 'passed') return <CircleCheck size={size} aria-hidden="true" />;
  if (status === 'failed') return <CircleAlert size={size} aria-hidden="true" />;
  return <CircleMinus size={size} aria-hidden="true" />;
}

/** ✓ 检查 / ✗ 运行: one step's outcome, readable without colour. */
export function GameStepPill({ status, label }: { status: GameResultStatus; label: string }) {
  const t = useT();
  return <span className={styles.pill} data-status={status} title={t('panel.game.stepStatus', { step: label, status: t(`gameVerify.status.${status}`) })}>
    <GameStatusIcon status={status} size={12} />
    <span>{label}</span>
    <VisuallyHidden>{` · ${t(`gameVerify.status.${status}`)}`}</VisuallyHidden>
  </span>;
}

/**
 * 上次验证 / 上次试玩 (specs/current/openpixo-game-panel.md §4): one line of
 * outcome and time that expands, with the shared accordion pair, into its
 * logs or frames.
 */
export function GameSummaryRow({ label, status, meta, completedAt, now, expanded, onToggle, busy, testId, children }: {
  label: string;
  status: GameResultStatus;
  meta?: ReactNode;
  completedAt?: number;
  now: number;
  expanded: boolean;
  onToggle: () => void;
  busy?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const t = useT();
  const bodyId = useId();
  // Mounted on first expand and kept, so collapsing animates and loaded logs stay.
  const [mounted, setMounted] = useState(expanded);
  if (expanded && !mounted) setMounted(true);
  void now; // Re-rendered by the view's clock so the relative time stays current.
  return <section className={styles.row} data-testid={testId} data-status={status}>
    <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle}>
      <Icon name="chevron-right" size={14} className={styles.chevron} />
      <span className={styles.label}>{label}</span>
      <span className={styles.status} data-status={status}>
        {busy ? <LoaderCircle size={13} aria-hidden="true" className={styles.spinner} /> : <GameStatusIcon status={status} />}
        {/* The row's verdict lives here, once; the body lists only the steps. */}
        <span className={styles.statusText}>{t(`gameVerify.status.${status}`)}</span>
      </span>
      <span className={styles.meta}>{meta}</span>
      {completedAt ? <time className={styles.time} dateTime={new Date(completedAt).toISOString()}
        title={new Date(completedAt).toLocaleString()}>{relativeTimeLong(completedAt, t)}</time> : null}
    </button>
    <div id={bodyId} className={`accordion-collapsible${expanded ? ' open' : ''}`} aria-hidden={!expanded}>
      <div className="accordion-collapsible-inner">
        {mounted ? <div className={styles.body}>{children}</div> : null}
      </div>
    </div>
  </section>;
}
