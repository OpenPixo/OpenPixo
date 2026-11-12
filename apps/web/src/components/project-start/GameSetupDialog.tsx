import { useState } from 'react';
import type { GameProjectSetup, GameProjectSetupResponse } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { GameSetupWizard } from '../new-game/GameSetupWizard';
import { saveGameSetup, uploadReferences } from '../new-game/game-setup-api';
import { draftToSetup, furthestReachableStep, setupToDraft, wizardSteps, type WizardDraft, type WizardReference, type WizardStepId } from '../new-game/wizard-state';

const EDIT_STEPS = wizardSteps('edit');
import styles from './GameSetupCard.module.css';

interface Props {
  projectId: string;
  setup: GameProjectSetup | null;
  /** Offered as the title when the setup has none yet. */
  projectName?: string;
  onClose: () => void;
  onSaved: (result: GameProjectSetupResponse) => void;
}

/**
 * The new-game wizard's setup steps for a project that was imported or made
 * from the CLI. It opens on the first unfinished step and keeps the
 * project's existing references.
 */
export function GameSetupDialog({ projectId, setup, projectName, onClose, onSaved }: Props) {
  const t = useT();
  const [draft, setDraft] = useState<WizardDraft>(() => {
    const start = setupToDraft(setup);
    return start.title || !projectName ? start : { ...start, title: projectName };
  });
  const [step, setStep] = useState<WizardStepId>(() => EDIT_STEPS[furthestReachableStep(setupToDraft(setup), { mode: 'edit' }, EDIT_STEPS)]!);
  const [references, setReferences] = useState<WizardReference[]>([]);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [failed, setFailed] = useState(false);
  const existing = setup?.art?.references ?? [];

  async function save() {
    setSaving(true);
    setFailed(false);
    try {
      const uploaded = references.length ? await uploadReferences(projectId, references) : { paths: [] };
      const result = await saveGameSetup(projectId, draftToSetup(draft, [...existing, ...uploaded.paths]));
      for (const reference of references) URL.revokeObjectURL(reference.url);
      onSaved(result);
      setClosing(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <GameSetupWizard
      title={t('game.setup.title')}
      context={{ mode: 'edit' }}
      steps={EDIT_STEPS}
      draft={draft}
      onDraftChange={setDraft}
      step={step}
      onStepChange={setStep}
      references={references}
      onReferencesChange={setReferences}
      summary={{ extraReferences: existing.length }}
      finishLabel={t('game.setup.save')}
      finishBusyLabel={t('game.setup.saving')}
      busy={saving || closing}
      error={failed ? <p className={styles.error} role="alert">{t('game.setup.saveFailed')}</p> : null}
      onFinish={() => void save()}
      closing={closing}
      onRequestClose={() => setClosing(true)}
      onClosed={onClose}
    />
  );
}
