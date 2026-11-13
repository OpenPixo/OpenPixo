// @ts-nocheck
import { openBrowser } from './services/open-url.js';

import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { createProjectMutations } from './projects/mutations.js';
import { TextGenerationError } from './services/text-generation.js';
import { resolveProjectExtensions } from './services/project-extensions.js';

import { captureJsonBodySize } from './http/json-body-size.js';
import type {
  DesktopExportArtifactInput,
  DesktopExportArtifactResult,
  DesktopExportPdfInput,
  DesktopExportPdfResult,
  DesktopRenderFramesInput,
  DesktopRenderFramesResult,
  DesktopRenderSlidesInput,
  DesktopRenderSlidesResult,
} from '@openpixo/sidecar-proto';
import express from 'express';
import multer from 'multer';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { executionProfileFromStreamFormat, gamePlanIsPending, isOpenPixoAgentAutoModel, OPENPIXO_AGENT_AUTO_PLAN_MODEL, PLUGIN_SHARE_ACTION_PLUGIN_IDS, renderChatTurnHostProtocolInstructions, renderGamePlanTurnNote } from '@openpixo/contracts';


import { composeGameSystemPrompt, gamePromptProjectInputs, promptEngineProfile } from './game/prompt.js';
import { connectedImageTools, runMediaExecutionForPrompt, usableMediaProviders } from './game/media-contract.js';
import { artBudgetRunFacts, ArtBudgetLedger } from './game/art-budget.js';
import { registerArtBudgetRoutes } from './routes/art-budget.js';
import { registerAgentImageModelRoutes } from './routes/agent-image-model.js';
import { getArtStyle, getProjectArtStyle, listArtStyles } from './styles/service.js';
import { renderConnectedExternalMcpDirective } from './mcp/connected-directive.js';
import {
  computeStableSectionHashes,
  serializeStableSections,
  type StableSectionHashes,
} from './runtimes/stable-prompt-sections.js';
import { emittedRenderableQuestionForm } from './question-form-detect.js';
import { resolveProjectRoot } from './project-root.js';
import { OPENPIXO_PLUGIN_ID } from './mcp-observability.js';
import {
  resolveDaemonCliPath,
  resolveDaemonPluginPreviewsDir,
  resolveDaemonResourceDir,
  resolveDaemonResourceRoot,
  resolveDataDir,
  resolveProcessResourcesPath,
} from './daemon-paths.js';
export {
  resolveDaemonCliPath,
  resolveDaemonPluginPreviewsDir,
  resolveDaemonResourceRoot,
  resolveDataDir,
} from './daemon-paths.js';
import {
  isStaticSpaFallbackRequest,
  registerStaticSpaFallback,
  resolveStaticSpaFallbackPath,
} from './static-spa.js';
export {
  isStaticSpaFallbackRequest,
  resolveStaticSpaFallbackPath,
} from './static-spa.js';
import {
  createCompatApiError,
  createCompatApiErrorResponse,
  sendApiError,
} from './http/api-errors.js';
export {
  createCompatApiError,
  createCompatApiErrorResponse,
} from './http/api-errors.js';
import { applyBakedPreviews, PLUGIN_PREVIEWS_ROUTE } from './plugins/plugin-preview-bakes.js';
import { userFacingAgentLabel } from './user-facing-agent-label.js';
import { UPLOAD_DIR, composeChatAgentTextPayload, composeLiveInstructionPrompt, formatDesignFilesWorkspaceHint, formatProjectAttachmentHint, resolveChatExtraAllowedDirs, chatToolOutputDirs, describeStablePromptCache, resolveResearchCommandContract, resolveSafeProjectAttachments, resolveSafePromptImagePaths } from './runtimes/chat-prompt-inputs.js';
import {
  recordPromptDeliveredAtSpawn,
  runtimeReadsPlainTextPromptFromStdin,
  applyClaudeStreamJsonRunBookkeeping,
  classifyChatRunCloseStatus,
  resolveActiveInactivityTimeoutMs,
  resolveChatRunArtifactQuietPeriodMs,
  resolveChatRunFirstOutputTimeoutMs,
  resolveChatRunInactivityTimeoutMs,
  runtimeEmissionCountsAsAgentProgress,
  resolveChatRunShutdownGraceMs,
} from './runtimes/chat-run-lifecycle.js';
// Shared with `POST /api/runs/:id/steer` so the opening prompt and a B11
// mid-turn steering frame are encoded by the same writer.
import { encodeStreamJsonUserMessage } from './runtimes/run-steering.js';
import {
  normalizeRunContextSelection,
  renderRunContextPrompt,
} from './runtimes/chat-run-context.js';
import {
  daemonAgentPayloadToPersistedAgentEvent,
  persistRunEventToAssistantMessage,
  flushRunMessageEvents,
  finalizeRunMessageEvents,
  persistRunFailureClassification,
  pinAssistantMessageOnRunCreate,
} from './runtimes/chat-run-messages.js';
import { withFailureStderrTail } from './run-diagnostics.js';
import { createRunSideEffectLedger, foldEventIntoRunSideEffectLedger, resolveRunProjectKindForAnalytics, retryFinalResultForRunStatus, runArtifactCountForRun, runAdmissionEvidenceForRun, runFilesWrittenForRun, runPreviewModuleCountForRun, runRetryEventsForAnalytics, runSideEffectsForRun, scanRunEventsForFinishedProps, scanRunEventsForRetrySideEffects } from './runtimes/run-lifecycle-analytics.js';
export {
  composeChatAgentTextPayload,
  composeLiveInstructionPrompt,
  formatDesignFilesWorkspaceHint,
  formatProjectAttachmentHint,
  resolveChatExtraAllowedDirs,
  describeStablePromptCache,
  resolveResearchCommandContract,
  resolveSafeProjectAttachments,
  resolveSafePromptImagePaths,
} from './runtimes/chat-prompt-inputs.js';
export {
  applyClaudeStreamJsonRunBookkeeping,
  classifyChatRunCloseStatus,
  resolveActiveInactivityTimeoutMs,
  resolveChatRunArtifactQuietPeriodMs,
  resolveChatRunFirstOutputTimeoutMs,
  resolveChatRunInactivityTimeoutMs,
  runtimeEmissionCountsAsAgentProgress,
} from './runtimes/chat-run-lifecycle.js';
export {
  renderRunContextPrompt,
} from './runtimes/chat-run-context.js';
export {
  daemonAgentPayloadToPersistedAgentEvent,
  persistRunEventToAssistantMessage,
  pinAssistantMessageOnRunCreate,
} from './runtimes/chat-run-messages.js';
export {
  resolveRunProjectKindForAnalytics as __forTestResolveRunProjectKindForAnalytics,
  retryFinalResultForRunStatus as __forTestRetryFinalResultForRunStatus,
  runRetryEventsForAnalytics as __forTestRunRetryEventsForAnalytics,
  scanRunEventsForFinishedProps as __forTestScanRunEventsForFinishedProps,
  scanRunEventsForRetrySideEffects as __forTestScanRunEventsForRetrySideEffects,
} from './runtimes/run-lifecycle-analytics.js';

export { resolveProjectRoot };
import { createCommandInvocation } from '@openpixo/platform';

import {
  getDetectedAgents as detectAgents,
  getAgentDef,
  isKnownModel,
  isKnownReasoningEffort,
  isKnownServiceTier,
  applyAgentLaunchEnvAsync,
  resolveAgentLaunchAsync,
  sanitizeCustomModel,
  spawnEnvForAgentAsync,
} from './agents.js';
import { resolveModelForAgent, resolveModelForServiceTier } from './runtimes/models.js';
import { loadMmdRouteLaunchEnv } from './runtimes/mmd-routes.js';
import { preflightCodexDefaultModel } from './runtimes/codex-model-preflight.js';
import { stampToolTiming } from './runtimes/tool-timing.js';
import {
  buildOpenCodeByokProviderConfig,
  BYOK_OPENCODE_PROVIDER_REQUIRED_MESSAGE,
  usesBundledOpenCode,
} from './runtimes/byok-opencode.js';


import {
  consumedImportNonces,
  getDesktopAuthSecret,
  isDesktopAuthGateActive,
  isDesktopAuthRegistered,
  pruneExpiredImportNonces,
  resetDesktopAuthForTests,
  setDesktopAuthSecret,
  signDesktopImportToken,
  verifyDesktopImportToken,
} from './desktop-auth.js';
import { normalizeDaemonBindHost } from './daemon-startup.js';
export {
  isDesktopAuthGateActive,
  isDesktopAuthRegistered,
  resetDesktopAuthForTests,
  setDesktopAuthSecret,
  signDesktopImportToken,
  verifyDesktopImportToken,
} from './desktop-auth.js';
import {
  normalizeTelemetryAppVersionInfo,
  readCurrentAppVersionInfo,
  UNKNOWN_APP_VERSION,
} from './app-version.js';
import { composeProjectSkillContext, findSkillById, listSkills, resolveSkillId } from './skills.js';


import { validateLinkedDirs } from './linked-dirs.js';

import {
  buildWindowsFolderDialogCommand,
  parseFolderDialogStdout,
  parseLinuxFolderDialogResult,
} from './native-folder-dialog.js';
import {
  AssetCacheError,
  assetCacheRewriteUrl,
  createPluginAssetCache,
  isCacheableExternalUrl,
} from './plugins/plugin-asset-cache.js';
import { defaultMediaExecutionPolicy } from './media/policy.js';
import {
  applySandboxRuntimeEnv,
  ensureSandboxRuntimeDirs,
  isSandboxModeEnabled,
  resolveSandboxRuntimeConfig,
} from './sandbox-mode.js';
import { createSkillCatalog } from './services/skill-catalog.js';
import { selectDefaultProjectSkills } from './game/default-skills.js';
import { npmRegistryEnv } from './game/npm-registry.js';

import { applyPlugin, defaultBundledRoot, dismissSkillPluginCandidate, doctorPlugin, FIRST_PARTY_ATOMS, generateSkillPluginDraft, getInstalledPlugin, getSnapshot, installFromLocalFolder, installPlugin, listSkillPluginCandidates, listInstalledPlugins, MissingInputError, pluginPromptBlock, pruneExpiredSnapshots, readPluginLockfile, registerBundledPlugins, registryRootsForDataDir, resolveLocalPluginBySource, restoreProjectSnapshotLink, resolvePluginSnapshot, isSafePluginId, startSnapshotGc, uninstallPlugin } from './plugins/index.js';

import {
  marketplaceManifestUrlForRegistry,
  marketplaceRegistryIdFromUrl,
} from './plugins/marketplaces.js';
import { createClaudeStreamHandler } from './runtimes/claude-stream.js';
import { createAgentTitleMarkerStripper } from './title-marker.js';
import {
  createPanelGrammarStripper,
  strippingConsumedTheWholeFrame,
} from './panel-grammar-strip.js';
import { createArtifactFocusMarkerStripper } from './artifact-focus-marker.js';
import { createNextStepMarkerStripper } from './next-step-marker.js';
import { createRoleMarkerGuard } from './role-marker-guard.js';
import { createToolLoopGuard, toolLoopModeForAgent, type ToolLoopVerdict } from './tool-loop-guard.js';
import { diagnoseClaudeCliFailure } from './claude-diagnostics.js';
import { createJsonEventStreamHandler } from './runtimes/json-event-stream.js';
import {
  CODEX_APP_SERVER_STREAM_FORMAT,
  applyCodexTransportOverride,
  codexResolvedSandboxMode,
} from './runtimes/defs/codex.js';
import { attachCodexAppServerSession } from './agent-protocol/codex-app-server/session.js';
import { createCodexThreadCleanupOwner, type CodexCleanupInvocation } from './agent-protocol/codex-app-server/cleanup-owner.js';
import {
  ensureDetectedRuntimeVersions,
  getDetectedRuntimeVersions,
  ensureDetectedRuntimeCapabilities,
} from './runtimes/detection.js';

import {
  classifyAgentAuthFailure,
  classifyAgentServiceFailure,
} from './runtimes/auth.js';
import { readOpenCodeServiceFailure } from './runtimes/opencode-log.js';
import { applyOpenCodeEventPlugin } from './runtimes/opencode-event-plugin.js';
import { subscribe as subscribeFileEvents } from './project-watchers.js';
import { createChatRunService } from './runtimes/runs.js';
import { reapLeftoverAgentProcesses, spawnAgentProcess } from './runtimes/agent-process.js';

import { createInternalRunCreationService } from './services/internal-run-service.js';
import { createRunCheckpointHook, checkpointProjectDirectoryResolver, checkpointProjectBusyReader } from './projects/checkpoint-run.js';
import { checkpointStore } from './projects/checkpoint-store.js';
import { createRunAnalyticsLifecycle } from './services/run-analytics-lifecycle.js';
import { runtimeResumesSessionById } from './runtimes/types.js';
import {
  createRunLifecycleTracer,
  runLifecycleMarkersForStreamEvent,
  type RunLifecycleStreamEventMarkers,
} from './run-lifecycle-tracer.js';
import { deriveRunErrorCode, runResultFromStatus } from './run-result.js';

import { classifyRunFailure, isResumableFailure } from './run-failure-classification.js';
import {
  deliverableSyntaxFinalizerEnabled,
  finalizeSuccessfulRunDeliverable,
} from './artifacts/successful-run-deliverable-finalization.js';
import { inferBaselineHtmlEntry } from './run-deliverable-validation.js';
import { recordDeliverableSyntaxDelivery } from './artifacts/deliverable-syntax-metrics.js';
import {
  POST_TOOL_RESUME_CONTINUATION_PROMPT,
  decidePostToolResumeRecovery,
  decideSafeRunRetry,
} from './run-retry-policy.js';
import { createRunPerRequestUsageLedger, foldEventIntoPerRequestUsageLedger, scanRunEventsForUsageAnalytics } from './run-analytics-observability.js';
import {
  createRunArtifactBaselines,
  diffRunArtifacts,
  snapshotProjectArtifacts,
  snapshotProjectArtifactsAsync,
} from './run-artifact-fs.js';
import {
  AiHtmlVersionSnapshotError,
  artifactOriginForRun,
  snapshotAiHtmlVersionsForRun,
} from './run-html-version-snapshots.js';
import { reconcileDurableRunTerminals } from './runtimes/run-terminal-reconciliation.js';
import {
  startMessageEventPayloadHeal,
  type MessageEventPayloadHealHandle,
} from './storage/message-event-payload-heal.js';


import { buildPromptStackTelemetry } from './prompt-telemetry.js';
import { newInsertId, readAnalyticsContext, type AnalyticsContext } from './analytics.js';
import {
  agentIdToTracking,
  modelIdForTracking,
} from '@openpixo/contracts/analytics';
import {
  mergeNoProxyWithLoopbackDefaults,
  redactSecrets,
  testAgentConnection,
  testProviderConnection,
  validateBaseUrl,
  validateBaseUrlResolved,
} from './connectionTest.js';
import { listProviderModels } from './integrations/provider-models.js';
import { nativeCodexProviderForConfig } from '@openpixo/contracts';
import { prepareNativeCodexProvider, NativeCodexProviderError, nativeCodexProviderSupportsVersion } from './runtimes/codex-provider.js';
import { codexOutputSecrets, redactCodexOutput, createCodexTextRedactor } from './runtimes/codex-output.js';
import { ClaudeApprovalSession } from './runtimes/claude-approvals.js';
import { agentCapabilities } from './runtimes/capabilities.js';
import { codexRunApprovalSession } from './runtimes/run-approvals.js';
import {
  cleanupRuntimeExtensionFiles,
  runtimeExtensionInjectors,
  writeRuntimeExtensionFiles,
  type RuntimeExtensionPlan,
} from './runtimes/extension-injection.js';
import { cleanupRuntimeExtensionsAfterDaemonRestart } from './runtimes/run-restart-recovery.js';

import { buildDocumentPreview } from './document-preview.js';
import { lintArtifact, renderFindingsForAgent } from './lint-artifact.js';
import { skillCwdAliasSegment, stageActiveSkill } from './cwd-aliases.js';
import { buildDesktopArtifactExportInput, buildDesktopPdfExportInput } from './pdf-export.js';
import { generateMedia } from './media/index.js';
import { resolveHyperFramesCliPath } from './media/hyperframes-runtime.js';
import { listElevenLabsVoiceOptions } from './integrations/elevenlabs-voices.js';
import { searchResearch, ResearchError } from './research/index.js';

import {
  AUDIO_DURATIONS_SEC,
  AUDIO_MODELS_BY_KIND,
  IMAGE_MODELS,
  MODEL3D_MODELS,
  MEDIA_ASPECTS,
  MEDIA_PROVIDERS,
  VIDEO_LENGTHS_SEC,
  VIDEO_MODELS,
} from './media/models.js';
import { readMaskedConfig, writeConfig } from './media/config.js';
import {
  listMediaTasksByProject,
  listRecentMediaTasks,
  reconcileMediaTasksOnBoot,
} from './media/tasks.js';
import { TASK_TTL_AFTER_DONE_MS, createMediaTaskStore } from './media/task-store.js';
import { buildClaudeMcpJson, buildOpenCodeMcpConfigContent, isManagedProjectCwd, readMcpConfig } from './mcp-config.js';
import {
  resolveExternalMcpServersForRun,
} from './run-tool-bundle.js';
import { PendingAuthCache, refreshAccessToken } from './mcp-oauth.js';
import { isTokenExpired, readAllTokens, setToken } from './mcp-tokens.js';
import { agentCliEnvForAgent, readAppConfig, readPluginEnvKnobs, writeAppConfig } from './app-config.js';
import { configureCodexImageProvider } from './media/codex-image-runtime.js';
import { formatLocalProjectTimestamp } from './services/project-timestamp.js';

import { createDiagnosticsExportHandler, resolveDaemonPreviousLogPath } from './diagnostics-export.js';

import { configureDiagnosticsEvidence } from './services/diagnostics-evidence.js';
import { beginDaemonHealthSession } from './services/daemon-health.js';
import { readSqlitePageStats } from './storage/db-inspect.js';
import {
  CHAT_SCROLL_FORENSICS_PATH,
  chatScrollForensicsBodyParser,
  chatScrollForensicsHandler,
} from './diagnostics-client-evidence.js';
import { DIAGNOSTICS_EXPORT_PATH } from '@openpixo/diagnostics';
import {
  createProjectArchiveStream,
  createBatchArchiveStream,
  createProjectFolder,
  decodeMultipartFilename,
  deleteProjectFile,
  assertSandboxProjectRootAvailable,
  deleteProjectFolder,
  detectEntryFile,
  ensureProject,
  ensureProjectSubdir,
  isRunTouchedProjectFile,
  isSafeId,
  listFiles,
  listProjectFolders,
  mimeFor,
  parseByteRange,
  projectDir,
  readProjectFile,
  renameProjectFile,
  removeProjectDir,
  resolveProjectDir,
  SandboxImportedProjectError,
  sanitizeName,
  sanitizePath,
  searchProjectFiles,
  stageProjectDirsForDelete,
  resolveProjectFilePath,
  resolveProjectDeletePath,
  writeProjectFile,
  reconcileHtmlArtifactManifest,
} from './projects.js';
import { validateArtifactManifestInput } from './artifacts/manifest.js';

import { appendMessageStatusEvent, deleteConversation, deleteProject as dbDeleteProject, deleteTemplate, getConversation, getMessage, getMessageTelemetryFinalizationState, getProject, getTemplate, insertConversation, insertProject, insertTemplate, latestTodoWriteInputForConversation, findTemplateByNameAndProject, updateTemplate, listProjectsAwaitingInput, listConversations, listLatestProjectRunStatuses, listMessages, listProjects, listTabs, listTemplates, normalizeConversationSessionMode, openDatabase, setTabs, SYNC_KEEPS_UPDATED_AT, updateConversation, updateProject, clearAgentSession, getAgentSessionRecord, upsertAgentSession, upsertMessage, userRequestBeforeAssistantMessage } from './db.js';
import {
  createPhysicalAgentSessionUsageTracker,
  computeIncludeStable,
  hashStableInstructions,
  persistCapturedAgentSession,
  resolveAgentResumeContext,
  resolveAgentResumeFailurePolicy,
  resolveAgentResumePromptPolicy,
  resolveResumeContinuationSeed,
} from './agent-session-resume.js';
import {
  initialNativeSessionRecoveryMetadata,
  markNativeSessionAutoReseeded,
  markNativeSessionCaptured,
} from './native-session-recovery.js';
import { registerActiveContextRoutes } from './routes/active-context.js';
import { registerAttributionRoutes } from './routes/attribution.js';
import { registerDaemonRoutes } from './routes/daemon.js';
import { registerDoctorRoutes } from './routes/doctor.js';
import { registerHostToolsRoutes } from './routes/host-tools.js';
import { registerGameVerifyRoutes, type RegisterGameVerifyRoutesDeps } from './routes/game-verify.js';
import { registerGamePlaytestRoutes } from './game/playtest-routes.js';
import { registerGameRunRoutes } from './routes/game-run.js';
import { registerPublishRoutes } from './routes/publish.js';
import { registerGameExportRoutes } from './routes/game-export.js';
import { registerRoomsRoutes } from './routes/rooms.js';
import { registerLocalRoomsRelay } from './routes/rooms-local.js';
import { registerOnlineRoutes } from './routes/online.js';
import { registerLocalOnlineEmulator } from './routes/online-local.js';
import { OnlineEmulator } from './online/emulator.js';
import { registerGameTuningRoutes } from './routes/game-tuning.js';
import { registerProjectNextStepsRoutes } from './routes/project-next-steps.js';
import { registerProjectCheckpointRoutes } from './routes/project-checkpoints.js';
import { registerConversationRewindRoutes } from './routes/project/conversation-rewind.js';
import { registerPluginAssetRoutes } from './routes/plugins/assets.js';
import { registerPluginMarketplaceRoutes } from './routes/plugins/marketplaces.js';
import { registerPluginEventRoutes, registerPluginRoutes, registerProjectPluginRoutes } from './routes/plugins/index.js';
import { registerMcpRoutes } from './mcp-routes.js';
import { registerXaiRoutes } from './routes/xai.js';
import { registerDeliverableSyntaxToolRoutes } from './routes/deliverable-syntax-tool.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerRecipeRoutes } from './recipes/routes.js';
import { OpenPixoAccountService } from './account/service.js';
import { OpenPixoHostedMedia, pendingHostedTaskIds } from './media/openpixo-hosted.js';
import { registerOpenPixoAccountCallback, registerOpenPixoAccountRoutes } from './routes/openpixo-account.js';
import { registerOpenPixoAgentProxy, registerOpenPixoAgentRoutes } from './routes/openpixo-agent.js';
import { OPENPIXO_AGENT_TOKEN_ENV, OpenPixoAgentGateway } from './openpixo-agent/gateway.js';
import {
  buildOpenPixoAgentOpenCodeConfig, OPENPIXO_AGENT_ID, openpixoAgentChoice, openpixoAgentEffort, openpixoAgentModel,
  openpixoAgentModelArg, openpixoAgentModelOffered, setOpenPixoAgentCatalogReader,
} from './openpixo-agent/runtime.js';
import { chooseOpenPixoAutoRunModel } from './openpixo-agent/auto-model.js';
import { contextLimitsForRun } from './runtimes/context-limits.js';
import { gameRecipePromptEntries } from './recipes/catalog.js';
import { registerProjectRoutes, registerProjectArtifactRoutes, registerProjectFileRoutes, registerProjectUploadRoutes } from './routes/project/index.js';
import { registerProjectChatArtifactRoutes } from './routes/project/chat-artifacts.js';
import { registerProjectEngineRoutes } from './routes/project/engine.js';
import { registerProjectAssetRoutes } from './routes/project-assets.js';
import { registerAssetOpRoutes } from './routes/asset-ops.js';
import { createChatArtifactBlobStore } from './chat-artifacts/blob-store.js';
import { resolveChatArtifactQuota } from './chat-artifacts/quota.js';
import {
  resolveChatArtifactMaintenanceIntervalMs,
  startChatArtifactMaintenance,
} from './chat-artifacts/maintenance.js';
import {
  captureRunChatArtifactSnapshots,
  type CaptureRunChatArtifactsReport,
} from './chat-artifacts/run-capture.js';
import { associateRunProducedFiles } from './runtimes/run-produced-files.js';
import { chatArtifactCaptureResultProps } from './chat-artifacts/telemetry.js';
import { freezeAndRenderChatArtifactCovers } from './chat-artifacts/cover.js';
import { setMessageArtifactHtmlVersionIds } from './chat-artifacts/store.js';

import { registerImportRoutes, registerProjectExportRoutes } from './import-export-routes.js';
import { registerGameTemplateRoutes } from './routes/game-templates.js';
import { registerGameSetupRoutes } from './routes/game-setup.js';
import { registerGamePlanRoutes } from './routes/game-plan.js';
import { gameEngineOptions, gamePlanPromptInput } from './game/plan.js';
import { gameToolResolver } from './game/verify.js';
import { openCodeRunExtraConfig } from './runtimes/opencode-permissions.js';
import { READ_ONLY_TURN_TOOL_OPERATIONS } from './runtimes/read-only-turn.js';

import { TranscriptExportLockedError } from './transcript-export.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerTerminalRoutes } from './routes/terminal.js';
import { registerProjectExtensionRoutes } from './routes/project-extensions.js';
import { registerStoreRoutes } from './routes/store.js';
import { builtInSkills } from './store/built-in-skills.js';
import { registerStyleRoutes } from './routes/styles.js';
import { createTerminalService } from './terminals.js';
import { registerSocialShareRoutes } from './routes/social-share.js';
import { registerWhatsNewRoutes } from './routes/whats-new.js';


import {
  createAuthorizeProjectRequest,
} from './projects/project-access.js';


import { registerTelemetryRoutes } from './routes/telemetry.js';
import {
  assembleExample,
  registerAtomRoutes,
  registerStaticResourceRoutes,
  rewriteSkillAssetUrls,
} from './routes/static-resource.js';
export { rewriteSkillAssetUrls } from './routes/static-resource.js';


import { createPluginInstallationHelpers, normalizeProjectPluginFolderPath, resolveProjectChildDirectory } from './services/plugin-installation.js';
import { createPluginShareTaskStore } from './services/plugin-share-tasks.js';
import { getRouteRegistrationInventory, installRouteRegistrationGuard } from './route-registration-guard.js';
import { assertServerContextSatisfiesRoutes } from './route-context-contract.js';
import {
  CHAT_TOOL_ENDPOINTS,
  CHAT_TOOL_OPERATIONS,
  PROJECT_EXPORT_TOOL_ENDPOINT,
  resolveChatToolTokenTtlMs,
  toolTokenRegistry,
} from './tool-tokens.js';
import {
  allowedBrowserPorts,
  configuredAllowedOrigins,
  isAllowedBrowserOrigin,
  isLocalSameOrigin,
  parseHostHeader,
} from './origin-validation.js';
import { projectPoweredPreviewOriginDecision } from './http/powered-preview-origin.js';
import { API_TOKEN_BASIC_CHALLENGE, apiTokenAuthorizationMatches, apiTokenFromEnv, isApiAuthDisabled } from './api-token-auth.js';
import { createWhatsNewService } from './services/whats-new.js';
import { execCommandViaLoginShell } from './services/login-shell.js';
import {
  OFFICIAL_MARKETPLACE_ID,
  createMarketplaceSeedHelpers,
} from './plugins/marketplace-seed.js';
import { PLUGIN_SHARE_ACTION_LABELS, USER_PLUGIN_SOURCE_KINDS, copyPluginFolderForProjectContext, detectSkillPluginCandidateOnRunSuccess, githubRepoNameFromPluginName, hasGeneratedPluginArtifacts, isPluginAuthoringRun, normalizePluginShareAction, reconcileAssistantMessageOnRunEnd, renderPluginBriefTemplate, renderPluginSharePrompt } from './plugins/share-helpers.js';
import { sanitizeArchiveFilename } from './projects/archive-filename.js';
import {
  isLoopbackHostname,
  isLoopbackPeerAddress,
  requireLocalDaemonRequest,
} from './http/local-daemon-request.js';

import { bearerTokenFromRequest, createToolRequestAuth } from './http/tool-request-auth.js';
import {
  advanceAuthenticatedDoneCapture,
  isTodoWriteToolName,
  stopReasonIsTruncation,
  todoItemsFromTodoWriteInput,
} from '@openpixo/contracts';
import {
  renderUnfinishedTodoRecall,
  recalledTodosFromTodoWriteInput,
  type RecalledTodo,
} from '@openpixo/contracts';



/**
 * `PIXO_PROJECT_CREATE_PREPARATION_TIMEOUT_MS` shortens the POST /api/projects
 * preparation deadline for end-to-end tests. Only a positive finite number is
 * honoured; anything else leaves the route on its production default.
 */
function projectCreatePreparationTimeoutMsFromEnv(): number | null {
  const raw = process.env.PIXO_PROJECT_CREATE_PREPARATION_TIMEOUT_MS;
  if (raw == null || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** @typedef {import('@openpixo/contracts').ApiErrorCode} ApiErrorCode */
/** @typedef {import('@openpixo/contracts').ApiError} ApiError */
/** @typedef {import('@openpixo/contracts').ApiErrorResponse} ApiErrorResponse */
/** @typedef {import('@openpixo/contracts').ChatRequest} ChatRequest */
/** @typedef {import('@openpixo/contracts').ChatSseEvent} ChatSseEvent */
/** @typedef {import('@openpixo/contracts').ProxyStreamRequest} ProxyStreamRequest */
/** @typedef {import('@openpixo/contracts').ProxySseEvent} ProxySseEvent */
/** @typedef {import('@openpixo/contracts').ProjectConversationCreatedSsePayload} ProjectConversationCreatedSsePayload */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = resolveProjectRoot(__dirname);
const RESOURCE_ROOT_ENV = 'PIXO_RESOURCE_ROOT';

const DAEMON_RESOURCE_ROOT = resolveDaemonResourceRoot({
  safeBases: [
    PROJECT_ROOT,
    resolveProcessResourcesPath(),
    process.env.PIXO_INSTALLATION_DIR,
  ],
});
// Built web app lives in `out/` — that's where Next.js writes the static
// export configured in next.config.ts. The folder name used to be `dist/`
// when this project shipped with Vite; the daemon serves whatever the
// frontend toolchain emits, no further config needed.
const STATIC_DIR = path.join(PROJECT_ROOT, 'apps', 'web', 'out');
// Baked plugin preview clips (scripts/bake-plugin-previews.mjs). Served at
// PLUGIN_PREVIEWS_ROUTE; their manifest rewrites html plugins' previews to a
// cheap poster + hover-play video in the home gallery.
const PLUGIN_PREVIEWS_DIR = resolveDaemonPluginPreviewsDir({
  resourceRoot: DAEMON_RESOURCE_ROOT,
  projectRoot: PROJECT_ROOT,
});
const PIXO_BIN = resolveDaemonCliPath();
export function resolveOpenPixoNodeBin({
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  resourceRoot = DAEMON_RESOURCE_ROOT,
  exists = fs.existsSync,
}: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  execPath?: string;
  platform?: NodeJS.Platform;
  resourceRoot?: string | null;
  exists?: (path: string) => boolean;
} = {}): string {
  const configured = env.PIXO_NODE_BIN?.trim();
  if (configured) return configured;

  const bundledName = platform === 'win32' ? 'node.exe' : 'node';
  const bundled = resourceRoot
    ? (platform === 'win32' ? path.win32 : path).join(resourceRoot, 'bin', bundledName)
    : null;
  if (bundled && exists(bundled)) return bundled;

  return execPath;
}

const PIXO_NODE_BIN = resolveOpenPixoNodeBin();
const SKILLS_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'skills',
  path.join(PROJECT_ROOT, 'skills'),
);
// Renderable templates pulled out of `skills/` by the skills/design-templates
// split (PR #955) so the EntryView Templates tab gets the large rendering
// catalogue and Settings → Skills only carries functional skills the agent
// invokes mid-task. See specs/current/skills-and-design-templates.md.
const DESIGN_TEMPLATES_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'design-templates',
  path.join(PROJECT_ROOT, 'design-templates'),
);
// User-installed skills and design systems live under the runtime data dir
// so they respect PIXO_DATA_DIR overrides (test isolation, packaged runs).
// Defined after RUNTIME_DATA_DIR is resolved below.
const FRAMES_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'frames',
  path.join(PROJECT_ROOT, 'assets', 'frames'),
);
const PROMPT_TEMPLATES_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'prompt-templates',
  path.join(PROJECT_ROOT, 'prompt-templates'),
);
const BUNDLED_PLUGINS_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  path.join('plugins', '_official'),
  defaultBundledRoot(PROJECT_ROOT),
);
const PLUGIN_REGISTRY_DIR = resolveDaemonResourceDir(
  DAEMON_RESOURCE_ROOT,
  'plugins/registry',
  path.join(PROJECT_ROOT, 'plugins', 'registry'),
);
const {
  bundledPluginRegistrySource,
  createMarketplaceFetcher,
  defaultMarketplaceSeedConfig,
  marketplaceSeedManifestText,
} = createMarketplaceSeedHelpers({
  bundledPluginsDir: BUNDLED_PLUGINS_DIR,
  projectRoot: PROJECT_ROOT,
  pluginRegistryDir: PLUGIN_REGISTRY_DIR,
  marketplaceManifestUrlForRegistry,
  marketplaceRegistryIdFromUrl,
});

const SANDBOX_MODE_ENABLED = isSandboxModeEnabled(process.env);
const RUNTIME_DATA_DIR = resolveDataDir(process.env.PIXO_DATA_DIR, PROJECT_ROOT, {
  requireExplicit: SANDBOX_MODE_ENABLED,
});
configureDiagnosticsEvidence(RUNTIME_DATA_DIR);
const SANDBOX_RUNTIME = resolveSandboxRuntimeConfig(SANDBOX_MODE_ENABLED, RUNTIME_DATA_DIR);
ensureSandboxRuntimeDirs(SANDBOX_RUNTIME);
const PLUGIN_LOCKFILE_PATH = path.join(RUNTIME_DATA_DIR, 'pixo-plugin-lock.json');
// Canonical (realpath-resolved) form of RUNTIME_DATA_DIR for the few callers
// that compare it against a user-supplied realpath() result. On macOS, /var
// is a symlink to /private/var, so an import realpath lands in /private/var
// and would never start-with the raw RUNTIME_DATA_DIR. Keep RUNTIME_DATA_DIR
// itself as the stable, user-shaped path so PIXO_DATA_DIR resolution stays
// predictable; only this canonical alias is used for symlink-aware checks.
const RUNTIME_DATA_DIR_CANONICAL = (() => {
  try {
    return fs.realpathSync(RUNTIME_DATA_DIR);
  } catch {
    return RUNTIME_DATA_DIR;
  }
})();
// Immutable chat-artifact snapshot storage. Derived from the SINGLE resolved
// data root per the repository "Daemon data directory contract" — the store
// itself has no default and would throw if handed anything else.
const CHAT_ARTIFACT_BLOBS = createChatArtifactBlobStore({ dataDir: RUNTIME_DATA_DIR });
const CHAT_ARTIFACT_QUOTA = resolveChatArtifactQuota(process.env);
const ARTIFACTS_DIR = path.join(RUNTIME_DATA_DIR, 'artifacts');
const PROJECTS_DIR = path.join(RUNTIME_DATA_DIR, 'projects');
const USER_SKILLS_DIR = path.join(RUNTIME_DATA_DIR, 'skills');
const PLUGIN_REGISTRY_ROOTS = registryRootsForDataDir(RUNTIME_DATA_DIR);
// Disk cache + same-origin proxy for external preview media (cross-border CDN
// images/videos referenced by plugin example.html). See plugin-asset-cache.ts.
const pluginAssetCache = createPluginAssetCache({
  cacheDir: path.join(RUNTIME_DATA_DIR, 'plugin-asset-cache'),
});
// User-imported design templates mirror USER_SKILLS_DIR but are scanned
// against DESIGN_TEMPLATES_DIR rather than SKILLS_DIR so the EntryView
// Templates surface and the Settings → Skills surface stay decoupled.
const USER_DESIGN_TEMPLATES_DIR = path.join(RUNTIME_DATA_DIR, 'design-templates');
// Multi-root tuples used everywhere the daemon resolves a skill / template
// id without knowing which surface it came from. SKILL_ROOTS drives
// Settings → Skills; DESIGN_TEMPLATE_ROOTS drives the EntryView Templates
// gallery; ALL_SKILL_LIKE_ROOTS spans both for chat run system-prompt
// composition and the orbit template resolver, where stored project ids
// can resolve to either root after the split.
const SKILL_ROOTS = [USER_SKILLS_DIR, SKILLS_DIR];
const DESIGN_TEMPLATE_ROOTS = [USER_DESIGN_TEMPLATES_DIR, DESIGN_TEMPLATES_DIR];
const ALL_SKILL_LIKE_ROOTS = [
  USER_SKILLS_DIR,
  USER_DESIGN_TEMPLATES_DIR,
  SKILLS_DIR,
  DESIGN_TEMPLATES_DIR,
];
fs.mkdirSync(PROJECTS_DIR, { recursive: true });
for (const dir of [USER_SKILLS_DIR, USER_DESIGN_TEMPLATES_DIR, PLUGIN_REGISTRY_ROOTS.userPluginsRoot]) {
  fs.mkdirSync(dir, { recursive: true });
}

// In-memory OAuth state cache. Lives for the daemon process's lifetime.
// Maps the OAuth `state` parameter we generated in /api/mcp/oauth/start
// to the verifier + endpoint info needed to finish the exchange when the
// browser hits /api/mcp/oauth/callback.
const mcpPendingAuth = new PendingAuthCache();

/**
 * Resolve the daemon's public base URL — the origin the user's browser
 * (or the OAuth provider) reaches us at. Order of precedence:
 *
 *   1. `PIXO_PUBLIC_BASE_URL` env var. Cloud and packaged-electron deployments
 *      set this to the externally-routable URL (e.g. `https://app.example.com`).
 *   2. `req.protocol://req.get('host')` from the inbound request. Works in
 *      local dev and most reverse-proxy setups (Express respects
 *      `trust proxy` so X-Forwarded-* headers are honored).
 *
 * The OAuth callback URI is derived from this — it MUST be reachable from
 * the user's browser, otherwise the redirect after auth lands on
 * ERR_CONNECTION_REFUSED. Misconfiguration is loud: the OAuth provider
 * will reject `redirect_uri` mismatches.
 */
function getPublicBaseUrl(req) {
  const env = process.env.PIXO_PUBLIC_BASE_URL;
  if (env && /^https?:\/\//i.test(env)) {
    return env.replace(/\/+$/u, '');
  }
  const proto = req.protocol || 'http';
  const host = req.get('host');
  if (!host) return `http://localhost:${process.env.PIXO_PORT ?? '7456'}`;
  return `${proto}://${host}`;
}

function mcpOAuthCallbackUrl(req) {
  return `${getPublicBaseUrl(req)}/api/mcp/oauth/callback`;
}

/**
 * Refresh an expired token using the OAuth client context that the original
 * authorization-code exchange persisted alongside the token. Refresh tokens
 * are bound (RFC 6749 §6) to the client that received them, so we MUST
 * refresh against the same `tokenEndpoint` / `clientId` / `clientSecret`
 * pair — re-running discovery with a different redirect URI would risk
 * registering a new client_id that the upstream then rejects the refresh
 * for. Tokens persisted before that context was recorded can't be safely
 * refreshed; the caller treats `null` as "needs reconnect".
 */
async function refreshAndPersistToken(dataDir, serverId, current) {
  if (!current.refreshToken) return null;
  if (!current.tokenEndpoint || !current.clientId) return null;
  const tokenResp = await refreshAccessToken({
    tokenEndpoint: current.tokenEndpoint,
    clientId: current.clientId,
    clientSecret: current.clientSecret,
    refreshToken: current.refreshToken,
    scope: current.scope,
    resource: current.resourceUrl,
  });
  const next = {
    accessToken: tokenResp.access_token,
    refreshToken: tokenResp.refresh_token ?? current.refreshToken,
    tokenType: tokenResp.token_type ?? 'Bearer',
    scope: tokenResp.scope ?? current.scope,
    expiresAt:
      typeof tokenResp.expires_in === 'number'
        ? Date.now() + tokenResp.expires_in * 1000
        : undefined,
    savedAt: Date.now(),
    tokenEndpoint: current.tokenEndpoint,
    clientId: current.clientId,
    clientSecret: current.clientSecret,
    authServerIssuer: current.authServerIssuer,
    redirectUri: current.redirectUri,
    resourceUrl: current.resourceUrl,
  };
  await setToken(dataDir, serverId, next);
  return next;
}

const activeChatAgentEventSinks = new Map();
const activeProjectEventSinks = new Map();

// Per-chat-run handles, keyed by runId. Lets non-stream side effects
// (live-artifact create, project events) reach back into the chat
// run's local state — currently used by the artifact quiet-period
// shortcut (#1451) so a successful artifact registration can shorten
// the inactivity watchdog without the chat path having to poll a
// store.
const activeChatRunHandles = new Map();

function emitChatAgentEvent(runId, payload) {
  const sink = activeChatAgentEventSinks.get(runId);
  if (!sink) return false;
  return sink(payload);
}

// Exported for tests covering the artifact quiet-period plumbing
// (#1451). The chat run path is a deep closure inside startServer, so
// pin the hook contract at the emit/handle boundary instead of
// driving a full fake-agent e2e for every invariant.
export const __forTestChatRunHandles = activeChatRunHandles;

// Broadcast an event to every SSE subscriber currently watching the given
// project's `/api/projects/:id/events` stream. The payload's `type` field
// becomes the SSE event name (see routes/project/index.ts). Used for live-artifact
// events and `conversation-created` events emitted by routine runs (#1361).
function emitProjectEvent(projectId, payload) {
  const sinks = activeProjectEventSinks.get(projectId);
  if (!sinks || sinks.size === 0) return false;
  for (const sink of Array.from(sinks)) {
    try {
      sink(payload);
    } catch {
      sinks.delete(sink);
    }
  }
  if (sinks.size === 0) activeProjectEventSinks.delete(projectId);
  return true;
}

// Broadcast a thin WORKSPACE-scoped invalidation only to the verified sink
// partition for `workspaceId`. There is deliberately no account-wide fallback:
// every producer below is attached to an explicit hub/poller/billing/project
// scope, and broad delivery would reveal cross-workspace activity timing.


/**
 * A verified hub connection is itself a freshness boundary, including the
 * daemon's very first connection. Published content and billing may already
 * have changed before the subscriber came online, so both scopes catch up
 * immediately instead of waiting for a later reconnect or poll tick.
 */

// Windows ENAMETOOLONG mitigation constants
const CMD_BAT_RE = /\.(cmd|bat)$/i;
const PROMPT_TEMP_FILE = () =>
  '.pixo-prompt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.md';
// Per-run baselines of the project's artifact files, captured before the agent
// runs and diffed at run-finish to derive `artifact_count` agent-agnostically
// (see `run-artifact-fs.ts`). Keyed by run id because the run-start scope and
// the run-finished analytics scope are different closures. The registry also
// flags runs that overlapped another run in the same cwd as `contended`; those
// must not trust the whole-tree diff (it would cross-attribute writes) and fall
// back to the per-run tool-stream count.
const runArtifactBaselines = createRunArtifactBaselines();
export const SSE_KEEPALIVE_INTERVAL_MS = 25_000;

export function createAgentRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
  daemonUrl: string,
  toolTokenGrant: { token?: string } | null = null,
  nodeBin: string = PIXO_NODE_BIN,
  inheritedEnvironment: (baseEnv?: NodeJS.ProcessEnv) => Record<string, string> = () => ({}),
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = applySandboxRuntimeEnv(
    {
      ...baseEnv,
      PIXO_DATA_DIR: RUNTIME_DATA_DIR,
      PIXO_DAEMON_URL: daemonUrl,
      PIXO_NODE_BIN: nodeBin,
    },
    SANDBOX_RUNTIME,
  );
  Object.assign(env, inheritedEnvironment(baseEnv));
  // The daemon API token authorizes the whole non-loopback API surface. Agent
  // children receive only their run-scoped tool capability, never that broad
  // credential inherited from the daemon process (including Windows casing).
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PIXO_API_TOKEN') delete env[key];
  }
  // A GUI-launched daemon can inherit a broken PATHEXT such as `.CPL` (issue
  // #6934). Nested native commands then lose stdout/stderr or fail with
  // ERROR_NO_DATA. On Windows, recover a usable executable-extension list while
  // preserving an already-valid value and the inherited key casing.
  if (process.platform === 'win32') {
    const pathextKey =
      Object.keys(env).find((key) => key.toLowerCase() === 'pathext') ?? 'PATHEXT';
    const pathextValue = typeof env[pathextKey] === 'string' ? (env[pathextKey] as string) : '';
    if (!/\.exe/i.test(pathextValue)) {
      env[pathextKey] = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';
    }
  }
  if (SANDBOX_RUNTIME.enabled) {
    const noProxy = mergeNoProxyWithLoopbackDefaults(env.NO_PROXY ?? env.no_proxy);
    if (noProxy) {
      env.NO_PROXY = noProxy;
      if (process.platform !== 'win32') env.no_proxy = noProxy;
    }
  }

  // Ensure the node binary directory is on PATH so agent sub-processes —
  // in particular npm .cmd shims on Windows that run `"node" script.js` —
  // can find the same node binary that runs the daemon even when the daemon
  // was launched with a full path to node and the directory was not on PATH.
  const nodeBinDir = path.dirname(nodeBin);
  if (nodeBinDir) {
    // On Windows, process.env spreads with the search path under 'Path' rather
    // than 'PATH'. Locate the key case-insensitively so we read and write the
    // same entry that child_process.spawn consults. If we blindly write a new
    // 'PATH' key alongside an existing 'Path', Node's case-insensitive env
    // de-duplication on Windows lets the new key win — dropping all inherited
    // directories (git, npm, agent shims, etc.) from the child's search path.
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const existingPath = typeof env[pathKey] === 'string' ? (env[pathKey] as string) : '';
    const parts = existingPath.split(path.delimiter).filter((p) => p.length > 0);
    const normalize = (p: string) => p.replace(/[/\\]+$/, '');
    const normalizedDir = normalize(nodeBinDir);
    const alreadyIncluded = parts.some((p) => {
      const n = normalize(p);
      return process.platform === 'win32'
        ? n.toLowerCase() === normalizedDir.toLowerCase()
        : n === normalizedDir;
    });
    if (!alreadyIncluded) {
      env[pathKey] = [nodeBinDir, ...parts].join(path.delimiter);
    }
  }

  if (toolTokenGrant?.token) {
    env.PIXO_TOOL_TOKEN = toolTokenGrant.token;
  } else {
    delete env.PIXO_TOOL_TOKEN;
  }

  return env;
}

export function createAgentRuntimeToolPrompt(
  daemonUrl: string,
  toolTokenGrant: { token?: string } | null = null,
): string {
  const tokenLine = toolTokenGrant?.token
    ? '- `PIXO_TOOL_TOKEN` is available in your environment for this run. Use it only through project wrapper commands; do not print, persist, or override it.'
    : '- `PIXO_TOOL_TOKEN` is not available for this run, so `/api/tools/*` wrapper commands may be unavailable.';

  return [
    '## Runtime tool environment',
    '',
    `- Daemon URL: \`${daemonUrl}\` (also available as \`PIXO_DAEMON_URL\`).`,
    '- `PIXO_NODE_BIN` is the absolute path to the Node-compatible runtime that started the daemon; packaged desktop installs provide this even when the user has no system `node` on PATH.',
    '- `PIXO_HYPERFRAMES_BIN` is the absolute path to OpenPixo\'s pinned HyperFrames CLI. Run lightweight commands through `PIXO_NODE_BIN`; use `"$PIXO_NODE_BIN" "$PIXO_BIN" media scaffold` for composition setup and never use a user-level `npx` cache.',
    `- \`PIXO_BIN\` is the absolute path to the ${PRODUCT_CLI_NAME} CLI script. On POSIX shells run wrappers with \`"$PIXO_NODE_BIN" "$PIXO_BIN" tools ...\` so calls do not depend on ${PRODUCT_CLI_NAME} or Node being on PATH.`,
    '- On PowerShell use `& $env:PIXO_NODE_BIN $env:PIXO_BIN tools ...`; on cmd.exe use `"%PIXO_NODE_BIN%" "%PIXO_BIN%" tools ...`.',
    tokenLine,
    '- Prefer project wrapper commands through `PIXO_NODE_BIN` + `PIXO_BIN` over raw HTTP. The wrappers read these environment values automatically.',
  ].join('\n');
}

export function createOpenPixoToolEnv({
  daemonUrl,
  hyperFramesBin = resolveHyperFramesCliPath(),
  projectDir,
  projectId,

  runId,
  conversationId,
  analyticsContext,
}: {
  daemonUrl: string;
  hyperFramesBin?: string;
  projectDir?: string | null;
  projectId?: string | null;

  runId?: string | null;
  conversationId?: string | null;
  analyticsContext?: AnalyticsContext | null;
}): NodeJS.ProcessEnv {
  return {
    PIXO_BIN: PIXO_BIN,
    PIXO_DATA_DIR: RUNTIME_DATA_DIR,
    PIXO_HYPERFRAMES_BIN: hyperFramesBin,
    PIXO_NODE_BIN: PIXO_NODE_BIN,
    PIXO_DAEMON_URL: daemonUrl,
    // Always overwrite ambient/configured identities, including unbound runs.
    // An older bound Run without a member keeps its Workspace id so the CLI
    // rejects the incomplete pair rather than silently reading another library.


    ...(typeof projectId === 'string' && projectId && projectDir
      ? {
          PIXO_PROJECT_ID: projectId,
          PIXO_PROJECT_DIR: projectDir,
        }
      : {}),
  };
}

export function createDaemonDataDirConfiguredAgentEnv(
  configuredAgentEnv: Record<string, string> = {},
): Record<string, string> {
  return {
    ...configuredAgentEnv,
    PIXO_DATA_DIR: RUNTIME_DATA_DIR,
  };
}

export function normalizeProjectDisplayStatus(status) {
  return status === 'starting' || status === 'queued' ? 'running' : status;
}

export function composeProjectDisplayStatus(
  baseStatus,
  awaitingInputProjects,
  projectId,
) {
  if (
    baseStatus.value === 'succeeded' &&
    awaitingInputProjects.has(projectId)
  ) {
    return { ...baseStatus, value: 'awaiting_input' };
  }
  return {
    ...baseStatus,
    value: normalizeProjectDisplayStatus(baseStatus.value),
  };
}

const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'canceled']);
// How much of a turn's visible text `run.askUserScanText` keeps: enough of the
// head to validate a complete `<question-form>` block, which a clarification
// turn emits near the top.
const ASK_USER_SCAN_CAP = 256 * 1024;

function captureRunWorkCompletenessSignals(run, ev) {
  if (!run || !ev || typeof ev !== 'object') return;
  if (ev.type === 'tool_use' && isTodoWriteToolName(ev.name)) {
    const todos = todoItemsFromTodoWriteInput(ev.input);
    if (Array.isArray(todos)) run.lastTodoSnapshot = todos;
    return;
  }
  if ((ev.type === 'turn_end' || ev.type === 'usage') && stopReasonIsTruncation(ev.stopReason)) {
    run.truncatedMidTurn = true;
  }
}

function fileNameFromToolInputPath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).at(-1) ?? trimmed;
}

function filesystemWriteFileNamesFromRunEvents(events) {
  const names = [];
  const seen = new Set();
  for (const rec of Array.isArray(events) ? events : []) {
    const data = rec?.data;
    if (!data || typeof data !== 'object') continue;
    if (data.type !== 'tool_use' && data.type !== 'artifact') continue;

    const toolName = typeof data.name === 'string' ? data.name : '';
    const isFileTool =
      data.type === 'artifact' ||
      /^(Write|Edit|MultiEdit|write_file|edit_file|replace_file)$/i.test(toolName);
    if (!isFileTool) continue;

    const input = data.input && typeof data.input === 'object' ? data.input : {};
    const candidate =
      fileNameFromToolInputPath(input.file_path) ||
      fileNameFromToolInputPath(input.filePath) ||
      fileNameFromToolInputPath(input.path) ||
      fileNameFromToolInputPath(input.filename) ||
      fileNameFromToolInputPath(data.path) ||
      fileNameFromToolInputPath(data.filePath) ||
      fileNameFromToolInputPath(data.name);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    names.push(candidate);
  }
  return names;
}

export function __forTestFilesystemWriteFileNamesFromRunEvents(events) {
  return filesystemWriteFileNamesFromRunEvents(events);
}

function filesystemEmptyAnswerFallbackText(fileNames) {
  if (!Array.isArray(fileNames) || fileNames.length === 0) {
    return 'Wrote project files.';
  }
  const shown = fileNames.slice(0, 3);
  if (fileNames.length === 1) {
    return `Wrote ${shown[0]}.`;
  }
  if (fileNames.length <= 3) {
    const last = shown.at(-1);
    const first = shown.slice(0, -1).join(', ');
    return `Wrote ${first} and ${last}.`;
  }
  return `Wrote ${shown.join(', ')}, and ${fileNames.length} files total.`;
}

export function __forTestFilesystemEmptyAnswerFallbackText(fileNames) {
  return filesystemEmptyAnswerFallbackText(fileNames);
}

export function shouldReportRunCompletedFromMessage(saved, body = {}) {
  return Boolean(
    saved &&
      saved.runId &&
      typeof saved.runStatus === 'string' &&
      TERMINAL_RUN_STATUSES.has(saved.runStatus) &&
      body?.telemetryFinalized === true,
  );
}

export function telemetryPromptFromRunRequest(message, currentPrompt) {
  return typeof currentPrompt === 'string' ? currentPrompt : message;
}

// Keep this header grammar aligned with parseFormAnswers in @openpixo/contracts.
const FORM_ANSWERS_HEADER_RE =
  /^\s*\[form answers(?:\s*[\u2014\-:]\s*([^\]\r\n]+))?\]\s*(?:\r?\n|$)/i;

// Aggressive OVERRIDE for weak / medium-strength plain agents (e.g.
// GPT-OSS-120B Medium, Gemini 3.5 Flash) that otherwise echo RULE 1's
// fenced form example back after the user has answered it. Strong models
// (Claude Sonnet 4.6, Gemini 3.1 Pro) already handle a shorter OVERRIDE;
// enumerating the anti-patterns is a no-op for them and a strong suppressor
// for the weaker ones. RULE 1 stays conditional: a genuinely new material
// blocker may still require a new, targeted form on any turn.
//
// Exported so tests pin both the trigger condition and the literal
// anti-patterns we ask the model to skip \u2014 silently weakening the
// list (e.g. dropping the markdown-fence ban) would reintroduce the
// form-echo regression on GPT-OSS / Gemini Flash.
export const FORM_ANSWERED_SYSTEM_OVERRIDE = `## OVERRIDE \u2014 submitted form answers are authoritative

The user already submitted their form answers (see # User request below).
Apply those answers. RULE 1 does not require another form merely because its
example appears in the system prompt.

Forbidden output for this turn:
- Re-emitting the answered \`discovery\` or \`task-type\` form, or asking again
  for information the submitted answers already provide.
- A markdown \`\`\`json fenced block echoing an answered form's schema or example.
- Form-asking prose that repeats the answered questions, such as
  "Got it \u2014 tell me the following" or
  "\u8bf7\u544a\u8bc9\u6211\u4ee5\u4e0b\u4fe1\u606f".
- Narrating fake system events such as "subagents stopped" or
  "server restart".

Required output for this turn:
- Open with a brief prose confirmation of what the brief is.
- Then apply RULE 2 as relevant and proceed to RULE 3 or the matching active
  workflow.
- Only if a new, materially blocking requirement remains unresolved may you
  emit one new targeted \`<question-form>\`; never repeat answered fields.

`;

// Smaller override for non-discovery / non-task-type form ids. These
// forms are not artifact-build transitions, so we only need to suppress
// the form re-ask without directing the model toward RULE 2 / RULE 3.
// Exported so tests can pin the literal content independently.
export const FORM_ANSWERED_GENERIC_OVERRIDE = `## OVERRIDE \u2014 submitted form answers are authoritative

The user already submitted their form answers (see # User request below).
Do not ask the same form again. Treat the submitted answers as the active
user instruction and respond accordingly. Ask again only if a new, materially
blocking requirement remains unresolved.

`;

function formAnswerTransitionForCurrentPrompt(currentPrompt) {
  if (typeof currentPrompt !== 'string') return null;
  const trimmed = currentPrompt.trim();
  if (!trimmed) return null;
  const match = FORM_ANSWERS_HEADER_RE.exec(trimmed);
  if (!match) return null;
  const rawFormId = (match[1] || 'form').trim() || 'form';
  const formId = rawFormId.replace(/[^\w.-]/g, '') || 'form';
  const lines = [
    '## Latest user turn - form answers submitted',
    trimmed,
    '',
    // Keep the wording in lock-step with main — the stronger answered-form
    // dedupe now lives in the system-prompt
    // `FORM_ANSWERED_SYSTEM_OVERRIDE` block, which every plain /
    // stream-json adapter sees. Diverging the
    // user-request transition string here breaks `chat-route.test
    // marks submitted discovery form answers ...` which asserts on
    // the exact main wording.
    `The user has answered the ${formId} form. Do not re-emit the answered form or repeat fields it already answered.`,
  ];
  if (formId.toLowerCase() === 'discovery' || formId.toLowerCase() === 'task-type') {
    lines.push(
      'Apply the submitted answers and continue with RULE 2 / RULE 3 or the matching active workflow. Only if a new, materially blocking requirement remains unresolved may you emit one targeted form; never repeat answered fields.',
    );
  } else {
    lines.push(
      'Treat these form answers as the active user turn instead of replaying the transcript as a fresh request.',
    );
  }
  return lines.join('\n');
}

/**
 * Background block that tells a FRESH session which request it is continuing.
 *
 * Only ever rendered for a turn whose message is a continuation directive AND
 * whose stored session the daemon refused (see `resolveResumeContinuationSeed`).
 * Absent for every other turn, so no existing prompt moves by a byte — and so
 * no upstream cached prefix moves either.
 */
export function renderResumeContinuationContext(
  originalRequest: string | null | undefined,
): string | null {
  const request = typeof originalRequest === 'string' ? originalRequest.trim() : '';
  if (!request) return null;
  return [
    '## Continuing an interrupted turn',
    'The previous attempt could not be continued in its original agent session,'
      + ' so this is a fresh session with no memory of it. The request that turn'
      + ' was working on:',
    '',
    request,
    '',
    'Any files it already wrote are still in the project — inspect them before'
      + ' redoing work.',
  ].join('\n');
}

export function composeChatUserRequestForAgent(
  message,
  currentPrompt,
  options: {
    skipTranscript?: boolean;
    /**
     * The request a refused upstream session was working on, when this turn is
     * a continuation directive the daemon could not resume. Rides the per-turn
     * user body for the same reason the todo recall below does: a resumed
     * session throws the rendered transcript away, and the system prompt is the
     * cached stable prefix. Omitted/empty leaves the composed body unchanged.
     */
    resumeContinuationOriginalRequest?: string | null;
    /**
     * The task list an earlier turn of this conversation last declared — the
     * WHOLE snapshot, finished rows included (see
     * `latestTodoWriteInputForConversation` + `recalledTodosFromTodoWriteInput`).
     * `renderUnfinishedTodoRecall` owns the question of whether any of it is
     * still open, and renders nothing when none of it is.
     *
     * This is the ONLY keyhole that reaches both branches below. A resumed
     * session throws the rendered transcript away entirely (`skipTranscript`),
     * so anything appended to the transcript is invisible to the 6 runtimes
     * with native resume; anything put in the system prompt moves the cached
     * stable prefix on every turn. The per-turn user body is the one place a
     * per-turn fact can ride for free, and `formAnswerTransitionForCurrentPrompt`
     * below is the existing precedent for synthesizing into it.
     *
     * Empty/omitted MUST leave the composed body byte-identical to before.
     */
    previousTurnTaskList?: readonly RecalledTodo[];
  } = {},
) {
  // When the adapter resumes its own session, the
  // daemon-rendered `## user` / `## assistant` transcript is a duplicate
  // of what the upstream CLI already has in memory — and the embedded
  // copy carries the literal `<question-form>` markup the agent emitted
  // on turn 1, which the model then re-emits on turn 2. Send only the
  // latest user turn (`currentPrompt`) in that case; the external runtime's
  // native session memory provides the rest.
  const skip = options.skipTranscript === true;
  // Native-session clients normally provide `currentPrompt`, but headless
  // callers such as `pixo run start --message` only populate `message`. On a
  // resumed session that value is the latest turn, not a rendered transcript,
  // so dropping it would send the misleading empty-turn placeholder instead.
  const bodySource = skip
    ? (typeof currentPrompt === 'string' ? currentPrompt : message)
    : message;
  const body =
    typeof bodySource === 'string' && bodySource.trim()
      ? bodySource
      : '(No extra typed instruction.)';
  const transition = formAnswerTransitionForCurrentPrompt(currentPrompt);
  // Stated before the turn's own words, the same way the form-answer transition
  // is: it is background the agent reads first, not something the user said.
  const recall = renderUnfinishedTodoRecall(options.previousTurnTaskList);
  // Stated before everything else: a fresh session must learn what it is
  // continuing before it reads the directive telling it to continue.
  const continuationContext = renderResumeContinuationContext(
    options.resumeContinuationOriginalRequest,
  );
  const parts: string[] = [];
  if (continuationContext) parts.push(continuationContext);
  if (recall) parts.push(recall);
  if (!transition) {
    parts.push(body);
  } else if (skip) {
    // The transition block already embeds the trimmed `currentPrompt`
    // (the submitted form answers). On the resume path `body` IS
    // `currentPrompt`, so appending it would ship the answers twice
    // (issue #6239); the transition alone carries the whole turn.
    parts.push(transition);
  } else {
    parts.push(transition, '## Full conversation transcript', body);
  }
  // With no recall block this is byte-for-byte the pre-feature result in all
  // three branches — a conversation with nothing outstanding cannot shift a
  // single prompt byte (and so cannot move an upstream cache boundary).
  return parts.join('\n\n');
}

const PROJECT_PREVIEW_SCOPE_TTL_MS = 60 * 60 * 1000;
const PROJECT_PREVIEW_ASSET_PATH_RE = /^\/projects\/([^/]+)\/preview\/([^/]+)\/.+$/u;
const PROJECT_RUN_SCOPED_EXPORT_PATH_RE =
  /^\/projects\/[^/]+\/export(?:\/(?:pptx|pdf-image|image))?$/u;

function createProjectPreviewScopeRegistry() {
  const scopes = new Map();

  function pruneExpired(now = Date.now()) {
    for (const [scope, entry] of scopes) {
      if (entry.expiresAt <= now) scopes.delete(scope);
    }
  }

  // A scope is either one-shot or reusable, and the two must never be
  // confused. One-shot scopes belong to a single job that owns their whole
  // lifetime -- a screenshot/PDF export mints one for the render and `revoke`s
  // it in its `finally`. Reusable scopes belong to whatever live preview is
  // currently showing an artifact and are released only by expiry.
  //
  // The distinction has to live on the ENTRY, not on the call site: `acquire`
  // searches by (project, workspace), and an export shares that tuple with the
  // preview it runs alongside. Without a marker, a preview could adopt an
  // export's scope and lose it the moment that export finished.
  function create(projectId, options, reusable) {
    pruneExpired();
    const scope = randomUUID();
    const expiresAt = Date.now() + (options.ttlMs ?? PROJECT_PREVIEW_SCOPE_TTL_MS);
    scopes.set(scope, {
      projectId: String(projectId),
      reusable,
      expiresAt,
      // The expiry this scope's DOCUMENTS report, frozen at creation.
      // `expiresAt` floats as the client renews; anything embedded in a served
      // body must not, or the same artifact comes back with different bytes and
      // the iframe reloads. The host only needs this as the seed for its first
      // renewal — every renewal after that is driven by the renew response.
      documentExpiresAt: expiresAt,
    });
    return scope;
  }

  return {
    mint(projectId, options = {}) {
      return create(projectId, options, false);
    },
    // Reuse the live scope for this exact (project, workspace) instead of
    // minting a new one, and do NOT renew it while doing so. The preview
    // transport injects the scope into a `<base href>` AND serializes its
    // expiry into the bridge script, so anything that moves per request --
    // a fresh id or a bumped expiry -- makes the SAME artifact serve different
    // bytes every read: the web client rebuilds its srcDoc, React assigns a
    // new string, and the iframe reloads; the artifact visibly disappears and
    // comes back (OPEND-2283). `options.ttlMs` applies only to a scope this
    // call has to create; keeping one alive is `renew`'s job.
    //
    // Deliberately NOT folded into `mint`: export flows mint a scope and
    // `revoke` it when the render finishes, and sharing one id with a live
    // preview would revoke the preview out from under it. That is why only
    // entries this method created are eligible below -- see `create`.
    acquire(projectId, options = {}) {
      pruneExpired();
      const wantedProject = String(projectId);
      for (const [scope, entry] of scopes) {
        // A one-shot scope's owner will revoke it; adopting it here would let
        // that teardown blank a preview that is still using it.
        if (entry.reusable !== true) continue;
        if (entry.projectId !== wantedProject) continue;
        // Deliberately does NOT renew `expiresAt`. The expiry is serialized
        // into the bridge script of the document this scope is about to be
        // injected into, so bumping it here changes the served bytes on every
        // read -- which reloads the iframe just as surely as a fresh scope id
        // would, defeating the whole point of reusing one. Lifetime extension
        // has its own path: the client renews explicitly
        // (`x-pixo-preview-scope-renewal`), and that response is not a document.
        return scope;
      }
      return create(projectId, options, true);
    },
    revoke(scope) {
      scopes.delete(String(scope || ''));
    },
    /**
     * The expiry to embed in a served document. Stable for the scope's whole
     * life, unlike `expiresAt`, which renewal moves. JSON responses should
     * keep using `expiresAt`; only bodies whose bytes must not change use this.
     */
    documentExpiresAt(projectId, scope) {
      const key = String(scope || '');
      const entry = scopes.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        scopes.delete(key);
        return undefined;
      }
      if (entry.projectId !== String(projectId)) return undefined;
      return entry.documentExpiresAt ?? entry.expiresAt;
    },
    expiresAt(projectId, scope) {
      const key = String(scope || '');
      const entry = scopes.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        scopes.delete(key);
        return undefined;
      }
      if (entry.projectId !== String(projectId)) return undefined;
      return entry.expiresAt;
    },
    renew(projectId, scope, options = {}) {
      const key = String(scope || '');
      const entry = scopes.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        scopes.delete(key);
        return undefined;
      }
      if (entry.projectId !== String(projectId)) return undefined;
      entry.expiresAt = Date.now() + (options.ttlMs ?? PROJECT_PREVIEW_SCOPE_TTL_MS);
      return entry.expiresAt;
    },
    validate(projectId, scope) {
      const key = String(scope || '');
      const entry = scopes.get(key);
      if (!entry) return false;
      if (entry.expiresAt <= Date.now()) {
        scopes.delete(key);
        return false;
      }
      return entry.projectId === String(projectId);
    },
  };
}

function parseProjectPreviewAssetPath(pathname) {
  const match = PROJECT_PREVIEW_ASSET_PATH_RE.exec(String(pathname || ''));
  if (!match) return null;
  try {
    return {
      projectId: decodeURIComponent(match[1]),
      scope: match[2],
    };
  } catch {
    return null;
  }
}

function openNativeFolderDialog() {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    if (platform === 'darwin') {
      // `choose folder` is handled specially by the system: it presents a fully
      // interactive standard navigation panel that reliably takes key focus
      // (unlike a JXA-driven NSOpenPanel from background-only osascript, which
      // renders but can't be clicked). That standard panel already includes a
      // "New Folder" button in the bottom-left, so users can create a folder
      // inline without any extra wiring.
      execFile(
        'osascript',
        ['-e', 'POSIX path of (choose folder with prompt "Select a code folder to link")'],
        { timeout: 120_000 },
        (err, stdout) => {
          if (err) return resolve(null);
          const p = stdout.trim().replace(/\/$/, '');
          resolve(p || null);
        },
      );
    } else if (platform === 'linux') {
      execFile(
        'zenity',
        ['--file-selection', '--directory', '--title=Select a code folder to link'],
        { timeout: 120_000 },
        (err, stdout, stderr) => {
          try {
            resolve(parseLinuxFolderDialogResult(err, stdout, stderr));
          } catch (folderDialogError) {
            reject(folderDialogError);
          }
        },
      );
    } else if (platform === 'win32') {
      const command = buildWindowsFolderDialogCommand();
      execFile(command.command, command.args, { timeout: 120_000 }, (err, stdout) => {
        resolve(parseFolderDialogStdout(err, stdout));
      });
    } else {
      resolve(null);
    }
  });
}

/**
 * @param {ApiErrorCode} code
 * @param {string} message
 * @param {Omit<ApiError, 'code' | 'message'>} [init]
 */
function createSseErrorPayload(code, message, init = {}) {
  return { message, error: createCompatApiError(code, message, init) };
}

function rewriteKnownAgentStreamError(agentId, message, failureText = '') {
  const rawMessage =
    typeof message === 'string' && message.trim()
      ? message.trim()
      : 'Agent stream error';
  const combined = `${rawMessage}\n${failureText}`;
  if (
    /bufio\.scanner:\s*token too long/i.test(combined) &&
    /opencode/i.test(combined) &&
    (agentId === 'opencode' || usesBundledOpenCode(agentId))
  ) {
    return 'The run failed due to an unknown upstream streaming error. Please retry.';
  }
  return rawMessage;
}


fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      file.originalname = decodeMultipartFilename(file.originalname);
      const safe = sanitizeName(file.originalname);
      cb(
        null,
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`,
      );
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const importUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      file.originalname = decodeMultipartFilename(file.originalname);
      const safe = sanitizeName(file.originalname);
      cb(
        null,
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`,
      );
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const PLUGIN_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const pluginUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: PLUGIN_UPLOAD_MAX_BYTES,
    files: 500,
    fieldSize: 2 * 1024 * 1024,
  },
});

const pluginShareTaskStore = createPluginShareTaskStore({
  randomUUID,
  execCommandViaLoginShell,
  PIXO_NODE_BIN,
  PIXO_BIN,
});

// Project-scoped multi-file upload. Lands files directly in the project
// folder (flat — same shape FileWorkspace expects), so the composer's
// pasted/dropped/picked images become referenceable filenames the agent
// can Read or @-mention without any cross-folder gymnastics.
// Bridge between the multer upload-storage destination (built at module
// init) and the per-process project DB (instantiated inside startServer).
// startServer() sets this so the upload destination can route attachments
// into the right project root, including folder-imported projects whose
// files live under metadata.baseDir.
let projectMetadataLookup: ((id: string) => Record<string, unknown> | null) | null = null;

/** Reserve names in multipart order, even when directory preparation finishes out of order. */
function queueProjectUploadNaming(req) {
  const previous = req._uploadNamingTail ?? Promise.resolve();
  let release: () => void;
  req._uploadNamingTail = new Promise<void>((resolve) => { release = resolve; });
  return { previous, release: () => release() };
}

const projectUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      const naming = queueProjectUploadNaming(req);
      try {
        // Route uploads into the project's actual root: for folder-imported
        // projects (metadata.baseDir set) attachments need to land alongside
        // the user's files so the agent can read them via the same path
        // it sees. projectMetadataLookup is populated at startServer() boot
        // and keyed by project id; null fallback gives the standard
        // .pixo/projects/<id>/ behavior for non-imported projects.
        const meta = projectMetadataLookup?.(req.params.id) ?? null;
        // Optional `dir` form field (sent BEFORE the file parts by the web
        // client) routes uploads into a subfolder, so files dropped/picked
        // while viewing a folder land there instead of the project root. The
        // sanitized relative dir is stashed on the request so the route can
        // report each file's true project-relative path.
        const subdir = typeof req.body?.dir === 'string' ? req.body.dir : '';
        const { absDir, relDir } = await ensureProjectSubdir(
          PROJECTS_DIR,
          req.params.id,
          subdir,
          meta,
        );
        // Multer invokes filename synchronously from this callback. Keep
        // directory I/O concurrent, but let earlier file parts reserve first.
        await naming.previous;
        (req as any)._uploadRelDir = relDir;
        (req as any)._uploadAbsDir = absDir;
        cb(null, absDir);
      } catch (err) {
        await naming.previous;
        cb(err, '');
      } finally {
        naming.release();
      }
    },
    filename: (req, file, cb) => {
      // multer@1 hands us latin1-decoded multipart filenames; restore the
      // original UTF-8 so the response (and the on-disk name) preserves
      // non-ASCII characters instead of mangling them. Then run the shared
      // sanitiser and only add a suffix when that sanitized source name
      // would collide with an existing or same-batch upload.
      file.originalname = decodeMultipartFilename(file.originalname);
      const safe = sanitizeName(file.originalname);
      const uploadDir = typeof (req as any)._uploadAbsDir === 'string' ? (req as any)._uploadAbsDir : '';
      const reserved = (req as any)._uploadReservedNames instanceof Set
        ? (req as any)._uploadReservedNames
        : ((req as any)._uploadReservedNames = new Set());
      cb(null, uniqueUploadFileName(uploadDir, safe, reserved));
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },  // 200MB — covers the largest design assets we expect (PPTX/PDF/raw images)
});

function uniqueUploadFileName(uploadDir, safeName, reserved) {
  const parsed = path.parse(safeName);
  const base = parsed.name || parsed.base || 'file';
  const ext = parsed.ext || '';
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = index === 0 ? safeName : `${base}-${index}${ext}`;
    if (reserved.has(candidate)) continue;
    if (uploadDir && fs.existsSync(path.join(uploadDir, candidate))) continue;
    reserved.add(candidate);
    return candidate;
  }
  const fallback = `${base}-${Date.now().toString(36)}${ext}`;
  reserved.add(fallback);
  return fallback;
}

function handleProjectUpload(req, res, next) {
  projectUpload.array('files', 12)(req, res, (err) => {
    if (err) {
      return sendMulterError(res, err);
    }
    next();
  });
}

function sendMulterError(res, err) {
  if (err instanceof multer.MulterError) {
    const code = err.code || 'UPLOAD_ERROR';
    const statusByCode = {
      LIMIT_FILE_SIZE: 413,
      LIMIT_FILE_COUNT: 400,
      LIMIT_UNEXPECTED_FILE: 400,
      LIMIT_PART_COUNT: 400,
      LIMIT_FIELD_KEY: 400,
      LIMIT_FIELD_VALUE: 400,
      LIMIT_FIELD_COUNT: 400,
      MISSING_FIELD_NAME: 400,
    };
    const errorByCode = {
      LIMIT_FILE_SIZE: 'file too large',
      LIMIT_FILE_COUNT: 'too many files',
      LIMIT_UNEXPECTED_FILE: 'unexpected file field',
      LIMIT_PART_COUNT: 'too many form parts',
      LIMIT_FIELD_KEY: 'field name too long',
      LIMIT_FIELD_VALUE: 'field value too long',
      LIMIT_FIELD_COUNT: 'too many form fields',
      MISSING_FIELD_NAME: 'missing field name',
    };
    const status = statusByCode[code] ?? 400;
    const message = errorByCode[code] ?? 'upload failed';
    return sendApiError(
      res,
      status,
      code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
      message,
      { details: { legacyCode: code } },
    );
  }

  if (err) {
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'upload failed');
  }

  return sendApiError(res, 500, 'INTERNAL_ERROR', 'upload failed');
}

export function createSseResponse(
  res,
  { keepAliveIntervalMs = SSE_KEEPALIVE_INTERVAL_MS } = {},
) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const canWrite = () => !res.destroyed && !res.writableEnded;
  const writeKeepAlive = () => {
    if (canWrite()) {
      res.write(': keepalive\n\n');
      return true;
    }
    return false;
  };

  let heartbeat = null;
  if (keepAliveIntervalMs > 0) {
    heartbeat = setInterval(writeKeepAlive, keepAliveIntervalMs);
    heartbeat.unref?.();
  }

  const cleanup = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  res.on('close', cleanup);
  res.on('finish', cleanup);

  return {
    /** @param {ChatSseEvent['event'] | ProxySseEvent['event'] | string} event */
    send(event, data, id: string | number | null | undefined = null) {
      if (!canWrite()) return false;
      // Assemble the full SSE event into a single write so id/event/data land
      // in one TCP chunk. Three separate writes would let `event: <type>` flush
      // ahead of the `data:` payload, which produces partial events for
      // consumers that read chunk-by-chunk (e.g. tests using a Response body
      // reader with a substring marker).
      const idLine = id !== null && id !== undefined ? `id: ${id}\n` : '';
      res.write(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    },
    writeKeepAlive,
    cleanup,
    end() {
      cleanup();
      if (canWrite()) {
        res.end();
      }
    },
  };
}

export type DesktopPdfExporter = (input: DesktopExportPdfInput) => Promise<DesktopExportPdfResult>;
export type DesktopFrameRenderer = (input: DesktopRenderFramesInput) => Promise<DesktopRenderFramesResult>;
export type DesktopSlideRenderer = (input: DesktopRenderSlidesInput) => Promise<DesktopRenderSlidesResult>;
export type DesktopArtifactExporter = (input: DesktopExportArtifactInput) => Promise<DesktopExportArtifactResult>;

// Loosely typed shape — we only access `namespace`, `base`, `mode`, and
// `source` from the runtime context when building the diagnostics export.
// Anything richer would force a dependency from server.ts into the sidecar
// package, which the boundary checks explicitly forbid.
export interface DaemonRuntimeContext {
  namespace: string;
  base: string;
  mode?: string;
  source?: string;
}

export interface StartServerOptions {
  captureGameWeb?: RegisterGameVerifyRoutesDeps['captureGameWeb'];
  desktopArtifactExporter?: DesktopArtifactExporter | null;
  desktopFrameRenderer?: DesktopFrameRenderer | null;
  desktopPdfExporter?: DesktopPdfExporter | null;
  desktopSlideRenderer?: DesktopSlideRenderer | null;
  host?: string;
  port?: number;
  returnServer?: boolean;
  runtime?: DaemonRuntimeContext | null;
  staticDir?: string;
  /** Opaque child-process environment supplied by the runtime integration seam. */
  inheritedEnvironment?: (baseEnv?: NodeJS.ProcessEnv) => Record<string, string>;

}


export interface StartServerResult {
  url: string;
  server: import('node:http').Server;
  shutdown: () => Promise<void> | void;
  routeInventory: import('./route-registration-guard.js').RouteRegistration[];
}

/** Production callback shared by the registered comment routes and HTTP regression tests. */

export async function startServer({
  port = 7456,
  host = normalizeDaemonBindHost(process.env.PIXO_BIND_HOST),
  returnServer = false,
  desktopPdfExporter = null,
  desktopFrameRenderer = null,
  desktopSlideRenderer = null,
  desktopArtifactExporter = null,
  captureGameWeb = null,
  runtime = null,
  staticDir = STATIC_DIR,
  inheritedEnvironment = () => ({}),
}: StartServerOptions = {}) {
  host = normalizeDaemonBindHost(host);
  let resolvedPort = port;
  let daemonShuttingDown = false;
  const extraAllowedOrigins = configuredAllowedOrigins();

  // Plan §3.K1 / spec §15.7 — bound-API-token guard.
  //
  // The daemon refuses to bind to a public interface unless an
  // PIXO_API_TOKEN is set. This is the spec §16 Phase 5 safety floor:
  // a hosted operator can no longer accidentally publish an unsecured
  // daemon by setting PIXO_BIND_HOST=0.0.0.0 without a token.
  //
  // Loopback hosts (127.0.0.1 / ::1 / localhost) are always allowed —
  // the desktop / dev flow remains unchanged. Setting PIXO_API_TOKEN is
  // purely additive: when present, every /api/* request must carry a
  // matching Bearer token or browser Basic credentials (loopback origins
  // are exempted so the desktop UI keeps working).
  const apiToken = apiTokenFromEnv();
  const apiAuthDisabled = isApiAuthDisabled();
  const apiTokenAuthEnabled = apiToken.length > 0 && !apiAuthDisabled;
  const isApiTokenAuthorization = (authorization: string | undefined): boolean =>
    apiTokenAuthEnabled && apiTokenAuthorizationMatches(authorization, apiToken);
  if (!isLoopbackHostname(host) && apiToken.length === 0 && !apiAuthDisabled) {
    throw new Error(
      `PIXO_BIND_HOST=${host} requires PIXO_API_TOKEN to be set. ` +
      `Generate one with \`openssl rand -hex 32\` and re-launch. ` +
      `(Loopback hosts 127.0.0.1 / ::1 / localhost do not need a token.) ` +
      `Set PIXO_DISABLE_API_AUTH=1 only when a trusted reverse proxy already authenticates every request.`,
    );
  }

  cleanupRuntimeExtensionsAfterDaemonRestart(path.join(RUNTIME_DATA_DIR, 'runs'));
  // Agent CLIs a previous daemon spawned and never saw finish (it died without
  // running any shutdown path) keep running until this point. Verify them by
  // OS identity and terminate them first thing, in the background: for as
  // long as a leftover runs it may be editing the project unsupervised.
  void reapLeftoverAgentProcesses({ runsLogDir: path.join(RUNTIME_DATA_DIR, 'runs') })
    .then((result) => {
      const unverified = result.skipped.filter((entry) => entry.verdict === 'unverifiable');
      if (result.reaped.length > 0 || unverified.length > 0 || result.stagedPromptsRemoved > 0) {
        console.warn('[runs] leftover agent processes from a previous daemon', {
          reaped: result.reaped,
          unverified,
          stagedPromptsRemoved: result.stagedPromptsRemoved,
        });
      }
    })
    .catch((error) => {
      console.warn('[runs] leftover agent process reap failed', error);
    });

  const app = express();
  installRouteRegistrationGuard(app);
  // A chat-scroll forensics capture carries the chat log's full `outerHTML`,
  // and the envelope carries two of them (`live` + `retained`), each truncated
  // renderer-side at 8MB. Register its parser before the global parser, which
  // would otherwise read and refuse the body. The endpoint collects the
  // longest transcripts, so leaving it on the 4mb ceiling made it blind to
  // exactly the incidents it was built for, and silently: the uploader reports
  // `res.ok` and the export continues without the evidence.
  app.use(CHAT_SCROLL_FORENSICS_PATH, chatScrollForensicsBodyParser);
  const openPixoAccount = new OpenPixoAccountService({ dataRoot: RUNTIME_DATA_DIR, port: () => resolvedPort });
  const openPixoAgentGateway = new OpenPixoAgentGateway(openPixoAccount);
  setOpenPixoAgentCatalogReader(() => openPixoAccount.agentModels());
  // Relays raw bytes, so it must see the body before the global JSON parser does.
  registerOpenPixoAgentProxy(app, { gateway: openPixoAgentGateway });
  // Game pages on a dev-server origin call it, so it sits ahead of the API origin guard with its own loopback rule.
  const localRoomsRelay = registerLocalRoomsRelay(app);
  const onlineEmulator = new OnlineEmulator({ dataDir: RUNTIME_DATA_DIR });
  registerLocalOnlineEmulator(app, { emulator: onlineEmulator, hasProject: projectId => Boolean(getProject(db, projectId)) });
  app.use(express.json({ limit: '4mb', verify: captureJsonBodySize }));
  registerOpenPixoAccountCallback(app, { account: openPixoAccount });
  const projectPreviewScopes = createProjectPreviewScopeRegistry();

  // Plan §3.K1 — API-token middleware.
  //
  // Active only when PIXO_API_TOKEN is set and API auth is not disabled.
  // Loopback origins skip the check (the desktop UI / local CLI never carry
  // credentials); every other request must present a matching bearer token
  // (CLI / proxy) or matching HTTP Basic credentials (browser UI). A currently
  // valid run-scoped token may pass only an exact screenshot-export endpoint;
  // its route rechecks the operation and project. Health / readiness / version
  // remain open. Server-minted project preview asset scopes are also accepted
  // for GETs so sandboxed
  // browser iframes can load HTML/CSS/JS without privileged headers.
  // Rich daemon status stays authenticated because it includes local
  // runtime paths.
  if (apiTokenAuthEnabled) {
    const openProbePaths = new Set([
      '/health',
      '/api/health',
      '/ready',
      '/api/ready',
      '/version',
      '/api/version',
    ]);
    app.use('/api', (req, res, next) => {
      if (openProbePaths.has(req.path)) return next();
      if (req.method === 'GET') {
        const previewAsset = parseProjectPreviewAssetPath(req.path);
        if (
          previewAsset &&
          projectPreviewScopes.validate(previewAsset.projectId, previewAsset.scope)
        ) {
          return next();
        }
      }
      // Loopback short-circuit. We ignore the proxied X-Forwarded-For
      // header here because a reverse proxy MUST always forward the
      // credentials; the loopback bypass exists for the localhost desktop
      // UI which has no proxy in the path.
      if (isLoopbackPeerAddress(req.socket?.remoteAddress)) return next();
      if (apiTokenAuthorizationMatches(req.get('authorization'), apiToken)) return next();
      if (
        req.method === 'POST'
        && PROJECT_RUN_SCOPED_EXPORT_PATH_RE.test(req.path)
        && toolTokenRegistry.validate(bearerTokenFromRequest(req), {
          endpoint: PROJECT_EXPORT_TOOL_ENDPOINT,
          operation: 'project:export',
        }).ok
      ) {
        return next();
      }
      res.setHeader('WWW-Authenticate', API_TOKEN_BASIC_CHALLENGE);
      return res.status(401).json({
        error: {
          code: 'API_TOKEN_REQUIRED',
          message: 'Authorization: Bearer <PIXO_API_TOKEN> or browser Basic authentication required',
        },
      });
    });

    // Docker Desktop forwards host-browser traffic across its bridge, so the
    // daemon correctly sees a non-loopback peer. Challenge the SPA document
    // navigation before serving any shell bytes; browsers then cache the Basic
    // credentials for same-origin /api requests. Static assets do not need a
    // separate challenge because the authenticated shell is the only entry
    // point and API routes still enforce credentials independently.
    app.use((req, res, next) => {
      if (isLoopbackPeerAddress(req.socket?.remoteAddress)) return next();
      if (resolveStaticSpaFallbackPath(req, staticDir) === null) return next();
      if (apiTokenAuthorizationMatches(req.get('authorization'), apiToken)) return next();

      res.setHeader('WWW-Authenticate', API_TOKEN_BASIC_CHALLENGE);
      return res.status(401).type('text/plain').send(
        'OpenPixo authentication required. Use username "openpixo" and PIXO_API_TOKEN as the password.',
      );
    });
  }

  const { listAllSkills, listAllTemplates, listAllSkillLikeEntries, validateProjectSkillId } = createSkillCatalog({
    roots: { skillRoots: SKILL_ROOTS, templateRoots: DESIGN_TEMPLATE_ROOTS, allRoots: ALL_SKILL_LIKE_ROOTS },
    skills: { listSkills, findSkillById },
  });

  // Chrome may strip the port from the Origin header on same-origin GET
  // requests. Only use this as a fallback for safe, idempotent GET requests;
  // mutating routes always require an exact origin/host match.
  function isPortlessLoopbackOrigin(origin) {
    return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])$/.test(origin);
  }

  function reportHostForPoweredPreview(): string {
    return host === '0.0.0.0' || host === '::' || host === '[::]' || host === '::1'
      ? '127.0.0.1'
      : host;
  }

  function poweredPreviewHost(): string | null {
    const reportHost = reportHostForPoweredPreview();
    if (reportHost === '127.0.0.1') return 'localhost';
    if (reportHost === 'localhost') return '127.0.0.1';
    return null;
  }

  // Routes that serve content to sandboxed iframes (Origin: null) for
  // read-only purposes.  All other /api routes reject Origin: null.
  const _NULL_ORIGIN_SAFE_GET_RE =
    /^\/projects\/[^/]+\/(?:raw|preview)\/|^\/asset-cache$/;
  const _POWERED_PREVIEW_SAFE_RE = /^\/projects\/[^/]+\/powered\/.+$/u;

  // Reserve project preview hosts before API exceptions and static serving.
  app.use((req, res, next) => {
    const projectPreviewDecision = projectPoweredPreviewOriginDecision(req, resolvedPort);
    if (projectPreviewDecision === 'reject') {
      return res.status(403).json({
        error: 'Powered preview origin cannot access this API route',
      });
    }
    res.locals.projectPoweredPreview = projectPreviewDecision === 'allow';
    next();
  });

  // Reject cross-origin requests to API endpoints. Normal non-browser
  // clients (no Origin header) retain their existing access.
  app.use('/api', (req, res, next) => {
    if (res.locals.projectPoweredPreview === true) return next();

    const poweredHost = poweredPreviewHost();
    if (poweredHost && resolvedPort) {
      const requestHost = parseHostHeader(req.headers.host);
      const fetchMetadataPresent =
        req.headers['sec-fetch-site'] != null ||
        req.headers['sec-fetch-mode'] != null ||
        req.headers['sec-fetch-dest'] != null;
      const poweredReferer = (() => {
        const raw = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer;
        if (typeof raw !== 'string' || raw.length === 0) return false;
        try {
          const parsed = new URL(raw);
          return parsed.hostname === poweredHost &&
            (parsed.port || (parsed.protocol === 'https:' ? '443' : '80')) === String(resolvedPort) &&
            /^\/api\/projects\/[^/]+\/powered\/.+/u.test(parsed.pathname);
        } catch {
          return false;
        }
      })();
      const isPoweredPreviewBrowserRequest =
        requestHost?.hostname === poweredHost &&
        requestHost.port === String(resolvedPort) &&
        (fetchMetadataPresent || poweredReferer);
      if (isPoweredPreviewBrowserRequest && !_POWERED_PREVIEW_SAFE_RE.test(req.path)) {
        return res.status(403).json({
          error: 'Powered preview origin cannot access this API route',
        });
      }
    }

    const origin = req.headers.origin;
    // Non-browser client → allow.
    if (origin == null || origin === '') return next();

    // Origin: null (sandboxed iframes).  Only allowed for safe, read-only
    // routes that set their own CORS headers for canvas drawing.
    if (origin === 'null') {
      const isSafeReadOnly =
        req.method === 'GET' && _NULL_ORIGIN_SAFE_GET_RE.test(req.path);
      if (!isSafeReadOnly) {
        return res.status(403).json({ error: 'Origin: null not allowed for this route' });
      }
      return next();
    }

    // Fail-closed: block all browser origins until port is resolved.
    if (!resolvedPort) {
      return res.status(403).json({ error: 'Server initializing' });
    }

    const ports = allowedBrowserPorts(resolvedPort);
    if (!isAllowedBrowserOrigin(origin, req.headers.host, ports, host, extraAllowedOrigins)) {
      if (req.method !== 'GET' || !isPortlessLoopbackOrigin(String(origin))) {
        return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
      }
    }
    next();
  });
  // Heap/SQLite health: begun before the first SQLite open so a daemon that
  // dies seconds into startup still leaves a checkpoint for the next boot.
  const daemonHealth = beginDaemonHealthSession({
    dataRoot: RUNTIME_DATA_DIR,
    previousLogPath: resolveDaemonPreviousLogPath(runtime),
  });
  const db = openDatabase(PROJECT_ROOT, { dataDir: RUNTIME_DATA_DIR });
  daemonHealth?.setStorageProbe(() => readSqlitePageStats({ db, file: db.name }));
  const pluginInstallation = createPluginInstallationHelpers({
    db,
    installFromLocalFolder,
    PLUGIN_REGISTRY_ROOTS,
    PLUGIN_LOCKFILE_PATH,
    PLUGIN_UPLOAD_MAX_BYTES,
  });
  const mediaTaskStore = createMediaTaskStore(db, {
    isRunActive: (runId) => toolTokenRegistry.activeRunTokenCount(runId) > 0,
  });
  const {
    authorizeToolRequest,
    optionalToolGrantFromRequest,
    requestProjectOverride,
    requestRunOverride,
  } = createToolRequestAuth(toolTokenRegistry);
  // Wire the upload-destination bridge to this db so multer can route
  // file uploads into baseDir-rooted projects' actual folders.
  projectMetadataLookup = (id) => {
    try { return getProject(db, id)?.metadata ?? null; } catch { return null; }
  };
  let daemonUrl = `http://127.0.0.1:${port}`;
  const openPixoHosted = new OpenPixoHostedMedia({
    db, cloud: openPixoAccount, projectsRoot: PROJECTS_DIR,
    getProjectMetadata: (id) => getProject(db, id)?.metadata,
    tasks: mediaTaskStore,
  });
  const artBudgetLedger = new ArtBudgetLedger(db);
  openPixoHosted.attachSettlement(artBudgetLedger);
  const mediaReconcile = reconcileMediaTasksOnBoot(db, {
    terminalTtlMs: TASK_TTL_AFTER_DONE_MS,
    preserveTaskIds: pendingHostedTaskIds(db),
  });
  if (mediaReconcile.interrupted > 0 || mediaReconcile.deleted > 0) {
    console.warn(
      `[media] reconcileMediaTasksOnBoot interrupted ${mediaReconcile.interrupted} task(s), ` +
        `deleted ${mediaReconcile.deleted} expired terminal task(s)`,
    );
  }
  mediaTaskStore.mediaTasks.clear();
  for (const row of listRecentMediaTasks(db, { terminalTtlMs: TASK_TTL_AFTER_DONE_MS })) {
    mediaTaskStore.hydrateMediaTask(row);
  }
  // Paid cloud jobs outlive a restart: query the cloud again rather than report them interrupted.
  openPixoHosted.resumePending();

  // Chat-artifact snapshot maintenance: one pass now, then a pass per period
  // for as long as the daemon lives. Blob-store initialization is deliberately
  // separate from the SQLite migration and never blocks startup: a broken
  // snapshot store must degrade the cards, not the daemon.
  //
  // The period defaults to 0 (boot-only, today's behaviour) because no period
  // has been ruled on yet — see `resolveChatArtifactMaintenanceIntervalMs`.
  const chatArtifactMaintenance = startChatArtifactMaintenance({
    db,
    blobs: CHAT_ARTIFACT_BLOBS,
    quota: CHAT_ARTIFACT_QUOTA,
    resolveSourcePath: (projectId, relativePath) => {
      try {
        const project = getProject(db, projectId);
        const dir = resolveProjectDir(PROJECTS_DIR, projectId, project?.metadata);
        return path.join(dir, relativePath.split('/').join(path.sep));
      } catch {
        return null;
      }
    },
    gcDryRun: process.env.PIXO_CHAT_ARTIFACT_GC !== '1',
    intervalMs: resolveChatArtifactMaintenanceIntervalMs(process.env),
  });

  if (process.env.PIXO_CODEX_DISABLE_PLUGINS === '1') {
    console.log('[pixo] Codex plugins disabled via PIXO_CODEX_DISABLE_PLUGINS=1');
  }

  let bundledMarketplaceEntries = [];
  // Plan §3.I3 / spec §23.3.5 — register every plugin under
  // <resourceRoot>/plugins/_official/** in packaged runs, or
  // <projectRoot>/plugins/_official/** in workspace runs, as bundled plugins. The walker
  // is idempotent (upserts on every boot) so a daemon upgrade rotates
  // the bundled set in lockstep with the code. ENOENT is silent —
  // running the daemon outside the dev tree just skips this step.
  try {
    const result = await registerBundledPlugins({
      db,
      bundledRoot: BUNDLED_PLUGINS_DIR,
      marketplaceProvenance: {
        sourceMarketplaceId: OFFICIAL_MARKETPLACE_ID,
        marketplaceTrust:    'official',
        entryNamePrefix:     'openpixo',
      },
    });
    bundledMarketplaceEntries = result.registered.map((plugin) => ({
      name:        `openpixo/${plugin.id}`,
      title:       plugin.title,
      title_i18n:  plugin.manifest.title_i18n,
      description: plugin.manifest.description,
      description_i18n: plugin.manifest.description_i18n,
      version:     plugin.version,
      source:      bundledPluginRegistrySource(plugin.source),
      publisher:   { id: 'openpixo' },
      homepage:    plugin.manifest.homepage,
      license:     plugin.manifest.license,
      tags:        plugin.manifest.tags,
      capabilitiesSummary: Array.isArray(plugin.manifest.pixo?.capabilities)
        ? plugin.manifest.pixo.capabilities
        : undefined,
    }));
    if (result.registered.length > 0) {
      console.log(`[plugins] registered ${result.registered.length} bundled plugin(s)`);
    }
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.warn(`[plugins] bundled warn: ${w}`);
    }
  } catch (err) {
    console.warn(`[plugins] bundled registration failed: ${(err)?.message ?? err}`);
  }

  try {
    const { ensureMarketplaceManifest } = await import('./plugins/marketplaces.js');
    const seedDirs = await fs.promises.readdir(PLUGIN_REGISTRY_DIR, { withFileTypes: true }).catch((err) => {
      if (err?.code === 'ENOENT') return [];
      throw err;
    });
    for (const dirent of seedDirs) {
      if (!dirent.isDirectory()) continue;
      const id = dirent.name;
      const manifestText = await marketplaceSeedManifestText(id, bundledMarketplaceEntries);
      if (!manifestText) continue;
      const configured = defaultMarketplaceSeedConfig(id);
      const result = ensureMarketplaceManifest(db, {
        id,
        url: configured.url,
        trust: configured.trust,
        manifestText,
      });
      if (result.ok) {
        console.log(`[plugins] seeded ${id} registry source (${result.row.manifest.plugins.length} plugin(s))`);
      } else {
        console.warn(`[plugins] ${id} registry seed failed: ${result.message}`);
      }
    }
  } catch (err) {
    console.warn(`[plugins] registry seed failed: ${(err)?.message ?? err}`);
  }

  // Plan §3.A5 / spec §16 Phase 5 / PB2: periodic snapshot GC. Disabled
  // when PIXO_SNAPSHOT_GC_INTERVAL_MS is 0; otherwise one-time bootstrap
  // sweep + interval. The function returns a NOOP_HANDLE when disabled
  // so we don't have to branch on the result.
  const snapshotGc = startSnapshotGc({ db });
  // One immediate sweep so a daemon that just gained the ALTER doesn't
  // wait the full interval before reaping pre-existing expired rows.
  try {
    const initialSweep = pruneExpiredSnapshots(db);
    if (initialSweep.removed > 0) {
      console.log(`[plugins] snapshot GC startup sweep removed ${initialSweep.removed} row(s)`);
    }
  } catch (err) {
    console.warn(`[plugins] snapshot GC startup sweep failed: ${(err)?.message ?? err}`);
  }
  void snapshotGc; // keep handle alive for the daemon's lifetime

  // Warm the full agent snapshot (versions, capabilities, models and auth)
  // asynchronously. Picker and run reads share these probes; later expired
  // reads return stale entries while revalidation runs off the request path.
  void readAppConfig(RUNTIME_DATA_DIR)
    .then((config) => {

      return detectAgents(config.agentCliEnv ?? {});
    })
    .catch(() => detectAgents().catch(() => {}));

  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
  }

  // ---- Projects (DB-backed) -------------------------------------------------


  const publicFileMutations = createProjectMutations();
  const telemetry = registerTelemetryRoutes(app, {
    dataDir: RUNTIME_DATA_DIR,
    namespace: runtime?.namespace,
    readAppConfig,
    writeAppConfig,
  });
  const resolvedAppVersionInfo = normalizeTelemetryAppVersionInfo(
    await telemetry.resolveAppVersion(),
  );
  const currentAppVersionInfo = () =>
    normalizeTelemetryAppVersionInfo(telemetry.getCachedAppVersion())
    ?? resolvedAppVersionInfo;
  const currentAppVersion = () =>
    currentAppVersionInfo()?.version ?? UNKNOWN_APP_VERSION;
  const { analyticsService } = telemetry;
  const codexThreadCleanupOwner = createCodexThreadCleanupOwner();
  const design = {
    runs: createChatRunService({
      createSseResponse,
      createSseErrorPayload,
      runsLogDir: path.join(RUNTIME_DATA_DIR, 'runs'),
      getAppVersionInfo: currentAppVersionInfo,
      onEventEmitted: (run, record) => {
        if (!run.sideEffectLedger) run.sideEffectLedger = createRunSideEffectLedger();
        foldEventIntoRunSideEffectLedger(run.sideEffectLedger, record);
        if (!run.perRequestUsageLedger) run.perRequestUsageLedger = createRunPerRequestUsageLedger();
        foldEventIntoPerRequestUsageLedger(run.perRequestUsageLedger, record);
      },
      beforeFinish: (run, status, _code, _signal, terminalAt) => {
        if (run.deliverableSyntaxValidation?.metrics) {
          run.deliverableSyntaxValidation = {
            ...run.deliverableSyntaxValidation,
            metrics: recordDeliverableSyntaxDelivery({
              previous: run.deliverableSyntaxValidation.metrics,
              terminalAtMs: terminalAt,
            }),
          };
        }
        if (status !== 'failed' && status !== 'canceled') return;
      },
    }),
    analytics: analyticsService,
    getAppVersion: currentAppVersion,
    readAnalyticsContext,
  };
  // Interactive Terminal sessions (node-pty). In-memory, process-local, and
  // killed on daemon shutdown — see shutdownDaemonRuns below.
  const terminalService = createTerminalService();

  // Every physical Run is started through this service so the analytics
  // lifecycle is installed once, for whoever asked for the Run — an HTTP
  // client, a retired Next-strategy automatic continuation, a scheduled Automation, or a
  // live-artifact refresh. Starting a Run any other way drops its analytics
  // silently, which is what OPEND-2365 was.
  const runAnalyticsLifecycle = createRunAnalyticsLifecycle({
    db,
    design,
    paths: { PROJECTS_DIR, RUNTIME_DATA_DIR },
    agents: { detectAgents },
    telemetry: {
      resolveRunProjectKindForAnalytics,
      runArtifactBaselines,
      runRetryEventsForAnalytics,
    },
  });
  const internalRunCreation = createInternalRunCreationService({
    runs: design.runs,
    claimAssistantMessage: (run, options) =>
      pinAssistantMessageOnRunCreate(db, run, options),
    analyticsLifecycle: runAnalyticsLifecycle,
    checkpointRun: createRunCheckpointHook({ projectDirectory: checkpointProjectDirectoryResolver({ db, PROJECTS_DIR }), store: (projectId) => checkpointStore(RUNTIME_DATA_DIR, projectId), runs: design.runs }),
  });
  // Runs are process-local, but their terminal obligations are durable. On a
  // fresh daemon boot, repair stale message rows and replay any PostHog or
  // Run analytics terminal work whose checkpoint was not committed. Network work
  // stays off the startup critical path.
  void reconcileDurableRunTerminals({
    analytics: analyticsService,
    appVersion: currentAppVersion(),
    appVersionInfo: currentAppVersionInfo(),
    db,
    runsLogDir: path.join(RUNTIME_DATA_DIR, 'runs'),
  }).then(async (reconciled) => {
    if (reconciled.interrupted > 0 || reconciled.messagesReconciled > 0) {
      console.warn('[runs] reconciled interrupted run terminals', reconciled);
    }
  }).catch((error) => {
    console.warn('[runs] terminal reconciliation failed', error);
  });

  // DNS-aware wrapper. The sync `validateBaseUrl` only inspects the literal
  // hostname string, so a public DNS name pointing at an internal address
  // (`internal.example.com → 10.0.0.5`) still passes. We delegate to
  // `validateBaseUrlResolved` here so every proxy and finalize handler runs
  // the same resolved-IP check before issuing the upstream request.
  const validateExternalApiBaseUrl = (baseUrl) => validateBaseUrlResolved(baseUrl);

  const resolvedPortRef = {
    get current() {
      return resolvedPort;
    },
  };
  const daemonUrlRef = {
    get current() {
      return daemonUrl;
    },
  };
  const httpDeps = {
    sendApiError,
    sendMulterError,
    createSseResponse,
    getPublicBaseUrl,
    requireLocalDaemonRequest,
    isLocalSameOrigin,
    resolvedPortRef,
  };
  const attributionService = registerAttributionRoutes(app, {
    analytics: analyticsService,
    appConfig: { readAppConfig },
    http: httpDeps,
    paths: { RUNTIME_DATA_DIR },
    env: process.env,
  });
  const pathDeps = {
    PROJECT_ROOT,
    PLUGIN_REGISTRY_DIR,
    PROJECTS_DIR,
    ARTIFACTS_DIR,
    RUNTIME_DATA_DIR,
    RUNTIME_DATA_DIR_CANONICAL,
    DESIGN_TEMPLATES_DIR,
    USER_DESIGN_TEMPLATES_DIR,
    SKILLS_DIR,
    USER_SKILLS_DIR,
    SKILL_ROOTS,
    PROMPT_TEMPLATES_DIR,
    PIXO_BIN,
  };

  app.get('/api/health', async (_req, res) => {
    const versionInfo = await readCurrentAppVersionInfo();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      version: versionInfo.version,
    });
  });

  app.get('/api/ready', async (_req, res) => {
    const versionInfo = await readCurrentAppVersionInfo();
    const ready = !daemonShuttingDown;
    res.status(ready ? 200 : 503).json({
      ok: ready,
      ready,
      version: versionInfo.version,
    });
  });

  app.get('/api/version', async (_req, res) => {
    const version = await readCurrentAppVersionInfo();
    // Now that this payload carries a runtime capability it is no longer a
    // near-static fact about the build: the same URL answers differently
    // depending on which daemon is behind it. A cached response therefore
    // outlives the daemon that produced it, and a stale `slideRenderer: true`
    // is consumed as authoritative — reopening the export the gate exists to
    // hide. Must not be cached anywhere.
    res.setHeader('Cache-Control', 'no-store');
    // Runtime capabilities ride along on the version payload rather than a
    // dedicated endpoint: this is already the "what runtime am I talking to"
    // channel (packaged/channel/platform/arch), the web fetches it once at
    // boot, and computing the flag from the very binding the export routes
    // guard on means the advertisement cannot drift from the 501 they return.
    res.json({
      version: {
        ...version,
        capabilities: { slideRenderer: typeof desktopSlideRenderer === 'function' },
      },
    });
  });

  // Powered-preview isolation info. Reports the daemon's own directly-reachable
  // http origin so the web host can render WebGL/Worker/WASM/SharedArrayBuffer
  // artifacts in a cross-origin-isolated iframe (see the /powered route and
  // apps/web/src/runtime/powered-preview.ts). The web host derives a separate
  // loopback hostname per project; the /api origin middleware reserves each
  // hostname for that project's powered GETs.
  app.get('/api/preview/isolation', (_req, res) => {
    const reportHost = reportHostForPoweredPreview();
    const baseOrigin = resolvedPort ? `http://${reportHost}:${resolvedPort}` : null;
    res.setHeader('Cache-Control', 'no-store');
    /** @type {import('@openpixo/contracts').ProjectPreviewIsolationResponse} */
    const body = {
      supported: Boolean(baseOrigin),
      projectOrigins: true,
      baseOrigin,
      pathPrefix: 'powered',
    };
    res.json(body);
  });

  registerDaemonRoutes(app, {
    db,
    paths: {
      PROJECT_ROOT,
      RESOURCE_ROOT: DAEMON_RESOURCE_ROOT ?? PROJECT_ROOT,
      RUNTIME_DATA_DIR,
    },
    http: { requireLocalDaemonRequest, sendApiError },
    host,
    getResolvedPort: () => resolvedPort,
    getDaemonShuttingDown: () => daemonShuttingDown,
    sandboxRuntime: SANDBOX_RUNTIME,
    env: process.env,
  });

  registerWhatsNewRoutes(app, {
    whatsNew: createWhatsNewService(),
  });

  registerPluginEventRoutes(app, {
    http: { requireLocalDaemonRequest, sendApiError },

    plugins: {
      listVisiblePluginIds: async () => new Set(
        listInstalledPlugins(db)
          .map((plugin) => plugin.id),
      ),
    },
  });


  // Gate the diagnostics export behind requireLocalDaemonRequest so it stays
  // unreachable when daemon binds to a non-loopback address (Tailscale,
  // 0.0.0.0, etc.). The bundle contains daemon/web/desktop logs, host
  // metadata, and crash reports — same threat tier as connector / live-
  // artifact endpoints, which all use the same guard.
  // Renderer-side chat-scroll evidence, pushed just before an export is
  // requested. Same guard and same threat tier as the export itself: the body
  // carries the chat log's DOM. Not a user-facing capability — it is the
  // renderer half of `pixo diagnostics export`, which already exists on both
  // surfaces — so it gets no CLI subcommand of its own.
  //
  // The 24mb body parser is NOT in this chain: a route-level parser cannot
  // reach a body the app-level 4mb parser has already read, so it is mounted
  // next to the other oversized-body routes, ahead of the global one. Naming it
  // here as well would only make it look like this line is what sizes the route.
  app.post(
    CHAT_SCROLL_FORENSICS_PATH,
    requireLocalDaemonRequest,
    chatScrollForensicsHandler,
  );

  app.get(
    DIAGNOSTICS_EXPORT_PATH,
    requireLocalDaemonRequest,
    createDiagnosticsExportHandler({
      runtime,
      projectRoot: PROJECT_ROOT,
      runsDir: path.join(RUNTIME_DATA_DIR, 'runs'),
      dataDir: RUNTIME_DATA_DIR,
    }),
  );

  const nodeDeps = { fs, path };
  const idDeps = { randomId, randomUUID };
  const uploadDeps = { upload, importUpload, handleProjectUpload };
  const projectStoreDeps = {
    getProject,


    insertProject,
    updateProject,
    dbDeleteProject,
    removeProjectDir,
    stageProjectDirsForDelete,
    validateLinkedDirs,
  };
  const authorizeProjectRequest = createAuthorizeProjectRequest({ db, PROJECTS_DIR, getProject, sendApiError });
  // Legacy registrars still receive the historical bound mutation-gate shape,
  // but production delegates it to the same central authorizer as newer route
  // modules. This keeps placeholder stamps authoritative across Figma import,
  // import helpers, runs/chat, and every project/file mutation route.
    const authorizeProjectToolRequest = async (res, projectId, options) =>
    await authorizeProjectRequest({}, res, projectId, options) ? { projectId } : null;
  const projectFileDeps = {
    ensureProject,
    listFiles,
    listProjectFolders,
    createProjectFolder,
    deleteProjectFolder,
    searchProjectFiles,
    readProjectFile,
    resolveProjectDir,
    resolveProjectFilePath,
    resolveProjectDeletePath,
    parseByteRange,
    renameProjectFile,
    deleteProjectFile,
    writeProjectFile,
    sanitizeName,
    sanitizePath,
    listTabs,
    setTabs,
  };
  const conversationDeps = {
    insertConversation,
    getConversation,
    listConversations,
    updateConversation,
    deleteConversation,
    getMessage,
    listMessages,
    upsertMessage,
  };
  const templateDeps = { getTemplate, listTemplates, deleteTemplate, insertTemplate, findTemplateByNameAndProject, updateTemplate };
  const projectStatusDeps = {
    listLatestProjectRunStatuses,
    listProjectsAwaitingInput,
    normalizeProjectDisplayStatus,
    composeProjectDisplayStatus,
    listProjects,

  };
  const projectEventDeps = { subscribeFileEvents, activeProjectEventSinks };
  const importDeps = { projectDir, detectEntryFile };
  const projectExportDeps = {
    createProjectArchiveStream,
    createBatchArchiveStream,
    buildDesktopPdfExportInput,
    buildDesktopArtifactExportInput,
    desktopPdfExporter,
    desktopSlideRenderer,
    desktopArtifactExporter,
    daemonUrlRef,
    sanitizeArchiveFilename,
  };
  const artifactDeps = {
    sanitizeSlug,
    lintArtifact,
    renderFindingsForAgent,
    validateArtifactManifestInput,
  };
  configureCodexImageProvider(RUNTIME_DATA_DIR);
  const mediaDeps = {
    MEDIA_PROVIDERS,
    IMAGE_MODELS,
    MODEL3D_MODELS,
    VIDEO_MODELS,
    AUDIO_MODELS_BY_KIND,
    MEDIA_ASPECTS,
    VIDEO_LENGTHS_SEC,
    AUDIO_DURATIONS_SEC,
    readMaskedConfig,
    writeConfig,
    generateMedia: (args) => generateMedia({ ...args, desktopFrameRenderer, openpixoHosted: openPixoHosted }),
    openpixoHosted: openPixoHosted,
    artBudget: artBudgetLedger,
    mediaTasks: mediaTaskStore.mediaTasks,
    createMediaTask: mediaTaskStore.createMediaTask,
    persistMediaTask: mediaTaskStore.persistMediaTask,
    appendTaskProgress: mediaTaskStore.appendTaskProgress,
    notifyTaskWaiters: mediaTaskStore.notifyTaskWaiters,
    getLiveMediaTask: mediaTaskStore.getLiveMediaTask,
    mediaTaskSnapshot: mediaTaskStore.mediaTaskSnapshot,
    listMediaTasksByProject,
    listElevenLabsVoiceOptions,
  };
  const appConfigDeps = {
    readAppConfig,
    writeAppConfig,
    onAppConfigWritten: () => {

      // completed write so even an A -> B -> A transition with no intervening
      // directory/status read fences exact authority from the old A session.

      void attributionService.processPending().catch((err: unknown) => {
        console.warn('[attribution] pending claim failed', err);
      });
    },
  };

  const nativeDialogDeps = { openBrowser, openNativeFolderDialog };
  const researchDeps = { searchResearch, ResearchError };
  const authDeps = {
    authorizeToolRequest,
    consumedImportNonces,
    desktopAuthSecret: getDesktopAuthSecret,
    isDesktopAuthGateActive,
    pruneExpiredImportNonces,
    optionalToolGrantFromRequest,
    requestProjectOverride,
    requestRunOverride,
    verifyDesktopImportToken,
  };
  const validationDeps = { isSafeId, validateExternalApiBaseUrl, validateBaseUrl, validateProjectSkillId };
  const agentDeps = {
    listProviderModels,
    testProviderConnection,
    testAgentConnection,
    getAgentDef,
    isKnownModel,
    isKnownServiceTier,
    sanitizeCustomModel,
  };

  // External services
  registerDoctorRoutes(app, { http: httpDeps, paths: pathDeps });
  registerOpenPixoAccountRoutes(app, { account: openPixoAccount });
  registerOpenPixoAgentRoutes(app, { account: openPixoAccount, gateway: openPixoAgentGateway });
  registerMcpRoutes(app, {
    http: httpDeps,
    paths: pathDeps,
    mcp: { pendingAuth: mcpPendingAuth, daemonUrlRef, inheritedEnvironment },
  });
  registerXaiRoutes(app, {
    http: httpDeps,
    paths: pathDeps,
  });
  // Project workspace
  registerActiveContextRoutes(app, {
    db,
    http: httpDeps,
    projectStore: projectStoreDeps,
  });
  registerHostToolsRoutes(app, {
    db,
    http: httpDeps,
    paths: pathDeps,
    projectStore: projectStoreDeps,
    projectFiles: projectFileDeps,
    authorizeProjectRequest,
  });
  const gameVerifyRouteDeps = { db, http: httpDeps, paths: pathDeps, authorizeProjectRequest, authorizeProjectToolRequest, captureGameWeb };
  registerGameVerifyRoutes(app, gameVerifyRouteDeps);
  registerGamePlaytestRoutes(app, gameVerifyRouteDeps);
  const stopGameRuns = registerGameRunRoutes(app, { db, http: httpDeps, paths: pathDeps, authorizeProjectRequest });
  registerGameTuningRoutes(app, { db, http: httpDeps, paths: pathDeps, authorizeProjectRequest, authorizeProjectToolRequest });
  const publishService = registerPublishRoutes(app, { db, http: httpDeps, paths: pathDeps, authorizeProjectRequest, authorizeProjectToolRequest, account: openPixoAccount });
  registerGameExportRoutes(app, { db, http: httpDeps, authorizeProjectRequest, authorizeProjectToolRequest, publish: publishService });
  registerRoomsRoutes(app, { db, http: httpDeps, authorizeProjectRequest, authorizeProjectToolRequest, publish: publishService, gameRuns: stopGameRuns.control,
    sdkDir: resolveDaemonResourceDir(DAEMON_RESOURCE_ROOT, 'game-sdk', path.join(PROJECT_ROOT, 'game-sdk')) });
  registerOnlineRoutes(app, { db, http: httpDeps, authorizeProjectRequest, authorizeProjectToolRequest, publish: publishService, gameRuns: stopGameRuns.control,
    sdkDir: resolveDaemonResourceDir(DAEMON_RESOURCE_ROOT, 'game-sdk', path.join(PROJECT_ROOT, 'game-sdk')), emulator: onlineEmulator, account: openPixoAccount });

  registerSocialShareRoutes(app, { http: httpDeps });
  const projectCreatePreparationTimeoutMs = projectCreatePreparationTimeoutMsFromEnv();
      registerProjectRoutes(app, {
    db,
    publicFileMutations,
    projectHolds: {
      release: async (projectId: string) => {
        await Promise.all([
          stopGameRuns.control.stop(projectId),
          terminalService.closeProjectSessions(projectId),
          projectAssetRoutes.release(projectId),
        ]);
      },
    },

    design,
    // Test seam for the POST /api/projects preparation deadline; production
    // keeps the route's 15s default when the variable is unset or invalid.
    ...(projectCreatePreparationTimeoutMs != null
      ? { projectCreatePreparationTimeoutMs }
      : {}),
    http: httpDeps,
    paths: pathDeps,
    projectStore: projectStoreDeps,
    projectFiles: projectFileDeps,
    conversations: conversationDeps,
    templates: templateDeps,
    status: projectStatusDeps,

    authorizeProjectRequest,


    pluginScope: {
      loadRegistry: loadPluginRegistryView,
      getPlugin: (id, options) => getInstalledPlugin(db, id),
      getLocalPluginBySource: (id, source) => getLocalPluginBySource(
        db,
        id,
        source,
      ),
    },
    events: projectEventDeps,
    ids: idDeps,
    telemetry: {
      captureProductEvent: async (req, eventName, properties) => {
        const analyticsContext = readAnalyticsContext(req);
        if (!analyticsContext) return;
        await analyticsService.capture({
          eventName,
          context: analyticsContext,
          appVersion: currentAppVersion(),
          properties,
          insertId: newInsertId(),
        });
      },

    },
    appConfig: appConfigDeps,
    agents: agentDeps,
    validation: validationDeps,
  });
  registerTerminalRoutes(app, {
    db,
    http: httpDeps,
    paths: pathDeps,
    projectStore: projectStoreDeps,
    projectFiles: projectFileDeps,
    terminals: terminalService,
    authorizeProjectRequest,
  });
  registerProjectEngineRoutes(app, { db, http: httpDeps, paths: pathDeps, authorizeProjectRequest });
  const projectAssetRoutes = registerProjectAssetRoutes(app, { db, http: httpDeps, paths: pathDeps, authorizeProjectRequest, authorizeProjectToolRequest });
  registerProjectNextStepsRoutes(app, { db, http: httpDeps, paths: pathDeps, authorizeProjectRequest, authorizeProjectToolRequest, mediaAssetCount: projectAssetRoutes.mediaAssetCount });
  registerProjectCheckpointRoutes(app, { db, http: httpDeps, paths: pathDeps, authorizeProjectRequest, authorizeProjectToolRequest, isProjectBusy: checkpointProjectBusyReader(design.runs) });
  registerConversationRewindRoutes(app, { db, http: httpDeps, paths: pathDeps, authorizeProjectRequest, isProjectBusy: checkpointProjectBusyReader(design.runs) });
  registerAssetOpRoutes(app, { db, http: httpDeps, paths: pathDeps, authorizeProjectRequest, authorizeProjectToolRequest });
  registerProjectExtensionRoutes(app, {
    db,
    http: httpDeps,
    paths: pathDeps,
    projectStore: projectStoreDeps,
    resources: { listAllSkills },
    authorizeProjectRequest,
  });
  const folderImporter = registerImportRoutes(app, {
    db,
    publicFileMutations,

    http: httpDeps,
    uploads: uploadDeps,
    node: nodeDeps,
    ids: idDeps,
    paths: pathDeps,
    imports: importDeps,
    auth: authDeps,
    projectStore: projectStoreDeps,
    conversations: conversationDeps,
    projectFiles: projectFileDeps,
    validation: validationDeps,


  });

  const gameTemplatesRoot = resolveDaemonResourceDir(
    DAEMON_RESOURCE_ROOT, 'game-templates', path.join(PROJECT_ROOT, 'game-templates'),
  );
  registerGameTemplateRoutes(app, {
    http: httpDeps,
    folderImporter,
    artStyleExists: styleId => Boolean(getArtStyle(db, styleId)),
    templatesRoot: gameTemplatesRoot,
    engineOptions: async () => gameEngineOptions(gameTemplatesRoot, gameToolResolver((await readMaskedConfig(PROJECT_ROOT, { refreshCredentials: false, cachedAgentDetection: true })).gameEnginePaths ?? {})),
  });
  const artBudgetDeps = { ledger: artBudgetLedger, account: openPixoAccount, isProjectBusy: checkpointProjectBusyReader(design.runs) };
  registerArtBudgetRoutes(app, {
    db, http: httpDeps, authorizeProjectRequest, ...artBudgetDeps,
    readImageTools: async () => connectedImageTools(await readMaskedConfig(PROJECT_ROOT, { refreshCredentials: false, cachedAgentDetection: true })),
  });
  registerAgentImageModelRoutes(app, {
    http: httpDeps,
    readFacts: async () => ({
      usableProviders: usableMediaProviders(await readMaskedConfig(PROJECT_ROOT, { refreshCredentials: false, cachedAgentDetection: true })),
      signedIn: await openPixoAccount.hasSession().catch(() => false),
      selected: (await readAppConfig(RUNTIME_DATA_DIR)).agentImageModel,
    }),
  });
  // Ahead of the media and recipe routes: it guards what an agent spends before approval.
  registerGamePlanRoutes(app, {
    db, http: httpDeps, paths: pathDeps, authorizeProjectRequest, authorizeProjectToolRequest,
    templatesRoot: gameTemplatesRoot,
    isProjectBusy: checkpointProjectBusyReader(design.runs),
    artBudget: artBudgetDeps,
  });
  registerStaticResourceRoutes(app, {
    db,
    http: httpDeps,
    paths: pathDeps,


    resources: {
      listAllSkills,
      listAllTemplates,
      listAllSkillLikeEntries,
      mimeFor,
    },
    tokenContractRebuild: {
    },
  });
  registerProjectArtifactRoutes(app, {
    http: httpDeps,
    uploads: uploadDeps,
    paths: pathDeps,
    node: nodeDeps,
    artifacts: artifactDeps,
  });
  registerDeliverableSyntaxToolRoutes(app, {
    projectsRoot: PROJECTS_DIR,
    authorizeToolRequest,
    authorizeProjectToolRequest,
    getProject: (id: string) => getProject(db, id),
    getRun: (id: string) => design.runs.get(id),
    persistRunState: (run) => design.runs.persistState(run),
    relatedPathsForRun: async ({ runId, projectRoot }) => {
      const baseline = runArtifactBaselines.peek(runId);
      if (
        !baseline
        || baseline.contended
        || path.resolve(baseline.cwd) !== path.resolve(projectRoot)
      ) {
        return [];
      }
      const current = await snapshotProjectArtifactsAsync(projectRoot);
      return diffRunArtifacts(
        baseline.before,
        current,
      ).renderDependencyTouchedPaths;
    },
  });
  app.use('/artifacts', express.static(ARTIFACTS_DIR));
  app.use(
    PLUGIN_PREVIEWS_ROUTE,
    express.static(PLUGIN_PREVIEWS_DIR, { maxAge: '1d', immutable: false }),
  );
  app.use('/frames', express.static(FRAMES_DIR));
  registerProjectExportRoutes(app, {
    db,
    http: httpDeps,
    paths: pathDeps,
    node: nodeDeps,
    ids: idDeps,
    projectStore: projectStoreDeps,
    exports: projectExportDeps,
    projectFiles: projectFileDeps,
    validation: validationDeps,
    auth: authDeps,
    authorizeProjectRequest,
    authorizeProjectToolRequest,
    isApiTokenAuthorization,
    projectPreviewScopes,
  });
  registerProjectFileRoutes(app, {
    db,
    isProjectEditingBusy: (projectId) => design.runs.list().some((run) =>
      run.projectId === projectId && !design.runs.isTerminal(run.status)),
    publicFileMutations,

    http: httpDeps,
    paths: pathDeps,
    uploads: uploadDeps,
    node: nodeDeps,
    projectStore: projectStoreDeps,
    authorizeProjectRequest,


    projectFiles: projectFileDeps,
    documents: { buildDocumentPreview },
    artifacts: artifactDeps,
    projectPreviewScopes,

  });
  // Immutable chat-artifact snapshot reads. Same read authority as /raw; see
  // routes/project/chat-artifacts.ts for the gate chain.
  registerProjectChatArtifactRoutes(app, {
    db,
    http: httpDeps,
    paths: pathDeps,
    projectStore: projectStoreDeps,
    authorizeProjectRequest,
  });

  registerMediaRoutes(app, {
    db,
    design,
    http: httpDeps,
    paths: pathDeps,
    ids: idDeps,
    auth: authDeps,
    media: mediaDeps,
    appConfig: appConfigDeps,

    nativeDialogs: nativeDialogDeps,
    projectStore: projectStoreDeps,
    projectFiles: projectFileDeps,
    conversations: conversationDeps,
    research: researchDeps,
    authorizeProjectRequest,
    authorizeProjectToolRequest,
  });


  const pluginRouteHelpers = {
    PLUGIN_PREVIEWS_DIR,
    applyBakedPreviews,
    assembleExample,
    pluginUpload,
    pluginInstallation,
    sendMulterError,
    decodeMultipartFilename,
    loadPluginRegistryView,
    requireLocalDaemonRequest,
    getProject,
    sendApiError,
    isLocalSameOrigin,
    resolvedPortRef,
    pluginShareTaskStore,
    installOrUpgradePlugin: async (req, res, mode) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const id = req.params.id;
      let source = '';
      let marketplaceResolution = null;
      if (mode === 'upgrade') {
        const policy = body.policy === 'pinned' ? 'pinned' : 'latest';
        const plugin = getInstalledPlugin(db, id);
        if (!plugin) return res.status(404).json({ error: { code: 'plugin-not-found', message: `No installed plugin with id "${id}".`, data: { id } } });
        if (plugin.sourceKind === 'bundled') return res.status(409).json({ error: { code: 'bundled-plugin', message: `Plugin "${id}" was shipped bundled with the daemon and upgrades only via daemon-image upgrade. The bundled boot walker re-registers bundled plugins on every boot.`, data: { id, sourceKind: plugin.sourceKind } } });
        source = plugin.source;
        if (policy === 'latest' && plugin.sourceMarketplaceEntryName) {
          const { resolvePluginInMarketplaces } = await import('./plugins/marketplaces.js');
          marketplaceResolution = resolvePluginInMarketplaces(db, plugin.sourceMarketplaceEntryName);
          if (marketplaceResolution) source = marketplaceResolution.source;
        }
        if (!source) return res.status(409).json({ error: { code: 'missing-source', message: `Plugin "${id}" has no recorded install source — cannot upgrade. Reinstall via '${PRODUCT_CLI_NAME} plugin install --source <...>' to set one.`, data: { id } } });
      } else {
        source = typeof body.source === 'string' ? body.source : '';
        if (!source) return res.status(400).json({ error: 'source is required' });
        const looksAbsolute = path.isAbsolute(source) || source.startsWith('./') || source.startsWith('.\\') || source.startsWith('~');
        const looksGithub = source.startsWith('github:');
        const looksHttps = /^https:\/\//i.test(source);
        if (!looksAbsolute && !looksGithub && !looksHttps) {
          const { resolvePluginInMarketplaces } = await import('./plugins/marketplaces.js');
          let lookupName = source;
          const lockfile = await readPluginLockfile(PLUGIN_LOCKFILE_PATH);
          const locked = lockfile.plugins[source];
          if (locked?.version && !source.includes('@')) lookupName = `${source}@${locked.version}`;
          const resolved = resolvePluginInMarketplaces(db, lookupName);
          if (!resolved) return res.status(404).json({ error: { code: 'plugin-not-found', message: `No marketplace plugin named "${source}". Add a marketplace via '${PRODUCT_CLI_NAME} marketplace add <url>' or pass a github: / https:// / local source.`, data: { name: source } } });
          marketplaceResolution = resolved;
          source = resolved.source;
        }
      }
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      const writeEvent = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (mode === 'upgrade') writeEvent('progress', { kind: 'progress', phase: 'resolving', message: `Upgrading ${id} from ${source} (policy=${body.policy === 'pinned' ? 'pinned' : 'latest'})` });
      // A fresh scoped install is stamped Personal to the exact verified
      // Workspace/member. Replacement is checked before any existing bytes
      // are removed, so another member cannot overwrite a same-id Personal
      // plugin. Headerless local/CLI installs remain unbound and available on
      // that compatibility lane, but explicit Workspaces quarantine them.
      try {
        const basePlugin = mode === 'upgrade' ? getInstalledPlugin(db, id) : null;
        for await (const ev of installPlugin(db, {
          source,
          roots: PLUGIN_REGISTRY_ROOTS,
          ...(mode === 'upgrade' ? { eventKind: 'upgraded' } : {}),
          sourceMarketplaceId: marketplaceResolution?.marketplaceId ?? basePlugin?.sourceMarketplaceId,
          sourceMarketplaceEntryName: marketplaceResolution?.pluginName ?? basePlugin?.sourceMarketplaceEntryName,
          sourceMarketplaceEntryVersion: marketplaceResolution?.pluginVersion ?? basePlugin?.sourceMarketplaceEntryVersion,
          marketplaceTrust: marketplaceResolution?.marketplaceTrust ?? basePlugin?.marketplaceTrust,
          resolvedSource: marketplaceResolution?.source ?? basePlugin?.resolvedSource,
          resolvedRef: marketplaceResolution?.ref ?? basePlugin?.resolvedRef,
          manifestDigest: marketplaceResolution?.manifestDigest ?? basePlugin?.manifestDigest,
          archiveIntegrity: marketplaceResolution?.archiveIntegrity ?? basePlugin?.archiveIntegrity,
          lockfilePath: PLUGIN_LOCKFILE_PATH,

        })) {
          writeEvent(ev.kind, ev);
          if (ev.kind === 'success' || ev.kind === 'error') break;
        }
      } catch (err) {
        writeEvent('error', { kind: 'error', message: String(err), warnings: [] });
      } finally {
        res.end();
      }
    },
    handleShareProject: async (req, res, sourcePlugin) => {
      try {
        if (!USER_PLUGIN_SOURCE_KINDS.has(sourcePlugin.sourceKind)) return res.status(409).json({ ok: false, code: 'plugin-not-shareable', message: 'Only user-installed plugins can start a share project.' });
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const action = normalizePluginShareAction(body.action);
        if (!action) return sendApiError(res, 400, 'BAD_REQUEST', 'action must be publish-github');
        const actionPluginId = PLUGIN_SHARE_ACTION_PLUGIN_IDS[action];
        const actionPlugin = getInstalledPlugin(db, actionPluginId);
        if (!actionPlugin) return res.status(409).json({ ok: false, code: 'share-action-plugin-missing', message: `The bundled action plugin "${actionPluginId}" is not installed. Restart the daemon so bundled plugins are registered.` });
        const now = Date.now(); const id = randomId(); const cid = randomId(); const sourceSlug = githubRepoNameFromPluginName(sourcePlugin.id); const stagedPath = `plugin-source/${sourceSlug}`; const prompt = renderPluginSharePrompt({ action, sourcePlugin, stagedPath }); const metadata = { kind: 'prototype' }; const projectRoot = await ensureProject(PROJECTS_DIR, id, metadata); await copyPluginFolderForProjectContext(sourcePlugin.fsPath, path.join(projectRoot, 'plugin-source', sourceSlug));
        insertProject(db, { id, name: `${PLUGIN_SHARE_ACTION_LABELS[action]}: ${sourcePlugin.title || sourcePlugin.id}`, skillId: null, pendingPrompt: prompt, metadata, createdAt: now, updatedAt: now });
        insertConversation(db, { id: cid, projectId: id, title: null, createdAt: now, updatedAt: now });
        const registry = await loadPluginRegistryView();
        const resolved = resolvePluginSnapshot({ db, body: { pluginId: actionPluginId, pluginInputs: { source_plugin_id: sourcePlugin.id, source_plugin_title: sourcePlugin.title || sourcePlugin.id, source_plugin_version: sourcePlugin.version, source_plugin_path: sourcePlugin.fsPath, plugin_context_path: stagedPath }, locale: typeof body.locale === 'string' ? body.locale : undefined }, projectId: id, conversationId: cid, registry, });
        if (resolved && !resolved.ok) return res.status(resolved.status).json(resolved.body);
        const project = getProject(db, id); if (!project) return sendApiError(res, 500, 'INTERNAL_ERROR', 'created project could not be loaded');
        res.json({ ok: true, project, conversationId: cid, ...(resolved?.ok ? { appliedPluginSnapshotId: resolved.snapshotId } : {}), actionPluginId, sourcePluginId: sourcePlugin.id, stagedPath, prompt, message: `Created a ${PLUGIN_SHARE_ACTION_LABELS[action]} task for ${sourcePlugin.title || sourcePlugin.id}.` });
      } catch (err) { res.status(400).json({ ok: false, message: String(err?.message || err) }); }
    },
    handlePluginTrust: async (req, res, plugin) => {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {}; const action = body.action === 'revoke' ? 'revoke' : 'grant';
        const { validateCapabilityList, grantCapabilities, revokeCapabilities } = await import('./plugins/trust.js');
        const { accepted, rejected } = validateCapabilityList(body.capabilities);
        if (rejected.length > 0) return res.status(400).json({ error: { code: 'invalid-capability', message: `Capability validation failed: ${rejected.map((r) => r.capability).join(', ')}`, data: { rejected } } });
        if (accepted.length === 0) return res.status(400).json({ error: { code: 'no-capabilities', message: 'capabilities[] is required and must contain at least one entry' } });
        const next = action === 'revoke' ? revokeCapabilities({ db, pluginId: req.params.id, capabilities: accepted }) : grantCapabilities({ db, pluginId: req.params.id, capabilities: accepted });
        const updated = getInstalledPlugin(db, req.params.id);
        try { const { recordPluginEvent } = await import('./plugins/events.js'); recordPluginEvent({ kind: 'plugin.trust-changed', pluginId: req.params.id, details: { action, capabilities: accepted, total: next.length } }); } catch {}
        res.status(action === 'grant' ? 201 : 200).json({ ok: true, id: req.params.id, action, capabilitiesGranted: next, plugin: updated });
      } catch (err) { res.status(500).json({ error: String(err) }); }
    },
    handlePluginStats: async (res, scopedInstalled, scopedSnapshotRows) => {
      try { const { pluginInventoryStats, snapshotInventoryStats } = await import('./plugins/stats.js'); const installed = scopedInstalled ?? listInstalledPlugins(db); const inventoryRows = scopedSnapshotRows ?? db.prepare(`SELECT status, project_id, run_id, applied_at FROM applied_plugin_snapshots`).all(); res.json({ plugins: pluginInventoryStats(installed), snapshots: snapshotInventoryStats(inventoryRows), generatedAt: Date.now() }); } catch (err) { res.status(500).json({ error: String(err) }); }
    },
    handleAppliedPluginExport: async (req, res) => {
      try { const body = req.body && typeof req.body === 'object' ? req.body : {}; const target = body.target === 'pixo' || body.target === 'claude-plugin' || body.target === 'agent-skill' ? body.target : null; if (!target) return res.status(400).json({ error: 'target must be one of: pixo, claude-plugin, agent-skill' }); const outDir = typeof body.outDir === 'string' && body.outDir.length > 0 ? body.outDir : null; if (!outDir) return res.status(400).json({ error: 'outDir is required' }); const { exportPlugin, ExportError } = await import('./plugins/export.js'); try { const result = await exportPlugin({ db, target, outDir, ...(typeof body.snapshotId === 'string' ? { snapshotId: body.snapshotId } : {}), ...(typeof body.projectId === 'string' ? { projectId: body.projectId } : {}) }); res.json({ ok: true, ...result }); } catch (err) { if (err instanceof ExportError) return res.status(404).json({ error: err.message }); throw err; } } catch (err) { res.status(500).json({ error: String(err) }); }
    },
    handleProjectInstallFolder: async (req, res) => {
      try { const project = getProject(db, req.params.id); if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); const body = req.body && typeof req.body === 'object' ? req.body : {}; const relativePath = normalizeProjectPluginFolderPath(body.path); const projectRoot = resolveProjectDir(PROJECTS_DIR, req.params.id, project.metadata); const folder = await resolveProjectChildDirectory(projectRoot, relativePath); const warnings = []; const log = []; let plugin = null; let message = 'Install finished.'; for await (const ev of installPlugin(db, { source: folder, roots: PLUGIN_REGISTRY_ROOTS })) { if (ev.message) log.push(ev.message); if (Array.isArray(ev.warnings)) warnings.splice(0, warnings.length, ...ev.warnings); if (ev.kind === 'success') { plugin = ev.plugin; message = `Installed ${ev.plugin.title}.`; break; } if (ev.kind === 'error') { message = ev.message; break; } } res.status(plugin ? 200 : 400).json({ ok: Boolean(plugin), plugin, warnings, message, log }); } catch (err) { const code = err && err.code; const status = code === 'ENOENT' || code === 'ENOTDIR' ? 404 : 400; sendApiError(res, status, status === 404 ? 'PLUGIN_FOLDER_NOT_FOUND' : 'BAD_REQUEST', String(err?.message || err)); }
    },
    handleProjectPluginCli: async (req, res) => {
      try { const project = getProject(db, req.params.id); if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); const body = req.body && typeof req.body === 'object' ? req.body : {}; const relativePath = normalizeProjectPluginFolderPath(body.path); const projectRoot = resolveProjectDir(PROJECTS_DIR, req.params.id, project.metadata); const folder = await resolveProjectChildDirectory(projectRoot, relativePath); const subcommand = 'publish-repo'; const timeout = 240_000; const result = await execCommandViaLoginShell(PIXO_NODE_BIN, [PIXO_BIN, 'plugin', subcommand, folder, '--json'], { timeout }); const payload = result.stdout ? JSON.parse(result.stdout) : null; if (!result.ok || !payload?.ok) return res.status(500).json({ ok: false, code: payload?.error?.label || 'publish-repo-failed', message: payload?.error?.stderr || payload?.error?.stdout || 'GitHub repo publish failed.', log: payload?.steps?.map((step) => step.stderr || step.stdout || step.command).filter(Boolean) ?? [result.stderr || result.stdout || `${subcommand} failed`] }); res.json({ ok: true, message: payload.repoUrl ? `Published plugin to ${payload.repoUrl}.` : 'Published plugin to GitHub.', ...(payload.repoUrl ? { url: payload.repoUrl } : {}), log: payload.steps?.map((step) => step.stderr || step.stdout || step.command).filter(Boolean) ?? [] }); } catch (err) { res.status(400).json({ ok: false, message: String(err?.message || err), log: [] }); }
    },
    handleCandidateDraft: async (req, res) => {
      if (!isLocalSameOrigin(req, resolvedPort)) return res.status(403).json({ error: 'cross-origin request rejected' });
      try { const project = getProject(db, req.params.id); if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); const projectRoot = resolveProjectDir(PROJECTS_DIR, req.params.id, project.metadata); const result = await generateSkillPluginDraft(db, projectRoot, req.params.id, req.params.candidateId); if (!result) return sendApiError(res, 404, 'NOT_FOUND', 'plugin candidate not found'); res.status(result.ok ? 200 : 422).json(result); } catch (err) { res.status(400).json({ ok: false, message: String(err?.message || err) }); }
    },
    handleCandidateShareTask: async (req, res) => {
      if (!isLocalSameOrigin(req, resolvedPort)) return res.status(403).json({ error: 'cross-origin request rejected' });
      try { const project = getProject(db, req.params.id); if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); const body = req.body && typeof req.body === 'object' ? req.body : {}; const action = body.action === 'publish-github' ? body.action : null; if (!action) return sendApiError(res, 400, 'BAD_REQUEST', 'plugin share action is required'); const projectRoot = resolveProjectDir(PROJECTS_DIR, req.params.id, project.metadata); const draft = await generateSkillPluginDraft(db, projectRoot, req.params.id, req.params.candidateId); if (!draft) return sendApiError(res, 404, 'NOT_FOUND', 'plugin candidate not found'); if (!draft.validation.ok) return res.status(422).json({ ok: false, code: 'plugin-draft-invalid', message: 'Generated plugin draft is invalid.', draft }); const task = pluginShareTaskStore.createAndStart(req.params.id, { action, path: draft.draftPath }, draft.folder); res.status(202).json({ taskId: task.id, action, path: draft.draftPath, status: task.status, startedAt: task.startedAt, draft }); } catch (err) { res.status(400).json({ ok: false, message: String(err?.message || err) }); }
    },
    handleProjectShareTask: async (req, res) => {
      if (!isLocalSameOrigin(req, resolvedPort)) return res.status(403).json({ error: 'cross-origin request rejected' });
      try { const project = getProject(db, req.params.id); if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); const body = req.body && typeof req.body === 'object' ? req.body : {}; const action: PluginShareAction | null = body.action === 'publish-github' ? body.action : null; if (!action) return sendApiError(res, 400, 'BAD_REQUEST', 'plugin share action is required'); const relativePath = normalizeProjectPluginFolderPath(body.path); const projectRoot = resolveProjectDir(PROJECTS_DIR, req.params.id, project.metadata); const folder = await resolveProjectChildDirectory(projectRoot, relativePath); const task = pluginShareTaskStore.createAndStart(req.params.id, { action, path: relativePath }, folder); res.status(202).json({ taskId: task.id, action, path: relativePath, status: task.status, startedAt: task.startedAt }); } catch (err) { const code = err && err.code; const status = code === 'ENOENT' || code === 'ENOTDIR' ? 404 : 400; sendApiError(res, status, status === 404 ? 'PLUGIN_FOLDER_NOT_FOUND' : 'BAD_REQUEST', String(err?.message || err)); }
    },
  };

  // Plan §3.A1: shared helper used by every endpoint that has to resolve
  // plugin context against the live registry. Skills + design systems are
  // walked from disk; craft is empty in v1; atoms come from the
  // first-party catalog. Project-scoped overrides arrive in Phase 4.
  async function loadPluginRegistryView() {
    const [skills] = await Promise.all([
      listAllSkills(),
    ]);
    // Spec §23.3.3: surface the bundled scenario plugins so apply()
    // can fall back to the matching scenario's pipeline when the
    // consumer plugin omits pixo.pipeline. Each scenario carries a
    // `taskKind` that picks the match.
    const scenarios = collectBundledScenarios();
    return {
      skills: skills.map((s) => ({ id: s.id, title: s.name, description: s.description })),
      atoms: FIRST_PARTY_ATOMS.map((a) => ({ id: a.id, label: a.label })),
      scenarios,
    };
  }

  // Pure read off `installed_plugins`: rows whose source_kind='bundled'
  // AND pixo.kind='scenario' AND pixo.pipeline is non-empty become entries
  // the apply path can fall back to. Scenario plugins from third-party
  // sources are intentionally NOT trusted as defaults — the bundled
  // boot walker (apps/daemon/src/plugins/bundled.ts) is the only writer
  // of source_kind='bundled', so this function never grants the
  // privilege to user-installed scenarios.
  //
  // Plan §3.O1 / §C-stage of plugin-driven-flow-plan: more than one
  // bundled scenario may share a `taskKind` (e.g. `pixo-media-generation`
  // also claims `new-generation` so the kind → scenario map can route
  // image / video / audio projects to it). The pipeline-fallback
  // resolver expects ONE scenario per taskKind, so this function
  // dedupes and prefers the canonical id `od-<taskKind>` as the
  // pipeline-fallback winner. Non-canonical scenarios still install
  // and run through their explicit pluginId path; they just don't get
  // to hijack a consumer plugin that omitted `pixo.pipeline`.
  function collectBundledScenarios() {
    type ScenarioEntry = {
      id: string;
      taskKind: 'new-generation' | 'figma-migration' | 'code-migration' | 'tune-collab';
      pipeline: NonNullable<NonNullable<import('@openpixo/contracts').PluginManifest['pixo']>['pipeline']>;
    };
    const byTaskKind = new Map<ScenarioEntry['taskKind'], ScenarioEntry>();
    try {
      const all = listInstalledPlugins(db);
      for (const row of all) {
        if (row.sourceKind !== 'bundled') continue;
        const pixo = row.manifest.pixo;
        if (!pixo || pixo.kind !== 'scenario') continue;
        if (!pixo.pipeline || !Array.isArray(pixo.pipeline.stages) || pixo.pipeline.stages.length === 0) continue;
        const taskKind = (pixo.taskKind ?? 'new-generation') as ScenarioEntry['taskKind'];
        if (taskKind !== 'new-generation' && taskKind !== 'figma-migration' &&
            taskKind !== 'code-migration' && taskKind !== 'tune-collab') continue;
        const entry: ScenarioEntry = { id: row.id, taskKind, pipeline: pixo.pipeline };
        const existing = byTaskKind.get(taskKind);
        if (!existing || entry.id === `pixo-${taskKind}`) {
          byTaskKind.set(taskKind, entry);
        }
      }
    } catch {
      // On a fresh install the table may not exist yet; surface no
      // scenarios rather than crash the apply path.
      return [];
    }
    return Array.from(byTaskKind.values());
  }

        const getLocalPluginBySource = async (
    dbHandle,
    id: string,
    source: string,
  ) => resolveLocalPluginBySource({
    db: dbHandle,
    id,
    source,
  });

  registerPluginRoutes(app, {
    db,
    authorizeProjectRequest,

    paths: { PROJECTS_DIR, PLUGIN_REGISTRY_ROOTS, PLUGIN_LOCKFILE_PATH },
    ids: idDeps,
    projectStore: projectStoreDeps,
    conversations: conversationDeps,


    plugins: {
      listInstalledPlugins,
      getInstalledPlugin,

      getLocalPluginBySource,
      installPlugin,
      isSafePluginId,
      uninstallPlugin,
      installFromLocalFolder,
      applyPlugin,
      doctorPlugin,
      getSnapshot,
      pruneExpiredSnapshots,
      readPluginLockfile,
      resolvePluginSnapshot,
      MissingInputError,
      pluginPromptBlock,
      listSkillPluginCandidates,
      dismissSkillPluginCandidate,
      generateSkillPluginDraft,
      FIRST_PARTY_ATOMS,
    },
    helpers: pluginRouteHelpers,
  });
  registerAtomRoutes(app, {
    db,
    resources: { FIRST_PARTY_ATOMS },
  });
  registerPluginMarketplaceRoutes(app, {
    db,
    bundledMarketplaceEntries,
    createMarketplaceFetcher,
    marketplaceRegistryIdFromUrl,
  });
  registerStoreRoutes(app, {
    db, http: httpDeps, paths: pathDeps, authorizeProjectRequest, account: openPixoAccount,
    builtInSkills: async () => builtInSkills(await listAllSkills(), (await readAppConfig(RUNTIME_DATA_DIR)).disabledSkills),
  });
  registerStyleRoutes(app, { db, http: httpDeps, paths: pathDeps, authorizeProjectRequest, authorizeProjectToolRequest });
  registerGameSetupRoutes(app, { db, http: httpDeps, authorizeProjectRequest });
  registerPluginAssetRoutes(app, {
    db,


    pluginAssetCache,
    AssetCacheError,
    assetCacheRewriteUrl,
    isCacheableExternalUrl,
    assembleExample,
  });

  registerProjectPluginRoutes(app, {
    db,
    authorizeProjectRequest,
    paths: { PROJECTS_DIR, PLUGIN_REGISTRY_ROOTS, PLUGIN_LOCKFILE_PATH },
    ids: idDeps,
    projectStore: projectStoreDeps,
    conversations: conversationDeps,
    plugins: {
      listInstalledPlugins,
      getInstalledPlugin,
      installPlugin,
      isSafePluginId,
      uninstallPlugin,
      installFromLocalFolder,
      applyPlugin,
      doctorPlugin,
      getSnapshot,
      pruneExpiredSnapshots,
      readPluginLockfile,
      resolvePluginSnapshot,
      MissingInputError,
      pluginPromptBlock,
      listSkillPluginCandidates,
      dismissSkillPluginCandidate,
      generateSkillPluginDraft,
      FIRST_PARTY_ATOMS,
    },
    helpers: pluginRouteHelpers,
  });
  registerProjectUploadRoutes(app, {
    db,
    http: httpDeps,
    uploads: uploadDeps,
    node: nodeDeps,
    paths: { PROJECTS_DIR },
    projectStore: projectStoreDeps,
    authorizeProjectRequest,
    authorizeProjectToolRequest,

    projectFiles: projectFileDeps,

  });

  const startChatRun = async (chatBody, run) => {
    const lifecycle = createRunLifecycleTracer(run);
    lifecycle.mark('chat_run_started');
    const pendingNativeSessionContinue =
      run.nativeSessionContinuePending &&
      typeof run.nativeSessionContinuePending.sessionId === 'string'
        ? run.nativeSessionContinuePending
        : null;
    run.nativeSessionContinuePending = null;
    /** @type {Partial<ChatRequest> & { imagePaths?: string[] }} */
    chatBody = chatBody || {};
    const {
      agentId: requestedAgentId,
      message,
      currentPrompt,
      priorTranscript,
      resumeContinuation,
      systemPrompt,
      imagePaths = [],
      projectId,
      conversationId,
      assistantMessageId,
      clientRequestId,
      skillId,
      skillIds,
      sessionMode,
      attachments = [],
      model,
      reasoning,
      serviceTier,
      locale,
      research,
      context,
      titleGeneration,
      byokProvider,
      byokMediaDefaults,
    } = chatBody;
    const nativeProviderSelection = nativeCodexProviderForConfig(byokProvider ?? {});
    const agentId = nativeProviderSelection && (!requestedAgentId || requestedAgentId === 'byok-opencode') ? 'codex' : requestedAgentId;
    lifecycle.mark('prompt_build_start');
    if (typeof projectId === 'string' && projectId) run.projectId = projectId;
    if (typeof conversationId === 'string' && conversationId)
      run.conversationId = conversationId;
    if (typeof assistantMessageId === 'string' && assistantMessageId)
      run.assistantMessageId = assistantMessageId;
    if (typeof clientRequestId === 'string' && clientRequestId)
      run.clientRequestId = clientRequestId;
    if (typeof agentId === 'string' && agentId) run.agentId = agentId;
    const finishRun = (status, code = null, signal = null) => {
      finalizeRunMessageEvents(db, run);
      return design.runs.finish(run, status, code, signal);
    };
    const failRun = (code, message) => {
      return design.runs.fail(run, code, message);
    };
    if (nativeProviderSelection && agentId !== 'codex') return failRun('BYOK_PROVIDER_UNSUPPORTED', 'This provider snapshot requires the native Codex executor. Select Codex or omit the agent.');
    if (resumeContinuation === true && !byokProvider && typeof conversationId === 'string'
      && getAgentSessionRecord(db, conversationId, 'codex')?.model?.startsWith('codex-provider:')) {
      return failRun('BYOK_PROVIDER_REQUIRED', 'This continuation requires the original native provider snapshot. Supply --byok-protocol, --byok-base-url, --byok-key-env and --model again; provider keys are never saved with the run.');
    }
    // Freeze the billing address once, before the first asynchronous setup
    // step. HTTP-created runs already carry the scope captured by the request
    // authorization transaction. Internal runs pin here. Retries reuse the
    // existing property and therefore never consult a later project rebind.
    const telemetryPrompt = telemetryPromptFromRunRequest(message, currentPrompt);
    if (
      !pendingNativeSessionContinue &&
      typeof telemetryPrompt === 'string'
    ) {
      run.userPrompt = telemetryPrompt;
    }
    if (typeof model === 'string' && model) run.model = model;
    if (typeof reasoning === 'string' && reasoning) run.reasoning = reasoning;
    if (typeof serviceTier === 'string' && serviceTier) run.serviceTier = serviceTier;
    if (typeof skillId === 'string' && skillId) run.skillId = skillId;
    const conversationSession =
      typeof conversationId === 'string' && conversationId
        ? getConversation(db, conversationId)
        : null;
    // A new game stays in Plan mode until the user approves its plan, whatever
    // the client sent. Plan mode is read-only on every runtime.
    const gamePlanPending = gamePlanIsPending(
      typeof projectId === 'string' && projectId ? getProject(db, projectId)?.metadata : null,
    );
    const runSessionMode = gamePlanPending
      ? 'plan'
      : sessionMode === 'chat' || sessionMode === 'design' || sessionMode === 'plan'
        ? normalizeConversationSessionMode(sessionMode)
        : normalizeConversationSessionMode(conversationSession?.sessionMode);
    if (gamePlanPending) run.sessionMode = runSessionMode;
    const readOnlyTurn = runSessionMode === 'plan';
    run.readOnlyTurn = readOnlyTurn;
    // Single choke point for the codex transport switch. Every other
    // agent — and codex with the switch off — gets back the identical
    // registry object, so nothing below can tell this call happened.
    const def = await applyCodexTransportOverride(getAgentDef(agentId));
    if (!def)
      return failRun(
        'AGENT_UNAVAILABLE',
        `unknown agent: ${agentId}`,
      );
    if (!def.bin)
      return failRun('AGENT_UNAVAILABLE', 'agent has no binary');
    let nativeCodexProvider = null;
    if (def.id === 'codex' && byokProvider) {
      try {
        nativeCodexProvider = await prepareNativeCodexProvider({
          config: byokProvider, model, reasoning, imagePaths,
          dataDir: RUNTIME_DATA_DIR, nodeExecutable: PIXO_NODE_BIN,
        });
      } catch (error) {
        if (error instanceof NativeCodexProviderError) return failRun(error.code, error.message);
        throw error;
      }
    }
    const byokOpenCodeProvider = def.id === 'byok-opencode'
      ? buildOpenCodeByokProviderConfig(
          byokProvider,
          typeof model === 'string' ? model : null,
        )
      : null;
    if (def.id === 'byok-opencode' && !byokOpenCodeProvider) {
      return failRun(
        'BYOK_PROVIDER_REQUIRED',
        BYOK_OPENCODE_PROVIDER_REQUIRED_MESSAGE,
      );
    }
    // OpenPixo credits: the bundled OpenCode talks to this daemon's gateway, which
    // adds the signed-in session. No account means no run, before anything spawns.
    const openpixoAgentRun = def.id === OPENPIXO_AGENT_ID;
    if (openpixoAgentRun && !(await openPixoAccount.hasSession().catch(() => false))) {
      return failRun('AGENT_AUTH_REQUIRED', 'Sign in to your OpenPixo account to use the agent with OpenPixo credits.');
    }
    // Auto is not a cloud model: replace it with the real one for this run, so the
    // OpenCode config, the session-resume identity and the cloud all see that one.
    const openpixoAgentAuto = openpixoAgentRun && isOpenPixoAgentAutoModel(openpixoAgentChoice(typeof model === 'string' ? model : null));
    const openpixoAgentRunModel = !openpixoAgentRun
      ? null
      : openpixoAgentAuto
        ? chooseOpenPixoAutoRunModel(db, {
            runId: run.id,
            projectId: typeof projectId === 'string' ? projectId : null,
            conversationId: typeof conversationId === 'string' ? conversationId : null,
            planPending: gamePlanPending,
            planModelOffered: await openpixoAgentModelOffered(OPENPIXO_AGENT_AUTO_PLAN_MODEL),
          }).model
        : openpixoAgentModel(typeof model === 'string' ? model : null);
    if (openpixoAgentRunModel) run.model = openpixoAgentRunModel;
    const providerOpenCodeConfig = byokOpenCodeProvider?.config
      ?? (openpixoAgentRunModel ? buildOpenPixoAgentOpenCodeConfig(daemonUrl, openpixoAgentRunModel) : null);
    const bundledOpenCodeExtraConfig = openCodeRunExtraConfig(def.id, providerOpenCodeConfig, readOnlyTurn);
    const requestedRuntimeModel = def.id === 'byok-opencode'
      ? byokOpenCodeProvider?.modelId ?? null
      : openpixoAgentRunModel
        ? openpixoAgentModelArg(openpixoAgentRunModel)
        : nativeCodexProvider?.model ?? model;
    if (
      (typeof message !== 'string' || !message.trim())
    ) {
      return failRun('BAD_REQUEST', 'message required');
    }
    if (run.cancelRequested || design.runs.isTerminal(run.status)) return;
    const runId = run.id;

    // Resolve the project working directory (creating the folder if it
    // doesn't exist yet). Without one we don't pass cwd to spawn — the
    // agent then runs in whatever inherited dir, which still lets API
    // mode work but loses file-tool addressability.
    // Project directory resolution lives in projects.ts so sandbox mode can
    // consistently reject imported-folder metadata that has no managed copy.
    let cwd = null;
    let existingProjectFiles = [];
    let existingProjectFolders = [];
    if (typeof projectId === 'string' && projectId) {
      let chatMeta = null;
      try {
        const chatProject = getProject(db, projectId);
        chatMeta = chatProject?.metadata ?? null;
        // ensureProject/resolveProjectDir now resolve external baseDir folders
        // internally (and assertSandboxProjectRootAvailable rejects imported
        // folders with no managed copy in sandbox mode), so we pass chatMeta
        // through instead of branching on baseDir here.
        assertSandboxProjectRootAvailable(chatMeta);
        cwd = await ensureProject(PROJECTS_DIR, projectId, chatMeta);
      } catch (err) {
        if (err instanceof SandboxImportedProjectError) {
          return failRun('BAD_REQUEST', err.message);
        }
        cwd = null;
      }
      if (cwd) {
        try {
          existingProjectFiles = await listFiles(PROJECTS_DIR, projectId, { metadata: chatMeta });
        } catch {
          // Inventory is advisory prompt context. A concurrent project-tree
          // mutation must not erase the authoritative cwd/session identity.
          existingProjectFiles = [];
        }
        try {
          existingProjectFolders = await listProjectFolders(PROJECTS_DIR, projectId, { metadata: chatMeta });
        } catch {
          // Keep cwd stable even when a directory disappears mid-enumeration.
          existingProjectFolders = [];
        }
      } else {
        existingProjectFiles = [];
        existingProjectFolders = [];
      }
    }
    if (run.cancelRequested || design.runs.isTerminal(run.status)) return;
    const { safeImages, oversizedImages, failedImages } =
      resolveSafePromptImagePaths(imagePaths);
    if (oversizedImages.length > 0) {
      return failRun(
        'BAD_REQUEST',
        'Image attachments must be 1 MB or smaller.',
      );
    }
    if (failedImages.length > 0) {
      return failRun(
        'INTERNAL_ERROR',
        'Failed to read one or more image attachments.',
      );
    }
    const transportSourceImages = safeImages;

    // Project-scoped attachments: project-relative paths inside cwd. Each
    // is run through the same path-traversal guard the file CRUD endpoints
    // use, then existence-checked. Whatever survives shows up as an
    // explicit list at the bottom of the user message so the agent knows
    // to Read it.
    const safeAttachments = cwd
      ? resolveSafeProjectAttachments(cwd, attachments)
      : [];
    run.projectAttachmentPaths = safeAttachments;

    // Local code agents don't accept a separate "system" channel the way the
    // Messages API does — we fold the skill + design-system prompt into the
    // user message. The <artifact> wrapping instruction comes from
    // systemPrompt. We also stitch in the cwd hint so the agent knows
    // where its file tools should write, and the attachment list so it
    // doesn't have to guess what the user just dropped in.
    const projectRecord =
      typeof projectId === 'string' && projectId
        ? getProject(db, projectId)
        : null;
    const effectiveRunSkillId = resolveSkillId(
      typeof skillId === 'string' && skillId
        ? skillId
        : projectRecord?.skillId,
    );
    const runContextPrompt = renderRunContextPrompt(context, projectRecord?.metadata);
    const linkedDirs = (() => {
      if (!Array.isArray(projectRecord?.metadata?.linkedDirs)) return [];
      const v = validateLinkedDirs(projectRecord.metadata.linkedDirs);
      return v.dirs ?? [];
    })();
    const cwdHint = cwd
      ? formatDesignFilesWorkspaceHint(cwd, existingProjectFiles, existingProjectFolders)
      : '';
    const linkedDirsHint = linkedDirs.length > 0
      ? `\n\nLinked code folders (read-only reference code the user wants you to see):\n${
          linkedDirs.map((d) => `- \`${d}\``).join('\n')
        }`
      : '';
    const attachmentHint = formatProjectAttachmentHint(safeAttachments);
    const inactivityTimeoutMs = resolveChatRunInactivityTimeoutMs();
    const toolTokenTtlMs = resolveChatToolTokenTtlMs(inactivityTimeoutMs);
    const toolTokenGrant = cwd && typeof projectId === 'string' && projectId
      ? toolTokenRegistry.mint({
          runId,
          projectId,
          allowedEndpoints: CHAT_TOOL_ENDPOINTS,
          allowedOperations: readOnlyTurn ? READ_ONLY_TURN_TOOL_OPERATIONS : CHAT_TOOL_OPERATIONS,
          ttlMs: toolTokenTtlMs,
        })
      : null;
    let toolTokenRevoked = false;
    let cleanupExtensionFiles = () => {};
    const revokeToolToken = (reason) => {
      if (toolTokenRevoked || !toolTokenGrant) return;
      toolTokenRevoked = true;
      toolTokenRegistry.revokeToken(toolTokenGrant.token, reason);
    };
    // The async startup phase below (compose prompt, prepare prompt file,
    // probe models, …) has many awaits and no blanket try/finally; an
    // exception there finalizes the run via runs.fail() without running the
    // per-attempt cleanup wired to the child lifecycle. Register the grant +
    // sink release on the run's terminal chokepoint so any exit path — startup
    // throw included — revokes the capability token instead of leaking it for
    // the token TTL. Idempotent with the explicit pre-spawn/child-close cleanup.
    if (toolTokenGrant) {
      run.onFinalize = () => {
        revokeToolToken('run_finalized');
        const sinkRunId = toolTokenGrant.runId ?? runId;
        activeChatAgentEventSinks.delete(sinkRunId);
        activeChatRunHandles.delete(sinkRunId);
      };
    }
    const runtimeToolPrompt = createAgentRuntimeToolPrompt(daemonUrl, toolTokenGrant);

    // Resolve external MCP config + stored OAuth tokens up-front so the
    // system prompt can warn the model away from Claude Code's synthetic
    // `*_authenticate` / `*_complete_authentication` tools for any
    // server the daemon already holds a valid Bearer for. We re-use both
    // values further down at .mcp.json write time — see the spawn block
    // below — instead of re-reading.
    let externalMcpConfig = { servers: [] };
    if (!SANDBOX_RUNTIME.enabled) {
      try {
        externalMcpConfig = await readMcpConfig(RUNTIME_DATA_DIR);
      } catch (err) {
        console.warn(
          '[mcp-config] read failed:',
          err && err.message ? err.message : err,
        );
      }
    }
    const runScopedMcpServers = Array.isArray(run?.toolBundle?.mcpServers)
      ? run.toolBundle.mcpServers
      : [];
    const {
      enabledServers: enabledExternalMcp,
      persistedTokenServerIds,
    } = resolveExternalMcpServersForRun({
      persistedServers: externalMcpConfig.servers,
      runScopedServers: runScopedMcpServers,
      sandboxMode: SANDBOX_RUNTIME.enabled,
    });
    const oauthTokensForSpawn = {};
    if (persistedTokenServerIds.size > 0) {
      try {
        const stored = await readAllTokens(RUNTIME_DATA_DIR);
        for (const [serverId, tok] of Object.entries(stored)) {
          if (!persistedTokenServerIds.has(serverId)) continue;
          // Default to the persisted access token; null it out if expired so
          // we never inject a stale `Authorization: Bearer …` header. The
          // model treats a server with a Bearer pinned as connected and
          // discourages re-auth, which is the worst possible UX when the
          // token is going to 401 every call.
          let access = isTokenExpired(tok) ? null : tok.accessToken;
          if (isTokenExpired(tok) && tok.refreshToken) {
            try {
              const refreshed = await refreshAndPersistToken(
                RUNTIME_DATA_DIR,
                serverId,
                tok,
              );
              if (refreshed) access = refreshed.accessToken;
            } catch (err) {
              console.warn(
                '[mcp-oauth] refresh failed for',
                serverId,
                err && err.message ? err.message : err,
              );
            }
          }
          if (access) {
            oauthTokensForSpawn[serverId] = access;
          } else {
            console.warn(
              '[mcp-oauth] skipping expired token for',
              serverId,
              '— reconnect required',
            );
          }
        }
      } catch (err) {
        console.warn(
          '[mcp-tokens] read failed:',
          err && err.message ? err.message : err,
        );
      }
    }
    const connectedExternalMcp = enabledExternalMcp
      .filter((s) => typeof oauthTokensForSpawn[s.id] === 'string')
      .map((s) => ({ id: s.id, label: s.label }));

        const projectExtensions = projectId
      ? await resolveProjectExtensions({
          dataDir: RUNTIME_DATA_DIR, projectId, skillsRoots: [USER_SKILLS_DIR, SKILLS_DIR],
          catalogSkills: await listAllSkills(),
        })
      : { skills: [], mcpServers: [] };
    const composeDaemonSystemPrompt = async ({
    agentId,
    projectId,
    skillId,
    skillIds,
    streamFormat,
    locale,
    sessionMode,
    appliedPluginSnapshotId,
    mediaExecution,
    byokMediaDefaults,
    projectExtensions: suppliedProjectExtensions = null,
  }) => {
    const project =
      typeof projectId === 'string' && projectId
        ? getProject(db, projectId)
        : null;
                const metadata = project?.metadata;
        // Resource provenance is intentionally independent from project
    // attribution. A Home selection can be staged while Workspace identity is
    // transitioning; the daemon persists the local catalogue partition so
    // the first run reads the same local record without waiting for identity
    // discovery or treating this as remote membership authority.
    let appConfigForPrompt = null;
    try {
      appConfigForPrompt = await readAppConfig(RUNTIME_DATA_DIR);
    } catch (err) {
      console.warn('[app-config] readAppConfig failed', err);
    }
    const effectiveSkillId = typeof skillId === 'string' && skillId ? skillId : project?.skillId;
        const projectExtensions = suppliedProjectExtensions ?? (projectId
      ? await resolveProjectExtensions({
          dataDir: RUNTIME_DATA_DIR, projectId, skillsRoots: [USER_SKILLS_DIR, SKILLS_DIR],
          catalogSkills: await listAllSkills(),
        })
      : { skills: [], mcpServers: [] });
    let allSkillsPromise: ReturnType<typeof listAllSkillLikeEntries> | null = null;
    const loadAllSkills = async () => {
      allSkillsPromise ??= listAllSkillLikeEntries();
      return await allSkillsPromise;
    };

    // Per-turn skills picked via the composer's @-mention popover. They
    // never persist on the project — we just append their bodies after the
    // primary skill so the agent sees one combined block this turn.
    const effectiveCanonicalSkillId =
      typeof effectiveSkillId === 'string' && effectiveSkillId
        ? resolveSkillId(effectiveSkillId)
        : null;
    const adHocSkillIds = Array.isArray(skillIds)
      ? skillIds
          .map((s) => (typeof s === 'string' ? s.trim() : ''))
          .filter(Boolean)
          .filter((id) => resolveSkillId(id) !== effectiveCanonicalSkillId)
      : [];

    let skillBody;
    let skillName;
    let activeSkillDir = null;
    const activeSkillDirs: string[] = [];
    const selectedSkillDirs: string[] = [];
    const selectedSkillIds: string[] = [];
    const registerSkillDir = (dir: string | null | undefined, selected = true, id?: string) => {
      if (typeof dir !== 'string' || dir.length === 0) return;
      if (!activeSkillDir) activeSkillDir = dir;
      if (!activeSkillDirs.includes(dir)) activeSkillDirs.push(dir);
      if (selected && !selectedSkillDirs.includes(dir)) selectedSkillDirs.push(dir);
      if (selected && id && !selectedSkillIds.includes(id)) selectedSkillIds.push(id);
    };
    for (const skill of projectExtensions.skills) registerSkillDir(skill.dir, false);
    if (effectiveSkillId) {
      // Span both functional skills and design templates so a project
      // saved against either surface keeps its system prompt after the
      // skills/design-templates split. See specs/current/skills-and-design-templates.md.
      const allSkills = await loadAllSkills();
      const skill = findSkillById(allSkills, effectiveSkillId);
      if (skill) {
        skillBody = skill.body;
        skillName = skill.name;
        registerSkillDir(skill.dir, true, skill.id);
      }
    }
    let composedSkillBlocks = '';
    if (adHocSkillIds.length > 0) {
      const allSkills = await loadAllSkills();
      const seen = new Set(
        effectiveCanonicalSkillId ? [String(effectiveCanonicalSkillId)] : [],
      );
      const blocks = [];
      const baseBody = skillBody && skillBody.trim().length > 0 ? skillBody : '';
      for (const id of adHocSkillIds) {
        const canonicalId = resolveSkillId(id);
        if (typeof canonicalId !== 'string' || canonicalId.length === 0) continue;
        if (seen.has(canonicalId)) continue;
        seen.add(canonicalId);
        const extra = findSkillById(allSkills, id);
        if (!extra) continue;
        registerSkillDir(extra.dir, true, extra.id);
        blocks.push(
          `\n\n---\n\n## Composed skill — ${extra.name || id}\n\n${(extra.body || '').trim()}`,
        );
      }
      if (blocks.length > 0) {
        composedSkillBlocks = blocks.join('');
        skillBody = baseBody + composedSkillBlocks;
        if (!skillName) {
          skillName = adHocSkillIds.length === 1
            ? findSkillById(allSkills, adHocSkillIds[0])?.name ?? null
            : 'composed';
        }
      }
    }

    // Stage A of plugin-driven-flow-plan: when the run is bound to a
    // plugin snapshot, prefer the plugin's local SKILL.md (declared via
    // `pixo.context.skills[{ path: './SKILL.md' }]`) over the global
    // skill. Without this override the agent loses the plugin's
    // template / token / layout rules and falls back to generic prompt
    // behaviour even though the user explicitly applied the plugin.
    if (
      typeof appliedPluginSnapshotId === 'string'
      && appliedPluginSnapshotId.length > 0
    ) {
      try {
        const snap = getSnapshot(db, appliedPluginSnapshotId);
        if (snap?.pluginId) {
          const plugin = getInstalledPlugin(db, snap.pluginId);
          if (plugin) {
            const { loadPluginLocalSkill } = await import('./plugins/local-skill.js');
            const local = await loadPluginLocalSkill(plugin);
            if (local) {
              skillBody = local.body + composedSkillBlocks;
              skillName = local.name;
              activeSkillDir = local.dir;
              registerSkillDir(local.dir, true, local.name);
            } else {
              // The plugin references a shared global skill by id
              // (`pixo.context.skills[{ ref: '<skill-id>' }]`) instead of
              // shipping its own SKILL.md — resolve it from the global
              // registry so the pinned plugin still gets the skill body AND
              // its companion dir staged into the project cwd (scripts, etc).
              // Lets many example plugins share one skill without each
              // duplicating the SKILL.md and its scripts.
              const skillRef = plugin.manifest?.pixo?.context?.skills?.find(
                (ref): ref is { ref: string } =>
                  typeof (ref as { ref?: unknown })?.ref === 'string'
                  && (ref as { ref: string }).ref.trim().length > 0,
              )?.ref?.trim();
              if (skillRef) {
                const allSkills = await loadAllSkills();
                const refSkill = findSkillById(allSkills, skillRef);
                if (refSkill) {
                  skillBody = refSkill.body + composedSkillBlocks;
                  skillName = refSkill.name;
                  activeSkillDir = refSkill.dir;
                  registerSkillDir(refSkill.dir, true, refSkill.id);
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn(
          `[plugins] pluginSkillBody load failed: ${err?.message ?? err}`,
        );
      }
    }

    // User-level custom instructions from app-config.json.
    let userInstructions = '';
    if (appConfigForPrompt?.customInstructions) {
      userInstructions = appConfigForPrompt.customInstructions;
    }
    const projectInstructions = project?.customInstructions ?? '';

    let pluginBlock;
    if (
      typeof appliedPluginSnapshotId === 'string'
      && appliedPluginSnapshotId.length > 0
    ) {
      try {
        const snap = getSnapshot(db, appliedPluginSnapshotId);
        if (snap) pluginBlock = pluginPromptBlock(snap);
      } catch (err) {
        console.warn(
          `[plugins] pluginBlock build failed: ${err?.message ?? err}`,
        );
      }
    }

    // A plan needs to know the engine before the first asset or scan has recorded it.
    const gameEnginePaths = appConfigForPrompt?.gameEnginePaths ?? {};
    // Its tools are resolved for this run, so a missing engine is stated before the agent builds for it.
    const planEngineProfile = promptEngineProfile(metadata, cwd, { enginePaths: gameEnginePaths });
    const gamePlan = await gamePlanPromptInput(metadata, {
      engineKnown: Boolean(planEngineProfile && planEngineProfile.engine !== 'unknown' && planEngineProfile.confidence !== 'unknown'),
      engineOptions: () => gameEngineOptions(gameTemplatesRoot, gameToolResolver(gameEnginePaths)),
      artStyles: () => listArtStyles(db, typeof locale === 'string' ? locale : undefined).map(({ id, title }) => ({ id, title })),
    });
    const systemPromptInputs = {
      baseDir: cwd ?? PROJECT_ROOT,
      ...gamePromptProjectInputs(metadata),
      engineProfile: planEngineProfile,
      ...(metadata?.gamePlan ? { gamePlan } : {}),
      gameExperience: appConfigForPrompt?.gameExperience ?? null,
      artStyle: projectId ? getProjectArtStyle(db, PROJECT_ROOT, projectId, typeof locale === 'string' ? locale : undefined).style : null,
      agentId, skillBody, skillName,
      recipes: gameRecipePromptEntries(BUNDLED_PLUGINS_DIR, metadata?.engineProfile?.engine, typeof locale === 'string' ? locale : undefined),
      locale: typeof locale === 'string' ? locale : undefined,
      sessionMode: normalizeConversationSessionMode(sessionMode),
      mediaExecution, byokMediaDefaults, streamFormat, pluginBlock,
      // The Settings image pick applies to every run, not only BYOK ones.
      agentImageModel: appConfigForPrompt?.agentImageModel,
      userInstructions, projectInstructions,
    };
    const prompt = composeGameSystemPrompt(systemPromptInputs);
    const defaultSkills = projectId && cwd && streamFormat !== 'plain'
      ? selectDefaultProjectSkills({
          catalog: await listAllSkills(),
          engine: planEngineProfile?.engine,
          disabledSkills: appConfigForPrompt?.disabledSkills,
          excludeIds: [
            ...projectExtensions.skills.map((skill) => skill.id),
            ...(projectExtensions.disabledSkillIds ?? []),
            ...selectedSkillIds,
          ],
        })
      : [];
    // The chat handler also needs to know where the active skill lives
    // on disk so it can stage a per-project copy of its side files
    // before spawning the agent. Returning that here avoids a second
    // `listSkills()` scan in `startChatRun`.
    return {
      prompt,
      activeSkillDir,
      activeSkillDirs: activeSkillDirs,
      defaultSkills,
      selectedSkillDirs,
      selectedSkillIds,
      promptTelemetryParts: {
        skillPrompt: skillBody ?? '',
        pluginStagePrompt: [
          ...([pluginBlock]),
        ]
          .filter((part) => typeof part === 'string' && part.trim().length > 0)
          .join('\n\n---\n\n'),
      },
      // Diagnostic only. The caller merges its own stable inputs
      // (runtimeToolPrompt, the client system prompt) in before hashing, so the
      // section map covers the whole fingerprint rather than just this half.
      stableSectionInputs: systemPromptInputs,
    };
  };

  const artBudgetFacts = run?.mediaExecution?.mode === 'disabled' || (def?.streamFormat ?? 'plain') === 'plain'
      ? { budgetImages: false, budgetUnset: false, turnNote: '' }
      : await artBudgetRunFacts({ ledger: artBudgetLedger, hasSession: () => openPixoAccount.hasSession(), projectId, metadata: projectRecord?.metadata });
  const promptContext = await composeDaemonSystemPrompt({
        agentId,
        projectId,
        projectExtensions,
        skillId,
        skillIds,
        streamFormat: def?.streamFormat ?? 'plain',
        locale,
        sessionMode: runSessionMode,
        mediaExecution: await runMediaExecutionForPrompt(run?.mediaExecution, PROJECT_ROOT, artBudgetFacts.budgetImages, artBudgetFacts.budgetUnset),
        byokMediaDefaults,
        // Plan §3.M2 / §3.V1 — forward the run's snapshot id so the
        // prompt composer can splice in `## Active stage` blocks.
        // Default ON; set PIXO_BUNDLED_ATOM_PROMPTS=0 to opt out.
        appliedPluginSnapshotId: run?.appliedPluginSnapshotId ?? null,
      });
    const {
      prompt: selectedSkillsSystemPrompt,
      activeSkillDirs,
      defaultSkills,
      selectedSkillDirs,
      selectedSkillIds,
      promptTelemetryParts: selectedSkillTelemetryParts,
      stableSectionInputs: selectedSkillSectionInputs,
    } = promptContext;
    const effectiveCwd = cwd ?? PROJECT_ROOT;
    const stagedSkillDirs = new Map<string, string>();
    // Default skills are copied like the rest, but stay out of `activeSkillDirs`:
    // that list also becomes each runtime's extra read access, one entry per skill.
    const skillDirsToStage = [...new Set([...activeSkillDirs, ...defaultSkills.map((skill) => skill.dir)])];
    if (skillDirsToStage.length > 0) {
      for (const skillDir of skillDirsToStage) {
        const result = await stageActiveSkill(
          effectiveCwd,
          skillCwdAliasSegment(skillDir),
          skillDir,
          (msg) => console.warn(msg),
        );
        if (!result.staged) {
          console.warn(
            `[pixo] skill-stage skipped: ${result.reason ?? 'unknown reason'}; falling back to absolute paths`,
          );
        }
        if (result.stagedPath) stagedSkillDirs.set(skillDir, path.relative(effectiveCwd, result.stagedPath).replaceAll('\\', '/'));
      }
    }
    const projectSkillContext = composeProjectSkillContext({
      skills: projectExtensions.skills, defaultSkills, stagedSkillDirs, selectedSkillDirs, selectedSkillIds,
      streamFormat: def?.streamFormat ?? 'plain',
      userMessage: typeof currentPrompt === 'string' ? currentPrompt : message,
    });
    const daemonSystemPrompt = [selectedSkillsSystemPrompt, projectSkillContext.stablePrompt].filter(Boolean).join('\n\n---\n\n');
    const stableSectionInputs = {
      ...selectedSkillSectionInputs,
      skillBody: [selectedSkillSectionInputs.skillBody, projectSkillContext.stablePrompt].filter(Boolean).join('\n\n---\n\n'),
    };
    const promptTelemetryParts = {
      ...selectedSkillTelemetryParts,
      skillPrompt: [selectedSkillTelemetryParts.skillPrompt, projectSkillContext.stablePrompt, projectSkillContext.turnPrompt].filter(Boolean).join('\n\n---\n\n'),
    };
    // Baseline the project's artifact files before the agent runs, so the
    // run-finished handler can diff against them and report `artifact_count`
    // for ANY agent (not just claude_code). Only for real project runs: a
    // null `cwd` means a no-project run rooted at PROJECT_ROOT, whose churn is
    // not the user's artifacts — those fall back to the tool-stream count.
    let baselineEntryFile: string | undefined;
    if (run?.id && cwd) {
      try {
        const before = await snapshotProjectArtifactsAsync(cwd);
        // Async I/O lets cancellation/finalization interleave with the scan.
        // In that case onFinalize already recorded the fallback outcome, so
        // do not leave a stale baseline behind for a completed run.
        if (!run.artifactOutcome && !design.runs.isTerminal(run.status)) {
          runArtifactBaselines.remember(run.id, cwd, before);
          baselineEntryFile = inferBaselineHtmlEntry(cwd, before.keys());
        }
      } catch {
        // Snapshotting is best-effort; finish falls back to the tool-stream count.
      }
    }
    const latestRunPromptForHtmlVersionSnapshot = () => {
      if (run.conversationId) {
        try {
          const row = db.prepare(
            `SELECT content
               FROM messages
              WHERE conversation_id = ?
                AND role = 'user'
                AND LENGTH(TRIM(content)) > 0
              ORDER BY COALESCE(ended_at, started_at, created_at, 0) DESC,
                       position DESC
              LIMIT 1`,
          ).get(run.conversationId);
          if (typeof row?.content === 'string' && row.content.trim()) {
            return { prompt: row.content.trim(), promptSource: 'message' as const };
          }
        } catch {
          // Version prompt provenance is best-effort.
        }
      }
      const requestPrompt =
        typeof currentPrompt === 'string' && currentPrompt.trim()
          ? currentPrompt.trim()
          : typeof message === 'string' && message.trim()
            ? message.trim()
            : null;
      return requestPrompt ? { prompt: requestPrompt, promptSource: 'message' as const } : { prompt: null };
    };
    const resolveRunArtifactOutcomeBeforeFinish = (afterSnapshot?: ReturnType<typeof snapshotProjectArtifacts>) => {
      if (!run?.id) return null;
      if (run.artifactOutcome) return run.artifactOutcome;

      const artifactBaseline = runArtifactBaselines.take(run.id);
      const fallbackOutcome = () => ({
        artifactCount: runArtifactCountForRun(run),
        previewModuleCount: runPreviewModuleCountForRun(run),
        filesWritten: runFilesWrittenForRun(run),
        filesWrittenSource: 'tool_stream' as const,
        filesWrittenUnknown: true,
      });
      let outcome;
      if (!artifactBaseline || artifactBaseline.contended) {
        outcome = fallbackOutcome();
      } else {
        try {
          const diff = diffRunArtifacts(
            artifactBaseline.before,
            afterSnapshot ?? snapshotProjectArtifacts(artifactBaseline.cwd),
          );
          outcome = {
            artifactCount: diff.touched,
            artifactsCreated: diff.created,
            artifactsModified: diff.modified,
            previewModuleCount: diff.previewModuleCount,
            filesWritten: diff.filesWritten,
            filesWrittenSource: 'filesystem' as const,
            filesWrittenUnknown: diff.filesWrittenUnknown === true,
            projectRoot: artifactBaseline.cwd,
            diff,
          };
          run.artifactPaths = diff.touchedPaths
            .map((filePath) => path.relative(artifactBaseline.cwd, filePath))
            .map((filePath) => filePath.replaceAll('\\', '/'))
            .filter((filePath) =>
              filePath.length > 0 &&
              filePath !== '..' &&
              !filePath.startsWith('../') &&
              !path.isAbsolute(filePath),
            );
        } catch {
          outcome = fallbackOutcome();
        }
      }
      run.artifactCount = outcome.artifactCount;
      run.artifactOutcome = outcome;
      return outcome;
    };
    const resolveRunArtifactOutcomeBeforeFinishAsync = async () => {
      if (!run?.id || run.artifactOutcome) return resolveRunArtifactOutcomeBeforeFinish();
      const artifactBaseline = runArtifactBaselines.peek(run.id);
      if (!artifactBaseline || artifactBaseline.contended) {
        return resolveRunArtifactOutcomeBeforeFinish();
      }
      // Keep the baseline registered until the async read completes. A direct
      // cancellation may finalize synchronously in the meantime; the resolver
      // below then observes run.artifactOutcome and discards this late result.
      const afterSnapshot = await snapshotProjectArtifactsAsync(artifactBaseline.cwd);
      return resolveRunArtifactOutcomeBeforeFinish(afterSnapshot);
    };
    // Design §10.3. The properties object is the builder's return value
    // VERBATIM — nothing is spread in or added here, so what the builder's own
    // tests assert on is exactly what reaches the sink.
    const emitChatArtifactCaptureTelemetry = (
      captureRun: { id: string; projectId?: string; analyticsContext?: AnalyticsContext | null },
      report: CaptureRunChatArtifactsReport,
    ) => {
      try {
        const context = captureRun.analyticsContext ?? null;
        if (!context || !captureRun.projectId || !design?.analytics?.capture) return;
        const properties = chatArtifactCaptureResultProps({
          projectId: captureRun.projectId,
          runId: captureRun.id,
          report,
        });
        if (!properties) return;
        design.analytics.capture({
          eventName: 'chat_artifact_capture_result',
          context,
          appVersion: design.getAppVersion?.() ?? 'unknown',
          properties,
          insertId: `chat_artifact_capture_result:${captureRun.id}`,
        });
      } catch {
        // Telemetry never changes the turn's outcome.
      }
    };
    // Freeze this turn's artifact evidence while the daemon still owns the
    // moment: at the terminal chokepoint, BEFORE the terminal SSE frame goes
    // out and before any client can see the message as done. A snapshot taken
    // after that races the next turn's overwrite, which is exactly the bug this
    // exists to close. Never throws — a failed capture degrades one card, it
    // does not fail the run.
    const captureChatArtifactsBeforeSuccess = async () => {
      try {
        if (!run?.projectId || !run.assistantMessageId) return;
        const outcome = await resolveRunArtifactOutcomeBeforeFinishAsync();
        const touchedPaths = Array.isArray(outcome?.diff?.touchedPaths)
          ? outcome.diff.touchedPaths
          : [];
        if (!outcome?.projectRoot || touchedPaths.length === 0) return;
        // Attach the turn's deliverable to the turn, before anything else here
        // can fail. `produced_files_json` otherwise has exactly one writer — a
        // closure inside the browser's `ProjectView` — so a run whose viewer
        // navigated away finishes with its artifacts orphaned, and the client's
        // own repair window has closed by the time the user returns
        // (OPEND-2598 / OPEND-2608). This only fills a column that is still
        // NULL, so the client's list stays authoritative when it does arrive.
        // Its own try: a produced-file miss must not cost the snapshot capture
        // below, and vice versa.
        try {
          await associateRunProducedFiles(db, {
            messageId: run.assistantMessageId,
            projectRoot: outcome.projectRoot,
            touchedPaths,
          });
        } catch (err) {
          console.warn('[chat-artifacts] produced-file association failed', err);
        }
        const deps = { db, blobs: CHAT_ARTIFACT_BLOBS, quota: CHAT_ARTIFACT_QUOTA };
        const captured = await captureRunChatArtifactSnapshots(deps, {
          projectId: run.projectId,
          projectRoot: outcome.projectRoot,
          messageId: run.assistantMessageId,
          runId: run.id,
          touchedPaths,
        });
        emitChatArtifactCaptureTelemetry(run, captured);
        // Same chokepoint, same reason (spec §6.3). The image path above froze
        // BYTES here; this freezes the HTML card's RENDERER INPUT here, so the
        // cover render that follows can take its seconds without the file it is
        // drawing being allowed to change underneath it. Only the freeze is
        // awaited — the render deliberately outlives the turn.
        await freezeAndRenderChatArtifactCovers(deps, {
          projectRoot: outcome.projectRoot,
          rows: captured.rows,
          renderer: desktopArtifactExporter,
          /*
           * The cover outlives the turn by design, so it lands into a message
           * the client already filed as done — after the single post-run
           * re-read (`ProjectView.scheduleConversationMessageRefresh`, 150ms)
           * has been and gone. Without this nudge the card keeps the
           * live-iframe degrade branch until a full reload, which is the
           * regression spec line 505 exists to forbid.
           *
           * Thin on purpose: it names the stale message and nothing else, so
           * `listMessages` stays the only thing that decides what a ref is.
           */
          onRefsChanged: (row) => {
            if (!run.projectId || !run.conversationId) return;
            emitProjectEvent(run.projectId, {
              type: 'chat-artifact-refs-changed',
              projectId: run.projectId,
              conversationId: run.conversationId,
              messageId: row.messageId,
              at: Date.now(),
            });
          },
        });
      } catch (err) {
        console.warn('[chat-artifacts] run terminal capture failed', err);
      }
    };
    const snapshotAiHtmlVersionsBeforeSuccess = async () => {
      const origin = artifactOriginForRun({
        runId: run.id,
        externalPluginAnalytics: run.externalPluginAnalytics,
      });
      if (origin) {
        // A successful Plugin run starts pessimistically. Only the exact
        // versions returned by the snapshot writer may promote it to matched.
        run.artifactOriginStatus = 'missing_version';
        run.artifactVersionId = undefined;
      }
      const outcome = await resolveRunArtifactOutcomeBeforeFinishAsync();
      if (!outcome?.diff || !outcome.projectRoot || !run.projectId) return;
      const promptInfo = latestRunPromptForHtmlVersionSnapshot();
      const result = await snapshotAiHtmlVersionsForRun({
        projectsRoot: PROJECTS_DIR,
        projectId: run.projectId,
        projectRoot: outcome.projectRoot,
        diff: outcome.diff,
        prompt: promptInfo.prompt,
        ...(promptInfo.promptSource ? { promptSource: promptInfo.promptSource } : {}),
        ...(origin ? { origin } : {}),
        metadata: projectRecord?.metadata,
      });
      // §3.2 lineage, backfilled rather than reordered: the chat-artifact refs
      // were written a few lines above, before these versions existed. Never
      // allowed to fail the run — a card without lineage is still a card.
      if (run.assistantMessageId && result.snapshots.length > 0) {
        try {
          setMessageArtifactHtmlVersionIds(
            db,
            run.assistantMessageId,
            new Map(result.snapshots.map(({ fileName, version }) => [fileName, version.id])),
          );
        } catch (err) {
          console.warn('[chat-artifacts] html version lineage backfill failed', err);
        }
      }
      if (origin) {
        const matching = result.snapshots.filter(({ version }) =>
          version.origin?.entrySurface === origin.entrySurface
          && version.origin.externalPluginId === origin.externalPluginId
          && version.origin.pluginWorkflowId === origin.pluginWorkflowId
          && version.origin.runId === origin.runId,
        );
        if (matching.length > 0) {
          run.artifactOriginStatus = 'matched';
          const configuredEntry =
            typeof projectRecord?.metadata?.entryFile === 'string'
              ? projectRecord.metadata.entryFile.replaceAll('\\', '/')
              : null;
          const selected =
            (configuredEntry
              ? matching.find(({ fileName }) => fileName === configuredEntry)
              : undefined)
            ?? (matching.length === 1 ? matching[0] : undefined);
          run.artifactVersionId = selected?.version.id;
        }
      }
    };
    // Chain onto the run service's terminal chokepoint so startup rejection,
    // direct cancellation, shutdown, and every explicit finish path all consume
    // their filesystem baseline before the terminal SSE frame is published.
    const previousOnFinalize = run.onFinalize;
    run.onFinalize = () => {
      try {
        previousOnFinalize?.();
      } finally {
        resolveRunArtifactOutcomeBeforeFinish();
      }
    };
    const toolOutputDirs = await chatToolOutputDirs(ARTIFACTS_DIR, projectId);
    const extraAllowedDirs = [
      ...resolveChatExtraAllowedDirs({
        agentId,
        skillsDir: SKILLS_DIR,
        linkedDirs,
        activeSkillDirs,
        toolOutputDirs,
      }),
      ...([]),
    ];
    const researchCommandContract = resolveResearchCommandContract(
      research,
      message,
    );
    // Resume-capable adapters continue their own upstream session so they
    // keep working memory across turns. Decide once per run; reuse for the
    // prompt-composition skipTranscript choice, the buildArgs flags, and the
    // create-turn persistence below.
    const agentSupportsSessionResume =
      runtimeResumesSessionById(def);
    // Capture-style adapters (codex) mint their OWN session id and report it on
    // the stream; the daemon captures it here and persists THAT as the resume
    // handle instead of `agentResumeCtx.newSessionId` (which such CLIs ignore).
    // Set from the `status` event's `sessionId` in `sendAgentEvent` below.
    const agentCapturesSessionId = def.capturesSessionIdFromStream === true;
    let capturedSessionId: string | null = null;
    let configuredAgentEnv = {};
    let appConfigForRun = null;
    try {
      const appConfig = await readAppConfig(RUNTIME_DATA_DIR);
      appConfigForRun = appConfig;
      configuredAgentEnv = agentCliEnvForAgent(appConfig.agentCliEnv, def.id);
    } catch {
      configuredAgentEnv = {};
    }
    const requestedLiveModelScope = null;
    const configuredModel =
      typeof appConfigForRun?.agentModels?.[def.id]?.model === 'string'
        ? appConfigForRun.agentModels[def.id].model
        : null;
    let safeModel = nativeCodexProvider?.model ?? resolveModelForAgent(
      def,
      typeof requestedRuntimeModel === 'string'
        ? isKnownModel(def, requestedRuntimeModel, requestedLiveModelScope)
          ? requestedRuntimeModel
          : sanitizeCustomModel(requestedRuntimeModel)
        : configuredModel,
      requestedLiveModelScope,
    );
    const safeReasoning =
      typeof reasoning === 'string' &&
      (nativeCodexProvider?.provider.id === 'deepseek'
        ? ['low', 'high', 'max'].includes(reasoning)
        : isKnownReasoningEffort(def, safeModel, reasoning, requestedLiveModelScope))
        ? reasoning
        : null;
    safeModel = nativeCodexProvider?.model ?? resolveModelForServiceTier(
      def,
      safeModel,
      typeof serviceTier === 'string' ? serviceTier : null,
      requestedLiveModelScope,
    );
    const safeServiceTier =
      !nativeCodexProvider &&
      typeof serviceTier === 'string' &&
      isKnownServiceTier(def, safeModel, serviceTier, requestedLiveModelScope)
        ? serviceTier
        : null;
    const agentOptions = {
      model: safeModel,
      reasoning: safeReasoning,
      serviceTier: safeServiceTier,
    };
    const agentLaunch = await resolveAgentLaunchAsync(def, configuredAgentEnv);
    const resolvedBin = agentLaunch.selectedPath;
    if (nativeCodexProvider && agentLaunch.launchPath) {
      const versions = await ensureDetectedRuntimeVersions('codex', configuredAgentEnv);
      if (!nativeCodexProviderSupportsVersion(versions?.agentCliVersion)) return failRun('AGENT_UNAVAILABLE', 'Native DeepSeek/OpenRouter requires Codex CLI 0.160.0 or newer. Update Codex and refresh the agent list in Settings.');
    }

    const resolvedAgentResumeCtx =
      agentSupportsSessionResume && run.conversationId
        ? resolveAgentResumeContext(db, {
            conversationId: run.conversationId,
            agentId: def.id,
            currentModel: nativeCodexProvider?.sessionIdentity ?? safeModel ?? null,
            currentCwd: effectiveCwd,
            currentAssistantMessageId: run.assistantMessageId ?? null,
          })
        : { storedSessionId: null as string | null, resumeSessionId: null as string | null, newSessionId: undefined as string | undefined, isResuming: false, storedStablePromptHash: null as string | null, storedInputTokens: null as number | null, storedStableSections: null as StableSectionHashes | null, invalidationReason: null };
    // A same-run post-tool recovery resumes the exact session id captured from
    // the interrupted attempt. The ordinary cross-turn cursor guard cannot
    // admit it yet because the current assistant placeholder is still in
    // flight, so this daemon-only path supplies the already-validated handle
    // directly. Public chat requests cannot reach this branch.
    const forceInternalResume =
      pendingNativeSessionContinue != null &&
      (runtimeResumesSessionById(def)) &&
      pendingNativeSessionContinue.sessionId.length > 0;
    const agentResumeCtx = forceInternalResume
      ? {
          ...resolvedAgentResumeCtx,
          storedSessionId: pendingNativeSessionContinue.sessionId,
          resumeSessionId: pendingNativeSessionContinue.sessionId,
          isResuming: true,
          storedStablePromptHash:
            pendingNativeSessionContinue.stablePromptHash ?? null,
          storedStableSections:
            pendingNativeSessionContinue.stablePromptSections ?? null,
          storedInputTokens:
            pendingNativeSessionContinue.lastInputTokens ?? null,
          invalidationReason: null,
        }
      : resolvedAgentResumeCtx;
    const publishNativeSessionRecoveryMetadata = () => {
      if (!run.nativeSessionRecovery) return;
      design.runs.emit(run, 'diagnostic', {
        type: 'native_session_recovery',
        nativeSessionRecovery: run.nativeSessionRecovery,
      });
    };
    // Physical attempts share run.events, so scanning that logical-run tail can
    // assign attempt A's usage to attempt B's different session. Keep only this
    // attempt's usage frames here; a fresh startChatRun closure starts empty.
    const physicalSessionUsage = createPhysicalAgentSessionUsageTracker(
      pendingNativeSessionContinue?.lastInputTokens ?? null,
    );
    const observedInputTokensForSession = physicalSessionUsage.inputTokens;
    run.nativeSessionRecovery = initialNativeSessionRecoveryMetadata({
      agent: def,
      supportsSessionResume: agentSupportsSessionResume,
      isResuming: agentResumeCtx.isResuming,
      resumeSessionId: agentResumeCtx.resumeSessionId,
      storedSessionId: agentResumeCtx.storedSessionId,
      invalidationReason: agentResumeCtx.invalidationReason,
    });
    publishNativeSessionRecoveryMetadata();
    /*
     * The plan the previous turn last declared — whole, finished rows included.
     *
     * Read here, on the path that already queries this conversation for the
     * resume cursor, and handed to the agent as a fact it decides about — see
     * `renderUnfinishedTodoRecall`, which decides whether any of it is still
     * open and renders nothing when none of it is. Every runtime gets it, not
     * just the 6 with native resume: the 21 that start a fresh process each
     * turn are exactly the ones with no other way to know. A read failure
     * degrades to "nothing outstanding" rather than failing the run.
     *
     * NOTE(sync/main): the retired Next-strategy request stage composes its own user prompt
     * from the frozen task bundle, so recall is not threaded into that branch —
     * the bundle IS the turn's stated input. Recall still applies to every
     * ordinary chat turn, which is where it was measured.
     */
    const previousTurnTaskList: RecalledTodo[] = run.conversationId
      ? (() => {
          try {
            return recalledTodosFromTodoWriteInput(
              latestTodoWriteInputForConversation(
                db,
                run.conversationId,
                run.assistantMessageId ?? '',
              ),
            );
          } catch {
            return [];
          }
        })()
      : [];
    const agentResumePromptPolicy = resolveAgentResumePromptPolicy(agentResumeCtx);
    // A continuation directive whose stored session the daemon just refused has
    // to be told which request it is continuing; see
    // `resolveResumeContinuationSeed`. Callers that ship their own transcript
    // never set `resumeContinuation`, so this stays null for them.
    const resumeContinuationSeed = resolveResumeContinuationSeed({
      isContinuation: resumeContinuation === true,
      requiresFullTranscript: agentResumePromptPolicy.requiresFullTranscript,
      storedSessionId: agentResumeCtx.storedSessionId,
      storedLastMessageId: agentResumeCtx.storedLastMessageId,
    });
    const resumeContinuationOriginalRequest =
      resumeContinuationSeed.required
      && run.conversationId
      && resumeContinuationSeed.anchorAssistantMessageId
        ? userRequestBeforeAssistantMessage(
            db,
            run.conversationId,
            resumeContinuationSeed.anchorAssistantMessageId,
          )
        : null;
    const userRequestPrompt = composeChatUserRequestForAgent(
          message,
          currentPrompt,
          // Only trim to the latest turn when we are actually resuming an
          // existing session. A create turn still sends the full transcript so
          // a brand-new session (incl. first turn after another agent)
          // is seeded with prior context.
          {
            skipTranscript: agentResumePromptPolicy.skipTranscript,
            previousTurnTaskList,
            resumeContinuationOriginalRequest,
          },
        );
    // The stable instruction slice (daemon prompt + tool contract + system
    // prompt = project instructions / skills) is identical across turns of
    // a conversation in the common case. A resumed Claude session already
    // holds it, so on resume turns we skip it unless it changed since the
    // session was seeded — keyed by a hash stored on agent_sessions. Create
    // turns and changed-hash turns send the full block (byte-identical to the
    // previous behavior); non-resume agents have isResuming === false and so
    // always send the full block.
    const stableInstructionFingerprint = ([daemonSystemPrompt, runtimeToolPrompt, systemPrompt])
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .join('\n\n---\n\n');
    const currentStableHash = hashStableInstructions(stableInstructionFingerprint);
    // Per-section digests of the SAME inputs the fingerprint is built from, so a
    // drift event can name which one moved. `currentStableHash` above stays the
    // sole re-send decider — these only label a decision already made.
    const currentStableSections = computeStableSectionHashes({
      ...(stableSectionInputs ?? {}),
      runtimeToolPrompt,
      clientSystemPrompt: systemPrompt,
    });
    // `runtimeToolPrompt` is part of the fingerprint and varies only when the
    // tool-token grant's presence flips between turns (rare cwd/projectId edge
    // cases); any such change correctly forces a full re-send that turn.
    const includeStableInstructions = computeIncludeStable(
      agentResumePromptPolicy.skipTranscript,
      agentResumeCtx.storedStablePromptHash,
      currentStableHash,
    );
    run.promptCache = describeStablePromptCache({
      isResuming: agentResumePromptPolicy.skipTranscript,
      storedStablePromptHash: agentResumeCtx.storedStablePromptHash,
      currentStableHash,
      storedStableSections: agentResumeCtx.storedStableSections,
      currentStableSections,
    });
    const currentStableSectionsJson = serializeStableSections(currentStableSections);
    const titleGenerationRequested =
      titleGeneration &&
      typeof titleGeneration === 'object' &&
      titleGeneration.enabled === true &&
      !agentResumeCtx.isResuming;
    const titleGenerationPrompt = titleGenerationRequested
      ? [
          'Internal title task:',
          'Before answering the user request, emit exactly one short title marker:',
          '<pixo-title>Title Here</pixo-title>',
          'Rules: 2-6 words, preserve the user request language, no quotes, no markdown, no punctuation unless necessary.',
          'Do not mention this title task to the user. Continue with the normal answer after the title marker.',
        ].join('\n')
      : '';
    /*
     * This turn's done-marker contract.
     *
     * It lives in the per-turn slice for the same reason the connected-MCP
     * directive does (see the note just below): the key is a fresh nonce every
     * run, so putting it in `daemonSystemPrompt` would move the cached stable
     * prefix on EVERY turn of EVERY conversation — a guaranteed
     * `stable-prompt-changed` miss that also invalidates the upstream cache for
     * the whole conversation history downstream of it. The rules are cheap to
     * restate per turn; the prefix is not cheap to lose.
     *
     * Wording mirrors the `<pixo-title>` task above it — same shape of contract
     * (emit one inline marker the host parses and strips), same "don't narrate
     * this to the user" clause.
     */
    /*
     * The run's UI locale rides along (OPEND-2765).
     *
     * The game prompt's language rule (`renderLanguageRule`) states the same
     * fallback, but it lives in `daemonSystemPrompt` — the cache-stable head, which the payload below
     * drops whenever `includeStableForPayload` is false. These three markers
     * are re-sent every turn because of the nonce, so on a resume turn the
     * marker contract was arriving with no locale attached and the follow-up
     * suggestions came back in English on a zh-CN run.
     */
    const hostProtocol = renderChatTurnHostProtocolInstructions(
      typeof run.doneKey === 'string' ? run.doneKey : '',
      'ordinary',
      typeof locale === 'string' ? locale : undefined,
    );
    /*
     * This turn's follow-up suggestions.
     *
     * Shares the per-turn nonce with the done marker above — see
     * `packages/contracts/src/api/next-step-marker.ts` for why this marker is
     * keyed at all (clicking a suggestion sends that exact sentence as the
     * user's next message, so an unkeyed marker would let any text the agent
     * read plant a sentence in the user's own composer path). Reusing the
     * existing nonce keeps the cost at one prompt sentence: no second key to
     * mint, no second event on the wire, and the model has already copied this
     * exact string once in the same turn.
     *
     * Per-turn slice for the same cache reason as the done marker: a fresh
     * nonce in the stable prefix would miss the prompt cache on every turn.
     */
    /*
     * This turn's display intent.
     *
     * Same per-turn slice and same shared nonce as the two markers above — see
     * `packages/contracts/src/api/artifact-focus-marker.ts` for why this one is
     * keyed (it names a path the host then reads and renders, so an unkeyed
     * form would let any document the agent merely READ steer the preview).
     *
     * The body lives next to the parser rather than here, so the instruction,
     * the example it shows, and the regexes that accept it cannot drift apart —
     * and so a BYOK path composing its own per-turn slice reads the same string
     * instead of a second copy of it. `renderArtifactFocusInstruction` returns
     * '' without a key, which is the same guard the two markers above spell out
     * inline.
     */
    // The connected-external-MCP directive reflects live OAuth token state,
    // which flips mid-conversation as Bearers expire/refresh. Keeping it out of
    // the cached stable prefix (daemonSystemPrompt) and re-sending it here in
    // the per-turn slice keeps the upstream prompt-cache prefix byte-stable
    // across resumes (protecting the conversation-history cache) while still
    // giving the model the current MCP auth state on every turn.
    const mcpConnectedDirective = renderConnectedExternalMcpDirective(connectedExternalMcp);
    /*
     * NOTE(sync/main): this branch used to hand-roll the client instruction
     * slice here (`clientInstructionParts` + `composeLiveInstructionPrompt`).
     * origin/main extracted that composition into `composeChatAgentTextPayload`
     * (see the call below), which owns the contributor registry and the retired Next-strategy
     * exact-input coverage assertion. We adopt main's composer and feed this
     * branch's three per-turn directives — done key, `<pixo-next>` suggestions and
     * `<pixo-focus>` — through its `clientSystemPrompt` slot, which is the same
     * position they occupied in the old array (after the title directive,
     * ahead of the system prompt). Unlike `systemPrompt` they are NOT gated on
     * `includeStableForPayload`: each carries this turn's nonce, so it has to be
     * restated every turn or the marker it authorises cannot be validated.
     */
    // Some models (notably claude-opus-4-7 with --include-partial-messages)
    // start their reply by echoing the top of the user message verbatim,
    // so the rendered chat shows a "# Instructions ..." block ahead of the
    // real answer. Closing every Instructions block with an explicit
    // "do not echo" line cuts the regression in practice without changing
    // the turn-shape every agent CLI expects (user message carrying both
    // instructions and request) — see server.ts:9920 composer notes.
    const ECHO_GUARD =
      '\n\n(Do not quote, restate, or echo the # Instructions block above in your reply. Begin your response with the answer to the # User request below.)';
    const formAnswerMatch = FORM_ANSWERS_HEADER_RE.exec(
      typeof currentPrompt === 'string' ? currentPrompt : '',
    );
    const formIdForOverride = formAnswerMatch
      ? ((formAnswerMatch[1] || 'form').trim().replace(/[^\w.-]/g, '') || 'form').toLowerCase()
      : null;
    const formOverride =
      formIdForOverride === 'discovery' || formIdForOverride === 'task-type'
        ? FORM_ANSWERED_SYSTEM_OVERRIDE
        : formIdForOverride !== null
          ? FORM_ANSWERED_GENERIC_OVERRIDE
          : '';
    const agentFormOverride = formOverride;
    const agentEchoGuard = ECHO_GUARD;
    const includeStableForPayload = includeStableInstructions;
    const promptImagePaths = safeImages;
    const composedResult = composeChatAgentTextPayload({
      formOverride: agentFormOverride,
      daemonSystemPrompt: includeStableForPayload ? daemonSystemPrompt : '',
      runtimeToolPrompt: includeStableForPayload ? runtimeToolPrompt : '',
      researchCommandContract,
      runContextPrompt,
      connectedExternalMcpReference: mcpConnectedDirective,
      titleGenerationDirective: titleGenerationPrompt,
      // This branch's per-turn directives ride in ahead of the system prompt,
      // exactly where they sat in the pre-merge `clientInstructionParts` array.
      // Each is keyed on this run's nonce, so they are unconditional while
      // `systemPrompt` stays gated on the stable-slice decision.
      clientSystemPrompt: [
        hostProtocol.doneMarker,
        hostProtocol.nextSteps,
        hostProtocol.artifactFocus,
        artBudgetFacts.turnNote,
        // Static per plan status, but resumed sessions skip the stable prompt: see `renderGamePlanTurnNote`.
        renderGamePlanTurnNote(projectRecord?.metadata?.gamePlan?.status, typeof locale === 'string' ? locale : undefined),
        includeStableForPayload ? systemPrompt : '',
      ]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join('\n\n---\n\n'),
      cwdReference: cwdHint,
      linkedDirectoryReferences: linkedDirsHint,
      echoGuard: agentEchoGuard,
      requestOrStageText: userRequestPrompt,
      projectAttachmentReferences: attachmentHint,
      imageReferences: promptImagePaths.map((p) => `@${p}`).join(' '),
        });
    const {
      composedPrompt: baseComposed,
      clientInstructionPrompt,
    } = composedResult;
    const composed = [baseComposed, projectSkillContext.turnPrompt]
      .filter(Boolean).join('\n\n---\n\n');
    const promptTelemetry = buildPromptStackTelemetry({
      composedPrompt: composed,
      sections: [
            { kind: 'formOverride', content: agentFormOverride },
            // Phase 1 explicitly needs redactedContent for these aggregate prompts:
            // they are the quickest way to inspect the system context sent to the
            // model when diagnosing local run recordings.
            { kind: 'daemonSystemPrompt', content: daemonSystemPrompt },
            { kind: 'runtimeToolPrompt', content: runtimeToolPrompt },
            { kind: 'researchCommandContract', content: researchCommandContract },
            { kind: 'runContextPrompt', content: runContextPrompt },
            { kind: 'clientSystemPrompt', content: clientInstructionPrompt },
            { kind: 'echoGuard', content: ECHO_GUARD },
            { kind: 'userRequest', content: userRequestPrompt },
            { kind: 'skillPrompt', content: promptTelemetryParts?.skillPrompt },
            {
              kind: 'pluginStagePrompt',
              content: promptTelemetryParts?.pluginStagePrompt,
            },
            { kind: 'cwdHint', content: cwdHint, metadata: cwd ? [cwd] : [] },
            {
              kind: 'linkedDirsHint',
              content: linkedDirsHint,
              metadata: linkedDirs,
            },
            {
              kind: 'attachments',
              content: attachmentHint,
              metadata: safeAttachments,
            },
            {
              kind: 'promptImagePaths',
              content: promptImagePaths.join('\n'),
              metadata: promptImagePaths,
            },
          ],
    });
    run.promptTelemetry = promptTelemetry;
    lifecycle.mark('prompt_build_end');
    lifecycle.mark('launch_preflight_start');

    const executionProfile = executionProfileFromStreamFormat(def.streamFormat);
    // The agent's visible text this run accumulates onto `run.askUserScanText`
    // (see the `send` hook below), so BOTH consumers of "did this turn end on a
    // clarifying question form?" read one buffer:
    //
    //   · the missing-artifacts guard at child close. The `pixo-plugin-authoring`
    //     plugin's turn-1 flow is to emit a `<question-form>` collecting the
    //     brief, then STOP and wait for the user (see the
    //     `discovery-question-form` atom in `plugins/scaffold.ts`). That turn
    //     legitimately closes with `code === 0` and no `generated-plugin/`
    //     artifacts yet, so the guard must not call it a failure;
    //   · `finish()` in `runtimes/runs.ts`, which asks the canonical
    //     `turnEndedByAskingUser` whether the turn handed the baton back to the
    //     user before it stamps `endedWithUnfinishedWork`.
    //
    // It lives on the run rather than in this closure because `finish()` runs in
    // the run service, which cannot see route locals. We buffer the streamed
    // text rather than read the persisted message because the assistant message
    // row may not be wired up at close time, and cap it because a clarification
    // form streams near the top of the turn — enough to validate the first
    // complete block (see `emittedRenderableQuestionForm`). Past the cap the
    // signal fails CLOSED: the turn keeps reporting its TodoWrite verdict rather
    // than inventing a form.
    let visibleAssistantText = '';
    // Everything this attempt put on stderr, kept as a bounded rolling window so
    // the terminal `error` frame can carry the ORIGINAL cause and not only the
    // daemon's own generic sentence. The window is deliberately larger than the
    // tail the card shows, so the tail is always computed over a full slice of
    // final output rather than over whatever happened to arrive last. Scoped to
    // one spawn attempt: a same-run retry re-enters startChatRun and gets a
    // fresh closure, so a failed attempt's output can never be attributed to the
    // next one's error frame.
    const FAILURE_STDERR_WINDOW_CAP = 32 * 1024;
    let failureStderrWindow = '';
    // Run instrumentation sits ON the path the model's bytes travel: `send`
    // is the single choke point every stream event passes through on its way
    // to the user, and the strategy's close-time tail is broadcast from the
    // child-close handler. A throw from instrumentation there does not cost an
    // analytics field, it costs the user the entire reply — so every mark goes
    // through here and its failures are contained to itself. The guard is
    // scoped to the marks alone; nothing that decides what the user receives
    // is inside it.
    let lifecycleTelemetryFaultWarned = false;
    const recordRunTelemetry = (label: string, record: () => void): void => {
      try {
        record();
      } catch (error) {
        // One line per run, not per event: a broken classifier would otherwise
        // log once per delta and bury the runs around it.
        if (lifecycleTelemetryFaultWarned) return;
        lifecycleTelemetryFaultWarned = true;
        console.warn(
          `[telemetry] run lifecycle instrumentation failed (${label}); run timing will be incomplete`,
          error,
        );
      }
    };
    // The single rule for "did the user actually receive something". Both
    // emission paths apply it: `send` for the live stream, and the strategy's
    // close-time tail, which cannot re-enter `send` because the protocol is
    // already finished. Keeping one rule is what stops the two paths from
    // disagreeing about what counts as visible output.
    const applyVisibleOutputMarks = (
      markers: RunLifecycleStreamEventMarkers,
    ): void => {
      // Sole owner of `first_visible_output`. A mark here means the bytes
      // really did leave the daemon — past the title-marker stripper, past the
      // role-marker guard, past the strategy protocol, past close-time
      // buffering. Do not stamp this mark from a decode site: doing so is what
      // made `time_to_first_visible_output_ms` identical to
      // `time_to_first_token_ms` on every run.
      if (markers.firstVisibleOutput) {
        lifecycle.mark('first_visible_output');
      }
      if (markers.firstArtifactWrite) {
        lifecycle.mark('first_artifact_write');
      }
    };
    const send = (event, data) => {
      // A run the OpenPixo gateway refused fails with the gateway's reason.
      if (event === 'error') data = openPixoAgentGateway.overrideRunError(run.id, data);
      if (event === 'agent' && data?.type === 'usage') {
        physicalSessionUsage.observe(event, data);
      }
      recordRunTelemetry(`stream event ${event}`, () => {
        const lifecycleMarkers = runLifecycleMarkersForStreamEvent(event, data);
        if (lifecycleMarkers.firstModelEventType) {
          lifecycle.markFirstModelEvent(
            lifecycleMarkers.firstModelEventType,
            lifecycleMarkers.firstModelEventAt,
          );
        }
        applyVisibleOutputMarks(lifecycleMarkers);
      });
      if (
        event === 'agent' &&
        data &&
        data.type === 'text_delta' &&
        typeof data.delta === 'string' &&
        (run.askUserScanText?.length ?? 0) < ASK_USER_SCAN_CAP
      ) {
        run.askUserScanText = ((run.askUserScanText ?? '') + data.delta).slice(
          0,
          ASK_USER_SCAN_CAP,
        );
      }
      if (
        event === 'agent' &&
        data &&
        data.type === 'text_delta' &&
        typeof data.delta === 'string'
      ) {
        visibleAssistantText += data.delta;
        const doneCapture = advanceAuthenticatedDoneCapture({
          fullVisibleText: visibleAssistantText,
          delta: data.delta,
          key: typeof run.doneKey === 'string' ? run.doneKey : '',
          state: {
            markerTail: run.completionMarkerTail,
            awaitingConclusion: run.completionMarkerAwaitingConclusion,
            authenticatedConclusion: run.authenticatedDoneConclusion,
          },
        });
        run.completionMarkerTail = doneCapture.markerTail;
        run.completionMarkerAwaitingConclusion = doneCapture.awaitingConclusion;
        run.authenticatedDoneConclusion = doneCapture.authenticatedConclusion;
      }
      if (event === 'stderr' && data && typeof data.chunk === 'string' && data.chunk) {
        failureStderrWindow = `${failureStderrWindow}${data.chunk}`.slice(
          -FAILURE_STDERR_WINDOW_CAP,
        );
      }
      // One decoration point for both consumers below: the live SSE client and
      // the persisted assistant message get the same error payload, so a reload
      // shows exactly what the run showed.
      const outgoing = withFailureStderrTail(event, data, failureStderrWindow);
      persistRunEventToAssistantMessage(db, run, event, outgoing);
      design.runs.emit(run, event, outgoing);
    };
    const retryAnalyticsBase = (decision, failure, errorCode) => {
      const runProjectKind = resolveRunProjectKindForAnalytics({
        hintProjectKind: null,
        projectMetadata: projectRecord?.metadata,
      });
      return {
        page_name: 'chat_panel',
        area: 'chat_panel',
        project_id: typeof projectId === 'string' ? projectId : run.projectId,
        conversation_id:
          typeof conversationId === 'string' ? conversationId : run.conversationId ?? null,
        run_id: run.id,
        retry_of_run_id: run.id,
        retry_attempt_index: decision.retryAttemptIndex,
        retry_max_attempts: decision.retryMaxAttempts,
        retry_strategy: decision.retryStrategy,
        agent_provider_id: agentIdToTracking(agentId),
        model_id: modelIdForTracking(safeModel ?? model),
        ...(failure?.failure_category ? { failure_category: failure.failure_category } : {}),
        ...(failure?.failure_detail ? { failure_detail: failure.failure_detail } : {}),
        ...(failure?.failure_stage ? { failure_stage: failure.failure_stage } : {}),
        ...(failure?.terminal_trigger ? { terminal_trigger: failure.terminal_trigger } : {}),
        ...(errorCode ? { error_code: errorCode } : {}),
      };
    };
    const destroyChildStdio = (child) => {
      // Best-effort cleanup of stdio streams on a child process we're about
      // to drop. The daemon-sidecar (apps/daemon) keeps listeners attached
      // to child.stdout / child.stderr / child.stdin across the run
      // lifecycle (line ~12890..~13500+ in this file). Those listeners hold
      // the Stream objects alive, and the Stream objects own the read side
      // of the OS pipes — so dropping the child reference via
      // `run.child = null` without destroying the streams leaks the pipe
      // file descriptors. After a few hundred retries the daemon
      // accumulates 10k+ FDs and posix_spawn returns EBADF.
      //
      // See: inherited issue #4100
      if (!child) return;
      const destroyStream = (stream) => {
        if (!stream || stream.destroyed) return;
        try { stream.removeAllListeners(); } catch {}
        try { stream.destroy(); } catch {}
      };
      destroyStream(child.stdout);
      destroyStream(child.stderr);
      destroyStream(child.stdin);
    };
    // Synchronously detach the failed attempt: kill the old child and move the
    // run back to `queued` *now*, even when the re-spawn is delayed by backoff.
    // This must not be deferred — leaving the old child alive during the backoff
    // window lets a follow-on signal (e.g. the inactivity watchdog's SIGTERM)
    // drive a second close-handler pass that finalizes the run as failed before
    // the retry ever spawns.
    const tearDownAttemptForRetry = () => {
      cleanupExtensionFiles();
      // Snapshot the failing attempt's child + process group BEFORE we detach
      // them, so the reap targets THIS attempt's group and never the next one.
      const priorChild = run.child;
      const priorProcessGroupId = run.processGroupId;
      // Release the previous child's stdio streams before letting the
      // reference drop — see destroyChildStdio for rationale.
      destroyChildStdio(priorChild);
      // Disband the WHOLE process group of the failed attempt, not just the
      // direct child. A same-run retry that only SIGTERMs run.child leaves the
      // CLI's spawned descendants (MCP servers, tool subprocesses) orphaned
      // (re-parented to PID 1), accumulating one leaked group per retry. Reap by
      // the CAPTURED pgid — the SIGKILL escalation is bound to it, so it can
      // never hit the next attempt's group (the cross-generation kill fixed in
      // #5202). On win32 / no pgid, fall back to signalling the direct child.
      const termination = design.runs.terminateProcessTree(
        run,
        priorChild,
        priorProcessGroupId,
        { reason: 'retry_generation_replaced' },
      );
      run.status = 'queued';
      run.updatedAt = Date.now();
      run.child = null;
      run.processGroupId = null;
      run.protocolSession = null;
      run.exitCode = null;
      run.signal = null;
      run.error = null;
      run.errorCode = null;
      run.stdinOpen = false;
      // Any run-scoped state that a single attempt writes and that later feeds
      // terminal classification must be cleared before the next attempt spawns,
      // or the prior attempt's verdict leaks forward. turnCompletedCleanly is
      // set by a clean `turn_end` (applyClaudeStreamJsonRunBookkeeping); without
      // this reset, a clean-but-empty attempt 1 would vouch for a crashed
      // attempt 2, classifying the run 'succeeded' off a stale flag.
      run.turnCompletedCleanly = false;
      run.terminalTrigger = null;
      lifecycle.resetForAttempt(run.retryAttemptCount ?? 0);
      // Spread, not replace: `resetForAttempt` has just stamped this attempt's
      // `attemptStartedAt`/`attemptIndex`, and replacing the object wholesale
      // dropped them, so nothing downstream could tell which attempt a run
      // event belonged to. Only the `run.createdAt` fallback for the logical
      // run start is added on top.
      run.analyticsTelemetry = {
        ...run.analyticsTelemetry,
        startRequestedAt: run.analyticsTelemetry?.startRequestedAt ?? run.createdAt,
      };
      return termination;
    };
    const spawnRetryAttempt = (retryChatBody = chatBody) => {
      void startChatRun(retryChatBody, run).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        design.runs.emit(
          run,
          'error',
          createSseErrorPayload('AGENT_EXECUTION_FAILED', message),
        );
        // Route the retried-start failure through the same finalizer as child
        // close/error so it emits terminal retry telemetry (run_retry_finished
        // with retry_result: 'failed') and sets run.retryFinalResult, instead
        // of finishing directly and leaving run_finished to report the fallback
        // retry_final_result: 'not_attempted'. retryAttemptCount is already 1
        // here, so decideSafeRunRetry suppresses with attempt_limit_reached and
        // cannot trigger another restart loop.
        finishWithRetryDecision('failed', 1, null);
      });
    };
    // Tear the failed attempt down now (moving the run to `queued`), then wait
    // out the policy's backoff before re-spawning. Stays cancel-aware: a cancel
    // or shutdown during the backoff window clears the timer (runtimes/runs.ts)
    // and finalizes the queued run, and the callback re-checks cancel/terminal
    // state in case it fires first.
    const scheduleRetryRestart = (delayMs, retryChatBody = chatBody) => {
      const termination = tearDownAttemptForRetry();
      const wait = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
      const spawnWhenQuiescent = () => {
        void Promise.resolve(termination).then((result) => {
          if (run.cancelRequested || design.runs.isTerminal(run.status)) return;
          if (!result?.quiescent) {
            send('error', createSseErrorPayload(
              'AGENT_EXECUTION_FAILED',
              'The previous agent process tree could not be terminated; the retry was stopped before another model request was started.',
              { retryable: false },
            ));
            finishWithRetryDecision('failed', 1, null, { allowRetry: false });
            return;
          }
          spawnRetryAttempt(retryChatBody);
        });
      };
      if (wait <= 0) {
        spawnWhenQuiescent();
        return;
      }
      run.retryRestartTimer = setTimeout(() => {
        run.retryRestartTimer = null;
        if (run.cancelRequested || design.runs.isTerminal(run.status)) return;
        spawnWhenQuiescent();
      }, wait);
    };
    const finalizeRetryTelemetry = (status, decision, failure, errorCode) => {
      const attemptCount = run.retryAttemptCount ?? 0;
      const result = runResultFromStatus(status);
      if (attemptCount <= 0 && result !== 'failed') {
        run.retryFinalResult = 'not_attempted';
        run.retrySuppressedReason = undefined;
        return;
      }
      const retryResult =
        attemptCount > 0
          ? result === 'success'
            ? 'success'
            : result === 'failed'
              ? 'failed'
              : 'suppressed'
          : 'suppressed';
      const retrySuppressedReason =
        retryResult === 'suppressed'
          ? run.cancelRequested
            ? 'cancel_requested'
            : decision?.retrySuppressedReason
          : undefined;
      const eventDecision =
        attemptCount > 0
          ? {
              ...decision,
              retryAttemptIndex: attemptCount,
              retryMaxAttempts:
                run.retryMaxAttempts ?? decision.retryMaxAttempts,
              retryStrategy: run.retryStrategy ?? decision.retryStrategy,
            }
          : decision;
      // A successful retry has no current failure classification or error code.
      // Fall back to the failure that caused attempt 0 to be retried so success
      // recovery can still be attributed by root cause. Failed/suppressed retry
      // events retain their existing current-attempt semantics.
      const eventFailure = retryResult === 'success'
        ? run.retryOriginFailure ?? failure
        : failure;
      const eventErrorCode = retryResult === 'success'
        ? run.retryOriginErrorCode ?? errorCode
        : errorCode;
      run.retryFinalResult = retryResult;
      run.retrySuppressedReason = retrySuppressedReason;
      design.runs.emit(run, 'run_retry_finished', {
        ...retryAnalyticsBase(eventDecision, eventFailure, eventErrorCode),
        retry_result: retryResult,
        ...(retrySuppressedReason
          ? { retry_suppressed_reason: retrySuppressedReason }
          : {}),
      });
    };
    let pendingRpcCloseReason = null;
    const markRpcCloseReason = (reason) => {
      pendingRpcCloseReason = reason;
    };
    const deriveRpcCloseReason = (status, code, signal) => {
      if (pendingRpcCloseReason) return pendingRpcCloseReason;
      if (run.cancelRequested || status === 'canceled') return 'cancel_requested';
      if (signal) return 'signal';
      if (typeof code === 'number') return code === 0 ? 'exit_0' : 'exit_nonzero';
      return 'unknown';
    };
    const finishStrategyAwarePhysicalRun = (status, code = null, signal = null) => {
      const finished = finishRun(status, code, signal);
      return finished;
    };
    const finishWithRetryDecision = (
      status,
      code = null,
      signal = null,
      { allowRetry = true } = {},
    ) => {
      lifecycle.mark('finalize_start');
      // The Run records how the process ended; the strategy task records its
      // own verdict. A task blocked at any stage keeps a cleanly exited Run
      // succeeded: the task projection on the terminal event carries the
      // blocked outcome and its reason codes, and the client decides from
      // those and the deliverable on disk what this turn produced.
      flushRunMessageEvents(run);
      // Persist the transport-level close mechanism before classifying this
      // attempt. Runtime fatal/stream signals are only known in the close
      // handler, and the retry classifier reads this diagnostic to distinguish
      // them from a generic process exit. Clear the pending value immediately
      // so a scheduled retry cannot inherit the previous attempt's reason.
      const rpcCloseReason = deriveRpcCloseReason(status, code, signal);
      design.runs.emit(run, 'diagnostic', {
        type: 'runtime_close',
        rpc_close_reason: rpcCloseReason,
        status,
        ...(typeof code === 'number' ? { exit_code: code } : {}),
        ...(signal ? { signal } : {}),
      });
      pendingRpcCloseReason = null;
      const result = runResultFromStatus(status);
      const errorCode = deriveRunErrorCode({
        status,
        error: run.error,
        errorCode: run.errorCode,
        exitCode: code,
        signal,
      });
      const failure = classifyRunFailure({
        result,
        status: {
          status,
          error: run.error,
          errorCode: run.errorCode,
          exitCode: code,
          signal,
        },
        ...(errorCode ? { errorCode } : {}),
        agentId: run.agentId,
        cancelOrigin: run.cancelOrigin ?? null,
        terminalTrigger: run.terminalTrigger ?? null,
        events: run.events,
        admissionEvidence: runAdmissionEvidenceForRun(run),
      });
      const sideEffects = {
        ...runSideEffectsForRun(run),
        cancelRequested: !!run.cancelRequested,
      };
            const liveSessionId = agentResumeCtx.isResuming
        ? agentResumeCtx.resumeSessionId
        : agentCapturesSessionId
          ? capturedSessionId
          : agentResumeCtx.newSessionId;
      const postToolResumeDecision = decidePostToolResumeRecovery({
        result,
        failure,
        continuationAttemptCount:
          run.nativeSessionContinueAttemptCount ?? 0,
        totalRetryAttemptCount: run.retryAttemptCount ?? 0,
        sideEffects,
        supportsNativeSessionContinue: runtimeResumesSessionById(def),

        hasNativeSession: !!run.conversationId && !!liveSessionId,
      });
      if (
        allowRetry && postToolResumeDecision?.shouldRetry &&
        !design.runs.isTerminal(run.status) &&
        run.conversationId &&
        liveSessionId
      ) {
        run.retryOriginalFailure ??= failure ?? undefined;
        run.retryOriginFailure = failure ? { ...failure } : null;
        run.retryOriginErrorCode = errorCode ?? null;
        run.retryAttemptCount = postToolResumeDecision.retryAttemptIndex;
        run.nativeSessionContinueAttemptCount =
          (run.nativeSessionContinueAttemptCount ?? 0) + 1;
        run.retryMaxAttempts = postToolResumeDecision.retryMaxAttempts;
        run.retryStrategy = postToolResumeDecision.retryStrategy;
        run.retryFinalResult = undefined;
        run.retrySuppressedReason = undefined;
        upsertAgentSession(db, {
          conversationId: run.conversationId,
          agentId: def.id,
          sessionId: liveSessionId,
          stablePromptHash: currentStableHash,
          stablePromptSections: currentStableSectionsJson,
          model: nativeCodexProvider?.sessionIdentity ?? safeModel ?? null,
          cwd: effectiveCwd,
          lastMessageId: run.assistantMessageId ?? null,
          lastInputTokens: observedInputTokensForSession(),
        });
        run.nativeSessionRecovery = markNativeSessionCaptured({
          previous: run.nativeSessionRecovery,
          agentId: def.id,
          sessionId: liveSessionId,
          resumed: agentResumeCtx.isResuming,
        });
        publishNativeSessionRecoveryMetadata();
        design.runs.emit(run, 'run_retry_attempted', {
          ...retryAnalyticsBase(postToolResumeDecision, failure, errorCode),
          retry_reason: postToolResumeDecision.retryReason,
          retry_delay_ms: postToolResumeDecision.retryDelayMs,
        });
        run.nativeSessionContinuePending = {

          sessionId: liveSessionId,
          stablePromptHash: currentStableHash,
          stablePromptSections: currentStableSections,
          lastInputTokens: observedInputTokensForSession(),
        };
        scheduleRetryRestart(postToolResumeDecision.retryDelayMs, {
          ...chatBody,
          message: POST_TOOL_RESUME_CONTINUATION_PROMPT,
          currentPrompt: POST_TOOL_RESUME_CONTINUATION_PROMPT,
          titleGeneration: undefined,
        });
        return true;
      }
      const decision = decideSafeRunRetry({
        result,
        failure,
        attemptCount: run.retryAttemptCount ?? 0,
        sideEffects,
      });
      if (allowRetry && decision.shouldRetry && !design.runs.isTerminal(run.status)) {
        run.retryOriginalFailure ??= failure ?? undefined;
        if ((run.retryAttemptCount ?? 0) === 0) {
          run.retryOriginFailure = failure ? { ...failure } : null;
          run.retryOriginErrorCode = errorCode ?? null;
        }
        run.retryAttemptCount = decision.retryAttemptIndex;
        run.retryMaxAttempts = decision.retryMaxAttempts;
        run.retryStrategy = decision.retryStrategy;
        run.retryFinalResult = undefined;
        run.retrySuppressedReason = undefined;
        design.runs.emit(run, 'run_retry_attempted', {
          ...retryAnalyticsBase(decision, failure, errorCode),
          retry_reason: decision.retryReason,
          retry_delay_ms: decision.retryDelayMs,
        });
        scheduleRetryRestart(decision.retryDelayMs);
        return true;
      }
      // Resume-on-failure: a terminal *resumable* failure (transient mid-stream
      // drop / inactivity) on a session-resuming runtime is not a dead end.
      // Persist the live CLI session so the next turn in this conversation
      // continues it (`--resume <id>`) instead of opening a fresh session, and
      // flag the run so the chat can surface a Continue affordance. The session
      // id is the one we actually drove this attempt with: the resumed id when
      // continuing, otherwise the freshly minted id we passed via --session-id.
      //
      // Gate on a real *committed* boundary this attempt, not merely on bytes
      // having reached the UI. A completed tool_use / artifact / live-artifact
      // corresponds to a block the agent has committed to its session (Claude
      // commits a tool_use block before running the tool), so `--resume` has
      // something concrete to pick up. We deliberately EXCLUDE
      // `userVisibleOutputSeen`: it flips true on the first streamed text
      // delta, but a single-turn drop can stream a few tokens with
      // `output_tokens == 0` and never commit a text block — resuming that
      // continues from the prior user turn (nothing to pick up), which is
      // exactly the "resume something with nothing to continue" case this
      // feature is meant to avoid. A text-only turn that is cut therefore stays
      // a from-scratch restart (auto-retry above or a manual Retry).
      // NOTE: `userVisibleOutputSeen` cannot by itself distinguish "half a text
      // block, zero commit" from "a committed text block then more streaming";
      // until the stream exposes a committed-text signal, tool/artifact blocks
      // are the only reliable resume boundary.
      const committedWorkSeen = !!(
        sideEffects.toolCallSeen ||
        sideEffects.artifactWriteSeen
      );
      const resumableFailure =
        result === 'failed' &&
        runtimeResumesSessionById(def) &&
        !!run.conversationId &&
        !!liveSessionId &&
        committedWorkSeen &&
        isResumableFailure(failure);
      run.resumable = resumableFailure;
      // Surface the daemon's failure classification (already computed for
      // retry-policy + telemetry) on the run so statusBody / the SSE `end` frame
      // carry it to the chat, which maps failureDetail -> a specific named
      // failure type + fix. Only meaningful on a failed result.
      run.failureCategory = result === 'failed' ? failure?.failure_category ?? null : null;
      run.failureDetail = result === 'failed' ? failure?.failure_detail ?? null : null;
      run.failureAction = result === 'failed' ? failure?.user_action ?? null : null;
      // The classifier's own retryability verdict. Kept alongside `user_action`
      // rather than derived from it: the two are written independently, so a
      // failure can be non-retryable while still carrying an action other than
      // `'none'` (install the CLI, switch model, recharge). Without this the
      // chat can only re-derive retryability from the detail NAME, which is the
      // drift the classification fields exist to end.
      run.retryable =
        result === 'failed' && typeof failure?.retryable === 'boolean'
          ? failure.retryable
          : null;
      // Stamp the classification onto the persisted assistant message too, so a
      // reload (or any daemon-side persistence without the live web error
      // handler) keeps the specific failure guidance instead of the coarse
      // errorCode UI. Mirrors what statusBody / the SSE `end` frame carry live.
      if (result === 'failed') persistRunFailureClassification(db, run);
      if (resumableFailure) {
        upsertAgentSession(db, {
          conversationId: run.conversationId,
          agentId: def.id,
          sessionId: liveSessionId,
          stablePromptHash: currentStableHash,
          stablePromptSections: currentStableSectionsJson,
          model: nativeCodexProvider?.sessionIdentity ?? safeModel ?? null,
          cwd: effectiveCwd,
          lastMessageId: run.assistantMessageId ?? null,
          lastInputTokens: observedInputTokensForSession(),
        });
        run.nativeSessionRecovery = markNativeSessionCaptured({
          previous: run.nativeSessionRecovery,
          agentId: def.id,
          sessionId: liveSessionId,
          resumed: agentResumeCtx.isResuming,
        });
        publishNativeSessionRecoveryMetadata();
      }
      finalizeRetryTelemetry(status, decision, failure, errorCode);
      if (executionProfile === 'filesystem' && result === 'success' && visibleAssistantText.trim().length === 0) {
        const fileNames = filesystemWriteFileNamesFromRunEvents(run.events);
        if (fileNames.length > 0) {
          send('agent', {
            type: 'diagnostic',
            name: 'filesystem_empty_answer_autofilled',
            source: 'daemon-run-finalize',
            fileCount: fileNames.length,
            files: fileNames.slice(0, 8),
          });
          send('agent', {
            type: 'text_delta',
            delta: filesystemEmptyAnswerFallbackText(fileNames),
          });
        }
      }
      finishStrategyAwarePhysicalRun(status, code, signal);
      return false;
    };

    // Legacy delivery stays available to runtimes without an extension
    // injector. Productized runtimes plan their per-run injection after the
    // capability probe below, without writing config into the project cwd.
    if (
      !def.extensionInjector &&
      def.externalMcpInjection === 'claude-mcp-json' &&
      isManagedProjectCwd(cwd, PROJECTS_DIR)
    ) {
      {
        const target = path.join(cwd, '.mcp.json');
        if (enabledExternalMcp.length > 0) {
          try {
            const claudeMcp = buildClaudeMcpJson(
              enabledExternalMcp,
              oauthTokensForSpawn,
            );
            if (claudeMcp) {
              await fs.promises.mkdir(path.dirname(target), { recursive: true });
              await fs.promises.writeFile(
                target,
                JSON.stringify(claudeMcp, null, 2),
                'utf8',
              );
            }
          } catch (err) {
            console.warn(
              '[mcp-config] failed to write project .mcp.json:',
              err && err.message ? err.message : err,
            );
          }
        } else {
          try {
            await fs.promises.unlink(target);
          } catch (err) {
            if ((err && err.code) !== 'ENOENT') {
              console.warn(
                '[mcp-config] failed to remove stale .mcp.json:',
                err && err.message ? err.message : err,
              );
            }
          }
        }
      }
    }
    // OpenCode: serialise enabled MCP servers into its `mcp` config schema
    // and hand the JSON to the child via `OPENCODE_CONFIG_CONTENT`. The env
    // var is *merged* with the user's saved `~/.config/opencode/opencode
    // .json` (per OpenCode's documented config layering), so adding a
    // server here does not erase whatever the user already has in their
    // global config. We deliberately leave the env unset when no servers
    // are enabled — overwriting with `{}` would wipe the user's saved
    // mcp section for this single invocation, which is exactly the kind
    // of surprise the previous silent-failure UX taught us to avoid.
    let opencodeConfigContent: string | null = null;
    const isOpenCodeContent = def.externalMcpInjection === 'opencode-env-content';
    if (!def.extensionInjector && isOpenCodeContent) {
      try {
        opencodeConfigContent = buildOpenCodeMcpConfigContent(
          enabledExternalMcp,
          oauthTokensForSpawn,
          {
            allowedDirectories: [effectiveCwd, ...extraAllowedDirs],
            ...(bundledOpenCodeExtraConfig
              ? { extraConfig: bundledOpenCodeExtraConfig }
              : {}),
          },
        );
      } catch (err) {
        console.warn(
          '[mcp-config] failed to build OPENCODE_CONFIG_CONTENT:',
          err && err.message ? err.message : err,
        );
      }
    }

    let mmdRouteLaunchEnv = null;
    if (def.id === 'claude' && safeModel) {
      mmdRouteLaunchEnv = await loadMmdRouteLaunchEnv(
        {
          ...process.env,
          ...(def.env || {}),
          ...configuredAgentEnv,
        },
        safeModel,
      ).catch(() => null);
    }

    // agentLaunch / resolvedBin are resolved above the resume guard (hoisted).

    const cleanupExtensionPlan = () => {
      cleanupExtensionFiles();
    };

    // Codex CLI parses config.toml before processing any -c overrides. An
    // invalid `service_tier` value (the Codex app has written "priority",
    // "default", and other values the CLI rejects) causes an immediate parse
    // error and exit-1 before any work starts. Normalize it in-place — any
    // value outside {fast,flex} has its line removed so the CLI uses its
    // built-in default — so the launch succeeds. Errors are silently swallowed
    // — a missing or read-only config.toml is fine, and the Codex CLI still
    // surfaces the original error if the write fails. See issue #4276 / #3408.
    if (def.id === 'codex' && !nativeCodexProvider) {
      const { normalizeCodexConfigFile } = await import('./codex-config-normalize.js');
      // Route through spawnEnvForAgent so resolveCodexConfigPath sees the same
      // fully-expanded CODEX_HOME the Codex child process will see. In
      // particular, spawnEnvForAgent calls expandConfiguredEnv which expands
      // `~/` / `~\` prefixes — a user-configured CODEX_HOME="~/.codex-alt"
      // would otherwise resolve to the literal path "~/.codex-alt/config.toml"
      // in the normalizer while the child resolves it to the absolute path,
      // leaving the real config untouched. Mirrors the diagnostics-export.ts
      // `envFor('codex')` pattern. See issue #4276.
      const codexConfigEnv = await spawnEnvForAgentAsync(
        'codex',
        process.env,
        configuredAgentEnv,
        undefined,
        { resolvedBin: agentLaunch.selectedPath },
      );
      await normalizeCodexConfigFile(codexConfigEnv);

      // When OpenPixo leaves model selection at `default`, Codex resolves
      // the concrete model from config.toml. A known-old CLI can accept the
      // config, start `exec`, and only then reject a newer configured model.
      // Gate only evidence-backed stable-version/model combinations before
      // buildArgs/spawn. Every uncertain boundary (custom provider, API-key
      // auth, config overlays, project config, unknown/prerelease version)
      // fails open so Codex keeps its existing forward compatibility.
      if (agentLaunch.launchPath) {
        if (run.cancelRequested || design.runs.isTerminal(run.status)) {
          lifecycle.mark('launch_preflight_end');
          cleanupExtensionPlan();
              return;
        }
        const preflight = await preflightCodexDefaultModel({
          launchPath: agentLaunch.launchPath,
          env: await applyAgentLaunchEnvAsync(codexConfigEnv, agentLaunch),
          requestedModel: safeModel,
          projectRoot: effectiveCwd,
        });
        if (run.cancelRequested || design.runs.isTerminal(run.status)) {
          lifecycle.mark('launch_preflight_end');
          cleanupExtensionPlan();
              return;
        }
        if (preflight.status === 'compatible' || preflight.status === 'incompatible') {
          run.resolvedModelId = preflight.model;
          run.preflightAgentCliVersion = preflight.cliVersion;
        }
        if (preflight.status === 'incompatible') {
          lifecycle.mark('launch_preflight_end');
          const message =
            `The '${preflight.model}' model requires a newer version of Codex. ` +
            `The installed Codex CLI (${preflight.cliVersion}) is older than the known-compatible ` +
            `minimum (${preflight.requiredCliVersion}). ` +
            'Upgrade the Codex CLI or choose a model supported by this installation, then retry.';
          design.runs.emit(run, 'diagnostic', {
            type: 'model_capability_preflight',
            status: 'incompatible',
            model: preflight.model,
            cli_version: preflight.cliVersion,
            required_cli_version: preflight.requiredCliVersion,
          });
          send('error', createSseErrorPayload(
            'AGENT_EXECUTION_FAILED',
            message,
            {
              retryable: false,
              details: {
                failureCategory: 'model_unavailable',
                failureDetail: 'cli_version_incompatible',
                model: preflight.model,
                requiredCliVersion: preflight.requiredCliVersion,
              },
            },
          ));
          cleanupExtensionPlan();
          // No child was spawned, so there is no process exit code to report.
          // Passing null preserves the preflight attribution instead of
          // polluting exit_nonzero transport metrics with a synthetic exit 1.
          finishWithRetryDecision('failed', null, null);
          return;
        }
      }
    }

    let args;
    const projectMcpServers = projectExtensions.mcpServers.map((server) => {
      const saved = externalMcpConfig.servers.find((entry) => entry.id === server.id);
      const token = saved?.url === server.url && saved?.authMode === 'oauth' && server.authMode === 'oauth'
        ? oauthTokensForSpawn[server.id] : null;
      return token && !Object.keys(server.headers ?? {}).some((key) => key.toLowerCase() === 'authorization')
        ? { ...server, headers: { ...server.headers, Authorization: `Bearer ${token}` } } : server;
    });
    let extensionPlan: RuntimeExtensionPlan | null = null;
    let runScratchDir: string | null = null;
    const runSecrets = def.extensionInjector ? []
      : codexOutputSecrets(projectMcpServers, nativeCodexProvider?.env.OPENPIXO_CODEX_PROVIDER_KEY);
    const redactRunOutput = (value) => redactCodexOutput(value, runSecrets);
    const requestedApprovalMode = appConfigForRun?.agentApprovalModes?.[def.id] ?? 'in-app';
    // A read-only turn asks the user nothing: Codex stays inside its read-only
    // sandbox, and the host answers Claude's permission requests itself.
    const approvalMode = readOnlyTurn
      ? (def.id === 'claude' && toolTokenGrant ? 'in-app' : 'skip')
      : def.id === 'codex' || (def.id === 'claude' && toolTokenGrant)
        ? requestedApprovalMode : 'skip';
    let claudeInAppApprovals = false;
    try {
      // Optional argv flags are gated on the `--help` capability map, which used
      // to be filled only by `GET /api/agents`. Probe it here so a daemon that
      // has never served that route still builds the same argv as one that has.
      await ensureDetectedRuntimeCapabilities(def.id, configuredAgentEnv);
      const claudeCaps = agentCapabilities.get('claude') ?? {};
      claudeInAppApprovals = def.id === 'claude' && approvalMode === 'in-app'
        && claudeCaps.permissionPromptTool === true && claudeCaps.mcpConfig === true;
      if (def.id === 'claude' && requestedApprovalMode === 'in-app' && !claudeInAppApprovals && !readOnlyTurn) {
        send('agent', { type: 'status', label: 'warning', detail: 'Claude Code cannot use in-app approval for this run; running with bypassPermissions. Update Claude Code to support --permission-prompt-tool and --mcp-config.' });
      }
      if (def.extensionInjector) {
        runScratchDir = path.join(RUNTIME_DATA_DIR, 'runs', run.id, 'extensions', randomUUID());
        extensionPlan = runtimeExtensionInjectors[def.extensionInjector].plan({
          runId: run.id,
          runScratchDir,
          projectMcpServers,
          globalMcpServers: enabledExternalMcp,
          globalMcpTokens: oauthTokensForSpawn,
          projectSkills: projectExtensions.skills,
          codexProviderKey: nativeCodexProvider?.env.OPENPIXO_CODEX_PROVIDER_KEY,
          ...(claudeInAppApprovals ? { claudeApprovalServer: {
            command: process.execPath,
            args: [PIXO_BIN, 'mcp', 'approvals'],
            env: {
              PIXO_DAEMON_URL: daemonUrl,
              PIXO_TOOL_TOKEN: toolTokenGrant.token,
              PIXO_NODE_BIN: PIXO_NODE_BIN,
              PIXO_DATA_DIR: RUNTIME_DATA_DIR,
              ELECTRON_RUN_AS_NODE: '1',
            },
          } } : {}),
          openCodeConfig: {
            allowedDirectories: [effectiveCwd, ...extraAllowedDirs],
            ...(bundledOpenCodeExtraConfig ? { extraConfig: bundledOpenCodeExtraConfig } : {}),
          },
        });
        const scratchDir = runScratchDir;
        cleanupExtensionFiles = () => cleanupRuntimeExtensionFiles(scratchDir);
        const previousExtensionFinalize = run.onFinalize;
        run.onFinalize = () => {
          try { previousExtensionFinalize?.(); }
          finally { cleanupExtensionFiles(); }
        };
        runSecrets.push(...extensionPlan.secrets);
        if (extensionPlan.unsupported.length > 0) {
          send('agent', {
            type: 'status',
            label: 'warning',
            detail: `${def.name} cannot inject: ${extensionPlan.unsupported.join(', ')}.`,
          });
        }
      }
      args = def.buildArgs(
        composed,
        promptImagePaths,
        extraAllowedDirs,
        agentOptions,
        {
          cwd: effectiveCwd,
          approvalMode,
          readOnlyTurn,
          resumeSessionId: agentResumePromptPolicy.resumeSessionId,
          newSessionId: agentResumeCtx.newSessionId,
          codexProviderArgs: nativeCodexProvider?.configArgs,
          codexSuppressReasoningSummary: nativeCodexProvider?.suppressReasoningSummary,
          codexMcpServers: projectMcpServers,
          disablePlugins:
            def.id === 'codex'
            && run.externalPluginAnalytics?.externalPluginId
              === OPENPIXO_PLUGIN_ID,
        },
      );
      args.push(...(extensionPlan?.args ?? []));
    } catch (err) {
      cleanupExtensionPlan();
      throw err;
    }

    let persistDeliveredAgentSessionState = () => {};
    if (runtimeResumesSessionById(def) && run.conversationId) {
      let persisted = false;
      persistDeliveredAgentSessionState = () => {
        if (persisted) return;
        persisted = true;
        if (!getConversation(db, run.conversationId)) {
          console.warn(
            '[sessions] skipped delivered session persistence because the conversation is not persisted',
          );
          return;
        }
        // The id to persist for a create turn: capture-style adapters store the
        // session id the CLI minted and reported on the stream; specify-style
        // adapters store the daemon-minted id they passed to the CLI. A
        // capture-style run that never reported an id (CLI died before
        // `thread.started`) leaves nothing to resume — correct, the next turn
        // starts fresh and re-seeds the transcript.
        const createTurnSessionId = agentCapturesSessionId
          ? capturedSessionId
          : agentResumeCtx.newSessionId;
        if (!agentResumeCtx.isResuming && createTurnSessionId) {
          upsertAgentSession(db, {
            conversationId: run.conversationId,
            agentId: def.id,
            sessionId: createTurnSessionId,
            stablePromptHash: currentStableHash,
            stablePromptSections: currentStableSectionsJson,
            model: nativeCodexProvider?.sessionIdentity ?? safeModel ?? null,
            cwd: effectiveCwd,
            lastMessageId: run.assistantMessageId ?? null,
            lastInputTokens: observedInputTokensForSession(),
          });
          if (!agentCapturesSessionId) {
            run.nativeSessionRecovery = markNativeSessionCaptured({
              previous: run.nativeSessionRecovery,
              agentId: def.id,
              sessionId: createTurnSessionId,
              resumed: false,
            });
            publishNativeSessionRecoveryMetadata();
          }
          return;
        }
        if (agentResumeCtx.isResuming && agentResumeCtx.resumeSessionId) {
          // Advance the resume identity guard after a successful resume turn:
          // the conversation grew by this turn, so the cursor must move to the
          // new max position (otherwise the next turn sees `cursor + 4` and
          // falsely reseeds). model/cwd are unchanged (they matched on resume);
          // refresh the stable hash to what the session now holds.
          upsertAgentSession(db, {
            conversationId: run.conversationId,
            agentId: def.id,
            sessionId: agentResumeCtx.resumeSessionId,
            stablePromptHash: currentStableHash,
            stablePromptSections: currentStableSectionsJson,
            model: nativeCodexProvider?.sessionIdentity ?? safeModel ?? null,
            cwd: effectiveCwd,
            lastMessageId: run.assistantMessageId ?? null,
            lastInputTokens: observedInputTokensForSession(),
          });
          if (!agentCapturesSessionId) {
            run.nativeSessionRecovery = markNativeSessionCaptured({
              previous: run.nativeSessionRecovery,
              agentId: def.id,
              sessionId: agentResumeCtx.resumeSessionId,
              resumed: true,
            });
            publishNativeSessionRecoveryMetadata();
          }
        }
      };
    }

    // `runStartTimeMs` is consumed by the run-end artifact-manifest
    // reconciler (#2893 / #3110) to skip artifacts whose mtime predates
    // this run. The original main-side hunk also re-declared `const send`

    // earlier, so we keep only the new `runStartTimeMs` declaration.
    const runStartTimeMs = Date.now();
    const firstOutputTimeoutMs =
      resolveChatRunFirstOutputTimeoutMs();
    const artifactQuietPeriodMs = resolveChatRunArtifactQuietPeriodMs();
    // Grace before the inactivity watchdog escalates a stalled child from
    // SIGTERM to SIGKILL. Env-tunable like its PIXO_CHAT_RUN_* cancel-grace
    // siblings so the escalation path can be exercised deterministically.
    const inactivityKillGraceMs = (() => {
      const raw = Number(process.env.PIXO_CHAT_RUN_INACTIVITY_KILL_GRACE_MS);
      return Number.isFinite(raw) && raw > 0 ? raw : 3_000;
    })();
    let inactivityTimer = null;
    const pendingApprovals = new Set<string>();
    let firstOutputTimer = null;
    let firstOutputSeen = false;
    let childStdoutSeen = false;
    let lastAgentEventPhase = 'spawn pending';
    let lastToolResultChars = 0;
    // Becomes true once any live-artifact create has been registered for
    // this run. Subsequent watchdog scheduling uses the shorter quiet
    // period, and a watchdog trip after this point is treated as
    // "agent finished the deliverable and went idle" rather than
    // "agent stalled with nothing to show" (issue #1451).
    let artifactRegistered = false;
    // Only daemon-initiated quiet-period termination should be treated
    // as `succeeded` in the close handler. A later unrelated SIGTERM /
    // SIGKILL (external `kill`, OOM, container shutdown) must keep its
    // existing `failed` classification even when `artifactRegistered`
    // is true — those signals don't mean the agent finished cleanly,
    // they just terminated the process. Set strictly inside
    // `failForInactivity`'s quiet-period branch.
    let artifactQuietShutdownRequested = false;
    // Set when the no-output inactivity watchdog routed this attempt through
    // the same-run retry finalizer AND that finalizer restarted the run on a
    // fresh child. The stalled child is then SIGTERM'd, so its later `close`
    // must NOT finalize the run a second time or unregister the new attempt's
    // event sink / run handle (both keyed by the shared runId). The close
    // handler bails early when this is true, revoking only this attempt's own
    // tool token.
    let watchdogRetryRestarted = false;
    const summarizeAgentEventForInactivity = (payload) => {
      const type = payload?.type ? String(payload.type) : 'unknown';
      if (type === 'tool_result') {
        const content = typeof payload.content === 'string' ? payload.content : '';
        lastToolResultChars = Math.max(lastToolResultChars, content.length);
        return `tool_result:${content.length} chars`;
      }
      if (type === 'tool_use') {
        const name = payload?.name ? String(payload.name) : 'unknown';
        return `tool_use:${name}`;
      }
      if (type === 'text_delta' || type === 'thinking_delta') {
        const text = typeof payload.delta === 'string'
          ? payload.delta
          : typeof payload.text === 'string'
            ? payload.text
            : '';
        return `${type}:${text.length} chars`;
      }
      if (type === 'status') {
        const label = payload?.label ? String(payload.label) : 'unknown';
        return `status:${label}`;
      }
      return type;
    };
    const clearInactivityWatchdog = () => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
    };
    const clearFirstOutputWatchdog = () => {
      if (firstOutputTimer) {
        clearTimeout(firstOutputTimer);
        firstOutputTimer = null;
      }
    };
    let forcedChildShutdownTimers = [];
    let protocolAttemptTermination = null;
    const beginProtocolAttemptTermination = (
      reason = 'protocol_terminal',
      { gracefulWaitMs = 0, onChildSignal = undefined as (() => void) | undefined } = {},
    ) => {
      if (protocolAttemptTermination) return protocolAttemptTermination;
      protocolAttemptTermination = design.runs.terminateProcessTree(
        run,
        child,
        run.processGroupId,
        {
          gracefulWaitMs,
          termGraceMs: inactivityKillGraceMs,
          killGraceMs: inactivityKillGraceMs,
          reason,
          onChildSignal,
        },
      );
      return protocolAttemptTermination;
    };
    const clearForcedChildShutdown = () => {
      for (const timer of forcedChildShutdownTimers) clearTimeout(timer);
      forcedChildShutdownTimers = [];
    };
    const scheduleForcedChildShutdown = () => {
      if (!child) return;
      clearForcedChildShutdown();
      // Capture THIS attempt's child and its process group. A same-run retry
      // can swap `run.child` to a fresh child within the grace window; these
      // timers must escalate the stalled child they were scheduled for, never
      // whatever now occupies `run.child` — otherwise the healthy retry gets
      // killed and this stalled child is left unreaped. See runs.ts
      // `signalChildProcess`.
      const targetChild = child;
      const targetProcessGroupId = run.processGroupId;
      forcedChildShutdownTimers = [
        setTimeout(() => {
          design.runs.signalChildProcess(targetChild, targetProcessGroupId, 'SIGTERM');
        }, inactivityKillGraceMs),
        setTimeout(() => {
          design.runs.signalChildProcess(targetChild, targetProcessGroupId, 'SIGKILL');
        }, inactivityKillGraceMs * 2),
      ];
    };
    const failForInactivity = (reason: 'inactivity' | 'first_output' = 'inactivity') => {
      if (pendingApprovals.size > 0) return;
      if (run.cancelRequested || design.runs.isTerminal(run.status)) return;
      clearInactivityWatchdog();
      clearFirstOutputWatchdog();
      if (artifactRegistered) {
        // The deliverable already exists. The agent process is either
        // genuinely idle (claude-code's stream-json child sitting on an
        // open stdin) or wedged in post-write reasoning that never
        // emits stdout. Either way, finishing the run via the normal
        // child-exit path (status decision in child.on('close') below)
        // is safer than tearing it down with a failure banner — the
        // tool token, cancel state, and exit-code classification stay
        // owned by the existing lifecycle. SIGTERM the child and let
        // the close handler classify the run as succeeded (via the
        // artifactQuietShutdown branch). Mark this termination as
        // daemon-initiated so an unrelated later signal (external
        // kill, OOM) is NOT silently reclassified to `succeeded` —
        // only signals from this watchdog branch should be.
        artifactQuietShutdownRequested = true;
        if (protocolSession?.abort) {
          beginProtocolAttemptTermination(
            'protocol_artifact_quiet_timeout',
            { gracefulWaitMs: 100 },
          );
          protocolSession.abort();
        } else {
          if (child && !child.killed) design.runs.signalChild(run, 'SIGTERM');
          scheduleForcedChildShutdown();
        }
        return;
      }
      // OpenCode retries a 429 usage-limit silently and emits nothing on
      // stdout/stderr, so the watchdog is the first signal we get. The real
      // reason is recorded only in OpenCode's own session log — recover it
      // and surface it HERE, before finish() tears down the live SSE
      // clients, so a viewer sees "usage limit reached" instead of the
      // generic stall message. Bound to this run via `since` so a stale or
      // concurrent session's error can't be misattributed. See issue #982.
      let stallPayload = null;
      if (agentId === 'opencode') {
        const logFailure = readOpenCodeServiceFailure(spawnedAgentEnv, {
          since: run.createdAt,
        });
        if (logFailure) {
          stallPayload = createSseErrorPayload(
            logFailure.code,
            logFailure.message,
            { retryable: logFailure.retryable },
          );
        }
      }
      if (!stallPayload) {
        const timeoutMs =
          reason === 'first_output' ? firstOutputTimeoutMs : inactivityTimeoutMs;
        const timeoutDescription =
          reason === 'first_output'
            ? 'without emitting a first output'
            : 'without emitting any new output';
        const message =
          `Agent stalled ${timeoutDescription} for ${Math.round(timeoutMs / 1000)}s. ` +
          'The model or CLI likely hung while generating. ' +
          `Phase details: spawned agent ${userFacingAgentLabel(agentId, resolvedBin)}; stdout arrived: ${childStdoutSeen ? 'yes' : 'no'}; ` +
          `last agent event: ${lastAgentEventPhase}; largest tool result observed: ${lastToolResultChars} chars. ` +
          'Retry the turn, pick a different model, or start a new conversation if the prior context is very large.';
        stallPayload = createSseErrorPayload('AGENT_EXECUTION_FAILED', message, { retryable: true });
      }
      run.terminalTrigger = reason === 'first_output'
        ? 'first_output_deadline'
        : 'inactivity_watchdog';
      send('error', stallPayload);
      if (protocolSession?.abort) {
        beginProtocolAttemptTermination(
          `protocol_${reason}_timeout`,
          { gracefulWaitMs: 100 },
        );
        protocolSession.abort();
      }
      // A silent first-token hang is one of the safe transient failure shapes
      // this run is allowed to recover: classifyRunFailure maps the stall text
      // to a retryable `timeout` at `first_token_wait`, and decideSafeRunRetry
      // permits the same-run retry when no output/tools/artifacts were seen.
      // Route through the shared finalizer (after surfacing stallPayload) so
      // the watchdog path gets the same run_retry_attempted/run_retry_finished
      // telemetry as child close/error — not a bare terminal failure.
      const retried = finishWithRetryDecision('failed', 1, null);
      if (retried) {
        watchdogRetryRestarted = true;
      }
      if (!protocolSession?.abort) {
        if (child && !child.killed) design.runs.signalChild(run, 'SIGTERM');
        scheduleForcedChildShutdown();
      }
    };
    const armFirstOutputWatchdog = () => {
      if (firstOutputSeen || firstOutputTimer || firstOutputTimeoutMs <= 0) return;
      firstOutputTimer = setTimeout(
        () => failForInactivity('first_output'),
        firstOutputTimeoutMs,
      );
      firstOutputTimer.unref?.();
    };
    const noteFirstOutputEvent = (payload) => {
      const type = payload?.type ? String(payload.type) : '';
      if (
        type !== 'text_delta' &&
        type !== 'thinking_delta' &&
        type !== 'tool_use' &&
        type !== 'tool_result' &&
        type !== 'artifact'
      ) {
        return;
      }
      firstOutputSeen = true;
      clearFirstOutputWatchdog();
    };
    const activeInactivityTimeoutMs = () =>
      resolveActiveInactivityTimeoutMs({
        inactivityTimeoutMs,
        artifactQuietPeriodMs,
        artifactRegistered,
      });

    const noteAgentActivity = () => {
      // E-lite: stamp the last-activity clock BEFORE the disabled-watchdog bail
      // so `last_progress_age_ms` is recorded even when the watchdog is off.
      run.lastAgentActivityAt = Date.now();
      if (toolTokenGrant) {
        toolTokenRegistry.refreshToken(toolTokenGrant.token, { ttlMs: toolTokenTtlMs });
      }
      const delay = activeInactivityTimeoutMs();
      if (delay <= 0) return;
      clearInactivityWatchdog();
      inactivityTimer = setTimeout(failForInactivity, delay);
      inactivityTimer.unref?.();
    };
    const noteArtifactRegistered = () => {
      if (artifactRegistered) return;
      artifactRegistered = true;
      firstOutputSeen = true;
      clearFirstOutputWatchdog();
      // Switch the watchdog to the shorter quiet-period window
      // immediately so we don't have to wait for the next agent event
      // before the new ceiling takes effect. Call unconditionally:
      // an earlier `if (inactivityTimer)` gate left the run in limbo
      // when `PIXO_CHAT_RUN_INACTIVITY_TIMEOUT_MS=0` but
      // `PIXO_CHAT_RUN_ARTIFACT_QUIET_PERIOD_MS>0` — noteAgentActivity()
      // had returned early at run start (pre-artifact delay = 0,
      // no timer set), so the guard then skipped the re-arm and the
      // newly-positive quiet-period delay never armed a timer at all.
      // `noteAgentActivity` itself is the one that decides whether to
      // schedule (it bails when the active delay is 0), so leaving the
      // decision there keeps the behavior coherent across all four
      // combinations of pre / quiet timeouts.
      noteAgentActivity();
    };
    const unregisterChatAgentEventSink = () => {
      const sinkRunId = toolTokenGrant?.runId ?? runId;
      activeChatAgentEventSinks.delete(sinkRunId);
      activeChatRunHandles.delete(sinkRunId);
    };
    const observeApprovalEvent = (event) => {
      if (event.type === 'approval_request' && typeof event.requestId === 'string') {
        pendingApprovals.add(event.requestId);
        firstOutputSeen = true;
        clearFirstOutputWatchdog();
        clearInactivityWatchdog();
      } else if (event.type === 'approval_resolved' && typeof event.requestId === 'string') {
        pendingApprovals.delete(event.requestId);
        if (pendingApprovals.size === 0) noteAgentActivity();
      }
    };
    if (claudeInAppApprovals) {
      run.approvalSession = new ClaudeApprovalSession((event) => {
        observeApprovalEvent(event);
        send('agent', redactRunOutput(event));
      });
    }
    if (toolTokenGrant?.runId) {
      activeChatAgentEventSinks.set(toolTokenGrant.runId, (payload) => {
        lastAgentEventPhase = summarizeAgentEventForInactivity(payload);
        noteAgentActivity();
        noteFirstOutputEvent(payload);
        send('agent', payload);
      });
      activeChatRunHandles.set(toolTokenGrant.runId, { noteArtifactRegistered });
    }
    // If detection can't find the binary, surface a friendly SSE error
    // pointing at /api/agents instead of silently falling back to
    // spawn(def.bin) — that fallback re-introduces the exact ENOENT symptom
    // from issue #10.
    if (!resolvedBin || !agentLaunch.launchPath) {
      cleanupExtensionPlan();
      revokeToolToken('child_exit');
      unregisterChatAgentEventSink();
      send('error', createSseErrorPayload(
        'AGENT_UNAVAILABLE',
        `Agent "${def.name}" (\`${def.bin}\`) is not installed or not on PATH. ` +
          'Install it and refresh the agent list (GET /api/agents) before retrying.',
        { retryable: true },
      ));
      return finishStrategyAwarePhysicalRun('failed', 1, null);
    }
    const configuredAgentSpawnEnv = createDaemonDataDirConfiguredAgentEnv(configuredAgentEnv);
    const agentSpawnEnv = await spawnEnvForAgentAsync(
      def.id,
      {
        ...createAgentRuntimeEnv(process.env, daemonUrl, toolTokenGrant, PIXO_NODE_BIN, inheritedEnvironment),
        ...(def.env || {}),
      },
      configuredAgentSpawnEnv,
      undefined,
      { resolvedBin: agentLaunch.selectedPath },
    );

    const pixoMediaEnv = createOpenPixoToolEnv({
      daemonUrl,
      projectDir: cwd,
      projectId: typeof projectId === 'string' ? projectId : null,

      runId: run.id,
      conversationId: run.conversationId,
      analyticsContext: run.analyticsContext ?? null,
    });
    if (run.cancelRequested || design.runs.isTerminal(run.status)) {
      cleanupExtensionPlan();
      revokeToolToken('child_exit');
      unregisterChatAgentEventSink();
      return;
    }

    run.status = 'running';
    run.updatedAt = Date.now();
    send('start', {
      runId,
      agentId,
      bin: userFacingAgentLabel(agentId, resolvedBin),
      streamFormat: def.streamFormat ?? 'plain',
      projectId: typeof projectId === 'string' ? projectId : null,
      cwd,
      model: safeModel,
      reasoning: safeReasoning,
      serviceTier: safeServiceTier,
      toolTokenExpiresAt: toolTokenGrant?.expiresAt ?? null,
    });
    /*
     * This turn's done key, published BEFORE the child is spawned.
     *
     * Ordering is the whole contract: the chat client only honours a
     * `<pixo-done key="…"/>` marker whose key matches the one it has already
     * seen for this turn, so the key event must land ahead of the first
     * `text_delta` on both the live stream and the persisted event list. It is
     * emitted as a normal agent event so it rides the same path as everything
     * else — persisted into the assistant message and replayed on reconnect —
     * rather than needing a message column of its own.
     */
    if (typeof run.doneKey === 'string' && run.doneKey) {
      send('agent', { type: 'done_key', key: run.doneKey });
    }
    // The skills this prompt carries in full. The agent never has to read these,
    // so its tool calls would not show that they were used.
    const loadedSkillIds = [...new Set([...selectedSkillIds, ...projectSkillContext.loadedSkillIds])];
    if (loadedSkillIds.length > 0) send('agent', { type: 'skills_loaded', skillIds: loadedSkillIds });
    noteAgentActivity();

    let child;
    let protocolSession = null;
    let writePromptToChildStdin = false;
    let promptDeliveredAtSpawn = false;
    let spawnedAgentEnv = null;
    let codexCleanupInvocation: CodexCleanupInvocation | null = null;
    let completeCodexEvidenceCollection = () => {};
    const codexEvidenceCollected = def.id === 'codex'
      ? new Promise<void>((resolve) => { completeCodexEvidenceCollection = resolve; })
      : undefined;
    // The stream handler is block-scoped to its parser branch, but the OpenCode
    // post-run child export runs in the shared close handler below — after the
    // stream that produced the candidates is gone.
    let jsonEventStreamHandler: ReturnType<typeof createJsonEventStreamHandler> | null = null;
    let agentStdoutTail = '';
    let agentStderrTail = '';
    const stderrRedactor = createCodexTextRedactor(runSecrets);
    const stdoutRedactor = createCodexTextRedactor(runSecrets);
    const emitVisibleAgentStderr = (chunk: unknown) => {
      const visibleChunk = stderrRedactor.write(chunk == null ? '' : String(chunk));
      if (!visibleChunk) return;
      agentStderrTail = `${agentStderrTail}${visibleChunk}`.slice(-2000);
      send('stderr', { chunk: visibleChunk });
    };
    const flushVisibleAgentStderr = () => {
      const visibleChunk = stderrRedactor.flush();
      if (!visibleChunk) return;
      agentStderrTail = `${agentStderrTail}${visibleChunk}`.slice(-2000);
      send('stderr', { chunk: visibleChunk });
    };
    try {
      // Prompt delivery via stdin is now the universal default. This bypasses
      // both the cmd.exe 8KB limit and the CreateProcess 32KB limit.
      const stdinMode =
        def.promptViaStdin ||
        def.streamFormat === CODEX_APP_SERVER_STREAM_FORMAT
          ? 'pipe'
          : 'ignore';
      // Per-run gateway token: environment only, redacted from output, revoked
      // when the run finalizes.
      let openpixoAgentEnv = {};
      if (openpixoAgentRun) {
        // Auto has no effort of its own: each model it picks runs at its default.
        const token = openPixoAgentGateway.open(runId, (event) => send('agent', event), openpixoAgentAuto ? null : openpixoAgentEffort(reasoning));
        runSecrets.push(token);
        openpixoAgentEnv = { [OPENPIXO_AGENT_TOKEN_ENV]: token };
        const previousGatewayFinalize = run.onFinalize;
        run.onFinalize = () => {
          try { previousGatewayFinalize?.(); }
          finally { openPixoAgentGateway.close(runId); }
        };
      }
      const env = await applyAgentLaunchEnvAsync({
        // First, so anything the user or runtime set explicitly still wins.
        ...await npmRegistryEnv({ env: agentSpawnEnv, cwd: effectiveCwd }),
        ...agentSpawnEnv,
        ...(mmdRouteLaunchEnv || {}),
        ...pixoMediaEnv,
        ...(byokOpenCodeProvider ? byokOpenCodeProvider.env : {}),
        ...openpixoAgentEnv,
        ...(nativeCodexProvider?.env ?? {}),

        // OpenCode external-MCP injection (issue #2142). Layered AFTER
        // spawnEnvForAgent / pixoMediaEnv / configuredAgentEnv so the
        // daemon-built MCP config wins over a stale value the user
        // might have exported in their shell — that would let an
        // outdated content string suppress the user's freshly-saved
        // MCP servers, which is exactly the bug we are fixing.
        // `opencodeConfigContent === null` means "no enabled servers";
        // we deliberately leave the env unset in that case so the
        // user's saved `~/.config/opencode/opencode.json` continues
        // to apply as-is.
        ...(opencodeConfigContent
          ? { OPENCODE_CONFIG_CONTENT: opencodeConfigContent }
          : {}),
        ...(extensionPlan?.env ?? {}),
      }, agentLaunch);
      if (def.id === 'opencode' || usesBundledOpenCode(def.id)) {
        try {
          const versions = await ensureDetectedRuntimeVersions('opencode', configuredAgentEnv);
          if (!versions?.agentCliVersion) {
            console.info('[opencode] optional tool previews disabled: CLI version unavailable; later launches retry detection after the short cache expires');
          }
          await applyOpenCodeEventPlugin(env, RUNTIME_DATA_DIR, versions?.agentCliVersion, agentSpawnEnv.OPENCODE_CONFIG_CONTENT);
        } catch (error) {
          console.warn('[opencode] optional tool previews unavailable:', error instanceof Error ? error.message : String(error));
        }
      }
      // Version detection and plugin staging above can yield while a cancel
      // request arrives. Never spawn a child after that cancellation.
      if (run.cancelRequested || design.runs.isTerminal(run.status)) {
        cleanupExtensionPlan();
        revokeToolToken('child_exit');
        unregisterChatAgentEventSink();
          return;
      }
      spawnedAgentEnv = env;
      if (extensionPlan && runScratchDir) writeRuntimeExtensionFiles(extensionPlan, runScratchDir);
      const invocation = createCommandInvocation({
        command: agentLaunch.launchPath,
        args,
        env,
      });
      if (def.streamFormat === CODEX_APP_SERVER_STREAM_FORMAT) {
        codexCleanupInvocation = {
          command: invocation.command, args: [...invocation.args], env: { ...env }, cwd: effectiveCwd,
          ...(invocation.windowsVerbatimArguments !== undefined
            ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments } : {}),
        };
      }
      lifecycle.mark('launch_preflight_end');
      lifecycle.mark('process_spawn_start');
      // A whole-prompt stdin prompt (plain text, or the runtime's own
      // one-shot framing) is handed over as a complete file at spawn; live
      // stdin protocols (Claude stream-json, JSON-RPC) keep the pipe. The
      // agent stays on record until its process group is gone, so a daemon
      // started after this one dies can reap it. See runtimes/agent-process.ts.
      const spawnedAgent = spawnAgentProcess({
        command: invocation.command,
        args: invocation.args,
        env,
        cwd: effectiveCwd,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        stdin: stdinMode === 'pipe' && runtimeReadsPlainTextPromptFromStdin(def)
          ? { prompt: composed }
          : stdinMode,
        runDir: path.join(RUNTIME_DATA_DIR, 'runs', run.id),
        runId: run.id,
      });
      child = spawnedAgent.child;
      promptDeliveredAtSpawn = spawnedAgent.promptDeliveredAtSpawn;
      lifecycle.mark('process_spawned');
      run.child = child;
      run.childPid = typeof child.pid === 'number' ? child.pid : null;
      run.processGroupId = spawnedAgent.processGroupId;
      if (
        (def.promptViaStdin || def.streamFormat === CODEX_APP_SERVER_STREAM_FORMAT) &&
        child.stdin
      ) {
        // EPIPE from a fast-exiting CLI (bad auth, missing model, exit on
        // launch) would otherwise surface as an unhandled stream error and
        // crash the daemon. Swallow it — the regular exit/close handlers
        // below already route the underlying failure to SSE via stderr.
        child.stdin.on('error', (err) => {
          // EPIPE = Unix broken-pipe when child closes its stdin read end
          // early. 'write EOF' (err.code 'EOF') = Windows equivalent of
          // the same condition via UV_EOF. Both mean the child exited before
          // reading stdin — the process exit/close handlers already route
          // the underlying failure to SSE via stderr, so swallow these here.
          if (err.code !== 'EPIPE' && err.code !== 'EOF' && err.message !== 'write EOF') {
            send(
              'error',
              createSseErrorPayload(
                'AGENT_EXECUTION_FAILED',
                `stdin: ${err.message}`,
              ),
            );
          }
        });
        // The app-server transport owns its own stdin writes (JSON-RPC
        // frames); only the plain stdin-prompt adapters hand the composed
        // prompt over on this channel — and a prompt already delivered as the
        // child's file-backed stdin at spawn must never be written twice.
        writePromptToChildStdin = def.promptViaStdin === true && !promptDeliveredAtSpawn;
      }
    } catch (err) {
      cleanupExtensionPlan();
      revokeToolToken('child_exit');
      unregisterChatAgentEventSink();
      send('error', createSseErrorPayload(
        'AGENT_EXECUTION_FAILED',
        `spawn failed: ${err.message}`,
      ));
      finishStrategyAwarePhysicalRun('failed', 1, null);
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      childStdoutSeen = true;
      noteAgentActivity();
      agentStdoutTail = `${agentStdoutTail}${stdoutRedactor.write(String(chunk))}`.slice(-2000);
    });

    // Structured streams (Claude Code) go through a line-delimited JSON
    // parser that turns stream_event objects into UI-friendly events. For
    // plain streams (most other CLIs) we forward raw chunks unchanged so
    // the browser can append them to the assistant's text buffer.
    let agentStreamError = null;
    // Preserve whether a latched error predates a later cancel request. The
    // close handler runs after cancel() has already flipped cancelRequested,
    // so consulting only the current flag loses the ordering of those events.
    let agentStreamErrorObservedBeforeCancellation = false;
    run.runtimeFailureObservedBeforeCancellation = false;
    let agentProducedOutput = false;
    let trackingSubstantiveOutput = false;
    // Event types that count as "the agent actually produced a response or a
    // deliverable." Lifecycle markers (`status`), meter readings (`usage`),
    // reasoning deltas, and tool activity deliberately do NOT count: a run can
    // think/read/call tools and still terminate before returning text/artifacts
    // to the user. Treat that as empty output instead of a silent success
    // (issues #691, #4814).
    const SUBSTANTIVE_AGENT_EVENT_TYPES = new Set([
      'text_delta',
      'artifact',
    ]);
    // First-token timing must reflect when the user actually starts seeing
    // model output, so only token-producing events qualify. `tool_use` is
    // deliberately excluded: a run that opens with a Read/Glob/MCP call would
    // otherwise stamp `firstTokenAt` before any `text_delta` streamed,
    // making `time_to_first_token_ms` / `spawn_to_first_token_ms` under-report
    // TTFT for tool-first runs. `thinking_delta` stays in because it is the
    // first visible model activity the user perceives.
    const FIRST_TOKEN_AGENT_EVENT_TYPES = new Set([
      'text_delta',
      'thinking_delta',
    ]);
    /*
     * `first_token` only. `first_visible_output` has exactly ONE owner: the
     * `send()` path, which asks `runLifecycleMarkersForStreamEvent` whether the
     * frame actually carried characters.
     *
     * Co-stamping both here made the two boundaries the same number by
     * construction, and Claude is the case where they genuinely differ: its
     * extended thinking arrives as `thinking_delta` frames whose `thinking` is
     * the empty string (20 of 20 frames on a 26.5s turn measured straight off
     * the CLI). A token really was produced — thinking tokens are billed — so
     * `first_token` belongs here; nothing was drawn, so the pixel boundary does
     * not. Run 1cc48454-e9a7-411a-981e-4325fcca95dd reported
     * `time_to_first_visible_output_ms: 9926` for a turn whose first on-screen
     * character landed at 46,729ms.
     *
     * A runtime whose visible output never reaches `send()` simply leaves the
     * mark unset, and `summarizeRunTimingAnalytics` already falls back to
     * `firstTokenAt` — i.e. exactly the value this line used to write.
     */
    const noteFirstTokenAt = (timestamp = Date.now()) => {
      // Telemetry-only, and every call site sits inside a live stream handler
      // that is mid-way through delivering a delta. Same contract as the marks
      // in `send`: a fault here costs a timing field, never the reply.
      recordRunTelemetry('first token', () => {
        if (run.analyticsTelemetry?.firstTokenAt) return;
        lifecycle.mark('first_token', timestamp);
      });
    };
    const noteCliReadyAt = (timestamp = Date.now()) => {
      if (run.analyticsTelemetry?.cliReadyAt) return;
      run.analyticsTelemetry = {
        ...(run.analyticsTelemetry ?? {}),
        cliReadyAt: timestamp,
      };
    };
    const noteSessionInitDoneAt = (timestamp = Date.now()) => {
      if (run.analyticsTelemetry?.sessionInitDoneAt) return;
      run.analyticsTelemetry = {
        ...(run.analyticsTelemetry ?? {}),
        sessionInitDoneAt: timestamp,
      };
    };
    const noteFirstTokenFromAgentEvent = (ev) => {
      if (ev?.type && FIRST_TOKEN_AGENT_EVENT_TYPES.has(ev.type)) {
        noteFirstTokenAt();
      }
    };

    // Per-run role-marker guard for non-Claude structured streams (#3247).
    // Claude has its own per-message guards in claude-stream.ts.
    const runGuard = createRoleMarkerGuard('run');
    let runWarned = false;
    // Strip on every Run, announce on the Runs that asked for a title. The
    // directive lives in the agent's own session history, so a resumed CLI can
    // repeat the marker on a later turn that never requested one — gating the
    // stripper on the request is what let `<pixo-title>` reach the chat.
    //
    // NOTE(sync/main): origin/main fixed that leak AT THIS CALL SITE (pass
    // `enabled: true`, swap the announce callback). This branch fixed the same
    // leak one layer down, in `title-marker.ts`: the stripper now always scans,
    // and `enabled` means "adopt this title", not "strip it". Both fixes are
    // kept — the call site below reads correctly against the new semantics, and
    // main's regression test (`enabled: true` + no-op emit) still passes.
    const rawTitleMarkerStripper = createAgentTitleMarkerStripper({
      enabled: Boolean(titleGenerationRequested),
      emitTitle: (title) => send('agent', { type: 'conversation_title', title }),
    });
    /*
     * 评审剧场的通信语法**兜底剥离**(见 `panel-grammar-strip.ts` 的注释)。
     *
     * 挂在这里而不是逐个改五个调用点:所有可见文本都要先过 `titleMarkerStripper`,
     * 把它包一层,五处自动都有,以后再多一处也不会漏。
     * 顺序是「先剥标题、再剥面板语法」—— 两者互不重叠,谁先都行,
     * 但两个都必须有各自的半截缓冲,否则会闪出半截标签。
     */
    const panelGrammarStripper = createPanelGrammarStripper();
    /*
     * **思考流**的那一份 —— 独立实例,不和正文共用。
     *
     * 上面那个只盖住 `text_delta`。`thinking_delta` 走的是另一条路
     * (`sendAgentEvent` 里非 text_delta 一律直接 `emitAgentEvent`),
     * 2026-08-26 建兜底时漏掉了它,于是剧场语法照旧原样进思考区**并落库**
     * (`chat-run-messages.ts` 把 `thinking_delta` 存成 `{ kind: 'thinking' }`),
     * 刷新之后永远还在。用户第五次撞到的就有这一半。
     *
     * 为什么必须是**第二个实例**而不是复用上面那个:剥离器带「半截标记」缓冲,
     * 两条流交错喂进同一个缓冲会互相串位 —— 正文的半截会被思考流的下一片接上,
     * 拼出一个两边都没写过的东西。各自一份缓冲是唯一安全的做法。
     */
    const thinkingGrammarStripper = createPanelGrammarStripper();
    /*
     * 这一轮的「下一步建议」(`<pixo-next key="…">`,见 `next-step-marker.ts`)。
     *
     * 和上面两个剥离器串在同一条链上,理由一样:所有可见文本都要过这条链,
     * 挂在这里就不会漏掉任何一个调用点。它排在最外层 —— 看到的正是客户端
     * 将要看到的文本,判据和最终屏幕上的东西一致。
     *
     * key 只管**采纳**,不管**剥离**:key 不对、没写 key、这一轮压根没 key,
     * 标记照样吃掉。这是 `<pixo-title>` 拿线上事故换来的规矩。
     */
    const nextStepMarkerStripper = createNextStepMarkerStripper({
      key: typeof run.doneKey === 'string' && run.doneKey ? run.doneKey : null,
      emit: (suggestions) => send('agent', { type: 'next_steps', suggestions }),
    });
    /*
     * 这一轮的「显示什么」(`<pixo-focus …/>`,见 `artifact-focus-marker.ts`)。
     *
     * 和上面三个剥离器串在同一条链上,理由一样:所有可见文本都要过这条链,
     * 挂在这里就不会漏掉任何一个调用点。
     *
     * key 只管**采纳**,不管**剥离** —— 和 `<pixo-next>` 同一条规矩,也是
     * `<pixo-title>` 拿线上事故换来的。
     *
     * `open` 还要过一道文件系统门:声明的路径必须落在项目根之内(realpath 之后
     * 再判一次,软链走不出去),而且文件必须**非空**。空白预览在用户眼里就是
     * bug,所以标记先到、字节后到时,标记是**攒着**而不是丢掉 —— 由
     * `settle()` 在每个 tool_result 之后补发。
     */
    const artifactFocusStripper = createArtifactFocusMarkerStripper({
      key: typeof run.doneKey === 'string' && run.doneKey ? run.doneKey : null,
      projectRoot: typeof cwd === 'string' && cwd ? cwd : null,
      emit: (selection) => send('agent', { type: 'artifact_focus', ...selection }),
    });
    const titleMarkerStripper = {
      strip: (delta: string) =>
        nextStepMarkerStripper.strip(
          artifactFocusStripper.strip(
            panelGrammarStripper.strip(rawTitleMarkerStripper.strip(delta)),
          ),
        ),
      flush: () => {
        const head = nextStepMarkerStripper.strip(
          artifactFocusStripper.strip(
            panelGrammarStripper.strip(rawTitleMarkerStripper.flush()),
          ),
        );
        const mid = nextStepMarkerStripper.strip(
          artifactFocusStripper.strip(panelGrammarStripper.flush()),
        );
        const tail = nextStepMarkerStripper.strip(artifactFocusStripper.flush());
        return head + mid + tail + nextStepMarkerStripper.flush();
      },
    };

    function flushAgentTitleMarkerBuffer() {
      const visible = titleMarkerStripper.flush();
      if (visible) emitGuardedTextDelta(visible);
      /*
       * 思考流攒着的半截 —— 流结束了,它终究不是标记,原样吐回去。
       *
       * 「不吞用户的字」和「不闪半截标签」是同一条规矩的两面(见
       * `panel-grammar-strip.ts` 开头的两条硬要求)。走 `send` 而不是
       * `emitAgentEvent`,是因为这里已经出了剥离器,再进一次收口会被自己
       * 重新扣住,永远吐不出来。
       */
      const heldThinking = thinkingGrammarStripper.flush();
      if (heldThinking) send('agent', { type: 'thinking_delta', delta: heldThinking });
      /*
       * Backstop for the empty-file gate. The normal release path is the
       * `tool_result` hook in `emitAgentEvent` — the write lands, the result
       * frame arrives, the bytes are there. This covers the runtime that
       * reports no write event at all: the file is on disk by the time the
       * stream ends, so one last probe turns a held marker into an event.
       * Fire-and-forget on purpose; the run must not block on a stat.
       */
      void artifactFocusStripper.settle();
    }

    function guardTextDelta(delta) {
      return runGuard.feedText(delta);
    }

    function emitGuardedTextDelta(delta: string) {
      const safe = guardTextDelta(delta);
      if (safe.length > 0) {
        noteFirstOutputEvent({ type: 'text_delta' });
        send('agent', { type: 'text_delta', delta: safe });
      }
      if (runGuard.contaminated && !runWarned) {
        runWarned = true;
        const warn = runGuard.warningEvent();
        if (warn) {
          send('agent', warn);
          abortForRoleMarker(warn.marker);
        }
      }
    }

    function emitTitleFilteredGuardedTextDelta(delta: string) {
      const visibleDelta = titleMarkerStripper.strip(delta);
      if (!visibleDelta) return false;
      emitGuardedTextDelta(visibleDelta);
      return true;
    }

    // Detection-only is necessary but not sufficient: by the time we see
    // the role marker the model has already burned tokens, and the
    // subprocess will keep generating downstream tokens (including
    // `tool_use` blocks built on the fabricated context) until it exits
    // on its own. We terminate the child immediately so:
    //   1. Token billing stops at the detection point, not at the
    //      model's natural completion of the contaminated response.
    //   2. `tool_use` content blocks emitted AFTER the marker cannot
    //      reach the daemon's tool-call dispatcher. Blocks emitted
    //      BEFORE the marker have already been dispatched; this guard
    //      can't help with those — they're a separate hardening.
    //   3. The UI distinguishes "completed" from "killed by safety
    //      guard" through a structured SSE error rather than seeing a
    //      `fabricated_role_marker` warning followed by an eventual
    //      normal turn-end.
    // Idempotent — multiple guard paths (per-message Claude, run-scoped
    // non-Claude, plain stdout) can all call it.
    let roleMarkerAbortFired = false;
    function abortForRoleMarker(marker: string) {
      if (roleMarkerAbortFired) return;
      roleMarkerAbortFired = true;
      send(
        'error',
        createSseErrorPayload(
          'ROLE_MARKER_HALLUCINATION',
          `Run terminated: model emitted fabricated role marker (\`${marker}\`). ` +
            'No further tokens or tool calls accepted from this turn. ' +
            'See inherited issue #3247.',
          { retryable: true },
        ),
      );
      if (protocolSession?.abort) {
        try {
          protocolSession.abort();
        } catch {
          // ignore — best-effort
        }
      }
      if (child && !child.killed) design.runs.signalChild(run, 'SIGTERM');
      scheduleForcedChildShutdown();
    }

    const toolLoopGuard = createToolLoopGuard({ mode: toolLoopModeForAgent(def.id) });
    let toolLoopAbortFired = false;

    // Idempotent — both agent-event paths (sendAgentEvent, the Claude
    // stream-json callback) can route a halt verdict here.
    function abortForToolLoop(verdict: ToolLoopVerdict) {
      if (toolLoopAbortFired) return;
      toolLoopAbortFired = true;
      send(
        'error',
        createSseErrorPayload(
          'TOOL_LOOP_DETECTED',
          `Run terminated: the agent repeated a ${verdict.toolName} call ` +
            `${verdict.count}× without progress (\`${verdict.signature}\`). Re-check the ` +
            'actual target — the file, the element, the command — before retrying ' +
            'instead of resubmitting the same turn.',
          { retryable: true },
        ),
      );
      if (protocolSession?.abort) {
        try {
          protocolSession.abort();
        } catch {
          // ignore — best-effort
        }
      }
      // Route through signalChild (not a bare child.kill) so the halt escalates
      // to the whole process group when one exists, matching abortForRoleMarker,
      // cancel, and the inactivity watchdog. A bare child.kill leaves Bash/build
      // grandchildren alive to keep mutating the workspace until the forced
      // shutdown fires — exactly the loop class this guard is meant to stop.
      if (child && !child.killed) design.runs.signalChild(run, 'SIGTERM');
      scheduleForcedChildShutdown();
    }

    // Feed a normalized agent event into the loop guard and act on a verdict.
    // Safe to call for every event; non-tool events are ignored. Emit the
    // `tool_loop` warning to the UI/CLI, and on a halt verdict tear the run
    // down so it cannot keep grinding.
    function observeToolEventForLoop(ev: any) {
      if (!ev || typeof ev !== 'object') return;
      if (ev.type === 'tool_use' && typeof ev.id === 'string') {
        toolLoopGuard.observeToolUse(ev.id, typeof ev.name === 'string' ? ev.name : 'tool', ev.input);
        return;
      }
      if (ev.type === 'tool_result' && typeof ev.toolUseId === 'string') {
        const verdict = toolLoopGuard.observeToolResult(
          ev.toolUseId,
          Boolean(ev.isError),
          typeof ev.content === 'string' ? ev.content : '',
        );
        if (verdict) {
          send('agent', verdict);
          if (verdict.action === 'halt') abortForToolLoop(verdict);
        }
      }
    }

    function emitAgentEvent(ev: any) {
      /*
       * 思考流的剧场语法剥离 —— 位置是判据的一部分,不是随手挑的。
       *
       * 必须在 `send('agent', …)` **之前**:落库(`persistRunEventToAssistantMessage`)
       * 就挂在 `send()` 里,晚一步这段协议就永久写进 `{ kind: 'thinking' }`,
       * 刷新之后再也擦不掉。
       *
       * 必须在 `emitAgentEvent` 这一层而不是某个适配器里:这是 27 个 runtime
       * 唯一都要经过的收口(见下面 tool timing 的同款理由),挂在这里就没有
       * runtime 能从覆盖面里漂出去 —— 上一次正是"某条路径漏挂"栽的跟头。
       *
       * 整片都是标记时连事件都不发,免得思考区多出一格空的「Thoughts」;
       * 但"模型已经在出字"这件事照记,否则首字时延会被记晚。
       *
       * ⚠️ 该不该扔看的是 `strippingConsumedTheWholeFrame` ——「上游到底送没送字符」,
       * 不是「剥完还剩没剩」。W102(2026-09-03)在这里栽过:原来写的是 `if (!visible)`,
       * 而 claude 的思考帧正文 100% 是空串,`strip('')` 也返回空串,于是**整个
       * claude 家族的思考帧被 100% 丢掉** —— 壳头「思考中」永远不亮(规格 W11 明写
       * 「哪怕 delta 为空」也要进入思考中),传输层拿这些帧当心跳的静默计时也一起谎报。
       * 判据与真机数字见 `panel-grammar-strip.ts` 上那个函数的注释。
       */
      if (ev?.type === 'thinking_delta' && typeof ev.delta === 'string') {
        const visible = thinkingGrammarStripper.strip(ev.delta);
        if (strippingConsumedTheWholeFrame(ev.delta, visible)) {
          noteFirstOutputEvent(ev);
          return;
        }
        if (visible !== ev.delta) ev = { ...ev, delta: visible };
      }
      stampToolTiming(ev);
      // Fold work-completeness signals (TodoWrite snapshot / truncation) off the
      // stream BEFORE the send, so run.lastTodoSnapshot / run.truncatedMidTurn are
      // set by the time finish() derives run.endedWithUnfinishedWork (#1247/#1060).
      captureRunWorkCompletenessSignals(run, ev);
      noteFirstOutputEvent(ev);
      send('agent', ev);
      observeToolEventForLoop(ev);
      /*
       * The `<pixo-focus open="…">` release point.
       *
       * A tool result is the daemon's only runtime-agnostic "the filesystem may
       * have changed" signal — Write, Edit, and a Bash heredoc all land here,
       * and this is the choke point every one of the 27 adapters funnels
       * through, so no runtime can drift out of coverage. `settle()` is a no-op
       * unless a marker is actually waiting on bytes, and it is idempotent, so
       * calling it on every result costs one branch.
       */
      if (ev?.type === 'tool_result') void artifactFocusStripper.settle();
    }

    const contextLimits = contextLimitsForRun(def, safeModel);
    const sendAgentEvent = (ev) => {
      if (runSecrets.length && (def.extensionInjector || def.id === 'codex')) ev = redactRunOutput(ev);
      if (ev?.type === 'context_usage' && contextLimits) ev = { ...contextLimits, ...ev };
      if (ev?.type === 'error') {
        // Cancellation is the terminal user intent. Some CLIs flush a final
        // error record while reacting to SIGTERM; treating that late frame as
        // a run failure races the cancel route and can make it return failed.
        if (run.cancelRequested) return;
        if (agentStreamError) return;
        flushVisibleAgentStderr();
        const failureText = [
          String(ev.message || 'Agent stream error'),
          typeof ev.raw === 'string' ? ev.raw : '',
          agentStdoutTail,
          agentStderrTail,
        ].join('\n');
        agentStreamError = rewriteKnownAgentStreamError(
          agentId,
          String(ev.message || 'Agent stream error'),
          failureText,
        );
        agentStreamErrorObservedBeforeCancellation = true;
        run.runtimeFailureObservedBeforeCancellation = true;
        clearInactivityWatchdog();
        const authFailure = classifyAgentAuthFailure(agentId, failureText);
        if (authFailure?.status === 'missing') {
          send('error', createSseErrorPayload(
            'AGENT_AUTH_REQUIRED',
            authFailure.message ?? `${def.name} authentication required. Please re-authenticate and retry.`,
            { retryable: true },
          ));
          return;
        }
        // Recover the specific model-service failure class (auth / quota /
        // upstream) for agents without a tailored probe (Claude Code, codex,
        // …), so the chat shows an accurate reason instead of the generic
        // execution-failed bucket.
        const serviceCode = classifyAgentServiceFailure(failureText);
        if (serviceCode) {
          send('error', createSseErrorPayload(serviceCode, agentStreamError, {
            details: ev.raw ? { raw: ev.raw } : undefined,
            retryable: true,
          }));
          return;
        }
        send('error', createSseErrorPayload('AGENT_EXECUTION_FAILED', agentStreamError, {
            details: ev.raw ? { raw: ev.raw } : undefined,
          }));
        return;
      }
      noteCliReadyAt();
      // Capture-style resume: codex reports its own thread id on the
      // `thread.started` status event. Persist the most recent non-empty id we
      // see so the create-turn store (and the resumable-failure store) use the
      // CLI's real session handle, not the unused daemon-minted `newSessionId`.
      if (
        agentCapturesSessionId &&
        ev?.type === 'status' &&
        typeof ev.sessionId === 'string' &&
        ev.sessionId.length > 0
      ) {
        capturedSessionId = ev.sessionId;
        run.nativeSessionRecovery = markNativeSessionCaptured({
          previous: run.nativeSessionRecovery,
          agentId: def.id,
          sessionId: capturedSessionId,
          resumed: agentResumeCtx.isResuming,
        });
        publishNativeSessionRecoveryMetadata();
      }
      lastAgentEventPhase = summarizeAgentEventForInactivity(ev);
      noteAgentActivity();
      if (ev?.type === 'text_delta' && typeof ev.delta === 'string') {
        const decodedAt = Date.now();
        if (emitTitleFilteredGuardedTextDelta(ev.delta)) {
          noteFirstTokenAt(decodedAt);
          agentProducedOutput = true;
        }
        return;
      }
      noteFirstTokenFromAgentEvent(ev);
      if (ev?.type && SUBSTANTIVE_AGENT_EVENT_TYPES.has(ev.type)) {
        agentProducedOutput = true;
      }
      emitAgentEvent(ev);
    };

    if (def.streamFormat === 'claude-stream-json') {
      const claude = createClaudeStreamHandler((ev) => {
        if (def.extensionInjector && runSecrets.length) ev = redactRunOutput(ev);
        // First parsed claude-stream-json event = CLI ready (#3408 §4); the
        // init/system line arrives well before the model's first token.
        noteCliReadyAt();
        if (ev?.type === 'error') {
          // Claude commonly reports its SIGTERM shutdown as an assistant or
          // result error frame. Once cancellation has been requested, that
          // frame is shutdown noise rather than a new user-visible failure.
          if (run.cancelRequested) return;
          if (agentStreamError) return;
          if (
            runtimeResumesSessionById(def) &&
            !run.resumeAutoReseeded &&
            resolveAgentResumeFailurePolicy({
              agentId: def.id,
              stderr: agentStderrTail,
              stdout: agentStdoutTail,
              isResuming: agentResumePromptPolicy.skipTranscript,
              resumeSessionId: agentResumePromptPolicy.resumeSessionId,
            }).resumeFailed
          ) {
            design.runs.emit(run, 'diagnostic', {
              type: 'agent_resume_failed_suppressed',
              agent_id: def.id,
              reason: 'resume_failed',
              previous_session_id: agentResumePromptPolicy.resumeSessionId ?? null,
            });
            return;
          }
          flushVisibleAgentStderr();
          const message = String((ev as any).message || 'Claude Code stream error');
          const failureText = [
            message,
            typeof (ev as any).code === 'string' ? (ev as any).code : '',
            agentStdoutTail,
            agentStderrTail,
          ].join('\n');
          clearInactivityWatchdog();
          // A parsed terminal Claude result has stronger provenance than text
          // sniffing across the combined stdout/stderr tail. In particular,
          // Claude can log `apiKeySource: none` alongside an upstream
          // `Prompt is too long` result; letting the broad auth diagnostic see
          // that tail first sends users to /login instead of reducing context.
          // Only accept the stable code emitted by claude-stream for this
          // terminal result shape; other Claude errors keep the existing
          // diagnostic/service fallback behavior.
          const structuredCode =
            (ev as any).terminal === true &&
            (ev as any).code === 'AGENT_PROMPT_TOO_LARGE'
              ? 'AGENT_PROMPT_TOO_LARGE'
              : null;
          // Claude surfaces a connection drop / reset as an in-stream `error`
          // frame (assistant `error:"unknown"` + the raw SDK string), which
          // would otherwise reach the UI verbatim as a non-retryable
          // AGENT_EXECUTION_FAILED. Run the same per-agent diagnostic used at
          // child-exit so this path emits the specific class
          // (AGENT_CONNECTION_DROPPED) — retryable, with copy the web can
          // localize and triage can count by code.
          const diagnostic = structuredCode
            ? null
            : diagnoseClaudeCliFailure({
                agentId: def.id,
                exitCode: 1,
                stderrTail: agentStderrTail,
                stdoutTail: failureText,
                env: spawnedAgentEnv,
                resolvedBin: agentLaunch.selectedPath,
              });
          const serviceCode = structuredCode
            ? null
            : classifyAgentServiceFailure(failureText);
          agentStreamError = structuredCode
            ? message
            : diagnostic?.message
              ?? rewriteKnownAgentStreamError(agentId, message, failureText);
          agentStreamErrorObservedBeforeCancellation = true;
          run.runtimeFailureObservedBeforeCancellation = true;
          send('error', createSseErrorPayload(
              structuredCode ?? diagnostic?.code ?? serviceCode ?? 'AGENT_EXECUTION_FAILED',
              agentStreamError,
              {
                retryable: structuredCode
                  ? false
                  : diagnostic?.retryable
                    ?? (serviceCode === 'AGENT_AUTH_REQUIRED' || serviceCode === 'RATE_LIMITED'),
                ...(diagnostic ? { details: { detail: diagnostic.detail } } : {}),
              },
            ));
          return;
        }
        lastAgentEventPhase = summarizeAgentEventForInactivity(ev);
        noteAgentActivity();
        if (ev?.type === 'text_delta' && typeof ev.delta === 'string') {
          const visibleDelta = titleMarkerStripper.strip(ev.delta);
          if (visibleDelta) {
            noteFirstTokenAt();
            emitAgentEvent({ ...ev, delta: visibleDelta });
          }
          return;
        }
        noteFirstTokenFromAgentEvent(ev);
        emitAgentEvent(ev);
        // Claude uses per-message guards (claude-stream.ts) rather than the
        // run-scoped guard above, so its `fabricated_role_marker` events
        // surface here directly from the stream handler, not via
        // emitGuardedTextDelta. Same abort semantics apply.
        if (ev && (ev as any).type === 'fabricated_role_marker') {
          const m = (ev as any).marker;
          abortForRoleMarker(typeof m === 'string' ? m : 'role marker');
        }
        // Stream-json input mode keeps the child's stdin open across the
        // turn so the daemon can stream further user messages mid-turn. The
        // child has no other way to know the turn is over, though — without
        // an EOF it sits idle until the inactivity watchdog kills it.
        // Bookkeeping here closes stdin on a clean terminal turn:
        //   - turn_end (per-turn synthesized from `stop_reason`): fire on
        //     `end_turn` etc. but NOT on `tool_use` — that stop reason
        //     means the model paused mid-tool, not "turn complete".
        //   - usage (session result at EOF in single-shot mode).
        try {
          applyClaudeStreamJsonRunBookkeeping(run, ev);
        } catch {}
      }, {
        suppressHtmlArtifactsAfterFileWrite: def.id === 'claude',
      });
      child.stdout.on('data', (chunk) => claude.feed(chunk));
      child.on('close', (code, signal) => {
        claude.flush();
        claude.finishOpenChildEvidence(
          run.cancelRequested
            ? 'canceled'
            : run.terminalTrigger === 'first_output_deadline'
              || run.terminalTrigger === 'inactivity_watchdog'
              ? 'timeout'
              : code === 0 && signal === null && !agentStreamError
                ? 'complete'
                : 'stream_incomplete',
        );
      });
    } else if (def.streamFormat === CODEX_APP_SERVER_STREAM_FORMAT) {
      // codex over the JSON-RPC `app-server` transport. Everything flows
      // through `sendAgentEvent`, exactly as it does for `exec --json`: the
      // normalizer translates app-server notifications back into the codex
      // stream frames the shipping parser already understands, so tool rows,
      // file changes, warnings, errors and usage take the same code path they
      // always did. The transport's own additions are token-level text and
      // reasoning deltas.
      trackingSubstantiveOutput = true;
      const codexSession = attachCodexAppServerSession({
        child,
        prompt: composed,
        cwd: effectiveCwd,
        model: safeModel,
        reasoning: safeReasoning,
        serviceTier: safeServiceTier,
        sandboxMode: codexResolvedSandboxMode({ readOnlyTurn }),
        approvalMode,
        config: extensionPlan?.rpcConfig,
        ...(nativeCodexProvider ? {
          modelProvider: nativeCodexProvider.providerId,
          suppressReasoningSummary: nativeCodexProvider.suppressReasoningSummary,
        } : {}),
        manageThreadVisibility: true,
        // This handle came from our captured agent_sessions record (or a
        // same-run daemon continuation), never from the public chat payload.
        resumeSessionOwned: agentResumeCtx.isResuming,
        imagePaths: def.supportsImagePaths ? safeImages : [],
        clientVersion: design.getAppVersion?.() ?? '0.0.0',
        // Capture-style resume, same contract as `exec resume <thread_id>`:
        // the id comes off the stream, and the daemon replays it here.
        resumeSessionId:
          agentResumeCtx.isResuming && agentResumeCtx.resumeSessionId
            ? agentResumeCtx.resumeSessionId
            : null,
        onAgentEvent: (event) => {
          observeApprovalEvent(event);
          sendAgentEvent(event);
        },
        onCliReady: () => noteCliReadyAt(),
        onSessionReady: () => noteSessionInitDoneAt(),
        // The prompt boundary for this transport is the `turn/start` write, not
        // a stdin write that never happens. Marking it keeps the run analytics
        // `stdin-write` and `agent-call` spans — and therefore the tool spans
        // nested under `agent-call` — present on app-server runs.
        onPromptSendStart: () => {
          lifecycle.mark('model_call_start');
          lifecycle.mark('stdin_write_start');
        },
        onPromptSendEnd: () => { lifecycle.mark('stdin_write_end'); },
        onTurnComplete: () => clearFirstOutputWatchdog(),
      });
      protocolSession = codexSession;
      run.codexApprovalSession = codexSession;
      run.approvalSession = codexRunApprovalSession(codexSession);
      if (codexCleanupInvocation) {
        const cleanupRunId = run.id;
        // Attach installs the session's physical-close proof first. This
        // listener is independent of the later retry-generation close guard.
        codexThreadCleanupOwner.bind(child, codexSession, codexCleanupInvocation, (result) => {
          const details = { runId: cleanupRunId, ...result };
          if (result.status === 'archived' && result.treeVerified !== false) {
            console.info('[codex] closed-thread cleanup completed', details);
          } else console.warn('[codex] closed-thread cleanup incomplete', details);
        }, codexEvidenceCollected);
      }
    } else if (def.streamFormat === 'json-event-stream') {
      // Pipe through sendAgentEvent so the OpenCode `type:'error'` frame
      // (now emitted as a real error event by json-event-stream.ts after
      // #691) actually triggers `agentStreamError` instead of being
      // forwarded as a no-op `agent` SSE event. This also wires the
      // substantive-output tracking the close handler reads below.
      trackingSubstantiveOutput = true;
      const handler = createJsonEventStreamHandler(
        def.eventParser || def.id,
        sendAgentEvent,
        def.id === 'opencode'
          ? {
              openCodeChildEvidence: {
                cliVersion:
                  run.preflightAgentCliVersion
                  ?? getDetectedRuntimeVersions(def.id)?.agentCliVersion
                  ?? '',
                onCandidate: (candidate) => sendAgentEvent({
                  type: 'diagnostic',
                  name: 'opencode_child_task_candidate',
                  ...candidate,
                }),
              },
            }
          : {},
      );
      jsonEventStreamHandler = handler;
      child.stdout.on('data', (chunk) => handler.feed(chunk));
      child.on('close', (code, signal) => {
        handler.flush();
      });
    }
    // Codex app-server supports protocol cancellation before child teardown.
    run.protocolSession = protocolSession;
    child.stderr.on('data', (chunk) => {
      noteAgentActivity();
      emitVisibleAgentStderr(chunk);
    });

    // A retry reuses the same run object but replaces run.child. Treat that
    // exact child identity as the attempt generation token: once ownership has
    // moved, this attempt may still receive a late error/close event, but it
    // must not emit errors, unregister the new sink, or make a terminal retry
    // decision for the new attempt.
    const attemptStillOwnsRun = () => run.child === child;
    const finishCanceledIfRequested = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): boolean => {
      if (!run.cancelRequested) return false;
      if (!design.runs.isTerminal(run.status)) {
        markRpcCloseReason('cancel_requested');
        finishWithRetryDecision('canceled', code, signal);
      }
      return true;
    };

    child.on('error', (err) => {
      clearInactivityWatchdog();
      clearFirstOutputWatchdog();
      cleanupExtensionPlan();
      flushVisibleAgentStderr();
      revokeToolToken('child_exit');
      if (!attemptStillOwnsRun()) return;
      unregisterChatAgentEventSink();
      if (run.pendingTerminalFinish) return;
      if (finishCanceledIfRequested(1, null)) return;
      if (protocolSession) beginProtocolAttemptTermination('protocol_child_error');
      send('error', createSseErrorPayload('AGENT_EXECUTION_FAILED', err.message));
      finishWithRetryDecision('failed', 1, null);
    });
    child.on('close', async (code, signal) => {
      try {
      clearInactivityWatchdog();
      clearFirstOutputWatchdog();
      clearForcedChildShutdown();
      flushVisibleAgentStderr();
      if (!attemptStillOwnsRun() || watchdogRetryRestarted) {
        // Finalization and event-sink / run-handle ownership (keyed by the
        // shared runId) now belong to another retry generation, so this
        // child's late close must not re-run them.
        // Revoke only THIS attempt's tool token (idempotent, keyed by its own
        // token string) and bail; the `finally` block still cleans up logs.
        revokeToolToken('child_exit');
        return;
      }
      revokeToolToken('child_exit');
      unregisterChatAgentEventSink();
      if (run.pendingTerminalFinish) return;
      if (protocolSession) beginProtocolAttemptTermination('protocol_child_close');
      completeCodexEvidenceCollection();

      // Resume-target-missing recovery runs BEFORE the generic fatal/stream-error
      // short-circuits. The signal arrives differently per adapter: codex reports

      if (
        !run.cancelRequested &&
        !forceInternalResume &&
        (runtimeResumesSessionById(def) || def.resumesSessionViaAcpLoad === true) &&
        run.conversationId &&
        resolveAgentResumeFailurePolicy({
          agentId: def.id,
          stderr: agentStderrTail,
          stdout: agentStdoutTail,
          isResuming: agentResumePromptPolicy.skipTranscript,
          resumeSessionId: agentResumePromptPolicy.resumeSessionId,
        }).autoReseedFullTranscript
      ) {
        const resumeSideEffects = runSideEffectsForRun(run);
        const safeColdProduction = undefined;
        // The resumed upstream session is gone (expired / pruned). Clear the dead
        // handle and TRANSPARENTLY re-run this same turn with a fresh session +
        // the full transcript rebuilt from the DB — exactly the pre-session-reuse
        // path. The user sees one (slightly slower) turn, never an error or a
        // "resend" prompt. Re-spawn reuses the same-run retry machinery; because
        // the session row is now cleared, the re-spawn resolves isResuming=false
        // (fresh session, full transcript), so it CANNOT resume-fail again — the
        // `resumeAutoReseeded` guard is belt-and-suspenders against any loop.
        clearAgentSession(db, run.conversationId, def.id);
        if (!run.resumeAutoReseeded) {
          run.resumeAutoReseeded = true;
          run.resumeAutoReseededFrom = agentResumePromptPolicy.resumeSessionId ?? null;
          run.nativeSessionRecovery = markNativeSessionAutoReseeded({
            previous: run.nativeSessionRecovery,
            agentId: def.id,
            previousSessionId: agentResumePromptPolicy.resumeSessionId,
          });
          publishNativeSessionRecoveryMetadata();
          // Persisted to the per-run events.jsonl that the help → diagnostics
          // export bundles, so the whole resume → fail → auto-reseed chain is
          // visible in a support bundle without any user-facing signal.
          design.runs.emit(run, 'diagnostic', {
            type: 'agent_resume_auto_reseed',
            agent_id: def.id,
            reason: 'resume_failed',
            previous_session_id: agentResumePromptPolicy.resumeSessionId ?? null,
            stale_session_cleared: true,
            nativeSessionRecovery: run.nativeSessionRecovery,
          });
          scheduleRetryRestart(0);
          return;
        }
        // Unreachable in practice (the reseed runs fresh); if a second resume
        // failure ever surfaces in one run, fall back to the explicit affordance.
        send('error', createSseErrorPayload(
          'AGENT_EXECUTION_FAILED',
          'The previous session could not be resumed (it may have expired). Resend your message to continue with a fresh session.',
          { retryable: true },
        ));
        return finishStrategyAwarePhysicalRun('failed', code ?? 1, signal ?? null);
      }
      flushAgentTitleMarkerBuffer();
      if (agentStreamErrorObservedBeforeCancellation && agentStreamError) {
        markRpcCloseReason('stream_error');
        return finishWithRetryDecision('failed', code === 0 ? 1 : (code ?? 1), signal ?? null);
      }
      if (
        code !== 0 &&
        !run.cancelRequested
      ) {

        const authFailure = classifyAgentAuthFailure(
          agentId,
          `${agentStderrTail}\n${agentStdoutTail}`,
        );
        if (authFailure?.status === 'missing') {
          send('error', createSseErrorPayload(
            'AGENT_AUTH_REQUIRED',
            authFailure.message ?? `${def.name} authentication required. Please re-authenticate and retry.`,
            { retryable: true },
          ));
          return finishWithRetryDecision('failed', code ?? 1, signal ?? null);
        }
      }
      // Empty-output guard: a clean `code === 0` exit with no visible
      // output means the run silently finished without producing anything.
      // Surface an explicit failure so the chat shows a clear reason.
      if (
        code === 0 &&
        !run.cancelRequested &&
        trackingSubstantiveOutput &&
        !agentProducedOutput
      ) {
        markRpcCloseReason('empty_output');
        send('error', createSseErrorPayload(
          'AGENT_EXECUTION_FAILED',
          'Agent completed without producing any output. The model or provider may have returned an empty response. Check the agent logs for upstream errors, then try re-authenticating the agent or switching models.',
          { retryable: true },
        ));
        return finishWithRetryDecision('failed', code, signal);
      }
      if (
        code === 0 &&
        !run.cancelRequested &&
        isPluginAuthoringRun(db, run, getSnapshot) &&
        !(await hasGeneratedPluginArtifacts(cwd)) &&
        !emittedRenderableQuestionForm(run.askUserScanText)
      ) {
        send('error', createSseErrorPayload(
          'AGENT_EXECUTION_FAILED',
          'Plugin authoring ended before generating the required generated-plugin artifacts.',
          { retryable: true },
        ));
        return finishWithRetryDecision('failed', code, signal);
      }
      const runArtifactSideEffects = runSideEffectsForRun(run);
      const status = classifyChatRunCloseStatus({
        cancelRequested: !!run.cancelRequested,
        code,
        signal,
        protocolCleanCompletion: protocolSession?.completedSuccessfully?.() === true,
        protocolCompletionShutdownRequested: protocolSession?.completionShutdownRequested?.() === true,
        artifactQuietShutdownRequested,
        turnCompletedCleanly: !!run.turnCompletedCleanly,
        artifactProducedThisRun:
          runArtifactSideEffects.artifactWriteSeen,
      });
      // Skip the close-handler failure emit when the run is already
      // terminal: the inactivity watchdog (failForInactivity) finishes the
      // run — sending its error and clearing run.clients/eventsLogStream —
      // before SIGTERM, so re-emitting here would double-send the error and
      // reopen the closed events-log stream. The run is finalized below
      // regardless (finish() no-ops once terminal).
      if (status === 'failed' && !design.runs.isTerminal(run.status)) {
        const diagnostic = diagnoseClaudeCliFailure({
          agentId: def.id,
          exitCode: code,
          signal,
          stderrTail: agentStderrTail,
          stdoutTail: agentStdoutTail,
          env: spawnedAgentEnv,
          resolvedBin: agentLaunch.selectedPath,
        });
        // A non-zero exit whose output reads as an auth / quota / upstream
        // problem (typical of Claude Code, codex, …) gets the specific code
        // rather than the generic execution-failed bucket; the human-readable
        // message still prefers the richer CLI diagnostic when we have one.
        const serviceCode = classifyAgentServiceFailure(
          `${agentStderrTail}\n${agentStdoutTail}`,
        );
        if (diagnostic) {
          send('error', createSseErrorPayload(
            // A diagnostic that named its own failure class (e.g.
            // AGENT_CONNECTION_DROPPED) wins over the generic service-failure
            // sniff so the UI can localize by code and triage can count it.
            diagnostic.code ?? serviceCode ?? 'AGENT_EXECUTION_FAILED',
            diagnostic.message,
            { retryable: diagnostic.retryable, details: { detail: diagnostic.detail } },
          ));
        } else if (serviceCode) {
          const detail = (agentStderrTail || agentStdoutTail || '').trim();
          send('error', createSseErrorPayload(
            serviceCode,
            detail || 'The model service returned an error.',
            { retryable: true },
          ));
        } else {
          // OpenCode swallows provider failures in headless mode: a 429
          // usage-limit is marked retryable and retried silently with
          // nothing on stdout/stderr, so the run only dies via the
          // inactivity watchdog and the checks above find no signal. The
          // real reason is recorded only in OpenCode's own session log,
          // so recover it before falling back to the generic rewrite.
          // See issue #982.
          const openCodeFailure =
            def.id === 'opencode'
              ? readOpenCodeServiceFailure(spawnedAgentEnv, { since: run.createdAt })
              : null;
          if (openCodeFailure) {
            send('error', createSseErrorPayload(
              openCodeFailure.code,
              openCodeFailure.message,
              { retryable: openCodeFailure.retryable },
            ));
          } else {
            const rewritten = rewriteKnownAgentStreamError(
              def.id,
              (agentStderrTail || agentStdoutTail || '').trim(),
              `${agentStderrTail}\n${agentStdoutTail}`,
            );
            if (rewritten !== 'Agent stream error') {
              send('error', createSseErrorPayload(
                  'AGENT_EXECUTION_FAILED',
                  rewritten,
                  { retryable: true },
                ));
            }
          }
        }
      }
      // Reconcile any HTML artifacts that were written during this run
      // without a manifest sidecar (e.g. agent used write_file instead of
      // create_artifact, or the run terminated between HTML write and
      // sidecar write). Only files modified after the run started are
      // touched — pre-existing HTML in imported-folder projects must not
      // receive spurious manifests. Best-effort; must not block finalisation.
      // See issue #2893.
      if (run.projectId) {
        (async () => {
          try {
            const project = getProject(db, run.projectId);
            const files = await listFiles(PROJECTS_DIR, run.projectId, {
              metadata: project?.metadata,
            });
            const dir = resolveProjectDir(PROJECTS_DIR, run.projectId, project?.metadata);
            for (const f of files) {
              const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
              if (ext !== '.html' && ext !== '.htm') continue;
              try {
                const filePath = path.join(dir, f.name);
                const st = await fs.promises.stat(filePath);
                if (!isRunTouchedProjectFile(st.mtimeMs, runStartTimeMs)) continue;
                await reconcileHtmlArtifactManifest(
                  PROJECTS_DIR,
                  run.projectId,
                  f.name,
                  project?.metadata,
                );
              } catch { /* per-file best-effort */ }
            }
          } catch { /* project-level best-effort */ }
        })();
      }
      if (status === 'succeeded') {
        let deliverableValid = false;
        let processTreeQuiescentForFinalization = true;
        // Every successful physical Run can produce a final Web deliverable,
        // even when retired Next-strategy Runtime State is absent. Resolve the settled
        // filesystem before deciding whether the host syntax gate applies.
        if (protocolAttemptTermination) {
          const termination = await protocolAttemptTermination;
          processTreeQuiescentForFinalization = termination?.quiescent === true;
        }
        await resolveRunArtifactOutcomeBeforeFinishAsync();
        const deliverableFinalization = await finalizeSuccessfulRunDeliverable({
          allowIndependentOutput: false,
          allowMultipleOutputCandidates: undefined === 'discovery',
          ...(run.artifactOutcome?.diff && baselineEntryFile ? { baselineEntryFile } : {}),
          projectsRoot: PROJECTS_DIR,
          projectId: run.projectId ?? null,
          projectMetadata: projectRecord?.metadata,
          artifactCount: Number.isFinite(run.artifactCount) ? run.artifactCount : 0,
          ...(Array.isArray(run.artifactPaths) ? { touchedPaths: run.artifactPaths } : {}),
          relatedPaths:
            run.artifactOutcome?.diff?.renderDependencyTouchedPaths ?? [],
          processTreeQuiescent: processTreeQuiescentForFinalization,
          syntaxFinalizerEnabled: deliverableSyntaxFinalizerEnabled(),
          ...(run.deliverableSyntaxRepair
            ? { repairState: run.deliverableSyntaxRepair }
            : {}),
          ...(run.deliverableSyntaxValidation?.metrics
            ? { previousMetrics: run.deliverableSyntaxValidation.metrics }
            : {}),
        });
        const { deliverable } = deliverableFinalization;
        // Adding a second page must not erase an unambiguous pre-run entry.
        // Retain only a verified baseline identity, without replacing a user's
        // explicit selection or metadata changed while this Run was executing.
        if (
          deliverable.valid && deliverable.linkedPage
          && deliverable.entryFile === baselineEntryFile
          && run.artifactOutcome?.diff && run.projectId && cwd
        ) {
          try {
            const current = getProject(db, run.projectId);
            if (
              current?.metadata?.kind === 'prototype'
              && !current.metadata.entryFile
              && resolveProjectDir(PROJECTS_DIR, current.id, current.metadata) === cwd
            ) {
              updateProject(db, current.id, {
                metadata: { ...current.metadata, entryFile: deliverable.entryFile },
                updatedAt: SYNC_KEEPS_UPDATED_AT,
              });
            }
          } catch {
            console.warn('[deliverable] could not retain verified prototype entry');
          }
        }
        // Host-owned syntax finalization is based on physical delivery, not on
        // The retired Next-strategy identity. It never resumes or prompts the Agent.
        if (deliverableFinalization.syntax.action !== 'skip') {
          const syntaxFinalization = deliverableFinalization.syntax;
          run.deliverableSyntaxValidation = syntaxFinalization.validation;
          if (syntaxFinalization.validation.repairState) {
            run.deliverableSyntaxRepair = syntaxFinalization.validation.repairState;
          }
          design.runs.persistState(run);
          {
            design.runs.emit(run, 'diagnostic', {
              type: 'deliverable_syntax_validation',
              source: 'run_finalizer',
              status: syntaxFinalization.validation.status,
              checker: 'checker' in syntaxFinalization.validation ? syntaxFinalization.validation.checker : null,
              candidateHash:
                'candidateHash' in syntaxFinalization.validation ? syntaxFinalization.validation.candidateHash : null,
              checkedFileCount:
                'checkedFiles' in syntaxFinalization.validation ? syntaxFinalization.validation.checkedFiles.length : 0,
              checkCount:
                syntaxFinalization.validation.metrics?.checkCount ?? null,
              checkerDurationMs:
                syntaxFinalization.validation.metrics?.checkerDurationMs ?? null,
              repairableCheckCount:
                syntaxFinalization.validation.metrics?.repairableCheckCount ?? null,
              repairExecutor:
                syntaxFinalization.validation.metrics?.repairExecutor ?? null,
              repairDurationMs:
                syntaxFinalization.validation.metrics?.repairDurationMs ?? null,
              appliedRepairRules:
                syntaxFinalization.validation.metrics?.appliedRepairRules ?? [],
              finalization: syntaxFinalization.validation.finalization,
              safeFixProposalCount: syntaxFinalization.validation.metrics?.safeFixProposalCount ?? null,
              safeFixProposalDurationMs: syntaxFinalization.validation.metrics?.safeFixProposalDurationMs ?? null,
            });
          }
          // A syntax warning is durable quality evidence, not an execution
          // failure. Continue the normal artifact/ref/version delivery path.
        }
        // Capture after best-effort syntax repair: verified committed bytes on
        // success, or the retained original on refusal. Snapshotting denotes
        // delivery, not syntax correctness; the Run keeps the warning evidence.
        // Freeze the delivered bytes before linking the HTML version below;
        // cover rendering remains asynchronous and does not delay the Run.
        await captureChatArtifactsBeforeSuccess();
        try {
          await snapshotAiHtmlVersionsBeforeSuccess();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const details = err instanceof AiHtmlVersionSnapshotError
            ? { failures: err.failures }
            : undefined;
          send('error', createSseErrorPayload(
            'HTML_VERSION_SNAPSHOT_FAILED',
            message,
            {
              retryable: false,
              ...(details ? { details } : {}),
            },
          ));
          finishStrategyAwarePhysicalRun('failed', 1, signal);
          return;
        }
        try {
          persistDeliveredAgentSessionState();
        } catch (err) {
          console.warn('[sessions] delivered session persistence failed', err);
        }
      }
      const retried = finishWithRetryDecision(status, code, signal);
      } finally {
        // Superseded attempts and early/error exits also release their own
        // receipt. The cleanup owner separately fences the shutdown deadline.
        completeCodexEvidenceCollection();
        cleanupExtensionPlan();
      }
    });
    if (promptDeliveredAtSpawn) {
      // The complete plain-text prompt became the child's stdin at spawn
      // (runtimes/agent-process.ts), so there is nothing left to write. A
      // spawn that failed (no PID) never received it.
      if (typeof child.pid === 'number') { recordPromptDeliveredAtSpawn(run, lifecycle); }
    } else if (writePromptToChildStdin && child.stdin) {
      const promptInputFormat = def.promptInputFormat ?? 'text';
      lifecycle.mark('model_call_start');
      lifecycle.mark('stdin_write_start');
      const markStdinWriteEnd = (err?: Error | null) => {
        if (err) return;
        lifecycle.mark('stdin_write_end');
      };
      // Plain-text prompts never get here: they are delivered at spawn.
      // stream-json is the one prompt still pumped through a live pipe; a
      // frame cut short by a dying daemon does not parse, so the child can
      // never act on a partial prompt.
      if (promptInputFormat === 'stream-json') {
        // Wrap the prompt as an Anthropic user message and write it as one
        // JSONL line. Do NOT close stdin: claude-code keeps reading further
        // messages until EOF, which is what lets the daemon stream more user
        // messages into the same turn. The stdin is closed on a clean terminal
        // turn (see applyClaudeStreamJsonRunBookkeeping) or when the child
        // exits (run terminates, user cancels).
        //
        // Shared encoder with B11 steering (`run-steering.ts`): a mid-turn
        // frame the model does not recognise fails invisibly, so the opening
        // prompt and the steering write must never drift apart.
        const userMessage = encodeStreamJsonUserMessage(composed);
        try {
          // E-lite: `write` returns false when the chunk was buffered because the
          // OS pipe is full (the child isn't draining stdin) — the corroborating
          // signal for a `stdin_write`-phase inactivity stall.
          const accepted = child.stdin.write(userMessage, 'utf8', markStdinWriteEnd);
          run.stdinBackpressure = accepted === false;
        } catch (err) {
          // Swallow EPIPE here for the same reason as the listener above —
          // a fast-exiting child has already routed its failure through
          // stderr / exit handlers.
          if (err && err.code !== 'EPIPE') throw err;
        }
        run.stdinOpen = true;
      }
    }
  };


  registerRecipeRoutes(app, { db, http: httpDeps, paths: { ...pathDeps, BUNDLED_PLUGINS_DIR }, authorizeProjectRequest, authorizeProjectToolRequest, mediaTasks: mediaTaskStore, resources: { listAllSkills },
    artBudget: { ledger: artBudgetLedger, openpixoHosted: openPixoHosted, hasSession: () => openPixoAccount.hasSession() } });

  registerRunRoutes(app, {
    db,
    design,
    resources: { listAllSkillLikeEntries },
    http: httpDeps,
    paths: { BUNDLED_PLUGINS_DIR, PROJECTS_DIR, RUNTIME_DATA_DIR },
    agents: { detectAgents, getAgentDef },
    chat: { startChatRun },
    lifecycle: { isDaemonShuttingDown: () => daemonShuttingDown },
    plugins: {
      detectSkillPluginCandidateOnRunSuccess,
      loadPluginRegistryView,
      renderPluginBriefTemplate,
      getLocalPluginBySource: (id, source) => getLocalPluginBySource(db, id, source),
      authorizePluginRequest: async (req, res, pluginId) => {
        const plugin = getInstalledPlugin(db, pluginId);
        if (!plugin) {
          sendApiError(res, 404, 'PLUGIN_NOT_FOUND', 'plugin not found');
          return false;
        }
        return true;
      },
    },
    telemetry: {
      resolveRunProjectKindForAnalytics,
      runArtifactBaselines,
      runRetryEventsForAnalytics,
    },
    messages: {
      pinAssistantMessageOnRunCreate,
      reconcileAssistantMessageOnRunEnd,
    },
    internalRuns: internalRunCreation,
    projectStore: {


    },

    authorizeProjectRequest,
  });

  assertServerContextSatisfiesRoutes({
    db,
    design,
    http: httpDeps,
    paths: pathDeps,
    ids: idDeps,
    uploads: uploadDeps,
    node: nodeDeps,
    projectStore: projectStoreDeps,
    authorizeProjectRequest,
    authorizeProjectToolRequest,
    isApiTokenAuthorization,
    projectFiles: projectFileDeps,
    conversations: conversationDeps,
    templates: templateDeps,
    status: projectStatusDeps,
    events: projectEventDeps,
    imports: importDeps,
    exports: projectExportDeps,
    artifacts: artifactDeps,
    documents: { buildDocumentPreview },
    auth: authDeps,
    media: mediaDeps,
    appConfig: appConfigDeps,

    nativeDialogs: nativeDialogDeps,
    research: researchDeps,
    mcp: { pendingAuth: mcpPendingAuth, daemonUrlRef },
    plugins: {
      detectSkillPluginCandidateOnRunSuccess,
      loadPluginRegistryView,
      renderPluginBriefTemplate,
    },
    resources: {
      listAllSkills,
      listAllTemplates,
      listAllSkillLikeEntries,
      mimeFor,
    },
    projectPreviewScopes,
    validation: validationDeps,
    chat: { startChatRun },
    messages: {
      pinAssistantMessageOnRunCreate,
      reconcileAssistantMessageOnRunEnd,
    },
    agents: agentDeps,
    lifecycle: { isDaemonShuttingDown: () => daemonShuttingDown },
  });

  // proxy routes (anthropic / openai / azure / google / ollama) live
  // in chat-routes.ts now — garnet had a partial duplicate here that
  // referenced helpers (rejectPluginInProxyBody, extractGeminiText, …)
  // dropped during the reconcile merge. Deleted to fix the BYOK crash.
  // Restore the plugin-runs-must-go-through-daemon gate by adding it
  // to chat-routes.ts if needed.

  registerChatRoutes(app, {
    db,
    design,
    http: httpDeps,
    authorizeProjectRequest,
    paths: pathDeps,
    chat: { startChatRun },
    agents: agentDeps,
    appConfig: { readAppConfig },
    validation: validationDeps,
    lifecycle: { isDaemonShuttingDown: () => daemonShuttingDown },
    telemetry: { },
  });

  registerStaticSpaFallback(app, staticDir);

  // Wait for `listen` to bind so callers always see the resolved URL —
  // critical when port=0 (ephemeral port) and when the embedding sidecar
  // needs to advertise the port to a parent process before any request
  // can flow. Three callers depend on this contract:
  //   - `apps/daemon/src/cli.ts`            → expects `{ url, server, shutdown }`
  //   - `apps/daemon/sidecar/server.ts`     → expects `{ url, server }`
  //   - `apps/daemon/tests/version-route.test.ts` → expects `{ url, server }`
  return await new Promise((resolve, reject) => {
    let daemonShutdownPromise: Promise<void> | null = null;
    // One-time heal of run events stored before the payload budget existed
    // (storage/message-event-payload-heal.ts). Started once the daemon is
    // listening, never on a request path; stopped with the other background
    // work below.
    let messageEventPayloadHeal: MessageEventPayloadHealHandle | null = null;
    const cleanupDaemonBackgroundWork = () => {
      openPixoHosted.close();
      openPixoAccount.close();
      daemonHealth?.markCleanShutdown();
      daemonHealth?.stop();
      void messageEventPayloadHeal?.stop();
      telemetry.disposeFatalHandlers();
      // Disarms synchronously; the returned promise drains an in-flight pass.
      // Nothing here awaits it — the point is that no NEW pass can start once
      // the daemon is coming down.
      void chatArtifactMaintenance.stop();
    };
    const shutdownDaemonRuns = (): Promise<void> => {
      if (daemonShutdownPromise) return daemonShutdownPromise;
      daemonShutdownPromise = (async () => {
        daemonShuttingDown = true;
        await stopGameRuns();
        await publishService.dispose();
        localRoomsRelay.stop();
        onlineEmulator.dispose();
        await projectAssetRoutes.close();
        const shutdownGraceMs = resolveChatRunShutdownGraceMs();
        await design.runs.shutdownActive({ graceMs: shutdownGraceMs });
        // Cleanup runs independently of user terminal classification. Give
        // confirmed closed writers at most three additional seconds at shutdown.
        const cleanupDrain = await codexThreadCleanupOwner.drain(shutdownGraceMs);
        if (cleanupDrain.pending > 0) {
          console.warn('[codex] closed-thread cleanup shutdown deadline reached', cleanupDrain);
        }
        await terminalService.shutdownActive();
        await design.analytics.shutdown();
      })();
      return daemonShutdownPromise;
    };
    let server;
    try {
      server = app.listen(port, host);
      server.once('listening', () => {
        // Widen the between-request idle window so kept-alive sockets
        // belonging to chat/SSE clients survive the gaps between bursts.
        //
        // Node's `keepAliveTimeout` (default 5s) only arms *after* a
        // response finishes writing, bounding the idle gap before the next
        // request on the same socket — it does not fire while an SSE
        // response is still streaming. A streaming `/api/runs/:id/events`
        // response stays open until the agent finishes, so middlebox idle
        // timers (nginx, socat/docker bridges, EC2 SG NAT) are typically
        // the proximate cause when an SSE stream drops; this listener-
        // side change cannot extend a connection past those middleboxes.
        //
        // What it *does* fix: chat clients that pipeline multiple requests
        // on the same TCP socket (status polls, run-status fetches, the
        // initial GET before the SSE upgrade). With the default 5s window
        // a sluggish client can lose the connection between two normal
        // calls and reconnect-storm. 120s aligns with the in-band
        // SSE_KEEPALIVE_INTERVAL_MS (25s) so kept-alive sockets used
        // around an SSE stream stay warm across reasonable client pauses.
        //
        // `headersTimeout` must exceed `keepAliveTimeout` per the Node
        // docs; otherwise a slow-loris client can stall request parsing.
        server.keepAliveTimeout = 120_000;
        server.headersTimeout = 125_000;
        const address = server.address();
        // `address()` can in theory return `string | AddressInfo | null`. For
        // a TCP listener it's always `AddressInfo` with a `.port` — the guard
        // is belt-and-braces so an unexpected null never silently produces a
        // `http://127.0.0.1:0` URL that callers would then try to fetch.
        const boundPort =
          address && typeof address === 'object' ? address.port : null;
        if (!boundPort) {
          reject(
            new Error(
              `[pixo] daemon failed to resolve listening port (address=${JSON.stringify(address)})`,
            ),
          );
          return;
        }
        resolvedPort = boundPort;

        messageEventPayloadHeal ??= startMessageEventPayloadHeal({ db });
        // Only once listening: a startup-time fatal report would add lines to
        // the log tail that packaged startup telemetry samples.
        daemonHealth?.enableFatalReports();
        daemonHealth?.setAppVersion(currentAppVersion());
        daemonHealth?.attachSink(({ eventName, properties, insertId }) =>
          analyticsService.captureSafety({
            eventName,
            appVersion: currentAppVersion(),
            properties,
            insertId,
          }));
        // When binding to all interfaces report localhost for local callers;
        // when binding to a specific address (e.g. a Tailscale IP) report that
        // address so remote callers and the sidecar use the correct URL.
        const reportHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
        const url = `http://${reportHost}:${resolvedPort}`;
        if (!returnServer) {
          console.log(`[pixo] daemon listening on ${url}`);
        }
        daemonUrl = url;
        resolve(returnServer ? {
          url,
          server,
          shutdown: shutdownDaemonRuns,
          routeInventory: getRouteRegistrationInventory(app),
        } : url);
      });
    } catch (error) {
      cleanupDaemonBackgroundWork();
      reject(error);
      return;
    }
    server.once('close', () => {
      void shutdownDaemonRuns().finally(cleanupDaemonBackgroundWork);
    });
    // `app.listen` throws synchronously when the port is already in use on
    // some Node versions, but emits an `error` event on others (and for
    // EACCES / EADDRNOTAVAIL even on the same Node). Wire the event so the
    // returned Promise always settles instead of hanging forever.
    server.on('error', (error) => {
      cleanupDaemonBackgroundWork();
      reject(error);
    });
  });
}

function randomId() {
  return randomUUID();
}

function sanitizeSlug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
