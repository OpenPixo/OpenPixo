import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface SecretStore {
  isAvailable(): Promise<boolean>;
  read(): Promise<string | null>;
  write(secret: string): Promise<void>;
  clear(): Promise<void>;
}

const STORAGE_ERROR = 'OS-encrypted account storage is unavailable.';

/** Only stdin/stdout carry data; argv contains a constant PowerShell program. */
function dpapi(operation: 'Protect' | 'Unprotect', data: Buffer): Promise<Buffer> {
  const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Security; `
    + `$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd()); `
    + `$result = [System.Security.Cryptography.ProtectedData]::${operation}($bytes, $null, `
    + `[System.Security.Cryptography.DataProtectionScope]::CurrentUser); `
    + `[Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
    let output = '';
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok || !/^[A-Za-z0-9+/]*={0,2}$/u.test(output)) reject(new Error(STORAGE_ERROR));
      else resolve(Buffer.from(output, 'base64'));
    };
    const timer = setTimeout(() => { child.kill(); finish(false); }, 15_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > 1024 * 1024) { child.kill(); finish(false); }
    });
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
    child.stdin.on('error', () => finish(false));
    child.stdin.end(data.toString('base64'));
  });
}

export class DpapiSecretStore implements SecretStore {
  private readonly file: string;
  private availability: Promise<boolean> | undefined;

  constructor(dataRoot: string) {
    if (!path.isAbsolute(dataRoot)) throw new Error('An absolute resolved daemon data root is required.');
    this.file = path.join(dataRoot, 'account', 'session.dpapi');
  }

  isAvailable(): Promise<boolean> {
    return this.availability ??= process.platform !== 'win32' ? Promise.resolve(false)
      : dpapi('Protect', Buffer.from('OpenPixo storage probe')).then(() => true, () => false);
  }

  async read(): Promise<string | null> {
    if (!await this.isAvailable()) throw new Error(STORAGE_ERROR);
    try {
      const ciphertext = await readFile(this.file);
      return (await dpapi('Unprotect', ciphertext)).toString('utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error(STORAGE_ERROR);
    }
  }

  async write(secret: string): Promise<void> {
    if (!await this.isAvailable()) throw new Error(STORAGE_ERROR);
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      const ciphertext = await dpapi('Protect', Buffer.from(secret, 'utf8'));
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await writeFile(temp, ciphertext, { mode: 0o600, flag: 'wx' });
      await rename(temp, this.file);
    } catch {
      throw new Error(STORAGE_ERROR);
    } finally {
      await rm(temp, { force: true }).catch(() => {});
    }
  }

  async clear(): Promise<void> {
    try { await rm(this.file, { force: true }); }
    catch { throw new Error(STORAGE_ERROR); }
  }
}
