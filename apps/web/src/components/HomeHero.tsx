// Prompt composer for the entry Home view.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, Tag } from '@openpixo/components';

import type { CSSProperties, DragEvent as ReactDragEvent, ReactNode } from 'react';
import type { ChatSessionMode, InputFieldSpec, InstalledPluginRecord, McpServerConfig, WorkspaceContextItem } from '@openpixo/contracts';
import type { SkillSummary } from '../types';
import { Icon, type IconName } from './Icon';
import {
  FileTypeIcon,
  fileTypePreviewKind,
  previewFallbackIcon,
  resolveFileTypeIcon,
} from './FileTypeIcon';
import { useAnalytics } from '../analytics/provider';
import {
  trackContextLinkResult,

  trackHomeChatComposerClick,
  trackProjectReferenceModalSurfaceView,
} from '../analytics/events';


import {
  inlineMentionToken,
  type InlineMentionEntity,
} from '../utils/inlineMentions';
import { useI18n, useT } from '../i18n';
import { localizePluginDescription, localizePluginTitle } from './plugins-home/localization';
import type { Locale } from '../i18n/types';
import {
  localizeSkillDescription,
  localizeSkillName,
} from '../i18n/content';
import { notifyCompletionFeedbackGesture } from '../utils/notifications';
import { ComposerPlusMenu, PLUS_SUBMENU_RESOURCE_KIND } from './ComposerPlusMenu';
import { ContextChipHoverCard } from './ContextChipHoverCard';
import { workspaceContextDetailLine, workspaceContextKindLabel } from './workspace-context';
import { WorkingDirPicker } from './WorkingDirPicker';
import { PixelAssetImage } from './assets/PixelAssetImage';
import {
  ProjectReferenceModal,
  type ProjectReferenceSelection,
} from './ProjectReferenceModal';
import {
  LexicalComposerInput,
  type LexicalComposerInputHandle,
  type CaretRect,
} from './composer/LexicalComposerInput';
import { CaretFloatingLayer } from './composer/CaretFloatingLayer';
import styles from './HomeHero.module.css';
export interface HomeHeroSubmitHandler {
  (): void;
}

// The homepage prompt input now shares the project composer's Lexical
// editor, so the forwarded handle is a small focus surface rather than a
// raw <textarea>. HomeView drives `focusEnd()` after seeding a prompt
// example / picking a plugin.
export interface HomeHeroHandle {
  focus(): void;
  focusEnd(): void;
  // Flash the send button twice — fired after a plugin Use action or an
  // example-prompt card seeds the composer, to pull the eye to the next step.
  pulseSend(): void;
}

interface Props {

  active?: boolean;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: HomeHeroSubmitHandler;
  // Wiring for the dormant `ComposerModePicker` (see the composer footer
  // below). Nothing in HomeHero reads these while the picker is off screen —
  // the host keeps its own `sessionMode` state, which now stays on the app
  // default. They are kept declared so the HomeView call site (and the restore
  // path) stays intact.
  sessionMode?: ChatSessionMode;
  onSessionModeChange?: (mode: ChatSessionMode) => void;
  activePluginTitle: string | null;
  activePluginRecord?: InstalledPluginRecord | null;
  onClearActivePlugin: () => void;
  activeSkillId?: string | null;
  activeSkillTitle?: string | null;
  activeSkillRecord?: SkillSummary | null;
  onClearActiveSkill?: () => void;
  selectedPluginContexts?: InstalledPluginRecord[];
  selectedMcpContexts?: McpServerConfig[];
  // Context-only selections (staged through the plain `Use` action, no inline
  // @mention pill). These have no in-prompt representation, so the active row
  // renders a removable chip for each — otherwise a kept-in-payload context
  // would be invisible and unremovable (silent context drift).
  contextOnlyPlugins?: InstalledPluginRecord[];
  contextOnlyMcpServers?: McpServerConfig[];
  contextWorkspaceItems?: WorkspaceContextItem[];
  onRemovePluginContext?: (pluginId: string) => void;
  onRemoveMcpContext?: (serverId: string) => void;
  onAddWorkspaceContext?: (item: WorkspaceContextItem) => void;
  onRemoveWorkspaceContext?: (id: string) => void;
  onAddPlugin?: () => void;
  onAddMcp?: () => void;
  onOpenPluginDetails?: (record: InstalledPluginRecord) => void;
  onOpenSkillDetails?: (skill: SkillSummary) => void;
  pluginInputFields?: InputFieldSpec[];
  pluginInputValues?: Record<string, unknown>;
  pluginInputTemplate?: string | null;
  onPluginInputValuesChange?: (values: Record<string, unknown>) => void;
  inlineEditableInputNames?: string[];
  footerInputNames?: string[];
  stagedFiles?: File[];
  onAddFiles?: (files: File[]) => void;
  onRemoveFile?: (index: number) => void;
  pluginOptions: InstalledPluginRecord[];
  pluginsLoading: boolean;
  skillOptions?: SkillSummary[];
  skillsLoading?: boolean;
  mcpOptions?: McpServerConfig[];
  mcpLoading?: boolean;
  pendingPluginId: string | null;
  submitDisabled?: boolean;
  // True while the submitted run is being handed to project creation. This is
  // a logical single-flight guard only: the optimistic route owns progress, so
  // the Home arrow must stay visually stable until that route unmounts it.
  submitting?: boolean;
  onPickPlugin: (record: InstalledPluginRecord, nextPrompt: string | null) => void;
  onPickSkill?: (skill: SkillSummary, nextPrompt: string | null) => void;
  onPickMcp?: (server: McpServerConfig, nextPrompt: string) => void;
  contextItemCount: number;
  error: string | null;
  showActivePluginChip?: boolean;
  workingDir?: string | null;
  recentDirs?: string[];
  onPickWorkingDir?: () => Promise<string | null> | string | null | void;
  onPickLocalCodeDir?: () => Promise<string | null> | string | null | void;
  onSelectRecentWorkingDir?: (dir: string) => void;
  onClearWorkingDir?: () => void;
  executionSwitcher?: ReactNode;
  artifactUpgradeSlot?: ReactNode;
  /** Shown above the composer, e.g. when no AI can build a game yet. */
  setupNotice?: ReactNode;
  /** Optional project art direction shown beside the composer controls. */
  artStyleId?: string | null;
  /** Optional heading for embedded uses; the home dashboard owns its heading. */
  title?: string;
  /** One quiet line under the headline. */
  subtitle?: string | null;
  /** Guided-start content between the headline and the composer card. */
  lead?: ReactNode;
}

type HomeMentionTab = 'all' | 'files' | 'plugins' | 'skills' | 'mcp';

// In the combined "All" overview, every surface is capped to a handful of top
// matches so no single section floods the picker. The dedicated "Design files"
// tab is exempt: staged files are the user's own finite content, so that tab
// lists every match (the results panel scrolls) and its count reflects the true
// total rather than the truncated preview.
const HOME_MENTION_ALL_TAB_PREVIEW = 6;

// The selected plugin leads the prompt's first line and shares it with the text,
// so a long plugin name would eat the line before the prompt starts. Cut it
// to a fixed count of characters (not a width) so every name yields the same
// short lead, and let the chip's `title` carry the full one. Counted in code
// points, so an emoji or a surrogate pair spends one slot, not two.
const LEAD_CHIP_TITLE_MAX_CHARS = 8;
function leadChipTitle(title: string): string {
  const chars = Array.from(title);
  if (chars.length <= LEAD_CHIP_TITLE_MAX_CHARS) return title;
  return `${chars.slice(0, LEAD_CHIP_TITLE_MAX_CHARS).join('').trimEnd()}…`;
}

interface HomeMentionOption {
  id: string;
  icon: IconName;
  title: string;
  description: string;
  meta: string;
  pluginRecord?: InstalledPluginRecord;
  disabled?: boolean;
  onPick: () => void;
}

interface HomeMentionSection {
  id: Exclude<HomeMentionTab, 'all'>;
  label: string;
  options: HomeMentionOption[];
}

const EMPTY_PLUGIN_CONTEXTS: InstalledPluginRecord[] = [];


const EMPTY_INPUT_FIELDS: InputFieldSpec[] = [];
const EMPTY_PLUGIN_INPUT_VALUES: Record<string, unknown> = {};
const EMPTY_INPUT_NAMES: string[] = [];
const EMPTY_STAGED_FILES: File[] = [];
const EMPTY_SKILLS: SkillSummary[] = [];
const EMPTY_MCP_OPTIONS: McpServerConfig[] = [];
const EMPTY_WORKSPACE_ITEMS: WorkspaceContextItem[] = [];

export const HomeHero = forwardRef<HomeHeroHandle, Props>(function HomeHero(
  {

    active = true,
    prompt,
    onPromptChange,
    onSubmit,
    activePluginTitle,
    activePluginRecord = null,
    activeSkillId = null,
    activeSkillTitle = null,
    activeSkillRecord = null,
    onClearActivePlugin,
    onClearActiveSkill = () => undefined,
    selectedPluginContexts = EMPTY_PLUGIN_CONTEXTS,
    contextOnlyPlugins = EMPTY_PLUGIN_CONTEXTS,
    contextOnlyMcpServers = EMPTY_MCP_OPTIONS,
    contextWorkspaceItems = EMPTY_WORKSPACE_ITEMS,
    onRemovePluginContext = () => undefined,
    onRemoveMcpContext = () => undefined,
    onAddWorkspaceContext = () => undefined,
    onRemoveWorkspaceContext = () => undefined,
    onAddPlugin,
    onAddMcp = () => undefined,
    onOpenPluginDetails = () => undefined,
    onOpenSkillDetails = () => undefined,
    pluginInputFields = EMPTY_INPUT_FIELDS,
    pluginInputValues = EMPTY_PLUGIN_INPUT_VALUES,
    onPluginInputValuesChange = () => undefined,
    footerInputNames = EMPTY_INPUT_NAMES,
    stagedFiles = EMPTY_STAGED_FILES,
    onAddFiles = () => undefined,
    onRemoveFile = () => undefined,
    pluginOptions,
    pluginsLoading,
    skillOptions = EMPTY_SKILLS,
    skillsLoading = false,
    mcpOptions = EMPTY_MCP_OPTIONS,
    mcpLoading = false,
    pendingPluginId,
    submitDisabled = false,
    submitting = false,
    onPickPlugin,
    onPickSkill = () => undefined,
    onPickMcp = () => undefined,
    contextItemCount,
    error,
    showActivePluginChip = true,
    workingDir = null,
    recentDirs = [],
    onPickWorkingDir,
    onPickLocalCodeDir,
    onSelectRecentWorkingDir,
    onClearWorkingDir,
    executionSwitcher,
    artifactUpgradeSlot,
    setupNotice,
    artStyleId = null,
    title,
    subtitle = null,
    lead = null,
  },
  ref,
) {
  const { locale, t } = useI18n();
  const sendHintId = useId();
  const analytics = useAnalytics();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionTab, setMentionTab] = useState<HomeMentionTab>('all');
  const [dragActive, setDragActive] = useState(false);
  const [projectReferenceOpen, setProjectReferenceOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const homeHeroRef = useRef<HTMLElement | null>(null);
  // Two-flash attention pulse on the send button; armed via the
  // imperative `pulseSend()` handle, cleared when the animation ends.
  const [sendAttention, setSendAttention] = useState(false);
  const [previewHomeFileKey, setPreviewHomeFileKey] = useState<string | null>(null);
  const [stagedFilePreviewUrls, setStagedFilePreviewUrls] = useState<Map<string, string>>(() => new Map());
  // Lexical-driven @-trigger state (replaces the old end-anchored
  // getContextMention regex) + the caret box the popover anchors to.
  const [mentionTrigger, setMentionTrigger] = useState<{ query: string } | null>(null);
  const [caretRect, setCaretRect] = useState<CaretRect | null>(null);
  const editorRef = useRef<LexicalComposerInputHandle | null>(null);
  const promptEditorRef = useRef<HTMLDivElement | null>(null);
  // A single-line chip row leads the prompt's FIRST line and every wrapped line
  // returns to the chip's own left edge. A float cannot do that — its band is
  // as tall as the chip (~28px), so it would push the second line right as well
  // — so the row is taken out of flow and the first line is indented past it.
  // These publish the measurements that indent needs (see the effect below).
  const chipRowRef = useRef<HTMLDivElement | null>(null);
  const promptFlowRef = useRef<HTMLDivElement | null>(null);
  const mentionPickerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shortcutsMenuRef = useRef<HTMLDivElement>(null);
  const canSubmit =
    (prompt.trim().length > 0 || stagedFiles.length > 0) && !submitDisabled && !submitting;
  const previewHomeFile = useMemo(() => {
    if (!previewHomeFileKey) return null;
    return stagedFiles.find((file, index) => homeFileKey(file, index) === previewHomeFileKey) ?? null;
  }, [previewHomeFileKey, stagedFiles]);
  const previewHomeFileUrl = previewHomeFileKey ? stagedFilePreviewUrls.get(previewHomeFileKey) ?? null : null;
  const placeholder = activePluginTitle || activeSkillTitle
    ? t('homeHero.placeholderActive')
    : t('homeHero.placeholder');
  const mentionActive = Boolean(mentionTrigger);
  const mentionQuery = mentionTrigger?.query ?? '';
  const sendEnabled = canSubmit;
  function handleSend() {
    if (!canSubmit) return;
    notifyCompletionFeedbackGesture();
    onSubmit();
  }
  const fileMatches = useMemo(
    () =>
      mentionActive
        ? stagedFiles
            .map((file, index) => ({ file, index }))
            .filter(({ file }) => fileMatchesQuery(file, mentionQuery))
        : [],
    [mentionActive, mentionQuery, stagedFiles],
  );
  const pluginMatches = useMemo(
    () =>
      mentionActive
        ? pluginOptions.filter((plugin) => pluginMatchesQuery(plugin, mentionQuery, locale))
        : [],
    [locale, mentionActive, mentionQuery, pluginOptions],
  );
  const skillMatches = useMemo(
    () =>
      mentionActive
        ? skillOptions.filter((skill) => skillMatchesQuery(skill, mentionQuery, locale))
        : [],
    [locale, mentionActive, mentionQuery, skillOptions],
  );
  const mcpMatches = useMemo(
    () =>
      mentionActive
        ? mcpOptions.filter((server) => mcpServerMatchesQuery(server, mentionQuery)).slice(0, 6)
        : [],
    [mcpOptions, mentionActive, mentionQuery],
  );
  const pickerOpen = active && mentionActive;
  const tabs: Array<{ id: HomeMentionTab; label: string; count: number }> = [
    // The All overview previews at most HOME_MENTION_ALL_TAB_PREVIEW files, so
    // its badge counts the previewed slice — not the full staged total — to keep
    // the count aligned with what that tab actually renders. The dedicated files
    // tab below lists every match and reports the true total.
    { id: 'all', label: t('common.all'), count: Math.min(fileMatches.length, HOME_MENTION_ALL_TAB_PREVIEW) + pluginMatches.length + skillMatches.length + mcpMatches.length },
    { id: 'files', label: t('chat.mentionTabFiles'), count: fileMatches.length },
    { id: 'plugins', label: t('entry.navPlugins'), count: pluginMatches.length },
    { id: 'skills', label: t('homeHero.skills'), count: skillMatches.length },
    { id: 'mcp', label: 'MCP', count: mcpMatches.length },
  ];
  const showFiles = mentionTab === 'all' || mentionTab === 'files';
  const showPlugins = mentionTab === 'all' || mentionTab === 'plugins';
  const showSkills = mentionTab === 'all' || mentionTab === 'skills';
  const showMcp = mentionTab === 'all' || mentionTab === 'mcp';
  const visibleSections: HomeMentionSection[] = [
    showFiles
      ? {
          id: 'files',
          label: t('chat.mentionSectionFiles'),
          options: (mentionTab === 'files' ? fileMatches : fileMatches.slice(0, HOME_MENTION_ALL_TAB_PREVIEW)).map(({ file, index }) => ({
            id: `file-${index}-${file.name}`,
            icon: isImageFile(file) ? 'image' : 'file',
            title: file.name,
            description: file.type || t('chat.mentionTabFiles'),
            meta: formatFileSize(file.size),
            onPick: () => pickFile(file),
          })),
        }
      : null,
    showPlugins
      ? {
          id: 'plugins',
          label: t('entry.navPlugins'),
          options: pluginMatches.map((plugin) => ({
            id: `plugin-${plugin.id}`,
            icon: 'sparkles',
            title: localizePluginTitle(locale, plugin),
            description: localizePluginDescription(locale, plugin) || plugin.id,
            meta: pendingPluginId === plugin.id ? t('homeHero.applying') : t(plugin.sourceKind === 'bundled' ? 'chat.mentionPluginOfficial' : 'chat.mentionPluginMine'),
            pluginRecord: plugin,
            disabled: pendingPluginId !== null,
            onPick: () => pickPlugin(plugin),
          })),
        }
      : null,
    showSkills
      ? {
          id: 'skills',
          label: t('homeHero.skills'),
          options: skillMatches.map((skill) => ({
            id: `skill-${skill.id}`,
            icon: skill.id === activeSkillId ? 'check' : 'file',
            title: localizeSkillName(locale, skill),
            description: localizeSkillDescription(locale, skill) || skill.id,
            meta: skill.id === activeSkillId ? t('common.active') : skill.mode,
            onPick: () => pickSkill(skill),
          })),
        }
      : null,
    showMcp
      ? {
          id: 'mcp',
          label: 'MCP',
          options: mcpMatches.map((server) => ({
            id: `mcp-${server.id}`,
            icon: 'link',
            title: server.label || server.id,
            description: server.url || server.command || server.id,
            meta: server.transport,
            onPick: () => pickMcp(server),
          })),
        }
      : null,
  ].filter((section): section is HomeMentionSection => Boolean(section?.options.length));
  const visiblePickerOptions = visibleSections.flatMap((section) => section.options);
  const visibleLoading =
    (mentionTab === 'all' && (pluginsLoading || skillsLoading || mcpLoading)) ||
    (mentionTab === 'plugins' && pluginsLoading) ||
    (mentionTab === 'skills' && skillsLoading) ||
    (mentionTab === 'mcp' && mcpLoading);
  const promptMentionEntities = useMemo(
    () =>
      buildHomeMentionEntities({
        activePluginRecord,
        activeSkillId,
        activeSkillTitle,
        mcpOptions,
        pluginOptions,
        contextWorkspaceItems,
        selectedPluginContexts,
        stagedFiles,
        skillOptions,
      }),
    [
      activePluginRecord,
      activeSkillId,
      activeSkillTitle,
      mcpOptions,
      pluginOptions,
      contextWorkspaceItems,
      selectedPluginContexts,
      stagedFiles,
      skillOptions,
    ],
  );
  const fieldByName = useMemo(
    () => new Map(pluginInputFields.map((field) => [field.name, field])),
    [pluginInputFields],
  );
  const footerInputFields = useMemo(
    () => footerInputNames
      .map((name) => fieldByName.get(name))
      .filter((field): field is InputFieldSpec => Boolean(field)),
    [fieldByName, footerInputNames],
  );
  const inputCardStyle = {
    '--home-hero-prompt-max-height': `${HOME_HERO_PROMPT_MAX_HEIGHT}px`,
  } as CSSProperties;

  useEffect(() => {
    if (selectedIndex >= visiblePickerOptions.length) setSelectedIndex(0);
  }, [selectedIndex, visiblePickerOptions.length]);

  useEffect(() => {
    if (!pickerOpen) return;
    const isInsideMentionSurface = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      return (
        promptEditorRef.current?.contains(target) ||
        mentionPickerRef.current?.contains(target)
      );
    };
    const closePicker = () => {
      setMentionTrigger(null);
      setMentionTab('all');
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!isInsideMentionSurface(event.target)) closePicker();
    };
    const closeOnOutsideMouse = (event: MouseEvent) => {
      if (!isInsideMentionSurface(event.target)) closePicker();
    };
    const closeOnOutsideFocus = (event: FocusEvent) => {
      if (!isInsideMentionSurface(event.target)) closePicker();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('mousedown', closeOnOutsideMouse, true);
    document.addEventListener('focusin', closeOnOutsideFocus);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('mousedown', closeOnOutsideMouse, true);
      document.removeEventListener('focusin', closeOnOutsideFocus);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (!shortcutsOpen) return;
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && shortcutsMenuRef.current?.contains(target)) return;
      // The dropdown is portaled to <body>, so it's outside shortcutsMenuRef;
      // recognize it explicitly or a click on a menu item would close the menu
      // before the item's handler runs.
      if (target instanceof Element && target.closest('[data-shortcuts-panel]')) return;
      setShortcutsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShortcutsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [shortcutsOpen]);

  useEffect(() => {
    const urls = new Map<string, string>();
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      stagedFiles.forEach((file, index) => {
        // Rasters, vectors AND videos all lead with a thumbnail now (per
        // product: 视频类、图像类位图、矢量图 默认展示可打开预览), so each of
        // them needs an object URL to draw from.
        if (fileTypePreviewKind(file.name, file.type)) {
          urls.set(homeFileKey(file, index), URL.createObjectURL(file));
        }
      });
    }
    setStagedFilePreviewUrls(urls);
    return () => {
      if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [stagedFiles]);

  useEffect(() => {
    if (previewHomeFileKey && !previewHomeFile) setPreviewHomeFileKey(null);
  }, [previewHomeFileKey, previewHomeFile]);

  useEffect(() => {
    if (!previewHomeFileKey) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPreviewHomeFileKey(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewHomeFileKey]);

  // Shared by the imperative pulseSend() handle (plugin Use / preset picks
  // routed through HomeView) and the component-internal static
  // prompt-example path — every "composer just got seeded" flow shows the
  // same Send cue.
  function triggerSendAttention() {
    // Drop the class for a frame so a pulse requested mid-animation
    // restarts instead of being swallowed.
    setSendAttention(false);
    requestAnimationFrame(() => setSendAttention(true));
  }

  useImperativeHandle(
    ref,
    (): HomeHeroHandle => ({
      focus() {
        editorRef.current?.focus();
      },
      focusEnd() {
        editorRef.current?.focus();
      },
      pulseSend() {
        triggerSendAttention();
      },
    }),
    [],
  );

  // Insert an atomic @mention pill at the active trigger and return the
  // editor's new serialized text. The pill replaces the in-flight `@query`
  // (Lexical's insertMention handles the range), so callers can forward the
  // resulting text to the host pick handler without computing offsets.
  function insertHomeMention(token: string, entity: InlineMentionEntity): string {
    editorRef.current?.insertMention({ token, entity });
    return editorRef.current?.getText() ?? prompt;
  }

  function pickPlugin(record: InstalledPluginRecord) {
    const token = pluginMentionText(record);
    const next = insertHomeMention(token, {
      id: record.id,
      kind: 'plugin',
      label: record.title,
      token,
    });
    onPickPlugin(record, next);
  }

  function pickFile(file: File) {
    const token = inlineMentionToken(file.name);
    insertHomeMention(token, { id: file.name, kind: 'file', label: file.name, token });
    setSelectedIndex(0);
    // The file is already staged; the editor's onChange has updated the
    // prompt text, so there is nothing else to forward to the host.
  }

  function pickSkill(skill: SkillSummary) {
    const token = inlineMentionToken(skill.name);
    const next = insertHomeMention(token, {
      id: skill.id,
      kind: 'skill',
      label: skill.name,
      token,
    });
    onPickSkill(skill, next);
  }

  function pickMcp(server: McpServerConfig) {
    const label = server.label || server.id;
    const token = inlineMentionToken(label);
    const next = insertHomeMention(token, { id: server.id, kind: 'mcp', label, token });
    onPickMcp(server, next);
  }

  /* 引用其它项目 / 关联本地代码 attach context; they do NOT write into the
     prompt (per product: 这4个选项选中后都是在工作目录显示，不要在上边的输入框
     展示). Both are answers to the working-directory question — "what may the
     agent read besides this thread" — so the picked thing belongs in that row
     with the folder, not as an @mention the user then has to edit around. */
  function addWorkspaceContextItem(item: WorkspaceContextItem) {
    onAddWorkspaceContext(item);
    dismissMentionPicker();
  }

  function handleReferenceProjects(selections: ProjectReferenceSelection[]) {
    for (const selection of selections) {
      const path = selection.resolvedDir.trim();
      const label = selection.project.name || selection.project.id;
      addWorkspaceContextItem(
        {
          id: `project:${selection.project.id}`,
          kind: 'project',
          label,
          title: label,
          path: selection.project.id,
          ...(path ? { absolutePath: path } : {}),
        }
      );
    }
    setProjectReferenceOpen(false);
    trackContextLinkResult(analytics.track, {
      page_name: 'home',
      area: 'chat_composer',
      context_kind: 'project',
      result: 'success',
      count: selections.length,
    });
  }

  async function handleLinkLocalCodeContext() {
    const selected = await onPickLocalCodeDir?.();
    if (!selected) {
      trackContextLinkResult(analytics.track, {
        page_name: 'home',
        area: 'chat_composer',
        context_kind: 'local_code',
        result: 'cancelled',
      });
      return;
    }
    const label = selected.split(/[/\\]/).filter(Boolean).pop() || selected;
    addWorkspaceContextItem(
      {
        id: `local-code:${selected}`,
        kind: 'local-code',
        label,
        title: label,
        path: selected,
        absolutePath: selected,
      }
    );
    trackContextLinkResult(analytics.track, {
      page_name: 'home',
      area: 'chat_composer',
      context_kind: 'local_code',
      result: 'success',
      count: 1,
    });
  }

  // Both context actions live in the Add menu only (OPEND-3126), where the
  // project composer offers them too. Their pick still lands on the
  // working-directory trigger below (see `workdirSelection`), but that row's
  // own menu no longer offers a second copy of either entry.
  function referenceProjectAction() {
    trackHomeChatComposerClick(analytics.track, {
      page_name: 'home',
      area: 'chat_composer',
      element: 'plus_pick',
      resource_kind: 'workspace',
      resource_id: 'reference-project',
    });
    trackProjectReferenceModalSurfaceView(analytics.track, {
      page_name: 'home',
      area: 'project_reference_modal',
    });
    setProjectReferenceOpen(true);
  }

  const linkLocalCodeAction = onPickLocalCodeDir
    ? () => {
        trackHomeChatComposerClick(analytics.track, {
          page_name: 'home',
          area: 'chat_composer',
          element: 'plus_pick',
          resource_kind: 'workspace',
          resource_id: 'local-code',
        });
        void handleLinkLocalCodeContext();
      }
    : undefined;

  // Lexical reports the active @-trigger derived from the caret. HomeHero
  // has no slash surface, so only the mention branch is wired.
  function handleTrigger({
    mention: nextMention,
    anchorRect,
  }: {
    mention: { q: string } | null;
    slash: { q: string } | null;
    anchorRect: CaretRect | null;
  }) {
    if (!active) {
      setCaretRect(null);
      setMentionTrigger(null);
      setMentionTab('all');
      return;
    }
    setCaretRect(anchorRect);
    if (nextMention) {
      setMentionTrigger((prev) => {
        if (!prev || prev.query !== nextMention.q) setSelectedIndex(0);
        return { query: nextMention.q };
      });
    } else {
      setMentionTrigger(null);
      setMentionTab('all');
    }
  }

  function dismissMentionPicker() {
    setMentionTrigger(null);
    setMentionTab('all');
    setSelectedIndex(0);
  }

  useEffect(() => {
    if (!active) dismissMentionPicker();
  }, [active]);

  // Routes popover navigation keys from the Lexical editor over the visible
  // picker option union. Returns true when consumed so the editor can
  // preventDefault.
  function handlePopoverKey(
    key: 'ArrowDown' | 'ArrowUp' | 'Tab' | 'Enter' | 'Escape',
  ): boolean {
    if (!mentionActive) return false;
    if (key === 'Escape') {
      setMentionTrigger(null);
      return true;
    }
    if (visiblePickerOptions.length === 0) return false;
    if (key === 'ArrowDown') {
      setSelectedIndex((idx) => (idx + 1) % visiblePickerOptions.length);
      return true;
    }
    if (key === 'ArrowUp') {
      setSelectedIndex(
        (idx) => (idx - 1 + visiblePickerOptions.length) % visiblePickerOptions.length,
      );
      return true;
    }
    if (key === 'Tab' || key === 'Enter') {
      const selected = visiblePickerOptions[selectedIndex] ?? visiblePickerOptions[0];
      if (selected && !selected.disabled) selected.onPick();
      return true;
    }
    return false;
  }

  function handleFiles(files: File[]) {
    if (files.length === 0) return;
    onAddFiles(files);
  }


  function removeFileChip(index: number, file: File) {
    const nextPrompt = stripHomeMentionToken(prompt, file.name);
    if (nextPrompt !== prompt) onPromptChange(nextPrompt);
    onRemoveFile(index);
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    setDragActive(false);
    handleFiles(files);
  }

  function openActivePluginDetails() {
    if (activePluginRecord) onOpenPluginDetails(activePluginRecord);
  }

  function openActiveSkillDetails() {
    if (activeSkillRecord) onOpenSkillDetails(activeSkillRecord);
  }

  // Inline-backed plugin/MCP/connector contexts already render as @mention pills
  // in the editor. This row should mount only for content that has a visible chip
  // here; the aggregate context count is just an aria label when the row exists.
  const showActivePluginRow = Boolean(showActivePluginChip && activePluginTitle);
  // The active-template chip is NOT part of this row any more — it leads the
  // prompt text instead (see `.home-hero__lead-chip`).
  /* The working-directory row names ONE pick on its trigger: the most recent
     workspace item, since a directory (which outranks it) is named by the
     picker itself. Anything before that rides beside the trigger as a chip —
     the row can still show everything attached, it just leads with the answer
     the user gave last. */
  const workdirSelection = workingDir
    ? null
    : contextWorkspaceItems[contextWorkspaceItems.length - 1] ?? null;
  const workdirOverflowItems = workdirSelection
    ? contextWorkspaceItems.slice(0, -1)
    : contextWorkspaceItems;
  /* One slot, last pick wins (per product: 还是用户选择，但是只保留最新的一个).
     The working directory and the referenced projects / linked checkouts are
     separate pieces of state and nothing below can see both — the picker is
     handed `selection` only when there is NO directory (above), so a directory
     plus a linked checkout rendered happily side by side. This is the one place
     that holds both, so the rule belongs here.
     Enforced AFTER the fact rather than by clearing before a pick: every one of
     these rows opens something the user can still cancel (a native folder
     dialog, the project modal), and pre-clearing would throw away a good
     selection the moment they backed out of choosing its replacement. When both
     are occupied the one that did NOT just change is dropped; when neither did
     (nothing to compare) the host's own state is left alone. */
  const workspaceItemsKey = contextWorkspaceItems.map((item) => item.id).join('|');
  const prevWorkingDirRef = useRef(workingDir);
  const prevWorkspaceItemsKeyRef = useRef(workspaceItemsKey);
  useEffect(() => {
    const prevDir = prevWorkingDirRef.current;
    const prevKey = prevWorkspaceItemsKeyRef.current;
    prevWorkingDirRef.current = workingDir;
    prevWorkspaceItemsKeyRef.current = workspaceItemsKey;
    const dirChanged = workingDir !== prevDir;
    const itemsChanged = workspaceItemsKey !== prevKey;
    if (workingDir && contextWorkspaceItems.length > 0) {
      if (dirChanged && !itemsChanged) {
        for (const item of contextWorkspaceItems) onRemoveWorkspaceContext?.(item.id);
      } else if (itemsChanged && !dirChanged) {
        onClearWorkingDir?.();
      }
      return;
    }
    // No directory, but several attachments stacked up: keep the newest only.
    if (!workingDir && contextWorkspaceItems.length > 1) {
      for (const item of contextWorkspaceItems.slice(0, -1)) onRemoveWorkspaceContext?.(item.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingDir, workspaceItemsKey]);
  /* Workspace items (referenced projects / linked local code) are deliberately
     absent: they render in the working-directory row below the card, not in
     this band (see the row for why). */
  const showActiveContextRow =
    stagedFiles.length > 0 ||
    Boolean(activeSkillTitle) ||
    contextOnlyPlugins.length > 0 ||
    contextOnlyMcpServers.length > 0;
  useEffect(() => {
    const flow = promptFlowRef.current;
    if (!flow) return;
    const clear = () => {
      flow.classList.remove('is-chip-inline');
      flow.style.removeProperty('--home-hero-chip-w');
      flow.style.removeProperty('--home-hero-chip-text-left');
      flow.style.removeProperty('--home-hero-chip-lead');
    };
    const row = chipRowRef.current;
    if (!row) {
      clear();
      return;
    }
    if (typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      const rect = row.getBoundingClientRect();
      // Inline mode only fits a SINGLE line of chips: the row is taken out of
      // flow there, so a wrapped (multi-line) row would overlap the prompt text
      // instead of pushing it down. Anything taller falls back to the stacked
      // row above the editor.
      if (rect.width <= 0 || rect.height > 36) {
        clear();
        return;
      }
      // Wrapped lines align with the chip's own content edge (its icon), not
      // its border box — measured so a padding/border change can't desync it.
      const content = row.querySelector('.home-hero__active-icon, .home-hero__active-label');
      const textLeft = content ? content.getBoundingClientRect().left - rect.left : 0;
      // The chip is taller than one line of prompt text, so both starting at the
      // flow's top would leave the first line riding high against it. Drop the
      // text by half the difference instead of lifting the chip: a negative
      // offset would be clipped by this flow's own `overflow`.
      const editable = flow.querySelector('.composer-editable, [contenteditable="true"]');
      const lineHeight = editable ? parseFloat(getComputedStyle(editable).lineHeight) : Number.NaN;
      const lead = Number.isFinite(lineHeight) ? Math.max(0, (rect.height - lineHeight) / 2) : 0;
      flow.style.setProperty('--home-hero-chip-w', `${rect.width}px`);
      flow.style.setProperty('--home-hero-chip-text-left', `${Math.max(0, textLeft)}px`);
      flow.style.setProperty('--home-hero-chip-lead', `${lead}px`);
      flow.classList.add('is-chip-inline');
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return clear;
    const observer = new ResizeObserver(apply);
    observer.observe(row);
    return () => {
      observer.disconnect();
      clear();
    };
  }, [showActivePluginRow]);
  let optionRenderIndex = 0;

  return (
    <section
      ref={homeHeroRef}
      className={styles.hero}
      data-testid="home-hero"
    >
      {title ? <h2 className={styles.heading}>{title}</h2> : null}
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      {lead}
      {setupNotice}
      <div
        className={styles.composerCard}
        data-testid="home-hero-composer-card"
      >
      <Card
        className={`home-hero__input-card ${styles.inputCard}${dragActive ? ` ${styles.dragActive}` : ''}`}
        style={inputCardStyle}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) setDragActive(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          setDragActive(false);
        }}
        onDrop={handleDrop}
      >
        <div className="home-hero__prompt-flow" ref={promptFlowRef}>
        {showActiveContextRow ? (
          <AttachmentBand
            ariaLabel={
              contextItemCount > 0
                ? t('homeHero.contextItemsResolved', { n: contextItemCount })
                : undefined
            }
          >
            {stagedFiles.length > 0 ? (
              <span className="home-hero__active-file-group" data-testid="home-hero-staged-files">
                {stagedFiles.map((file, index) => {
                  const key = homeFileKey(file, index);
                  const previewUrl = stagedFilePreviewUrls.get(key) ?? null;
                  const previewKind = fileTypePreviewKind(file.name, file.type);
                  const fileBody = (
                    <>
                      {previewUrl && previewKind === 'video' ? (
                        // Its own first frame is the thumbnail: `preload
                        // metadata` is enough to paint one, and the element
                        // stays inert (no controls, muted) — the chip is a
                        // label, the click opens the real player.
                        <video
                          className="home-hero__active-thumb"
                          src={previewUrl}
                          muted
                          playsInline
                          preload="metadata"
                          aria-hidden
                        />
                      ) : previewUrl && previewKind ? (
                        <PixelAssetImage source={previewUrl} name="" maxHeight={36} fitLarge
                          className={`home-hero__active-thumb ${styles.stagedArt}`} />
                      ) : (
                        <span className="home-hero__active-icon" aria-hidden>
                          {/* The type's own mark (per product). A previewable
                              file only lands here when its thumbnail could not
                              be made at all. */}
                          <FileTypeIcon
                            name={
                              previewKind
                                ? previewFallbackIcon(previewKind, file.name)
                                : resolveFileTypeIcon(file.name, file.type)
                            }
                            size={20}
                          />
                        </span>
                      )}
                      {/* Name over type · size (per product): two lines inside the
                          chip instead of one run, so the band stays a single
                          row of fixed-height chips. */}
                      <span className="home-hero__active-file-text">
                        <span className="home-hero__active-label">{file.name}</span>
                        <span className="home-hero__active-meta">{formatFileMeta(file)}</span>
                      </span>
                    </>
                  );
                  return (
                    <span
                      key={key}
                      className="home-hero__active-chip home-hero__active-chip--context home-hero__active-chip--file"
                      title={`${file.name} · ${formatFileSize(file.size)}`}
                    >
                      {previewUrl ? (
                        <button
                          type="button"
                          className="home-hero__active-chip-body home-hero__active-file-body"
                          onClick={() => setPreviewHomeFileKey(key)}
                          aria-label={t('common.previewFile', { name: file.name })}
                        >
                          {fileBody}
                        </button>
                      ) : (
                        <span className="home-hero__active-file-body">
                          {fileBody}
                        </span>
                      )}
                      {/* No tooltip on this one: the × already sits inside a
                          chip that names the file, so the floating 移除文件
                          bubble was covering the chip above it for no new
                          information. `aria-label` still carries the action. */}
                      <button
                        type="button"
                        className="home-hero__active-clear"
                        onClick={() => removeFileChip(index, file)}
                        aria-label={t('chat.removeAria', { name: file.name })}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  );
                })}
              </span>
            ) : null}
            {activeSkillTitle ? (
              <span
                className="home-hero__active-chip home-hero__active-chip--skill"
                data-testid="home-hero-active-skill"
              >
                <button
                  type="button"
                  className="home-hero__active-chip-body"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    openActiveSkillDetails();
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    openActiveSkillDetails();
                  }}
                  onClick={openActiveSkillDetails}
                  disabled={!activeSkillRecord}
                  title={activeSkillRecord ? activeSkillRecord.description || activeSkillTitle : undefined}
                >
                  <span className="home-hero__active-icon" aria-hidden>
                    <Icon name="sparkles" size={12} />
                  </span>
                  <span className="home-hero__active-label">{t('homeHero.skillPrefix', { title: activeSkillTitle })}</span>
                </button>
                <button
                  type="button"
                  className="home-hero__active-clear pixo-tooltip"
                  onClick={onClearActiveSkill}
                  aria-label={t('homeHero.clearActiveSkill')}
                  title={t('homeHero.clearActiveSkill')}
                  data-tooltip={t('homeHero.clearActiveSkill')}
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            ) : null}
            {contextOnlyPlugins.map((plugin) => (
              <ContextChipHoverCard
                key={`ctx-plugin-${plugin.id}`}
                className="home-hero__active-chip home-hero__active-chip--context"
                data-testid={`home-hero-context-plugin-${plugin.id}`}
                typeLabel="Plugin"
                detail={plugin.id}
              >
                <span className="home-hero__active-icon" aria-hidden>
                  <Icon name="sliders" size={12} />
                </span>
                <span className="home-hero__active-label">{plugin.title}</span>
                <button
                  type="button"
                  className="home-hero__active-clear pixo-tooltip"
                  onClick={() => {
                    trackHomeChatComposerClick(analytics.track, {
                      page_name: 'home',
                      area: 'chat_composer',
                      element: 'context_remove',
                      resource_kind: 'plugin',
                      resource_id: plugin.id,
                    });
                    onRemovePluginContext(plugin.id);
                  }}
                  aria-label={t('chat.removeAria', { name: plugin.title })}
                  title={t('common.close')}
                  data-tooltip={t('common.close')}
                  data-testid={`home-hero-context-clear-${plugin.id}`}
                >
                  <Icon name="close" size={12} />
                </button>
              </ContextChipHoverCard>
            ))}
            {contextOnlyMcpServers.map((server) => {
              const label = server.label || server.id;
              return (
                <ContextChipHoverCard
                  key={`ctx-mcp-${server.id}`}
                  className="home-hero__active-chip home-hero__active-chip--context"
                  data-testid={`home-hero-context-mcp-${server.id}`}
                  typeLabel="MCP server"
                  detail={server.url || server.id}
                >
                  <span className="home-hero__active-icon" aria-hidden>
                    <Icon name="sliders" size={12} />
                  </span>
                  <span className="home-hero__active-label">{label}</span>
                  <button
                    type="button"
                    className="home-hero__active-clear pixo-tooltip"
                    onClick={() => {
                      trackHomeChatComposerClick(analytics.track, {
                        page_name: 'home',
                        area: 'chat_composer',
                        element: 'context_remove',
                        resource_kind: 'mcp',
                        resource_id: server.id,
                      });
                      onRemoveMcpContext(server.id);
                    }}
                    aria-label={t('chat.removeAria', { name: label })}
                    title={t('common.close')}
                    data-tooltip={t('common.close')}
                    data-testid={`home-hero-context-clear-${server.id}`}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </ContextChipHoverCard>
              );
            })}

          </AttachmentBand>
        ) : null}
        <div className="home-hero__prompt-surface">
          {/* The selected-template chip leads the prompt's first line and never
              shares the attachment row above (per product), so it lives here —
              beside the text it belongs to — rather than with staged files. */}
          {showActivePluginRow ? (
            <div ref={chipRowRef} className="home-hero__lead-chip">
                <span className="home-hero__active-chip" data-testid="home-hero-active-plugin">
                  <button
                    type="button"
                    className="home-hero__active-chip-body"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      openActivePluginDetails();
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      openActivePluginDetails();
                    }}
                    onClick={openActivePluginDetails}
                    disabled={!activePluginRecord}
                    title={activePluginRecord ? t('homeHero.pluginTitle', { title: activePluginRecord.title }) : undefined}
                  >
                    <span className="home-hero__active-icon" aria-hidden>
                      <Icon name="sparkles-filled" size={12} />
                    </span>
                    <span className="home-hero__active-label">
                      {leadChipTitle(activePluginTitle ?? '')}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="home-hero__active-clear"
                    onClick={() => {
                      trackHomeChatComposerClick(analytics.track, {
                        page_name: 'home',
                        area: 'chat_composer',
                        element: 'plugin_chip_clear',
                        chip_id: activePluginRecord?.id,
                      });
                      onClearActivePlugin();
                    }}
                    /* No tooltip: the × sits inside the chip it clears, so a
                       floating label only covered the chip above it. The
                       aria-label still names the action for screen readers. */
                    aria-label={t('homeHero.clearActivePlugin')}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </span>
            </div>
          ) : null}
          <div ref={promptEditorRef} className="home-hero__prompt-editor home-hero__lexical">
            <LexicalComposerInput
              ref={editorRef}
              testId="home-hero-input"
              draft={prompt}
              placeholder={placeholder}
              title={placeholder}
              descriptionId={sendHintId}
              knownEntities={promptMentionEntities}
              onChange={(plainText) => {
                // A programmatic seed (host setPrompt → draft prop →
                // SeedingPlugin) echoes back through Lexical's onChange. The
                // old <textarea> never fired onChange for a controlled-value
                // change, so skip the echo here: otherwise seeding would run
                // the host's handlePromptChange — flipping promptEditedByUser
                // (spurious "replace prompt?" dialogs) and re-extracting plugin
                // inputs from the seeded text. Real user edits always differ
                // from the current prompt.
                if (plainText === prompt) return;
                onPromptChange(plainText);
              }}
              onTrigger={handleTrigger}
              onEnterSend={handleSend}
              onPasteFiles={handleFiles}
              // Backspace at the start clears the selected plugin.
              onBackspaceAtStart={() => {
                if (!showActivePluginRow) return false;
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plugin_chip_clear',
                  chip_id: activePluginRecord?.id,
                });
                onClearActivePlugin();
                return true;
              }}
              popoverOpen={pickerOpen && visiblePickerOptions.length > 0}
              onPopoverKey={handlePopoverKey}
              comboboxAria={{
                expanded: pickerOpen,
                activeId: pickerOpen ? `home-hero-option-${selectedIndex}` : null,
              }}
            />
          </div>
        </div>
        </div>
        <CaretFloatingLayer caret={caretRect} open={pickerOpen}>
          <div
            ref={mentionPickerRef}
            id="home-hero-context-picker"
            className="home-hero__plugin-picker home-hero__plugin-picker--floating"
            role="listbox"
            aria-label={t('homeHero.contextSearchResults')}
            data-testid="home-hero-plugin-picker"
          >
            <div className="home-hero__mention-tabs" role="tablist" aria-label={t('homeHero.contextSurfaces')}>
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={mentionTab === item.id}
                  className={`home-hero__mention-tab${mentionTab === item.id ? ' is-active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setMentionTab(item.id);
                    setSelectedIndex(0);
                  }}
                >
                  <span>{item.label}</span>
                  {item.count > 0 ? <span>{item.count}</span> : null}
                </button>
              ))}
            </div>
            <div className="home-hero__plugin-picker-results">
              {visibleLoading && visiblePickerOptions.length === 0 ? (
                <div className="home-hero__plugin-picker-empty">{t('homeHero.loadingContext')}</div>
              ) : null}
              {!visibleLoading && visiblePickerOptions.length === 0 ? (
                <div className="home-hero__plugin-picker-empty">
                  {mentionQuery ? (
                    <>{t('homeHero.noResults', { query: mentionQuery })}</>
                  ) : (
                    <>{t('homeHero.searchPrompt')}</>
                  )}
                </div>
              ) : null}
              {visibleSections.map((section) => (
                <div key={section.id} className="home-hero__mention-section">
                  <div className="home-hero__mention-section-label">{section.label}</div>
                  {section.options.map((item) => {
                    const optionIndex = optionRenderIndex;
                    optionRenderIndex += 1;
                    return (
                      <button
                        key={item.id}
                        id={`home-hero-option-${optionIndex}`}
                        type="button"
                        role="option"
                        aria-selected={optionIndex === selectedIndex}
                        className={`home-hero__plugin-option${
                          optionIndex === selectedIndex ? ' is-active' : ''
                        }`}
                        onMouseEnter={() => setSelectedIndex(optionIndex)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          if (!item.disabled) item.onPick();
                        }}
                        disabled={item.disabled}
                      >
                        <span className="home-hero__plugin-option-icon" aria-hidden>
                          <Icon name={item.icon} size={13} />
                        </span>
                        <span className="home-hero__plugin-option-main">
                          <span>{item.title}</span>
                          <span>{item.description}</span>
                        </span>
                        <span className="home-hero__plugin-option-meta">
                          {item.meta}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </CaretFloatingLayer>
        <div className={`home-hero__input-foot ${styles.footer}`}>
          <input
            ref={fileInputRef}
            data-testid="home-hero-file-input"
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              handleFiles(files);
              event.target.value = '';
            }}
          />
          <div className={`home-hero__foot-left ${styles.controls}`}>
            {executionSwitcher ? (
              <div className={`home-hero__execution-switcher ${styles.executionSwitcher}`}>
                {executionSwitcher}
              </div>
            ) : null}
            <Button
              variant="secondary"
              className={styles.attachmentButton}
              onClick={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'attachment',
                });
                fileInputRef.current?.click();
              }}
            >
              <Icon name="plus" size={13} />
              {t('home.composerAttachments')}
            </Button>
            {artStyleId ? (
              <Tag className={styles.styleTag} data-testid="home-hero-art-style">
                {t('home.composerStyle', { style: artStyleId.replace(/[-_]/g, ' ') })}
              </Tag>
            ) : null}
            {/* Upload entry: an icon-only disc, lifted out of the accessory row
                below into the head of this one (per product) but keeping that
                row's leading position. Sized and filled like the model chip
                across the row. */}
            <ComposerPlusMenu

              triggerTestId="home-hero-plus-trigger"
              placementPreference="down"
              onOpen={() =>
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_menu_open',
                })
              }
              onSubmenuOpen={(submenu) => {
                // Home never passes the working-dir submenu (it keeps its own
                // footer picker), so only the resource submenus reach here.
                if (submenu === 'workingDir') return;
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_submenu_open',
                  resource_kind: PLUS_SUBMENU_RESOURCE_KIND[submenu],
                });
              }}
              onSearchUsed={(submenu) => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_search',
                  resource_kind: PLUS_SUBMENU_RESOURCE_KIND[submenu],
                });
              }}
              plugins={pluginOptions}
              onPickPlugin={(record) => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_pick',
                  resource_kind: 'plugin',
                  resource_id: record.id,
                });
                pickPlugin(record);
              }}
              onAddPlugin={onAddPlugin ? () => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_add',
                  resource_kind: 'plugin',
                });
                onAddPlugin();
              } : undefined}
              skills={skillOptions}
              onPickSkill={(skill) => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_pick',
                  resource_kind: 'skill',
                  resource_id: skill.id,
                });
                pickSkill(skill);
              }}
              mcpServers={mcpOptions}
              onPickMcp={(server) => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_pick',
                  resource_kind: 'mcp',
                  resource_id: server.id,
                });
                pickMcp(server);
              }}
              onAddMcp={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_add',
                  resource_kind: 'mcp',
                });
                onAddMcp();
              }}
              onAttachFiles={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'attachment',
                });
                fileInputRef.current?.click();
              }}
              // Both context actions sit in the Add menu on Home as well as
              // in the project composer (OPEND-3085, per the Demo). This is
              // their ONLY entry on Home (OPEND-3126): the working-directory
              // row below no longer carries copies, so the `plus_pick`
              // analytics are emitted from here alone.
              onReferenceProject={referenceProjectAction}
              onLinkLocalCode={linkLocalCodeAction}
            />
            {projectReferenceOpen ? (
              <ProjectReferenceModal

                onClose={() => {
                  // Only the dismiss paths (X / backdrop / Escape / Cancel)
                  // land here — a confirmed pick closes via
                  // handleReferenceProjects, which reports 'success'.
                  trackContextLinkResult(analytics.track, {
                    page_name: 'home',
                    area: 'chat_composer',
                    context_kind: 'project',
                    result: 'cancelled',
                  });
                  setProjectReferenceOpen(false);
                }}
                onSelect={handleReferenceProjects}
              />
            ) : null}

            {footerInputFields.length > 0 ? (
              <div className="home-hero__footer-options" data-testid="home-hero-footer-options">
                {footerInputFields.map((field) => (
                  <FooterInputOption
                    key={field.name}
                    field={field}
                    value={pluginInputValues[field.name]}
                    onChange={(value) => {
                      onPluginInputValuesChange({
                        ...pluginInputValues,
                        [field.name]: value,
                      });
                    }}
                    t={t}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className={`home-hero__foot-right ${styles.sendControls}`}>
            {/* No mode picker on Home (2026-09-08, product): the 「设计 ×」 chip
                used to sit here, left of the model switcher. The project
                composer dropped the same chooser first (2026-08-19 — see the
                matching comment in `ChatComposer.tsx`); Home was the last
                surface still carrying it, and every Home request defaulted
                past it to Design anyway.

                Behaviour is unchanged, only the control is gone: `HomeView`
                still owns the `sessionMode` state that feeds `conversationMode`
                (plus the task profile and plugin provenance), and with nothing
                calling `setSessionMode` it stays on the app default, `design`.

                To restore: re-add `import { ComposerModePicker } from
                './ComposerModePicker'`, re-destructure the `sessionMode` /
                `onSessionModeChange` props (still declared above, still passed
                by `HomeView`), and render the picker here with the
                `trackComposerSessionModeClick` call it had. Pinned by
                `tests/components/HomeView.mode-picker-removed.test.tsx`. */}
            <p id={sendHintId} className={styles.sendHint} data-testid="home-hero-send-hint">
              {t('chat.sendHint')}
            </p>
            <Button
              variant="primary"
              className={`${styles.submit}${sendAttention ? ` ${styles.sendAttention}` : ''}`}
              data-testid="home-hero-submit"
              onClick={handleSend}
              onAnimationEnd={() => setSendAttention(false)}
              disabled={!sendEnabled}
              // No tooltip: the arrow is the composer's only send affordance,
              // and the 运行 bubble landed on the prompt text right above it.
              // Progress appears in the destination Chat frame, so this action
              // never flashes a transient loading name/state before unmount.
              aria-label={t('homeHero.run')}
              aria-busy={false}
            >
              <Icon name="arrow-up" size={18} />
            </Button>
          </div>
        </div>
      </Card>

      {/* Accessory row under the composer card: just the working directory now
          — the upload entry moved up into the card's send cluster (per product)
          and the design system sits beside the type pill (per product:
          绿色 pill 后面跟设计系统 icon). */}
      <div className={`home-hero__workdir-row ${styles.workingDirectory}`}>
        {onPickWorkingDir ? (
          <WorkingDirPicker
            className="home-hero__working-dir-picker"
            /* Docked at the foot of the community view, a downward panel opens
               straight off the bottom of the window — so this one hangs UP and
               over the composer instead. Home's copy of the same picker sits
               mid-column with room below it and keeps opening down. */
            placement="down"
            emptyLabel={t('homeWorkingDir.triggerShort')}
            workingDir={workingDir}
            recentDirs={recentDirs}
            onPickDirectory={() => {
              trackHomeChatComposerClick(analytics.track, {
                page_name: 'home',
                area: 'chat_composer',
                element: 'working_dir',
              });
              void onPickWorkingDir();
            }}
            onSelectRecent={(dir) => {
              trackHomeChatComposerClick(analytics.track, {
                page_name: 'home',
                area: 'chat_composer',
                element: 'working_dir_recent',
              });
              onSelectRecentWorkingDir?.(dir);
            }}
            onClear={() => {
              trackHomeChatComposerClick(analytics.track, {
                page_name: 'home',
                area: 'chat_composer',
                element: 'working_dir_clear',
              });
              onClearWorkingDir?.();
            }}
            /* The folder rows here and the context actions in the Add menu
               answer one question — what may the agent read besides this
               thread — so they all report the same way: the trigger takes the
               pick's name, and its hover × clears it (per product: 工作目录会
               换成后边的文件名…和现在选择最近使用的文件夹的逻辑一样). The LAST
               attached item is the one named; a directory outranks it. */
            selection={
              workdirSelection
                ? {
                    label: workdirSelection.label,
                    icon: workdirSelection.kind === 'local-code' ? 'terminal' : 'folder',
                    title: workdirSelection.absolutePath ?? workdirSelection.title,
                    onClear: () => {
                      trackHomeChatComposerClick(analytics.track, {
                        page_name: 'home',
                        area: 'chat_composer',
                        element: 'context_remove',
                        resource_kind: 'workspace',
                        resource_id: workdirSelection.id,
                      });
                      onRemoveWorkspaceContext(workdirSelection.id);
                    },
                  }
                : null
            }
          />
        ) : null}
        {/* Only the OVERFLOW: with several projects referenced at once the
            trigger can name one, so the rest ride beside it rather than
            disappearing. A single pick — the normal case — leaves this empty. */}
        {workdirOverflowItems.map((item) => (
          <ContextChipHoverCard
            key={`ctx-workspace-${item.id}`}
            className="home-hero__active-chip home-hero__active-chip--context"
            data-testid={`home-hero-context-workspace-${item.id}`}
            typeLabel={workspaceContextKindLabel(item.kind, t)}
            detail={workspaceContextDetailLine(item)}
          >
            <span className="home-hero__active-icon" aria-hidden>
              <Icon name={item.kind === 'local-code' ? 'terminal' : 'folder'} size={12} />
            </span>
            <span className="home-hero__active-label">{item.label}</span>
            <button
              type="button"
              className="home-hero__active-clear pixo-tooltip"
              onClick={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'context_remove',
                  resource_kind: 'workspace',
                  resource_id: item.id,
                });
                // Nothing to strip from the prompt any more: attaching one of
                // these no longer writes a mention into it.
                onRemoveWorkspaceContext(item.id);
              }}
              aria-label={t('chat.removeAria', { name: item.label })}
              title={t('common.close')}
              data-tooltip={t('common.close')}
              data-testid={`home-hero-context-clear-${item.id}`}
            >
              <Icon name="close" size={12} />
            </button>
          </ContextChipHoverCard>
        ))}
      </div>
      </div>

      {artifactUpgradeSlot}

      {error ? (
        <div role="alert" className="home-hero__error">
          {error}
        </div>
      ) : null}
      {previewHomeFile && previewHomeFileUrl ? createPortal(
        <div
          className="staged-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label={previewHomeFile.name}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewHomeFileKey(null);
          }}
        >
          <div className="staged-preview-card">
            <div className="staged-preview-head">
              <span title={previewHomeFile.name}>{previewHomeFile.name}</span>
              <button
                type="button"
                className="icon-only pixo-tooltip"
                onClick={() => setPreviewHomeFileKey(null)}
                aria-label={t('common.close')}
                title={t('common.close')}
                data-tooltip={t('common.close')}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            {/* A video opens as a player, everything else as a still — the
                same card either way, so the chip's click always lands on the
                file itself rather than on a download. */}
            {fileTypePreviewKind(previewHomeFile.name, previewHomeFile.type) === 'video' ? (
              <video src={previewHomeFileUrl} controls autoPlay={false} playsInline />
            ) : (
              <img src={previewHomeFileUrl} alt={previewHomeFile.name} />
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </section>
  );
});

function homeFileKey(file: File, index: number): string {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(file.name);
}

/**
 * The staged-file chip's second line — "PNG · 1.7 MB". The extension is the
 * label people recognise; a name without a usable one falls back to the MIME
 * subtype's leading token (`image/svg+xml` → SVG) and, failing that, to the
 * size alone.
 */
function formatFileMeta(file: File): string {
  const size = formatFileSize(file.size);
  const ext = /\.([a-z0-9]{1,8})$/i.exec(file.name)?.[1];
  const kind = ext ?? file.type.split('/')[1]?.split(/[+;]/)[0];
  return kind ? `${kind.toUpperCase()} · ${size}` : size;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}

const HOME_HERO_PROMPT_MAX_HEIGHT = 180;

function pluginMentionText(record: InstalledPluginRecord): string {
  return inlineMentionToken(record.title);
}

function buildHomeMentionEntities({
  activePluginRecord,
  activeSkillId,
  activeSkillTitle,
  contextWorkspaceItems,
  mcpOptions,
  pluginOptions,
  selectedPluginContexts,
  stagedFiles,
  skillOptions,
}: {
  activePluginRecord: InstalledPluginRecord | null;
  activeSkillId: string | null;
  activeSkillTitle: string | null;
  contextWorkspaceItems: WorkspaceContextItem[];
  mcpOptions: McpServerConfig[];
  pluginOptions: InstalledPluginRecord[];
  selectedPluginContexts: InstalledPluginRecord[];
  stagedFiles: File[];
  skillOptions: SkillSummary[];
}): InlineMentionEntity[] {
  const entities: InlineMentionEntity[] = [];
  for (const item of contextWorkspaceItems) {
    entities.push({
      id: item.id,
      kind: 'workspace',
      label: item.label,
      token: inlineMentionToken(item.label),
      title: `Workspace: ${item.label}`,
    });
  }
  const fileSeen = new Set<string>();
  for (const file of stagedFiles) {
    if (fileSeen.has(file.name)) continue;
    fileSeen.add(file.name);
    entities.push({
      id: file.name,
      kind: 'file',
      label: file.name,
      token: inlineMentionToken(file.name),
      title: `File: ${file.name}`,
    });
  }
  const pluginSeen = new Set<string>();
  for (const plugin of [...selectedPluginContexts, ...pluginOptions]) {
    if (pluginSeen.has(plugin.id)) continue;
    pluginSeen.add(plugin.id);
    entities.push({
      id: plugin.id,
      kind: 'plugin',
      label: plugin.title,
      token: pluginMentionText(plugin),
      title: `Plugin: ${plugin.title}`,
    });
  }
  if (activePluginRecord && !pluginSeen.has(activePluginRecord.id)) {
    entities.push({
      id: activePluginRecord.id,
      kind: 'plugin',
      label: activePluginRecord.title,
      token: pluginMentionText(activePluginRecord),
      title: `Plugin: ${activePluginRecord.title}`,
    });
  }
  const skillSeen = new Set<string>();
  for (const skill of skillOptions) {
    if (skillSeen.has(skill.id)) continue;
    skillSeen.add(skill.id);
    entities.push({
      id: skill.id,
      kind: 'skill',
      label: skill.name,
      token: inlineMentionToken(skill.name),
      title: `Skill: ${skill.name}`,
    });
    if (skill.id !== skill.name) {
      entities.push({
        id: skill.id,
        kind: 'skill',
        label: skill.id,
        token: inlineMentionToken(skill.id),
        title: `Skill: ${skill.name}`,
      });
    }
  }
  if (activeSkillId && activeSkillTitle && !skillSeen.has(activeSkillId)) {
    entities.push({
      id: activeSkillId,
      kind: 'skill',
      label: activeSkillTitle,
      token: inlineMentionToken(activeSkillTitle),
      title: `Skill: ${activeSkillTitle}`,
    });
  }
  for (const server of mcpOptions) {
    const label = server.label || server.id;
    entities.push({
      id: server.id,
      kind: 'mcp',
      label,
      token: inlineMentionToken(label),
      title: `MCP: ${label}`,
    });
    if (server.id !== label) {
      entities.push({
        id: server.id,
        kind: 'mcp',
        label: server.id,
        token: inlineMentionToken(server.id),
        title: `MCP: ${label}`,
      });
    }
  }
  return entities;
}

function FooterInputOption({
  field,
  value,
  onChange,
  t,
}: {
  field: InputFieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  t: ReturnType<typeof useT>;
}) {
  const label = footerInputLabel(field, t);
  if (field.name === 'speakerNotes') {
    const checked = footerSpeakerNotesEnabled(value);
    return (
      <button
        type="button"
        className={`home-hero__footer-switch${checked ? ' is-on' : ''}`}
        aria-label={label}
        aria-pressed={checked}
        data-testid="home-hero-footer-option-speakerNotes"
        onClick={() => onChange(checked ? 'no speaker notes' : 'include speaker notes')}
      >
        <span>{t('homeHero.footer.speakerNotes')}</span>
        <i aria-hidden />
      </button>
    );
  }
  if (field.type === 'select' && Array.isArray(field.options)) {
    return (
      <FooterSelectOption
        fieldName={field.name}
        label={label}
        value={value === undefined || value === null ? '' : String(value)}
        options={[
          ...(field.placeholder ? [{ value: '', label: field.placeholder }] : []),
          ...field.options.map((option) => ({
            value: option,
            label: footerInputValueLabel(field, option, t),
            modelIcon: field.name === 'model' ? modelOptionIcon(option, footerInputValueLabel(field, option, t)) : undefined,
            ratioIcon: field.name === 'ratio' ? ratioOptionIcon(option) : undefined,
          })),
        ]}
        onChange={onChange}
      />
    );
  }
  return (
    <label className="home-hero__footer-option home-hero__footer-option--text" data-field-name={field.name}>
      <span>{label}</span>
      <input
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder ?? ''}
        aria-label={label}
        data-testid={`home-hero-footer-option-${field.name}`}
      />
    </label>
  );
}

function FooterSelectOption({
  fieldName,
  label,
  value,
  options,
  searchable = false,
  searchPlaceholder,
  onChange,
}: {
  fieldName: string;
  label: string;
  value: string;
  options: FooterSelectItemOption[];
  searchable?: boolean;
  searchPlaceholder?: string;
  onChange: (value: unknown) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const visibleOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => (
      option.label.toLowerCase().includes(query) ||
      option.value.toLowerCase().includes(query) ||
      (option.description ?? '').toLowerCase().includes(query) ||
      (option.meta ?? '').toLowerCase().includes(query) ||
      (option.group ?? '').toLowerCase().includes(query)
    ));
  }, [options, search]);
  const groupedOptions = useMemo(() => {
    const groups: { label: string | null; options: FooterSelectItemOption[] }[] = [];
    for (const option of visibleOptions) {
      const groupLabel = option.group ?? null;
      const last = groups[groups.length - 1];
      if (last && last.label === groupLabel) {
        last.options.push(option);
      } else {
        groups.push({ label: groupLabel, options: [option] });
      }
    }
    return groups;
  }, [visibleOptions]);
  useEffect(() => {
    if (!open) return;
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  return (
    <div
      ref={ref}
      className={`home-hero__footer-option home-hero__footer-option--select${open ? ' is-open' : ''}`}
      data-field-name={fieldName}
    >
      <span>{label}</span>
      <button
        type="button"
        className="home-hero__footer-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={`home-hero-footer-option-${fieldName}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected?.icon ? <FooterOptionIcon name={selected.icon} compact /> : null}
        {selected?.modelIcon ? <ModelOptionIcon icon={selected.modelIcon} compact /> : null}
        {selected?.ratioIcon ? <RatioOptionIcon icon={selected.ratioIcon} compact /> : null}
        <span className="home-hero__footer-select-label">{selected?.label ?? value}</span>
        <Icon name="chevron-down" size={12} aria-hidden />
      </button>
      {open ? (
        <div
          className={`home-hero__footer-select-menu${searchable ? ' home-hero__footer-select-menu--searchable' : ''}`}
          role="listbox"
          data-testid={`home-hero-footer-option-${fieldName}-menu`}
        >
          {searchable ? (
            <div className="home-hero__footer-select-search">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder ?? label}
                autoFocus
                data-testid={`home-hero-footer-option-${fieldName}-search`}
              />
              <div className="home-hero__footer-select-count">
                {t('homeHero.footer.availableCount', { n: visibleOptions.length })}
              </div>
            </div>
          ) : null}
          {groupedOptions.length === 0 ? (
            <div className="home-hero__footer-select-empty">{t('homeHero.footer.noMatches')}</div>
          ) : (
            groupedOptions.map((group, index) => (
              <div
                className="home-hero__footer-select-group"
                key={`${group.label ?? 'ungrouped'}:${group.options[0]?.value ?? index}`}
              >
                {group.label ? (
                  <div className="home-hero__footer-select-group-label">{group.label}</div>
                ) : null}
                {group.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className={`home-hero__footer-select-item${option.value === value ? ' is-selected' : ''}`}
                    onClick={() => {
                      onChange(option.submitValue ?? option.value);
                      setOpen(false);
                    }}
                  >
                    {option.icon ? <FooterOptionIcon name={option.icon} /> : null}
                    {option.modelIcon ? <ModelOptionIcon icon={option.modelIcon} /> : null}
                    {option.ratioIcon ? <RatioOptionIcon icon={option.ratioIcon} /> : null}
                    <span className="home-hero__footer-select-copy">
                      <span className="home-hero__footer-select-label">{option.label}</span>
                      {option.description ? (
                        <span className="home-hero__footer-select-description">{option.description}</span>
                      ) : null}
                    </span>
                    {option.meta ? <span className="home-hero__footer-select-meta">{option.meta}</span> : null}
                    {option.value === value ? <Icon name="check" size={14} aria-hidden /> : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

interface FooterSelectItemOption {
  value: string;
  submitValue?: string;
  label: string;
  group?: string;
  icon?: IconName;
  description?: string;
  meta?: string;
  modelIcon?: ModelOptionIconSpec;
  ratioIcon?: RatioOptionIconSpec;
  preview?: {
    title: string;
    swatches?: string[];
    logoUrl?: string;
  };
}

interface ModelOptionIconSpec {
  label: string;
  tone:
    | 'openai'
    | 'dalle'
    | 'seed'
    | 'sense'
    | 'grok'
    | 'google'
    | 'router'
    | 'flux'
    | 'elevenlabs'
    | 'fishaudio'
    | 'minimax'
    | 'suno'
    | 'audio'
    | 'custom';
  src?: string;
}

interface RatioOptionIconSpec {
  width: number;
  height: number;
  tone: 'square' | 'wide' | 'tall' | 'standard' | 'portrait' | 'custom';
}

function FooterOptionIcon({
  name,
  compact = false,
}: {
  name: IconName;
  compact?: boolean;
}) {
  return (
    <span
      className={`home-hero__footer-option-icon${compact ? ' home-hero__footer-option-icon--compact' : ''}`}
      aria-hidden
    >
      <Icon name={name} size={13} />
    </span>
  );
}

function ModelOptionIcon({
  icon,
  compact = false,
}: {
  icon: ModelOptionIconSpec;
  compact?: boolean;
}) {
  return (
    <span
      className={`home-hero__model-option-icon home-hero__model-option-icon--${icon.tone}${compact ? ' home-hero__model-option-icon--compact' : ''}`}
      aria-hidden
    >
      {icon.src ? <img src={icon.src} alt="" draggable={false} /> : icon.label}
    </span>
  );
}

function RatioOptionIcon({
  icon,
  compact = false,
}: {
  icon: RatioOptionIconSpec;
  compact?: boolean;
}) {
  return (
    <span
      className={`home-hero__ratio-option-icon home-hero__ratio-option-icon--${icon.tone}${compact ? ' home-hero__ratio-option-icon--compact' : ''}`}
      aria-hidden
    >
      <i style={{ width: icon.width, height: icon.height }} />
    </span>
  );
}

function footerInputLabel(field: InputFieldSpec, t: ReturnType<typeof useT>): string {
  switch (field.name) {
    case 'speakerNotes':
      return t('homeHero.footer.speakerNotes');
    case 'model':
      return t('newproj.modelLabel');
    case 'ratio':
      return t('homeHero.footer.ratio');
    case 'duration':
      return t('homeHero.footer.duration');
    case 'resolution':
      return t('homeHero.footer.resolution');
    default:
      return field.label ?? field.name;
  }
}

function footerInputValueLabel(field: InputFieldSpec, value: string, t: ReturnType<typeof useT>): string {
  if (field.name === 'speakerNotes') {
    return footerSpeakerNotesEnabled(value) ? t('homeHero.footer.speakerNotes') : t('homeHero.footer.noSpeakerNotes');
  }
  return optionLabelMap(field)[value] ?? value;
}

function footerSpeakerNotesEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return false;
  return !(
    normalized === 'false' ||
    normalized === 'no' ||
    normalized === 'none' ||
    normalized.includes('no speaker')
  );
}

function modelOptionIcon(value: string, label: string): ModelOptionIconSpec {
  const normalized = `${value} ${label}`.toLowerCase();
  if (normalized.includes('dall-e')) return { label: 'OpenAI', tone: 'dalle', src: '/model-icons/openai.svg' };
  if (normalized.includes('gpt-image') || normalized.includes('openai') || normalized.includes('sora')) {
    return { label: 'OpenAI', tone: 'openai', src: '/model-icons/openai.svg' };
  }
  if (normalized.includes('seedream') || normalized.includes('seededit') || normalized.includes('seedance') || normalized.includes('doubao') || normalized.includes('bytedance')) {
    return { label: 'ByteDance', tone: 'seed', src: '/model-icons/bytedance.svg' };
  }
  if (normalized.includes('senseaudio')) return { label: 'SA', tone: 'sense' };
  if (normalized.includes('grok') || normalized.includes('xai') || normalized.includes('xai/')) {
    return { label: 'xAI', tone: 'grok', src: '/model-icons/x.svg' };
  }
  if (normalized.includes('gemini') || normalized.includes('imagen') || normalized.includes('veo') || normalized.includes('google') || normalized.includes('nano-banana')) {
    return { label: 'Google Gemini', tone: 'google', src: '/model-icons/google-gemini.svg' };
  }
  if (normalized.includes('flux') || normalized.includes('bfl') || normalized.includes('black-forest')) {
    return { label: 'FLUX', tone: 'flux', src: '/model-icons/flux.svg' };
  }
  if (normalized.includes('openrouter')) return { label: 'OpenRouter', tone: 'router', src: '/model-icons/openrouter.svg' };
  if (normalized.includes('imagerouter') || normalized.includes('/')) return { label: 'IR', tone: 'router' };
  if (normalized.includes('eleven')) {
    return { label: 'ElevenLabs', tone: 'elevenlabs', src: '/model-icons/elevenlabs.svg' };
  }
  if (normalized.includes('fish')) {
    return { label: 'Fish Audio', tone: 'fishaudio', src: '/model-icons/fishaudio.svg' };
  }
  if (normalized.includes('minimax')) {
    return { label: 'MiniMax', tone: 'minimax', src: '/model-icons/minimax.svg' };
  }
  if (normalized.includes('suno')) return { label: 'Suno', tone: 'suno', src: '/model-icons/suno.svg' };
  if (
    normalized.includes('udio') ||
    normalized.includes('audio') ||
    normalized.includes('voice')
  ) {
    return { label: modelInitials(label), tone: 'audio' };
  }
  return { label: modelInitials(label || value), tone: 'custom' };
}

function modelInitials(input: string): string {
  const cleaned = input
    .replace(/^[^a-z0-9]+/i, '')
    .replace(/^(gpt|model)[-_ ]*/i, '')
    .trim();
  const parts = cleaned.split(/[^a-z0-9]+/i).filter(Boolean);
  const initials = parts.length >= 2
    ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`
    : (parts[0] ?? cleaned).slice(0, 2);
  return initials.toUpperCase() || 'M';
}

function ratioOptionIcon(value: string): RatioOptionIconSpec {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
  const rawWidth = Number(match?.[1] ?? 1);
  const rawHeight = Number(match?.[2] ?? 1);
  const ratioWidth = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1;
  const ratioHeight = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1;
  const maxEdge = 17;
  const scale = maxEdge / Math.max(ratioWidth, ratioHeight);
  const width = Math.max(8, Math.round(ratioWidth * scale));
  const height = Math.max(8, Math.round(ratioHeight * scale));
  const normalized = `${ratioWidth}:${ratioHeight}`;
  const tone = (() => {
    if (normalized === '1:1') return 'square';
    if (normalized === '16:9') return 'wide';
    if (normalized === '9:16') return 'tall';
    if (normalized === '4:3') return 'standard';
    if (normalized === '3:4') return 'portrait';
    return ratioWidth > ratioHeight ? 'wide' : ratioHeight > ratioWidth ? 'tall' : 'custom';
  })();
  return { width, height, tone };
}

function optionLabelMap(field: InputFieldSpec): Record<string, string> {
  const labels = (field as { optionLabels?: unknown }).optionLabels;
  return labels && typeof labels === 'object' && !Array.isArray(labels)
    ? labels as Record<string, string>
    : {};
}

function stripHomeMentionToken(value: string, label: string): string {
  const token = inlineMentionToken(label);
  return value.replace(
    new RegExp(`(^|[\\s([{"'])${escapeRegExp(token)}(?=$|\\s|[.,;:!?)}\\]"'])([^\\S\\r\\n])?`, 'g'),
    '$1',
  );
}

function fileMatchesQuery(file: File, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [file.name, file.type || '']
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function pluginMatchesQuery(plugin: InstalledPluginRecord, query: string, locale: Locale): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    plugin.title,
    localizePluginTitle(locale, plugin),
    plugin.id,
    plugin.sourceKind,
    plugin.manifest?.description ?? '',
    localizePluginDescription(locale, plugin),
    ...(plugin.manifest?.tags ?? []),
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function skillMatchesQuery(skill: SkillSummary, query: string, locale: Locale): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    skill.id,
    skill.name,
    localizeSkillName(locale, skill),
    skill.description,
    localizeSkillDescription(locale, skill),
    skill.mode,
    skill.surface ?? '',
    ...skill.triggers,
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function mcpServerMatchesQuery(server: McpServerConfig, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    server.id,
    server.label ?? '',
    server.transport,
    server.url ?? '',
    server.command ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The staged-attachment band: one nowrap row of chips that scrolls sideways.
 * Once the chips outrun the card, the overflowing edge gets a mask in the
 * card's own fill with a paging button on top, so the row reads as "there is
 * more this way" instead of a chip silently sliced off at the border.
 */
function AttachmentBand({ ariaLabel, children }: { ariaLabel?: string; children: ReactNode }) {
  const t = useT();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      // 1px of slack: fractional scroll offsets (page zoom, trackpad momentum)
      // otherwise strand the arrow at either end of the track.
      const next =
        max > 1
          ? { start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 }
          : { start: false, end: false };
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // Staging a file grows the row's scrollWidth without touching the
    // scroller's own box, so ResizeObserver alone never fires — watch the
    // subtree for added/removed chips too. (`.home-hero__active-file-group` is
    // `display: contents`, so its chips are NOT direct children here.)
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(measure) : null;
    mo?.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, []);

  const page = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Just under a full viewport so the chip at the edge stays half in frame
    // and the jump reads as continuous.
    el.scrollBy({ left: direction * Math.max(120, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <div className="home-hero__active-band">
      <div className="home-hero__active" ref={scrollerRef} aria-label={ariaLabel}>
        {children}
      </div>
      {edges.start ? (
        <>
          <span className="home-hero__active-fade home-hero__active-fade--start" aria-hidden />
          <button
            type="button"
            className="home-hero__active-page home-hero__active-page--prev"
            data-testid="home-hero-attachments-prev"
            aria-label={t('homeHero.attachmentsScrollPrev')}
            onClick={() => page(-1)}
          >
            <Icon name="chevron-left" size={16} />
          </button>
        </>
      ) : null}
      {edges.end ? (
        <>
          <span className="home-hero__active-fade home-hero__active-fade--end" aria-hidden />
          <button
            type="button"
            className="home-hero__active-page home-hero__active-page--next"
            data-testid="home-hero-attachments-next"
            aria-label={t('homeHero.attachmentsScrollNext')}
            onClick={() => page(1)}
          >
            <Icon name="chevron-right" size={16} />
          </button>
        </>
      ) : null}
    </div>
  );
}
