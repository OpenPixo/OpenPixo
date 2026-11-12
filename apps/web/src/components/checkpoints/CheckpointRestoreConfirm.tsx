import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from '@openpixo/components';
import type { GetProjectCheckpointResponse, ProjectCheckpoint } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { CheckpointRequestError, getProjectCheckpoint, restoreProjectCheckpoint } from './client';
import styles from './Checkpoints.module.css';

export function checkpointErrorKey(error: unknown) {
  const code = error instanceof CheckpointRequestError ? error.code : '';
  return code === 'CHECKPOINT_BUSY' ? 'checkpoint.busy' : code === 'CHECKPOINT_WORKTREE_CONFLICT' ? 'checkpoint.conflict' : 'checkpoint.failed';
}

export function CheckpointRestoreConfirm({ projectId, checkpoint, open, onClose, onRestored, anchor, popoverId }: {
  projectId: string; checkpoint: ProjectCheckpoint; open: boolean; onClose: () => void; onRestored?: () => void;
  anchor?: RefObject<HTMLElement>;
  popoverId?: string;
}) {
  const t = useT();
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<GetProjectCheckpointResponse | null>(null);
  const [error, setError] = useState<ReturnType<typeof checkpointErrorKey> | null>(null);
  const [saving, setSaving] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setPreview(null); setError(null);
    void getProjectCheckpoint(projectId, checkpoint.id, controller.signal).then(
      result => { if (!controller.signal.aborted) setPreview(result); },
      failure => { if (!controller.signal.aborted) setError(checkpointErrorKey(failure)); },
    );
    return () => controller.abort();
  }, [projectId, checkpoint.id, open]);
  useLayoutEffect(() => {
    if (!open || !anchor?.current) return;
    const place = () => {
      const rect = anchor.current!.getBoundingClientRect();
      const height = panel.current?.offsetHeight ?? 340;
      setPosition({ left: Math.max(12, Math.min(rect.right - 360, window.innerWidth - 372)),
        top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - height - 12)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchor, preview, error]);
  useEffect(() => {
    if (!open || !anchor) return;
    cancel.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!saving && !panel.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) { event.preventDefault(); onClose(); anchor.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, anchor, saving, onClose]);
  const restore = async () => {
    if (!preview || preview.busy || saving) return;
    setSaving(true); setError(null);
    try { await restoreProjectCheckpoint(projectId, checkpoint.id); onRestored?.(); onClose(); anchor?.current?.focus(); }
    catch (failure) { setError(checkpointErrorKey(failure)); }
    finally { setSaving(false); }
  };
  const content = <>
    <DialogHeader><DialogTitle id={id}>{t('checkpoint.restoreTitle')}</DialogTitle></DialogHeader>
    <DialogBody>
      <p>{t('checkpoint.restoreDescription')}</p>
      <p className={styles.summary}>{checkpoint.summary || t('checkpoint.noSummary')}</p>
      {!preview && !error ? <p role="status">{t('checkpoint.loading')}</p> : null}
      {preview ? <>
        <p>{t('checkpoint.files', { count: preview.currentChanges.length })}</p>
        <ul className={styles.files}>{preview.currentChanges.map(file => <li key={file.path}><code>{file.path}</code></li>)}</ul>
        {preview.currentChanges.length === 0 ? <p>{t('checkpoint.noChanges')}</p> : null}
        {preview.busy ? <p role="status">{t('checkpoint.busy')}</p> : null}
      </> : null}
      {error ? <p role="alert">{t(error)}</p> : null}
    </DialogBody>
    <DialogFooter>
      <Button ref={cancel} variant="ghost" disabled={saving} onClick={() => { onClose(); anchor?.current?.focus(); }}>{t('checkpoint.cancel')}</Button>
      <Button variant="danger" disabled={saving || !preview || preview.busy || preview.currentChanges.length === 0} onClick={() => void restore()}>{t('checkpoint.restore')}</Button>
    </DialogFooter>
  </>;
  if (!anchor) return <Dialog open={open} size="sm" role="alertdialog" ariaLabelledBy={id} onClose={onClose}
    closeOnBackdrop={!saving} closeOnEscape={!saving} initialFocusRef={cancel}>{content}</Dialog>;
  if (typeof document === 'undefined') return null;
  return createPortal(<div ref={panel} id={popoverId} role="dialog" aria-labelledby={id} aria-hidden={!open}
    data-open={open} className={styles.popover} style={position}>{content}</div>, document.body);
}
