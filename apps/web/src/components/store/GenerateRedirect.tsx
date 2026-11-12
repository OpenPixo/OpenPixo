import { useEffect } from 'react';
import { Button, Card, Eyebrow } from '@openpixo/components';
import { useI18n } from '../../i18n';
import { navigate } from '../../router';
import { mostRecentStoreProject, openProjectGenerate } from '../../state/store';
import type { StoreProject } from './StoreView';
import styles from './GenerateRedirect.module.css';

export function GenerateRedirect({ projects }: { projects: StoreProject[] }) {
  const { t } = useI18n();
  const project = mostRecentStoreProject(projects);
  useEffect(() => {
    if (project) openProjectGenerate(project, true);
  }, [project?.id]);

  return <Card className={styles.notice}>
    <Eyebrow>{t('store.generate.eyebrow')}</Eyebrow>
    <h1>{t('store.generate.title')}</h1>
    <p>{t('store.generate.explanation')}</p>
    {project ? <Button variant="primary" onClick={() => openProjectGenerate(project)}>
      {t('store.generate.open', { name: project.name })}
    </Button> : <>
      <p>{t('store.generate.projectRequired')}</p>
      <Button variant="primary" onClick={() => navigate({ kind: 'home', view: 'projects' })}>{t('store.action.openProjects')}</Button>
    </>}
  </Card>;
}
