import { useRef } from 'react';
import { ConfirmDialog } from '@openpixo/components';
import { useT } from '../../i18n';

export function ProjectDeleteConfirmDialog({
  projectName,
  keepsFolder = false,
  pending,
  failed,
  errorCode,
  onCancel,
  onConfirm,
}: {
  projectName: string | null;
  /** Imported from a folder (`metadata.baseDir`): the daemon only forgets the
   *  project, so the dialog must not read as deleting the user's files. */
  keepsFolder?: boolean;
  pending: boolean;
  failed: boolean;
  /** The daemon's error code. Raw error text (a Windows `EPERM: rename …`) means
   *  nothing to the user, so only known codes get their own sentence. */
  errorCode?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  // Both keep their last value through the exit transition.
  const last = useRef({ name: projectName, keepsFolder });
  if (projectName !== null) last.current = { name: projectName, keepsFolder };
  const removing = last.current.keepsFolder;
  const name = last.current.name ?? '';
  return <ConfirmDialog open={projectName !== null} title={t(removing ? 'designs.removeTitle' : 'designs.deleteTitle')} busy={pending} destructive
    confirmLabel={t(removing ? 'designs.removeAction' : 'designs.menuDelete')} cancelLabel={t('designs.renameCancel')} onCancel={onCancel} onConfirm={onConfirm}>
    <p>{t(removing ? 'designs.removeConfirm' : 'designs.deleteConfirm', { name })}</p>
    {failed && <p role="alert">{t(errorCode === 'PROJECT_FILES_IN_USE' ? 'designs.deleteFilesInUse' : 'ds.actionFailed')}</p>}
  </ConfirmDialog>;
}
