// EntryShell — the centered-hero entry layout.
//
// This component owns the entire JSX render and local UI state for the home
// view (left rail + hero + projects views + new-project modal) and routes the
// first-run `/onboarding` view to `OnboardingView`. `EntryView` is a thin
// wrapper that passes data and callbacks through to this shell.

import { GeneratePage } from './generate/GeneratePage';
import { StoreProjectActions } from './StoreProjectActions';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { defaultScenarioPluginIdForProjectMetadata, type ChatSessionMode, type CreateProjectExampleReference, type RunContextSelection } from '@openpixo/contracts';
import type { OpenPixoHostProjectImportSuccess } from '@openpixo/host';
import { useAnalytics } from '../analytics/provider';
import { trackHomeNavClick, trackPageView } from '../analytics/events';
import { useI18n } from '../i18n';
import { navigate, useRoute } from '../router';
import type {
  AgentInfo,
  ApiProtocol,
  AppConfig,
  ExecMode,
  Project,
  ProjectMetadata,
  PromptTemplateSummary,
  SkillSummary,
} from '../types';
import { CenteredLoader } from './Loading';
import { ProjectsPanel } from './ProjectsPanel';
import { EntryNavRail, type EntryView as EntryViewKind } from './EntryNavRail';
import {
  buildProjectSearchCatalog,
  ProjectSearchModal,
} from './ProjectSearchModal';
import { UpdaterPopup } from './UpdaterPopup';
import { WhatsNewPopup } from './WhatsNewPopup';
import { clearHomeComposerDraft, HomeView, type HomeComposerSubmit } from './HomeView';
import { entryStrategyRoutingFields } from './entry-strategy-routing';
import { homeWorkingDirCreateFields } from './home-working-dir';
import { EntryBlankState } from './EntryBlankState';
import { RecentProjectsStrip, type ProjectCollectionScope } from './RecentProjectsStrip';
import {
  takeHomePromptHandoff,
  type HomePromptHandoff,
} from './home-hero/plugin-authoring';
import { Button } from '@openpixo/components';
import styles from './EntryShell.module.css';
import { IntegrationsView, type IntegrationTab } from './IntegrationsView';
import { InlineModelSwitcher } from './InlineModelSwitcher';
import { type EntrySettingsSection } from './EntrySettingsMenu';
import { NewProjectModal } from './NewProjectModal';
import type { CreateInput } from './NewProjectPanel';
import type { PluginShareAction, PluginShareProjectOutcome } from '../state/projects';
import { OnboardingView } from './onboarding/OnboardingView';
import { SignInDialog } from './account/SignInDialog';
import onboardingStyles from './onboarding/Onboarding.module.css';
import { NewGameDialog } from './NewGameDialog';
import { homeSubmitOpensSetup } from './new-game/setup-routing';
import { NoAgentNotice } from './home/NoAgentNotice';
import { SAMPLE_TEMPLATE_ID, useQuickSample } from './new-game/quick-sample';
import { isMacPlatform } from '../utils/platform';
import { smoothScrollToTop } from '../utils/smoothScrollToTop';
import { summarizeProjectNameFromPrompt } from '../utils/projectName';
import type { ProviderModelsCache } from './providerModelsCache';
import {
  ENTRY_RAIL_STATE_EVENT,
  ENTRY_RAIL_TOGGLE_EVENT,
  ENTRY_SEARCH_OPEN_EVENT,
  readStoredRailOpen,
  requestEntryNewGame,
  writeStoredRailOpen,
} from './entryRailBridge';
import { railWidthProperties, useRailWidth } from './entry-nav-rail/rail-width';

// The entry nav-rail is open by default; an explicit collapse is persisted so
// it survives both a home -> project -> home navigation (EntryShell unmounts on
// the project route) and a full reload. The storage key, the rail toggle/state
// window events, and the reader/writer live in `entryRailBridge` so the pinned
// Home tab's sidebar toggle (WorkspaceTabsBar, a sibling React tree) can share
// them without importing this module's graph.
export { ENTRY_RAIL_STATE_EVENT, ENTRY_RAIL_TOGGLE_EVENT };


type EntryCreateProjectInput = Omit<CreateInput, 'metadata'> & {
  metadata?: CreateInput['metadata'];
  pendingPrompt?: string;
  pluginId?: string;
  pluginSource?: string;
  pluginType?: string;
  appliedPluginSnapshotId?: string;
  pluginInputs?: Record<string, unknown>;
  /** Official example card the user picked under the automatic route. */
  exampleReference?: CreateProjectExampleReference;
  initialRunContext?: RunContextSelection | null;
  conversationMode?: ChatSessionMode;
  autoSendFirstMessage?: boolean;

  /**
   * The optimistic project already flushed by `onBeginProjectCreation`. The
   * create reuses this id (the daemon accepts a caller-minted id) instead of
   * starting a second hand-off.
   */
  optimisticProjectId?: string;
  requestId?: string;
  pendingFiles?: File[];
  userWorkingDirToken?: string;
  linkedDirs?: string[] | null;
};

/**
 * What App hands back once a Home send has entered the project frame
 * optimistically: the client-minted project id the create must reuse, and the
 * way to undo the hand-off (drop the optimistic row, return to Home with the
 * draft and staged files intact) when no project is going to be created —
 * a dismissed balance dialog, or a gate that could not answer.
 */
export interface OptimisticProjectCreationHandoff {
  projectId: string;
  rollback: (options?: { notice?: string }) => void;
}

function defaultPluginIdForMetadata(metadata: ProjectMetadata): string | null {
  return defaultScenarioPluginIdForProjectMetadata(metadata);
}

function defaultPluginInputsForCreate(
  input: CreateInput,
  pluginId: string | null,
): Record<string, unknown> | null {
  const kind = input.metadata.kind;
  const projectName = input.name.trim();

  if (pluginId !== 'pixo-media-generation') return null;
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return null;

  const promptTemplate = input.metadata.promptTemplate;
  const subject =
    promptTemplate?.prompt?.trim()
    || projectName
    || promptTemplate?.title?.trim()
    || `${kind} concept`;
  const style =
    promptTemplate?.summary?.trim()
    || 'cinematic, high-quality, game-ready';
  const aspect =
    kind === 'image'
      ? input.metadata.imageAspect
      : kind === 'video'
        ? input.metadata.videoAspect
        : undefined;

  return {
    mediaKind: kind,
    subject,
    style,
    ...(aspect ? { aspect } : {}),
  };
}

export interface ProjectTitleHint {
  name: string;
}

interface Props {
  skills: SkillSummary[];
  projects: Project[];
  promptTemplates: PromptTemplateSummary[];
  integrationInitialTab?: IntegrationTab;
  skillsLoading?: boolean;
  projectsLoading?: boolean;
  projectsLoadFailed?: boolean;
  // Execution / model-switching context. Threaded down from `App` so the
  // top-bar `InlineModelSwitcher` can render the active mode/agent/model
  // and persist changes through the same callbacks the project view uses.
  config: AppConfig;
  providerModelsCache?: ProviderModelsCache;
  onProviderModelsCacheChange?: Dispatch<SetStateAction<ProviderModelsCache>>;
  agents: AgentInfo[];
  // True until the cold-start agent detection stream reaches `done`.
  agentsLoading?: boolean;


  daemonLive: boolean;
  onModeChange: (mode: ExecMode) => void;
  onAgentChange: (id: string) => void;
  onAgentModelChange: (
    id: string,
    choice: { model?: string; reasoning?: string; serviceTier?: string },
  ) => void;
  onApiProtocolChange: (protocol: ApiProtocol) => void;
  onApiModelChange: (model: string) => void;
  onConfigPersist: (cfg: AppConfig) => Promise<void> | void;
  onResetOnboarding?: (next: AppConfig) => void;
  /** True only when GET /api/app-config returned a real config object. */
  daemonAppConfigReady?: boolean;
  /** Non-optimistic daemon write for the silent-update preference. */
  onSilentUpdatePreferenceChange?: (allowSilentUpdates: boolean) => Promise<void>;
  onSkillsRefresh?: () => Promise<void> | void;
  onSkillsChanged?: (affectedSkillId?: string) => void;
  onRefreshAgents: () => Promise<AgentInfo[]> | AgentInfo[];
  onCreateProject: (input: EntryCreateProjectInput) => Promise<boolean> | boolean | void;
  /**
   * Flush the optimistic project frame for a Home send on the click tick,
   * before any admission check. Owned by App because the hand-off leaves the
   * Home route (and unmounts this shell).
   */
  onBeginProjectCreation: (input: EntryCreateProjectInput) => OptimisticProjectCreationHandoff;

  onCreatePluginShareProject: (
    pluginId: string,
    action: PluginShareAction,
    locale?: string,
  ) => Promise<PluginShareProjectOutcome>;
  onImportFolder?: (baseDir: string) => Promise<void> | void;
  onImportFolderResponse?: (response: OpenPixoHostProjectImportSuccess) => Promise<void> | void;
  onOpenProject: (
    id: string,
    fileName?: string,
    projectTitleHint?: ProjectTitleHint,
  ) => Promise<boolean> | boolean | void;
  onDeleteProject: (id: string) => Promise<boolean | void> | boolean | void;
  onDuplicateProject?: (id: string) => Promise<void> | void;
  onRenameProject: (id: string, name: string) => void;
  onProjectsRefresh?: () => Promise<void> | void;
  onOpenSettings: (section?: EntrySettingsSection) => void;
  onCompleteOnboarding: () => void;


}

// Map an EntryNavRail view id to the existing analytics `element` enum on
// `home/nav` ui_click. Keep this compatibility signal alongside the new
// Workspace navigation dimensions so established PostHog dashboards do not
// lose their historical series.
function navElementForView(
  next: EntryViewKind,
):
  | 'home'
  | 'projects'
  | 'integrations'
  | null {
  switch (next) {
    case 'home':
      return 'home';
    case 'projects':
      return 'projects';
    case 'integrations':
      return 'integrations';
    default:
      return null;
  }
}

// Tab views stay mounted (so previews/thumbnails survive a tab switch) but the
// inactive ones must leave layout, the accessibility tree, and tab order.
// `content-visibility: hidden` still reserves the hidden pane's block size,
// which pushes later sidebar destinations far below the sticky topbar.
function inactiveViewProps(active: boolean) {
  return {
    style: active ? undefined : ({ display: 'none' } as const),
    inert: !active,
    'aria-hidden': !active,
  };
}

export function EntryShell({
  skills,
  projects,
  promptTemplates,
  integrationInitialTab = 'mcp',
  skillsLoading = false,
  projectsLoading = false,
  projectsLoadFailed = false,
  config,
  providerModelsCache: sharedProviderModelsCache,
  onProviderModelsCacheChange,
  agents,
  agentsLoading = false,


  daemonLive,
  onModeChange,
  onAgentChange,
  onAgentModelChange,
  onApiProtocolChange,
  onApiModelChange,
  onConfigPersist,
  onResetOnboarding,
  daemonAppConfigReady = false,
  onSilentUpdatePreferenceChange,
  onSkillsRefresh,
  onSkillsChanged,
  onRefreshAgents,
  onCreateProject,
  onBeginProjectCreation,

  onImportFolder,
  onImportFolderResponse,
  onOpenProject,
  onDeleteProject,
  onDuplicateProject,
  onRenameProject,
  onProjectsRefresh,
  onOpenSettings,
  onCompleteOnboarding,


}: Props) {
  const { t } = useI18n();
  // Each entry view has its own URL for navigation and deep links.
  const route = useRoute();
  const view: EntryViewKind = route.kind === 'home' ? route.view : 'home';


  const homeProjectsList = projects;
  const projectSearchProjects = buildProjectSearchCatalog(projects, []);
  const [pullingProjectId, setPullingProjectId] = useState<string | null>(null);
  // The 全部项目 page's collection tab (OPEND-3108). The legacy `all-projects`
  // view is a deep link to the 团队项目 tab; every other entry keeps whatever
  // tab the user last picked.
  const [projectsCollection, setProjectsCollection] = useState<ProjectCollectionScope>('recent');
  useEffect(() => {
    // Entering the page from the rail opens 最近浏览过 (the Demo's strip
    // remounts on every visit, so it never carries a tab over); the legacy
    // `/all-projects` view is the one deep link that lands on 团队项目.
    if (view === 'all-projects' || view === 'drafts') setProjectsCollection('recent');
  }, [view]);
  async function handleOpenAllProjects(id: string): Promise<boolean> {
    return (await onOpenProject(id)) !== false;
  }

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [homeSetup, setHomeSetup] = useState<{ prompt: string; files: File[] } | null>(null);
  const onboardingSample = useQuickSample(onImportFolderResponse);
  const [signInOpen, setSignInOpen] = useState(false);
  // Home has NO low-balance surface, and since T66 (product 2026-09-07) neither
  // does anywhere else: a positive balance produces nothing at all and the run
  // just starts. Home reached that end state first — ruling 2026-09-06 (T53),
  // "什么都不显示,有余额就允许运行" — and the project page has now been pulled
  // level with it, so `handlePluginLoopSubmit` having no low-balance branch is
  // simply the shape of the gate: there is no such result kind to handle.
  // The rail keeps its own compact expand affordance when collapsed. It opens
  // by default; only a user toggle (`toggleRail`) is persisted, so a default
  // is never written back as if it were a choice.
  const [railOpen, setRailOpen] = useState<boolean>(readStoredRailOpen);
  const railWidth = useRailWidth();
  const railToggledRef = useRef(false);
  const toggleRail = useCallback(() => {
    railToggledRef.current = true;
    setRailOpen((open) => !open);
  }, []);
  const [projectSearchOpen, setProjectSearchOpen] = useState(false);

  // ⌘K / Ctrl+K opens the project search palette — same as clicking the rail
  // search item. ⌘B / Ctrl+B toggles the nav rail, like its header toggle.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.isComposing
        || (
          target instanceof Element
          && target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
          )
        )
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        setProjectSearchOpen(true);
        return;
      }
      const primary = isMacPlatform()
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (
        primary &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === 'b' || event.key === 'B')
      ) {
        event.preventDefault();
        toggleRail();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleRail]);
  useEffect(() => {
    if (railToggledRef.current) {
      railToggledRef.current = false;
      writeStoredRailOpen(railOpen);
    }
    // Broadcast the state so chrome outside this tree (the pinned Home tab's
    // sidebar toggle) can mirror it via aria-expanded.
    window.dispatchEvent(
      new CustomEvent(ENTRY_RAIL_STATE_EVENT, { detail: { open: railOpen } }),
    );
  }, [railOpen]);

  // The pinned Home tab (WorkspaceTabsBar) carries a sidebar toggle; it lives
  // in a sibling tree, so the request arrives as a window event.
  useEffect(() => {
    window.addEventListener(ENTRY_RAIL_TOGGLE_EVENT, toggleRail);
    return () => window.removeEventListener(ENTRY_RAIL_TOGGLE_EVENT, toggleRail);
  }, [toggleRail]);
  // Same story for the search button, which sits in that chrome row beside the
  // rail toggle (per product: 搜索和收起跟 home icon 一起放在顶部) while the
  // palette it opens is owned here.
  useEffect(() => {
    const onOpen = () => setProjectSearchOpen(true);
    window.addEventListener(ENTRY_SEARCH_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ENTRY_SEARCH_OPEN_EVENT, onOpen);
  }, []);
  const [localProviderModelsCache, setLocalProviderModelsCache] =
    useState<ProviderModelsCache>({});
  const hasSharedProviderModelsCache =
    Boolean(sharedProviderModelsCache) && Boolean(onProviderModelsCacheChange);
  const activeProviderModelsCache =
    hasSharedProviderModelsCache
      ? sharedProviderModelsCache!
      : localProviderModelsCache;
  const activeSetProviderModelsCache =
    hasSharedProviderModelsCache
      ? onProviderModelsCacheChange!
      : setLocalProviderModelsCache;
  const [integrationTab, setIntegrationTab] = useState<IntegrationTab>(integrationInitialTab);
  // Lazy initializer, so a handoff published by a surface that then navigated
  // here — the `/marketplace/<id>` detail route, which `App` renders outside
  // this shell — is claimed on the very first render and reaches HomeView in
  // the same commit as the mount. The read is destructive, so it applies once.
  const [homePromptHandoff] = useState<HomePromptHandoff | null>(
    () => takeHomePromptHandoff(),
  );
  const entryMainScrollRef = useRef<HTMLElement | null>(null);
  // Entry views share this element, so route changes must not inherit the previous view's offset.
  useLayoutEffect(() => {
    const scrollContainer = entryMainScrollRef.current;
    if (!scrollContainer) return;
    scrollContainer.scrollTop = 0;
  }, [view]);
  const analytics = useAnalytics();

  function changeView(next: EntryViewKind) {
    const navElement = navElementForView(next);
    if (navElement) {
      trackHomeNavClick(analytics.track, {
        page_name: 'home',
        area: 'nav',
        element: navElement,
      });
    }
    navigate({ kind: 'home', view: next });
  }

  // Always-mounted entry views receive an explicit isActive prop below.
  useEffect(() => {
    if (view === 'drafts') trackPageView(analytics.track, { page_name: 'drafts' });
    else if (view === 'all-projects') trackPageView(analytics.track, { page_name: 'all_projects' });
  }, [analytics.track, view]);

  useEffect(() => {
    if (view !== 'home' || !homePromptHandoff) return;
    const frame = window.requestAnimationFrame(() => {
      const scrollContainer = entryMainScrollRef.current;
      if (!scrollContainer) return;
      smoothScrollToTop(scrollContainer);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [homePromptHandoff?.id, view]);

  // The frosted top edge exists to melt content that scrolls UP under the tab
  // strip. At rest nothing is under it, but it blurred anyway — and because
  // `.entry-main__inner` starts its content at 12px, every page's h2 sat inside
  // that 32px band and read as a smudged dark block behind the title
  // (acceptance #28). Gate the blur on actually being scrolled.
  useEffect(() => {
    const scrollContainer = entryMainScrollRef.current;
    if (!scrollContainer) return;
    const sync = () => {
      scrollContainer.classList.toggle('is-scrolled', scrollContainer.scrollTop > 0);
    };
    sync();
    scrollContainer.addEventListener('scroll', sync, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', sync);
  }, [view]);

  useEffect(() => {
    setIntegrationTab(integrationInitialTab);
  }, [integrationInitialTab]);

  function openIntegrationTab(tab: IntegrationTab) {
    setIntegrationTab(tab);
    changeView('integrations');
  }

  function openNewProject() {
    setNewProjectOpen(true);
  }

  function handleCreate(input: CreateInput) {
    // Resolve optional scenario inputs through the shared defaults so media
    // projects use the same retained scenario as the daemon's create path.
    const pluginId = defaultPluginIdForMetadata(input.metadata);
    const pluginInputs = defaultPluginInputsForCreate(input, pluginId);
    const { skillSelectionProvenance, ...projectInput } = input;
    return onCreateProject({
      ...projectInput,
      ...(pluginInputs
          ? { pluginInputs }
          : {}),
    });
  }

  // Plan §3.F5 — the home prompt-loop submit path. The user picks a
  // plugin (which calls /api/plugins/:id/apply and binds a snapshot),
  // edits the rendered example query if any, then presses Enter. We
  // derive a project name from the active plugin (or prompt head),
  // forward the pluginId so POST /api/projects pins the snapshot to
  // project + conversation, and request auto-send of the first
  // message so the user lands inside a running pipeline.
  //
  // Stage B of plugin-driven-flow-plan: the rail can stamp a
  // `projectKind` on the payload so the created project records the
  // chosen surface (image / video / audio, etc.). Free-form Home
  // submits carry projectKind='other', so the agent infers the task type and asks only
  // when the brief cannot be routed reliably.
  async function handlePluginLoopSubmit(payload: HomeComposerSubmit) {
    // A new game starts in its setup. The composer keeps the text until a game
    // is actually created, so cancelling loses nothing.
    if (onImportFolderResponse && homeSubmitOpensSetup(payload)) {
      setHomeSetup({ prompt: payload.prompt, files: payload.attachments ?? [] });
      return 'blocked' as const;
    }

    const createInput = pluginLoopCreateInput(payload);

    // Without known negative evidence, the project frame opens on the click tick,
    // before any admission check. Everything below runs behind that frame —
    // this shell is unmounted the moment the hand-off navigates, so nothing
    // after this line may rely on this instance's state or DOM. App owns the
    // hand-off and the way back.
    const handoff = onBeginProjectCreation(createInput);
    return onCreateProject({
      ...createInput,
      optimisticProjectId: handoff.projectId,

    });
  }

  /**
   * The create request a Home composer send turns into. Pure: it reads only
   * the payload, so it can be computed before the optimistic hand-off and
   * reused by the create that follows the admission check.
   */
  function pluginLoopCreateInput(payload: HomeComposerSubmit): EntryCreateProjectInput {
    const summarizedName = summarizeProjectNameFromPrompt(payload.prompt);
    const head = payload.prompt.trim().split(/\s+/).slice(0, 8).join(' ');
    const firstAttachmentName = payload.attachments?.[0]?.name ?? '';
    const fallbackName =
      summarizedName || (head.length > 0 ? head : firstAttachmentName || 'Untitled');
    const name =
      payload.pluginTitle && payload.pluginTitle.trim().length > 0
        ? payload.pluginTitle.trim()
        : fallbackName;
    const workingDirFields = homeWorkingDirCreateFields(payload);
    const metadata: ProjectMetadata = {
      ...(payload.projectMetadata ?? {}),
      kind: payload.projectKind ?? payload.projectMetadata?.kind ?? 'prototype',
      nameSource: 'prompt',
      ...(payload.contextPlugins && payload.contextPlugins.length > 0
        ? { contextPlugins: payload.contextPlugins }
        : {}),
      ...(payload.contextMcpServers && payload.contextMcpServers.length > 0
        ? { contextMcpServers: payload.contextMcpServers }
        : {}),
      ...workingDirFields.metadata,
    };
    const strategyRoutingFields = entryStrategyRoutingFields(payload, metadata);
    return {
      name,
      ...strategyRoutingFields,
      metadata,
      pendingPrompt: payload.prompt,
      ...(payload.pluginId
        ? { pluginId: payload.pluginId }
        : {}),
      ...(payload.pluginSource
        ? { pluginSource: payload.pluginSource }
        : {}),
      ...(payload.pluginType
        ? { pluginType: payload.pluginType }
        : {}),
      ...(payload.appliedPluginSnapshotId
        ? { appliedPluginSnapshotId: payload.appliedPluginSnapshotId }
        : {}),
      ...(payload.initialRunContext ? { initialRunContext: payload.initialRunContext } : {}),
      ...(payload.conversationMode ? { conversationMode: payload.conversationMode } : {}),
      ...(payload.attachments && payload.attachments.length > 0
        ? { pendingFiles: payload.attachments }
        : {}),
      ...(workingDirFields.userWorkingDirToken
        ? { userWorkingDirToken: workingDirFields.userWorkingDirToken }
        : {}),
      autoSendFirstMessage: true,
    };
  }


  function finishOnboarding() {
    onCompleteOnboarding();

    changeView('home');
  }

  // The rail supplies the updater; its trigger renders in the chrome host
  // once an installer is ready.
  const updaterSlot = (
    <UpdaterPopup
      allowSilentUpdates={config.allowSilentUpdates}
      silentUpdatePreferenceReady={daemonAppConfigReady}
      onAllowSilentUpdatesChange={
        onSilentUpdatePreferenceChange
          ?? ((allowSilentUpdates) => onConfigPersist({ ...config, allowSilentUpdates }))
      }
    />
  );

  // #5517 removes the entry top-bar settings cog: the nav-rail account menu owns
  // the settings entry (EntryNavRail onOpenSettings), so the top strip no longer
  // carries a redundant one.


  if (view === 'onboarding') {
    return (
      <div className="entry-shell entry-shell--no-header entry-shell--onboarding">
        <main className={onboardingStyles.shellMount} aria-label={t('settings.welcomeTitle')}>
          <OnboardingView
            config={config}
            agents={agents}
            agentsLoading={agentsLoading}
            providerModelsCache={activeProviderModelsCache}
            onProviderModelsCacheChange={activeSetProviderModelsCache}
            daemonLive={daemonLive}
            onModeChange={onModeChange}
            onAgentChange={onAgentChange}
            onAgentModelChange={onAgentModelChange}
            onApiProtocolChange={onApiProtocolChange}
            onApiModelChange={onApiModelChange}
            onConfigPersist={onConfigPersist}
            onRefreshAgents={onRefreshAgents}

            onFinish={finishOnboarding}
            onStartSample={() => void onboardingSample.start()}
            onOpenDoctor={() => onOpenSettings('doctor')}
            onOpenAccount={() => onOpenSettings('account')}
          />
        </main>
      </div>
    );
  }

  const homeExecutionSwitcher = (
    <InlineModelSwitcher
      config={config}
      agents={agents}
      providerModelsCache={activeProviderModelsCache}
      onProviderModelsCacheChange={activeSetProviderModelsCache}
      daemonLive={daemonLive}
      onModeChange={onModeChange}
      onAgentChange={onAgentChange}
      onAgentModelChange={onAgentModelChange}
      onApiProtocolChange={onApiProtocolChange}
      onApiModelChange={onApiModelChange}
      onOpenSettings={onOpenSettings}
      onSignIn={() => setSignInOpen(true)}
    />
  );

  // Home project creation uses the same handlers as the rest of the shell.
  const homeViewProps = {
    projects: homeProjectsList,
    projectsLoading,
    onSubmit: handlePluginLoopSubmit,
    onOpenProject,
    onBrowseRegistry: () => changeView('store'),
    onOpenMcp: () => openIntegrationTab('mcp'),
    onOpenDoctor: () => onOpenSettings('doctor'),
    onOpenEngineSettings: () => onOpenSettings('gameEngines'),

    skills,
    skillsLoading,
    onImportFolder,
    onImportFolderResponse,
    onViewAllProjects: () => changeView('projects'),
  };

  return (
    <div className={`${styles.shell} entry-shell entry-shell--no-header`}>
      <div className={styles.dragStrip} aria-hidden />
      <div
        className={`${styles.layout} entry${railOpen ? ' entry--rail-open' : ''}`}
        data-rail-host
        style={railWidthProperties(railWidth)}
      >
        <EntryNavRail
          config={config}
          onResetOnboarding={onResetOnboarding}
          view={view}
          onViewChange={changeView}
          onNewProject={() => {
            trackHomeNavClick(analytics.track, {
              page_name: 'home',
              area: 'nav',
              element: 'new_project_plus',
            });
            // The same game dialog Home's own New game opens (HomeDashboard),
            // from every entry view and from inside a project.
            requestEntryNewGame();
            changeView('home');
          }}
          onOpenSearch={() => setProjectSearchOpen(true)}
          open={railOpen}
          onToggleRail={toggleRail}


          onOpenSettings={onOpenSettings}


          updaterSlot={updaterSlot}
          footerNotice={undefined}
          /* Same catalog and same opener the 全部项目 grid uses below, so the
             rail's 最近浏览过 list and that view's 最近浏览过 tab are two views of
             ONE list rather than two sorts of two lists. */
          recentProjects={projectSearchProjects}
          onOpenRecentProject={handleOpenAllProjects}
          /* Same handlers the projects grid drives its own row menu with, so a
             rename or a delete from the rail lands in exactly one place. */
          onRenameRecentProject={onRenameProject}
          onDeleteRecentProject={onDeleteProject}
          onDuplicateRecentProject={onDuplicateProject}
          /* And the same shared-state answer + optimistic markers the grids
             get, so 转入团队空间 from the rail updates every list at once. */


        />
        {projectSearchOpen ? (
          <ProjectSearchModal
            // Search spans personal drafts plus the shared workspace catalog.
            // The pull-first handler still opens not-yet-local shared projects.
            projects={projectSearchProjects}

            onOpenProject={handleOpenAllProjects}
            onClose={() => setProjectSearchOpen(false)}
          />
        ) : null}
        <main
          className={`entry-main entry-main--scroll${view === 'home' ? ` ${styles.homeScroll}` : ''}${view === 'generate' ? ` ${styles.generateScroll}` : ''}`}
          ref={entryMainScrollRef}
        >
          {/* Navigation and search belong to the rail; the home content uses
              the full height while the updater stays in its floating host. */}
          <WhatsNewPopup active={view === 'home' && true} />
          {/* The campaign badge lives in EntryNavRail's top-right cluster so it
              stays beside the account module across every entry tab. */}
          <div
            className={[
              'entry-main__inner',
              view === 'home' ? '' : 'entry-main__inner--wide',
              view === 'generate' ? styles.generateInner : '',
            ].filter(Boolean).join(' ')}
          >
            <div className="entry-main__view-home" data-testid="entry-view-home" data-active={view === 'home' ? 'true' : 'false'} {...inactiveViewProps(view === 'home')}>
              <HomeView
                {...homeViewProps}
                isActive={view === 'home'}
                promptHandoff={homePromptHandoff}
                executionSwitcher={view === 'home' ? homeExecutionSwitcher : undefined}
                setupNotice={view === 'home' ? (
                  <NoAgentNotice
                    agents={agents}
                    agentsLoading={agentsLoading}
                    config={config}
                    onSignIn={() => setSignInOpen(true)}
                    onBuyCredits={() => onOpenSettings('account')}
                    onSetUpOwnTools={() => (onResetOnboarding ? onResetOnboarding(config) : onOpenSettings('execution'))}
                  />
                ) : undefined}
              />
            </div>
            <div data-testid="entry-view-projects" data-active={view === 'projects' ? 'true' : 'false'} {...inactiveViewProps(view === 'projects')}>
              {projectsLoading || skillsLoading ? (
                <CenteredLoader label={t('common.loading')} />
              ) : (
                <div className="entry-section">
                  <header className="entry-section__head">
                    <h1 className="entry-section__title">{t('entry.navProjects')}</h1>
                  </header>
                  <ProjectsPanel
                    projects={projects}
                    skills={skills}
                    onOpen={onOpenProject}
                    onDelete={onDeleteProject}
                    onDuplicate={onDuplicateProject}
                    onRename={onRenameProject}
                    onRefresh={onProjectsRefresh}
                    isActive={view === 'projects'}
                    onNewProject={() => {
                      openNewProject();
                    }}
                  />
                </div>
              )}
            </div>

            {view === 'generate' ? <GeneratePage routeProjectId={route.kind === 'home' ? route.generateProjectId : undefined} games={projects}
              onOpenAccount={() => onOpenSettings('account')} onOpenExtensions={() => changeView('store')} /> : null}
            {view === 'store' ? <StoreProjectActions itemName={route.kind === 'home' ? route.storeItemName : undefined} initialTab={route.kind === 'home' ? route.storeTab : undefined} projects={projects} onOpenProject={onOpenProject} onOpenAccount={() => onOpenSettings('account')} /> : null}
            {null}
            {null}
            {view === 'integrations' ? (
              <IntegrationsView
                config={config}
                initialTab={integrationTab}
                onConfigPersist={onConfigPersist}
                onSkillsRefresh={onSkillsRefresh}
                onSkillsChanged={onSkillsChanged}
              />
            ) : null}
            {/* Team destinations — the entry shell owns the nav frame only; each
                view is provided by another lane (B = members/board, D = team
                project spaces / workspace settings), rendered as a placeholder
                until those land. */}
            {view === 'drafts' || view === 'all-projects' ? (
              // 全部项目 (OPEND-3108): ONE catalog — the same list the rail's
              // 最近浏览过 shows — split by the strip's 最近浏览过 / 个人项目 /
              // 团队项目 tabs. The legacy `all-projects` view (the
              // `/all-projects` deep link) is this page opened on its 团队项目
              // tab. The team half of the catalog comes from `teamProjects`,
              // which has its own loading state and restarts from empty
              // whenever the entry shell remounts (e.g. returning from a
              // project); wait for BOTH reads before calling the page empty.
              !projectsLoading && projectSearchProjects.length === 0 && (projectsLoadFailed || false) ? (
                <div className="entry-section">
                  <header className="entry-section__head">
                    <h1 className="entry-section__title">{t('entry.navDrafts')}</h1>
                  </header>
                  <div className={styles.projectListError} role="alert">
                    <p>{t('entry.projectsLoadFailed')}</p>
                    <Button onClick={() => {

                      void Promise.resolve(onProjectsRefresh?.()).catch(() => {});
                    }}>{t('preview.retry')}</Button>
                  </div>
                </div>
              ) : projectsLoading || (projectSearchProjects.length === 0 && false) ? (
                <div className="entry-section">
                  <CenteredLoader label={t('common.loading')} />
                </div>
              ) : projectSearchProjects.length === 0 ? (
                <EntryBlankState
                  heading={t('entry.navDrafts')}
                  description={t('entry.blankDraftsDescription')}
                  actionLabel={t('entry.blankCreate')}
                  // The same game dialog the rail's plus and Home's New game open.
                  onCreate={() => {
                    requestEntryNewGame();
                    changeView('home');
                  }}
                />
              ) : (
                <div className="entry-section">
                  <RecentProjectsStrip
                    projects={projectSearchProjects}
                    limit={1000}
                    heading={t('entry.navDrafts')}
                    space="drafts"
                    collection={projectsCollection}
                    onCollectionChange={setProjectsCollection}


                    openingProjectId={pullingProjectId}
                    // Pull-first opener: a 团队项目 row that is not local yet
                    // materializes before it opens, like the old team grid.
                    onOpen={handleOpenAllProjects}
                    onViewAll={() => {}}
                    onDelete={onDeleteProject}
                    onDuplicate={onDuplicateProject}
                    onRename={onRenameProject}


                  />
                </div>
              )
            ) : null}
            {view === 'board' ? (
              null
            ) : null}
          </div>
        </main>
      </div>
      {onboardingSample.fallback && onImportFolderResponse && (
        <NewGameDialog
          initialTemplateId={SAMPLE_TEMPLATE_ID}
          initialError={onboardingSample.fallback.error}
          onClose={onboardingSample.closeFallback}
          onCreated={onImportFolderResponse}
        />
      )}
      {homeSetup && onImportFolderResponse && (
        <NewGameDialog
          initialPrompt={homeSetup.prompt}
          initialFiles={homeSetup.files}
          onClose={() => setHomeSetup(null)}
          onOpenEngineSettings={() => onOpenSettings('gameEngines')}
          onCreated={async response => {
            clearHomeComposerDraft();
            await onImportFolderResponse(response);
          }}
        />
      )}
      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
      <NewProjectModal
        open={newProjectOpen}
        skills={skills}
        promptTemplates={promptTemplates}
        mediaProviders={config.mediaProviders}
        loading={skillsLoading}
        onCreate={handleCreate}
        {...(onImportFolder ? { onImportFolder } : {})}
        {...(onImportFolderResponse ? { onImportFolderResponse } : {})}
        onClose={() => setNewProjectOpen(false)}
      />
    </div>
  );
}
