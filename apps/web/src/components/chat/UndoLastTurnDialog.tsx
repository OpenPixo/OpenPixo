import { useState } from 'react';
import { ConfirmDialog } from '@openpixo/components';
import type { ProjectCheckpoint } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { restoreProjectCheckpoint } from '../checkpoints/client';

/**
 * `/undo`: puts the project's files back to how they were before the last
 * reply, the same restore as that turn's Undo button. The conversation is left
 * as it is, and the restore keeps a snapshot of the files it replaced, so the
 * Changes history can bring them back.
 */
export function UndoLastTurnDialog({ projectId, checkpoint, onClose, onRestored }: {
  projectId: string;
  /** The checkpoint taken when the last reply's first run started; null keeps the dialog closed. */
  checkpoint: ProjectCheckpoint | null;
  onClose: () => void;
  onRestored: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function confirm() {
    if (!checkpoint || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await restoreProjectCheckpoint(projectId, checkpoint.id);
      onRestored();
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmDialog
      open={checkpoint !== null}
      title={t('chat.undoLastTitle')}
      confirmLabel={t('chat.undoLastConfirm')}
      cancelLabel={t('chat.editCancel')}
      busy={busy}
      onConfirm={() => void confirm()}
      onCancel={onClose}
      onAfterClose={() => setFailed(false)}
    >
      <p>{t('chat.undoLastBody')}</p>
      {failed ? <p role="alert">{t('chat.undoLastFailed')}</p> : null}
    </ConfirmDialog>
  );
}
