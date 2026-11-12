import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { resolveDaemonUrl } from '../daemon-url.js';

export class AccountCliError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export async function accountCliApi(flagUrl?: string) {
  const base = (await resolveDaemonUrl({ flagUrl: flagUrl ?? null })).replace(/\/$/u, '');
  const token = process.env.PIXO_API_TOKEN ?? process.env.PIXO_TOOL_TOKEN;
  return async <T>(route: string, method = 'GET', body?: unknown): Promise<T> => {
    try {
      const response = await fetch(`${base}/api/openpixo${route}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin,
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json() as T & { error?: { code?: string; message?: string } };
      if (!response.ok) throw new AccountCliError(data.error?.code ?? 'CLOUD_UNAVAILABLE', data.error?.message ?? 'The request failed.');
      return data;
    } catch (error) {
      if (error instanceof AccountCliError) throw error;
      throw new AccountCliError('CLOUD_UNAVAILABLE', 'The OpenPixo daemon could not be reached.');
    }
  };
}

export function printAccountCliError(error: unknown, json: boolean): void {
  const failure = error instanceof AccountCliError ? error
    : new AccountCliError('BAD_REQUEST', 'Invalid command options. Run with --help for usage.');
  if (json) console.log(JSON.stringify({ error: { code: failure.code, message: failure.message } }));
  else console.error(failure.message);
  process.exitCode = 5;
}

export async function promptEmailCode(): Promise<string> {
  if (!process.stdin.isTTY) throw new AccountCliError('BAD_REQUEST', 'Email sign-in requires an interactive terminal for the code.');
  // Suppress readline's echo, including when stdout is captured for --json.
  const silent = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const prompt = createInterface({ input: process.stdin, output: silent, terminal: true });
  const abort = new AbortController();
  prompt.once('SIGINT', () => abort.abort());
  process.stderr.write('Email code / 邮箱验证码: ');
  try { return (await prompt.question('', { signal: abort.signal })).trim(); }
  finally { prompt.close(); silent.end(); process.stderr.write('\n'); }
}

/** PowerShell receives the URL through stdin; shell syntax in a URL is never executed. */
export async function openAccountBrowser(url: string, noBrowser = false): Promise<void> {
  if (noBrowser || process.platform !== 'win32') return;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1')) return;
  const opened = await new Promise<boolean>((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; Start-Process -FilePath ([Console]::In.ReadToEnd())"], {
      windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 10_000);
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
    child.stdin.on('error', () => {});
    child.stdin.end(url);
  });
  if (!opened) console.error('Open the printed URL in your browser / 请在浏览器中打开上方链接。');
}
