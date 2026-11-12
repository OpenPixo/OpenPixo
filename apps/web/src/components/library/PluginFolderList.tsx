import { useMemo, useState } from 'react';
import type { ProjectFile } from '../../types';
import type { PluginFolderAgentAction } from '../files/pluginFolderActions';
import { getPluginFolderCandidates } from '../files/pluginFolders';
import { relativeTime, type TranslateFn } from './file-meta';

// Generated plugin folders and their agent actions (Add to My plugins /
// Publish repo). Moved out of FilesPanel; shown at the top of the project
// root listing instead of behind their own category tab.

export type PluginFolderActionHandler = (
  relativePath: string,
  action: PluginFolderAgentAction,
) => Promise<{ message?: string; url?: string } | void> | { message?: string; url?: string } | void;

interface ActionNotice {
  message: string;
  url?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The agent's reply, with a trailing copy of the URL folded into the link. */
export function buildActionNotice(message: string, url?: string): ActionNotice {
  const trimmedMessage = message.trim();
  const trimmedUrl = url?.trim();
  if (!trimmedUrl) return { message: trimmedMessage };
  const normalized = trimmedMessage.replace(new RegExp(`\\s*${escapeRegExp(trimmedUrl)}\\s*$`), '');
  return { message: normalized.trim() || trimmedUrl, url: trimmedUrl };
}

export function usePluginFolders(files: readonly ProjectFile[], hidden: ReadonlySet<string>) {
  return useMemo(
    () => getPluginFolderCandidates(files as ProjectFile[]).filter((folder) => !hidden.has(folder.path)),
    [files, hidden],
  );
}

export function PluginFolderList({
  folders,
  t,
  activePaths,
  onOpenFile,
  onAction,
}: {
  folders: ReturnType<typeof usePluginFolders>;
  t: TranslateFn;
  activePaths: ReadonlySet<string>;
  onOpenFile: (name: string) => void;
  onAction?: PluginFolderActionHandler;
}) {
  const [installing, setInstalling] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  if (folders.length === 0) return null;

  async function runAction(relativePath: string, action: PluginFolderAgentAction) {
    if (!onAction || installing || sharing) return;
    setNotice(null);
    if (action === 'install') setInstalling(relativePath);
    else setSharing(`${action}:${relativePath}`);
    try {
      const outcome = await onAction(relativePath, action);
      const url = outcome && typeof outcome.url === 'string' ? outcome.url : '';
      const message = outcome && typeof outcome.message === 'string' ? outcome.message : '';
      if (message || url) setNotice(buildActionNotice(message || url, url));
    } catch (error) {
      console.warn('[PluginFolderList] action failed:', error);
      setNotice({ message: t('filesPanel.pluginFolder.failed') });
    } finally {
      setInstalling(null);
      setSharing(null);
    }
  }

  return (
    <div className="df-section" data-testid="library-plugin-folders">
      {notice ? (
        <div className="df-inline-notice" role="status">
          <span>{notice.message}</span>
          {notice.url ? (
            <>
              {' '}
              <a href={notice.url} target="_blank" rel="noreferrer">{notice.url}</a>
            </>
          ) : null}
        </div>
      ) : null}
      {folders.map((folder) => {
        const busy = activePaths.has(folder.path) || installing !== null || sharing !== null;
        return (
          <div key={folder.path} className="df-row df-row-plugin-folder" data-testid={`design-plugin-folder-${folder.path}`}>
            <button type="button" className="df-row-folder-main" onClick={() => onOpenFile(folder.manifestPath)}>
              <span className="df-row-icon" data-kind="folder" aria-hidden>DIR</span>
              <span className="df-row-name-wrap">
                <span className="df-row-name">{folder.path}</span>
                <span className="df-row-sub">{t('filesPanel.pluginFolder.ready', { n: folder.fileCount })}</span>
              </span>
            </button>
            <span className="df-row-time">{relativeTime(folder.updatedAt, t)}</span>
            {onAction ? (
              <div className="df-plugin-actions">
                <button
                  type="button"
                  className="df-plugin-install"
                  data-testid={`design-plugin-folder-install-${folder.path}`}
                  disabled={busy}
                  onClick={() => void runAction(folder.path, 'install')}
                >
                  {t(installing === folder.path ? 'filesPanel.pluginFolder.sending' : 'filesPanel.pluginFolder.install')}
                </button>
                <button
                  type="button"
                  className="df-plugin-install"
                  data-testid={`design-plugin-folder-publish-${folder.path}`}
                  disabled={busy}
                  onClick={() => void runAction(folder.path, 'publish')}
                >
                  {t(sharing === `publish:${folder.path}` ? 'filesPanel.pluginFolder.sending' : 'filesPanel.pluginFolder.publish')}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
