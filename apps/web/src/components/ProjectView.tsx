import { PRODUCT_NAME } from '@openpixo/contracts';
import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { subscribeProjectComposerPrefill, takeProjectComposerPrefill } from '../state/composer-prefill';
import { useStartupReady } from '../observability/startup-ready';
import { EngineBadge } from './game/EngineBadge';
import { getOpenPixoHost } from '@openpixo/host';
import { markConversationSeen } from '../state/conversation-seen';
import { ProjectCheckpointHistory } from './checkpoints/ProjectCheckpointHistory';
import { useProjectCheckpoints } from './checkpoints/useProjectCheckpoints';
import { UndoLastTurnDialog } from './chat/UndoLastTurnDialog';
import { lastTurnFirstRunId } from '../runtime/chat/last-turn-run';
import { turnStartBaseline } from '../runtime/turn-baseline';
import type { ComposerSlashAction } from './ChatComposer';
import { navigationTiming, useProjectNavigationReady, observeNavigation } from '../observability/navigation-timing';
import { readRetriedErrorSurface, retriedErrorSurfaceKey, writeRetriedErrorSurface } from '../runtime/chat/retried-error-surface';


import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useLayoutEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';
import { AnimatePresence } from 'motion/react';
import { createHtmlArtifactManifest, inferLegacyManifest } from '../artifacts/manifest';
import { resolveHtmlPointerArtifactTarget } from '../artifacts/pointer';
import { validateHtmlArtifact } from '../artifacts/validate';
import { resolvePersistedArtifactHtml } from '../artifacts/recover';
import { createArtifactParser } from '../artifacts/parser';
import { useI18n } from '../i18n';
import { type DaemonAgentReconnectState, type DaemonAgentRetryState, type DaemonReconnectState, fetchChatRunStatus, GENERIC_DAEMON_DISCONNECT_CODE, GENERIC_DAEMON_DISCONNECT_MESSAGE, listActiveChatRuns, listProjectRuns, reattachDaemonRun, streamViaDaemon } from '../providers/daemon';
import {
  type ChatReconnectSignal,
  type ChatReconnectView,
  MANUAL_RECONNECT_FEEDBACK_MS,
  nextChatReconnectView,
  reconnectViewForConversation,
  settledSignalFromMessages,
} from '../runtime/chat/reconnect-state';
import { forkBoundaryMessageIndex } from '../runtime/chat/fork-boundary';
import { assistantMessageNeverHadARun } from '../runtime/chat/host-authored-message';
import {
  artifactBaseNameFor,
  artifactExtensionFor,
  artifactFromRecoverableSourceText,
  artifactWithHtml,
  attributableRunFiles,
  chooseArtifactToPersist,
  computeProducedFiles,
  computeTraceObjectFiles,
  filterProjectFilesByMinMtime,
  finalizeTurn,
  provenProjectRelativeToolPath,
  resolveAgentTouchedFileNames,
  TURN_POLICIES,
  type TurnPorts,
} from '../runtime/chat/turn-finalizer';
import { resolveRecoveryActionBlockReason } from '../runtime/chat/recovery-gating';
import { listNamesConversation, routedConversationVerdict } from '../runtime/chat/routed-conversation';
import { loadConversationTranscript } from '../state/load-conversation-transcript';
import { nativeCodexProviderForConfig } from '@openpixo/contracts';
import type { ProjectCheckpoint, RewindConversationResponse } from '@openpixo/contracts';
import { ConversationRewindError, rewindConversation, type EditUserMessageOutcome } from '../state/conversation-rewind';
import {
  fetchProjectFiles,
  fetchProjectFileText,
  invalidateProjectFilesCache,
  writeProjectTextFile,
} from '../providers/registry';
import { useProjectFileEvents, type ProjectEvent } from '../providers/project-events';
import { claimProjectTurnIndex, claimRunTurnIndex } from '../analytics/identity';
import {
  buildInitialTaskAnalytics,
  buildRecoveryTaskAnalytics,
  runAgentProviderId,
} from '../analytics/run-task';
import { useCoalescedCallback } from '../hooks/useCoalescedCallback';
import { useProjectTitle } from '../hooks/useProjectTitle';

import { isTodoWriteToolName, type ByokChatProviderConfig, type ByokMediaDefaults, type ByokChatProtocol, type ChatTaskExecutionAnalytics } from '@openpixo/contracts';
import { anonymizeArtifactId, artifactKindToTracking, byokProtocolToTracking, executionModeToTracking, projectKindFromMetadataToTracking, projectKindFromMetadataToTrackingOrLegacyDefault, sessionModeToTracking } from '@openpixo/contracts/analytics';
import type {
  TrackingArtifactKind,
  TrackingConversationForkErrorCode,
  TrackingConversationForkPoint,
  TrackingRunRecoveryActionType,
} from '@openpixo/contracts/analytics';
import { useAnalytics } from '../analytics/provider';
import {
  trackByokPreflightBlocked,
  trackComposerBarClick,
  trackConversationForkClick,
  trackConversationForkResult,
  trackPageView,
  trackRunRecoveryActionClick,
  trackRunStartBlockedSurfaceView,
} from '../analytics/events';
import { byokPreflightBlockReason } from './byok/preflight';
import { navigate } from '../router';
import { agentModelDisplayName } from '../utils/agentLabels';
import { isMacPlatform } from '../utils/platform';
import {
  canAutoRenameProjectFromPrompt,
  summarizeProjectNameFromPrompt,
} from '../utils/projectName';
import {
  apiProtocolModelLabel,
  usesAnthropicProxy,
} from '../utils/apiProtocol';
import { playSound, showCompletionNotification } from '../utils/notifications';
import { randomUUID } from '../utils/uuid';
import { DEFAULT_NOTIFICATIONS, KNOWN_PROVIDERS } from '../state/config';
import type { TodoItem } from '../runtime/todos';

import {
  appendErrorStatusEvent,
  removeErrorStatusEvent,
  runFailureFieldsFromError,
  stderrTailFromError,
} from '../runtime/chat-events';
import type { RunFailureClassificationFields } from '../runtime/chat-events';
import {
  BYOK_CODEX_UNAVAILABLE_CODE,
  BYOK_OPENCODE_UNAVAILABLE_CODE,
  isByokRuntimeRefusal,
} from '../runtime/failure-guidance';
import {
  designDeliveryReconciliationStale,
  designDeliveryVerificationPending,
  isRetryableAssistantTerminalFailure,
  resolveDesignDeliveryOutcome,
  type DesignDeliveryOutcome,
} from '../runtime/design-delivery';
import { notifyArtifactDelivered } from './experience-survey-trigger';
import { RESUME_CONTINUE_PROMPT } from '../runtime/resume';


import { markHistoryReplayLanded } from './chat/useCharReveal';




import { createConversation, deleteConversation as deleteConversationApi, duplicatePluginAsProject, fetchAppliedPluginSnapshot, installGeneratedPluginFolder, listConversations, listMessages, loadTabs, patchConversation, patchProject, ProjectConversationsHttpError, saveMessage, startGeneratedPluginShareTask, cacheTabsLocally, persistTabsToDaemonNow, listPlugins, type SaveMessageOptions, waitGeneratedPluginShareTask } from '../state/projects';
import type {
  AppliedPluginSnapshot,
  ChatAnalyticsEntryFrom,
  ChatSessionMode,
  InstalledPluginRecord,
  RunContextSelection,
  WorkspaceContextItem,
} from '@openpixo/contracts';
import type {
  AgentEvent,
  AgentInfo,
  AppConfig,
  Artifact,
  ChatAttachment,
  ChatMessage,
  ChatMessageFeedbackChange,
  Conversation,
  OpenTabsState,
  Project,
  ProjectMetadata,
  ProjectFile,
  SkillSummary,
} from '../types';
import { historyWithApiAttachmentContext } from '../api-attachment-context';
import { InlineModelSwitcher } from './InlineModelSwitcher';
import { AgentImageModelChip } from './agent-image-model/AgentImageModelPicker';
import { Icon } from './Icon';
import { ConversationHead } from './workspace/ConversationHead';
import { localizePluginTitle } from './plugins-home/localization';


import {
  ProjectPreviewProvider,
  type ProjectPreviewContextValue,
  type ProjectResourceAuthority,
} from './project-preview-context';
import { PluginDetailsModal } from './PluginDetailsModal';
import { ChatPane } from './ChatPane';
import { GameSetupDialog } from './project-start/GameSetupDialog';
import { closeSetupGate, newGameNeedsSetup, setupGateClosed } from './new-game/setup-routing';

import historyDockStyles from './chat/ConversationHistoryDock.module.css';
import type { ChatSendMeta, ChatSendOutcome } from './ChatComposer';
import { useIframeKeepAlivePool } from './IframeKeepAlivePool';
import { invalidateHtmlSourceSnapshotProject } from './html-source-snapshot-cache';
import {
  decideAgentFocusOpen,
  decideAutoOpenAfterWrite,
  selectAutoOpenProducedArtifact,
  selectAutoOpenTurnArtifact,
} from './auto-open-file';
import { collectReferencedJsxNames } from '../runtime/jsx-module-refs';
import {
  FileWorkspace,
  type FileRefreshResult,
} from './FileWorkspace';
import {
  type PluginFolderAgentAction,
} from './files/pluginFolderActions';
import { CenteredLoader } from './Loading';
import { useCreationHandoffMessages } from './useCreationHandoffMessages';
import { FALLBACK_MAX_CHAT_PANEL_WIDTH, MIN_CHAT_PANEL_WIDTH, MIN_WORKSPACE_PANEL_WIDTH, clampChatPanelWidth, clampPreferredChatPanelWidth, projectSplitClassName, projectSplitStyle, readSavedChatPanelWidth, readStoredPanelHidden, resolveProjectSplitLayout, saveChatPanelWidth, workspacePanelTrackForMinWidth, writeProjectSplitLayout, writeStoredPanelHidden } from './project-split-layout';
import type { SettingsSection } from './SettingsDialog';
import { Toast } from './Toast';
import { useDesignMdState } from '../hooks/useDesignMdState';
import {
  useProjectDetail,
  type ProjectDetailSeed,
} from '../hooks/useProjectDetail';
import { useTerminalLaunch } from '../hooks/useTerminalLaunch';
import { createBoundedConcurrency } from '../lib/bounded-concurrency';
import { buildContinueInCliToast } from '../lib/build-continue-in-cli-toast';
import { buildClipboardPrompt } from '../lib/build-clipboard-prompt';
import { copyToClipboard } from '../lib/copy-to-clipboard';
import {
  dismissHomeAttachmentUpload,
  homeAttachmentUploadsFor,
  subscribeHomeAttachmentUploads,
} from '../state/home-attachment-handoff';
import { conversationAgentConfig, latestConversationRun, selectedAssistantIdentity as resolveSelectedAssistantIdentity } from './agentModelSelection';
import { mediaExecutionPolicyForProjectMetadata } from '../media/execution-policy';
import { mediaModelProviderId } from '../media/models';
import { byokProviderRequiresApiKey } from '../utils/byokProvider';
import {
  useByokImageModelOptions,
  useByokVideoModelOptions,
  useByokSpeechModelOptions,
} from '../media/aihubmix-image-models';

type ProjectChatSendMeta = ChatSendMeta & {
  /** Stable persisted row ids for a replayable handoff such as Home auto-send. */
  userMessageId?: string;
  assistantMessageId?: string;
  queueOnly?: boolean;
  retryOfAssistantId?: string;
  sessionMode?: ChatSessionMode;
  /** Overrides the run_created / run_finished `entry_from` analytics prop for
   *  this send (e.g. 'resume_continue' from the resumable-failure Continue
   *  action). Behavior never depends on it; it only shapes PostHog props. */
  entryFrom?: ChatAnalyticsEntryFrom;
  /** Marks this send as the AI-optimize (deep enrichment) run so the daemon
   *  can emit design_system_enrich_result + flag the DS as ai_refined on
   *  success (tracking spec C14/C15). Daemon mode only. */
  dsEnrichment?: boolean;
  /** Marks a send replayed from the queued-sends drain. Its payload already
   *  lives in the queue item, so a pre-run block
   *  must NOT re-queue it — only pause further drains. */
  queueDrain?: boolean;
  /** The OpenPixo Cloud balance gate already ran for this exact send at
   *  the home submit (with any soft warning answered there); skip re-gating
   *  so the user is never double-prompted for one task. */

  /** The caller owns a payload that must be consumed exactly once — the Home
   *  handoff's separately persisted prompt, an inline question form's single
   *  answer. Once the payload is durably parked in this view's queue, report
   *  it as accepted so the caller releases it instead of offering a second
   *  copy that the queue drain would then send twice. This flag is
   *  transport-only and is stripped before queue persistence. */
  acceptDurableQueue?: boolean;
  /**
   * 这一发的正文**此刻属于输入框**,而且输入框正等着知道要不要把它收回去。
   *
   * 只有 `handleComposerSend` 打这个标记。它是 OPEND-2719 那条「余额耗尽不代管、
   * 把正文还给输入框」的**唯一**入场券:`handleSend` 还有十来个直接调用方
   * (分享到社区、设计系统反馈、继续未完成任务、续跑、问答表单、首页自动发送、
   * 重发失败的用户消息……),它们的正文不在输入框里,用户也没在等着编辑它 ——
   * 对它们「不代管」等于悄悄取消了排队。
   *
   * ⚠️ 判据必须是**肯定式**。原来写成「不是重试、不是排空队列 ⇒ 就是输入框」,
   * 而那份排除法把上面那十来个调用方全算成了输入框(PR #7927 评审)。
   *
   * ⚠️ 和 `acceptDurableQueue` 同类:**transport-only**,由
   * `stripQueueOnlyFromMeta` 在入队前摘掉。一条排过队的输入框消息,它的正文已经
   * 交给队列项保管了,回放时再声称「输入框在等它」就是撒谎。
   */
  composerOwnedDraft?: true;
  /** Stable task lineage for retries, resumes and clarification answers. */
  taskAnalytics?: ChatTaskExecutionAnalytics;
};


function conversationForkErrorCode(error: unknown): TrackingConversationForkErrorCode {
  if (error instanceof ProjectConversationsHttpError) {
    if (error.status === 400) return 'bad_request';
    if (error.status === 401 || error.status === 403) return 'permission_denied';
    if (error.status === 404) return 'fork_source_not_found';
    if (error.status === 413) return 'payload_too_large';
    if (error.status >= 500) return 'server_error';
    return 'http_error';
  }
  if (error instanceof TypeError) return 'network_error';
  return 'unknown_error';
}

function conversationForkPoint(
  messages: ChatMessage[],
  assistantMessageId: string,
  forkIndex: number,
): TrackingConversationForkPoint {
  if (forkIndex < 0) return 'unknown';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    return message.id === assistantMessageId ? 'latest' : 'historical';
  }
  return 'unknown';
}

export async function listConversationsWithRetry(
  projectId: string,
): Promise<Conversation[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= CONVERSATION_LOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await listConversations(projectId, { throwOnError: true });
    } catch (err) {
      lastError = err;
      // A shared project may be visible in the catalog just before its local
      // conversation materialization completes. Only that transient 404 earns
      // the bounded retry window; auth/permission/request failures are settled
      // and retrying them merely leaves the entire project in a loading state.

        throw err;


    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Could not load conversations for this project.');
}

/** Keep a live thinking suffix when an older snapshot has the same event count. */
function localThinkingExtendsServerSnapshot(server: ChatMessage, local: ChatMessage): boolean {
  if (!server.runId || server.runId !== local.runId || !isActiveRunStatus(server.runStatus)) {
    return false;
  }
  const serverEvents = server.events ?? [];
  const localEvents = local.events ?? [];
  if (serverEvents.length === 0 || serverEvents.length !== localEvents.length) return false;
  const lastIndex = serverEvents.length - 1;
  const serverTail = serverEvents[lastIndex];
  const localTail = localEvents[lastIndex];
  if (
    serverTail?.kind !== 'thinking'
    || localTail?.kind !== 'thinking'
    || localTail.text.length <= serverTail.text.length
    || !localTail.text.startsWith(serverTail.text)
  ) return false;
  return serverEvents.slice(0, lastIndex).every((event, index) =>
    JSON.stringify(event) === JSON.stringify(localEvents[index]),
  );
}

function mergeServerMessageWithLocal(
  server: ChatMessage,
  local?: ChatMessage,
  locallyStreaming = false,
): ChatMessage {
  if (!local) return server;
  const merged: ChatMessage = { ...server };
  if (local.role === 'assistant' && server.role === 'assistant') {
    if ((local.content?.length ?? 0) > (server.content?.length ?? 0)) {
      merged.content = local.content;
    }
    if ((local.events?.length ?? 0) > (server.events?.length ?? 0)
      || localThinkingExtendsServerSnapshot(server, local)) {
      merged.events = local.events;
    }
  }
  // A live task can reuse this row for a successor Run. Once the server
  // restores the row's physical Run, successor files must not be saved under
  // that restored identity. Same-Run late files (and legacy rows without Run
  // identity) still need the ordinary freshness fallback.
  const producedFilesBelongToAnotherRun = Boolean(
    server.runId && local.runId && server.runId !== local.runId,
  );
  if (
    !producedFilesBelongToAnotherRun
    && !server.producedFiles?.length
    && local.producedFiles?.length
  ) {
    merged.producedFiles = local.producedFiles;
  }
  if (!server.preTurnFileNames?.length && local.preTurnFileNames?.length) {
    merged.preTurnFileNames = local.preTurnFileNames;
  }
  if (!server.lastRunEventId && local.lastRunEventId) {
    merged.lastRunEventId = local.lastRunEventId;
  }
  if (
    locallyStreaming
    && local.role === 'assistant' && server.role === 'assistant'
    && local.runId && local.runId === server.runId
  ) {
    // A live stream owns its transcript until its controller releases it.
    // A GET can be ahead of both the SSE reader and its pending text buffer;
    // accepting that text here would append the same frames again on flush.
    // Keep the event cursor with the transcript, without deduplicating prose.
    merged.content = local.content;
    merged.events = local.events;
    merged.lastRunEventId = local.lastRunEventId;
  }
  if (!server.startedAt && local.startedAt) {
    merged.startedAt = local.startedAt;
  }
  if (!server.endedAt && local.endedAt) {
    merged.endedAt = local.endedAt;
  }
  if (!server.runStatus && local.runStatus) {
    merged.runStatus = local.runStatus;
  }
  // Feedback is written through a best-effort PUT after the button updates
  // the local message. A run-completion refresh can race that PUT and return
  // the previous server snapshot; blindly accepting it makes the selected
  // thumb (and the reason panel after submit) visibly snap back until reload.
  // Both copies carry the client-issued feedback timestamp, so keep the newer
  // one just like we already keep fresher streamed content/events above.
  if (
    local.feedback
    && (
      !server.feedback
      || (local.feedback.updatedAt ?? local.feedback.createdAt)
        > (server.feedback.updatedAt ?? server.feedback.createdAt)
    )
  ) {
    merged.feedback = local.feedback;
  }
  return merged;
}

export function mergeServerMessagesIntoConversation(
  current: ChatMessage[],
  serverMessages: ChatMessage[],
  options: { liveAssistantMessageIds?: ReadonlySet<string> } = {},
): ChatMessage[] {
  const currentById = new Map(current.map((message) => [message.id, message]));
  const serverIds = new Set(serverMessages.map((message) => message.id));
  const merged = serverMessages.map((message) =>
    mergeServerMessageWithLocal(
      message,
      currentById.get(message.id),
      options.liveAssistantMessageIds?.has(message.id) === true,
    ),
  );
  for (const message of current) {
    if (!serverIds.has(message.id)) merged.push(message);
  }
  return normalizeConversationMessageOrder(merged);
}

export function normalizeConversationMessageOrder(messages: ChatMessage[]): ChatMessage[] {
  let normalized: ChatMessage[] | null = null;
  for (let index = 0; index < messages.length - 1; index += 1) {
    const assistant = (normalized ?? messages)[index];
    const user = (normalized ?? messages)[index + 1];
    if (
      assistant?.role !== 'assistant'
      || user?.role !== 'user'
      || typeof assistant.runId !== 'string'
      || assistant.runId.length === 0
      || typeof assistant.startedAt !== 'number'
      || typeof user.createdAt !== 'number'
      || assistant.startedAt !== user.createdAt
    ) {
      continue;
    }
    // POST /api/runs pins the assistant synchronously. Older clients persisted
    // the matching user row through a separate best-effort PUT, so the two
    // requests could land in the opposite order. The identical turn-start
    // timestamp is a narrow positive witness; unrelated assistant/user pairs
    // keep their server position.
    normalized ??= [...messages];
    normalized[index] = user;
    normalized[index + 1] = assistant;
    index += 1;
  }
  return normalized ?? messages;
}


interface Props {
  project: Project;
  /**
   * Exact project-bound Workspace authority resolved by the route gate.
   * Production deep links pass this instead of borrowing the shell's mutable
   * current/default Workspace. Tests and legacy embedded callers may omit it
   * and retain the existing provider behavior.
   */

  /** Fresh route-bootstrap witnesses, reused to avoid repeating scope/detail reads. */

  initialProjectDetail?: ProjectDetailSeed | null;
  /** Lifetime of asynchronous project reads. */
  projectAuthorizationKey?: string;


  routeFileName: string | null;
  /**
   * Routed conversation id. When set (the URL is
   * `/projects/:id/conversations/:cid[/...]`), the project view picks
   * this conversation as active instead of defaulting to `list[0]`.
   * Falls through to the default picker if the conversation does not
   * exist (e.g. the run was deleted between the route landing and the
   * conversation list loading). Issue #1505. Optional so existing
   * test harnesses that mount ProjectView with a stub props bag do
   * not have to be updated; production callers in `App.tsx` always
   * pass the value from `useRoute()`.
   */
  routeConversationId?: string | null;
  config: AppConfig;
  agents: AgentInfo[];
  // Mentionable functional skills — already filtered by config.disabledSkills
  // upstream, so this drives only the chat composer's @-picker scope. For
  // resolving an existing project's `skillId` (which can also point at a
  // design template after the skills/design-templates split), use
  // `designTemplates` as a fallback in the skill-name / skill-mode lookups
  // below.
  skills: SkillSummary[];
  // All known design templates (unfiltered). Required so projects created
  // from the Templates surface keep composing the template body in API
  // mode even when the user later disables the template in Settings.
  designTemplates: SkillSummary[];
  daemonLive: boolean;
  onModeChange: (mode: AppConfig['mode']) => void;
  onAgentChange: (id: string) => void;
  pendingAgentSelection?: { projectId: string; conversationId: string | null; agentId: string } | null;
  onAgentSelectionConsumed?: () => void;
  /** Resolves only after the App configuration owner has persisted Cloud. */

  onAgentModelChange: (
    id: string,
    choice: { model?: string; reasoning?: string; serviceTier?: string },
  ) => void;
  onApiModelChange?: (model: string) => void;
  onRefreshAgents: () => void;
  onOpenSettings: (section?: SettingsSection) => void;

  onOpenMcpSettings?: () => void;
  onBrowsePlugins?: () => void;
  onBack: () => void;
  onClearPendingPrompt: () => void;
  onTouchProject: () => void;
  onProjectChange: (next: Project) => void;
  /** Rename fences from the era of the inline title rename in the chat card.
   *  The card no longer renders a title (OPEND-3128: the project is named once,
   *  in the switcher, whose row menu renames through App's own projection
   *  fence), so this view invokes neither; the props stay for App's wiring
   *  until that plumbing is retired. */
  onProjectRenameStarted?: (optimistic: Project) => ProjectRenameFenceToken | null;
  onProjectRenameSettled?: (
    token: ProjectRenameFenceToken | null,
    confirmed: Project,
  ) => void;
  onProjectsRefresh: () => void;
  onDeleteProject?: (id: string) => Promise<boolean> | boolean;
  onDuplicateProject?: (
    sourceProjectId: string,
    input?: { name?: string },
  ) => Promise<void> | void;
  /**
   * The Home send this project was just created from (OPEND-3334). App mounts
   * this view on the click, before `POST /api/projects` answers, and keeps
   * the record until the first transcript settles (OPEND-2170):
   *
   * - `persisted: false` — the project row does not exist on the daemon yet.
   *   Every project read is held ({@link projectReadsHeldForCreation}); the
   *   view draws only what this tab already knows.
   * - `conversationId` — the seed conversation's id, minted with the project
   *   id, so the chat pane is keyed by its final conversation from the first
   *   frame and never re-keys when the conversation list answers.
   * - `prompt` / `files` — the optimistic first turn, drawn under the ids the
   *   auto-send will use, so the real turn takes over the same rows.
   *
   * App clears it on `onCreationHandoffSettled`.
   */
  creationHandoff?: {
    prompt: string;
    files?: readonly File[];
    conversationId?: string | null;
    persisted: boolean;
  } | null;
  /** The first transcript is on screen (or failed to load): drop the card. */
  onCreationHandoffSettled?: (projectId: string) => void;
}

export type ProjectRenameFenceToken = Readonly<{
  accountGeneration: number;
  scopeKey: string;
  projectId: string;
  mutationVersion: number;
}>;

interface QueuedChatSend {
  id: string;
  conversationId: string;
  prompt: string;
  attachments: ChatAttachment[];
  meta?: ProjectChatSendMeta;
  createdAt: number;
}

interface QueuedChatSendUpdate {
  prompt: string;
  attachments: ChatAttachment[];
  meta?: ProjectChatSendMeta;
}

// Split geometry lives in `project-split-layout.ts` (shared with the
// creation frame, OPEND-3207); re-exported here for existing importers.
export {
  defaultChatPanelWidthForSplit,
  projectSplitClassName,
  projectSplitStyle,
} from './project-split-layout';
// Turn attribution lives in `runtime/chat/turn-finalizer.ts`; re-exported here
// for existing importers.
export {
  computeProducedFiles,
  computeTraceObjectFiles,
  findExistingArtifactProjectFile,
  findExistingNonHtmlArtifactProjectFile,
  findSameTurnHtmlWriteForRecoveredArtifact,
  findSameTurnNonHtmlWriteForRecoveredArtifact,
  mergeRecoveredArtifact,
  mergeRecoveredTraceObjectFile,
  resolveAgentTouchedFileNames,
} from '../runtime/chat/turn-finalizer';
// The brand-extraction project's design-system (brand kit) preview tab. Mirrors
// the daemon `BRAND_KIT_FILE` (apps/daemon/src/brands/kit-render.ts); kept as a
// local literal to respect the web↔daemon boundary.


const BYOK_PROVIDER_REQUIRED_MESSAGE =
  'BYOK requires a provider, API key, and model. Complete BYOK settings before starting a run.';
const BEDROCK_BYOK_UNSUPPORTED_MESSAGE =
  'AWS Bedrock BYOK chat requires AWS credential signing and is not supported by the current API-key proxy.';
const CHAT_PANEL_KEYBOARD_STEP = 16;
// A just-created local project may not be readable yet. Bound retries so a
// genuinely missing project's conversation list still surfaces an error.
const CONVERSATION_LOAD_RETRY_DELAYS_MS = [
  120, 300, 600, 1000, 1500, 2000, 2500, 3500,
] as const;
type ConversationMaterializationRecovery = {
  projectId: string;
  authorityKey: string;
  generation: number;

  errorMessage: string;
};
export function reconcileConversationRecoveryGlobalError(
  current: string | null,
  previousConversationError: string,
  nextConversationError: string,
): string {
  return current === null || current === previousConversationError
    ? nextConversationError
    : current;
}
export function createConversationMaterializationGenerationController() {
  let current = 0;
  return {
    begin(): number {
      current += 1;
      return current;
    },
    invalidate(generation: number): void {
      if (current === generation) current += 1;
    },
    isCurrent(generation: number): boolean {
      return current === generation;
    },
  };
}
// Trailing-debounce window for the canonical (daemon + SQLite) tab-state write.
// Embedded-browser navigation bursts settle well within this; the local cache
// is written immediately so nothing is lost if the daemon write is coalesced.
const TAB_PERSIST_DEBOUNCE_MS = 400;
// The generic browser-side SSE reconnect-budget exhaustion message emitted by
// consumeDaemonRun when the daemon status fetch still shows the run as
// queued/running (providers/daemon.ts).  Both the live-stream onError and the
// reattach-stream onError share this message; neither constitutes an
// authoritative terminal failure.  Use isGenericDaemonDisconnect() at both
// sites so generic disconnects stay eligible for attachRecoverableRuns to
// re-query daemon authoritative status on the next tick.
function isGenericDaemonDisconnect(err: unknown): boolean {
  return err instanceof Error && (
    (err as Error & { code?: string }).code === GENERIC_DAEMON_DISCONNECT_CODE ||
    err.message === GENERIC_DAEMON_DISCONNECT_MESSAGE
  );
}

// The refusal for a BYOK send whose local runtime is not detected. The failure
// card reads the code; the message only travels on the error event into the
// diagnostics export.
function byokRuntimeRefusal(
  runsOnCodex: boolean,
  t: ReturnType<typeof useI18n>['t'],
): Error {
  return Object.assign(
    new Error(t(
      runsOnCodex
        ? 'chat.runError.byokCodexUnavailableMessage'
        : 'chat.runError.byokOpencodeUnavailableMessage',
    )),
    { code: runsOnCodex ? BYOK_CODEX_UNAVAILABLE_CODE : BYOK_OPENCODE_UNAVAILABLE_CODE },
  );
}

// A persisted status/error event represents a generic daemon disconnect when
// either its structured `code` matches GENERIC_DAEMON_DISCONNECT_CODE, OR
// (legacy rows persisted before this code was introduced) its `detail`
// equals the canonical GENERIC_DAEMON_DISCONNECT_MESSAGE with no code set.
// Mirrors isGenericDaemonDisconnect() above, which checks the equivalent
// code-or-message pair on live Error objects for the same reason.
function hasGenericDisconnectFailureEvent(message: ChatMessage): boolean {
  return (message.events ?? []).some(
    (event) =>
      event.kind === 'status' &&
      event.label === 'error' &&
      (event.code === GENERIC_DAEMON_DISCONNECT_CODE ||
        event.detail === GENERIC_DAEMON_DISCONNECT_MESSAGE),
  );
}

/**
 * 从重挂的流里回放出来的状态帧,能不能改这条消息的状态。
 *
 * **不变量:daemon 已经对这条 run 给出终态裁定之后,同一条 run 回放出来的「活着」
 * 信号只是历史,不许把这一轮改回进行中。**
 *
 * 订阅之前客户端刚问过 `/api/runs/:id`。拿到终态之后仍然会去订阅(`recoverableGenericDisconnectFailed`
 * 这类路径要靠重放补回正文与产物),而 daemon 重放的是这条 run 的**完整事件日志** ——
 * 里面有它当初的 `start` 帧,`providers/daemon.ts` 收到 `start` 就发 `running`。
 * 那一帧描述的是「这条 run 当时启动了」,不是「它现在活着」。
 *
 * 让它落地的后果(真机会话 64acc867 / 消息 b7b61e19,DB 与 API 都写着 failed):
 *  · `isAssistantMessageStreaming` 看到 running 就提前返回 true,`AssistantMessage`
 *    把整轮的 `turnRunStatus` 钉成 running → 壳头「进行中」,耗时跟着 `nowMs` 永远涨
 *    (一条真实时长 20.7s 的 run 被画成 202 分钟);
 *  · `currentConversationAwaitingActiveRunAttach`(有活跃 run、又没在流)为真 → 发送禁用,
 *    而 `currentConversationControlStreaming` 为假 → 连停止按钮都没有。用户没有出路。
 *
 * run 的日志里没有 `end` 帧时(daemon 被重启打断,`terminalTrigger: "daemon_restart"`)
 * 这就是死结:再没有任何一帧能把它改回终态,刷新也解不开。
 *
 * 只挡**非终态**的帧。终态帧照常落地;daemon 的裁定本身不是终态(run 真的在跑)时
 * 整条判据关闭;流已经转到**另一条** run(strategy task 推进)时同样放行 ——
 * 那条 run 的死活与这份裁定无关。
 */
function replayedRunStatusMayLand(
  frameStatus: ChatMessage['runStatus'],
  terminalVerdict: ChatMessage['runStatus'] | null,
  frameBelongsToVerdictRun: boolean,
): boolean {
  if (!terminalVerdict) return true;
  if (!frameBelongsToVerdictRun) return true;
  return isTerminalRunStatus(frameStatus);
}

/**
 * How many REPLAY reattaches may hold a connection at the same time.
 *
 * Reopening a conversation whose messages all ended in a daemon disconnect
 * releases one reattach per message. Each one opens an SSE subscription, and
 * the browser gives an origin about six HTTP/1.1 connections for the entire
 * profile — shared with any other OpenPixo tab sitting in the background.
 * Firing the whole batch at once does not make the batch finish sooner; it
 * parks every other request the page still owes behind it.
 *
 * Two is deliberate rather than one: a replay is mostly connection setup plus
 * a finite event log, so a second in-flight replay keeps the pipe busy while
 * the first is being decoded, without approaching the connection budget.
 *
 * Module scope, not per-effect: the connection budget belongs to the tab, and
 * this effect re-runs on every `messages` change. A gate that was recreated
 * per run would let each re-run open its own pair.
 */
const REATTACH_REPLAY_CONCURRENCY = 2;
/**
 * A replay is a finite event log, so it settles — but a connection that dies
 * without closing does not. Cap how long one replay may hold its slot so a
 * wedged one can never stop the rest of the batch from reattaching at all;
 * exceeding the cap only means we stop counting it, never that we drop it.
 */
const REATTACH_REPLAY_MAX_HOLD_MS = 30_000;
const reattachReplayGate = createBoundedConcurrency(REATTACH_REPLAY_CONCURRENCY, {
  maxHoldMs: REATTACH_REPLAY_MAX_HOLD_MS,
});

function mergeChatAttachments(...groups: ChatAttachment[][]): ChatAttachment[] {
  const seen = new Set<string>();
  const out: ChatAttachment[] = [];
  for (const group of groups) {
    for (const attachment of group) {
      const path = attachment.path.trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push({ ...attachment, path });
    }
  }
  return out;
}

function historyWithWorkspaceContext(
  history: ChatMessage[],
  messageId: string,
  context: ChatSendMeta['context'] | undefined,
): ChatMessage[] {
  const items = context?.workspaceItems ?? [];
  if (items.length === 0) return history;
  const block = [
    '',
    '',
    '<active-workspace-context>',
    `${PRODUCT_NAME} selected or inferred these workspace contexts for this turn. Treat absolute paths as reference context unless the user explicitly asks to edit them.`,
    ...items.map((item, index) => {
      const details = [
        item.path ? `path: ${item.path}` : null,
        item.absolutePath ? `absolute: ${item.absolutePath}` : null,
        item.url ? `url: ${item.url}` : null,
        item.title ? `title: ${item.title}` : null,
        item.tabId ? `tab: ${item.tabId}` : null,
      ].filter(Boolean).join(' | ');
      return `${index + 1}. ${item.kind}: ${item.label}${details ? ` | ${details}` : ''}`;
    }),
    '</active-workspace-context>',
  ].join('\n');
  return history.map((message) =>
    message.id === messageId && message.role === 'user'
      ? { ...message, content: `${message.content}${block}` }
      : message,
  );
}

function autoSendFirstMessageKey(projectId: string): string {
  return `pixo:auto-send-first:${projectId}`;
}

function stableIdentityDigest(value: string): string {
  // FNV-1a 64-bit keeps the daemon-facing id bounded while preserving a
  // deterministic identity across retries and ProjectView remounts.
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36).padStart(13, '0');
}

/**
 * Whether this view's project resources are off limits: a Home send's project
 * whose create has not answered yet. Every project read waits on this.
 */
export function projectReadsHeldForCreation(
  creationHandoff: { persisted: boolean } | null | undefined,
): boolean {
  return Boolean(creationHandoff && !creationHandoff.persisted);
}

function homeAutoSendIdentity(projectId: string): Pick<
  ProjectChatSendMeta,
  'assistantMessageId' | 'clientRequestId' | 'userMessageId'
> {
  const handoffId = `home-auto-send-${stableIdentityDigest(projectId)}`;
  return {
    clientRequestId: handoffId,
    userMessageId: `${handoffId}-user`,
    assistantMessageId: `${handoffId}-assistant`,
  };
}

/**
 * A question form's answer is one payload with one identity.
 *
 * "At most one user answer message and one non-failed run per
 * sourceAssistantMessageId + formId" cannot be a property of the form's own
 * submit lock: a second tab, a reload in a context that denies storage, and a
 * queue replay all reach the host without that lock. Deriving the send's ids
 * from the occurrence makes the guarantee a property of the request, and every
 * layer that already dedupes on identity then enforces it for free — the
 * conversation queue keys entries on `clientRequestId`, the answer row keeps
 * one `userMessageId` instead of appending a second, and the daemon's
 * `createOrReuse` returns the first run rather than spawning another.
 *
 * A form rendered without a known occurrence (no source message, no form id)
 * keeps the per-send random identity it has always had.
 *
 * The row and the run are claimed by two different authorities, both of which
 * decide on this identity. `handleSend` persists the user row before the
 * daemon has answered, so the row's exactly-once cannot be decided here: the
 * write goes out `createOnly`, and the daemon — where the check and the write
 * are one operation — keeps the first accepted answer and returns it. The run
 * is claimed by `createOrReuse` on the same key. A later submitter therefore
 * adds neither a second answer nor a second run, and adopts the answer that
 * actually ran instead of displaying one no run ever saw.
 */
function questionFormAnswerIdentity(
  sourceAssistantMessageId: string | undefined,
  formId: string | undefined,
): Pick<ProjectChatSendMeta, 'clientRequestId' | 'userMessageId'> {
  if (!sourceAssistantMessageId || !formId) return {};
  const answerId = `qf-answer-${stableIdentityDigest(`${sourceAssistantMessageId}:${formId}`)}`;
  return { clientRequestId: answerId, userMessageId: `${answerId}-user` };
}

function autoSendPromptKey(projectId: string): string {
  return `pixo:auto-send-prompt:${projectId}`;
}

function autoSendAttachmentsKey(projectId: string): string {
  return `pixo:auto-send-attachments:${projectId}`;
}

function autoSendContextKey(projectId: string): string {
  return `pixo:auto-send-context:${projectId}`;
}



function readAutoSendAttachments(projectId: string): ChatAttachment[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(autoSendAttachmentsKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredChatAttachment);
  } catch {
    return [];
  }
}

function readAutoSendPrompt(projectId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(autoSendPromptKey(projectId));
  } catch {
    return null;
  }
}

function readAutoSendContext(projectId: string): RunContextSelection | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(autoSendContextKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isStoredRunContextSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}


function clearAutoSendSession(projectId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(autoSendFirstMessageKey(projectId));
    window.sessionStorage.removeItem(autoSendPromptKey(projectId));
    window.sessionStorage.removeItem(autoSendAttachmentsKey(projectId));
    window.sessionStorage.removeItem(autoSendContextKey(projectId));


  } catch {
    /* ignore */
  }
}

function isStoredChatAttachment(value: unknown): value is ChatAttachment {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === 'string' &&
    record.path.length > 0 &&
    typeof record.name === 'string' &&
    record.name.length > 0 &&
    (record.kind === 'image' || record.kind === 'file') &&
    (record.size === undefined || typeof record.size === 'number') &&
    (record.order === undefined || typeof record.order === 'number')
  );
}

function isStoredStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStoredWorkspaceContextItem(value: unknown): value is WorkspaceContextItem {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.kind === 'string' &&
    record.kind.length > 0 &&
    typeof record.label === 'string' &&
    record.label.length > 0 &&
    (record.tabId === undefined || typeof record.tabId === 'string') &&
    (record.path === undefined || typeof record.path === 'string') &&
    (record.absolutePath === undefined || typeof record.absolutePath === 'string') &&
    (record.url === undefined || typeof record.url === 'string') &&
    (record.title === undefined || typeof record.title === 'string')
  );
}

function isStoredRunContextSelection(value: unknown): value is RunContextSelection {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.skillIds === undefined || isStoredStringArray(record.skillIds)) &&
    (record.pluginIds === undefined || isStoredStringArray(record.pluginIds)) &&
    (record.mcpServerIds === undefined || isStoredStringArray(record.mcpServerIds)) &&
    (record.connectorIds === undefined || isStoredStringArray(record.connectorIds)) &&
    (
      record.workspaceItems === undefined ||
      (Array.isArray(record.workspaceItems) &&
        record.workspaceItems.every(isStoredWorkspaceContextItem))
    )
  );
}


function workspaceContextItemEqual(
  a: WorkspaceContextItem | null,
  b: WorkspaceContextItem | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.label === b.label &&
    (a.tabId ?? '') === (b.tabId ?? '') &&
    (a.path ?? '') === (b.path ?? '') &&
    (a.absolutePath ?? '') === (b.absolutePath ?? '') &&
    (a.url ?? '') === (b.url ?? '') &&
    (a.title ?? '') === (b.title ?? '')
  );
}

function workspaceContextItemsEqual(
  a: WorkspaceContextItem[],
  b: WorkspaceContextItem[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, index) => workspaceContextItemEqual(item, b[index] ?? null));
}

function projectFileContentSnapshotsEqual(
  a: ProjectFile[],
  b: ProjectFile[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const byPath = new Map(a.map((file) => [file.path ?? file.name, file]));
  return b.every((file) => {
    const previous = byPath.get(file.path ?? file.name);
    return previous != null
      && previous.name === file.name
      && previous.path === file.path
      && previous.type === file.type
      && previous.size === file.size
      && previous.mtime === file.mtime
      && previous.kind === file.kind
      && previous.mime === file.mime;
  });
}


/**
 * B11 —— 「当前 agent 不支持中途插话」什么时候才**说得通**。
 *
 * 这句话是对「队列里那颗为什么不是『引导对话』」的解释,而「引导」只有在
 * **有一轮正在跑**的时候才存在。一轮都没在跑、队列纯粹排着等的时候,没有任何
 * 东西可以插话:那颗按钮就是普通的「立即发送」,不打断任何东西 —— 这时候再解释
 * 「不支持中途插话」,是在回答一个没人问的问题。
 */
export function shouldExplainMidTurnSteeringUnsupported(input: {
  steerableRunId: string | null;
  agentSupportsSteering: boolean;
}): boolean {
  return Boolean(input.steerableRunId) && !input.agentSupportsSteering;
}

// React key for the on-screen question form. Deliberately does NOT include the
// form's parsed `id`: there is at most one (first) form per assistant message,
// so `${conversation}:${message}` is already a stable, unique identity for the
// occurrence. Folding the parsed id in would remount the panel mid-stream — the
// preview shows the `discovery` fallback until the body `id` streams in, and a
// form that emits answerable questions before its `id` would flip identity
// while the user is mid-answer, dropping their selections. A distinct later
// form lives in a different assistant message, so it still gets its own key
// (and replays the reveal) without relying on the id.
export function buildQuestionFormKey(
  conversationId: string | null,
  assistantMessageId: string | null,
  hasForm: boolean,
): string | null {
  return conversationId && assistantMessageId && hasForm
    ? `${conversationId}:${assistantMessageId}`
    : null;
}

// The split's three grid custom properties are written directly (see
// `writeProjectSplitLayout` and the `@property` registrations + `.split` /
// `.split.split-focus` transition rules in shell.css) instead of composing a
// `gridTemplateColumns` string, so a collapse/expand or a live resize is a
// plain custom-property write.
function applySplitChatPanelWidth(
  split: HTMLDivElement | null,
  width: number,
  workspacePanelTrack: string,
  workspaceFocused: boolean,
  options: { animate?: boolean } = {},
): void {
  if (!split) return;
  if (workspaceFocused) {
    // Workspace-focused mode collapses the chat column through the
    // `.split-focus` CSS class alone (see `projectSplitStyle`, which
    // deliberately returns no inline style while focused). A resize firing
    // while focused still reaches this function via the ResizeObserver
    // effect below; without this guard it would write stale inline width
    // overrides back onto the element, which — as inline styles — outrank
    // the `.split-focus` class rule's `0px` values and reintroduce the
    // (hidden, so blank) chat column as dead space.
    split.style.removeProperty('--project-chat-panel-width');
    split.style.removeProperty('--project-chat-handle-width');
    split.style.removeProperty('--project-workspace-panel-track');
    return;
  }
  writeProjectSplitLayout(split, width, workspacePanelTrack, options);
}

// The media model the user picked in the New Project → Media dialog, keyed by
// surface. For BYOK providers (AIHubMix) media is produced by the generate_*
// chat tools whose default model comes from the per-request byok*Model field —
// NOT the `pixo media generate` dispatcher — so without this seed the dialog pick
// is dropped and the conversation falls back to the Settings default. Returns
// undefined for non-media projects (and when the field is empty) so callers fall
// back to the Settings default exactly as before. The daemon re-validates the id
// against the active provider's registry, so a mismatched pick is safely ignored.
function projectMediaModelSeed(
  metadata: ProjectMetadata | null | undefined,
  surface: 'image' | 'video' | 'speech',
): string | undefined {
  if (!metadata) return undefined;
  if (surface === 'image' && metadata.kind === 'image') {
    return metadata.imageModel?.trim() || undefined;
  }
  if (surface === 'video' && metadata.kind === 'video') {
    return metadata.videoModel?.trim() || undefined;
  }
  if (surface === 'speech' && metadata.kind === 'audio' && metadata.audioKind === 'speech') {
    return metadata.audioModel?.trim() || undefined;
  }
  return undefined;
}

function projectMediaVoiceSeed(
  metadata: ProjectMetadata | null | undefined,
): string | undefined {
  if (metadata?.kind === 'audio' && metadata.audioKind === 'speech') {
    return metadata.voice?.trim() || undefined;
  }
  return undefined;
}

// Carry the creation-time model pick into the conversation ONLY when it belongs
// to the active BYOK provider. Guards against clobbering a user's Settings
// default with a model from a different provider — e.g. a SenseAudio user whose
// image project was created with the dialog's default model keeps their
// configured SenseAudio model instead of being forced to the registry default.
// AIHubMix's live (`aihubmix-` prefixed) ids resolve via mediaModelProviderId
// without waiting on the async catalogue, so the AIHubMix path still seeds.
function byokModelSeedForProtocol(
  metadata: ProjectMetadata | null | undefined,
  surface: 'image' | 'video' | 'speech',
  protocol: string | undefined,
): string | undefined {
  const picked = projectMediaModelSeed(metadata, surface);
  if (!picked) return undefined;
  return mediaModelProviderId(picked) === protocol ? picked : undefined;
}

function firstNonBlank(...values: Array<string | null | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? '';
}

function byokMediaDefaultsForRun(input: {
  imageModelOverride: string;
  videoModelOverride: string;
  speechModelOverride: string;
  speechVoiceOverride: string;
  config: Pick<AppConfig, 'byokImageModel' | 'byokVideoModel' | 'byokSpeechModel' | 'byokSpeechVoice'>;
  imageModelOptions: readonly { id: string }[];
  videoModelOptions: readonly { id: string }[];
  speechModelOptions: readonly { id: string }[];
}): ByokMediaDefaults {
  const imageModel = firstNonBlank(
    input.imageModelOverride,
    input.config.byokImageModel,
    input.imageModelOptions[0]?.id,
  );
  const videoModel = firstNonBlank(
    input.videoModelOverride,
    input.config.byokVideoModel,
    input.videoModelOptions[0]?.id,
  );
  const speechModel = firstNonBlank(
    input.speechModelOverride,
    input.config.byokSpeechModel,
    input.speechModelOptions[0]?.id,
  );
  const speechVoice = firstNonBlank(
    input.speechVoiceOverride,
    input.config.byokSpeechVoice,
  );
  return {
    ...(imageModel ? { imageModel } : {}),
    ...(videoModel ? { videoModel } : {}),
    ...(speechModel ? { speechModel } : {}),
    ...(speechVoice ? { speechVoice } : {}),
  };
}

function byokOpenCodeProviderFromConfig(
  config: AppConfig,
): ByokChatProviderConfig | undefined {
  if (!isOpenCodeByokChatProtocol(config.apiProtocol)) return undefined;
  const selectedProvider = selectedKnownProviderForConfig(config);
  const model = config.model.trim();
  if (
    (byokProviderRequiresApiKey(config.apiProtocol, selectedProvider, config.baseUrl)
      && !config.apiKey.trim())
    || !model
    || model.toLowerCase() === 'default'
    || (config.apiProtocol === 'azure' && !config.baseUrl.trim())
  ) {
    return undefined;
  }
  return {
    protocol: config.apiProtocol,
    apiKey: config.apiKey.trim(),
    baseUrl: config.baseUrl.trim(),
    model,
    ...(config.apiProtocol === 'azure' && config.apiVersion?.trim()
      ? { apiVersion: config.apiVersion.trim() }
      : {}),
    requiresApiKey: byokProviderRequiresApiKey(
      config.apiProtocol,
      selectedProvider,
      config.baseUrl,
    ),
  };
}

function selectedKnownProviderForConfig(config: AppConfig) {
  if (!config.apiProtocol) return undefined;
  return KNOWN_PROVIDERS.find(
    (provider) =>
      provider.protocol === config.apiProtocol
      && provider.baseUrl === config.baseUrl
      && (
        config.apiProviderBaseUrl == null
        || provider.baseUrl === config.apiProviderBaseUrl
      ),
  );
}

function isOpenCodeByokChatProtocol(
  protocol: AppConfig['apiProtocol'],
): protocol is ByokChatProtocol {
  return (
    protocol === 'anthropic' ||
    protocol === 'openai' ||
    protocol === 'azure' ||
    protocol === 'google' ||
    protocol === 'ollama' ||
    protocol === 'senseaudio' ||
    protocol === 'aihubmix'
  );
}

/** Prefer newer detail for the same local project. */
export function reconcileProjectDetail(
  project: Project,
  detail: Project | null,
): Project {
  if (!detail || detail.id !== project.id || detail.updatedAt < project.updatedAt) {
    return project;
  }
  return detail;
}

export function ProjectView({
  project,


  initialProjectDetail,

  projectAuthorizationKey = project.id,


  routeFileName,
  routeConversationId = null,


  config: savedConfig,
  agents,
  skills,
  designTemplates,
  daemonLive,
  onModeChange,
  onAgentChange,
  pendingAgentSelection = null,
  onAgentSelectionConsumed,
  onAgentModelChange,
  onApiModelChange,
  onOpenSettings,


  onOpenMcpSettings,
  onBrowsePlugins,
  onBack,
  onClearPendingPrompt,
  onTouchProject,
  onProjectChange,
  onProjectsRefresh,
  onDeleteProject,
  onDuplicateProject,

  creationHandoff = null,
  onCreationHandoffSettled,
}: Props) {
  const { locale, t } = useI18n();
  useProjectTitle(project.name);
  // A Home send mounts this view before the project row exists on the daemon
  // (OPEND-3334). Until it does, no project resource is read: every read
  // would 404, and an unpersisted project must not fan out conversation,
  // file, or presence requests. The view draws only what this tab knows.
  const projectReadsHeld = projectReadsHeldForCreation(creationHandoff);
  const activeAuthorizationLifetimeRef = useRef<string | null>(projectAuthorizationKey);
  /**
   * The Home-carried attachments, by every name the workspace might list them
   * under. `selectPrimaryProjectFile` uses it to NOT auto-open a file the user
   * merely attached to their prompt.
   *
   * This can no longer be a first-render snapshot. The project frame now opens
   * while those files are still uploading, so at mount the only names we have
   * are the local ones the picker gave us; the server paths arrive later. Both
   * sources are folded in, and the set keeps refreshing until the uploads are
   * done — a snapshot taken mid-upload would let a just-uploaded attachment
   * win the initial-open race it is supposed to be excluded from.
   */
  const initialHomeAttachmentFileNamesRef = useRef<{
    projectId: string;
    fileNames: Set<string>;
  } | null>(null);
  const refreshInitialHomeAttachmentFileNames = useCallback(() => {
    const current = initialHomeAttachmentFileNamesRef.current;
    const fileNames = current?.projectId === project.id ? current.fileNames : new Set<string>();
    let isHomeAutoSend = false;
    try {
      isHomeAutoSend = Boolean(
        window.sessionStorage.getItem(autoSendFirstMessageKey(project.id)),
      );
    } catch {
      /* sessionStorage may be unavailable; use ordinary initial selection. */
    }
    if (isHomeAutoSend) {
      for (const upload of homeAttachmentUploadsFor(project.id)) fileNames.add(upload.name);
      for (const attachment of readAutoSendAttachments(project.id)) {
        fileNames.add(attachment.path);
        const baseName = attachment.path.split('/').pop();
        if (baseName) fileNames.add(baseName);
        if (attachment.name) fileNames.add(attachment.name);
      }
    }
    initialHomeAttachmentFileNamesRef.current = { projectId: project.id, fileNames };
    return fileNames;
  }, [project.id]);
  if (initialHomeAttachmentFileNamesRef.current?.projectId !== project.id) {
    refreshInitialHomeAttachmentFileNames();
  }

  useEffect(() => {
    activeAuthorizationLifetimeRef.current = projectAuthorizationKey;
    return () => {
      if (activeAuthorizationLifetimeRef.current === projectAuthorizationKey) {
        activeAuthorizationLifetimeRef.current = null;
      }
    };
  }, [projectAuthorizationKey]);
  const analytics = useAnalytics();
  const projectResourceAuthority: ProjectResourceAuthority = projectReadsHeld ? 'pending' : 'local';
  const projectResourceAuthorityRef = useRef(projectResourceAuthority);
  projectResourceAuthorityRef.current = projectResourceAuthority;
  const readableTranscriptPrincipalRef = useRef(project.id);
  readableTranscriptPrincipalRef.current = project.id;
  const projectRunAuthorityKey = project.id;
  const iframeKeepAlivePool = useIframeKeepAlivePool();
  // ProjectView is the authorization lifetime for project-owned file content.
  // FileViewer may unmount while switching to a root tab such as Files,
  // but ProjectView remains mounted in that flow so revisit snapshots survive.
  // Leaving the project (or changing project identity) crosses the boundary:
  // drop every source snapshot before a later mount can seed content that the
  // next project/workspace context has not reauthorized.
  // `viewerOnly` is not a revocation signal: it also represents authorized
  // read-only members, so this ProjectView lifetime is the fail-closed boundary.
  useEffect(() => () => {
    invalidateHtmlSourceSnapshotProject(project.id);
  }, [project.id]);
  const projectTabsCanPersistToDaemonRef = useRef(
    true,
  );
  projectTabsCanPersistToDaemonRef.current = true;
  const projectDetail = useProjectDetail(project.id, initialProjectDetail, !projectReadsHeld);
  const detailedProject = projectDetail.project?.id === project.id ? projectDetail.project : null;
  const currentProject = reconcileProjectDetail(
    project,
    detailedProject,
  );
  // Website-clone turns reproduce a whole multi-page site; auto-open should
  // land on the site entry (index.html), not the last-written subpage. See
  // `SelectAutoOpenOptions.preferSiteEntry`.
  const autoOpenArtifactOptions = {
    preferSiteEntry: currentProject.metadata?.intent === 'web-clone',
  };
  // P0 page_view page_name=chat_panel — fire once per project mount.
  // ProjectView outlives conversation switches (ChatPane is keyed by
  // activeConversationId so it remounts when the user switches chats,
  // but this component does not), so page_view stays a "chat-panel
  // entry" metric instead of becoming a "conversation switch" count.
  // Reviewer #2285 (mrcfps, 2026-05-20 04:08) flagged the previous
  // ChatComposer-level emit for skewing the funnel.
  const chatPanelPageViewFiredRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const trackedTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const timer of trackedTimeoutsRef.current) clearTimeout(timer);
      trackedTimeoutsRef.current.clear();
    };
  }, []);

  const scheduleProjectTimeout = useCallback((callback: () => void, delayMs: number) => {
    if (!mountedRef.current) return null;
    const timer = setTimeout(() => {
      trackedTimeoutsRef.current.delete(timer);
      if (!mountedRef.current) return;
      callback();
    }, delayMs);
    trackedTimeoutsRef.current.add(timer);
    return timer;
  }, []);

  const clearProjectTimeout = useCallback((timer: ReturnType<typeof setTimeout> | null) => {
    if (timer == null) return;
    clearTimeout(timer);
    trackedTimeoutsRef.current.delete(timer);
  }, []);

  useEffect(() => {
    if (chatPanelPageViewFiredRef.current === project.id) return;
    chatPanelPageViewFiredRef.current = project.id;
    trackPageView(analytics.track, { page_name: 'chat_panel' });
  }, [analytics.track, project.id]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const conversationsRef = useRef<Conversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  // The list load outlives the render that started it; the URL can move on
  // while it is in flight.
  const routeConversationIdRef = useRef(routeConversationId);
  routeConversationIdRef.current = routeConversationId;
  const [pendingEmptyConversationSeed, setPendingEmptyConversationSeed] =
    useState<{ projectId: string; authorityKey: string } | null>(null);
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );
  const [conversationAgentChoices, setConversationAgentChoices] = useState<Record<string, string>>({});
  const conversationAgentKey = `${project.id}:${activeConversationId ?? ''}`;
  // Settings is a separate route. App retains its targeted choice until a run
  // accepts it, including across another Settings visit before sending.
  const pendingConversationAgentId = pendingAgentSelection?.projectId === project.id && activeConversationId
    && (!pendingAgentSelection.conversationId || pendingAgentSelection.conversationId === activeConversationId)
    ? pendingAgentSelection.agentId : undefined;
  const config = useMemo(() => conversationAgentConfig(
    savedConfig, agents, activeConversation?.latestRunAgentId, pendingConversationAgentId ?? conversationAgentChoices[conversationAgentKey],
  ), [savedConfig, agents, activeConversation?.latestRunAgentId, pendingConversationAgentId, conversationAgentChoices, conversationAgentKey]);
  const rememberConversationAgent = useCallback((conversationId: string, agentId: string | undefined) => {
    setConversations(current => current.some(item => item.id === conversationId && item.latestRunAgentId !== agentId)
      ? current.map(item => item.id === conversationId ? { ...item, latestRunAgentId: agentId } : item)
      : current);
  }, []);
  const consumeConversationAgentChoice = useCallback((conversationId: string, agentId: string | null | undefined) => {
    const key = `${project.id}:${conversationId}`;
    setConversationAgentChoices(current => {
      if (!agentId || current[key] !== agentId) return current;
      const next = { ...current }; delete next[key]; return next;
    });
    if (pendingAgentSelection?.projectId === project.id && pendingAgentSelection.agentId === agentId
      && (!pendingAgentSelection.conversationId || pendingAgentSelection.conversationId === conversationId)) onAgentSelectionConsumed?.();
  }, [project.id, pendingAgentSelection, onAgentSelectionConsumed]);
  const previewContextValue = useMemo<ProjectPreviewContextValue>(
    () => ({


      projectResourceAuthority,
    }),
    [null, false, projectResourceAuthority,],
  );
  const activeSessionMode = activeConversation?.sessionMode ?? 'design';
  const [messagesConversationId, setMessagesConversationId] = useState<string | null>(null);
  const [failedMessagesConversationId, setFailedMessagesConversationId] = useState<string | null>(null);
  const [conversationLoadFailure, setConversationLoadFailure] = useState<{
    message: string;
    source: 'read' | 'create';
  } | null>(null);
  const conversationLoadError = conversationLoadFailure?.message ?? null;
  const conversationMaterializationRecoveryRef =
    useRef<ConversationMaterializationRecovery | null>(null);
  const conversationMaterializationGenerationControllerRef =
    useRef<ReturnType<typeof createConversationMaterializationGenerationController> | null>(null);
  const conversationMaterializationGenerationController =
    conversationMaterializationGenerationControllerRef.current
    ?? createConversationMaterializationGenerationController();
  conversationMaterializationGenerationControllerRef.current =
    conversationMaterializationGenerationController;
  const conversationMaterializationRecoveryInFlightRef =
    useRef<ConversationMaterializationRecovery | null>(null);
  const [messageLoadRetryNonce, setMessageLoadRetryNonce] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
  const [activePluginActionPaths, setActivePluginActionPaths] = useState<Set<string>>(() => new Set());
  const [hiddenAssistantPluginActionPaths, setHiddenAssistantPluginActionPaths] = useState<Set<string>>(() => new Set());
  const [forceStreamingPluginMessageIds, setForceStreamingPluginMessageIds] = useState<Set<string>>(() => new Set());
  // True once the initial DB read for the active conversation has settled.
  // Auto-send gates on this so it can't fire before listMessages resolves and
  // race-clobber the freshly-pushed user + assistant placeholder. Without
  // this, the auto-send writes [user, assistant] into state, then the still
  // in-flight listMessages PUT response arrives, runs setMessages(list), and
  // wipes both — leaving the daemon's run with no client-side message to
  // attach the runId to.
  const [messagesInitialized, setMessagesInitialized] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingConversationId, setStreamingConversationId] = useState<string | null>(null);
  const [paneError, setPaneError] = useState<{
    message: string;
    sourceAssistantId: string | null;
  } | null>(null);
  const error = paneError?.message ?? null;
  const errorSourceAssistantId = paneError?.sourceAssistantId ?? null;
  const setError = useCallback((next: SetStateAction<string | null>) => {
    setPaneError((current) => {
      const currentMessage = current?.message ?? null;
      const message = typeof next === 'function' ? next(currentMessage) : next;
      if (message == null) return null;
      return {
        message,
        sourceAssistantId:
          typeof next === 'function' && message === currentMessage
            ? current?.sourceAssistantId ?? null
            : null,
      };
    });
  }, []);
  const setRunError = useCallback((message: string, sourceAssistantId: string) => {
    setPaneError({ message, sourceAssistantId });
  }, []);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [filesRefresh, setFilesRefresh] = useState(0);
  const filesRefreshRequestKeyRef = useRef(0);
  const bumpFilesRefresh = useCallback(() => {
    setFilesRefresh((current) => {
      const next = current + 1;
      filesRefreshRequestKeyRef.current = next;
      return next;
    });
  }, []);
  // True while a working-dir replace is reindexing the new folder. Surfaced
  // to the Files panel so the file list shows a loading state instead
  // of silently sitting on the old tree for the few seconds the scan takes.
  const [projectFilesSnapshot, setProjectFilesSnapshot] = useState<{
    files: ProjectFile[];
    refreshKey: number;
    generation: number;
  }>({ files: [], refreshKey: 0, generation: 0 });
  const projectFiles = projectFilesSnapshot.files;
  const committedFilesRefreshKey = projectFilesSnapshot.refreshKey;
  const committedFilesGeneration = projectFilesSnapshot.generation;
  const projectFilesGenerationRef = useRef(committedFilesGeneration);
  const committedFilesRefreshKeyRef = useRef(committedFilesRefreshKey);
  committedFilesRefreshKeyRef.current = committedFilesRefreshKey;
  const projectFilesRef = useRef<ProjectFile[]>([]);
  // A workspace manual save is explicit caller evidence, not a property of
  // every browser POST (chat artifact persistence uses that API too).
  const manualFileWritesByRunRef = useRef(new Map<AbortController, {
    projectId: string;
    authorityKey: string;
    conversationId: string;
    runId: string | null;
    detached: boolean;
    files: Map<string, ProjectFile>;
    dispose: (force?: boolean) => void;
    retain: () => () => void;
  }>());
  useEffect(() => () => {
    for (const run of manualFileWritesByRunRef.current.values()) {
      if (run.projectId === project.id && run.authorityKey === projectRunAuthorityKey) {
        run.dispose(true);
      }
    }
  }, [project.id, projectRunAuthorityKey]);
  const projectFilesRequestSeqRef = useRef(0);
  const [workspaceFocused, setWorkspaceFocused] = useState(false);
  // Read by `renderPreferredChatPanelWidth` instead of closing over
  // `workspaceFocused` directly, so that callback's identity (and therefore
  // the ResizeObserver effect keyed on it, below) doesn't need to depend on
  // focus state — see the render-phase mirror below for why.
  const workspaceFocusedRef = useRef(workspaceFocused);
  // Keep this render-phase mirror synchronous with the state that determines
  // the committed `.split-focus` class. A child layout effect (and, in the
  // browser, ResizeObserver delivery before passive effects) can run before a
  // parent effect, so effect-based synchronization still exposes one stale
  // frame where the old three-column widths can be written back inline.
  workspaceFocusedRef.current = workspaceFocused;
  // Mirrors `workspaceFocused` but lags behind it while collapsing, so the
  // chat pane stays mounted/visible until the `.split` width transition
  // actually finishes — see the sync effect near the ResizeObserver below.
  const [chatSlotHidden, setChatSlotHidden] = useState(workspaceFocused);
  // The side panel's hidden/shown choice (spec §2): hiding it gives the
  // conversation the whole width. Persisted across projects and reloads.
  const [panelHidden, setPanelHidden] = useState(readStoredPanelHidden);
  const togglePanelHidden = useCallback(() => {
    setPanelHidden((hidden) => {
      writeStoredPanelHidden(!hidden);
      return !hidden;
    });
  }, []);
  // Something the user asked to see in the panel (a file clicked in the
  // conversation, a starter action) shows the panel if it was hidden
  // (specs/current/openpixo-game-panel.md §3).
  const revealPanel = useCallback(() => {
    setPanelHidden((hidden) => {
      if (hidden) writeStoredPanelHidden(false);
      return false;
    });
  }, []);
  // Toolbar seat for ChatPane's conversation history control (portal host).
  const [historyPortalTarget, setHistoryPortalTarget] = useState<HTMLDivElement | null>(null);
  // Per-session override for the BYOK chat's generate_image tool. Seeded once
  // from the New Project → Media model pick (project.metadata.imageModel) — but
  // only when that pick belongs to the active BYOK provider (see
  // byokModelSeedForProtocol) — falling back to the Settings default
  // (config.byokImageModel) otherwise. Subsequent selections live only in this
  // component's state — page refresh / project switch resets to this seed.
  // Persistent defaults live in Settings → BYOK → Image generation model.
  const [byokImageModelOverride, setByokImageModelOverride] = useState<string>(
    () => byokModelSeedForProtocol(project.metadata, 'image', config.apiProtocol) ?? config.byokImageModel ?? '',
  );
  // Same per-session override for the BYOK chat's generate_video tool, seeded
  // from the project's videoModel pick (provider-gated), then Settings.
  const [byokVideoModelOverride, setByokVideoModelOverride] = useState<string>(
    () => byokModelSeedForProtocol(project.metadata, 'video', config.apiProtocol) ?? config.byokVideoModel ?? '',
  );
  // Same per-session overrides for the BYOK chat's generate_speech tool (model +
  // voice), seeded from the project's speech pick (provider-gated), then Settings.
  const [byokSpeechModelOverride, setByokSpeechModelOverride] = useState<string>(
    () => byokModelSeedForProtocol(project.metadata, 'speech', config.apiProtocol) ?? config.byokSpeechModel ?? '',
  );
  // Voice only carries when the speech model itself is carried (same provider),
  // so a cross-provider voice id never leaks into the request.
  const [byokSpeechVoiceOverride, setByokSpeechVoiceOverride] = useState<string>(
    () => (byokModelSeedForProtocol(project.metadata, 'speech', config.apiProtocol)
      ? projectMediaVoiceSeed(project.metadata)
      : undefined) ?? config.byokSpeechVoice ?? '',
  );
  // Live model option lists (same hooks the composer/Settings pickers use) so
  // the chat "default" (no explicit pick) resolves to the FIRST catalogue model
  // shown in the dropdown — not a hardcoded id. The daemon keeps its own
  // fallback for when the catalogue hasn't loaded.
  const byokImageModelOptionsPV = useByokImageModelOptions(config.apiProtocol);
  const byokVideoModelOptionsPV = useByokVideoModelOptions(config.apiProtocol);
  const byokSpeechModelOptionsPV = useByokSpeechModelOptions(config.apiProtocol);
  // PR #974 round 7 (mrcfps @ useDesignMdState.ts:131): counter that
  // bumps on file-changed SSE events, live_artifact* events, and the
  // chat streaming-completion edge so the staleness chip stays in sync
  // with the underlying mtimes / conversation updatedAt as the user
  // keeps working post-finalize. The hook treats it as a dep and
  // recomputes whenever it changes.
  const [designMdRefreshKey, setDesignMdRefreshKey] = useState(0);
  // ----- Continue in CLI / Finalize design package wiring (#451) -----
  // The toast surface is shared between Finalize errors and the
  // success/fallback toasts emitted from handleContinueInCli.
  const designMdState = useDesignMdState(project.id, designMdRefreshKey, !projectReadsHeld);
  const terminalLauncher = useTerminalLaunch();
  const [projectActionsToast, setProjectActionsToast] = useState<{
    message: string;
    details: string | null;
    code?: string | null;
    tone?: 'default' | 'success' | 'error' | 'loading';
    ttlMs?: number;
    scope?: 'chat-pane';
  } | null>(null);
  const [chatSeed, setChatSeed] = useState<{ id: string; value: string } | null>(null);

  /**
   * 正在等服务端确认的那一次重试(OPEND-2758)。
   *
   * `failedAssistantId` 只识别被接管的旧失败，错误卡不再固定在它身上;
   * `replacementAssistantId` 是这一发新画出去的助手消息 —— 它拿到 `runId`
   * (也就是 `POST /api/runs` 回来了)才算「服务端确认」,宣告到那一刻才撤。
   */
  const [retryPending, setRetryPending] = useState<{
    conversationId: string;
    failedAssistantId: string;
    replacementAssistantId: string;
  } | null>(null);
  // A ref closes the same-render double-click window before React paints busy.
  const retryLocksRef = useRef(new Map<string, string>());
  const [retriedErrorSurfaces, setRetriedErrorSurfaces] = useState<Record<string, readonly string[]>>({});
  const retriedErrorKey = activeConversationId
    ? retriedErrorSurfaceKey(project.id, activeConversationId)
    : null;
  const supersededErrorAssistantIds = retriedErrorKey
    ? retriedErrorSurfaces[retriedErrorKey] ?? readRetriedErrorSurface(retriedErrorKey) ?? []
    : [];
  const supersedeRetriedError = useCallback((
    conversationId: string,
    displayedAssistantId: string,
    physicalAssistantId: string,
  ) => {
    const key = retriedErrorSurfaceKey(project.id, conversationId);
    // A folded strategy turn displays its request ID but owns the final run's
    // diagnostic. Both identities belong to this one validated retry target.
    const assistantIds = [...new Set([displayedAssistantId, physicalAssistantId])];
    writeRetriedErrorSurface(key, assistantIds);
    setRetriedErrorSurfaces((current) => ({ ...current, [key]: assistantIds }));
  }, [project.id]);
  /** 这次重试的替补助手消息**曾经**上过屏 —— 见下面那个 effect 的第三条出路。 */
  const retryPendingPaintedRef = useRef<string | null>(null);
  const [autoAuditRepairSeed, setAutoAuditRepairSeed] =
    useState<{ id: string; value: string } | null>(null);
  const initialChatPanelWidth = useMemo(readSavedChatPanelWidth, []);
  const [chatPanelWidth, setChatPanelWidth] = useState(initialChatPanelWidth.width);
  const [chatPanelMaxWidth, setChatPanelMaxWidth] = useState(FALLBACK_MAX_CHAT_PANEL_WIDTH);
  const [workspacePanelMinWidth, setWorkspacePanelMinWidth] = useState(MIN_WORKSPACE_PANEL_WIDTH);
  const [resizingChatPanel, setResizingChatPanel] = useState(false);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const chatPanelWidthRef = useRef(chatPanelWidth);
  const preferredChatPanelWidthRef = useRef(chatPanelWidth);
  const chatPanelWidthCustomizedRef = useRef(initialChatPanelWidth.customized);
  const resizeStartPreferredWidthRef = useRef(chatPanelWidth);
  const chatPanelMaxWidthRef = useRef(chatPanelMaxWidth);
  const resizeStateRef = useRef<{
    startClientX: number;
    startWidth: number;
    isRtl: boolean;
    hasMoved: boolean;
  } | null>(null);
  const pointerCleanupRef = useRef<(() => void) | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const pendingPointerClientXRef = useRef<number | null>(null);
  // The persisted set of open tabs + active tab. Persisted via PUT on every
  // change; loaded once when the project mounts.
  const [openTabsState, setOpenTabsState] = useState<OpenTabsState>({
    tabs: [],
    active: null,
  });
  // Artifact context for the header actions (settings gear, handoff) that live
  // in this workspace's header alongside FileViewer's present/share/download.
  // Mirrors the artifact_id / artifact_kind that FileViewer attaches, derived
  // from the currently-active file tab, so all artifact_header analytics carry
  // the same dimensions. Undefined on non-file tabs (e.g. the file list).
  const headerArtifact = useMemo<{
    artifact_id?: string;
    artifact_kind?: TrackingArtifactKind;
  }>(() => {
    const activeName = openTabsState.active;
    const file = activeName
      ? projectFiles.find((entry) => entry.name === activeName) ?? null
      : null;
    if (!file) return {};
    return {
      artifact_id: anonymizeArtifactId({ projectId: project.id, fileName: file.name }),
      artifact_kind: artifactKindToTracking({ fileKind: file.kind ?? null }),
    };
  }, [openTabsState.active, projectFiles, project.id]);
  const routeFileNameRef = useRef(routeFileName);
  routeFileNameRef.current = routeFileName;
  const [activeWorkspaceContext, setActiveWorkspaceContext] =
    useState<WorkspaceContextItem | null>(null);
  const [workspaceContexts, setWorkspaceContexts] = useState<WorkspaceContextItem[]>([]);
  const tabsLoadedRef = useRef(false);
  const tabsHydratedFromSavedStateRef = useRef(false);
  const [tabsHydrationVersion, setTabsHydrationVersion] = useState(0);
  const hasAppliedInitialPrimaryOpenRef = useRef(false);
  // Routed to FileWorkspace — bumped whenever the user clicks "open" on a
  // tool card, an attachment chip, or a produced-file chip in chat. We
  // include a nonce so re-clicking the same name after the user closed the
  // tab still focuses it.
  // `openBatch` carries a whole finished turn's artifacts (OPEND-2588) in one
  // request. It has to be one request: this is a single state slot, so N
  // synchronous `requestOpenFile` calls would collapse into the last one.
  // `origin: 'conversation'` marks the user's own clicks; see
  // `requestConversationOpenFile`.
  const [openRequest, setOpenRequest] = useState<
    { name: string; nonce: number; openBatch?: readonly string[]; origin?: 'conversation' } | null
  >(null);
  // Parallel to shareRequest, but opens the workspace's Download/Export menu.
  const [downloadRequest, setDownloadRequest] = useState<
    { name: string; nonce: number; anchorId?: string } | null
  >(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef<AbortController | null>(null);
  // Runs explicitly superseded by a "send now" interrupt. Their abort
  // controller is recorded here synchronously — before handleStop() clears the
  // active refs — so the run's late terminal callbacks (which the daemon still
  // delivers for a canceled run) can be recognized as stale and skip every
  // current-run side effect, independent of abortRef churn. A WeakSet so a
  // finished run's controller is collected once nothing else references it.
  const supersededRunsRef = useRef<WeakSet<AbortController>>(new WeakSet());
  const streamingConversationIdRef = useRef<string | null>(null);
  const [queuedChatSends, setQueuedChatSends] = useState<QueuedChatSend[]>([]);
  const queuedChatSendsRef = useRef<QueuedChatSend[]>([]);
  // A BYOK preflight can reject a send before any Run exists. Keep that
  // submission's task identity in memory so fixing Settings and resubmitting
  // the same draft completes the original task funnel instead of fabricating a
  // second task. The full send is persisted in the queue separately.
  const blockedRunTaskRef = useRef<{
    conversationId: string;
    requestKey: string;
    taskAnalytics: ChatTaskExecutionAnalytics;
  } | null>(null);
  const sendTextBufferRef = useRef<BufferedTextUpdates | null>(null);
  const reattachTextBuffersRef = useRef<Set<BufferedTextUpdates>>(new Set());
  const reattachControllersRef = useRef<Map<string, AbortController>>(new Map());
  const reattachCancelControllersRef = useRef<Map<string, AbortController>>(new Map());
  const completedReattachRunsRef = useRef<Set<string>>(new Set());
  // A locally finished run briefly has terminal status before its async
  // project-file refresh attaches delivery evidence. Do not let that same
  // browser session reattach the run during this handoff; reattach remains
  // the recovery path after a reload, where this in-memory set is empty.
  const finalizingLocalRunIdsRef = useRef<Set<string>>(new Set());
  // Tracks transient null-status retry attempts per runId; bounded by
  // MAX_TRANSIENT_RETRIES so we never spin indefinitely on a persistently
  // missing run.
  const transientFailedRetriesRef = useRef<Map<string, number>>(new Map());
  // Tracks generic-disconnect retry attempts per runId independently of the
  // null-status path so the two transient error classes don't share one budget
  // and cause premature sealing when both fire on the same run.
  const genericDisconnectRetriesRef = useRef<Map<string, number>>(new Map());
  // Cooldown window for active generic-disconnect retries after the transient
  // budget is exhausted, so a flapping SSE endpoint does not trigger an
  // immediate reattach loop while the daemon still reports the run as active.
  const genericDisconnectBackoffUntilRef = useRef<Map<string, number>>(new Map());
  // Timer handles for pending transient-retry callbacks; cleared on cleanup.
  const transientRetryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [recoveryTick, setRecoveryTick] = useState(0);
  /**
   * 组件 22 · 重连 · S29:流水最后一行此刻该不该有、写几分之几。
   *
   * 读数来自传输层的 `onReconnect`(`providers/daemon.ts` 的 `DaemonReconnectState`),
   * 推演规则全在 `runtime/chat/reconnect-state.ts` —— 包括「恢复后整行消失」
   * 与「run 落终态后整行消失」这两条边界。这里只做搬运。
   */
  const [reconnectView, setReconnectView] = useState<ChatReconnectView | null>(null);
  const pushReconnectSignal = useCallback((signal: ChatReconnectSignal) => {
    setReconnectView((prev) => nextChatReconnectView(prev, signal));
  }, []);
  /**
   * 那一轮的结局有时不从流上来 —— 会话刷新、切回这个会话时重新拉消息,
   * 都能把终态带进 `messages`,而 `settled` 今天只在流上发。掉线正是流断了的时刻,
   * 所以这条「别的门」恰恰是最常走的那条:不补这一拍,重连行会挂在一条写着
   * 「已完成」的消息下面继续说「连接失败」(2026-08-27 真机见过)。
   *
   * 撤不撤由 `nextChatReconnectView` 判 —— `failed` 对已经交回给人的那一行是不动的。
   */
  useEffect(() => {
    const signal = settledSignalFromMessages(reconnectView, messages);
    if (signal) pushReconnectSignal(signal);
  }, [reconnectView, messages, pushReconnectSignal]);
  /**
   * 组件 22 的**第二个上膛口**:浏览器自己说这一屏没网了。
   *
   * 第一个上膛口是传输层那条重连预算,它只认「socket 真的断掉」。那条路本身是通的
   * (`tests/providers/daemon-sse-tab-offline.test.ts` 走的就是它)。可 daemon 跑在
   * **本机回环**上 —— 页签断网时那条流常常一点事都没有:25 秒一次的 keepalive 照旧到,
   * 75 秒的静默闸(`DAEMON_STREAM_IDLE_TIMEOUT_MS`)一次都不上膛,预算于是从头到尾是 0。
   *
   * 真机 2026-09-03:一条长任务跑着,把那个页签断网,一分钟后 `navigator.onLine`
   * 已经是 `false`,而壳头照旧写着「进行中」、秒数还在往上走,「正在重新连接 /
   * 连接失败 / 重新连接」一个字都没有。**浏览器早就知道,我们没问过它。**
   *
   * 只在**这个会话里有一轮还在跑**的时候上膛:没有在跑的东西就没有可重连的东西,
   * 那时报「正在重新连接」是凭空多一句话。收场只认 `online` 与这一轮的终态
   * (`settled`),判据全在 `nextChatReconnectView` 的 `network` 分支。
   */
  const offlineWatchRunId = useMemo(() => {
    // 切会话的那一拍 `messages` 可能还是上一个会话的,别把别人的 run 盖上这个会话的戳。
    if (!activeConversationId || messagesConversationId !== activeConversationId) return null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.role !== 'assistant' || !message.runId) continue;
      if (!isActiveRunStatus(message.runStatus)) continue;
      return message.runId;
    }
    return null;
  }, [messages, activeConversationId, messagesConversationId]);
  useEffect(() => {
    const runId = offlineWatchRunId;
    const conversationId = activeConversationId;
    if (!runId || !conversationId) return undefined;
    const push = (online: boolean): void => {
      pushReconnectSignal({ kind: 'network', runId, conversationId, online });
    };
    // 挂上来时就已经断着的那一种:事件早发过了,只有问一次才知道。
    if (typeof navigator !== 'undefined' && navigator.onLine === false) push(false);
    const handleOffline = (): void => push(false);
    const handleOnline = (): void => push(true);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [offlineWatchRunId, activeConversationId, pushReconnectSignal]);
  /**
   * 22-3 那颗〔重新连接〕。
   *
   * 语义是**接回同一轮的流**,不是重试 —— 复用已有的重挂通道
   * (`attachRecoverableRuns` → `reattachDaemonRun`,带 `?after=<lastRunEventId>` 游标),
   * 所以已经跑出来的东西不会丢,也不会在 daemon 上多起一轮。
   *
   * 用尽预算后那条通道被 `genericDisconnectBackoffUntilRef` 压了一段冷却窗口
   * (给还在跑的 daemon 留喘息),这里是用户明确要求现在就试,所以先撤掉冷却与
   * 重试计数,再推一拍 `recoveryTick` 把重挂扫描叫醒。
   *
   * 按下之后那一行**当场**翻回「正在重新连接 1/5」,不撤整行。
   *
   * 为什么必须当场变:按下之后要走的整条链(清记账 → 叫醒扫描 → 拉运行状态 →
   * 起重挂)全在异步里,而 daemon 没回来时它在第三步就断了 —— 上面这几行
   * `delete` 一个像素都不会改。真机 2026-08-27 用户原话「点击 reconnect 咋没啥
   * 反应」;**「点了没变化」和「按钮坏了」在屏幕上长得一模一样。**
   *
   * 为什么不能撤整行:更早一版乐观推了一条 `dropped`,重挂起不来时没有人再把
   * 行画回来,屏幕只剩壳头一句「运行失败」,用户连再按一次的入口都没有。
   * 撤整行的唯一正当时机仍然是「重挂真的开始了」,那个位置由 `attachRecoverableRuns`
   * 里 `reattachDaemonRun` 前一行的 `dropped` 占着。
   *
   * 乐观就必须有到期。这把闸是那条不变量在运行时的唯一落点:重挂起不来的形态太多
   * (状态拉不到、daemon 亲口说这一轮已经 failed、被冷却窗口挡下、扫描因为
   * `daemonLive` 翻假压根没跑),挨个去认等于把一条规矩拆成十几处记得写对。
   * 过了 `MANUAL_RECONNECT_FEEDBACK_MS` 这一行还是那条乐观读数,就回落成 22-3
   * 把按钮还给人 —— 判据在 `reconnect-state.ts` 的 `manual-retry-expired`,
   * 传输层真的接管出来的读数不带 `manualRetry`,那把闸对它自动作废。
   *
   * 连点不成立,而且不是靠一把锁:乐观读数的 `exhausted` 是 false,而
   * `components/chat/Reconnect.tsx` 只有 `exhausted` 那一档才画按钮 ——
   * 窗口里屏幕上没有可按的东西,一次按压最多换来一次重挂扫描。
   */
  const reconnectRunId = reconnectView?.runId ?? null;
  const manualReconnectExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleManualReconnect = useCallback(() => {
    const runId = reconnectRunId;
    /*
     * 没有 runId 就是**屏幕上没有那一行**:按钮和这个 id 读的是同一份
     * `reconnectView`(渲染那一路只多过一道会话过滤,过滤只会把它变成 null),
     * 所以没有行 = 没有按钮 = 没有东西可接。能走到这里只剩一种时序:画面画出按钮
     * 之后、这一下按压落地之前那一行自己收场了(比如这一轮其实已经成功)。
     * 那时什么都不做才是对的 —— 不该为一个已经不存在的目标再起一次重挂。
     */
    if (!runId) return;
    transientFailedRetriesRef.current.delete(runId);
    genericDisconnectRetriesRef.current.delete(runId);
    genericDisconnectBackoffUntilRef.current.delete(runId);
    completedReattachRunsRef.current.delete(runId);
    clearProjectTimeout(manualReconnectExpiryRef.current);
    manualReconnectExpiryRef.current = null;
    setReconnectView((prev) => nextChatReconnectView(prev, { kind: 'manual-retry', runId }));
    manualReconnectExpiryRef.current = scheduleProjectTimeout(() => {
      manualReconnectExpiryRef.current = null;
      setReconnectView((prev) =>
        nextChatReconnectView(prev, { kind: 'manual-retry-expired', runId }));
    }, MANUAL_RECONNECT_FEEDBACK_MS);
    setRecoveryTick((t) => t + 1);
  }, [reconnectRunId, clearProjectTimeout, scheduleProjectTimeout]);
  const recoveredArtifactMessagesRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<ChatMessage[]>([]);
  const startingQueuedChatSendIdRef = useRef<string | null>(null);
  const [queuedAutoStartTick, setQueuedAutoStartTick] = useState(0);
  // We auto-save the most recent artifact to the project folder. Track the
  // last name we persisted so re-renders during streaming don't spawn
  // duplicate writes.
  const savedArtifactRef = useRef<string | null>(null);
  // Track which conversation the current messages belong to, so we can
  // correctly gate new-conversation creation even during async loads.
  const messagesConversationIdRef = useRef<string | null>(null);
  const messagesAuthorityKeyRef = useRef<string | null>(null);
  // The create response proves this unseeded conversation has no messages.
  // Consume that fact once; later switches and authority changes still reload.
  const createdEmptyTranscriptRef = useRef<{
    projectId: string;
    conversationId: string;
    authorityKey: string;
  } | null>(null);
  const loadedTranscriptRef = useRef<{
    projectId: string;
    conversationId: string;
    principalKey: string | null;
  } | null>(null);
  const creatingConversationRef = useRef(false);
  // Last conversation id this view pushed into the URL. Lets the
  // route -> active-conversation sync tell a genuine external navigation
  // apart from the URL merely lagging a local conversation switch.
  const lastSyncedConversationIdRef = useRef<string | null>(null);
  // The route value the route -> active-conversation sync last acted on.
  const lastSeenRouteConversationIdRef = useRef<string | null>(null);
  // Live mirror of the currently-viewed project id. Used to bail out of
  // the conversation-created async refresh (#1361) if the user switches
  // projects while the refetch is in flight — the existing project-load
  // effects use the same kind of cancellation guard.
  const projectIdRef = useRef(project.id);
  useEffect(() => {
    projectIdRef.current = project.id;
  }, [project.id]);
  const projectRunAuthorityKeyRef = useRef(projectRunAuthorityKey);
  projectRunAuthorityKeyRef.current = projectRunAuthorityKey;
  const conversationsLoadedProjectIdRef = useRef<string | null>(null);
  // Live mirror of the full project prop, for async handlers whose useCallback
  // deps only track `project.id` (e.g. the project-events handler below):
  // comparing a re-fetched record against a stale closure copy would
  // mis-detect changes after a rename.
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    setChatSeed(null);
    setAutoAuditRepairSeed(null);
    const restored = loadQueuedChatSends(project.id);
    queuedChatSendsRef.current = restored;
    setQueuedChatSends(restored);
  }, [project.id]);
  // Monotonic token bumped on every `conversation-created` refresh dispatch.
  // Two rapid events (e.g. concurrent routine runs against the same reused
  // project, #1502) can start overlapping `listConversations` calls; if the
  // later request resolves first with N+1 conversations and the earlier
  // request resolves afterwards with only N, an unconditional
  // `setConversations(list)` would drop the newest conversation. Each
  // dispatch captures the token at start; only the dispatch whose token
  // still equals `conversationsRefreshTokenRef.current` at await-return is
  // allowed to apply its result.
  const conversationsRefreshTokenRef = useRef(0);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const currentConversationHasActiveRun = useMemo(
    () => messages.some((m) => m.role === 'assistant' && isActiveRunStatus(m.runStatus)),
    [messages],
  );
  const currentConversationHasRecoverableArtifact = useMemo(
    () => messages.some((message) => hasRecoverableArtifactMessage(message)),
    [messages],
  );
  const currentConversationLoading = Boolean(
    activeConversationId
      && messagesConversationId !== activeConversationId
      && failedMessagesConversationId !== activeConversationId,
  );
  // A readable transcript can stay visible during an authority refresh, but
  // sending and recovery still wait for the new authoritative read to settle.
  // Compare keys during render: the load effect's state reset cannot block
  // later effects from draining a queue using this same render's readiness.
  const currentConversationReadPending = currentConversationLoading
    || Boolean(activeConversationId && (
      !messagesInitialized || messagesAuthorityKeyRef.current !== projectRunAuthorityKey
    ));
  const currentConversationStreaming = streaming && streamingConversationId === activeConversationId;
  const currentConversationControlStreaming =
    currentConversationStreaming;
  const currentConversationBusy = currentConversationReadPending
    || currentConversationStreaming
    || currentConversationHasActiveRun;
  const currentConversationAwaitingActiveRunAttach =
    currentConversationHasActiveRun
    && !currentConversationStreaming;
  const currentConversationSendDisabled = projectReadsHeld
    || currentConversationReadPending
    || failedMessagesConversationId === activeConversationId
    || currentConversationAwaitingActiveRunAttach;
  /**
   * 报错卡上那一排恢复动作动不了的时候,**是哪一档挡住的**(OPEND-2821)。
   *
   * 这不是新的门:四档是原来那个布尔(`busy || sendDisabled`)所覆盖的同一个
   * 集合的一个划分,等价性写在 `runtime/chat/recovery-gating.ts` 的注释里。
   * 有了原因之后按钮才能既画成禁用态、又说得出话 —— 在此之前
   * `handleRetry` 在这六个条件下静默 `return`,而按钮永远画成可点。
   */
  const currentConversationActionBlockReason = resolveRecoveryActionBlockReason({
    readOnly: Boolean(projectReadsHeld),
    messagesUnavailable: failedMessagesConversationId === activeConversationId,

    conversationBusy: Boolean(
      currentConversationBusy || currentConversationAwaitingActiveRunAttach,
    ),
  });
  const currentConversationActionDisabled = currentConversationActionBlockReason !== null;
  // Keep the broad mutation gate above: pending authority/materialization also
  // forbids sending, but only a settled denial can claim view-only permission.
  let currentConversationAccessError: 'messages-unavailable' | 'read-only' | null = null;
  if (
    conversationLoadFailure?.source === 'read'
    || (activeConversationId && failedMessagesConversationId === activeConversationId)
  ) {
    currentConversationAccessError = 'messages-unavailable';
  } else ;
  const currentConversationActionDisabledRef = useRef(currentConversationActionDisabled);
  currentConversationActionDisabledRef.current = currentConversationActionDisabled;

  const currentConversationQueuedItems = activeConversationId
    ? queuedChatSends
        .filter((item) => item.conversationId === activeConversationId)
        .map((item) => {
          const queuedItem = {
            id: item.id,
            prompt: item.prompt,
            attachments: item.attachments,
          };
          if (item.meta === undefined) return queuedItem;
          return { ...queuedItem, meta: item.meta };
        })
    : [];
  const newConversationDisabled = creatingConversation || projectReadsHeld;
  // CS03: actionable business Ready, independent of the chat first-paint
  // metric. Never accept a stale transcript or a merely mounted placeholder.
  const projectInteractiveReady = Boolean(
      detailedProject
      && !projectDetail.loading
      && activeConversationId
      && messagesConversationId === activeConversationId
      && messagesInitialized
      && messagesAuthorityKeyRef.current === projectRunAuthorityKey
      && !currentConversationSendDisabled
      && !newConversationDisabled
    );
  useStartupReady({ visible: Boolean(detailedProject && !projectDetail.loading), interactive: projectInteractiveReady });
  useProjectNavigationReady({
    projectId: project.id,
    conversationId: activeConversationId,
    visible: Boolean(detailedProject && !projectDetail.loading),
    ready: projectInteractiveReady,
    failure: projectDetail.error ? 'project_unavailable'
      : conversationLoadFailure ? 'conversations_unavailable'
      : activeConversationId && failedMessagesConversationId === activeConversationId
        ? 'messages_unavailable' : null,
  });
  const activeCompletionNotificationRunsRef = useRef<Set<string>>(new Set());
  const completedNotificationRunsRef = useRef<Set<string>>(new Set());

  // Load conversations on project switch. If none exist (older projects
  // pre-conversations, or a freshly created one whose default seed got
  // dropped), create one on the fly.
  useEffect(() => {
    if (projectReadsHeld) return;
    let cancelled = false;
    const revalidatingCurrentProject =
      conversationsLoadedProjectIdRef.current === project.id;
    const generation = conversationMaterializationGenerationController.begin();
    const requestWorkspaceContext = null;
    conversationMaterializationRecoveryRef.current = null;
    setPendingEmptyConversationSeed(null);
    setConversationLoadFailure(null);
    setError(null);
    if (!revalidatingCurrentProject) {
      setConversations([]);
      setActiveConversationId(null);
      setMessagesConversationId(null);
      setFailedMessagesConversationId(null);
      setMessageLoadRetryNonce(0);
      setMessages([]);
      setStreaming(false);
      streamingConversationIdRef.current = null;
      setStreamingConversationId(null);
      setArtifact(null);
      savedArtifactRef.current = null;
    }
    (async () => {
      try {
        let list = await listConversationsWithRetry(
          project.id,
        );
        if (cancelled) return;
        // A conversation created from the sidebar while this read was in flight
        // is what the URL names but the read predates. Ask once more before the
        // default pick below overrules the URL.
        if (!listNamesConversation(list, routeConversationIdRef.current)) {
          list = await listConversations(project.id, { throwOnError: true }).catch(() => list);
          if (cancelled) return;
        }
        conversationsLoadedProjectIdRef.current = project.id;
        if (list.length === 0) {
          // Conversation reads can settle before collaboration ownership. Keep
          // the empty result and let the effect below seed only after the
          // fail-closed viewer gate proves this caller may mutate. This avoids
          // both a member's POST -> 403 loop and reloading the whole transcript
          // when status later confirms an owner.
          setConversations([]);
          setActiveConversationId(null);
          setPendingEmptyConversationSeed({
            projectId: project.id,
            authorityKey: projectRunAuthorityKey,
          });
        } else {
          setPendingEmptyConversationSeed(null);
          setConversations(list);
          // Issue #1505: when the URL deep-links to a specific
          // conversation, prefer that one. Falls through to list[0]
          // when the routed id is null or no longer present (the
          // routine row may have been deleted between the route
          // landing and the conversation list loading).
          const routedId = routeConversationIdRef.current;
          const routedMatch = routedId
            ? list.find((c) => c.id === routedId) ?? null
            : null;
          const retainedMatch = revalidatingCurrentProject
            ? list.find((c) => c.id === activeConversationIdRef.current) ?? null
            : null;
          setActiveConversationId(
            retainedMatch?.id ?? routedMatch?.id ?? list[0]!.id,
          );
        }
      } catch (err) {
        if (cancelled) return;
        console.warn('Could not load conversations for this project', err);
        const message = t('project.conversationsLoadFailed');
        conversationMaterializationRecoveryRef.current = null;
        setPendingEmptyConversationSeed(null);
        const accessRevoked =
          err instanceof ProjectConversationsHttpError
          && (err.status === 401 || err.status === 403);
        if (!revalidatingCurrentProject || accessRevoked) {
          setConversations([]);
          setActiveConversationId(null);
        }
        setConversationLoadFailure({ message, source: 'read' });
        setError(message);
      }
    })();
    return () => {
      cancelled = true;
      conversationMaterializationGenerationController.invalidate(generation);
      if (
        conversationMaterializationRecoveryRef.current?.generation
        === generation
      ) {
        conversationMaterializationRecoveryRef.current = null;
      }
    };
  }, [ conversationMaterializationGenerationController, project.id, projectReadsHeld, projectRunAuthorityKey]);

  const recoverMaterializedConversations = useCallback(async (
    signalProjectId: string,
    signalAuthorityKey: string,
  ) => {
    const recovery = conversationMaterializationRecoveryRef.current;
    if (!recovery) return;
    if (recovery.projectId !== signalProjectId) return;
    if (recovery.authorityKey !== signalAuthorityKey) return;
    if (!conversationMaterializationGenerationController.isCurrent(recovery.generation)) return;
    if (projectIdRef.current !== recovery.projectId) return;
    if (projectRunAuthorityKeyRef.current !== recovery.authorityKey) return;
    if (conversationMaterializationRecoveryInFlightRef.current === recovery) return;
    conversationMaterializationRecoveryInFlightRef.current = recovery;
    try {
      // Materialization completion is already our retry signal, so perform one
      // exact-scoped read here instead of extending the fixed initial retry
      // schedule. A still-early 404 leaves recovery armed for the next signal.
      const list = await listConversations(recovery.projectId);
      if (conversationMaterializationRecoveryRef.current !== recovery) return;
      if (!conversationMaterializationGenerationController.isCurrent(recovery.generation)) return;
      if (projectIdRef.current !== recovery.projectId) return;
      if (projectRunAuthorityKeyRef.current !== recovery.authorityKey) return;

      conversationMaterializationRecoveryRef.current = null;
      setConversationLoadFailure(null);
      setError((current) => (
        current === recovery.errorMessage ? null : current
      ));
      if (list.length === 0) {
        setConversations([]);
        setActiveConversationId(null);
        setPendingEmptyConversationSeed({
          projectId: recovery.projectId,
          authorityKey: recovery.authorityKey,
        });
        return;
      }

      setPendingEmptyConversationSeed(null);
      setConversations(list);
      const routedMatch = routeConversationId
        ? list.find((candidate) => candidate.id === routeConversationId) ?? null
        : null;
      setActiveConversationId(routedMatch ? routedMatch.id : list[0]!.id);
    } catch (err) {
      if (conversationMaterializationRecoveryRef.current !== recovery) return;
      if (!conversationMaterializationGenerationController.isCurrent(recovery.generation)) return;
      if (projectIdRef.current !== recovery.projectId) return;
      if (projectRunAuthorityKeyRef.current !== recovery.authorityKey) return;
      if (
        err instanceof ProjectConversationsHttpError
        && err.status === 404
      ) {
        return;
      }
      // A completion signal exposed a settled non-404 failure. Stop treating
      // it as a materialization race and surface that exact response now; a
      // later project/authority load owns only any further retry.
      conversationMaterializationRecoveryRef.current = null;
      console.warn('Could not load conversations for this project', err);
      const message = t('project.conversationsLoadFailed');
      setConversationLoadFailure({ message, source: 'read' });
      setError((current) => reconcileConversationRecoveryGlobalError(
        current,
        recovery.errorMessage,
        message,
      ));
    } finally {
      if (conversationMaterializationRecoveryInFlightRef.current === recovery) {
        conversationMaterializationRecoveryInFlightRef.current = null;
      }
    }
  }, [conversationMaterializationGenerationController, routeConversationId]);


  const emptyConversationReadOnlySettled =
    false;
  useEffect(() => {
    if (
      !pendingEmptyConversationSeed
      || pendingEmptyConversationSeed.projectId !== project.id
      || pendingEmptyConversationSeed.authorityKey !== projectRunAuthorityKey
    ) {
      return;
    }
    let cancelled = false;
    const requestWorkspaceContext = null;
    (async () => {
      try {
        const fresh = await createConversation(project.id, undefined, {

        });
        if (cancelled) return;
        if (!fresh) {
          throw new Error('Could not create a conversation for this project.');
        }
        setPendingEmptyConversationSeed(null);
        setConversations([fresh]);
        setActiveConversationId(fresh.id);
      } catch (err) {
        if (cancelled) return;
        console.warn('Could not create a conversation for this project', err);
        const message = t('project.conversationsLoadFailed');
        setPendingEmptyConversationSeed(null);
        setConversationLoadFailure({ message, source: 'create' });
        setError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingEmptyConversationSeed, true, project.id, projectRunAuthorityKey]);

  // Everything a conversation switch drops, committed together with the new
  // active id so no frame draws the old turn under the new conversation. A
  // running turn is only detached here: the daemon run keeps going, and the
  // cleanup effect below releases its local stream consumer.
  const beginConversationSwitch = useCallback((id: string) => {
    setMessages([]);
    setArtifact(null);
    setStreaming(false);
    streamingConversationIdRef.current = null;
    setStreamingConversationId(null);
    setMessagesConversationId(null);
    setFailedMessagesConversationId(null);
    setConversationLoadFailure(null);
    messagesConversationIdRef.current = null;
    messagesAuthorityKeyRef.current = null;
    activeConversationIdRef.current = id;
    setActiveConversationId(id);
  }, []);

  // The list is a cache of what the daemon knows, and the sidebar writes to it
  // without telling this view. So the conversation just followed may simply not
  // be listed yet. One fresh read settles it: listed, and the pane's history
  // catches up; not listed, and the URL named nothing real, so fall back the way
  // a stale deep link does and correct the address.
  const syncConversationsWithFollowedRoute = useCallback(async (followedId: string) => {
    const capturedProjectId = project.id;
    const myToken = ++conversationsRefreshTokenRef.current;
    let list: Conversation[];
    try {
      list = await listConversations(capturedProjectId, { throwOnError: true });
    } catch {
      // An unreadable list says nothing about the conversation. Its transcript
      // read reports the failure in the pane.
      return;
    }
    if (projectIdRef.current !== capturedProjectId) return;
    if (conversationsRefreshTokenRef.current !== myToken) return;
    setConversations(list);
    if (list.some((conversation) => conversation.id === followedId)) return;
    if (activeConversationIdRef.current !== followedId) return;
    const fallback = list[0];
    if (fallback) {
      beginConversationSwitch(fallback.id);
      // The fallback may be the conversation the pane left a moment ago, in
      // which case the active id ends where it began and nothing else reloads
      // the transcript just cleared.
      setMessageLoadRetryNonce((nonce) => nonce + 1);
      navigate(
        {
          kind: 'project',
          projectId: capturedProjectId,
          conversationId: fallback.id,
          fileName: routeFileName ?? null,
        },
        { replace: true },
      );
    } else {
      setActiveConversationId(null);
      setPendingEmptyConversationSeed({
        projectId: capturedProjectId,
        authorityKey: projectRunAuthorityKeyRef.current,
      });
    }
  }, [beginConversationSwitch, project.id, routeFileName]);

  // The pane and the URL name the same conversation; see
  // `routedConversationVerdict` for the rule. Following does not wait for the
  // list, so the pane switches the moment the route does.
  useEffect(() => {
    const verdict = routedConversationVerdict({
      routeId: routeConversationId,
      previousRouteId: lastSeenRouteConversationIdRef.current,
      activeId: activeConversationId,
      lastPushedId: lastSyncedConversationIdRef.current,
    });
    lastSeenRouteConversationIdRef.current = routeConversationId;
    if (verdict !== 'follow' || !routeConversationId) return;
    beginConversationSwitch(routeConversationId);
    if (!conversations.some((conversation) => conversation.id === routeConversationId)) {
      void syncConversationsWithFollowedRoute(routeConversationId);
    }
  }, [routeConversationId, conversations, activeConversationId, beginConversationSwitch, syncConversationsWithFollowedRoute]);

  // Reset chat pane to the open default on project switch.
  useEffect(() => {
    setWorkspaceFocused(false);
  }, [project.id]);


  // Load messages whenever the active conversation changes. This happens
  // on project mount (after conversations load) and on user-triggered
  // conversation switches.
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      setMessagesInitialized(false);
      setMessagesConversationId(null);
      setFailedMessagesConversationId(null);
      messagesConversationIdRef.current = null;
      messagesAuthorityKeyRef.current = null;
      loadedTranscriptRef.current = null;
      setStreaming(false);
      streamingConversationIdRef.current = null;
      setStreamingConversationId(null);
      return;
    }
    const createdEmptyTranscript = createdEmptyTranscriptRef.current;
    createdEmptyTranscriptRef.current = null;
    if (
      createdEmptyTranscript?.projectId === project.id
      && createdEmptyTranscript.conversationId === activeConversationId
      && createdEmptyTranscript.authorityKey === projectRunAuthorityKey
    ) return;
    const reloadingCurrentConversation =
      messagesConversationIdRef.current === activeConversationId
      && messagesAuthorityKeyRef.current === projectRunAuthorityKey;
    const loadedTranscript = loadedTranscriptRef.current;
    const preservingLoadedTranscript =
      messagesConversationIdRef.current === activeConversationId
      && loadedTranscript?.projectId === project.id
      && loadedTranscript.conversationId === activeConversationId
      && loadedTranscript.principalKey !== null
      && loadedTranscript.principalKey === readableTranscriptPrincipalRef.current;
    const liveReloadMessageIds = new Set<string>();
    if (
      messagesConversationIdRef.current === activeConversationId
      && streamingConversationIdRef.current === activeConversationId
      && abortRef.current !== null
      && cancelRef.current !== null
      && projectResourceAuthorityRef.current === 'local'
    ) {
      const currentMessages = messagesRef.current;
      let assistantIndex = -1;
      for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
        const message = currentMessages[index];
        if (message?.role === 'assistant' && isActiveRunStatus(message.runStatus)) {
          liveReloadMessageIds.add(message.id);
          assistantIndex = index;
          break;
        }
      }
      for (let index = assistantIndex - 1; index >= 0; index -= 1) {
        const message = currentMessages[index];
        if (message?.role !== 'user') continue;
        liveReloadMessageIds.add(message.id);
        break;
      }
    }
    const preservingLiveConversation = liveReloadMessageIds.size > 0;
    const liveReloadController = preservingLiveConversation ? abortRef.current : null;
    // Reset the initialized flag so auto-send waits for this authoritative DB
    // read to settle before checking messages.length. A confirmed readable
    // scope for the same principal may keep already-loaded history visible;
    // this does not replace the full authority key used for the fresh request.
    // Other authority handoffs retain only the existing live-turn exception.
    setMessagesInitialized(false);
    let cancelled = false;
    const transcriptController = new AbortController();
    const requestWorkspaceContext = null;
    setFailedMessagesConversationId(null);
    if (!preservingLiveConversation) {
      if (!preservingLoadedTranscript) setMessagesConversationId(null);
      setStreaming(false);
      streamingConversationIdRef.current = null;
      setStreamingConversationId(null);
    }
    if (!reloadingCurrentConversation && !preservingLoadedTranscript) {
      setMessages((current) =>
        preservingLiveConversation
          ? current.filter((message) => liveReloadMessageIds.has(message.id))
          : [],
      );
      setArtifact(null);
      savedArtifactRef.current = null;
    }
    if (!reloadingCurrentConversation && !preservingLiveConversation && !preservingLoadedTranscript) {
      messagesConversationIdRef.current = null;
      messagesAuthorityKeyRef.current = null;
      loadedTranscriptRef.current = null;
    }
    (async () => {
      try {
        const list = await loadConversationTranscript(project.id, activeConversationId, transcriptController.signal);
        if (cancelled) return;
        // Capture ownership when this GET is admitted, before queuing React's
        // updater. The same batch may next clear the controller on terminal
        // status and enqueue its final buffer flush. Reading refs inside the
        // delayed updater would accept the full GET and then append that flush
        // again. A GET admitted after termination still takes normal history.
        const liveAssistantMessageIds =
          liveReloadController !== null
          && abortRef.current === liveReloadController
          && !liveReloadController.signal.aborted
          && streamingConversationIdRef.current === activeConversationId
          && projectResourceAuthorityRef.current === 'local'
            ? liveReloadMessageIds
            : undefined;
        setMessages((current) =>
          preservingLiveConversation
            ? mergeServerMessagesIntoConversation(
                current.filter((message) => liveReloadMessageIds.has(message.id)),
                list,
                { liveAssistantMessageIds },
              )
            : normalizeConversationMessageOrder(list),
        );
        const latestRun = latestConversationRun(list);
        if (latestRun) rememberConversationAgent(activeConversationId, latestRun.agentId);
        setMessagesInitialized(true);
        setArtifact(null);
        setError(null);
        savedArtifactRef.current = null;
        messagesConversationIdRef.current = activeConversationId;
        messagesAuthorityKeyRef.current = projectRunAuthorityKey;
        loadedTranscriptRef.current = {
          projectId: project.id,
          conversationId: activeConversationId,
          principalKey: "local",
        };
        setMessagesConversationId(activeConversationId);
        setFailedMessagesConversationId(null);
      } catch (err) {
        if (cancelled) return;
        loadedTranscriptRef.current = null;
        console.warn('Could not load messages for this conversation', err);
        // A failed read carries the daemon's or the network's text, never ours.
        const message = t('project.conversationsLoadFailed');
        if (!reloadingCurrentConversation) {
          setMessages((current) =>
            preservingLiveConversation
              ? current.filter((item) => liveReloadMessageIds.has(item.id))
              : [],
          );
          setArtifact(null);
          savedArtifactRef.current = null;
        }
        setError(message);
        if (!preservingLiveConversation) {
          messagesConversationIdRef.current = null;
          messagesAuthorityKeyRef.current = null;
          setMessagesConversationId(null);
        }
        setFailedMessagesConversationId(activeConversationId);
      }
    })();
    return () => {
      cancelled = true;
      transcriptController.abort();
    };
  }, [project.id, activeConversationId, messageLoadRetryNonce, projectRunAuthorityKey]);

  useEffect(() => {
    return () => {
      sendTextBufferRef.current?.cancel();
      sendTextBufferRef.current = null;
      // Unmounts / conversation switches should only detach local stream
      // consumers. Aborting the daemon cancel controllers here turns routine
      // cleanup into an explicit POST /api/runs/:id/cancel, which can mark a
      // live run canceled even when the user never clicked Stop.
      abortRef.current?.abort();
      abortRef.current = null;
      cancelRef.current = null;
      for (const textBuffer of reattachTextBuffersRef.current) textBuffer.cancel();
      reattachTextBuffersRef.current.clear();
      for (const controller of reattachControllersRef.current.values()) {
        if (abortRef.current === controller) abortRef.current = null;
        controller.abort();
      }
      for (const controller of reattachCancelControllersRef.current.values()) {
        // Route changes should only detach the browser-side SSE listener.
        // Aborting this signal maps to POST /cancel, so leave the daemon run alive.
        if (cancelRef.current === controller) cancelRef.current = null;
      }
      reattachControllersRef.current.clear();
      reattachCancelControllersRef.current.clear();
    };
  }, [project.id, activeConversationId]);

  const cancelSendTextBuffer = useCallback((flushPending = false) => {
    if (flushPending) sendTextBufferRef.current?.flush();
    sendTextBufferRef.current?.cancel();
    sendTextBufferRef.current = null;
  }, []);

  const cancelReattachTextBuffers = useCallback((flushPending = false) => {
    for (const textBuffer of reattachTextBuffersRef.current) {
      if (flushPending) textBuffer.flush();
      textBuffer.cancel();
    }
    reattachTextBuffersRef.current.clear();
  }, []);

  /* The conversation in front of the user has no unseen reply: mark it seen
     when it opens, when its run ends, and when the window comes back. */
  useEffect(() => {
    if (!activeConversationId) return;
    const mark = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') markConversationSeen(activeConversationId);
    };
    mark();
    window.addEventListener('focus', mark);
    return () => { window.removeEventListener('focus', mark); mark(); };
  }, [activeConversationId, streaming]);

  // The taskbar button shows work in progress while this project's run is going.
  useEffect(() => {
    const attention = getOpenPixoHost()?.attention;
    if (!attention) return;
    attention.setRunning(streaming);
    return () => { if (streaming) attention.setRunning(false); };
  }, [streaming]);

  const notifyCompletedRun = useCallback((last: ChatMessage) => {
    // Round 7 (mrcfps @ useDesignMdState.ts:131): a chat turn just
    // settled — conversation updatedAt almost certainly moved, so
    // recompute DESIGN.md staleness even when the turn produced no
    // file mutations or live artifacts.
    setDesignMdRefreshKey((n) => n + 1);

    const status =
      last.resultDeliveryState === 'no_result' ||
      last.resultDeliveryState === 'delivery_failed'
        ? 'failed'
        : last.runStatus;
    if (status !== 'succeeded' && status !== 'failed') return;

    // The desktop flashes the taskbar button only when the window is in the background.
    getOpenPixoHost()?.attention?.request();

    const cfg = config.notifications ?? DEFAULT_NOTIFICATIONS;
    if (cfg.soundEnabled) {
      playSound(status === 'succeeded' ? cfg.successSoundId : cfg.failureSoundId);
    }

    if (cfg.desktopEnabled) {
      // System notifications are useful only when the task is not already in
      // front of the user. Sounds remain independent feedback for both states.
      const isHidden = typeof document !== 'undefined' && document.hidden;
      const isFocused = typeof document === 'undefined' ? true : document.hasFocus();
      if (isHidden || !isFocused) {
        const title = status === 'succeeded'
          ? t('notify.successTitle')
          : t('notify.failureTitle');
        const fallbackBody = status === 'succeeded'
          ? t('notify.successBody')
          : t('notify.failureBody');
        const trimmed = (last.content ?? '').trim();
        const body = trimmed ? trimmed.slice(0, 80) : fallbackBody;
        void showCompletionNotification({
          status,
          title,
          body,
          onClick: () => {
            if (typeof window !== 'undefined') window.focus();
          },
        });
      }
    }
  }, [config.notifications, t]);

  // Fire completion feedback from assistant run-status transitions rather than
  // from the local SSE listener state. A run can finish while its conversation
  // is detached; when the user returns, the terminal status should still produce
  // the one completion notification for runs this view previously saw active.
  useEffect(() => {
    const completedMessages: ChatMessage[] = [];
    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      const keys = message.runId ? [message.runId, message.id] : [message.id];
      if (isActiveRunStatus(message.runStatus)) {
        for (const key of keys) activeCompletionNotificationRunsRef.current.add(key);
        continue;
      }
      if (message.runStatus !== 'succeeded' && message.runStatus !== 'failed') continue;
      if (message.runStatus === 'succeeded' && designDeliveryVerificationPending(message)) continue;
      if (!keys.some((key) => activeCompletionNotificationRunsRef.current.has(key))) continue;
      if (keys.some((key) => completedNotificationRunsRef.current.has(key))) continue;
      for (const key of keys) completedNotificationRunsRef.current.add(key);
      completedMessages.push(message);
    }

    for (const message of completedMessages) notifyCompletedRun(message);
  }, [messages, notifyCompletedRun]);

  // Hydrate the open-tabs state once per project. After this initial
  // load, every mutation flows through saveTabsState() which keeps DB +
  // local state coherent.
  useEffect(() => {
    if (projectReadsHeld) return;
    let cancelled = false;
    const requestWorkspaceContext = null;
    tabsLoadedRef.current = false;
    tabsHydratedFromSavedStateRef.current = false;
    hasAppliedInitialPrimaryOpenRef.current = false;
    setOpenTabsState({ tabs: [], active: null });
    (async () => {
      const state = await loadTabs(project.id, {
        reconcileNewerCacheToDaemon: projectTabsCanPersistToDaemonRef.current,
      });
      if (cancelled) return;
      const routeActive = routeFileNameRef.current;
      let nextState = routeActive
        ? {
            ...state,
            tabs: state.tabs.includes(routeActive)
              ? state.tabs
              : [...state.tabs, routeActive],
            active: routeActive,
          }
        : state;
      const routeChangesSavedState = Boolean(
        routeActive
        && (
          state.active !== routeActive
          || !state.tabs.includes(routeActive)
        ),
      );
      if (routeActive && routeChangesSavedState) {
        nextState = cacheTabsLocally(project.id, nextState);
        if (projectTabsCanPersistToDaemonRef.current) {
          void persistTabsToDaemonNow(project.id, nextState);
        }
      }
      tabsHydratedFromSavedStateRef.current = state.hasSavedState === true;
      setOpenTabsState(nextState);
      tabsLoadedRef.current = true;
      setTabsHydrationVersion((version) => version + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, projectReadsHeld, projectRunAuthorityKey]);

  // Debounce the canonical (daemon + SQLite) tab-state write. The embedded
  // browser fans out url/title/favicon updates in bursts on a single page load
  // (did-navigate, did-navigate-in-page, page-title-updated, favicon), and each
  // used to be a localStorage write + HTTP PUT + SQLite UPDATE + re-render.
  // We keep React state and the local cache IMMEDIATE (so the UI and a reload
  // are never stale) and coalesce only the daemon PUT.
  const tabsDaemonSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDaemonTabsRef = useRef<{
    projectId: string;
    state: OpenTabsState;

  } | null>(null);
  const flushTabsDaemonSave = useCallback(() => {
    if (tabsDaemonSaveTimerRef.current != null) {
      clearTimeout(tabsDaemonSaveTimerRef.current);
      tabsDaemonSaveTimerRef.current = null;
    }
    const pending = pendingDaemonTabsRef.current;
    pendingDaemonTabsRef.current = null;
    if (pending) {
      void persistTabsToDaemonNow(pending.projectId, pending.state);
    }
  }, []);

  const persistTabsState = useCallback(
    (next: OpenTabsState) => {
      // A tab activation the host did not ask for is the user steering the
      // preview themselves. See `userTookOverPreviewRef` for why that outranks
      // an agent's `<pixo-focus open="…">`.
      if (next.active && next.active !== lastHostRequestedOpenRef.current) {
        userTookOverPreviewRef.current = true;
      }
      setOpenTabsState(next);
      if (!tabsLoadedRef.current) return;
      // Immediate, cheap, synchronous — keeps the cache canonical for reload.
      const stamped = cacheTabsLocally(project.id, next);

      pendingDaemonTabsRef.current = {
        projectId: project.id,
        state: stamped,

      };
      if (tabsDaemonSaveTimerRef.current != null) {
        clearTimeout(tabsDaemonSaveTimerRef.current);
      }
      tabsDaemonSaveTimerRef.current = setTimeout(() => {
        tabsDaemonSaveTimerRef.current = null;
        const pending = pendingDaemonTabsRef.current;
        pendingDaemonTabsRef.current = null;
        if (pending) {
          void persistTabsToDaemonNow(pending.projectId, pending.state);
        }
      }, TAB_PERSIST_DEBOUNCE_MS);
    },
    [project.id, null, true],
  );

  // Revocation can arrive without another tab interaction. Discard a queued
  // write immediately instead of letting its old authority fire after the
  // project has become read-only.
  useEffect(() => {
    return;

  }, [true]);

  // Flush any pending tab write when the project changes or the view unmounts,
  // so a fast project switch / close doesn't leave the daemon a debounce behind.
  useEffect(
    () => flushTabsDaemonSave,
    [flushTabsDaemonSave, project.id],
  );

  const handleActiveWorkspaceContextChange = useCallback((next: WorkspaceContextItem | null) => {
    setActiveWorkspaceContext((current) =>
      workspaceContextItemEqual(current, next) ? current : next,
    );
  }, []);

  const handleWorkspaceContextsChange = useCallback((next: WorkspaceContextItem[]) => {
    // This runs in a post-commit effect inside FileWorkspace: on any tab
    // mutation the workspace-context set changes and this setState schedules a
    // SECOND full render of the entire ProjectView -> FileWorkspace ->
    // FileViewer tree, on top of the tab-state render that triggered it. The
    // result only feeds the composer's @-mention context picker, which never
    // needs to update in the same frame the user closes a tab. Marking it as a
    // transition lets the urgent tab-close render commit first (tab disappears
    // immediately) and defers this heavy second pass so it no longer stalls the
    // interaction.
    startTransition(() => {
      setWorkspaceContexts((current) =>
        workspaceContextItemsEqual(current, next) ? current : next,
      );
    });
  }, []);

  const refreshProjectFiles = useCallback(async (
    options?: { fresh?: boolean; afterChange?: boolean },
    onAcceptedGeneration?: (generation: number) => void,
  ): Promise<ProjectFile[]> => {
    const requestSeq = ++projectFilesRequestSeqRef.current;
    const requestedRefreshKey = filesRefreshRequestKeyRef.current;
    let next: ProjectFile[];
    try {
      next = await fetchProjectFiles(project.id, {
        requireAuthoritative: true,
        ...(options?.fresh ? { fresh: true } : {}),
        ...(options?.afterChange ? { afterChange: true } : {}),
      });
    } catch {
      // A transport/HTTP failure is not an authoritative empty directory.
      // Keep the last accepted snapshot and generation, while preserving the
      // refresh helper's historical resolved-list contract for its callers.
      return projectFilesRef.current;
    }
    if (requestSeq === projectFilesRequestSeqRef.current) {
      const acceptedGeneration = projectFilesGenerationRef.current + 1;
      projectFilesGenerationRef.current = acceptedGeneration;
      projectFilesRef.current = next;
      // Commit the list and both observation witnesses atomically. A refresh
      // request must never publish a new key or generation alongside an older
      // file snapshot.
      setProjectFilesSnapshot({
        files: next,
        refreshKey: requestedRefreshKey,
        generation: acceptedGeneration,
      });
      onAcceptedGeneration?.(acceptedGeneration);
    }
    return next;
  }, [project.id, projectRunAuthorityKey]);

  useEffect(() => {
    projectFilesRef.current = projectFiles;
  }, [projectFiles]);

  // Cache HTML file contents so the auto-open module check (issue #2744) does
  // not re-fetch unchanged entries on every Write. Keyed by file name with the
  // mtime stored alongside, so a rewrite REPLACES the file's single entry
  // rather than accreting a new key. Bounded by the project's HTML file count.
  const htmlContentCacheRef = useRef<Map<string, { mtime: number; text: string | null }>>(
    new Map(),
  );
  const readProjectHtml = useCallback(
    async (name: string): Promise<string | null> => {
      const file = projectFilesRef.current.find((entry) => entry.name === name);
      const mtime = file?.mtime ?? 0;
      const cached = htmlContentCacheRef.current.get(name);
      if (cached && cached.mtime === mtime) return cached.text;
      try {
        const text = await fetchProjectFileText(project.id, name);
        htmlContentCacheRef.current.set(name, { mtime, text });
        return text;
      } catch {
        htmlContentCacheRef.current.set(name, { mtime, text: null });
        return null;
      }
    },
    [project.id, projectRunAuthorityKey],
  );

  const refreshWorkspaceItems = useCallback(async (
    options?: { freshProjectFiles?: boolean },
    onAcceptedFilesGeneration?: (generation: number) => void,
  ): Promise<ProjectFile[]> => {
    if (projectReadsHeld) return [];
    const [nextFiles] = await Promise.all([
      refreshProjectFiles({ fresh: options?.freshProjectFiles }, onAcceptedFilesGeneration),
      ]);
    return nextFiles;
  }, [projectReadsHeld, refreshProjectFiles]);

  const recordManualFileWrite = useCallback((file: ProjectFile) => {
    for (const [controller, run] of manualFileWritesByRunRef.current) {
      if ((run.detached || !controller.signal.aborted) && run.projectId === project.id
        && run.authorityKey === projectRunAuthorityKey) {
        run.files.set(file.name, { ...file });
      }
    }
  }, [project.id, projectRunAuthorityKey]);

  const findDetachedManualFileWrites = useCallback((conversationId: string, runId: string) => {
    for (const run of manualFileWritesByRunRef.current.values()) {
      if (run.detached && run.projectId === project.id
        && run.authorityKey === projectRunAuthorityKey
        && run.conversationId === conversationId && run.runId === runId) return run;
    }
    return undefined;
  }, [project.id, projectRunAuthorityKey]);

  const registerManualFileWrites = useCallback((
    controller: AbortController,
    files: Map<string, ProjectFile>,
    conversationId: string,
    runId: string | null = null,
  ) => {
    const previous = runId ? findDetachedManualFileWrites(conversationId, runId) : undefined;
    if (previous) {
      for (const [name, file] of previous.files) files.set(name, file);
      previous.dispose();
    }
    let retained = 0;
    let generation = 0;
    let disposalRequested = false;
    let disposed = false;
    const onAbort = () => dispose(true);
    const dispose = (force = false) => {
      if (disposed) return;
      if (!force && retained > 0) {
        disposalRequested = true;
        return;
      }
      disposed = true;
      manualFileWritesByRunRef.current.delete(controller);
      controller.signal.removeEventListener('abort', onAbort);
    };
    const entry = {
      projectId: project.id, authorityKey: projectRunAuthorityKey,
      conversationId, runId, detached: false, files, dispose,
      retain: () => {
        if (disposed) return () => {};
        const retainedGeneration = generation;
        retained += 1;
        let released = false;
        return () => {
          if (released || generation !== retainedGeneration) return;
          released = true;
          retained -= 1;
          if (retained === 0 && disposalRequested) dispose();
        };
      },
    };
    manualFileWritesByRunRef.current.set(controller, entry);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    return {
      bindRun: (nextRunId: string) => {
        // A strategy successor can reuse the assistant and transport, but its
        // physical run must not inherit a predecessor's ownership receipts.
        if (entry.runId && entry.runId !== nextRunId) {
          files.clear();
          // An older recovery's finally must not dispose a successor's writer.
          generation += 1;
          retained = 0;
          disposalRequested = false;
        }
        entry.runId = nextRunId;
      },
      release: (recoverable = false) => {
        if (recoverable && entry.runId && !controller.signal.aborted) {
          // Keep observing real writes between transports, including during
          // the status probe/backoff. Only the same scoped physical run adopts it.
          entry.detached = true;
          controller.signal.removeEventListener('abort', onAbort);
        } else dispose();
      },
    };
  }, [project.id, projectRunAuthorityKey, findDetachedManualFileWrites]);

  const refreshFileWorkspace = useCallback(async (
    options?: { fresh?: boolean },
  ): Promise<FileRefreshResult> => {
    let acceptedGeneration: number | null = null;
    await refreshWorkspaceItems(
      { freshProjectFiles: options?.fresh },
      (generation) => { acceptedGeneration = generation; },
    );
    return { acceptedGeneration };
  }, [refreshWorkspaceItems]);

  const previousMaterializationDownloadRef = useRef<{
    projectId: string;
    authorityKey: string;
    pending: boolean;
  } | null>(null);
  useEffect(() => {
    const previous = previousMaterializationDownloadRef.current;
    const sameAuthority = previous?.projectId === project.id
      && previous.authorityKey === projectRunAuthorityKey;
    previousMaterializationDownloadRef.current = {
      projectId: project.id,
      authorityKey: projectRunAuthorityKey,
      pending: false,
    };
    if (
      !sameAuthority
      || !previous.pending
    ) {
      return;
    }

    // The first file read for a newly opened Team mirror can legitimately
    // observe the empty placeholder directory. Materialization replaces that
    // directory without producing a chokidar event for a stream that was not
    // connected yet, so settling the download is itself an authoritative file
    // invalidation. Fence the placeholder snapshot and fetch the exact scoped
    // directory now; otherwise the first view stays empty until it is reopened.
    invalidateProjectFilesCache(project.id);
    void refreshWorkspaceItems({ freshProjectFiles: true }).catch(() => {
      // Preserve the last accepted snapshot on a transient transport failure.
      // The project event stream and ordinary refresh paths remain retries.
    });
    void recoverMaterializedConversations(project.id, projectRunAuthorityKey);
  }, [project.id, projectRunAuthorityKey, false, recoverMaterializedConversations, refreshWorkspaceItems]);

  useEffect(() => {
    // The default only fills a first load that named nothing. A file URL already
    // chose what opens, so leaving that file must not bring the default in.
    if (routeFileName) {
      hasAppliedInitialPrimaryOpenRef.current = true;
      return;
    }
    if (!tabsLoadedRef.current) return;
    if (hasAppliedInitialPrimaryOpenRef.current) return;
    if (openTabsState.active || openTabsState.tabs.length > 0) {
      hasAppliedInitialPrimaryOpenRef.current = true;
      return;
    }
    if (tabsHydratedFromSavedStateRef.current) {
      hasAppliedInitialPrimaryOpenRef.current = true;
      return;
    }
    const primaryFile = selectPrimaryProjectFile(
      projectFiles,
      refreshInitialHomeAttachmentFileNames(),
    );
    if (!primaryFile) return;
    hasAppliedInitialPrimaryOpenRef.current = true;
    // This default is a host selection, just like requestOpenFile. Persisting
    // it must not turn an automatically opened search image into a user veto.
    lastHostRequestedOpenRef.current = primaryFile.name;
    persistTabsState({ tabs: [primaryFile.name], active: primaryFile.name });
  }, [openTabsState.active, openTabsState.tabs.length, persistTabsState, projectFiles, refreshInitialHomeAttachmentFileNames, routeFileName]);

  /**
   * The last file the HOST asked to open. Everything the host opens — an
   * auto-open decision, a Share/Download affordance, a route restore — goes
   * through `requestOpenFile`, so a tab activation that lands anywhere ELSE is
   * the user's own click.
   */
  const lastHostRequestedOpenRef = useRef<string | null>(null);
  /**
   * True once the user has taken the preview over during the current run.
   *
   * Read by the `<pixo-focus open="…">` handler, which declines rather than yank
   * the tab away. Reset when a run starts: taking over during turn N says
   * nothing about turn N+1.
   *
   * Known false negative, accepted: the user clicking BACK to the file the host
   * last opened is indistinguishable from the host's own open. The cost is that
   * a later agent `open` may still fire in that one case, and the cost of
   * closing it would be threading a "who asked" flag through FileWorkspace's
   * whole tab surface.
   */
  const userTookOverPreviewRef = useRef(false);

  const requestOpenFile = useCallback((name: string) => {
    if (!name) return;
    lastHostRequestedOpenRef.current = name;
    setOpenRequest({ name, nonce: Date.now() });
  }, []);
  /**
   * A file the USER opened from the conversation — a file link, an artifact
   * card, an inline asset, Download, a file URL. Unlike the host-driven
   * `requestOpenFile` (auto-open, `<pixo-focus open>`), it switches the panel
   * to 资源库 and shows a hidden panel (specs/current/openpixo-game-panel.md §3).
   */
  const requestConversationOpenFile = useCallback((name: string) => {
    if (!name) return;
    lastHostRequestedOpenRef.current = name;
    revealPanel();
    setOpenRequest({ name, nonce: Date.now(), origin: 'conversation' });
  }, [revealPanel]);

  /**
   * Open a finished turn's artifacts together, with `focused` selected.
   *
   * Product ruling 2026-09-04 (OPEND-2588): 「就让 agent 生成完,把那些产物在右侧
   * 全打开呗」—— 「是全部的**主要**产物」. Auto-open used to open exactly ONE file
   * per turn, so a batch that generated four images left two of them with no
   * tab. Which artifacts qualify is still `auto-open-file.ts`'s call; this only
   * stops throwing the rest away.
   *
   * Deliberately ONE request rather than a `requestOpenFile` loop: `openRequest`
   * is a single state slot, so successive calls in the same tick collapse to the
   * last name, and even spread across ticks each open would steal the focus that
   * the selection heuristic deliberately assigned to `focused`.
   */
  const requestOpenTurnArtifacts = useCallback(
    (names: readonly string[], focused: string) => {
      if (!focused) return;
      lastHostRequestedOpenRef.current = focused;
      // The batch is the complete, ordered tab list — `focused` included, so
      // the tab strip keeps file-list order instead of pushing the selected
      // artifact to the end.
      const openBatch = names.filter((name) => Boolean(name));
      setOpenRequest({
        name: focused,
        nonce: Date.now(),
        ...(openBatch.length > 1 ? { openBatch } : {}),
      });
    },
    [],
  );

  const persistArtifact = useCallback(
    async (
      art: Artifact,
      projectFilesSnapshot?: ProjectFile[],
      sourceText?: string,
      options: {
        pointerMinMtime?: number;
        isCurrent?: () => boolean;
        shouldOpen?: () => boolean;
      } = {},
    ) => {
      if (options.isCurrent && !options.isCurrent()) {
        return { ok: false as const, cancelled: true as const, error: undefined };
      }
      const persistedHtml = resolvePersistedArtifactHtml({
        artifactHtml: art.html,
        identifier: art.identifier,
        sourceText,
      });
      const artifactToPersist = persistedHtml === art.html ? art : { ...art, html: persistedHtml };
      const baseName = artifactBaseNameFor(art);
      const ext = artifactExtensionFor(art);
      const currentProjectFiles = projectFilesSnapshot ?? projectFilesRef.current;
      const existing = new Set(currentProjectFiles.map((f) => f.name));
      let fileName = `${baseName}${ext}`;
      // A non-empty identifier is stable artifact identity: when its canonical
      // filename already exists, update that file in place. Title- and
      // fallback-derived names still suffix collisions so new artifacts cannot
      // silently replace unrelated project files.
      const updatesExplicitlyIdentifiedFile =
        Boolean(art.identifier?.trim()) && existing.has(fileName);
      let collisionFileName = fileName;
      let n = 2;
      while (
        existing.has(collisionFileName) &&
        savedArtifactRef.current !== collisionFileName
      ) {
        collisionFileName = `${baseName}-${n}${ext}`;
        n += 1;
      }
      if (!updatesExplicitlyIdentifiedFile) fileName = collisionFileName;
      if (ext === '.html') {
        const pointerProjectFiles = filterProjectFilesByMinMtime(
          currentProjectFiles,
          options.pointerMinMtime,
        );
        const pointerTarget = resolveHtmlPointerArtifactTarget({
          content: artifactToPersist.html,
          candidateFileName: collisionFileName,
          projectFiles: pointerProjectFiles,
        });
        if (pointerTarget) {
          if (savedArtifactRef.current === pointerTarget) {
            return { ok: true as const, fileName: pointerTarget };
          }
          savedArtifactRef.current = pointerTarget;
          if (options.shouldOpen?.() !== false) requestOpenFile(pointerTarget);
          return { ok: true as const, fileName: pointerTarget };
        }
      }
      // Pre-write structural gate for HTML artifacts (#50, #1143). Reject
      // bodies that obviously aren't a complete document — usually a one-line
      // prose summary the model emitted inside `<artifact type="text/html">`
      // when only Edit-tool changes happened this turn. Without this guard,
      // such content lands as a phantom HTML file in the project panel.
      if (ext === '.html') {
        const validation = validateHtmlArtifact(artifactToPersist.html);
        if (!validation.ok) {
          const message =
            `Refused to save artifact "${art.identifier || art.title || 'untitled'}": ` +
            validation.reason;
          setError(message);
          return { ok: false as const, error: message };
        }
      }
      if (savedArtifactRef.current === fileName) {
        return { ok: true as const, fileName };
      }
      const title = art.title || art.identifier || fileName;
      const metadata = {
        identifier: art.identifier,
        artifactType: art.artifactType,
        inferred: false,
      };
      const manifest =
        ext === '.html'
          ? createHtmlArtifactManifest({
              entry: fileName,
              title,
              sourceSkillId: project.skillId ?? undefined,
              metadata,
            })
          : inferLegacyManifest({
              entry: fileName,
              title,
              metadata: {
                ...metadata,
                sourceSkillId: project.skillId ?? undefined,
              },
            });
      const file = await writeProjectTextFile(project.id, fileName, artifactToPersist.html, {
        artifactManifest: manifest ?? undefined,
      });
      // The server may have accepted the file before navigation, a new turn,
      // or access revocation. Do not apply that old response to the current UI.
      if (options.isCurrent && !options.isCurrent()) {
        return { ok: false as const, cancelled: true as const, error: undefined };
      }
      if (file) {
        savedArtifactRef.current = file.name;
        bumpFilesRefresh();
        // Surface the daemon's stub-guard warning when it fires in `warn`
        // mode (the default). Without this the warning would land in the
        // file metadata silently and the user would never see that the
        // model shipped a placeholder.
        if (file.stubGuardWarning) {
          setError(
            `Saved "${file.name}", but the model may have shipped a placeholder: ` +
              `${file.stubGuardWarning.message}`,
          );
        }
        // Auto-open the freshly-persisted artifact as a tab so the user
        // sees it without an extra click. The Write-tool path already does
        // this for tool-emitted files; this handles the artifact-tag path.
        // Evaluate at response time: a user can select another tab during POST.
        if (options.shouldOpen?.() !== false) requestOpenFile(file.name);
        return { ok: true as const, fileName: file.name };
      } else {
        // writeProjectTextFile collapses all failure paths (non-OK HTTP
        // responses, network errors, and stub-guard 422s) to null — the
        // helper's return contract would need to be widened to distinguish
        // them, which is out of scope here.  Show a generic banner so the
        // failure is observable rather than silent; the daemon logs carry
        // the structured details for any specific error type.
        // Clear the saved-artifact ref so the user can retry.
        savedArtifactRef.current = '';
        const message =
          `Couldn't save artifact "${fileName}". The write failed — ` +
          'check the daemon logs for details.';
        setError(message);
        return { ok: false as const, error: message };
      }
    },
    [project.id, project.skillId, null, requestOpenFile],
  );

  // What every turn finalization shares. Live completion narrows `shouldOpen`;
  // recovery adds its `isCurrent` fence.
  const turnPorts = useMemo<Omit<TurnPorts, 'isCurrent'>>(() => ({
    refreshProjectFiles: (options) => refreshProjectFiles(options),
    readProjectHtml,
    persistArtifact,
    requestOpenFile,
    requestOpenTurnArtifacts,
    readSavedArtifact: () => savedArtifactRef.current,
    writeSavedArtifact: (name) => {
      savedArtifactRef.current = name;
    },
    // A deliberate user selection wins over any automatic open, without
    // canceling file persistence.
    shouldOpen: () => !userTookOverPreviewRef.current,
  }), [refreshProjectFiles, readProjectHtml, persistArtifact, requestOpenFile, requestOpenTurnArtifacts]);

  // Set of project file names that the chat surface uses to decide whether
  // a tool card's path is openable as a tab. Recomputed on every file-list
  // change; tool cards just read from the set.
  const projectFileNames = useMemo(
    () => new Set(projectFiles.map((f) => f.name)),
    [projectFiles],
  );
  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  // Keep the @-picker's source of truth fresh: every refreshSignal bump
  // (artifact saved, sketch saved, image uploaded) refetches; on first
  // mount we also do an initial pull so attachments staged before the
  // agent has written anything still see the user's pasted images.
  useEffect(() => {
    void refreshWorkspaceItems({
      freshProjectFiles: filesRefresh > committedFilesRefreshKeyRef.current,
    }).catch(() => {
      // The daemon probe can briefly lag behind a just-started local
      // runtime. Retry when daemonLive flips or the explicit refresh key
      // changes instead of leaving the project view in its empty shell.
    });
  }, [daemonLive, refreshWorkspaceItems, filesRefresh]);

  // Live-reload: when the daemon's chokidar watcher reports a file change,
  // bump filesRefresh so the file list refetches with new mtimes — which
  // propagates through to FileViewer iframes via PR #384's ?v=${mtime}
  // cache-bust, triggering an automatic preview reload without a click.
  //
  // Coalesce the refresh: agent rewrites surface to chokidar as an
  // `unlink` + `add` (+ later `change`) burst within a single tick (#2195).
  // Refreshing the file list on the intermediate `unlink` makes the open
  // tab's active file vanish for one frame before the `add` restores it,
  // and FileWorkspace's "tab no longer on disk" path then drops the user
  // out of their preview. A short trailing wait absorbs the burst; the
  // maxWait cap stops a sustained edit storm from starving the UI.
  const refreshFilesAndDesignMd = useCallback(() => {
    // A chokidar event is an authoritative invalidation, not merely a visual
    // refresh hint. Fence the exact project/Workspace file-list authority
    // before publishing the React refresh key: otherwise fetchProjectFiles
    // can return its short-lived settled cache (or an already-joined response
    // that was captured before this event) and leave the restored project on
    // the old file snapshot.
    invalidateProjectFilesCache(project.id);
    bumpFilesRefresh();
    // Round 7 (mrcfps): file mutations are the dominant staleness signal
    // post-finalize — bump the refresh key so DESIGN.md staleness
    // recomputes against the new mtimes.
    setDesignMdRefreshKey((n) => n + 1);
  }, [project.id]);
  const reconcileFilesWhenProjectEventsBecomeReady = useCallback(async () => {
    // The initial file snapshot and the project-event stream are established
    // independently. Re-read once after the stream handshake to close the
    // gap, but do not publish a preview invalidation merely because the
    // handshake completed: changing the iframe URL would abort a perfectly
    // good first navigation and load the same document twice.
    const hadAcceptedSnapshot = projectFilesGenerationRef.current > 0;
    const previousFiles = projectFilesRef.current;
    invalidateProjectFilesCache(project.id);
    const nextFiles = await refreshProjectFiles({ fresh: true });

    if (
      !hadAcceptedSnapshot
      || projectFileContentSnapshotsEqual(previousFiles, nextFiles)
    ) {
      return;
    }
    // A real snapshot change landed in the pre-handshake gap. Route it
    // through the normal refresh witness so the preview and DESIGN.md state
    // catch up exactly as they do for a live `file-changed` event.
    bumpFilesRefresh();
    setDesignMdRefreshKey((n) => n + 1);
  }, [bumpFilesRefresh, project.id, refreshProjectFiles]);
  const coalescedFileChangedRefresh = useCoalescedCallback(
    refreshFilesAndDesignMd,
    { wait: 80, maxWait: 250 },
  );
  // Track the local project event stream connection.
  const [projectEventsSseConnected, setProjectEventsSseConnected] = useState(false);
  // Same temporal-dead-zone dodge for the conversation re-read, used by the
  // `chat-artifact-refs-changed` branch below.
  const scheduleConversationMessageRefreshRef = useRef<((conversationId: string) => void) | null>(
    null,
  );
  const handleProjectEvent = useCallback((evt: ProjectEvent) => {
    if (evt.type === 'file-changed') {
      iframeKeepAlivePool.evictProject(project.id);
      invalidateHtmlSourceSnapshotProject(project.id);
      coalescedFileChangedRefresh();
      void recoverMaterializedConversations(project.id, projectRunAuthorityKey);
      return;
    }
    if (evt.type === 'chat-artifact-refs-changed') {
      /*
       * A card's static cover finished rendering after its turn already ended.
       *
       * The render deliberately outlives the turn, so it lands well after the
       * one post-run re-read (`scheduleConversationMessageRefresh`, 150ms) has
       * already returned a message with no ready ref — measured at 616ms on a
       * real client against that 150ms window. Without this the card sits on
       * the live-iframe degrade branch for the rest of the session, which is
       * what `chat-artifact-versioning-design.md` line 505 forbids: "后台
       * ready 后消息投影更新".
       *
       * Re-read rather than apply: the event carries no refs, so `listMessages`
       * stays the single authority on what a ref is, and a duplicate event
       * costs one redundant fetch instead of a wrong card. Reusing the existing
       * scheduler also keeps the degrade branch mounted until the real refs
       * arrive — line 505 asks for a follow-up update, not a placeholder.
       */
      if (evt.projectId === project.id) {
        scheduleConversationMessageRefreshRef.current?.(evt.conversationId);
      }
      return;
    }
    if (evt.type === 'conversation-created') {
      // A new conversation was inserted into this project by a path the
      // open project view can't observe through its own state (currently:
      // Routines "Run now" in reuse-an-existing-project mode, #1361).
      // Refetch the conversation list so the new entry becomes visible
      // without requiring the user to leave and re-enter the project.
      // Deliberately do NOT change the active conversation here — the
      // user keeps their current context. Auto-switch is a separate UX
      // decision tracked in #1361.
      if (evt.projectId !== project.id) return;
      const capturedProjectId = project.id;
      const myToken = ++conversationsRefreshTokenRef.current;
      void (async () => {
        try {
          const list = await listConversations(capturedProjectId);
          // Bail if the user switched projects while this request was in
          // flight (#1361 review, Codex P1). The captured project id is the
          // one we asked the daemon about; the live ref is the one the
          // user is looking at right now. If they don't match, applying
          // the list would overwrite the new project's sidebar with
          // stale data from the old one.
          if (projectIdRef.current !== capturedProjectId) return;
          // Bail if a newer conversation-created event already dispatched
          // its own refresh after us (#1361 review, lefarcen P2). With two
          // rapid events the later request may resolve first; if this
          // earlier request resolves afterwards it would drop the newer
          // conversation. Only the latest dispatch is allowed to apply.
          if (conversationsRefreshTokenRef.current !== myToken) return;
          setConversations(list);
        } catch {
          // Defensive: refresh failed (network blip, daemon gone). The
          // next project mount or another conversation-created event
          // will retry; no need to surface an error here.
        }
      })();
      return;
    }
  }, [coalescedFileChangedRefresh, iframeKeepAlivePool, onProjectsRefresh, recoverMaterializedConversations, project.id, projectRunAuthorityKey]);
  const projectEventsEnabled = daemonLive;
  useProjectFileEvents(project.id, projectEventsEnabled, handleProjectEvent, {
    onConnectedChange: setProjectEventsSseConnected,
    // Files or comments can change after their initial snapshots but before
    // SSE is listening. Reconcile both once the exact-scoped stream is ready:
    // for comments this also redeems a daemon-side dirty mark left by a hub
    // event that arrived in the pre-handshake gap.
    onReady: () => {
      void reconcileFilesWhenProjectEventsBecomeReady();
    },
  });

  const activePromptContextSignature = useMemo(() => {
    const skill = project.skillId
      ? (skills.find((s) => s.id === project.skillId) ??
        designTemplates.find((s) => s.id === project.skillId))
      : null;
    return JSON.stringify({
      skill: skill
        ? {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            mode: skill.mode,
            source: skill.source ?? null,
            upstream: skill.upstream,
          }
        : null,
    });
  }, [designTemplates, project.skillId, skills]);
  const previousPromptContextSignatureRef = useRef(activePromptContextSignature);
  useEffect(() => {
    if (previousPromptContextSignatureRef.current === activePromptContextSignature) return;
    previousPromptContextSignatureRef.current = activePromptContextSignature;
    iframeKeepAlivePool.evictProject(project.id, { includeActive: true });
  }, [activePromptContextSignature, iframeKeepAlivePool, project.id]);

  // When the URL points at a specific file, fire an open request so the
  // FileWorkspace promotes it to an active tab. We watch routeFileName
  // (the parsed segment) so back/forward navigation triggers the same path.
  // A file URL the user navigated to (deep link, back/forward) is their
  // open: it switches the panel to 资源库. A URL this view just wrote from the
  // panel's own state is an echo and opens nothing: the panel already holds that
  // item, and a request could land after the user moved on and reopen a file
  // they just left. It still counts as the host's selection for the takeover
  // check (`userTookOverPreviewRef`).
  const lastSyncedRouteFileRef = useRef<string | null>(null);
  useEffect(() => {
    if (!routeFileName) return;
    if (routeFileName === lastSyncedRouteFileRef.current) lastHostRequestedOpenRef.current = routeFileName;
    else requestConversationOpenFile(routeFileName);
  }, [routeFileName, requestConversationOpenFile]);

  // Sync the URL when the active tab changes, so reload + share-link both
  // land back on the same view. Replace (not push) on tab activation so the
  // history stack doesn't fill with every tab click.
  // Composite sync key: tracks BOTH the active file target AND the active
  // conversation id, so a conversation-only change (e.g. `listConversations`
  // resolves after `loadTabs` hydrated the active tab, or the user picks a
  // different conversation under the same tab) still triggers the navigate
  // and pushes `/conversations/:cid` into the URL. Keying only on the file
  // target lost that update because the early-return saw `target` unchanged
  // and skipped the navigate (lefarcen P1 on PR #1508).
  const lastSyncedRouteKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const target = openTabsState.active && (
      openTabsState.tabs.includes(openTabsState.active)
      || projectFileNames.has(openTabsState.active)

    )
      ? openTabsState.active
      : null;
    // A restarted/deep-linked project already carries its persisted
    // conversation in the route while the daemon's conversation list is still
    // hydrating. Preserve that authority until activeConversationId resolves;
    // otherwise this first tab-sync pass strips `/conversations/:cid` and the
    // subsequent list load can no longer select the requested conversation.
    const effectiveConversationId = activeConversationId ?? routeConversationId;
    const nextKey = `${effectiveConversationId ?? ''}:${target ?? ''}`;
    // The project row navigates to the bare project, which says nothing about
    // the conversation. The pane stays where it is, so the URL has to get that
    // conversation back or the sidebar loses its highlight.
    const routeDroppedConversation = Boolean(activeConversationId && !routeConversationId);
    if (nextKey === lastSyncedRouteKeyRef.current && !routeDroppedConversation) return;
    lastSyncedRouteKeyRef.current = nextKey;
    lastSyncedRouteFileRef.current = target;
    lastSyncedConversationIdRef.current = effectiveConversationId;
    // PerishCode + Codex P1 on PR #1508: the prior version of this
    // sync stripped any `/conversations/:cid` segment from the URL as
    // soon as a tab became active, which regressed the deep-link
    // behavior the parent commit was meant to add (reload / share
    // would fall back to `list[0]` instead of the routed run's
    // conversation). Thread the active conversation id so the URL
    // always reflects the conversation the project view is actually
    // showing, matching how `fileName` already tracks the active tab.
    navigate(
      {
        kind: 'project',
        projectId: project.id,
        conversationId: effectiveConversationId,
        fileName: target,
      },
      { replace: true },
    );
  }, [openTabsState.active, projectFileNames, project.id, activeConversationId, routeConversationId]);

  const handleEnsureProject = useCallback(async (): Promise<string | null> => {
    return project.id;
  }, [project.id]);

  const persistMessage = useCallback(
    (m: ChatMessage, options?: SaveMessageOptions) => {
      if (!activeConversationId) return;
      // Source-level guard against the "Working 24m+ / Waiting for first
      // output" UI: never write a daemon assistant row that is still
      // queued/running but has no runId. Until POST /api/runs returns the
      // runId, the message is purely in-flight on the client; persisting it
      // here creates a row that nothing can ever reattach to (daemon never
      // saw the runId, client lost the response). Once onRunCreated assigns
      // a runId — or the run finishes terminally — this guard lets the row
      // through normally.
      if (isPhantomDaemonRunMessage(m)) return;
      void saveMessage(project.id, activeConversationId, m, {
        ...options,

      });
    },
    [project.id, activeConversationId, null],
  );

  const persistMessageById = useCallback(
    (messageId: string, options?: SaveMessageOptions) => {
      if (!activeConversationId) return;
      setMessages((curr) => {
        const found = curr.find((m) => m.id === messageId);
        if (found && !isPhantomDaemonRunMessage(found)) {
          void saveMessage(project.id, activeConversationId, found, {
            ...options,

          });
        }
        return curr;
      });
    },
    [project.id, activeConversationId, null],
  );

  const updateMessageById = useCallback(
    (
      messageId: string,
      updater: (message: ChatMessage) => ChatMessage,
      persist = false,
      persistOptions?: SaveMessageOptions,
    ) => {
      setMessages((curr) => {
        let saved: ChatMessage | null = null;
        const next = curr.map((m) => {
          if (m.id !== messageId) return m;
          const updated = updater(m);
          saved = updated;
          return updated;
        });
        // Same phantom guard as persistMessage: skip writes for a daemon
        // assistant row that is still in-flight (active runStatus, no runId).
        // The runId-arriving update from onRunCreated passes through because
        // the updater sets runId before this check runs.
        if (persist && saved && activeConversationId && !isPhantomDaemonRunMessage(saved)) {
          void saveMessage(project.id, activeConversationId, saved, {
            ...persistOptions,

          });
        }
        return next;
      });
    },
    [project.id, activeConversationId, null],
  );



  const appendConversationMessage = useCallback(
    (
      conversationId: string,
      message: ChatMessage,
      options?: SaveMessageOptions,
      persist = true,
    ) => {
      if (
        activeConversationId === conversationId
        || messagesConversationIdRef.current === conversationId
      ) {
        setMessages((curr) => [...curr, message]);
      }
      if (persist) {
        void saveMessage(project.id, conversationId, message, {
          ...options,

        });
      }
    },
    [activeConversationId, project.id, null],
  );

  // Identity for host-authored chat messages (the brand browser-assist prompt
  // below). Without it the message collapses to the generic "Assistant" label +
  // monogram; stamping the user's currently-selected design agent makes its
  // avatar and role name follow that selection (Claude by default), matching how
  // handleSend identifies a real turn.
  const selectedAssistantIdentity = useMemo(
    () => resolveSelectedAssistantIdentity(config, agents),
    [config, agents],
  );

  // One-shot: when extraction is blocked by an anti-bot wall (or has stalled past
  // the timeout), drop the assist card into the conversation so the user can
  // clear the wall in the Browser tab and Confirm. Keyed per conversation+brand
  // so it can't double-post.


  const replaceConversationMessage = useCallback(
    (
      conversationId: string,
      message: ChatMessage,
      options?: SaveMessageOptions,
      persist = true,
    ) => {
      if (
        activeConversationId === conversationId
        || messagesConversationIdRef.current === conversationId
      ) {
        setMessages((curr) => curr.map((item) => (item.id === message.id ? message : item)));
      }
      if (persist) {
        void saveMessage(project.id, conversationId, message, {
          ...options,

        });
      }
    },
    [activeConversationId, project.id, null],
  );

  const refreshConversationMessagesFromServer = useCallback(
    async (conversationId: string) => {
      if (messagesConversationIdRef.current !== conversationId) return;
      try {
        const serverMessages = await listMessages(project.id, conversationId);
        if (messagesConversationIdRef.current !== conversationId) return;
        setMessages((current) => mergeServerMessagesIntoConversation(current, serverMessages));
        const latestRun = latestConversationRun(serverMessages);
        if (latestRun) rememberConversationAgent(conversationId, latestRun.agentId);
        setMessagesInitialized(true);
        setMessagesConversationId(conversationId);
        setFailedMessagesConversationId(null);
      } catch (err) {
        console.warn('Failed to refresh conversation messages after run completion', err);
      }
    },
    [project.id, null],
  );

  const scheduleConversationMessageRefresh = useCallback(
    (conversationId: string) => {
      scheduleProjectTimeout(() => {
        void refreshConversationMessagesFromServer(conversationId);
      }, 150);
    },
    [refreshConversationMessagesFromServer, scheduleProjectTimeout],
  );

  const markStreamingConversation = useCallback((conversationId: string) => {
    streamingConversationIdRef.current = conversationId;
    setStreaming(true);
    setStreamingConversationId(conversationId);
  }, []);

  const clearStreamingMarker = useCallback((conversationId?: string | null) => {
    const next = clearStreamingConversationMarker(
      streamingConversationIdRef.current,
      conversationId,
    );
    if (next === streamingConversationIdRef.current) return;
    streamingConversationIdRef.current = next;
    setStreamingConversationId(next);
    setStreaming(next !== null);
  }, []);

  const clearActiveRunRefs = useCallback((
    conversationId: string,
    controller: AbortController,
    cancelController: AbortController,
  ) => {
    if (!shouldClearActiveRunRefs(streamingConversationIdRef.current, conversationId)) {
      return false;
    }
    if (abortRef.current !== controller || cancelRef.current !== cancelController) {
      return false;
    }
    abortRef.current = null;
    cancelRef.current = null;
    return true;
  }, []);

  const clearCurrentRunStreamingMarker = useCallback((
    conversationId: string,
    controller: AbortController,
    cancelController: AbortController,
  ) => {
    if (!clearActiveRunRefs(conversationId, controller, cancelController)) return false;
    clearStreamingMarker(conversationId);
    return true;
  }, [clearActiveRunRefs, clearStreamingMarker]);

  const handleAssistantFeedback = useCallback(
    (assistantMessage: ChatMessage, change: ChatMessageFeedbackChange) => {
      const now = Date.now();
      updateMessageById(
        assistantMessage.id,
        (prev) =>
          change
            ? {
                ...prev,
                feedback: {
                  rating: change.rating,
                  reasonCodes: change.reasonCodes,
                  customReason: change.customReason,
                  reasonsSubmittedAt: change.reasonsSubmittedAt,
                  createdAt:
                    prev.feedback?.rating === change.rating
                      ? prev.feedback.createdAt
                      : now,
                  updatedAt: now,
                },
              }
            : {
                ...prev,
                feedback: undefined,
              },
        true,
      );
      // Forward affirmative ratings to the daemon → Langfuse `score-create`.
      // Clears (change=null) are skipped — Langfuse scores are append-only,
      // and the rating is also captured by the PostHog event so a clear is
      // recoverable downstream if we ever need it.
      const runId = assistantMessage.runId;
    },
    [updateMessageById, activeConversationId, null],
  );

  // `code` is the structured API error code (e.g. AGENT_AUTH_REQUIRED); it
  // rides along on the error status event so AssistantMessage can render the
  const appendAssistantErrorEvent = useCallback(
    (
      messageId: string,
      message: string,
      code?: string,
      failure?: RunFailureClassificationFields,
      stderrTail?: string,
    ) => {
      if (!message) return;
      updateMessageById(
        messageId,
        (prev) => appendErrorStatusEvent(prev, message, code, failure, stderrTail),
        true,
      );
    },
    [updateMessageById],
  );

  // Same exposure for the conversation re-read, so a pushed
  // `chat-artifact-refs-changed` can pick up a cover that landed after the turn.
  useEffect(() => {
    scheduleConversationMessageRefreshRef.current = scheduleConversationMessageRefresh;
    return () => {
      scheduleConversationMessageRefreshRef.current = null;
    };
  }, [scheduleConversationMessageRefresh]);

  // Maximum number of times we will retry fetching a null status for a
  // spuriouslyFailedPending run before treating the absence as authoritative
  // completion.  Transient null-status retries are bounded; after
  // MAX_TRANSIENT_RETRIES we add to completedReattachRunsRef to avoid spinning.
  const MAX_TRANSIENT_RETRIES = 2;

  // Reset transient retry counts when the conversation or daemon connection
  // changes so stale counts from a previous session do not bleed in.  This
  // must be a separate effect keyed only on those two values; placing the
  // reset inside the reattach effect (which also depends on recoveryTick and
  // messages) would zero the counts every time the timer-driven recoveryTick
  // bumped, preventing attempts >= MAX_TRANSIENT_RETRIES from ever holding.
  useEffect(() => {
    transientFailedRetriesRef.current = new Map();
    genericDisconnectRetriesRef.current = new Map();
    genericDisconnectBackoffUntilRef.current = new Map();
  }, [activeConversationId, daemonLive]);

  // 组件 22 · 重连 · S29:换项目 / 离开这一屏,本地就不再跟着那条流了,
  // 掉线那一行不该跟着走。会话之间的隔离由渲染前的
  // `reconnectViewForConversation` 负责;这里管的是整屏的收尾。
  useEffect(
    () => () => {
      setReconnectView(null);
    },
    [project.id],
  );

  useEffect(() => {
    if (config.mode !== 'daemon' || !daemonLive || !activeConversationId || streaming) return;
    let cancelled = false;
    const reattachConversationId = activeConversationId;

    const attachRecoverableRuns = async () => {
      const missingRunIdMessages = messages.filter((m) => {
        if (m.role !== 'assistant' || m.runId) return false;
{}

        return isActiveRunStatus(m.runStatus);
      });
      const activeRuns = missingRunIdMessages.length > 0
        ? await listActiveChatRuns(project.id, reattachConversationId)
        : [];
      const historicalRuns = missingRunIdMessages.length > 0
        ? (await listProjectRuns()).filter(
            (run) => run.projectId === project.id && run.conversationId === reattachConversationId,
          )
        : [];
      if (cancelled) return;
      const activeByMessage = new Map(
        activeRuns
          .filter((run) => run.assistantMessageId)
          .map((run) => [run.assistantMessageId!, run]),
      );
      const historicalByMessage = new Map(
        historicalRuns
          .filter((run) => run.assistantMessageId)
          .map((run) => [run.assistantMessageId!, run]),
      );

      for (const message of messages) {
        if (cancelled) return;
        if (message.role !== 'assistant') continue;

        // A message whose run_status was spuriously written as 'failed' before
        // the page reloaded (e.g. the SSE reconnect fallback fired while the
        // daemon run was still in flight) must still be reattached when the
        // actual daemon run succeeded.  Detect this by checking for a 'failed'
        // message that has a runId but no content and no produced files — the
        // daemon's authoritative status is fetched below and the message is
        // updated to reflect it.
        //
        // NOTE: `spuriouslyFailedPending` is kept separate from the other two
        // branches because the recovery action is gated on the fetched daemon
        // status; genuine failures (onError of a live stream) must not enter
        // the reattach path and must never have their persisted failure context
        // cleared or their resumable flag overwritten.
        const spuriouslyFailedPending =
          message.runStatus === 'failed' &&
          !!message.runId &&
          !message.content &&
          !(message.producedFiles?.length);
        const recoverableGenericDisconnectFailed =
          message.runStatus === 'failed' &&
          !!message.runId &&
          hasGenericDisconnectFailureEvent(message);
        const replayingTerminalRun =
          shouldReplayTerminalRunMessage(message) || spuriouslyFailedPending;
        const needsReplayForMessage =
          isActiveRunStatus(message.runStatus) ||
          replayingTerminalRun ||
          spuriouslyFailedPending ||
          recoverableGenericDisconnectFailed;
        const needsFullReplay = needsReplayForMessage;
        if (!needsFullReplay) continue;
        const fallbackRun = !message.runId
          ? activeByMessage.get(message.id) ?? historicalByMessage.get(message.id) ?? null
          : null;
        const runId = message.runId ?? fallbackRun?.id;
        // Self-heal phantom 'running' rows: when the message has no runId
        // and the daemon has no active run mapped to it, the original send
        // POST was lost (daemon restart mid-flight, the user navigated
        // away before /api/runs returned, or a network blip). Leaving the
        // message as 'running' is what produces the "Waiting for first
        // output — Working 24m+" UI the user reported. Mark it failed so
        // the composer is interactive again and the user can re-send.
        if (!runId) {
{}

          updateMessageById(
            message.id,
            (prev) => ({
              ...prev,
              runStatus: 'failed',
              endedAt: prev.endedAt ?? Date.now(),
            }),
            true,
          );
          continue;
        }
        if (finalizingLocalRunIdsRef.current.has(runId)) continue;
        if (reattachControllersRef.current.has(runId)) continue;
        if (completedReattachRunsRef.current.has(runId)) continue;
        const genericDisconnectBackoffUntil =
          genericDisconnectBackoffUntilRef.current.get(runId) ?? 0;
        if (genericDisconnectBackoffUntil > Date.now()) continue;
        genericDisconnectBackoffUntilRef.current.delete(runId);

        if (fallbackRun && !message.runId) {
          updateMessageById(
            message.id,
            (prev) => ({ ...prev, runId, runStatus: fallbackRun.status }),
            true,
          );
        }

        const physicalStatus = fallbackRun
          ?? await fetchChatRunStatus(runId);
        if (cancelled) return;
        if (!physicalStatus) {
          // A missing status response cannot invalidate persisted success.
          if (message.runStatus === 'succeeded') continue;
          // A local retry seal is not a daemon terminal verdict. Keep this
          // run's receipts for the existing manual reconnect action.
          // `fetchChatRunStatus` returns null on ANY non-OK response or fetch
          // exception (providers/daemon.ts:686), not only when the daemon has
          // permanently forgotten the run.  For a spuriously-failed pending
          // message we must keep this path retryable: a transient network or
          // daemon hiccup during reload must not permanently suppress the
          // reattach attempt for the rest of the session.
          //
          // Transient null-status retries are bounded; after MAX_TRANSIENT_RETRIES
          // we treat the absence as authoritative completion to avoid spinning.
          // Timers are tracked in transientRetryTimersRef and cleared on cleanup.
          //
          // For other message states (phantom running rows with no runId),
          // fall through to the original mark-failed behaviour and seal the
          // runId so we don't loop indefinitely.
          if (spuriouslyFailedPending) {
            const attempts = transientFailedRetriesRef.current.get(runId) ?? 0;
            if (attempts >= MAX_TRANSIENT_RETRIES) {
              // Cap reached — treat as authoritative completion so we stop retrying.
              // Clear the Map entry so it doesn't accumulate stale entries.
              transientFailedRetriesRef.current.delete(runId);
              genericDisconnectRetriesRef.current.delete(runId);
              completedReattachRunsRef.current.add(runId);
            } else {
              transientFailedRetriesRef.current.set(runId, attempts + 1);
              const handle = setTimeout(() => {
                transientRetryTimersRef.current.delete(handle);
                setRecoveryTick((t) => t + 1);
              }, 3000);
              transientRetryTimersRef.current.add(handle);
            }
          } else {
            updateMessageById(
              message.id,
              (prev) => ({ ...prev, runStatus: 'failed', endedAt: prev.endedAt ?? Date.now() }),
              true,
            );
            completedReattachRunsRef.current.add(runId);
          }
          continue;
        }
        const reattachRunId = runId;
        const status = physicalStatus;
        // When the daemon authoritative status is 'failed', the run ended in a
        // genuine failure.  For spuriously-failed pending messages this means
        // the client-side heuristic was wrong — the daemon did not succeed.
        // Leave the message alone so its persisted error content/events/producedFiles
        // survive, but still apply the daemon's authoritative `resumable` flag so
        // ChatPane's Continue affordance reflects the daemon's view after a reload.
        if (spuriouslyFailedPending && status.status === 'failed') {
          if (typeof status.resumable !== 'undefined') {
            updateMessageById(
              message.id,
              (prev) => ({ ...prev, resumable: status.resumable }),
              true,
            );
          }
          // Clear stale retry count — this run is authoritatively done.
          transientFailedRetriesRef.current.delete(runId);
          genericDisconnectRetriesRef.current.delete(runId);
          genericDisconnectBackoffUntilRef.current.delete(runId);
          completedReattachRunsRef.current.add(runId);
          findDetachedManualFileWrites(reattachConversationId, runId)?.dispose();
          continue;
        }
        if (spuriouslyFailedPending && status.status === 'canceled') {
          setError(null);
          // Route through the shared invariant helper: `status` is already
          // terminal here, so this resolves to `status.updatedAt` directly.
          const endedAt = await resolveTerminalEndedAt(
            runId,
            status,
          );
          updateMessageById(
            message.id,
            (prev) => ({
              ...prev,
              runStatus: 'canceled',
              endedAt,
              ...(status.resumable !== undefined ? { resumable: status.resumable } : {}),
            }),
            true,
          );
          transientFailedRetriesRef.current.delete(runId);
          genericDisconnectRetriesRef.current.delete(runId);
          genericDisconnectBackoffUntilRef.current.delete(runId);
          completedReattachRunsRef.current.add(runId);
          findDetachedManualFileWrites(reattachConversationId, runId)?.dispose();
          continue;
        }
        if (spuriouslyFailedPending && status.status === 'succeeded') {
          setError(null);
          transientFailedRetriesRef.current.delete(runId);
          genericDisconnectRetriesRef.current.delete(runId);
          genericDisconnectBackoffUntilRef.current.delete(runId);
        }
        if (!(spuriouslyFailedPending && status.status === 'succeeded')) {
          updateMessageById(
            message.id,
            (prev) => ({
              ...prev,
              runStatus: status.status,
              ...(status.resumable !== undefined ? { resumable: status.resumable } : {}),
            }),
            true,
          );
        }

        if (shouldReplayTerminalRunMessage(message)) {
          const replayedContent = textContentFromAgentEvents(message.events);
          if (replayedContent.trim().length > 0) {
            const parser = createArtifactParser();
            let parsedArtifact: Artifact | null = null;
            let liveHtml = '';
            for (const ev of [...parser.feed(replayedContent), ...parser.flush()]) {
              if (ev.type === 'artifact:start') {
                liveHtml = '';
                parsedArtifact = {
                  identifier: ev.identifier,
                  artifactType: ev.artifactType,
                  title: ev.title,
                  html: '',
                };
                setArtifact(parsedArtifact);
              } else if (ev.type === 'artifact:chunk') {
                liveHtml += ev.delta;
                parsedArtifact = artifactWithHtml(parsedArtifact, ev.identifier, liveHtml);
                setArtifact((prev) =>
                  artifactWithHtml(prev, ev.identifier, liveHtml),
                );
              } else if (ev.type === 'artifact:end') {
                parsedArtifact = artifactWithHtml(parsedArtifact, ev.identifier, ev.fullContent);
                setArtifact((prev) =>
                  prev ? artifactWithHtml(prev, ev.identifier, ev.fullContent) : null,
                );
              }
            }

            // Legacy rows persisted before `endedAt` existed reach this
            // branch with no stored `endedAt` at all — fall back to the
            // daemon's authoritative terminal timestamp (already fetched
            // above as `status`) rather than the reload's wall-clock time.
            const legacyReplayEndedAt = await resolveTerminalEndedAt(
              runId,
              status,
            );
            updateMessageById(
              message.id,
              (prev) => ({
                ...prev,
                content: replayedContent,
                runStatus: resolveSucceededRunStatus(prev.runStatus),
                endedAt: prev.endedAt ?? legacyReplayEndedAt,
              }),
              true,
              { telemetryFinalized: true },
            );

            const {
              producedFiles: produced,
              traceObjectFiles,
              persistenceSucceeded: artifactPersistenceSucceeded,
              persistenceError: artifactPersistenceError,
            } = await finalizeTurn(
              {
                projectId: project.id,
                projectRoot: projectDetail.resolvedDir,
                preTurnFileNames: message.preTurnFileNames,
                turnStartedAt: status.createdAt || message.startedAt || message.createdAt,
                turnEndedAt: message.endedAt || legacyReplayEndedAt,
                autoOpenOptions: autoOpenArtifactOptions,
                readOutput: () => ({
                  artifact: chooseArtifactToPersist(parsedArtifact, replayedContent),
                  sourceText: replayedContent,
                }),
                readTouchedPaths: () => extractTouchedFilePathsFromEvents(message.events),
                readAuthoritativeArtifactPaths: () => status.artifactPaths,
                readManualWrites: () =>
                  findDetachedManualFileWrites(reattachConversationId, runId)?.files
                    ?? new Map<string, ProjectFile>(),
              },
              TURN_POLICIES.replay,
              turnPorts,
            );
            const deliveryOutcome = resolveDesignDeliveryOutcome({
              sessionMode: message.sessionMode,
              runStatus: 'succeeded',
              content: replayedContent,
              events: message.events,
              producedFileCount: produced.length,
              traceObjectFileCount: traceObjectFiles.length,
              artifactCount: status.artifactCount,
              persistenceSucceeded: artifactPersistenceSucceeded,
              persistenceFailed: artifactPersistenceError !== undefined,
            });
            updateMessageById(
              message.id,
              (prev) =>
                applyDesignDeliveryOutcome(
                  {
                    ...prev,
                    content: replayedContent,
                    producedFiles: produced,
                    traceObjectFiles,
                  },
                  deliveryOutcome,
                  artifactPersistenceError,
                ),
              true,
              { telemetryFinalized: true },
            );
            if (deliveryOutcome === 'no_result' || deliveryOutcome === 'delivery_failed') {
              setError(artifactPersistenceError ?? DESIGN_RESULT_MISSING_DETAIL);
            }
            // Clear stale retry count for successfully recovered run.
            transientFailedRetriesRef.current.delete(runId);
            genericDisconnectRetriesRef.current.delete(runId);
            completedReattachRunsRef.current.add(runId);
            findDetachedManualFileWrites(reattachConversationId, runId)?.dispose();
            onProjectsRefresh();
            continue;
          }
        }

        const controller = new AbortController();
        const cancelController = new AbortController();
        const manualFileWrites = new Map<string, ProjectFile>();
        const manualFileWriteRegistration = registerManualFileWrites(
          controller, manualFileWrites, reattachConversationId, reattachRunId,
        );
        let keepManualFileWritesForRecovery = false;
        const ownedReattachRunIds = new Set<string>();
        const claimReattachRun = (claimedRunId: string) => {
          ownedReattachRunIds.add(claimedRunId);
          reattachControllersRef.current.set(claimedRunId, controller);
          reattachCancelControllersRef.current.set(claimedRunId, cancelController);
        };
        const releaseReattachRuns = () => {
          for (const claimedRunId of ownedReattachRunIds) {
            if (reattachControllersRef.current.get(claimedRunId) === controller) {
              reattachControllersRef.current.delete(claimedRunId);
            }
            if (reattachCancelControllersRef.current.get(claimedRunId) === cancelController) {
              reattachCancelControllersRef.current.delete(claimedRunId);
            }
          }
        };
        const completeReattachRuns = () => {
          keepManualFileWritesForRecovery = false;
          for (const claimedRunId of ownedReattachRunIds) {
            completedReattachRunsRef.current.add(claimedRunId);
          }
        };
        claimReattachRun(runId);
        claimReattachRun(reattachRunId);
        let activeReattachRunId = reattachRunId;
        /*
         * daemon 刚给出的裁定 —— 见 `replayedRunStatusMayLand`。终态时它就是这条 run 的
         * 权威结论,之后从同一条流里回放出来的 `start`(→ `running`)只是历史帧。
         */
        const reattachTerminalVerdict = isTerminalRunStatus(status.status) ? status.status : null;
        /*
         * 这次订阅**听到 daemon 说话了吗**。见 `.finally()` 里的封存判据。
         * 只有三种声音算数:终态的 `onRunStatus`、`onDone`、`onError` ——
         * 它们各自都会封存这条 run 或安排一次有节流的重试。
         */
        let reattachHeardFromDaemon = false;
        if (!isTerminalRunStatus(status.status)) {
          abortRef.current = controller;
          cancelRef.current = cancelController;
          markStreamingConversation(reattachConversationId);
        }
        // Only blank content/events/producedFiles when the daemon confirms the run
        // is still recoverable (queued/running/succeeded).  A genuinely failed run
        // already carries diagnostic information in `events`; clearing it before
        // re-running the reattach path would erase the error context and loop the
        // message through reattach even when the daemon still reports `failed`.
        const daemonStatusIsRecoverable =
          status.status === 'queued' ||
          status.status === 'running' ||
          status.status === 'succeeded';
        if (needsFullReplay && daemonStatusIsRecoverable) {
          updateMessageById(
            message.id,
            // Clear endedAt only for spuriously-failed pending messages so the
            // replay finalizers stamp Date.now() on real completion instead of
            // preserving the SSE-disconnect timestamp that onError set when the
            // browser-side reconnect loop gave up.  Already-succeeded rows
            // reaching needsFullReplay via shouldReplayTerminalRunMessage must
            // keep their original terminal timestamp; resetting it here causes
            // prev.endedAt ?? Date.now() to re-stamp to reload time and drifts
            // persisted run durations forward.
            (prev) => ({
              ...prev,
              content: '',
              events: [],
              producedFiles: undefined,
              ...(spuriouslyFailedPending ? { endedAt: undefined } : {}),
            }),
            true,
          );
          // When the failed-message recovery moves back to running/succeeded,
          // clear any stale "daemon stream disconnected" error banner that the
          // original onError path may have set, so the chat does not show a
          // stale error after the reattach succeeds.
          setError(null);
        }

        let persistTimer: ReturnType<typeof setTimeout> | null = null;
        const persistSoon = () => {
          if (persistTimer) return;
          persistTimer = scheduleProjectTimeout(() => {
            persistTimer = null;
            persistMessageById(message.id);
          }, 500);
        };
        const persistNow = (options?: SaveMessageOptions) => {
          if (persistTimer) {
            clearProjectTimeout(persistTimer);
            persistTimer = null;
          }
          textBuffer.flush();
          persistMessageById(message.id, options);
        };
        const parser = createArtifactParser();
        let parsedArtifact: Artifact | null = null;
        let liveHtml = '';
        let replayedContent = needsFullReplay ? '' : message.content;
        let replayedEvents: AgentEvent[] = needsFullReplay ? []
          : [...(message.events ?? [])];
        let daemonArtifactCount = status.artifactCount;
        let latestReattachRunStatus: ChatMessage['runStatus'] = status.status;
        let authoritativeReattachArtifactPaths = status.artifactPaths;
        const applyContentDelta = (delta: string) => {
          for (const ev of parser.feed(delta)) {
            if (ev.type === 'artifact:start') {
              liveHtml = '';
              parsedArtifact = {
                identifier: ev.identifier,
                artifactType: ev.artifactType,
                title: ev.title,
                html: '',
              };
              setArtifact(parsedArtifact);
            } else if (ev.type === 'artifact:chunk') {
              liveHtml += ev.delta;
              parsedArtifact = parsedArtifact
                ? { ...parsedArtifact, html: liveHtml }
                : {
                    identifier: ev.identifier,
                    title: '',
                    html: liveHtml,
                  };
              setArtifact((prev) =>
                prev
                  ? { ...prev, html: liveHtml }
                  : {
                      identifier: ev.identifier,
                      title: '',
                      html: liveHtml,
                    },
              );
            } else if (ev.type === 'artifact:end') {
              parsedArtifact = parsedArtifact
                ? { ...parsedArtifact, html: ev.fullContent }
                : {
                    identifier: ev.identifier,
                    title: '',
                    html: ev.fullContent,
                  };
              setArtifact((prev) => (prev ? { ...prev, html: ev.fullContent } : null));
            }
          }
        };
        if (!needsFullReplay && message.content) {
          applyContentDelta(message.content);
        }
        const textBuffer = createBufferedTextUpdates({
          updateMessage: (updater) => updateMessageById(message.id, updater),
          persistSoon,
          flushAndPersistNow: () => persistNow({ keepalive: true }),
          onContentDelta: applyContentDelta,
          // 这两种情况下面会把 `initialLastEventId` 设成 null,daemon 于是从第 0 条
          // 重推 —— 开头那一段是用户已经看过的历史,攒住一次性铺出来,别一段一段
          // 重新走一遍流式(OPEND-2590)。
          replayingHistory: needsFullReplay,
        });
        reattachTextBuffersRef.current.add(textBuffer);
        const unregisterTextBuffer = () => {
          reattachTextBuffersRef.current.delete(textBuffer);
        };

        const shouldPublishRunFinishedEvent =
          isActiveRunStatus(message.runStatus)
          || isActiveRunStatus(status.status)
          || spuriouslyFailedPending
          || recoverableGenericDisconnectFailed;
        // 组件 22 · 重连 · S29:重挂即将开始 ——「次数用尽、交回给人」这句话此刻
        // 已经不成立了,先把那一行撤掉。这次重挂的读数从 0 起,断不了就永远不会
        // 发 `cleared`,留着那一行会在正文重新流进来时挂着一句反话。
        pushReconnectSignal({ kind: 'dropped', runId });
        const startReattach = () => reattachDaemonRun({
          agentId: message.agentId,
          runId: reattachRunId,
          projectId: project.id,
          conversationId: reattachConversationId,

          signal: controller.signal,
          cancelSignal: cancelController.signal,
          initialLastEventId:
            needsFullReplay ? null : message.lastRunEventId ?? null,
          publishRunFinishedEvent: shouldPublishRunFinishedEvent,
          onArtifactPaths: (paths) => {
            authoritativeReattachArtifactPaths = paths;
          },
          handlers: {
            onDelta: (delta) => {
              // First payload from the resumed stream is real recovery — the daemon is
              // sending data, not just answering REST status probes.  Reset the
              // transient retry budgets so a future disconnect starts from zero, but
              // only on genuine stream progress (not on a status fetch or queued→running
              // transition). Terminal replay recovery is the exception: if a
              // replay-only reconnect delivers partial output and then disconnects
              // again, we must preserve the generic-disconnect retry budget long
              // enough to status-probe and force a clean full replay instead of
              // persisting that truncated transcript.
              transientFailedRetriesRef.current.delete(runId);
              if (!(replayingTerminalRun && !(message.producedFiles?.length))) {
                genericDisconnectRetriesRef.current.delete(runId);
              }
              genericDisconnectBackoffUntilRef.current.delete(runId);
              replayedContent += delta;
              textBuffer.appendContent(delta);
            },
            onAgentEvent: (ev) => {
              transientFailedRetriesRef.current.delete(runId);
              if (!(replayingTerminalRun && !(message.producedFiles?.length))) {
                genericDisconnectRetriesRef.current.delete(runId);
              }
              genericDisconnectBackoffUntilRef.current.delete(runId);
              replayedEvents = appendCoalescedAgentEvent(replayedEvents, ev);
              textBuffer.appendEvent(ev);
            },
            onArtifactCount: (count) => {
              daemonArtifactCount = count;
            },
            // 组件 22 · 重连 · S29,重挂那条流上的同一份读数。
            // 会话取被重挂消息自己的 `reattachConversationId`(后台重挂可能发生在
            // 别的会话上),渲染前再按当前会话过一道,免得串到别人的流水里。
            onReconnect: (state: DaemonReconnectState) => {
              pushReconnectSignal({
                kind: 'transport',
                runId,
                conversationId: reattachConversationId,
                attempt: state.attempt,
                max: state.max,
                phase: state.phase,
              });
            },
            // daemon 把这一轮重跑了 —— 同一行、同一套规矩,只有那句话不同。
            onAgentRetry: (state: DaemonAgentRetryState) => {
              pushReconnectSignal({
                kind: 'agent-retry',
                runId,
                conversationId: reattachConversationId,
                attempt: state.attempt,
                max: state.max,
                phase: state.phase,
                ...(state.cause ? { cause: state.cause } : {}),
              });
            },
            onAgentReconnect: (state: DaemonAgentReconnectState) => {
              pushReconnectSignal({
                kind: 'agent-reconnect',
                runId,
                conversationId: reattachConversationId,
                attempt: state.attempt,
                max: state.max,
                phase: state.phase,
              });
            },
            onDone: async () => {
              reattachHeardFromDaemon = true;
              // A reattached run interrupted by a "send now" still receives a
              // late onDone from the daemon. Decide ownership first, then bail
              // BEFORE any current-run side effect (committing buffered text,
              // repainting the artifact preview via setArtifact, re-finalizing
              // the message) — only release this run's bookkeeping. See the
              // streamViaDaemon onDone for the ownership rationale.
              const runMayFinalize =
                !supersededRunsRef.current.has(controller);
              if (runMayFinalize) textBuffer.flush();
              textBuffer.cancel();
              unregisterTextBuffer();
              // Clear stale retry count for successfully recovered run.
              transientFailedRetriesRef.current.delete(runId);
              genericDisconnectRetriesRef.current.delete(runId);
              completeReattachRuns();
              releaseReattachRuns();
              clearCurrentRunStreamingMarker(reattachConversationId, controller, cancelController);
              // Clear any stale error banner set by the original onError path
              // (e.g. "daemon stream disconnected") so the chat does not show it
              // after the spuriously-failed message reattaches and succeeds.
              if (runMayFinalize && spuriouslyFailedPending) setError(null);
              if (!runMayFinalize) return;
              for (const ev of parser.flush()) {
                if (ev.type === 'artifact:end') {
                  parsedArtifact = parsedArtifact
                    ? { ...parsedArtifact, html: ev.fullContent }
                    : {
                        identifier: ev.identifier,
                        title: '',
                        html: ev.fullContent,
                      };
                  setArtifact((prev) => (prev ? { ...prev, html: ev.fullContent } : null));
                }
              }
              // `status` is the pre-reattach snapshot fetched before
              // reattachDaemonRun started — on a reload-while-running it is
              // still 'running' (a near-run-start heartbeat), not the
              // daemon's terminal time. Re-probe now, at the end of
              // recovery, for the authoritative terminal `updatedAt`.
              const endedAt = await resolveTerminalEndedAt(
                activeReattachRunId,
                activeReattachRunId === runId ? status : null,
              );
              updateMessageById(
                message.id,
                (prev) => ({
                  ...prev,
                  content: needsFullReplay ? replayedContent : prev.content,
                  events: needsFullReplay ? replayedEvents : prev.events,
                  runStatus:
                    latestReattachRunStatus === 'canceled' ? 'canceled' : 'succeeded',
                  endedAt,
                }),
                true,
                latestReattachRunStatus === 'canceled'
                  ? { telemetryFinalized: true }
                  : undefined,
              );
              if (latestReattachRunStatus === 'canceled') return;
              void (async () => {
                const {
                  producedFiles: produced,
                  traceObjectFiles,
                  persistenceSucceeded: artifactPersistenceSucceeded,
                  persistenceError: artifactPersistenceError,
                } = await finalizeTurn(
                  {
                    projectId: project.id,
                    projectRoot: projectDetail.resolvedDir,
                    preTurnFileNames: message.preTurnFileNames,
                    turnStartedAt: status.createdAt || message.startedAt || message.createdAt,
                    turnEndedAt: endedAt,
                    autoOpenOptions: autoOpenArtifactOptions,
                    readOutput: () => ({
                      artifact: chooseArtifactToPersist(parsedArtifact, replayedContent),
                      sourceText: replayedContent,
                    }),
                    readTouchedPaths: () => extractTouchedFilePathsFromEvents(
                      needsFullReplay ? replayedEvents : message.events,
                    ),
                    readAuthoritativeArtifactPaths: () => authoritativeReattachArtifactPaths,
                    readManualWrites: () => manualFileWrites,
                  },
                  TURN_POLICIES.reattachDone,
                  turnPorts,
                );
                const deliveryContent = needsFullReplay ? replayedContent : message.content;
                const deliveryEvents = needsFullReplay ? replayedEvents : message.events;
                const deliveryOutcome = resolveDesignDeliveryOutcome({
                  sessionMode: message.sessionMode,
                  runStatus: 'succeeded',
                  content: deliveryContent,
                  events: deliveryEvents,
                  producedFileCount: produced.length,
                  traceObjectFileCount: traceObjectFiles.length,
                  artifactCount: daemonArtifactCount,
                  persistenceSucceeded: artifactPersistenceSucceeded,
                  persistenceFailed: artifactPersistenceError !== undefined,
                });
                updateMessageById(
                  message.id,
                  (prev) =>
                    applyDesignDeliveryOutcome(
                      {
                        ...prev,
                        content: deliveryContent,
                        events: deliveryEvents,
                        producedFiles: produced,
                        traceObjectFiles,
                      },
                      deliveryOutcome,
                      artifactPersistenceError,
                    ),
                  true,
                  { telemetryFinalized: true },
                );
                if (deliveryOutcome === 'no_result' || deliveryOutcome === 'delivery_failed') {
                  setError(artifactPersistenceError ?? DESIGN_RESULT_MISSING_DETAIL);
                }
              })();
              onProjectsRefresh();
            },
            onError: async (err) => {
              reattachHeardFromDaemon = true;
              const errorCode = (err as Error & { code?: string }).code;
              const resumable = (err as Error & { resumable?: boolean }).resumable === true;
              let skipFinalPersistNow = false;
              let retryFullReplayAfterCleanup = false;
              const genericDisconnect = isGenericDaemonDisconnect(err);
              const failure = runFailureFieldsFromError(err);
              // A superseded reattached run must not paint a global failure
              // banner or re-finalize its message over the replacement run.
              const runMayFinalize =
                !supersededRunsRef.current.has(controller);
              keepManualFileWritesForRecovery = genericDisconnect && runMayFinalize;

              if (keepManualFileWritesForRecovery) manualFileWriteRegistration.release(true);
              textBuffer.flush();
              textBuffer.cancel();
              unregisterTextBuffer();
              if (runMayFinalize) {
                setRunError(err.message, message.id);
                appendAssistantErrorEvent(
                  message.id,
                  err.message,
                  errorCode,
                  failure,
                  stderrTailFromError(err),
                );
                updateMessageById(
                  message.id,
                  (prev) => ({
                    ...prev,
                    runStatus: 'failed',
                    endedAt: prev.endedAt ?? Date.now(),
                    resumable,
                  }),
                  true,
                );
                if (!genericDisconnect && artifactFromRecoverableSourceText(replayedContent)) {
                  void (async () => {
                    if (recoveredArtifactMessagesRef.current.has(message.id)) return;
                    const latestRunStatus = await fetchChatRunStatus(runId).catch(() => null);
                    const artifactToPersist = chooseArtifactToPersist(parsedArtifact, replayedContent);
                    if (!artifactToPersist?.html) return;
                    const { producedFiles: produced } = await finalizeTurn(
                      {
                        projectId: project.id,
                        projectRoot: projectDetail.resolvedDir,
                        preTurnFileNames: message.preTurnFileNames,
                        turnStartedAt:
                          latestRunStatus?.createdAt || message.startedAt || message.createdAt,
                        autoOpenOptions: autoOpenArtifactOptions,
                        readOutput: () => ({
                          artifact: artifactToPersist,
                          sourceText: replayedContent,
                        }),
                        readTouchedPaths: () => extractTouchedFilePathsFromEvents(replayedEvents),
                        readAuthoritativeArtifactPaths: () => latestRunStatus?.artifactPaths,
                        readManualWrites: () => manualFileWrites,
                      },
                      TURN_POLICIES.reattachError,
                      turnPorts,
                    );
                    if (produced.length > 0) {
                      recoveredArtifactMessagesRef.current.add(message.id);
                    }
                    if (latestRunStatus?.status === 'succeeded') setError(null);

                    // Unlike the recoverArtifacts sibling below, this row's
                    // endedAt was already stamped synchronously above (~4041)
                    // at disconnect time — `prev.endedAt` is never null here,
                    // so a `prev.endedAt ?? ...` fallback would never fire.
                    // Overwrite it, but ONLY when the daemon just confirmed
                    // succeeded (the same condition gating the runStatus
                    // upgrade below) — `latestRunStatus` is already the fresh,
                    // confirmed-terminal probe from above, so its `updatedAt`
                    // is authoritative directly, with no extra re-probe.
                    // Otherwise this row is still not terminal and must keep
                    // its existing endedAt.
                    updateMessageById(
                      message.id,
                      (prev) => ({
                        ...prev,
                        content: replayedContent,
                        producedFiles: produced.length > 0 ? produced : prev.producedFiles,
                        resultDeliveryState:
                          produced.length > 0 ? 'delivered' : prev.resultDeliveryState,
                        runStatus: latestRunStatus?.status === 'succeeded' ? 'succeeded' : prev.runStatus,
                        endedAt:
                          latestRunStatus?.status === 'succeeded'
                            ? latestRunStatus.updatedAt
                            : prev.endedAt,
                      }),
                      true,
                      { telemetryFinalized: true },
                    );
                    onProjectsRefresh();
                  })();
                }
              }
              // Clear stale retry count for the run.  Generic disconnects
              // (browser SSE reconnect-budget exhaustion) are NOT authoritative
              // terminal failures — the daemon may still report the run as
              // queued/running/succeeded on the next attachRecoverableRuns tick.
              // Only seal completedReattachRunsRef for real terminal errors so
              // generic disconnects stay eligible for re-query.
              // Generic disconnects share the transient-retry budget with the
              // null-status path. Even once the generic-disconnect retry budget
              // is exhausted, we must not seal on a transient status-probe miss:
              // fetchChatRunStatus() returns null for any network/non-OK failure,
              // not only when the daemon has truly forgotten the run. Treat
              // null the same as an active retryable state and keep the row
              // eligible for future refresh/reattach. Only authoritative
              // terminal statuses seal completedReattachRunsRef.
              let shouldRefreshConversationAfterCleanup = true;
              let shouldRetryAfterControllerCleanup = false;
              if (genericDisconnect) {
                const attempts = (genericDisconnectRetriesRef.current.get(runId) ?? 0) + 1;
                if (attempts >= MAX_TRANSIENT_RETRIES) {
                  const backoffUntil = Date.now() + 3000;
                  genericDisconnectRetriesRef.current.set(runId, attempts);
                  genericDisconnectBackoffUntilRef.current.set(runId, backoffUntil);
                  // consumeDaemonRun invokes async error handlers without
                  // awaiting them. Clear the streaming marker before the status
                  // probe yields so the surrounding finally block cannot clear
                  // the refs first and strand the conversation in streaming.
                  clearCurrentRunStreamingMarker(
                    reattachConversationId,
                    controller,
                    cancelController,
                  );
                  const backoffTimer = scheduleProjectTimeout(() => {
                    genericDisconnectBackoffUntilRef.current.delete(runId);
                    shouldRetryAfterControllerCleanup = true;
                    setRecoveryTick((t) => t + 1);
                  }, 3000);
                  const latestRunStatus = await fetchChatRunStatus(runId).catch(() => null);
                  if (!latestRunStatus || isActiveRunStatus(latestRunStatus.status)) {
                    // If the backoff elapsed while this probe was still in
                    // flight, its recovery tick already ran while the run was
                    // still registered as reattaching. Re-run recovery after
                    // controller cleanup so the retry is not stranded until an
                    // unrelated state change.
                    shouldRefreshConversationAfterCleanup = false;
                  } else if (latestRunStatus.status === 'succeeded') {

                    clearProjectTimeout(backoffTimer);
                    setError(null);
                    // If the resumed stream already replayed some content/events
                    // before disconnecting again, finalizing this row as
                    // succeeded would persist a truncated transcript. Clear the
                    // partial local replay and trigger one immediate full replay
                    // from the daemon's terminal event log instead.
                    if (
                      needsFullReplay
                      && !(message.producedFiles?.length)
                      && (replayedContent.trim().length > 0 || replayedEvents.length > 0)
                    ) {
                      updateMessageById(
                        message.id,
                        (prev) => ({
                          ...removeErrorStatusEvent(prev, err.message, errorCode),
                          content: '',
                          events: [],
                          // A non-empty prefix would otherwise make the
                          // terminal-replay heuristic treat this row as fully
                          // restored. Keep it recoverable until the active
                          // Run's complete visible suffix is replayed.
                          runStatus: 'succeeded',
                          // Adopt the daemon's authoritative terminal timestamp rather
                          // than the stale disconnect-time stamp taken when the generic
                          // disconnect first fired.
                          endedAt: latestRunStatus.updatedAt,
                          ...(latestRunStatus.resumable !== undefined
                            ? { resumable: latestRunStatus.resumable }
                            : {}),
                        }),
                        true,
                        { telemetryFinalized: true },
                      );
                      retryFullReplayAfterCleanup = true;
                    } else {
                      updateMessageById(
                        message.id,
                        (prev) => ({
                          ...removeErrorStatusEvent(prev, err.message, errorCode),
                          runStatus: 'succeeded',
                          endedAt: latestRunStatus.updatedAt,
                          ...(latestRunStatus.resumable !== undefined
                            ? { resumable: latestRunStatus.resumable }
                            : {}),
                        }),
                        true,
                        { telemetryFinalized: true },
                      );
                    }
                    skipFinalPersistNow = true;
                    genericDisconnectRetriesRef.current.delete(runId);
                    genericDisconnectBackoffUntilRef.current.delete(runId);
                  } else {
                    clearProjectTimeout(backoffTimer);
                    if (latestRunStatus.status === 'canceled') setError(null);
                    updateMessageById(
                      message.id,
                      (prev) => ({
                        ...prev,
                        runStatus: latestRunStatus.status,
                        endedAt: latestRunStatus.updatedAt,
                        ...(latestRunStatus.resumable !== undefined
                          ? { resumable: latestRunStatus.resumable }
                          : {}),
                      }),
                      true,
                      { telemetryFinalized: true },
                    );
                    skipFinalPersistNow = true;
                    completeReattachRuns();
                    genericDisconnectRetriesRef.current.delete(runId);
                    genericDisconnectBackoffUntilRef.current.delete(runId);
                  }
                } else {
                  genericDisconnectRetriesRef.current.set(runId, attempts);
                }
              } else {
                transientFailedRetriesRef.current.delete(runId);
                genericDisconnectRetriesRef.current.delete(runId);
                genericDisconnectBackoffUntilRef.current.delete(runId);
                completeReattachRuns();
              }
              manualFileWriteRegistration.release(keepManualFileWritesForRecovery);
              releaseReattachRuns();
              clearCurrentRunStreamingMarker(reattachConversationId, controller, cancelController);
              if (!skipFinalPersistNow) persistNow({ telemetryFinalized: true });
              if (shouldRetryAfterControllerCleanup && !shouldRefreshConversationAfterCleanup) {
                setRecoveryTick((t) => t + 1);
              }
              if (retryFullReplayAfterCleanup) setRecoveryTick((t) => t + 1);
              if (shouldRefreshConversationAfterCleanup) {
                scheduleConversationMessageRefresh(reattachConversationId);
              }
            },
          },
          onRunStatus: (runStatus) => {
            textBuffer.flush();
            /*
             * 回放出来的「活着」不许压过 daemon 的终态裁定 —— 判据与理由见
             * `replayedRunStatusMayLand`。挡下的帧连 `settled` 信号都不发:
             * 什么都没有落定,重连那一行不该被一帧历史扰动。
             */
            if (
              !replayedRunStatusMayLand(
                runStatus,
                reattachTerminalVerdict,
                activeReattachRunId === reattachRunId,
              )
            ) {
              return;
            }
            // 见发送路径同名回调:落终态就把重连那一行让出去。
            pushReconnectSignal({ kind: 'settled', runId, status: runStatus });
            updateMessageById(
              message.id,
              (prev) => ({
                ...prev,
                runStatus,
                endedAt: isTerminalRunStatus(runStatus) ? prev.endedAt ?? Date.now() : prev.endedAt,
              }),
              true,
            );
            latestReattachRunStatus = runStatus;
            if (isTerminalRunStatus(runStatus)) reattachHeardFromDaemon = true;
            if (runStatus === 'canceled') {
              textBuffer.cancel();
              unregisterTextBuffer();
              // Clear stale retry count for canceled run.
              transientFailedRetriesRef.current.delete(runId);
              genericDisconnectRetriesRef.current.delete(runId);
              genericDisconnectBackoffUntilRef.current.delete(runId);
              completeReattachRuns();
              releaseReattachRuns();
              clearCurrentRunStreamingMarker(reattachConversationId, controller, cancelController);
            }
            if (isTerminalRunStatus(runStatus)) {
              scheduleConversationMessageRefresh(reattachConversationId);
            }
          },
          /* 同上:重连接管的那条 run 被停掉时,来源同样落到它自己的消息上。 */
          onCancelOrigin: (cancelOrigin) => {
            textBuffer.flush();
            updateMessageById(message.id, (prev) => ({ ...prev, cancelOrigin }), true);
          },
          onRunEventId: (lastRunEventId) => {
            textBuffer.flush();
            updateMessageById(message.id, (prev) => ({ ...prev, lastRunEventId }));
            persistSoon();
          },
        })
          .catch((err) => {
            keepManualFileWritesForRecovery = false;
            // Skip AbortError (expected on interrupt) and any error from a run
            // that was tagged superseded by a send-now interrupt — it must not
            // surface a global failure over the replacement.
            const runMayFinalize =
              !supersededRunsRef.current.has(controller);
            if ((err as Error).name !== 'AbortError' && runMayFinalize) {
              const msg = err instanceof Error ? err.message : String(err);
              setRunError(msg, message.id);
              appendAssistantErrorEvent(message.id, msg);
              updateMessageById(
                message.id,
                (prev) => ({ ...prev, runStatus: 'failed', endedAt: prev.endedAt ?? Date.now() }),
                true,
                { telemetryFinalized: true },
              );
            }
          })
          .finally(() => {
            manualFileWriteRegistration.release(keepManualFileWritesForRecovery);
            textBuffer.flush();
            textBuffer.cancel();
            unregisterTextBuffer();
            if (persistTimer) clearProjectTimeout(persistTimer);
            /*
             * **不变量:一次 daemon 一句话都没说的重挂,不构成「再试一次」的理由。**
             *
             * 这条 effect 的依赖里带着 `messages`,而重挂过程中每条回放事件都会
             * `updateMessageById` —— 它的 `setMessages((curr) => curr.map(...))` 永远返回
             * 新数组,所以每条事件都让 effect 重跑一次。正常收场时不要紧:`onDone` /
             * `onError` / 终态 `onRunStatus` 都会 `completeReattachRuns()` 把这条 run 封存,
             * 重跑时在封存那道闸上直接 `continue`。
             *
             * 但流**没给出任何裁定**就结束时,收尾只走这里的 `releaseReattachRuns()`:
             * 认领被释放、又没被封存,于是下一次重跑立刻又订阅一次、又回放一整份日志、
             * 又改一遍 `messages` —— 实测约 120 次/秒,每次都带一次 SSE 订阅和一次
             * `saveMessage`,栈就落在用户报的 `onRunEventId → updateMessageById` 和
             * `persistSoon → persistMessageById` 上。
             *
             * 封存不是死路:重连行的手动重试(`handleManualReconnect`)会把这条 run 从
             * `completedReattachRunsRef` 里删掉,用户始终有出路。
             *
             * 我们自己 abort 掉的那次除外 —— 那是卸载/切会话/按停的收尾,不是
             * 「daemon 没说话」;那些路径各自会重挂或把这一行落终态,封存反而会让
             * 切回来时接不上。
             */
            if (!reattachHeardFromDaemon && !controller.signal.aborted) {
              completeReattachRuns();
            }
            releaseReattachRuns();
            clearActiveRunRefs(reattachConversationId, controller, cancelController);
          });
        /*
         * 组件 22 · 重连 · 连接预算:重挂**排队**,但只排「回放」那一类。
         *
         * `reattachDaemonRun` 的 promise 要等这条流走完才 settle。daemon 还说
         * 这条 run 活着时,那就是「等这次生成结束」——把它放进闸里,后面排队的
         * run 在它跑完之前一个字都收不到,那不是限流,是丢输出。所以活着的 run
         * 直接放行,只有终态回放(有限的事件日志,很快 settle)进闸。
         *
         * 闸只改**同时**开几条,不改开不开:被挡住的那条在前一条 settle 时立刻
         * 补上(见 lib/bounded-concurrency.ts)。
         */
        const reattachIsLiveStream =
          isActiveRunStatus(message.runStatus) || isActiveRunStatus(status.status);
        if (reattachIsLiveStream) {
          void startReattach();
        } else {
          void reattachReplayGate.run(startReattach);
        }
      }
    };

    void attachRecoverableRuns();
    return () => {
      cancelled = true;
      // Clear any pending transient-retry timers so they don't fire after
      // unmount or after the effect re-enters for a different conversation.
      for (const handle of transientRetryTimersRef.current) {
        clearTimeout(handle);
      }
      transientRetryTimersRef.current = new Set();
    };
  }, [daemonLive, config.mode, activeConversationId, projectRunAuthorityKey, currentProject.metadata, streaming, messages, project.id, updateMessageById, persistMessageById, markStreamingConversation, clearStreamingMarker, clearActiveRunRefs, clearCurrentRunStreamingMarker, clearProjectTimeout, refreshProjectFiles, registerManualFileWrites, findDetachedManualFileWrites, readProjectHtml, persistArtifact, requestOpenFile, requestOpenTurnArtifacts, onProjectsRefresh, scheduleProjectTimeout, scheduleConversationMessageRefresh, recoveryTick]);

  useEffect(() => {
    if (config.mode !== 'daemon' || !daemonLive || !activeConversationId) return;
    if (!currentConversationHasRecoverableArtifact) return;
    let cancelled = false;
    let recovering = false;

    const recoverArtifacts = async () => {
      if (recovering) return;
      recovering = true;
      const retainedReceipts = new Map<string, NonNullable<ReturnType<typeof findDetachedManualFileWrites>>>();
      const releaseReceipts: Array<() => void> = [];
      const retainReceipt = (runId: string) => {
        const existing = retainedReceipts.get(runId);
        if (existing) return existing;
        const receipt = findDetachedManualFileWrites(activeConversationId, runId);
        if (receipt) {
          retainedReceipts.set(runId, receipt);
          releaseReceipts.push(receipt.retain());
        }
        return receipt;
      };
      try {
        // Pin the live writer before the first HTTP await. A sibling terminal
        // finalizer may accept an earlier output meanwhile; late manual saves
        // still have to update this same run's proof until recovery finishes.
        for (const message of messagesRef.current) {
          if (message.runId && hasRecoverableArtifactMessage(message)) retainReceipt(message.runId);
        }
        const serverMessages = await listMessages(project.id, activeConversationId).catch(() => null);
        if (cancelled) return;
        const recoveryMessages = serverMessages && serverMessages.length > 0
          ? serverMessages
          : messagesRef.current;
        for (const message of recoveryMessages) {
          if (cancelled) return;
          if (!hasRecoverableArtifactMessage(message)) continue;
          if (recoveredArtifactMessagesRef.current.has(message.id)) continue;
          const runId = message.runId;
          if (!runId) continue;
          retainReceipt(runId);
          const latestAssistantMessage = () => {
            for (let index = messagesRef.current.length - 1; index >= 0; index -= 1) {
              const item = messagesRef.current[index];
              // A host memory card belongs to the preceding turn; it does not
              // supersede that run's pending artifact persistence.
              if (item?.role === 'assistant' && !assistantMessageNeverHadARun(item)) return item;
            }
            return undefined;
          };
          const latestAssistantAtStart = latestAssistantMessage();
          const recoveryTargetIsCurrent = () => {
            const latestAssistant = latestAssistantMessage();
            return mountedRef.current
              && projectIdRef.current === project.id
              && activeConversationIdRef.current === activeConversationId
              && (projectResourceAuthorityRef.current === 'local')
              && latestAssistant?.id === latestAssistantAtStart?.id
              && latestAssistant?.runId === latestAssistantAtStart?.runId
              && messagesRef.current.some((item) => item.id === message.id && item.runId === runId);
          };

          const sourceText = message.content.trim().length > 0
            ? message.content
            : textContentFromAgentEvents(message.events);

          const parser = createArtifactParser();
          let parsedArtifact: Artifact | null = null;
          let liveHtml = '';
          for (const ev of [...parser.feed(sourceText), ...parser.flush()]) {
            if (ev.type === 'artifact:start') {
              liveHtml = '';
              parsedArtifact = {
                identifier: ev.identifier,
                artifactType: ev.artifactType,
                title: ev.title,
                html: '',
              };
              setArtifact(parsedArtifact);
            } else if (ev.type === 'artifact:chunk') {
              liveHtml += ev.delta;
              parsedArtifact = artifactWithHtml(parsedArtifact, ev.identifier, liveHtml);
              setArtifact((prev) =>
                artifactWithHtml(prev, ev.identifier, liveHtml),
              );
            } else if (ev.type === 'artifact:end') {
              parsedArtifact = artifactWithHtml(parsedArtifact, ev.identifier, ev.fullContent);
              setArtifact((prev) =>
                prev ? artifactWithHtml(prev, ev.identifier, ev.fullContent) : null,
              );
            }
          }

          const artifactToPersist = chooseArtifactToPersist(parsedArtifact, sourceText);
          if (!artifactToPersist?.html) continue;
          const latestRunStatus = await fetchChatRunStatus(runId).catch(() => null);
          if (cancelled || !recoveryTargetIsCurrent()) return;
          const finalized = await finalizeTurn(
            {
              projectId: project.id,
              projectRoot: projectDetail.resolvedDir,
              preTurnFileNames: message.preTurnFileNames,
              turnStartedAt: latestRunStatus?.createdAt || message.startedAt || message.createdAt,
              autoOpenOptions: autoOpenArtifactOptions,
              readOutput: () => ({ artifact: artifactToPersist, sourceText }),
              readTouchedPaths: () => extractTouchedFilePathsFromEvents(message.events),
              readAuthoritativeArtifactPaths: () => latestRunStatus?.artifactPaths,
              readManualWrites: () => retainReceipt(runId)?.files ?? new Map<string, ProjectFile>(),
            },
            TURN_POLICIES.recovery,
            {
              ...turnPorts,
              isCurrent: (checkpoint, matched) => {
                if (checkpoint === 'after-first-refresh') return !cancelled;
                if (checkpoint !== 'before-attribution') return recoveryTargetIsCurrent();
                // Another terminal finalizer can accept an earlier output while this
                // artifact POST is pending. That changes recovery eligibility and
                // cleans up this effect, but the successful write still belongs to
                // this same scoped run and must finish its message projection.
                return recoveryTargetIsCurrent() && !(cancelled && !matched);
              },
            },
          );
          if (!finalized) return;
          const { producedFiles: produced, attributeFiles } = finalized;
          if (produced.length === 0) {
            continue;
          }
          const recoveredManualFileWrites = retainReceipt(runId);
          recoveredArtifactMessagesRef.current.add(message.id);
          // This message's persisted runStatus was already terminal (a
          // precondition of hasRecoverableArtifactMessage); when it has no
          // stored endedAt, fall back to the daemon's authoritative terminal
          // timestamp (already fetched above as latestRunStatus) instead of
          // this reload/poll's wall-clock time.
          const recoveredArtifactEndedAt = await resolveTerminalEndedAt(
            runId,
            latestRunStatus,
          );
          if (!recoveryTargetIsCurrent()) return;
          updateMessageById(
            message.id,
            (prev) => prev.runId !== runId ? prev : ({
              ...prev,
              content: sourceText,
              producedFiles: produced,
              // Keep this recovery path's existing optional trace surface;
              // only remove unchanged files proven to be manual writes.
              ...(prev.traceObjectFiles ? {
                traceObjectFiles: attributeFiles(prev.traceObjectFiles),
              } : {}),
              resultDeliveryState: 'delivered',
              runStatus:
                latestRunStatus?.status === 'succeeded'
                  ? 'succeeded'
                  : prev.runStatus,
              endedAt: prev.endedAt ?? recoveredArtifactEndedAt,
            }),
            true,
            { telemetryFinalized: true },
          );
          recoveredManualFileWrites?.dispose();
          scheduleConversationMessageRefresh(activeConversationId);
          onProjectsRefresh();
        }
      } finally {
        for (const release of releaseReceipts) release();
        recovering = false;
      }
    };

    void recoverArtifacts();
    const interval = window.setInterval(() => {
      void recoverArtifacts();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [daemonLive, config.mode, activeConversationId, project.id, projectDetail.resolvedDir, findDetachedManualFileWrites, currentConversationHasRecoverableArtifact, refreshProjectFiles, persistArtifact, requestOpenFile, updateMessageById, scheduleConversationMessageRefresh, onProjectsRefresh]);

  const commitQueuedChatSends = useCallback((next: QueuedChatSend[]) => {
    queuedChatSendsRef.current = next;
    setQueuedChatSends(next);
    saveQueuedChatSends(project.id, next);
  }, [project.id]);

  const enqueueChatSend = useCallback((item: QueuedChatSend) => {
    if (queuedChatSendsRef.current.some((candidate) => candidate.id === item.id)) {
      return false;
    }
    const next = [...queuedChatSendsRef.current, item];
    commitQueuedChatSends(next);
    return true;
  }, [commitQueuedChatSends]);

  const removeQueuedChatSend = useCallback((id: string) => {
    const next = queuedChatSendsRef.current.filter((item) => item.id !== id);
    commitQueuedChatSends(next);
  }, [commitQueuedChatSends]);

  // The user taking a send out of the queue, as opposed to the drain removing
  // one whose run has started.
  const discardQueuedChatSend = useCallback((id: string) => {
    const item = queuedChatSendsRef.current.find((candidate) => candidate.id === id);
    removeQueuedChatSend(id);
  }, [ removeQueuedChatSend]);

  const updateQueuedChatSend = useCallback((id: string, update: QueuedChatSendUpdate) => {
    const edited = queuedChatSendsRef.current.find((item) => item.id === id);
    const next = queuedChatSendsRef.current.map((item) => {
      if (item.id !== id) return item;
      const meta = stripQueueOnlyFromMeta({ ...(item.meta ?? {}), ...(update.meta ?? {}) });
      const updated: QueuedChatSend = {
        ...item,
        prompt: update.prompt,
        attachments: update.attachments,
      };
      if (meta === undefined) delete updated.meta;
      else updated.meta = meta;
      return updated;
    });
    commitQueuedChatSends(next);
    if (edited) {
    }
  }, [commitQueuedChatSends,]);

  const prioritizeQueuedChatSend = useCallback((id: string) => {
    const item = queuedChatSendsRef.current.find((candidate) => candidate.id === id);
    if (!item) return;
    const next = [item, ...queuedChatSendsRef.current.filter((candidate) => candidate.id !== id)];
    commitQueuedChatSends(next);
  }, [commitQueuedChatSends]);

  const reorderCurrentConversationQueuedChatSends = useCallback((orderedIds: string[]) => {
    if (!activeConversationId || orderedIds.length === 0) return;
    const order = new Map(orderedIds.map((id, index) => [id, index]));
    const current = queuedChatSendsRef.current;
    const originalConversationItems = current.filter(
      (item) => item.conversationId === activeConversationId,
    );
    const sortedConversationItems = [...originalConversationItems].sort((a, b) => {
      const aOrder = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });
    if (
      sortedConversationItems.every((item, index) => item.id === originalConversationItems[index]?.id)
    ) {
      return;
    }
    let cursor = 0;
    const next = current.map((item) => {
      if (item.conversationId !== activeConversationId) return item;
      return sortedConversationItems[cursor++] ?? item;
    });
    commitQueuedChatSends(next);
  }, [activeConversationId, commitQueuedChatSends]);

  const queueChatSendForCurrentConversation = useCallback((input: {
    attachments: ChatAttachment[];
    conversationId: string;
    /** A pre-run gate is holding this send, so no run is coming on its own. */
    heldBeforeRun?: boolean;
    meta?: ProjectChatSendMeta;
    prompt: string;
  }) => {
    const clientRequestId = input.meta?.clientRequestId ?? randomUUID();
    const queuedMeta = stripQueueOnlyFromMeta({
      ...(input.meta ?? {}),
      clientRequestId,
    });
    const enqueued = enqueueChatSend({
      id: clientRequestId,
      conversationId: input.conversationId,
      prompt: input.prompt,
      attachments: input.attachments,
      ...(queuedMeta === undefined ? {} : { meta: queuedMeta }),
      createdAt: Date.now(),
    });
    if (!enqueued) return;
  }, [ enqueueChatSend, project.id, null]);

  const handleSend = useCallback(
    async (
      prompt: string,
      attachments: ChatAttachment[],
      meta?: ProjectChatSendMeta,
      baseMessages?: ChatMessage[],
    ) => {
      if (projectReadsHeld) return false;
      if (!activeConversationId) return false;
      if (messagesConversationIdRef.current !== activeConversationId) return false;
      const clientRequestId = meta?.clientRequestId ?? randomUUID();
      meta = {
        ...(meta ?? {}),
        clientRequestId,
      };
      const runSessionMode = meta?.sessionMode ?? activeSessionMode;
      const retryTarget = meta?.retryOfAssistantId
        ? resolveRetryTarget(messages, meta.retryOfAssistantId)
        : null;
      if (meta?.retryOfAssistantId && !retryTarget) return false;
      const blockedRequestKey = JSON.stringify([
        prompt,
        attachments.map((attachment) => [attachment.path, attachment.name]),
      ]);
      const pendingBlockedTask = blockedRunTaskRef.current;
      const resumesBlockedTask = !meta?.taskAnalytics
        && !retryTarget
        && pendingBlockedTask?.conversationId === activeConversationId
        && pendingBlockedTask.requestKey === blockedRequestKey;
      if (
        pendingBlockedTask?.conversationId === activeConversationId
        && pendingBlockedTask.requestKey !== blockedRequestKey
      ) {
        blockedRunTaskRef.current = null;
      }
      let taskAnalytics = meta?.taskAnalytics
        ?? (retryTarget
          ? buildRecoveryTaskAnalytics(
              messages,
              retryTarget.failedAssistant,
              'manual_retry',
            )
          : resumesBlockedTask
            ? pendingBlockedTask.taskAnalytics
          : buildInitialTaskAnalytics(randomUUID()));
      const runContext = meta?.context ?? retryTarget?.userMsg.runContext;
      const unclaimedHistoryBase = retryTarget
        ? retryTarget.priorMessages
        : baseMessages ?? messages;
      // Stable user ids are also used by retries and durable queue drains. If
      // the row is already visible, replace its position below instead of
      // appending a second copy of the same logical user turn.
      const historyBase = meta?.userMessageId
        ? unclaimedHistoryBase.filter((message) => message.id !== meta.userMessageId)
        : unclaimedHistoryBase;
      if (
        !retryTarget &&
        !prompt.trim() &&
        attachments.length === 0
      ) return false;
      const effectiveAttachments = mergeChatAttachments(attachments);
      const byokOpenCodeProvider = byokOpenCodeProviderFromConfig(config);
      const nativeByokProvider = (config.mode === 'api' || config.agentId === 'byok-opencode') && byokOpenCodeProvider
        ? nativeCodexProviderForConfig(byokOpenCodeProvider)
        : null;
      const requiresByokPreflight =
        (config.mode === 'api' && config.apiProtocol !== 'bedrock') ||
        (config.mode === 'daemon' && config.agentId === 'byok-opencode');
      if (requiresByokPreflight && !byokOpenCodeProvider) {
        const blockReason = byokPreflightBlockReason(config) ?? 'config_invalid';
        const recoveryActionInstanceId = `blocked:${taskAnalytics.taskExecutionId}`;
        const recoveryActionType: TrackingRunRecoveryActionType =
          blockReason === 'model_required' || blockReason === 'model_default'
            ? 'switch_model_retry'
            : blockReason === 'api_key_required' || blockReason === 'api_key_invalid'
              ? 'authorize_and_retry'
              : 'manual_retry';
        taskAnalytics = {
          ...taskAnalytics,
          recoveryActionType,
          recoveryActionInstanceId,
        };
        blockedRunTaskRef.current = {
          conversationId: activeConversationId,
          requestKey: blockedRequestKey,
          taskAnalytics,
        };
        trackByokPreflightBlocked(analytics.track, {
          source: 'run',
          reason: blockReason,
          provider_id: byokProtocolToTracking(config.apiProtocol) ?? 'unknown',
          active_execution_mode: executionModeToTracking(config.mode),
        });
        trackRunStartBlockedSurfaceView(analytics.track, {
          page_name: 'chat_panel',
          area: 'chat_composer',
          element: 'run_start_blocked',
          task_execution_id: taskAnalytics.taskExecutionId,
          recovery_action_instance_id: recoveryActionInstanceId,
          block_reason: blockReason,
          agent_provider_id: byokProtocolToTracking(config.apiProtocol) ?? 'unknown',
          model_id: config.model?.trim() || 'default',
        });
        setError(BYOK_PROVIDER_REQUIRED_MESSAGE);
        onOpenSettings('execution');
        return false;
      }
      if (!retryTarget && meta?.queueOnly) {
        queueChatSendForCurrentConversation({
          conversationId: activeConversationId,
          prompt,
          attachments: effectiveAttachments,
          meta: { ...(meta ?? {}), sessionMode: runSessionMode, taskAnalytics },
        });
        // `true` means the send has been durably accepted by this view's
        // queue. Callers that hold a saved comment in their composer may only
        // let go of it after this acknowledgement; preflight rejection
        // remains `false`. The comment itself is never deleted by a send.
        return true;
      }
      if (currentConversationBusy) {
        queueChatSendForCurrentConversation({
          conversationId: activeConversationId,
          prompt,
          attachments: effectiveAttachments,
          meta: { ...(meta ?? {}), sessionMode: runSessionMode, taskAnalytics },
        });
        return meta?.acceptDurableQueue === true;
      }
      const runConversationId = activeConversationId;
      // This is the accepted retry boundary: all synchronous refusal paths are
      // above it. A later preflight/POST failure supplies its own current surface.
      if (retryTarget && meta?.retryOfAssistantId) {
        supersedeRetriedError(runConversationId, meta.retryOfAssistantId, retryTarget.failedAssistant.id);
      }
      setError(null);
      /*
       * 【和上屏同一批】`chatSeed?.id` 是 `ChatPane` 的 `key` 的一部分 —— 清它会把
       * 整个面板**重挂**。重挂会清掉 anchor-to-top 的那两个 ref,而重挂之后到齐的
       * 转录按定义「不是新发的一轮」(`isNewTailUserTurn`),于是这一轮钉不了顶。
       * 原来它和 `setMessages` 在同一批里,重挂和上屏是同一帧;上屏提前而它留在
       * 预检后面的话,就变成「先画好、1–2 秒后再把面板拆了重来」,反而制造出
       * OPEND-2615 那个症状。两件事必须绑在一起。
       */
      setChatSeed(null);
      const startedAt = Date.now();
      const previousConversation = conversationsRef.current.find(
        (conversation) => conversation.id === runConversationId,
      );
      const previousConversationUpdatedAt = previousConversation?.updatedAt;
      const previousConversationLatestRun = previousConversation?.latestRun;
      const userMsg: ChatMessage = retryTarget?.userMsg ?? {
        id: meta?.userMessageId ?? randomUUID(),
        role: 'user',
        content: prompt,
        createdAt: startedAt,
        clientRequestId,
        sessionMode: runSessionMode,
        taskAnalytics,
        ...(meta?.appliedPluginSnapshot
          ? { appliedPluginSnapshot: meta.appliedPluginSnapshot }
          : {}),
        ...(runContext ? { runContext } : {}),
        attachments: effectiveAttachments.length > 0 ? effectiveAttachments : undefined,
      };
      const runAttachments = mergeChatAttachments(userMsg.attachments ?? []);
      const selectedAgentChoice =
        config.mode === 'daemon' && config.agentId
          ? config.agentModels?.[config.agentId]
          : undefined;
      const { agentId: assistantAgentId, agentName: assistantAgentName } = resolveSelectedAssistantIdentity(config, agents);
      // A kickoff turn can start before this page ever loaded the file list; see `turnStartBaseline`.
      const preTurnBaseline = turnStartBaseline(projectFiles, projectFilesGenerationRef.current > 0, () => refreshProjectFiles());
      const preTurnFileNames = preTurnBaseline.names;
      const assistantId = meta?.assistantMessageId ?? randomUUID();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        agentId: assistantAgentId,
        agentName: assistantAgentName,
        events: [],
        createdAt: startedAt,
        runStatus: config.mode === 'daemon' ? 'running' : undefined,
        startedAt,
        sessionMode: runSessionMode,
        taskAnalytics,
        preTurnFileNames,
      };
      let latestAssistantMsg: ChatMessage = assistantMsg;
      // Tracks the runId once POST /api/runs returns so that the live stream
      // onError handler can mark the run as completed in completedReattachRunsRef.
      // This prevents attachRecoverableRuns from attempting to reattach a run
      // that just failed in the current session (the daemon status fetch is only
      // needed on reload, not for runs that are already known to have failed).
      let currentRunId: string | undefined = undefined;
      let daemonArtifactCount: number | undefined;
      const updateConversationLatestRun = (
        status: NonNullable<ChatMessage['runStatus']>,
        endedAt?: number,
      ) => {
        setConversations((curr) =>
          curr.map((conversation) =>
            conversation.id === runConversationId
              ? {
                  ...conversation,
                  updatedAt: endedAt ?? startedAt,
                  latestRun: {
                    status,
                    startedAt,
                    ...(endedAt === undefined
                      ? {}
                      : {
                          endedAt,
                          durationMs: Math.max(0, endedAt - startedAt),
                        }),
                  },
                }
              : conversation,
          ),
        );
      };
      const nextHistory = retryTarget
        ? [...retryTarget.priorMessages, userMsg]
        : [...historyBase, userMsg];
      const nextVisibleMessages = retryTarget
        ? [...nextHistory, ...retryTarget.preservedAttempts, assistantMsg]
        : [...nextHistory, assistantMsg];
      /*
       * 画出去 —— 同时把画之前的样子记下来。预检拒绝时要**原样**放回去,而
       * 「原样」只有这一刻知道:`messages` 是一份快照,不是能从这一轮反算出来的量
       * (重试那一路尤其:被重试的那条用户消息和保留下来的失败尝试都在里面)。
       */
      const paintedFrom: { messages: ChatMessage[] | null } = { messages: null };
      setMessages((current) => {
        paintedFrom.messages = current;
        return nextVisibleMessages;
      });
      markStreamingConversation(runConversationId);
      // The send check confirms sign-in only; funding is decided by Link as
      // the run starts. Home sends that already checked the same identity skip
      // the duplicate sign-in read here.

      /*
       * 上屏提前带来的**新状态**:预检那一两秒里,这一轮已经在跑的样子摆在屏幕上,
       * 于是〔停止〕这颗按钮**第一次**在建出 run 之前可以按。按下去
       * `handleStop` 会把进行中标记清掉、把这条 assistant 收成「已停止」——
       * 如果这里不看一眼,预检回来之后照样持久化并 `POST /api/runs`,
       * 用户明明叫停了却还是跑起来一轮。
       *
       * 判据用进行中标记本身:它是「这条会话此刻认领着哪一轮」的唯一出处,
       * 停止、切走、被别的轮接管,三种情况一次说清。
       *
       * **不收回画面**:停止那条路已经把这一轮收成终态了(用户消息留着,
       * assistant 标成已停止),这里再按预检那套原样放回去,会把用户刚发的
       * 那条消息一起抹掉。
       */
      if (streamingConversationIdRef.current !== runConversationId) return false;
      if (resumesBlockedTask) blockedRunTaskRef.current = null;
      activeCompletionNotificationRunsRef.current.add(assistantId);
      updateConversationLatestRun(config.mode === 'daemon' ? 'running' : 'queued');
      setArtifact(null);
      savedArtifactRef.current = null;
      onTouchProject();
      if (!retryTarget) {
        // This row exists nowhere else until its PUT or POST /api/runs lands,
        // and the user can reload before either does, so this save is durable.
        //
        // A send whose id was decided from its occupancy (an inline question
        // form's answer) claims that row once: the daemon keeps whichever
        // answer landed first and hands it back, and this view adopts it so
        // the transcript shows the answer the surviving run actually read.
        if (meta?.userMessageId) {
          void Promise.resolve(
            saveMessage(project.id, runConversationId, userMsg, {
              createOnly: true,
              durable: true,
            }),
          ).then((stored) => {
            if (!stored || stored.content === userMsg.content) return;
            setMessages((current) =>
              current.map((message) =>
                message.id === userMsg.id ? { ...message, content: stored.content } : message,
              ),
            );
          });
        } else {
          persistMessage(userMsg, { durable: true });
        }
      }
      // Intentionally do NOT persist `assistantMsg` here. In daemon mode it
      // starts as runStatus='running' with no runId, which the source-level
      // guard treats as a phantom — the first DB write happens inside
      // `onRunCreated` (below) once POST /api/runs returns a runId. In API
      // mode there is no runStatus, and the buffered text path will persist
      // as soon as the first delta lands.
      persistMessage(assistantMsg);
      const isFirstTurn = !retryTarget && historyBase.length === 0;
      const fallbackFirstTurnTitle = summarizeProjectNameFromPrompt(prompt) || prompt.slice(0, 60).trim();
      const fallbackProjectName = summarizeProjectNameFromPrompt(prompt);
      // If this is the first turn, derive a working title from the prompt
      // so the conversation is identifiable in the dropdown without a
      // round-trip through the agent.
      if (isFirstTurn) {
        const title = fallbackFirstTurnTitle;
        if (title) {
          setConversations((curr) =>
            curr.map((c) =>
              c.id === runConversationId ? { ...c, title } : c,
            ),
          );
          void patchConversation(project.id, runConversationId, { title });
        }
        const projectName = fallbackProjectName;
        if (
          projectName &&
          projectName !== project.name &&
          canAutoRenameProjectFromPrompt(project, prompt)
        ) {
          const metadata = project.metadata
            ? { ...project.metadata, nameSource: 'prompt' as const }
            : undefined;
          const updated: Project = {
            ...project,
            name: projectName,
            ...(metadata ? { metadata } : {}),
            updatedAt: Date.now(),
          };
          onProjectChange(updated);
          void patchProject(project.id, {
            name: projectName,
            ...(metadata ? { metadata } : {}),
          });
        }
      }
      const canReplaceConversationTitle = (title: string | null | undefined) => {
        const trimmed = (title ?? '').trim();
        return (
          !trimmed ||
          trimmed === fallbackFirstTurnTitle ||
          trimmed === prompt.slice(0, 60).trim()
        );
      };
      const applyAgentGeneratedTitle = (rawTitle: string) => {
        if (!isFirstTurn) return;
        const agentTitle = rawTitle.trim();
        if (!agentTitle) return;
        const currentConversationTitle = conversationsRef.current.find(
          (conversation) => conversation.id === runConversationId,
        )?.title;
        const shouldPatchConversation = canReplaceConversationTitle(currentConversationTitle);
        setConversations((curr) =>
          curr.map((conversation) => {
            if (conversation.id !== runConversationId) return conversation;
            if (!canReplaceConversationTitle(conversation.title)) return conversation;
            return { ...conversation, title: agentTitle };
          }),
        );
        if (shouldPatchConversation) {
          void patchConversation(project.id, runConversationId, { title: agentTitle });
        }
        if (
          agentTitle !== project.name &&
          canAutoRenameProjectFromPrompt(project, prompt)
        ) {
          const metadata = project.metadata
            ? { ...project.metadata, nameSource: 'agent' as const }
            : undefined;
          const updated: Project = {
            ...project,
            name: agentTitle,
            ...(metadata ? { metadata } : {}),
            updatedAt: Date.now(),
          };
          onProjectChange(updated);
          void patchProject(project.id, {
            name: agentTitle,
            ...(metadata ? { metadata } : {}),
          });
        }
      };

      // Snapshot the file list at turn-start so we can diff after the
      // agent finishes and surface anything new (e.g. a generated .pptx)
      // as download chips on the assistant message.
      const beforeFileNames = preTurnBaseline.set;
      // Pending Write/Edit tool invocations for this run: tool_use_id -> path.
      // Keeping this local prevents a superseded stream's late tool_result from
      // consuming a replacement run's colliding tool id.
      const pendingWrites = new Map<string, string>();
      const traceTouchedFilePaths = new Set<string>();
      const manualFileWrites = new Map<string, ProjectFile>();
      // Per-write file-list reads are intentionally fire-and-forget so a file
      // can open while the run is still streaming. Once terminal completion
      // has selected a turn-level artifact, however, an older Write refresh
      // must not move focus again.
      let completionSelectedAutoOpen = false;
      let liveFocusClosed = false;
      let latestExplicitFocusRequest = 0;
      // A new run gets a clean slate: taking the preview over during the last
      // turn says nothing about this one.
      userTookOverPreviewRef.current = false;
      const clearTraceTouchedFilePaths = (recoverable = false) => {
        manualFileWriteRegistration.release(recoverable);
        pendingWrites.clear();
        traceTouchedFilePaths.clear();
      };
      const provenTraceTouchedFiles = () => [...traceTouchedFilePaths]
        .map((touchedPath, index) => {
          const name = provenProjectRelativeToolPath(
            touchedPath,
            projectDetail.resolvedDir,
          );
          return name ? { name, path: name, mtime: index } : null;
        })
        .filter((file): file is { name: string; path: string; mtime: number } => file !== null);

      const parser = createArtifactParser();
      let parsedArtifact: Artifact | null = null;
      let liveHtml = '';
      let streamedText = '';

      const updateAssistant = (updater: (prev: ChatMessage) => ChatMessage) => {
        setMessages((curr) => {
          const messageIndex = curr.findIndex((message) => message.id === assistantId);
          if (messageIndex >= 0) {
            const previous = curr[messageIndex]!;
            const updated = updater(previous);
            latestAssistantMsg = updated;
            if (updated === previous) return curr;
            const next = curr.slice();
            next[messageIndex] = updated;
            return next;
          }

          // A workspace-authority refresh can reload the same conversation
          // while POST /runs is retrying. That authoritative read may still
          // be empty and replace the Home handoff's client-owned user and
          // assistant placeholders. The stream remains attached, however, so
          // dropping later deltas here leaves a successful daemon run blank
          // until a tab switch or reload reads the persisted transcript.
          //
          // Restore only the two rows owned by the live controller for the
          // project and conversation still on screen. A revoked authority is
          // never allowed to resurrect them, and settled historical messages
          // keep the existing clear-on-authority-change behavior.
          if (
            abortRef.current !== controller
            || projectIdRef.current !== project.id
            || activeConversationIdRef.current !== runConversationId
            || projectResourceAuthorityRef.current !== 'local'
          ) {
            return curr;
          }
          const updated = updater(latestAssistantMsg);
          latestAssistantMsg = updated;
          const userAlreadyPresent = curr.some((message) => message.id === userMsg.id);
          return [
            ...curr,
            ...(userAlreadyPresent ? [] : [userMsg]),
            updated,
          ];
        });
      };
      let persistTimer: ReturnType<typeof setTimeout> | null = null;
      const persistAssistantSoon = () => {
        if (persistTimer) return;
        persistTimer = scheduleProjectTimeout(() => {
          persistTimer = null;
          persistMessageById(assistantId);
        }, assistantPersistWindowMs(latestAssistantMsg.events?.length ?? 0));
      };
      const persistAssistantNowKeepalive = () => {
        if (persistTimer) {
          clearProjectTimeout(persistTimer);
          persistTimer = null;
        }
        persistMessageById(assistantId, { keepalive: true });
      };
      const pushedEventDeduper = createAdjacentAgentEventDeduper();
      const pushEvent = (ev: AgentEvent) => {
        textBuffer.flush();
        if (pushedEventDeduper.isDuplicate(ev)) return;
        updateAssistant((prev) => {
          const previousEvents = prev.events ?? [];
          const nextEvents = appendCoalescedAgentEvent(previousEvents, ev);
          return nextEvents === previousEvents
            ? prev
            : { ...prev, events: nextEvents };
        });
        /*
         * `<pixo-focus open="…">` —— agent 说「现在开这个」。
         *
         * daemon 已经证过三件事:key 是这一轮的、路径落在项目根之内、文件**非空**
         * (空白预览在用户眼里就是 bug,产品明确拍过)。所以这里不再复核那三条,
         * 只判客户端才知道的两条:是不是**本轮新建**的,以及用户有没有自己接管
         * 过预览。判据全在 `decideAgentFocusOpen` 里,那是个纯函数,有独立红测。
         *
         * 事件可能在**回合中途**到达 —— 这正是它存在的意义:agent 写完 index.html
         * 之后还要再花一分半写配套资源,不该让用户对着空白等到回合结束。
         */
        if (ev.kind === 'artifact_focus' && ev.open) {
          const declaredPath = ev.open;
          const focusRequest = ++latestExplicitFocusRequest;
          void refreshProjectFiles().then(async (nextFiles) => {
            const moduleFileNames = /\.(jsx|tsx)$/i.test(declaredPath)
              ? await collectReferencedJsxNames(nextFiles, readProjectHtml)
              : undefined;
            // The file read belongs to this live stream. Completion, failure,
            // or cancellation must not let its stale focus replace a later choice.
            if (
              liveFocusClosed
              || controller.signal.aborted
              || focusRequest !== latestExplicitFocusRequest
            ) return;
            const decision = decideAgentFocusOpen({
              declaredPath,
              projectFiles: nextFiles,
              preTurnFileNames: beforeFileNames,
              userTookOverPreview: userTookOverPreviewRef.current,
              moduleFileNames,
            });
            if (decision.shouldOpen && decision.fileName) {
              // agent 的明示优先于本轮后续的启发式排序:它比 rank/mtime 更知道
              // 哪个才是交付物。置位之后,尾随的配套文件写入不会再抢走焦点。
              completionSelectedAutoOpen = true;
              requestOpenFile(decision.fileName);
            }
          }).catch(() => {
            // 后台读文件列表失败不具权威性 —— 保持现状,等下一个事件。
          });
        }
        persistAssistantSoon();
        persistAssistantSoon();
        // Track Write tool invocations so we can auto-open the destination
        // file the moment the agent finishes writing it. The file-creating
        // tools we care about: Write (new file), Edit (existing file —
        // surfacing the freshly-modified file is also useful).
        if (ev.kind === 'tool_use' && isFileWriteToolName(ev.name)) {
          const filePath = extractFileWriteToolPath(ev.input);
          if (typeof filePath === 'string' && filePath.length > 0) {
            // Preserve the full path so decideAutoOpenAfterWrite can do a
            // path-suffix match against the project's relative file paths.
            // Reducing to a basename here would lose the segment alignment
            // we need to disambiguate same-basename collisions across the
            // project tree and outside it.
            pendingWrites.set(ev.id, filePath);
          }
        }
        if (ev.kind === 'tool_result') {
          const filePath = pendingWrites.get(ev.toolUseId);
          if (filePath) {
            pendingWrites.delete(ev.toolUseId);
            if (!ev.isError) {
              traceTouchedFilePaths.add(filePath);
              // Absolute daemon tool paths can prove containment before the
              // asynchronous file-list refresh completes. Open the best
              // proven touched artifact immediately so a terminal status and
              // an external `/files` observer cannot outrun the workspace UI.
              const immediateFileName = provenProjectRelativeToolPath(
                filePath,
                projectDetail.resolvedDir,
              );
              const immediateTouchedFiles = provenTraceTouchedFiles();
              const immediateArtifact = selectAutoOpenProducedArtifact(
                immediateTouchedFiles,
                { ...autoOpenArtifactOptions, preTurnFileNames: beforeFileNames },
              );
              if (
                !completionSelectedAutoOpen
                && immediateFileName
                && immediateArtifact === immediateFileName
              ) {
                requestOpenFile(immediateFileName);
              }
              // Refresh first so FileWorkspace's file list (and the tab
              // body) sees the new content before we ask it to focus.
              // Only auto-open if the file actually landed in the project's
              // file list — otherwise an out-of-project Write (e.g. an
              // upstream repo edit) would spawn a permanent placeholder tab.
              void refreshProjectFiles().then(async (nextFiles) => {
                // A .jsx/.tsx loaded by a sibling HTML entry is a module of a
                // multi-file React prototype, not a standalone page — don't
                // strand the user on a dead-end preview tab. Issue #2744.
                const moduleFileNames = /\.(jsx|tsx)$/i.test(filePath)
                  ? await collectReferencedJsxNames(nextFiles, readProjectHtml)
                  : undefined;
                // Write and explicit focus reads can share pending file I/O.
                // Neither may take the preview after this stream or user moved on.
                if (
                  liveFocusClosed
                  || controller.signal.aborted
                  || userTookOverPreviewRef.current
                ) return;
                const decision = decideAutoOpenAfterWrite(filePath, nextFiles, {
                  moduleFileNames,
                });
                // Several Write refreshes can settle together after the UI
                // already renders the run as Done but before the stream's
                // onDone callback arrives. Rank every file touched so far and
                // let only the best artifact open; otherwise a trailing
                // support-file write (plan.md) immediately replaces the
                // generated deliverable (index.html).
                const bestTouchedArtifact = selectAutoOpenProducedArtifact(
                  provenTraceTouchedFiles(),
                  { ...autoOpenArtifactOptions, preTurnFileNames: beforeFileNames },
                ) ?? selectAutoOpenTurnArtifact([], nextFiles, {
                    ...autoOpenArtifactOptions,
                    preTurnFileNames: beforeFileNames,
                    turnStartedAt: startedAt,
                    agentTouchedFileNames: resolveAgentTouchedFileNames(
                      [...traceTouchedFilePaths],
                      nextFiles,
                      project.id,
                      projectDetail.resolvedDir,
                    ),
                  });
                if (
                  !completionSelectedAutoOpen
                  && bestTouchedArtifact === decision.fileName
                  && decision.shouldOpen
                  && decision.fileName
                ) {
                  requestOpenFile(decision.fileName);
                }
              }).catch(() => {
                // A failed background read is non-authoritative. Keep the
                // current file list and skip auto-open until a later event.
              });
            }
          }
        }
      };

      const applyContentDelta = (delta: string) => {
        for (const ev of parser.feed(delta)) {
          if (ev.type === 'artifact:start') {
            liveHtml = '';
            parsedArtifact = {
              identifier: ev.identifier,
              artifactType: ev.artifactType,
              title: ev.title,
              html: '',
            };
            setArtifact(parsedArtifact);
          } else if (ev.type === 'artifact:chunk') {
            liveHtml += ev.delta;
            parsedArtifact = parsedArtifact
              ? { ...parsedArtifact, html: liveHtml }
              : {
                  identifier: ev.identifier,
                  title: '',
                  html: liveHtml,
                };
            setArtifact((prev) =>
              prev
                ? { ...prev, html: liveHtml }
                : {
                    identifier: ev.identifier,
                    title: '',
                    html: liveHtml,
                  },
            );
          } else if (ev.type === 'artifact:end') {
            parsedArtifact = parsedArtifact
              ? { ...parsedArtifact, html: ev.fullContent }
              : {
                  identifier: ev.identifier,
                  title: '',
                  html: ev.fullContent,
                };
            setArtifact((prev) => (prev ? { ...prev, html: ev.fullContent } : null));
          }
        }
      };

      const textBuffer = createBufferedTextUpdates({
        updateMessage: updateAssistant,
        persistSoon: persistAssistantSoon,
        flushAndPersistNow: persistAssistantNowKeepalive,
        onContentDelta: applyContentDelta,
      });
      sendTextBufferRef.current = textBuffer;

      const controller = new AbortController();
      const manualFileWriteRegistration = registerManualFileWrites(
        controller, manualFileWrites, runConversationId,
      );
      const cancelController = new AbortController();
      let authoritativeArtifactPaths: string[] | undefined;
      // onDone is delivered for a canceled run too; onRunStatus says which.
      let runReportedCanceled = false;
      abortRef.current = controller;
      cancelRef.current = cancelController;
      const handlers = {
        onDelta: (delta: string) => {
          if (delta.trim()) {}
          // See reattach-path comment above for rationale.  PR #4651 round 9.
          if (currentRunId) {
            transientFailedRetriesRef.current.delete(currentRunId);
            genericDisconnectRetriesRef.current.delete(currentRunId);
            genericDisconnectBackoffUntilRef.current.delete(currentRunId);
          }
          streamedText += delta;
          textBuffer.appendContent(delta);
        },
        onAgentEvent: (ev: AgentEvent) => {
          if (ev.kind === 'text' || ev.kind === 'thinking' || ev.kind === 'tool_use') {}
          if (currentRunId) {
            transientFailedRetriesRef.current.delete(currentRunId);
            genericDisconnectRetriesRef.current.delete(currentRunId);
            genericDisconnectBackoffUntilRef.current.delete(currentRunId);
          }
          if (ev.kind === 'conversation_title') {
            applyAgentGeneratedTitle(ev.title);
            return;
          }
          if (ev.kind === 'text') {
            pushedEventDeduper.reset();
            textBuffer.appendTextEvent(ev.text);
          } else if (ev.kind === 'thinking') {
            pushedEventDeduper.reset();
            textBuffer.appendEvent(ev);
          } else {
            pushEvent(ev);
          }
        },
        onArtifactCount: (count: number) => {
          daemonArtifactCount = count;
        },
        // 组件 22 · 重连 · S29:掉线期间流水最后一行的读数。传输层如实上报,
        // 该不该显示、显示到几分之几由 reconnect-state 判(它也负责与组件 20 互斥)。
        onReconnect: (state: DaemonReconnectState) => {
          if (!currentRunId) return;
          pushReconnectSignal({
            kind: 'transport',
            runId: currentRunId,
            conversationId: runConversationId,
            attempt: state.attempt,
            max: state.max,
            phase: state.phase,
          });
        },
        // 自动重试:daemon 把 agent 那一轮重跑了。走同一行(交付稿 4058 不许为
        // 同一件事再立第三个模块),读数与预算取运行层自己的那一份。
        onAgentRetry: (state: DaemonAgentRetryState) => {
          if (!currentRunId) return;
          pushReconnectSignal({
            kind: 'agent-retry',
            runId: currentRunId,
            conversationId: runConversationId,
            attempt: state.attempt,
            max: state.max,
            phase: state.phase,
            ...(state.cause ? { cause: state.cause } : {}),
          });
        },
        onAgentReconnect: (state: DaemonAgentReconnectState) => {
          if (!currentRunId) return;
          pushReconnectSignal({
            kind: 'agent-reconnect',
            runId: currentRunId,
            conversationId: runConversationId,
            attempt: state.attempt,
            max: state.max,
            phase: state.phase,
          });
        },
        onDone: (fullText = '') => {

          liveFocusClosed = true;
          // The daemon delivers onDone even for a canceled run, so a run
          // superseded by a "send now" interrupt can still land here and must
          // not apply its completion side effects over the replacement. A run
          // may finalize unless it was tagged superseded at interrupt time
          // (recorded before handleStop cleared the refs), which is reliable
          // even before the replacement send attaches — unlike abortRef, whose
          // terminal onRunStatus / handleStop churn make it ambiguous here.
          const runMayFinalize =
            !supersededRunsRef.current.has(controller);
          if (!runMayFinalize) {
            textBuffer.cancel();
            cancelSendTextBuffer();
            clearTraceTouchedFilePaths();
            return;
          }
          textBuffer.flush();
          textBuffer.cancel();
          cancelSendTextBuffer();
          for (const ev of parser.flush()) {
            if (ev.type === 'artifact:end') {
              parsedArtifact = parsedArtifact
                ? { ...parsedArtifact, html: ev.fullContent }
                : {
                    identifier: ev.identifier,
                    title: '',
                    html: ev.fullContent,
                  };
              setArtifact((prev) => (prev ? { ...prev, html: ev.fullContent } : null));
            }
          }
          const emptyApiResponse =
            config.mode === 'api' &&
            !fullText.trim() &&
            !streamedText.trim() &&
            !liveHtml.trim();
          if (emptyApiResponse) {
            const endedAt = Date.now();
            const diagnostic = t('assistant.emptyResponseMessage');
            updateMessageById(
              assistantId,
              (prev) => ({
                ...prev,
                endedAt,
                runStatus: 'failed',
                events: [
                  ...(prev.events ?? []),
                  { kind: 'status', label: 'empty_response', detail: config.model },
                  { kind: 'text', text: diagnostic },
                ],
              }),
              true,
              { telemetryFinalized: true },
            );
            const ownsCurrentRun = clearCurrentRunStreamingMarker(
              runConversationId,
              controller,
              cancelController,
            );
            if (ownsCurrentRun) updateConversationLatestRun('failed', endedAt);
            void refreshProjectFiles().catch(() => {
              // Retain the last accepted file list while the daemon recovers.
            });
            onProjectsRefresh();
            clearTraceTouchedFilePaths();
            return;
          }
          const endedAt = Date.now();
          let finalRunStatus: ChatMessage['runStatus'] = 'succeeded';
          updateAssistant((prev) => {
            finalRunStatus = resolveSucceededRunStatus(prev.runStatus);
            return {
              ...prev,
              endedAt,
              runStatus: finalRunStatus,
            };
          });
          const finalizingRunId = currentRunId;
          // File persistence can finish after the user has selected another
          // preview or moved on to a new run. Recheck focus ownership at each
          // open boundary without interrupting this run's output persistence.
          const shouldOpenCompletedArtifact = () => {
            let latestRunMessage: ChatMessage | undefined;
            for (let index = messagesRef.current.length - 1; index >= 0; index -= 1) {
              const message = messagesRef.current[index];
              if (message?.role === 'assistant' && !assistantMessageNeverHadARun(message)) {
                latestRunMessage = message;
                break;
              }
            }
            return mountedRef.current
              && !userTookOverPreviewRef.current
              && !supersededRunsRef.current.has(controller)
              && projectIdRef.current === project.id
              && activeConversationIdRef.current === runConversationId
              && projectRunAuthorityKeyRef.current === projectRunAuthorityKey
              && projectResourceAuthorityRef.current === 'local'
              && latestRunMessage?.id === assistantId;
          };
          if (finalizingRunId) finalizingLocalRunIdsRef.current.add(finalizingRunId);
          const ownsCurrentRun = clearCurrentRunStreamingMarker(
            runConversationId,
            controller,
            cancelController,
          );
          if (ownsCurrentRun) updateConversationLatestRun(finalRunStatus ?? 'succeeded', endedAt);
          // Refetch the file list directly (rather than just bumping the
          // refresh signal) so we can diff against the pre-turn snapshot
          // and attach the new files to the assistant message as download
          // chips.
          void (async () => {
            try {
              await preTurnBaseline.ready;
              const {
                producedFiles: produced,
                traceObjectFiles,
                recoveredArtifact,
                autoOpen,
                persistenceSucceeded: artifactPersistenceSucceeded,
                persistenceError: artifactPersistenceError,
              } = await finalizeTurn(
                {
                  projectId: project.id,
                  projectRoot: projectDetail.resolvedDir,
                  preTurnFileNames: beforeFileNames,
                  turnStartedAt: startedAt,
                  turnEndedAt: endedAt,
                  autoOpenOptions: autoOpenArtifactOptions,
                  readOutput: () => {
                    const finalText = streamedText || fullText;
                    return {
                      artifact: chooseArtifactToPersist(parsedArtifact, finalText),
                      sourceText: finalText,
                    };
                  },
                  readTouchedPaths: () => traceTouchedFilePaths,
                  readAuthoritativeArtifactPaths: () => authoritativeArtifactPaths,
                  readManualWrites: () => manualFileWrites,
                  readLiveWrittenFiles: provenTraceTouchedFiles,
                },
                TURN_POLICIES.live,
                { ...turnPorts, shouldOpen: shouldOpenCompletedArtifact },
              );
              if (recoveredArtifact || autoOpen) completionSelectedAutoOpen = true;
              const deliveryCandidate: ChatMessage = {
                ...latestAssistantMsg,
                endedAt,
                runStatus: finalRunStatus,
                sessionMode: runSessionMode,
                producedFiles: produced,
                traceObjectFiles,
              };
              const deliveryOutcome = resolveDesignDeliveryOutcome({
                sessionMode: deliveryCandidate.sessionMode,
                runStatus: deliveryCandidate.runStatus,
                content: deliveryCandidate.content,
                events: deliveryCandidate.events,
                producedFileCount: produced.length,
                traceObjectFileCount: traceObjectFiles.length,
                artifactCount: daemonArtifactCount,
                persistenceSucceeded: artifactPersistenceSucceeded,
                persistenceFailed: artifactPersistenceError !== undefined,
              });
              const finalized = applyDesignDeliveryOutcome(
                deliveryCandidate,
                deliveryOutcome,
                artifactPersistenceError,
              );
              latestAssistantMsg = finalized;
              // Only the live completion path arms the experience survey. The
              // reattach and artifact-recovery paths below also settle on
              // `delivered`, but they do so while replaying a run that
              // finished before this page load — "how was that?" about work
              // the user cannot remember finishing is a worse question than
              // one not asked.
              if (deliveryOutcome === 'delivered') notifyArtifactDelivered();
              setMessages((curr) => {
                const updated = curr.map((m) =>
                  m.id === assistantId
                    ? finalized
                    : m,
                );
                persistMessage(finalized, { telemetryFinalized: true });
                return updated;
              });
              if (deliveryOutcome === 'no_result' || deliveryOutcome === 'delivery_failed') {
                setError(artifactPersistenceError ?? DESIGN_RESULT_MISSING_DETAIL);
              }
            } finally {
              clearTraceTouchedFilePaths();
              if (finalizingRunId) finalizingLocalRunIdsRef.current.delete(finalizingRunId);
            }
          })();
          onProjectsRefresh();
        },
        onError: async (err: Error) => {
          liveFocusClosed = true;
          // Disconnect-time stamp, used as-is for non-generic-disconnect
          // failures. When the generic-disconnect retry-cap probe below
          // resolves a terminal daemon status, this is advanced to that
          // authoritative `updatedAt` so BOTH the assistant message row and
          // updateConversationLatestRun() (which drives the sidebar/dropdown
          // sort + duration) reflect the daemon's terminal time rather than
          // this stale pre-probe timestamp.
          let endedAt = Date.now();
          const errorCode = (err as Error & { code?: string }).code;
          const resumable = (err as Error & { resumable?: boolean }).resumable === true;
          let finalRunStatusAfterError: ChatMessage['runStatus'] = 'failed';
          let refreshConversationAfterError = false;
          // The final onError invocation whose retry-cap probe turns terminal
          // may arrive AFTER an earlier invocation already consumed
          // ownership via clearCurrentRunStreamingMarker (abortRef/cancelRef
          // are nulled out the first time, so a later call with the same
          // controller reads ownsCurrentRun as false). Track whether the
          // terminal-probe branches below already stamped the conversation
          // directly, so the unconditional call at the bottom does not need
          // (and must not double-apply) that same update.
          let conversationFinalizedInline = false;
          const failure = runFailureFieldsFromError(err);
          // A run superseded by a "send now" interrupt can still surface a
          // late disconnect error (e.g. a canceled stream that lost its
          // terminal SSE). It must not paint a global failure banner or
          // re-finalize its already-canceled assistant message once it was
          // tagged superseded. See the onDone above for the ownership rationale.
          const runMayFinalize =
            !supersededRunsRef.current.has(controller);

          if (currentRunId && runMayFinalize && isGenericDaemonDisconnect(err)) {
            manualFileWriteRegistration.release(true);
          }
          textBuffer.flush();
          textBuffer.cancel();
          cancelSendTextBuffer();
          // POST /api/runs can fail before it yields a run id. That is a failed
          // user send, not a failed assistant run: no assistant process ever
          // existed, so keeping the optimistic placeholder would fabricate a
          // run and route the user to the wrong recovery action.
          //
          // A BYOK runtime refusal never attempted that POST, and the failed
          // turn's card is the only place that says what to install. Dropping
          // the turn here would leave a bare Retry and no reason, so it keeps
          // the same failed turn API mode gets.
          if (config.mode === 'daemon' && !currentRunId && !isByokRuntimeRefusal(errorCode)) {
            if (runMayFinalize) {
              setError(null);
              if (errorCode === 'CONVERSATION_NOT_FOUND') {
                setProjectActionsToast({
                  message: t('chat.sendTargetMissing'),
                  details: null,
                  tone: 'error',
                  scope: 'chat-pane',
                });
              }
              activeCompletionNotificationRunsRef.current.delete(assistantId);
              setConversations((current) =>
                current.map((conversation) => {
                  if (
                    conversation.id !== runConversationId
                    || conversation.latestRun?.startedAt !== startedAt
                  ) {
                    return conversation;
                  }
                  return {
                    ...conversation,
                    ...(previousConversationUpdatedAt === undefined
                      ? {}
                      : { updatedAt: previousConversationUpdatedAt }),
                    latestRun: previousConversationLatestRun,
                  };
                }),
              );
              setMessages((current) => {
                let failedUser: ChatMessage | null = null;
                const next = current.flatMap((message) => {
                  if (message.id === assistantId) return [];
                  if (message.id !== userMsg.id) return [message];
                  failedUser = { ...message, sendFailed: true };
                  return [failedUser];
                });
                if (failedUser) persistMessage(failedUser);
                return next;
              });
            }
            clearTraceTouchedFilePaths();
            clearCurrentRunStreamingMarker(
              runConversationId,
              controller,
              cancelController,
            );
            return;
          }
          // The daemon refused a duplicate design-system enrichment because the
          // conversation already runs one (HTTP 409
          // DESIGN_SYSTEM_ENRICHMENT_IN_PROGRESS). The surviving run is the one
          // the user asked for, so this is not a failure worth a global banner;
          // only the duplicate turn itself records why it went nowhere.
          if (runMayFinalize) {
            setRunError(err.message, assistantId);
            appendAssistantErrorEvent(
              assistantId,
              err.message,
              errorCode,
              failure,
              stderrTailFromError(err),
            );
            updateAssistant((prev) => ({
              ...prev,
              endedAt,
              runStatus: config.mode === 'api' || prev.runId || isActiveRunStatus(prev.runStatus)
                ? 'failed'
                : prev.runStatus,
              resumable,
            }));
          }
          // Mark the run as completed in the reattach registry so that
          // attachRecoverableRuns does not race it after streaming ends.
          // Without this guard, the spuriouslyFailedPending heuristic would
          // match a freshly-failed live run (no content, no producedFiles) and
          // attempt a daemon status fetch on a run the client already knows
          // failed — overwriting the assistant message's resumable flag with
          // the fetched status before the ChatPane has had a chance to render.
          //
          // EXCEPTION: the generic "daemon stream disconnected before run
          // completed" error is a browser-side SSE reconnect-budget exhaustion,
          // NOT an authoritative terminal failure.  The daemon may still report
          // the run as queued/running on the next tick, so we must leave the
          // runId eligible for attachRecoverableRuns to re-query.  Only seal
          // the registry entry on authoritative terminal failures (any error
          // that is NOT the generic disconnect message).
          // Generic disconnects share the transient-retry budget with the
          // reattach null-status path. As with the reattach path above, a null
          // status probe is not authoritative — it may be a transient fetch or
          // daemon hiccup — so keep the run eligible for future re-query unless
          // the daemon explicitly reports a terminal status.
          if (currentRunId) {
            if (isGenericDaemonDisconnect(err)) {
              const runIdForGenericDisconnect = currentRunId;
              const attempts =
                (genericDisconnectRetriesRef.current.get(runIdForGenericDisconnect) ?? 0) + 1;
              if (attempts >= MAX_TRANSIENT_RETRIES) {
                const backoffUntil = Date.now() + 3000;
                genericDisconnectRetriesRef.current.set(runIdForGenericDisconnect, attempts);
                genericDisconnectBackoffUntilRef.current.set(runIdForGenericDisconnect, backoffUntil);
                const backoffTimer = scheduleProjectTimeout(() => {
                  genericDisconnectBackoffUntilRef.current.delete(runIdForGenericDisconnect);
                  setRecoveryTick((t) => t + 1);
                }, 3000);
                const latestRunStatus = await fetchChatRunStatus(runIdForGenericDisconnect).catch(() => null);
                if (latestRunStatus?.artifactPaths) {
                  authoritativeArtifactPaths = latestRunStatus.artifactPaths;
                }
                if (!latestRunStatus || isActiveRunStatus(latestRunStatus.status)) {
                } else if (latestRunStatus.status === 'succeeded') {

                  clearProjectTimeout(backoffTimer);
                  // Advance the outer endedAt so updateConversationLatestRun()
                  // below adopts this same authoritative terminal timestamp,
                  // matching the message row's endedAt set further down.
                  endedAt = latestRunStatus.updatedAt;
                  if (runMayFinalize) {
                    setError(null);
                    updateAssistant((prev) => {
                      const recovered = removeErrorStatusEvent(prev, err.message, errorCode);
                      if (
                        !prev.producedFiles?.length
                        && (prev.content.trim().length > 0 || (prev.events?.length ?? 0) > 0)
                      ) {
                        return {
                          ...recovered,
                          content: '',
                          events: [],
                          // Adopt the daemon's authoritative terminal timestamp rather
                          // than the stale disconnect-time stamp taken when the generic
                          // disconnect first fired.
                          endedAt: latestRunStatus.updatedAt,
                          runStatus: 'succeeded',
                          ...(latestRunStatus.resumable !== undefined
                            ? { resumable: latestRunStatus.resumable }
                            : {}),
                        };
                      }
                      return {
                        ...recovered,
                        endedAt: latestRunStatus.updatedAt,
                        runStatus: 'succeeded',
                        ...(latestRunStatus.resumable !== undefined
                          ? { resumable: latestRunStatus.resumable }
                          : {}),
                      };
                    });
                    updateConversationLatestRun('succeeded', endedAt);
                    conversationFinalizedInline = true;
                  }
                  finalRunStatusAfterError = 'succeeded';
                  refreshConversationAfterError = true;
                  genericDisconnectRetriesRef.current.delete(runIdForGenericDisconnect);
                  genericDisconnectBackoffUntilRef.current.delete(runIdForGenericDisconnect);
                } else {
                  clearProjectTimeout(backoffTimer);
                  // Same rationale as the succeeded branch above: keep the
                  // conversation-level stamp in step with the message row.
                  endedAt = latestRunStatus.updatedAt;
                  if (runMayFinalize) {
                    if (latestRunStatus.status === 'canceled') setError(null);
                    updateAssistant((prev) => ({
                      ...prev,
                      endedAt: latestRunStatus.updatedAt,
                      runStatus: latestRunStatus.status,
                      ...(latestRunStatus.resumable !== undefined
                        ? { resumable: latestRunStatus.resumable }
                        : {}),
                    }));
                    updateConversationLatestRun(latestRunStatus.status, endedAt);
                    conversationFinalizedInline = true;
                  }
                  finalRunStatusAfterError = latestRunStatus.status;
                  refreshConversationAfterError = true;
                  completedReattachRunsRef.current.add(runIdForGenericDisconnect);
                  genericDisconnectRetriesRef.current.delete(runIdForGenericDisconnect);
                  genericDisconnectBackoffUntilRef.current.delete(runIdForGenericDisconnect);
                }
              } else {
                genericDisconnectRetriesRef.current.set(runIdForGenericDisconnect, attempts);
              }
            } else {
              genericDisconnectRetriesRef.current.delete(currentRunId);
              genericDisconnectBackoffUntilRef.current.delete(currentRunId);
              completedReattachRunsRef.current.add(currentRunId);
            }
          }
          const ownsCurrentRun = clearCurrentRunStreamingMarker(
            runConversationId,
            controller,
            cancelController,
          );
          if (ownsCurrentRun && !conversationFinalizedInline) {
            updateConversationLatestRun(finalRunStatusAfterError, endedAt);
          }
          setMessages((curr) => {
            const finalized = curr.find((m) => m.id === assistantId);
            if (finalized) persistMessage(finalized, { telemetryFinalized: true });
            return curr;
          });
          if (refreshConversationAfterError) {
            scheduleConversationMessageRefresh(runConversationId);
          }
          const authoritativeTouchedPaths = [
            ...traceTouchedFilePaths,
            ...(authoritativeArtifactPaths ?? []),
          ];
          void (async () => {
            await preTurnBaseline.ready;
            const nextFiles = await refreshProjectFiles({ fresh: true, afterChange: true });
            if (authoritativeArtifactPaths === undefined) return;
            const ownedFiles = attributableRunFiles(
              nextFiles, manualFileWrites, authoritativeTouchedPaths, project.id, projectDetail.resolvedDir,
            );
            const produced = computeProducedFiles(
              beforeFileNames,
              ownedFiles,
              authoritativeArtifactPaths,
              project.id,
              projectDetail.resolvedDir,
            ) ?? [];
            const traceObjectFiles = computeTraceObjectFiles(
              beforeFileNames,
              ownedFiles,
              authoritativeTouchedPaths,
              project.id,
              projectDetail.resolvedDir,
            ) ?? [];
            updateMessageById(
              assistantId,
              (prev) => ({ ...prev, producedFiles: produced, traceObjectFiles }),
              true,
              { telemetryFinalized: true },
            );
            // An accepted output ends recovery; otherwise an inline artifact
            // can still need the sibling recovery effect's real file POST.
            if (produced.length > 0 && !isGenericDaemonDisconnect(err)) manualFileWriteRegistration.release();
          })().catch(() => {
            // Retain the last accepted file list while the daemon recovers.
          });
          clearTraceTouchedFilePaths(Boolean(
            currentRunId && runMayFinalize && (
              (isGenericDaemonDisconnect(err) && !completedReattachRunsRef.current.has(currentRunId))
              // A terminal strategy error can precede browser artifact
              // persistence. Retain this scoped run's receipts until that
              // recovery accepts an output, rather than losing writer proof.
              || hasRecoverableArtifactMessage({
                ...latestAssistantMsg,
                runId: currentRunId,
                // React may not have committed the final text updater yet;
                // this transport's accumulator already has every delta.
                content: streamedText || latestAssistantMsg.content,
                runStatus: 'failed',
              })
            ),
          ));
        },
      };

      if (config.mode === 'daemon') {
        if (!config.agentId) {
          handlers.onError(new Error(t('settings.onboardingGateTooltipLocal')));
          return true;
        }
        const choice = selectedAgentChoice;
        const daemonByokOpenCode = config.agentId === 'byok-opencode';
        const daemonAgentId = daemonByokOpenCode && nativeByokProvider ? 'codex' : config.agentId;
        if (daemonByokOpenCode && !agentsById.get(daemonAgentId)?.available) {
          handlers.onError(byokRuntimeRefusal(Boolean(nativeByokProvider), t));
          return true;
        }
        // A caller-supplied entry_from (e.g. 'resume_continue' from the
        // resumable-failure Continue action) overrides the DS default so the
        // run is attributed to the affordance that started it.
        //
        // Session-dimension hints are stamped on every real run creation (this
        // path only runs for non-queued sends): claim the next 0-based turn
        // index for this browser session, and flag whether the project already
        // had a generated artifact (project-scoped) so the run reads as an edit
        // rather than a first creation.
        const sessionTurn = claimRunTurnIndex();
        // Per-project run turn index (project-lifetime, localStorage-backed):
        // "within THIS project, which prompt / follow-up is this?". Sibling to
        // the session-wide `sessionTurn` above — claimed together per real run
        // so run_created / run_finished carry both the session-global and the
        // project-scoped sequence.
        const projectTurn = claimProjectTurnIndex(project.id);
        const hasExistingArtifact = projectFilesRef.current.some(
          (file) => Boolean(file.artifactManifest),
        );
        const runAnalyticsHints = {
          ...(meta?.entryFrom ? { entryFrom: meta.entryFrom } : {}),
          ...(sessionTurn
            ? { turnIndex: sessionTurn.turnIndex, isFirstRun: sessionTurn.isFirstRun }
            : {}),
          ...(projectTurn ? { projectTurnIndex: projectTurn.projectTurnIndex } : {}),
          ...(meta?.dsEnrichment ? { dsEnrichment: true } : {}),
          hasExistingArtifact,
          runtimeType: daemonByokOpenCode
            ? ('byok' as const)
            : 'local_cli' as const,
          taskExecutionId: taskAnalytics.taskExecutionId,
          initialRunId: taskAnalytics.initialRunId,
          sourceRunId: taskAnalytics.sourceRunId,
          taskRunIndex: taskAnalytics.taskRunIndex,
          recoveryActionType: taskAnalytics.recoveryActionType,
          recoveryActionInstanceId: taskAnalytics.recoveryActionInstanceId,
        };
        void streamViaDaemon({
          agentId: daemonAgentId,
          history: nextHistory,
          signal: controller.signal,
          cancelSignal: cancelController.signal,
          handlers,
          projectId: project.id,
          conversationId: runConversationId,
          userMessageId: userMsg.id,
          assistantMessageId: assistantId,
          clientRequestId,
          skillId: project.skillId ?? null,
          skillIds: Array.isArray(meta?.skillIds) ? meta.skillIds : [],
          context: runContext,

          attachments: runAttachments.map((a) => a.path),
          sessionMode: runSessionMode,
          appliedPluginSnapshotId:
            meta?.appliedPluginSnapshotId ?? meta?.appliedPluginSnapshot?.snapshotId ?? null,
          pluginId: meta?.appliedPluginSnapshot?.pluginId,
          pluginInputs: meta?.appliedPluginSnapshot?.inputs,
          research: meta?.research,
          mediaExecution: mediaExecutionPolicyForProjectMetadata(project.metadata),
          model: daemonByokOpenCode ? config.model : choice?.model ?? null,
          reasoning: daemonByokOpenCode ? null : choice?.reasoning ?? null,
          serviceTier: daemonByokOpenCode ? null : choice?.serviceTier ?? null,
          ...(daemonByokOpenCode && byokOpenCodeProvider
            ? { byokProvider: byokOpenCodeProvider }
            : {}),
          ...(daemonByokOpenCode
            ? {
                byokMediaDefaults: byokMediaDefaultsForRun({
                  imageModelOverride: byokImageModelOverride,
                  videoModelOverride: byokVideoModelOverride,
                  speechModelOverride: byokSpeechModelOverride,
                  speechVoiceOverride: byokSpeechVoiceOverride,
                  config,
                  imageModelOptions: byokImageModelOptionsPV,
                  videoModelOptions: byokVideoModelOptionsPV,
                  speechModelOptions: byokSpeechModelOptionsPV,
                }),
              }
            : {}),
          titleGeneration: isFirstTurn ? { enabled: true } : undefined,
          locale,
          ...(runAnalyticsHints ? { analyticsHints: runAnalyticsHints } : {}),
          onRunCreated: (runId) => {
            rememberConversationAgent(runConversationId, daemonAgentId);
            consumeConversationAgentChoice(runConversationId, config.agentId);
            // A successor boundary must include the final predecessor delta
            // and buffered text event even when the 250ms UI batch has not
            // fired yet.
            textBuffer.flush();
            const resolvedTaskAnalytics = {
              ...taskAnalytics,
              initialRunId: taskAnalytics.initialRunId ?? runId,
            };
            const pinnedAssistant = {
              ...latestAssistantMsg,
              runId,
              runStatus: 'queued' as const,
              taskAnalytics: resolvedTaskAnalytics,
              lastRunEventId: undefined,
            };
            latestAssistantMsg = pinnedAssistant;
            currentRunId = runId;
            manualFileWriteRegistration.bindRun(runId);
            // The view may already be on a different project/conversation;
            // pin the daemon run to the original row so returning can reattach.
            void saveMessage(project.id, runConversationId, pinnedAssistant, {

            });
            updateMessageById(assistantId, (prev) => ({
              ...prev,
              runId,
              runStatus: 'queued',
              taskAnalytics: resolvedTaskAnalytics,
              lastRunEventId: undefined,
            }));
          },
          onArtifactPaths: (paths) => {
            authoritativeArtifactPaths = paths;
          },
          onRunStatus: (runStatus) => {
            // streamViaDaemon reports `failed` before onError when POST
            // /api/runs itself fails. Until onRunCreated supplies an id there is
            // no assistant run to finalize or persist; onError moves the failure
            // to the user row instead.
            if (!currentRunId && runStatus === 'failed') return;
            runReportedCanceled = runStatus === 'canceled';
            const endedAt = isTerminalRunStatus(runStatus) ? Date.now() : undefined;
            const runMayFinalize =
              !supersededRunsRef.current.has(controller);
            // 这一轮落终态,掉线那一行就该消失。canceled 由回合 footer 报结果,
            // succeeded 同样不留「已恢复」。见 reconnect-state 的规则表。
            if (currentRunId) {
              pushReconnectSignal({ kind: 'settled', runId: currentRunId, status: runStatus });
            }
            updateMessageById(
              assistantId,
              (prev) => ({
                ...prev,
                runStatus,
                endedAt: endedAt === undefined ? prev.endedAt : prev.endedAt ?? endedAt,
              }),
              true,
              runStatus === 'canceled' ? { telemetryFinalized: true } : undefined,
            );
            if (!runMayFinalize) return;
            updateConversationLatestRun(runStatus, endedAt);
            if (isTerminalRunStatus(runStatus)) {
              clearCurrentRunStreamingMarker(runConversationId, controller, cancelController);
              scheduleConversationMessageRefresh(runConversationId);
              // Transport exhaustion reports failed before its generic error.
              // Keep receipts until onError distinguishes that recoverable
              // disconnect from an authoritative failure; cancel still forgets.
              if (runStatus !== 'succeeded') clearTraceTouchedFilePaths(runStatus === 'failed');
            }
          },
          /*
           * 「这一轮是谁停的」——只在服务端答得出来时才落到消息上。
           * 交付稿第 81 格那一行「已手动暂停任务」只认 `user_stop`;
           * 存进消息(而不是只留在 run 对象里)是因为刷新之后那一行还得在,
           * 而且还得是同一个来源(盘点 R8)。
           */
          onCancelOrigin: (cancelOrigin) => {
            updateMessageById(assistantId, (prev) => ({ ...prev, cancelOrigin }), true);
          },
          onRunEventId: (lastRunEventId) => {
            updateMessageById(assistantId, (prev) => ({ ...prev, lastRunEventId }));
            persistAssistantSoon();
          },
        });
        return true;
      } else {
        if (config.apiProtocol === 'bedrock') {
          handlers.onError(new Error(BEDROCK_BYOK_UNSUPPORTED_MESSAGE));
          return true;
        }
        const byokAgentId = nativeByokProvider ? 'codex' : 'byok-opencode';
        if (!agentsById.get(byokAgentId)?.available) {
          handlers.onError(byokRuntimeRefusal(Boolean(nativeByokProvider), t));
          return true;
        }
        pushEvent({ kind: 'status', label: 'requesting', detail: config.model });
        const byokOpenCodeHistory = await historyWithApiAttachmentContext(
          historyWithWorkspaceContext(nextHistory, userMsg.id, runContext),
          userMsg.id,
          project.id,
          projectFiles,
          {
            omitNativeImageAttachments: usesAnthropicProxy(config),

          },
        );
        // Session-dimension hints on the BYOK-OpenCode path too, so
        // run_created / run_finished carry the same session-global and
        // project-scoped run sequence on every runtime (cli / byok).
        const byokSessionTurn = claimRunTurnIndex();
        const byokProjectTurn = claimProjectTurnIndex(project.id);
        const byokHasExistingArtifact = projectFilesRef.current.some(
          (file) => Boolean(file.artifactManifest),
        );
        void streamViaDaemon({
          agentId: byokAgentId,
          history: byokOpenCodeHistory,
          signal: controller.signal,
          cancelSignal: cancelController.signal,
          handlers,
          projectId: project.id,
          conversationId: runConversationId,
          userMessageId: userMsg.id,
          assistantMessageId: assistantId,
          clientRequestId,
          skillId: project.skillId ?? null,
          skillIds: Array.isArray(meta?.skillIds) ? meta.skillIds : [],
          context: runContext,

          attachments: runAttachments.map((a) => a.path),
          sessionMode: runSessionMode,
          appliedPluginSnapshotId:
            meta?.appliedPluginSnapshotId ?? meta?.appliedPluginSnapshot?.snapshotId ?? null,
          pluginId: meta?.appliedPluginSnapshot?.pluginId,
          pluginInputs: meta?.appliedPluginSnapshot?.inputs,
          research: meta?.research,
          mediaExecution: mediaExecutionPolicyForProjectMetadata(project.metadata),
          model: config.model,
          reasoning: null,
          serviceTier: null,
          ...(byokOpenCodeProvider ? { byokProvider: byokOpenCodeProvider } : {}),
          byokMediaDefaults: byokMediaDefaultsForRun({
            imageModelOverride: byokImageModelOverride,
            videoModelOverride: byokVideoModelOverride,
            speechModelOverride: byokSpeechModelOverride,
            speechVoiceOverride: byokSpeechVoiceOverride,
            config,
            imageModelOptions: byokImageModelOptionsPV,
            videoModelOptions: byokVideoModelOptionsPV,
            speechModelOptions: byokSpeechModelOptionsPV,
          }),
          titleGeneration: isFirstTurn ? { enabled: true } : undefined,
          locale,
          analyticsHints: {
            ...(meta?.entryFrom ? { entryFrom: meta.entryFrom } : {}),
            ...(byokSessionTurn
              ? { turnIndex: byokSessionTurn.turnIndex, isFirstRun: byokSessionTurn.isFirstRun }
              : {}),
            ...(byokProjectTurn ? { projectTurnIndex: byokProjectTurn.projectTurnIndex } : {}),
            hasExistingArtifact: byokHasExistingArtifact,
            runtimeType: 'byok',
            taskExecutionId: taskAnalytics.taskExecutionId,
            initialRunId: taskAnalytics.initialRunId,
            sourceRunId: taskAnalytics.sourceRunId,
            taskRunIndex: taskAnalytics.taskRunIndex,
            recoveryActionType: taskAnalytics.recoveryActionType,
            recoveryActionInstanceId: taskAnalytics.recoveryActionInstanceId,
          },
          onRunCreated: (runId) => {
            rememberConversationAgent(runConversationId, byokAgentId);
            consumeConversationAgentChoice(runConversationId, config.agentId);
            manualFileWriteRegistration.bindRun(runId);
            textBuffer.flush();
            const resolvedTaskAnalytics = {
              ...taskAnalytics,
              initialRunId: taskAnalytics.initialRunId ?? runId,
            };
            const pinnedAssistant = {
              ...latestAssistantMsg,
              runId,
              runStatus: 'queued' as const,
              taskAnalytics: resolvedTaskAnalytics,
              lastRunEventId: undefined,
            };
            latestAssistantMsg = pinnedAssistant;
            void saveMessage(project.id, runConversationId, pinnedAssistant, {

            });
            updateMessageById(assistantId, (prev) => ({
              ...prev,
              runId,
              runStatus: 'queued',
              taskAnalytics: resolvedTaskAnalytics,
              lastRunEventId: undefined,
            }));
          },
          onRunStatus: (runStatus) => {
            runReportedCanceled = runStatus === 'canceled';
            const endedAt = isTerminalRunStatus(runStatus) ? Date.now() : undefined;
            const runMayFinalize = !supersededRunsRef.current.has(controller);
            // 见 CLI 路径同名回调:落终态就把重连那一行让出去。
            if (currentRunId) {
              pushReconnectSignal({ kind: 'settled', runId: currentRunId, status: runStatus });
            }
            updateMessageById(
              assistantId,
              (prev) => ({
                ...prev,
                runStatus,
                endedAt: endedAt === undefined ? prev.endedAt : prev.endedAt ?? endedAt,
              }),
              true,
              runStatus === 'canceled' ? { telemetryFinalized: true } : undefined,
            );
            if (!runMayFinalize) return;
            updateConversationLatestRun(runStatus, endedAt);
            if (isTerminalRunStatus(runStatus)) {
              clearCurrentRunStreamingMarker(runConversationId, controller, cancelController);
              scheduleConversationMessageRefresh(runConversationId);
            }
          },
          /*
           * 「这一轮是谁停的」——只在服务端答得出来时才落到消息上。
           * 交付稿第 81 格那一行「已手动暂停任务」只认 `user_stop`;
           * 存进消息(而不是只留在 run 对象里)是因为刷新之后那一行还得在,
           * 而且还得是同一个来源(盘点 R8)。
           */
          onCancelOrigin: (cancelOrigin) => {
            updateMessageById(assistantId, (prev) => ({ ...prev, cancelOrigin }), true);
          },
          onRunEventId: (lastRunEventId) => {
            updateMessageById(assistantId, (prev) => ({ ...prev, lastRunEventId }));
            persistAssistantSoon();
          },
        });
        return true;
      }
    },
    [ rememberConversationAgent, consumeConversationAgentChoice, supersedeRetriedError, activeConversationId, activeSessionMode, currentConversationBusy, queueChatSendForCurrentConversation, messages, config, locale, agentsById, onTouchProject, project.id, project.name, projectFiles, refreshProjectFiles, readProjectHtml, requestOpenFile, requestOpenTurnArtifacts, persistMessage, persistMessageById, updateMessageById, markStreamingConversation, clearStreamingMarker, clearCurrentRunStreamingMarker, clearProjectTimeout, scheduleConversationMessageRefresh, scheduleProjectTimeout, onProjectsRefresh, onProjectChange, onOpenSettings, byokImageModelOverride, byokVideoModelOverride, byokSpeechModelOverride, byokSpeechVoiceOverride, byokImageModelOptionsPV, byokVideoModelOptionsPV, byokSpeechModelOptionsPV, projectRunAuthorityKey, registerManualFileWrites, null, null, true, false],
  );

  const handleResendUserMessage = useCallback(
    (failedMessage: ChatMessage) => {
      if (failedMessage.role !== 'user' || !failedMessage.sendFailed) return;
      const currentMessages = messagesRef.current;
      const currentMessage = currentMessages.find((message) => message.id === failedMessage.id);
      if (currentMessage?.role !== 'user' || !currentMessage.sendFailed) return;

      const retryMessage: ChatMessage = { ...currentMessage, sendFailed: undefined };
      function restoreFailedState() {
        updateMessageById(
          retryMessage.id,
          (message) => ({ ...message, sendFailed: true }),
          true,
        );
      }

      // Clear the persistent failure state before the canonical send path runs
      // its preflight checks. A rejected preflight restores the retry action.
      updateMessageById(currentMessage.id, () => retryMessage, true);

      void handleSend(
        retryMessage.content,
        retryMessage.attachments ?? [],
        {
          clientRequestId: retryMessage.clientRequestId ?? retryMessage.id,
          userMessageId: retryMessage.id,
          acceptDurableQueue: true,
          ...(retryMessage.sessionMode ? { sessionMode: retryMessage.sessionMode } : {}),
          ...(retryMessage.runContext
            ? {
                context: retryMessage.runContext,
                skillIds: retryMessage.runContext.skillIds,
              }
            : {}),
          ...(retryMessage.appliedPluginSnapshot
            ? { appliedPluginSnapshot: retryMessage.appliedPluginSnapshot }
            : {}),
          ...(retryMessage.taskAnalytics ? { taskAnalytics: retryMessage.taskAnalytics } : {}),
        },
      ).then(
        (started) => {
          if (!started) restoreFailedState();
        },
        restoreFailedState,
      );
    },
    [handleSend, updateMessageById],
  );

  /*
   * "Edit" on a sent message: the daemon takes the conversation back to just
   * before it (and, when asked, the files to before its answer), then the
   * edited text goes out the normal way with the same attachments and context.
   * The send gets the shortened list as its history, so nothing removed comes
   * back from a stale copy of the transcript.
   */
  const handleEditUserMessage = useCallback(
    async (original: ChatMessage, text: string, restoreFiles: boolean): Promise<EditUserMessageOutcome> => {
      if (original.role !== 'user' || !text.trim()) return { ok: false, code: 'BAD_REQUEST' };
      if (!activeConversationId || currentConversationBusy || projectReadsHeld) return { ok: false, code: 'RUN_ACTIVE' };
      const conversationId = activeConversationId;
      let result: RewindConversationResponse;
      try {
        result = await rewindConversation(project.id, conversationId, { fromMessageId: original.id, restoreFiles });
      } catch (error) {
        return { ok: false, code: error instanceof ConversationRewindError ? error.code : 'REWIND_FAILED' };
      }
      if (messagesConversationIdRef.current !== conversationId) return { ok: true, files: result.files };
      const removed = new Set(result.removedMessageIds);
      const kept = messagesRef.current.filter((message) => !removed.has(message.id));
      messagesRef.current = kept;
      setMessages(kept);
      if (result.files.restored) void refreshProjectFiles();
      void handleSend(
        text,
        original.attachments ?? [],
        {
          clientRequestId: randomUUID(),
          ...(original.sessionMode ? { sessionMode: original.sessionMode } : {}),
          ...(original.runContext
            ? { context: original.runContext, skillIds: original.runContext.skillIds }
            : {}),
          ...(original.appliedPluginSnapshot ? { appliedPluginSnapshot: original.appliedPluginSnapshot } : {}),
        },
        kept,
      );
      return { ok: true, files: result.files };
    },
    [activeConversationId, currentConversationBusy, projectReadsHeld, project.id, refreshProjectFiles, handleSend],
  );

  const handleComposerSend = useCallback(
    async (
      prompt: string,
      attachments: ChatAttachment[],
      meta?: ChatSendMeta,
    ): Promise<ChatSendOutcome> => {

      /*
       * 等 `handleSend` 落定,好让**被余额拦下的那一发**把正文还回输入框
       * (OPEND-2719)。以前这里是 `void handleSend(...)`:输入框立刻清空,
       * 于是「不代管就会丢正文」变成了硬约束,拦截档只能拿队列去接。
       *
       * 这一等**只对 OpenPixo Cloud 有实际时长** —— 只有那一档在
       * `POST /api/runs` 之前有一次预检往返;别的 agent 这条路上一个 await
       * 都没有,promise 在微任务里就落定,输入框和以前一样立刻清空。
       * 等待期间 `ChatComposer` 自己会把发送键换成「准备中」那枚不可点的
       * 药丸(`composedSendPending`)—— 那套机制原本就是为这道预检写的,
       * 只是在此之前没有宿主真的去等它。
       */
      const clientRequestId = meta?.clientRequestId ?? randomUUID();
      const started = await handleSend(prompt, attachments, {
        ...(meta ?? {}),
        clientRequestId,
        // 这条路,而且只有这条路,的正文归输入框所有 —— 见
        // `ProjectChatSendMeta.composerOwnedDraft`。
        composerOwnedDraft: true,
      });
      if (started) return;
      // 认领必须按请求 id:同一条会话里可能有别的发送也在这段时间被拒。


    },
    [activeConversationId, false, handleSend, project.id],
  );

  // Cancel every in-flight run for the current conversation (the user's own
  // streaming turn plus any reattached runs), mark their assistant messages
  // canceled, and drop the streaming state. Defined here — ahead of the
  // queued-send handlers — because "send now" interrupts the active run to
  // make room for the prioritized send.
  const handleStop = useCallback(() => {
    const stoppedAt = Date.now();
{}

    cancelSendTextBuffer(true);
    cancelReattachTextBuffers(true);
    cancelRef.current?.abort();
    cancelRef.current = null;
    for (const controller of reattachCancelControllersRef.current.values()) {
      controller.abort();
    }
    reattachCancelControllersRef.current.clear();
    abortRef.current?.abort();
    abortRef.current = null;
    for (const controller of reattachControllersRef.current.values()) {
      controller.abort();
    }
    reattachControllersRef.current.clear();
    setStreaming(false);
    streamingConversationIdRef.current = null;
    setStreamingConversationId(null);
    setMessages((curr) => {
      const { messages: next, finalized } = finalizeActiveAssistantMessagesOnStop(curr, stoppedAt);
      for (const message of finalized) persistMessage(message, { telemetryFinalized: true });
      return next;
    });
  }, [cancelSendTextBuffer, cancelReattachTextBuffers, currentProject.metadata, onProjectsRefresh, persistMessage, projectDetail.refresh, requestOpenFile, refreshWorkspaceItems]);

  // Starts a queued send. One that ends without a run stays in the queue, but
  // no longer holds its comments.
  const startQueuedChatSend = useCallback(async (item: QueuedChatSend): Promise<boolean> => {
    let started = false;
    try {
      started = await handleSend(
        item.prompt,
        item.attachments,
        { ...(item.meta ?? {}), queueDrain: true },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    return started;
  }, [handleSend,]);

  const sendQueuedChatSendNow = useCallback((id: string) => {
    const item = queuedChatSendsRef.current.find((candidate) => candidate.id === id);
    if (!item) return;
    if (currentConversationBusy) {
      // "Send now" while the agent is still working: the user has explicitly
      // chosen this turn over the in-flight one, so interrupt the running run
      // and move this item to the front. Stopping flips the conversation out
      // of its busy state, and the auto-start effect below then flushes the
      // now-first queued send — reusing the same path as a natural completion,
      // so runs never overlap.
      //
      // Record the runs we're superseding BEFORE handleStop() clears the active
      // refs. The daemon still delivers a late terminal callback for the
      // canceled run; tagging its controller here lets those callbacks be
      // recognized as stale and skip every current-run side effect, even if the
      // replacement send hasn't attached yet.
      if (abortRef.current) supersededRunsRef.current.add(abortRef.current);
      for (const controller of reattachControllersRef.current.values()) {
        supersededRunsRef.current.add(controller);
      }
      // handleStop releases the interrupted turn's comments back to 'open'.
      prioritizeQueuedChatSend(id);
      handleStop();
      return;
    }
    void (async () => {
      const started = await startQueuedChatSend(item);
      if (started) removeQueuedChatSend(id);
    })();
  }, [ currentConversationBusy, handleStop, prioritizeQueuedChatSend, removeQueuedChatSend, startQueuedChatSend]);

  /*
   * B11 「引导对话」 —— 队列行领头那颗按钮走的就是上面的
   * `sendQueuedChatSendNow`(OPEND-2602)。
   *
   * 它原来走的是「一个字都不打断,把消息写进 agent 子进程还开着的 stdin」
   * (`steerChatRun`)。产品 2026-09-03 裁决把这条路整个撤了,两件实测事实:
   *   · 当前只有 `claude` 的 `promptInputFormat` 是 `stream-json`;
   *   · 拿装机的真 claude 2.1.259 做对照:轮次跑到一半写进 stdin 的 user 帧
   *     CLI 完全没处理(等 180s 进程活着不动),同一条在 `result` 帧之后写进去
   *     才正常起第二轮 —— 而 daemon 恰恰在 `usage` 那一档就关了 stdin。
   *
   * 现在它按下去干的事是**中断当前这一轮,然后立刻发出这条**,也就是
   * `sendQueuedChatSendNow` 在会话 busy 时走的那条路 —— 复用它,而不是
   * 另起一条:那条已经处理好三件难的事(把被顶掉的 run 记进 `supersededRunsRef`,
   * 免得 daemon 迟到的终止回调污染新一轮;把卡在 `applying` 的预览批注复位;
   * 靠自动启动效应避免两轮重叠)。会话没在跑时它就是直接发,同一个函数的
   * 另一条分支。
   *
   * 这里曾经还有一道 `canSteerCurrentTurn` 门,用来决定按钮画「引导对话」
   * 还是退回一颗无标签的「立即发送」。产品 2026-09-08 当面把它裁掉了 ——
   * 「引导对话就是原本的立即发送啊,只不过我们换了个名字跟 codex 客户端
   * 对齐了下」。门两边喂的本来就是同一个 `sendQueuedChatSendNow`,所以门一撤
   * 按钮行为一个字没变,变的只是它不再改名。交付稿里也只有「引导对话」
   * 那一颗(`729fa43ce7:docs/design/chat-panel-next.html` 组件 17)。
   */

  useEffect(() => {
    if (currentConversationBusy) {
      startingQueuedChatSendIdRef.current = null;
      return;
    }
    if (startingQueuedChatSendIdRef.current) return;
    if (!activeConversationId) return;
    if (messagesConversationIdRef.current !== activeConversationId) return;

    const next = queuedChatSendsRef.current.find(
      (item) => item.conversationId === activeConversationId,
    );
    if (!next) return;
    startingQueuedChatSendIdRef.current = next.id;
    void (async () => {
      const started = await startQueuedChatSend(next);
      if (!started) {
        if (startingQueuedChatSendIdRef.current === next.id) {
          startingQueuedChatSendIdRef.current = null;
        }
        return;
      }
      removeQueuedChatSend(next.id);
      scheduleProjectTimeout(() => {
        if (startingQueuedChatSendIdRef.current !== next.id) return;
        startingQueuedChatSendIdRef.current = null;
        setQueuedAutoStartTick((tick) => tick + 1);
      }, 0);
    })();
  }, [activeConversationId, config.mode, config.agentId, currentConversationBusy, queuedAutoStartTick, queuedChatSends, startQueuedChatSend, removeQueuedChatSend, scheduleProjectTimeout]);

  /*
   * 〔更换模型〕(E3)。交付稿 `error-ux-design.md:130`(S08)写的是
   * 「更换模型**直接打开模型选择器,选完自动重跑**」。
   *
   * 分两半:这里推一拍信号把 composer 的模型选择器叫开,并记下是**哪一轮**
   * 在等重跑;等选中的配置提交到当前 render,再把那一轮重发一次。
   *
   * 记 message 而不是只记一个布尔:用户可能在选模型之前又翻了别的会话,
   * 到时候重跑的必须仍是当初按下那颗按钮的那一轮。
   */
  const [modelPickerOpenSignal, setModelPickerOpenSignal] = useState(0);
  const rerunAfterModelChangeRef = useRef<{
    message: ChatMessage;
    conversationKey: string;
  } | null>(null);
  const [pendingModelSwitchRetry, setPendingModelSwitchRetry] = useState<{
    message: ChatMessage;
    conversationKey: string;
    selection:
      | { mode: 'daemon'; agentId: string; choice: Parameters<Props['onAgentModelChange']>[1] }
      | { mode: 'api'; model: string };
  } | null>(null);
  const handleSwitchModel = useCallback((assistantMessage: ChatMessage) => {
    rerunAfterModelChangeRef.current = { message: assistantMessage, conversationKey: conversationAgentKey };
    setPendingModelSwitchRetry(null);
    setModelPickerOpenSignal((n) => n + 1);
  }, [conversationAgentKey]);

  /** A retry consumes the current error surface, but never the failed history. */
  const handleRetry = useCallback(
    (
      assistantMessage: ChatMessage,
      recoveryActionType: TrackingRunRecoveryActionType = 'manual_retry',
    ) => {
      const retryConversationId = activeConversationId;
      if (
        currentConversationActionDisabledRef.current
        || !retryConversationId
        || activeConversationIdRef.current !== retryConversationId
        || retryLocksRef.current.has(retryConversationId)
        || !resolveRetryTarget(messages, assistantMessage.id)
      ) return;
      const replacementAssistantId = randomUUID();
      retryLocksRef.current.set(retryConversationId, replacementAssistantId);
      setRetryPending({
        conversationId: retryConversationId,
        failedAssistantId: assistantMessage.id,
        replacementAssistantId,
      });
      void (async () => {
        let started = false;
        try {
          started = await handleSend('', [], {
            retryOfAssistantId: assistantMessage.id,
            assistantMessageId: replacementAssistantId,
            taskAnalytics: buildRecoveryTaskAnalytics(messages, assistantMessage, recoveryActionType),
          });
        } finally {
          if (!started) {
            if (retryLocksRef.current.get(retryConversationId) === replacementAssistantId) {
              retryLocksRef.current.delete(retryConversationId);
            }
            setRetryPending((current) =>
              current?.replacementAssistantId === replacementAssistantId ? null : current,
            );
          }
        }
      })();
    },
    [activeConversationId, handleSend, messages],
  );

  // Retry only from the render whose effective configuration contains the selection.
  useEffect(() => {
    const origin = rerunAfterModelChangeRef.current;
    if (origin && origin.conversationKey !== conversationAgentKey) {
      rerunAfterModelChangeRef.current = null;
    }
    const pending = pendingModelSwitchRetry;
    if (!pending) return;
    if (pending.conversationKey !== conversationAgentKey || !rerunAfterModelChangeRef.current) {
      setPendingModelSwitchRetry(null);
      return;
    }
    const selection = pending.selection;
    if (config.mode !== selection.mode) return;
    if (selection.mode === 'daemon') {
      if (config.agentId !== selection.agentId) return;
      const committedChoice = config.agentModels?.[selection.agentId];
      if ((['model', 'reasoning', 'serviceTier'] as const).some((key) =>
        Object.prototype.hasOwnProperty.call(selection.choice, key)
        && committedChoice?.[key] !== selection.choice[key],
      )) return;
    } else if (config.model !== selection.model) return;
    rerunAfterModelChangeRef.current = null;
    setPendingModelSwitchRetry(null);
    handleRetry(pending.message, 'switch_model_retry');
  }, [config, conversationAgentKey, handleRetry, pendingModelSwitchRetry]);

  // Release only the request we witnessed. Old responses must not unlock a
  // later attempt; accepting or rejecting it must not revive its old error card.
  useEffect(() => {
    if (!retryPending) {
      retryPendingPaintedRef.current = null;
      return;
    }
    const release = () => {
      if (retryLocksRef.current.get(retryPending.conversationId) === retryPending.replacementAssistantId) {
        retryLocksRef.current.delete(retryPending.conversationId);
      }
      setRetryPending((current) =>
        current?.replacementAssistantId === retryPending.replacementAssistantId ? null : current,
      );
    };
    if (retryPending.conversationId !== activeConversationId) {
      release();
      return;
    }
    const replacement = messages.find((message) => message.id === retryPending.replacementAssistantId);
    if (replacement) {
      retryPendingPaintedRef.current = retryPending.replacementAssistantId;
      if (replacement.runId || !isActiveRunStatus(replacement.runStatus)) release();
      return;
    }
    if (retryPendingPaintedRef.current === retryPending.replacementAssistantId) release();
  }, [activeConversationId, messages, retryPending]);

  // "Continue" on a resumable failed run: send a fresh turn in the same
  // conversation. For a session-resuming runtime (Claude) the daemon persisted
  // the failed run's CLI session, so this turn resumes it (`--resume`) and the
  // agent continues from its committed work instead of restarting. Mirrors the
  // "Continue remaining tasks" affordance; unlike Retry it does not replay the
  // prior turn from scratch. Tagged `entryFrom: 'resume_continue'` so
  // run_created / run_finished can quantify how often resume fires and whether
  // it recovers (the whole point is to show the mechanism lowers failure rate).
  const handleResumeRun = useCallback(
    (assistantMessage: ChatMessage) => {
      if (currentConversationActionDisabled) return;
      void handleSend(RESUME_CONTINUE_PROMPT, [], {
        entryFrom: 'resume_continue',
        taskAnalytics: buildRecoveryTaskAnalytics(
          messages,
          assistantMessage,
          'resume_run',
        ),
      });
    },
    [currentConversationActionDisabled, handleSend, messages],
  );

  // OPEND-3205 supersedes the Settings-return automatic retry for this action.
  // Preserve the failed turn; selecting Cloud does not submit another task.


  useEffect(() => {
    if (!autoAuditRepairSeed) return;
    if (!activeConversationId) return;
    if (!messagesInitialized) return;
    if (currentConversationBusy) return;
    const repairText = autoAuditRepairSeed.value.trim();
    setAutoAuditRepairSeed(null);
    if (!repairText) return;
    void handleSend(repairText, [],);
  }, [activeConversationId, autoAuditRepairSeed, currentConversationBusy, handleSend, messagesInitialized]);

  const handleContinueRemainingTasks = useCallback(
    async (_assistantMessage: ChatMessage, todos: TodoItem[]) => {
      if (currentConversationActionDisabled || todos.length === 0) return false;
      const remainingList = todos
        .map((todo, i) => {
          const label =
            todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content;
          return `${i + 1}. [${todo.status}] ${label}`;
        })
        .join('\n');
      const prompt =
        'Continue the remaining unfinished tasks from the previous run. ' +
        'Do not redo completed work. Focus only on these unfinished todos:\n\n' +
        `${remainingList}\n\n` +
        'Before making changes, inspect the current project files as needed. ' +
        'Update TodoWrite as you complete each remaining task.';
      return handleSend(prompt, [],);
    },
    [currentConversationActionDisabled, handleSend],
  );

  const selectedPluginActionAgent =
    config.mode === 'daemon' && config.agentId
      ? agentsById.get(config.agentId)
      : null;
  const selectedPluginActionChoice =
    config.mode === 'daemon' && config.agentId
      ? config.agentModels?.[config.agentId]
      : undefined;
  const pluginWorkflowAgentName =
    config.mode === 'daemon'
      ? agentModelDisplayName(
          config.agentId,
          selectedPluginActionAgent?.name,
          selectedPluginActionChoice?.model,
          selectedPluginActionAgent?.models,
        )
      : apiProtocolModelLabel(config.apiProtocol, config.model, config.baseUrl);

  const handlePluginFolderAgentAction = useCallback(
    async (relativePath: string, action: PluginFolderAgentAction) => {
      if (currentConversationActionDisabled || !activeConversationId) return;
      setHiddenAssistantPluginActionPaths((prev) => new Set(prev).add(relativePath));
      if (action === 'install') {
        setActivePluginActionPaths((prev) => new Set(prev).add(relativePath));
        let outcome;
        try {
          outcome = await installGeneratedPluginFolder(project.id, relativePath);
        } finally {
          setActivePluginActionPaths((prev) => {
            const next = new Set(prev);
            next.delete(relativePath);
            return next;
          });
          setHiddenAssistantPluginActionPaths((prev) => {
            const next = new Set(prev);
            next.delete(relativePath);
            return next;
          });
        }
        if (!outcome.ok) throw new Error(outcome.message);
        return { message: outcome.message };
      }
      const conversationId = activeConversationId;
      const shareAction = 'publish-github';
      setActivePluginActionPaths((prev) => new Set(prev).add(relativePath));
      let taskStart;
      try {
        taskStart = await startGeneratedPluginShareTask(project.id, relativePath, shareAction);
      } catch (error) {
        setActivePluginActionPaths((prev) => {
          const next = new Set(prev);
          next.delete(relativePath);
          return next;
        });
        setHiddenAssistantPluginActionPaths((prev) => {
          const next = new Set(prev);
          next.delete(relativePath);
          return next;
        });
        throw error;
      }
      const startedAt = taskStart.startedAt;
      const messageId = randomUUID();
      const updateConversationLatestRun = (
        status: NonNullable<ChatMessage['runStatus']>,
        endedAt?: number,
      ) => {
        setConversations((curr) =>
          curr.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  updatedAt: endedAt ?? startedAt,
                  latestRun: {
                    status,
                    startedAt,
                    ...(endedAt === undefined
                      ? {}
                      : {
                          endedAt,
                          durationMs: Math.max(0, endedAt - startedAt),
                        }),
                  },
                }
              : conversation,
          ),
        );
      };
      const progressMessage: ChatMessage = {
        id: messageId,
        role: 'assistant',
        content: pluginWorkflowStartContent(action, relativePath),
        agentName: pluginWorkflowAgentName,
        events: pluginWorkflowPlannedEvents(action, relativePath),
        createdAt: startedAt,
        startedAt,
        runStatus: 'running',
      };
      setForceStreamingPluginMessageIds((prev) => new Set(prev).add(messageId));
      appendConversationMessage(conversationId, progressMessage, undefined, false);
      updateConversationLatestRun('running');
      void (async () => {
        let since = 0;
        let liveEvents = [...pluginWorkflowPlannedEvents(action, relativePath)];
        let liveContent = pluginWorkflowStartContent(action, relativePath);
        while (true) {
          const snapshot = await waitGeneratedPluginShareTask(taskStart.taskId, since, 25_000);
          since = snapshot.nextSince;
          if (snapshot.progress.length > 0) {
            const newTextEvents = snapshot.progress
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => ({ kind: 'text' as const, text: `${line}\n` }));
            liveEvents = [
              ...liveEvents.filter((event, index) => !(index === liveEvents.length - 1 && event.kind === 'status' && event.label === 'working')),
              ...newTextEvents,
              { kind: 'status', label: 'working', detail: pluginWorkflowTitle(action) },
            ];
            liveContent = `${liveContent}\n\n${snapshot.progress.map((line) => line.trim()).filter(Boolean).join('\n')}`.trim();
            replaceConversationMessage(
              conversationId,
              {
                ...progressMessage,
                content: liveContent,
                events: liveEvents,
                runStatus: 'running',
              },
              undefined,
              false,
            );
          }
          if (snapshot.status === 'running' || snapshot.status === 'queued') continue;
          const endedAt = snapshot.endedAt ?? Date.now();
          setActivePluginActionPaths((prev) => {
            const next = new Set(prev);
            next.delete(relativePath);
            return next;
          });
          setHiddenAssistantPluginActionPaths((prev) => {
            const next = new Set(prev);
            next.delete(relativePath);
            return next;
          });
          if (snapshot.status === 'done' && snapshot.result) {
            setForceStreamingPluginMessageIds((prev) => {
              const next = new Set(prev);
              next.delete(messageId);
              return next;
            });
            replaceConversationMessage(
              conversationId,
              {
                ...progressMessage,
                content: pluginWorkflowSuccessContent(
                  action,
                  relativePath,
                  snapshot.result.message,
                  snapshot.result.url,
                  snapshot.result.log,
                ),
                events: pluginWorkflowResultEvents(
                  action,
                  relativePath,
                  snapshot.result.message,
                  snapshot.result.url,
                  snapshot.result.log,
                  true,
                  liveEvents,
                ),
                endedAt,
                runStatus: 'succeeded',
              },
              { telemetryFinalized: true },
            );
            updateConversationLatestRun('succeeded', endedAt);
            return;
          }
          const errorMessage = snapshot.error?.message || `${pluginWorkflowTitle(action)} failed.`;
          setForceStreamingPluginMessageIds((prev) => {
            const next = new Set(prev);
            next.delete(messageId);
            return next;
          });
          replaceConversationMessage(
            conversationId,
            {
              ...progressMessage,
              content: pluginWorkflowFailureContent(
                action,
                relativePath,
                errorMessage,
                snapshot.error?.log,
              ),
              events: pluginWorkflowResultEvents(
                action,
                relativePath,
                errorMessage,
                undefined,
                snapshot.error?.log,
                false,
                liveEvents,
              ),
              endedAt,
              runStatus: 'failed',
            },
            { telemetryFinalized: true },
          );
          updateConversationLatestRun('failed', endedAt);
          return;
        }
      })().catch((err) => {
        const endedAt = Date.now();
        setForceStreamingPluginMessageIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
        setActivePluginActionPaths((prev) => {
          const next = new Set(prev);
          next.delete(relativePath);
          return next;
        });
        setHiddenAssistantPluginActionPaths((prev) => {
          const next = new Set(prev);
          next.delete(relativePath);
          return next;
        });
        replaceConversationMessage(
          conversationId,
          {
            ...progressMessage,
            content: pluginWorkflowFailureContent(
              action,
              relativePath,
              err instanceof Error ? err.message : String(err),
            ),
            events: pluginWorkflowResultEvents(
              action,
              relativePath,
              err instanceof Error ? err.message : String(err),
              undefined,
              [],
              false,
            ),
            endedAt,
            runStatus: 'failed',
          },
          { telemetryFinalized: true },
        );
        updateConversationLatestRun('failed', endedAt);
      });
      return;
    },
    [activeConversationId, appendConversationMessage, currentConversationActionDisabled, pluginWorkflowAgentName, project.id, null, replaceConversationMessage],
  );

  const handleNewConversation = useCallback(async () => {
    if (projectReadsHeld) return;
    if (creatingConversationRef.current) return;
    // Only block if we're sure the current conversation is empty:
    // messages must be loaded AND match the active conversation.
    if (
      messagesConversationIdRef.current === activeConversationId &&
      messages.length === 0
    ) {
      return;
    }
    creatingConversationRef.current = true;
    setCreatingConversation(true);
    setConversationLoadFailure(null);
    try {
      const fresh = await createConversation(project.id, undefined, {

      });
      if (!fresh) throw new Error('Could not create a conversation for this project.');
      // Eagerly clear messages and update ref so rapid clicks don't create
      // duplicate empty conversations before the effect resolves.
      setMessages([]);
      setArtifact(null);
      savedArtifactRef.current = null;
      setStreaming(false);
      streamingConversationIdRef.current = null;
      setStreamingConversationId(null);
      setMessagesInitialized(true);
      setMessagesConversationId(fresh.id);
      messagesConversationIdRef.current = fresh.id;
      messagesAuthorityKeyRef.current = projectRunAuthorityKey;
      createdEmptyTranscriptRef.current = {
        projectId: project.id,
        conversationId: fresh.id,
        authorityKey: projectRunAuthorityKey,
      };
      loadedTranscriptRef.current = {
        projectId: project.id,
        conversationId: fresh.id,
        principalKey: 'local',
      };
      setConversations((curr) => [fresh, ...curr]);
      setActiveConversationId(fresh.id);
      // Push the new conversation id into the URL synchronously so the
      // route-sync effect sees a matching `routeConversationId` before
      // it can revert `activeConversationId`. Without this, the route-sync
      // effect can fight the conversation switch, preventing users from
      // switching back to older conversations after creating a new one.
      navigate(
        {
          kind: 'project',
          projectId: project.id,
          conversationId: fresh.id,
          fileName: openTabsState.active ?? null,
        },
        { replace: true },
      );
      setError(null);
    } catch (err) {
      console.warn('Could not create a conversation for this project', err);
      const message = t('project.conversationsLoadFailed');
      setConversationLoadFailure({ message, source: 'create' });
      setError(message);
    } finally {
      creatingConversationRef.current = false;
      setCreatingConversation(false);
    }
  }, [project.id, activeConversationId, messages.length, navigate, openTabsState.active, null, projectRunAuthorityKey, false]);

  const handleSelectConversation = useCallback((id: string, measureNavigation = true) => {
    if (id === activeConversationId && failedMessagesConversationId !== id) return;
    const navigationId = measureNavigation ? observeNavigation(() => navigationTiming.begin(
      { kind: 'project', projectId: project.id, conversationId: activeConversationId },
      { projectId: project.id, conversationId: id },
    )) : null;
    beginConversationSwitch(id);
    // Push the new conversation id into the URL synchronously so the
    // route-sync effect sees a matching `routeConversationId` before it
    // can find the previous conversation in the list and revert
    // `activeConversationId` to it. Without this, the same effect that
    // fights handleNewConversation also fights chat switching,
    // ping-ponging until React's nested-update guard fires.
    navigate(
      {
        kind: 'project',
        projectId: project.id,
        conversationId: id,
        fileName: openTabsState.active ?? null,
      },
      {
        replace: true,
        onCommit: () => { if (navigationId) observeNavigation(() => navigationTiming.commit(navigationId)); },
        onCancel: reason => { if (navigationId) observeNavigation(() => navigationTiming.finish(navigationId, 'cancelled', reason)); },
      },
    );
    setMessageLoadRetryNonce((nonce) => nonce + 1);
  }, [activeConversationId, beginConversationSwitch, failedMessagesConversationId, project.id, openTabsState.active]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      if (projectReadsHeld) return;
      const ok = await deleteConversationApi(project.id, id);
      if (!ok) return;
      // The deleted conversation may have owned an unanswered
      // `<question-form>`, which the daemon counts toward the project's
      // `needsInput` flag in `/api/projects`. Home cards render that
      // flag from the cached projects payload, so without refreshing
      // it here the `Needs input` badge survives the deletion until
      // the next manual reload.
      onProjectsRefresh();
      setConversations((curr) => {
        const next = curr.filter((c) => c.id !== id);
        if (next.length === 0) {
          // Re-seed so the project always has at least one conversation
          // to write into.
          void createConversation(project.id, undefined, {

          }).then((fresh) => {
            if (fresh) {
              setConversations([fresh]);
              setActiveConversationId(fresh.id);
            }
          });
        } else if (id === activeConversationId) {
          setActiveConversationId(next[0]!.id);
        }
        return next;
      });
    },
    [project.id, activeConversationId, onProjectsRefresh, null, false],
  );

  const handleRenameConversation = useCallback(
    async (id: string, title: string) => {
      if (projectReadsHeld) return;
      const trimmed = title.trim();
      setConversations((curr) =>
        curr.map((c) => (c.id === id ? { ...c, title: trimmed } : c)),
      );
      await patchConversation(project.id, id, { title: trimmed });
    },
    [project.id, null, false],
  );

  const handleConversationSessionModeChange = useCallback(
    async (id: string, sessionMode: ChatSessionMode) => {
      if (projectReadsHeld) return;
      setConversations((curr) =>
        curr.map((conversation) =>
          conversation.id === id ? { ...conversation, sessionMode } : conversation,
        ),
      );
      const updated = await patchConversation(project.id, id, { sessionMode });
      if (updated) {
        setConversations((curr) =>
          curr.map((conversation) =>
            conversation.id === id ? { ...conversation, ...updated } : conversation,
          ),
        );
      }
    },
    [project.id, null, false],
  );

  const handleActiveConversationSessionModeChange = useCallback(
    (sessionMode: ChatSessionMode) => {
      if (!activeConversationId) return;
      void handleConversationSessionModeChange(activeConversationId, sessionMode);
    },
    [activeConversationId, handleConversationSessionModeChange],
  );

  const handleForkFromMessage = useCallback(
    async (assistantMessage: ChatMessage) => {
      if (!activeConversationId || forkingMessageId || projectReadsHeld) return;
      const requestId = analytics.newRequestId();
      const startedAt = Date.now();
      /*
       * `assistantMessage` 是**渲染**出来的那一格 —— 一条 OD Next Full Plan 回合的
       * 几个物理 run 被 `foldStrategyTaskTurns` 折成一条,折出来那条带的是头一个 run
       * 的 id。分叉切的是转录,所以先把边界推回这条逻辑回合在转录里的最后一条。
       * 见 `runtime/chat/fork-boundary.ts`。
       */
      const forkIndex = forkBoundaryMessageIndex(messages, assistantMessage.id);
      const forkBoundaryMessage = forkIndex < 0 ? undefined : messages[forkIndex];
      const forkAfterMessageId = forkBoundaryMessage?.id ?? assistantMessage.id;
      const forkContext = {
        page_name: 'chat_panel' as const,
        area: 'chat_panel' as const,
        element: 'assistant_fork_button' as const,
        action: 'fork_conversation' as const,
        project_id: project.id,
        project_kind: projectKindFromMetadataToTracking(project.metadata),
        conversation_id: activeConversationId,
        assistant_message_id: assistantMessage.id,
        source_run_id: assistantMessage.runId ?? null,
        source_agent_id: assistantMessage.agentId ?? 'unknown',
        agent_provider_id: runAgentProviderId(assistantMessage.agentId ?? 'unknown'),
        session_mode: sessionModeToTracking(activeSessionMode),
        fork_point: conversationForkPoint(messages, forkAfterMessageId, forkIndex),
        seed_message_count: forkIndex < 0 ? null : forkIndex + 1,
        conversation_message_count: messages.length,
        messages_after_fork_count: forkIndex < 0 ? null : messages.length - forkIndex - 1,
      };
      trackConversationForkClick(analytics.track, forkContext, { requestId });
      setForkingMessageId(assistantMessage.id);
      setConversationLoadFailure(null);
      let emptyResponse = false;
      try {
        const forkFallbackPredecessorMessageId = forkIndex < 0
          ? undefined
          : (messages[forkIndex - 1]?.id ?? null);
        /*
         * 标题**不传** —— 归 daemon 起(`apps/daemon/src/conversation-fork-title.ts`)。
         *
         * 2026-09-03 产品裁决把「{原标题} 分叉」换成了自增编号「{原标题} (n)」。编号要
         * 唯一就得先看一眼这个项目里已有哪些标题,那份名单只有 daemon 手上是权威的:
         * 这里的 `conversations` 是可能过期的快照,两个客户端各拿各的快照算同一个号
         * 必然撞。daemon 那边「读名单 → 算号 → 落库」中间没有 await,同进程内原子。
         *
         * 顺带白拿了 CLI 那条路(`pixo chat new --fork-after`),它本来就不传标题。
         * `fresh.title` 是 daemon 返回的真实标题,下面直接进 `conversations`,
         * 所以这里也不需要乐观标题。
         */
        const fresh = await createConversation(project.id, undefined, {
          seedFromConversationId: activeConversationId,
          forkAfterMessageId,
          sessionMode: activeSessionMode,
          /*
           * 兜底送的是**边界那条转录消息**,不是屏幕上那条折叠出来的 —— 折叠那条的正文
           * 是几个 run 拼起来的,真走到兜底路径就会把同一段内容再塞一遍。
           */
          forkFallbackMessage:
            forkFallbackPredecessorMessageId === undefined
              ? undefined
              : (forkBoundaryMessage ?? assistantMessage),
          forkFallbackPredecessorMessageId,

          throwOnError: true,
        });
        if (!fresh) {
          emptyResponse = true;
          throw new Error(t('chat.forkConversationFailed'));
        }
        trackConversationForkResult(
          analytics.track,
          {
            ...forkContext,
            target_conversation_id: fresh.id,
            result: 'success',
            duration_ms: Math.max(0, Date.now() - startedAt),
          },
          { requestId },
        );
        /*
         * 分界线**不落在源会话**(2026-08-26 用户裁决:「要在新的 fork 里出现,
         * 而不是旧会话里出现啊」)。
         *
         * 这里原来给源会话那条助手消息盖 `forkedInto`,理由是「分支要留在它被拉出来
         * 的地方」。但点完分叉页面就**跳到新会话**,人此刻站在那边 —— 源会话上的那条线
         * 除非专门翻回去否则永远看不到;而那行脚注「从上一个会话继续」
         * 对着原地没动的源会话说也不成立。
         *
         * 标记改由 daemon 在建新会话时盖在**带过来的最后一条**上,见
         * `apps/daemon/src/routes/project/conversations.ts` 的 fork 分支。
         * 放在 daemon 还顺带白拿了 CLI 那条路(`pixo project conversation --fork-after`)。
         */
        setMessages([]);
        setArtifact(null);
        setStreaming(false);
        streamingConversationIdRef.current = null;
        setStreamingConversationId(null);
        setMessagesConversationId(null);
        messagesConversationIdRef.current = null;
        messagesAuthorityKeyRef.current = null;
        setFailedMessagesConversationId(null);
        setConversations((curr) => [fresh, ...curr.filter((c) => c.id !== fresh.id)]);
        setActiveConversationId(fresh.id);
        navigate(
          {
            kind: 'project',
            projectId: project.id,
            conversationId: fresh.id,
            fileName: openTabsState.active ?? null,
          },
          { replace: true },
        );
        onProjectsRefresh();
        setError(null);
      } catch (err) {
        trackConversationForkResult(
          analytics.track,
          {
            ...forkContext,
            target_conversation_id: null,
            result: 'failed',
            error_code: emptyResponse ? 'empty_response' : conversationForkErrorCode(err),
            duration_ms: Math.max(0, Date.now() - startedAt),
          },
          { requestId },
        );
        const message = err instanceof Error ? err.message : t('chat.forkConversationFailed');
        setConversationLoadFailure({ message, source: 'create' });
        setError(message);
      } finally {
        setForkingMessageId(null);
      }
    },
    [activeConversationId, activeConversation?.title, activeSessionMode, analytics, forkingMessageId, messages, navigate, onProjectsRefresh, openTabsState.active, project.id, project.metadata, false, t, updateMessageById],
  );

  const activeConversationChatState = useMemo(
    () =>
      activeConversationId
        ? {
	            conversationId: activeConversationId,
	            messages,
	            streaming: currentConversationControlStreaming,
	            loading: currentConversationLoading,
	            sendDisabled: currentConversationSendDisabled,
            queuedItems: currentConversationQueuedItems,
            error: conversationLoadError ?? error,
            errorSourceAssistantId:
              conversationLoadError ? null : errorSourceAssistantId,
            onSend: handleComposerSend,
            onRetry: handleRetry,
            recoveryActionsBlockedReason: currentConversationActionBlockReason,
            retryPendingAssistantId: retryPending?.conversationId === activeConversationId
              ? retryPending.failedAssistantId : null,
            supersededErrorAssistantIds,
            onStop: handleStop,
            onRemoveQueuedSend: discardQueuedChatSend,
            onUpdateQueuedSend: updateQueuedChatSend,
            onReorderQueuedSends: reorderCurrentConversationQueuedChatSends,
            // B11 「引导对话」: one button, always offered. The handler already
            // branches on `currentConversationBusy` into stop-then-resend, so
            // there is nothing left for a visibility gate to decide.
            onSendQueuedNow: sendQueuedChatSendNow,
            onAssistantFeedback: handleAssistantFeedback,
          }
        : undefined,
    [activeConversationId, conversationLoadError, currentConversationActionDisabled, currentConversationActionBlockReason, retryPending, supersededErrorAssistantIds, currentConversationQueuedItems, currentConversationSendDisabled, currentConversationLoading, currentConversationControlStreaming, error, errorSourceAssistantId, handleAssistantFeedback, handleRetry, handleComposerSend, handleStop, messages, discardQueuedChatSend, reorderCurrentConversationQueuedChatSends, sendQueuedChatSendNow, updateQueuedChatSend],
  );

  // Signal that pushes a draft into the chat composer (the "Import repo" CTA).
  const [composerDraftSignal, setComposerDraftSignal] = useState<{ text: string; nonce: number }>();
  useEffect(() => {
    const prefill = takeProjectComposerPrefill(project.id);
    if (prefill) setComposerDraftSignal(prefill);
    // A draft queued from inside this project (the Share dialog) must be seen, so bring the chat back too.
    return subscribeProjectComposerPrefill(project.id, () => {
      const queued = takeProjectComposerPrefill(project.id);
      if (!queued) return;
      setComposerDraftSignal(queued);
      setWorkspaceFocused(false);
    });
  }, [project.id]);
  // Mirrors share, but opens the workspace's Download/Export menu (PDF / image /
  // zip / standalone HTML / save-as-template) instead of a bare file download.
  /*
   * `format` **只有产物卡的格式浮层会传**:多格式产物在卡上就把格式选完了,
   * 不该把人送进预览区的菜单再选第二遍(产品 2026-08-27「导出浮层贴着按钮开」)。
   * 不带 `format` 的调用(「下一步引导」那行〔下载〕)沿用原语义:打开文件、
   * 展开导出菜单。
   */
  const handleArtifactDownload = useCallback(
    (fileName: string, anchorId?: string) => {
      requestConversationOpenFile(fileName);
      setDownloadRequest({ name: fileName, nonce: Date.now(), ...(anchorId ? { anchorId } : {}) });
    },
    [requestConversationOpenFile],
  );
  const chatResizeLabel = t('project.resizeChatPanel');
  const workspacePanelTrack = workspacePanelTrackForMinWidth(workspacePanelMinWidth);
  // The comment panel floats over the workspace now, so opening it must not
  // touch the split at all: the chat column keeps the width the user set.
  // (It used to take over this column at COMMENT_INSPECTOR_PANEL_WIDTH.)
  const splitLeftPanelWidth = chatPanelWidthRef.current;
  const chatPanelAriaMinWidth = Math.min(MIN_CHAT_PANEL_WIDTH, chatPanelMaxWidth);
  const projectActionsToastInChatPane =
    projectActionsToast?.scope === 'chat-pane' &&
    !workspaceFocused &&
    Boolean(activeConversationId || conversationLoadError);
  const projectActionsToastNode = projectActionsToast ? (
    <Toast
      portalToBody={!projectActionsToastInChatPane}
      message={projectActionsToast.message}
      details={projectActionsToast.details}
      code={projectActionsToast.code}
      tone={projectActionsToast.tone}
      ttlMs={projectActionsToast.ttlMs}
      onDismiss={() => setProjectActionsToast(null)}
    />
  ) : null;

  const renderPreferredChatPanelWidth = useCallback((
    preferredWidth: number,
    maxWidth = chatPanelMaxWidthRef.current,
    options: { commitState?: boolean; animate?: boolean } = {},
  ): number => {
    const next = clampChatPanelWidth(preferredWidth, maxWidth);
    chatPanelWidthRef.current = next;
    applySplitChatPanelWidth(
      splitRef.current,
      next,
      workspacePanelTrack,
      workspaceFocusedRef.current,
      { animate: options.animate },
    );
    if (options.commitState !== false) setChatPanelWidth(next);
    return next;
  }, [workspacePanelTrack]);
  // Deliberately excludes `workspaceFocused`: the ResizeObserver effect below
  // is keyed on this callback's identity, and recreating the observer on
  // every focus toggle forced a synchronous `clientWidth` reflow + style
  // rewrite in the same commit as the collapse/expand — a second, more
  // subtle jitter source layered on top of the grid hard-cut this file's
  // change fixes. `workspaceFocusedRef` (kept fresh during render) gives the callback
  // body the current value without making it a dependency.

  const applyChatPanelWidth = useCallback((
    width: number,
    options: { commitState?: boolean } = {},
  ): number => {
    const nextPreferred = clampPreferredChatPanelWidth(
      clampChatPanelWidth(width, chatPanelMaxWidthRef.current),
    );
    preferredChatPanelWidthRef.current = nextPreferred;
    return renderPreferredChatPanelWidth(nextPreferred, chatPanelMaxWidthRef.current, options);
  }, [renderPreferredChatPanelWidth]);

  const finishChatPanelResize = useCallback((saveFinalWidth = true) => {
    const resized = resizeStateRef.current?.hasMoved === true;
    pointerCleanupRef.current?.();
    pointerCleanupRef.current = null;
    if (pointerFrameRef.current !== null) {
      cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
    }
    pendingPointerClientXRef.current = null;
    resizeStateRef.current = null;
    setResizingChatPanel(false);
    if (saveFinalWidth && resized) {
      const finalWidth = renderPreferredChatPanelWidth(preferredChatPanelWidthRef.current);
      chatPanelWidthCustomizedRef.current = true;
      saveChatPanelWidth(finalWidth);
    }
  }, [renderPreferredChatPanelWidth]);

  // `chatPanelWidthRef` and the `--project-chat-panel-width` DOM write are
  // already kept in sync by `renderPreferredChatPanelWidth` (which sets the
  // ref and calls `applySplitChatPanelWidth` in the same statement, right
  // before `setChatPanelWidth`). A mirroring effect keyed on `chatPanelWidth`
  // would just replay that identical write a tick later — dropped as
  // redundant. `projectSplitStyle` (the JSX `style` prop below) is the only
  // other writer, and it already re-renders whenever `chatPanelWidth` changes.

  useEffect(() => {
    chatPanelMaxWidthRef.current = chatPanelMaxWidth;
  }, [chatPanelMaxWidth]);

  useLayoutEffect(() => {
    const split = splitRef.current;
    if (!split) return undefined;

    const updateAllowedWidth = (options: { animate?: boolean } = {}) => {
      // Same resolver as the creation frame that may have preceded this view
      // (OPEND-3207): a saved width, else the equal split of the container.
      const layout = resolveProjectSplitLayout(split.clientWidth, {
        width: preferredChatPanelWidthRef.current,
        customized: chatPanelWidthCustomizedRef.current,
      });
      chatPanelMaxWidthRef.current = layout.chatPanelMaxWidth;
      setWorkspacePanelMinWidth(layout.workspacePanelMinWidth);
      setChatPanelMaxWidth(layout.chatPanelMaxWidth);
      renderPreferredChatPanelWidth(layout.chatPanelWidth, layout.chatPanelMaxWidth, options);
    };

    // The first write settles the column without the `.split` transition:
    // the `clientWidth` read above has already forced a style pass with the
    // provisional inline width, so an animated write here would be seen
    // sliding from that value on every mount.
    updateAllowedWidth({ animate: false });

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateAllowedWidth());
      observer.observe(split);
      return () => observer.disconnect();
    }

    const onWindowResize = () => updateAllowedWidth();
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [renderPreferredChatPanelWidth]);

  useEffect(() => () => finishChatPanelResize(false), [finishChatPanelResize]);

  // The chat slot stays in grid flow even after the collapse finishes. Using
  // the native `hidden` attribute here removes the first grid item with
  // `display: none`, which shifts FileWorkspace into the zero-width handle
  // track and leaves the full-width workspace track empty. The settled class
  // below only hides the collapsed chat visually, preserving all three grid
  // item positions. Expanding removes it immediately so the content is
  // visible while the chat column grows back in.
  useEffect(() => {
    if (!workspaceFocused) {
      setChatSlotHidden(false);
      return undefined;
    }
    const split = splitRef.current;
    if (!split) {
      setChatSlotHidden(true);
      return undefined;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      setChatSlotHidden(true);
    };
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== split) return;
      if (
        event.propertyName !== '--project-chat-panel-width'
        && event.propertyName !== '--project-chat-handle-width'
      ) {
        return;
      }
      finish();
    };
    split.addEventListener('transitionend', handleTransitionEnd);
    // Collapse is 140ms (shell.css `.split.split-focus`); the margin above
    // that covers `prefers-reduced-motion` (duration collapses to ~0 globally,
    // which some engines never fire a `transitionend` for) and any
    // already-collapsed-width edge case where the property never changes.
    const fallback = window.setTimeout(finish, 220);
    return () => {
      split.removeEventListener('transitionend', handleTransitionEnd);
      window.clearTimeout(fallback);
    };
  }, [workspaceFocused]);

  const handleChatResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const split = splitRef.current;
    if (!split) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerCleanupRef.current?.();
    setResizingChatPanel(true);
    resizeStartPreferredWidthRef.current = preferredChatPanelWidthRef.current;

    const updateWidthFromClientX = (clientX: number) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const delta = clientX - state.startClientX;
      if (delta === 0 && !state.hasMoved) return;
      state.hasMoved = true;
      const rawWidth = state.startWidth + (state.isRtl ? -delta : delta);
      applyChatPanelWidth(rawWidth, { commitState: false });
    };

    const flushPendingPointerMove = () => {
      if (pointerFrameRef.current !== null) {
        cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      const clientX = pendingPointerClientXRef.current;
      pendingPointerClientXRef.current = null;
      if (clientX !== null) updateWidthFromClientX(clientX);
    };

    resizeStateRef.current = {
      startClientX: event.clientX,
      startWidth: chatPanelWidthRef.current,
      isRtl: window.getComputedStyle(split).direction === 'rtl',
      hasMoved: false,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      pendingPointerClientXRef.current = moveEvent.clientX;
      if (pointerFrameRef.current !== null) return;
      pointerFrameRef.current = requestAnimationFrame(() => {
        pointerFrameRef.current = null;
        flushPendingPointerMove();
      });
    };
    const handlePointerEnd = () => {
      flushPendingPointerMove();
      finishChatPanelResize(true);
    };
    const handlePointerCancel = () => {
      flushPendingPointerMove();
      preferredChatPanelWidthRef.current = resizeStartPreferredWidthRef.current;
      renderPreferredChatPanelWidth(resizeStartPreferredWidthRef.current);
      finishChatPanelResize(false);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handlePointerCancel);
    };

    pointerCleanupRef.current = cleanup;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handlePointerCancel);
  }, [applyChatPanelWidth, finishChatPanelResize, renderPreferredChatPanelWidth]);

  const handleChatResizeBlur = useCallback(() => {
    if (!pointerCleanupRef.current) return;
    preferredChatPanelWidthRef.current = resizeStartPreferredWidthRef.current;
    renderPreferredChatPanelWidth(resizeStartPreferredWidthRef.current);
    finishChatPanelResize(false);
  }, [finishChatPanelResize, renderPreferredChatPanelWidth]);

  const handleChatResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | null = null;
    const split = splitRef.current;
    const isRtl = split ? window.getComputedStyle(split).direction === 'rtl' : false;
    if (event.key === 'ArrowLeft') {
      nextWidth = chatPanelWidthRef.current + (isRtl ? 1 : -1) * CHAT_PANEL_KEYBOARD_STEP;
    } else if (event.key === 'ArrowRight') {
      nextWidth = chatPanelWidthRef.current + (isRtl ? -1 : 1) * CHAT_PANEL_KEYBOARD_STEP;
    } else if (event.key === 'Home') {
      nextWidth = MIN_CHAT_PANEL_WIDTH;
    } else if (event.key === 'End') {
      nextWidth = chatPanelMaxWidthRef.current;
    }
    if (nextWidth === null) return;
    event.preventDefault();
    const next = applyChatPanelWidth(nextWidth);
    chatPanelWidthCustomizedRef.current = true;
    saveChatPanelWidth(next);
  }, [applyChatPanelWidth]);

  // Hand the pending prompt to ChatPane exactly once per project. The local
  // project-scoped snapshot survives the conversation-id remount, while the
  // persisted pendingPrompt is cleared so refreshes and later entries do not
  // re-seed the composer.
  //
  // PluginLoopHome auto-send case: when the project was created with
  // `autoSendFirstMessage`, app.tsx left a sessionStorage flag telling us
  // to fire the prompt as a real user message immediately. We must NOT
  // seed initialDraft in that case — otherwise the textarea echoes the
  // prompt while it is also streaming as the first user message. The ref
  // captures the prompt independently so downstream effects can still
  // dispatch the auto-send without going through initialDraft.
  const autoSendSeedRef = useRef<string | null>(null);
  const autoSendAttachmentsRef = useRef<ChatAttachment[] | null>(null);
  const autoSendContextRef = useRef<RunContextSelection | null>(null);
  const autoSendFirstMessageRef = useRef(false);

  if (autoSendSeedRef.current === null) {
    let isAutoSend = false;

    try {
      // A Home send mounts this view before App has written the auto-send
      // keys (they follow the create and the uploads, OPEND-3334). Its prompt
      // is the first message, never a composer draft; the dispatch below
      // still waits for the flag and re-reads the session values live.
      isAutoSend = creationHandoff !== null || Boolean(
        window.sessionStorage.getItem(autoSendFirstMessageKey(project.id)),
      );

    } catch {
      /* sessionStorage may be unavailable; treat as manual flow. */
    }
    autoSendFirstMessageRef.current = isAutoSend;

    autoSendSeedRef.current = isAutoSend
      ? (readAutoSendPrompt(project.id) ?? creationHandoff?.prompt ?? project.pendingPrompt ?? '')
      : '';
    autoSendAttachmentsRef.current = isAutoSend ? readAutoSendAttachments(project.id) : [];
    autoSendContextRef.current = isAutoSend ? readAutoSendContext(project.id) : null;
  }
  /**
   * The Home batch that is still going up for this project.
   *
   * This is what un-blocks the first paint. The server paths the auto-send
   * needs are written only after the last upload answers, and reading them at
   * mount is what used to keep the whole project frame behind the uploads.
   * They are needed by the SEND, not by the paint: the frame opens now, draws
   * these cards from the local bytes the picker already handed us, and the
   * auto-send below waits for this list to empty out before it reads the real
   * paths — see `readAutoSendAttachments` at the dispatch site.
   */
  const homeAttachmentUploads = useSyncExternalStore(
    subscribeHomeAttachmentUploads,
    () => homeAttachmentUploadsFor(project.id),
    () => homeAttachmentUploadsFor(project.id),
  );
  const initialWorkspaceContexts = autoSendContextRef.current?.workspaceItems ?? [];
  const [initialDraft, setInitialDraft] = useState<
    { projectId: string; value: string } | undefined
  >(
    autoSendSeedRef.current || !project.pendingPrompt
      ? undefined
      : { projectId: project.id, value: project.pendingPrompt },
  );
  useEffect(() => {
    // Clearing it is a write to the project row, which does not exist yet.
    if (projectReadsHeld) return;
    const pendingPrompt = project.pendingPrompt;
    if (!pendingPrompt) return;
    if (autoSendFirstMessageRef.current) {
      autoSendSeedRef.current = pendingPrompt;
      onClearPendingPrompt();
      return;
    }
    setInitialDraft((current) =>
      current?.projectId === project.id
        ? current
        : { projectId: project.id, value: pendingPrompt },
    );
    onClearPendingPrompt();
  }, [project.id, project.pendingPrompt, projectReadsHeld, onClearPendingPrompt]);
  const chatInitialDraft =
    chatSeed?.value ??
    (
      (initialDraft?.projectId === project.id ? initialDraft.value : undefined)
    );
  const [projectDuplicateStarting, setProjectDuplicateStarting] = useState(false);

  const handleDuplicateProject = useCallback(() => {
    if (projectDuplicateStarting || !onDuplicateProject) return;
    setProjectDuplicateStarting(true);
    void Promise.resolve(onDuplicateProject(currentProject.id, {}))
      .catch((err) => {
        setProjectActionsToast({
          message: err instanceof Error ? err.message : String(err),
          details: null,
          tone: 'error',
        });
      })
      .finally(() => {
        setProjectDuplicateStarting(false);
      });
  }, [currentProject.id, onDuplicateProject, projectDuplicateStarting]);

  const handleContinueInCli = useCallback(async () => {
    const projectDir = projectDetail.resolvedDir;
    if (!projectDir) {
      setProjectActionsToast({
        message: 'Working directory unavailable. Update the daemon to enable Continue in CLI.',
        details: null,
      });
      return;
    }
    const prompt = buildClipboardPrompt({
      project: { id: project.id, name: project.name },
      designMdState: {
        designSystemId: designMdState.designSystemId,
        generatedAt: designMdState.generatedAt,
        transcriptMessageCount: designMdState.transcriptMessageCount,
        currentArtifact: designMdState.currentArtifact,
      },
      projectDir,
    });
    const copied = await copyToClipboard(prompt);
    if (!copied) {
      // Clipboard write failed in both the canonical and execCommand
      // fallback paths (locked clipboard / insecure context). Surface
      // the prompt body in the toast so the user can manually
      // select-and-copy. Do not open the folder — the user has nothing
      // to paste yet.
      setProjectActionsToast({
        message: 'Clipboard unavailable. Copy this prompt manually, then run `claude` at the working directory.',
        details: `Working directory: ${projectDir}`,
        code: prompt,
      });
      return;
    }
    const launched = await terminalLauncher.open(project.id);
    setProjectActionsToast(buildContinueInCliToast(projectDir, launched));
  }, [project.id, project.name, projectDetail.resolvedDir, designMdState.generatedAt, designMdState.transcriptMessageCount, designMdState.designSystemId, designMdState.currentArtifact, terminalLauncher]);

  // Defensive: if the conversation already has messages once they
  // hydrate, the pendingPrompt that seeded the composer is stale (the
  // user sent it earlier but onClearPendingPrompt did not get a chance
  // to patch the server before the page reloaded). Drop the seed so the
  // textarea does not echo a prompt the user already submitted.
  useEffect(() => {
    if (initialDraft && messages.length > 0) {
      setInitialDraft(undefined);
    }
  }, [initialDraft, messages.length]);

  // §8.4 — when the project was created with a plugin pinned (the
  // PluginLoopHome → POST /api/projects path), fetch the immutable
  // snapshot once so ChatPane can render the active plugin as a
  // context chip on user messages instead of re-rendering the inline
  // plugin rail. Re-fetches when the pinned id changes; cancelled if
  // the project switches away mid-flight to avoid setState-on-unmount.
  const [activePluginSnapshot, setActivePluginSnapshot] =
    useState<AppliedPluginSnapshot | null>(null);
  const [contextPluginDetails, setContextPluginDetails] =
    useState<InstalledPluginRecord | null>(null);
  useEffect(() => {
    const snapshotId = project.appliedPluginSnapshotId;
    if (!snapshotId) {
      setActivePluginSnapshot(null);
      return;
    }
    let cancelled = false;
    void fetchAppliedPluginSnapshot(snapshotId).then((snap) => {
      if (cancelled) return;
      setActivePluginSnapshot(snap);
    });
    return () => {
      cancelled = true;
    };
  }, [project.appliedPluginSnapshotId]);
  const handleOpenContextPluginDetails = useCallback(async (pluginId: string) => {
    const normalizedId = pluginId.trim();
    if (!normalizedId) return;
    const plugins = await listPlugins({ includeHidden: true });
    const record = plugins.find((plugin) => plugin.id === normalizedId);
    if (record) setContextPluginDetails(record);
  }, []);
  const handleDuplicateContextPlugin = useCallback(async (record: InstalledPluginRecord) => {
    try {
      const result = await duplicatePluginAsProject(record.id, {
        name: localizePluginTitle(locale, record),
      });
      setContextPluginDetails(null);
      navigate({
        kind: 'project',
        projectId: result.projectId,
        conversationId: result.conversationId,
        fileName: result.relPath,
      });
    } catch {
      setProjectActionsToast({
        message: t('pluginCard.duplicateFailed'),
        details: null,
        tone: 'error',
        ttlMs: 3000,
      });
    }
  }, [locale, t]);
  const latestApprovalRun = messages.slice().reverse().find((message) => message.role === 'assistant' && message.runId);
  const approvalRunId = latestApprovalRun && (latestApprovalRun.agentId === 'codex' || latestApprovalRun.agentId === 'claude')
    ? latestApprovalRun.runId : null;

  // ⌘+Shift+K (mac) / Ctrl+Shift+K (others) → Continue in CLI. Mirrors
  // the capture-phase, platform-gated pattern from FileWorkspace's
  // Quick Switcher shortcut. ⌘+Shift+K is free (⌘+P is the only
  // existing primary-modifier shortcut on this surface).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const primary = isMacPlatform() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (primary && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        if (e.isComposing) return;
        if (!designMdState.exists) return;
        e.preventDefault();
        void handleContinueInCli();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [designMdState.exists, handleContinueInCli]);

  // The optimistic first turn of a Home send belongs to this view, not to
  // App's creation record (OPEND-3334). It is captured at mount and retired
  // only when the column no longer needs it: the real turn owns the rows, the
  // auto-send was turned down, or nothing is going to be sent. App's record
  // has its own cleanup deadline; tying the turn to it made the turn vanish
  // whenever the Home uploads outlived that deadline, and come back when
  // they finished.
  const [optimisticFirstTurn, setOptimisticFirstTurn] = useState<{
    prompt: string;
    files?: readonly File[];
  } | null>(() => (creationHandoff
    ? { prompt: creationHandoff.prompt, files: creationHandoff.files }
    : null));
  // The seed conversation's id, minted with the project. Kept for the life of
  // the view: the pane is keyed by it from the first frame, so the
  // conversation list answering (or the record being released) never re-keys
  // it.
  const [seedConversationId] = useState(() => creationHandoff?.conversationId ?? null);
  // Until the auto-sent turn is on screen the transcript is empty, but the
  // turn's first frame is already known: ChatPane draws it from these two
  // optimistic messages with its own components, so the real turn takes over
  // the same rows (OPEND-3334). Any real message wins at once.
  const creationHandoffMessageIds = useMemo(() => {
    const identity = homeAutoSendIdentity(project.id);
    return { user: identity.userMessageId!, assistant: identity.assistantMessageId! };
  }, [project.id]);
  const creationHandoffMessages = useCreationHandoffMessages(
    optimisticFirstTurn,
    selectedAssistantIdentity,
    creationHandoffMessageIds,
  );
  const creationHandoffTurnShown = optimisticFirstTurn !== null && messages.length === 0;
  const chatPaneConversationKey =
    activeConversationId
    ?? seedConversationId
    ?? 'conversation-unavailable';
  // A project born from the Home send starts with no files, and the pending
  // frame already drew the empty state. Keep drawing it (inert) until the
  // first listing is accepted instead of flipping to "Loading…" in between;
  // the authority gate itself is untouched, so no CTA acts before that read
  // (Home attachments are still uploading then). An imported working folder
  // may hold files, so it keeps the honest loading state.
  const [emptyLookBeforeFirstListing] = useState(
    () => creationHandoff !== null && !project.metadata?.baseDir,
  );
  const ignoreStopBeforeFirstRun = useCallback(() => undefined, []);
  // OPEND-2170: the first turn is settled once the column has something real
  // to show — the auto-sent turn painted, a loaded transcript with nothing to
  // send, or a load that failed (the error surface is the real thing then).
  // Then the optimistic turn retires and App may release its record.
  const creationHandoffSettledRef = useRef(false);
  useEffect(() => {
    if (optimisticFirstTurn === null || creationHandoffSettledRef.current) return;
    const transcriptLoaded =
      Boolean(activeConversationId)
      && messagesConversationId === activeConversationId
      && messagesInitialized;
    const transcriptFailed =
      Boolean(conversationLoadError)
      || (Boolean(activeConversationId) && failedMessagesConversationId === activeConversationId);
    const firstTurnPainted = messages.length > 0;
    const nothingToSend =
      !autoSendFirstMessageRef.current
      || (
        !(autoSendSeedRef.current ?? '').trim()
        && (autoSendAttachmentsRef.current?.length ?? 0) === 0
        && homeAttachmentUploads.length === 0
      );
    if (!(transcriptFailed || (transcriptLoaded && (firstTurnPainted || nothingToSend)))) return;
    creationHandoffSettledRef.current = true;
    setOptimisticFirstTurn(null);
    onCreationHandoffSettled?.(project.id);
  }, [activeConversationId, conversationLoadError, failedMessagesConversationId, homeAttachmentUploads.length, messages.length, messagesConversationId, messagesInitialized, onCreationHandoffSettled, optimisticFirstTurn, project.id, false]);
  // App released its record without the first turn settling here. The turn
  // still stands while the Home uploads are going up (the send follows them)
  // or while the auto-send keys are written (the send is coming). With
  // neither, nothing will be sent — e.g. the working-directory hand-off
  // failed after the create — and the turn must not stand as "Working".
  useEffect(() => {
    if (optimisticFirstTurn === null || creationHandoff !== null) return;
    if (homeAttachmentUploads.length > 0) return;
    let sendPending = false;
    try {
      sendPending = Boolean(window.sessionStorage.getItem(autoSendFirstMessageKey(project.id)));
    } catch {
      sendPending = false;
    }
    if (sendPending) return;
    setOptimisticFirstTurn(null);
  }, [creationHandoff, homeAttachmentUploads.length, optimisticFirstTurn, project.id]);

  // PluginLoopHome auto-send: when the user submits on Home, app.tsx
  // sets `sessionStorage['pixo:auto-send-first:<projectId>']` and routes
  // through createProject. Once the conversation id resolves and the
  // composer is mounted, fire handleSend(pendingPrompt) exactly once so
  // the user lands inside a running pipeline without an extra click.
  // We gate on `messages.length === 0` so a refresh after the run is
  // mid-flight never double-fires; the sessionStorage flag is cleared
  // immediately after the first dispatch.
  const autoSentRef = useRef(false);
  const autoSendInFlightRef = useRef(false);
  // A new game that reached this view without its setup (a plugin start, an
  // empty folder) gets it now. Its first message waits so planning starts from the answers.
  const [setupGateClosedFor, setSetupGateClosedFor] = useState<string | null>(null);
  const setupGatePending = setupGateClosedFor !== project.id && !setupGateClosed(project.id) && newGameNeedsSetup(project.metadata);
  const finishSetupGate = useCallback(() => {
    closeSetupGate(project.id);
    setSetupGateClosedFor(project.id);
  }, [project.id]);
  useEffect(() => {
    if (autoSentRef.current) return;
    if (autoSendInFlightRef.current) return;
    if (setupGatePending) return;
    if (!activeConversationId) return;
    // `messagesInitialized` is React state, while the conversation ownership
    // guard used by handleSend is a ref. Require both to agree before consuming
    // the one-shot handoff: during a project/context transition there can be a
    // render where the state is ready but the ref has already been invalidated
    // for a fresh scoped reload.
    if (messagesConversationIdRef.current !== activeConversationId) return;

    // Wait for the initial listMessages DB read to land. Without this gate
    // the auto-send fires before the in-flight DB response, which then
    // arrives with `setMessages([])` and wipes the freshly-pushed user +
    // assistant placeholder out of React state — leaving the daemon's run
    // with no in-memory message to attach the runId to.
    if (!messagesInitialized) return;
    if (streaming) return;
    if (messages.length > 0) return;
    // The picked files are still going up. Sending now would ship the prompt
    // with whichever attachments happened to have landed — which, at the
    // moment this frame opens, is none of them. This effect re-runs when the
    // batch drains (`homeAttachmentUploads` is a dependency), so waiting here
    // costs the send exactly the upload time it always cost, and costs the
    // first paint nothing.
    if (homeAttachmentUploads.length > 0) return;
    let flag: string | null = null;
    try {
      flag = window.sessionStorage.getItem(autoSendFirstMessageKey(project.id));
    } catch {
      flag = null;
    }
    if (!flag) return;
    // Prefer the seed captured at mount (autoSendSeedRef) — it survives
    // even after onClearPendingPrompt wipes project.pendingPrompt on the
    // server. Fall back to the live values for any edge case where the
    // ref was not populated (e.g. sessionStorage error path).
    const seed = (
      autoSendSeedRef.current ||
      (initialDraft?.projectId === project.id ? initialDraft.value : '') ||
      project.pendingPrompt ||
      ''
    ).trim();
    // Read the server paths HERE, not at mount. The mount snapshot is taken
    // while the batch may still be uploading, so it can legitimately be empty
    // for a project that does have attachments; the session values are only
    // cleared once a send is accepted, so a fresh read is the newer of the two
    // whenever it has anything, and the snapshot still covers the case where
    // sessionStorage stopped answering after mount.
    const freshAttachments = readAutoSendAttachments(project.id);
    const attachments = freshAttachments.length > 0
      ? freshAttachments
      : autoSendAttachmentsRef.current ?? [];
    const context = autoSendContextRef.current ?? readAutoSendContext(project.id);
    if (!seed && attachments.length === 0) {
      return;
    }
    // A view mounted from the click read no witness (App writes it after the
    // create); read it now so Home's gate decision is still reused.


    autoSendInFlightRef.current = true;
    void handleSend(seed, attachments, {
        ...(context ? { context } : {}),
        ...homeAutoSendIdentity(project.id),
        acceptDurableQueue: true,
        // Only reuse Home's decision for the exact persisted project scope.
        // A workspace/member mismatch falls through to handleSend's normal gate.

      })
      .then((accepted) => {
        if (!accepted) {
          // The turn was turned down (a preflight block, a scope transition):
          // the optimistic turn must not keep claiming it is running. A later
          // retry paints the real turn itself.
          setOptimisticFirstTurn(null);
          // The handoff was not accepted (for example a transient project
          // scope/conversation transition or a recoverable preflight block).
          // Keep every session value intact; a later dependency change can
          // retry the exact same prompt and attachments.
          autoSendInFlightRef.current = false;
          return;
        }
        autoSentRef.current = true;
{}

        clearAutoSendSession(project.id);
        autoSendAttachmentsRef.current = [];
        autoSendInFlightRef.current = false;
      })
      .catch(() => {
        setOptimisticFirstTurn(null);
        // `handleSend` normally reports a rejected preflight as `false`, but
        // transport/provider setup may still throw. Preserve the handoff for a
        // later retry instead of silently consuming the user's first prompt.
        autoSendInFlightRef.current = false;
      });
  }, [activeConversationId, homeAttachmentUploads, messagesInitialized, streaming, messages.length, project.id, false, project.metadata, initialDraft, project.pendingPrompt, true, null, null, handleSend, setupGatePending]);

  /*
   * Slash commands the composer runs itself. `/undo` is listed only when the
   * last reply left a checkpoint with changes, the game actions only where the
   * panel can run them; a command that cannot run now is not offered.
   */
  const [gameRequest, setGameRequest] = useState<{
    projectId: string; kind: 'run-game' | 'verify' | 'playtest'; nonce: number;
  } | null>(null);
  const [undoCheckpoint, setUndoCheckpoint] = useState<ProjectCheckpoint | null>(null);
  const { data: checkpointList } = useProjectCheckpoints(project.id, !projectReadsHeld, { poll: false, refreshKey: activeConversationId });
  const lastTurnCheckpoint = useMemo(() => {
    if (checkpointList?.status !== 'available') return null;
    const runId = lastTurnFirstRunId(messages);
    const checkpoint = runId ? checkpointList.checkpoints.find((item) => item.kind === 'run' && item.runId === runId) : undefined;
    return checkpoint && checkpoint.runChanges?.length !== 0 ? checkpoint : null;
  }, [checkpointList, messages]);
  const requestGameAction = useCallback((kind: 'run-game' | 'verify' | 'playtest') => {
    revealPanel();
    setGameRequest((previous) => ({ projectId: project.id, kind, nonce: (previous?.nonce ?? 0) + 1 }));
  }, [project.id, revealPanel]);
  const composerSlashActions = useMemo<ComposerSlashAction[]>(() => {
    if (projectReadsHeld) return [];
    const actions: ComposerSlashAction[] = [];
    if (!newConversationDisabled) {
      actions.push({ id: 'new', label: '/new', descKey: 'composer.slashNew', icon: 'plus', run: () => { void handleNewConversation(); } });
    }
    actions.push({ id: 'model', label: '/model', descKey: 'composer.slashModel', icon: 'sliders', run: () => setModelPickerOpenSignal((n) => n + 1) });
    if (lastTurnCheckpoint && !streaming) {
      actions.push({ id: 'undo', label: '/undo', descKey: 'composer.slashUndo', icon: 'reload', run: () => setUndoCheckpoint(lastTurnCheckpoint) });
    }
    actions.push(
      { id: 'run', label: '/run', descKey: 'composer.slashRun', icon: 'play', run: () => requestGameAction('run-game') },
      { id: 'verify', label: '/verify', descKey: 'composer.slashVerify', icon: 'check', run: () => requestGameAction('verify') },
      { id: 'playtest', label: '/playtest', descKey: 'composer.slashPlaytest', icon: 'eye', run: () => requestGameAction('playtest') },
    );
    return actions;
  }, [projectReadsHeld, newConversationDisabled, handleNewConversation, lastTurnCheckpoint, streaming, requestGameAction]);

  // CLI / agent selector lives below the chat conversation (composer footer),
  // not in the top-right header.
  const executionControls = (
    <>
      <InlineModelSwitcher
        config={config}
        agents={agents}
        daemonLive={daemonLive}
        onModeChange={onModeChange}
        onOpen={() => {
          trackComposerBarClick(analytics.track, {
            page_name: 'chat_panel',
            area: 'chat_composer',
            element: 'agent_selector_open',
            ...(project?.id ? { project_id: project.id } : {}),
          });
        }}
        onAgentChange={(id) => {
          setConversationAgentChoices(choices => ({ ...choices, [conversationAgentKey]: id }));
          trackComposerBarClick(analytics.track, {
            page_name: 'chat_panel',
            area: 'chat_composer',
            element: 'agent_select',
            agent_id: id,
            ...(project?.id ? { project_id: project.id } : {}),
          });
          if (pendingConversationAgentId) onAgentSelectionConsumed?.();
          onAgentChange(id);
        }}
        onAgentModelChange={(agentId, choice) => {
          trackComposerBarClick(analytics.track, {
            page_name: 'chat_panel',
            area: 'chat_composer',
            element: 'agent_model_select',
            agent_id: agentId,
            ...(choice?.model ? { model_id: choice.model } : {}),
            ...(project?.id ? { project_id: project.id } : {}),
          });
          onAgentModelChange(agentId, choice);
          /*
           * 「选完自动重跑」的那一半。只有确实是从报错卡那颗〔更换模型〕进来的
           * 才会有待重跑的那一轮 —— 平时手动换模型不该无端重发。
           */
          const pending = rerunAfterModelChangeRef.current;
          if (pending) setPendingModelSwitchRetry({
            ...pending, selection: { mode: 'daemon', agentId, choice: { ...choice } },
          });
        }}
        onApiModelChange={(model) => {
          trackComposerBarClick(analytics.track, {
            page_name: 'chat_panel',
            area: 'chat_composer',
            element: 'agent_model_select',
            model_id: model,
            ...(project?.id ? { project_id: project.id } : {}),
          });
          onApiModelChange?.(model);
          const pending = rerunAfterModelChangeRef.current;
          if (pending) setPendingModelSwitchRetry({
            ...pending, selection: { mode: 'api', model },
          });
        }}
        onOpenSettings={onOpenSettings}
        openSignal={modelPickerOpenSignal}
        placement="up"

      />
      {/* The image model is picked apart from the agent; the same global pref as Settings. */}
      <AgentImageModelChip />
    </>
  );

  // The `.app` shell belongs to the caller, not to this component: App.tsx
  // owns the `div.app` around every project-route surface, so switching
  // between them never replays the `.app` entrance animation.
  return (
    <ProjectPreviewProvider value={previewContextValue}>

      {/* ProjectActionsToolbar removed per 00efdcba — hide finalize-design
          toolbar from project header. Restore from cf1cd9bb if product
          wants the Finalize + Continue-in-CLI buttons back in the chrome. */}
      <div
        ref={splitRef}
        className={[
          projectSplitClassName(workspaceFocused),
          panelHidden && !workspaceFocused ? 'split-panel-hidden' : '',
          resizingChatPanel && !workspaceFocused ? 'is-resizing-chat' : '',
        ].filter(Boolean).join(' ')}
        style={projectSplitStyle(workspaceFocused, splitLeftPanelWidth, workspacePanelTrack)}
        // A Home send's creation phase, for tests and diagnostics: `pending`
        // while the project row does not exist yet (reads held), `persisted`
        // until the first transcript settles, absent otherwise.
        data-creation-phase={
          creationHandoff ? (creationHandoff.persisted ? 'persisted' : 'pending') : undefined
        }
      >
        <div
          className={[
            'split-chat-slot',
            chatSlotHidden ? 'split-chat-slot-hidden' : '',
          ].filter(Boolean).join(' ')}
          aria-hidden={chatSlotHidden || undefined}
        >
          {/* The conversation header (specs/current/openpixo-ui-cleanup.md
              §3). The workspace tab strip no longer docks here: the sidebar is
              the one project list, and the strip stays mounted in the
              zero-height chrome row for its shortcuts. */}
          {!workspaceFocused ? (
            <ConversationHead
              projectName={currentProject.name}
              sessionTitle={conversations.find((conversation) => conversation.id === activeConversationId)?.title}
              historyRef={setHistoryPortalTarget}
              historyDockClassName={historyDockStyles.dock}
              panelVisible={!panelHidden}
              onTogglePanel={togglePanelHidden}
            />
          ) : null}
          {activeConversationId || conversationLoadError || emptyConversationReadOnlySettled || seedConversationId !== null ? (
            <ChatPane
              historyPortalTarget={historyPortalTarget}
              // The conversation id is part of the key so switching conversations
              // resets internal scroll/draft state inside ChatPane and ChatComposer.
              key={`${project.id}:${chatPaneConversationKey}:${chatSeed?.id ?? 'ready'}`}
              // The optimistic first turn carries the auto-send's ids, so the
              // real rows take over these rows in place (OPEND-3334).
              messages={creationHandoffTurnShown ? creationHandoffMessages : messages}
              // The optimistic turn is a running turn: the composer shows the
              // same stop control the auto-sent turn will, so it does not swap
              // at the hand-off. There is no run to stop yet.
              streaming={currentConversationControlStreaming || creationHandoffTurnShown}
              // The optimistic turn is the column's content while the first
              // transcript loads; a skeleton under it would be a second
              // loading form (OPEND-2170).
              loading={currentConversationLoading && !creationHandoffTurnShown}
              // A read-only viewer of a team-shared project cannot drive artifact
              // changes through chat (comments go through the separate overlay).
              // Home's own prompt has not gone out yet — it is waiting for this
              // same batch. Letting a second prompt overtake it would consume
              // the turn the Home prompt was going to use, and go out without
              // the attachments the user picked for it. Typing stays open;
              // only the send waits, and it waits exactly as long as the
              // uploads do.
              // Home's own prompt has not gone out yet — it is waiting for this
              // same batch. Letting a second prompt overtake it would consume
              // the turn the Home prompt was going to use, and go out without
              // the attachments the user picked for it. Typing stays open;
              // only the send waits, and it waits exactly as long as the
              // uploads do.
              sendDisabled={
                currentConversationSendDisabled
                || projectReadsHeld
                || homeAttachmentUploads.length > 0
              }
              viewerOnly={projectReadsHeld}
              queuedItems={currentConversationQueuedItems}
              error={conversationLoadError ?? error}
              errorSourceAssistantId={
                conversationLoadError ? null : errorSourceAssistantId
              }
              projectId={project.id}
              sessionMode={activeSessionMode}
              approvalRunId={approvalRunId}
              onSessionModeChange={handleActiveConversationSessionModeChange}
              projectKindForTracking={projectKindFromMetadataToTracking(currentProject.metadata)}
              projectFiles={projectFiles}
              projectFileNames={projectFileNames}
              projectResolvedDir={projectDetail.resolvedDir}
              skills={skills}
              onEnsureProject={handleEnsureProject}
              onSend={handleComposerSend}
              onResendUserMessage={handleResendUserMessage}
              onEditUserMessage={projectReadsHeld ? undefined : handleEditUserMessage}
              onRetry={handleRetry}
              // 这一刻接不接得住恢复动作,以及接不住时该说哪句话(OPEND-2821)。
              recoveryActionsBlockedReason={currentConversationActionBlockReason}
              accessError={currentConversationAccessError}
              supersededErrorAssistantIds={supersededErrorAssistantIds}
              // 哪一轮的重试还在等服务端确认(OPEND-2758)。会话对不上就不算 ——
              // 宣告是按会话认领的,别的会话的卡不该被它钉住。
              retryPendingAssistantId={
                retryPending && retryPending.conversationId === activeConversationId
                  ? retryPending.failedAssistantId
                  : null
              }
              onSwitchModel={handleSwitchModel}


              onResumeRun={handleResumeRun}
              onStop={creationHandoffTurnShown ? ignoreStopBeforeFirstRun : handleStop}
              // 组件 22 · 重连 · S29:掉线时流水的最后一行。按当前会话过一道 ——
              // 后台重挂可能发生在别的会话上,那一行不该串进这一屏。
              reconnect={reconnectViewForConversation(reconnectView, activeConversationId)}
              onManualReconnect={handleManualReconnect}
              onRemoveQueuedSend={discardQueuedChatSend}
              onUpdateQueuedSend={updateQueuedChatSend}
              onReorderQueuedSends={reorderCurrentConversationQueuedChatSends}
              onSendQueuedNow={sendQueuedChatSendNow}
              onRequestOpenFile={requestConversationOpenFile}
              onRequestPluginDetails={handleOpenContextPluginDetails}
              onRequestPluginFolderAgentAction={handlePluginFolderAgentAction}
              activePluginActionPaths={activePluginActionPaths}
              hiddenPluginActionPaths={hiddenAssistantPluginActionPaths}
              forceStreamingMessageIds={forceStreamingPluginMessageIds}
              initialDraft={chatInitialDraft}
              questionFormSubmitDisabled={currentConversationActionDisabled}
              onSubmitQuestionForm={async (text, attachments = [], context, sourceAssistantMessageId, formId) => {
                if (currentConversationActionDisabled) return false;
                let sourceAssistant = sourceAssistantMessageId
                  ? messages.find((message) => message.id === sourceAssistantMessageId)
                  : undefined;
                const questionTaskAnalytics = sourceAssistant
                  ? buildRecoveryTaskAnalytics(
                      messages,
                      sourceAssistant,
                      'question_answer',
                    )
                  : undefined;
                if (sourceAssistant && questionTaskAnalytics) {
                  trackRunRecoveryActionClick(analytics.track, {
                    page_name: 'chat_panel',
                    area: 'chat_panel',
                    element: 'run_recovery_action',
                    task_execution_id: questionTaskAnalytics.taskExecutionId,
                    recovery_action_instance_id:
                      questionTaskAnalytics.recoveryActionInstanceId!,
                    recovery_action_type: 'question_answer',
                    ...(questionTaskAnalytics.sourceRunId
                      ? { source_run_id: questionTaskAnalytics.sourceRunId }
                      : {}),
                    ...(sourceAssistant.agentId
                      ? { source_agent_provider_id: runAgentProviderId(sourceAssistant.agentId) }
                      : {}),
                  });
                }
                return handleSend(text, attachments, {
                  entryFrom: 'question_answer',
                  ...questionFormAnswerIdentity(sourceAssistantMessageId, formId),
                  // The form owns the only copy of this answer (and of any
                  // file it uploaded). A send that parks in the conversation
                  // queue is durably accepted, not refused: reporting it as
                  // refused would unlock the form and roll back the uploads
                  // the queued send still points at, so the user re-answers
                  // and the drain sends the same brief twice.
                  acceptDurableQueue: true,
                  ...(context ? { context } : {}),
                  ...(questionTaskAnalytics
                    ? { taskAnalytics: questionTaskAnalytics }
                    : {}),
                });
              }}
              onContinueRemainingTasks={handleContinueRemainingTasks}
              onAssistantFeedback={handleAssistantFeedback}
              onArtifactDownload={handleArtifactDownload}
              onForkFromMessage={
                projectReadsHeld ? undefined : handleForkFromMessage
              }
              forkingMessageId={forkingMessageId}
              onNewConversation={handleNewConversation}
              composerSlashActions={composerSlashActions}
              newConversationDisabled={newConversationDisabled}
              conversations={conversations}
              activeConversationId={activeConversationId}
              messagesConversationId={messagesConversationId}
              onSelectConversation={handleSelectConversation}
              onDeleteConversation={handleDeleteConversation}
              config={config}
              onOpenSettings={onOpenSettings}


              showByokRecoveryAction={
                config.mode === 'api' &&
                daemonLive &&
                (
                  !config.apiKey.trim() ||
                  !config.baseUrl.trim() ||
                  !config.model.trim()
                )
              }
              onSwitchToLocalCli={() => {
                setError(null);
                onModeChange('daemon');
              }}


              onOpenMcpSettings={onOpenMcpSettings}
              onBrowsePlugins={onBrowsePlugins}
              // The Home batch, drawn from the local bytes while it uploads.
              // Same tray, same cards, same "uploading" treatment the composer
              // already gives files picked from inside the project.
              // The optimistic turn already shows the staged files as the
              // message's attachments; the tray would show them twice.
              homeAttachmentUploads={creationHandoffTurnShown ? undefined : homeAttachmentUploads}
              onDismissHomeAttachmentUpload={(cardId) =>
                dismissHomeAttachmentUpload(project.id, cardId)}
              chatLogTray={
                projectActionsToastInChatPane ? (
                  <div className="project-actions-toast-anchor">
                    {projectActionsToastNode}
                  </div>
                ) : null
              }
              composerDraftSignal={composerDraftSignal}
              researchAvailable={config.mode === 'daemon'}
              byokApiProtocol={config.apiProtocol}
              byokImageModel={byokImageModelOverride}
              onChangeByokImageModel={setByokImageModelOverride}
              byokVideoModel={byokVideoModelOverride}
              onChangeByokVideoModel={setByokVideoModelOverride}
              byokSpeechModel={byokSpeechModelOverride}
              onChangeByokSpeechModel={setByokSpeechModelOverride}
              byokSpeechVoice={byokSpeechVoiceOverride}
              onChangeByokSpeechVoice={setByokSpeechVoiceOverride}
              projectMetadata={currentProject.metadata}
              onProjectMetadataChange={onProjectChange}
              activeWorkspaceContext={activeWorkspaceContext}
              initialWorkspaceContexts={initialWorkspaceContexts}
              workspaceContexts={workspaceContexts}
              currentSkillId={project.skillId}
              onProjectSkillChange={(skillId) => {
                onProjectChange({ ...project, skillId });
              }}
              activePluginSnapshot={activePluginSnapshot}
              onShowToast={(message) => {
                setProjectActionsToast({ message, details: null });
              }}
              onBack={onBack}
              onCollapse={() => setWorkspaceFocused(true)}
              collapseControlLifted={!workspaceFocused}
              backLabel={t('project.backToProjects')}
              composerFooterAccessory={executionControls}
            />
          ) : (
            <div className="pane" data-testid="chat-pane-loading">
              <CenteredLoader />
            </div>
          )}
        </div>
        {/* The comment panel is a floating card over the workspace in EVERY
            state (per product: 任何状态下评论卡片都在这个位置). It used to dock
            inside the chat column, which put it in a different place —  and
            made it invisible in full-screen preview, where that column is
            hidden. Keep the empty host mounted so FileViewer can resolve its
            portal before opening; `:empty` hides all chrome and hit testing
            until the localized comment panel is portaled in. Exactly one
            element ever carries `commentInspectorPortalId`. */}

        {!workspaceFocused && !panelHidden ? (
          <div
            className="split-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label={chatResizeLabel}
            aria-valuemin={chatPanelAriaMinWidth}
            aria-valuemax={chatPanelMaxWidth}
            aria-valuenow={chatPanelWidth}
            tabIndex={0}
            title={chatResizeLabel}
            onPointerDown={handleChatResizePointerDown}
            onKeyDown={handleChatResizeKeyDown}
            onBlur={handleChatResizeBlur}
          />
        ) : null}
        <FileWorkspace
          // Panel header: the engine chip (specs/current/openpixo-game-panel.md §3).
          // Checkpoints live in 改动's toolbar, Verify and Run in the 游戏 view's.
          headerActions={projectReadsHeld ? null : <EngineBadge key={project.id} projectId={project.id}
               onOpenSettings={() => onOpenSettings('gameEngines')} />}
          changesActions={<ProjectCheckpointHistory key={`checkpoints:${project.id}`} projectId={project.id} disabled={projectReadsHeld}
              onRestored={() => { void refreshFileWorkspace({ fresh: true }); }} />}
          gameControls={{
            verifyAvailable: true,
            startRequest: gameRequest?.projectId === project.id
              ? { kind: gameRequest.kind, nonce: gameRequest.nonce } : null,
          }}
          gameViewRequest={gameRequest?.projectId === project.id ? gameRequest.nonce : 0}
          onOpenEngineSettings={() => onOpenSettings('gameEngines')}
          onOpenAccount={() => onOpenSettings('account')}
          projectId={project.id}
          projectName={currentProject.name}
          viewerOnly={projectReadsHeld}
          materializationPending={false}
          filesAuthoritative={committedFilesGeneration > 0}
          emptyLookBeforeFirstListing={emptyLookBeforeFirstListing}
          projectReadsHeld={projectReadsHeld}

          projectKind={projectKindFromMetadataToTrackingOrLegacyDefault(currentProject.metadata)}
          rootDirName={(() => {
            const baseDir = currentProject.metadata?.baseDir;
            return typeof baseDir === 'string'
              ? baseDir.split(/[/\\]/).filter(Boolean).pop()
              : undefined;
          })()}
          reloading={false}
          resolvedDir={projectDetail.resolvedDir}
          files={projectFiles}
          filesRefreshKey={committedFilesRefreshKey}
          filesGeneration={committedFilesGeneration}
          onRefreshFiles={refreshFileWorkspace}
          onManualFileWritten={recordManualFileWrite}
          streaming={currentConversationActionDisabled}
          // The building preview needs a real run, not the disabled-actions
          // state above (which a read-only viewer also has, with nothing
          // running). An attached-but-not-yet-streaming run counts: it is
          // already writing.
          runInFlight={currentConversationStreaming || currentConversationHasActiveRun}
          routeFileName={routeFileName}
          openRequest={openRequest}
          downloadRequest={downloadRequest}
          tabsState={openTabsState}
          onTabsStateChange={persistTabsState}
          onPluginFolderAgentAction={handlePluginFolderAgentAction}
          activePluginActionPaths={activePluginActionPaths}
          focusMode={workspaceFocused}
          onFocusModeChange={setWorkspaceFocused}
          onDuplicateProject={onDuplicateProject ? handleDuplicateProject : undefined}
          duplicateProjectBusy={projectDuplicateStarting}
          fileActionsBefore={null}
          chatConfig={config}
          chatAgentsById={agentsById}
          handoffAgents={agents}
          handoffArtifactId={headerArtifact.artifact_id}
          handoffArtifactKind={headerArtifact.artifact_kind}
          metricsConsent={config.telemetry?.metrics === true}
          installationId={config.installationId}
          chatLocale={locale}
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
          onRenameConversation={handleRenameConversation}
          onConversationSessionModeChange={handleConversationSessionModeChange}
          onNewConversation={handleNewConversation}
          activeConversationChat={activeConversationChatState}

          chatRecoveryActionsBlockedReason={resolveRecoveryActionBlockReason({
            readOnly: Boolean(projectReadsHeld),
            messagesUnavailable: false,

            conversationBusy: false,
          })}
          onActiveContextChange={handleActiveWorkspaceContextChange}
          onWorkspaceContextsChange={handleWorkspaceContextsChange}
          messages={messages}
          artifactHtml={artifact?.html}
          conversationError={error}

          conversationId={activeConversationId}
        />
      </div>
      {contextPluginDetails ? (
        <PluginDetailsModal
          record={contextPluginDetails}

          onClose={() => setContextPluginDetails(null)}
          onUse={() => setContextPluginDetails(null)}
          onDuplicate={(record) => void handleDuplicateContextPlugin(record)}
          isApplying={false}
          hideUseAction
        />
      ) : null}
      <AnimatePresence>
        {projectActionsToast && !projectActionsToastInChatPane ? projectActionsToastNode : null}
      </AnimatePresence>
      {setupGatePending && messagesInitialized && messages.length === 0 ? (
        <GameSetupDialog projectId={project.id} setup={project.metadata?.gameSetup ?? null} projectName={project.name}
          onClose={finishSetupGate} onSaved={() => {}} />
      ) : null}
      <UndoLastTurnDialog projectId={project.id} checkpoint={undoCheckpoint}
        onClose={() => setUndoCheckpoint(null)}
        onRestored={() => { void refreshFileWorkspace({ fresh: true }); }} />
    </ProjectPreviewProvider>
  );
}

export function selectPrimaryProjectFile(
  files: ProjectFile[],
  excludedFileNames: ReadonlySet<string> = new Set(),
): ProjectFile | null {
  const normalizedExcludedFileNames = new Set(
    [...excludedFileNames].map(normalizeProjectFileName),
  );
  const candidates = files
    .filter(
      (file) =>
        !isProcessArtifactFile(file.name)
        && !normalizedExcludedFileNames.has(normalizeProjectFileName(file.name))
        && !(
          file.path
          && normalizedExcludedFileNames.has(normalizeProjectFileName(file.path))
        ),
    )
    .map((file) => ({ file, rank: primaryProjectFileRank(file) }))
    .filter((candidate) => Number.isFinite(candidate.rank));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.rank - b.rank || b.file.mtime - a.file.mtime);
  return candidates[0]?.file ?? null;
}

function isProcessArtifactFile(name: string): boolean {
  const base = name.split('/').pop()?.toLowerCase() ?? name.toLowerCase();
  return (
    base === 'critique.json'
    || base.endsWith('.log')
    || base.endsWith('.meta.json')
    || base.endsWith('.artifact.json')
    || base.endsWith('.map')
  );
}

function primaryProjectFileRank(file: ProjectFile): number {
  if (manifestDeclaresPrimary(file)) return 0;
  if (file.artifactManifest && file.artifactManifest.metadata?.inferred !== true) return 1;
  if (file.kind === 'html') return 2;
  if (file.kind === 'image') return 3;
  if (file.kind === 'video') return 4;
  if (file.kind === 'sketch') return 5;
  if (file.kind === 'pdf') return 6;
  if (file.kind === 'presentation') return 7;
  if (file.kind === 'document') return 8;
  if (file.kind === 'spreadsheet') return 9;
  return Number.POSITIVE_INFINITY;
}

function manifestDeclaresPrimary(file: ProjectFile): boolean {
  const manifest = file.artifactManifest;
  if (!manifest) return false;
  if (primaryValueTargetsFile(manifest.primary, file.name)) return true;
  const metadata = manifest.metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  if (primaryValueTargetsFile(metadata.primary, file.name)) return true;
  const outputs = metadata.outputs;
  if (outputs && typeof outputs === 'object' && !Array.isArray(outputs)) {
    return primaryValueTargetsFile(
      (outputs as { primary?: unknown }).primary,
      file.name,
    );
  }
  return false;
}

function primaryValueTargetsFile(value: unknown, fileName: string): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return normalizeProjectFileName(value) === normalizeProjectFileName(fileName);
}

function normalizeProjectFileName(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
}


function isTerminalRunStatus(status: ChatMessage['runStatus']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

function isActiveRunStatus(status: ChatMessage['runStatus']): boolean {
  return status === 'queued' || status === 'running';
}

/** A daemon run-status snapshot, as returned by `fetchChatRunStatus`/`listActiveChatRuns`. */
type RunStatusSnapshot = Awaited<ReturnType<typeof fetchChatRunStatus>>;

/**
 * Resolves the authoritative `endedAt` for a terminal-recovery branch.
 *
 * Invariant: every terminal-recovery branch (reload reattach, generic
 * disconnect retry-cap probe, stale/legacy row replay) must stamp `endedAt`
 * from an authoritative TERMINAL `updatedAt` — a status snapshot whose
 * `status` is terminal (succeeded/canceled/failed), observed at the END of
 * recovery — never from a pre-reattach/heartbeat snapshot or a stale
 * disconnect-time value.
 *
 * `candidate` is whatever status snapshot the caller already has in hand
 * (e.g. fetched before `reattachDaemonRun` started, which may still read
 * 'running'/'queued' if the daemon only finished afterward). When it is
 * already terminal, its `updatedAt` IS the authoritative value and is
 * returned with no extra round trip. When it is missing or still active, a
 * fresh probe is taken via `fetchChatRunStatus` — the daemon may have
 * finished in the interim — and used if terminal. If the fresh probe is
 * also unavailable or non-terminal, `Date.now()` is the last-resort
 * fallback so `endedAt` is never left unset.
 */
async function resolveTerminalEndedAt(
  runId: string,
  candidate: RunStatusSnapshot | null | undefined,
): Promise<number> {
  if (candidate && !isActiveRunStatus(candidate.status)) {
    return candidate.updatedAt;
  }
  const probed = await fetchChatRunStatus(runId).catch(() => null);
  if (probed && !isActiveRunStatus(probed.status)) {
    return probed.updatedAt;
  }
  return Date.now();
}

const ASSISTANT_PERSIST_MIN_WINDOW_MS = 500;
const ASSISTANT_PERSIST_MAX_WINDOW_MS = 5_000;
const ASSISTANT_PERSIST_MS_PER_EVENT = 10;

/**
 * How long a streaming assistant message waits before its next PUT. Each PUT
 * sends the whole message, so past 50 events the window grows with its size to
 * hold the bytes written per second steady, up to a 5 s cap. The cap also bounds
 * what a crash can lose; terminal and keepalive writes do not wait for it.
 */
export function assistantPersistWindowMs(eventCount: number): number {
  return Math.min(
    ASSISTANT_PERSIST_MAX_WINDOW_MS,
    Math.max(ASSISTANT_PERSIST_MIN_WINDOW_MS, eventCount * ASSISTANT_PERSIST_MS_PER_EVENT),
  );
}

// Whether a message's text holds a recoverable artifact, per message object.
// Messages are replaced on change, never mutated, and every streamed update
// re-asks about each finished reply; parsing one means reading its whole body.
const artifactVerdictByMessage = new WeakMap<ChatMessage, boolean>();

export function hasRecoverableArtifactMessage(message: ChatMessage): boolean {
  if (message.role !== 'assistant') return false;
  if (!message.runId) return false;
  if (!isTerminalRunStatus(message.runStatus)) return false;
  if (message.producedFiles?.length) return false;
  const known = artifactVerdictByMessage.get(message);
  if (known !== undefined) return known;
  const sourceText = message.content.trim().length > 0
    ? message.content
    : textContentFromAgentEvents(message.events);
  const verdict = artifactFromRecoverableSourceText(sourceText) !== null;
  artifactVerdictByMessage.set(message, verdict);
  return verdict;
}

export function shouldReplayTerminalRunMessage(message: ChatMessage): boolean {
  if (message.role !== 'assistant') return false;
  if (!message.runId) return false;
  if (message.runStatus !== 'succeeded') return false;
  // A daemon can persist terminal success before the browser finishes its
  // project-file refresh. Reattach once even when prose already exists so the
  // delivery invariant can confirm a file or downgrade the turn after reload.
  if (designDeliveryVerificationPending(message)) {
    // #6505: a historical succeeded Design row whose delivery metadata never
    // materialized must not be replayed/reattached on every reload. Bound
    // reconciliation to a short window after the run's terminal time; past it,
    // the row renders as a terminal outcome instead of looping through replay.
    if (designDeliveryReconciliationStale(message)) return false;
    return true;
  }
  if (message.content.trim().length > 0) return false;
  if (
    message.startedAt == null
    && !message.preTurnFileNames?.length
    && textContentFromAgentEvents(message.events).trim().length === 0
  ) {
    return false;
  }
  return !(message.producedFiles?.length);
}

function textContentFromAgentEvents(events?: AgentEvent[]): string {
  return (events ?? [])
    .filter((event): event is Extract<AgentEvent, { kind: 'text' }> => event.kind === 'text')
    .map((event) => event.text)
    .join('');
}

const QUEUED_CHAT_SENDS_STORAGE_VERSION = 1;

function queuedChatSendsStorageKey(projectId: string): string {
  return `pixo:chat-queued-sends:${projectId}:v${QUEUED_CHAT_SENDS_STORAGE_VERSION}`;
}

function loadQueuedChatSends(projectId: string): QueuedChatSend[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(queuedChatSendsStorageKey(projectId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const seenIds = new Set<string>();
    return parsed
      .filter(isQueuedChatSend)
      .filter((item) => {
        if (seenIds.has(item.id)) return false;
        seenIds.add(item.id);
        return true;
      })
      .slice(0, 100);
  } catch {
    return [];
  }
}

function saveQueuedChatSends(projectId: string, items: QueuedChatSend[]): void {
  if (typeof window === 'undefined') return;
  try {
    const key = queuedChatSendsStorageKey(projectId);
    if (items.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(items.slice(0, 100)));
  } catch {
    // Ignore private-mode/quota failures. The in-memory queue still works.
  }
}

function isQueuedChatSend(value: unknown): value is QueuedChatSend {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return false;
  const record = value as Partial<QueuedChatSend>;
  return (
    typeof record.id === 'string' &&
    typeof record.conversationId === 'string' &&
    typeof record.prompt === 'string' &&
    Array.isArray(record.attachments) &&
    typeof record.createdAt === 'number'
  );
}

function stripQueueOnlyFromMeta(
  meta: ProjectChatSendMeta | ChatSendMeta | undefined,
): ProjectChatSendMeta | undefined {
  if (!meta) return undefined;
  const {
    queueOnly: _queueOnly,
    acceptDurableQueue: _acceptDurableQueue,
    // 一旦排过队,正文的保管方就是队列项而不是输入框了 —— 这份认领不能跟着
    // 回放走,否则一条排过队的输入框消息在回放时被拦下,会去撤一个早就清空的
    // 草稿,而队列里那条反而被扔掉。见 `composerOwnedDraft` 的说明。
    composerOwnedDraft: _composerOwnedDraft,
    ...rest
  } = meta as ProjectChatSendMeta;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export interface RetryTarget {
  failedAssistant: ChatMessage;
  userMsg: ChatMessage;
  priorMessages: ChatMessage[];
  preservedAttempts: ChatMessage[];
}

export function resolveRetryTarget(
  messages: ChatMessage[],
  failedAssistantId: string,
): RetryTarget | null {
  let failedIndex = messages.findIndex(
    (message) =>
      message.id === failedAssistantId &&
      message.role === 'assistant',
  );
  if (failedIndex <= 0 || failedIndex !== messages.length - 1) return null;
  const failedAssistant = messages[failedIndex]!;
  if (!isRetryableAssistantTerminalFailure(failedAssistant)) return null;

  let userIndex = failedIndex;
  while (userIndex >= 0 && messages[userIndex]?.role === 'assistant') {
    const attemptMessage = messages[userIndex]!;
    if (!isRetryableAssistantTerminalFailure(attemptMessage)) break;
    userIndex -= 1;
  }

  const userMsg = messages[userIndex];
  if (!userMsg || userMsg.role !== 'user') return null;

  return {
    failedAssistant,
    userMsg,
    priorMessages: messages.slice(0, userIndex),
    preservedAttempts: messages.slice(userIndex + 1, failedIndex + 1),
  };
}

function pluginWorkflowTitle(_action: PluginFolderAgentAction): string {
  return 'Publish repo';
}

function pluginWorkflowCliCommand(_action: PluginFolderAgentAction, relativePath: string): string {
  return `${PRODUCT_CLI_NAME} plugin publish-repo ${relativePath}`;
}

function pluginWorkflowPlannedSteps(_action: PluginFolderAgentAction): string[] {
  return [
    'Resolve GitHub owner and validate plugin metadata',
    'Create or update the GitHub repository',
    'Push plugin files and tags',
    'Return the repository URL',
  ];
}

function pluginWorkflowPlannedEvents(action: PluginFolderAgentAction, relativePath: string): AgentEvent[] {
  return [
    { kind: 'text', text: `${pluginWorkflowStartContent(action, relativePath)}\n\n` },
    { kind: 'status', label: 'working', detail: pluginWorkflowTitle(action) },
  ];
}

function pluginWorkflowResultEvents(
  action: PluginFolderAgentAction,
  relativePath: string,
  message: string,
  url: string | undefined,
  log: string[] | undefined,
  ok: boolean,
  existingEvents?: AgentEvent[],
): AgentEvent[] {
  const summary = ok
    ? pluginWorkflowSuccessContent(action, relativePath, message, url, log)
    : pluginWorkflowFailureContent(action, relativePath, message, log);
  const baseEvents = (existingEvents ?? []).filter(
    (event) => !(event.kind === 'status' && event.label === 'working'),
  );
  return [
    ...baseEvents,
    { kind: 'text', text: `${summary}\n\n` },
    {
      kind: 'status',
      label: ok ? 'done' : 'failed',
      detail: ok ? 'CLI command finished' : 'CLI command failed',
    },
  ];
}

function pluginWorkflowStartContent(action: PluginFolderAgentAction, relativePath: string): string {
  const title = pluginWorkflowTitle(action);
  const command = pluginWorkflowCliCommand(action, relativePath);
  const steps = pluginWorkflowPlannedSteps(action).map((step) => `- ${step}`).join('\n');
  return `${title} started.\n\n\`\`\`bash\n${command}\n\`\`\`\n\nPlanned steps:\n${steps}`;
}

function pluginWorkflowSuccessContent(
  action: PluginFolderAgentAction,
  relativePath: string,
  message: string,
  url?: string,
  log?: string[],
): string {
  const summary = stripTrailingUrl(message, url) || `${pluginWorkflowTitle(action)} completed for \`${relativePath}\`.`;
  const lines = (log ?? []).map((line) => line.trim()).filter(Boolean).slice(0, 5);
  const command = pluginWorkflowCliCommand(action, relativePath);
  const details = lines.length > 0
    ? `\n\nCLI output:\n${lines.map((line) => `- \`${truncatePluginWorkflowLine(line)}\``).join('\n')}`
    : '';
  const link = url ? `\n\nLink: [${url}](${url})` : '';
  return `${summary}\n\n\`\`\`bash\n${command}\n\`\`\`${link}${details}`;
}

function pluginWorkflowFailureContent(
  action: PluginFolderAgentAction,
  relativePath: string,
  message: string,
  log?: string[],
): string {
  const lines = (log ?? []).map((line) => line.trim()).filter(Boolean).slice(0, 5);
  const command = pluginWorkflowCliCommand(action, relativePath);
  const details = lines.length > 0
    ? `\n\nCLI output:\n${lines.map((line) => `- \`${truncatePluginWorkflowLine(line)}\``).join('\n')}`
    : '';
  return `${pluginWorkflowTitle(action)} failed.\n\n\`\`\`bash\n${command}\n\`\`\`\n\n${message}${details}`;
}

function truncatePluginWorkflowLine(line: string): string {
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

function stripTrailingUrl(message: string, url?: string): string {
  const text = message.trim();
  const link = url?.trim();
  if (!link) return text;
  return text.replace(new RegExp(`\\s*${escapeRegExp(link)}\\s*$`), '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A daemon assistant message that is "queued/running" but has no runId yet
// is in-flight on the client: POST /api/runs has not returned. Persisting it
// in this state creates a phantom DB row that the reattach loop can never
// recover (the daemon either never saw the request or the response was lost),
// which is what produced the "Working 24m+" stuck UI. Treat the in-flight
// window as ephemeral and only write to DB once a runId pins the row to a
// real daemon run — or once the run reaches a terminal state.
function isPhantomDaemonRunMessage(m: ChatMessage): boolean {
  return (
    m.role === 'assistant' &&
    isActiveRunStatus(m.runStatus) &&
    !m.runId
  );
}

function isStoppableAssistantMessage(message: ChatMessage): boolean {
  if (message.role !== 'assistant') return false;
  if (isActiveRunStatus(message.runStatus)) return true;
  return message.runStatus === undefined && message.endedAt === undefined && message.startedAt !== undefined;
}

export function resolveSucceededRunStatus(status: ChatMessage['runStatus']): ChatMessage['runStatus'] {
  return status === 'failed' || status === 'canceled' ? status : 'succeeded';
}

const DESIGN_RESULT_MISSING_DETAIL =
  'The design run finished without producing a deliverable project file.';
const DESIGN_RESULT_DELIVERY_FAILED_DETAIL =
  `The design result was generated, but ${PRODUCT_NAME} could not save it to the project.`;

function applyDesignDeliveryOutcome(
  message: ChatMessage,
  outcome: DesignDeliveryOutcome,
  persistenceError?: string,
): ChatMessage {
  if (outcome === 'delivered') {
    return { ...message, resultDeliveryState: 'delivered' };
  }
  if (outcome !== 'no_result' && outcome !== 'delivery_failed') return message;
  const detail =
    outcome === 'delivery_failed'
      ? persistenceError || DESIGN_RESULT_DELIVERY_FAILED_DETAIL
      : DESIGN_RESULT_MISSING_DETAIL;
  const failed = {
    ...message,
    resultDeliveryState: outcome,
    resumable: false,
  };
  return appendErrorStatusEvent(
    failed,
    detail,
    'ARTIFACT_NOT_FOUND',
  );
}

export function extractTouchedFilePathsFromEvents(events: ChatMessage['events']): string[] {
  if (!Array.isArray(events)) return [];
  const pending = new Map<string, string>();
  const touched: string[] = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const rec = event as Record<string, unknown>;
    if (rec.kind === 'tool_use' && isFileWriteToolName(rec.name)) {
      const filePath = extractFileWriteToolPath(rec.input);
      if (typeof rec.id === 'string' && typeof filePath === 'string' && filePath) {
        pending.set(rec.id, filePath);
      }
    }
    if (rec.kind === 'tool_result') {
      const toolUseId = typeof rec.toolUseId === 'string'
        ? rec.toolUseId
        : typeof rec.tool_use_id === 'string'
          ? rec.tool_use_id
          : '';
      const filePath = pending.get(toolUseId);
      if (!filePath) continue;
      pending.delete(toolUseId);
      if (rec.isError !== true) touched.push(filePath);
    }
  }
  return touched;
}

function isFileWriteToolName(value: unknown): boolean {
  return (
    value === 'Write'
    || value === 'write'
    || value === 'create_file'
    || value === 'Edit'
    || value === 'str_replace_edit'
    || value === 'MultiEdit'
    || value === 'multi_edit'
  );
}

function extractFileWriteToolPath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const rec = input as Record<string, unknown>;
  const filePath = rec.file_path ?? rec.filePath ?? rec.path;
  return typeof filePath === 'string' && filePath ? filePath : null;
}

export function clearStreamingConversationMarker(
  currentConversationId: string | null,
  completedConversationId?: string | null,
): string | null {
  if (
    completedConversationId !== undefined
    && completedConversationId !== null
    && currentConversationId !== completedConversationId
  ) {
    return currentConversationId;
  }
  return null;
}

export function shouldClearActiveRunRefs(
  currentConversationId: string | null,
  completedConversationId: string,
): boolean {
  return currentConversationId === completedConversationId;
}


export function finalizeActiveAssistantMessagesOnStop(
  messages: ChatMessage[],
  stoppedAt: number,
): { messages: ChatMessage[]; finalized: ChatMessage[] } {
  const finalized: ChatMessage[] = [];
  const next = messages.map((message) => {
    if (!isStoppableAssistantMessage(message)) {
      return message;
    }
    const updated = {
      ...message,
      runStatus: 'canceled' as const,
      endedAt: message.endedAt ?? stoppedAt,
    };
    finalized.push(updated);
    return updated;
  });
  return { messages: next, finalized };
}

type BufferedTextUpdates = ReturnType<typeof createBufferedTextUpdates>;

/**
 * 重放窗口关掉的判据:这条流安静这么久,就当 daemon 的缓冲已经放完了。
 *
 * 为什么是「安静多久」而不是某个信号:`/api/runs/:id/events` 上**没有**历史与直播的
 * 分界。daemon(`runtimes/runs.ts` 的 `stream`)是先同步把 `run.events` 整个写出去,
 * 写完才把这条连接加进 `run.clients` 收直播 —— 两段同一个通道、同一套 `id`、同一种帧。
 * 客户端唯一能如实观察到的差别是**到货节奏**:重放那一段是一次灌下来的,直播那一段
 * 按模型出字的速度来。所以这里造的分界就是「第一次安静下来」。
 */
export const HISTORY_REPLAY_SETTLE_MS = 160;
/**
 * 兜底:模型此刻正在密集出字时,重放和直播的节奏可能一直分不开。窗口最多开这么久,
 * 到点无论如何都切回逐块直播 —— 宁可把开头那一小段直播也一次性铺出来,
 * 也不能把「运行中、agent 新输出」的流式效果永久关掉。
 */
export const HISTORY_REPLAY_MAX_MS = 1_200;

export function createBufferedTextUpdates({
  updateMessage,
  persistSoon,
  flushAndPersistNow,
  onContentDelta,
  replayingHistory = false,
}: {
  updateMessage: (updater: (prev: ChatMessage) => ChatMessage) => void;
  persistSoon: () => void;
  // Synchronous flush + persist with a transport that survives page
  // unload (PUT with keepalive). Invoked by the pagehide handler so the
  // last buffered chunk isn't lost when the user reloads mid-stream.
  flushAndPersistNow?: () => void;
  onContentDelta?: (delta: string) => void;
  /**
   * 这条流开头是 daemon 从缓冲里重推的历史(重挂时 `?after=` 不带游标,从第 0 条起)。
   * 开着的时候,落地动作全部攒住,窗口关掉时一次性提交 —— 历史不该一段一段地
   * 走一遍入场动画,那是「运行中、agent 新输出」才有的样子(OPEND-2590)。
   */
  replayingHistory?: boolean;
}) {
  let pendingContentDelta = '';
  let pendingTextEventDelta = '';
  let pendingThinkingEventDelta = '';
  /**
   * **来过几帧**思考,和它们**带了多少字**是两件事(W102,2026-09-03)。
   *
   * claude 的思考帧正文 100% 是空串,攒起来还是空串。只看 `pendingThinkingEventDelta`
   * 就等于「一帧都没来过」,于是 `{ kind: 'thinking' }` 一条都不进 `message.events`,
   * 而壳头的「思考中」(`buildTurnBlocks` 的 `shell.thinking`)**只**认这种事件 ——
   * 那一格就永远不亮,用户盯着几分钟空白。规格 W11 写死:`thinking_delta` 到达
   * **哪怕 delta 为空**也要进入思考中。所以帧数要单独记。
   */
  let pendingThinkingEventFrames = 0;
  let flushFrame: number | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let flushing = false;
  let needsFlush = false;
  const nonDeltaEventDeduper = createAdjacentAgentEventDeduper();
  const hasDocument = typeof document !== 'undefined';
  const hasWindow = typeof window !== 'undefined';

  const cancelScheduledFlush = () => {
    if (flushFrame !== null) {
      cancelAnimationFrame(flushFrame);
      flushFrame = null;
    }
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  // ── 重放窗口(OPEND-2590)────────────────────────────────────────────────
  // 窗口开着时,每一次「提交给 React」都改成排队。攒住的是 updater 函数本身,
  // 所以去重、合并、事件与正文的先后全部保持原样;关窗口时按顺序叠成一次提交。
  let replayOpen = replayingHistory;
  let replayQueue: Array<(prev: ChatMessage) => ChatMessage> = [];
  let replayContentDelta = '';
  let replaySettleTimer: ReturnType<typeof setTimeout> | null = null;
  let replayCapTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReplayTimers = () => {
    if (replaySettleTimer !== null) {
      clearTimeout(replaySettleTimer);
      replaySettleTimer = null;
    }
    if (replayCapTimer !== null) {
      clearTimeout(replayCapTimer);
      replayCapTimer = null;
    }
  };

  /** 把攒住的历史一次性交出去。队列空就什么都不做。 */
  const drainReplayQueue = () => {
    if (replayQueue.length === 0) {
      replayContentDelta = '';
      return;
    }
    const queued = replayQueue;
    const contentDelta = replayContentDelta;
    replayQueue = [];
    replayContentDelta = '';
    // 化开只服务「模型此刻正在吐的字」。这一整块是 daemon 从缓冲里重推的旧内容,
    // 打个标记让 `useCharReveal` 把它直接落地,不走入场动画。
    markHistoryReplayLanded();
    updateMessage((prev) => queued.reduce((message, updater) => updater(message), prev));
    persistSoon();
    if (contentDelta) onContentDelta?.(contentDelta);
  };

  const closeReplayWindow = () => {
    clearReplayTimers();
    if (!replayOpen) return;
    replayOpen = false;
    drainReplayQueue();
  };

  /** 又有东西到货:窗口还开着就把「安静」的判定往后推。 */
  const noteReplayActivity = () => {
    if (!replayOpen || disposed) return;
    if (replaySettleTimer !== null) clearTimeout(replaySettleTimer);
    replaySettleTimer = setTimeout(closeReplayWindow, HISTORY_REPLAY_SETTLE_MS);
  };

  /** 落地一次改动:窗口开着就排队,否则照旧直接提交。 */
  const commit = (updater: (prev: ChatMessage) => ChatMessage) => {
    if (replayOpen) {
      replayQueue.push(updater);
      return;
    }
    updateMessage(updater);
  };

  const commitPersistSoon = () => {
    if (replayOpen) return;
    persistSoon();
  };

  if (replayOpen) {
    replayCapTimer = setTimeout(closeReplayWindow, HISTORY_REPLAY_MAX_MS);
    noteReplayActivity();
  }

  const flushPending = () => {
    if (disposed) return;
    if (flushing) {
      needsFlush = true;
      return;
    }
    cancelScheduledFlush();
    if (
      !pendingContentDelta
      && !pendingTextEventDelta
      && !pendingThinkingEventDelta
      && pendingThinkingEventFrames === 0
      && !needsFlush
    ) return;
    flushing = true;
    needsFlush = false;
    const contentDelta = pendingContentDelta;
    const textEventDelta = pendingTextEventDelta;
    const thinkingEventDelta = pendingThinkingEventDelta;
    const thinkingFramesArrived = pendingThinkingEventFrames > 0;
    pendingContentDelta = '';
    pendingTextEventDelta = '';
    pendingThinkingEventDelta = '';
    pendingThinkingEventFrames = 0;
    try {
      commit((prev) => {
        const previousEvents = prev.events ?? [];
        const nextEvents = appendBufferedAgentDeltas(
          previousEvents,
          textEventDelta,
          thinkingEventDelta,
          thinkingFramesArrived,
        );
        // 一串空思考帧里只有第一帧会改动数组;其余帧什么都没变,别白换一次消息身份
        if (nextEvents === previousEvents && !contentDelta) return prev;
        return { ...prev, content: prev.content + contentDelta, events: nextEvents };
      });
      if (replayOpen) {
        replayContentDelta += contentDelta;
      } else {
        persistSoon();
        if (contentDelta) onContentDelta?.(contentDelta);
      }
    } finally {
      flushing = false;
    }
    if (
      pendingContentDelta
      || pendingTextEventDelta
      || pendingThinkingEventDelta
      || pendingThinkingEventFrames > 0
      || needsFlush
    ) {
      needsFlush = false;
      scheduleFlush();
    }
  };

  const scheduleFlush = () => {
    if (disposed || flushFrame !== null || flushTimer !== null) return;
    flushFrame = requestAnimationFrame(() => {
      flushFrame = null;
      flushPending();
    });
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPending();
    }, 250);
  };

  /**
   * 对外的 `flush()` 是「**现在**就要看到已落地的状态」—— 落盘、卸载、收尾都靠它,
   * 所以它连重放队列一起交出去。模块内部为了排序而做的 flush 走 `flushPending()`,
   * 那种只是把待定的正文变成一条 text 事件,不该把重放窗口提前关掉。
   */
  const flush = () => {
    flushPending();
    drainReplayQueue();
  };

  const appendContent = (delta: string) => {
    if (disposed) return;
    pendingContentDelta += delta;
    needsFlush = true;
    noteReplayActivity();
    scheduleFlush();
  };

  const appendTextEvent = (delta: string) => {
    if (disposed) return;
    // 攒着的思考先交出去 —— 空帧也算,否则思考与正文的先后会错位
    if (pendingThinkingEventDelta || pendingThinkingEventFrames > 0) flushPending();
    nonDeltaEventDeduper.reset();
    pendingTextEventDelta += delta;
    needsFlush = true;
    noteReplayActivity();
    scheduleFlush();
  };

  const appendEvent = (ev: AgentEvent) => {
    if (disposed) return;
    if (ev.kind === 'text') {
      appendTextEvent(ev.text);
      return;
    }
    if (ev.kind === 'thinking') {
      if (pendingTextEventDelta) flushPending();
      nonDeltaEventDeduper.reset();
      pendingThinkingEventDelta += ev.text;
      // 帧数单独记:claude 的 delta 全是空串,只看上面那行等于「一帧都没来过」
      pendingThinkingEventFrames += 1;
      needsFlush = true;
      noteReplayActivity();
      scheduleFlush();
      return;
    }
    flushPending();
    noteReplayActivity();
    if (nonDeltaEventDeduper.isDuplicate(ev)) return;
    commit((prev) => {
      const previousEvents = prev.events ?? [];
      const nextEvents = appendCoalescedAgentEvent(previousEvents, ev);
      return nextEvents === previousEvents
        ? prev
        : { ...prev, events: nextEvents };
    });
    commitPersistSoon();
  };

  const cancel = () => {
    // 攒住的历史不能跟着 buffer 一起消失:重挂开始时这条消息已经被清空了,
    // 丢掉队列等于把正文留在空白上。先交出去再拆。
    clearReplayTimers();
    replayOpen = false;
    drainReplayQueue();
    disposed = true;
    cancelScheduledFlush();
    pendingContentDelta = '';
    pendingTextEventDelta = '';
    pendingThinkingEventDelta = '';
    pendingThinkingEventFrames = 0;
    needsFlush = false;
    nonDeltaEventDeduper.reset();
    if (hasDocument) {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (hasWindow) {
      window.removeEventListener('pagehide', onPageHide);
    }
  };

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  }

  function onPageHide() {
    flush();
    // persistSoon's 500ms debounce never fires once the document tears
    // down, so synchronously PUT with keepalive instead.
    flushAndPersistNow?.();
  }

  if (hasDocument) {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (hasWindow) {
    window.addEventListener('pagehide', onPageHide);
  }

  // True when text has been appended but not yet flushed into a `text` event.
  // Callers that need the soon-to-be-committed event count (e.g. pinning a live
  // tool's stream position) add 1 for this still-buffered preamble.
  const hasPendingText = () => pendingTextEventDelta.length > 0;

  return { appendContent, appendTextEvent, appendEvent, flush, cancel, hasPendingText };
}

function isSnapshotAgentEvent(event: AgentEvent): event is Extract<AgentEvent, { kind: 'tool_use' }> {
  return event.kind === 'tool_use' && isTodoWriteToolName(event.name);
}

function agentEventsAreIdentical(left: AgentEvent, right: AgentEvent): boolean {
  if (left === right) return true;
  if (
    !isSnapshotAgentEvent(left)
    || !isSnapshotAgentEvent(right)
    || left.id !== right.id
    || left.name !== right.name
  ) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function createAdjacentAgentEventDeduper() {
  let previous: AgentEvent | null = null;
  let previousJson: string | null = null;
  return {
    isDuplicate(event: AgentEvent): boolean {
      if (!isSnapshotAgentEvent(event)) {
        previous = null;
        previousJson = null;
        return false;
      }
      if (!previous || !isSnapshotAgentEvent(previous)) {
        previous = event;
        return false;
      }
      if (previous === event) return true;
      if (previous.id !== event.id || previous.name !== event.name) {
        previous = event;
        previousJson = null;
        return false;
      }
      const eventJson = JSON.stringify(event);
      const priorJson = previousJson ?? JSON.stringify(previous);
      if (eventJson === priorJson) {
        previousJson = priorJson;
        return true;
      }
      previous = event;
      previousJson = eventJson;
      return false;
    },
    reset(): void {
      previous = null;
      previousJson = null;
    },
  };
}

function appendCoalescedAgentEvent(events: AgentEvent[], event: AgentEvent): AgentEvent[] {
  const last = events[events.length - 1];
  if (
    (event.kind === 'text' || event.kind === 'thinking')
    && last?.kind === event.kind
  ) {
    return [
      ...events.slice(0, -1),
      { ...last, text: last.text + event.text },
    ];
  }
  if (
    last
    && event.kind !== 'text'
    && event.kind !== 'thinking'
    && isSnapshotAgentEvent(last)
    && isSnapshotAgentEvent(event)
    && agentEventsAreIdentical(last, event)
  ) {
    return events;
  }
  return [...events, event];
}

/**
 * 把这一批攒住的增量落进事件流。
 *
 * `thinkingFramesArrived` 和 `thinkingDelta` 分开传,是 W102(2026-09-03)的判据:
 * **帧到了**和**帧里有字**是两件事。claude 的思考帧正文 100% 是空串,只看
 * `thinkingDelta` 就等于「一帧都没来过」——「思考中」那一格于是永远不亮
 * (规格 W11:`thinking_delta` 到达**哪怕 delta 为空**就进入思考中)。
 *
 * 空帧只需要在流里留下「在想」这一个事实,所以已经有一段思考在收尾时就什么都不做:
 * 数组身份不变,上面的 `commit` 会原样返回,连着几十帧空的也不会换一次消息身份。
 * 空串本身不成段 —— `build-turn-blocks.ts` 那两道 `!text.trim()` 管这件事。
 */
function appendBufferedAgentDeltas(
  events: AgentEvent[],
  textDelta: string,
  thinkingDelta: string,
  thinkingFramesArrived = false,
): AgentEvent[] {
  let next = events;
  if (textDelta) next = appendCoalescedAgentEvent(next, { kind: 'text', text: textDelta });
  if (thinkingDelta) {
    next = appendCoalescedAgentEvent(next, { kind: 'thinking', text: thinkingDelta });
  } else if (thinkingFramesArrived && next[next.length - 1]?.kind !== 'thinking') {
    next = appendCoalescedAgentEvent(next, { kind: 'thinking', text: '' });
  }
  return next;
}
