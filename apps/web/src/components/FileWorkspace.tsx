import { useConfirmDialog } from '../hooks/useConfirmDialog';

import type { RecoveryActionBlockReason } from '../runtime/chat/recovery-gating';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { TrackingArtifactKind, TrackingProjectKind } from '@openpixo/contracts/analytics';


import { useAnalytics } from '../analytics/provider';
import {
  trackFileManagerClick,
  trackFileUploadResult,
  trackPageView,
} from '../analytics/events';
import { deriveUploadCohort } from '../analytics/upload-tracking';
import { useI18n } from '../i18n';
import { useStableHandler } from '../lib/use-stable-handler';
import { isMacPlatform } from '../utils/platform';
import { deleteProjectFile, fetchProjectFolders, renameProjectFile, type UploadProjectFilesResult, uploadProjectFiles, writeProjectTextFile } from '../providers/registry';
import type { Dict } from '../i18n/types';

import { type AgentInfo, type AppConfig, type Conversation, conversationIdFromSideChatTabId, isSideChatTabId, isTerminalTabId, terminalIdFromTabId, type OpenTabsState, type ProjectFile, type ProjectFolder, terminalTabId } from '../types';
import { type ChatSessionMode, type WorkspaceContextItem } from '@openpixo/contracts';


import { createTerminal, killTerminal, } from '../state/projects';

import { FilesPanel, type FilesNavState, type LibraryTypeRequest } from './FilesPanel';
import type { PluginFolderAgentAction } from './files/pluginFolderActions';
import { FileViewer, } from './FileViewer';
import { useIframeKeepAlivePool } from './IframeKeepAlivePool';
import { Icon } from './Icon';
import { ProjectExtensionsPanel } from './ProjectExtensionsPanel';
import { ChangesView } from './panel/ChangesView';
import { ChangeDiffViewer } from './changes/ChangeDiffViewer';
import { GameView, type GameViewControls } from './panel/GameView';
import { LibraryView } from './panel/LibraryView';
import { PanelHeader } from './panel/PanelHeader';
import type { PanelMenuItem } from './panel/PanelMenu';
import { PanelSheet } from './panel/PanelSheet';
import { PanelStackBar } from './panel/PanelStackBar';
import viewToolbarStyles from './panel/ViewToolbar.module.css';
import {
  initialPanelNav,
  isChangeDiffItem,
  panelItemHomeView,
  panelItems,
  panelItemView,
  parseChangeDiffItem,
  panelTop,
  popPanelItem,
  pushPanelItem,
  readStoredPanelView,
  removePanelItems,
  renamePanelItem,
  replacePanelItem,
  switchPanelView,
  writeStoredPanelView,
  type PanelNav,
  type PanelView,
  PANEL_CHANGES_ROOT,
  showPanelRoot,
} from './panel/panel-nav';
import { clearStudioEntry, pendingStudioRecipe } from './studio/entry';
import { GenerateView } from './generate/GenerateView';


import { Toast } from './Toast';


import { SideChatTab, type ActiveConversationChatState } from './workspace/SideChatTab';
import { TerminalViewer } from './workspace/TerminalViewer';
import { QuickSwitcher } from './QuickSwitcher';
import { useWorkspaceTabsDockRef } from './workspaceTabsDock';
import { AnimatePresence } from 'motion/react';
import type { ChatMessage } from '../types';
import { runProgressSteps } from '../runtime/run-progress';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

function syncInertAttribute(element: HTMLElement | null, inert: boolean): void {
  if (!element) return;
  // React 18 treats `inert` as an unknown string attribute while React 19
  // treats it as boolean. Updating the standard DOM attribute directly keeps
  // retained viewers accessible in both runtimes without either warning.
  element.toggleAttribute('inert', inert);
}

export interface FileRefreshResult {
  acceptedGeneration: number | null;
}

interface Props {
  projectId: string;
  projectKind: TrackingProjectKind;
  projectName?: string;
  // Basename of the project's chosen working directory (e.g. "openclaw").
  // Threaded to FilesPanel as the breadcrumb root label. Undefined for
  // default-storage projects.
  rootDirName?: string;
  // True while a working-dir replace is reindexing; shows a loading state.
  reloading?: boolean;
  /** Absolute on-disk project directory (from GET /api/projects/:id). Used by
   * the Files panel's "copy absolute path" action. */
  resolvedDir?: string | null;
  files: ProjectFile[];
  filesRefreshKey?: number;
  filesGeneration?: number;
  onRefreshFiles: (
    options?: { fresh?: boolean },
  ) => Promise<FileRefreshResult | void> | FileRefreshResult | void;
  onManualFileWritten?: (file: ProjectFile) => void;
  streaming?: boolean;
  /**
   * True while a run of the current conversation is actually in flight: its
   * events are streaming, or an active run is attached and waiting to.
   *
   * Deliberately separate from `streaming`, which is the composer's
   * "actions disabled" state and is also true for a read-only viewer of a
   * shared project, a conversation still loading, or a run with no billable
   * principal. The Files building preview keys off THIS flag: a page
   * only "takes shape" while something is writing it, and a viewer with no run
   * in flight must see the file grid, not a live preview captioned "thinking".
   */
  runInFlight?: boolean;
  /** Exact router file still awaiting the async open request on project mount. */
  routeFileName?: string | null;
  /** The route is `/projects/:id/generate`: open the generator sheet in 资源库. */
  routedGenerate?: boolean;
  /**
   * A request to show a file. `origin: 'conversation'` marks a user click in
   * the conversation (file link, artifact card, inline asset, a file URL): it
   * lands on 资源库's stack and switches the panel there. Anything else is a
   * host-driven open (auto-open after a turn and its `openBatch`, the agent's
   * `<pixo-focus open>`): onto 资源库's stack too, but the view never switches
   * (specs/current/openpixo-game-panel.md §2, decision 2).
   */
  openRequest?: { name: string; nonce: number; openBatch?: readonly string[]; origin?: 'conversation' } | null;
  // Open the named file AND surface its Download/Export menu. Drives the
  // chat-side "Download" next-step action.
  downloadRequest?: { name: string; nonce: number; anchorId?: string } | null;
  // Persisted set of open tabs + active tab. Owned by ProjectView so the
  // daemon's SQLite store can hold the source of truth and survive reloads.
  tabsState: OpenTabsState;
  onTabsStateChange: (next: OpenTabsState) => void;
  onPluginFolderAgentAction?: (
    relativePath: string,
    action: PluginFolderAgentAction,
  ) => Promise<{ message?: string; url?: string } | void> | { message?: string; url?: string } | void;
  activePluginActionPaths?: Set<string>;
  hiddenPluginActionPaths?: Set<string>;
  focusMode?: boolean;
  onFocusModeChange?: (next: boolean) => void;
  onDuplicateProject?: () => void;
  duplicateProjectBusy?: boolean;
  // Side Chat (`chat:<conversationId>` tab) wiring. Threaded from ProjectView
  // so a secondary ChatPane can render an already-open conversation tab without
  // FileWorkspace owning any chat state. All optional: a workspace mounted
  // without these simply does not render restored side-chat tabs. There is no
  // launcher affordance to create new side chats — only persisted `chat:` tabs
  // are restored.
  chatConfig?: AppConfig;
  chatAgentsById?: Map<string, AgentInfo>;
  handoffAgents?: AgentInfo[];
  handoffArtifactId?: string;
  handoffArtifactKind?: TrackingArtifactKind;
  metricsConsent?: boolean;
  installationId?: string | null;
  chatLocale?: string;
  conversations?: Conversation[];
  /** The primary chat's active conversation. */
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
  onConversationSessionModeChange?: (id: string, mode: ChatSessionMode) => void;
  onNewConversation?: () => void;
  activeConversationChat?: ActiveConversationChatState;
  chatRecoveryActionsBlockedReason?: RecoveryActionBlockReason | null;
  onActiveContextChange?: (context: WorkspaceContextItem | null) => void;
  onWorkspaceContextsChange?: (contexts: WorkspaceContextItem[]) => void;
  messages?: ChatMessage[];
  artifactHtml?: string | null;
  conversationError?: string | null;
  onAuthorizeAndRetry?: (message: ChatMessage) => void;
  // Conversation id for recovery telemetry.
  conversationId?: string | null;
  // Project-level actions (settings, handoff, avatar menu) rendered at the
  // right end of the Files tab row. The former standalone chrome header
  // row was removed; these moved here alongside the FileViewer present/Share
  // portal that targets the same actions container.
  fileActionsBefore?: ReactNode;
  /** 改动's toolbar: the snapshot history. */
  changesActions?: ReactNode;
  /** Header controls: the engine chip. */
  headerActions?: ReactNode;
  /** 游戏 view: which game controls the project has, and a starter request to start inline. */
  gameControls?: GameViewControls;
  /** Bumped by a starter Verify / Run request: switches the panel to 游戏. */
  gameViewRequest?: number;
  /** Checklist "open assets / generate": 资源库 gallery, or 资源库 + the generator sheet. */
  gameTabRequest?: { tab: 'assets' | 'generate'; nonce: number } | null;
  /** Overrides the 改动 badge count the Changes view reports; hidden when 0. */
  changesBadge?: number;
  /** ⋯ › Engine settings. */
  onOpenEngineSettings?: () => void;
  /** The Share dialog's way to credits. */
  onOpenAccount?: () => void;
  /**
   * Disable mutations while the local project is unavailable or pending.
   */
  viewerOnly?: boolean;
  /** First-open placeholder: do not mount cached/write-capable workspace tabs. */
  materializationPending?: boolean;
  /** See FilesPanel's `filesAuthoritative`. */
  filesAuthoritative?: boolean;
  /**
   * The project row does not exist on the daemon yet (a Home send whose create
   * has not answered, OPEND-3334): this workspace reads nothing of its own
   * (folders, share status) until it does.
   */
  projectReadsHeld?: boolean;
  /** See FilesPanel's `emptyLookBeforeFirstListing`. */
  emptyLookBeforeFirstListing?: boolean;
  /** Optional override for the read-only notice text. */
  readonlyNotice?: string;
}

function noop(): void {}

function rejectRenameWhileMaterializing(): null {
  return null;
}


export const FILES_TAB = '__design_files__';
// Keep a small LRU of already-opened HTML viewers mounted. Moving an iframe
// between a visible host and the global parking pool makes Chromium navigate
// it again even when `src` is byte-identical, so tab A -> tab B -> tab A used
// to refetch both artifacts and briefly return to a blank/loading preview.
const HTML_VIEWER_KEEPALIVE_CAP = 3;
const RETAINED_VIEWER_INACTIVE_STYLE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  opacity: 0,
  pointerEvents: 'none',
} satisfies CSSProperties;
const QUICK_SWITCHER_DOCUMENT_CLASS = 'pixo-quick-switcher-open';

// Stable empty folder list so the render-phase project-switch reset is
// idempotent (passing a fresh `[]` each render would re-trigger the reset).
const EMPTY_PROJECT_FOLDERS: ProjectFolder[] = [];
type WorkspaceOrderedTab = { id: string; kind: 'file'; name: string };


const NO_REFERENCE_PATHS: string[] = [];

/** Everything the panel keeps per project; reset together on a project switch. */
interface ProjectPanelState {
  projectId: string;
  nav: PanelNav;
  /** Checklist "open assets": 资源库 shows 图片 once (applied by the browser). */
  libraryTypeRequest: LibraryTypeRequest | null;
  /** Pictures "generate from" handed to 生成. */
  studioReferencePaths: string[];
  /** Bumped on every "generate from", so the same pictures twice still reach the box. */
  studioReferenceRequest: number;
  /** A recipe queued by a composer / home entry point, read once per project. */
  initialRecipeId: string | null;
  extensionsOpen: boolean;
}

function initialPanelState(projectId: string, routedGenerate: boolean): ProjectPanelState {
  const initialRecipeId = pendingStudioRecipe(projectId);
  // The /generate deep link and a queued recipe open 生成; otherwise the
  // project's saved view (default 游戏).
  const generate = routedGenerate || Boolean(initialRecipeId);
  return {
    projectId,
    nav: initialPanelNav(generate ? 'generate' : readStoredPanelView(projectId)),
    libraryTypeRequest: null,
    studioReferencePaths: NO_REFERENCE_PATHS,
    studioReferenceRequest: 0,
    initialRecipeId,
    extensionsOpen: false,
  };
}


function joinDisplayPath(root: string, child: string): string {
  const cleanRoot = root.replace(/[\\/]+$/u, '');
  const cleanChild = child.replace(/^[\\/]+/u, '');
  return cleanChild ? `${cleanRoot}/${cleanChild}` : cleanRoot;
}

function createDefaultFilesNavState(): FilesNavState {
  return {
    kindFilter: new Set(),
    currentDir: '',
    page: 0,
    pageSize: 30,
  };
}

export function FileWorkspace({
  projectId,
  projectKind,
  projectName,
  rootDirName,
  reloading,
  resolvedDir,
  files,
  filesRefreshKey = 0,
  filesGeneration,
  onRefreshFiles,
  onManualFileWritten,
  streaming,
  runInFlight = false,
  routeFileName,
  routedGenerate = false,
  openRequest,
  downloadRequest,
  tabsState,
  onTabsStateChange,
  onPluginFolderAgentAction,
  activePluginActionPaths,
  hiddenPluginActionPaths,
  focusMode = false,
  onFocusModeChange,
  onDuplicateProject,
  duplicateProjectBusy = false,
  chatConfig,
  chatAgentsById,
  handoffAgents,
  handoffArtifactId,
  handoffArtifactKind,
  metricsConsent,
  installationId,
  chatLocale,
  conversations = [],
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  onConversationSessionModeChange,
  onNewConversation,
  activeConversationChat,
  chatRecoveryActionsBlockedReason,
  onActiveContextChange,
  onWorkspaceContextsChange,
  messages = [],
  conversationId,
  fileActionsBefore,
  headerActions,
  gameControls,
  gameViewRequest,
  gameTabRequest,
  changesBadge,
  changesActions,
  onOpenEngineSettings,
  onOpenAccount,
  viewerOnly = false,
  materializationPending = false,
  filesAuthoritative = true,
  emptyLookBeforeFirstListing = false,
  projectReadsHeld = false,
  readonlyNotice,

}: Props) {
  const refreshFilesWithoutResult = useCallback(async () => {
    await onRefreshFiles();
  }, [onRefreshFiles]);
  const { locale, t } = useI18n();

  const iframeKeepAlivePool = useIframeKeepAlivePool();
  const analytics = useAnalytics();
  // P1 page_view page_name=file_manager — once per project the user lands
  // inside the workspace. Re-fire when the projectId changes so a
  // project-switch session shows up as a fresh view rather than reusing
  // the previous one.
  const fileManagerViewedProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (fileManagerViewedProjectRef.current === projectId) return;
    fileManagerViewedProjectRef.current = projectId;
    trackPageView(analytics.track, { page_name: 'file_manager' });
  }, [projectId, analytics.track]);
  // ── Panel navigation (specs/current/openpixo-game-panel.md §3) ──────────
  // Three views, each with its own stack of opened items. The top of the
  // current view's stack is what the body shows; FILES_TAB stands for "the
  // view's own root" so the viewer plumbing below keeps one notion of the
  // active surface. Stacks are reset per project; the view choice persists.
  const [panelState, setPanelState] = useState(() => initialPanelState(projectId, routedGenerate));
  if (panelState.projectId !== projectId) {
    setPanelState(initialPanelState(projectId, routedGenerate));
  }
  const panel = panelState.projectId === projectId ? panelState : initialPanelState(projectId, routedGenerate);
  const panelNav = panel.nav;
  // 改动 badge: reported by ChangesView (spec §5); never moves the panel.
  const [changesViewBadge, setChangesViewBadge] = useState(0);
  const panelNavRef = useRef(panelNav);
  panelNavRef.current = panelNav;
  const updatePanel = useCallback((update: (state: ProjectPanelState) => ProjectPanelState) => {
    setPanelState((current) => update(current));
  }, []);
  const updatePanelNav = useCallback((update: (nav: PanelNav) => PanelNav) => {
    setPanelState((current) => {
      const nav = update(current.nav);
      return nav === current.nav ? current : { ...current, nav };
    });
  }, []);
  const panelView = panelNav.view;
  useEffect(() => {
    if (panelState.projectId === projectId) writeStoredPanelView(projectId, panelState.nav.view);
  }, [panelState.projectId, panelState.nav.view, projectId]);
  useEffect(() => { clearStudioEntry(projectId); }, [projectId]);
  // Every item open in any view, in the order it was first opened — what the
  // retained viewers and the workspace contexts used to read from the tab
  // strip. NOT stack order: re-opening an item moves it to the top of its
  // stack, and retained HTML viewers render in this order, so following the
  // stack would move a live iframe's ancestor and make Chromium reload it.
  const stableItemOrderRef = useRef<{ projectId: string; items: string[] }>({ projectId, items: [] });
  const persistedTabs = useMemo(() => {
    const open = new Set(panelItems(panelNav));
    const previous = stableItemOrderRef.current.projectId === projectId ? stableItemOrderRef.current.items : [];
    const next = previous.filter((item) => open.has(item));
    for (const item of open) if (!next.includes(item)) next.push(item);
    const items = arraysEqual(next, previous) ? previous : next;
    stableItemOrderRef.current = { projectId, items };
    return items;
  }, [panelNav, projectId]);
  const activeTab = panelTop(panelNav) ?? FILES_TAB;
  // Bumped by opens from inside the panel so focus lands on ← (and Esc pops).
  const [stackFocusRequest, setStackFocusRequest] = useState(0);
  // `materializationPending` can briefly become true again while the router
  // commits a file-tab URL. Once this project has rendered real workspace
  // content, that transient revalidation must not tear down retained viewers:
  // doing so destroys iframe browsing contexts, edit sessions, and toolbar
  // portals for a single frame. A genuinely new project still gets the
  // first-materialization loading surface because its id has not been marked
  // ready in this component instance.
  const materializedProjectRef = useRef<string | null>(
    materializationPending ? null : projectId,
  );
  if (!materializationPending) materializedProjectRef.current = projectId;
  const initialMaterializationPending =
    materializationPending && materializedProjectRef.current !== projectId;
  const [uploadError, setUploadError] = useState<string | null>(null);
  // The folder the Files panel is currently viewing (synced via
  // onCurrentDirChange). New files — uploads, pastes, sketches, dropped files —
  // are created under this folder instead of the project root.
  const [uploadDir, setUploadDir] = useState<string>('');
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [projectFolders, setProjectFolders] = useState<ProjectFolder[]>(EMPTY_PROJECT_FOLDERS);
  // Reset the folder list during render — NOT in an effect — when the project
  // changes. FilesPanel is keyed by `projectId`, so an effect-based reset
  // would let the new panel mount once with the previous project's folders and
  // briefly suppress the new project's empty state (the exact regression this
  // fix removes). Adjusting state during render discards this render before the
  // child commits, so the new panel never sees stale folders. Mirrors the
  // designFilesNav ref reset above. The stable empty constant keeps this
  // idempotent (no re-entrant render loop).
  const projectFoldersProjectIdRef = useRef(projectId);
  if (projectFoldersProjectIdRef.current !== projectId) {
    projectFoldersProjectIdRef.current = projectId;
    setProjectFolders(EMPTY_PROJECT_FOLDERS);
  }
  // Transient feedback when a ⋯ menu "create" action (e.g. New Terminal)
  // fails on the daemon side, so the click is never a silent no-op.
  const [launcherToast, setLauncherToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRootRef = useRef<HTMLDivElement | null>(null);
  // Focus-mode dock host for the workspace tab strip (workspaceTabsDock.ts).
  const focusTabsDockRef = useWorkspaceTabsDockRef();
  const designFilesNavProjectIdRef = useRef(projectId);
  const designFilesNavRef = useRef<FilesNavState>(createDefaultFilesNavState());
  if (designFilesNavProjectIdRef.current !== projectId) {
    designFilesNavProjectIdRef.current = projectId;
    designFilesNavRef.current = createDefaultFilesNavState();
  }
  const onFilesNavStateChange = useCallback((state: FilesNavState) => {
    designFilesNavRef.current = state;
  }, []);

  // Maps a terminal tab's original session id (the `terminal:<id>` suffix) to
  // the PTY session it is CURRENTLY bound to. Restart rebinds the surface to a
  // fresh session while the tab id stays constant, and the surface is unmounted
  // whenever its tab isn't active — so this ref (which survives the child's
  // unmount) is the only place that knows which PTY to kill on an explicit
  // Close. `<TerminalViewer onSessionIdChange>` keeps it current.
  const terminalLiveSessionsRef = useRef<Map<string, string>>(new Map());
  const handleTerminalSessionChange = useCallback(
    (originalId: string, sessionId: string) => {
      terminalLiveSessionsRef.current.set(originalId, sessionId);
    },
    [],
  );
  const [liveHtmlViewerFileNames, setLiveHtmlViewerFileNames] = useState<string[]>([]);

  // The set actually rendered. The activation LRU governs ad-hoc browser tabs,
  // but a pinned brand-extraction tab must stay mounted even when it was never
  // activated this session (a refresh can remount the workspace with brand.html
  // active and the LRU empty). Keeping its <webview> alive is what lets the chat
  // "Continue extraction" handler read the live, post-wall DOM instead of
  // silently degrading to a re-walled server fetch.

  const visibleFiles = useMemo(
    () => files,
    [files],
  );

  // What the Files building preview shows while a run is in flight:
  // what the run is doing right now, and the steps behind it. Recomputed per
  // streamed event by design — a tool call landing IS the update the pane is
  // there to show.
  const runSteps = useMemo(() => runProgressSteps(messages), [messages]);
  const runStartedAt = useMemo(() => {
    if (!runInFlight) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      if (message.role === 'user') return null;
      if (message.role !== 'assistant') continue;
      return message.endedAt ? null : message.startedAt ?? null;
    }
    return null;
  }, [messages, runInFlight]);

  // Known-file set for the side chat's file-link routing — same shape
  // ProjectView feeds its primary ChatPane.
  const sideChatFileNames = useMemo(() => new Set(files.map((file) => file.name)), [files]);


  const refreshProjectFolders = useCallback(async (): Promise<ProjectFolder[]> => {
    const next = await fetchProjectFolders(projectId);
    setProjectFolders(next);
    return next;
  }, [projectId,]);

  useEffect(() => {
    if (projectReadsHeld) return;
    let cancelled = false;
    // The synchronous clear happens during render (see projectFoldersProjectIdRef
    // above); here we only fetch the new project's folders.
    void fetchProjectFolders(projectId).then((next) => {
      if (!cancelled) setProjectFolders(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, projectReadsHeld,]);

  // True when the Files tab has nothing to attach: no files, no live
  // artifacts, no folders. Mirrors FilesPanel's own empty-state gate so
  // the "Design files" composer context and the empty placeholder agree on
  // when the tab is actually empty. Reused below to suppress the auto-attached
  // workspace context for a brand-new/empty project.
  const designFilesTabIsEmpty =
    visibleFiles.length === 0
    && projectFolders.length === 0;

  // ── Parent tab state ↔ panel stacks ────────────────────────────────────
  // ProjectView persists `tabsState` (daemon SQLite + local cache) and syncs
  // the URL from `tabsState.active`. The panel owns the stacks and mirrors
  // them out as { tabs: every open item, active: what the body shows }. A
  // state the panel did not write (hydration, a host default, a deep link
  // restored with the saved tabs) seeds 资源库's stack with its active item
  // without moving the view; legacy tab lists are not replayed as stacks.
  const lastCommittedTabsRef = useRef<OpenTabsState | null>(null);
  // Compared by content: a parent may hand in an equal object each render.
  const lastSeenTabsKeyRef = useRef<string | null>(null);
  // The stacks a pending hydration push started from: the mirror below must
  // not answer them with an empty state and overwrite what the parent just
  // restored.
  const reconcileBaseNavRef = useRef<PanelNav | null>(null);
  useEffect(() => {
    const key = tabsStateKey(projectId, tabsState);
    if (key === lastSeenTabsKeyRef.current) return;
    lastSeenTabsKeyRef.current = key;
    const committed = lastCommittedTabsRef.current;
    if (committed && key === tabsStateKey(projectId, committed)) return;
    const active = tabsState.active;
    if (!active || active === FILES_TAB) return;
    if (panelItemView(panelNavRef.current, active) !== null) return;
    reconcileBaseNavRef.current = panelNavRef.current;
    updatePanelNav((nav) => (panelItemView(nav, active) === null ? pushPanelItem(nav, panelItemHomeView(active), active) : nav));
  }, [projectId, tabsState, updatePanelNav]);
  const displayedTabsState = useMemo<OpenTabsState>(
    () => ({ tabs: persistedTabs, active: panelTop(panelNav) }),
    [panelNav, persistedTabs],
  );
  const tabsStatePropRef = useRef(tabsState);
  tabsStatePropRef.current = tabsState;
  useEffect(() => {
    if (reconcileBaseNavRef.current === panelNav) return;
    reconcileBaseNavRef.current = null;
    // What the parent was last told (it echoes it back as the prop); before
    // the first commit, the prop itself.
    const current = lastCommittedTabsRef.current ?? tabsStatePropRef.current;
    if (current.active === displayedTabsState.active && arraysEqual(current.tabs, displayedTabsState.tabs)) {
      lastCommittedTabsRef.current = current;
      return;
    }
    lastCommittedTabsRef.current = displayedTabsState;
    onTabsStateChange(displayedTabsState);
    // Only the panel's own navigation is mirrored out; the parent's prop is
    // read through the ref so its echo of this commit does not re-commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedTabsState]);

  // Opens that come from the conversation (file links, artifact cards,
  // inline assets, Download, a file URL) land on 资源库's stack and switch the
  // panel there; the user clicked, so moving the panel is theirs to ask for
  // (spec §3). Host-driven opens — the auto-open after a turn (OPEND-2588's
  // batch) and the agent's `<pixo-focus open>` — also go onto 资源库's stack,
  // but never switch the view (spec §2, decision 2): a game running in 游戏
  // stays in front, and the artifacts wait one click away.
  useEffect(() => {
    if (!openRequest) return;
    const name = openRequest.name;
    // FILES_TAB is the starter checklist's "show the project"; the tab
    // request that accompanies it picks the view.
    if (!name || name === FILES_TAB) return;
    if (openRequest.origin !== 'conversation') {
      openFromHost(name);
      return;
    }
    // Re-opening the shown item (a link to it, back/forward to its URL) must
    // not move it.
    if (name === panelTop(panelNavRef.current)) return;
    openFromConversation(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  // Download from a chat artifact card: open the file in 资源库 so its
  // FileViewer can surface the Download/Export menu.
  useEffect(() => {
    if (!downloadRequest?.name) return;
    if (downloadRequest.name === panelTop(panelNavRef.current)) return;
    openFromConversation(downloadRequest.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadRequest]);

  // Starter Verify / Run requests switch to 游戏 (its toolbar triggers start
  // the action themselves from the same nonce).
  useEffect(() => {
    if (!gameViewRequest) return;
    updatePanel((state) => ({ ...state, extensionsOpen: false, nav: switchPanelView(state.nav, 'game') }));
  }, [gameViewRequest, updatePanel]);

  // Checklist "open assets" lands in 资源库; "generate" and the /generate deep link in 生成.
  const requestedGameTab = gameTabRequest?.tab;
  const requestedGameTabNonce = gameTabRequest?.nonce;
  useEffect(() => {
    if (!requestedGameTab) return;
    updatePanel((state) => ({
      ...state,
      extensionsOpen: false,
      libraryTypeRequest: requestedGameTab === 'assets'
        ? { type: 'image', nonce: requestedGameTabNonce ?? 0 }
        : state.libraryTypeRequest,
      nav: switchPanelView(state.nav, requestedGameTab === 'generate' ? 'generate' : 'library'),
    }));
  }, [requestedGameTab, requestedGameTabNonce, updatePanel]);
  useEffect(() => {
    if (!routedGenerate) return;
    updatePanel((state) => ({ ...state, nav: switchPanelView(state.nav, 'generate') }));
  }, [projectId, routedGenerate, updatePanel]);

  const [sourceLineRequest, setSourceLineRequest] = useState<{ projectId: string; name: string; line: number; nonce: number } | null>(null);
  const sourceLineNonce = useRef(0);

  /** Open an item from inside the panel: onto `view`'s stack (default: the current view). */
  function openInPanel(name: string, view: PanelView = panelNavRef.current.view) {
    setUploadError(null);
    setSourceLineRequest(null);
    updatePanel((state) => ({
      ...state,
      extensionsOpen: false,
      nav: pushPanelItem(state.nav, view, name, { activate: true }),
    }));
    setStackFocusRequest((value) => value + 1);
  }
  function openFromConversation(name: string) {
    setUploadError(null);
    setSourceLineRequest(null);
    if (name === PANEL_CHANGES_ROOT) {
      updatePanel((state) => ({ ...state, extensionsOpen: false, nav: showPanelRoot(state.nav, 'changes') }));
      return;
    }
    updatePanel((state) => ({
      ...state,
      extensionsOpen: false,
      // A replayed URL can name a 改动 diff item; it goes back to 改动.
      nav: pushPanelItem(state.nav, panelItemHomeView(name), name, { activate: true }),
    }));
  }
  /**
   * Put a turn's main artifact on 文件's stack without switching the view. Only
   * that one: a stack of everything the turn produced turned the 文件 tab into
   * a pile of viewers to back out of, and the chat already lists the rest.
   * An artifact already open elsewhere keeps its place: the host does not pull
   * an item out of the view the user put it in.
   */
  function openFromHost(focus: string) {
    setSourceLineRequest(null);
    updatePanelNav((nav) => {
      const where = panelItemView(nav, focus);
      return where !== null && where !== 'library' ? nav : pushPanelItem(nav, 'library', focus);
    });
  }
  function openFileAtLine(name: string, line: number) {
    openInPanel(name);
    setSourceLineRequest({ projectId, name, line: Math.max(1, Math.trunc(line)), nonce: ++sourceLineNonce.current });
  }
  function openFile(name: string) {
    openInPanel(name);
  }
  function openInLibrary(name: string) {
    openInPanel(name, 'library');
  }
  /** Bring an already-open item forward in its own view, or open it in 资源库. */
  function focusPanelItem(item: string) {
    if (item === FILES_TAB) return;
    openInPanel(item, panelItemView(panelNavRef.current, item) ?? 'library');
  }
  function switchView(view: PanelView) {
    updatePanel((state) => ({
      ...state,
      extensionsOpen: false,
      // Pressing the current view again leaves whatever it had opened: the way back to its list.
      nav: state.nav.view === view ? showPanelRoot(state.nav, view) : switchPanelView(state.nav, view),
    }));
  }
  /** 生成素材… and "generate from": switch to 生成, handing over the pictures, if any. */
  function openStudio(referencePaths?: string[]) {
    updatePanel((state) => ({
      ...state,
      extensionsOpen: false,
      studioReferencePaths: referencePaths ?? NO_REFERENCE_PATHS,
      studioReferenceRequest: referencePaths?.length ? state.studioReferenceRequest + 1 : state.studioReferenceRequest,
      nav: switchPanelView(state.nav, 'generate'),
    }));
    clearStudioEntry(projectId);
  }

  // Terminal items own a daemon PTY that outlives unmount (so view switches
  // and stack pushes reattach cheaply). Leaving the stack — ← / Esc, the
  // terminal's own Close — is the one place it is terminated: the item is no
  // longer reachable. Kill the LIVE session (it may differ from the item's
  // original id after a Restart), falling back to the id itself.
  function releasePanelItem(item: string) {
    if (!isTerminalTabId(item)) return;
    const originalId = terminalIdFromTabId(item);
    const liveId = terminalLiveSessionsRef.current.get(originalId) ?? originalId;
    void killTerminal(projectId, liveId, { keepalive: true });
    terminalLiveSessionsRef.current.delete(originalId);
  }
  function popPanel() {
    const popped = panelTop(panelNavRef.current);
    if (popped === null) return;
    updatePanelNav((nav) => popPanelItem(nav).nav);
    releasePanelItem(popped);
  }
  function closePanelItem(item: string) {
    updatePanelNav((nav) => removePanelItems(nav, (candidate) => candidate === item));
    releasePanelItem(item);
  }

  // Open `openName` in place of `closeName`, in the stack that held it. Used
  // by the React module pointer (issue #2744): once the user jumps to the HTML
  // entry that renders a module, the dead-end module viewer is dropped.
  function openFileReplacing(openName: string, closeName: string) {
    setUploadError(null);
    updatePanelNav((nav) => replacePanelItem(nav, closeName, openName, nav.view));
  }

  async function openNewTerminal() {
    const view = panelNavRef.current.view;
    const term = await createTerminal(projectId, undefined);
    if (!term) {
      setLauncherToast({ message: t('workspace.terminalStartFailed'), tone: 'error' });
      return;
    }
    openInPanel(terminalTabId(term.id), view);
  }

  async function handleFilePicked(ev: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(ev.target.files ?? []);
    ev.target.value = '';
    await uploadFiles(picked);
  }

  async function uploadFiles(picked: File[]) {
    if (picked.length === 0) return;

    setUploadError(null);
    // Cohort math is shared across all three upload surfaces; see
    // `analytics/upload-tracking.ts` for the per-file → batch reduction.
    const cohort = deriveUploadCohort(picked);
    let result: UploadProjectFilesResult;
    try {
      result = await uploadProjectFiles(projectId, picked, uploadDir);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn('Project upload failed', err);
      setUploadError(t('filesPanel.uploadFailed', { n: picked.length }));
      trackFileUploadResult(analytics.track, {
        page_name: 'file_manager',
        area: 'file_manager',
        project_id: projectId,
        ...cohort,
        result: 'failed',
        error_code: detail,
      });
      return;
    }
    if (result.uploaded.length > 0) {
      await onRefreshFiles();
      const lastUploaded = result.uploaded[result.uploaded.length - 1];
      if (lastUploaded?.path) openInLibrary(lastUploaded.path);
    }

    if (result.failed.length > 0) {
      const failedCount = result.failed.length;
      const uploadedCount = result.uploaded.length;
      setUploadError(
        uploadedCount > 0
          ? t('filesPanel.uploadPartial', { uploaded: uploadedCount, failed: failedCount })
          : t('filesPanel.uploadFailed', { n: failedCount }),
      );
      console.warn('Project upload had failures', result.error, result.failed);
      trackFileUploadResult(analytics.track, {
        page_name: 'file_manager',
        area: 'file_manager',
        project_id: projectId,
        ...cohort,
        result: 'failed',
        ...(result.error ? { error_code: result.error } : {}),
      });
    } else if (result.uploaded.length > 0) {
      trackFileUploadResult(analytics.track, {
        page_name: 'file_manager',
        area: 'file_manager',
        project_id: projectId,
        ...cohort,
        result: 'success',
      });
    }
  }

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const isAllowedDropTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return Boolean(target.closest('.df-panel, .composer'));
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e) || isAllowedDropTarget(e.target)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e) || isAllowedDropTarget(e.target)) return;
      e.preventDefault();
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Esc pops the current view's stack (spec §3). Only for keys meant for the
  // panel: focus inside it, or nowhere in particular right after a pointer
  // press inside it (an image viewer has nothing focusable). Text fields, the
  // terminal, open menus/sheets/dialogs and the file palette keep their Esc.
  const pointerInPanelRef = useRef(false);
  const quickSwitcherOpenRef = useRef(quickSwitcherOpen);
  quickSwitcherOpenRef.current = quickSwitcherOpen;
  const popPanelRef = useRef(popPanel);
  popPanelRef.current = popPanel;
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = workspaceRootRef.current;
      pointerInPanelRef.current = Boolean(root && event.target instanceof Node && root.contains(event.target));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (quickSwitcherOpenRef.current) return;
      const root = workspaceRootRef.current;
      if (!root) return;
      const target = event.target;
      const fromPanel = target instanceof Node && root.contains(target);
      const fromNowhere = (target === document.body || target === document.documentElement) && pointerInPanelRef.current;
      if (!fromPanel && !fromNowhere) return;
      if (target instanceof Element && isEscapeOwningTarget(target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (panelTop(panelNavRef.current) === null) return;
      event.preventDefault();
      popPanelRef.current();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Cmd+P (mac) / Ctrl+P (win/linux) opens the file palette. Capture phase
  // so we beat the browser's default print dialog. Platform-gated so on
  // macOS we don't steal Ctrl+P from native readline ("previous line") in
  // text fields, and on win/linux we don't steal Cmd+P (rare but possible
  // on remapped keyboards).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const primary = isMacPlatform() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (primary && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        if (e.isComposing) return;
        e.preventDefault();
        setQuickSwitcherOpen((open) => !open);
      } else if (e.key === 'Escape' && quickSwitcherOpen) {
        // The palette handles Esc itself, but also catch it here for the
        // case where focus has drifted off the palette input.
        setQuickSwitcherOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [quickSwitcherOpen]);

  useEffect(() => {
    document.body.classList.toggle(QUICK_SWITCHER_DOCUMENT_CLASS, quickSwitcherOpen);
    return () => {
      document.body.classList.remove(QUICK_SWITCHER_DOCUMENT_CLASS);
    };
  }, [quickSwitcherOpen]);

  const fileDeletePendingRef = useRef(false);
  const { confirm: askDelete, dialog: deleteDialog } = useConfirmDialog();
  async function confirmFileDelete(_filePaths: readonly string[], message: string): Promise<boolean> {
    return askDelete({ title: t('designs.deleteTitle'), body: message, confirmLabel: t('designs.menuDelete'), destructive: true });
  }

  async function handleDelete(name: string) {
    if (viewerOnly || fileDeletePendingRef.current) return; // read-only viewer or pending deletion
    fileDeletePendingRef.current = true;
    try {
      if (!await confirmFileDelete([name], t('workspace.deleteFileConfirm', { name }))) return;
      const ok = await deleteProjectFile(projectId, name);
      if (ok) {
        await onRefreshFiles();
        // Drop the deleted file from whichever stack held it; a view showing
        // it falls back to what was under it.
        updatePanelNav((nav) => removePanelItems(nav, (item) => item === name));
      }
    } finally {
      fileDeletePendingRef.current = false;
    }
  }

  async function handleDeleteMany(names: string[]) {
    if (viewerOnly || fileDeletePendingRef.current) return; // read-only viewer or pending deletion
    if (names.length === 0) return;
    fileDeletePendingRef.current = true;
    try {
      if (!await confirmFileDelete(names, t('workspace.deleteSelectedFilesConfirm', { n: names.length }))) return;
      const deleted: string[] = [];
      const failed: string[] = [];
      for (const name of names) {
        const ok = await deleteProjectFile(projectId, name);
        if (ok) deleted.push(name);
        else failed.push(name);
      }
      if (deleted.length > 0) {
        await onRefreshFiles();
        const deletedSet = new Set(deleted);
        updatePanelNav((nav) => removePanelItems(nav, (item) => deletedSet.has(item)));
      }
      if (failed.length > 0) {
        setLauncherToast({ message: t('workspace.deleteSelectedFilesPartial', { n: failed.length }), tone: 'error' });
      }
    } finally {
      fileDeletePendingRef.current = false;
    }
  }

  async function handleRename(oldName: string, nextName: string): Promise<ProjectFile | null> {
    if (viewerOnly) return null;

    const result = await renameProjectFile(projectId, oldName, nextName);
    const renamed = result.file;
    await onRefreshFiles();
    await refreshProjectFolders();

    updatePanelNav((nav) => renamePanelItem(nav, oldName, renamed.name));

    return renamed;
  }


  async function createMarkdownDocument() {
    const target = nextMarkdownDocumentPath(files, uploadDir);
    const file = await writeProjectTextFile(
      projectId,
      target,
      initialMarkdownDocument(target, projectKind, t),
      undefined
    );
    if (!file) return;
    onManualFileWritten?.(file);
    await onRefreshFiles();
    await refreshProjectFolders();
    openInLibrary(file.name);
  }


  const activeFile = useMemo<ProjectFile | null>(() => {
    const onDisk = visibleFiles.find((f) => f.name === activeTab);
    if (onDisk) return onDisk;
    return null;
  }, [activeTab, visibleFiles,]);
  const activeViewerFile = activeFile;
  const activeHtmlViewerFile = activeViewerFile?.kind === 'html' ? activeViewerFile : null;


  const htmlViewerFileSnapshotsRef = useRef<{
    projectId: string;
    files: Map<string, ProjectFile>;
  }>({ projectId, files: new Map() });
  if (htmlViewerFileSnapshotsRef.current.projectId !== projectId) {
    htmlViewerFileSnapshotsRef.current = { projectId, files: new Map() };
  }
  const htmlViewerFileSnapshots = htmlViewerFileSnapshotsRef.current.files;
  for (const candidate of visibleFiles) {
    if (candidate.kind !== 'html') continue;
    // Retained viewers stay mounted at the real viewport size, so let them
    // consume file revisions while inactive. They can finish the one required
    // navigation behind the active tab; activation then remains a pure
    // visibility swap instead of combining resize + navigation in one frame.
    htmlViewerFileSnapshots.set(candidate.name, candidate);
  }
  useEffect(() => {
    setLiveHtmlViewerFileNames([]);
  }, [projectId]);
  useEffect(() => {
    if (!activeHtmlViewerFile) return;
    setLiveHtmlViewerFileNames((current) => [
      activeHtmlViewerFile.name,
      ...current.filter((name) => name !== activeHtmlViewerFile.name),
    ].slice(0, HTML_VIEWER_KEEPALIVE_CAP));
  }, [activeHtmlViewerFile?.name, projectId]);
  useEffect(() => {
    setLiveHtmlViewerFileNames((current) => {
      const openHtmlNames = new Set(persistedTabs);
      const next = current.filter((name) => openHtmlNames.has(name));
      return next.length === current.length ? current : next;
    });
    for (const name of htmlViewerFileSnapshots.keys()) {
      if (!persistedTabs.includes(name)) htmlViewerFileSnapshots.delete(name);
    }
  }, [persistedTabs]);
  const committedHtmlFileNames = useMemo(
    () => new Set(visibleFiles.filter((file) => file.kind === 'html').map((file) => file.name)),
    [visibleFiles],
  );
  useEffect(() => {
    const missingNames = [...htmlViewerFileSnapshots.keys()].filter(
      name => !committedHtmlFileNames.has(name)
        && (filesGeneration != null || !persistedTabs.includes(name)),
    );
    if (missingNames.length === 0) return;
    const removed = new Set(missingNames);
    setLiveHtmlViewerFileNames(current => current.filter(name => !removed.has(name)));
    for (const name of missingNames) htmlViewerFileSnapshots.delete(name);
    iframeKeepAlivePool.evictMatching(entry => entry.projectId === projectId
      && missingNames.some(name => entry.fileName === name || entry.fileName.startsWith(`${name}:`)));
  }, [committedHtmlFileNames, filesGeneration, iframeKeepAlivePool, persistedTabs, projectId]);
  const mountedHtmlViewerFiles = useMemo(() => {
    const candidates = activeHtmlViewerFile
        ? [
            activeHtmlViewerFile.name,
            ...liveHtmlViewerFileNames.filter((name) => name !== activeHtmlViewerFile.name),
          ]
        : [ ...liveHtmlViewerFileNames];
    // Manual Edit is exited (and pending edits flushed) before activation can
    // leave a tab. Protected viewers are prioritized but never bypass the hard
    // cap, so a regression cannot create an unbounded iframe population.
    const retainedNames = new Set([...new Set(candidates)].slice(0, HTML_VIEWER_KEEPALIVE_CAP));
    // LRU order is eviction metadata, not DOM order. Reordering an iframe's
    // connected ancestor makes Chromium navigate the frame again, so render
    // retained viewers in the stable persisted-tab order while switching.
    return persistedTabs
      .filter((name) => retainedNames.has(name))
      .map((name) => htmlViewerFileSnapshots.get(name))
      .filter((file): file is ProjectFile => file != null);
  }, [activeHtmlViewerFile, liveHtmlViewerFileNames, persistedTabs, visibleFiles]);
  const mountedHtmlViewerNames = mountedHtmlViewerFiles.map((file) => file.name);
  const previousMountedHtmlViewersRef = useRef({ projectId, names: new Set<string>() });
  useEffect(() => {
    const next = new Set(mountedHtmlViewerNames);
    const previous = previousMountedHtmlViewersRef.current;
    if (previous.projectId !== projectId) {
      iframeKeepAlivePool.evictProject(previous.projectId);
    } else {
      for (const name of previous.names) {
        if (next.has(name)) continue;
        iframeKeepAlivePool.evictMatching(
          (entry) => entry.projectId === projectId && (
            entry.fileName === name || entry.fileName.startsWith(`${name}:`)
          ),
        );
      }
    }
    previousMountedHtmlViewersRef.current = { projectId, names: next };
  }, [iframeKeepAlivePool, mountedHtmlViewerNames.join('\0'), projectId]);
  const retainedNonHtmlViewerFileRef = useRef<{ projectId: string; fileName: string } | null>(null);
  if (activeViewerFile && activeViewerFile.kind !== 'html') {
    retainedNonHtmlViewerFileRef.current = { projectId, fileName: activeViewerFile.name };
  }
  const retainedNonHtmlViewerFile =
    activeTab === FILES_TAB && retainedNonHtmlViewerFileRef.current?.projectId === projectId
      ? visibleFiles.find((file) => file.name === retainedNonHtmlViewerFileRef.current?.fileName) ?? null
      : null;
  const viewerFile = activeViewerFile?.kind === 'html'
    ? null
    : activeViewerFile ?? retainedNonHtmlViewerFile;
  const viewerFileActive = activeViewerFile !== null;

  const activeTabHasRenderableSurface =
    isTerminalTabId(activeTab)
    || (isSideChatTabId(activeTab) && Boolean(chatConfig) && Boolean(chatAgentsById))
    || isChangeDiffItem(activeTab)
    || activeFile !== null;
  // A persisted file tab can outlive its file. The tab strip hides that stale
  // entry, so keeping it as the visual active target would leave the fixed
  // Files tab as the only visible tab while the body tells the user to
  // OpenPixo Files. Treat the root as the display fallback without erasing
  // persisted state: an in-flight file refresh may still restore the target.
  const designFilesTabActive =
    activeTab === FILES_TAB || !activeTabHasRenderableSurface;

  // Identity-stable props for the memoized FileViewer. Without these, every
  // FileWorkspace state change (closing an adjacent tab, drag hover, launcher
  // toggles) would hand FileViewer fresh object/function identities and drag
  // the whole viewer subtree — live iframes included — through a re-render.
  const activeFileDownloadRequest = useMemo(
    () => (downloadRequest
      ? {
          name: downloadRequest.name,
          request: { nonce: downloadRequest.nonce, anchorId: downloadRequest.anchorId },
        }
      : null),
    [downloadRequest],
  );
  const stableOpenFileReplacing = useStableHandler(openFileReplacing);
  const renderFileViewer = (file: ProjectFile, workspaceActive: boolean) => (
    <FileViewer
      projectId={projectId}
      projectKind={projectKind}
      file={file}
      filesRefreshKey={filesRefreshKey}
      sourceLineRequest={sourceLineRequest?.projectId === projectId && sourceLineRequest.name === file.name ? sourceLineRequest : null}
      streaming={streaming}
      motionPreviewMuted={runInFlight}
      onFileSaved={refreshFilesWithoutResult}
      onFileWritten={onManualFileWritten}


      onOpenFileReplacing={stableOpenFileReplacing}
      downloadRequest={
        viewerOnly || activeFileDownloadRequest?.name !== file.name
          ? null
          : activeFileDownloadRequest.request
      }
      viewerOnly={viewerOnly}
      projectName={projectName}
      projectDir={resolvedDir}
      agents={handoffAgents}
      artifactId={handoffArtifactId}
      artifactKind={handoffArtifactKind}
      metricsConsent={metricsConsent}
      installationId={installationId}
      workspaceActive={workspaceActive}
    />
  );

  const activeWorkspaceContext = useMemo<WorkspaceContextItem | null>(() => {
    if (designFilesTabActive) {
      // A view root is a folder context only in 资源库, the view that browses
      // folders. Nothing to reference yet — don't auto-stage an empty chip.
      if (panelView !== 'library' || designFilesTabIsEmpty) return null;
      const trimmedDir = uploadDir.trim();
      const label = trimmedDir.split('/').filter(Boolean).pop() || t('workspace.designFiles');
      return {
        id: trimmedDir ? `folder:${trimmedDir}` : 'workspace:design-files',
        kind: trimmedDir ? 'folder' : 'design-files',
        label,
        tabId: FILES_TAB,
        ...(trimmedDir ? { path: trimmedDir } : {}),
        ...(resolvedDir ? { absolutePath: joinDisplayPath(resolvedDir, trimmedDir) } : {}),
      };
    }
    if (isTerminalTabId(activeTab)) {
      const terminalId = terminalIdFromTabId(activeTab);
      return {
        id: `terminal:${terminalId}`,
        kind: 'terminal',
        label: t('workspace.newTerminal'),
        tabId: activeTab,
      };
    }
    if (isSideChatTabId(activeTab)) {
      const conversationId = conversationIdFromSideChatTabId(activeTab);
      const conversation = conversations.find((item) => item.id === conversationId);
      return {
        id: `side-chat:${conversationId}`,
        kind: 'side-chat',
        label: conversation?.title?.trim() || t('workspace.sideChatDefaultTitle'),
        tabId: activeTab,
      };
    }
    if (activeFile) {
      const filePath = activeFile.path ?? activeFile.name;
      return {
        id: `file:${filePath}`,
        kind: 'file',
        label: filePath.split('/').filter(Boolean).pop() || filePath,
        tabId: activeTab,
        path: filePath,
        ...(resolvedDir ? { absolutePath: joinDisplayPath(resolvedDir, filePath) } : {}),
      };
    }
    return null;
  }, [
    activeFile,
    activeTab,
    panelView,
    conversations,
    designFilesTabIsEmpty,
    designFilesTabActive,
    resolvedDir,
    t,
    uploadDir,
  ]);

  useEffect(() => {
    onActiveContextChange?.(activeWorkspaceContext);
  }, [activeWorkspaceContext, onActiveContextChange]);

  // Every open item (all views), in view order: what the file palette and the
  // composer's workspace contexts list.
  const tabNames = persistedTabs;
  const orderedWorkspaceTabs = useMemo(() => orderWorkspaceTabs(tabNames), [tabNames]);

  const workspaceContexts = useMemo<WorkspaceContextItem[]>(() => {
    const out: WorkspaceContextItem[] = [];
    const seen = new Set<string>();
    const push = (item: WorkspaceContextItem | null | undefined) => {
      if (!item) return;
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(item);
    };

    const trimmedDir = uploadDir.trim();
    const designFilesLabel = trimmedDir.split('/').filter(Boolean).pop() || t('workspace.designFiles');
    push({
      id: trimmedDir ? `folder:${trimmedDir}` : 'workspace:design-files',
      kind: trimmedDir ? 'folder' : 'design-files',
      label: designFilesLabel,
      tabId: FILES_TAB,
      ...(trimmedDir ? { path: trimmedDir } : {}),
      ...(resolvedDir ? { absolutePath: joinDisplayPath(resolvedDir, trimmedDir) } : {}),
    });

    const filesByName = new Map(visibleFiles.map((file) => [file.name, file] as const));
    const terminalTabNames = tabNames.filter(isTerminalTabId);

    for (const entry of orderedWorkspaceTabs) {

      const name = entry.name;
      if (isTerminalTabId(name)) {
        const terminalId = terminalIdFromTabId(name);
        const ordinal = terminalTabNames.indexOf(name) + 1;
        push({
          id: `terminal:${terminalId}`,
          kind: 'terminal',
          label: ordinal > 1 ? `${t('workspace.newTerminal')} ${ordinal}` : t('workspace.newTerminal'),
          tabId: name,
        });
        continue;
      }

      if (isSideChatTabId(name)) {
        const conversationId = conversationIdFromSideChatTabId(name);
        const conversation = conversations.find((item) => item.id === conversationId);
        push({
          id: `side-chat:${conversationId}`,
          kind: 'side-chat',
          label: conversation?.title?.trim() || t('workspace.sideChatDefaultTitle'),
          tabId: name,
        });
        continue;
      }

      const file = filesByName.get(name);
      if (file) {
        const filePath = file?.path ?? file?.name ?? name;
        push({
          id: `file:${filePath}`,
          kind: 'file',
          label: filePath.split('/').filter(Boolean).pop() || filePath,
          tabId: name,
          path: filePath,
          ...(resolvedDir ? { absolutePath: joinDisplayPath(resolvedDir, filePath) } : {}),
        });
      }
    }

    return out;
  }, [
    [],
    conversations,
    orderedWorkspaceTabs,
    resolvedDir,
    t,
    tabNames,
    uploadDir,
    visibleFiles,
  ]);

  useEffect(() => {
    onWorkspaceContextsChange?.(workspaceContexts);
  }, [onWorkspaceContextsChange, workspaceContexts]);

  // What the current view shows instead of its root, and the name its ← bar
  // gives it. A stale stack top (a file still loading or just deleted) shows
  // the root, like the old tab strip's fallback.
  const displayedItem = designFilesTabActive ? null : activeTab;
  const libraryRootShown = panelView === 'library' && designFilesTabActive;
  function panelItemLabel(item: string): string {
    if (isTerminalTabId(item)) {
      const ordinal = tabNames.filter(isTerminalTabId).indexOf(item) + 1;
      return ordinal > 1 ? `${t('workspace.newTerminal')} ${ordinal}` : t('workspace.newTerminal');
    }
    if (isSideChatTabId(item)) {
      const conversation = conversations.find((entry) => entry.id === conversationIdFromSideChatTabId(item));
      return conversation?.title?.trim() || t('workspace.sideChatDefaultTitle');
    }
    const diffTarget = parseChangeDiffItem(item);
    if (diffTarget) return diffTarget.path.split('/').filter(Boolean).pop() || diffTarget.path;
    return item.split('/').filter(Boolean).pop() || item;
  }

  // ⋯ menu (spec §3): the former 扩展 section, the former `+` launcher's
  // terminal and file search, and engine settings. A read-only viewer gets no
  // create actions.
  const menuItems: PanelMenuItem[] = [
    {
      id: 'extensions',
      label: t('panel.menu.extensions'),
      icon: 'puzzle',
      onSelect: () => updatePanel((state) => ({ ...state, extensionsOpen: true })),
    },
    ...(viewerOnly ? [] : [{
      id: 'new-terminal',
      label: t('panel.menu.newTerminal'),
      icon: 'terminal' as const,
      onSelect: () => { void openNewTerminal(); },
    }]),
    {
      id: 'open-file',
      label: t('panel.menu.openFile'),
      icon: 'search',
      hint: isMacPlatform() ? '⌘P' : 'Ctrl+P',
      onSelect: () => setQuickSwitcherOpen(true),
    },
    ...(onOpenEngineSettings ? [{
      id: 'engine-settings',
      label: t('panel.menu.engineSettings'),
      icon: 'settings' as const,
      onSelect: onOpenEngineSettings,
    }] : []),
  ];

  return (
    <div
      className={[
        'workspace',
        '',
        '',
      ].filter(Boolean).join(' ')}
      data-testid="file-workspace"
      data-panel-view={panelView}
      ref={workspaceRootRef}
    >
      {deleteDialog}
      <PanelHeader
        view={panelView}
        onViewChange={switchView}
        changesBadge={changesBadge ?? changesViewBadge}
        ready={!initialMaterializationPending}
        focusMode={focusMode}
        onFocusModeChange={onFocusModeChange}
        menuItems={menuItems}
        leading={focusMode ? (
          // Focus mode keeps the project tab strip on this same row (the chat
          // column — its usual dock — is collapsed): the strip portals in
          // here, before the view switcher. See workspaceTabsDock.ts.
          <div
            className="ws-tabs-project-dock"
            data-testid="workspace-tabs-dock-focus"
            ref={focusTabsDockRef}
          />
        ) : null}
        actions={fileActionsBefore || headerActions ? (
          <>
            {fileActionsBefore ? <div className="ws-tabs-file-actions-before">{fileActionsBefore}</div> : null}
            {headerActions}
          </>
        ) : null}
      />

      {/* Workspace-owned toasts anchor to this pane's bottom-center instead of
          the viewport's: a bare fixed .pixo-toast centers across the whole
          window, drifting over the chat pane and covering the composer send
          area in split view. */}
      {launcherToast ? (
        <div className="workspace-toast-anchor">
          <Toast
            message={launcherToast.message}
            tone={launcherToast.tone}
            role={launcherToast.tone === 'error' ? 'alert' : 'status'}
            ttlMs={40000}
            onDismiss={() => setLauncherToast(null)}
          />
        </div>
      ) : null}
      {/* The banner asserts a reason ("this is a shared project"), so it renders
          only when the caller knows one. `viewerOnly` is fail-closed and is also
          true while ownership is still unproven -- falling back to the generic
          copy there told a personal project's owner it was someone else's
          shared project for as long as the workspace context took to resolve
          (OPEND-2283). Controls stay disabled either way; only the claim waits. */}
      {viewerOnly && readonlyNotice && !initialMaterializationPending ? (
        <div className="workspace-readonly-notice" role="status">
          <Icon name="lock" size={14} />
          <span>{readonlyNotice}</span>
        </div>
      ) : null}
      <div className="ws-body">
        {initialMaterializationPending ? (
          <FilesPanel
            projectId={projectId}
            projectKind={projectKind}
            viewerOnly
            downloadPending
            files={[]}
            folders={[]}
            onRefreshFiles={noop}
            onOpenFile={noop}
            onRenameFile={rejectRenameWhileMaterializing}
            onDeleteFile={noop}
            onDeleteFiles={noop}
            onUpload={noop}
            onUploadFiles={noop}
            onPaste={noop}
          />
        ) : (
          <>
            <PanelStackBar
              label={displayedItem ? panelItemLabel(displayedItem) : null}
              title={displayedItem ?? undefined}
              onBack={popPanel}
              fileActionsVisible={viewerFileActive}
              focusRequest={stackFocusRequest}
            />
            {/* FilesPanel shows its own upload banner at the 资源库 list root;
                everywhere else (a viewer the upload auto-opened, another view)
                this fallback keeps a partial failure visible. */}
            {uploadError && !libraryRootShown ? (
              <div className="df-upload-banner" data-testid="upload-error-banner">
                <span>{uploadError}</span>
                <button
                  type="button"
                  data-testid="upload-error-dismiss"
                  onClick={() => setUploadError(null)}
                >
                  {t('common.dismiss')}
                </button>
              </div>
            ) : null}
            <GameView
              key={`game:${projectId}`}
              projectId={projectId}
              projectName={projectName}
              hidden={!(panelView === 'game' && designFilesTabActive)}
              controls={gameControls}
              viewerOnly={viewerOnly}
              probeHeld={projectReadsHeld}
              onOpenEngineSettings={onOpenEngineSettings}
              onOpenAccount={onOpenAccount}
              refreshKey={filesRefreshKey}
              onOpenFileAtLine={(path, line) => openFileAtLine(path, line)}
              onRefreshFiles={refreshFilesWithoutResult}
            />
            <ChangesView
              key={`changes:${projectId}`}
              projectId={projectId}
              hidden={!(panelView === 'changes' && designFilesTabActive)}
              active={panelView === 'changes'}
              conversationId={conversationId}
              messages={messages}
              runInFlight={runInFlight}
              refreshKey={filesRefreshKey}
              files={visibleFiles}
              resolvedDir={resolvedDir}
              viewerOnly={viewerOnly}
              toolbarActions={changesActions}
              onOpenItem={(item) => openInPanel(item, 'changes')}
              onBadgeChange={setChangesViewBadge}
            />
            <GenerateView
              key={`generate:${projectId}`}
              projectId={projectId}
              files={visibleFiles}
              viewerOnly={viewerOnly}
              hidden={!(panelView === 'generate' && designFilesTabActive)}
              active={panelView === 'generate'}
              initialRecipeId={panel.initialRecipeId}
              referencePaths={panel.studioReferencePaths}
              referenceRequest={panel.studioReferenceRequest}
              onOpenFile={openInLibrary}
              onRefreshFiles={refreshFilesWithoutResult}
              onOpenExtensions={() => updatePanel((state) => ({ ...state, extensionsOpen: true }))}
              onOpenAccount={onOpenAccount}
            />
            <LibraryView
              key={`library:${projectId}`}
              hidden={!libraryRootShown}
              typeFilterRequest={panel.libraryTypeRequest}
              onOpenStudio={openStudio}
              renderBrowser={(library) => (
                <FilesPanel
                  {...library}
                  key={projectId}
                  projectId={projectId}
                  projectKind={projectKind}
                  filesRefreshKey={filesRefreshKey}
                  viewerOnly={viewerOnly}
                  filesAuthoritative={filesAuthoritative}
                  emptyLookBeforeFirstListing={emptyLookBeforeFirstListing}
                  rootDirName={rootDirName}
                  resolvedDir={resolvedDir}
                  reloading={reloading}
                  running={runInFlight}
                  runStartedAt={runStartedAt}
                  runSteps={runSteps}
                  files={visibleFiles}
                  folders={projectFolders}
                  onRefreshFiles={refreshFilesWithoutResult}
                  onCurrentDirChange={setUploadDir}
                  navState={designFilesNavRef.current}
                  onNavStateChange={onFilesNavStateChange}
                  onOpenFile={openInLibrary}
                  onRenameFile={handleRename}
                  onDeleteFile={(name) => {
                    trackFileManagerClick(analytics.track, {
                      page_name: 'file_manager',
                      area: 'file_manager',
                      element: 'delete',
                      project_id: projectId,
                      project_kind: projectKind,
                    });
                    void handleDelete(name);
                  }}
                  onDeleteFiles={(names) => {
                    trackFileManagerClick(analytics.track, {
                      page_name: 'file_manager',
                      area: 'file_manager',
                      element: 'delete',
                      project_id: projectId,
                      project_kind: projectKind,
                    });
                    return handleDeleteMany(names);
                  }}
                  onUpload={() => {
                    trackFileManagerClick(analytics.track, {
                      page_name: 'file_manager',
                      area: 'file_manager',
                      element: 'upload',
                      project_id: projectId,
                      project_kind: projectKind,
                    });
                    fileInputRef.current?.click();
                  }}
                  onUploadFiles={(picked) => void uploadFiles(picked)}
                  onPaste={() => {
                    trackFileManagerClick(analytics.track, {
                      page_name: 'file_manager',
                      area: 'file_manager',
                      element: 'paste',
                      project_id: projectId,
                      project_kind: projectKind,
                    });
                    void createMarkdownDocument();
                  }}
                  onDuplicateProject={onDuplicateProject}
                  duplicateProjectBusy={duplicateProjectBusy}
                  uploadError={uploadError}
                  onClearUploadError={() => setUploadError(null)}
                  onPluginFolderAgentAction={onPluginFolderAgentAction}
                  activePluginActionPaths={activePluginActionPaths}
                  hiddenPluginActionPaths={hiddenPluginActionPaths}
                />
              )}
            />
            {displayedItem && isSideChatTabId(displayedItem) && chatConfig && chatAgentsById ? (
              <SideChatTab
                key={`${projectId}:${displayedItem}`}
                projectId={projectId}
                conversationId={conversationIdFromSideChatTabId(displayedItem)}
                config={chatConfig}
                agentsById={chatAgentsById}
                locale={chatLocale ?? 'en'}
                projectFiles={visibleFiles}
                projectFileNames={sideChatFileNames}
                projectResolvedDir={resolvedDir}
                conversations={conversations}
                onSelectConversation={onSelectConversation ?? (() => {})}
                onDeleteConversation={onDeleteConversation ?? (() => {})}
                onRenameConversation={onRenameConversation}
                onSessionModeChange={onConversationSessionModeChange}
                onNewConversation={onNewConversation}
                activeConversationChat={activeConversationChat}
                recoveryActionsBlockedReason={chatRecoveryActionsBlockedReason}
                // A side chat is a conversation: its file links open in 资源库.
                onRequestOpenFile={openFromConversation}
              />
            ) : displayedItem && isChangeDiffItem(displayedItem) ? (
              <ChangeDiffViewer
                key={`${projectId}:${displayedItem}`}
                projectId={projectId}
                checkpointId={parseChangeDiffItem(displayedItem)!.checkpointId}
                path={parseChangeDiffItem(displayedItem)!.path}
                refreshKey={filesRefreshKey}
                onOpenFile={(path) => openInPanel(path, panelView)}
              />
            ) : displayedItem && isTerminalTabId(displayedItem) ? (
              <TerminalViewer
                key={displayedItem}
                projectId={projectId}
                terminalId={terminalIdFromTabId(displayedItem)}
                onClose={() => closePanelItem(displayedItem)}
                onSessionIdChange={handleTerminalSessionChange}
              />
            ) : null}
          </>
        )}

        {!initialMaterializationPending ? mountedHtmlViewerFiles.map((file) => {
          const workspaceActive = activeHtmlViewerFile?.name === file.name;
          return (
            <div
              key={`${projectId}:${file.name}`}
              ref={(element) => {
                syncInertAttribute(element, !workspaceActive);
              }}
              data-testid="retained-file-viewer"
              data-file-name={file.name}
              aria-hidden={workspaceActive ? undefined : true}
              style={{
                display: 'flex',
                flex: workspaceActive ? '1 1 auto' : undefined,
                flexDirection: 'column',
                minHeight: 0,
                ...(workspaceActive
                  ? {}
                  : RETAINED_VIEWER_INACTIVE_STYLE),
              }}
            >
              {renderFileViewer(file, workspaceActive)}
            </div>
          );
        }) : null}
        {!initialMaterializationPending && viewerFile ? (
          <div
            ref={(element) => {
              syncInertAttribute(element, !viewerFileActive);
            }}
            data-testid="retained-file-viewer"
            aria-hidden={viewerFileActive ? undefined : true}
            style={{
              display: 'flex',
              flex: viewerFileActive ? '1 1 auto' : undefined,
              flexDirection: 'column',
              minHeight: 0,
              ...(viewerFileActive
                ? {}
                : RETAINED_VIEWER_INACTIVE_STYLE),
            }}
          >
            {renderFileViewer(viewerFile, viewerFileActive)}
          </div>
        ) : null}
        {!initialMaterializationPending ? (
          <PanelSheet
            open={panel.extensionsOpen}
            title={t('panel.menu.extensions')}
            onClose={() => updatePanel((state) => ({ ...state, extensionsOpen: false }))}
            testId="panel-extensions-sheet"
          >
            {viewerOnly
              ? <p className={viewToolbarStyles.sheetNotice}>{t('gameAssets.readOnly')}</p>
              : <ProjectExtensionsPanel key={projectId} projectId={projectId} locale={locale} embedded />}
          </PanelSheet>
        ) : null}
      </div>

      {!initialMaterializationPending ? <input
        ref={fileInputRef}
        type="file"
        multiple
        data-testid="file-list-upload-input"
        style={{ display: 'none' }}
        onChange={handleFilePicked}
      /> : null}
      <AnimatePresence>
        {!initialMaterializationPending && quickSwitcherOpen ? (
          <QuickSwitcher
            projectId={projectId}
            files={visibleFiles}
            workspaceContexts={workspaceContexts}
            onOpenFile={(name) => {
              // The palette searches the project's files: they open in 资源库.
              openInLibrary(name);
              setQuickSwitcherOpen(false);
            }}
            onOpenTab={(tabId) => {
              focusPanelItem(tabId);
              setQuickSwitcherOpen(false);
            }}
            onClose={() => setQuickSwitcherOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function normalizeProjectFilePath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/');
}

function joinProjectFilePath(dir: string, name: string): string {
  const normalizedDir = normalizeProjectFilePath(dir);
  return normalizedDir ? `${normalizedDir}/${name}` : name;
}

function nextMarkdownDocumentPath(files: ProjectFile[], dir: string): string {
  const existing = new Set(files.map((file) => normalizeProjectFilePath(file.name).toLowerCase()));
  for (let index = 1; index < 1000; index += 1) {
    const name = index === 1 ? 'document.md' : `document-${index}.md`;
    const candidate = joinProjectFilePath(dir, name);
    if (!existing.has(normalizeProjectFilePath(candidate).toLowerCase())) return candidate;
  }
  return joinProjectFilePath(dir, `document-${Date.now()}.md`);
}

function initialMarkdownDocument(
  path: string,
  projectKind: TrackingProjectKind,
  t: TranslateFn,
): string {
  const title = normalizeProjectFilePath(path)
    .split('/')
    .pop()
    ?.replace(/\.mdx?$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase()) || t('filesPanel.documentTemplate.titleFallback');
  return `# ${title}

## ${t('filesPanel.documentTemplate.goalHeading')}

${t('filesPanel.documentTemplate.goalBody')}

## ${t('filesPanel.documentTemplate.capabilitiesHeading')}

- ${t('filesPanel.documentTemplate.capabilityMarkdown')}
- ${t('filesPanel.documentTemplate.capabilityAgent')}
- ${t('filesPanel.documentTemplate.capabilityImages')}

## ${t('filesPanel.documentTemplate.scenarioHeading')}

## ${t('filesPanel.documentTemplate.nextHeading')}

${t('filesPanel.documentTemplate.nextBody')}
`;
}

function tabsStateKey(projectId: string, state: OpenTabsState): string {
  return [projectId, state.active ?? '', ...state.tabs].join('\u0000');
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * Elements whose own Esc must not pop the panel's view stack: text entry
 * (the terminal's input is an xterm helper textarea), and anything inside an
 * open menu or sheet.
 */
function isEscapeOwningTarget(target: Element): boolean {
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm')) return true;
  return Boolean(target.closest('[role="menu"], [role="listbox"], [role="dialog"]'));
}

function orderWorkspaceTabs(fileTabNames: string[]): WorkspaceOrderedTab[] {
  return fileTabNames.map(name => ({ id: name, kind: 'file', name }));
}
