import { spawn, type ChildProcess } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { createCommandInvocation, forceStopWindowsProcessTree } from '@openpixo/platform';
import type { EngineCommand } from '@openpixo/contracts';

export const VERIFY_LOG_LIMIT = 1024 * 1024;
/** Only loopback HTTP dev servers may cross the privileged capture boundary. */
export function gameLocalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function gamePngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.length > 20 * 1024 * 1024 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid screenshot PNG');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192) throw new Error('Invalid screenshot size');
  return { width, height };
}
async function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32') await forceStopWindowsProcessTree(child.pid);
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}
export class GameCommandTimeout extends Error { constructor() { super('Engine command timed out'); } }

/** Shared process/URL/timeout/cleanup implementation. No shell interpolation. */
export async function executeGameProcess<T = never>(options: {
  projectDir: string; command: EngineCommand; executable: string; argv?: string[]; output: (chunk: Buffer) => void;
  action?: (input: { urlReady: Promise<string>; remainingMs: () => number }) => Promise<T>;
}): Promise<{ exitCode: number | null; value?: T }> {
  const { command } = options;
  if (!Number.isInteger(command.timeoutMs) || command.timeoutMs < 1 || command.timeoutMs > 600_000) throw new Error('Invalid engine command timeout');
  const projectDir = await realpath(options.projectDir), cwd = await realpath(path.resolve(projectDir, command.cwd));
  const relative = path.relative(projectDir, cwd);
  if (path.isAbsolute(command.cwd) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Engine command cwd is outside the project');
  const argv = options.argv ?? command.argv;
  const invocation = createCommandInvocation({ command: options.executable, args: argv.slice(1) });
  const child = spawn(invocation.command, invocation.args, { cwd, stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', windowsHide: true, windowsVerbatimArguments: invocation.windowsVerbatimArguments });
  let tail = '', closedAlready = false;
  let foundUrl!: (url: string) => void;
  const urlReady = new Promise<string>(resolve => { foundUrl = resolve; });
  const output = (chunk: Buffer) => {
    options.output(chunk);
    tail = (tail + chunk.toString('utf8')).replace(/\x1b\[[0-9;]*m/g, '').slice(-8192);
    const candidate = tail.match(/http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/[^\s<>"']*/)?.[0];
    const local = candidate && gameLocalUrl(candidate); if (local) foundUrl(local);
  };
  child.stdout.on('data', output); child.stderr.on('data', output);
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject); child.once('close', code => { closedAlready = true; resolve(code); });
  });
  const started = Date.now(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const task = options.action ? Promise.race([
      options.action({ urlReady, remainingMs: () => Math.max(1, command.timeoutMs - (Date.now() - started)) }).then(value => ({ exitCode: null, value })),
      closed.then(code => { throw new Error(`Run exited before capture completed (${code})`); }),
    ]) : closed.then(exitCode => ({ exitCode }));
    return await Promise.race([task, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new GameCommandTimeout()), command.timeoutMs); })]);
  } finally {
    clearTimeout(timer);
    try { if (!closedAlready) await killTree(child); }
    catch (error) { child.kill('SIGKILL'); child.stdout.destroy(); child.stderr.destroy(); throw error; }
    finally { await closed.catch(() => {}); }
  }
}
