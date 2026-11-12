import { useEffect, useRef, useState } from 'react';
import type { ProjectAsset } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { fetchAssetInfo } from '../../providers/project-assets';
import { fetchHostEditors, openProjectInEditor } from '../../providers/registry';
import { AssetDetailDrawer } from '../assets/AssetDetailDrawer';
import { AssetProcessingDialog } from '../assets/AssetProcessingDialog';
import { ImageEditorDialog } from '../image-editor/ImageEditorDialog';

// The asset actions of the former Assets gallery (GameAssetsPanel), on files
// of the one 资源库 browser: 素材详情, the image editor and batch processing.
// The browser lists files, not the asset index, so details and the editor
// first read the file's index record (dimensions, grid, tags) by path.

export function useLibraryAssetDialogs({
  projectId,
  viewerOnly,
  onRefreshFiles,
}: {
  projectId: string;
  viewerOnly: boolean;
  onRefreshFiles: () => Promise<void> | void;
}) {
  const { locale, t } = useI18n();
  const [detail, setDetail] = useState<ProjectAsset | null>(null);
  const [editing, setEditing] = useState<ProjectAsset | null>(null);
  const [processing, setProcessing] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    setDetail(null);
    setEditing(null);
    setProcessing(null);
  }, [projectId, viewerOnly]);

  function readAsset(path: string, then: (asset: ProjectAsset) => void) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError(null);
    void fetchAssetInfo(projectId, path, controller.signal).then((asset) => {
      if (!controller.signal.aborted) then(asset);
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setError(locale === 'zh-CN' || !(cause instanceof Error) ? t('gameAssets.loadFailed') : cause.message);
    });
  }

  async function openExternally(path: string) {
    if (viewerOnly) return;
    setError(null);
    try {
      const editors = await fetchHostEditors();
      const id = editors.platform === 'win32' ? 'explorer' : editors.platform === 'darwin' ? 'finder' : 'file-manager';
      if (!editors.editors.some((editor) => editor.id === id && editor.available)) throw new Error(t('gameAssets.noExternalApp'));
      await openProjectInEditor(projectId, id, path);
    } catch (cause) {
      setError(locale === 'zh-CN' || !(cause instanceof Error) ? t('gameAssets.openFailed') : cause.message);
    }
  }

  return {
    error,
    clearError: () => setError(null),
    showDetails: (path: string) => readAsset(path, setDetail),
    editImage: (path: string) => {
      if (!viewerOnly) readAsset(path, setEditing);
    },
    process: (paths: string[]) => {
      if (!viewerOnly && paths.length > 0) setProcessing(paths);
    },
    render({
      fileNames,
      onOpenFile,
      onAddToChat,
      onImageSaved,
    }: {
      fileNames: readonly string[];
      onOpenFile: (path: string) => void;
      onAddToChat?: (path: string) => void;
      onImageSaved: (asset: ProjectAsset) => void;
    }) {
      return (
        <>
          {detail ? (
            <AssetDetailDrawer
              key={`${projectId}:${detail.relPath}`}
              initial={detail}
              files={fileNames}
              viewerOnly={viewerOnly}
              onClose={() => setDetail(null)}
              onChanged={() => {}}
              onOpenFile={(path) => {
                setDetail(null);
                onOpenFile(path);
              }}
              onOpenExternal={(path) => void openExternally(path)}
              onEdit={(asset) => {
                setDetail(null);
                setEditing(asset);
              }}
              onAddToChat={onAddToChat ? (asset) => onAddToChat(asset.relPath) : undefined}
            />
          ) : null}
          {processing && !viewerOnly ? (
            <AssetProcessingDialog
              projectId={projectId}
              paths={processing}
              onClose={() => setProcessing(null)}
              onProcessed={async () => { await onRefreshFiles(); }}
            />
          ) : null}
          {editing && !viewerOnly ? (
            <ImageEditorDialog
              key={`${projectId}:${editing.relPath}`}
              asset={editing}
              onClose={() => setEditing(null)}
              onSaved={(asset) => {
                setEditing(null);
                onImageSaved(asset);
              }}
            />
          ) : null}
        </>
      );
    },
  };
}
