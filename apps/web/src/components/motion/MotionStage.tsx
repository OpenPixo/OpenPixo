import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '@openpixo/components';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { fetchMotionFile } from '../../providers/motion';
import { canShowMotion, loadMotionPlayer, type MotionActor } from './motion-player';
import styles from './Motion.module.css';

const MOODS: Record<string, keyof Dict> = {
  calm: 'motion.mood.calm', smile: 'motion.mood.smile', happy: 'motion.mood.happy', angry: 'motion.mood.angry', sad: 'motion.mood.sad', surprised: 'motion.mood.surprised', shy: 'motion.mood.shy',
};
/** The size the character is drawn at; the page scales the canvas. */
const SIZE = { width: 512, height: 640 } as const;

/** The character moving in the page, with the player a game gets. It looks at the pointer. */
export function MotionStage({ characterId, name }: { characterId: string; name: string }) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null), actorRef = useRef<MotionActor | null>(null);
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading'), [moods, setMoods] = useState<string[]>([]), [mood, setMood] = useState<string | null>(null);

  useEffect(() => {
    let left = false, frame = 0, made: MotionActor | null = null;
    setState('loading');
    setMood(null);
    if (!canShowMotion()) { setState('failed'); return; }
    void (async () => {
      try {
        const [player, file] = await Promise.all([loadMotionPlayer(), fetchMotionFile(characterId)]);
        if (left) return;
        made = await player.createPixoMotion(file, SIZE);
        if (left || !host.current) return;
        made.canvas.className = styles.canvas ?? '';
        host.current.append(made.canvas);
        actorRef.current = made;
        let last = performance.now();
        const tick = (now: number): void => { made!.update(Math.max(0, now - last) / 1000); last = now; frame = requestAnimationFrame(tick); };
        frame = requestAnimationFrame(tick);
        setMoods(made.moods ?? Object.keys(MOODS));
        setState('shown');
      } catch (error) {
        console.warn('[motion] could not show the character:', error);
        if (!left) setState('failed');
      }
    })();
    return () => {
      left = true;
      cancelAnimationFrame(frame);
      actorRef.current = null;
      if (made) { made.canvas.remove(); made.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext(); }
    };
  }, [characterId]);

  const look = (event: PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    actorRef.current?.lookAt(((event.clientX - box.left) / box.width) * 2 - 1, 1 - ((event.clientY - box.top) / box.height) * 2);
  };

  return <div className={styles.stageWrap}>
    <div ref={host} className={styles.stage} onPointerMove={look} onPointerLeave={() => actorRef.current?.lookAway?.()} role="img" aria-label={name} data-testid="motion-stage" data-state={state}>
      {state === 'loading' && <p className={styles.stageNote} aria-busy="true">{t('motion.loading')}</p>}
      {state === 'failed' && <p className={styles.stageNote} role="status">{t('motion.cannotPlay')}</p>}
    </div>
    {state === 'shown' && <div className={styles.playbar}>
      <span className={styles.playLabel}>{t('motion.moods')}</span>
      {moods.map(m => <button key={m} type="button" className={mood === m ? styles.chipOn : styles.chip} aria-pressed={mood === m} onClick={() => { setMood(actorRef.current?.mood(m) ?? m); }}>
        {MOODS[m] ? t(MOODS[m]) : m}
      </button>)}
      <Button size="sm" variant="secondary" onClick={() => actorRef.current?.talk(2.5)} data-testid="motion-talk">{t('motion.talk')}</Button>
      <span className={styles.lookHint}>{t('motion.lookHint')}</span>
    </div>}
  </div>;
}
