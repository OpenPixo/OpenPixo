import { Icon } from '../Icon';
import type { TranslateFn } from './file-meta';

export interface SelectionActions {
  /** Absent for read-only viewers. */
  addToChat?: () => void;
  /** At least one image selected and the generator is reachable. */
  generateFrom?: () => void;
  /** Exactly one image selected. */
  editImage?: () => void;
  /** Every selected file is image / audio / video. */
  process?: () => void;
  download: () => void;
  delete?: () => void;
  deleting: boolean;
  clear: () => void;
}

/**
 * The multi-select bar: what the current selection can do, and nothing else.
 * File actions (add to chat, download, delete) and the asset actions of the
 * old Assets gallery (generate from, edit, processing) share one bar.
 */
export function SelectionBar({ count, actions, t }: { count: number; actions: SelectionActions; t: TranslateFn }) {
  return (
    <div className="df-batch-bar" data-testid="file-list-batch-bar">
      <span className="df-batch-count">{t('filesPanel.selectedCount', { n: count })}</span>
      <div className="df-batch-actions">
        {actions.addToChat ? (
          <button type="button" className="df-batch-primary" data-testid="file-list-batch-add-to-chat" onClick={actions.addToChat}>
            <Icon name="attach" size={13} />
            <span>{t('filesPanel.addSelectedToChat', { n: count })}</span>
          </button>
        ) : null}
        {actions.generateFrom ? (
          <button type="button" data-testid="file-list-batch-generate-from" onClick={actions.generateFrom}>
            <Icon name="sparkles" size={13} />
            <span>{t('gameAssets.generateFrom')}</span>
          </button>
        ) : null}
        {actions.editImage ? (
          <button type="button" data-testid="file-list-batch-edit-image" onClick={actions.editImage}>
            <Icon name="crop" size={13} />
            <span>{t('imageEditor.title')}</span>
          </button>
        ) : null}
        {actions.process ? (
          <button type="button" data-testid="file-list-batch-process" onClick={actions.process}>
            <Icon name="sliders" size={13} />
            <span>{t('gameAssets.process')}</span>
          </button>
        ) : null}
        <button type="button" onClick={actions.download} title={t('filesPanel.downloadSelected', { n: count })}>
          <Icon name="download" size={13} />
          <span>{t('filesPanel.download')}</span>
        </button>
        {actions.delete ? (
          <button
            type="button"
            className="danger"
            data-testid="file-list-batch-delete"
            disabled={actions.deleting}
            onClick={actions.delete}
            title={t('filesPanel.deleteSelected', { n: count })}
          >
            <span>{t('filesPanel.delete')}</span>
          </button>
        ) : null}
        <button type="button" className="df-batch-clear" onClick={actions.clear}>
          {t('filesPanel.clearSelection')}
        </button>
      </div>
    </div>
  );
}

/** POST the selection to the archive endpoint and save the ZIP it returns. */
export async function downloadProjectFilesZip(projectId: string, files: readonly string[]): Promise<void> {
  if (files.length === 0) return;
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/archive/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.message || `request failed (${response.status})`);
    }
    const blob = await response.blob();
    const header = response.headers.get('content-disposition') || '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
    let filename = 'project.zip';
    if (star?.[1]) {
      try {
        filename = decodeURIComponent(star[1]);
      } catch {
        filename = star[1];
      }
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    console.warn('[batchDownload] failed:', error);
    throw error;
  }
}
