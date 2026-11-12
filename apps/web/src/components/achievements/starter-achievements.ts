import type { ProjectNextStep, ProjectNextStepId } from '@openpixo/contracts';
import type { Dict } from '../../i18n/types';

export interface AchievementSnapshot {
  seen: Partial<Record<ProjectNextStepId, boolean>>;
  earned: ProjectNextStepId[];
}

export const STARTER_ACHIEVEMENTS = {
  environment: { titleKey: 'achievement.environment', xp: 40 },
  'run-game': { titleKey: 'achievement.runGame', xp: 80 },
  'agent-task': { titleKey: 'achievement.agentTask', xp: 100 },
  'media-assets': { titleKey: 'achievement.mediaAssets', xp: 100 },
  verify: { titleKey: 'achievement.verify', xp: 120 },
} as const satisfies Record<ProjectNextStepId, { titleKey: keyof Dict; xp: number }>;

export function advanceAchievementSnapshot(previous: AchievementSnapshot | null, steps: ProjectNextStep[]) {
  const seen: AchievementSnapshot['seen'] = {};
  const earned = new Set(previous?.earned ?? []);
  const unlocked: ProjectNextStepId[] = [];
  for (const step of steps) {
    seen[step.id] = step.status === 'done';
    if (step.status !== 'done') continue;
    if (previous?.seen[step.id] === false && !earned.has(step.id)) unlocked.push(step.id);
    earned.add(step.id);
  }
  return { snapshot: { seen, earned: [...earned] }, unlocked };
}

export function readAchievementSnapshot(value: string | null): AchievementSnapshot | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || !('seen' in parsed) || !('earned' in parsed)) return null;
    const { seen, earned } = parsed;
    if (!seen || typeof seen !== 'object' || !Array.isArray(earned)) return null;
    const ids = Object.keys(STARTER_ACHIEVEMENTS) as ProjectNextStepId[];
    return {
      seen: Object.fromEntries(ids.filter(id => id in seen && typeof (seen as Record<string, unknown>)[id] === 'boolean')
        .map(id => [id, (seen as Record<string, boolean>)[id]])),
      earned: earned.filter((id): id is ProjectNextStepId => ids.includes(id)),
    };
  } catch { return null; }
}
