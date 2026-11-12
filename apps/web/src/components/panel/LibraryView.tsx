import type { ReactNode } from 'react';
import type { ProjectFile } from '@openpixo/contracts';
import { useT } from '../../i18n';
import type { LibraryTypeRequest } from '../FilesPanel';
import { StudioPanel } from '../studio/StudioPanel';
import { useStudioPrefetch } from '../studio/useStudioPrefetch';
import { PanelSheet } from './PanelSheet';
import toolbar from './ViewToolbar.module.css';

export interface LibraryStudioState {
  /** The sheet is showing. */
  open: boolean;
  /** Recipe queued by a composer / home entry point, read once per project. */
  initialRecipeId: string | null;
  /** Reference images handed over by "generate from" on an asset. */
  referencePaths: string[];
}

/** What 资源库 hands its browser: the generator entry points and a one-shot type request. */
export interface LibraryBrowserProps {
  onGenerate: () => void;
  onGenerateFrom: (paths: string[]) => void;
  typeFilterRequest: LibraryTypeRequest | null;
}

/**
 * 资源库 view root (specs/current/openpixo-game-panel.md §6): the one file and
 * asset browser (`FilesPanel`, built by FileWorkspace, which owns upload /
 * delete / rename), and the recipe picker (`StudioPanel`) in a sheet over the
 * view for 生成素材… and "generate from".
 *
 * The browser mounts only while the view root shows: it listens for pasted
 * files on the window, so a hidden one would steal pastes from the other
 * views. Its folder, filter and search survive through FileWorkspace's nav
 * state; the list / grid choice through storage. The Studio sheet stays
 * mounted once opened, and its data is read ahead when the project opens so the
 * first click on Generate has something to show.
 */
export function LibraryView({
  projectId,
  files,
  viewerOnly,
  hidden,
  active,
  typeFilterRequest,
  renderBrowser,
  studio,
  onOpenStudio,
  onCloseStudio,
  onOpenFile,
  onRefreshFiles,
  onOpenExtensions,
  onOpenAccount,
}: {
  projectId: string;
  files: ProjectFile[];
  viewerOnly?: boolean;
  /** True while another view, or an item on this view's stack, is showing. */
  hidden: boolean;
  /** 资源库 is the current view (the Studio sheet shows only then). */
  active: boolean;
  /** "Open assets" from the checklist: show this type once. */
  typeFilterRequest: LibraryTypeRequest | null;
  renderBrowser: (library: LibraryBrowserProps) => ReactNode;
  studio: LibraryStudioState;
  onOpenStudio: (referencePaths?: string[]) => void;
  onCloseStudio: () => void;
  /** Open a file from inside 资源库: onto this view's stack. */
  onOpenFile: (name: string) => void;
  onRefreshFiles: () => Promise<void>;
  onOpenExtensions: () => void;
  onOpenAccount?: () => void;
}) {
  const t = useT();
  useStudioPrefetch(projectId);
  return (
    <>
      <div className={toolbar.view} hidden={hidden} data-testid="panel-library-view">
        {hidden ? null : renderBrowser({
          onGenerate: () => onOpenStudio([]),
          onGenerateFrom: (paths) => onOpenStudio(paths),
          typeFilterRequest,
        })}
      </div>
      <PanelSheet
        open={studio.open && active}
        title={t('studio.title')}
        onClose={onCloseStudio}
        testId="panel-studio-sheet"
      >
        <StudioPanel
          projectId={projectId}
          files={files}
          viewerOnly={viewerOnly}
          open={studio.open && active}
          initialRecipeId={studio.initialRecipeId}
          referencePaths={studio.referencePaths}
          onRefreshFiles={onRefreshFiles}
          onOpenExtensions={onOpenExtensions}
          onOpenFile={onOpenFile}
          onOpenAccount={onOpenAccount}
        />
      </PanelSheet>
    </>
  );
}
