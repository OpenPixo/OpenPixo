import { PRODUCT_NAME } from '@openpixo/contracts';
// Home owns the composer draft, selected context, and installed-plugin handoffs.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApplyResult, ChatSessionMode, InputFieldSpec, McpServerConfig, InstalledPluginRecord, ProjectKind, RunContextSelection, WorkspaceContextItem } from '@openpixo/contracts';
import { useAnalytics } from '../analytics/provider';
import { trackHomeChatComposerClick, trackPageView, trackPluginDetailModalClick, trackPluginDetailModalSharePopoverClick } from '../analytics/events';
import { applyPlugin, duplicatePluginAsProject, listPlugins, listPluginsFresh, pluginCatalogCacheKey, readCachedVisiblePlugins, ProjectCreateError, renderPluginBriefTemplate, resolvePluginQueryFallback } from '../state/projects';
import {
  HOME_COMPOSER_ATTACHMENTS_EVENT,
  clearHomeComposerAttachments,
  peekHomeComposerAttachments,
} from '../state/home-composer-stash';
import { fetchMcpServers } from '../state/mcp';
import { useI18n } from '../i18n';
import {
  formatModelWindowRetryAt,
  modelWindowLimitCopy,
} from '../runtime/failure-guidance';
import {
  localizeSkillName,
  localizeSkillPrompt,
} from '../i18n/content';
import {
  daemonIsLive,
  dirExists,
  fetchRecentLinkedDirs,
  openFolderDialog,
  pushRecentLinkedDir,
} from '../providers/registry';
import { authorizeHostGameParent, isOpenPixoHostAvailable, pickHostWorkingDir } from '@openpixo/host';
import { refreshHomeWorkingDirGrant } from './home-working-dir';
import type {
  Project,
  ProjectMetadata,
  SkillSummary,
} from '../types';
import { inlineMentionToken, mentionTokenPresent } from '../utils/inlineMentions';
import { smoothScrollToTop } from '../utils/smoothScrollToTop';
import {
  missingRequiredInputs,
  pluginInputsAreValid,
  requiredInputsAreUserFillable,
} from '../utils/pluginRequiredInputs';
import { HomeHero, type HomeHeroHandle } from './HomeHero';

import { workspaceContextLinkedDirs } from './workspace-context';


import type { HomePromptHandoff } from './home-hero/plugin-authoring';
import { PluginDetailsModal } from './PluginDetailsModal';
import { SkillDetailsModal } from './SkillDetailsModal';
import { localizeHomePresetTitle, localizePluginTitle } from './plugins-home/localization';
import type { PluginUseAction } from './plugins-home/useActions';
import { examplePresetSeedPrompt } from './plugins-home/presetSeedPrompt';
import { localizePluginDescription } from './plugins-home/localization';
import { AnimatePresence } from 'motion/react';
import type { OpenPixoHostProjectImportSuccess } from '@openpixo/host';
import { HomeDashboard } from './home/HomeDashboard';

export interface HomeComposerSubmit {
  prompt: string;
  pluginId?: string | null;
  pluginSource?: string | null;
  pluginType?: string | null;
  skillId?: string | null;
  appliedPluginSnapshotId: string | null;
  pluginTitle: string | null;
  taskKind: string | null;
  pluginInputs?: Record<string, unknown> | null;
  contextPlugins?: Array<{ id: string; title: string; description?: string }> | null;
  contextMcpServers?: Array<{ id: string; label?: string; transport?: string; url?: string; command?: string }> | null;
  initialRunContext?: RunContextSelection | null;
  projectKind?: ProjectKind | null;
  projectMetadata?: ProjectMetadata | null;
  workingDir?: string | null;
  linkedDirs?: string[] | null;
  workingDirToken?: string | null;
  conversationMode?: ChatSessionMode;
  attachments?: File[];
}


export interface ActivePlugin {
  record: InstalledPluginRecord;
  // `result` is `null` during the optimistic window — set on chip
  // click before applyPlugin's roundtrip finishes — and is filled in
  // once the daemon returns the snapshot + resolved context. submit()
  // and contextItemCount both null-coalesce, so an in-flight active
  // is safe to render without a result.
  result: ApplyResult | null;
  inputs: Record<string, unknown>;
  inputFields: InputFieldSpec[];
  inputsValid: boolean;
  queryTemplate: string | null;
  // True when `queryTemplate` covers only a suffix of the prompt (the plugin
  // query appended after a user-owned draft), so input extraction must allow
  // an arbitrary mutable prefix instead of anchoring at the start. Set by the
  // use-with-query route.
  queryTemplateAllowsPrefix?: boolean;
  lastRenderedPrompt: string | null;
  projectKind: ProjectKind | null;
  projectMetadata: ProjectMetadata | null;
  editableInputNames: string[];
  preserveInputFields: boolean;
  suppressPromptSync: boolean;
}

// `inlineBacked` distinguishes a context inserted as an inline `@mention` pill
// (added through the mention picker / plus menu, which writes a token into the
// prompt) from a context-only selection made through the plain `Use` action
// (which stages the context without touching the prompt). Inline-backed
// contexts are dropped once their `@` token is deleted; context-only ones stay
// selected until explicitly removed. Conflating the two drops plain `Use`
// selections from the submit payload because they never carry a token.
interface SelectedPluginContext {
  record: InstalledPluginRecord;
  inlineBacked: boolean;
}

interface SelectedMcpContext {
  server: McpServerConfig;
  inlineBacked: boolean;
}

interface PendingPluginUseHandoff {
  pluginId: string;
  action: PluginUseAction;
  inputs?: Record<string, unknown>;
}


interface Props {
  isActive?: boolean;
  projects: Project[];
  projectsLoading?: boolean;
  // `'blocked'` means the shell refused the submit but already surfaced its
  // own UI: keep the draft, show no error.
  onSubmit: (
    payload: HomeComposerSubmit,
  ) => Promise<boolean | 'blocked' | void> | boolean | 'blocked' | void;
  onOpenProject: (id: string, fileName?: string) => void;
  onBrowseRegistry?: () => void;
  onOpenMcp?: () => void;
  onOpenDoctor?: () => void;
  /** Settings → Game engines, offered by the new-game dialog when an engine is missing. */
  onOpenEngineSettings?: () => void;
  promptHandoff?: HomePromptHandoff | null;
  skills?: SkillSummary[];
  skillsLoading?: boolean;
  executionSwitcher?: ReactNode;
  artifactUpgradeSlot?: ReactNode;
  /** Shown above the composer, e.g. when no AI can build a game yet. */
  setupNotice?: ReactNode;
  /** The agent that will answer, named in the hero; null reads "your agent". */
  onImportFolder?: (baseDir: string) => Promise<void> | void;
  onImportFolderResponse?: (response: OpenPixoHostProjectImportSuccess) => Promise<void> | void;
  onViewAllProjects?: () => void;
}
const EMPTY_SKILLS: SkillSummary[] = [];

// Project navigation unmounts Home, so keep its draft in localStorage.
const HOME_COMPOSER_PROMPT_KEY = 'pixo:home-composer:prompt';
const HOME_COMPOSER_PLUGIN_KEY = 'pixo:home-composer:plugin';

interface HomeComposerPluginDraft {
  pluginId: string;
  projectKind: ProjectKind | null;
}
const HOME_COMPOSER_SEED_EVENT = 'pixo:home-composer:seed';

function readHomeComposerDraft(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeHomeComposerDraft(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode / quota exceeded) — degrade silently to
    // in-memory-only state; the composer still works for this session.
  }
}


function readHomeComposerPluginDraft(): HomeComposerPluginDraft | null {
  const raw = readHomeComposerDraft(HOME_COMPOSER_PLUGIN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HomeComposerPluginDraft> | null;
    if (!parsed || typeof parsed.pluginId !== 'string' || !parsed.pluginId) return null;
    return {
      pluginId: parsed.pluginId,
      projectKind: typeof parsed.projectKind === 'string' ? (parsed.projectKind as ProjectKind) : null,
    };
  } catch {
    return null;
  }
}
function writeHomeComposerPluginDraft(draft: HomeComposerPluginDraft | null): void {
  writeHomeComposerDraft(HOME_COMPOSER_PLUGIN_KEY, draft ? JSON.stringify(draft) : null);
}

// Drop the persisted draft once a run is actually created, so the just-sent
// prompt and pick don't resurrect the next time the Home tab mounts.
export function clearHomeComposerDraft(): void {
  writeHomeComposerDraft(HOME_COMPOSER_PROMPT_KEY, null);
  writeHomeComposerPluginDraft(null);
}

/** Seed the Home composer from another surface. */
export function seedHomeComposerPrompt(prompt: string): void {
  writeHomeComposerDraft(HOME_COMPOSER_PROMPT_KEY, prompt);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(HOME_COMPOSER_SEED_EVENT, { detail: { prompt } }));
  }
}

export function HomeView({
  isActive = true,
  projects,
  projectsLoading,
  onSubmit,
  onOpenProject,
  onBrowseRegistry,
  onOpenMcp,
  onOpenDoctor,
  onOpenEngineSettings,
  promptHandoff,
  skills = EMPTY_SKILLS,
  skillsLoading = false,
  executionSwitcher,
  artifactUpgradeSlot,
  setupNotice,
  onImportFolder,
  onImportFolderResponse,
  onViewAllProjects,
}: Props) {
  const { locale, t } = useI18n();
  const analytics = useAnalytics();
  const workspaceContextState = { context: null, loading: false, identityChangePending: false, failure: undefined, pendingAccountGeneration: 0, requestToken: 0, resourceReadIdentity: null };


  const pluginAccountGeneration = 0;
  const pluginCatalogOptions = {

    accountGeneration: pluginAccountGeneration,
  };
  // Read installed plugins from the local catalogue cache.
  const desiredPluginCatalogKey = workspaceContextState.identityChangePending
    ? null
    : pluginCatalogCacheKey(pluginCatalogOptions);
  // P0 page_view page_name=home — fire once on mount. ref-keyed to survive
  // re-renders that flip parent state without remounting HomeView.
  const homePageViewFiredRef = useRef(false);
  useEffect(() => {
    if (homePageViewFiredRef.current) return;
    homePageViewFiredRef.current = true;
    trackPageView(analytics.track, { page_name: 'home' });
  }, [analytics.track]);
  // A project route fully unmounts HomeView. Restore the last successful
  // catalog synchronously when Home mounts again so known creation actions do
  // not become disabled merely because the 10-second refresh TTL elapsed while
  // the user was in a project. The effect below still revalidates an expired
  // catalog; only a true cold start (no successful catalog yet) stays guarded.
  const initialPluginsRef = useRef<InstalledPluginRecord[] | null>(
    desiredPluginCatalogKey ? readCachedVisiblePlugins(pluginCatalogOptions) : null,
  );
  const [pluginCatalogKey, setPluginCatalogKey] = useState<string | null>(
    desiredPluginCatalogKey,
  );
  const [plugins, setPlugins] = useState<InstalledPluginRecord[]>(
    () => initialPluginsRef.current ?? [],
  );
  const [pluginsLoading, setPluginsLoading] = useState(
    () => initialPluginsRef.current === null,
  );
  // Home stays mounted while entry-shell views and Workspaces change. Never
  // commit one render with the previous identity's plugin catalogue: switch to
  // the exact new cache partition synchronously, or mask the old rows while a
  // deliberate identity change is unresolved.
  if (pluginCatalogKey !== desiredPluginCatalogKey) {
    const cached = desiredPluginCatalogKey
      ? readCachedVisiblePlugins(pluginCatalogOptions)
      : null;
    setPluginCatalogKey(desiredPluginCatalogKey);
    setPlugins(cached ?? []);
    setPluginsLoading(cached === null);
  }
  const [pendingApplyId, setPendingApplyId] = useState<string | null>(null);
  const [pendingPluginUseHandoff, setPendingPluginUseHandoff] =
    useState<PendingPluginUseHandoff | null>(null);
  const [pendingPluginRestore, setPendingPluginRestore] = useState<HomeComposerPluginDraft | null>(readHomeComposerPluginDraft);
  const [active, setActive] = useState<ActivePlugin | null>(null);
  const reconciledPluginCatalogKeyRef = useRef<string | null>(null);

  // Home creates use the default execution mode.
  const sessionMode: ChatSessionMode = 'design';
  const [activeSkill, setActiveSkill] = useState<SkillSummary | null>(null);
  const [selectedPluginContexts, setSelectedPluginContexts] = useState<SelectedPluginContext[]>([]);
  const [selectedMcpContexts, setSelectedMcpContexts] = useState<SelectedMcpContext[]>([]);
  const [contextWorkspaceItems, setContextWorkspaceItems] = useState<WorkspaceContextItem[]>([]);
  // A failed optimistic create hands the staged attachments back through the
  // stash (App owns the rollback); a plain mount starts empty. `peek` is
  // side-effect free on purpose: StrictMode invokes this initializer twice and
  // keeps only one result, so consuming here would hand the files to the
  // discarded call. The effect below clears the slot once they are in state.
  const [stagedFiles, setStagedFiles] = useState<File[]>(() =>
    peekHomeComposerAttachments(),
  );
  useEffect(() => {
    clearHomeComposerAttachments();
  }, []);
  const [workingDir, setWorkingDir] = useState<string | null>(null);
  // Token paired with `workingDir` when picked through the desktop host's
  // native dialog. Spent on the post-creation working-dir POST so the
  // daemon's desktop-auth gate accepts the path. Null for web picks.
  const [workingDirToken, setWorkingDirToken] = useState<string | null>(null);
  // Restore the prompt once per mount.
  const restoredDraftRef = useRef<{
    prompt: string;
  } | null>(null);
  if (restoredDraftRef.current === null) {
    restoredDraftRef.current = { prompt: readHomeComposerDraft(HOME_COMPOSER_PROMPT_KEY) ?? '' };
  }
  const restoredDraft = restoredDraftRef.current;
  // Global most-recently-used working directories, surfaced in the picker's
  // "Recent folders" submenu. Loaded from the daemon's app-config and bumped
  // whenever the user picks a folder.
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetchRecentLinkedDirs().then((dirs) => {
      if (!cancelled) setRecentDirs(dirs);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const rememberRecentDir = useCallback(async (dir: string) => {
    // Optimistically promote the dir to the front so the submenu updates
    // immediately; the daemon also trims/de-dupes/caps the persisted list.
    setRecentDirs((prev) => [dir, ...prev.filter((d) => d !== dir)].slice(0, 5));
    const persisted = await pushRecentLinkedDir(dir);
    setRecentDirs(persisted);
  }, []);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [prompt, setPrompt] = useState(() => restoredDraft.prompt);
  // Persist the composer draft on every change so it survives the unmount that
  // a tab switch triggers (see the module note above). Empty values clear the
  // key rather than storing "".
  useEffect(() => {
    writeHomeComposerDraft(HOME_COMPOSER_PROMPT_KEY, prompt);
  }, [prompt]);
  useEffect(() => {
    writeHomeComposerPluginDraft(active
      ? { pluginId: active.record.id, projectKind: active.projectKind }
      : null);
  }, [active]);
  // Live counterpart to the draft-key restore above (see the
  // `HOME_COMPOSER_SEED_EVENT` module note) — picks up a `seedHomeComposerPrompt`
  // call that fires while this HomeView instance is already mounted, which is
  // the common case now that EntryShell keeps Home mounted across view
  // switches instead of tearing it down.
  useEffect(() => {
    function onSeed(event: Event) {
      const detail = (event as CustomEvent<{ prompt: string }>)
        .detail;
      if (typeof detail?.prompt !== 'string') return;
      setPrompt(detail.prompt);
    }
    window.addEventListener(HOME_COMPOSER_SEED_EVENT, onSeed);
    return () => window.removeEventListener(HOME_COMPOSER_SEED_EVENT, onSeed);
  }, []);
  // The attachment hand-off's second consumer: a failed optimistic create that
  // lands while this page composer is already mounted (the user pressed Back on
  // the pending frame mid-create) cannot rely on the mount initializer above,
  // so take the stash on the event instead.
  useEffect(() => {
    function onAttachmentsHandedBack() {
      const files = peekHomeComposerAttachments();
      if (files.length === 0) return;
      clearHomeComposerAttachments();
      setStagedFiles((current) => [...current, ...files]);
    }
    window.addEventListener(HOME_COMPOSER_ATTACHMENTS_EVENT, onAttachmentsHandedBack);
    return () => window.removeEventListener(HOME_COMPOSER_ATTACHMENTS_EVENT, onAttachmentsHandedBack);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [daemonRecoveryActive, setDaemonRecoveryActive] = useState(false);
  useEffect(() => {
    if (!daemonRecoveryActive) return;
    let cancelled = false;
    let timeout: number | null = null;
    const probe = async () => {
      const alive = await daemonIsLive();
      if (cancelled) return;
      if (alive) {
        setDaemonRecoveryActive(false);
        setError((current) => current === t('home.daemonRecovering') ? null : current);
        return;
      }
      timeout = window.setTimeout(() => void probe(), 1_500);
    };
    void probe();
    return () => {
      cancelled = true;
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [daemonRecoveryActive, t]);
  // Composer in-flight guard: disables the send button, shows Sending…, and
  // swallows repeat clicks across the whole async create tail.
  const [sending, setSending] = useState(false);
  const [detailsRecord, setDetailsRecord] = useState<InstalledPluginRecord | null>(null);
  const [detailsSkill, setDetailsSkill] = useState<SkillSummary | null>(null);
  const inputRef = useRef<HomeHeroHandle | null>(null);
  const homeViewRef = useRef<HTMLDivElement | null>(null);
  const consumedHandoffIdRef = useRef<number | null>(null);
  const activePluginApplyRequestRef = useRef(0);
  const pluginCatalogRequestGenerationRef = useRef(0);
  const pluginCatalogReloadRef = useRef<(
    force?: boolean,
    supersede?: boolean,
  ) => Promise<void>>(
    async () => {},
  );
  const pluginCatalogReloadInFlightRef = useRef<{
    key: string;
    promise: Promise<void>;
  } | null>(null);
  const pluginCatalogStaleRef = useRef(false);
  const homeActiveRef = useRef(isActive);
  homeActiveRef.current = isActive;
  const desiredPluginCatalogKeyRef = useRef(desiredPluginCatalogKey);
  desiredPluginCatalogKeyRef.current = desiredPluginCatalogKey;
  const scrollHomeToTop = useCallback(() => {
    requestAnimationFrame(() => {
      const scrollContainer = homeViewRef.current?.closest('.entry-main--scroll');
      if (!(scrollContainer instanceof HTMLElement)) return;
      smoothScrollToTop(scrollContainer);
    });
  }, []);
  useEffect(() => {
    if (!desiredPluginCatalogKey) return;
    let cancelled = false;
    let ownedPromise: Promise<void> | null = null;
    const issuedCatalogKey = desiredPluginCatalogKey;
    // On mount use the cache-aware loader (skips the network when warm); an
    // explicit plugins-changed event forces a fresh fetch.
    const load = (force = false, supersede = false): Promise<void> => {
      const current = pluginCatalogReloadInFlightRef.current;
      if (!supersede && current?.key === issuedCatalogKey) return current.promise;
      const requestGeneration = ++pluginCatalogRequestGenerationRef.current;
      const promise = (force
        ? listPlugins(pluginCatalogOptions)
        : listPluginsFresh(pluginCatalogOptions)).then((rows) => {
        if (
          cancelled
          || requestGeneration !== pluginCatalogRequestGenerationRef.current
          || desiredPluginCatalogKeyRef.current !== issuedCatalogKey
        ) return;
        setPluginCatalogKey(issuedCatalogKey);
        setPlugins(rows);
        setPluginsLoading(false);
      }).finally(() => {
        if (pluginCatalogReloadInFlightRef.current?.promise === promise) {
          pluginCatalogReloadInFlightRef.current = null;
        }
      });
      pluginCatalogReloadInFlightRef.current = { key: issuedCatalogKey, promise };
      ownedPromise = promise;
      return promise;
    };
    pluginCatalogReloadRef.current = load;
    if (homeActiveRef.current) load();
    else pluginCatalogStaleRef.current = true;
    const onChanged = () => {
      // A mutation event is newer than any pending snapshot and must supersede
      // it; only lifecycle catch-up joins the initial read.
      if (homeActiveRef.current) load(true, true);
      else pluginCatalogStaleRef.current = true;
    };
    window.addEventListener('pixo:plugins-changed', onChanged);
    return () => {
      cancelled = true;
      // A Workspace-directory refresh can briefly mask the catalog identity
      // (K -> null -> K). Do not let the remounted K effect join this effect's
      // cancelled promise: its response is intentionally prevented from
      // committing, so reusing it would leave the new surface in the cold
      // `pluginsLoading` state forever even though `/api/plugins` succeeded.
      // A newer request has a different promise and must remain registered.
      const inFlight = pluginCatalogReloadInFlightRef.current;
      if (ownedPromise && inFlight?.promise === ownedPromise) {
        pluginCatalogReloadInFlightRef.current = null;
      }
      if (pluginCatalogReloadRef.current === load) {
        pluginCatalogReloadRef.current = async () => {};
      }
      window.removeEventListener('pixo:plugins-changed', onChanged);
    };
  }, [desiredPluginCatalogKey, undefined]);

  useEffect(() => {
    if (!isActive || !desiredPluginCatalogKey || !pluginCatalogStaleRef.current) return;

    pluginCatalogStaleRef.current = false;
    pluginCatalogReloadRef.current(true);
  }, [desiredPluginCatalogKey, isActive, undefined]);


  useEffect(() => {
    let cancelled = false;
    void fetchMcpServers().then((result) => {
      if (cancelled) return;
      setMcpServers(result?.servers ?? []);
      setMcpLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!promptHandoff || consumedHandoffIdRef.current === promptHandoff.id) return;
    consumedHandoffIdRef.current = promptHandoff.id;
    setError(null);
      setPendingPluginUseHandoff({
        pluginId: promptHandoff.pluginId,
        action: promptHandoff.action ?? 'use',
        ...(promptHandoff.inputs ? { inputs: promptHandoff.inputs } : {}),
      });
      if (promptHandoff.focus) {
        focusPromptAtEnd();
      }
      scrollHomeToTop();
  }, [promptHandoff, scrollHomeToTop]);

  const activeContextItemCount = useMemo(
    () =>
      active
        ? active.result?.contextItems?.length ??
          estimatePluginContextItemCount(active.record)
        : 0,
    [active],
  );
  // Inline-backed contexts are already represented in the composer as `@mention`
  // pills, so they must NOT also drive the active context row — otherwise
  // selecting only an inline-mentioned connector mounts an empty row (count
  // label, no visible children) above the editor. Context-only `Use` selections
  // have no inline representation, so they are the only ones the row should
  // surface (and count).
  const contextItemCount = useMemo(() => {
    const contextOnlyPlugins = selectedPluginContexts.filter(
      (item) => !item.inlineBacked,
    ).length;
    const contextOnlyMcp = selectedMcpContexts.filter(
      (item) => !item.inlineBacked,
    ).length;
    return (
      activeContextItemCount +
      contextOnlyPlugins +
      contextOnlyMcp +contextWorkspaceItems.length +
      stagedFiles.length
    );
  }, [
    activeContextItemCount,
    contextWorkspaceItems.length,
    selectedMcpContexts,
    selectedPluginContexts,
    stagedFiles.length,
  ]);

  const activeBadgeTitle = active ? localizeHomePresetTitle(locale, active.record) : null;

  const selectableSkills = useMemo(
    () => skills.filter((skill) => !skill.aggregatesExamples),
    [skills],
  );

  const enabledMcpServers = useMemo(
    () => mcpServers.filter((server) => server.enabled),
    [mcpServers],
  );
  useEffect(() => {
    if (pluginsLoading) return;
    const pluginById = new Map(plugins.map((record) => [record.id, record]));

    // Catalogue reads are already partitioned by Workspace. Reconcile staged
    // choices here when that partition settles: same ids bind to the CURRENT
    // catalogue record; missing ids lose only their selection. Keep the prompt,
    // attachments and the rest of the draft intact. Do not move this policy to
    // project creation or turn it into remote authorization — local catalogue
    // refresh/SSE is the product boundary for plugin availability.
    if (reconciledPluginCatalogKeyRef.current !== pluginCatalogKey) {
      // An apply started against the prior Workspace must not commit after the
      // catalogue partition changes. Ordinary same-Workspace SSE refreshes do
      // not cancel an in-flight local apply.
      activePluginApplyRequestRef.current += 1;
      reconciledPluginCatalogKeyRef.current = pluginCatalogKey;
    }
    setActive((current) => {
      if (!current) return current;
      const nextRecord = pluginById.get(current.record.id);
      if (!nextRecord) return null;
      if (nextRecord === current.record) return current;
      return {
        ...current,
        record: nextRecord,
        // An apply snapshot belongs to the old catalogue record. Preserve the
        // user's inputs, but force submit to resolve against the rebound record.
        result: null,
      };
    });
    setSelectedPluginContexts((current) => {
      let changed = false;
      const next = current.flatMap((selection) => {
        const nextRecord = pluginById.get(selection.record.id);
        if (!nextRecord) {
          changed = true;
          return [];
        }
        if (nextRecord === selection.record) return [selection];
        changed = true;
        return [{ ...selection, record: nextRecord }];
      });
      return changed ? next : current;
    });
    setDetailsRecord((current) => {
      if (!current) return current;
      return pluginById.get(current.id) ?? null;
    });
  }, [pluginCatalogKey, plugins, pluginsLoading]);

  useEffect(() => {
    if (skillsLoading) return;
    setActiveSkill((current) => {
      if (!current) return current;
      const rebound = selectableSkills.find((skill) => skill.id === current.id) ?? null;
      return rebound;
    });
    setDetailsSkill((current) => {
      if (!current) return current;
      return selectableSkills.find((skill) => skill.id === current.id) ?? null;
    });
  }, [selectableSkills, skillsLoading]);

  function focusPromptAtEnd() {
    requestAnimationFrame(() => {
      inputRef.current?.focusEnd();
    });
  }

  async function usePlugin(
    record: InstalledPluginRecord,
    nextPrompt?: string | null,
    options?: {
      projectKind?: ProjectKind;
      inputs?: Record<string, unknown>;
      inputFields?: InputFieldSpec[];
      queryTemplate?: string | null;
      projectMetadata?: ProjectMetadata | null;
      editableInputNames?: string[];
      preserveInputFields?: boolean;
      // Context-only use keeps the user draft unchanged.
      suppressPromptUpdate?: boolean;
      // When true, `queryTemplate` only covers the trailing plugin-query
      // segment (use-with-query appends it after a mutable user draft), so
      // input extraction must allow an arbitrary prefix instead of anchoring
      // the whole prompt.
      queryTemplateAllowsPrefix?: boolean;
      deferApply?: boolean;
      focusPrompt?: boolean;

    },
    // Resolves true when the bound plugin left the composer submittable
    // (inputs valid, apply not failed/superseded) — callers use this to
    // decide whether the Send cue should fire.
  ): Promise<boolean> {
    const applyRequestId = activePluginApplyRequestRef.current + 1;
    activePluginApplyRequestRef.current = applyRequestId;
    const shouldResolveImmediately = options?.deferApply !== true;
    const inputFields = options?.inputFields ?? record.manifest?.pixo?.inputs ?? [];
    const optimisticInputs = hydratePluginInputs(
      inputFields,
      withHomePluginContextDefaults(options?.inputs, inputFields, undefined),
    );
    const inputsValid = pluginInputsAreValid(inputFields, optimisticInputs);
    const queryTemplate =
      options?.queryTemplate !== undefined
        ? options.queryTemplate
        : nextPrompt !== undefined && nextPrompt !== null
        ? null
        : resolvePluginQueryFallback(record.manifest?.pixo?.useCase?.query, locale);
    const suppressPromptUpdate = options?.suppressPromptUpdate === true;
    const optimisticPrompt =
      nextPrompt !== undefined && nextPrompt !== null
        ? nextPrompt
        : queryTemplate
          ? renderPluginBriefTemplate(queryTemplate, optimisticInputs)
          : null;
    setError(null);
    // The manifest carries the inputs and query template, so
    // we can render the brief locally without waiting for the apply
    // roundtrip. The active badge + prompt appear on the same frame as
    // the click; applyPlugin then resolves the snapshot id and context
    // items in the background and we reconcile in place. Without this
    // the user sees a ~100-500ms freeze before the input back-fills,
    // which feels like the UI is jammed.
    setActive({
      record,
      result: null,
      inputs: optimisticInputs,
      inputFields,
      inputsValid,
      queryTemplate,
      queryTemplateAllowsPrefix: options?.queryTemplateAllowsPrefix === true,
      // When prompt updates are suppressed we leave lastRenderedPrompt
      // null so the inline pattern-extraction in handlePromptChange
      // doesn't claim ownership of the user's typed text.
      lastRenderedPrompt: suppressPromptUpdate ? null : optimisticPrompt,
      projectKind: options?.projectKind ?? null,
      projectMetadata: homeCreateProjectMetadata(
        options?.projectKind ?? null,
        optimisticInputs,
        options?.projectMetadata ?? null,
      ),
      editableInputNames: options?.editableInputNames ?? [],
      preserveInputFields: options?.preserveInputFields === true,
      suppressPromptSync: suppressPromptUpdate,
    });
    setDetailsRecord(null);
    if (!suppressPromptUpdate && optimisticPrompt !== null) {
      setPrompt(optimisticPrompt);
    }
    if (options?.focusPrompt !== false) focusPromptAtEnd();

    if (!inputsValid) {
      // Required inputs without defaults: the inputs form is the next step,
      // not Send.
      return false;
    }
    if (!shouldResolveImmediately) return true;

    const result = await resolveActivePlugin(record, optimisticInputs, applyRequestId);
    if (activePluginApplyRequestRef.current !== applyRequestId) return false;
    if (!result) {
      // Roll back the optimistic active so submit can't fire against a
      // plugin that never bound. Only clear when the in-flight apply
      // still matches the visible active state — concurrent clicks
      // would otherwise stomp a successful later apply.
      setActive((prev) => (prev?.record.id === record.id ? { ...prev, inputsValid: false } : prev));
      setError(t('home.error.applyFailed', { name: record.title }));
      return false;
    }
    const reconciledInputs: Record<string, unknown> = { ...optimisticInputs };
    for (const field of result.inputs ?? []) {
      if (field.default !== undefined && reconciledInputs[field.name] === undefined) {
        reconciledInputs[field.name] = field.default;
      }
    }
    const reconciledInputsValid = pluginInputsAreValid(
      options?.preserveInputFields ? inputFields : result.inputs ?? inputFields,
      reconciledInputs,
    );
    setActive((prev) => {
      if (!prev || prev.record.id !== record.id) return prev;
      // Mirror the prompt-reconcile guard below for the extracted inputs: the
      // user may have edited the prompt during the apply roundtrip, and
      // handlePromptChange has already extracted those edits into
      // prev.inputs. Rebuilding from the bind-time optimistic snapshot would
      // silently revert them, so merge the apply result's defaults into
      // prev.inputs instead.
      const mergedInputs: Record<string, unknown> = { ...prev.inputs };
      for (const field of result.inputs ?? []) {
        if (field.default !== undefined && mergedInputs[field.name] === undefined) {
          mergedInputs[field.name] = field.default;
        }
      }
      const mergedFields = options?.preserveInputFields ? inputFields : result.inputs ?? inputFields;
      return {
        ...prev,
        result,
        inputs: mergedInputs,
        inputFields: mergedFields,
        inputsValid: pluginInputsAreValid(mergedFields, mergedInputs),
        projectMetadata: homeCreateProjectMetadata(
          prev.projectKind,
          mergedInputs,
          prev.projectMetadata,
        ),
      };
    });
    // The daemon may have filled in `topic`/`audience` defaults the
    // optimistic render didn't know about (the manifest is inspected
    // client-side but field.default lives on the apply result). Re-
    // render the brief using the reconciled inputs, but only if the
    // user hasn't edited the prompt in the meantime — if they have,
    // current !== optimisticPrompt and the functional setter is a
    // no-op so their edits survive.
    if (!suppressPromptUpdate && (nextPrompt === undefined || nextPrompt === null)) {
      const reconciledQuery =
        options?.queryTemplate !== undefined
          ? options.queryTemplate
          : result.query || resolvePluginQueryFallback(record.manifest?.pixo?.useCase?.query, locale);
      if (reconciledQuery) {
        const reconciledPrompt = renderPluginBriefTemplate(reconciledQuery, reconciledInputs);
        if (reconciledPrompt !== optimisticPrompt) {
          setPrompt((current) => {
            if (current !== optimisticPrompt) return current;
            return reconciledPrompt;
          });
          setActive((prev) =>
            prev && prev.record.id === record.id
              ? { ...prev, lastRenderedPrompt: reconciledPrompt }
              : prev,
          );
        }
      }
    }
    return reconciledInputsValid;
  }

  async function resolveActivePlugin(
    record: InstalledPluginRecord,
    inputs: Record<string, unknown>,
    applyRequestId?: number,
  ): Promise<ApplyResult | null> {
    setPendingApplyId(record.id);
    function clearPendingApply() {
      if (
        applyRequestId === undefined
        || activePluginApplyRequestRef.current === applyRequestId
      ) {
        setPendingApplyId(null);
      }
    }
    const result = await applyPlugin(record.id, {
      locale,
      inputs,
      pluginSource: record.source,

    });
    clearPendingApply();
    return result;
  }

  // Store and details handoffs route the selected plugin into the next run.
  // A query handoff appends its brief; plain Use preserves the current draft.
  async function routePluginUse(
    record: InstalledPluginRecord,
    action: PluginUseAction = 'use',
    inputs?: Record<string, unknown>,
  ) {
    if (action === 'use-with-query') {
      // Prefer a human-readable seed over generator-facing instructions.
      const seed = examplePresetSeedPrompt(
        record,
        locale,
        () => localizePluginDescription(locale, record).trim() || record.title,
      );
      const trimmedSeed = seed.text.trim();
      const currentDraft = prompt.trim();
      // Append, don't replace: keep the user's draft and add the seed below it.
      const combined = !trimmedSeed
        ? prompt
        : !currentDraft
          ? trimmedSeed
          : `${prompt.trimEnd()}\n\n${trimmedSeed}`;
      // Preserve placeholder write-back ONLY when the seed IS the rendered
      // plugin query (a human-friendly, non-meta-instruction query): keep the
      // raw `{{...}}`-bearing template so editing a hydrated value in the
      // composer still flows back into `active.inputs` and submit resolves the
      // snapshot from what the user sees. When we fell back to a description /
      // meta-instruction seed there are no placeholders to extract, so null the
      // template.
      const rawQueryTemplate = seed.fromRenderedQuery
        ? resolvePluginQueryFallback(record.manifest?.pixo?.useCase?.query, locale)
        : null;
      const hasTemplate = Boolean(rawQueryTemplate && trimmedSeed);
      const submittable = await usePlugin(record, combined, {
        ...(inputs ? { inputs } : {}),
        queryTemplate: hasTemplate ? rawQueryTemplate : null,
        // Allow an arbitrary prefix whenever we track the query template, so the
        // placeholder extractor matches the query as a suffix even when the user
        // PREPENDS an intro AFTER the seed was inserted (the empty-draft → add
        // prefix → edit placeholder case). Suffix matching is equally correct
        // when there is no prefix at all.
        queryTemplateAllowsPrefix: hasTemplate,
      });
      scrollHomeToTop();
      // Plugins with required inputs and no defaults land on the inputs
      // form, not Send — only cue Send when submit is actually unlocked.
      if (submittable) {
        inputRef.current?.pulseSend();
      }
      return;
    }
    const submittable = await usePlugin(record, undefined, {
      ...(inputs ? { inputs } : {}),
      suppressPromptUpdate: true,
    });
    scrollHomeToTop();
    // Plain Use doesn't seed the composer; with no draft and no staged
    // files (or with required inputs still missing) the send button stays
    // disabled, and flashing a disabled button points at a dead end.
    if (submittable && (prompt.trim().length > 0 || stagedFiles.length > 0)) {
      inputRef.current?.pulseSend();
    }
  }

  useEffect(() => {
    if (!pendingPluginUseHandoff || pluginsLoading) return;
    const record = plugins.find((plugin) => plugin.id === pendingPluginUseHandoff.pluginId);
    setPendingPluginUseHandoff(null);
    if (!record) {
      setError(t('home.error.pluginNotInstalled', { name: pendingPluginUseHandoff.pluginId }));
      return;
    }
    void routePluginUse(
      record,
      pendingPluginUseHandoff.action,
      pendingPluginUseHandoff.inputs,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPluginUseHandoff, pluginsLoading, plugins]);

  useEffect(() => {
    if (!pendingPluginRestore || pluginsLoading) return;
    const restore = pendingPluginRestore;
    setPendingPluginRestore(null);
    if (active || pendingPluginUseHandoff) return;
    const record = plugins.find((plugin) => plugin.id === restore.pluginId);
    if (!record) {
      writeHomeComposerPluginDraft(null);
      return;
    }
    void usePlugin(record, undefined, {
      projectKind: restore.projectKind ?? undefined,
      suppressPromptUpdate: true,
      deferApply: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPluginRestore, pluginsLoading, plugins, active, pendingPluginUseHandoff]);

  function addPluginContext(record: InstalledPluginRecord, nextPrompt: string | null) {
    setSelectedPluginContexts((prev) => {
      if (prev.some((item) => item.record.id === record.id)) return prev;
      return [...prev, { record, inlineBacked: true }];
    });
    if (nextPrompt !== null) setPrompt(nextPrompt);
    setError(null);
    focusPromptAtEnd();
  }

  async function duplicateExamplePlugin(record: InstalledPluginRecord) {
    setError(null);
    // Details can duplicate an installed plugin into a project.
    trackHomeChatComposerClick(analytics.track, {
      page_name: 'home',
      area: 'chat_composer',
      element: 'example_open_project',
      plugin_id: record.sourceMarketplaceEntryName ?? record.id,
      plugin_type: record.marketplaceTrust ?? 'official',
    });
    try {
      const result = await duplicatePluginAsProject(record.id, {
        name: localizePluginTitle(locale, record),
      });
      onOpenProject(result.projectId, result.relPath);
    } catch {
      setError(t('pluginCard.duplicateFailed'));
    }
  }

  function removePluginContext(pluginId: string) {
    const record = selectedPluginContexts.find((item) => item.record.id === pluginId)?.record ?? null;
    setSelectedPluginContexts((prev) => prev.filter((item) => item.record.id !== pluginId));
    if (record) {
      setPrompt((current) => removePluginMentionFromPrompt(current, record));
    }
  }

  function handlePromptChange(nextPrompt: string) {
    setPrompt(nextPrompt);
    if (!active?.queryTemplate) return;
    const extracted = extractPluginInputsFromPrompt(
      active.queryTemplate,
      nextPrompt,
      active.inputFields,
      { allowPrefix: active.queryTemplateAllowsPrefix === true },
    );
    if (!extracted) return;
    const nextInputs = { ...active.inputs, ...extracted };
    const normalizedInputs = nextInputs;
    const inputsValid = pluginInputsAreValid(active.inputFields, normalizedInputs);
    const inputsChanged = !inputsEqual(active.inputs, normalizedInputs);
    setActive({
      ...active,
      inputs: normalizedInputs,
      inputsValid,
      projectMetadata: homeCreateProjectMetadata(active.projectKind, normalizedInputs, active.projectMetadata),
      result:
        inputsChanged && !inputsEqual(active.result?.appliedPlugin?.inputs, normalizedInputs)
          ? null
          : active.result,
      lastRenderedPrompt: nextPrompt,
    });
  }

  function stageFiles(files: File[]) {
    if (files.length === 0) return;
    setStagedFiles((current) => [...current, ...files]);
    setError(null);
    focusPromptAtEnd();
  }

  function removeStagedFile(index: number) {
    setStagedFiles((current) => current.filter((_, i) => i !== index));
  }

  function addWorkspaceContext(item: WorkspaceContextItem) {
    setContextWorkspaceItems((current) =>
      current.some((candidate) => candidate.id === item.id)
        ? current
        : [...current, item],
    );
    setError(null);
  }

  function removeWorkspaceContext(id: string) {
    setContextWorkspaceItems((current) => current.filter((item) => item.id !== id));
  }

  async function handlePickWorkingDir() {
    // On desktop the working-dir POST is gated behind a host-minted token, so
    // pick through the host bridge to capture { baseDir, token } together.
    if (isOpenPixoHostAvailable()) {
      const result = await pickHostWorkingDir();
      if (result.ok) {
        setWorkingDir(result.baseDir);
        setWorkingDirToken(result.token);
        void rememberRecentDir(result.baseDir);
        return result.baseDir;
      }
      // The user explicitly cancelled the host picker — respect that and do
      // not pop a second dialog.
      if ('canceled' in result && result.canceled) return null;
      // The host is present but could not service the pick (mixed-version
      // upgrade where the preload lacks `project.pickWorkingDir`, or a host
      // error). We must NOT fall back to openFolderDialog() here: the browser
      // dialog yields a raw path with no host-minted token, so the later
      // POST /api/projects/:id/working-dir would be rejected by the desktop
      // auth gate and surface as a confusing late create-time failure.
      // Surface the host error instead and keep the existing working dir.
      console.warn('[HomeView] folder picker failed:', 'reason' in result ? result.reason : 'host unavailable');
      setError(t('home.error.folderPicker'));
      return null;
    }
    // Pure web path: no desktop host, so there is no token gate — the raw
    // browser folder path is the expected, working input.
    const picked = await openFolderDialog();
    if (picked) {
      setWorkingDir(picked);
      setWorkingDirToken(null);
      void rememberRecentDir(picked);
      return picked;
    }
    return null;
  }

  async function handlePickLocalCodeDir() {
    if (isOpenPixoHostAvailable()) {
      const result = await pickHostWorkingDir();
      if (result.ok) {
        void rememberRecentDir(result.baseDir);
        return result.baseDir;
      }
      if ('canceled' in result && result.canceled) return null;
      console.warn('[HomeView] folder picker failed:', 'reason' in result ? result.reason : 'host unavailable');
      setError(t('home.error.folderPicker'));
      return null;
    }
    const picked = await openFolderDialog();
    if (picked) {
      void rememberRecentDir(picked);
      return picked;
    }
    return null;
  }

  function updateActiveInputs(next: Record<string, unknown>) {
    if (!active) return;
    const normalized = next;
    const inputFields = active.inputFields;
    const queryTemplate = active.queryTemplate;
    const projectMetadata = homeCreateProjectMetadata(active.projectKind, normalized, active.projectMetadata);
    const inputsValid = pluginInputsAreValid(inputFields, normalized);
    const nextRendered =
      queryTemplate !== null
        ? renderPluginBriefTemplate(queryTemplate, normalized)
        : active.lastRenderedPrompt;
    if (
      !active.suppressPromptSync &&
      queryTemplate !== null &&
      nextRendered !== null &&
      (prompt === active.lastRenderedPrompt || prompt.trim().length === 0)
    ) {
      setPrompt(nextRendered);
    }
    setActive({
      ...active,
      inputs: normalized,
      inputFields,
      queryTemplate,
      projectMetadata,
      inputsValid,
      result: inputsEqual(active.result?.appliedPlugin?.inputs, normalized) ? active.result : null,
      lastRenderedPrompt: active.suppressPromptSync ? active.lastRenderedPrompt : nextRendered,
    });
  }

  function clearActivePlugin() {
    activePluginApplyRequestRef.current += 1;
    setActive(null);
    setPendingApplyId(null);
    setPrompt('');
  }

  // Selected skills are carried into the next run.
  function useSkill(skill: SkillSummary, nextPrompt: string | null) {
    setActiveSkill(skill);
    setError(null);
    const replacement = nextPrompt ?? localizeSkillPrompt(locale, skill) ?? '';
    if (replacement.trim().length > 0) {
      setPrompt(replacement);
    }
    focusPromptAtEnd();
  }

  function useMcpServer(_server: McpServerConfig, nextPrompt: string) {
    setSelectedMcpContexts((current) => (
      current.some((item) => item.server.id === _server.id)
        ? current
        : [...current, { server: _server, inlineBacked: true }]
    ));
    setPrompt(nextPrompt);
    setError(null);
    focusPromptAtEnd();
  }

  function removeMcpContext(serverId: string) {
    const server = selectedMcpContexts.find((item) => item.server.id === serverId)?.server ?? null;
    setSelectedMcpContexts((current) => current.filter((item) => item.server.id !== serverId));
    if (server) {
      setPrompt((current) => removeContextMentionsFromPrompt(current, [
        server.label || server.id,
        server.id,
      ]));
    }
  }

  async function submit() {
    // The send button disables itself while sending, but the Enter-to-send
    // path lands here directly — swallow re-entry during the in-flight window.
    if (sending) return;
    const trimmed = prompt.trim();
    if (!trimmed && stagedFiles.length === 0) return;
    // P0 ui_click area=chat_composer element=send_button. Fires before the
    // async plugin-apply roundtrip so the click count reflects user intent
    // even when the run is rejected (missing inputs, apply failure). The
    // subsequent run_created/run_finished events carry the result detail.
    trackHomeChatComposerClick(analytics.track, {
      page_name: 'home',
      area: 'chat_composer',
      element: 'send_button',
    });
    let submittedActive = active;
    // Pre-empt the run only when the user could actually fix it here. On the
    // seeded-brief 「使用」 path there is no field to fill, so we let the send
    // through and report whatever the daemon decides (below).
    if (
      submittedActive &&
      !submittedActive.inputsValid &&
      requiredInputsAreUserFillable({ ...submittedActive, mediaSurface: null })
    ) {
      setError(
        missingRequiredInputsMessage(
          missingRequiredInputs(submittedActive.inputFields, submittedActive.inputs),
          t,
        ),
      );
      return;
    }
    setError(null);
    // Sending covers the whole async tail — a pending plugin apply (when one
    // must resolve first) and the project-creation roundtrip are both windows
    // a second click could otherwise re-enter.
    setSending(true);
    try {
      const defaultInputs = { prompt: trimmed };
      const submittedPluginInputs = submittedActive ? submittedActive.inputs : defaultInputs;
      const activeInputsChangedForSubmit = submittedActive
        ? !inputsEqual(submittedActive.result?.appliedPlugin?.inputs ?? submittedActive.inputs, submittedPluginInputs)
        : false;
      if (
        submittedActive
        && (!submittedActive.result || activeInputsChangedForSubmit)
      ) {
        const result = await resolveActivePlugin(submittedActive.record, submittedPluginInputs);
        if (!result) {
          // The daemon is the authority on required inputs, and it rejects a
          // missing one with MissingInputError. Name the fields it would have
          // named instead of the generic apply failure, so the seeded-brief path
          // (which no longer pre-empts the send) fails legibly.
          const missing = missingRequiredInputs(submittedActive.inputFields, submittedPluginInputs);
          setError(
            missing.length > 0
              ? missingRequiredInputsMessage(missing, t)
              : t('home.error.applyInvalid', { name: submittedActive.record.title }),
          );
          return;
        }
        submittedActive = { ...submittedActive, result, inputs: submittedPluginInputs };
        setActive(submittedActive);
      }
      // Reconcile each selected context against the serialized prompt text before
      // forwarding it. Inline-backed contexts (inserted as `@mention` pills) are
      // only sent while their token survives in the prompt — the Lexical composer
      // lets users delete a mention pill (backspace, edit), and when they do that
      // plugin/MCP/connector should stop being sent. Context-only `Use`
      // selections never carry a token, so they stay in the payload until the
      // user explicitly clears them.
      const contextPlugins = selectedPluginContexts
        .filter((item) => !item.inlineBacked || mentionTokenPresent(trimmed, item.record.title))
        .map((item) => ({
          id: item.record.id,
          title: item.record.title,
          ...(item.record.manifest?.description
            ? { description: item.record.manifest.description }
            : {}),
        }));
      const contextMcpServers = selectedMcpContexts
        .filter((item) => !item.inlineBacked || mentionTokenPresent(trimmed, item.server.label || item.server.id))
        .map((item) => ({
          id: item.server.id,
          ...(item.server.label ? { label: item.server.label } : {}),
          ...(item.server.transport ? { transport: item.server.transport } : {}),
          ...(item.server.url ? { url: item.server.url } : {}),
          ...(item.server.command ? { command: item.server.command } : {}),
        }));
      // Referenced project / local-code folders are required user-selected
      // inputs. If one disappears before submit, fail loudly instead of sending
      // workspace text the daemon cannot back with `--add-dir` access.
      const contextLinkedDirCandidates = workspaceContextLinkedDirs(contextWorkspaceItems);
      const missingContextLinkedDirs =
        contextLinkedDirCandidates.length === 0
          ? []
          : (
              await Promise.all(
                contextLinkedDirCandidates.map(async (dir) => ((await dirExists(dir)) ? null : dir)),
              )
            ).filter((dir): dir is string => Boolean(dir));
      if (missingContextLinkedDirs.length > 0) {
        setError(t('home.error.referenceFolderMissing'));
        return;
      }
      const contextLinkedDirs = contextLinkedDirCandidates;
      const submittedProjectKind =
        submittedActive?.projectKind ?? projectKindForSkill(activeSkill) ?? 'other';
      const submittedProjectMetadata = homeCreateProjectMetadata(
        submittedProjectKind,
        submittedActive?.inputs ?? null,
        submittedActive?.projectMetadata ?? null,
      );
      // A mentioned Skill travels with whatever the composer selected, rather
      // than replacing it: the pick decides the route, the Skill is material
      // inside it. Free-form prompts without a selection stay plain chat.
      const resolvedSkillId = activeSkill?.id ?? null;
      const routedPluginId = submittedActive?.record.id;
      // The desktop token for this folder may have expired while the user typed.
      const workingDirGrant = workingDir
        ? await refreshHomeWorkingDirGrant(workingDir, workingDirToken, {
            hostAvailable: isOpenPixoHostAvailable(),
            authorize: authorizeHostGameParent,
            pick: pickHostWorkingDir,
          })
        : null;
      if (workingDir && !workingDirGrant) {
        setError(t('home.error.folderPicker'));
        return;
      }
      const accepted = await onSubmit({
        prompt: trimmed,
        ...(routedPluginId ? { pluginId: routedPluginId } : {}),
        ...(submittedActive?.record.source
          ? { pluginSource: submittedActive.record.source }
          : {}),
        pluginType: submittedActive?.record.marketplaceTrust ?? (routedPluginId ? 'official' : null),
        skillId: resolvedSkillId,
        appliedPluginSnapshotId: submittedActive?.result?.appliedPlugin?.snapshotId ?? null,
        pluginTitle: submittedActive?.record.title ?? null,
        taskKind: submittedActive?.result?.appliedPlugin?.taskKind ?? null,
        pluginInputs: submittedPluginInputs,
        projectKind: submittedProjectKind,
        projectMetadata: submittedProjectMetadata,
        contextPlugins,
        contextMcpServers,
        ...(contextWorkspaceItems.length > 0
          ? { initialRunContext: { workspaceItems: contextWorkspaceItems } }
          : {}),
        attachments: stagedFiles,
        ...(workingDirGrant ? { workingDir: workingDirGrant.workingDir } : {}),
        ...(workingDirGrant?.token ? { workingDirToken: workingDirGrant.token } : {}),
        ...(contextLinkedDirs.length > 0 ? { linkedDirs: contextLinkedDirs } : {}),
        conversationMode: sessionMode,
      });
      if (accepted === false) {
        setError(t('home.createFailed'));
        return;
      }
      // Keep the composer draft and staged contexts after a handled refusal.
      if (accepted === 'blocked') return;
      // The draft has become a real run; drop it synchronously (before the
      // navigation unmounts us) so the sent prompt + pick don't reappear the
      // next time the Home tab mounts.
      clearHomeComposerDraft();
      // Only drop the staged contexts once the run actually started — a
      // rejected creation keeps them so the retry sends the same payload.
      setSelectedPluginContexts([]);
      setSelectedMcpContexts([]);
      setContextWorkspaceItems([]);
    } catch (err) {
      // A submit handler that throws (instead of resolving false) lands on
      // the same recovery path as a rejected creation.
      console.warn('Home composer submit failed', err);
      const isTransportFailure =
        err instanceof TypeError
        || (err instanceof ProjectCreateError && err.status === null);
      if (isTransportFailure) {
        setDaemonRecoveryActive(true);
        setError(t('home.daemonRecovering'));
      } else {
        // A rolling model window is the one upstream failure whose own wording
        // must not reach the user: the gateway writes it in English for API
        // callers, and read literally it sounds like a charged failure rather
        // than a wait. Everything else keeps the verbatim path, where the
        // daemon's message IS the specific thing to say.
        const windowLimit = modelWindowLimitCopy(
          err instanceof Error ? err.message : null,
        );
        if (windowLimit) {
          setError(t(
            windowLimit.messageKey,
            windowLimit.retryAt
              ? { retryAt: formatModelWindowRetryAt(windowLimit.retryAt, locale) }
              : undefined,
          ));
        } else {
          setError(err instanceof Error && err.message.trim()
            ? err.message
            : t('home.createFailed'));
        }
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      data-testid="home-view"
      ref={homeViewRef}
    >
      <HomeDashboard projects={projects} projectsLoading={projectsLoading}
        onOpenProject={onOpenProject}
        onImportFolder={onImportFolder} onImportFolderResponse={onImportFolderResponse}
        onViewAllProjects={onViewAllProjects} onOpenDoctor={onOpenDoctor} onOpenEngineSettings={onOpenEngineSettings}>
      <HomeHero
        ref={inputRef}
        active={isActive}
        artStyleId={active?.projectMetadata?.artStyleId}
        prompt={prompt}
        onPromptChange={handlePromptChange}
        onSubmit={submit}
        submitting={sending}
        activePluginTitle={activeBadgeTitle}
        activePluginRecord={active?.record ?? null}
        activeSkillId={activeSkill?.id ?? null}
        activeSkillTitle={activeSkill ? localizeSkillName(locale, activeSkill) : null}
        activeSkillRecord={activeSkill}
        showActivePluginChip={Boolean(active)}
        onClearActivePlugin={clearActivePlugin}
        onClearActiveSkill={() => {
          setActiveSkill(null);
        }}
        selectedPluginContexts={selectedPluginContexts.map((item) => item.record)}
        selectedMcpContexts={selectedMcpContexts.map((item) => item.server)}
        contextOnlyPlugins={selectedPluginContexts.filter((item) => !item.inlineBacked).map((item) => item.record)}
        contextOnlyMcpServers={selectedMcpContexts.filter((item) => !item.inlineBacked).map((item) => item.server)}
        contextWorkspaceItems={contextWorkspaceItems}
        onRemovePluginContext={removePluginContext}
        onRemoveMcpContext={removeMcpContext}
        onAddWorkspaceContext={addWorkspaceContext}
        onRemoveWorkspaceContext={removeWorkspaceContext}
        onAddPlugin={onBrowseRegistry}
        onAddMcp={onOpenMcp}
        onOpenPluginDetails={setDetailsRecord}
        onOpenSkillDetails={setDetailsSkill}
        pluginInputFields={active?.inputFields ?? []}
        pluginInputValues={active?.inputs ?? {}}
        pluginInputTemplate={active?.queryTemplate ?? null}
        onPluginInputValuesChange={updateActiveInputs}
        inlineEditableInputNames={active?.editableInputNames ?? []}
        footerInputNames={[]}
        stagedFiles={stagedFiles}
        onAddFiles={stageFiles}
        onRemoveFile={removeStagedFile}
        pluginOptions={plugins}
        pluginsLoading={
          pluginsLoading
          || workspaceContextState.loading
          || workspaceContextState.identityChangePending === true
        }
        skillOptions={selectableSkills}
        skillsLoading={skillsLoading}
        mcpOptions={enabledMcpServers}
        mcpLoading={mcpLoading}
        pendingPluginId={pendingApplyId}
        submitDisabled={
          Boolean(pendingPluginRestore) ||
          Boolean(pendingPluginUseHandoff) ||
          Boolean(pendingApplyId) ||
          // Only let missing required inputs disable Send where the user has a
          // surface to fill them; otherwise a seeded 「使用」 brief would sit next
          // to a permanently dead button (see requiredInputsAreUserFillable).
          Boolean(active
            && !active.inputsValid && requiredInputsAreUserFillable({ ...active, mediaSurface: null }))
        }
        onPickPlugin={(record, nextPrompt) => addPluginContext(record, nextPrompt)}
        onPickSkill={useSkill}
        onPickMcp={useMcpServer}
        contextItemCount={contextItemCount}
        error={error}
        workingDir={workingDir}
        recentDirs={recentDirs}
        onPickWorkingDir={handlePickWorkingDir}
        onPickLocalCodeDir={handlePickLocalCodeDir}
        onSelectRecentWorkingDir={(dir) => {
          setWorkingDir(dir);
          // Recents carry no desktop trust token; sending asks the host for one.
          setWorkingDirToken(null);
          void rememberRecentDir(dir);
        }}
        onClearWorkingDir={() => {
          setWorkingDir(null);
          setWorkingDirToken(null);
        }}
        executionSwitcher={executionSwitcher}
        artifactUpgradeSlot={artifactUpgradeSlot}
        setupNotice={setupNotice}
      />
      </HomeDashboard>

      <AnimatePresence>
        {detailsRecord ? (
          <PluginDetailsModal
            record={detailsRecord}

            onClose={() => {
              // Covers the close button, Esc and the backdrop — every
              // variant funnels dismissal through this single onClose.
              trackPluginDetailModalClick(analytics.track, {
                page_name: 'home',
                area: 'plugin_detail_modal',
                element: 'close',
                plugin_id: detailsRecord.sourceMarketplaceEntryName ?? detailsRecord.id,
                plugin_type: detailsRecord.marketplaceTrust ?? 'official',
              });
              setDetailsRecord(null);
            }}
            onUse={(record, action) => {
              trackPluginDetailModalClick(analytics.track, {
                page_name: 'home',
                area: 'plugin_detail_modal',
                element: action === 'use-with-query' ? 'use_plugin_dropdown' : 'use_plugin',
                plugin_id: record.sourceMarketplaceEntryName ?? record.id,
                plugin_type: record.marketplaceTrust ?? 'official',
              });
              void routePluginUse(record, action);
            }}
            onDuplicate={(record) => {
              setDetailsRecord(null);
              void duplicateExamplePlugin(record);
            }}
            isApplying={pendingApplyId === detailsRecord.id}
            onSharePopoverItemClick={(item) =>
              trackPluginDetailModalSharePopoverClick(analytics.track, {
                page_name: 'home',
                area: 'plugin_detail_share_popover',
                element: item,
                plugin_id: detailsRecord.sourceMarketplaceEntryName ?? detailsRecord.id,
                plugin_type: detailsRecord.marketplaceTrust ?? 'official',
              })}
          />
        ) : null}
        {detailsSkill ? (
          <SkillDetailsModal
            skillId={detailsSkill.id}
            summary={detailsSkill}
            onClose={() => setDetailsSkill(null)}
          />
        ) : null}

      </AnimatePresence>
    </div>
  );
}

function projectKindForSkill(skill: SkillSummary | null): ProjectKind | null {
  if (!skill) return null;
  if (skill.mode === 'deck') return 'deck';
  if (skill.mode === 'prototype') return 'prototype';
  if (skill.mode === 'template') return 'template';
  if (skill.mode === 'image' || skill.surface === 'image') return 'image';
  if (skill.mode === 'video' || skill.surface === 'video') return 'video';
  if (skill.mode === 'audio' || skill.surface === 'audio') return 'audio';
  return 'other';
}

function homeCreateProjectMetadata(
  projectKind: ProjectKind | null,
  _inputs: Record<string, unknown> | null,
  existing: ProjectMetadata | null,
): ProjectMetadata | null {
  const kind = projectKind ?? existing?.kind ?? null;
  if (!kind) return existing;

  // Artifact-specific settings (fidelity, speaker notes, slide count, …) are no
  // longer collected in the home composer. We only seed `kind`; the prompt
  // treats other fields as not provided, infers defaults, and asks only when
  // a missing answer materially changes the result.
  const next: ProjectMetadata = {
    ...(existing ?? {}),
    kind,
  };
  return next;
}

// Supply values that are already part of the Home shell's active context for
// plugin fields that otherwise have no input surface. Explicit request values
// and manifest defaults remain authoritative.
function withHomePluginContextDefaults(
  provided: Record<string, unknown> | undefined,
  fields: InputFieldSpec[],
  workspaceName: string | undefined,
): Record<string, unknown> | undefined {
  const workspaceField = fields.find((field) => field.name === 'workspace_name');
  const normalizedWorkspaceName = workspaceName?.trim();
  if (
    !workspaceField
    || workspaceField.default !== undefined
    || !normalizedWorkspaceName
  ) {
    return provided;
  }
  const current = provided?.workspace_name;
  if (current !== undefined && current !== null && String(current).trim().length > 0) {
    return provided;
  }
  return {
    ...(provided ?? {}),
    workspace_name: normalizedWorkspaceName,
  };
}

function estimatePluginContextItemCount(
  record: InstalledPluginRecord,
): number {
  const context = record.manifest?.pixo?.context;
  if (!context) return 0;
  const assetCount = context.assets?.length ?? 0;
  const mcpCount = context.mcp?.length ?? 0;
  const claudePluginCount = context.claudePlugins?.length ?? 0;
  const atomCount = context.atoms?.length ?? 0;
  return assetCount + mcpCount + claudePluginCount + atomCount;
}

// Single wording for "these required plugin fields are still empty", shared by
// the pre-submit gate and the daemon-rejection path so both read identically.
function missingRequiredInputsMessage(missing: string[], t: (key: 'home.error.missingInputs' | 'home.error.missingInputsGeneric', vars?: Record<string, string>) => string): string {
  return missing.length > 0
    ? t('home.error.missingInputs', { fields: missing.join(', ') })
    : t('home.error.missingInputsGeneric');
}

function hydratePluginInputs(
  fields: InputFieldSpec[],
  provided: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(provided ?? {}) };
  for (const field of fields) {
    if (next[field.name] === undefined && field.default !== undefined) {
      next[field.name] = field.default;
    }
  }
  return next;
}

const TEMPLATE_INPUT_PATTERN = /\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g;

function extractPluginInputsFromPrompt(
  template: string,
  prompt: string,
  fields: InputFieldSpec[],
  options?: { allowPrefix?: boolean },
): Record<string, unknown> | null {
  TEMPLATE_INPUT_PATTERN.lastIndex = 0;
  const fieldByName = new Map(fields.map((field) => [field.name, field]));
  const keys: string[] = [];
  // `allowPrefix` matches the template as a suffix of the prompt with any
  // leading text allowed. Used by use-with-query, where the plugin query is
  // appended after a user-owned draft prefix: the prefix is mutable and must
  // not be baked into the anchored template, otherwise editing it would break
  // placeholder extraction and leave pluginInputs stale.
  let pattern = options?.allowPrefix ? '[\\s\\S]*?' : '^';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEMPLATE_INPUT_PATTERN.exec(template)) !== null) {
    const placeholder = match[0];
    const key = match[1];
    if (!key) continue;
    pattern += escapeRegExp(template.slice(lastIndex, match.index));
    pattern += '([\\s\\S]*?)';
    keys.push(key);
    lastIndex = match.index + placeholder.length;
  }
  if (keys.length === 0) return null;
  pattern += escapeRegExp(template.slice(lastIndex));
  const renderedMatch = new RegExp(pattern + '$').exec(prompt);
  if (!renderedMatch) return null;
  const next: Record<string, unknown> = {};
  keys.forEach((key, index) => {
    const field = fieldByName.get(key);
    if (!field) return;
    const raw = renderedMatch[index + 1] ?? '';
    next[key] = coercePromptInputValue(raw, field);
  });
  return next;
}

function coercePromptInputValue(raw: string, field: InputFieldSpec): unknown {
  const rawType = (field as { type?: unknown }).type;
  const type = typeof rawType === 'string' ? rawType : 'string';
  const trimmed = raw.trim();
  if (type === 'number') {
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (type === 'boolean') {
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
  }
  if (type === 'select' && Array.isArray(field.options) && field.options.includes(trimmed)) {
    return trimmed;
  }
  return raw;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removePluginMentionFromPrompt(prompt: string, record: InstalledPluginRecord): string {
  const token = inlineMentionToken(record.title);
  return prompt
    .replace(new RegExp(`(^|\\s)${escapeRegExp(token)}(?=\\s|$)`, 'g'), ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function removeContextMentionsFromPrompt(prompt: string, labels: string[]): string {
  const uniqueLabels = Array.from(new Set(labels.filter(Boolean)));
  return uniqueLabels.reduce((current, label) => {
    const token = inlineMentionToken(label);
    return current.replace(
      new RegExp(`(^|[\\s([{"'])${escapeRegExp(token)}(?=$|\\s|[.,;:!?)}\\]"'])([^\\S\\r\\n])?`, 'g'),
      '$1',
    );
  }, prompt);
}


function inputsEqual(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown>,
): boolean {
  if (!left) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, idx) => key === rightKeys[idx] && left[key] === right[key]);
}
