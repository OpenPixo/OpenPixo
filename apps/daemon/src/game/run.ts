import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { createCommandInvocation, forceStopWindowsProcessTree } from '@openpixo/platform';
import type { EngineProfile, GameRunStatus } from '@openpixo/contracts';
import { gameLocalUrl } from './verify.js';
import { missingGameToolGuidance } from './verify-tools.js';
import { prepareGameDependencyInstall, resolveGameCommandDirectory } from './install-deps.js';

export const GAME_RUN_LOG_LIMIT = 64 * 1024;
const GAME_RUN_STOP_TIMEOUT_MS = 5000;

export interface GameRunContext {
  profile: EngineProfile;
  projectDir: string;
  resolveTool: (id: string) => string | null | Promise<string | null>;
}

interface RunEntry {
  state: GameRunStatus;
  log: Buffer;
  logFile?: string;
  logWrite?: Promise<void>;
  logDirty: boolean;
  launch?: Promise<void>;
  child?: ChildProcess;
  closed?: Promise<void>;
  stopRequested: boolean;
  stop?: Promise<void>;
  cleanup?: Promise<void>;
  startupTimer?: ReturnType<typeof setTimeout>;
}

/** Require a URL terminator so a port split across stdout chunks is never accepted. */
export function gameRunUrlFromOutput(output: string, expectedPort?: number): string | null {
  const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
  for (const match of plain.matchAll(/http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s<>"']*)?(?=\s)/g)) {
    const local = gameLocalUrl(match[0]);
    if (local && (expectedPort === undefined || Number(new URL(local).port || 80) === expectedPort)) return local;
  }
  return null;
}

async function loopbackPort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Could not allocate a local game port')); return; }
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32') await forceStopWindowsProcessTree(child.pid);
  else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { child.kill('SIGKILL'); }
  }
}

/** Owns project processes until their pipes close; neither commands nor argv come from HTTP. */
export class GameRunManager {
  private readonly entries = new Map<string, RunEntry>();
  private disposed = false;

  constructor(private readonly dataDir: string, private readonly onRunning?: (projectId: string, state: GameRunStatus) => void) {}

  status(projectId: string): GameRunStatus {
    const entry = this.entries.get(projectId);
    return entry ? { ...entry.state, ...(entry.state.logRef ? { logTail: entry.log.toString('utf8') } : {}) } : { status: 'idle' };
  }

  log(projectId: string, ref: string): string | null {
    const entry = this.entries.get(projectId);
    return entry?.state.logRef === ref ? entry.log.toString('utf8') : null;
  }

  async start(projectId: string, prepare: () => Promise<GameRunContext>): Promise<GameRunStatus> {
    if (this.disposed) return { status: 'failed', reasonCode: 'START_FAILED', message: 'The daemon is shutting down' };
    const previous = this.entries.get(projectId);
    if (previous && (previous.state.status === 'starting' || previous.state.status === 'running' || previous.child || previous.stop || previous.cleanup)) return this.status(projectId);
    const entry: RunEntry = { state: { status: 'starting' }, log: Buffer.alloc(0), logDirty: false, stopRequested: false };
    this.entries.set(projectId, entry);
    entry.launch = this.launch(projectId, entry, prepare);
    await entry.launch;
    return this.status(projectId);
  }

  async stop(projectId: string): Promise<GameRunStatus> {
    const entry = this.entries.get(projectId);
    if (!entry) return { status: 'idle' };
    entry.stopRequested = true;
    clearTimeout(entry.startupTimer);
    entry.stop ??= (async () => {
      await entry.launch;
      await entry.cleanup;
      if (entry.child) {
        await this.cleanupTree(entry);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([entry.closed, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Game process descendants did not stop')), GAME_RUN_STOP_TIMEOUT_MS);
          })]);
        } finally { clearTimeout(timer); }
      }
      if (entry.state.status === 'starting' || entry.state.status === 'running') entry.state = { ...entry.state, status: 'exited', exitedAt: Date.now(), exitCode: null };
      await entry.logWrite;
    })().finally(() => { delete entry.stop; });
    await entry.stop;
    return this.status(projectId);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.entries.keys()].map(id => this.stop(id)));
  }

  private append(entry: RunEntry, chunk: Buffer | string): void {
    entry.log = Buffer.concat([entry.log, Buffer.from(chunk)]).subarray(-GAME_RUN_LOG_LIMIT);
    if (!entry.logFile) return;
    entry.logDirty = true;
    if (!entry.logWrite) {
      entry.logWrite = (async () => {
        while (entry.logDirty) { entry.logDirty = false; await writeFile(entry.logFile!, entry.log); }
      })().catch(() => {}).finally(() => { delete entry.logWrite; });
    }
  }

  private fail(entry: RunEntry, reasonCode: NonNullable<GameRunStatus['reasonCode']>, message: string): void {
    entry.state = { ...entry.state, status: 'failed', reasonCode, message, exitedAt: Date.now() };
    this.append(entry, `\n${message}\n`);
  }

  private markRunning(projectId: string, entry: RunEntry, url?: string): void {
    entry.state = { ...entry.state, status: 'running', ...(url ? { url } : {}) };
    clearTimeout(entry.startupTimer);
    // A record write must never fail a healthy process or escape a stdout callback.
    try { this.onRunning?.(projectId, { ...entry.state }); }
    catch { this.append(entry, '\nCould not save the game readiness record.\n'); }
  }

  private async launch(projectId: string, entry: RunEntry, prepare: () => Promise<GameRunContext>): Promise<void> {
    try {
      const { profile, projectDir: inputDir, resolveTool } = await prepare();
      entry.state.engine = profile.engine;
      if (entry.stopRequested) { entry.state.status = 'exited'; return; }
      // Godot 3 profiles expose the engine tool through check; run it with fixed main-scene arguments.
      const command = profile.commands.run ?? (profile.engine === 'godot' ? profile.commands.check : undefined);
      const web = ['phaser', 'threejs', 'web-generic'].includes(profile.engine);
      if ((!web && profile.engine !== 'godot') || !command?.argv[0]) {
        this.fail(entry, 'UNSUPPORTED_ENGINE', 'Running this engine is not supported'); return;
      }
      const projectDir = await realpath(inputDir);
      const cwd = await resolveGameCommandDirectory(projectDir, command.cwd);
      let tool = command.argv[0];
      let executable: string | null | undefined;
      if (web) {
        const { executable: installExecutable, argv: _argv, node: _node, status: _status, ...dependencies } = await prepareGameDependencyInstall(cwd, resolveTool);
        entry.state = { ...entry.state, ...dependencies };
        if (dependencies.reasonCode) {
          this.fail(entry, dependencies.reasonCode, dependencies.message ?? 'Required package tools are missing'); return;
        }
        tool = dependencies.packageManager!;
        executable = installExecutable;
        const installed = await stat(path.join(cwd, 'node_modules')).then(value => value.isDirectory(), () => false);
        if (!installed) {
          this.fail(entry, 'DEPENDENCIES_MISSING', 'Project dependencies are missing. Install them before running the game.');
          return;
        }
      }
      executable ??= await resolveTool(tool);
      if (!executable) {
        this.fail(entry, 'MISSING_TOOL', `Required game tool is missing: ${tool}`);
        entry.state.missingToolGuidance = missingGameToolGuidance([tool]); return;
      }
      const port = web ? await loopbackPort() : undefined;
      if (entry.stopRequested) { entry.state.status = 'exited'; return; }
      const argv = web ? [...command.argv.slice(1), ...(tool === 'npm' && !command.argv.includes('--') ? ['--'] : []), '--host', '127.0.0.1', '--port', String(port), '--strictPort'] : ['--path', cwd];
      const logRef = randomUUID();
      const logDir = path.join(this.dataDir, 'logs', 'game-runs');
      await mkdir(logDir, { recursive: true });
      entry.logFile = path.join(logDir, `${logRef}.log`);
      await writeFile(entry.logFile, '');
      if (entry.stopRequested) { entry.state.status = 'exited'; return; }
      entry.state = { ...entry.state, startedAt: Date.now(), logRef };
      const invocation = createCommandInvocation({ command: executable, args: argv });
      const child = spawn(invocation.command, invocation.args, {
        cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        env: { ...process.env, PIXO_DATA_DIR: this.dataDir },
      });
      entry.child = child;
      child.once('exit', () => {
        clearTimeout(entry.startupTimer);
        if (!entry.stopRequested) void this.cleanupTree(entry).catch(error => this.append(entry, `\nCould not stop game descendants: ${String(error)}\n`));
      });
      entry.closed = new Promise(resolve => {
        child.once('close', code => {
          delete entry.child;
          clearTimeout(entry.startupTimer);
          entry.state.exitCode = code;
          if (entry.state.status !== 'failed') {
            if (entry.stopRequested || code === 0) entry.state = { ...entry.state, status: 'exited', exitedAt: Date.now(), exitCode: code };
            else this.fail(entry, 'PROCESS_EXITED', `Game process exited (${code ?? 'signal'})`);
          }
          resolve();
        });
      });
      let urlTail = '';
      const output = (chunk: Buffer) => {
        this.append(entry, chunk);
        if (web && entry.state.status === 'starting' && !entry.stopRequested) {
          urlTail = (urlTail + chunk.toString('utf8')).slice(-8192);
          const url = gameRunUrlFromOutput(urlTail, port);
          if (url) this.markRunning(projectId, entry, url);
        }
      };
      child.stdout!.on('data', output);
      child.stderr!.on('data', output);
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      if (entry.stopRequested) return;
      if (!web && entry.state.status === 'starting') this.markRunning(projectId, entry);
      else if (entry.state.status === 'starting') {
        entry.startupTimer = setTimeout(() => {
          this.fail(entry, 'START_TIMEOUT', 'The game server did not report a local URL before the startup timeout');
          void this.cleanupTree(entry).catch(error => this.append(entry, `\nCould not stop game process: ${String(error)}\n`));
        }, command.timeoutMs);
        entry.startupTimer.unref();
      }
    } catch (error) { this.fail(entry, 'START_FAILED', error instanceof Error ? error.message : String(error)); }
  }

  private async cleanupTree(entry: RunEntry): Promise<void> {
    if (!entry.child) return;
    entry.cleanup ??= killTree(entry.child).finally(() => { delete entry.cleanup; });
    await entry.cleanup;
  }
}
