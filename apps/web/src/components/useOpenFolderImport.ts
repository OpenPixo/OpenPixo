import { useCallback, useState } from 'react';
import {
  isOpenPixoHostAvailable,
  pickAndImportHostProject,
  type OpenPixoHostProjectImportSuccess,
} from '@openpixo/host';
import { useT } from '../i18n';
import { pickLocalFolderPath } from '../state/projects';


import { formatPickAndImportFailure } from '../utils/pickAndImportError';

interface UseOpenFolderImportArgs {
  skillId?: string | null;
  onImportFolder?: (baseDir: string) => Promise<void> | void;
  onImportFolderResponse?: (response: OpenPixoHostProjectImportSuccess) => Promise<void> | void;
}

export function useOpenFolderImport({
  skillId,
  onImportFolder,
  onImportFolderResponse,
}: UseOpenFolderImportArgs) {
  const t = useT();
  const workspaceContextState = { context: null, loading: false, identityChangePending: false, failure: undefined, pendingAccountGeneration: 0, requestToken: 0, resourceReadIdentity: null };
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const hasHostPickAndImport = isOpenPixoHostAvailable();
  const available = hasHostPickAndImport ? Boolean(onImportFolderResponse) : Boolean(onImportFolder);

  const openFolder = useCallback(async () => {
    if (hasHostPickAndImport) {
      if (!onImportFolderResponse) return;
      setError(null);
      setImporting(true);
      try {
        const result = await pickAndImportHostProject({
          skillId: skillId ?? null,

        });
        if (!result) return;
        if (result.ok === true) {
          await onImportFolderResponse(result);
          return;
        }
        if ('canceled' in result && result.canceled === true) return;
        setError(formatPickAndImportFailure(result, t('home.openFolderFailed')));
      } catch (err) {
        setError({
          message: t('home.openFolderFailed'),
          ...(err instanceof Error && err.message ? { details: err.message } : {}),
        });
      } finally {
        setImporting(false);
      }
      return;
    }

    if (!onImportFolder) return;
    setError(null);
    setImporting(true);
    try {
      const selectedPath = await pickLocalFolderPath();
      if (!selectedPath) return;
      await onImportFolder(selectedPath);
    } catch (err) {
      setError({
        message: t('home.openFolderFailed'),
        ...(err instanceof Error && err.message ? { details: err.message } : {}),
      });
    } finally {
      setImporting(false);
    }
  }, [
    hasHostPickAndImport,
    onImportFolder,
    onImportFolderResponse,
    skillId,
    t,
    workspaceContextState,
  ]);

  return {
    available,
    clearError: () => setError(null),
    error,
    importing,
    openFolder,
  };
}
