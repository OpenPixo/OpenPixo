import type { ReactNode } from 'react';
import type { LibraryTypeRequest } from '../FilesPanel';
import toolbar from './ViewToolbar.module.css';

/** What 资源库 hands its browser: the generator entry points and a one-shot type request. */
export interface LibraryBrowserProps {
  onGenerate: () => void;
  onGenerateFrom: (paths: string[]) => void;
  typeFilterRequest: LibraryTypeRequest | null;
}

/**
 * 资源库 view root (specs/current/openpixo-game-panel.md §6): the one file and
 * asset browser (`FilesPanel`, built by FileWorkspace, which owns upload /
 * delete / rename). 生成素材… and "generate from" switch to the 生成 view
 * (specs/current/asset-generator.md §6.1), handing over the pictures picked.
 *
 * The browser mounts only while the view root shows: it listens for pasted
 * files on the window, so a hidden one would steal pastes from the other
 * views. Its folder, filter and search survive through FileWorkspace's nav
 * state; the list / grid choice through storage.
 */
export function LibraryView({
  hidden,
  typeFilterRequest,
  renderBrowser,
  onOpenStudio,
}: {
  /** True while another view, or an item on this view's stack, is showing. */
  hidden: boolean;
  /** "Open assets" from the checklist: show this type once. */
  typeFilterRequest: LibraryTypeRequest | null;
  renderBrowser: (library: LibraryBrowserProps) => ReactNode;
  /** Switch to 生成, with these pictures as references when given. */
  onOpenStudio: (referencePaths?: string[]) => void;
}) {
  return (
    <div className={toolbar.view} hidden={hidden} data-testid="panel-library-view">
      {hidden ? null : renderBrowser({
        onGenerate: () => onOpenStudio([]),
        onGenerateFrom: (paths) => onOpenStudio(paths),
        typeFilterRequest,
      })}
    </div>
  );
}
