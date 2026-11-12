import { useCallback, useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react';
import { Button } from '@openpixo/components';
import type { ProjectAsset } from '@openpixo/contracts';
import type { TrackingProjectKind } from '@openpixo/contracts/analytics';
import { trackFileManagerClick } from '../analytics/events';
import { useAnalytics } from '../analytics/provider';
import { useT } from '../i18n';
import { copyToClipboard } from '../lib/copy-to-clipboard';
import { dragSelection } from '../runtime/chat/project-file-reference';
import type { RunProgressStep } from '../runtime/run-progress';
import type { ProjectFile, ProjectFileKind, ProjectFolder } from '../types';
import { selectBuildPreviewHtmlEntry } from './auto-open-file';
import { addProjectFilesToChat, setProjectFileDragData } from './files/add-to-chat';
import { BuildPreviewToggle } from './files/BuildPreviewToggle';
import { projectFileKind } from './files/file-kind';
import { FileListBuildingState } from './files/FileListBuildingState';
import { FileListSkeleton } from './files/FileListSkeleton';
import type { PluginFolderAgentAction } from './files/pluginFolderActions';
import { absoluteProjectFilePath } from './files/project-file-path';
import { Icon } from './Icon';
import { EntryMenu, entryMenuItemCount, menuPositionAtPointer, menuPositionForAnchor, type EntryMenuActions, type EntryMenuPosition } from './library/EntryMenu';
import type { EntryContext, RenameState } from './library/entry-controls';
import { DirCard, FileCard } from './library/LibraryCards';
import { useLibraryAssetDialogs } from './library/LibraryAssetDialogs';
import { LibraryFilterBar } from './library/LibraryFilterBar';
import { DirRow, FileRow } from './library/LibraryRows';
import {
  GenerateAssetsButton,
  LibraryBreadcrumbs,
  LibraryLayoutToggle,
  LibraryProjectMenu,
  LibraryToolbar,
} from './library/LibraryToolbar';
import {
  descendantFileCounts,
  isMediaFile,
  libraryListing,
  libraryTypeCounts,
  nearestExistingDir,
  relativeToDir,
  type LibraryTypeFilter,
} from './library/library-entries';
import { readLibraryLayout, writeLibraryLayout, type LibraryLayout } from './library/library-layout';
import { PluginFolderList, usePluginFolders } from './library/PluginFolderList';
import { downloadProjectFilesZip, SelectionBar } from './library/SelectionBar';
import { useIncrementalRender } from './library/useIncrementalRender';
import { useClipboardFileUpload, useFileDropZone } from './library/useLibraryUpload';
import styles from './library/Library.module.css';
import { Toast } from './Toast';

export interface FilesNavState {
  /** Unused since the 资源库 merge; kept so saved shapes stay assignable. */
  kindFilter: Set<ProjectFileKind>;
  currentDir: string;
  page: number;
  pageSize: number | 'all';
  /** 资源库 type filter (default 全部). */
  typeFilter?: LibraryTypeFilter;
  /** 资源库 path search. */
  query?: string;
  /** Last `typeFilterRequest` applied, so a remount does not re-apply it. */
  appliedRequestNonce?: number;
}

/** A one-shot "show this type" request (the checklist's "open assets" → 图片). */
export interface LibraryTypeRequest {
  type: LibraryTypeFilter;
  nonce: number;
}

interface Props {
  projectId: string;
  projectKind: TrackingProjectKind;
  filesRefreshKey?: number;
  /** Read-only viewer of a team-shared project: disables project mutations. */
  viewerOnly?: boolean;
  /**
   * True while a non-owner member's local mirror has not yet caught up to the
   * project's published head. Existing files belong to the last complete
   * local materialization and remain useful while the next version downloads;
   * only an empty local result swaps the creation CTAs for a syncing notice.
   */
  downloadPending?: boolean;
  /**
   * Whether `files` reflects a file list the daemon actually returned. Zero
   * files before the first authoritative read is indistinguishable from a
   * genuinely empty project, and the empty-state CTAs create NEW content --
   * offering them to someone whose project does have files is the same class
   * of mistake the `downloadPending` branch below already guards (OPEND-2283).
   */
  filesAuthoritative?: boolean;
  /**
   * Before the first authoritative read, draw the empty state instead of
   * "Loading…" -- inert, so none of its CTAs can act on a guess. For a project
   * the Home send just created, whose hand-off frame already showed this empty
   * state (OPEND-3334): flipping to "Loading…" and back reads as a jump.
   */
  emptyLookBeforeFirstListing?: boolean;
  /** Basename of the project's working directory, shown as the root crumb. */
  rootDirName?: string;
  resolvedDir?: string | null;
  /** True while the host is reindexing a freshly replaced working dir. */
  reloading?: boolean;
  /**
   * True while a run of this conversation is genuinely in flight. A run that
   * has already written a page is shown taking shape.
   */
  running?: boolean;
  /** Active turn start, used to exclude pages left over from earlier runs. */
  runStartedAt?: number | null;
  /** The running turn's tool calls, newest first (the building preview's step feed). */
  runSteps?: RunProgressStep[];
  files: ProjectFile[];
  /** Persisted folders, including empty ones no file lives under. */
  folders?: ProjectFolder[];
  onRefreshFiles: () => Promise<void> | void;
  onOpenFile: (name: string) => void;
  onRenameFile: (from: string, to: string) => Promise<ProjectFile | null> | ProjectFile | null;
  onDeleteFile: (name: string) => void;
  onDeleteFiles: (names: string[]) => Promise<void> | void;
  onUpload: () => void;
  onUploadFiles: (files: File[]) => void;
  /** Historical name: creates a new blank Markdown document. */
  onPaste: () => void;
  onDuplicateProject?: () => void;
  duplicateProjectBusy?: boolean;
  /** The folder being viewed, so uploads / new documents land in it. */
  onCurrentDirChange?: (dir: string) => void;
  uploadError?: string | null;
  onClearUploadError?: () => void;
  onPluginFolderAgentAction?: (
    relativePath: string,
    action: PluginFolderAgentAction,
  ) => Promise<{ message?: string; url?: string } | void> | { message?: string; url?: string } | void;
  activePluginActionPaths?: Set<string>;
  hiddenPluginActionPaths?: Set<string>;
  navState?: FilesNavState;
  onNavStateChange?: (state: FilesNavState) => void;
  /** 生成素材…: opens the generator sheet (given by the 资源库 view). */
  onGenerate?: () => void;
  /** "Generate from this": the generator sheet with these images as references. */
  onGenerateFrom?: (paths: string[]) => void;
  typeFilterRequest?: LibraryTypeRequest | null;
}

const NO_PATHS: ReadonlySet<string> = new Set();
const LIST_RENDER_BATCH = 200;
const GRID_RENDER_BATCH = 48;

// React 18's DOM runtime drops the boolean `inert` attribute; set it on the
// node so keyboard focus is blocked as well as pointer interaction.
const makeInert = (node: HTMLElement | null) => {
  node?.setAttribute('inert', '');
};

/**
 * The 资源库 browser (specs/current/openpixo-game-panel.md §6): one browser
 * for the project's files and assets. List or grid (remembered per project),
 * type filter, path search and breadcrumbs; image / audio entries carry the
 * asset actions of the former Assets gallery. Every open goes through
 * `onOpenFile`, which pushes onto the 资源库 stack.
 *
 * The pieces live in `components/library/`: listing rules
 * (`library-entries`), rows, cards, toolbar, filter row, entry menu,
 * selection bar, plugin folders, upload / paste and the asset dialogs. This
 * component owns the state that ties them together.
 */
export function FilesPanel({
  projectId,
  projectKind,
  filesRefreshKey = 0,
  viewerOnly = false,
  downloadPending = false,
  filesAuthoritative = true,
  emptyLookBeforeFirstListing = false,
  rootDirName,
  resolvedDir,
  reloading,
  running = false,
  runStartedAt,
  runSteps,
  files,
  folders,
  onRefreshFiles,
  onOpenFile,
  onRenameFile,
  onDeleteFile,
  onDeleteFiles,
  onUpload,
  onUploadFiles,
  onPaste,
  onDuplicateProject,
  duplicateProjectBusy = false,
  uploadError = null,
  onClearUploadError,
  onCurrentDirChange,
  onPluginFolderAgentAction,
  activePluginActionPaths = NO_PATHS as Set<string>,
  hiddenPluginActionPaths = NO_PATHS as Set<string>,
  navState,
  onNavStateChange,
  onGenerate,
  onGenerateFrom,
  typeFilterRequest,
}: Props) {
  const t = useT();
  const analytics = useAnalytics();
  const track = (element: Parameters<typeof trackFileManagerClick>[1]['element']) => trackFileManagerClick(analytics.track, {
    page_name: 'file_manager',
    area: 'file_manager',
    element,
    project_id: projectId,
    project_kind: projectKind,
  });

  // ---- Where the browser is and how it looks ---------------------------
  const [layout, setLayoutState] = useState<LibraryLayout>(() => readLibraryLayout(projectId));
  const setLayout = (next: LibraryLayout) => {
    setLayoutState(next);
    writeLibraryLayout(projectId, next);
  };
  const [currentDir, setCurrentDir] = useState<string>(() => navState?.currentDir ?? '');
  const [typeFilter, setTypeFilter] = useState<LibraryTypeFilter>(() => navState?.typeFilter ?? 'all');
  const [query, setQuery] = useState(() => navState?.query ?? '');
  const [appliedRequestNonce, setAppliedRequestNonce] = useState(() => navState?.appliedRequestNonce ?? 0);

  // A request applies once: the browser remounts every time 资源库's root
  // shows again, and must not snap back to the requested type each time.
  const requestNonce = typeFilterRequest?.nonce ?? 0;
  useEffect(() => {
    if (!typeFilterRequest || typeFilterRequest.nonce === appliedRequestNonce) return;
    setTypeFilter(typeFilterRequest.type);
    setQuery('');
    setAppliedRequestNonce(typeFilterRequest.nonce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestNonce]);

  useEffect(() => {
    onCurrentDirChange?.(currentDir);
  }, [currentDir, onCurrentDirChange]);

  const savedKindFilter = navState?.kindFilter;
  useEffect(() => {
    onNavStateChange?.({
      kindFilter: savedKindFilter ?? new Set(),
      currentDir,
      page: 0,
      pageSize: 30,
      typeFilter,
      query,
      appliedRequestNonce,
    });
  }, [currentDir, typeFilter, query, appliedRequestNonce, savedKindFilter, onNavStateChange]);

  // ---- Selection, rename, menu, notices --------------------------------
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<RenameState | null>(null);
  const [menu, setMenu] = useState<EntryMenuPosition | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  /** Move to another folder level; each level has its own selection. */
  const openDir = useCallback((dir: string) => {
    setCurrentDir(dir);
    setSelected(new Set());
    setRenaming(null);
    setMenu(null);
  }, []);

  // Deleting the last file of a folder lands on the nearest folder left.
  useEffect(() => {
    if (currentDir === '') return;
    const existing = nearestExistingDir(currentDir, files, folders);
    if (existing !== currentDir) openDir(existing);
  }, [files, folders, currentDir, openDir]);

  // Prune selections that no longer exist (refresh / delete within the
  // project; the parent remounts the browser per project).
  useEffect(() => {
    setSelected((previous) => {
      if (previous.size === 0) return previous;
      const names = new Set(files.map((file) => file.name));
      const next = new Set([...previous].filter((name) => names.has(name)));
      return next.size === previous.size ? previous : next;
    });
  }, [files]);

  // ---- The run's building preview --------------------------------------
  // The page the run is currently building, if it has produced one. Only HTML
  // qualifies: there is nothing to watch take shape in a markdown file or an
  // image, and swapping the preview for one mid-run would be a downgrade.
  const buildPreviewFile = useMemo(() => {
    if (!running || !runStartedAt || !Number.isFinite(runStartedAt)) return null;
    const name = selectBuildPreviewHtmlEntry(files.filter((file) => file.mtime >= runStartedAt));
    return name ? files.find((file) => file.name === name) ?? null : null;
  }, [running, runStartedAt, files]);
  // A long run must not trap the user away from their files: the toolbar's
  // preview switch flips this both ways; it resets when the next run starts.
  const [buildPreviewDismissed, setBuildPreviewDismissed] = useState(false);
  useEffect(() => {
    if (running) setBuildPreviewDismissed(false);
  }, [running]);
  const showingBuildPreview = Boolean(buildPreviewFile && running && !buildPreviewDismissed);

  // ---- Upload / paste / drop ---------------------------------------------
  const drop = useFileDropZone({ disabled: viewerOnly, onUploadFiles });
  const clearDropError = drop.clearReadError;
  const beforePasteUpload = useCallback(() => {
    clearDropError();
    onClearUploadError?.();
  }, [clearDropError, onClearUploadError]);
  useClipboardFileUpload(onUploadFiles, beforePasteUpload);

  // ---- Asset actions ------------------------------------------------------
  const assets = useLibraryAssetDialogs({ projectId, viewerOnly, onRefreshFiles });

  // ---- What is listed ----------------------------------------------------
  const listing = useMemo(
    () => libraryListing({ files, folders, currentDir, type: typeFilter, query }),
    [files, folders, currentDir, typeFilter, query],
  );
  const counts = useMemo(() => libraryTypeCounts(files, currentDir), [files, currentDir]);
  const dirCounts = useMemo(() => descendantFileCounts(files), [files]);
  const pluginFolders = usePluginFolders(files, hiddenPluginActionPaths);
  const showPluginFolders = !listing.flat && currentDir === '' && pluginFolders.length > 0;
  const filesByName = useMemo(() => new Map(files.map((file) => [file.name, file])), [files]);
  const incremental = useIncrementalRender(
    layout === 'grid' ? GRID_RENDER_BATCH : LIST_RENDER_BATCH,
    `${layout}\u0000${currentDir}\u0000${typeFilter}\u0000${query}`,
  );

  // ---- Actions ---------------------------------------------------------------
  function toggleSelect(name: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function addToChat(names: readonly string[]) {
    setMenu(null);
    const outcome = addProjectFilesToChat(names, files);
    if (outcome.kind === 'empty') return;
    setNotice(outcome.kind === 'added'
      ? { message: t('filesPanel.addedToChat', { n: outcome.count }), tone: 'success' }
      : { message: t('filesPanel.noChatOpen'), tone: 'error' });
    if (outcome.kind === 'added' && names.length > 1) setSelected(new Set());
  }

  async function copyFilePath(name: string, absolute: boolean) {
    const file = filesByName.get(name);
    const path = file && absolute ? absoluteProjectFilePath(file, resolvedDir) : file?.name;
    if (!path) return;
    const copied = await copyToClipboard(path);
    setNotice({ message: t(copied ? 'filesPanel.pathCopied' : 'filesPanel.pathCopyFailed'), tone: copied ? 'success' : 'error' });
  }

  function startRename(name: string) {
    setMenu(null);
    setRenaming({ name, draft: relativeToDir(name, currentDir), saving: false });
  }

  async function commitRename(name: string, draft: string) {
    const nextBasename = draft.trim();
    const nextName = currentDir === '' ? nextBasename : `${currentDir}/${nextBasename}`;
    if (!nextBasename || nextName === name) {
      setRenaming(null);
      return;
    }
    setRenaming({ name, draft, saving: true });
    try {
      const renamed = await onRenameFile(name, nextName);
      if (!renamed) throw new Error('Rename failed');
      setSelected((previous) => {
        if (!previous.has(name)) return previous;
        const next = new Set(previous);
        next.delete(name);
        next.add(renamed.name);
        return next;
      });
      setRenaming(null);
    } catch (error) {
      console.warn('[FilesPanel] rename failed:', error);
      setNotice({ message: t('filesPanel.renameFailed'), tone: 'error' });
      setRenaming({ name, draft, saving: false });
    }
  }

  async function deleteSelection() {
    if (deleting || selected.size === 0) return;
    setDeleting(true);
    try {
      // Selection is kept: a cancelled confirm or a failed delete leaves it for
      // a retry, and the prune effect drops names that did go.
      await onDeleteFiles([...selected]);
    } finally {
      setDeleting(false);
    }
  }

  function imageSaved(asset: ProjectAsset) {
    // Reveal the saved derivative: search for it and select it once listed.
    // A derivative outside the folder being browsed is searched from the root.
    const inside = currentDir === '' || asset.relPath.startsWith(`${currentDir}/`);
    void Promise.resolve(onRefreshFiles()).finally(() => {
      if (!inside) setCurrentDir('');
      setTypeFilter('all');
      setQuery(inside ? relativeToDir(asset.relPath, currentDir) : asset.relPath);
      setSelected(new Set([asset.relPath]));
    });
  }

  function menuActions(name: string): EntryMenuActions {
    const file = filesByName.get(name);
    const kind = file ? projectFileKind(file) : 'binary';
    const media = file ? isMediaFile(file) : false;
    const multi = selected.has(name) && selected.size > 1;
    return {
      addToChat: viewerOnly ? undefined : {
        label: multi ? t('filesPanel.addSelectedToChat', { n: selected.size }) : t('filesPanel.addToChat'),
        // The menu of a selected file adds the whole selection.
        run: () => addToChat(dragSelection(name, selected)),
      },
      open: () => onOpenFile(name),
      details: media ? () => assets.showDetails(name) : undefined,
      generateFrom: kind === 'image' && onGenerateFrom && !viewerOnly ? () => onGenerateFrom([name]) : undefined,
      editImage: kind === 'image' && !viewerOnly ? () => assets.editImage(name) : undefined,
      rename: viewerOnly ? undefined : () => startRename(name),
      copyRelativePath: () => void copyFilePath(name, false),
      copyAbsolutePath: file && absoluteProjectFilePath(file, resolvedDir) ? () => void copyFilePath(name, true) : undefined,
      delete: viewerOnly ? undefined : () => onDeleteFile(name),
    };
  }

  const ctx: EntryContext = {
    projectId,
    currentDir,
    flat: listing.flat,
    viewerOnly,
    filesRefreshKey,
    selected,
    renaming,
    t,
    onOpen: onOpenFile,
    onOpenDir: openDir,
    onToggleSelect: toggleSelect,
    onMenu: (name, anchor) => setMenu(menuPositionForAnchor(name, anchor, entryMenuItemCount(menuActions(name)))),
    onContextMenu: (event: MouseEvent<HTMLElement>, name) => {
      event.preventDefault();
      setMenu(menuPositionAtPointer(name, event.clientX, event.clientY, entryMenuItemCount(menuActions(name))));
    },
    // Dragging one of several selected files carries the whole selection.
    onDragStart: (event: DragEvent<HTMLElement>, file) =>
      setProjectFileDragData(event.dataTransfer, projectId, dragSelection(file.name, selected)),
    onAddToChat: addToChat,
    onStartRename: startRename,
    onRenameDraft: setRenaming,
    onCommitRename: (name, draft) => void commitRename(name, draft),
    onCancelRename: () => setRenaming(null),
  };

  const selectedFiles = [...selected].flatMap((name) => filesByName.get(name) ?? []);
  const selectedImages = selectedFiles.filter((file) => projectFileKind(file) === 'image');
  const singleImage = selectedFiles.length === 1 && selectedImages.length === 1 ? selectedImages[0]! : null;

  // ---- Rendering -----------------------------------------------------------
  const visibleUploadError = uploadError ?? drop.readError;
  const hasSelection = selected.size > 0;
  const projectEmpty = files.length === 0 && (folders?.length ?? 0) === 0;
  const finding = listing.flat;

  // The empty state's one markup, for the confirmed-empty project and for the
  // inert stand-in drawn before the first listing (`emptyLookBeforeFirstListing`).
  const renderEmptyState = (beforeFirstListing: boolean) => (
    <div
      className="df-empty"
      data-testid={beforeFirstListing ? 'file-list-empty-unconfirmed' : 'file-list-empty'}
      ref={beforeFirstListing ? makeInert : undefined}
      aria-busy={beforeFirstListing || undefined}
    >
      <div className="df-empty-pill">
        <span className="df-empty-title">{t('filesPanel.empty')}</span>
        {/* Starter actions stay discoverable while mutations are disabled. */}
        <div className="df-empty-actions">
          <button
            type="button"
            className="df-empty-cta df-empty-cta-doc"
            data-testid={beforeFirstListing ? undefined : 'file-list-empty-new-document'}
            disabled={viewerOnly}
            onClick={onPaste}
            title={viewerOnly ? t('studio.readOnly') : t('filesPanel.newDocumentTitle')}
          >
            <Icon name="file" size={13} />
            <span>{t('filesPanel.newDocument')}</span>
          </button>
          <button
            type="button"
            className="df-empty-cta df-empty-cta-upload"
            data-testid={beforeFirstListing ? undefined : 'file-list-upload-trigger'}
            disabled={viewerOnly}
            onClick={onUpload}
            title={viewerOnly ? t('studio.readOnly') : t('filesPanel.upload.title')}
          >
            <Icon name="upload" size={13} />
            <span>{t('filesPanel.upload.label')}</span>
          </button>
        </div>
      </div>
    </div>
  );

  function renderListing() {
    const nothingListed = listing.dirs.length === 0 && listing.files.length === 0 && !showPluginFolders;
    if (nothingListed) {
      return (
        <div className={styles.noMatches} data-testid="library-no-matches">
          <span>{t('panel.library.noMatches')}</span>
          {finding ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setTypeFilter('all');
                setQuery('');
              }}
            >
              {t('panel.library.clearFilters')}
            </Button>
          ) : null}
        </div>
      );
    }
    const dirPath = (name: string) => (currentDir === '' ? name : `${currentDir}/${name}`);
    const shownFiles = incremental.limit(listing.files);
    if (layout === 'grid') {
      return (
        <>
          {showPluginFolders ? (
            <PluginFolderList folders={pluginFolders} t={t} activePaths={activePluginActionPaths}
              onOpenFile={onOpenFile} onAction={onPluginFolderAgentAction} />
          ) : null}
          <div className={styles.grid} data-testid="library-grid">
            {listing.dirs.map((name) => (
              <DirCard key={`dir:${name}`} path={dirPath(name)} name={name} count={dirCounts.get(dirPath(name)) ?? 0} ctx={ctx} />
            ))}
            {shownFiles.map((file) => <FileCard key={file.name} file={file} ctx={ctx} />)}
            {incremental.sentinel(listing.files.length)}
          </div>
        </>
      );
    }
    return (
      <div className={styles.list} data-testid="library-list">
        {showPluginFolders ? (
          <PluginFolderList folders={pluginFolders} t={t} activePaths={activePluginActionPaths}
            onOpenFile={onOpenFile} onAction={onPluginFolderAgentAction} />
        ) : null}
        {listing.dirs.map((name) => (
          <DirRow key={`dir:${name}`} path={dirPath(name)} name={name} count={dirCounts.get(dirPath(name)) ?? 0} ctx={ctx} />
        ))}
        {shownFiles.map((file) => <FileRow key={file.name} file={file} ctx={ctx} />)}
        {incremental.sentinel(listing.files.length)}
      </div>
    );
  }

  let body;
  if (showingBuildPreview) {
    // The middle state: a page exists but the run is still writing it.
    // Watching it take shape beats a list whose only news is that a file
    // appeared. Falls back the moment the run ends, or when the toolbar's
    // preview switch is turned off.
    body = (
      <div className="df-empty" data-testid="file-list-building-host">
        <FileListBuildingState projectId={projectId} file={buildPreviewFile!} filesRefreshKey={filesRefreshKey} steps={runSteps ?? []} />
      </div>
    );
  } else if (projectEmpty && !filesAuthoritative) {
    body = emptyLookBeforeFirstListing ? renderEmptyState(true) : <FileListSkeleton />;
  } else if (projectEmpty) {
    // A shared project whose local mirror has not caught up reads as exactly
    // the same zero-files result as an empty project; its CTAs (which create
    // NEW content) would mislead, so it gets a syncing notice instead.
    body = downloadPending ? (
      <div className="df-empty df-empty-syncing" data-testid="file-list-syncing">
        <div className="df-empty-pill">
          <span className="df-empty-title">{t('filesPanel.syncing')}</span>
        </div>
      </div>
    ) : renderEmptyState(false);
  } else {
    body = renderListing();
  }

  const selectionActions = {
    addToChat: viewerOnly ? undefined : () => addToChat([...selected]),
    generateFrom: onGenerateFrom && !viewerOnly && selectedImages.length > 0
      ? () => onGenerateFrom(selectedImages.map((file) => file.name))
      : undefined,
    editImage: singleImage && !viewerOnly ? () => assets.editImage(singleImage.name) : undefined,
    process: !viewerOnly && selectedFiles.length > 0 && selectedFiles.every(isMediaFile)
      ? () => assets.process(selectedFiles.map((file) => file.name))
      : undefined,
    download: () => {
      track('download_as_zip');
      downloadProjectFilesZip(projectId, [...selected]).catch(() => {
        setNotice({ message: t('filesPanel.downloadFailed'), tone: 'error' });
      });
    },
    delete: viewerOnly ? undefined : () => void deleteSelection(),
    deleting,
    clear: () => setSelected(new Set()),
  };

  const toastNotice = notice ?? (assets.error ? { message: assets.error, tone: 'error' as const } : null);

  return (
    <div className={`df-panel ${hasSelection ? 'has-selection' : ''}`} data-layout={layout}>
      {reloading ? (
        <div className="df-reloading-overlay" data-testid="file-list-reloading">
          <span className="loading-spinner">
            <Icon name="spinner" size={16} />
            <span className="loading-spinner-label">{t('common.loading')}</span>
          </span>
        </div>
      ) : null}
      <div className="df-main">
        <LibraryToolbar
          crumbs={(
            <LibraryBreadcrumbs
              currentDir={currentDir}
              rootLabel={rootDirName ?? t('filesPanel.crumbs')}
              t={t}
              onNavigate={openDir}
            />
          )}
        >
          {/* Only while a run in flight has written a page: outside that
              window there is one view, and the switch would do nothing. */}
          {buildPreviewFile && running ? (
            <BuildPreviewToggle checked={!buildPreviewDismissed} onChange={(next) => setBuildPreviewDismissed(!next)} />
          ) : null}
          <LibraryLayoutToggle layout={layout} t={t} onChange={setLayout} />
          {viewerOnly ? null : (
            <LibraryProjectMenu
              t={t}
              duplicateBusy={duplicateProjectBusy}
              onUpload={onUpload}
              onNewDocument={onPaste}
              onDuplicateProject={onDuplicateProject ? () => {
                track('duplicate_project');
                onDuplicateProject();
              } : undefined}
            />
          )}
          {onGenerate ? <GenerateAssetsButton t={t} onGenerate={onGenerate} /> : null}
        </LibraryToolbar>
        {!projectEmpty && !showingBuildPreview ? (
          <LibraryFilterBar
            type={typeFilter}
            counts={counts}
            query={query}
            t={t}
            onTypeChange={setTypeFilter}
            onQueryChange={setQuery}
          />
        ) : null}
        <div className="df-body" {...drop.handlers}>
          {visibleUploadError ? (
            <div className="df-upload-banner" data-testid="upload-error-banner">
              <span>{visibleUploadError}</span>
              {onClearUploadError || drop.readError ? (
                <button
                  type="button"
                  data-testid="upload-error-dismiss"
                  onClick={() => {
                    drop.clearReadError();
                    onClearUploadError?.();
                  }}
                >
                  {t('common.dismiss')}
                </button>
              ) : null}
            </div>
          ) : null}
          {hasSelection ? <SelectionBar count={selected.size} actions={selectionActions} t={t} /> : null}
          {body}
        </div>
        {drop.dragging ? (
          <div className="df-drop-overlay" data-testid="file-list-drop-overlay" aria-hidden>
            <div className="df-drop-overlay-card">
              <Icon name="upload" size={22} />
              <span className="label">{t('filesPanel.dropTitle')}</span>
              <span className="desc">{t('filesPanel.dropDesc')}</span>
            </div>
          </div>
        ) : null}
      </div>
      {menu ? <EntryMenu projectId={projectId} position={menu} actions={menuActions(menu.name)} t={t} onClose={closeMenu} /> : null}
      {assets.render({
        fileNames: files.map((file) => file.name),
        onOpenFile,
        onAddToChat: viewerOnly ? undefined : (path) => addToChat([path]),
        onImageSaved: imageSaved,
      })}
      {toastNotice ? (
        <div className="workspace-toast-anchor">
          <Toast
            message={toastNotice.message}
            tone={toastNotice.tone}
            role={toastNotice.tone === 'error' ? 'alert' : 'status'}
            onDismiss={() => {
              setNotice(null);
              assets.clearError();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
