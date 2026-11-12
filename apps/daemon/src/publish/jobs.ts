import { randomUUID } from 'node:crypto';
import type { EngineProfile, PublishedGame, PublishJob, PublishPhase, PublishRequest } from '@openpixo/contracts';
import { AccountError, PublishCloudError } from '../account/errors.js';
import type { OpenPixoAccountService } from '../account/service.js';
import { PublishBuildError } from './build.js';
import { collectBundle, findBuildOutput, PublishBundleError, type PublishBundle } from './bundle.js';
import { extraGamePrice } from './extra-game.js';
import { PublishUploadError, uploadBundle, type UploadInput } from './upload.js';
import { webProjectCwd } from './web-project.js';

/** The cloud account surface publishing needs. */
export type PublishAccount = Pick<OpenPixoAccountService, 'assertConfigured' | 'hasSession' | 'publishBegin' | 'publishFinish' | 'shareStatus' | 'shareRemove' | 'shareLimit'>;

export interface PublishProjectContext {
  projectDir: string;
  profile: EngineProfile;
  title: string;
  shareId?: string;
}

export interface PublishJobsDeps {
  account: PublishAccount;
  prepare: (projectId: string) => Promise<PublishProjectContext>;
  /** Runs the project's own build; only called when the request did not skip it. */
  build: (context: PublishProjectContext) => Promise<void>;
  /** Saved as soon as the cloud issues it, so a retry after a failed upload keeps the same link. */
  saveShareId: (projectId: string, shareId: string | null) => void;
  sleep?: UploadInput['sleep'];
}

interface Entry {
  job: PublishJob;
  game?: PublishedGame;
  finished: boolean;
  settled: Promise<void>;
}

/**
 * A job's failure. `credits` rides along with PUBLISH_EXTRA_GAME_REQUIRED so the Share dialog and the
 * CLI can name the price; `PublishJob.error` in the contracts does not declare it yet.
 */
export interface PublishJobFailure {
  error: NonNullable<PublishJob['error']> & { credits?: number };
  refusedFiles?: string[];
}

function failure(error: unknown): PublishJobFailure {
  if (error instanceof PublishCloudError) {
    return { error: { code: error.code, message: error.message, ...(error.credits === undefined ? {} : { credits: error.credits }) },
      ...(error.refusedFiles?.length ? { refusedFiles: error.refusedFiles } : {}) };
  }
  if (error instanceof PublishBundleError) {
    return { error: { code: error.code, message: error.message }, ...(error.refusedFiles?.length ? { refusedFiles: error.refusedFiles } : {}) };
  }
  if (error instanceof AccountError || error instanceof PublishUploadError) return { error: { code: error.code, message: error.message } };
  if (error instanceof PublishBuildError) return { error: { code: 'PUBLISH_BUILD_FAILED', message: error.message } };
  // The Share dialog shows this as given, so an unexpected failure's own words stay in the log.
  console.error('[publish] job failed:', error);
  return { error: { code: 'PUBLISH_FAILED', message: 'Something went wrong while publishing. Your public link, if you have one, still shows the previous version. Try again.' } };
}

/**
 * One publish at a time per project, held in memory. A restart forgets the job, which
 * is safe: the link keeps serving its last activated version until a finish succeeds.
 */
export class PublishJobs {
  private readonly entries = new Map<string, Entry>();
  private readonly controller = new AbortController();

  constructor(private readonly deps: PublishJobsDeps) {}

  /** Returns the running job instead of starting a second one, so repeat clicks share it. */
  start(projectId: string, request: PublishRequest): PublishJob {
    const current = this.entries.get(projectId);
    if (current && !current.finished) return { ...current.job };
    const job: PublishJob = { id: randomUUID(), phase: request.skipBuild ? 'checking' : 'building', filesDone: 0, filesTotal: 0, startedAt: new Date().toISOString() };
    const entry: Entry = { job, finished: false, settled: Promise.resolve() };
    this.entries.set(projectId, entry);
    entry.settled = this.run(projectId, entry, request)
      .catch(error => { job.phase = 'failed'; Object.assign(job, failure(error)); })
      .finally(() => { entry.finished = true; });
    return { ...job };
  }

  get(projectId: string): PublishJob | null {
    const entry = this.entries.get(projectId);
    return entry ? { ...entry.job } : null;
  }

  running(projectId: string): boolean {
    const entry = this.entries.get(projectId);
    return Boolean(entry && !entry.finished);
  }

  /** The game the last successful publish in this session returned. */
  lastGame(projectId: string): PublishedGame | undefined {
    return this.entries.get(projectId)?.game;
  }

  /** Drops a finished job once its link is gone, so status stops reporting it. */
  forget(projectId: string): void {
    if (!this.running(projectId)) this.entries.delete(projectId);
  }

  settled(projectId: string): Promise<void> {
    return this.entries.get(projectId)?.settled ?? Promise.resolve();
  }

  /** Stops uploads. A build in progress ends on its own timeout. */
  async dispose(): Promise<void> {
    this.controller.abort();
    await Promise.all([...this.entries.values()].map(entry => entry.settled));
  }

  private async run(projectId: string, entry: Entry, request: PublishRequest): Promise<void> {
    const { job } = entry;
    const phase = (next: PublishPhase) => { job.phase = next; };
    const context = await this.deps.prepare(projectId);
    // Answer "paused", "needs a plan" or "accept the rules first" before a build the cloud would then refuse.
    const status = await this.deps.account.shareStatus(context.shareId).catch(error => {
      if (error instanceof PublishCloudError && error.code === 'SHARE_NOT_FOUND') return this.deps.account.shareStatus();
      throw error;
    });
    if (status.paused.publish) throw new PublishCloudError('PUBLISH_PAUSED');
    if (status.publishPlan?.planRequired) throw new PublishCloudError('PUBLISH_PLAN_REQUIRED');
    if (!status.termsAccepted && !request.acceptTerms) throw new PublishCloudError('SHARE_TERMS_REQUIRED');
    // A full plan offers the extra game; the creator has to have agreed before a build the cloud would refuse.
    const extraCredits = extraGamePrice(status.publishPlan, status.game);
    if (extraCredits !== null && !request.payExtraGame) throw new PublishCloudError('PUBLISH_EXTRA_GAME_REQUIRED', undefined, undefined, extraCredits);
    if (!request.skipBuild) await this.deps.build(context);

    phase('checking');
    const bundle = await collectBundle(await findBuildOutput(context.projectDir, webProjectCwd(context.profile), Boolean(context.profile.commands.build)));
    job.filesTotal = bundle.files.length;

    const begun = await this.begin(projectId, context, bundle, request);
    this.deps.saveShareId(projectId, begun.shareId);

    phase('uploading');
    await uploadBundle({ rootDir: bundle.rootDir, files: bundle.files, baseUrl: begun.uploadBaseUrl, version: begun.version, token: begun.uploadToken,
      signal: this.controller.signal, onFileDone: () => { job.filesDone += 1; }, ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}) });

    phase('activating');
    entry.game = await this.deps.account.publishFinish(begun.shareId, begun.version);
    phase('done');
  }

  /** A link deleted on the cloud, or owned by another account, starts over as a new link. */
  private async begin(projectId: string, context: PublishProjectContext, bundle: PublishBundle, request: PublishRequest) {
    const body = { title: request.title ?? context.title, ...(request.acceptTerms ? { acceptTerms: true } : {}),
      // Always explicit: the cloud reads a request without the field as an app that cannot pay, and answers PUBLISH_QUOTA.
      payExtraGame: request.payExtraGame === true, files: bundle.files };
    if (!context.shareId) return this.deps.account.publishBegin(body);
    try {
      return await this.deps.account.publishBegin({ ...body, shareId: context.shareId });
    } catch (error) {
      if (!(error instanceof PublishCloudError) || error.code !== 'SHARE_NOT_FOUND') throw error;
      this.deps.saveShareId(projectId, null);
      return this.deps.account.publishBegin(body);
    }
  }
}
