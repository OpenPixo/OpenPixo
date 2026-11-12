import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectNextStepId, ProjectNextStepsResponse } from '@openpixo/contracts';
import { advanceAchievementSnapshot, readAchievementSnapshot, type AchievementSnapshot } from './starter-achievements';

export const achievementStorageKey = (projectId: string) => `pixo:quest:achievements:${encodeURIComponent(projectId)}`;

export function useStarterAchievements(projectId: string | null, data: ProjectNextStepsResponse | null) {
  const memory = useRef(new Map<string, AchievementSnapshot>());
  const [queue, setQueue] = useState<{ projectId: string | null; items: ProjectNextStepId[] }>({ projectId, items: [] });

  useEffect(() => {
    if (!projectId || !data || data.projectId !== projectId) return;
    let previous = memory.current.get(projectId) ?? null;
    if (!previous) {
      try { previous = readAchievementSnapshot(window.localStorage.getItem(achievementStorageKey(projectId))); }
      catch { /* Browser storage may be unavailable. The mounted session still deduplicates. */ }
    }
    const result = advanceAchievementSnapshot(previous, data.steps);
    memory.current.set(projectId, result.snapshot);
    try { window.localStorage.setItem(achievementStorageKey(projectId), JSON.stringify(result.snapshot)); }
    catch { /* Progress remains usable without persistent browser preferences. */ }
    setQueue(current => current.projectId === projectId && result.unlocked.length === 0 ? current
      : { projectId, items: [...(current.projectId === projectId ? current.items : []), ...result.unlocked] });
  }, [projectId, data]);

  const dismiss = useCallback(() => setQueue(current => ({ ...current, items: current.items.slice(1) })), []);
  return { achievement: queue.projectId === projectId ? queue.items[0] ?? null : null, dismiss };
}
