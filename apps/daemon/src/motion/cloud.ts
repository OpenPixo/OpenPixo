import type { MotionCharacter, MotionJob, MotionOrderRequest, MotionPortrait, MotionPortraitRequest, MotionService } from '@openpixo/contracts';
import type { CharacterAccount } from '../character/cloud.js';
import { isMotionCode, MotionError, motionError } from './errors.js';
import * as wire from './wire.js';

/** The same account and the same service address as animated characters: Pixo Motion lives under `/v1/motion/`. */
export type MotionAccount = Pick<CharacterAccount, 'characterOrigin' | 'hasSession' | 'character' | 'creditsChanged'>;

/** Pixo Motion, spoken to as the signed-in user. */
export class MotionCloud {
  /** Jobs that were seen running, to notice when one ends and its credits settle. */
  private readonly running = new Set<string>();
  constructor(private readonly account: MotionAccount) {}

  available(): boolean { return this.account.characterOrigin() !== null; }
  signedIn(): Promise<boolean> { return this.account.hasSession(); }
  origin(): string {
    const origin = this.account.characterOrigin();
    if (!origin) throw new MotionError('MOTION_NOT_CONFIGURED');
    return origin;
  }

  private notice(job: MotionJob | null): MotionJob | null {
    if (!job) return job;
    const ended = job.state === 'succeeded' || job.state === 'failed';
    if (!ended) this.running.add(job.id);
    else if (this.running.delete(job.id)) this.account.creditsChanged();
    return job;
  }
  private seen(character: MotionCharacter): MotionCharacter { this.notice(character.job); return character; }

  private async json(route: string, method = 'GET', body?: unknown): Promise<unknown> {
    this.origin();
    let response: Response;
    try { response = await this.account.character(`motion/${route}`, method, body); } catch (error) { throw motionError(error); }
    if (!response.ok) {
      let code: unknown;
      try { code = (await response.json() as { error?: { code?: unknown } }).error?.code; } catch { /* not ours */ }
      throw new MotionError(isMotionCode(code) ? code : 'CLOUD_UNAVAILABLE');
    }
    try { return await response.json(); } catch { throw new MotionError('CLOUD_UNAVAILABLE'); }
  }

  async service(): Promise<MotionService> { return wire.service(await this.json('service')); }
  async paint(request: MotionPortraitRequest): Promise<MotionPortrait> { return wire.portrait(await this.json('portraits', 'POST', request)); }
  async portrait(id: string): Promise<MotionPortrait> { return wire.portrait(await this.json(`portraits/${id}`)); }
  async portraitFiles(id: string): Promise<wire.RemoteFiles> { return wire.download(await this.json(`portraits/${id}/download`, 'POST'), this.origin(), ['portrait.png']); }

  /** Spends credits. The same request id answers the same job, so a lost answer can be asked for again. */
  async order(request: MotionOrderRequest): Promise<MotionJob> {
    try { return this.notice(wire.job(await this.json('jobs', 'POST', request)))!; } finally { this.account.creditsChanged(); }
  }
  async job(id: string): Promise<MotionJob> { return this.notice(wire.job(await this.json(`jobs/${id}`)))!; }

  async list(): Promise<MotionCharacter[]> { return wire.characters(await this.json('characters')).map(c => this.seen(c)); }
  async get(id: string): Promise<MotionCharacter> { return this.seen(wire.character(await this.json(`characters/${id}`))); }
  async rename(id: string, name: string): Promise<MotionCharacter> { return wire.character(await this.json(`characters/${id}`, 'PATCH', { name })); }
  async remove(id: string): Promise<void> { await this.json(`characters/${id}`, 'DELETE'); }
  async characterFiles(id: string): Promise<wire.RemoteFiles> { return wire.download(await this.json(`characters/${id}/download`, 'POST'), this.origin(), ['character.pxmo', 'poster.png']); }
}
