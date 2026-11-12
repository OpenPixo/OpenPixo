import { useEffect, useState } from 'react';
import type { ProjectNextStepId } from '@openpixo/contracts';
import { Card, Eyebrow } from '@openpixo/components';
import { createPortal } from 'react-dom';
import { Trophy } from 'lucide-react';
import { useT } from '../../i18n';
import { STARTER_ACHIEVEMENTS } from './starter-achievements';
import styles from './AchievementToast.module.css';

export function AchievementToast({ achievement, onDismiss }: {
  achievement: ProjectNextStepId | null;
  onDismiss: () => void;
}) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [displayed, setDisplayed] = useState(achievement);
  useEffect(() => {
    setMounted(true);
    if (!achievement) return;
    setDisplayed(achievement);
    const timeout = window.setTimeout(onDismiss, 4_000);
    return () => window.clearTimeout(timeout);
  }, [achievement, onDismiss]);
  const detail = displayed ? STARTER_ACHIEVEMENTS[displayed] : null;
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(<Card className={styles.toast} data-visible={!!achievement} role="status" aria-live="polite" aria-atomic="true" aria-hidden={!achievement}>
    <span className={styles.trophy}><Trophy size={18} aria-hidden="true" /></span>
    <div className={styles.copy}>
      <Eyebrow className={styles.eyebrow}>{t('achievement.eyebrow')}</Eyebrow>
      <strong>{detail ? t(detail.titleKey) : ''}</strong>
    </div>
    <span className={styles.xp}>{detail ? t('achievement.xp', { xp: detail.xp }) : ''}</span>
  </Card>, document.body);
}
