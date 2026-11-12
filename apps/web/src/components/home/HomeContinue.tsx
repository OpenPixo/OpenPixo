import { useId, useRef, useState } from 'react';
import { Button, Card } from '@openpixo/components';
import type { GameTemplateSummary } from '@openpixo/contracts';
import { ArrowRight, Play } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { Project } from '../../types';
import { relativeTimeLong } from '../../utils/chatTime';
import { notifyStarterFactsChanged } from '../project-start/events';
import { useQuestProgress } from '../quest/useQuestProgress';
import { templateCover } from './HomeTemplates';
import { useHomeProjectFacts } from './useHomeProjectFacts';
import styles from './HomeContinue.module.css';

interface Props {
  projects: readonly Project[];
  templates: readonly GameTemplateSummary[];
  loading?: boolean;
  onOpenProject: (id: string) => void;
  onViewAll?: () => void;
}

export function HomeContinue({ projects, templates, loading, onOpenProject, onViewAll }: Props) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const project = projects.reduce<Project | null>((latest, item) => !latest || item.updatedAt > latest.updatedAt ? item : latest, null);
  const facts = useHomeProjectFacts(project?.id ?? null, project?.updatedAt);
  const quest = useQuestProgress(project?.id ?? null);
  const [launching, setLaunching] = useState<string | null>(null);
  const launchRef = useRef(false);
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(() => new Set());
  if (loading && !project) return <div className={`${styles.section} ${styles.loading}`} role="status" aria-label={t('home.continueLoading')} />;
  if (!project) return null;

  const template = templates.find(item => item.id === project.metadata?.templateId);
  const templateName = template
    ? locale === 'zh-CN' ? template.nameZhCN || template.name : template.name
    : project.metadata?.templateLabel || t('home.continueGame');
  const styleCover = project.metadata?.artStyleId
    ? `/api/styles/${encodeURIComponent(project.metadata.artStyleId)}/previews/0`
    : undefined;
  const fallbackCover = templateCover(template ?? { id: '', engine: project.metadata?.engineProfile?.engine ?? 'web-generic', name: '', description: '' });
  const thumbnail = [facts.thumbnail, styleCover, fallbackCover]
    .find((source): source is string => typeof source === 'string' && !failedImages.has(source));
  const verified = quest.data?.steps.some(step => step.id === 'verify' && step.status === 'done');
  const run = async () => {
    if (launchRef.current) return;
    launchRef.current = true;
    setLaunching(project.id);
    try {
      const request = fetch(`/api/projects/${encodeURIComponent(project.id)}/game/run`, { method: 'POST' });
      onOpenProject(project.id);
      const response = await request;
      if (response.ok) notifyStarterFactsChanged(project.id);
    } catch { /* Opening the project remains available when the run API is unavailable. */ }
    finally {
      launchRef.current = false;
      setLaunching(null);
    }
  };

  return <section className={styles.section} aria-labelledby={titleId}>
    <div className={styles.head}>
      <h2 id={titleId}>{t('home.continueTitle')}</h2>
      {onViewAll && <Button variant="ghost" size="sm" className={styles.link} onClick={onViewAll}>{t('home.continueAllGames')}<ArrowRight size={13} aria-hidden="true" /></Button>}
    </div>
    <Card interactive className={styles.row}>
      {thumbnail
        ? <img className={styles.thumbnail} src={thumbnail} alt="" onError={() => setFailedImages(previous => new Set(previous).add(thumbnail))} />
        : <div className={styles.thumbnail} aria-hidden="true" />}
      <div className={styles.identity}>
        <h3>{project.name}</h3>
        <p className={styles.subtitle}>{templateName} · {relativeTimeLong(project.updatedAt, t)}</p>
        {verified && <span className={styles.verified}><span className={styles.dot} aria-hidden="true" />{t('home.continueVerified')}</span>}
      </div>
      <div className={styles.actions}>
        <Button variant="ghost" disabled={launching !== null} onClick={() => void run()}><Play size={13} fill="currentColor" aria-hidden="true" />{launching === project.id ? t('home.continueRunning') : t('home.continueRun')}</Button>
        <Button variant="primary" onClick={() => onOpenProject(project.id)}>{t('home.continueOpen')}</Button>
      </div>
    </Card>
  </section>;
}
