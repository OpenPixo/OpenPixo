import { isSampleCharacter, type AnimatedCharacter, CharacterBrief, CharacterBriefRequest, CharacterGear, CharacterJob, CharacterOrderRequest, CharacterService, CharacterTuning, CharacterUpdate, CharacterWear } from '@openpixo/contracts';
import { CharacterError, characterError, isCharacterCode } from './errors.js';
import * as wire from './wire.js';

/** What this module needs of the account: one signed request, and nobody else holds the session. */
export interface CharacterAccount {
  characterOrigin(): string | null;
  hasSession(): Promise<boolean>;
  character(route: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<Response>;
  /** The same without a session, for the free sample alone. */
  characterSample(route: string, method?: string): Promise<Response>;
  creditsChanged(): void;
}

const MAX_ANSWER = 16 * 1024 * 1024;

/** The character service, spoken to as the signed-in user. */
export class CharacterCloud {
  /** Paid jobs that were seen running, to notice when one ends and its credits settle. */
  private readonly running = new Set<string>();
  constructor(private readonly account: CharacterAccount) {}

  private notice(job: CharacterJob | null): void {
    if (!job || job.kind === 'pack') return;
    const ended = job.state === 'succeeded' || job.state === 'failed';
    if (!ended) this.running.add(job.id);
    else if (this.running.delete(job.id)) this.account.creditsChanged();
  }

  private seen(character: AnimatedCharacter): AnimatedCharacter { this.notice(character.job); return character; }

  available(): boolean { return this.account.characterOrigin() !== null; }
  signedIn(): Promise<boolean> { return this.account.hasSession(); }
  private origin(): string {
    const origin = this.account.characterOrigin();
    if (!origin) throw new CharacterError('CHARACTER_NOT_CONFIGURED');
    return origin;
  }

  private async send(route: string, method: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    this.origin();
    return this.answer(() => this.account.character(route, method, body, signal));
  }

  private async answer(request: () => Promise<Response>): Promise<Response> {
    let response: Response;
    try { response = await request(); } catch (error) { throw characterError(error); }
    if (response.ok) return response;
    let code: unknown;
    try { code = (await response.json() as { error?: { code?: unknown } }).error?.code; } catch { /* not ours */ }
    throw new CharacterError(isCharacterCode(code) ? code : 'CLOUD_UNAVAILABLE');
  }

  /** The free sample: no account is needed, and none is told. */
  private async open(route: string, method = 'GET'): Promise<unknown> {
    this.origin();
    const response = await this.answer(() => this.account.characterSample(route, method));
    try { return await response.json(); } catch { throw new CharacterError('CLOUD_UNAVAILABLE'); }
  }

  /** Null when the cloud has none. */
  async sample(language: string): Promise<AnimatedCharacter | null> {
    try { return wire.character(await this.open(`sample?language=${language.startsWith('zh') ? 'zh' : 'en'}`)); }
    catch (error) { if (error instanceof CharacterError && error.code === 'CHARACTER_NOT_FOUND') return null; throw error; }
  }

  private async json(route: string, method = 'GET', body?: unknown): Promise<unknown> {
    const response = await this.send(route, method, body);
    try { return await response.json(); } catch { throw new CharacterError('CLOUD_UNAVAILABLE'); }
  }

  async service(): Promise<CharacterService> { return wire.service(await this.json('service')); }
  async list(): Promise<AnimatedCharacter[]> { return wire.characters(await this.json('characters')).map(c => this.seen(c)); }
  async get(id: string): Promise<AnimatedCharacter> { return isSampleCharacter(id) ? wire.character(await this.open(`sample/${id}`)) : this.seen(wire.character(await this.json(`characters/${id}`))); }
  async brief(request: CharacterBriefRequest): Promise<CharacterBrief> { return wire.brief(await this.json('briefs', 'POST', request)); }

  /** Spends credits. The same request id answers the same job, so a lost answer can be asked for again. */
  async order(request: CharacterOrderRequest): Promise<CharacterJob> {
    try {
      const job = wire.job(await this.json('jobs', 'POST', request));
      this.notice(job);
      return job;
    } finally { this.account.creditsChanged(); }
  }

  async job(id: string): Promise<CharacterJob> {
    const job = wire.job(await this.json(`jobs/${id}`));
    this.notice(job);
    return job;
  }

  async update(id: string, change: CharacterUpdate): Promise<AnimatedCharacter> { return wire.character(await this.json(`characters/${id}`, 'PATCH', change)); }
  async remove(id: string): Promise<void> { await this.json(`characters/${id}`, 'DELETE'); }
  async saveMotion(id: string, name: string, tuning: CharacterTuning): Promise<AnimatedCharacter> { return wire.character(await this.json(`characters/${id}/motions/${name}`, 'PUT', { tuning })); }
  async removeMotion(id: string, name: string): Promise<AnimatedCharacter> { return wire.character(await this.json(`characters/${id}/motions/${name}`, 'DELETE')); }
  async pack(id: string, requestId: string): Promise<CharacterJob> { return wire.job(await this.json(`characters/${id}/pack`, 'POST', { requestId })); }
  async download(id: string): Promise<wire.RemoteFiles & { revision: number }> { return wire.packageFiles(await (isSampleCharacter(id) ? this.open(`sample/${id}/download`, 'POST') : this.json(`characters/${id}/download`, 'POST')), this.origin()); }

  /** One motion with other sliders, as it would be packed. Nothing is saved. */
  async tune(id: string, motion: string, tuning: CharacterTuning, wear: CharacterWear, signal?: AbortSignal): Promise<Buffer> {
    const response = await this.send(`characters/${id}/tune`, 'POST', { motion, tuning, wear: { weapon: wear.weapon ?? null, cape: wear.cape ?? null, shield: wear.shield ?? null } }, signal);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_ANSWER) throw new CharacterError('CLOUD_UNAVAILABLE');
    return bytes;
  }

  async gear(): Promise<CharacterGear> { return wire.gear(await this.json('gear')); }
  async gearFiles(): Promise<wire.RemoteFiles> { return wire.remoteFiles(await this.json('gear/download', 'POST'), this.origin()); }
  async renamePiece(piece: string, label: string): Promise<CharacterGear> { return wire.gear(await this.json(`gear/${piece}`, 'PATCH', { label })); }
  async removePiece(piece: string): Promise<CharacterGear> { return wire.gear(await this.json(`gear/${piece}`, 'DELETE')); }
  async removeGearMotion(name: string): Promise<CharacterGear> { return wire.gear(await this.json(`gear/motions/${name}`, 'DELETE')); }
}
