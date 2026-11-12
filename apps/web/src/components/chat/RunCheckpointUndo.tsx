import { useId, useRef, useState } from 'react';
import { Button, VisuallyHidden } from '@openpixo/components';
import { RotateCcw } from 'lucide-react';
import { useT } from '../../i18n';
import { CheckpointRestoreConfirm } from '../checkpoints/CheckpointRestoreConfirm';
import { useProjectCheckpoints } from '../checkpoints/useProjectCheckpoints';
import styles from './RunCheckpointUndo.module.css';

/** Only mounted on the last execution shell of a terminal physical run. */
export function RunCheckpointUndo({ projectId, runId }: { projectId: string; runId: string }) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const { data } = useProjectCheckpoints(projectId);
  const checkpoint = data?.status === 'available' ? data.checkpoints.find(item => item.runId === runId) : undefined;
  if (!checkpoint || data?.status !== 'available') return null;
  const noChanges = checkpoint.runChanges?.length === 0;
  return <>
    <Button ref={anchor} variant="ghost" size="sm" className={styles.action} disabled={data.busy || noChanges}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={popoverId}
      title={data.busy ? t('checkpoint.busy') : noChanges ? t('checkpoint.noChanges') : undefined}
      onClick={event => { event.preventDefault(); event.stopPropagation(); setRestored(false); setOpen(true); }}>
      <RotateCcw size={12} aria-hidden="true" />{t('checkpoint.undo')}
    </Button>
    {restored ? <VisuallyHidden role="status">{t('checkpoint.restored')}</VisuallyHidden> : null}
    <CheckpointRestoreConfirm projectId={projectId} checkpoint={checkpoint} open={open} anchor={anchor} popoverId={popoverId}
      onClose={() => setOpen(false)} onRestored={() => setRestored(true)} />
  </>;
}
