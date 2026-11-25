import { useEffect, useRef, useState } from 'react';
import { Button, SegmentedProgress } from '@openpixo/components';
import type { LocalCharacter } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { characterFile, deleteCharacter } from '../../providers/characters';
import { codeText, isWorking, stateText, stepOf, STEPS } from './character-text';
import { canShowCharacters, FRAMES, loadPack, run } from './stage';
import styles from './Characters.module.css';

/** A still until it is pointed at; then it moves, in what it wears at the start. */
function Moving({ character }: { character: LocalCharacter }) {
  const canvas = useRef<HTMLCanvasElement>(null), [shown, setShown] = useState(false);
  useEffect(() => {
    let stop: (() => void) | null = null, left = false;
    void loadPack(character).then(pack => {
      if (left || !canvas.current) return;
      const actor = pack.create();
      stop = run(canvas.current, actor, () => FRAMES.card, () => { if (!left) setShown(true); });
    }).catch(() => { /* the still stays */ });
    return () => { left = true; stop?.(); };
  }, [character.id, character.revision]);
  return <canvas ref={canvas} className={`${styles.cardCanvas} ${shown ? styles.cardCanvasOn : ''}`} aria-hidden="true" />;
}

export function CharacterCard({ character: c, sample, onOpen, onDeleted, onChange }: { character: LocalCharacter; sample?: boolean; onOpen: () => void; onDeleted: () => void; onChange: () => void }) {
  const { t } = useI18n();
  const [near, setNear] = useState(false), [removing, setRemoving] = useState(false);
  const ready = c.state === 'ready', working = isWorking(c), update = c.games.some(g => g.revision < c.revision);
  const counts = [t('characters.countSets', { count: c.items.sets.length }), t('characters.countWeapons', { count: c.items.weapons.length }), t('characters.countMotions', { count: c.motions.length })].join(' · ');
  if (!ready) {
    return <article className={styles.card} data-testid="character-card" data-state={c.state}>
      <div className={`${styles.cardStage} ${c.state === 'making' ? styles.cardMaking : ''}`}>
        {c.state === 'making' && c.job ? <div className={styles.progress} role="status"><strong>{stateText(t, c.job.state)}</strong><SegmentedProgress total={STEPS.length} done={stepOf(c.job.state)} label={stateText(t, c.job.state)} /><span>{t('characters.makingHint')}</span></div>
          : <div className={styles.progress}><strong>{t('characters.state.failed')}</strong><span>{codeText(t, c.job?.errorCode ?? null)}</span>
            <Button size="sm" disabled={removing} onClick={() => { setRemoving(true); deleteCharacter(c.id).then(onDeleted, () => { setRemoving(false); onChange(); }); }}>{t('characters.remove')}</Button></div>}
      </div>
      <h3>{c.name}</h3>
    </article>;
  }
  return <button type="button" className={styles.card} onClick={onOpen} onPointerEnter={() => setNear(true)} onPointerLeave={() => setNear(false)} onFocus={() => setNear(true)} onBlur={() => setNear(false)} data-testid="character-card" data-state="ready">
    <span className={styles.cardStage}>
      <img src={characterFile(c.id, c.revision, 'portrait.png')} alt="" loading="lazy" draggable={false} />
      {near && canShowCharacters() && <Moving character={c} />}
      {sample && <span className={styles.badge}>{t('characters.sample')}</span>}
      {working && c.job && <span className={styles.badge}>{stateText(t, c.job.state)}</span>}
    </span>
    <h3>{c.name}</h3>
    <span className={styles.cardMeta}>{counts}</span>
    <span className={styles.cardMeta}>{c.games.length ? t('characters.inGames', { count: c.games.length }) : t('characters.inNoGame')}{update && <b className={styles.update}>{t('characters.updateWaiting')}</b>}</span>
  </button>;
}
