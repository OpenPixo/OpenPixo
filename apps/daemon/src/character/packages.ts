import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readCapped } from '../store/verified-download.js';
import type { CharacterCloud } from './cloud.js';
import { CharacterError } from './errors.js';
import { CHARACTER_ID, FILE_NAME, PIECE_ID, type RemoteFile, type RemoteFiles } from './wire.js';

const CONCURRENCY = 6;
const KEEP_REVISIONS = 2;
/** Written last, so a folder with it is whole. Not a name a package file can have. */
const WHOLE = '.whole';
const ICONS_MS = 60_000;

export type CharacterFetch = (url: string, init: { headers: Record<string, string>; redirect: 'error'; signal: AbortSignal }) => Promise<Response>;

const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);
const failed = (): CharacterError => new CharacterError('CHARACTER_DOWNLOAD_FAILED');

/**
 * Finished packages on this computer, for the Characters page and for games. Every file is checked
 * against the size and SHA-256 the cloud gave; a folder is there whole or not at all.
 */
export class CharacterPackages {
  private readonly running = new Map<string, Promise<{ revision: number; folder: string }>>();
  private icons: { at: number; files: Map<string, RemoteFile>; remote: RemoteFiles } | null = null;

  constructor(private readonly root: string, private readonly cloud: CharacterCloud, private readonly fetchFile: CharacterFetch = (url, init) => fetch(url, init)) {}

  private folder(id: string, revision: number): string { return path.join(this.root, 'packages', id, String(revision)); }

  /** The newest package, downloaded if it is not here yet. */
  async newest(id: string): Promise<{ revision: number; folder: string }> {
    if (!CHARACTER_ID.test(id)) throw new CharacterError('CHARACTER_NOT_FOUND');
    const running = this.running.get(id);
    if (running) return running;
    const work = this.fetchNewest(id).finally(() => { this.running.delete(id); });
    this.running.set(id, work);
    return work;
  }

  /** One file of a package, or null when there is none of that name. */
  async file(id: string, revision: number, name: string): Promise<string | null> {
    if (!CHARACTER_ID.test(id) || !Number.isSafeInteger(revision) || revision < 1 || !FILE_NAME.test(name)) return null;
    let folder = this.folder(id, revision);
    if (!await exists(path.join(folder, WHOLE))) {
      const newest = await this.newest(id);
      if (newest.revision !== revision) return null;
      ({ folder } = newest);
    }
    const file = path.join(folder, name);
    return await exists(file) ? file : null;
  }

  /** The small picture of a piece the account owns. */
  async icon(piece: string): Promise<string | null> {
    if (!PIECE_ID.test(piece)) return null;
    const name = `${piece}.png`;
    if (!this.icons || Date.now() - this.icons.at > ICONS_MS || !this.icons.files.has(name)) {
      const remote = await this.cloud.gearFiles();
      this.icons = { at: Date.now(), remote, files: new Map(remote.files.map(f => [f.name, f])) };
    }
    const { files, remote } = this.icons, wanted = files.get(name);
    if (!wanted) return null;
    // by what is in it: another account's pieces have the same names
    const folder = path.join(this.root, 'icons'), file = path.join(folder, `${wanted.sha256}.png`);
    if (!await exists(file)) {
      const data = await this.get(remote, wanted);
      await mkdir(folder, { recursive: true });
      const part = `${file}.${randomBytes(4).toString('hex')}.part`;
      await writeFile(part, data);
      await rename(part, file);
    }
    return file;
  }

  /** After a change of what the account owns. */
  forgetIcons(): void { this.icons = null; }

  async forget(id: string): Promise<void> {
    if (CHARACTER_ID.test(id)) await rm(path.join(this.root, 'packages', id), { recursive: true, force: true });
  }

  private async get(remote: RemoteFiles, file: RemoteFile): Promise<Buffer> {
    let response: Response;
    try { response = await this.fetchFile(`${remote.baseUrl}/${file.name}`, { headers: { authorization: `Bearer ${remote.token}` }, redirect: 'error', signal: AbortSignal.timeout(120_000) }); }
    catch { throw failed(); }
    if (!response.ok) { await response.body?.cancel(); throw failed(); }
    const data = await readCapped(response, file.bytes, file.name, failed);
    if (data.length !== file.bytes || createHash('sha256').update(data).digest('hex') !== file.sha256) throw failed();
    return data;
  }

  private async fetchNewest(id: string): Promise<{ revision: number; folder: string }> {
    const remote = await this.cloud.download(id), target = this.folder(id, remote.revision);
    if (await exists(path.join(target, WHOLE))) return { revision: remote.revision, folder: target };
    const parent = path.dirname(target), stage = path.join(parent, `.partial-${randomBytes(4).toString('hex')}`);
    await mkdir(stage, { recursive: true });
    try {
      const queue = [...remote.files], old = await this.reusable(parent);
      const worker = async (): Promise<void> => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          // most files are the same as in the package before
          const known = old.get(file.sha256);
          let data: Buffer | null = known ? await readFile(known).catch(() => null) : null;
          if (!data || data.length !== file.bytes || createHash('sha256').update(data).digest('hex') !== file.sha256) data = await this.get(remote, file);
          await writeFile(path.join(stage, file.name), data);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
      await writeFile(path.join(stage, WHOLE), JSON.stringify(Object.fromEntries(remote.files.map(f => [f.name, f.sha256]))));
      await rm(target, { recursive: true, force: true });
      await rename(stage, target);
    } finally { await rm(stage, { recursive: true, force: true }); }
    await this.dropOld(parent);
    return { revision: remote.revision, folder: target };
  }

  private async revisions(parent: string): Promise<number[]> {
    return (await readdir(parent).catch(() => [])).filter(n => /^[1-9]\d{0,8}$/u.test(n)).map(Number).sort((a, b) => b - a);
  }

  private async reusable(parent: string): Promise<Map<string, string>> {
    const [newest] = await this.revisions(parent);
    if (newest === undefined) return new Map();
    const folder = path.join(parent, String(newest));
    try {
      const names = JSON.parse(await readFile(path.join(folder, WHOLE), 'utf8')) as Record<string, string>;
      return new Map(Object.entries(names).filter(([name]) => FILE_NAME.test(name)).map(([name, sha]) => [sha, path.join(folder, name)]));
    } catch { return new Map(); }
  }

  private async dropOld(parent: string): Promise<void> {
    for (const revision of (await this.revisions(parent)).slice(KEEP_REVISIONS)) await rm(path.join(parent, String(revision)), { recursive: true, force: true }).catch(() => {});
  }
}
