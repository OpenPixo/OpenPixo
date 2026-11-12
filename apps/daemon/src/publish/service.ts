import type Database from 'better-sqlite3';
import type { PublishJob, PublishRequest, PublishStatusResponse, RoomsUsage } from '@openpixo/contracts';
import { AccountError, PublishCloudError } from '../account/errors.js';
import type { ShareStatusResult } from '../account/publish-cloud.js';
import { readAppConfig } from '../app-config.js';
import { getProject, updateProject } from '../db.js';
import { detectEngineProfile } from '../game/engine-detect.js';
import { gameToolResolver } from '../game/verify.js';
import { resolveProjectDir } from '../projects.js';
import { runProjectBuild } from './build.js';
import { PublishJobs, type PublishAccount, type PublishProjectContext } from './jobs.js';
import { isWebProject, unsupportedEngineMessage } from './web-project.js';

export class PublishRequestError extends Error {
  constructor(readonly status: number, readonly code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'PROJECT_NOT_FOUND', message: string) { super(message); }
}

export interface PublishServiceDeps {
  db: Database.Database;
  projectsDir: string;
  dataDir: string;
  /** Absent when the build has no cloud. */
  account?: PublishAccount | undefined;
  /** Test seam; production runs the project's own build script. */
  build?: (context: PublishProjectContext) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

/** Project facts, the cloud link and the job queue behind `/api/projects/:id/publish`. */
export class PublishService {
  private readonly jobs: PublishJobs | null;
  /** Polling during a publish must not become a Supabase call per second. */
  private readonly cached = new Map<string, ShareStatusResult>();

  constructor(private readonly deps: PublishServiceDeps) {
    this.jobs = deps.account ? new PublishJobs({ account: deps.account, prepare: id => this.context(id),
      build: deps.build ?? (context => this.defaultBuild(context)), saveShareId: (id, shareId) => this.saveShareId(id, shareId),
      ...(deps.sleep ? { sleep: deps.sleep } : {}) }) : null;
  }

  async context(projectId: string): Promise<PublishProjectContext> {
    const project = getProject(this.deps.db, projectId);
    if (!project) throw new PublishRequestError(404, 'PROJECT_NOT_FOUND', 'project not found');
    const projectDir = resolveProjectDir(this.deps.projectsDir, projectId, project.metadata);
    const config = await readAppConfig(this.deps.dataDir);
    let profile;
    try { profile = detectEngineProfile(projectDir, { enginePaths: config.gameEnginePaths ?? {} }); }
    catch { throw new PublishRequestError(422, 'VALIDATION_FAILED', 'This project has no game files yet.'); }
    const shareId = project.metadata?.publishShareId;
    return { projectDir, profile, title: project.name, ...(shareId ? { shareId } : {}) };
  }

  /** Throws the plain refusal for anything that is not a web game. */
  async webContext(projectId: string, action: string): Promise<PublishProjectContext> {
    const context = await this.context(projectId);
    if (!isWebProject(context.profile, context.projectDir)) {
      throw new PublishRequestError(422, 'VALIDATION_FAILED', unsupportedEngineMessage(context.profile, action));
    }
    return context;
  }

  private async defaultBuild(context: PublishProjectContext, retry?: string): Promise<void> {
    const config = await readAppConfig(this.deps.dataDir);
    await runProjectBuild({ profile: context.profile, projectDir: context.projectDir, resolveTool: gameToolResolver({ ...(config.gameEnginePaths ?? {}) }),
      ...(retry ? { retry } : {}) });
  }

  /** The project's own build for the creator, outside a publish (the offline export uses it). */
  async build(context: PublishProjectContext, retry: string): Promise<void> {
    await (this.deps.build ? this.deps.build(context) : this.defaultBuild(context, retry));
  }

  private saveShareId(projectId: string, shareId: string | null): void {
    const project = getProject(this.deps.db, projectId);
    if (!project || (project.metadata?.publishShareId ?? null) === shareId) return;
    const { publishShareId: _previous, ...rest } = project.metadata ?? {};
    updateProject(this.deps.db, projectId, { metadata: { ...rest, ...(shareId ? { publishShareId: shareId } : {}) } as typeof project.metadata });
    this.cached.delete(projectId);
  }

  private account(): PublishAccount {
    if (!this.deps.account) throw new AccountError('ACCOUNT_NOT_CONFIGURED');
    this.deps.account.assertConfigured();
    return this.deps.account;
  }

  /** Reads the cloud's view. A link the cloud no longer knows is forgotten here too. */
  async shareStatus(projectId: string, shareId: string | undefined): Promise<ShareStatusResult> {
    const account = this.account();
    try {
      const status = await account.shareStatus(shareId);
      this.cached.set(projectId, status);
      return status;
    } catch (error) {
      if (!shareId || !(error instanceof PublishCloudError) || error.code !== 'SHARE_NOT_FOUND') throw error;
      this.saveShareId(projectId, null);
      return this.shareStatus(projectId, undefined);
    }
  }

  async start(projectId: string, request: PublishRequest): Promise<PublishJob> {
    await this.webContext(projectId, 'be published');
    const account = this.account();
    if (!await account.hasSession()) throw new AccountError('ACCOUNT_SIGNED_OUT');
    this.cached.delete(projectId);
    return this.jobs!.start(projectId, request);
  }

  async status(projectId: string): Promise<PublishStatusResponse> {
    const context = await this.context(projectId);
    const job = this.jobs?.get(projectId) ?? null;
    const unavailable = (unavailableReason: NonNullable<PublishStatusResponse['unavailableReason']>, status?: ShareStatusResult): PublishStatusResponse => ({
      available: false, unavailableReason, game: status?.game ?? null, job, termsAccepted: status?.termsAccepted ?? false, termsUrl: status?.termsUrl ?? '',
      ...(status?.publishPlan ? { publishPlan: status.publishPlan } : {}) });
    if (!isWebProject(context.profile, context.projectDir)) return unavailable('engine_unsupported');
    if (!this.deps.account) return unavailable('no_cloud');
    try { this.deps.account.assertConfigured(); }
    catch { return unavailable('no_cloud'); }
    if (!await this.deps.account.hasSession()) return unavailable('signed_out');
    let status: ShareStatusResult;
    try {
      const cached = this.jobs!.running(projectId) ? this.cached.get(projectId) : undefined;
      status = cached ?? await this.shareStatus(projectId, context.shareId);
    } catch (error) {
      if (error instanceof AccountError && error.code === 'ACCOUNT_SIGNED_OUT') return unavailable('signed_out');
      // Without the cloud the job is still the answer a caller is waiting for.
      if (!job) throw error;
      return { available: true, game: this.jobs!.lastGame(projectId) ?? null, job, termsAccepted: false, termsUrl: '' };
    }
    if (status.paused.publish) return unavailable('paused', status);
    return { available: true, game: status.game, job, termsAccepted: status.termsAccepted, termsUrl: status.termsUrl,
      ...(status.publishPlan ? { publishPlan: status.publishPlan } : {}) };
  }

  async remove(projectId: string): Promise<void> {
    const { shareId } = await this.context(projectId);
    if (!shareId) throw new PublishRequestError(404, 'NOT_FOUND', 'This game has no public link.');
    if (this.jobs?.running(projectId)) throw new PublishRequestError(409, 'CONFLICT', 'A publish is running. Wait for it to finish, then remove the link.');
    try { await this.account().shareRemove(shareId); }
    catch (error) { if (!(error instanceof PublishCloudError) || error.code !== 'SHARE_NOT_FOUND') throw error; }
    this.saveShareId(projectId, null);
    this.jobs?.forget(projectId);
  }

  async setRoomsLimit(projectId: string, monthlyCreditLimit: number): Promise<RoomsUsage> {
    const { shareId } = await this.context(projectId);
    if (!shareId) throw new PublishRequestError(409, 'CONFLICT', 'Publish the game first. The spending limit belongs to its public link.');
    return this.account().shareLimit(shareId, monthlyCreditLimit);
  }

  settled(projectId: string): Promise<void> { return this.jobs?.settled(projectId) ?? Promise.resolve(); }

  async dispose(): Promise<void> { await this.jobs?.dispose(); }
}
