import type { ProjectNextStepId } from '@openpixo/contracts';

export const FIRST_CHAPTER_STEPS: readonly ProjectNextStepId[] = [
  'environment', 'run-game', 'agent-task', 'media-assets', 'verify',
];

export const QUEST_CHAPTERS = [
  { id: '01', titleKey: 'quest.chapter.prototype', locked: false, steps: FIRST_CHAPTER_STEPS },
  { id: '02', titleKey: 'quest.chapter.art', locked: true },
  { id: '03', titleKey: 'quest.chapter.feel', locked: true },
  { id: '04', titleKey: 'quest.chapter.publish', locked: true },
] as const;
