import { useCallback, useEffect, useState } from 'react';
import { GAME_ENGINE_IDS, type ProjectNextStep, type ProjectNextStepAction, type ProjectNextStepsResponse } from '@openpixo/contracts';
import { STARTER_FACTS_CHANGED_EVENT } from '../project-start/events';
import { FIRST_CHAPTER_STEPS } from './chapters';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStepAction(value: unknown): value is ProjectNextStepAction {
  if (!isRecord(value) || typeof value.value !== 'string') return false;
  switch (value.kind) {
    case 'open-settings': return value.value === 'environment';
    case 'open-tab': return value.value === 'assets' || value.value === 'generate';
    case 'run-game':
    case 'verify':
    case 'prefill-chat': return true;
    default: return false;
  }
}

function isStep(value: unknown): value is ProjectNextStep {
  return isRecord(value) && FIRST_CHAPTER_STEPS.some(id => id === value.id)
    && (value.status === 'done' || value.status === 'todo' || value.status === 'blocked')
    && isStepAction(value.action);
}

/** Only complete facts for the requested project may replace the last good snapshot. */
function isQuestResponse(value: unknown, projectId: string): value is ProjectNextStepsResponse {
  if (!isRecord(value) || value.projectId !== projectId || typeof value.dismissed !== 'boolean'
    || !GAME_ENGINE_IDS.some(engine => engine === value.engine) || !Array.isArray(value.steps)) return false;
  const steps = value.steps;
  return steps.length === FIRST_CHAPTER_STEPS.length && steps.every(isStep)
    && FIRST_CHAPTER_STEPS.every(id => steps.some(step => step.id === id));
}

interface ProgressSnapshot {
  projectId: string | null;
  data: ProjectNextStepsResponse | null;
  loading: boolean;
  failed: boolean;
}

const initial = (projectId: string | null): ProgressSnapshot => ({ projectId, data: null, loading: !!projectId, failed: false });

/** The persistent quest follows starter facts even after its project checklist is dismissed. */
export function useQuestProgress(projectId: string | null) {
  const [snapshot, setSnapshot] = useState(() => initial(projectId));
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!projectId) { setSnapshot(initial(null)); return; }
    let active = true;
    let request: AbortController | null = null;
    const refresh = () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      setSnapshot(previous => ({ ...(previous.projectId === projectId ? previous : initial(projectId)), loading: true, failed: false }));
      void fetch(`/api/projects/${encodeURIComponent(projectId)}/next-steps`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error();
          const data: unknown = await response.json();
          if (!isQuestResponse(data, projectId)) throw new Error('Invalid quest response');
          if (active && !controller.signal.aborted) setSnapshot({ projectId, data, loading: false, failed: false });
        }).catch(() => {
          if (active && !controller.signal.aborted) setSnapshot(previous => ({ ...previous, loading: false, failed: true }));
        });
    };
    const factsChanged = (event: Event) => {
      if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) refresh();
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(STARTER_FACTS_CHANGED_EVENT, factsChanged);
    return () => {
      active = false;
      request?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener(STARTER_FACTS_CHANGED_EVENT, factsChanged);
    };
  }, [projectId, revision]);

  return { ...(snapshot.projectId === projectId ? snapshot : initial(projectId)), retry };
}
