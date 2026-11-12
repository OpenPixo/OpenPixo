import { useRef, useState } from 'react';
import { authorizeHostGameParent, isOpenPixoHostAvailable, type OpenPixoHostProjectImportSuccess } from '@openpixo/host';
import { checkGameTarget, fetchGameTemplates, GameTemplateRequestError } from '../../state/game-templates';
import { createGameFromTemplate } from '../NewGameDialog.api';
import { rememberedGameParent } from '../NewGameDialog.errors';
import { SAMPLE_TEMPLATE_ID, draftToSetup, emptyDraft, templateDraftDefaults } from './wizard-state';

export { SAMPLE_TEMPLATE_ID };

export async function createQuickSample(): Promise<OpenPixoHostProjectImportSuccess> {
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
  const draft = { ...emptyDraft(SAMPLE_TEMPLATE_ID), ...templateDraftDefaults(SAMPLE_TEMPLATE_ID), kickoff: false };
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

export function useQuickSample(onCreated?: (response: OpenPixoHostProjectImportSuccess) => Promise<void> | void) {
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState<{ error: unknown } | null>(null);
  const active = useRef(false);
  async function start() {
    if (active.current || !onCreated) return;
    active.current = true;
    setBusy(true);
    try { await onCreated(await createQuickSample()); }
    catch (error) { setFallback({ error }); }
    finally { active.current = false; setBusy(false); }
  }
  return { busy, start, fallback, closeFallback: () => setFallback(null) };
}
