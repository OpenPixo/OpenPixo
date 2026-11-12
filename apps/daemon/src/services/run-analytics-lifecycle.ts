// The physical-Run analytics lifecycle: `run_created` on start, `run_finished`
// on terminal, and the durable recovery record that lets a daemon restart
// replay the pair.
//
// This used to live inline in `POST /api/runs`, which meant a Run only entered
// the lifecycle if a client had asked for it over HTTP. Every physical Run the
// daemon allocates on its own — a scheduled
// Automation, a live-artifact refresh — started outside it and reported
// nothing, so per-Run rates were computed on the client-started stage alone
// (OPEND-2365). It is a module now so `internalRunCreation.start` can install
// it for every physical Run from one place, whoever asked for the Run.
//
// Nothing here may throw into the caller: analytics is an observer of the Run,
// never a participant in it.

import { scheduler } from 'node:timers/promises';
import { buildRunCreatedV4Aliases, buildRunFinishedV4Aliases, deriveConfigureGlobals, modelIdForTracking, sessionModeToTracking, type RunTaskLineageProps, type TrackingRunRecoveryActionType } from '@openpixo/contracts/analytics';
import { spawnEnvForAgentAsync as spawnEnvForAgent } from '../agents.js';
import { newInsertId, normalizeAnalyticsCaptureResult } from '../analytics.js';
import type { AnalyticsCaptureResult, AnalyticsContext } from '../analytics.js';
import { agentCliEnvForAgent, readAppConfig } from '../app-config.js';
import {
  codexSessionIdFromRunEvents,
  readCodexRolloutFirstCall,
} from '../codex-rollout-usage.js';
import {
  conversationTurnIndexForRun,
  getProject,
  updateProject,
} from '../db.js';
import {
  agentProviderIdForRunAnalytics,
  hasExplicitRequestedModelForAnalytics,
  perRequestUsageForRun,
  runtimeTypeForRunAnalytics,
  scanRunEventsForPerRequestUsageAnalytics,
  scanRunEventsForUsageAnalytics,
  summarizeRunTimingAnalytics,
  summarizeToolAnalytics,
} from '../run-analytics-observability.js';
import {
  diffRunArtifacts,
  primaryArtifactChangeForRun,
  snapshotProjectArtifacts,
  supportingAssetFilesChangedForRun,
  type RunArtifactDiff,
} from '../run-artifact-fs.js';
import { summarizeRunDiagnosticsForAnalytics } from '../run-diagnostics.js';
import { classifyRunFailure } from '../run-failure-classification.js';
import { deriveRunErrorCode, runResultFromStatus } from '../run-result.js';
import { terminalLifecycleForPosthogLocalQueue } from '../observability/run-terminal-lifecycle.js';
import {
  runEventStorageShapeAnalytics,
  runMessageEventPersistenceAnalytics,
} from '../runtimes/chat-run-messages.js';
import { readRunStorageAnalytics } from '../storage/run-storage-analytics.js';
import { getDetectedRuntimeVersions } from '../runtimes/detection.js';
import {
  deriveActivationMilestones,
  runAskedUserQuestion,
} from '../runtimes/run-artifacts.js';
import {
  runArtifactCountForRun,
  runIntentDocumentWritten,
  runFilesWrittenForRun,
  runAdmissionEvidenceForRun,
  runPreviewModuleCountForRun,
} from '../runtimes/run-lifecycle-analytics.js';
import type { AppliedPluginSnapshot } from '@openpixo/contracts';
import { runTouchedArtifactPaths, toJsonRecord, toProjectRecord, validateChatRunDeliverable, type ChatRun, type JsonRecord, type ProjectRecord, type RunArtifactBaselines, type RunCreatedFallbackInput, type RunProjectKindInput, type RunRetryAnalyticsEvent, type TerminalRunStatus } from '../runtimes/chat-run-records.js';

type AgentCliEnv = Parameters<typeof agentCliEnvForAgent>[0];

/**
 * The lineage hints a daemon-created Run inherits from the Run that caused it.
 *
 * A logical task can span several physical Runs (request -> contract_repair ->
 * production). Without this, every Run falls back to its own id and lands in
 * the warehouse as an unrelated one-Run task: the chain cannot be reassembled
 * and per-stage rates cannot be compared.
 *
 * Resolved from the source Run's request facts, NOT from the recovery record
 * its own `run_created` wrote. The lifecycle re-reads host facts before it
 * captures, so a short Run can hand off to its continuation before that record
 * exists; inheriting from it would silently start a second task. The fallback
 * chain below is the same one `install` applies to the source Run, so both
 * resolve to the same id whether or not the record has landed yet.
 */
export function inheritedRunLineageHints(
  sourceRun: { id: string; clientRequestId?: string | null },
  sourceBody: { analyticsHints?: unknown } | null | undefined,
  taskRunIndex: number,
): {
  taskExecutionId: string;
  initialRunId: string;
  taskRunIndex: number;
  sourceRunId: string;
} {
  const hints = toJsonRecord((sourceBody ?? {}).analyticsHints);
  const hint = (key: string): string | null =>
    typeof hints[key] === 'string' && hints[key] ? hints[key] as string : null;
  return {
    taskExecutionId:
      hint('taskExecutionId') ?? sourceRun.clientRequestId ?? sourceRun.id,
    initialRunId: hint('initialRunId') ?? sourceRun.id,
    taskRunIndex,
    sourceRunId: sourceRun.id,
  };
}

/**
 * What the lifecycle reads from the daemon. `telemetry` is the same group the
 * run routes already own — it exists only to serve these two events.
 */
export interface RunAnalyticsLifecycleDeps {
  db: Parameters<typeof getProject>[0];
  design: {
    runs: {
      wait(run: ChatRun): Promise<TerminalRunStatus>;
      setAnalyticsRecovery?(run: ChatRun, recovery: {
        context: AnalyticsContext;
        properties: Record<string, unknown>;
        insertId: string;
      }): void;
      markAnalyticsCompleted?(run: ChatRun): void;
      beginAnalyticsDelivery?(run: ChatRun): void;
      finalizeAnalyticsDelivery?(run: ChatRun, result: AnalyticsCaptureResult): void;
      setDeliverableValidation?(run: ChatRun, result: unknown): void;
    };
    analytics: {
      capture(args: {
        eventName: string;
        context: AnalyticsContext;
        appVersion: string;
        properties: Record<string, unknown>;
        insertId: string;
      }): unknown | Promise<unknown>;
    };
    getAppVersion(): string;
  };
  paths: { PROJECTS_DIR: string; RUNTIME_DATA_DIR: string };
  agents: {
    detectAgents: (
      agentCliEnv?: Record<string, unknown>,
    ) => Promise<Array<{ id: string; available: boolean }>>;
  };
  telemetry: RunAnalyticsTelemetryDeps;
}

export interface RunAnalyticsTelemetryDeps {
  resolveRunProjectKindForAnalytics: (input: RunProjectKindInput) => string | null;
  runArtifactBaselines: RunArtifactBaselines;
  runRetryEventsForAnalytics: (events: ChatRun['events']) => RunRetryAnalyticsEvent[];
}

/**
 * Everything about one physical Run that is not readable off the Run itself.
 *
 * A daemon-started Run supplies the same facts its HTTP sibling would: the
 * request body it was composed from, and the analytics identity it inherits
 * from the Run that caused it. `analyticsContext` resolution stays first-write
 * immutable — a continuation cannot relabel the identity of the task it
 * continues.
 */
export interface RunAnalyticsFacts {
  body: JsonRecord;
  /**
   * Identity of the caller that asked for this Run. Required, and `null` is a
   * real answer: a Run nothing asked for (a scheduled Automation, a background
   * refresh) has no caller to attribute to, and the lifecycle then stays silent
   * rather than inventing one. Making it optional would let a caller drop its
   * identity by forgetting a key, which is the shape of the bug this whole
   * seam exists to prevent.
   */
  requestAnalyticsContext: AnalyticsContext | null;
  /**
   * The resolved plugin snapshot, when the caller had one. Declared as the
   * narrow shape this module actually reads rather than the resolver's full
   * union, so a caller that only holds the successful resolution can hand it
   * over without a cast.
   */
  snapshot?: { ok: boolean; snapshot: AppliedPluginSnapshot } | null;
  creationKind?: 'created' | 'reused';
  resumed?: boolean;
  attributionMismatch?: boolean;
}

/** The facts plus the Run they describe. */
export type RunAnalyticsInstallInput = RunAnalyticsFacts & { run: ChatRun };

async function waitForTerminalClaimSettlementBoundary(): Promise<void> {
  // A physical runtime can report the same terminal outcome through adjacent
  // error/close callbacks. Give callbacks already queued by the first terminal
  // transition one check phase to update the lifecycle before freezing the
  // sole run_finished envelope.
  await scheduler.yield();
}

export interface RunAnalyticsLifecycle {
  /**
   * Arm both events for one physical Run. Safe to call before the Run starts;
   * the terminal half attaches to `runs.wait` and settles on its own.
   */
  install(input: RunAnalyticsInstallInput): void;
}

function runFinishedStorageProperties(
  db: Parameters<typeof readRunStorageAnalytics>[0],
  run: Parameters<typeof runEventStorageShapeAnalytics>[0] & { id: string },
): Record<string, unknown> | null {
  try {
    const properties = {
      ...readRunStorageAnalytics(db, { runId: run.id, assistantMessageId: run.assistantMessageId }),
      ...runEventStorageShapeAnalytics(run),
    };
    return Object.keys(properties).length > 0 ? properties : null;
  } catch {
    return null;
  }
}

export function createRunAnalyticsLifecycle(
  deps: RunAnalyticsLifecycleDeps,
): RunAnalyticsLifecycle {
  const { db, design } = deps;
  const { PROJECTS_DIR, RUNTIME_DATA_DIR } = deps.paths;
  const { detectAgents } = deps.agents;
  const {
    resolveRunProjectKindForAnalytics,
    runArtifactBaselines,
    runRetryEventsForAnalytics,
  } = deps.telemetry;

  const install = (input: RunAnalyticsInstallInput): void => {
    const run = input.run;
    void (async () => {
      const reqBody = input.body;
      const analyticsHints =
        (reqBody as { analyticsHints?: Record<string, unknown> | null }).analyticsHints
          && typeof (reqBody as { analyticsHints?: unknown }).analyticsHints === 'object'
          ? ((reqBody as { analyticsHints?: Record<string, unknown> }).analyticsHints ?? {})
          : {};
      const requestProjectId = typeof reqBody.projectId === 'string' ? reqBody.projectId : null;

      const recoveredAnalyticsContext =
        run.analyticsRecovery
        && typeof run.analyticsRecovery === 'object'
        && (run.analyticsRecovery as { context?: unknown }).context
        && typeof (run.analyticsRecovery as { context?: unknown }).context === 'object'
          ? ((run.analyticsRecovery as { context: AnalyticsContext }).context)
          : null;
      // Source/identity is first-write immutable for a logical run. A retry or
      // recharge resume cannot relabel a prior ordinary request as Plugin (or
      // vice versa) by changing analytics-only headers.
      const analyticsContext =
        run.analyticsContext
        ?? recoveredAnalyticsContext
        ?? input.requestAnalyticsContext
        ?? null;
      if (!run.analyticsContext && analyticsContext) {
        run.analyticsContext = analyticsContext;
      }
      design.runs.wait(run).then((status: { status: string }) => {
      }).catch(() => {});
      if (analyticsContext) {
        const runInsertId = newInsertId();
        const appCfgForAnalytics = await readAppConfig(RUNTIME_DATA_DIR).catch(
          () => ({} as Record<string, unknown>),
        );
        const detectedAgentsForAnalytics = await detectAgents(
          toJsonRecord((appCfgForAnalytics as { agentCliEnv?: unknown }).agentCliEnv),
        ).catch((): Array<{ id: string; available: boolean }> => []);
                const configureGlobals = deriveConfigureGlobals({
          mode: 'daemon',
          agentId: typeof reqBody.agentId === 'string' ? reqBody.agentId : null,
          agents: detectedAgentsForAnalytics,

        });
        const promptText =
          typeof reqBody.currentPrompt === 'string'
            ? reqBody.currentPrompt
            : typeof reqBody.message === 'string'
              ? reqBody.message
              : '';
        const userQueryTokens = promptText.length > 0
          ? Math.ceil(promptText.length / 4)
          : 0;
        const hintEntryFrom = typeof analyticsHints.entryFrom === 'string'
          ? analyticsHints.entryFrom
          : undefined;
        const hintProjectKind = typeof analyticsHints.projectKind === 'string'
          ? analyticsHints.projectKind
          : null;
        const hintTurnIndex = typeof analyticsHints.turnIndex === 'number'
          ? analyticsHints.turnIndex
          : undefined;
        const hintIsFirstRun = typeof analyticsHints.isFirstRun === 'boolean'
          ? analyticsHints.isFirstRun
          : undefined;
        const hintHasExistingArtifact = typeof analyticsHints.hasExistingArtifact === 'boolean'
          ? analyticsHints.hasExistingArtifact
          : undefined;
        const hintProjectTurnIndex = typeof analyticsHints.projectTurnIndex === 'number'
          ? analyticsHints.projectTurnIndex
          : undefined;
        const taskExecutionId = typeof analyticsHints.taskExecutionId === 'string'
          && analyticsHints.taskExecutionId.length > 0
          ? analyticsHints.taskExecutionId
          : run.clientRequestId ?? run.id;
        const initialRunId = typeof analyticsHints.initialRunId === 'string'
          && analyticsHints.initialRunId.length > 0
          ? analyticsHints.initialRunId
          : run.id;
        const taskRunIndex = typeof analyticsHints.taskRunIndex === 'number'
          && Number.isInteger(analyticsHints.taskRunIndex)
          && analyticsHints.taskRunIndex >= 0
          ? analyticsHints.taskRunIndex
          : 0;
        const recoveryActionTypes: ReadonlySet<TrackingRunRecoveryActionType> = new Set([
          'manual_retry',
          'resume_run',
          'authorize_and_retry',
          'switch_model_retry',
          'switch_runtime_retry',
          'question_answer',
        ]);
        const recoveryActionType = typeof analyticsHints.recoveryActionType === 'string'
          && recoveryActionTypes.has(
            analyticsHints.recoveryActionType as TrackingRunRecoveryActionType,
          )
          ? analyticsHints.recoveryActionType as TrackingRunRecoveryActionType
          : undefined;
        const taskLineage: RunTaskLineageProps = {
          task_execution_id: taskExecutionId,
          initial_run_id: initialRunId,
          task_run_index: taskRunIndex,
          ...(typeof analyticsHints.sourceRunId === 'string' && analyticsHints.sourceRunId.length > 0
            ? { source_run_id: analyticsHints.sourceRunId }
            : {}),
          ...(recoveryActionType ? { recovery_action_type: recoveryActionType } : {}),
          ...(typeof analyticsHints.recoveryActionInstanceId === 'string'
            && analyticsHints.recoveryActionInstanceId.length > 0
            ? { recovery_action_instance_id: analyticsHints.recoveryActionInstanceId }
            : {}),
        };
        const conversationTurnIndex = run.conversationId
          ? conversationTurnIndexForRun(db, run.conversationId, run.id)
          : null;
        const sessionDimensionProps = {
          ...(hintTurnIndex !== undefined ? { turn_index: hintTurnIndex } : {}),
          ...(hintIsFirstRun !== undefined ? { is_first_run: hintIsFirstRun } : {}),
          ...(hintProjectTurnIndex !== undefined
            ? { project_turn_index: hintProjectTurnIndex }
            : {}),
          ...(conversationTurnIndex !== null
            ? { conversation_turn_index: conversationTurnIndex }
            : {}),
          ...(hintHasExistingArtifact !== undefined
            ? { has_existing_artifact: hintHasExistingArtifact }
            : {}),
        };
        const runProjectForAnalytics = requestProjectId
          ? toProjectRecord(getProject(db, requestProjectId))
          : null;
        const runProjectKind = resolveRunProjectKindForAnalytics({
          hintProjectKind,
          projectMetadata: runProjectForAnalytics?.metadata,
        });
        const reqContext =
          reqBody.context && typeof reqBody.context === 'object'
            ? (reqBody.context as Record<string, unknown>)
            : {};
        const runMcpServerIds = Array.isArray(reqContext.mcpServerIds)
          ? (reqContext.mcpServerIds as unknown[]).filter(
              (id): id is string => typeof id === 'string',
            )
          : [];
        const runTurnSkillIds = Array.isArray(reqBody.skillIds)
          ? (reqBody.skillIds as unknown[]).filter(
              (id): id is string => typeof id === 'string',
            )
          : [];
        const runSkillIds = [
          ...new Set(
            [reqBody.skillId, ...runTurnSkillIds].filter(
              (id): id is string => typeof id === 'string' && id.length > 0,
            ),
          ),
        ];
        const baseProps: Record<string, unknown> = {
          page_name: 'chat_panel',
          area: 'chat_composer',
          ...configureGlobals,
          runtime_type: runtimeTypeForRunAnalytics({
            derived: configureGlobals.runtime_type,
            hint: analyticsHints.runtimeType,
          }),
          project_id: requestProjectId,
          conversation_id:
            typeof reqBody.conversationId === 'string' ? reqBody.conversationId : null,
          run_id: run.id,
          project_kind: runProjectKind,
          ...(hintEntryFrom ? { entry_from: hintEntryFrom } : {}),
          ...sessionDimensionProps,
          has_attachment: Array.isArray(reqBody.attachments)
            ? (reqBody.attachments as unknown[]).length > 0
            : false,
          user_query_tokens: userQueryTokens,
          model_id: modelIdForTracking(
            typeof reqBody.model === 'string' ? reqBody.model : null,
          ),
          agent_provider_id: agentProviderIdForRunAnalytics({
            agentId: reqBody.agentId,
            byokProvider: reqBody.byokProvider,
          }),
          skill_id: typeof reqBody.skillId === 'string' ? reqBody.skillId : null,
          ...(typeof reqBody.sessionMode === 'string'
            ? { session_mode: sessionModeToTracking(reqBody.sessionMode) }
            : {}),
          plugin_id: input.snapshot?.ok
            ? input.snapshot.snapshot.pluginId
            : typeof reqBody.pluginId === 'string'
              ? reqBody.pluginId
              : null,
          mcp_ids: runMcpServerIds,
          mcp_id: runMcpServerIds[0] ?? null,
          skill_ids: runSkillIds,
          token_count_source: userQueryTokens > 0 ? 'estimated' : 'unknown',
          ...(run.externalPluginAnalytics
            ? {
                entry_surface:
                  run.externalPluginAnalytics.entrySurface,
                host_product:
                  run.externalPluginAnalytics.hostProduct,
                external_plugin_id:
                  run.externalPluginAnalytics.externalPluginId,
                external_plugin_version:
                  run.externalPluginAnalytics.externalPluginVersion,
                distribution_mechanism:
                  run.externalPluginAnalytics.distributionMechanism,
                publisher_class:
                  run.externalPluginAnalytics.publisherClass,
                attribution_quality:
                  run.externalPluginAnalytics.attributionQuality,
                plugin_workflow_id:
                  run.externalPluginAnalytics.pluginWorkflowId,
                logical_request_digest:
                  run.externalPluginAnalytics.logicalRequestDigest,
                logical_request_digest_version:
                  run.externalPluginAnalytics.logicalRequestDigestVersion,
                brief_state:
                  run.externalPluginAnalytics.briefState,
                generation_slo_window_ms:
                  run.externalPluginAnalytics.generationSloWindowMs,
                deduplicated: input.creationKind === 'reused',
                resume: input.resumed === true,
                attempt_count: (run.manualResumeAttemptCount ?? 0) + 1,
                recharge_wait_duration_ms:
                  run.rechargeWaitDurationMs ?? 0,
                ...(input.attributionMismatch
                  ? { source_metadata_mismatch: true }
                  : {}),
              }
            : {}),
        };
        Object.assign(baseProps, buildRunCreatedV4Aliases(baseProps, taskLineage));
        design.runs.setAnalyticsRecovery?.(run, {
          context: analyticsContext,
          properties: baseProps,
          insertId: runInsertId,
        });
        design.analytics.capture({
          eventName: 'run_created',
          context: analyticsContext,
          appVersion: design.getAppVersion(),
          properties: baseProps,
          insertId: runInsertId,
        });
        design.runs.wait(run).then(async (status: TerminalRunStatus) => {
          const appCfgAtFinish = await readAppConfig(RUNTIME_DATA_DIR).catch(
            () => ({} as Record<string, unknown>),
          );
          const result = runResultFromStatus(status.status);
          const errorCode = deriveRunErrorCode(status);
          const failure = classifyRunFailure({
            result,
            status,
            ...(errorCode ? { errorCode } : {}),
            agentId: run.agentId,
            cancelOrigin: run.cancelOrigin ?? null,
            terminalTrigger: run.terminalTrigger ?? null,
            events: run.events,
            admissionEvidence: runAdmissionEvidenceForRun(run),
          });
          const usageAnalytics = scanRunEventsForUsageAnalytics(
            run.events,
            reqBody.model,
            userQueryTokens,
          );
          const perRequestUsage = perRequestUsageForRun(run);
          // Whether this run is a non-first turn in its conversation — i.e. a
          // prior completed assistant turn exists (excluding this run's own
          // placeholder). The session-reuse cache win only applies to follow-up
          // turns, so slicing `first_call_cache_hit_ratio` by this flag is the
          // baseline-vs-optimized comparison. Mirrors server.ts hasPriorAssistantTurn.
          const isFollowupTurn = run.conversationId
            ? Boolean(
                db
                  .prepare(
                    `SELECT 1 FROM messages
                       WHERE conversation_id = ?
                         AND role = 'assistant'
                         AND COALESCE(content, '') <> ''
                         AND id <> COALESCE(?, '')
                       LIMIT 1`,
                  )
                  .get(run.conversationId, run.assistantMessageId ?? ''),
              )
            : false;
          // Resolve the turn's first-call usage (cache-hit of the OPENING model
          // call — the signal session reuse moves). Every coding agent except
          // codex reports per-call usage on the stream, so the forward-scanned
          // first usage event IS the opening call. codex reports only a single
          // cumulative `turn.completed` usage on the stream, so its first stream
          // event is the whole-session aggregate; its real per-call number lives
          // in the rollout `last_token_usage`, read here best-effort.
          const firstCallUsage = await (async (): Promise<{
            first_call_input_tokens?: number;
            first_call_input_tokens_effective?: number;
            first_call_cache_read_input_tokens?: number;
            first_call_cache_creation_input_tokens?: number;
            first_call_cache_hit_ratio?: number;
          } | null> => {
            if (run.agentId === 'codex') {
              // Best-effort: a throw anywhere here (env resolution, rollout read)
              // must degrade to "no codex first-call fields", never bubble to the
              // outer run_finished .catch and drop the whole completion event.
              try {
                const sessionId = codexSessionIdFromRunEvents(run.events);
                const codexHome = (await spawnEnvForAgent(
                  'codex',
                  { ...process.env, PIXO_DATA_DIR: RUNTIME_DATA_DIR },
                  agentCliEnvForAgent(
                    (appCfgAtFinish as { agentCliEnv?: AgentCliEnv }).agentCliEnv,
                    'codex',
                  ),
                )).CODEX_HOME;
                const codexUsage = await readCodexRolloutFirstCall({ codexHome, sessionId });
                return codexUsage
                  ? {
                      ...codexUsage,
                      first_call_input_tokens_effective:
                        codexUsage.first_call_input_tokens,
                    }
                  : null;
              } catch {
                return null;
              }
            }
            if (usageAnalytics.first_call_input_tokens === undefined) return null;
            return {
              first_call_input_tokens: usageAnalytics.first_call_input_tokens,
              ...(usageAnalytics.first_call_input_tokens_effective !== undefined
                ? {
                    first_call_input_tokens_effective:
                      usageAnalytics.first_call_input_tokens_effective,
                  }
                : {}),
              ...(usageAnalytics.first_call_cache_read_input_tokens !== undefined
                ? {
                    first_call_cache_read_input_tokens:
                      usageAnalytics.first_call_cache_read_input_tokens,
                  }
                : {}),
              ...(usageAnalytics.first_call_cache_creation_input_tokens !== undefined
                ? {
                    first_call_cache_creation_input_tokens:
                      usageAnalytics.first_call_cache_creation_input_tokens,
                  }
                : {}),
              ...(usageAnalytics.first_call_cache_hit_ratio !== undefined
                ? { first_call_cache_hit_ratio: usageAnalytics.first_call_cache_hit_ratio }
                : {}),
            };
          })();
          const analyticsCapturedAt = Date.now();
          const timingAnalytics = summarizeRunTimingAnalytics({
            runCreatedAt: run.createdAt,
            runUpdatedAt: run.updatedAt,
            analyticsCapturedAt,
          ...(run.analyticsTelemetry ? { telemetry: run.analyticsTelemetry } : {}),
            events: run.events,
          });
          const toolAnalytics = summarizeToolAnalytics(run.events);
          const toolStreamArtifactCount = (): number => runArtifactCountForRun(run);
          const toolStreamIntentDocumentWritten = (): boolean =>
            runIntentDocumentWritten(run);
          const toolStreamPreviewModuleCount = (): number =>
            runPreviewModuleCountForRun(run);
          const toolStreamFilesWritten = (): number => runFilesWrittenForRun(run);
          let artifactCount: number;
          let artifactsCreated: number | undefined;
          let artifactsModified: number | undefined;
          let intentDocumentWritten: boolean;
          let previewModuleCount: number;
          let filesWritten: number | undefined;
          let artifactDiff: RunArtifactDiff | undefined;
          const artifactOutcome = run.artifactOutcome;
          if (artifactOutcome) {
            artifactCount = artifactOutcome.artifactCount;
            artifactsCreated = artifactOutcome.artifactsCreated;
            artifactsModified = artifactOutcome.artifactsModified;
            intentDocumentWritten = artifactOutcome.diff?.intentDocumentWritten ?? toolStreamIntentDocumentWritten();
            previewModuleCount = artifactOutcome.previewModuleCount;
            filesWritten = artifactOutcome.filesWritten;
            artifactDiff = artifactOutcome.diff;
          } else {
            const artifactBaseline = runArtifactBaselines.take(run.id);
            if (artifactBaseline && !artifactBaseline.contended) {
              let diff: ReturnType<typeof diffRunArtifacts> | null = null;
              try {
                diff = diffRunArtifacts(
                  artifactBaseline.before,
                  snapshotProjectArtifacts(artifactBaseline.cwd),
                );
              } catch {
                diff = null;
              }
              if (diff) {
                artifactDiff = diff;
                artifactCount = diff.touched;
                artifactsCreated = diff.created;
                artifactsModified = diff.modified;
                intentDocumentWritten = diff.intentDocumentWritten ?? false;
                previewModuleCount = diff.previewModuleCount;
                filesWritten = diff.filesWritten;
              } else {
                artifactCount = toolStreamArtifactCount();
                intentDocumentWritten = toolStreamIntentDocumentWritten();
                previewModuleCount = toolStreamPreviewModuleCount();
                filesWritten = toolStreamFilesWritten();
              }
            } else {
              artifactCount = toolStreamArtifactCount();
              intentDocumentWritten = toolStreamIntentDocumentWritten();
              previewModuleCount = toolStreamPreviewModuleCount();
              filesWritten = toolStreamFilesWritten();
            }
          }
          const touchedArtifactPaths = runTouchedArtifactPaths(run);
          const deliverable = run.externalPluginAnalytics
            ? await validateChatRunDeliverable({
                db,
                projectsRoot: PROJECTS_DIR,
                run,
                runStatus: run.status,
                artifactCount,
                ...(touchedArtifactPaths
                  ? { touchedPaths: touchedArtifactPaths }
                  : {}),
              })
            : null;
          if (deliverable) {
            design.runs.setDeliverableValidation?.(run, deliverable);
          }
          const activationMilestones = deriveActivationMilestones({
            result,
            artifactCount,
            capturedAtIso: new Date(analyticsCapturedAt).toISOString(),
          });
          const diagnosticsAnalytics = summarizeRunDiagnosticsForAnalytics({
            events: run.events,
            exitCode: status.exitCode ?? null,
            signal: status.signal ?? null,
            cancelRequested: !!run.cancelRequested,
            firstTokenSeen: Boolean(run.analyticsTelemetry?.firstTokenAt),
            artifactWriteSeen: artifactCount > 0 || intentDocumentWritten || previewModuleCount > 0,
          });
          const finishedModelId = hasExplicitRequestedModelForAnalytics(reqBody.model)
            ? modelIdForTracking(reqBody.model)
            : modelIdForTracking(
                usageAnalytics.agent_reported_model ?? run.resolvedModelId,
              );
          const runtimeVersions = getDetectedRuntimeVersions(run.agentId);
          const agentCliVersion =
            run.preflightAgentCliVersion ?? runtimeVersions?.agentCliVersion;
          for (const [index, retryEvent] of runRetryEventsForAnalytics(run.events).entries()) {
            design.analytics.capture({
              eventName: retryEvent.event,
              context: analyticsContext,
              appVersion: design.getAppVersion(),
              properties: retryEvent.data,
              insertId: `${runInsertId}-${retryEvent.event}-${index}`,
            });
          }
          const clarificationRequested = runAskedUserQuestion(run.events);
          const interactionMode = typeof reqBody.sessionMode === 'string'
            ? sessionModeToTracking(reqBody.sessionMode)
            : undefined;
          const primaryArtifactChange = artifactDiff
            ? primaryArtifactChangeForRun({
                diff: artifactDiff,
                projectKind: runProjectKind,
                hadExistingArtifacts: hintHasExistingArtifact === true,
                ...(interactionMode ? { interactionMode } : {}),
                clarificationRequested,
              })
            : undefined;
          const supportingAssetFilesChanged = artifactDiff
            ? supportingAssetFilesChangedForRun(artifactDiff, runProjectKind)
            : undefined;
          design.runs.beginAnalyticsDelivery?.(run);
          await waitForTerminalClaimSettlementBoundary();
          const terminalLifecycle = run.terminalLifecycle
            ? terminalLifecycleForPosthogLocalQueue(run.terminalLifecycle)
            : undefined;
          const finishedProperties: Record<string, unknown> = {
              ...baseProps,
              ...(run.diagnosticIncidentIds?.length ? { diagnostic_incident_ids: run.diagnosticIncidentIds } : {}),
              stable_prompt_hash: run.promptCache?.stablePromptHash,
              stable_prompt_cache_hit: run.promptCache?.hit,
              stable_prompt_cache_miss_reason: run.promptCache?.missReason,
              // Which stable-prefix input drifted, for miss_reason
              // 'stable-prompt-changed' only. `unattributed` means the prefix
              // moved but no tracked section did — a coverage gap in
              // runtimes/stable-prompt-sections.ts, not a cause.
              stable_prompt_changed_sections: run.promptCache?.changedSections ?? undefined,
              area: 'chat_panel',
              result,
              terminal_integrity: terminalLifecycle?.terminalIntegrity ?? 'canonical',
              ...(terminalLifecycle
                ? {
                    run_attempt: terminalLifecycle.runAttempt,
                    ...(terminalLifecycle.runtimeGenerationId
                      ? { runtime_generation_id: terminalLifecycle.runtimeGenerationId }
                      : {}),
                    termination_origin: terminalLifecycle.terminationOrigin,
                    terminal_persistence_status:
                      terminalLifecycle.terminalPersistence.status,
                    terminal_persistence_error_type:
                      terminalLifecycle.terminalPersistence.errorType,
                    posthog_delivery_status: terminalLifecycle.posthogDelivery.status,
                    posthog_acknowledgement:
                      terminalLifecycle.posthogDelivery.acknowledgement,
                    posthog_delivery_attempt_count:
                      terminalLifecycle.posthogDelivery.attemptCount,
                    posthog_error_type: terminalLifecycle.posthogDelivery.errorType,
                    mature_unfinished_state: terminalLifecycle.unfinishedState,
                    duplicate_terminal_count:
                      terminalLifecycle.duplicateTerminalCount,
                    late_terminal_count: terminalLifecycle.lateTerminalCount,
                  }
                : {}),
              ...(activationMilestones ? { $set_once: activationMilestones } : {}),
              model_id: finishedModelId,
              artifact_count: artifactCount,
              ...(run.externalPluginAnalytics
                ? {
                    deliverable_valid: deliverable?.valid === true,
                    deliverable_validation:
                      deliverable?.valid === true ? 'valid' : 'invalid',
                    artifact_origin_status:
                      run.artifactOriginStatus ?? 'missing_version',
                    ...(run.artifactVersionId
                      ? { artifact_version_id: run.artifactVersionId }
                      : {}),
                    resume: (run.manualResumeAttemptCount ?? 0) > 0,
                    attempt_count: (run.manualResumeAttemptCount ?? 0) + 1,
                    recharge_wait_duration_ms:
                      run.rechargeWaitDurationMs ?? 0,
                  }
                : {}),
              ...(artifactsCreated !== undefined ? { artifacts_created: artifactsCreated } : {}),
              ...(artifactsModified !== undefined ? { artifacts_modified: artifactsModified } : {}),
              ...(filesWritten !== undefined ? { files_written_count: filesWritten } : {}),
              asked_user_question: clarificationRequested,
              retry_attempt_count: run.retryAttemptCount ?? 0,
              retry_final_result: run.retryFinalResult ?? 'not_attempted',
              ...(agentCliVersion
                ? { agent_cli_version: agentCliVersion }
                : {}),
              ...(run.retryOriginalFailure?.failure_category
                ? {
                    retry_original_failure_category:
                      run.retryOriginalFailure.failure_category,
                  }
                : {}),
              ...(run.retryOriginalFailure?.failure_detail
                ? {
                    retry_original_failure_detail:
                      run.retryOriginalFailure.failure_detail,
                  }
                : {}),
              ...(run.retryOriginalFailure?.failure_stage
                ? {
                    retry_original_failure_stage:
                      run.retryOriginalFailure.failure_stage,
                  }
                : {}),
              ...(run.retrySuppressedReason
                ? { retry_suppressed_reason: run.retrySuppressedReason }
                : {}),
              ...timingAnalytics,
              ...diagnosticsAnalytics,
              // E-lite: `approval_requested`/`tool_result_sent` ride in via
              // `...diagnosticsAnalytics`; these two come off the run object.
              stdin_backpressure: run.stdinBackpressure === true,
              ...(typeof run.lastAgentActivityAt === 'number'
                ? { last_progress_age_ms: Math.max(0, analyticsCapturedAt - run.lastAgentActivityAt) }
                : {}),
              ...(errorCode ? { error_code: errorCode } : {}),
              ...(failure ?? {}),
              ...(usageAnalytics.input_tokens !== undefined
                ? { input_tokens: usageAnalytics.input_tokens }
                : {}),
              ...(usageAnalytics.input_tokens_provider !== undefined
                ? { input_tokens_provider: usageAnalytics.input_tokens_provider }
                : {}),
              ...(usageAnalytics.input_tokens_effective !== undefined
                ? { input_tokens_effective: usageAnalytics.input_tokens_effective }
                : {}),
              ...(usageAnalytics.output_tokens !== undefined
                ? { output_tokens: usageAnalytics.output_tokens }
                : {}),
              ...(usageAnalytics.total_tokens !== undefined
                ? { total_tokens: usageAnalytics.total_tokens }
                : {}),
              ...(usageAnalytics.thought_tokens !== undefined
                ? { thought_tokens: usageAnalytics.thought_tokens }
                : {}),
              ...(usageAnalytics.cache_read_input_tokens !== undefined
                ? { cache_read_input_tokens: usageAnalytics.cache_read_input_tokens }
                : {}),
              ...(usageAnalytics.cache_creation_input_tokens !== undefined
                ? {
                    cache_creation_input_tokens:
                      usageAnalytics.cache_creation_input_tokens,
                  }
                : {}),
              ...(usageAnalytics.uncached_input_tokens !== undefined
                ? { uncached_input_tokens: usageAnalytics.uncached_input_tokens }
                : {}),
              ...(usageAnalytics.estimated_context_tokens !== undefined
                ? { estimated_context_tokens: usageAnalytics.estimated_context_tokens }
                : {}),
              ...(usageAnalytics.cache_hit_ratio !== undefined
                ? { cache_hit_ratio: usageAnalytics.cache_hit_ratio }
                : {}),
              // First-call cache-hit of the turn's opening model call (per-call
              // usage for Claude/OpenCode from the stream; Codex from
              // its rollout). Sliced by is_followup_turn, this isolates the
              // session-reuse cache win on non-first turns.
              ...(firstCallUsage ?? {}),
              is_followup_turn: isFollowupTurn,
              cache_token_source: usageAnalytics.cache_token_source,
              // Prefer provider scan over run_created baseProps (`estimated`).
              token_count_source: usageAnalytics.token_count_source,
              // Per-request token coverage (#4610): how many model requests in
              // this run carry a per-request usage record (request_id + tokens),
              // and whether their token sum reconciles with the run-level
              // aggregate above. Lifts request-level cost/percentile analysis off
              // the ~0.9% floor for claude_code.
              request_usage_count: perRequestUsage.request_count,
              ...(perRequestUsage.input_tokens_sum !== undefined
                ? { request_usage_input_tokens_sum: perRequestUsage.input_tokens_sum }
                : {}),
              ...(perRequestUsage.output_tokens_sum !== undefined
                ? { request_usage_output_tokens_sum: perRequestUsage.output_tokens_sum }
                : {}),
              ...(perRequestUsage.reconciles_aggregate !== null
                ? { request_usage_reconciles_aggregate: perRequestUsage.reconciles_aggregate }
                : {}),
              tool_error_count: toolAnalytics.tool_error_count,
              tool_name_count: toolAnalytics.tool_name_count,
              tool_names: toolAnalytics.tool_names_csv,
              ...runMessageEventPersistenceAnalytics(run),
            };
          Object.assign(
            finishedProperties,
            buildRunFinishedV4Aliases(finishedProperties, taskLineage, {
              inputAccountingMode: usageAnalytics.input_accounting_mode,
              ...(firstCallUsage
                ? {
                    firstModelCall: {
                      ...(firstCallUsage.first_call_input_tokens !== undefined
                        ? { provider_input_tokens: firstCallUsage.first_call_input_tokens }
                        : {}),
                      ...(firstCallUsage.first_call_input_tokens_effective !== undefined
                        ? { effective_input_tokens: firstCallUsage.first_call_input_tokens_effective }
                        : {}),
                      ...(firstCallUsage.first_call_cache_read_input_tokens !== undefined
                        ? { cache_read_tokens: firstCallUsage.first_call_cache_read_input_tokens }
                        : {}),
                      ...(firstCallUsage.first_call_cache_creation_input_tokens !== undefined
                        ? { cache_write_tokens: firstCallUsage.first_call_cache_creation_input_tokens }
                        : {}),
                    },
                  }
                : {}),
              ...(primaryArtifactChange
                ? { primaryArtifactChange }
                : {}),
              ...(artifactDiff
                ? {
                    artifactFiles: {
                      changed_file_count: artifactDiff.contentTouched,
                      created_file_count: artifactDiff.contentCreated,
                      modified_file_count: artifactDiff.contentModified,
                      ...(supportingAssetFilesChanged !== undefined
                        ? {
                            supporting_asset_files_changed_count:
                              supportingAssetFilesChanged,
                          }
                        : {}),
                    },
                  }
                : {}),
            }),
          );
          // Refresh local recovery snapshot so crash recovery matches PostHog
          // `run_finished` (usage/timing/tools), not only run_created baseProps.
          // Keep the base insertId here: reconcileDurableRunTerminals appends
          // `-finish` when replaying. Storing `${runInsertId}-finish` would
          // produce `…-finish-finish` and can duplicate PostHog events.
          design.runs.setAnalyticsRecovery?.(run, {
            context: analyticsContext,
            properties: finishedProperties,
            insertId: runInsertId,
          });
          // Storage observability rides only on the emitted copy: the recovery
          // snapshot above and `finishedProperties` itself stay unchanged, and
          // a startup replay re-measures from SQLite instead.
          const storageProperties = runFinishedStorageProperties(db, run);
          let captureResult: AnalyticsCaptureResult;
          try {
            captureResult = normalizeAnalyticsCaptureResult(
              await Promise.resolve(design.analytics.capture({
                eventName: 'run_finished',
                context: analyticsContext,
                appVersion: design.getAppVersion(),
                properties: storageProperties
                  ? { ...finishedProperties, ...storageProperties }
                  : finishedProperties,
                insertId: `${runInsertId}-finish`,
              })),
            );
          } catch {
            captureResult = {
              status: 'failed',
              acknowledgement: 'none',
              errorType: 'enqueue_failed',
            };
          }
          design.runs.finalizeAnalyticsDelivery?.(run, captureResult);
          if (captureResult.status !== 'failed') {
            design.runs.markAnalyticsCompleted?.(run);
          }
        }).catch(() => {});
      }
    })().catch(() => {
      // An observer must never take the Run down with it.
    });
  };

  return { install };
}
