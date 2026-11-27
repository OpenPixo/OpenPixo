import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MotionCharacter } from '@openpixo/contracts';
import { readCapped } from '../store/verified-download.js';
import type { MotionCloud } from './cloud.js';
import { MotionError } from './errors.js';
import { MOTION_ID, type RemoteFile, type RemoteFiles } from './wire.js';

export type MotionFetch = (url: string, init: { headers: Record<string, string>; redirect: 'error'; signal: AbortSignal }) => Promise<Response>;

/** Written last, so a folder with it is whole. It holds the SHA-256 of the character file. */
const WHOLE = '.whole';
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);
const failed = (): MotionError => new MotionError('MOTION_DOWNLOAD_FAILED');
const known = (id: string): string => { if (!MOTION_ID.test(id)) throw new MotionError('MOTION_NOT_FOUND'); return id; };

/**
 * Portraits and finished characters on this computer, under the daemon data root. Each is downloaded once and
 * checked against the size and SHA-256 the cloud gave; a character's folder is there whole or not at all.
 */
export class MotionFiles {
  private readonly running = new Map<string, Promise<string>>();
  constructor(private readonly root: string, private readonly cloud: MotionCloud, private readonly fetchFile: MotionFetch = (url, init) => fetch(url, init)) {}

  private once(key: string, work: () => Promise<string>): Promise<string> {
    const running = this.running.get(key);
    if (running) return running;
    const next = work().finally(() => { this.running.delete(key); });
    this.running.set(key, next);
    return next;
  }

  /** The portrait picture, once it is painted. */
  portrait(id: string): Promise<string> {
    const file = path.join(this.root, 'portraits', `${known(id)}.png`);
    return this.once(`portrait:${id}`, async () => {
      if (await exists(file)) return file;
      const portrait = await this.cloud.portrait(id);
      if (portrait.state !== 'ready') throw new MotionError(portrait.state === 'failed' ? portrait.errorCode ?? 'MOTION_PAINTING_FAILED' : 'MOTION_PORTRAIT_NOT_READY');
      const remote = await this.cloud.portraitFiles(id), data = await this.get(remote, remote.files[0]!);
      await mkdir(path.dirname(file), { recursive: true });
      const part = `${file}.${randomBytes(4).toString('hex')}.part`;
      await writeFile(part, data);
      await rename(part, file);
      return file;
    });
  }

  /**
   * The folder with `character.pxmo` and `poster.png`. What is here is served without asking the cloud; given the
   * character as the cloud has it now, a file that is not the same any more is downloaded again.
   */
  character(id: string, now?: MotionCharacter): Promise<string> {
    const folder = path.join(this.root, 'characters', known(id));
    return this.once(`character:${id}`, async () => {
      const have = await readFile(path.join(folder, WHOLE), 'utf8').catch(() => null);
      if (have !== null && (!now?.file || now.file.sha256 === have.trim())) return folder;
      const character = now ?? await this.cloud.get(id);
      if (!character.file) throw new MotionError(character.state === 'failed' ? 'MOTION_NOT_FOUND' : 'MOTION_BUSY');
      const remote = await this.cloud.characterFiles(id), file = remote.files.find(f => f.name === 'character.pxmo')!;
      if (file.sha256 !== character.file.sha256 || file.bytes !== character.file.bytes) throw failed();
      const stage = path.join(path.dirname(folder), `.${id}.partial-${randomBytes(4).toString('hex')}`);
      await mkdir(stage, { recursive: true });
      try {
        for (const f of remote.files) await writeFile(path.join(stage, f.name), await this.get(remote, f));
        await writeFile(path.join(stage, WHOLE), file.sha256);
        await rm(folder, { recursive: true, force: true });
        await rename(stage, folder);
      } finally { await rm(stage, { recursive: true, force: true }); }
      return folder;
    });
  }

  async forget(id: string): Promise<void> {
    if (MOTION_ID.test(id)) await rm(path.join(this.root, 'characters', id), { recursive: true, force: true });
  }

  private async get(remote: RemoteFiles, file: RemoteFile): Promise<Buffer> {
    let response: Response;
    try { response = await this.fetchFile(`${remote.baseUrl}/${file.name}`, { headers: { authorization: `Bearer ${remote.token}` }, redirect: 'error', signal: AbortSignal.timeout(180_000) }); }
    catch { throw failed(); }
    if (!response.ok) { await response.body?.cancel(); throw failed(); }
    const data = await readCapped(response, file.bytes, file.name, failed);
    if (data.length !== file.bytes || createHash('sha256').update(data).digest('hex') !== file.sha256) throw failed();
    return data;
  }
}
