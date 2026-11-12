import { useEffect, useState } from 'react';
import type { GameTemplateSummary } from '@openpixo/contracts';
import { fetchGameTemplates } from '../../state/game-templates';
import { SAMPLE_TEMPLATE_ID } from '../new-game/quick-sample';

const COVERS: Record<string, string> = {
  [SAMPLE_TEMPLATE_ID]: 'pixel-16-bit', 'phaser3-vite': 'pixel-8-bit',
  'godot4-2d': 'isometric-pixel', 'godot4-3d': 'low-poly-3d', 'threejs-vite': 'toon-3d',
};

/** The template's own in-game screenshot when it ships one, else a matching art-style preview. */
export function templateCover(template: GameTemplateSummary): string {
  if (template.coverUrl) return template.coverUrl;
  return `/api/styles/${COVERS[template.id] ?? (template.engine === 'godot' ? 'isometric-pixel' : 'pixel-16-bit')}/previews/0`;
}

export function useHomeTemplates() {
  const [templates, setTemplates] = useState<GameTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void fetchGameTemplates(controller.signal).then(result => {
      if (!controller.signal.aborted) setTemplates(Array.isArray(result.templates) ? result.templates : []);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  return { templates, loading, failed, retry: () => setRevision(value => value + 1) };
}
