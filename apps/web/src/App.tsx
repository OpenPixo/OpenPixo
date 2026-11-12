import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { Button } from '@openpixo/components';
import { reportAgentDetectDiagnostics } from './analytics/agent-detect';
import { useAnalytics } from './analytics/provider';
import {
  trackExperienceSurveyDismissed,
  trackExperienceSurveySent,
  trackExperienceSurveyShown,
  trackFileUploadResult,
  trackProjectCreateResult,
} from './analytics/events';
import { deriveUploadCohort } from './analytics/upload-tracking';
import { detectClientType } from './analytics/identity';
import {
  deriveConfigureGlobals,
  projectKindFromMetadataToTracking,
  fidelityToTracking,
} from '@openpixo/contracts/analytics';
import type { ChatSessionMode, CreateProjectExampleReference, RunContextSelection } from '@openpixo/contracts';

import { EntryView } from './components/EntryView';
import type {
  OptimisticProjectCreationHandoff,
  ProjectTitleHint,
} from './components/EntryShell';

import type { IntegrationTab } from './components/IntegrationsView';
import { MarketplaceView } from './components/MarketplaceView';
import { PluginDetailView } from './components/PluginDetailView';
import type { CreateInput } from './components/NewProjectPanel';
import { Toast } from './components/Toast';


import { CenteredLoader } from './components/Loading';
import type { ProjectRenameFenceToken } from './components/ProjectView';


import { projectsForWorkspaceChrome } from './runtime/workspace-chrome-projects';


import { ExperienceSurvey } from './components/ExperienceSurvey';
import { TooltipLayer } from './components/TooltipLayer';
import { RequiredUpdateGate } from './components/RequiredUpdateGate';
import { UpdateDialog } from './components/UpdateDialog';
import { UpdaterPopup } from './components/UpdaterPopup';
import {
  openWorkspaceTab,
  removeWorkspaceProjectTabs,
  WorkspaceTabsBar,
} from './components/WorkspaceTabsBar';
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';
import { ProjectSidebar } from './components/ProjectSidebar';
import { WorkspaceTopRightAccountCluster } from './components/EntryNavRail';

import {
  IframeKeepAliveProvider,
  useIframeKeepAlivePool,
} from './components/IframeKeepAlivePool';
import { switchApiProtocolConfig, updateCurrentApiProtocolConfig } from './components/api-protocol-config';
import type { SettingsSection } from './components/SettingsDialog';
import { PrivacyConsentModal } from './components/PrivacyConsentModal';
import { prepareOnboardingRerun } from './components/onboarding/setup-readiness';


import {
  clearHomeComposerAttachments,
  stashHomeComposerAttachments,
} from './state/home-composer-stash';
import { daemonIsLive, fetchAppVersionInfo, fetchAgentsStream, fetchDesignTemplates, fetchPromptTemplates, fetchSkills, openExternalUrl, uploadProjectFiles, replaceProjectWorkingDir } from './providers/registry';
import { openFirstPartyExternalLinkFromClick } from './first-party-external-link';
import { OPEN_MEDIA_SETTINGS_EVENT, OPEN_SKILLS_SETTINGS_EVENT } from './settings-navigation';


import { navigate, useRoute, type Route } from './router';
import { navigationTiming, navigationPage, usePageNavigationReady, observeNavigation } from './observability/navigation-timing';
import { useStartupReady } from './observability/startup-ready';
import {
  APP_CONFIG_CHANGED_EVENT,
  fetchDaemonConfig,
  DEFAULT_CONFIG,
  DEFAULT_NOTIFICATIONS,
  fetchMediaProvidersFromDaemon,
  hasAnyConfiguredProvider,
  loadConfig,
  mergeDaemonConfig,
  mergeDaemonMediaProviders,
  rebaseConfigEdits,
  saveConfig,
  shouldSyncLocalMediaProvidersToDaemon,
  syncConfigToDaemon,
  syncMediaProvidersToDaemon,
} from './state/config';
import { createSilentUpdatePreferenceWriter } from './state/silent-update-preference';
import { applyAppearanceToDocument } from './state/appearance';
import { isMacPlatform } from './utils/platform';
import { randomUUID } from './utils/uuid';
import { armCompletionFeedbackOnFirstGesture } from './utils/notifications';


import { installFontRecovery } from './runtime/font-recovery';
import {
  runWithConcurrency,
  STAGED_UPLOAD_CONCURRENCY,
} from './runtime/chat/staged-attachment';
import {
  beginHomeAttachmentUploads,
  dismissedHomeAttachmentOrders,
  endHomeAttachmentUploads,
  settleHomeAttachmentUpload,
} from './state/home-attachment-handoff';
import { bootstrapProjectRoute, createProject, createPluginShareProject, deleteProject as deleteProjectApi, duplicateProject, getProject, importFolderProject, invalidatePluginCatalogCache, listProjects, listTemplates, deleteTemplate, patchProject, ProjectCreateError } from './state/projects';
import { useModalWindowDragGuard } from './hooks/useModalWindowDragGuard';
import {
  holdProjectRunStatusReads,
  releaseProjectRunStatusReads,
} from './hooks/useProjectRunStatuses';
import { resumeThumbnailLoads, suspendThumbnailLoads } from './lib/thumbnail-load-gate';
import type {
  PluginShareAction,
  PluginShareProjectOutcome,
} from './state/projects';
import { readProjectDisplaySnapshot, writeProjectDisplaySnapshot } from './state/project-display-cache';
import { getOpenPixoHost, type OpenPixoHostProjectImportSuccess } from '@openpixo/host';
import { useI18n } from './i18n';
import type {
  AgentInfo,
  AgentModelChoice,
  ApiProtocol,
  AppConfig,
  AppVersionInfo,
  ChatAttachment,
  Project,
  ProjectMetadata,
  ProjectTemplate,
  ProviderModelOption,
  PromptTemplateSummary,
  SkillSummary,
} from './types';

// The project workspace and settings are about half the app's code, and Home
// needs neither to paint. They load on first use and are preloaded shortly after
// startup, so opening a project stays instant. AppErrorBoundary catches a chunk
// that fails to load.
const loadProjectView = () => import('./components/ProjectView');
const loadSettingsDialog = () => import('./components/SettingsDialog');
const ProjectView = lazy(() => loadProjectView().then((m) => ({ default: m.ProjectView })));
const SettingsDialog = lazy(() => loadSettingsDialog().then((m) => ({ default: m.SettingsDialog })));
const LAZY_VIEW_PRELOAD_DELAY_MS = 1_500;

type AppCreateProjectInput = Omit<CreateInput, 'metadata'> & {
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
   * The optimistic project `beginOptimisticProjectCreation` already flushed
   * for this send (Home hands off before its admission check). The create
   * reuses the id instead of opening a second frame.
   */
  optimisticProjectId?: string;
  requestId?: string;
  pendingFiles?: File[];
  userWorkingDirToken?: string;
  linkedDirs?: string[] | null;
};

/**
 * How long the hand-off card may stay over a mounted ProjectView before App
 * drops it on its own (OPEND-2170). ProjectView releases it as soon as the
 * first transcript settles; this only covers a first send that is parked
 * behind a dialog or a read that never answers.
 */
const CREATION_HANDOFF_SETTLE_DEADLINE_MS = 8_000;

/**
 * Everything the optimistic project surface shows while POST /api/projects is
 * in flight. It is self-contained on purpose: the pending frame must render on
 * the tick the request is sent and keep rendering even if a project-list
 * refresh drops the optimistic row before the daemon confirms the id.
 */
interface PendingProjectCreation {
  projectId: string;
  /**
   * The seed conversation's id, minted with the project id and sent with the
   * create, so the route and the chat pane name the final conversation from
   * the first frame (OPEND-3334).
   */
  conversationId: string;
  name: string;
  prompt: string;
  /**
   * `POST /api/projects` has answered and the row is persisted. ProjectView
   * is mounted from the click either way; until then it holds every project
   * read (an unpersisted id must not fan out reads) and draws only this
   * record's optimistic first turn. The record stays until the first
   * transcript settles (OPEND-2170).
   */
  created?: boolean;
  /**
   * The files the user staged on Home, still as local `File` objects. The
   * optimistic first turn draws them from these bytes, so the first project
   * frame shows the attachments without reading a project that is not
   * persisted yet.
   */
  files: readonly File[];
}



const AGENT_FOCUS_REFRESH_THROTTLE_MS = 10_000;

/**
 * Whether this launch should hand the user to the first-run onboarding flow.
 *
 * Two conditions, both about the *user*, neither about where they happen to be
 * in the app: they have never completed onboarding (on either the local or the
 * daemon copy — `mergeDaemonConfig` ratchets the two before this runs), and
 * they did not arrive through an explicit deep link that onboarding must not
 * hijack (projects have direct URLs).
 *
 * Deliberately a pure predicate over a resolved config: the redirect belongs to
 * the one-shot boot pass, and expressing it as a function of "who the user is"
 * rather than "what just happened" keeps it from being re-decided mid-session.
 */
export function shouldRouteToFirstRunOnboarding(
  config: AppConfig,
  pathname: string,
): boolean {
  if (config.onboardingCompleted === true) return false;
  if (pathname.startsWith('/projects/')) {
    return false;
  }
  return true;
}

function workspaceProjectListViewForRoute(route: Route): 'all' | 'recent' | 'drafts' {
  if (route.kind === 'home' && route.view === 'all-projects') return 'all';
  if (route.kind === 'home' && route.view === 'drafts') return 'drafts';
  if (route.kind === 'project') return 'all';
  return 'recent';
}

export function shouldSyncMediaProvidersOnSave(
  mediaProviders: AppConfig['mediaProviders'],
  options?: { force?: boolean },
): boolean {
  return Boolean(options?.force) || hasAnyConfiguredProvider(mediaProviders);
}


function mergeLinkedDirsIntoMetadata(
  metadata: ProjectMetadata | undefined,
  linkedDirs?: string[] | null,
): ProjectMetadata | undefined {
  const nextDirs = (linkedDirs ?? []).map((dir) => dir.trim()).filter(Boolean);
  if (nextDirs.length === 0) return metadata;
  const baseMetadata = metadata ?? { kind: 'other' };
  return {
    ...baseMetadata,
    linkedDirs: Array.from(new Set([...(baseMetadata.linkedDirs ?? []), ...nextDirs])),
  };
}


export function mergeAgentModelChoice(
  previous: AgentModelChoice | undefined,
  next: { model?: string; reasoning?: string; serviceTier?: string },
): AgentModelChoice {
  const merged: AgentModelChoice = { ...(previous ?? {}), ...next };
  // Effort belongs to a model: choosing one restores what it last ran at, or its own default.
  if (typeof next.reasoning === 'string') {
    if (merged.model) merged.reasoningByModel = { ...previous?.reasoningByModel, [merged.model]: next.reasoning };
  } else if (typeof next.model === 'string') {
    const saved = previous?.reasoningByModel?.[next.model];
    if (saved) merged.reasoning = saved;
    else delete merged.reasoning;
  }
  if (
    Object.prototype.hasOwnProperty.call(next, 'serviceTier') &&
    next.serviceTier === undefined
  ) {
    delete merged.serviceTier;
  }
  return merged;
}


/**
 * Active Cloud sign-out is an account boundary for Cloud-owned execution
 * state. Local BYOK credentials and provider choices belong to this install,
 * not the signed-in Cloud account, so keep them available when onboarding asks
 * the user to choose an execution path again.
 */
export function resetExecutionConfigAfterSignOut(config: AppConfig): AppConfig {
  return {
    ...config,
    onboardingCompleted: false,
    mode: DEFAULT_CONFIG.mode,
    agentId: null,
    agentModels: {},
    agentCliEnv: {},
    agentCliEnvIntent: {},
  };
}

type ProjectListRequest = {
  generation: number;
  mutationVersion: number;
  accountGeneration: number;
  scopeKey: string;
  displayKey: string;

};

type PendingProjectNameProjection = {
  accountGeneration: number;
  scopeKey: string;
  project: Project;
  mutationVersion: number;
  confirmed: boolean;
};

type QueuedProjectRenameState = {
  generation: number;
  confirmed: Project;
  pending: number;
  tail: Promise<void>;
};

/**
 * The scope key for a caller with NO resolved workspace identity — either the
 * context has not landed yet (every fresh boot passes through this) or the
 * daemon has no workspace plane at all. It is deliberately NOT treated as "a
 * workspace you left": a boot that lists projects before the context resolves
 * did not read another workspace's data, so promoting `local` → `ws:member`
 * must not discard the list it just loaded.
 */
const UNRESOLVED_PROJECT_LIST_SCOPE = 'local';

function projectListScopeKey(): string {
  return UNRESOLVED_PROJECT_LIST_SCOPE;
}

export function projectViewAuthorizationLifetimeKey(projectId: string): string { return projectId; }

export function buildPersistedConfig(next: AppConfig, current: AppConfig): AppConfig {
  const stalePrivacySnapshot =
    current.privacyDecisionAt != null && next.privacyDecisionAt == null;
  return {
    ...next,
    onboardingCompleted: current.onboardingCompleted ? true : next.onboardingCompleted,
    ...(stalePrivacySnapshot
      ? {
          installationId: current.installationId,
          privacyDecisionAt: current.privacyDecisionAt,
          telemetry: current.telemetry,
        }
      : {}),
  };
}

/**
 * True when `next` and `last` produce an identical persisted shape —
 * i.e. the only diffs between them are fields that buildPersistedConfig
 * intentionally strips before disk/daemon writes (the Composio API key
 * draft today; any future save-on-explicit-confirm secrets later).
 *
 * The autosave loop in Settings uses this to skip the "All changes
 * saved" indicator transition when the user has only typed an unsaved
 * secret. Without it, autosave completes a no-op write and flashes
 * "Saved" — misleading users into trusting that a sensitive key has
 * been persisted when in fact only the section-local "Save key"
 * gesture commits it.
 */
export function isAutosaveDraftOnlyChange(next: AppConfig, last: AppConfig): boolean {
  return (
    JSON.stringify(buildPersistedConfig(next, next))
    === JSON.stringify(buildPersistedConfig(last, last))
  );
}

export function resolveSettingsCloseConfig(
  rendered: AppConfig,
  latestPersisted: AppConfig,
): AppConfig {
  const base = latestPersisted === rendered ? rendered : latestPersisted;
  return base.onboardingCompleted ? base : { ...base, onboardingCompleted: true };
}


const CANONICAL_AGENT_ORDER = [
  'claude',
  'codex',
  'opencode',
] as const;

const CANONICAL_AGENT_ORDER_INDEX = new Map<string, number>(
  CANONICAL_AGENT_ORDER.map((id, index) => [id, index]),
);

function orderAgentsByRegistry(agents: AgentInfo[]): AgentInfo[] {
  return agents
    .map((agent, index) => ({ agent, index }))
    .sort((left, right) => {
      const leftRank =
        CANONICAL_AGENT_ORDER_INDEX.get(left.agent.id) ??
        CANONICAL_AGENT_ORDER.length;
      const rightRank =
        CANONICAL_AGENT_ORDER_INDEX.get(right.agent.id) ??
        CANONICAL_AGENT_ORDER.length;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.index - right.index;
    })
    .map(({ agent }) => agent);
}

function upsertAgent(agents: AgentInfo[], agent: AgentInfo): AgentInfo[] {
  const index = agents.findIndex((item) => item.id === agent.id);
  if (index === -1) return [...agents, agent];
  const next = agents.slice();
  next[index] = agent;
  return next;
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

// Bound retries while a locally created project becomes readable.
const DEEP_LINK_RETRY_ATTEMPTS = 21;
const DEEP_LINK_RETRY_DELAY_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type DeepLinkedProjectResolution =
  | { kind: 'found'; project: Project }
  | { kind: 'still-materializing' }
  | { kind: 'unavailable' }
  | { kind: 'not-found' };

export type ProjectRouteSurfaceState =
  | 'ready'
  | 'loading-projects'
  | 'resolving-deep-link'
  | 'missing'
  | 'materialization-failed'
  | 'daemon-unavailable';

interface SettingsReturnTarget {
  route: Extract<Route, { kind: 'project' }>;
  accountGeneration: number;
  identityScopeKey: string;
}

/**
 * The project route must never use `!activeProject` as an unbounded loading
 * condition. Once the initial list is complete, every absent-project path is
 * either a bounded deep-link resolution or an explicit terminal surface.
 */
export function projectRouteSurfaceState(input: {
  projectsLoading: boolean;
  hasActiveProject: boolean;
  daemonLive: boolean;
  resolutionFailure?: 'missing' | 'materialization-failed';
}): ProjectRouteSurfaceState {
  if (input.hasActiveProject) return 'ready';
  if (input.projectsLoading) return 'loading-projects';
  if (!input.daemonLive) return 'daemon-unavailable';
  if (input.resolutionFailure) return input.resolutionFailure;
  return 'resolving-deep-link';
}

/**
 * Resolve a deep-linked local project with bounded retries. Injecting the
 * delay keeps the retry decision testable without mounting the component.
 */
export async function resolveDeepLinkedProject(projectId: string, deps: { getProject: (id: string) => Promise<Project | null>; delay: (ms: number) => Promise<void>; retryAttempts?: number; retryDelayMs?: number; isCancelled?: () => boolean }): Promise<DeepLinkedProjectResolution> {
    const attempts = deps.retryAttempts ?? DEEP_LINK_RETRY_ATTEMPTS;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await deps.delay(deps.retryDelayMs ?? DEEP_LINK_RETRY_DELAY_MS);
      if (deps.isCancelled?.()) return { kind: 'still-materializing' };
      const project = await deps.getProject(projectId).catch(() => null);
      if (deps.isCancelled?.()) return { kind: 'still-materializing' };
      if (project) return { kind: 'found', project };
    }
    return { kind: 'not-found' };
  }


/**
 * What the user reads when a Home send's optimistic project creation fails.
 *
 * A create request that never reached the local daemon uses the same transport
 * classification as HomeView. Other failures keep their existing text.
 */
function homeCreateFailureNotice(
  err: unknown,
  t: (key: 'home.createTimedOut' | 'home.daemonRecovering') => string,
  fallback: string,
): string {
  if (err instanceof ProjectCreateError && err.code === 'PROJECT_CREATE_PREPARATION_TIMEOUT') {
    return t('home.createTimedOut');
  }
  if (err instanceof TypeError || (err instanceof ProjectCreateError && err.status === null)) {
    return t('home.daemonRecovering');
  }
  return fallback;
}

export function App() {
  // `reducedMotion="user"` makes every motion/react component honor the OS
  // `prefers-reduced-motion` setting: transform/layout animations are zeroed
  // out while opacity-only changes are kept. The CSS `@media (prefers-reduced-
  // motion: reduce)` block covers the CSS-keyframe surfaces, but the dialogs,
  // toasts and popovers that moved to motion/react need this gate too — without
  // it they keep springing/sliding for users who asked us not to animate.
  return (
    <MotionConfig reducedMotion="user">
      <IframeKeepAliveProvider>
        {null}
        <AppInner />
      </IframeKeepAliveProvider>
    </MotionConfig>
  );
}

function AppInner() {
  const { t, locale } = useI18n();
  const iframeKeepAlivePool = useIframeKeepAlivePool();
  const clientType = useMemo(() => detectClientType(), []);
  const hostPlatform = useMemo(() => getOpenPixoHost()?.client.platform, []);
  useModalWindowDragGuard();


  // Catalog display state is account-scoped in addition to Workspace-scoped.
  // During an unseeded identity transition the hook intentionally retains the
  // previous context while the replacement account is resolved; a pending
  // sentinel makes that retained context unusable for display immediately.


  const listCurrentWorkspaceProjects = useCallback(
    (options?: { throwOnError?: boolean;  }) => {
      const context = null;
      return listProjects({
        ...options,


      });
    },
    [],
  );
  useEffect(() => {
    const onFirstPartyExternalLink = (event: MouseEvent) => openFirstPartyExternalLinkFromClick(
      event,
      (url) => { void openExternalUrl(url); },
    );
    document.addEventListener('click', onFirstPartyExternalLink);
    return () => document.removeEventListener('click', onFirstPartyExternalLink);
  }, []);
  // Fonts whose startup fetch lost a race stay missing forever without
  // this — see runtime/font-recovery.ts.
  useEffect(() => installFontRecovery(), []);
  useEffect(() => {
    // Not under `next dev`: an import there compiles on demand and applies a hot
    // update, which stalled and reset the file panel's stack for several hundred
    // ms in the middle of whatever the developer was doing.
    if (process.env.NODE_ENV !== 'production') return;
    const preload = () => {
      void loadProjectView();
      void loadSettingsDialog();
    };
    const timer = setTimeout(preload, LAZY_VIEW_PRELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  // Observability marker. `apps/web/src/observability/white-screen.ts`
  // keys its "app actually mounted" success condition on this attribute
  // because the dynamic-import loading shell (`<div class="pixo-loading-shell">
  // Loading OpenPixo…</div>`) is itself >MIN_VISIBLE_TEXT and would
  // otherwise be mistaken for a real mount. Survives subsequent render
  // crashes — once App has mounted at least once, it's no longer a white
  // screen (subsequent failures show up as `$exception`).
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-pixo-app-mounted', '1');
      document.querySelectorAll('.pixo-loading-shell').forEach((node) => node.remove());
    }
  }, []);
  // Desktop vibrancy focus response: an unfocused window drops the cream
  // scrim to let the wallpaper show through more clearly; on focus the scrim
  // returns to full strength (app-wash.css keys off this class).
  useEffect(() => {
    if (
      clientType !== 'desktop'
      || hostPlatform !== 'darwin'
      || typeof window === 'undefined'
    ) return undefined;
    const root = document.documentElement;
    const sync = () => root.classList.toggle('is-window-blurred', !document.hasFocus());
    sync();
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      root.classList.remove('is-window-blurred');
    };
  }, [clientType, hostPlatform]);
  const [config, setConfig] = useState<AppConfig>(() => loadConfig());
  const configRef = useRef(config);
  configRef.current = config;
  const latestPersistedConfigRef = useRef(config);
  latestPersistedConfigRef.current = config;
  const settingsDraftConfigRef = useRef<AppConfig | null>(null);
  const completionFeedbackGestureConsumedRef = useRef(false);
  useEffect(() => {
    if (completionFeedbackGestureConsumedRef.current) return undefined;
    const notifications = config.notifications ?? DEFAULT_NOTIFICATIONS;
    if (!notifications.soundEnabled && !notifications.desktopEnabled) return undefined;
    return armCompletionFeedbackOnFirstGesture(notifications, ({ desktopPermission }) => {
      completionFeedbackGestureConsumedRef.current = true;
      if (
        !notifications.desktopEnabled
        || desktopPermission === null
        || desktopPermission === 'granted'
      ) return;
      // The product default expresses intent, but an unsupported/denied browser
      // permission cannot honestly remain Active. Reconcile only the desktop
      // switch; the independent completion-sound preference stays enabled.
      setConfig((previous) => {
        const previousNotifications = previous.notifications ?? DEFAULT_NOTIFICATIONS;
        if (!previousNotifications.desktopEnabled) return previous;
        const next: AppConfig = {
          ...previous,
          notifications: { ...previousNotifications, desktopEnabled: false },
        };
        latestPersistedConfigRef.current = next;
        saveConfig(next);
        return next;
      });
    });
  }, [config.notifications?.desktopEnabled, config.notifications?.soundEnabled]);
  const [settingsOpen, setSettingsOpen] = useState(false);


  // Surfaced when a Home-picked working dir could not be applied to a freshly
  // created project (expired/invalid desktop token, daemon rejection). Without
  // this the failure was swallowed and the user believed their folder was in
  // effect while the project actually stayed in the managed root.
  const [workingDirError, setWorkingDirError] = useState<string | null>(null);
  const [projectCreateError, setProjectCreateError] = useState<string | null>(null);
  const [projectOpenError, setProjectOpenError] = useState<string | null>(null);
  const [deepLinkResolutionFailure, setDeepLinkResolutionFailure] = useState<{
    projectId: string;
    failure: 'missing' | 'materialization-failed';
  } | null>(null);
  const [deepLinkRetryRevision, setDeepLinkRetryRevision] = useState(0);
  const [settingsWelcome, setSettingsWelcome] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection>('execution');
  const [integrationInitialTab, setIntegrationInitialTab] = useState<IntegrationTab>('mcp');
  const [daemonLive, setDaemonLive] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [pendingAgentSelection, setPendingAgentSelection] = useState<{
    projectId: string; conversationId: string | null; agentId: string;
  } | null>(null);

  const agentStreamRequestSeqRef = useRef(0);
  const agentStreamAbortRef = useRef<AbortController | null>(null);
  const agentFocusRefreshLastRunRef = useRef(Date.now());
  const [providerModelsCache, setProviderModelsCache] = useState<
    Record<string, ProviderModelOption[]>
  >({});
  // Functional skills (capabilities the agent invokes mid-task) — stays
  // small and lives under the Settings → Skills surface.
  const [workspaceSkills, setWorkspaceSkills] = useState<{
    identity: string;
    items: SkillSummary[];
    ready: boolean;
  }>(() => ({
    identity: "local",
    items: [],
    ready: false,
  }));
  // A workspace-scoped response is safe to render only under the exact
  // identity it was fetched for. The replacement read starts in an effect, so
  // clearing in that effect would still paint one frame of A's skills under B.
  // Derive the visible catalog during render instead: an identity mismatch is
  // a fail-closed empty list until B's own response commits.
  const skills =
    workspaceSkills.identity === "local"
      ? workspaceSkills.items
      : [];
  // Design templates (rendering catalogue: decks, prototypes, image/video/
  // audio templates) — sourced from /api/design-templates and shown in the
  // EntryView Templates tab. See specs/current/skills-and-design-templates.md.
  const [designTemplates, setDesignTemplates] = useState<SkillSummary[]>([]);
  const skillsRequestGenerationRef = useRef<Map<string, number>>(new Map());
  const [projects, setProjects] = useState<Project[]>([]);
  const [pendingProjectCreation, setPendingProjectCreation] =
    useState<PendingProjectCreation | null>(null);
  // Seed conversation id per optimistic project, read by the create request.
  // A ref, not the record: the record may already be cleared or replaced by a
  // newer send when a slow create finally goes out.
  const pendingProjectConversationIdsRef = useRef(new Map<string, string>());
  // Hard block from the Home pre-run balance gate. Hosted here, not in
  // EntryShell: the gate answers behind the optimistic pending frame, where
  // EntryShell is already unmounted (OPEND-2614).

  const [appliedProjectListWitness, setAppliedProjectListWitness] = useState<{
    displayKey: string;
    scopeKey: string;
    generation: number;

    projectIds: ReadonlySet<string>;
  } | null>(null);
  const projectsRef = useRef<Project[]>(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);
  const handleCreationHandoffSettled = useCallback((projectId: string) => {
    // Only a persisted project's record can be released: before the create
    // answers, the record is what holds ProjectView's project reads.
    setPendingProjectCreation((current) =>
      current?.projectId === projectId && current.created ? null : current,
    );
  }, []);
  const pendingLocalProjectIdsRef = useRef<Set<string>>(new Set());
  const currentProjectListScope = projectListScopeKey();
  const currentPendingLocalProjectScope = [
    0,
    currentProjectListScope,
  ].join(':');
  const pendingLocalProjectScopeRef = useRef(currentPendingLocalProjectScope);
  const projectAuthorizationScopeRef = useRef(currentProjectListScope);
  const projectAuthorizationGenerationRef = useRef(0);
  if (projectAuthorizationScopeRef.current !== currentProjectListScope) {
    projectAuthorizationScopeRef.current = currentProjectListScope;
    projectAuthorizationGenerationRef.current += 1;
  }
  if (pendingLocalProjectScopeRef.current !== currentPendingLocalProjectScope) {
    pendingLocalProjectScopeRef.current = currentPendingLocalProjectScope;
    pendingLocalProjectIdsRef.current.clear();
  }
  const locallyDeletedProjectIdsRef = useRef<Map<string, number>>(new Map());
  const projectListMutationVersionRef = useRef(0);
  const projectRenameStatesRef = useRef<Map<string, QueuedProjectRenameState>>(new Map());
  const pendingProjectNameProjectionsRef = useRef<Map<string, PendingProjectNameProjection>>(
    new Map(),
  );
  const projectListRequestGenerationRef = useRef(0);
  const latestAppliedProjectListGenerationRef = useRef(0);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [promptTemplates, setPromptTemplates] = useState<
    PromptTemplateSummary[]
  >([]);
  const [appVersionInfo, setAppVersionInfo] = useState<AppVersionInfo | null>(
    null,
  );


  const [daemonMediaProviders, setDaemonMediaProviders] = useState<
    AppConfig['mediaProviders'] | null
  >(null);
  const [daemonMediaProvidersFetchState, setDaemonMediaProvidersFetchState] = useState<
    'idle' | 'ok' | 'error'
  >('idle');
  const [mediaProvidersNotice, setMediaProvidersNotice] = useState<string | null>(null);
  // Per-resource loading flags. Each goes false the moment its own fetch
  // resolves so each entry-view tab can render as its data lands instead of
  // every tab waiting on the slowest endpoint (typically `/api/agents`,
  // which probes CLI versions and can take seconds on cold start). The entry
  // view picks the right flag for whichever tab the user is currently on.
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsReady, setAgentsReady] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(true);
  // Functional skills and design templates are two independent registry reads
  // that gate ONE loader: the EntryView must not stop spinning until both have
  // answered, or whichever tab the user is on renders an incomplete catalog as
  // if it were final. They are now read from two different places (the boot pass
  // reads templates; the workspace-keyed effect reads skills once the caller's
  // identity is known), so the pair of flags lives here rather than inside one
  // effect's closure.
  const skillRegistriesReadyRef = useRef({ functional: false, templates: false });
  const markSkillRegistryReady = useCallback((half: 'functional' | 'templates') => {
    skillRegistriesReadyRef.current[half] = true;
    const { functional, templates } = skillRegistriesReadyRef.current;
    if (functional && templates) setSkillsLoading(false);
  }, []);
  const [dsLoading, setDsLoading] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectListFailure, setProjectListFailure] = useState<{
    displayKey: string;
    generation: number;
  } | null>(null);
  const [promptTemplatesLoading, setPromptTemplatesLoading] = useState(true);
  const [designTemplatesReady, setDesignTemplatesReady] = useState(false);
  const [promptTemplatesReady, setPromptTemplatesReady] = useState(false);
  // Goes true once the daemon-persisted config (agentId/designSystemId/etc.)
  // has merged into local state. Auto-selection effects below wait on this
  // so they don't race ahead of the daemon-stored choice and overwrite it
  // with a freshly picked first-available agent.
  const [daemonConfigLoaded, setDaemonConfigLoaded] = useState(false);
  // True only when GET /api/app-config returned a real config object. Used to
  // gate silent-update default seeding: a failed/null fetch must not be treated
  // as "no preference yet" or we would overwrite a daemon-backed opt-out.
  const [daemonAppConfigReady, setDaemonAppConfigReady] = useState(false);
  const route = useRoute();
  useLayoutEffect(() => {
    navigationTiming.observeRoute(route);
  }, [route]);
  useEffect(() => {
    const onPageExit = () => navigationTiming.cancel('page_exit');
    window.addEventListener('pagehide', onPageExit);
    return () => window.removeEventListener('pagehide', onPageExit);
  }, []);
  const routeRef = useRef(route);
  routeRef.current = route;
  const settingsReturnTargetRef = useRef<SettingsReturnTarget | null>(null);
  const workspaceProjectView = workspaceProjectListViewForRoute(route);
  // Read-only mirror for the boot effect. The boot pass needs to know which
  // project list to seed, but it must NOT restart when that answer changes:
  // see the "boot is a one-shot" note on the bootstrap effect below. A
  // dedicated effect already re-lists projects whenever the view or the
  // workspace changes, so nothing is lost by the boot pass not reacting.
  const workspaceProjectViewRef = useRef(workspaceProjectView);
  workspaceProjectViewRef.current = workspaceProjectView;
  // `listCurrentWorkspaceProjects` already collapses `workspaceView` to
  // `undefined` when there is no resolved `workspaceContext` (see its
  // `context ? options?.workspaceView ?? 'recent' : undefined` above), so the
  // request it sends never actually varies by home tab outside a workspace.
  // But the raw route-derived `workspaceProjectView` still changes string
  // value on every 最近/全部/草稿 tab switch, and that alone is enough to
  // re-run the effect below (dependency arrays compare the value passed in,
  // not what the callback does with it) — re-fetching the identical list on
  // every click. Mirror the callback's own collapse here so the effect's
  // dependency is stable outside a workspace, matching the fetch it triggers.
  const effectiveWorkspaceProjectView = undefined;
  const projectDisplayAccountGeneration = 0;
  const currentProjectDisplayKey = "local";
  useStartupReady({
    visible: route.kind === 'home' && daemonAppConfigReady,
    interactive: route.kind === 'home' && daemonAppConfigReady && true
      && true && !projectsLoading
      && appliedProjectListWitness?.displayKey === currentProjectDisplayKey
      && projectListFailure?.displayKey !== currentProjectDisplayKey
      && agentsReady && !agentsLoading && !skillsLoading && !dsLoading && !promptTemplatesLoading
      && designTemplatesReady && promptTemplatesReady
      && workspaceSkills.ready
      && workspaceSkills.identity === "local",
  });
  // Page timing shares the authoritative Home gates, including scoped data.
  // Independent data-driven destinations report Ready in their own component.
  const pageWithSharedData = route.kind === 'home' && ['home', 'onboarding', 'projects', 'drafts', 'all-projects', 'design-systems', 'brands', 'settings'].includes(route.view);
  usePageNavigationReady({
    page: navigationPage(route),
    visible: pageWithSharedData && daemonAppConfigReady,
    ready: pageWithSharedData && daemonAppConfigReady && true
      && true && !projectsLoading
      && appliedProjectListWitness?.displayKey === currentProjectDisplayKey
      && projectListFailure?.displayKey !== currentProjectDisplayKey
      && agentsReady && !agentsLoading && !skillsLoading && !dsLoading && !promptTemplatesLoading
      && designTemplatesReady && promptTemplatesReady
      && workspaceSkills.ready
      && workspaceSkills.identity === "local",
    failure: pageWithSharedData && projectListFailure?.displayKey === currentProjectDisplayKey,
    scopeKey: currentProjectDisplayKey,
  });
  // Display snapshots are deliberately separate from authorization. They may
  // prevent a warm view from flashing a loader, but every network read and
  // mutation still carries the current request's independently verified
  // Workspace context. An exact account/workspace/member+view hit is safe to
  // render while it revalidates; any other identity is cleared before paint.
  const projectListScopeRef = useRef(currentProjectListScope);
  const projectDisplayKeyRef = useRef(currentProjectDisplayKey);
  if (projectDisplayKeyRef.current !== currentProjectDisplayKey) {
    const leftAResolvedWorkspace =
      projectListScopeRef.current !== UNRESOLVED_PROJECT_LIST_SCOPE;
    const snapshot = readProjectDisplaySnapshot();
    // A create/import is immediately projected into `projects`, but opening
    // that project changes the list projection from Home's `recent` to `all`.
    // An older exact-scope `all` snapshot must not erase the pending local row:
    // ProjectView can keep rendering from its route snapshot, while later
    // rename callbacks then have no list row to update and Back restores the
    // stale Home cards. Personal creates belong to recent/all/drafts; Team is
    // intentionally excluded until the share mutation is authoritative.
    const pendingProjects = effectiveWorkspaceProjectView === 'team'
      ? []
      : projects.filter((project) =>
          pendingLocalProjectScopeRef.current === currentPendingLocalProjectScope
          && pendingLocalProjectIdsRef.current.has(project.id)
        );
    projectListScopeRef.current = currentProjectListScope;
    projectDisplayKeyRef.current = currentProjectDisplayKey;
    if (snapshot) {
      const snapshotIds = new Set(snapshot.projects.map((project) => project.id));
      const preserved = pendingProjects.filter((project) => !snapshotIds.has(project.id));
      setProjects(preserved.length > 0 ? [...preserved, ...snapshot.projects] : snapshot.projects);
      setProjectsLoading(false);
    } else if (leftAResolvedWorkspace) {
      setProjects(pendingProjects);
      setProjectsLoading(true);
    }
  }
  const projectScopeRefreshMountedRef = useRef(false);
  const analytics = useAnalytics();

  // Single-flight guard for `/api/agents?stream=1`: beginning a new request
  // physically aborts the previous stream, not just invalidates its
  // callbacks. Stacked live streams are what deadlocked the packaged app —
  // each navigation/focus refresh opened another slow cold-probe stream,
  // and once they pinned every upstream connection slot the whole openpixo://
  // proxy starved (see apps/packaged/src/index.ts ignore-connections-limit
  // note for the other half of that fix).
  const beginAgentStreamRequest = useCallback(() => {
    setAgentsReady(false);
    agentStreamAbortRef.current?.abort();
    agentStreamAbortRef.current = new AbortController();
    agentStreamRequestSeqRef.current += 1;
    return agentStreamRequestSeqRef.current;
  }, []);

  const isCurrentAgentStreamRequest = useCallback((requestId: number) => {
    return agentStreamRequestSeqRef.current === requestId;
  }, []);


  // v2 schema removed the standalone `app_launch` event; the initial
  // page_view fires from each top-level page surface (home / projects /
  // plugins / integrations) instead.
  // `detectClientType` still feeds analytics identity via the provider.
  void detectClientType;

  const rememberLocalProject = useCallback((projectId: string) => {
    pendingLocalProjectIdsRef.current.add(projectId);
    locallyDeletedProjectIdsRef.current.delete(projectId);
    projectListMutationVersionRef.current += 1;
    const context = null;

  }, []);


  const clearLocalProject = useCallback((projectId: string, options?: { deleted?: boolean }) => {
    pendingLocalProjectIdsRef.current.delete(projectId);
    projectListMutationVersionRef.current += 1;
    if (options?.deleted) {
      locallyDeletedProjectIdsRef.current.set(
        projectId,
        projectListMutationVersionRef.current,
      );
    }
  }, []);

  const beginProjectListRequest = useCallback((
    workspaceView: 'all' | 'recent' | 'drafts' | undefined,
  ): ProjectListRequest => {
    projectListRequestGenerationRef.current += 1;
    const issuedContext = null;
    const accountGeneration = 0;
    const effectiveView = undefined;
    return {
      generation: projectListRequestGenerationRef.current,
      mutationVersion: projectListMutationVersionRef.current,
      accountGeneration,
      scopeKey: projectListScopeKey(),
      displayKey: "local",

    };
  }, []);

  const recordProjectListFailure = useCallback((request: ProjectListRequest) => {
    if (
      request.generation === projectListRequestGenerationRef.current
      && request.accountGeneration === 0
      && request.scopeKey === projectListScopeKey()
    ) {
      setProjectListFailure({ displayKey: request.displayKey, generation: request.generation });
    }
  }, []);

  const reconcileFetchedProjects = useCallback((list: Project[], request: ProjectListRequest) => {
    if (
      request.accountGeneration !== 0
      || request.scopeKey !== projectListScopeKey()
    ) {
      return false;
    }
    const projectedList = list.map((project) => {
      const key = JSON.stringify([
        request.accountGeneration,
        request.scopeKey,
        project.id,
      ]);
      const pending = pendingProjectNameProjectionsRef.current.get(key);
      if (!pending) return project;
      if (
        pending.confirmed
        && request.mutationVersion >= pending.mutationVersion
      ) {
        // A request issued after the local mutation settled is authoritative,
        // even when another tab has already committed a newer name. The fence
        // only protects requests that were already in flight when the local
        // optimistic rename began; keeping it past the first post-write read
        // would permanently hide later remote renames.
        pendingProjectNameProjectionsRef.current.delete(key);
        return project;
      }
      return {
        ...project,
        name: pending.project.name,
        metadata: pending.project.metadata,
        updatedAt: Math.max(project.updatedAt, pending.project.updatedAt),
      };
    });
    const pendingLocalProjectIds = pendingLocalProjectIdsRef.current;
    const locallyDeletedProjectIds = locallyDeletedProjectIdsRef.current;
    const fetchedIds = new Set(projectedList.map((project) => project.id));
    if (request.generation < latestAppliedProjectListGenerationRef.current) {
      const visibleList =
        locallyDeletedProjectIds.size > 0
          ? projectedList.filter((project) => !locallyDeletedProjectIds.has(project.id))
          : projectedList;
      if (visibleList.length === 0) return false;
      const hydratableProjects = visibleList.filter(
        (project) =>
          pendingLocalProjectIds.has(project.id),
      );
      if (hydratableProjects.length === 0) return false;
      const hydratableById = new Map(
        hydratableProjects.map((project) => [project.id, project]),
      );
      for (const project of hydratableProjects) {
        pendingLocalProjectIds.delete(project.id);
      }
      setProjects((current) => {
        let changed = false;
        const currentIds = new Set<string>();
        const next = current.map((project) => {
          currentIds.add(project.id);
          const hydrated = hydratableById.get(project.id);
          if (!hydrated) return project;
          changed = true;
          hydratableById.delete(project.id);
          return hydrated;
        });
        for (const project of hydratableById.values()) {
          if (currentIds.has(project.id)) continue;
          changed = true;
          next.push(project);
        }
        return changed ? next : current;
      });
      return true;
    }
    latestAppliedProjectListGenerationRef.current = request.generation;
    setProjectListFailure((failure) =>
      failure?.displayKey === request.displayKey && request.generation >= failure.generation
        ? null
        : failure);
    setAppliedProjectListWitness({
      displayKey: request.displayKey,
      scopeKey: request.scopeKey,
      generation: request.generation,

      projectIds: fetchedIds,
    });
    for (const id of fetchedIds) pendingLocalProjectIds.delete(id);
    for (const [id, deletedAtMutationVersion] of locallyDeletedProjectIds) {
      if (
        request.mutationVersion >= deletedAtMutationVersion
        && !fetchedIds.has(id)
      ) {
        locallyDeletedProjectIds.delete(id);
      }
    }
    const activeDeletedProjectIds = new Set(locallyDeletedProjectIds.keys());
    const visibleList =
      activeDeletedProjectIds.size > 0
        ? projectedList.filter((project) => !activeDeletedProjectIds.has(project.id))
        : projectedList;
    const visibleFetchedIds =
      activeDeletedProjectIds.size > 0
        ? new Set(visibleList.map((project) => project.id))
        : fetchedIds;
    writeProjectDisplaySnapshot(visibleList);
    setProjects((current) => {
      const preserved = current.filter(
        (project) =>
          pendingLocalProjectIds.has(project.id) &&
          !visibleFetchedIds.has(project.id) &&
          !activeDeletedProjectIds.has(project.id),
      );
      return preserved.length > 0 ? [...preserved, ...visibleList] : visibleList;
    });
    return true;
  }, []);

  // Propagate the Privacy toggle through to PostHog without a reload —
  // posthog-js's opt_out_capturing flips a localStorage flag that makes
  // every subsequent capture() a no-op. When the user opts back in we
  // call opt_in_capturing to resume.
  useEffect(() => {
    analytics.setConsent(daemonAppConfigReady && config.telemetry?.metrics === true);
  }, [analytics.setConsent, daemonAppConfigReady, config.telemetry?.metrics]);

  // Sync PostHog's distinct_id with the anonymous installationId, both on
  // first opt-in (when the daemon stamps a fresh id) and on Delete-my-data
  // rotation (when PrivacySection.tsx generates a new one). posthog-js
  // caches the previous id in localStorage; identify() alone would stitch
  // the two ids together, so applyIdentity() does reset() first to
  // guarantee the new session is fully decoupled from the deleted one.
  useEffect(() => {
    if (config.telemetry?.metrics !== true) return;
    analytics.setIdentity(config.installationId ?? null);
  }, [analytics.setIdentity, config.installationId, config.telemetry?.metrics]);

  const identityScopeKey = "local";

  // v2 analytics requires every event to carry the configure-state
  // triplet (has_available_configure_cli / configure_type /
  // configure_availability). We push it into the PostHog global register
  // whenever the user's execution-mode config or the detected agent list
  // changes; the next capture inherits the fresh values, so dashboards
  // can segment by execution setup without per-helper boilerplate.
  //
  // Gated on `agentsLoading` so the cold-start probe (`fetchAgentsStream()`
  // lands asynchronously after this effect's first run) does not stamp
  // the first home/projects/plugins page_view with
  // has_available_configure_cli=false / configure_availability=unavailable
  // on machines that DO have an installed CLI. While the probe is in
  // flight we leave the boot defaults ('unknown'/'unknown') in place,
  // matching what the helper would return for an empty agent list with
  // no mode pinned.
  useEffect(() => {
    if (agentsLoading) return;
    const byokConfigured = (() => {
      const protocols = config.apiProtocolConfigs;
      if (!protocols) return Boolean(config.apiKey?.trim());
      return Object.values(protocols).some(
        (cfg) => Boolean(cfg?.apiKey?.trim()),
      );
    })();
    const globals = deriveConfigureGlobals({
      mode: config.mode,
      agentId: config.agentId,
      agents: agents.map((a) => ({ id: a.id, available: a.available })),
      byokConfigured,

    });
    analytics.setConfigureGlobals(globals);
  }, [
    analytics.setConfigureGlobals,
    agentsLoading,
    null,
    config.mode,
    config.agentId,
    config.apiKey,
    config.apiProtocolConfigs,
    agents,
  ]);

  // Stamp the app appearance onto the <html> element so CSS variables pick it
  // up. The theme itself is a constant (light-only), but the accent still comes
  // from config, and the stamp must be re-applied whenever that changes.
  // useLayoutEffect (vs useEffect) fires before the browser paints, so no
  // 1-frame flash. Safe here because the component tree is ssr:false.
  useLayoutEffect(() => {
    applyAppearanceToDocument({ accentColor: config.accentColor });
  }, [config.accentColor]);

  // Tell the daemon what the user is currently looking at, so the MCP
  // server can surface it as `get_active_context` to a coding agent in
  // another repo. Best-effort fire-and-forget; the daemon holds it in
  // memory with a short TTL and the MCP layer falls back to
  // {active:false} if this hasn't run.
  const activeProjectId = route.kind === 'project' ? route.projectId : null;
  const activeFileName = route.kind === 'project' ? route.fileName : null;
  // While a project route is active, background home-surface thumbnail
  // documents must not compete with the project's own foreground reads; the
  // card-click handler suspends the gate synchronously and this effect keeps
  // it authoritative for every other entry path (deep links, quick switcher)
  // and resumes it when the user returns home (Batch A §4.2).
  useEffect(() => {
    if (route.kind === 'project') suspendThumbnailLoads();
    else resumeThumbnailLoads();
  }, [route.kind]);
  // Gate the privacy banner on three things:
  //   1. Daemon config has hydrated (privacyDecisionAt is daemon-owned).
  //   2. The user has not yet made a privacy decision.
  //   3. Onboarding is complete (Skip and design-system creation both flip
  //      onboardingCompleted to true; see handleCompleteOnboarding wiring).
  // Once onboarding is done the banner is allowed on any route — including
  // the project view the design-system finish path drops the user into, so
  // they can read and acknowledge the disclosure while the first generation
  // is running. Settings is irrelevant to visibility; the banner sits above
  // the modal-backdrop layer in index.css so opening Settings does not hide
  // it.
  const showPrivacyConsent =
    daemonConfigLoaded &&
    config.privacyDecisionAt == null &&
    config.telemetry?.metrics === true &&
    config.onboardingCompleted === true;
  useEffect(() => {
    const body = activeProjectId
      ? { projectId: activeProjectId, fileName: activeFileName }
      : { active: false };
    fetch('/api/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {
      // Daemon down or transient network — not worth surfacing.
    });
  }, [activeProjectId, activeFileName]);


  // Bootstrap — detect daemon, then fan out independent fetches so each
  // entry-view tab can render the moment its own data lands. Earlier this
  // was one Promise.all behind a global "Loading workspace…" placeholder,
  // which made the slowest endpoint (typically `/api/agents` on cold start)
  // gate every tab including the ones that don't need agents at all.
  //
  // Boot is a ONE-SHOT: every dependency below is a stable callback, so this
  // runs once per app launch and never again. That is load-bearing, not
  // incidental — this pass owns the first-run onboarding routing decision and
  // rewrites the merged config back to localStorage + the daemon. Re-running it
  // on navigation replays both: a user is re-judged against a config read that
  // may lag their own completion, and gets bounced into the first-run flow they
  // already finished. Anything route- or workspace-derived that boot needs must
  // be read through a ref (see `workspaceProjectViewRef`), and anything that
  // must react to those changes belongs in its own effect.
  useEffect(() => {
    let cancelled = false;
    let effectAgentStreamAbort: AbortController | null = null;
    const configAtBootStart = latestPersistedConfigRef.current;
    (async () => {
      const alive = await daemonIsLive();
      if (cancelled) return;
      setDaemonLive(alive);
      if (!alive) {
        // No daemon — clear every loading flag so empty states render
        // instead of the entry view sitting on indefinite spinners.
        setAgentsLoading(false);
        setSkillsLoading(false);
        setDsLoading(false);
        setProjectsLoading(false);
        setPromptTemplatesLoading(false);
        setDaemonConfigLoaded(true);
        setDaemonAppConfigReady(false);
        return;
      }

      const agentRequestId = beginAgentStreamRequest();
      effectAgentStreamAbort = agentStreamAbortRef.current;
      void fetchAgentsStream({
        signal: effectAgentStreamAbort?.signal,
        onAgent: (agent) => {
          if (cancelled || !isCurrentAgentStreamRequest(agentRequestId)) return;
          setAgents((current) =>
            upsertAgent(current, agent),
          );
        },
      })
        .then((list) => {
          if (cancelled || !isCurrentAgentStreamRequest(agentRequestId)) return;
          setAgentsReady(true);
          reportAgentDetectDiagnostics(analytics.track, list);
          setAgents(
            orderAgentsByRegistry(list),
          );
        })
        .catch((err) => {
          if (
            cancelled ||
            isAbortError(err) ||
            !isCurrentAgentStreamRequest(agentRequestId)
          ) {
            return;
          }
          setAgents([]);
        })
        .finally(() => {
          if (cancelled || !isCurrentAgentStreamRequest(agentRequestId)) return;
          setAgentsLoading(false);
        });

      // The retired template registry requires no startup read. Functional
      // skills load independently through refreshSkills.
      setDesignTemplatesReady(true);
      markSkillRegistryReady('templates');

      const request = beginProjectListRequest(workspaceProjectViewRef.current);
      void listCurrentWorkspaceProjects({
        throwOnError: true,

      }).then((list) => {
        if (!cancelled) reconcileFetchedProjects(list, request);
      }).catch(() => {
        if (!cancelled) recordProjectListFailure(request);
      }).finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });


      let promptsReady = true;
      void fetchPromptTemplates({ onReadResult: ready => { promptsReady = ready; } }).then((list) => {
        if (cancelled) return;
        setPromptTemplatesReady(promptsReady);
        setPromptTemplates(list);
        setPromptTemplatesLoading(false);
      });

      void fetchAppVersionInfo().then((info) => {
        if (cancelled) return;
        setAppVersionInfo(info);
      });

      // Daemon-persisted config + composio config + media provider config land
      // together so the welcome-modal decision and daemon-backed settings
      // apply in one merge, avoiding a flash where local-only state is shown
      // before daemon overrides it.
      void Promise.all([
        fetchDaemonConfig(),        fetchMediaProvidersFromDaemon(),
      ]).then(async ([
        daemonConfig,
        daemonMediaProvidersResult,
      ]) => {
        if (cancelled) return;
        const daemonMediaProvidersLoaded =
          daemonMediaProvidersResult.status === 'ok'
            ? daemonMediaProvidersResult.providers
            : null;
        setDaemonMediaProviders(daemonMediaProvidersLoaded);
        setDaemonMediaProvidersFetchState(daemonMediaProvidersResult.status);
        setMediaProvidersNotice(
          daemonMediaProvidersResult.status === 'error'
            ? t('settings.mediaProviderLoadError')
            : null,
        );
        // Settings and the composer remain interactive while daemon hydration
        // is in flight. Hydrate the config boot started from, then rebase what
        // the user changed since onto it, so the boot snapshot cannot overwrite
        // a user write here or through the write-back below.
        const baseConfig = latestPersistedConfigRef.current;
        const migratedLocalMediaProviders = shouldSyncLocalMediaProvidersToDaemon(
          baseConfig.mediaProviders,
          daemonMediaProvidersLoaded,
        );
        const next = mergeDaemonMediaProviders(
          rebaseConfigEdits(
            configAtBootStart,
            baseConfig,
            mergeDaemonConfig(configAtBootStart, daemonConfig),
          ),
          daemonMediaProvidersLoaded,
        );
        saveConfig(next);
        if (
          daemonMediaProvidersResult.status === 'ok'
          && migratedLocalMediaProviders
          && hasAnyConfiguredProvider(next.mediaProviders)
        ) {
          void syncMediaProvidersToDaemon(next.mediaProviders, {
            daemonProviders: daemonMediaProvidersLoaded,
          });
        }
        // Migrate localStorage prefs to daemon on first boot with the new
        // endpoint. If daemon already had values the merge above used them;
        // writing back is idempotent and keeps both sides in sync.
        void syncConfigToDaemon(next);
        latestPersistedConfigRef.current = next;
        setConfig(next);

        // Route first-run users through the global onboarding panel.
        // The onboarding panel and the privacy banner have independent
        // lifecycles: onboarding keys off `onboardingCompleted`, the
        // banner keys off `privacyDecisionAt`. They may coexist on the
        // first launch; the banner sits above the modal layer so it
        // stays actionable regardless of the active view.
        if (shouldRouteToFirstRunOnboarding(next, window.location.pathname)) {
          navigate({ kind: 'home', view: 'onboarding' }, { replace: true });
        }
        setDaemonConfigLoaded(true);
        // Only a non-null GET payload means we actually observed daemon prefs.
        setDaemonAppConfigReady(daemonConfig != null);
      });
    })();
    return () => {
      cancelled = true;
      effectAgentStreamAbort?.abort();
    };
    // `workspaceProjectView` is intentionally absent: it is route-derived, and
    // depending on it would turn this one-shot boot pass into a per-navigation
    // one. It is read through `workspaceProjectViewRef` instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    beginAgentStreamRequest,
    beginProjectListRequest,
    isCurrentAgentStreamRequest,
    listCurrentWorkspaceProjects,
    reconcileFetchedProjects,
    recordProjectListFailure,
  ]);

  // Keep the active projection's last-good display in sync with optimistic
  // local mutations (rename/delete/create). Related projections are marked
  // dirty by the mutation helpers and still revalidate when selected.
  useEffect(() => {
    if (projectsLoading) return;
    writeProjectDisplaySnapshot(projects);
  }, [
    currentProjectDisplayKey,
    effectiveWorkspaceProjectView,
    projectDisplayAccountGeneration,
    projects,
    projectsLoading,
    null,
  ]);

  // Auto-pick the first available agent once both the daemon-stored config
  // and the agents listing have landed. Splitting this out of bootstrap
  // avoids racing the local-config initial value against a slow agents
  // probe — by the time this runs, daemonConfig has already overlaid the
  // user's previous choice, so we only fill an empty slot.
  //
  // First-run onboarding is the one time we must NOT do this: the onboarding
  // flow owns the initial agent pick. Backfill an empty slot only for returning users.
  useEffect(() => {
    if (!daemonConfigLoaded || agentsLoading) return;
    if (config.onboardingCompleted !== true) return;
    if (config.agentId) return;
    const firstAvailable = agents.find((a) => a.id === 'codex' && a.available)
      ?? agents.find((a) => a.available);
    if (!firstAvailable) return;
    setConfig((prev) => {
      if (prev.agentId) return prev;
      const next: AppConfig = { ...prev, agentId: firstAvailable.id };
      saveConfig(next);
      void syncConfigToDaemon(next);
      return next;
    });
  }, [
    daemonConfigLoaded,
    agentsLoading,
    agents,
    config.agentId,
    config.onboardingCompleted,
  ]);

  const refreshProjectsStrict = useCallback(async () => {
    const request = beginProjectListRequest(workspaceProjectView);
    try {
      const list = await listCurrentWorkspaceProjects({
        throwOnError: true,

      });
      reconcileFetchedProjects(list, request);
    } catch (error) {
      recordProjectListFailure(request);
      throw error;
    }
  }, [beginProjectListRequest, listCurrentWorkspaceProjects, reconcileFetchedProjects, recordProjectListFailure, workspaceProjectView]);

  const refreshProjects = useCallback(
    () => refreshProjectsStrict().catch(() => {}),
    [refreshProjectsStrict],
  );

  useEffect(() => {
    // Bootstrap already reads this exact scope on mount. Only re-list after
    // the resolved workspace identity or a workspace-specific route changes;
    // local navigation does not alter the unscoped project catalogue.
    if (!projectScopeRefreshMountedRef.current) {
      projectScopeRefreshMountedRef.current = true;
      return;
    }
    let cancelled = false;
    const request = beginProjectListRequest(effectiveWorkspaceProjectView);
    const snapshot = readProjectDisplaySnapshot();
    if (snapshot) {
      setProjects(snapshot.projects);
      setProjectsLoading(false);
    } else {
      setProjectsLoading(true);
    }
    (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const list = await listCurrentWorkspaceProjects({
            throwOnError: true,

          });
          if (!cancelled) reconcileFetchedProjects(list, request);
          return;
        } catch (err) {
          if (cancelled) return;
          if (attempt === 0) {
            // Switching into a team workspace can race the daemon's remote
            // team-project-catalog session warming up for it (recvqaeREM6pdv:
            // a transient 502 here used to be silently downgraded to an empty
            // list, which HomeView cannot tell apart from a genuinely empty
            // workspace and renders as the first-run empty state). Retry once
            // before giving up instead of reconciling a failure as "no
            // projects".
            await new Promise((resolve) => setTimeout(resolve, 1200));
            continue;
          }
          recordProjectListFailure(request);
          console.error('[projects] failed to refresh after workspace switch', err);
        }
      }
    })().finally(() => {
      if (!cancelled) setProjectsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    undefined,
    beginProjectListRequest,
    currentProjectDisplayKey,
    effectiveWorkspaceProjectView,
    listCurrentWorkspaceProjects,
    reconcileFetchedProjects,
    recordProjectListFailure,
  ]);

  const refreshSkills = useCallback(async () => {
    const issuedCatalogIdentity = 'local';
    const requestGeneration =
      (skillsRequestGenerationRef.current.get(issuedCatalogIdentity) ?? 0) + 1;
    skillsRequestGenerationRef.current.set(issuedCatalogIdentity, requestGeneration);
    let ready = true;
    const list = await fetchSkills({ onReadResult: success => { ready = success; } });
    // Only the latest refresh may replace the local catalog.
    if (
      skillsRequestGenerationRef.current.get(issuedCatalogIdentity) !== requestGeneration
    ) return;
    setWorkspaceSkills({
      identity: issuedCatalogIdentity,
      items: list,
      ready,
    });
    markSkillRegistryReady('functional');
  }, [markSkillRegistryReady]);

  const skillsReadIdentity = "local";
  const skillsReadIdentityRef = useRef<string | null>(null);
  useEffect(() => {

    if (skillsReadIdentityRef.current === skillsReadIdentity) return;
    skillsReadIdentityRef.current = skillsReadIdentity;

    void refreshSkills();
  }, [
    false,
    false,
    skillsReadIdentity,
    refreshSkills,
    undefined,
  ]);


  const reloadMediaProvidersFromDaemon = useCallback(async () => {
    const result = await fetchMediaProvidersFromDaemon();
    if (result.status !== 'ok') {
      setDaemonMediaProvidersFetchState('error');
      setMediaProvidersNotice(
        t('settings.mediaProviderLoadError'),
      );
      return null;
    }
    setDaemonMediaProviders(result.providers);
    setDaemonMediaProvidersFetchState('ok');
    setMediaProvidersNotice(null);
    setConfig((prev) => {
      const merged = mergeDaemonMediaProviders(prev, result.providers);
      saveConfig(merged);
      return merged;
    });
    return result.providers;
  }, []);

  /**
   * Non-optimistic, serialized write for the daemon-owned silent-update
   * preference. Concurrent Settings / popup toggles cannot commit out of
   * order: only the latest request applies to app state after its daemon
   * write succeeds.
   */
  const silentUpdatePreferenceWriterRef = useRef(
    createSilentUpdatePreferenceWriter<AppConfig>({
      readBase: () => latestPersistedConfigRef.current,
      writeDaemon: async (next) => {
        await syncConfigToDaemon(next, { throwOnError: true });
      },
      commit: (allowSilentUpdates) => {
        const next: AppConfig = {
          ...latestPersistedConfigRef.current,
          allowSilentUpdates,
        };
        latestPersistedConfigRef.current = next;
        setConfig((prev) => ({ ...prev, allowSilentUpdates }));
        // saveConfig strips daemon-owned keys from localStorage; in-memory
        // config still carries allowSilentUpdates for the rest of the session.
        saveConfig(next);
      },
    }),
  );
  const handleSilentUpdatePreferenceChange = useCallback(async (allowSilentUpdates: boolean) => {
    await silentUpdatePreferenceWriterRef.current.write(allowSilentUpdates);
  }, []);

  /**
   * Autosave-driven persistence path. The settings dialog calls this on
   * every committed edit (via a debounced effect) so localStorage and
   * the daemon stay in lock-step with the user's draft. We deliberately
   * do NOT touch the Composio secret here — it has its own gesture
   * (handleConfigPersistComposioKey) so partial keys never leave the
   * browser. Onboarding is also left alone; the dialog's close path
   * is the canonical "I'm done" signal.
   */
  const handleConfigPersist = useCallback(async (
    next: AppConfig,
    options?: { forceMediaProviderSync?: boolean },
  ) => {
    // Strip the in-flight Composio secret before anything hits disk so
    // a half-typed key can't survive in localStorage. If the dialog is
    // closing, preserve any onboarding completion that the close gesture
    // already committed so an unmount autosave cannot re-open the welcome flow.
    // allowSilentUpdates is daemon-owned and must not be applied optimistically:
    // keep the previous value in memory until the daemon write succeeds.
    const prevSilent = latestPersistedConfigRef.current.allowSilentUpdates;
    const nextSilent = next.allowSilentUpdates;
    const silentChanged = nextSilent !== prevSilent;
    const nextForOptimistic = silentChanged
      ? { ...next, allowSilentUpdates: prevSilent }
      : next;
    const persisted = buildPersistedConfig(nextForOptimistic, configRef.current);
    latestPersistedConfigRef.current = persisted;
    saveConfig(persisted);
    setConfig(persisted);
    const shouldSyncMediaProviders =
      daemonMediaProvidersFetchState === 'ok'
      && shouldSyncMediaProvidersOnSave(persisted.mediaProviders, {
        force: options?.forceMediaProviderSync,
      });
    const daemonPayload = silentChanged
      ? { ...persisted, allowSilentUpdates: nextSilent }
      : persisted;
    await Promise.all([
      shouldSyncMediaProviders
        ? syncMediaProvidersToDaemon(persisted.mediaProviders, {
            force: options?.forceMediaProviderSync,
            daemonProviders: daemonMediaProviders,
            throwOnError: options?.forceMediaProviderSync,
          })
        : Promise.resolve(),
      syncConfigToDaemon(daemonPayload, { throwOnError: true }),
    ]);
    if (silentChanged) {
      latestPersistedConfigRef.current = {
        ...latestPersistedConfigRef.current,
        allowSilentUpdates: nextSilent,
      };
      setConfig((curr) => ({ ...curr, allowSilentUpdates: nextSilent }));
    }
  }, [daemonMediaProviders, daemonMediaProvidersFetchState]);

  const handleSettingsDraftChange = useCallback((draft: AppConfig) => {
    settingsDraftConfigRef.current = draft;
  }, []);

  const handlePrivacyConsentChoice = useCallback((share: boolean) => {
    const base = settingsDraftConfigRef.current ?? latestPersistedConfigRef.current;
    const installationId = share
      ? base.installationId ?? generateInstallationIdSafe()
      : null;
    void handleConfigPersist({
      ...base,
      installationId,
      privacyDecisionAt: Date.now(),
      telemetry: {
        ...(base.telemetry ?? {}),
        metrics: share,
      },
    });
  }, [handleConfigPersist]);

  const handleModeChange = useCallback(
    (mode: AppConfig['mode']) => {
      const next = { ...latestPersistedConfigRef.current, mode };
      latestPersistedConfigRef.current = next;
      saveConfig(next);
      setConfig(next);
    },
    [],
  );

  const handleAgentChange = useCallback(
    (agentId: string) => {
      const next = { ...latestPersistedConfigRef.current, agentId };
      latestPersistedConfigRef.current = next;
      saveConfig(next);
      void syncConfigToDaemon(next);
      setConfig(next);
    },
    [],
  );

  // OPEND-3205: this action changes the runtime in the current project. Do not
  // optimistically acknowledge a daemon write or arm a Settings-return retry.


  const handleAgentModelChange = useCallback(
    (agentId: string, choice: { model?: string; reasoning?: string; serviceTier?: string }) => {
      const current = latestPersistedConfigRef.current;
      const prev = current.agentModels?.[agentId] ?? {};
      const merged = mergeAgentModelChoice(prev, choice);
      const nextAgentModels = {
        ...(current.agentModels ?? {}),
        [agentId]: merged,
      };
      const next = { ...current, agentModels: nextAgentModels };
      latestPersistedConfigRef.current = next;
      saveConfig(next);
      void syncConfigToDaemon(next);
      setConfig(next);
    },
    [],
  );

  // BYOK protocol switch — also flips `mode` to 'api' so the user does
  // not have to take a second step after picking a provider from the
  // inline switcher. The helper preserves any per-protocol fields the
  // user had previously configured for the target protocol.
  const handleApiProtocolChange = useCallback(
    (protocol: ApiProtocol) => {
      const next = switchApiProtocolConfig(
        latestPersistedConfigRef.current,
        protocol,
      );
      latestPersistedConfigRef.current = next;
      saveConfig(next);
      void syncConfigToDaemon(next);
      setConfig(next);
    },
    [],
  );

  // BYOK model picker — patches `model` (and the per-protocol shadow
  // copy) without touching apiKey/baseUrl so the user can swap models
  // mid-session without retyping their key.
  const handleApiModelChange = useCallback(
    (model: string) => {
      const next = updateCurrentApiProtocolConfig(
        latestPersistedConfigRef.current,
        { model },
      );
      latestPersistedConfigRef.current = next;
      saveConfig(next);
      void syncConfigToDaemon(next);
      setConfig(next);
    },
    [],
  );

  const refreshAgents = useCallback(
    async (options?: { throwOnError?: boolean; agentCliEnv?: AppConfig['agentCliEnv']; refresh?: boolean }) => {
      if (options && Object.prototype.hasOwnProperty.call(options, 'agentCliEnv')) {
        const current = latestPersistedConfigRef.current;
        const nextConfig = {
          ...current,
          agentCliEnv: options.agentCliEnv ?? {},
        };
        latestPersistedConfigRef.current = nextConfig;

        saveConfig(nextConfig);
        setConfig(nextConfig);
        await syncConfigToDaemon(nextConfig);
      }
      const agentRequestId = beginAgentStreamRequest();
      setAgentsLoading(true);
      try {
        const next = await fetchAgentsStream({
          signal: agentStreamAbortRef.current?.signal,
          refresh: options?.refresh ?? true,
          onAgent: (agent) => {
            if (!isCurrentAgentStreamRequest(agentRequestId)) return;
            setAgents((current) =>
              upsertAgent(current, agent),
            );
          },
        });
        const ordered = orderAgentsByRegistry(next);
        reportAgentDetectDiagnostics(analytics.track, ordered);
        if (isCurrentAgentStreamRequest(agentRequestId)) {
          setAgentsReady(true);
          setAgents(ordered);
          setAgentsLoading(false);
        }
        return ordered;
      } catch (err) {
        if (!isCurrentAgentStreamRequest(agentRequestId)) return [];
        setAgentsLoading(false);
        if (options?.throwOnError) throw err;
        setAgents([]);
        return [];
      }
    },
    [beginAgentStreamRequest, isCurrentAgentStreamRequest],
  );

  useEffect(() => {
    if (!daemonLive || agentsLoading) return;

    const refreshIfDue = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - agentFocusRefreshLastRunRef.current < AGENT_FOCUS_REFRESH_THROTTLE_MS) return;
      agentFocusRefreshLastRunRef.current = now;
      void refreshAgents({ refresh: false });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshIfDue();
    };

    window.addEventListener('focus', refreshIfDue);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshIfDue);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [agentsLoading, daemonLive, refreshAgents]);

  useEffect(() => {
    const handleAppConfigChanged = () => {
      void fetchDaemonConfig().then((daemonConfig) => {
        const previous = latestPersistedConfigRef.current;
        const next = mergeDaemonConfig(previous, daemonConfig);
        latestPersistedConfigRef.current = next;
        saveConfig(next);
        setConfig(next);
        void refreshAgents({ refresh: false });
      });
    };
    window.addEventListener(APP_CONFIG_CHANGED_EVENT, handleAppConfigChanged);
    return () => window.removeEventListener(APP_CONFIG_CHANGED_EVENT, handleAppConfigChanged);
  }, [refreshAgents]);

  /**
   * Undo an optimistic hand-off that will not become a project: drop the
   * optimistic row and pending frame, return to Home if the user is still on
   * that route, and hand the staged files back so the retry sends the same
   * payload. Home remounts on the way back and restores its prompt draft on
   * its own. `notice` surfaces as the create-error toast; a caller whose own
   * UI already explained the outcome (the balance dialog) passes none.
   */
  const rollbackOptimisticProjectCreation = useCallback(
    (projectId: string, stagedFiles: readonly File[], notice: string | null) => {
      clearLocalProject(projectId);
      releaseProjectRunStatusReads(projectId);
      pendingProjectConversationIdsRef.current.delete(projectId);
      removeWorkspaceProjectTabs(projectId);
      setProjects((current) => current.filter((project) => project.id !== projectId));
      setPendingProjectCreation((current) =>
        current?.projectId === projectId ? null : current);
      stashHomeComposerAttachments(stagedFiles);
      if (
        routeRef.current.kind === 'project'
        && routeRef.current.projectId === projectId
      ) {
        navigate({ kind: 'home', view: 'home' });
      }
      if (notice) setProjectCreateError(notice);
    },
    [clearLocalProject],
  );

  /**
   * Enter the project frame for a Home send NOW, before anything is awaited.
   * The id is client-owned and the daemon accepts that exact id for
   * idempotent retries. Keep the real ProjectView unmounted until the response
   * settles; the pending surface is deliberately read-free so an unpersisted
   * project cannot fan out unauthorized conversation/file/presence requests.
   *
   * Home calls this on the click tick. `handleCreateProject` also calls it for
   * auto-send creates that did not come through Home's composer.
   */
  const beginOptimisticProjectCreation = useCallback(
    (input: AppCreateProjectInput): OptimisticProjectCreationHandoff => {
      const derivedPendingPrompt =
        input.pendingPrompt ??
        (input.metadata?.promptTemplate?.prompt?.trim() || undefined);
      const metadata = mergeLinkedDirsIntoMetadata(input.metadata, input.linkedDirs);
      const stagedFiles = Array.isArray(input.pendingFiles)
        ? input.pendingFiles.filter((file): file is File => file instanceof File)
        : [];
      // PRODUCT INVARIANT: ordinary project creation is local. Reuse a
      // current in-memory Workspace snapshot for `personal` + `local_only`
      // attribution when available, but never start identity discovery or
      // block creation on Workspace availability.
      const createWorkspaceState = null;
      const optimisticProjectId = randomUUID();
      const optimisticConversationId = randomUUID();
      const now = Date.now();
      const optimisticProject: Project = {
        id: optimisticProjectId,
        name: input.name.trim(),
        skillId: input.skillId,
        createdAt: now,
        updatedAt: now,
        ...(derivedPendingPrompt ? { pendingPrompt: derivedPendingPrompt } : {}),
        ...(metadata ? { metadata } : {}),
        ...(input.appliedPluginSnapshotId
          ? { appliedPluginSnapshotId: input.appliedPluginSnapshotId }
          : {}),
        ...({}),
      };
      rememberLocalProject(optimisticProjectId);
      holdProjectRunStatusReads(optimisticProjectId);
      // A previous rollback's snapshot must not outlive the retry that
      // carries the same files; the new attempt owns them from here.
      clearHomeComposerAttachments();
      flushSync(() => {
        setPendingProjectCreation({
          projectId: optimisticProjectId,
          conversationId: optimisticConversationId,
          name: optimisticProject.name,
          prompt: derivedPendingPrompt ?? '',
          files: stagedFiles,
        });
        setProjects((current) => [
          optimisticProject,
          ...current.filter((project) => project.id !== optimisticProjectId),
        ]);
      });
      pendingProjectConversationIdsRef.current.set(optimisticProjectId, optimisticConversationId);
      const optimisticRoute = {
        kind: 'project',
        projectId: optimisticProjectId,
        conversationId: optimisticConversationId,
        fileName: null,
      } as const;
      openWorkspaceTab(optimisticRoute);
      navigate(optimisticRoute);
      return {
        projectId: optimisticProjectId,
        rollback: (options) =>
          rollbackOptimisticProjectCreation(
            optimisticProjectId,
            stagedFiles,
            options?.notice ?? null,
          ),
      };
    },
    [rememberLocalProject, rollbackOptimisticProjectCreation],
  );

  const handleCreateProject = useCallback(
    async (
      input: AppCreateProjectInput,
    ): Promise<boolean> => {
      // Honor an explicit `null` design system — the create panel defaults
      // to "None" for every kind now, and the user expects that to land
      // as a no-design-system project rather than silently inheriting the
      // workspace default.
      const derivedPendingPrompt =
      input.pendingPrompt ??
      (input.metadata?.promptTemplate?.prompt?.trim() || undefined);

      const metadata = mergeLinkedDirsIntoMetadata(input.metadata, input.linkedDirs);
      const fidelity = fidelityToTracking(metadata?.fidelity ?? null);
      let optimisticProjectId: string | null = input.optimisticProjectId ?? null;
      let result;
      const stagedFiles = Array.isArray(input.pendingFiles)
        ? input.pendingFiles.filter((file): file is File => file instanceof File)
        : [];
      try {
        // PRODUCT INVARIANT: ordinary project creation is local. Reuse a
        // current in-memory Workspace snapshot for `personal` + `local_only`
        // attribution when available, but never start identity discovery or
        // block creation on Workspace availability. Remote share/sync/move
        // operations retain their authoritative gates.
        const createWorkspaceState = null;

        // An auto-send create that did not come through Home's composer opens
        // its frame here; Home's own sends arrive with the frame already up.
        if (input.autoSendFirstMessage && !optimisticProjectId) {
          optimisticProjectId = beginOptimisticProjectCreation(input).projectId;
        }
        const optimisticConversationId = optimisticProjectId
          ? pendingProjectConversationIdsRef.current.get(optimisticProjectId)
          : undefined;
        result = await createProject({
          ...(optimisticProjectId ? { id: optimisticProjectId } : {}),
          ...(optimisticConversationId ? { conversationId: optimisticConversationId } : {}),
          name: input.name,
          skillId: input.skillId,
          pendingPrompt: derivedPendingPrompt,
          metadata,
          ...(input.conversationMode ? { conversationMode: input.conversationMode } : {}),
          ...(input.pluginId ? { pluginId: input.pluginId } : {}),
          ...(input.pluginSource ? { pluginSource: input.pluginSource } : {}),
          ...(input.appliedPluginSnapshotId
            ? { appliedPluginSnapshotId: input.appliedPluginSnapshotId }
            : {}),
          ...(input.pluginInputs ? { pluginInputs: input.pluginInputs } : {}),
          ...({}),
          ...(input.exampleReference
            ? { exampleReference: input.exampleReference }
            : {}),

        });
      } catch (err) {
        const errorCode =
          err instanceof Error && err.message.trim()
            ? err.message
            : 'CREATE_REQUEST_FAILED';
        trackProjectCreateResult(
          analytics.track,
          {
            page_name: 'home',
            area: 'new_project',
            project_source: 'create_button',
            project_id: null,
            project_kind: projectKindFromMetadataToTracking(metadata),
            fidelity,
            result: 'failed',
            error_code: errorCode,
          },
          { requestId: input.requestId },
        );
        if (optimisticProjectId) {
          rollbackOptimisticProjectCreation(
            optimisticProjectId,
            stagedFiles,
            homeCreateFailureNotice(err, t, errorCode),
          );
          return false;
        }
        throw err;
      }
      if (!result) {
        trackProjectCreateResult(
          analytics.track,
          {
            page_name: 'home',
            area: 'new_project',
            project_source: 'create_button',
            project_id: null,
            project_kind: projectKindFromMetadataToTracking(metadata),
            fidelity,
            ...(input.pluginId ? { plugin_id: input.pluginId } : {}),
            ...(input.pluginType ? { plugin_type: input.pluginType } : {}),
            result: 'failed',
            error_code: 'CREATE_REQUEST_FAILED',
          },
          { requestId: input.requestId },
        );
        return false;
      }
      let project = result.appliedPluginSnapshotId
        ? {
            ...result.project,
            appliedPluginSnapshotId: result.appliedPluginSnapshotId,
          }
        : result.project;
      if (optimisticProjectId) {
        releaseProjectRunStatusReads(optimisticProjectId);
        // The files now belong to this project (uploaded below); a later Home
        // visit must not revive them into the composer.
        clearHomeComposerAttachments();
        rememberLocalProject(project.id);
        flushSync(() => {
          setProjects((curr) => [
            project,
            ...curr.filter((candidate) => candidate.id !== project.id),
          ]);
        });
      }
      try {
        const pendingFiles = stagedFiles;
        // Flip the project onto the user-picked working directory BEFORE
        // uploading staged Home attachments. `replaceProjectWorkingDir` changes
        // `metadata.baseDir`, so the project starts reading from the external
        // folder. If we uploaded first, the staged files would land in the
        // temporary managed `.pixo/projects/<id>` root and then silently vanish
        // from Files and the first auto-send context once the working
        // dir flips. Doing the handoff first means the initial upload lands in
        // the final tree.
        const userWorkingDir = metadata?.userWorkingDir;
        let workingDirHandoffFailed = false;
        if (userWorkingDir) {
          try {
            const moved = await replaceProjectWorkingDir(
              result.project.id,
              userWorkingDir,
              input.userWorkingDirToken
            );
            // The project now lives in that folder, and a folder that already
            // holds a game has no plan: the open project must show both.
            if (moved?.project) {
              project = { ...project, ...moved.project };
              const updated = project;
              setProjects((curr) => curr.map((candidate) => candidate.id === updated.id ? updated : candidate));
            }
          } catch (err) {
            // The desktop working-dir token is short-lived (~60s TTL); if the
            // user lingered on Home or the POST was otherwise rejected, the
            // handoff fails AFTER the project already exists. Do NOT swallow
            // this and do NOT proceed: uploading staged attachments or
            // auto-sending the first message would target the managed
            // `.pixo/projects/<id>` root the user did not choose. Mark the
            // handoff as failed so the upload + auto-send branches below are
            // skipped, then surface a create-time error so the user can
            // re-pick the working directory from inside the project.
            console.warn('Failed to set working directory for new project', userWorkingDir, err);
            workingDirHandoffFailed = true;
            setWorkingDirError(
              `Couldn't apply the chosen folder "${userWorkingDir}". The project was created in the default location — re-pick the working directory from the project before uploading files or sending a message.`,
            );
          }
        }
        // The project row exists and its working directory is final, so the
        // real project frame is allowed to open — and it must open NOW, not
        // when the last attachment finishes. Park the picked files first so
        // ProjectView's very first render already has cards to draw for them,
        // then drop the gate. Everything below this line happens behind an
        // interactive project instead of behind a frozen hand-off screen.
        //
        // "Drop the gate" marks the record persisted rather than clearing it
        // (OPEND-2170): ProjectView mounts now, but keeps drawing this
        // record's chat card until its first transcript settles
        // (`handleCreationHandoffSettled`), so the column never flips through
        // the view's own loaders in between.
        if (!workingDirHandoffFailed) {
          beginHomeAttachmentUploads(result.project.id, pendingFiles);
        }
        setPendingProjectCreation((current) =>
          current?.projectId === optimisticProjectId ? { ...current, created: true } : current,
        );
        let firstMessageAttachments: ChatAttachment[] = [];
        if (!workingDirHandoffFailed && pendingFiles.length > 0) {
          // Home composer attaches stay client-side until submit lands a
          // project; the actual upload happens here. v2 doc wants one
          // file_upload_result per surface — `page_name='home'` /
          // `area='chat_composer'` so it's distinguishable from the
          // file_manager Upload button and the chat_panel composer.
          const cohort = deriveUploadCohort(pendingFiles);
          // One request per file at `STAGED_UPLOAD_CONCURRENCY`, the same shape
          // the in-project composer has used since the staged-attachment work.
          // The single 12-file batch this replaces made every attachment wait
          // on the slowest one, and reported one failure as a failure for the
          // whole batch plus every file queued behind it.
          const outcomes = await runWithConcurrency(
            pendingFiles,
            STAGED_UPLOAD_CONCURRENCY,
            async (file, index) => {
              try {
                return await uploadProjectFiles(
                  result.project.id,
                  [file],
                  undefined
                );
              } finally {
                // This file's card leaves the tray the moment it answers, so
                // the batch drains in front of the user instead of vanishing
                // all at once at the end. Also where its object URL is
                // revoked — see `settleHomeAttachmentUpload`.
                settleHomeAttachmentUpload(result.project.id, index);
              }
            },
          );
          // `runWithConcurrency` answers in input order, so the first message
          // keeps the order the user picked, not the order the uploads landed.
          const dismissedOrders = dismissedHomeAttachmentOrders(result.project.id);
          firstMessageAttachments = outcomes.flatMap((outcome, index) =>
            dismissedOrders.has(index) ? [] : outcome.uploaded);
          const failedUploads = outcomes.flatMap((outcome) => outcome.failed);
          const firstUploadError = outcomes.find((outcome) => outcome.error)?.error;
          const partial = failedUploads.length > 0;
          if (partial) {
            console.warn('Some Home attachments failed to upload', failedUploads);
          }
          trackFileUploadResult(analytics.track, {
            page_name: 'home',
            area: 'chat_composer',
            project_id: result.project.id,
            ...cohort,
            result: partial ? 'failed' : 'success',
            ...(partial && firstUploadError
              ? { error_code: firstUploadError }
              : {}),
          });
        }
        trackProjectCreateResult(
          analytics.track,
          {
            page_name: 'home',
            area: 'new_project',
            project_source: 'create_button',
            project_id: result.project.id,
            project_kind: projectKindFromMetadataToTracking(metadata),
            fidelity,
            ...(input.pluginId ? { plugin_id: input.pluginId } : {}),
            ...(input.pluginType ? { plugin_type: input.pluginType } : {}),
            result: 'success',
          },
          { requestId: input.requestId },
        );
        // PluginLoopHome flow: the user already typed (or accepted) the
        // first message on Home. Mark this project so ProjectView fires
        // sendMessage(pendingPrompt) once on mount instead of just
        // pre-filling the composer. Scoped to sessionStorage so a page
        // reload after the run has started does not refire.
        if (
          !workingDirHandoffFailed &&
          input.autoSendFirstMessage &&
          (derivedPendingPrompt !== undefined || firstMessageAttachments.length > 0)
        ) {
          try {
            window.sessionStorage.setItem(
              `pixo:auto-send-first:${result.project.id}`,
              '1',
            );
            if (derivedPendingPrompt !== undefined) {
              window.sessionStorage.setItem(
                `pixo:auto-send-prompt:${result.project.id}`,
                derivedPendingPrompt,
              );
            } else {
              window.sessionStorage.removeItem(
                `pixo:auto-send-prompt:${result.project.id}`,
              );
            }


            if (firstMessageAttachments.length > 0) {
              window.sessionStorage.setItem(
                `pixo:auto-send-attachments:${result.project.id}`,
                JSON.stringify(firstMessageAttachments),
              );
            } else {
              window.sessionStorage.removeItem(
                `pixo:auto-send-attachments:${result.project.id}`,
              );
            }
            if (input.initialRunContext && Object.keys(input.initialRunContext).length > 0) {
              window.sessionStorage.setItem(
                `pixo:auto-send-context:${result.project.id}`,
                JSON.stringify(input.initialRunContext),
              );
            } else {
              window.sessionStorage.removeItem(
                `pixo:auto-send-context:${result.project.id}`,
              );
            }
          } catch {
            /* sessionStorage may be unavailable (e.g. SSR / private mode); fall
               back to manual send. */
          }
        }
        if (!optimisticProjectId) {
          rememberLocalProject(project.id);
          flushSync(() => {
            setProjects((curr) => [
              project,
              ...curr.filter((candidate) => candidate.id !== project.id),
            ]);
          });
        }
      } catch (err) {
        if (!optimisticProjectId) throw err;
        const errorCode =
          err instanceof Error && err.message.trim() ? err.message : 'PROJECT_SETUP_FAILED';
        console.warn('Failed to finish setting up new project', project.id, err);
        setProjectCreateError(errorCode);
      } finally {
        // Whatever happened to the uploads — answered, failed, or threw before
        // they started — nothing may be left holding an object URL for the
        // rest of the session, and no card may sit in the tray for a file that
        // is never coming.
        endHomeAttachmentUploads(project.id);
        // The creation record outlives the request on purpose (OPEND-2170):
        // ProjectView keeps drawing the hand-off's chat card from it until
        // its first transcript settles (`handleCreationHandoffSettled`), so
        // the column never flips through the view's own loaders in between.
      }
      const projectRoute = {
        kind: 'project',
        projectId: project.id,
        fileName: null,
      } as const;
      // The Home auto-send path already owns this route from the optimistic
      // handoff. Do not re-navigate after persistence: if the user deliberately
      // backed out while creation finished, reopening the project would steal
      // focus. Non-optimistic creation paths retain the existing navigation.
      if (!optimisticProjectId) {
        openWorkspaceTab(projectRoute);
        navigate(projectRoute);
      }
      return true;
    },
    [
      analytics.track,
      beginOptimisticProjectCreation,
      rememberLocalProject,
      rollbackOptimisticProjectCreation,
      t,
    ],
  );

  const handleDuplicateProject = useCallback(
    async (sourceProjectId: string, input: { name?: string } = {}) => {
      const result = await duplicateProject(sourceProjectId, input);
      rememberLocalProject(result.project.id);
      setProjects((curr) => [
        result.project,
        ...curr.filter((p) => p.id !== result.project.id),
      ]);
      navigate({
        kind: 'project',
        projectId: result.project.id,
        conversationId: result.conversationId,
        fileName: null,
      });
    },
    [rememberLocalProject],
  );

  const handleCreatePluginShareProject = useCallback(
    async (
      pluginId: string,
      action: PluginShareAction,
      locale?: string,
    ): Promise<PluginShareProjectOutcome> => {
      // Best-effort, NOT `resolvedWorkspaceContextForWrite`: that helper throws
      // while the identity read is in flight, and refusing this create would be
      // a new block on a path that works today. Sending the context whenever it
      // is known is a strict improvement — this call used to send none, ever —
      // and the daemon binds a headerless create to its own signed-in workspace
      // (`createdProjectWorkspaceHome`), so the loading window no longer
      // produces an orphan either way.
      const outcome = await createPluginShareProject(
        pluginId,
        action,
        locale
      );
      if (!outcome.ok) return outcome;
      try {
        window.sessionStorage.setItem(
          `pixo:auto-send-first:${outcome.project.id}`,
          '1',
        );
        if (outcome.project.pendingPrompt !== undefined) {
          window.sessionStorage.setItem(
            `pixo:auto-send-prompt:${outcome.project.id}`,
            outcome.project.pendingPrompt,
          );
        }
      } catch {
        // If sessionStorage is unavailable, the project still opens with
        // the prepared prompt in the composer.
      }
      const project = outcome.appliedPluginSnapshotId
        ? {
            ...outcome.project,
            appliedPluginSnapshotId: outcome.appliedPluginSnapshotId,
          }
        : outcome.project;
      rememberLocalProject(project.id);
      setProjects((curr) => [
        project,
        ...curr.filter((p) => p.id !== project.id),
      ]);
      navigate({
        kind: 'project',
        projectId: project.id,
        fileName: null,
      });
      return outcome;
    },
    [rememberLocalProject],
  );

  const handleImportFolder = useCallback(async (baseDir: string) => {
    const result = await importFolderProject(
      { baseDir }
    );
    rememberLocalProject(result.project.id);
    setProjects((curr) => [result.project, ...curr.filter((p) => p.id !== result.project.id)]);
    navigate({
      kind: 'project',
      projectId: result.project.id,
      fileName: null,
    });
  }, [rememberLocalProject]);

  // PR #974: on desktop, the host bridge owns the picker and import POST
  // atomically. The renderer never sees the path, token, or daemon DTO;
  // it receives host-owned project identifiers and refreshes project state
  // through the normal daemon API.
  const handleImportFolderResponse = useCallback(async (result: OpenPixoHostProjectImportSuccess) => {
    rememberLocalProject(result.projectId);
    const importedProjectContext = null;
    const project = await getProject(result.projectId);
    if (project != null) {
      setProjects((curr) => [project, ...curr.filter((p) => p.id !== project.id)]);
    } else {
      // Daemon hasn't materialized the full record yet (race between the
      // host's import POST and our /api/projects read). Seed a minimal
      // placeholder so the route stays alive and ProjectView mounts; the
      // pending-local id keeps reconcileFetchedProjects from evicting the
      // stub until a project-list snapshot actually includes it, and the
      // next refresh swaps it for the real Project record. Without the
      // stub, a stale `[]` list response would replace `projects` with `[]`
      // and the route-guard effect would bounce the user back to Home.
      const stub: Project = {
        id: result.projectId,
        name: '',
        skillId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setProjects((curr) => [stub, ...curr.filter((p) => p.id !== stub.id)]);
      const request = beginProjectListRequest(workspaceProjectView);
      const list = await listCurrentWorkspaceProjects({  });
      reconcileFetchedProjects(list, request);
    }
    navigate({
      kind: 'project',
      projectId: result.projectId,
      fileName: null,
    });
  }, [beginProjectListRequest, listCurrentWorkspaceProjects, rememberLocalProject, reconcileFetchedProjects, workspaceProjectView]);

  const openProjectForNavigation = useCallback(async (
    id: string,
    fileName?: string,
    projectTitleHint?: ProjectTitleHint,
  ): Promise<boolean> => {
    const routeFileName = fileName ?? null;
    const openingAuthorizationGeneration = projectAuthorizationGenerationRef.current;
    const openingScopeIsCurrent = () => projectAuthorizationGenerationRef.current === openingAuthorizationGeneration;
    const navigateToOpenedProject = () => {
      navigate({ kind: 'project', projectId: id, fileName: routeFileName });
      return true;
    };
    if (projectsRef.current.some((project) => project.id === id)) return navigateToOpenedProject();
    try {
      const project = await getProject(id);
      if (!openingScopeIsCurrent()) return false;
      if (project) {
        setProjects((curr) => openingScopeIsCurrent()
          ? [
              project,
              ...curr.filter((candidate) => candidate.id !== project.id),
            ]
          : curr);
        return navigateToOpenedProject();
      }
      const request = beginProjectListRequest('all');
      const list = await listCurrentWorkspaceProjects({  });
      if (!openingScopeIsCurrent()) return false;
      reconcileFetchedProjects(list, request);
      const fetchedProject = locallyDeletedProjectIdsRef.current.has(id)
        ? undefined
        : list.find((candidate) => candidate.id === id);
      if (fetchedProject) {
        return navigateToOpenedProject();
      }
    } catch {
      // Fall through to the same visible missing-project state. The daemon can
      // return 404 or transiently fail while reconciling a deleted backing
      // project; either way the user needs feedback instead of a silent bounce.
    }
    if (!openingScopeIsCurrent()) return false;
    setProjectOpenError(t('project.missing'));
    return false;
  }, [
    beginProjectListRequest,
    listCurrentWorkspaceProjects,
    reconcileFetchedProjects,
    t,
  ]);

  const handleOpenProject = useCallback(async (
    id: string,
    fileName?: string,
    projectTitleHint?: ProjectTitleHint,
  ): Promise<boolean> => {
    const source = routeRef.current;
    // Clicking an already-open project/file is not another project entry.
    if (source.kind === 'project' && source.projectId === id) {
      observeNavigation(() => navigationTiming.cancel('superseded'));
      return openProjectForNavigation(id, fileName, projectTitleHint);
    }
    const openingAccountGeneration = 0;
    const openingAuthorizationGeneration = projectAuthorizationGenerationRef.current;
    const navigationId = observeNavigation(() => navigationTiming.begin(source, { projectId: id }));
    try {
      const opened = await openProjectForNavigation(id, fileName, projectTitleHint);
      if (!opened) {
        if (0 !== openingAccountGeneration
          || projectAuthorizationGenerationRef.current !== openingAuthorizationGeneration) {
          if (navigationId) observeNavigation(() => navigationTiming.finish(navigationId, 'cancelled', 'scope_changed'));
        } else {
          if (navigationId) observeNavigation(() => navigationTiming.finish(navigationId, 'failed', 'open_unavailable'));
        }
      }
      return opened;
    } catch (error) {
      if (navigationId) observeNavigation(() => navigationTiming.finish(navigationId, 'failed', 'open_unavailable'));
      throw error;
    }
  }, [openProjectForNavigation]);

  const handleDeleteProject = useCallback(async (id: string) => {
    // Carry the active workspace identity so the daemon's cross-workspace
    // ownership check actually runs — see deleteProject's docblock
    // (recvq5ecTkar91: a leaked-in project was really deletable, not just
    // visible, because this call sent no workspace headers at all).
    const mutationContext = null;
    const mutationAccountGeneration = 0;
    await deleteProjectApi(id);

    clearLocalProject(id, { deleted: true });
    removeWorkspaceProjectTabs(id);
    iframeKeepAlivePool.evictProject(id, { includeActive: true });
    setProjects((curr) => curr.filter((p) => p.id !== id));
    if (route.kind === 'project' && route.projectId === id) {
      navigate({ kind: 'home', view: 'home' });
    }
    return true;
  }, [clearLocalProject, iframeKeepAlivePool, route]);

  const handleRenameProject = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const previous = projectsRef.current.find((project) => project.id === id) ?? null;
    const renameContext = null;
    const renameAccountGeneration = 0;
    const renameScopeKey = projectListScopeKey();
    const renameProjectionKey = JSON.stringify([
      renameAccountGeneration,
      renameScopeKey,
      id,
    ]);
    let renameState = projectRenameStatesRef.current.get(renameProjectionKey);
    if (!renameState || renameState.pending === 0) {
      if (!previous) return;
      renameState = {
        generation: 0,
        confirmed: previous,
        pending: 0,
        tail: Promise.resolve(),
      };
      projectRenameStatesRef.current.set(renameProjectionKey, renameState);
    }
    const renameGeneration = ++renameState.generation;
    renameState.pending += 1;
    projectListMutationVersionRef.current += 1;
    const renameMutationVersion = projectListMutationVersionRef.current;
    const optimistic = { ...(previous ?? renameState.confirmed), name: trimmed };
    pendingProjectNameProjectionsRef.current.set(renameProjectionKey, {
      accountGeneration: renameAccountGeneration,
      scopeKey: renameScopeKey,
      project: optimistic,
      mutationVersion: renameMutationVersion,
      confirmed: false,
    });
    setProjects((curr) =>
      curr.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
    );

    const runRename = async () => {
      const persisted = await patchProject(id, { name: trimmed });
      if (persisted) renameState.confirmed = persisted;
      const isLatestQueuedRename =
        projectRenameStatesRef.current.get(renameProjectionKey) === renameState
        && renameState.generation === renameGeneration;
      if (!isLatestQueuedRename) return;
      const nextProject = persisted ?? renameState.confirmed;
      const pendingProjection = pendingProjectNameProjectionsRef.current.get(renameProjectionKey);
      if (pendingProjection?.mutationVersion === renameMutationVersion) {
        pendingProjection.project = nextProject;
        pendingProjection.confirmed = true;
      }

      const isCurrentScope =
        0 === renameAccountGeneration
        && projectListScopeKey() === renameScopeKey;
      if (!isCurrentScope) return;
      if (!persisted) {
        setProjects((current) => current.map((project) =>
          project.id === id && project.name === trimmed
            ? {
                ...project,
                name: nextProject.name,
                metadata: nextProject.metadata,
                updatedAt: nextProject.updatedAt,
              }
            : project
        ));
        await refreshProjects();
        return;
      }
      setProjects((current) => current.map((project) =>
        project.id === id
          ? {
              ...project,
              name: persisted.name,
              metadata: persisted.metadata,
              updatedAt: persisted.updatedAt,
            }
          : project
      ));
      await refreshProjects();
    };
    const queued = renameState.tail.then(runRename, runRename);
    renameState.tail = queued.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      renameState.pending -= 1;
      if (
        renameState.pending === 0
        && projectRenameStatesRef.current.get(renameProjectionKey) === renameState
      ) {
        projectRenameStatesRef.current.delete(renameProjectionKey);
      }
    });
    await queued;
  }, [refreshProjects]);

  // The project header back button is an escape hatch back to Home. Avoid
  // depending on browser history here: tab restores and template-create flows
  // can leave an in-app history entry that points back to the same project.
  const handleBack = useCallback(() => {
    const currentProjectId = route.kind === 'project' ? route.projectId : null;
    navigate({ kind: 'home', view: 'home' }, {
      onCommit: () => {
        if (!currentProjectId) return;
        iframeKeepAlivePool.evictProject(currentProjectId, { includeActive: true });
      },
    });
  }, [iframeKeepAlivePool, route]);

  const handleClearPendingPrompt = useCallback(() => {
    const projectId = route.kind === 'project' ? route.projectId : null;
    if (!projectId) return;
    setProjects((curr) =>
      curr.map((p) =>
        p.id === projectId ? { ...p, pendingPrompt: undefined } : p,
      ),
    );
    const mutationContext = null;

    void patchProject(projectId, { pendingPrompt: null });
  }, [route]);

  const handleTouchProject = useCallback(() => {
    const projectId = route.kind === 'project' ? route.projectId : null;
    if (!projectId) return;
    const updatedAt = Date.now();
    setProjects((curr) =>
      curr.map((p) => (p.id === projectId ? { ...p, updatedAt } : p)),
    );
    const mutationContext = null;

    void patchProject(projectId, { updatedAt });
  }, [route]);

  const handleProjectChange = useCallback((updated: Project) => {
    // ProjectView is pinned to the opened project's persisted Workspace, which
    // can differ from the shell's ambient selection while a switch settles.
    // Patch every list projection for that exact principal so an inline rename
    // cannot restore an old title when the user next opens Personal or Team.
    const projectContext = null;
    const accountGeneration = 0;
    // A cold deep link can mount from this route-owned snapshot before the
    // ambient project list resolves. Keep that independent row current too,
    // but only under the exact account + Workspace principal that opened it.
    const routeSnapshot = routeProjectSnapshotRef.current;
    const routeSnapshotMatches = routeRef.current.kind === 'project'
      && routeRef.current.projectId === updated.id
      && routeSnapshot?.project.id === updated.id;
    if (routeSnapshotMatches) {
      routeProjectSnapshotRef.current = {
        ...routeSnapshot,
        project: updated,
      };
      setRouteProjectSnapshotRevision((current) => current + 1);
    }
    setProjects((curr) => {
      const previous = curr.find((p) => p.id === updated.id);
      if (
        previous
        && (
          previous.skillId !== updated.skillId
          || previous.customInstructions !== updated.customInstructions
        )
      ) {
        iframeKeepAlivePool.evictProject(updated.id, { includeActive: true });
      }
      return curr.map((p) => (p.id === updated.id ? updated : p));
    });

  }, [iframeKeepAlivePool]);

  const handleProjectRenameStarted = useCallback((
    optimistic: Project,
  ): ProjectRenameFenceToken => {
    const context = null;
    const accountGeneration = 0;
    const scopeKey = projectListScopeKey();
    projectListMutationVersionRef.current += 1;
    const mutationVersion = projectListMutationVersionRef.current;
    const key = JSON.stringify([accountGeneration, scopeKey, optimistic.id]);
    pendingProjectNameProjectionsRef.current.set(
      key,
      {
        accountGeneration,
        scopeKey,
        project: optimistic,
        mutationVersion,
        confirmed: false,
      },
    );
    return {
      accountGeneration,
      scopeKey,
      projectId: optimistic.id,
      mutationVersion,
    };
  }, []);

  const handleProjectRenameSettled = useCallback((
    token: ProjectRenameFenceToken | null,
    confirmed: Project,
  ) => {
    if (!token || token.projectId !== confirmed.id) return;
    const key = JSON.stringify([token.accountGeneration, token.scopeKey, token.projectId]);
    const pending = pendingProjectNameProjectionsRef.current.get(key);
    if (!pending || pending.mutationVersion !== token.mutationVersion) return;
    pending.project = confirmed;
    pending.confirmed = true;
  }, []);

  // ProjectView's prompt-context signature derives from SkillSummary /
  // DesignSystemSummary fields, so a body-only registry edit (same name,
  // description, etc.) leaves every signature unchanged and the active
  // preview keeps serving stale prompt context. Settings → Skills /
  // Settings → Design Systems call back through these handlers after
  // every successful mutation; we drop any pool entry whose project
  // depends on the affected id — active or parked — so the next mount
  // recomposes the system prompt with the new body.

  const handleSkillsChanged = useCallback(
    (affectedSkillId?: string) => {
      void refreshSkills();
      iframeKeepAlivePool.evictMatching(
        (entry) => {
          const proj = projectsRef.current.find((p) => p.id === entry.projectId);
          if (!proj) return false;
          if (affectedSkillId) return proj.skillId === affectedSkillId;
          return proj.skillId != null;
        },
        { includeActive: true },
      );
    },
    [iframeKeepAlivePool, refreshSkills],
  );

  // Keep a cold deep-link row until a newer successful project list proves it was deleted.
  const routeProjectSnapshotRef = useRef<{
    project: Project;
    capturedAfterListGeneration: number;
    resolvedDir?: string | null;
  } | null>(null);
  const [, setRouteProjectSnapshotRevision] = useState(0);
  let loadedActiveProject: Project | null = null;
  if (route.kind === 'project') {
    const listedProject = projects.find(project => project.id === route.projectId);
    const previous = routeProjectSnapshotRef.current;
    if (listedProject) {
      routeProjectSnapshotRef.current = {
        project: listedProject,
        capturedAfterListGeneration: latestAppliedProjectListGenerationRef.current,
        ...(previous?.project.id === listedProject.id ? { resolvedDir: previous.resolvedDir } : {}),
      };
    } else if (previous?.project.id !== route.projectId || (
      appliedProjectListWitness && appliedProjectListWitness.generation > (previous?.capturedAfterListGeneration ?? 0)
      && !appliedProjectListWitness.projectIds.has(route.projectId)
    )) {
      routeProjectSnapshotRef.current = null;
    }
    loadedActiveProject = listedProject ?? routeProjectSnapshotRef.current?.project ?? null;
  } else {
    routeProjectSnapshotRef.current = null;
  }
  // Never mount ProjectView around the synthetic "Untitled" placeholder. Its
  // effects immediately fan out project-owned reads, but before the project
  // list lands there is no persisted Workspace id with which to scope them.
  // Waiting for the real row is the authorization gate that turns the cold
  // start from two headerless 400 waves plus a scoped retry into one scoped
  // wave. Unbound local projects still mount as soon as their real row lands.
  const activeProject = loadedActiveProject;


  useEffect(() => {
    if (route.kind !== 'project') return;
    const attempt = navigationTiming.getSnapshot();
    if (!attempt || attempt.projectId !== route.projectId) return;
    // These failures render an App-owned error surface, so ProjectView's
    // business Ready hook will never mount to terminate the attempt.
    if (deepLinkResolutionFailure?.projectId === route.projectId) {
      navigationTiming.finish(attempt.id, 'failed', 'project_unavailable');
    }
  }, [route, undefined, deepLinkResolutionFailure]);
  // The post-generation upgrade gate belongs to the project that owns the
  // conversation, not whichever Workspace the navigation shell currently
  // selects. A bound project stays fail-closed until its exact membership and
  // billing snapshot resolve; borrowing the ambient/account Free plan here is
  // what interrupted paid Team members with the Free upsell.


  // Project tabs belong to the project's persisted Workspace authority, not
  // the shell's ambient selection. On a cold deep link the ambient context can
  // settle (or switch A -> B) after the exact project scope has already loaded;
  // handing that B key to WorkspaceTabsBar makes its legitimate scope-change
  // cleanup navigate to B's saved Home tab, unmounting the healthy A project
  // and emitting a misleading presence/leave. Keep tab reconciliation
  // deferred until the project row + exact membership witness exist, then pin
  // it to that Workspace. Truly unbound local projects retain the ambient
  // account/workspace tab behavior.
  // The switcher names the open project once (OPEND-3128), so it reads the
  // same catalog-title authority ProjectView reconciles the record with; a
  // deep-linked row the ambient list lacks is appended for its tab only.
  const workspaceChromeProjects = useMemo(
    () => projectsForWorkspaceChrome({
      projects,
      activeProject,
      activeProjectId: route.kind === 'project' ? route.projectId : null,
    }),
    [projects, activeProject, route],
  );
  const activeProjectAuthorizationKey =
    route.kind === 'project'
      ? projectViewAuthorizationLifetimeKey(route.projectId)
      : null;

  // A full-page refresh/deep link does not pass through EntryShell's card
  // click, and the local list may already contain a stale shared-project row.
  // Fetch a deep-linked local project that was absent from the initial list.
  const routeProjectListed = route.kind === 'project' && projects.some((p) => p.id === route.projectId);
  useEffect(() => {
    if (route.kind !== 'project' || loadedActiveProject || routeProjectListed) return;
    const projectId = route.projectId;
    const mutationVersion = projectListMutationVersionRef.current;
    let cancelled = false;
    const obsolete = () => cancelled || locallyDeletedProjectIdsRef.current.has(projectId);
    setDeepLinkResolutionFailure(current => current?.projectId === projectId ? null : current);
    void (async () => {
      const bootstrap = await bootstrapProjectRoute(projectId);
      if (obsolete()) return;
      if (bootstrap.kind === 'found') {
        if (mutationVersion !== projectListMutationVersionRef.current) return;
        routeProjectSnapshotRef.current = {
          project: bootstrap.project,
          capturedAfterListGeneration: latestAppliedProjectListGenerationRef.current,
          resolvedDir: bootstrap.resolvedDir,
        };
        setRouteProjectSnapshotRevision(current => current + 1);
        return;
      }
      if (projectsLoading || !daemonLive) return;
      if (bootstrap.kind === 'forbidden') {
        setDeepLinkResolutionFailure({ projectId, failure: 'missing' });
        return;
      }
      const resolution = await resolveDeepLinkedProject(projectId, {
        getProject,
        delay,
        isCancelled: obsolete,
      });
      if (obsolete()) return;
      if (resolution.kind === 'found') {
        if (mutationVersion !== projectListMutationVersionRef.current) return;
        const fetched = resolution.project;
        setProjects(current => current.some(project => project.id === fetched.id)
          ? current : [...current, fetched]);
        return;
      }
      setDeepLinkResolutionFailure({ projectId, failure: resolution.kind === 'not-found' ? 'missing' : 'materialization-failed' });
    })().catch(() => {
      if (!obsolete()) setDeepLinkResolutionFailure({ projectId, failure: 'materialization-failed' });
    });
    return () => { cancelled = true; };
  }, [route, loadedActiveProject, routeProjectListed, projectsLoading, daemonLive, deepLinkRetryRevision]);

  const openSettings = useCallback((
    section: SettingsSection = 'execution',
  ) => {
    if (section === 'mcpClient' || section === 'integrations') {
      settingsReturnTargetRef.current = null;
      setIntegrationInitialTab(
        section === 'mcpClient'
            ? 'mcp'
            : 'use-everywhere',
      );
      navigate({ kind: 'home', view: 'integrations' });
      return;
    }
    const currentRoute = routeRef.current;
    if (currentRoute.kind === 'home' && currentRoute.view === 'onboarding') {
      setSettingsWelcome(false);
      setSettingsInitialSection(section);
      setSettingsOpen(true);
      return;
    }
    settingsReturnTargetRef.current =
      currentRoute.kind === 'project' && identityScopeKey !== null
        ? {
            route: { ...currentRoute },
            accountGeneration: 0,
            identityScopeKey,
          }
        : null;
    setSettingsWelcome(false);
    setSettingsInitialSection(section);
    navigate({ kind: 'home', view: 'settings' });
  }, [identityScopeKey]);

  useEffect(() => {
    const handleOpenMediaSettings = () => openSettings('media');
    const handleOpenSkillsSettings = () => openSettings('skills');
    window.addEventListener(OPEN_MEDIA_SETTINGS_EVENT, handleOpenMediaSettings);
    window.addEventListener(OPEN_SKILLS_SETTINGS_EVENT, handleOpenSkillsSettings);
    return () => {
      window.removeEventListener(OPEN_MEDIA_SETTINGS_EVENT, handleOpenMediaSettings);
      window.removeEventListener(OPEN_SKILLS_SETTINGS_EVENT, handleOpenSkillsSettings);
    };
  }, [openSettings]);



  const openMcpSettings = useCallback(() => {
    setIntegrationInitialTab('mcp');
    navigate({ kind: 'home', view: 'integrations' });
  }, []);

  // The composer "+" menu's "add plugin" / "add connector" rows route to the
  // home plugin-registry / connector-integration surfaces.
  const openPluginRegistry = useCallback(() => {
    navigate({ kind: 'home', view: 'store' });
  }, []);

  const handleCompleteOnboarding = useCallback(() => {
    const current = latestPersistedConfigRef.current;
    if (current.onboardingCompleted) return;
    const next: AppConfig = { ...current, onboardingCompleted: true };
    latestPersistedConfigRef.current = next;
    saveConfig(next);
    void syncConfigToDaemon(next);
    setConfig(next);
  }, []);

  // Cmd+, (mac) / Ctrl+, (win/linux) opens Settings. Capture phase so we
  // beat the browser's default Preferences dialog. Platform-gated so
  // meta/ctrl don't conflict across OS.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const primary = isMacPlatform() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (primary && !e.shiftKey && !e.altKey && e.key === ',') {
        if (e.isComposing) return;
        e.preventDefault();
        openSettings();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [openSettings]);

  // When the user lands on the entry view (route.kind === 'home'), pull
  // a fresh template list. The template store is global — if they just
  // saved a template inside a project, returning home should reflect it
  // immediately in the From-template tab without forcing a page reload.
  // Same rationale for design systems: a brand extraction (or any in-project
  // design-system creation) registers a `user:<id>` system out of band, so the
  // Design systems tab must re-fetch to show it — and the brand-ready prompt
  // relies on the new system being present so it can preselect it.

  // Existing card grids (ProjectsPanel, ProjectView), pickers (NewProjectPanel,
  // ChatComposer mention) all look skills up by id without caring whether
  // the id resolves to a functional skill or a design template. Pass them
  // the union so the post-split refactor stays invisible to those callers.
  const allSkillSummaries = useMemo(
    () => [...skills, ...designTemplates],
    [skills, designTemplates],
  );
  const enabledSkills = useMemo(
    () =>
      allSkillSummaries.filter(
        (s) => !(config.disabledSkills ?? []).includes(s.id),
      ),
    [allSkillSummaries, config.disabledSkills],
  );
  // Functional-skills-only enabled subset — what ProjectView's chat
  // composer @-picker should see. Without this, a skill the user has
  // disabled in Settings still appears in an existing project's @-mention
  // popover and can ride along to the daemon via skillIds, breaking the
  // Library toggle for projects opened on the post-split branch.
  const enabledFunctionalSkills = useMemo(
    () =>
      skills.filter(
        (s) => !(config.disabledSkills ?? []).includes(s.id),
      ),
    [skills, config.disabledSkills],
  );
  // Templates-only enabled subset — what the EntryView Templates gallery
  // actually renders. Filtering in App keeps the EntryView prop surface
  // narrow ("here are the templates the user has not disabled").
  const enabledDesignTemplates = useMemo(
    () =>
      designTemplates.filter(
        (s) => !(config.disabledSkills ?? []).includes(s.id),
      ),
    [designTemplates, config.disabledSkills],
  );

  const handleCloseSettings = () => {
    // Closing Settings is still the canonical "I'm done" gesture now that
    // there is no global Save button. The same close path is shared by the
    // legacy modal and the full-page route. We mark onboardingCompleted on
    // close so the welcome modal stops re-prompting on every refresh,
    // regardless of whether the user changed anything during the session.
    const next = route.kind === 'home' && route.view === 'onboarding'
      ? latestPersistedConfigRef.current
      : resolveSettingsCloseConfig(config, latestPersistedConfigRef.current);
    if (!next.onboardingCompleted || !config.onboardingCompleted) {
      latestPersistedConfigRef.current = next;
      saveConfig(next);
      void syncConfigToDaemon(next);
      setConfig(next);
    }
    setSettingsOpen(false);
    settingsDraftConfigRef.current = null;
    if (route.kind === 'home' && route.view === 'settings') {
      const returnTarget = settingsReturnTargetRef.current;
      settingsReturnTargetRef.current = null;
      const returnIdentityStillMatches = Boolean(
        returnTarget
        && returnTarget.accountGeneration === 0
        && returnTarget.identityScopeKey === identityScopeKey
      );
      navigate(
        returnIdentityStillMatches && returnTarget
          ? returnTarget.route
          : { kind: 'home', view: 'home' },
      );
    }
  };

  const handleResetOnboarding = useCallback((requested: AppConfig) => {
    // An explicit re-run forgets the chosen path so setup cannot finish itself.
    const next = prepareOnboardingRerun(requested);
    latestPersistedConfigRef.current = next;
    saveConfig(next);
    void syncConfigToDaemon(next, { allowOnboardingReset: true });
    setConfig(next);
    setSettingsOpen(false);
    settingsDraftConfigRef.current = null;
    navigate({ kind: 'home', view: 'onboarding' });
  }, []);


  const renderSettingsSurface = (presentation: 'modal' | 'page') => (
    <Suspense fallback={null}>
    <SettingsDialog
      presentation={presentation}
      initial={config}
      agents={agents}
      agentsLoading={agentsLoading}
      daemonLive={daemonLive}
      appVersionInfo={appVersionInfo}
      welcome={presentation === 'modal' ? settingsWelcome : false}
      initialSection={settingsInitialSection}
      onPersist={handleConfigPersist}
      onAgentSelect={(agentId) => {
        const target = settingsReturnTargetRef.current?.route;
        if (target?.kind === 'project') setPendingAgentSelection({
          projectId: target.projectId, conversationId: target.conversationId ?? null, agentId,
        });
      }}
      onSilentUpdatePreferenceChange={handleSilentUpdatePreferenceChange}
      onDraftChange={handleSettingsDraftChange}
      onClose={handleCloseSettings}
      onResetOnboarding={handleResetOnboarding}

      onRefreshAgents={refreshAgents}

      daemonMediaProviders={daemonMediaProviders}
      daemonMediaProvidersFetchState={daemonMediaProvidersFetchState}
      mediaProvidersNotice={mediaProvidersNotice}
      onReloadMediaProviders={reloadMediaProvidersFromDaemon}
      onProjectsRefresh={refreshProjects}
      onSkillsChanged={handleSkillsChanged}
      onSkillsRefresh={refreshSkills}
      providerModelsCache={providerModelsCache}
      onProviderModelsCacheChange={setProviderModelsCache}
      onOpenIntegrations={() => openSettings('mcpClient')}
    />
    </Suspense>
  );

  // Phase 2B / spec §11.6 — marketplace deep UI dispatch. The
  // /marketplace and /marketplace/:id routes render outside the
  // EntryView / ProjectView split so the discovery surface stays
  // independent of any active project.
  // Once the row is persisted the record gets a deadline: ProjectView
  // normally releases it within a few hundred ms, but a first send parked
  // behind a gate dialog or a read that never answers must not pin the card
  // forever. (The record is keyed on the route, so leaving the project hides
  // it without clearing; the deadline retires it either way.)
  const pendingCreationProjectId = pendingProjectCreation?.created
    ? pendingProjectCreation.projectId
    : null;
  useEffect(() => {
    if (!pendingCreationProjectId) return;
    const timer = window.setTimeout(() => {
      setPendingProjectCreation((current) =>
        current?.projectId === pendingCreationProjectId ? null : current,
      );
    }, CREATION_HANDOFF_SETTLE_DEADLINE_MS);
    return () => window.clearTimeout(timer);
  }, [pendingCreationProjectId]);
  let appMain: ReactNode;
  const pendingFirstRunOnboardingRoute =
    route.kind === 'home' &&
    route.view === 'home' &&
    config.onboardingCompleted !== true &&
    !daemonConfigLoaded;
  if (pendingFirstRunOnboardingRoute) {
    appMain = (
      <div className="entry-shell entry-shell--no-header">
        <CenteredLoader label={t('entry.loadingWorkspace')} />
      </div>
    );
  } else if (route.kind === 'marketplace') {
    appMain = <MarketplaceView />;
  } else if (route.kind === 'marketplace-detail') {
    appMain = (
      <PluginDetailView
        pluginId={route.pluginId}

      />
    );
  } else if (route.kind === 'home' && route.view === 'settings') {
    appMain = renderSettingsSurface('page');
  } else if (route.kind === 'project') {
    // Keyed on the route, not on `activeProject`: a newer send's record must
    // not leak into another project's view.
    const pendingCreation =
      pendingProjectCreation?.projectId === route.projectId
        ? pendingProjectCreation
        : null;
    const routeSurfaceState = projectRouteSurfaceState({
      projectsLoading,
      hasActiveProject: activeProject !== null,
      daemonLive,
      resolutionFailure:
        deepLinkResolutionFailure?.projectId === route.projectId
          ? deepLinkResolutionFailure.failure
          : undefined,
    });
    const signedOutObservedShare = null;
    const signedOutShareFallback = null;
    const localObservedShare = null;
    // A Home send's project is ProjectView from the click (OPEND-3334): the
    // view mounts on the optimistic row, holds every project read until the
    // create answers, and stays the same instance through the first turn.
    // While the creation record lives, the route's own loading and failure
    // surfaces do not replace it — the user is looking at the project they
    // just created, and ProjectView's own authority hooks fail closed.
    const creationOwnsSurface = pendingCreation !== null && activeProject !== null;
    if (
      !creationOwnsSurface
      && (
        routeSurfaceState === 'loading-projects'
        || routeSurfaceState === 'resolving-deep-link'
      )
    ) {
      appMain = (
        <div className="entry-shell entry-shell--no-header">
          <CenteredLoader label={t('entry.loadingWorkspace')} />
        </div>
      );
    } else if (!creationOwnsSurface && routeSurfaceState !== 'ready') {
      const canRetry = routeSurfaceState === 'materialization-failed';
      appMain = <div className="entry-shell entry-shell--no-header">
          <div className="centered-loader">
            <span role="alert">
              {routeSurfaceState === 'missing'
                ? t('project.missing')
                : t('common.unavailable')}
            </span>
            <Button
              onClick={
                canRetry
                  ? () => setDeepLinkRetryRevision((current) => current + 1)
                  : handleBack
              }
            >
              {canRetry
                ? t('promptTemplates.retry')
                : t('project.backToProjects')}
            </Button>
          </div>
        </div>;
    } else if (activeProject) {
      appMain = (
        <div className="app">
        <Suspense fallback={null}>
        <ProjectView
          key={projectViewAuthorizationLifetimeKey(activeProject.id)}
          project={activeProject}


          initialProjectDetail={
            routeProjectSnapshotRef.current?.project.id === activeProject.id
            && routeProjectSnapshotRef.current.resolvedDir !== undefined
              ? {
                  project: routeProjectSnapshotRef.current.project,
                  resolvedDir: routeProjectSnapshotRef.current.resolvedDir,
                }
              : undefined
          }

          projectAuthorizationKey={
            activeProjectAuthorizationKey ?? activeProject.id
          }


          routeFileName={route.fileName}
          routeConversationId={route.conversationId ?? null}
          routeWorkspaceTab={route.kind === 'project' ? route.workspaceTab : undefined}
          pendingAgentSelection={pendingAgentSelection}
          onAgentSelectionConsumed={() => setPendingAgentSelection(current => current === pendingAgentSelection ? null : current)}
          config={config}
          agents={agents}
          skills={enabledFunctionalSkills}
          designTemplates={designTemplates}
          daemonLive={daemonLive}
          onModeChange={handleModeChange}
          onAgentChange={handleAgentChange}

          onAgentModelChange={handleAgentModelChange}
          onApiModelChange={handleApiModelChange}
          onRefreshAgents={refreshAgents}
          onOpenSettings={openSettings}

          onOpenMcpSettings={openMcpSettings}
          onBrowsePlugins={openPluginRegistry}
          onBack={handleBack}
          onClearPendingPrompt={handleClearPendingPrompt}
          onTouchProject={handleTouchProject}
          onProjectChange={handleProjectChange}
          onProjectRenameStarted={handleProjectRenameStarted}
          onProjectRenameSettled={handleProjectRenameSettled}
          onProjectsRefresh={refreshProjects}
          onDeleteProject={handleDeleteProject}
          onDuplicateProject={handleDuplicateProject}
          creationHandoff={
            pendingCreation
              ? {
                  prompt: pendingCreation.prompt,
                  files: pendingCreation.files,
                  conversationId: pendingCreation.conversationId,
                  persisted: pendingCreation.created === true,
                }
              : null
          }
          onCreationHandoffSettled={handleCreationHandoffSettled}
        />
        </Suspense>
        </div>
      );
    }
  } else {
    appMain = (
      <EntryView
        onBeginProjectCreation={beginOptimisticProjectCreation}

        skills={enabledSkills}
        projects={projects}
        promptTemplates={promptTemplates}
        agents={agents}
        agentsLoading={agentsLoading}


        config={config}
        providerModelsCache={providerModelsCache}
        onProviderModelsCacheChange={setProviderModelsCache}
        integrationInitialTab={integrationInitialTab}
        daemonLive={daemonLive}
        onModeChange={handleModeChange}
        onAgentChange={handleAgentChange}
        onAgentModelChange={handleAgentModelChange}
        onApiProtocolChange={handleApiProtocolChange}
        onApiModelChange={handleApiModelChange}
        onConfigPersist={handleConfigPersist}
        onResetOnboarding={handleResetOnboarding}
        daemonAppConfigReady={daemonAppConfigReady}
        onSilentUpdatePreferenceChange={handleSilentUpdatePreferenceChange}
        onSkillsRefresh={refreshSkills}
        onSkillsChanged={handleSkillsChanged}
        onRefreshAgents={refreshAgents}
        skillsLoading={
          workspaceSkills.identity !== "local" || skillsLoading
        }
        projectsLoading={projectsLoading}
        projectsLoadFailed={projectListFailure?.displayKey === currentProjectDisplayKey}
        promptTemplatesLoading={promptTemplatesLoading}
        onCreateProject={handleCreateProject}
        onCreatePluginShareProject={handleCreatePluginShareProject}
        onImportFolder={handleImportFolder}
        onImportFolderResponse={handleImportFolderResponse}
        onOpenProject={handleOpenProject}
        onDeleteProject={handleDeleteProject}
        onDuplicateProject={handleDuplicateProject}
        onRenameProject={handleRenameProject}
        onProjectsRefresh={refreshProjectsStrict}
        onOpenSettings={openSettings}
        onCompleteOnboarding={handleCompleteOnboarding}


      />
    );
  }

  return (
    <>
      <div
        className={`workspace-shell workspace-shell--${clientType}`}
        data-client-type={clientType}
        data-host-platform={hostPlatform}
      >
        {/* Window drag strip for the custom Windows title bar (styles/window-titlebar.css).
            First in the page so every control after it stays clickable. */}
        <div className="pixo-titlebar-strip" aria-hidden="true" />
        <WorkspaceTabsBar
          route={route}
          // The ambient list may still be loading (or belong to a different
          // selected Workspace) while a deep-linked project is already open.
          // Supply only that route-owned row to chrome; never insert it into
          // the ambient Home catalogue.
          projects={workspaceChromeProjects}


          onboardingCompleted={config.onboardingCompleted === true}

          onRenameProject={handleRenameProject}
          onDuplicateProject={handleDuplicateProject}
          onDeleteProject={handleDeleteProject}
        />
        {/* With a project open, its sidebar (the Home rail) owns the account
            cluster; while the route's project is still loading or missing
            there is no sidebar, so the updater keeps this stand-in. */}
        {route.kind === 'project' && !activeProject ? (
          <WorkspaceTopRightAccountCluster
            updaterSlot={
              <UpdaterPopup
                allowSilentUpdates={config.allowSilentUpdates}
                silentUpdatePreferenceReady={daemonAppConfigReady}
                onAllowSilentUpdatesChange={handleSilentUpdatePreferenceChange}
              />
            }
          />
        ) : null}
        <div className="workspace-shell__body">
          {route.kind === 'project' && activeProject ? (
            <ProjectSidebar
              conversationsReady={
                (pendingProjectCreation?.projectId !== activeProject.id || pendingProjectCreation?.created === true)
              }
              projects={workspaceChromeProjects}
              activeProjectId={activeProject.id} activeConversationId={route.conversationId ?? null}
              activeFileName={route.fileName}
              onOpenProject={handleOpenProject} onOpenSettings={openSettings}
              onRenameProject={handleRenameProject} onDeleteProject={handleDeleteProject}
              onDuplicateProject={handleDuplicateProject}
              updaterSlot={
                <UpdaterPopup
                  allowSilentUpdates={config.allowSilentUpdates}
                  silentUpdatePreferenceReady={daemonAppConfigReady}
                  onAllowSilentUpdatesChange={handleSilentUpdatePreferenceChange}
                />
              }
            >{appMain}</ProjectSidebar>
          ) : appMain}
        </div>
      </div>
      {/* Every placement these hosts may render is a home placement
          (`opend.home.*`), so the home view is where they belong: not over a
          project workbench, not over another entry tab, and — since account
          restoration can finish while login is still up — not over onboarding. */}
      {route.kind === 'home' && route.view === 'home' && (
        <>


        </>
      )}
      <KeyboardShortcutsHelp />
      <TooltipLayer />
      <UpdateDialog />
      <RequiredUpdateGate />
      {/* Mounted at shell level, outside the route views, so a survey armed by
          an export inside a project stays on screen when the user navigates
          back to home. */}
      <ExperienceSurvey
        metricsConsent={config.telemetry?.metrics === true}

        onExposure={() => trackExperienceSurveyShown(analytics.track)}
        onDismiss={() => trackExperienceSurveyDismissed(analytics.track)}
        onSubmit={(answers) => trackExperienceSurveySent(analytics.track, answers)}
      />

      <AnimatePresence>
      {settingsOpen ? (
        renderSettingsSurface('modal')
      ) : null}
      </AnimatePresence>


      {workingDirError ? (
        <Toast
          message={workingDirError}
          role="alert"
          onDismiss={() => setWorkingDirError(null)}
        />
      ) : null}
      {projectCreateError ? (
        <Toast
          // 「标题\n正文」两行的定稿(S28a / S03,见 `homeCreateFailureNotice`)拆成
          // Toast 的标题 + 正文;单行的照旧只有标题。
          message={projectCreateError.split('\n')[0] ?? projectCreateError}
          details={projectCreateError.includes('\n') ? projectCreateError.slice(projectCreateError.indexOf('\n') + 1) : null}
          role="alert"
          tone="error"
          onDismiss={() => setProjectCreateError(null)}
        />
      ) : null}

      {projectOpenError ? (
        <Toast
          message={projectOpenError}
          role="alert"
          tone="error"
          onDismiss={() => setProjectOpenError(null)}
        />
      ) : null}
      {/* First-run privacy consent banner. It waits for daemon config
          hydration because privacyDecisionAt is daemon-owned and stripped
          from localStorage. It waits for `onboardingCompleted` so first-run
          users see the welcome panel before the disclosure (Skip and
          finish both flip the flag). Independent of Settings: z-index in
          index.css sits above modal backdrops so opening Settings does
          not hide the banner. */}
      <AnimatePresence>
      {showPrivacyConsent ? (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
        >
        <PrivacyConsentModal
          onShare={() => {
            // The banner owns only the privacy decision; it does not drive
            // navigation. Choosing Share keeps the current anonymous identity
            // when one already exists and enables the telemetry surface.
            handlePrivacyConsentChoice(true);
          }}
          onDecline={() => {
            handlePrivacyConsentChoice(false);
          }}
        />
      </motion.div>
      ) : null}
      </AnimatePresence>
    </>
  );
}

function generateInstallationIdSafe(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
