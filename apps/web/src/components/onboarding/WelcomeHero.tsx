import { useEffect, useRef } from 'react';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import { PearlDiverScene } from './PearlDiverScene';
import styles from './WelcomeHero.module.css';

/**
 * The first-run picture of the whole product: someone asks for a game in chat,
 * and the game is there, running. It is all live HTML and vector art, so it is
 * complete on the first frame, follows the theme, and stays sharp at any size.
 * Motion only adds to a picture that already makes sense when it is still.
 */
export function WelcomeHero() {
  const t = useT();
  const stage = useDepthOnPointer();
  return (
    <div ref={stage} className={styles.stage} role="img" aria-label={t('onboarding.hero.label')} data-testid="onboarding-hero">
      <span className={styles.pixelA} />
      <span className={styles.pixelB} />
      <span className={styles.pixelC} />
      <div className={styles.composition} aria-hidden="true">
        <div className={styles.frame}>
          <div className={styles.frameBar}>
            <span className={styles.frameDot} />
            <span className={styles.frameTitle}>{t('onboarding.hero.gameTitle')}</span>
            <span className={styles.frameTag}><Icon name="play" size={10} />{t('onboarding.hero.playable')}</span>
          </div>
          <div className={styles.screen}>
            <PearlDiverScene />
            <div className={styles.keys}>
              <span className={styles.keyCaps}>
                <kbd className={styles.keyLeft}>←</kbd>
                <kbd className={styles.keyUp}>↑</kbd>
                <kbd className={styles.keyDown}>↓</kbd>
                <kbd className={styles.keyRight}>→</kbd>
              </span>
              <span>{t('onboarding.hero.keysHint')}</span>
            </div>
          </div>
        </div>

        <div className={styles.chat}>
          <p className={styles.userBubble}>{t('onboarding.hero.prompt')}</p>
          <ul className={styles.steps}>
            <li><Icon name="check" size={12} />{t('onboarding.hero.stepRules')}</li>
            <li><Icon name="check" size={12} />{t('onboarding.hero.stepArt')}</li>
            <li><Icon name="check" size={12} />{t('onboarding.hero.stepPlaytest')}</li>
          </ul>
          <p className={styles.reply}>{t('onboarding.hero.reply')}</p>
          <div className={styles.composer}>
            <span>{t('onboarding.hero.composer')}</span>
            <span className={styles.send}><Icon name="arrow-up" size={12} /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Lets the layers drift a little with the pointer, so the picture feels touchable.
 * It writes two CSS variables and leaves the look to the stylesheet; people who
 * ask for reduced motion get the still picture.
 */
function useDepthOnPointer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== false) return;
    let frame = 0;
    const set = (x: number, y: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--px', x.toFixed(3));
        el.style.setProperty('--py', y.toFixed(3));
      });
    };
    const move = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      set(((event.clientX - box.left) / box.width) * 2 - 1, ((event.clientY - box.top) / box.height) * 2 - 1);
    };
    const leave = () => set(0, 0);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, []);
  return ref;
}
