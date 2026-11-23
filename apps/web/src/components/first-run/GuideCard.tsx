import type { ReactNode } from 'react';
import { Button, SegmentedProgress } from '@openpixo/components';
import { FIRST_RUN_GUIDE_STEPS, type FirstRunGuideStep, type FirstRunHint } from '@openpixo/contracts';
import { Check, Lightbulb, LoaderCircle } from 'lucide-react';
import { useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { closeFirstRunHint } from '../../state/first-run-guide';
import styles from './GuideCard.module.css';

export type GuideTone = 'todo' | 'working' | 'done' | 'problem';

/**
 * One step of the walkthrough, drawn in the page where the step happens: under
 * the game, or above the composer. It never floats over anything and never
 * takes the pointer from the game, so the user can always just do the thing.
 */
export function GuideCard({ step, tone, title, body, actions, onSkip }: {
  step: FirstRunGuideStep;
  tone: GuideTone;
  title: string;
  body: string;
  actions?: ReactNode;
  onSkip: () => void;
}) {
  const t = useT();
  const index = FIRST_RUN_GUIDE_STEPS.indexOf(step);
  const total = FIRST_RUN_GUIDE_STEPS.length;
  const progress = t('guide.progress', { n: index + 1, total });
  return (
    <section className={styles.card} data-tone={tone} data-step={step} data-testid="first-run-guide" aria-label={t('guide.label')} key={step}>
      <div className={styles.head}>
        <SegmentedProgress className={styles.progress} total={total} done={tone === 'done' ? index + 1 : index} label={progress} />
        <span className={styles.count} aria-hidden="true">{index + 1} / {total}</span>
        <Button variant="ghost" size="sm" className={styles.skip} onClick={onSkip} data-testid="first-run-guide-skip">
          {t('guide.skip')}
        </Button>
      </div>
      <div className={styles.copy} role="status">
        <p className={styles.title}>
          {tone === 'done' ? <span className={styles.mark} aria-hidden="true"><Check size={12} strokeWidth={2.5} /></span> : null}
          {tone === 'working' ? <LoaderCircle size={14} aria-hidden="true" className={styles.spinner} /> : null}
          {title}
        </p>
        <p className={styles.body}>{body}</p>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </section>
  );
}

const HINT_COPY: Record<FirstRunHint, keyof Dict> = {
  plan: 'guide.hint.plan', art: 'guide.hint.art', stage: 'guide.hint.stage', share: 'guide.hint.share',
};

/** A one-time hint in the user's first own game: one sentence, closed for good. */
export function FirstRunHintStrip({ hint }: { hint: FirstRunHint }) {
  const t = useT();
  return (
    <div className={styles.hint} role="status" data-testid="first-run-hint" data-hint={hint} key={hint}>
      <Lightbulb size={14} aria-hidden="true" className={styles.hintIcon} />
      <p className={styles.hintText}>{t(HINT_COPY[hint])}</p>
      <Button variant="ghost" size="sm" className={styles.hintClose} onClick={() => closeFirstRunHint(hint)}>
        {t('guide.hint.close')}
      </Button>
    </div>
  );
}
