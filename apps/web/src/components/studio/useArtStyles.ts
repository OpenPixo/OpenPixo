import { useEffect, useState } from 'react';
import type { ArtStyle, ProjectArtStyleResponse } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { getProjectArtStyle, listArtStyles, PROJECT_ART_STYLE_CHANGED } from '../../providers/styles';

export function useArtStyles(projectId: string) {
  const { locale } = useI18n();
  const [styles, setStyles] = useState<ArtStyle[]>([]);
  const [projectStyle, setProjectStyle] = useState<ProjectArtStyleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setFailed(false); setProjectStyle(null); setStyles([]);
    void Promise.allSettled([
      listArtStyles(controller.signal, locale), getProjectArtStyle(projectId, controller.signal, locale),
    ]).then(([catalog, project]) => {
      if (controller.signal.aborted) return;
      if (catalog.status === 'fulfilled') setStyles(catalog.value);
      if (project.status === 'fulfilled') setProjectStyle(project.value);
      setFailed(catalog.status === 'rejected' || project.status === 'rejected');
      setLoading(false);
    });
    return () => controller.abort();
  }, [projectId, locale, revision]);
  useEffect(() => {
    function changed(event: Event) {
      if ((event as CustomEvent<{ projectId: string }>).detail.projectId === projectId) setRevision(value => value + 1);
    }
    window.addEventListener(PROJECT_ART_STYLE_CHANGED, changed);
    return () => window.removeEventListener(PROJECT_ART_STYLE_CHANGED, changed);
  }, [projectId]);
  return { styles, projectStyle, loading, failed, retry: () => setRevision(value => value + 1) };
}
