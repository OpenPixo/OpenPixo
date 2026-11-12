import { useEffect, useId, useRef, useState } from 'react';
import { Button, ConfirmDialog, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from '@openpixo/components';
import type { CheckpointUnavailableReason, ProjectCheckpoint } from '@openpixo/contracts';
import { History } from 'lucide-react';
import { useI18n, useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { CHECKPOINT_RESTORED, enableProjectCheckpoints } from './client';
import { CheckpointRestoreConfirm, checkpointErrorKey } from './CheckpointRestoreConfirm';
import { useProjectCheckpoints } from './useProjectCheckpoints';
import styles from './Checkpoints.module.css';

const reasons: Record<CheckpointUnavailableReason, keyof Dict> = {
  not_git: 'checkpoint.notGit', git_unavailable: 'checkpoint.gitUnavailable', not_project_root: 'checkpoint.notProjectRoot',
  unsupported_repository: 'checkpoint.unsupported', repository_unavailable: 'checkpoint.unavailable', project_too_large: 'checkpoint.tooLarge',
};

function relativeTime(createdAt: string, locale: string): string {
  const seconds = Math.min(0, Math.round((new Date(createdAt).getTime() - Date.now()) / 1_000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds > -60) return formatter.format(seconds, 'second');
  if (seconds > -3_600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (seconds > -86_400) return formatter.format(Math.round(seconds / 3_600), 'hour');
  return formatter.format(Math.round(seconds / 86_400), 'day');
}

export function ProjectCheckpointHistory({ projectId, disabled = false, onRestored }: {
  projectId: string; disabled?: boolean; onRestored?: () => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ProjectCheckpoint | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ReturnType<typeof checkpointErrorKey> | null>(null);
  const { data, failed } = useProjectCheckpoints(projectId, open);
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;
  useEffect(() => {
    const restored = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail.projectId === projectId) onRestoredRef.current?.();
    };
    window.addEventListener(CHECKPOINT_RESTORED, restored);
    return () => window.removeEventListener(CHECKPOINT_RESTORED, restored);
  }, [projectId]);
  const enable = async () => {
    setSaving(true); setError(null);
    try { await enableProjectCheckpoints(projectId); setConfirmEnable(false); }
    catch (failure) { setError(checkpointErrorKey(failure)); }
    finally { setSaving(false); }
  };
  return <>
    {/* Icon-only in the panel header (specs/current/openpixo-ui-cleanup.md §3). */}
    <Button variant="ghost" size="icon" className="pixo-tooltip" disabled={disabled} onClick={() => setOpen(true)}
      aria-label={t('checkpoint.history')} data-tooltip={t('checkpoint.history')} data-tooltip-placement="bottom"><History size={15} aria-hidden="true" /></Button>
    <Dialog open={open} onClose={() => { setOpen(false); setRestoreOpen(false); setConfirmEnable(false); }} ariaLabelledBy={id} size="md">
      <DialogHeader><DialogTitle id={id}>{t('checkpoint.history')}</DialogTitle></DialogHeader>
      <DialogBody>
        <p className={styles.detail}>{t('checkpoint.retention')}</p>
        {!data && !failed ? <p role="status">{t('checkpoint.loading')}</p> : null}
        {failed || error ? <p role="alert">{t(error ?? 'checkpoint.failed')}</p> : null}
        {data?.status === 'unavailable' ? <>
          <p>{t(reasons[data.reason])}</p>
          {data.reason === 'not_git' ? <Button onClick={() => { setError(null); setConfirmEnable(true); }}>{t('checkpoint.enable')}</Button> : null}
        </> : null}
        {data?.status === 'available' ? <>
          {data.busy ? <p role="status">{t('checkpoint.busy')}</p> : null}
          {data.checkpoints.length === 0 ? <p>{t('checkpoint.empty')}</p> : null}
          <ol className={styles.history}>{data.checkpoints.map(checkpoint => <li key={checkpoint.id}>
            <div className={styles.entry}>
              <strong>{checkpoint.kind === 'before_restore' ? `${t('checkpoint.beforeRestore')} · ` : ''}{checkpoint.summary || t('checkpoint.noSummary')}</strong>
              <time dateTime={checkpoint.createdAt} title={new Date(checkpoint.createdAt).toLocaleString(locale)}>{relativeTime(checkpoint.createdAt, locale)}</time>
              <span>{t('checkpoint.changedSincePrevious', { count: checkpoint.changedFileCount })}</span>
              {checkpoint.runChanges ? <span>{t('checkpoint.runChanges', { count: checkpoint.runChanges.length })}</span> : null}
            </div>
            <Button variant="ghost" size="sm" disabled={data.busy} onClick={() => { setSelected(checkpoint); setRestoreOpen(true); }}>{t('checkpoint.restore')}</Button>
          </li>)}</ol>
        </> : null}
      </DialogBody>
      <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>{t('checkpoint.close')}</Button></DialogFooter>
      <ConfirmDialog open={confirmEnable} title={t('checkpoint.enableTitle')} confirmLabel={t('checkpoint.enable')}
        cancelLabel={t('checkpoint.cancel')} busy={saving} onConfirm={() => void enable()} onCancel={() => { setConfirmEnable(false); setError(null); }}>
        <p>{t('checkpoint.enableDescription')}</p>{error ? <p role="alert">{t(error)}</p> : null}
      </ConfirmDialog>
      {selected ? <CheckpointRestoreConfirm projectId={projectId} checkpoint={selected} open={open && restoreOpen} onClose={() => setRestoreOpen(false)} /> : null}
    </Dialog>
  </>;
}
