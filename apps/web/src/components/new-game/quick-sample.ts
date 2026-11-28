import { useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { queueProjectGameStart } from '../../state/game-start-request';
import { openSoundDevice } from '../game/open-sound-device';
import { authorizeHostGameParent, isOpenPixoHostAvailable, type OpenPixoHostProjectImportSuccess } from '@openpixo/host';
import { checkGameTarget, fetchGameTemplates, GameTemplateRequestError } from '../../state/game-templates';
import { createGameFromTemplate } from '../NewGameDialog.api';
import { rememberedGameParent } from '../NewGameDialog.errors';
import { SAMPLE_TEMPLATE_ID, draftToSetup, emptyDraft, templateDraftDefaults } from './wizard-state';

export { SAMPLE_TEMPLATE_ID };

/** The sample's own name in the user's language: its template name without the "Sample:" label. */
function sampleTitle(template: { nameZhCN?: string }, locale: string): string | undefined {
  return locale === 'zh-CN' ? template.nameZhCN?.replace(/^示例[:：]\s*/, '').trim() || undefined : undefined;
}

export async function createQuickSample(locale = 'en'): Promise<OpenPixoHostProjectImportSuccess> {
  const { templates, defaultParentDir } = await fetchGameTemplates();
  const template = templates.find(item => item.id === SAMPLE_TEMPLATE_ID);
  if (!template) throw new GameTemplateRequestError('Sample template not found', 404, 'TEMPLATE_NOT_FOUND');
  let parentDir = rememberedGameParent() || defaultParentDir;
  if (!parentDir) throw new GameTemplateRequestError('Game parent not found', 400, 'PARENT_NOT_FOUND');
  let token: string | undefined;
  if (isOpenPixoHostAvailable()) {
    // The host only vouches for a remembered parent picked in this run; the default games folder always qualifies.
    let approved = await authorizeHostGameParent(parentDir);
    if (!approved.ok && defaultParentDir && parentDir !== defaultParentDir) approved = await authorizeHostGameParent(defaultParentDir);
    if (!approved.ok) throw new GameTemplateRequestError('reason' in approved ? approved.reason : 'Game parent authorization failed', 403, 'TARGET_REJECTED');
    parentDir = approved.baseDir;
    token = approved.token;
  }
  const baseName = template.name.replace(/^sample:\s*/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pixel-platformer';
  const title = sampleTitle(template, locale);
  const draft = { ...emptyDraft(SAMPLE_TEMPLATE_ID), ...templateDraftDefaults(SAMPLE_TEMPLATE_ID), ...(title ? { title } : {}), kickoff: false };
  for (let attempt = 1; attempt <= 20; attempt++) {
    const name = attempt === 1 ? baseName : `${baseName}-${attempt}`;
    const result = await checkGameTarget({ parentDir, name, createParent: true }, token);
    if (result.status === 'exists') continue;
    if (result.status !== 'available') throw new GameTemplateRequestError(result.message ?? result.status, 400, result.reasonCode);
    const created = await createGameFromTemplate({ templateId: SAMPLE_TEMPLATE_ID, parentDir, name, createParent: true, setup: draftToSetup(draft) }, token);
    return { ok: true, projectId: created.project.id, conversationId: created.conversationId, entryFile: created.entryFile };
  }
  throw new GameTemplateRequestError('Sample names already exist', 409, 'TARGET_EXISTS');
}

/** Shown when the sample cannot be made by itself: the game dialog opens on it with the error. */
export interface QuickSampleFallback {
  error: unknown;
  /** For the dialog's `onMade`. */
  onMade: (made: { projectId: string; templateId: string }) => void;
}

/** Makes the finished sample and opens it already running: it is there to be played. */
export function useQuickSample(onCreated?: (response: OpenPixoHostProjectImportSuccess) => Promise<void> | void) {
  const { locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState<QuickSampleFallback | null>(null);
  const active = useRef(false);
  /** `onMade` runs once the sample exists, before its project opens. */
  async function start(onMade?: (projectId: string) => void) {
    if (active.current || !onCreated) return;
    active.current = true;
    setBusy(true);
    openSoundDevice();
    try {
      const sample = await createQuickSample(locale);
      queueProjectGameStart(sample.projectId);
      onMade?.(sample.projectId);
      await onCreated(sample);
    }
    catch (error) {
      // The game dialog takes over; a sample made there still gets what this start was for (the walkthrough).
      setFallback({ error, onMade: made => {
        if (made.templateId !== SAMPLE_TEMPLATE_ID) return;
        queueProjectGameStart(made.projectId);
        onMade?.(made.projectId);
      } });
    }
    finally { active.current = false; setBusy(false); }
  }
  return { busy, start, fallback, closeFallback: () => setFallback(null) };
}
