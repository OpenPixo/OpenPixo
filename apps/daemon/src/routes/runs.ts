import { enforceLocalProjectDataPlaneRequest } from '../projects/project-access.js';
import type { Express, Request, Response } from 'express';
import { registerRunApprovalRoutes } from './codex-approvals.js';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  defaultScenarioPluginIdForProjectMetadata,
  InstalledPluginRecordSchema,
  RUN_RESULT_PACKAGE_SCHEMA,
  nativeCodexProviderForConfig,
  resolveConversationAgentId,
  type AppliedPluginSnapshot,
  type ArtifactManifest,
  type ByokChatProviderConfig,
  type ChatRunStatus,
  type ChatRunStatusResponse,
  type InstalledPluginRecord,
  type ProjectMetadata as ContractProjectMetadata,
  type RunResultPackageResponse,
} from '@openpixo/contracts';
import {
  buildRunCreatedV4Aliases,
  buildRunFinishedV4Aliases,
  deriveConfigureGlobals,
  modelIdForTracking,
  sessionModeToTracking,
  type RunTaskLineageProps,
  type TrackingRunRecoveryActionType,
} from '@openpixo/contracts/analytics';
import type { PixoNativeEvent } from '@openpixo/agui-adapter';
import { newInsertId, readAnalyticsContext } from '../analytics.js';
import type { AnalyticsContext } from '../analytics.js';
import { spawnEnvForAgent } from '../agents.js';
import { agentCliEnvForAgent, readAppConfig } from '../app-config.js';
import type { AuthorizeProjectRequest } from '../projects/project-access.js';
import { validateLocalDaemonRequest } from '../http/local-daemon-request.js';

import {
  codexSessionIdFromRunEvents,
  readCodexRolloutFirstCall,
} from '../codex-rollout-usage.js';
import {
  conversationTurnIndexForRun,
  getFirstProjectConversation,
  getConversation,
  getProject,
  listProjectsAwaitingInput,
  normalizeConversationSessionMode,
  updateProject,
  upsertMessage,
} from '../db.js';
import {
  ensureDetectedRuntimeVersions,
  getDetectedRuntimeVersions,
} from '../runtimes/detection.js';
import { mintRunDoneKey } from '../runtimes/run-done-key.js';
import { parseMediaExecutionPolicyInput } from '../media/policy.js';
import { isManagedProjectCwd } from '../mcp-config.js';
import {
  normalizeExternalPluginRunAnalyticsHints,
  OPENPIXO_PLUGIN_ID,
  resolvePluginGenerationSloWindowMs,
  validatePluginWorkflowId,
} from '../mcp-observability.js';
import {
  createInternalRunCreationService,
  type InternalRunCreateInput,
  type InternalRunCreationService,
} from '../services/internal-run-service.js';

import type { SkillInfo } from '../skills.js';
import { automaticScenarioTaskProfile, getInstalledPlugin, readVerifiedProjectScenarioBinding, resolvePluginFolder, resolvePluginSnapshot, type ResolveSnapshotResult } from '../plugins/index.js';
import { getSnapshot, linkSnapshotToRun } from '../plugins/snapshots.js';
import {
  digestExampleSkillManifest,
  readVerifiedProjectExampleBinding,
} from '../plugins/example-binding.js';
import {
  assertSandboxProjectRootAvailable,
  isSafeId,
  listFiles,
  resolveProjectDir,
  SandboxImportedProjectError,
} from '../projects.js';
import {
  agentProviderIdForRunAnalytics,
  hasExplicitRequestedModelForAnalytics,
  runtimeTypeForRunAnalytics,
  scanRunEventsForUsageAnalytics,
  summarizeRunTimingAnalytics,
  summarizeToolAnalytics,
  type RunEventForAnalyticsObservability,
  type RunTelemetryTimestamps,
} from '../run-analytics-observability.js';
import {
  diffRunArtifacts,
  primaryArtifactChangeForRun,
  snapshotProjectArtifacts,
  supportingAssetFilesChangedForRun,
  type RunArtifactDiff,
  type RunArtifactBaseline,
} from '../run-artifact-fs.js';
import {
  projectDeliverableValidation,
  validateRunDeliverable,
  type RunDeliverableValidationResult,
} from '../run-deliverable-validation.js';
import type { RunEventForDiagnostics } from '../run-diagnostics.js';
import { summarizeRunDiagnosticsForAnalytics } from '../run-diagnostics.js';
import type { RunEventForFailureClassification } from '../run-failure-classification.js';
import { classifyRunFailure } from '../run-failure-classification.js';
import { deriveRunErrorCode, runResultFromStatus } from '../run-result.js';
import type { RunStatusForAnalytics } from '../run-result.js';
import {
  parseRunToolBundleForRequest,
  validateRunToolBundleForAgent,
} from '../run-tool-bundle.js';
import type { DetectedAgent, RuntimeAgentDef } from '../runtimes/types.js';
import {
  buildOpenCodeByokProviderConfig,
  BYOK_OPENCODE_AGENT_ID,
  BYOK_OPENCODE_PROVIDER_REQUIRED_MESSAGE,
} from '../runtimes/byok-opencode.js';
import { resolveChatRunInactivityTimeoutMs } from '../runtimes/chat-run-lifecycle.js';
import {
  runtimeAcceptsMidTurnInput,
  type RunSteeringRefusal,
} from '../runtimes/run-steering.js';
import { runMessageEventPersistenceAnalytics } from '../runtimes/chat-run-messages.js';
import {
  isLegacyHydratedRunWithoutAppliedSnapshot,
  TERMINAL_RUN_STATUSES,
} from '../runtimes/runs.js';
import {
  deriveActivationMilestones,
  runAskedUserQuestion,
} from '../runtimes/run-artifacts.js';
import {
  runArtifactCountForRun,
  runIntentDocumentWritten,
  runFilesWrittenForRun,
  runPreviewModuleCountForRun,
} from '../runtimes/run-lifecycle-analytics.js';
import {
  UPLOAD_DIR,
} from '../runtimes/chat-prompt-inputs.js';
import { createRunAnalyticsLifecycle } from '../services/run-analytics-lifecycle.js';
import {
  runTouchedArtifactPaths,
  validateChatProjectDeliverable,
  toJsonRecord,
  toProjectRecord,
  validateChatRunDeliverable,
  type ChatRun,
  type JsonRecord,
  type RunArtifactBaselines,
  type RunCreatedFallbackInput,
  type RunProjectKindInput,
  type RunRetryAnalyticsEvent,
  type ProjectMetadata,
  type ProjectRecord,
  type RunEventRecord,
  type SseClient,
} from '../runtimes/chat-run-records.js';

// Keep in sync with the web uploader's `looksLikeImage` (apps/web registry):
// omit-pin seeds must classify the same extensions as `image` so reload chips
// match the original staged attachment kind.
const SEEDED_USER_IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.svg',
  '.bmp',
]);

type SqliteDb = Database.Database;
type ApiRequest = Request<Record<string, string>, unknown, JsonRecord>;
type ApiResponse = Response<unknown>;
type AgentCliEnv = Parameters<typeof agentCliEnvForAgent>[0];
type RunDeliveryTarget = 'managed-project' | 'external-project' | 'none';

/**
 * Map ChatRunCreateRequest attachment fields onto the ChatMessage shape used by
 * upsertMessage / listMessages. Request `attachments` are project-relative
 * path strings; persisted messages store `{ path, name, kind, order }` so the
 * UI can reload chips and annotation context after a headless omit-pin seed.
 */
function seededAttachmentSize(projectRoot: string | null | undefined, attachmentPath: string): number | undefined {
  if (!projectRoot) return undefined;
  try {
    const absolute = path.resolve(projectRoot, attachmentPath);
    const relative = path.relative(path.resolve(projectRoot), absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    const stat = fs.statSync(absolute);
    return stat.isFile() ? stat.size : undefined;
  } catch {
    return undefined;
  }
}

function seededUserMessageAttachmentFields(meta: JsonRecord, projectRoot?: string | null): {
  attachments?: Array<{ path: string; name: string; kind: 'image' | 'file'; order: number }>;
} {
  const attachments = Array.isArray(meta.attachments)
    ? meta.attachments
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((attachmentPath, index) => {
          const name = path.basename(attachmentPath) || attachmentPath;
          const ext = path.extname(name).toLowerCase();
          const size = seededAttachmentSize(projectRoot, attachmentPath);
          return {
            path: attachmentPath,
            name,
            kind: SEEDED_USER_IMAGE_EXTS.has(ext) ? ('image' as const) : ('file' as const),
            ...(size === undefined ? {} : { size }),
            order: index,
          };
        })
    : [];
  return {
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

/**
 * Map request/run turn metadata onto the ChatMessage fields the web client
 * writes via PUT /messages. ChatPane and ProjectView retry both re-read
 * sessionMode / runContext / appliedPluginSnapshot from the user message after
 * reload, so omit-pin seeds must persist the same columns.
 */
function seededUserMessageTurnMetadataFields(
  meta: JsonRecord,
  appliedPluginSnapshot?: AppliedPluginSnapshot | null,
): {
  sessionMode?: string;
  runContext?: Record<string, unknown>;
  appliedPluginSnapshot?: AppliedPluginSnapshot;
} {
  const runContext =
    meta.context && typeof meta.context === 'object' && !Array.isArray(meta.context)
      ? (meta.context as Record<string, unknown>)
      : undefined;
  return {
    ...(typeof meta.sessionMode === 'string' && meta.sessionMode
      ? { sessionMode: meta.sessionMode }
      : {}),
    ...(runContext ? { runContext } : {}),
    ...(appliedPluginSnapshot ? { appliedPluginSnapshot } : {}),
  };
}

interface RunCreateMeta extends InternalRunCreateInput, JsonRecord {
  projectId?: string;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  clientRequestId?: string;
  requestFingerprint?: string;
  agentId?: string;
  pluginId?: string;
  appliedPluginSnapshotId?: string;
  message?: string;
  currentPrompt?: string;
  projectMetadata?: ProjectMetadata;

}

interface RunListFilters {
  projectId?: unknown;
  conversationId?: unknown;
  status?: unknown;
}

interface ChatRunService {
  create(meta: RunCreateMeta): ChatRun;
  createOrReuse(meta: RunCreateMeta):
    | { kind: 'created'; run: ChatRun }
    | { kind: 'reused'; run: ChatRun }
    | { kind: 'conflict'; run: ChatRun };
  prepareRestart(run: ChatRun): ChatRun | null;
  get(id: string): ChatRun | null;
  findByPluginWorkflowId(pluginWorkflowId: string): ChatRun | null;
  list(filters: RunListFilters): ChatRun[];
  statusBody(run: ChatRun): ChatRunStatusResponse;
  stream(run: ChatRun, req: Request, res: Response): void;
  start(run: ChatRun, starter: () => Promise<unknown>): ChatRun;
  fail(run: ChatRun, code: string, message: string): void;
  wait(run: ChatRun): Promise<ChatRunStatusResponse>;
  cancel(
    run: ChatRun,
    origin?: NonNullable<ChatRunStatusResponse['cancelOrigin']>,
  ): Promise<ChatRunStatusResponse>;
  /**
   * B11 「引导对话」: deliver one more user message into the turn that is still
   * running. `runtimeAccepts` is the caller's `runtimeAcceptsMidTurnInput`
   * verdict for the run's agent def — the runs service owns no agent registry.
   */
  steer(
    run: ChatRun,
    text: string,
    runtimeAccepts: boolean,
  ):
    | { ok: true; backpressure: boolean }
    | { ok: false; refusal: RunSteeringRefusal };
  /** Undo an optimistically-created run (e.g. a failed ownership claim). */
  drop(run: ChatRun): void;
  /** Persist daemon-owned state assigned during an atomic claim hook. */
  persistState(run: ChatRun): void;
  isTerminal(status: ChatRunStatus): boolean;
  emit?(run: ChatRun, event: string, data: unknown): RunEventRecord;
  setAnalyticsRecovery?(run: ChatRun, recovery: {
    context: AnalyticsContext;
    properties: Record<string, unknown>;
    insertId: string;
  }): void;
  markAnalyticsCompleted?(run: ChatRun): void;
  setDeliverableValidation?(
    run: ChatRun,
    result: RunDeliverableValidationResult,
  ): void;
}

interface AnalyticsService {
  capture(input: {
    eventName: string;
    context: AnalyticsContext;
    appVersion: string;
    properties: Record<string, unknown>;
    insertId: string;
  }): void | Promise<void>;
}

interface RunRoutesDesignService {
  runs: ChatRunService;
  analytics: AnalyticsService;
  getAppVersion(): string;
}

/**
 * The Skill catalogue a run resolves user-selected Skills from. Same listing
 * the system-prompt composer reads, scoped through
 * `resolveSkillCatalogScope`, so a Skill admitted on one surface is
 * resolvable on the other.
 */
interface RunRoutesSkillCatalogService {
  listAllSkillLikeEntries: () => Promise<readonly SkillInfo[]>;
}

interface ProjectFileEntry {
  name: string;
  artifactKind?: string | null;
  artifactManifest?: ArtifactManifest | JsonRecord | null;
}

interface SseResponse {
  send(event: string, data: unknown, id?: number): void;
  end(): void;
  cleanup?(): void;
}

type SuccessfulRunSnapshotResolution = Omit<
  Extract<ResolveSnapshotResult, { ok: true }>,
  'created'
> & {
  created?: boolean;
  status?: number;
};

export interface RegisterRunRoutesDeps {
  db: SqliteDb;
  design: RunRoutesDesignService;
  resources: RunRoutesSkillCatalogService;
  http: {
    createSseResponse: (res: Response) => SseResponse;
    sendApiError: (
      res: Response,
      status: number,
      code: string,
      message: string,
      details?: Record<string, unknown>,
    ) => Response<unknown> | void;
  };
  paths: {
    BUNDLED_PLUGINS_DIR?: string;
    PROJECTS_DIR: string;
    RUNTIME_DATA_DIR: string;
  };
  agents: {
    detectAgents: (agentCliEnv?: Record<string, unknown>) => Promise<DetectedAgent[]>;
    getAgentDef: (agentId: string) => RuntimeAgentDef | null | undefined;
  };
  chat: {
    startChatRun: (meta: RunCreateMeta, run: ChatRun) => Promise<unknown>;
  };
  lifecycle: {
    isDaemonShuttingDown: () => boolean;
  };
  plugins: {
    detectSkillPluginCandidateOnRunSuccess: (
      db: SqliteDb,
      runs: ChatRunService,
      run: ChatRun,
      input: JsonRecord,
      projectRoot: string,
    ) => void;
    loadPluginRegistryView: () => Promise<Parameters<typeof resolvePluginSnapshot>[0]['registry']>;
    renderPluginBriefTemplate: (template: string, inputs?: Record<string, unknown>) => string;
    /**
     * Exact local catalogue lookup, the same one `/api/plugins/:id/apply-local`
     * and project create use. Run start re-resolves a project's example
     * binding through it instead of trusting the stored path.
     */
    getLocalPluginBySource?: (
      id: string,
      source: string,
    ) => Promise<InstalledPluginRecord | null>;
    /**
     * Fail-closed request-scoped plugin lookup. The catalog API and the run
     * API must use the same Workspace/member visibility rules; otherwise a
     * caller can bypass a hidden Personal plugin by posting its id directly
     * to /api/runs.
     */
    authorizePluginRequest?: (
      req: ApiRequest,
      res: ApiResponse,
      pluginId: string,
    ) => Promise<boolean>;
  };
  telemetry: {
    resolveRunProjectKindForAnalytics: (input: RunProjectKindInput) => string | null;
    runArtifactBaselines: RunArtifactBaselines;
    runRetryEventsForAnalytics: (events: RunEventRecord[]) => RunRetryAnalyticsEvent[];
  };
  messages: {
    pinAssistantMessageOnRunCreate: (
      db: SqliteDb,
      run: ChatRun,
      opts?: {
        status?: string;
        beforeFreshInsert?: () => void;
        beforeClaimCommit?: () => void;
        isRunActive?: (runId: string) => boolean;
      },
    ) => { ok: boolean; reason?: 'active' | 'scope' };
    reconcileAssistantMessageOnRunEnd: (
      db: SqliteDb,
      runs: ChatRunService,
      run: ChatRun,
    ) => void;
  };
  /**
   * Process-owned physical Run seam. The composition root supplies one shared
   * instance so non-HTTP coordinators can reuse the exact create/claim/start
   * path. Route-only fixtures may omit it and receive an equivalent local
   * instance around their injected run registry.
   */
  internalRuns?: InternalRunCreationService<RunCreateMeta, ChatRun>;
  /** Fresh exact authority for run reads/cancel after resolving run.projectId. */
  authorizeProjectRequest?: AuthorizeProjectRequest;
}

const AGUI_NATIVE_EVENT_KINDS: ReadonlySet<PixoNativeEvent['kind']> = new Set([
  'message_chunk',
  'tool_call',
  'state_update',
  'end',
  'run_started',
  'pipeline_stage_started',
  'pipeline_stage_completed',
]);

function toProjectFiles(value: unknown): ProjectFileEntry[] {
  return Array.isArray(value)
    ? value.filter((item): item is ProjectFileEntry =>
        Boolean(item && typeof item === 'object' && typeof (item as JsonRecord).name === 'string'),
      )
    : [];
}

// Intents the scenario-plugin fallback resolver is allowed to see. Mirrors the
// `ProjectMetadata['intent']` contract union so an unknown/legacy string in a
// stored project row never gets cast into the union.
const SCENARIO_PROJECT_INTENTS: Record<NonNullable<ContractProjectMetadata['intent']>, true> = {
  'live-artifact': true,
  'web-clone': true,
  document: true,
  'webgl-experience': true,
  'worker-visualizer': true,
  marketing: true,
  hyperframes: true,
  'motion-design': true,
};

function toScenarioProjectIntent(value: unknown): ContractProjectMetadata['intent'] | undefined {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCENARIO_PROJECT_INTENTS, value)
    ? value as NonNullable<ContractProjectMetadata['intent']>
    : undefined;
}

function toScenarioProjectMetadata(
  metadata: ProjectMetadata,
): Pick<ContractProjectMetadata, 'kind' | 'intent'> | null {
  if (!metadata || typeof metadata.kind !== 'string') return null;
  const intent = toScenarioProjectIntent(metadata.intent);
  return {
    kind: metadata.kind as ContractProjectMetadata['kind'],
    ...(intent ? { intent } : {}),
  };
}

function routeParamId(req: ApiRequest): string | null {
  return typeof req.params.id === 'string' && req.params.id.length > 0
    ? req.params.id
    : null;
}

function withoutSensitiveRunInput(body: JsonRecord): JsonRecord {
  const sanitized = { ...body };
  delete sanitized.byokProvider;
  delete sanitized.byokProfileId;
  delete sanitized.apiKey;
  delete sanitized.rechargeResumeCapability;
  // Workspace scope is a server-issued authorization fact, not a request option.
  delete sanitized.workspaceScope;
  return sanitized;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJsonValue(nested)]),
    );
  }
  return value;
}

function semanticPluginSnapshot(
  snapshot: AppliedPluginSnapshot | null | undefined,
): Record<string, unknown> | null {
  if (!snapshot) return null;
  const {
    snapshotId: _snapshotId,
    appliedAt: _appliedAt,
    status: _status,
    ...semantic
  } = snapshot;
  return semantic;
}

function runRequestFingerprint(
  meta: RunCreateMeta,
  appliedPluginSnapshot?: AppliedPluginSnapshot | null,
): string {
  // Fingerprint the complete execution-shaping request, not a hand-picked
  // subset that silently aliases system prompts, attachments, context,
  // research or media defaults. Exclude only transport/recovery metadata,
  // analytics-only source hints and derived mutable rows. A freshly-created
  // snapshot id is deliberately excluded; its immutable semantic content is
  // included instead so a lost-response retry neither conflicts spuriously
  // nor ignores a real plugin upgrade.
  const logicalRequest = { ...meta } as JsonRecord;
  delete logicalRequest.clientRequestId;
  delete logicalRequest.requestFingerprint;
  delete logicalRequest.resume;
  delete logicalRequest.analyticsHints;
  delete logicalRequest.userMessageId;
  delete logicalRequest.assistantMessageId;
  delete logicalRequest.projectMetadata;
  delete logicalRequest.appliedPluginSnapshotId;
  logicalRequest.appliedPluginSnapshot =
    semanticPluginSnapshot(appliedPluginSnapshot);
  return createHash('sha256')
    .update(JSON.stringify(canonicalJsonValue(logicalRequest)))
    .digest('hex');
}

const EXTERNAL_PLUGIN_ANALYTICS_KEYS = [
  'entrySurface',
  'hostProduct',
  'externalPluginId',
  'externalPluginVersion',
  'distributionMechanism',
  'publisherClass',
  'attributionQuality',
  'pluginWorkflowId',
  'logicalRequestDigest',
  'logicalRequestDigestVersion',
] as const;

function externalPluginAttributionMismatch(
  existing: Record<string, unknown> | null | undefined,
  incoming: unknown,
): boolean {
  const next =
    incoming && typeof incoming === 'object' && !Array.isArray(incoming)
      ? (incoming as Record<string, unknown>)
      : null;
  const existingIsPlugin =
    existing?.externalPluginId === OPENPIXO_PLUGIN_ID;
  const nextIsPlugin = next?.externalPluginId === OPENPIXO_PLUGIN_ID;
  if (!existingIsPlugin && !nextIsPlugin) return false;
  if (!existingIsPlugin || !nextIsPlugin) return true;
  return EXTERNAL_PLUGIN_ANALYTICS_KEYS.some(
    (key) => existing[key] !== next[key],
  );
}

function hasCompleteByokOpenCodeConfig(meta: JsonRecord): boolean {
  if (meta.agentId !== BYOK_OPENCODE_AGENT_ID) return true;
  return buildOpenCodeByokProviderConfig(
    meta.byokProvider as ByokChatProviderConfig | null | undefined,
    typeof meta.model === 'string' ? meta.model : null,
  ) !== null;
}

function toPixoNativeEvent(record: RunEventRecord): PixoNativeEvent | null {
  if (!AGUI_NATIVE_EVENT_KINDS.has(record.event as PixoNativeEvent['kind'])) return null;
  return { kind: record.event, ...toJsonRecord(record.data) } as PixoNativeEvent;
}

export function sendStructuredRunCreateFailure(
  res: ApiResponse,
  sendApiError: RegisterRunRoutesDeps['http']['sendApiError'],
  error: unknown,
  requestId: string = randomUUID(),
): Response<unknown> | void {
  const rawCode = (error as NodeJS.ErrnoException)?.code;
  const code = typeof rawCode === 'string' && /^[A-Z0-9_]+$/.test(rawCode)
    ? rawCode
    : 'UNKNOWN';
  console.error(`[runs] preparation failed request=${requestId} code=${code}`);
  return sendApiError(
    res,
    500,
    'INTERNAL_ERROR',
    'Run preparation failed.',
    { requestId },
  );
}

export function registerRunCreateRoute(
  app: Express,
  handleRunCreate: (req: ApiRequest, res: ApiResponse) => Promise<unknown>,
  sendApiError: RegisterRunRoutesDeps['http']['sendApiError'],
): void {
  app.post('/api/runs', async (req: ApiRequest, res: ApiResponse) => {
    try {
      return await handleRunCreate(req, res);
    } catch (error) {
      if (res.headersSent) throw error;
      return sendStructuredRunCreateFailure(res, sendApiError, error);
    }
  });
}

export function registerRunRoutes(app: Express, ctx: RegisterRunRoutesDeps) {
  const { db, design } = ctx;
  const { createSseResponse, sendApiError } = ctx.http;
  const { BUNDLED_PLUGINS_DIR, PROJECTS_DIR, RUNTIME_DATA_DIR } = ctx.paths;
  const { detectAgents, getAgentDef } = ctx.agents;
  const { startChatRun } = ctx.chat;
  const {
    detectSkillPluginCandidateOnRunSuccess,
    loadPluginRegistryView,
    renderPluginBriefTemplate,
  } = ctx.plugins;
  const {
    resolveRunProjectKindForAnalytics,
    runArtifactBaselines,
    runRetryEventsForAnalytics,
  } = ctx.telemetry;
  const {
    pinAssistantMessageOnRunCreate,
    reconcileAssistantMessageOnRunEnd,
  } = ctx.messages;
  const internalRuns = ctx.internalRuns ?? createInternalRunCreationService({
    runs: design.runs,
    claimAssistantMessage: (run, options) =>
      pinAssistantMessageOnRunCreate(db, run, options),
    analyticsLifecycle: createRunAnalyticsLifecycle({
      db,
      design,
      paths: { PROJECTS_DIR, RUNTIME_DATA_DIR },
      agents: { detectAgents },
      telemetry: ctx.telemetry,
    }),
  });
  const runStatus = (run: ChatRun): ChatRunStatusResponse => design.runs.statusBody(run);

  /** Authorize every bound run mutation before plugin or snapshot resolution. */
  async function authorizeRunProjectBeforePluginResolution(
    req: ApiRequest,
    res: ApiResponse,
    projectId: string,
  ): Promise<{ ok: true; authorizedBoundMutation: boolean } | { ok: false }> {
    if (ctx.authorizeProjectRequest && !await ctx.authorizeProjectRequest(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return { ok: false };
    return { ok: true, authorizedBoundMutation: true };
  }

  function requestedSnapshotBelongsToProject(
    res: ApiResponse,
    projectId: string,
    snapshotId: unknown,
  ): boolean {
    if (typeof snapshotId !== 'string' || snapshotId.trim().length === 0) {
      return true;
    }
    const normalizedSnapshotId = snapshotId.trim();
    const row = db
      .prepare('SELECT project_id AS projectId FROM applied_plugin_snapshots WHERE id = ?')
      .get(normalizedSnapshotId) as { projectId?: unknown } | undefined;
    if (row?.projectId === projectId) return true;
    sendApiError(
      res,
      404,
      'snapshot-not-found',
      `Applied plugin snapshot ${normalizedSnapshotId} not found`,
    );
    return false;
  }


  async function authorizeRunProject(
    req: ApiRequest,
    res: ApiResponse,
    run: ChatRun,
    options: { mode: 'read'; allowNavigationQuery?: boolean } | {
      mode: 'write';
      capability: 'writeFiles';
    },
  ): Promise<boolean> {
    return !run.projectId || !ctx.authorizeProjectRequest || await ctx.authorizeProjectRequest(req, res, run.projectId, options);
  }

  registerRunApprovalRoutes<ChatRun>(app, {
    getRun: (id) => design.runs.get(id),
    cancelRun: (run) => design.runs.cancel(run, 'user_stop'),
    authorize: (req, res, run, write) => authorizeRunProject(req, res, run,
      write ? { mode: 'write', capability: 'writeFiles' } : { mode: 'read' }),
    sendApiError,
  });

  function runToolBundleDeliveryTargetForProject(
    projectId: unknown,
    metadata: ProjectMetadata,
  ): RunDeliveryTarget {
    if (typeof projectId !== 'string' || !projectId || !isSafeId(projectId)) {
      return 'none';
    }
    try {
      const cwd = resolveProjectDir(PROJECTS_DIR, projectId, metadata, {
        allowUnavailableSandboxImportedProject: true,
      });
      return isManagedProjectCwd(cwd, PROJECTS_DIR) ? 'managed-project' : 'external-project';
    } catch {
      return 'none';
    }
  }

  const handleRunCreate = async (req: ApiRequest, res: ApiResponse, stream = false) => {
    if (ctx.lifecycle.isDaemonShuttingDown()) {
      return sendApiError(res, 503, 'UPSTREAM_UNAVAILABLE', 'daemon is shutting down');
    }
    const requestBody = toJsonRecord(req.body);
    if (nativeCodexProviderForConfig(toJsonRecord(requestBody.byokProvider))) {
      if (requestBody.agentId && requestBody.agentId !== 'codex' && requestBody.agentId !== BYOK_OPENCODE_AGENT_ID) return sendApiError(res, 400, 'VALIDATION_FAILED', 'This provider snapshot requires the native Codex executor. Select Codex or omit the agent.');
      requestBody.agentId = 'codex';
    }
    const requestAnalyticsContext = readAnalyticsContext(req);
    const mediaExecution = parseMediaExecutionPolicyInput(requestBody.mediaExecution);
    if (!mediaExecution.ok) {
      return sendApiError(res, 400, 'BAD_REQUEST', mediaExecution.message);
    }
    const toolBundle = parseRunToolBundleForRequest(requestBody.toolBundle);
    if (!toolBundle.ok) {
      return sendApiError(res, 400, 'BAD_REQUEST', toolBundle.message);
    }
    if (!hasCompleteByokOpenCodeConfig(requestBody)) {
      return sendApiError(
        res,
        400,
        'VALIDATION_FAILED',
        BYOK_OPENCODE_PROVIDER_REQUIRED_MESSAGE,
      );
    }
    // Legacy streaming chat also supports unpersisted conversations without pins.
    // Preserve that path while rejecting mismatched existing ownership on both routes.
    // For /api/runs, reject a client-supplied conversationId missing a projectId or
    // not owned by that projectId before plugin snapshot resolve (which links
    // the snapshot to the conversation and would FK-fail / 500) and before
    // omit-pin mint/seed (which would return 202 with an unpersisted
    // assistantMessageId, or write messages without owning-project context).
    if (typeof requestBody.conversationId === 'string' && requestBody.conversationId) {
      const requestConversation = getConversation(db, requestBody.conversationId);
      if (
        (!stream && (
          !requestConversation || typeof requestBody.projectId !== 'string' || !requestBody.projectId
        )) ||
        (!requestConversation && (requestBody.assistantMessageId || requestBody.userMessageId)) ||
        (requestConversation && typeof requestBody.projectId === 'string'
          && requestBody.projectId && requestConversation.projectId !== requestBody.projectId)
      ) {
        return sendApiError(res, 404, 'CONVERSATION_NOT_FOUND', 'conversation not found for project');
      }
    }
    let authorizedBoundMutation = false;
    if (typeof requestBody.projectId === 'string' && requestBody.projectId) {
      const authorization = await authorizeRunProjectBeforePluginResolution(
        req,
        res,
        requestBody.projectId,
      );
      if (!authorization.ok) return;
      authorizedBoundMutation = authorization.authorizedBoundMutation;
    }
    const agentConversation = typeof requestBody.conversationId === 'string' && requestBody.conversationId
      ? getConversation(db, requestBody.conversationId)
      : !stream && typeof requestBody.projectId === 'string' && requestBody.projectId
        ? getFirstProjectConversation(db, requestBody.projectId)
        : null;
    let effectiveAgentId = resolveConversationAgentId(
      typeof requestBody.agentId === 'string' ? requestBody.agentId : null,
      agentConversation?.latestRunAgentId,
      null,
    );
    if (!effectiveAgentId) {
      try {
        const appCfg = await readAppConfig(RUNTIME_DATA_DIR);
        const cfgAgent = typeof appCfg.agentId === 'string' && appCfg.agentId
          ? appCfg.agentId
          : null;
        const agents = await detectAgents(
          toJsonRecord(appCfg.agentCliEnv),
        ).catch((): DetectedAgent[] => []);
        const cfgAgentAvailable = cfgAgent
          ? agents.some((agent) => agent.id === cfgAgent && agent.available)
          : false;
        effectiveAgentId = cfgAgent && cfgAgentAvailable
          ? cfgAgent
          : agents.find((agent) => agent.available)?.id ?? null;
      } catch (err) {
        console.warn('[runs] agent id fallback failed', err);
      }
    }

    let resolvedSnapshot: SuccessfulRunSnapshotResolution | null = null;
    if (typeof requestBody.projectId === 'string' && requestBody.projectId) {
      let runResolveBody: JsonRecord = requestBody;
      let synthesizedAutomaticDefault = false;
      const rolloutProject = toProjectRecord(getProject(db, requestBody.projectId));
      const snapshotConversationId =
        typeof requestBody.conversationId === 'string' && requestBody.conversationId
          ? getConversation(db, requestBody.conversationId)?.id ?? null
          : getFirstProjectConversation(db, requestBody.projectId)?.id ?? null;
      const defaultPluginId = defaultScenarioPluginIdForProjectMetadata(
        toScenarioProjectMetadata(rolloutProject?.metadata),
      );
      const suppliedSnapshotWasNamed = typeof requestBody.appliedPluginSnapshotId === 'string'
        && requestBody.appliedPluginSnapshotId.trim().length > 0;
      const suppliedPluginWasNamed = typeof requestBody.pluginId === 'string'
        && requestBody.pluginId.trim().length > 0;
      const projectHasExplicitPin = Boolean(rolloutProject?.appliedPluginSnapshotId);
      const verifiedScenarioBinding = rolloutProject
        ? readVerifiedProjectScenarioBinding(db, {
            projectId: rolloutProject.id,
            appliedPluginSnapshotId: rolloutProject.appliedPluginSnapshotId,
            metadata: rolloutProject.metadata as ContractProjectMetadata,
          })
        : null;
      const verifiedExampleBinding = readVerifiedProjectExampleBinding(
        rolloutProject?.metadata as ContractProjectMetadata | null | undefined,
      );
      let selectedExamplePlugin: InstalledPluginRecord | null = null;
      if (verifiedExampleBinding) {
        try {
          const candidate = await ctx.plugins.getLocalPluginBySource?.(
            verifiedExampleBinding.pluginId,
            verifiedExampleBinding.pluginSource,
          );
          const parsed = InstalledPluginRecordSchema.safeParse(candidate);
          if (
            !parsed.success
            || parsed.data.id !== verifiedExampleBinding.pluginId
            || parsed.data.source !== verifiedExampleBinding.pluginSource
            || await digestExampleSkillManifest(parsed.data.fsPath)
              !== verifiedExampleBinding.manifestSourceDigest
          ) {
            throw new Error('the bound example no longer resolves to its frozen identity');
          }
          selectedExamplePlugin = parsed.data;
        } catch (error) {
          console.warn(
            `[plugins] selected example ${verifiedExampleBinding.pluginId} is unavailable for ordinary fallback: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      const projectPinIsAutomaticDefault = Boolean(
        projectHasExplicitPin
        && verifiedScenarioBinding?.provenance === 'automatic_default'
        && verifiedScenarioBinding.pluginId === defaultPluginId,
      );
      const suppressAutomaticDefaultPinFallback = Boolean(
        projectPinIsAutomaticDefault
        && verifiedExampleBinding
        && !selectedExamplePlugin,
      );
      const suppliedContextPluginWasNamed = Boolean(
        Array.isArray((rolloutProject?.metadata as ContractProjectMetadata | undefined)?.contextPlugins)
        && (rolloutProject?.metadata as ContractProjectMetadata).contextPlugins!.length > 0
      );
      const officialTypeEntry = Boolean(defaultPluginId
        && getInstalledPlugin(db, defaultPluginId)?.sourceKind === 'bundled'
        && verifiedScenarioBinding?.pluginId === defaultPluginId
        && (!suppliedPluginWasNamed || requestBody.pluginId === defaultPluginId)
        && (!suppliedSnapshotWasNamed || requestBody.appliedPluginSnapshotId === rolloutProject?.appliedPluginSnapshotId));
      const officialTemplateEntry = Boolean(selectedExamplePlugin?.sourceKind === 'bundled'
        && verifiedExampleBinding
        && (!suppliedPluginWasNamed || requestBody.pluginId === selectedExamplePlugin.id)
        && (!suppliedSnapshotWasNamed || requestBody.appliedPluginSnapshotId === rolloutProject?.appliedPluginSnapshotId));
      const explicitExecutablePlugin = !officialTypeEntry && !officialTemplateEntry && Boolean(
        suppliedSnapshotWasNamed
        || suppliedPluginWasNamed
        || (projectHasExplicitPin && !projectPinIsAutomaticDefault)
      );
      // A named Skill is deliberately absent here. Naming one — the composer's
      // @-mention, `pixo run --skill`, a Skill persisted on the project — refines
      // the task; it does not claim the route away from a task type OD Next
      // already owns. An admitted strategy carries the Skill in
      // `session_skills/user_selected_skills` (see
      // `capturePixoNextSessionSkillPackage`), where the strategy's conflict
      // order already ranks a user-selected Skill above its own. A context
      // plugin still claims authority: that is an executable surface the
      // strategy has no slot for.
      const explicitUserPlugin = Boolean(
        explicitExecutablePlugin
        || suppliedContextPluginWasNamed
      );
      if (!explicitExecutablePlugin) {
        const projectRow = rolloutProject;
        const hasPin =
          typeof projectRow?.appliedPluginSnapshotId === 'string'
          && projectRow.appliedPluginSnapshotId.length > 0;if (!hasPin || (projectPinIsAutomaticDefault && selectedExamplePlugin)) {
          // An official example card is the user's concrete choice inside this
          // task type. When OD Next is not active, execute that exact example
          // on the ordinary route instead of silently substituting the
          // project-kind default (for decks, the unrelated simple-deck/COO
          // template). A stale/unavailable binding deliberately yields no
          // plugin rather than a different template.
          const fallbackPluginId = selectedExamplePlugin?.id
            ?? (verifiedExampleBinding ? null : defaultPluginId);
          if (
            fallbackPluginId
            && (selectedExamplePlugin || getInstalledPlugin(db, fallbackPluginId))
          ) {
            runResolveBody = { ...requestBody, pluginId: fallbackPluginId };
            synthesizedAutomaticDefault = !selectedExamplePlugin;
          }
        }
      }
      // Authorize the final plugin id, not only the literal request field.
      // Project-kind fallback may synthesize a pluginId, and it must not gain
      // a bypass around the same scoped catalog resolver.
      if (
        typeof runResolveBody.pluginId === 'string'
        && runResolveBody.pluginId.length > 0
        && ctx.plugins.authorizePluginRequest
        && !await ctx.plugins.authorizePluginRequest(
          req,
          res,
          runResolveBody.pluginId,
        )
      ) return;
      let registryView: Parameters<typeof resolvePluginSnapshot>[0]['registry'];
      try {
        registryView = await loadPluginRegistryView();
      } catch (err) {
        return res.status(500).json({ error: String(err) });
      }
      const resolved = resolvePluginSnapshot({
        db,
        body: runResolveBody,
        projectId: requestBody.projectId,
        conversationId: snapshotConversationId,
        registry: registryView,
        requireSnapshotProjectMatch: true,
        allowProjectPinFallback: !suppressAutomaticDefaultPinFallback,
        ...(selectedExamplePlugin ? { plugin: selectedExamplePlugin } : {}),
        ...(selectedExamplePlugin && runResolveBody.pluginId === selectedExamplePlugin.id
          ? { runScopedActivation: true }
          : {}),
        ...(!explicitExecutablePlugin
          && (projectPinIsAutomaticDefault || synthesizedAutomaticDefault)
          && defaultPluginId
          ? {
              projectBinding: {
                provenance: 'automatic_default' as const,
                taskProfile: verifiedScenarioBinding?.taskProfile
                  ?? automaticScenarioTaskProfile({
                    metadata: rolloutProject?.metadata as ContractProjectMetadata,
                    pluginId: defaultPluginId,
                  }),
              },
            }
          : {}),
        ...({}),
      });
      if (resolved && !resolved.ok) {
        if (!explicitExecutablePlugin) {
          console.warn(
            `[plugins] default-scenario fallback skipped for run on project ${requestBody.projectId}: ${resolved.body?.error?.code ?? 'unknown'}`,
          );
        } else {
          return res.status(resolved.status).json(resolved.body);
        }
      } else {
        resolvedSnapshot = resolved;
      }
    }
    const meta: RunCreateMeta = {
      ...withoutSensitiveRunInput(requestBody),
      mediaExecution: mediaExecution.policy,
      toolBundle: toolBundle.bundle,
      ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
      // Always replace any untrusted request field, including with null for an
      // unbound project.

      ...({}),
    };
    if (resolvedSnapshot?.ok) {
      meta.appliedPluginSnapshotId = resolvedSnapshot.snapshotId;
      if (!meta.pluginId) meta.pluginId = resolvedSnapshot.snapshot.pluginId;
      if (typeof meta.message !== 'string' || meta.message.trim().length === 0) {
        const renderedQuery = renderPluginBriefTemplate(
          resolvedSnapshot.snapshot.query ?? '',
          resolvedSnapshot.snapshot.inputs,
        ).trim();
        if (renderedQuery.length > 0) meta.message = renderedQuery;
      }
    }
    let runProject: ProjectRecord | null = null;
    if (typeof meta.projectId === 'string' && meta.projectId) {
      try {
        runProject = toProjectRecord(getProject(db, meta.projectId));
        assertSandboxProjectRootAvailable(runProject?.metadata);
      } catch (err) {
        if (err instanceof SandboxImportedProjectError) {
          return sendApiError(res, 400, 'BAD_REQUEST', err.message);
        }
        throw err;
      }
    }
    if (meta.agentId === BYOK_OPENCODE_AGENT_ID
      && nativeCodexProviderForConfig(toJsonRecord(requestBody.byokProvider))) meta.agentId = 'codex';
    if (!hasCompleteByokOpenCodeConfig({
      ...meta,
      ...(requestBody.byokProvider !== undefined
        ? { byokProvider: requestBody.byokProvider }
        : {}),
    })) {
      return sendApiError(
        res,
        400,
        'VALIDATION_FAILED',
        BYOK_OPENCODE_PROVIDER_REQUIRED_MESSAGE,
      );
    }
    const toolBundleSupport = validateRunToolBundleForAgent(
      toolBundle.bundle,
      typeof meta.agentId === 'string' ? getAgentDef(meta.agentId) : null,
      {
        deliveryTarget: runToolBundleDeliveryTargetForProject(
          meta.projectId,
          runProject?.metadata,
        ),
      },
    );
    if (!toolBundleSupport.ok) {
      return sendApiError(res, 400, 'BAD_REQUEST', toolBundleSupport.message);
    }
    if (runProject?.metadata) {
      meta.projectMetadata = runProject.metadata;
    }
    const requestAnalyticsHints =
      meta.analyticsHints
      && typeof meta.analyticsHints === 'object'
      && !Array.isArray(meta.analyticsHints)
        ? (meta.analyticsHints as Record<string, unknown>)
        : null;
    const hasExternalPluginHints = Boolean(
      requestAnalyticsHints
      && (
        requestAnalyticsHints.externalPluginId !== undefined
        || requestAnalyticsHints.externalPluginVersion !== undefined
        || requestAnalyticsHints.pluginWorkflowId !== undefined
        || requestAnalyticsHints.logicalRequestDigest !== undefined
        || requestAnalyticsHints.logicalRequestDigestVersion !== undefined
      ),
    );
    if (hasExternalPluginHints) {
      let normalizedExternalPluginHints;
      try {
        normalizedExternalPluginHints =
          normalizeExternalPluginRunAnalyticsHints(requestAnalyticsHints, {
            clientRequestId: meta.clientRequestId,
            analyticsContext: requestAnalyticsContext,
          });
      } catch (error) {
        return sendApiError(
          res,
          400,
          'PLUGIN_CONTRACT_REJECTED',
          error instanceof Error ? error.message : String(error),
        );
      }
      const inactivityTimeoutMs = resolveChatRunInactivityTimeoutMs();
      meta.analyticsHints = {
        ...requestAnalyticsHints,
        ...normalizedExternalPluginHints,
        generationSloWindowMs: resolvePluginGenerationSloWindowMs({
          inactivityTimeoutMs,
          configuredValue: process.env.PIXO_PLUGIN_GENERATION_SLO_WINDOW_MS,
        }),
      };
      const existingWorkflowRun = design.runs.findByPluginWorkflowId(
        normalizedExternalPluginHints.pluginWorkflowId,
      );
      if (
        existingWorkflowRun
        && existingWorkflowRun.clientRequestId !== meta.clientRequestId
      ) {
        return sendApiError(
          res,
          409,
          'PLUGIN_WORKFLOW_CONFLICT',
          'pluginWorkflowId is already bound to a different logical run request',
        );
      }
    }
    // Headless / MCP clients often omit conversationId; bind the project's
    // earliest conversation so the run has a chat home.
    let conversationFallbackBound = false;
    if (
      !stream &&
      typeof meta.projectId === 'string' &&
      meta.projectId &&
      (typeof meta.conversationId !== 'string' || !meta.conversationId)
    ) {
      try {
        const defaultConv = getFirstProjectConversation(db, meta.projectId);
        if (defaultConv && typeof defaultConv.id === 'string' && defaultConv.id) {
          meta.conversationId = defaultConv.id;
          conversationFallbackBound = true;
        }
      } catch (err) {
        console.warn('[runs] mcp conversation fallback failed', err);
      }
    }
    const conversationSession =
      typeof meta.conversationId === 'string' && meta.conversationId
        ? getConversation(db, meta.conversationId)
        : null;
    // Re-check after optional headless conversation bind: a run may only attach
    // to a conversation that exists and is owned by its project. Covers both
    // client-supplied ids (already validated above) and fallback-bound ids.
    // Require a string projectId so omit-pin never seeds without owning-project
    // context. Must run before omit-pin mint/seed so a missing conversation
    // never yields a 202 with an assistantMessageId that was never persisted.
    if (!stream && typeof meta.conversationId === 'string' && meta.conversationId) {
      if (
        !conversationSession ||
        typeof meta.projectId !== 'string' ||
        !meta.projectId ||
        conversationSession.projectId !== meta.projectId
      ) {
        return sendApiError(res, 404, 'CONVERSATION_NOT_FOUND', 'conversation not found for project');
      }
    }
    // Resolve session mode before omit-pin seed so the user turn stores the
    // same mode the run will use (matches web PUT /messages persistence).
    meta.sessionMode =
      meta.sessionMode === 'chat' || meta.sessionMode === 'design' || meta.sessionMode === 'plan'
        ? normalizeConversationSessionMode(meta.sessionMode)
        : normalizeConversationSessionMode(conversationSession?.sessionMode);
    // Web always mints assistantMessageId client-side. API clients that already
    // know conversationId (eval runners, scripts, MCP after the bind above) may
    // omit it. Without a server-side pin, pinAssistantMessageOnRunCreate no-ops,
    // lastMessageId stays null, and multi-turn native session resume is skipped
    // (missing_cursor / resume_skipped). Ownership is validated above first.
    // A web client also supplies userMessageId so this route can pin the user
    // row before the assistant row. Its separate best-effort PUT may arrive
    // later; upserting the same id then preserves the position established
    // here. Headless fallback keeps its existing generated-id behavior.
    //
    // Prepare seed payload before createOrReuse, but only persist when the run
    // is newly created so lost-response retries with clientRequestId do not
    // duplicate user turns.
    const missingClientPin =
      typeof meta.assistantMessageId !== 'string' || !meta.assistantMessageId;
    const clientUserMessageId =
      typeof meta.userMessageId === 'string' && meta.userMessageId
        ? meta.userMessageId
        : null;
    if (clientUserMessageId && !isSafeId(clientUserMessageId)) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'userMessageId is invalid');
    }
    if (clientUserMessageId && typeof meta.conversationId === 'string') {
      const existingUserPin = db
        .prepare(`SELECT role, conversation_id AS conversationId FROM messages WHERE id = ?`)
        .get(clientUserMessageId) as
        | { role?: unknown; conversationId?: unknown }
        | undefined;
      if (existingUserPin && existingUserPin.role !== 'user') {
        return sendApiError(
          res,
          409,
          'INVALID_USER_MESSAGE',
          'userMessageId must reference a user message',
        );
      }
      if (
        existingUserPin
        && existingUserPin.conversationId !== meta.conversationId
      ) {
        return sendApiError(
          res,
          409,
          'IDEMPOTENCY_CONFLICT',
          'userMessageId belongs to a different conversation',
        );
      }
    }
    // The run's assistantMessageId must reference an assistant message in THIS
    // conversation, or the run would pin/append/finalize a row it does not own
    // (a user row in the same conversation, or an assistant row in another
    // conversation). Without this check, `pinAssistantMessageOnRunCreate` only
    // skips the pin and the run still mutates the foreign row via the id-only
    // writers (#6418 review).
    const clientAssistantMessageId =
      typeof meta.assistantMessageId === 'string' && meta.assistantMessageId
        ? meta.assistantMessageId
        : null;
    if (clientAssistantMessageId && !isSafeId(clientAssistantMessageId)) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'assistantMessageId is invalid');
    }
    if (
      clientUserMessageId
      && clientAssistantMessageId
      && clientUserMessageId === clientAssistantMessageId
    ) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        'userMessageId and assistantMessageId must be distinct',
      );
    }
    if (clientAssistantMessageId) {
      // Without a resolvable conversation there is nothing to validate the
      // assistantMessageId against — the run would mutate a row it does not
      // own via the id-only writers. Reject rather than guess (nettee).
      if (typeof meta.conversationId !== 'string' || !meta.conversationId) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'assistantMessageId requires a conversation');
      }
      const chatConversation = getConversation(db, meta.conversationId);
      if (
        !chatConversation
        || (
          typeof meta.projectId === 'string'
          && meta.projectId
          && chatConversation.projectId !== meta.projectId
        )
      ) {
        return sendApiError(res, 404, 'CONVERSATION_NOT_FOUND', 'conversation not found for project');
      }
      const existingAssistantPin = db
        .prepare(
          `SELECT role, conversation_id AS conversationId, run_id AS runId, run_status AS runStatus FROM messages WHERE id = ?`,
        )
        .get(clientAssistantMessageId) as
        | { role?: unknown; conversationId?: unknown; runId?: unknown; runStatus?: unknown }
        | undefined;
      if (existingAssistantPin && existingAssistantPin.role !== 'assistant') {
        return sendApiError(
          res,
          409,
          'INVALID_ASSISTANT_MESSAGE',
          'assistantMessageId must reference an assistant message',
        );
      }
      if (
        existingAssistantPin
        && existingAssistantPin.conversationId !== meta.conversationId
      ) {
        return sendApiError(
          res,
          409,
          'IDEMPOTENCY_CONFLICT',
          'assistantMessageId belongs to a different conversation',
        );
      }
    }
    let runUserSeed: {
      id: string;
      conversationId: string;
      content: string;
      attachments: ReturnType<typeof seededUserMessageAttachmentFields>;
      turnMetadata: ReturnType<typeof seededUserMessageTurnMetadataFields>;
    } | null = null;
    if (
      typeof meta.conversationId === 'string' &&
      meta.conversationId &&
      conversationSession &&
      typeof meta.projectId === 'string' && meta.projectId &&
      (clientUserMessageId || missingClientPin || conversationFallbackBound)
    ) {
      if (missingClientPin) {
        meta.assistantMessageId = randomUUID();
      }
      // Prefer original request currentPrompt (latest turn) whenever it is a
      // string — including empty for attachments-only sends. Plugin resolution
      // may replace meta.message with a rendered scenario brief for the run
      // (see above); seed visible chat content from requestBody so that
      // internal brief never appears as user-authored content. message may be
      // a full flattened ChatRequest transcript. Minimal MCP requests set both
      // equal. Only fall back to message when currentPrompt is absent. Empty
      // message is still seedable when attachment metadata is present so
      // chips/annotations survive reload for omit-pin clients that leave
      // currentPrompt unset.
      const projectRoot = runProject && meta.projectId
        ? resolveProjectDir(PROJECTS_DIR, meta.projectId, runProject.metadata)
        : null;
      const seededAttachments = seededUserMessageAttachmentFields(meta, projectRoot);
      const hasSeedableAttachmentMetadata =
        (seededAttachments.attachments?.length ?? 0) > 0;
      const originalCurrentPrompt = requestBody.currentPrompt;
      const originalMessage = requestBody.message;
      const promptForUserMessage =
        typeof originalCurrentPrompt === 'string'
          ? originalCurrentPrompt
          : typeof originalMessage === 'string' &&
              (originalMessage.trim().length > 0 || hasSeedableAttachmentMetadata)
            ? originalMessage
            : null;
      if (promptForUserMessage !== null) {
        runUserSeed = {
          id: clientUserMessageId ?? randomUUID(),
          conversationId: meta.conversationId,
          content: promptForUserMessage,
          attachments: seededAttachments,
          turnMetadata: seededUserMessageTurnMetadataFields(
            meta,
            resolvedSnapshot?.ok ? resolvedSnapshot.snapshot : null,
          ),
        };
      }
    }
    const seedRunUserMessage = () => {
      if (!runUserSeed) return;
      const now = Date.now();
      upsertMessage(db, runUserSeed.conversationId, {
        id: runUserSeed.id,
        role: 'user',
        content: runUserSeed.content,
        startedAt: now,
        endedAt: now,
        // Same turn metadata the web client writes via PUT /messages so
        // reload/retry keep sessionMode, runContext, and applied plugin.
        ...runUserSeed.turnMetadata,
        // Preserve request attachments on the seeded user
        // turn so reload/listMessages still show chips and annotation context
        // for omit-pin / headless clients (same columns as PUT /messages).
        ...runUserSeed.attachments,
      });
      // Bump parent project updatedAt so listProjects reorders (same as
      // PUT /messages). Headless/API turns that never hit that route would
      // otherwise leave the project buried under more recent activity.
      if (typeof meta.projectId === 'string' && meta.projectId) {
        updateProject(db, meta.projectId, {});
      }
    };
    const fingerprintSnapshot = resolvedSnapshot?.ok
        ? resolvedSnapshot.snapshot
        : null;
    const fingerprintMeta = { ...meta };
    delete fingerprintMeta.runtimeCapabilitySnapshot;
    meta.requestFingerprint = runRequestFingerprint(fingerprintMeta, fingerprintSnapshot);
    const preparedRun = internalRuns.prepare({
      meta,
      ...(runUserSeed ? { beforeClaimCommit: () => seedRunUserMessage() } : {}),
      resume: {
        requested: requestBody.resume === true,
        canResume: () => false,
      },
    });
    if (preparedRun.kind === 'idempotency_conflict') {
      return sendApiError(
        res,
        409,
        'IDEMPOTENCY_CONFLICT',
        'clientRequestId is already associated with a different logical run request',
      );
    }
    const run = preparedRun.run;
    const analyticsAttributionMismatch =
      (preparedRun.kind !== 'ready' || preparedRun.creationKind === 'reused')
      && externalPluginAttributionMismatch(
        run.externalPluginAnalytics,
        meta.analyticsHints,
      );
    if (preparedRun.kind === 'reused') {
      if (stream) { design.runs.stream(run, req, res); return; }
      return res.status(202).json({
        runId: run.id,
        conversationId: run.conversationId ?? null,
        assistantMessageId: run.assistantMessageId ?? null,
        clientRequestId: run.clientRequestId ?? null,
        reused: true,
        resumed: false,
        ...(analyticsAttributionMismatch
          ? { analyticsAttributionMismatch: true }
          : {}),
        ...(run.appliedPluginSnapshotId
          ? { appliedPluginSnapshotId: run.appliedPluginSnapshotId }
          : {}),
        ...(run.pluginId ? { pluginId: run.pluginId } : {}),
        ...({}),
        ...({}),
      });
    }
    if (preparedRun.kind === 'resume_not_allowed') {
      return sendApiError(
        res,
        409,
        'RUN_NOT_RECHARGE_RESUMABLE',
        'Only a failed OpenPixo Cloud run waiting for recharge can be resumed with the same request',
      );
    }
    if (preparedRun.kind === 'assistant_claim_conflict') {
      return sendApiError(
        res,
        409,
        'RUN_IN_PROGRESS',
        'assistantMessageId is already bound to an active run',
      );
    }
    const resumed = preparedRun.resumed;
    const declaredClient = String(req.get('x-pixo-client') ?? '').toLowerCase();
    if (requestAnalyticsContext?.clientType === 'external_mcp') {
      run.clientType = 'external_mcp';
    } else if (declaredClient === 'desktop' || declaredClient === 'web') {
      run.clientType = declaredClient;
    } else {
      const ua = String(req.get('user-agent') ?? '');
      run.clientType = ua.includes('Electron/') ? 'desktop' : 'web';
    }
    if (resolvedSnapshot?.ok) {
      try {
        linkSnapshotToRun(
          db,
          resolvedSnapshot!.snapshotId,
          run.id,
        );
      } catch {
        // Linking is best-effort here; in-memory run still carries the id.
      }
    }
    const body = {
      runId: run.id,
      conversationId: run.conversationId ?? null,
      assistantMessageId: run.assistantMessageId ?? null,
      clientRequestId: run.clientRequestId ?? null,
      reused: preparedRun.creationKind === 'reused',
      resumed,
      ...(analyticsAttributionMismatch
        ? { analyticsAttributionMismatch: true }
        : {}),
      ...(run.appliedPluginSnapshotId
        ? { appliedPluginSnapshotId: run.appliedPluginSnapshotId }
        : {}),
      ...(run.pluginId ? { pluginId: run.pluginId } : {}),
      ...({}),
      ...({}),
    };
    if (stream) design.runs.stream(run, req, res);
    else res.status(202).json(body);
    reconcileAssistantMessageOnRunEnd(db, design.runs, run);
    if (run.projectId && run.conversationId) {
      try {
        const project = toProjectRecord(getProject(db, run.projectId));
        const projectRoot = resolveProjectDir(PROJECTS_DIR, run.projectId, project?.metadata);
        detectSkillPluginCandidateOnRunSuccess(db, design.runs, run, requestBody, projectRoot);
      } catch (err) {
        console.warn('[plugins] skill candidate hook setup failed', err);
      }
    }
    const executionMeta: RunCreateMeta = {
      ...meta,
      ...(requestBody.byokProvider !== undefined
        ? { byokProvider: requestBody.byokProvider }
        : {}),
    };
    internalRuns.start(
      run,
      {
        body: requestBody,
        requestAnalyticsContext,
        snapshot: resolvedSnapshot,
        creationKind: preparedRun.creationKind,
        resumed,
        attributionMismatch: analyticsAttributionMismatch,
      },
      () => startChatRun(executionMeta, run),
    );
  };

  registerRunCreateRoute(app, handleRunCreate, sendApiError);

  // Restart-safety probe for the desktop updater. `GET /api/runs` refuses an
  // unscoped listing once any run belongs to a Workspace-bound project, so a
  // host-level caller could never learn whether it is safe to restart. This
  // route answers only that question: it is loopback-only (peer, Host and
  // Origin, which also defeats DNS rebinding) and returns a bare count — no
  // run, project or conversation ids — so it cannot enumerate Workspace runs.
  // Registered before `/api/runs/:id` so the path is not read as a run id.
  app.get('/api/runs/active-count', (req: ApiRequest, res: ApiResponse) => {
    const local = validateLocalDaemonRequest(req);
    if (!local.ok) {
      return sendApiError(res, 403, 'FORBIDDEN', local.message, { details: local.details });
    }
    const activeRunCount = design.runs.list({ status: 'active' }).length;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ activeRunCount });
  });

  app.get('/api/runs', async (req: ApiRequest, res: ApiResponse) => {
    const { projectId, conversationId, status } = req.query;
    const runs = design.runs.list({ projectId, conversationId, status });
    if (typeof projectId === 'string' && projectId && ctx.authorizeProjectRequest && !await ctx.authorizeProjectRequest(req, res, projectId, { mode: 'read' })) return;
    const readable = await Promise.all(runs.map(async run => !run.projectId || await enforceLocalProjectDataPlaneRequest({ db, PROJECTS_DIR, getProject, req, projectId: run.projectId, options: { mode: 'read' } })));
    const visibleRuns = runs.filter((_run, index) => readable[index]);
    // `ChatRunStatus` cannot say "waiting on the user": the run that asked the
    // question reports `succeeded` and exits, while the project stays blocked.
    // Clients rendering a per-project status off this feed would show such a
    // project as finished, so ship the awaiting-input set alongside — the same
    // one `GET /api/projects` composes `awaiting_input` from.
    //
    // Intersected with the projects `visibleRuns` already reveals: without a
    // `projectId` the query is unscoped, and returning it raw would leak the ids
    // of projects this caller is not authorized to see. With one, this per-project
    // poll also keeps the query off every other project's messages.
    const visibleProjectIds = new Set(
      visibleRuns
        .map((run) => run.projectId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    const awaitingInputProjectIds = visibleProjectIds.size
      ? [...listProjectsAwaitingInput(db, typeof projectId === 'string' && projectId ? projectId : undefined)]
        .filter((id) => visibleProjectIds.has(id))
      : [];
    const body = {
      runs: visibleRuns.map(runStatus),
      awaitingInputProjectIds,
    };
    res.json(body);
  });

  app.get('/api/runs/by-plugin-workflow/:workflowId', (req: ApiRequest, res: ApiResponse) => {
    let pluginWorkflowId: string;
    try {
      pluginWorkflowId = validatePluginWorkflowId(req.params.workflowId);
    } catch {
      return sendApiError(
        res,
        400,
        'PLUGIN_CONTRACT_REJECTED',
        'pluginWorkflowId must be a canonical UUID or ULID',
      );
    }
    const run = design.runs.findByPluginWorkflowId(pluginWorkflowId);
    const analytics =
      run?.externalPluginAnalytics
      && run.externalPluginAnalytics.externalPluginId
        === OPENPIXO_PLUGIN_ID
        ? run.externalPluginAnalytics
        : null;
    if (!run || !analytics) {
      return sendApiError(
        res,
        404,
        'NOT_FOUND',
        'plugin workflow run not found',
      );
    }
    res.json({
      runId: run.id,
      projectId: run.projectId,
      pluginWorkflowId,
      logicalRequestDigest: analytics.logicalRequestDigest,
      logicalRequestDigestVersion: analytics.logicalRequestDigestVersion,
      externalPluginContext: {
        id: analytics.externalPluginId,
        version: analytics.externalPluginVersion,
        distributionMechanism: analytics.distributionMechanism,
        publisherClass: analytics.publisherClass,
      },
    });
  });

  app.get('/api/runs/:id/result-package', async (req: ApiRequest, res: ApiResponse) => {
    const runId = routeParamId(req);
    if (!runId) return sendApiError(res, 400, 'BAD_REQUEST', 'run id missing');
    const requestedRun = design.runs.get(runId);
    const run = requestedRun;
    if (!requestedRun || !run) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    if (!await authorizeRunProject(req, res, run, { mode: 'read' })) return;
    const status = runStatus(run);
    const project = run.projectId ? toProjectRecord(getProject(db, run.projectId)) : null;
    let files: ProjectFileEntry[] = [];
    if (project) {
      const packageMetadata = run.projectMetadata ?? null;
      try {
        if (status.workspace?.storage?.kind === 'folder-backed') {
          const projectRoot = resolveProjectDir(PROJECTS_DIR, project.id, packageMetadata);
          const projectRootStat = await fs.promises.stat(projectRoot);
          if (!projectRootStat.isDirectory()) {
            throw new Error('workspace root is not a directory');
          }
        }
        files = toProjectFiles(await listFiles(PROJECTS_DIR, project.id, { metadata: packageMetadata }));
      } catch (err) {
        return sendApiError(
          res,
          500,
          'WORKSPACE_ENUMERATION_FAILED',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    const artifacts = files
      .filter((file): file is ProjectFileEntry & { artifactManifest: ArtifactManifest } =>
        Boolean(file.artifactManifest && typeof file.artifactManifest === 'object'),
      )
      .map((file) => ({
        file: file.name,
        kind: typeof file.artifactManifest.kind === 'string'
          ? file.artifactManifest.kind
          : file.artifactKind ?? null,
        renderer: typeof file.artifactManifest.renderer === 'string'
          ? file.artifactManifest.renderer
          : null,
        title: typeof file.artifactManifest.title === 'string'
          ? file.artifactManifest.title
          : file.name,
        status: typeof file.artifactManifest.status === 'string'
          ? file.artifactManifest.status
          : null,
        manifest: file.artifactManifest,
      }));
    const body: RunResultPackageResponse = {
      schema: RUN_RESULT_PACKAGE_SCHEMA,
      run: {
        id: status.id,
        status: status.status,
        projectId: status.projectId,
        conversationId: status.conversationId,
        assistantMessageId: status.assistantMessageId,
        agentId: status.agentId,
        createdAt: status.createdAt,
        updatedAt: status.updatedAt,
        ...(status.cancelRequested !== undefined
          ? { cancelRequested: status.cancelRequested }
          : {}),
        ...(status.exitCode !== undefined ? { exitCode: status.exitCode } : {}),
        ...(status.signal !== undefined ? { signal: status.signal } : {}),
        ...(status.error !== undefined ? { error: status.error } : {}),
        ...(status.errorCode !== undefined ? { errorCode: status.errorCode } : {}),
      },
      ...({}),
      workspace: status.workspace ?? {
        storage: { kind: 'pixo-owned', baseDir: null },
        provenance: null,
      },
      events: {
        logPath: status.eventsLogPath ?? null,
      },
      project: project
        ? {
            id: project.id,
            name: project.name,
            fileCount: files.length,
          }
        : null,
      artifacts,
    };
    res.json(body);
  });

  app.get('/api/runs/:id', async (req: ApiRequest, res: ApiResponse) => {
    const runId = routeParamId(req);
    if (!runId) return sendApiError(res, 400, 'BAD_REQUEST', 'run id missing');
    const run = design.runs.get(runId);
    if (!run) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    if (!await authorizeRunProject(req, res, run, { mode: 'read' })) return;
    const status = runStatus(run);
    if (!design.runs.isTerminal(run.status)) {
      res.json(status);
      return;
    }
    if (
      typeof status.deliverableValid === 'boolean'
      && typeof status.deliverableValidation === 'string'
    ) {
      res.json(status);
      return;
    }
    const touchedArtifactPaths = runTouchedArtifactPaths(run);
    const deliverable = await validateChatRunDeliverable({
      db,
      projectsRoot: PROJECTS_DIR,
      run,
      runStatus: run.status,
      artifactCount:
        typeof status.artifactCount === 'number' ? status.artifactCount : 0,
      ...(touchedArtifactPaths
        ? { touchedPaths: touchedArtifactPaths }
        : {}),
    });
    design.runs.setDeliverableValidation?.(run, deliverable);
    res.json({
      ...status,

      deliverableValid: deliverable.valid,
      deliverableValidation: deliverable.validation,
      ...(deliverable.entryFile
        ? { deliverableEntryFile: deliverable.entryFile }
        : {}),
      ...(deliverable.artifactKind
        ? { deliverableArtifactKind: deliverable.artifactKind }
        : {}),
    });
  });

  app.get('/api/runs/:id/events', async (req: ApiRequest, res: ApiResponse) => {
    const runId = routeParamId(req);
    if (!runId) return sendApiError(res, 400, 'BAD_REQUEST', 'run id missing');
    const run = design.runs.get(runId);
    if (!run) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    if (!await authorizeRunProject(
      req,
      res,
      run,
      { mode: 'read', allowNavigationQuery: true },
    )) return;
    design.runs.stream(run, req, res);
  });

  app.get('/api/runs/:id/agui', async (req: ApiRequest, res: ApiResponse) => {
    const runId = routeParamId(req);
    if (!runId) return sendApiError(res, 400, 'BAD_REQUEST', 'run id missing');
    const run = design.runs.get(runId);
    if (!run) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    if (!await authorizeRunProject(
      req,
      res,
      run,
      { mode: 'read', allowNavigationQuery: true },
    )) return;
    const { encodePixoEventForAgui } = await import('@openpixo/agui-adapter');
    const sse = createSseResponse(res);
    const lastEventId = Number(req.get('Last-Event-ID') || req.query.after || 0);
    const emitMapped = (record: RunEventRecord) => {
      const nativeEvent = toPixoNativeEvent(record);
      if (!nativeEvent) return;
      const mapped = encodePixoEventForAgui(
        nativeEvent,
        { runId: run.id, seq: record.id, now: Date.now() },
      );
      if (mapped) sse.send(mapped.kind, mapped, record.id);
    };
    for (const record of run.events) {
      if (!Number.isFinite(lastEventId) || record.id > lastEventId) emitMapped(record);
    }
    if (design.runs.isTerminal(run.status)) {
      sse.end();
      return;
    }
    const adapterClient = {
      send: (event: string, data: unknown, id?: number) => {
        const nativeEvent = toPixoNativeEvent({
          id: id ?? 0,
          event,
          data,
          timestamp: Date.now(),
        });
        if (!nativeEvent) return;
        const ctx = id === undefined
          ? { runId: run.id, now: Date.now() }
          : { runId: run.id, seq: id, now: Date.now() };
        const mapped = encodePixoEventForAgui(nativeEvent, ctx);
        if (mapped) sse.send(mapped.kind, mapped, id);
      },
      end:     () => sse.end(),
      cleanup: () => sse.cleanup?.(),
    };
    run.clients.add(adapterClient);
    res.on('close', () => {
      run.clients.delete(adapterClient);
      sse.cleanup?.();
    });
  });

  app.post('/api/runs/:id/cancel', async (req: ApiRequest, res: ApiResponse) => {
    const runId = routeParamId(req);
    if (!runId) return sendApiError(res, 400, 'BAD_REQUEST', 'run id missing');
    const run = design.runs.get(runId);
    if (!run) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    if (!await authorizeRunProject(
      req,
      res,
      run,
      { mode: 'write', capability: 'writeFiles' },
    )) return;
    const cancelRun = run;
    await design.runs.cancel(cancelRun, 'user_stop');
    const body = { ok: true, run: runStatus(cancelRun) };
    res.json(body);
  });

  // B11 「引导对话」 — steer the turn that is ALREADY running.
  //
  // The sibling `/cancel` above is the interrupt path: it stops the turn and
  // the caller re-sends. This one is the opposite — the turn keeps everything
  // it has done and one more `user` frame goes down the child's still-open
  // stdin, so the model reads the correction mid-flight. Admissibility is
  // decided once, in `classifyRunSteering`; this route only translates the
  // verdict into HTTP and makes the delivered message durable.
  app.post('/api/runs/:id/steer', async (req: ApiRequest, res: ApiResponse) => {
    const runId = routeParamId(req);
    if (!runId) return sendApiError(res, 400, 'BAD_REQUEST', 'run id missing');
    const run = design.runs.get(runId);
    if (!run) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    if (!await authorizeRunProject(
      req,
      res,
      run,
      { mode: 'write', capability: 'writeFiles' },
    )) return;
    const requestBody = toJsonRecord(req.body);
    const rawText = typeof requestBody.text === 'string' ? requestBody.text : '';
    const text = rawText.trim();
    if (!text) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        'text is required and must be a non-empty string',
      );
    }
    const runtimeAccepts = runtimeAcceptsMidTurnInput(
      typeof run.agentId === 'string' ? getAgentDef(run.agentId) : null,
    );
    const outcome = design.runs.steer(run, text, runtimeAccepts);
    if (!outcome.ok) {
      // Two distinct codes on purpose: `UNSUPPORTED` is permanent for this
      // agent (the caller should stop offering the affordance), the closed
      // ones mean "this turn is past taking input — send it as a new turn".
      if (outcome.refusal === 'runtime_unsupported') {
        return sendApiError(
          res,
          409,
          'RUN_STEERING_UNSUPPORTED',
          `agent ${run.agentId ?? 'unknown'} cannot take a mid-turn message: `
          + 'its stdin is closed together with the opening prompt',
          { retryable: false, details: { refusal: outcome.refusal } },
        );
      }
      return sendApiError(
        res,
        409,
        'RUN_STEERING_CLOSED',
        outcome.refusal === 'run_terminal'
          ? 'run already finished; send the message as a new turn'
          : 'the turn already ended and stopped reading input; send the message as a new turn',
        { retryable: false, details: { refusal: outcome.refusal } },
      );
    }
    // Durability. Without this row the user reloads and their own words are
    // gone — the model acted on something the transcript never recorded. It is
    // written only AFTER a successful delivery, so a refused steer leaves no
    // trace, and it goes in as `role: 'user'` because that is who wrote it:
    // any other role would misattribute it, and the next turn's flattened
    // transcript would drop the instruction the model was actually given.
    // Position is append-only, so it lands after the assistant turn it steered
    // — which is exactly when the user said it.
    const messageId = randomUUID();
    if (run.conversationId) {
      const now = Date.now();
      upsertMessage(db, run.conversationId, {
        id: messageId,
        role: 'user',
        content: text,
        startedAt: now,
        endedAt: now,
      });
      if (typeof run.projectId === 'string' && run.projectId) {
        updateProject(db, run.projectId, {});
      }
    }
    res.json({
      ok: true,
      delivered: true,
      messageId,
      run: design.runs.statusBody(run),
    });
  });

  app.post('/api/chat', async (req: ApiRequest, res: ApiResponse) => {
    await handleRunCreate(req, res, true);
  });
}

export const __forTestHasCompleteByokOpenCodeConfig = hasCompleteByokOpenCodeConfig;
export const __forTestWithoutSensitiveRunInput = withoutSensitiveRunInput;
