import { useState } from 'react';
import { Button } from '@openpixo/components';
import type { MotionCharacter } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { deleteMotion, motionPoster } from '../../providers/motion';
import { codeText } from './motion-text';
import { MotionProgress } from './MotionProgress';
import styles from './Motion.module.css';

/** One moving character in the list: its poster, or how far it is, or why it did not work out. */
export function MotionCard({ character: c, onOpen, onDeleted, onChange }: { character: MotionCharacter; onOpen: () => void; onDeleted: () => void; onChange: () => void }) {
  const { t } = useI18n();
  const [removing, setRemoving] = useState(false);
  if (c.state === 'ready') {
    return <button type="button" className={styles.card} onClick={onOpen} data-testid="motion-card" data-state="ready">
      <span className={styles.cardStage}><img src={motionPoster(c.id)} alt="" loading="lazy" draggable={false} /></span>
      <h3>{c.name}</h3>
    </button>;
  }
  return <article className={styles.card} data-testid="motion-card" data-state={c.state}>
    <div className={`${styles.cardStage} ${c.state === 'making' ? styles.cardMaking : ''}`}>
      {c.state === 'making' && c.job ? <button type="button" className={styles.cardOpen} onClick={onOpen}><MotionProgress job={c.job} compact /></button>
        : <div className={styles.cardFailed}>
          <strong>{t('motion.state.failed')}</strong>
          <span>{codeText(t, c.job?.errorCode ?? null)}</span>
          <span>{t('motion.creditsBack')}</span>
          <Button size="sm" disabled={removing} onClick={() => { setRemoving(true); deleteMotion(c.id).then(onDeleted, () => { setRemoving(false); onChange(); }); }}>{t('motion.remove')}</Button>
        </div>}
    </div>
    <h3>{c.name}</h3>
  </article>;
}
