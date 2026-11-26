import type { MotionJob } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { stateText, stepsDone, stepText, STEPS } from './motion-text';
import styles from './Motion.module.css';

/** The five steps and a bar. What happens in a step is not said: only that it goes on. */
export function MotionProgress({ job, compact }: { job: MotionJob; compact?: boolean }) {
  const { t } = useI18n();
  const done = stepsDone(job.state), percent = Math.round(job.progress * 100);
  return <div className={compact ? styles.progressCompact : styles.progress} role="status" data-testid="motion-progress">
    <strong>{stateText(t, job.state)}</strong>
    <ol className={styles.steps}>
      {STEPS.map((step, i) => <li key={step} className={i < done ? styles.stepDone : i === done ? styles.stepNow : styles.step}>{stepText(t, step)}</li>)}
    </ol>
    <div className={styles.bar} role="progressbar" aria-label={stateText(t, job.state)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <div style={{ transform: `scaleX(${job.progress})` }} />
    </div>
    {!compact && <span className={styles.hint}>{t('motion.makingHint')}</span>}
  </div>;
}
