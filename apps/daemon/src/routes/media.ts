import fs from 'node:fs';
import type { Express } from 'express';
import type {
  GetMediaCapabilitiesResponse,
  HyperFramesScaffoldRequest,
  HyperFramesScaffoldResponse,
  MediaExecutionPolicy,
  MediaGenerationResultProps,
  ProjectFile,
  ProjectMediaTaskFile,
} from '@openpixo/contracts';
import type { AnalyticsContext } from '../analytics.js';
import { defaultMediaExecutionPolicy, mediaPolicyDenial } from '../media/policy.js';
import { formatMediaTaskDiagnostic } from '../media/diagnostics.js';
import { findMediaModel, hostedAudioKind, hostedAudioParams, hostedModelSurface, type MediaModel } from '../media/models.js';
import { ImageOutputSizeError, OPENPIXO_MEDIA_PROVIDER_ID, hostedResolution, resolveImageOutputSize } from '@openpixo/contracts';
import { AccountError } from '../account/errors.js';
import { CLOUD_REQUEST_ID } from '../account/cloud-media.js';
import { accountError } from '../account/errors.js';
import { resolveProjectImageRefs } from '../media/index.js';
import type { OpenPixoHostedMedia } from '../media/openpixo-hosted.js';
import { prepareAgentHostedRequest, type AgentHostedRequest } from '../game/art-budget-spend.js';
import { hostedImageModelForReferences, referenceImageCount, styleReferenceRefusal, type HostedImageModelChoice } from '../media/hosted-image-service.js';
import { projectStyleReference } from '../styles/reference.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
import { configuredRecipeProviders } from '../recipes/models.js';

import type { ImageGenerationRequestSummary } from '../media/image-generation-retry.js';
import type { RouteDeps } from '../server-context.js';
import type {
  AuthorizeProjectRequest,
  AuthorizeProjectToolRequest,
} from '../projects/project-access.js';
import { proxyDispatcherRequestInit } from '../connectionTest.js';
import {
  aihubmixCatalogUrl,
  parseAIHubMixCatalog,
  AIHUBMIX_DEFAULT_BASE_URL,
  type AIHubMixCatalogType,
} from '../integrations/aihubmix.js';
import { isSandboxModeEnabled } from '../sandbox-mode.js';
import { createChatArtifactBlobStore } from '../chat-artifacts/blob-store.js';
import { captureChatArtifactSnapshotFromBytes } from '../chat-artifacts/capture.js';
import { resolveChatArtifactQuota } from '../chat-artifacts/quota.js';
import {
  HYPERFRAMES_SCAFFOLD_TOOL_ENDPOINT,
  MEDIA_TASK_WAIT_TOOL_ENDPOINT,
  type ToolTokenGrant,
} from '../tool-tokens.js';
import { associateLateRunProducedFile } from '../runtimes/run-produced-files.js';
import { scaffoldHyperFramesComposition } from '../media/hyperframes-scaffold.js';
import { assignMediaTaskBatches } from '../media/task-batches.js';
import { mediaTaskErrorFromFailure } from '../media/task-error.js';
import { resolveSheetRequest } from '../media/sheet-request.js';
import type { ImageSheetPlan } from '../media/image-sheet.js';
import { mergeImageArtStyle } from '../media/art-style.js';
import { resolveArtStyleForGeneration } from '../styles/service.js';


const LONG_MEDIA_PROXY_TIMEOUT_MS = 10 * 60 * 1000;
const MEDIA_FILE_MTIME_TOLERANCE_MS = 1;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Files a media task's recorded metadata could still be, after the agent moved
 * or renamed it.
 *
 * An in-project move preserves size and mtime, so the pair is a bounded
 * identity witness that needs no filename guessing. The tolerance absorbs a
 * destination filesystem storing fewer sub-millisecond digits than the source;
 * it is deliberately far below any real filesystem's timestamp granularity,
 * because a wider window buys nothing for a move (which preserves the value
 * exactly) and only makes unrelated files collide. A witness that has drifted
 * past it is not a witness, and staying blind beats showing the wrong image.
 *
 * `claimedNames` are files another task has already proven it owns. A witness
 * may never point at one of those: two chat cards showing the same image is
 * the same lie as one card showing a stranger's.
 */
function mediaTaskFileCandidates(
  taskFile: unknown,
  projectFiles: readonly ProjectFile[],
  claimedNames: ReadonlySet<string>,
): ProjectFile[] {
  if (!taskFile || typeof taskFile !== 'object') return [];
  const file = taskFile as Partial<ProjectMediaTaskFile>;
  const name = typeof file.name === 'string' ? file.name.trim() : '';
  if (!name) return [];

  const size = finiteNumber(file.size);
  const mtime = finiteNumber(file.mtime);
  if (size === null || mtime === null) return [];
  const kind = typeof file.kind === 'string' && file.kind ? file.kind : null;
  return projectFiles.filter((candidate) => (
    !claimedNames.has(candidate.name)
    && candidate.size === size
    && Math.abs(candidate.mtime - mtime) <= MEDIA_FILE_MTIME_TOLERANCE_MS
    && (kind === null || candidate.kind === kind)
  ));
}

/**
 * Resolve one media task's generation-time file metadata to the path that is
 * currently registered in the project. Ambiguous matches fail closed so
 * ChatPanel never previews an unrelated file.
 */
export function resolveMediaTaskProjectFile(
  taskFile: unknown,
  projectFiles: ProjectFile[],
  claimedNames: ReadonlySet<string> = new Set(),
): ProjectFile | null {
  if (!taskFile || typeof taskFile !== 'object') return null;
  const file = taskFile as Partial<ProjectMediaTaskFile>;
  const name = typeof file.name === 'string' ? file.name.trim() : '';
  if (!name) return null;

  if (!claimedNames.has(name)) {
    const exact = projectFiles.find((candidate) => candidate.name === name);
    if (exact) return exact;
  }

  const matches = mediaTaskFileCandidates(taskFile, projectFiles, claimedNames);
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Resolve every moved media task against the project at once, so no surviving
 * file is handed to two of them.
 *
 * Per-task uniqueness is not enough: two tasks that recorded the same witness
 * each see exactly one candidate and each would take it. A file that more than
 * one task can claim proves nothing about either, so it is withdrawn from all
 * of them — the same fail-closed rule, applied across tasks instead of within
 * one.
 */
export function resolveMovedMediaTaskFiles(
  candidates: ReadonlyArray<{ taskId: string; file: unknown }>,
  projectFiles: readonly ProjectFile[],
  claimedNames: ReadonlySet<string> = new Set(),
): Map<string, ProjectFile> {
  const matchesByTask = new Map<string, ProjectFile[]>();
  const claimCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const matches = mediaTaskFileCandidates(candidate.file, projectFiles, claimedNames);
    matchesByTask.set(candidate.taskId, matches);
    for (const match of matches) {
      claimCounts.set(match.name, (claimCounts.get(match.name) ?? 0) + 1);
    }
  }

  const resolved = new Map<string, ProjectFile>();
  for (const [taskId, matches] of matchesByTask) {
    const uncontested = matches.filter((match) => (claimCounts.get(match.name) ?? 0) === 1);
    const only = uncontested.length === 1 ? uncontested[0] : undefined;
    if (only) resolved.set(taskId, only);
  }
  return resolved;
}

function reconciledMediaTaskFile(
  taskFile: unknown,
  projectFile: ProjectFile,
): Record<string, unknown> {
  const original = taskFile && typeof taskFile === 'object'
    ? taskFile as Record<string, unknown>
    : {};
  return {
    ...original,
    name: projectFile.name,
    size: projectFile.size,
    mtime: projectFile.mtime,
    kind: projectFile.kind,
    mime: projectFile.mime,
  };
}

function mediaProviderId(model: string): string | undefined {
  const registered = findMediaModel(model)?.provider;
  if (registered) return registered;
  if (model.startsWith('fal-ai/')) return 'media-gateway';
  if (model.startsWith('aihubmix-')) return 'aihubmix';
  return undefined;
}

// Short in-memory cache for the AIHubMix media catalogue so the picker can
// refresh without hammering the upstream public endpoint. Keyed by
// `${baseUrl}|${type}`. Values expire after AIHUBMIX_CATALOG_TTL_MS.
const AIHUBMIX_CATALOG_TTL_MS = 5 * 60 * 1000;
const aihubmixCatalogCache = new Map<string, { at: number; models: Array<{ id: string; label: string }> }>();

export interface RegisterMediaRoutesDeps extends RouteDeps<'db' | 'design' | 'http' | 'paths' | 'ids' | 'auth' | 'media' | 'appConfig' | 'nativeDialogs' | 'projectStore' | 'projectFiles' | 'conversations' | 'research'> {
  authorizeProjectRequest: AuthorizeProjectRequest;
  authorizeProjectToolRequest: AuthorizeProjectToolRequest;
}

export type LegacyMediaRouteGrantDecision =
  | { ok: true; grant: ToolTokenGrant | null }
  | {
      ok: false;
      code: string;
      details?: Record<string, unknown>;
      message: string;
      status: number;
    };

export function resolveLegacyMediaRouteGrant(input: {
  grant: ToolTokenGrant | null;
  projectId: string;
  requestProjectOverride: (projectId: string, tokenProjectId: string) => boolean;
  sandboxMode: boolean;
}): LegacyMediaRouteGrantDecision {
  if (
    input.sandboxMode &&
    input.grant &&
    input.requestProjectOverride(input.projectId, input.grant.projectId)
  ) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      details: { suppliedProjectId: input.projectId },
      message: 'projectId is derived from the tool token',
      status: 403,
    };
  }

  if (!input.grant && input.sandboxMode) {
    return {
      ok: false,
      code: 'TOOL_TOKEN_MISSING',
      message: 'tool token is required for media generation in sandbox mode',
      status: 401,
    };
  }

  return { ok: true, grant: input.grant };
}

export { mediaTaskErrorFromFailure };

export function registerMediaRoutes(app: Express, ctx: RegisterMediaRoutesDeps) {
  const { db, design } = ctx;
  const { sendApiError, requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  const { PROJECT_ROOT, PROJECTS_DIR, RUNTIME_DATA_DIR } = ctx.paths;
  // Derived from the one resolved daemon data root; the store rejects anything
  // else, so there is no second data root to drift.
  const chatArtifactBlobs = createChatArtifactBlobStore({ dataDir: RUNTIME_DATA_DIR });
  const chatArtifactQuota = resolveChatArtifactQuota(process.env);
  const { authorizeToolRequest, optionalToolGrantFromRequest, requestProjectOverride } = ctx.auth;
  const { randomUUID } = ctx.ids;
  const { MEDIA_PROVIDERS, IMAGE_MODELS, VIDEO_MODELS, MODEL3D_MODELS, AUDIO_MODELS_BY_KIND, MEDIA_ASPECTS, VIDEO_LENGTHS_SEC, AUDIO_DURATIONS_SEC, readMaskedConfig, writeConfig, generateMedia, createMediaTask, persistMediaTask, appendTaskProgress, notifyTaskWaiters, getLiveMediaTask, mediaTaskSnapshot, listMediaTasksByProject, listElevenLabsVoiceOptions } = ctx.media;
  const { readAppConfig, writeAppConfig } = ctx.appConfig;
  const onAppConfigWritten =
    typeof ctx.appConfig.onAppConfigWritten === 'function'
      ? ctx.appConfig.onAppConfigWritten
      : null;

  const { openBrowser, openNativeFolderDialog } = ctx.nativeDialogs;
  const { getProject } = ctx.projectStore;
  const { listFiles, resolveProjectDir, resolveProjectFilePath } = ctx.projectFiles;
  const { insertConversation, upsertMessage } = ctx.conversations;
  const { searchResearch, ResearchError } = ctx.research;
  const getResolvedPort = () => resolvedPortRef.current;

  const mediaPolicyForGrant = (grant: ToolTokenGrant | null):
    | { ok: true; policy: MediaExecutionPolicy }
    | { ok: false; code: string; message: string } => {
    if (!grant?.runId) return { ok: true, policy: defaultMediaExecutionPolicy() };
    const run = design.runs.get(grant.runId);
    if (!run) {
      return {
        ok: false,
        code: 'MEDIA_POLICY_UNAVAILABLE',
        message: 'media generation policy is unavailable for this run',
      };
    }
    return { ok: true, policy: run.mediaExecution ?? defaultMediaExecutionPolicy() };
  };

  const mediaAnalyticsContext = async (
    req: any,
    grant: ToolTokenGrant | null,
  ): Promise<AnalyticsContext | null> => {
    const requestContext = design.readAnalyticsContext(req);
    if (requestContext) return requestContext;

    const runContext = grant?.runId
      ? design.runs.get(grant.runId)?.analyticsContext ?? null
      : null;
    if (runContext) return runContext;

    // Standalone `pixo media generate` requests do not carry browser analytics
    // headers or a parent run. Match the updater's daemon-internal identity
    // fallback, but only after explicit metrics consent; capture() re-checks
    // the same consent before sending.
    const appConfig = await readAppConfig(RUNTIME_DATA_DIR).catch(() => null);
    const installationId =
      appConfig?.telemetry?.metrics === true
      && typeof appConfig.installationId === 'string'
      && appConfig.installationId
        ? appConfig.installationId
        : null;
    if (!installationId) return null;
    return {
      deviceId: installationId,
      sessionId: installationId,
      clientType: 'desktop',
      locale: 'en',
      requestId: null,
    };
  };

  const handleGenerate = async (
    req: any,
    res: any,
    options: { projectId: string; grant: ToolTokenGrant | null },
  ) => {
    const projectId = options.projectId;
    const project = getProject(db, projectId);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const surface = req.body?.surface;
    if (surface !== 'image' && surface !== 'video' && surface !== 'audio' && surface !== 'model3d') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'surface must be image, video, audio or model3d');
    }
    if (surface === 'model3d' && !req.body?.image && !(Array.isArray(req.body?.images) && req.body.images.length)) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'A 3D model is made from one image: pass --image <project-relative path>');
    }
    const requestedModel = typeof req.body?.model === 'string' ? req.body.model : req.body?.provider === 'codex-cli' ? 'codex-image' : '';
    if (!requestedModel) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'model is required');
    }
    const hostedImageChoice: HostedImageModelChoice = options.grant && surface === 'image'
      ? hostedImageModelForReferences(requestedModel, referenceImageCount(req.body))
      : { model: requestedModel };
    const model = hostedImageChoice.model;
    if (options.grant && surface === 'image') {
      const refusal = styleReferenceRefusal(projectStyleReference(project.metadata), referenceImageCount(req.body), req.body?.noReference);
      if (refusal) return sendApiError(res, 400, 'STYLE_REFERENCE_CHOICE_REQUIRED', refusal);
    }
    if (req.body?.count !== undefined && (!Number.isInteger(req.body.count) || req.body.count < 1 || req.body.count > 4)) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'count must be an integer from 1 to 4');
    }
    if (req.body?.styleId !== undefined && req.body.styleId !== null && (typeof req.body.styleId !== 'string' || !req.body.styleId.trim())) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'styleId must be a non-empty string or null');
    }
    if (req.body?.background !== undefined && req.body.background !== 'transparent' && req.body.background !== 'scene') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'background must be transparent or scene');
    }
    // Shape errors are the caller's to fix; out-of-range sizes are clamped later
    // by the same rule and reported as warnings on the task file.
    const hasSize = req.body?.width !== undefined || req.body?.height !== undefined;
    if (hasSize && surface !== 'image') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'width and height apply to image generation only');
    }
    try {
      resolveImageOutputSize({ width: req.body?.width, height: req.body?.height, aspect: req.body?.aspect });
    } catch (error) {
      if (error instanceof ImageOutputSizeError) return sendApiError(res, 400, 'BAD_REQUEST', error.message);
      throw error;
    }

    // A sheet is generated as one image with no size, then cut: the request's size is
    // each piece's. The layout goes into the prompt here, before any pricing, so the
    // quoted request is the one sent.
    let sheetPlan: ImageSheetPlan | null = null;
    let body = model === requestedModel ? req.body ?? {} : { ...req.body, model };
    if (body.sheet !== undefined) {
      const resolved = resolveSheetRequest(body, findMediaModel(model)?.provider);
      if (!resolved.ok) return sendApiError(res, 400, 'BAD_REQUEST', resolved.message);
      sheetPlan = resolved.plan;
      body = resolved.body;
    }

    const policy = mediaPolicyForGrant(options.grant);
    if (!policy.ok) {
      return sendApiError(res, 403, policy.code, policy.message);
    }
    const denial = mediaPolicyDenial(policy.policy, { surface, model });
    if (denial) {
      return sendApiError(res, 403, denial.code, denial.message);
    }

    // OpenPixo-hosted models spend credits, on one of two authorities. The user
    // confirms a quote, in the app or by running `pixo media generate` themselves.
    // An agent's tool token has only the art budget the user set, below: it can
    // authorize no quote, price or request id, whatever it puts in the body.
    const hostedModel = findMediaModel(model)?.provider === OPENPIXO_MEDIA_PROVIDER_ID;
    let hosted: { quoteId: string; cloudRequestId: string; style?: string } | AgentHostedRequest | undefined;
    let budgetRequestId: string | null = null;
    if (hostedModel) {
      // Checked before any pricing, so a wrong surface or a nonsense length never reaches a quote.
      if (surface !== hostedModelSurface(findMediaModel(model)?.id)) {
        return sendApiError(res, 400, 'GENERATION_PARAMS_INVALID', `${model} does not make --surface ${surface}.`);
      }
      const hostedDuration = body?.duration;
      if (hostedDuration !== undefined && (typeof hostedDuration !== 'number' || !Number.isFinite(hostedDuration) || hostedDuration <= 0)) {
        return sendApiError(res, 400, 'GENERATION_PARAMS_INVALID', 'duration must be a positive number of seconds.');
      }
    }
    if (hostedModel && !options.grant) {
      const confirm = new AccountError('GENERATION_CONFIRMATION_REQUIRED');
      const { quoteId, cloudRequestId } = body;
      // A voice is the service's style, and it has to reach the cloud the way it was quoted.
      const audioKind = hostedAudioKind(findMediaModel(model)?.id);
      const style = audioKind ? hostedAudioParams(audioKind, body).style : body?.style;
      if (typeof quoteId !== 'string' || !UUID_PATTERN.test(quoteId)) return sendApiError(res, 400, confirm.code, confirm.message);
      if (typeof cloudRequestId !== 'string' || !CLOUD_REQUEST_ID.test(cloudRequestId)
        || (style !== undefined && (typeof style !== 'string' || !style || style.length > 100))) {
        return sendApiError(res, 400, 'GENERATION_PARAMS_INVALID', 'cloudRequestId (8-200 safe characters) is required; style must be a short string.');
      }
      hosted = { quoteId, cloudRequestId, ...(style ? { style } : {}) };
    }

    /**
     * The dual of `attachLateOutputToRunMessage` below: hand the FAILURE back to
     * the turn that asked for it.
     *
     * Every failure path here already knew which run this was — `runId` is right
     * there in `options.grant`, printed in the `[media]` diagnostic and shipped
     * to analytics — and none of them wrote it anywhere the run could see. So
     * the run's terminal verdict came from the agent's exit code alone: the
     * agent apologises in prose and exits 0, and the turn published
     * `status: "succeeded"`, `endedWithUnfinishedWork: false`, a green check and
     * an empty artifact rail while the daemon's own log said the only
     * deliverable had failed 55s earlier.
     *
     * Declared outside the try so BOTH failure paths reach it: the async
     * provider rejection AND the synchronous dispatch throw below, which marks
     * the same task failed and would otherwise stay silent for the same reason.
     *
     * Best-effort by construction: the task is already marked failed and its
     * waiters already told, so this must never turn a recorded failure into an
     * unhandled rejection.
     */
    const reportFailureToRun = (taskId: string, error: unknown): void => {
      const runId = options.grant?.runId;
      if (!runId || !taskId) return;
      try {
        design.runs.noteMediaTaskFailure(runId, {
          taskId,
          surface,
          model,
          failedAt: Date.now(),
          error,
        });
      } catch (err) {
        console.warn('[media] run failure association failed', err);
      }
    };

    const artStyle = surface === 'image'
      ? await resolveArtStyleForGeneration(db, PROJECT_ROOT, projectId, body?.styleId)
      : null;
    const imageRequest = surface === 'image'
      ? mergeImageArtStyle({
          prompt: typeof body?.prompt === 'string' ? body.prompt : undefined,
          negativePrompt: typeof body?.negativePrompt === 'string' ? body.negativePrompt : undefined,
          resolution: typeof body?.resolution === 'string' ? body.resolution : undefined,
          background: body?.background === 'transparent' || body?.background === 'scene' ? body.background : undefined,
        }, artStyle)
      : null;
    if (hostedModel && options.grant) {
      const decision = await prepareAgentHostedRequest({
        ledger: ctx.media.artBudget, hosted: ctx.media.openpixoHosted, grant: options.grant, projectId, metadata: project.metadata,
        projectDir: resolveProjectDir(PROJECTS_DIR, projectId, project.metadata), service: model, surface, prompt: imageRequest?.prompt ?? body?.prompt,
        pixelArt: artStyle?.constraints?.pixelSize !== undefined, body: body,
      });
      if (!decision.ok) return sendApiError(res, decision.status, decision.code, decision.message);
      // The hosted module writes the finished file itself too, so its notes travel with the request.
      const notes = hostedImageChoice.note ? [hostedImageChoice.note] : [];
      hosted = notes.length ? { ...decision.hosted, warnings: [...notes, ...decision.hosted.warnings] } : decision.hosted;
      budgetRequestId = decision.hosted.cloudRequestId;
    }
    // A reservation is given back only when nothing was ever sent to the cloud; every
    // outcome after that is the hosted module's to report, from what the cloud proves.
    const releaseUnsentBudgetCharge = () => {
      if (budgetRequestId) ctx.media.artBudget.releaseIfNeverSubmitted(budgetRequestId);
    };
    let task: ReturnType<typeof createMediaTask> | null = null;
    try {
      const taskId = randomUUID();
      const analyticsContext = await mediaAnalyticsContext(req, options.grant);
      let providerRequestSummary:
        | (ImageGenerationRequestSummary & { providerId: string })
        | null = null;
      task = createMediaTask(taskId, projectId, {
        surface: body?.surface,
        model: body?.model,
        runId: options.grant?.runId,
      });
      const requestedProviderId = mediaProviderId(model);
      const diagnosticContext = {
        taskId,
        runId: options.grant?.runId,
        projectId,
        surface,
        model,
      };
      console.error(formatMediaTaskDiagnostic({
        ...diagnosticContext,
        event: 'queued',
        providerId: requestedProviderId,
        status: task.status,
        referenceImageCount: Array.isArray(body?.images)
          ? body.images.length
          : body?.image
            ? 1
            : 0,
        hasCompositionDir: Boolean(body?.compositionDir),
      }));

      /**
       * Hand this task's output back to the turn that asked for it.
       *
       * A media generation is a 202 dispatch: the file can land long after the
       * run went terminal, and the run-terminal produced-file floor works off a
       * filesystem diff frozen before these bytes existed (Plane OPEND-2608 /
       * OPEND-2609). `associateLateRunProducedFile` is additive and refuses to
       * act while the run is still live, so the terminal pass keeps ownership
       * of every file that DID land in time.
       *
       * Resolves the same managed or imported project root as `generateMedia`.
       */
      const attachLateOutputToRunMessage = async (meta: unknown): Promise<void> => {
        const runId = options.grant?.runId;
        const name =
          meta && typeof meta === 'object' && typeof (meta as { name?: unknown }).name === 'string'
            ? (meta as { name: string }).name
            : '';
        if (!runId || !name) return;
        try {
          await associateLateRunProducedFile(db, {
            runId,
            projectRoot: resolveProjectDir(PROJECTS_DIR, projectId, project.metadata),
            projectRelativePath: name,
          });
        } catch (err) {
          console.warn('[media] late produced-file association failed', err);
        }
      };

      const proxyDispatcher = await proxyDispatcherRequestInit(process.env, {
        headersTimeout: LONG_MEDIA_PROXY_TIMEOUT_MS,
        bodyTimeout: LONG_MEDIA_PROXY_TIMEOUT_MS,
      });
      task.status = 'running';
      persistMediaTask(task);
      // Media billing follows the project's Workspace binding, not its sharing
      // visibility. A private project inside a team Workspace must still spend
      // that Workspace's balance; `findTeamWorkspaceIdForProject` deliberately

            generateMedia({
        projectRoot: PROJECT_ROOT,
        projectsRoot: PROJECTS_DIR,
        projectId,
        metadata: project.metadata,
        surface: body?.surface,
        model,
        provider: typeof body?.provider === 'string' ? body.provider : undefined,
        count: body?.count,
        background: body?.background,
        runtimeDataDir: RUNTIME_DATA_DIR,
        // A user's hosted request must reach the cloud exactly as they saw it quoted, so
        // no art-style rewrite. An agent's was merged before the daemon priced it.
        prompt: hosted && !options.grant ? body?.prompt : imageRequest?.prompt ?? body?.prompt,
        hosted: hosted ? { ...hosted, taskId } : undefined,
        output: body?.output,
        aspect: body?.aspect,
        quality: typeof body?.quality === 'string' ? body.quality : undefined,
        resolution: imageRequest?.resolution ?? (typeof body?.resolution === 'string' ? body.resolution : undefined),
        width: typeof body?.width === 'number' ? body.width : undefined,
        height: typeof body?.height === 'number' ? body.height : undefined,
        pixelArt: artStyle?.constraints?.pixelSize !== undefined,
        sheet: sheetPlan ? { ...sheetPlan, pixelArt: artStyle?.constraints?.pixelSize !== undefined } : null,
        length:
          typeof body?.length === 'number' ? body.length : undefined,
        duration:
          typeof body?.duration === 'number'
            ? body.duration
            : undefined,
        voice: body?.voice,
        audioKind: body?.audioKind,
        language: typeof body?.language === 'string' ? body.language : undefined,
        loop: typeof body?.loop === 'boolean' ? body.loop : undefined,
        promptInfluence: typeof body?.promptInfluence === 'number'
          ? body.promptInfluence
          : undefined,
        compositionDir: body?.compositionDir,
        image: body?.image,
        images: Array.isArray(body?.images) ? body.images : undefined,

        // Strong capture path (spec §5.1.1): freeze the provider's own bytes
        // the moment they land, so a later turn overwriting the same output
        // name can never rewrite this message's history. Bound to THIS run and
        // task, so the run-terminal pass can reuse it verbatim instead of
        // re-reading a file that may already have moved on.
        onBytesWritten: async (written: {
          bytes: Buffer;
          name: string;
          mime: string;
          kind: string;
          mtime: number;
        }) => {
          await captureChatArtifactSnapshotFromBytes(
            { db, blobs: chatArtifactBlobs, quota: chatArtifactQuota },
            {
              projectId,
              projectRelativePath: written.name,
              kind: written.kind,
              mime: written.mime,
              bytes: written.bytes,
              sourceMtime: written.mtime,
              ...(options.grant?.runId ? { runId: options.grant.runId } : {}),
              mediaTaskId: taskId,
            },
          );
        },
        onProgress: (line: any) => appendTaskProgress(task, line),
        requestInit: proxyDispatcher.requestInit,
        onProviderRequestSettled: (summary: ImageGenerationRequestSummary & { providerId: string }) => {
          providerRequestSummary = summary;
        },
      })
        .then(async (meta: any) => {
          task.status = 'done';
          task.file = meta;
          task.endedAt = Date.now();
          persistMediaTask(task);
          if (analyticsContext && providerRequestSummary) {
            captureMediaGenerationResult({
              analyticsContext,
              durationMs: task.endedAt - task.startedAt,
              meta,
              model,
              projectId,
              providerRequestSummary,
              ...(options.grant?.runId ? { runId: options.grant.runId } : {}),
              surface,
              taskId,
            });
          }
          notifyTaskWaiters(task);
          console.error(formatMediaTaskDiagnostic({
            ...diagnosticContext,
            event: 'done',
            providerId: meta?.providerId ?? providerRequestSummary?.providerId ?? requestedProviderId,
            status: task.status,
            elapsedMs: task.endedAt - task.startedAt,
            fileSize: typeof meta?.size === 'number' ? meta.size : undefined,
            mime: typeof meta?.mime === 'string' ? meta.mime : undefined,
          }));
          // Last, and only after the waiters have been told: this generation
          // may have outlived the turn that asked for it, and the run-terminal
          // floor froze its file list before these bytes existed. Attach them
          // to that turn now, additively. A no-op whenever the run is still
          // live — the terminal pass covers that case on its own.
          await attachLateOutputToRunMessage(meta);
        })
        .catch((err: any) => {
          releaseUnsentBudgetCharge();
          task.status = 'failed';
          task.error = mediaTaskErrorFromFailure(err, { model });
          task.endedAt = Date.now();
          persistMediaTask(task);
          if (analyticsContext && providerRequestSummary) {
            captureMediaGenerationResult({
              analyticsContext,
              durationMs: task.endedAt - task.startedAt,
              model,
              projectId,
              providerRequestSummary,
              ...(options.grant?.runId ? { runId: options.grant.runId } : {}),
              surface,
              taskId,
            });
          }
          notifyTaskWaiters(task);
          console.error(formatMediaTaskDiagnostic({
            ...diagnosticContext,
            event: 'failed',
            providerId: providerRequestSummary?.providerId ?? requestedProviderId,
            status: task.error.status,
            code: task.error.code,
            elapsedMs: task.endedAt - task.startedAt,
            error: task.error.message,
          }));
          // Last, and only after the waiters have been told: the run that asked
          // for this generation must not be able to report itself complete when
          // the host just watched its deliverable fail.
          reportFailureToRun(taskId, task.error);
        })
        .finally(() => proxyDispatcher.close());

      return res.status(202).json({
        taskId,
        status: task.status,
        startedAt: task.startedAt,
      });
    } catch (err: any) {
      releaseUnsentBudgetCharge();
      if (task) {
        task.status = 'failed';
        task.error = mediaTaskErrorFromFailure(err, { model });
        task.endedAt = Date.now();
        persistMediaTask(task);
        notifyTaskWaiters(task);
        console.error(formatMediaTaskDiagnostic({
          event: 'failed',
          taskId: task.id,
          runId: options.grant?.runId,
          projectId,
          surface,
          model,
          providerId: mediaProviderId(model),
          status: task.error.status,
          code: task.error.code,
          elapsedMs: task.endedAt - task.startedAt,
          error: task.error.message,
        }));
        // Same invariant as the async rejection above: a dispatch that threw
        // before the provider was ever reached is still a generation this run
        // asked for and did not get.
        reportFailureToRun(task.id, task.error);
      }
      throw err;
    }
  };

  const handleHyperFramesScaffold = async (
    req: any,
    res: any,
    projectId: string,
  ) => {
    const project = getProject(db, projectId);
    if (!project) {
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    }
    const body = (req.body ?? {}) as Partial<HyperFramesScaffoldRequest>;
    if (typeof body.compositionDir !== 'string' || !body.compositionDir.trim()) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'compositionDir is required');
    }
    const projectDir = resolveProjectDir(PROJECTS_DIR, project.id, project.metadata);
    const result: HyperFramesScaffoldResponse = await scaffoldHyperFramesComposition({
      projectDir,
      compositionDir: body.compositionDir,
    });
    return res.status(201).json(result);
  };

  const captureMediaGenerationResult = (input: {
    analyticsContext: AnalyticsContext;
    durationMs: number;
    meta?: { providerError?: string | null; usedStubFallback?: boolean };
    model: string;
    projectId: string;
    providerRequestSummary: ImageGenerationRequestSummary & { providerId: string };
    runId?: string;
    surface: 'image' | 'video' | 'audio' | 'model3d';
    taskId: string;
  }) => {
    const summary = input.providerRequestSummary;
    const props = {
      page_name: 'studio',
      area: 'media_generation',
      project_id: input.projectId,
      task_id: input.taskId,
      ...(input.runId ? { run_id: input.runId } : {}),
      surface: input.surface,
      provider_id: summary.providerId,
      model_id: input.model,
      result: input.meta && !input.meta.providerError && !input.meta.usedStubFallback
        ? 'success'
        : 'failed',
      ...(summary.initialResponseStatus !== undefined
        ? { initial_response_status: summary.initialResponseStatus }
        : {}),
      ...(summary.responseStatus !== undefined
        ? { response_status: summary.responseStatus }
        : {}),
      attempt_count: summary.attemptCount,
      retry_count: summary.retryCount,
      ...(summary.retryReason ? { retry_reason: summary.retryReason } : {}),
      ...(summary.retryAfterMs !== undefined
        ? { retry_after_ms: summary.retryAfterMs }
        : {}),
      ...(summary.retryDelayMs !== undefined
        ? { retry_delay_ms: summary.retryDelayMs }
        : {}),
      retry_final_result: summary.retryFinalResult,
      duration_ms: Math.max(0, input.durationMs),
      used_stub_fallback: input.meta?.usedStubFallback === true,
    } satisfies MediaGenerationResultProps;

    try {
      design.analytics.capture({
        eventName: 'media_generation_result',
        context: input.analyticsContext,
        appVersion: design.getAppVersion(),
        properties: props,
        insertId: `media_generation_result:${input.taskId}`,
      });
    } catch {
      // Analytics is best-effort and must not change the media task outcome.
    }
  };
  app.get('/api/media/models', async (req, res) => {
    res.json({
      providers: MEDIA_PROVIDERS,
      image: IMAGE_MODELS,
      video: VIDEO_MODELS,
      model3d: MODEL3D_MODELS,
      audio: AUDIO_MODELS_BY_KIND,
      aspects: MEDIA_ASPECTS,
      videoLengthsSec: VIDEO_LENGTHS_SEC,
      audioDurationsSec: AUDIO_DURATIONS_SEC,
    });
  });

  // Live AIHubMix media catalogue. The static IMAGE_MODELS registry only
  // seeds a couple of AIHubMix entries; the picker calls this to list the full
  // image-generation catalogue straight from AIHubMix
  // (GET /api/v1/models?type=image_generation, public). Ids are prefixed
  // `aihubmix-` so they stay unique and route through the AIHubMix renderer
  // (which strips the prefix to the wire name). Falls back to the cached copy
  // on upstream failure so a transient blip doesn't empty the picker.
  app.get('/api/media/providers/aihubmix/models', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const raw = req.query.type;
    const type: AIHubMixCatalogType =
      raw === 'llm' || raw === 'video' || raw === 'tts'
        ? raw
        : 'image_generation';
    // This is an unauthenticated, public GET. The AIHubMix catalogue lives at a
    // single fixed origin, so we deliberately do NOT honour a caller-supplied
    // `baseUrl` here — letting the caller pick the fetch target would open an
    // SSRF hole (e.g. pointing the daemon at http://169.254.169.254/ cloud
    // metadata). Hard-code the official origin instead; a custom BYOK base URL
    // only ever needs to differ for authenticated chat/media calls, not for
    // browsing the public model catalogue.
    const baseUrl = AIHUBMIX_DEFAULT_BASE_URL;
    const cacheKey = `${baseUrl}|${type}`;
    const cached = aihubmixCatalogCache.get(cacheKey);
    if (cached && Date.now() - cached.at < AIHUBMIX_CATALOG_TTL_MS) {
      return res.json({ ok: true, cached: true, models: cached.models });
    }
    const dispatcher = await proxyDispatcherRequestInit();
    try {
      const resp = await fetch(aihubmixCatalogUrl(baseUrl, type), {
        ...dispatcher.requestInit,
        method: 'GET',
        // The catalogue endpoint is public — no auth header (sending an empty
        // Bearer would be rejected by some gateways).
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        if (cached) return res.json({ ok: true, stale: true, models: cached.models });
        return res.status(502).json({ ok: false, detail: `aihubmix catalog ${resp.status}` });
      }
      const data = await resp.json();
      const models = parseAIHubMixCatalog(data).map((m) => ({
        id: `aihubmix-${m.id}`,
        label: m.label,
      }));
      aihubmixCatalogCache.set(cacheKey, { at: Date.now(), models });
      return res.json({ ok: true, models });
    } catch (err: any) {
      if (cached) return res.json({ ok: true, stale: true, models: cached.models });
      return res
        .status(502)
        .json({ ok: false, detail: String(err && err.message ? err.message : err) });
    } finally {
      await dispatcher.close();
    }
  });

  app.get('/api/media/capabilities', async (_req, res) => {
    try {
      // A panel waits on this answer, so it reads the last Codex detection instead of
      // launching the CLI. Expired detections refresh themselves in the background.
      const config = await readMaskedConfig(PROJECT_ROOT, { refreshCredentials: false, cachedAgentDetection: true, dataDir: RUNTIME_DATA_DIR });
      const providers = configuredRecipeProviders(config, false);
      const capabilities: GetMediaCapabilitiesResponse['capabilities'] = {};
      const models = [...IMAGE_MODELS, ...VIDEO_MODELS, ...MODEL3D_MODELS, ...Object.values(AUDIO_MODELS_BY_KIND).flat()];
      for (const model of models) {
        for (const capability of model.caps) {
          const status = capabilities[capability] ??= { configured: false, providers: [] };
          if (providers.has(model.provider) && !status.providers.includes(model.provider)) {
            status.configured = true;
            status.providers.push(model.provider);
          }
        }
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ capabilities } satisfies GetMediaCapabilitiesResponse);
    } catch {
      res.status(500).json({ error: 'Unable to read media capabilities' });
    }
  });

  app.get('/api/media/config', async (_req, res) => {
    try {
      const cfg = await readMaskedConfig(PROJECT_ROOT);
      res.json(cfg);
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.put('/api/media/config', async (req, res) => {
    try {
      const cfg = await writeConfig(PROJECT_ROOT, req.body);
      res.json(cfg);
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      res
        .status(status)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.get('/api/media/providers/elevenlabs/voices', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
      const proxyDispatcher = await proxyDispatcherRequestInit(process.env);
      try {
        const voices = await listElevenLabsVoiceOptions(PROJECT_ROOT, {
          limit,
          requestInit: proxyDispatcher.requestInit,
        });
        res.json({ voices });
      } finally {
        await proxyDispatcher.close();
      }
    } catch (err: any) {
      const message = String(err && err.message ? err.message : err);
      const status = message.includes('no ElevenLabs API key') ? 400 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.get('/api/app-config', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const config = await readAppConfig(RUNTIME_DATA_DIR);
      res.json({ config });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.put('/api/app-config', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const currentConfig = await readAppConfig(RUNTIME_DATA_DIR);

      const config = await writeAppConfig(RUNTIME_DATA_DIR, req.body);

      onAppConfigWritten?.(config);
      res.json({ config });
    } catch (err: any) {
      if (err?.code === 'INVALID_APP_CONFIG_VALUE') {
        // Nested envelope on purpose. `pixo`'s error reader only finds a code in
        // this shape; from a flat body it falls back to `daemon-not-running`
        // and exits 64, which tells a caller to go start a daemon that just
        // answered. Rejected input should read as a plain failure.
        return res.status(400).json({
          error: { code: err.code, message: String(err.message) },
        });
      }
      const status = err?.code === 'WORKSPACE_ACCESS_DENIED'
          ? 403
          : 500;
      res
        .status(status)
        .json({
          error: String(err && err.message ? err.message : err),
          ...(err?.code ? { code: err.code } : {}),
          ...(err?.retryable ? { retryable: true } : {}),
        });
    }
  });

  // Lightweight existence probe for a single directory, used by the composer
  // to flag a working directory in red the moment its folder is gone (the
  // composer re-checks on focus / picker-open, so deletions reflect live).
  app.post('/api/dir-exists', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const dir = typeof req.body?.path === 'string' ? req.body.path : '';
    let exists = false;
    if (dir) {
      try {
        exists = fs.statSync(dir).isDirectory();
      } catch {
        exists = false;
      }
    }
    res.json({ exists });
  });

  // Recent working directories, pruned to those that still exist on disk. A
  // folder the user deleted (or an external drive that's gone) drops out of
  // the list here and the pruned list is persisted back, so the picker's
  // "recent folders" never offers a path that no longer resolves.
  app.get('/api/recent-dirs', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const config = await readAppConfig(RUNTIME_DATA_DIR);
      const recents = Array.isArray(config.recentLinkedDirs)
        ? config.recentLinkedDirs
        : [];
      const existing = recents.filter((dir: string) => {
        try {
          return fs.statSync(dir).isDirectory();
        } catch {
          return false;
        }
      });
      if (existing.length !== recents.length) {
        await writeAppConfig(RUNTIME_DATA_DIR, { recentLinkedDirs: existing });
      }
      /** @type {import('@openpixo/contracts').RecentLinkedDirsResponse} */
      const body = { dirs: existing };
      res.json(body);
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });


  app.post('/api/system/open-external', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return res.status(400).json({ ok: false, error: 'url must be a valid URL' });
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({ ok: false, error: 'url must be http or https' });
      }
      const child = openBrowser(parsed.toString());
      res.json({ ok: Boolean(child) });
    } catch (err: any) {
      res
        .status(500)
        .json({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });

  // Native OS folder picker dialog. Returns { path: string | null }.
  app.post('/api/dialog/open-folder', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const selected = await openNativeFolderDialog();
      res.json({ path: selected });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.post('/api/projects/:id/media/hyperframes/scaffold', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({
        error: 'cross-origin request rejected: HyperFrames scaffolding is restricted to the local UI / CLI',
      });
    }
    try {
      const project = getProject(db, req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await ctx.authorizeProjectRequest(
        req,
        res,
        project.id,
        { mode: 'write', capability: 'writeFiles' },
      )) return;
      await handleHyperFramesScaffold(req, res, project.id);
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      const code = err?.code;
      const body: any = { error: String(err && err.message ? err.message : err) };
      if (code) body.code = code;
      res.status(status).json(body);
    }
  });

  app.post(HYPERFRAMES_SCAFFOLD_TOOL_ENDPOINT, async (req, res) => {
    const grant = authorizeToolRequest(req, res, 'media:scaffold', {
      endpoint: HYPERFRAMES_SCAFFOLD_TOOL_ENDPOINT,
    });
    if (!grant) return;
    try {
      if (!await ctx.authorizeProjectToolRequest(
        res,
        grant.projectId,
        { mode: 'write', capability: 'writeFiles' },
      )) return;
      await handleHyperFramesScaffold(req, res, grant.projectId);
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      const code = err?.code;
      const body: any = { error: String(err && err.message ? err.message : err) };
      if (code) body.code = code;
      res.status(status).json(body);
    }
  });

  app.post('/api/projects/:id/media/generate', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({
        error:
          'cross-origin request rejected: media generation is restricted to the local UI / CLI',
      });
    }

    try {
      const project = getProject(db, req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await ctx.authorizeProjectRequest(
        req,
        res,
        project.id,
        { mode: 'write', capability: 'writeFiles' },
      )) return;
      const grant = optionalToolGrantFromRequest(req, { operation: 'media:generate' });
      const grantDecision = resolveLegacyMediaRouteGrant({
        grant,
        projectId: req.params.id,
        requestProjectOverride,
        sandboxMode: isSandboxModeEnabled(process.env),
      });
      if (!grantDecision.ok) {
        return sendApiError(
          res,
          grantDecision.status,
          grantDecision.code,
          grantDecision.message,
          grantDecision.details ? { details: grantDecision.details } : {},
        );
      }
      await handleGenerate(req, res, { projectId: req.params.id, grant: grantDecision.grant });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      const code = err?.code;
      const body: any = { error: String(err && err.message ? err.message : err) };
      if (code) body.code = code;
      res.status(status).json(body);
    }
  });

  // Price an OpenPixo-hosted request, reference images included. The images are
  // uploaded privately to the signed-in account so the quote can bind their
  // hashes; nothing is spent. Only the local UI/CLI may do this; an agent's own
  // requests are priced by the daemon when they arrive.
  app.post('/api/projects/:id/media/openpixo-quote', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return sendApiError(res, 403, 'FORBIDDEN', 'cross-origin request rejected: hosted quotes are restricted to the local UI / CLI');
    }
    try {
      const project = getProject(db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      if (!await ctx.authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
      if (optionalToolGrantFromRequest(req, { operation: 'media:generate' })) {
        const confirm = new AccountError('GENERATION_CONFIRMATION_REQUIRED');
        return res.status(confirm.status).json(confirm.response());
      }
      const body = req.body ?? {};
      const hosted: OpenPixoHostedMedia = ctx.media.openpixoHosted;
      const audioKind = hostedAudioKind(body.service);
      if (audioKind) {
        // Audio has no shape and no references. Nothing is uploaded for a request the cloud would refuse.
        if (body.image || body.images?.length) return sendApiError(res, 400, 'GENERATION_PARAMS_INVALID', 'Audio takes no reference images.');
        return res.json(await hosted.quote(body.service, { prompt: body.prompt, ...hostedAudioParams(audioKind, body) }));
      }
      const projectDir = resolveProjectDir(PROJECTS_DIR, project.id, project.metadata);
      const references = await resolveProjectImageRefs(body.image, body.images, projectDir);
      const resolution = hostedResolution(body.resolution);
      const quote = await hosted.quote(body.service, {
        prompt: body.prompt, ...(body.aspect !== undefined ? { aspect: body.aspect } : {}), ...(body.style !== undefined ? { style: body.style } : {}),
        // The generate call sends the same resolution, read the same way, so the quote matches it.
        ...(resolution ? { resolution } : {}),
      }, references.map(ref => ({ bytes: Buffer.from(ref.dataUrl.slice(ref.dataUrl.indexOf(',') + 1), 'base64'), mime: ref.mime })));
      return res.json(quote);
    } catch (error) {
      if (error instanceof AccountError) return res.status(error.status).json(error.response());
      // Path and format errors from reference resolution are the caller's to fix.
      if (error instanceof Error && /--image/u.test(error.message)) return sendApiError(res, 400, 'GENERATION_PARAMS_INVALID', error.message);
      const failure = accountError(error);
      return res.status(failure.status).json(failure.response());
    }
  });

  app.post('/api/tools/media/generate', async (req, res) => {
    const grant = authorizeToolRequest(req, res, 'media:generate');
    if (!grant) return;
    try {
      if (!await ctx.authorizeProjectToolRequest(
        res,
        grant.projectId,
        { mode: 'write', capability: 'writeFiles' },
      )) return;
      await handleGenerate(req, res, { projectId: grant.projectId, grant });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      const code = err?.code;
      const body: any = { error: String(err && err.message ? err.message : err) };
      if (code) body.code = code;
      res.status(status).json(body);
    }
  });

  app.post('/api/research/search', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({
        error:
          'cross-origin request rejected: research search is restricted to the local UI / CLI',
      });
    }

    try {
      const proxyDispatcher = await proxyDispatcherRequestInit(process.env);
      try {
        const result = await searchResearch({
          projectRoot: PROJECT_ROOT,
          query: req.body?.query,
          maxSources:
            typeof req.body?.maxSources === 'number'
              ? req.body.maxSources
              : undefined,
          providers: Array.isArray(req.body?.providers)
            ? req.body.providers
            : undefined,
          requestInit: proxyDispatcher.requestInit,
        });
        res.json(result);
      } finally {
        await proxyDispatcher.close();
      }
    } catch (err: any) {
      if (err instanceof ResearchError) {
        return res.status(err.status).json({
          error: { code: err.code, message: err.message },
        });
      }
      res.status(500).json({
        error: {
          code: 'RESEARCH_FAILED',
          message: String(err && err.message ? err.message : err),
        },
      });
    }
  });

  app.post('/api/media/tasks/:id/wait', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const authorizationHeader = req.get('authorization');
    // Only a Bearer credential chooses the tool-token lane: that is the sole
    // shape `bearerTokenFromRequest` parses. A reverse proxy that
    // authenticates browsers itself forwards its own `Authorization: Basic
    // ...`, which can never satisfy the lane, so claiming it here failed
    // every proxied wait with TOOL_TOKEN_MISSING. Once a Bearer caller does
    // choose the lane, invalid, expired, or under-scoped credentials must not
    // downgrade to project authorization.
    // Classify the scheme independently of whether a token follows it: a bare
    // `Bearer` (or `Bearer ` trimmed to it) is still a caller reaching for the
    // tool-token lane and must keep failing closed with TOOL_TOKEN_MISSING
    // rather than downgrading to browser project authority.
    const usesToolTokenLane = typeof authorizationHeader === 'string'
      && /^Bearer(?:\s|$)/i.test(authorizationHeader.trim());
    const toolGrant = usesToolTokenLane
      ? authorizeToolRequest(
          req,
          res,
          'media:generate',
          { endpoint: MEDIA_TASK_WAIT_TOOL_ENDPOINT },
        )
      : null;
    if (usesToolTokenLane && !toolGrant) return;
    if (
      toolGrant
      && !await ctx.authorizeProjectToolRequest(
        res,
        toolGrant.projectId,
        { mode: 'read' },
      )
    ) return;

    // Token callers must prove their grant targets the persisted local project
    // before task lookup; cloud availability is irrelevant to this local wait.
    const taskId = req.params.id;
    const task = getLiveMediaTask(taskId);
    if (!task) return res.status(404).json({ error: 'task not found' });
    if (toolGrant) {
      if (requestProjectOverride(task.projectId, toolGrant.projectId)) {
        return sendApiError(
          res,
          403,
          'FORBIDDEN',
          'media task belongs to a different project',
        );
      }
    } else if (!await ctx.authorizeProjectRequest(
      req,
      res,
      task.projectId,
      { mode: 'read' },
    )) {
      return;
    }

    const since = Number.isFinite(req.body?.since) ? Number(req.body.since) : 0;
    const requestedTimeout = Number.isFinite(req.body?.timeoutMs)
      ? Number(req.body.timeoutMs)
      : 25_000;
    const timeoutMs = Math.min(Math.max(requestedTimeout, 0), 25_000);

    const respond = () => {
      if (res.writableEnded) return;
      res.json(mediaTaskSnapshot(task, since));
    };

    if (
      task.status === 'done' ||
      task.status === 'failed' ||
      task.status === 'interrupted' ||
      task.progress.length > since
    ) {
      return respond();
    }

    let resolved = false;
    const wake = () => {
      if (resolved) return;
      resolved = true;
      task.waiters.delete(wake);
      clearTimeout(timer);
      respond();
    };
    task.waiters.add(wake);
    const timer = setTimeout(wake, timeoutMs);
    res.on('close', wake);
  });

  app.get('/api/projects/:id/media/tasks', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const projectId = req.params.id;
    const project = getProject(db, projectId);
    if (!project) {
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    }
    if (!await ctx.authorizeProjectRequest(req, res, projectId, { mode: 'read' })) return;
    const includeDone =
      req.query.includeDone === '1' || req.query.includeDone === 'true';
    const taskRows = listMediaTasksByProject(db, projectId, {
      includeTerminal: includeDone,
    });
    const confirmedFiles = new Map<string, ProjectFile>();
    const movedCandidates: typeof taskRows = [];
    if (includeDone && taskRows.some((task: any) => task.status === 'done')) {
      await Promise.all(taskRows.map(async (task: any) => {
        if (task.status !== 'done') return;
        const name = typeof task.file?.name === 'string' ? task.file.name.trim() : '';
        if (!name) return;
        try {
          confirmedFiles.set(
            task.id,
            await resolveProjectFilePath(PROJECTS_DIR, projectId, name, project.metadata),
          );
        } catch {
          if (finiteNumber(task.file?.size) !== null && finiteNumber(task.file?.mtime) !== null) {
            movedCandidates.push(task);
          }
        }
      }));
    }
    if (movedCandidates.length > 0) {
      try {
        const projectFiles = await listFiles(
          PROJECTS_DIR,
          projectId,
          { metadata: project.metadata },
        );
        // Files a task still resolves by its recorded path are already
        // spoken for; a moved task must not take one of them.
        const claimedNames = new Set(
          [...confirmedFiles.values()].map((file) => file.name),
        );
        const resolved = resolveMovedMediaTaskFiles(
          movedCandidates.map((task: any) => ({ taskId: task.id, file: task.file })),
          projectFiles,
          claimedNames,
        );
        for (const [taskId, file] of resolved) confirmedFiles.set(taskId, file);
      } catch {
        // Task status remains useful when an imported folder is temporarily
        // unavailable. Omit unconfirmed files and let the client's bounded
        // terminal poll reconcile them if the project root returns.
      }
    }
    const batches = assignMediaTaskBatches(taskRows.map((task: any) => ({
      id: task.id,
      runId: task.runId,
      surface: task.surface,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
      sequence: task.sequence,
    })));
    const tasks = taskRows.map((t: any) => {
      const resolvedFile = confirmedFiles.get(t.id) ?? null;
      let confirmedFile: Record<string, unknown> | null = null;
      if (resolvedFile) {
        confirmedFile = reconciledMediaTaskFile(t.file, resolvedFile);
        if ((t.file as { name?: unknown } | null)?.name !== resolvedFile.name) {
          const liveTask = getLiveMediaTask(t.id);
          if (liveTask) {
            liveTask.file = confirmedFile;
            persistMediaTask(liveTask);
          }
        }
      }
      const batch = batches.get(t.id);
      return {
        taskId: t.id,
        sequence: t.sequence,
        ...(batch ?? {}),
        ...(t.runId ? { runId: t.runId } : {}),
        status: t.status,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        elapsed: Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000),
        surface: t.surface,
        model: t.model,
        progress: t.progress.slice(-3),
        progressCount: t.progress.length,
        ...(confirmedFile ? { file: confirmedFile } : {}),
        ...(t.status === 'failed' || t.status === 'interrupted' ? { error: t.error } : {}),
      };
    });
    // Newest first, with creation order breaking the ties a parallel fan-out
    // always produces.
    tasks.sort((a: any, b: any) => (b.startedAt - a.startedAt) || (b.sequence - a.sequence));
    res.json({ tasks });
  });

  // Multi-file upload that the chat composer uses for paste/drop/picker.
  // Files land flat in the project folder; the response carries the same
  // metadata as listFiles so the client can stage them as ChatAttachments
  // without a separate refetch.

}
