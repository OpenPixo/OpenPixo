import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCommandInvocation, forceStopWindowsProcessTree } from '@openpixo/platform';
import type { CodexImageReasonCode, GeneratedProjectAssetFile, ImageOutputSize, ProjectMetadata } from '@openpixo/contracts';
import { kindFor, mimeFor, resolveProjectWritePath } from '../projects.js';
import { codexImageDataRoot, resolveCodexImageRuntime, type CodexImageRuntime } from './codex-image-runtime.js';
import { finalSizeInstruction, keyedBackgroundInstruction, type RgbColor, type ShapedImage } from './image-output.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DIAGNOSTIC_LIMIT = 16 * 1024;

export class CodexImageError extends Error {
  constructor(readonly code: CodexImageReasonCode, message: string,
    readonly status = 502, readonly retryable = false) {
    super(message);
    this.name = 'CodexImageError';
  }
}

export interface CodexImageOptions {
  dataRoot: string;
  prompt: string;
  negativePrompt?: string | undefined;
  count?: number | undefined;
  images?: readonly string[] | undefined;
  background?: 'transparent' | 'scene' | undefined;
  aspect?: string | undefined;
  resolution?: string | undefined;
  /** Final size the host resizes to; a composition hint for image_gen. */
  finalSize?: ImageOutputSize | undefined;
  /** Backdrop color to paint if image_gen cannot return alpha. */
  keyColor?: RgbColor | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  onProgress?: ((message: string) => void) | undefined;
  /** Tests supply a fake executable; production always uses the runtime detector. */
  resolveRuntime?: ((dataRoot: string, options?: { generating?: boolean }) => Promise<CodexImageRuntime>) | undefined;
}

export function codexImageInstruction(options: CodexImageOptions): string {
  return [
    `Use your built-in image_gen tool to generate exactly ${options.count ?? 1} image(s).`,
    'Make one image_gen call per image. Do not use API/CLI fallbacks, write code, or run shell commands.',
    ...(options.images?.length ? ['The attached images are references or edit targets. Preserve what the request does not ask to change.'] : []),
    ...(options.background === 'transparent' ? ['Use a genuinely transparent background and preserve the alpha channel.',
      ...(options.keyColor ? [`If you cannot return alpha: ${keyedBackgroundInstruction(options.keyColor)}`] : [])] : []),
    ...(options.aspect ? [`Aspect ratio: ${options.aspect}.`] : []),
    ...(options.resolution ? [`Size hint: ${options.resolution}.`] : []),
    ...(options.finalSize ? [finalSizeInstruction(options.finalSize)] : []),
    '', 'Image request:', options.prompt,
    ...(options.negativePrompt ? ['', 'Avoid:', options.negativePrompt] : []),
    '', 'When finished, reply only with DONE.',
  ].join('\n');
}

function failureFromDiagnostic(diagnostic: string): CodexImageError {
  if (/not (?:logged|signed) in|not authenticated|login required|please (?:log|sign) in|unauthorized|401|token.{0,30}expired/i.test(diagnostic)) {
    return new CodexImageError('CODEX_CLI_AUTH_REQUIRED', 'Codex sign-in is required. Run codex login with your ChatGPT account.', 401);
  }
  if (/quota|usage[_ ]limit|insufficient[_ ]credits?|credits?.{0,30}(?:exhausted|insufficient)|limit.{0,30}(?:reset|plan)|out of credits/i.test(diagnostic)) {
    return new CodexImageError('CODEX_IMAGE_QUOTA_EXCEEDED', 'Your Codex plan image allowance has been reached. Wait for it to reset or switch providers.', 429);
  }
  if (/rate[_ -]?limit|too many requests|429|throttl/i.test(diagnostic)) {
    return new CodexImageError('CODEX_IMAGE_RATE_LIMITED', 'Codex image generation is rate limited. Try again later.', 429, true);
  }
  return new CodexImageError('CODEX_IMAGE_FAILED', 'Codex image generation failed. Check the CLI or choose another image provider.', 502, true);
}

async function directories(root: string): Promise<string[]> {
  try { return await readdir(root); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

/** A new thread owns its output directory. Never search other threads as a fallback. */
export async function generateCodexImages(options: CodexImageOptions): Promise<Array<{ bytes: Buffer; ext: string }>> {
  const count = options.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('Codex image count must be an integer from 1 to 4');
  if (options.signal?.aborted) throw new CodexImageError('CODEX_IMAGE_CANCELLED', 'Codex image generation was cancelled.', 499);
  const runtime = await (options.resolveRuntime ?? resolveCodexImageRuntime)(options.dataRoot, { generating: true });
  if (!runtime.status.available || !runtime.executable) {
    throw new CodexImageError(runtime.status.reasonCode ?? 'CODEX_CLI_NOT_FOUND', runtime.status.reason ?? 'Codex CLI is unavailable.', 503);
  }
  const env: NodeJS.ProcessEnv = { ...runtime.env, PIXO_DATA_DIR: options.dataRoot };
  const imageRoot = path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'generated_images');
  const existingThreads = new Set(await directories(imageRoot));
  const tempRoot = path.join(options.dataRoot, 'tmp', 'codex-image');
  await mkdir(tempRoot, { recursive: true });
  const cwd = await mkdtemp(path.join(tempRoot, 'run-'));
  try {
    const args = ['exec', '--skip-git-repo-check', '-s', 'read-only', '--json', '--color', 'never',
      ...(options.images ?? []).map(image => `--image=${path.resolve(image)}`), '-C', cwd, '-'];
    const invocation = createCommandInvocation({ command: runtime.executable, args, env });
    let threadId: string | undefined;
    let diagnostic = '';
    let pendingLine = '';
    let stopReason: CodexImageError | undefined;
    let stopping: Promise<void> | undefined;
    const appendDiagnostic = (text: string) => { diagnostic = (diagnostic + '\n' + text).slice(-DIAGNOSTIC_LIMIT); };
    const parseLine = (line: string) => {
      try {
        const event = JSON.parse(line);
        if (event.type === 'thread.started' && typeof event.thread_id === 'string'
          && /^[a-zA-Z0-9_-]{1,128}$/.test(event.thread_id) && !threadId) {
          threadId = event.thread_id;
          options.onProgress?.('Codex · image_gen');
        }
        if (event.type === 'error' || event.type === 'turn.failed') appendDiagnostic(line);
        if (event.item?.type === 'agent_message' && typeof event.item.text === 'string') appendDiagnostic(event.item.text);
      } catch { /* Non-JSON CLI diagnostics are not output paths. */ }
    };
    const child = spawn(invocation.command, invocation.args, {
      cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      detached: process.platform !== 'win32',
    });
    const stop = (reason: CodexImageError) => {
      if (stopReason) return;
      stopReason = reason;
      stopping = (async () => {
        if (!child.pid) return;
        if (process.platform === 'win32') await forceStopWindowsProcessTree(child.pid);
        else { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
      })().catch(() => { child.kill('SIGKILL'); });
    };
    const abort = () => stop(new CodexImageError('CODEX_IMAGE_CANCELLED', 'Codex image generation was cancelled.', 499));
    const timeout = setTimeout(() => stop(new CodexImageError('CODEX_IMAGE_TIMEOUT', 'Codex image generation timed out. Try again or switch providers.', 504, true)), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    try {
      const exit = await new Promise<number | null>((resolve, reject) => {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          pendingLine += chunk;
          let newline: number;
          while ((newline = pendingLine.indexOf('\n')) !== -1) {
            parseLine(pendingLine.slice(0, newline)); pendingLine = pendingLine.slice(newline + 1);
          }
          if (pendingLine.length > DIAGNOSTIC_LIMIT * 4) pendingLine = '';
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', appendDiagnostic);
        child.stdin.on('error', () => { /* Early exit is classified from close/error. */ });
        child.once('error', error => reject(new CodexImageError(
          (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'CODEX_CLI_NOT_FOUND' : 'CODEX_IMAGE_FAILED',
          'Codex CLI could not be started. Detect the CLI again in Settings.', 503)));
        child.once('close', code => resolve(code));
        child.stdin.end(codexImageInstruction(options), 'utf8');
      });
      if (pendingLine) parseLine(pendingLine);
      if (stopping) await stopping;
      if (stopReason) throw stopReason;
      if (exit !== 0) throw failureFromDiagnostic(diagnostic);
      if (!threadId || existingThreads.has(threadId)) {
        const failure = failureFromDiagnostic(diagnostic);
        if (failure.code !== 'CODEX_IMAGE_FAILED') throw failure;
        throw new CodexImageError('CODEX_IMAGE_NO_OUTPUT', 'Codex did not produce an image. Try another prompt or image provider.');
      }
      const threadRoot = path.join(imageRoot, threadId);
      const names = await directories(threadRoot);
      const images: Array<{ bytes: Buffer; ext: string }> = [];
      for (const name of names.sort()) {
        const ext = path.extname(name).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(ext)) continue;
        const file = path.join(threadRoot, name);
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink()) continue;
        images.push({ bytes: await readFile(file), ext });
      }
      if (!images.length) {
        const failure = failureFromDiagnostic(diagnostic);
        if (failure.code !== 'CODEX_IMAGE_FAILED') throw failure;
        throw new CodexImageError('CODEX_IMAGE_NO_OUTPUT', 'Codex did not produce an image. Try another prompt or image provider.');
      }
      return images;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      if (stopping) await stopping;
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export interface CodexImageFilesOptions extends Omit<CodexImageOptions, 'dataRoot' | 'images'> {
  dataRoot?: string | undefined;
  projectsRoot: string;
  projectId: string;
  metadata?: ProjectMetadata | undefined;
  output: string;
  references: Array<{ abs: string; dataUrl: string }>;
  /** Exact size / real alpha post-process, applied to each image before it is written. */
  shape?: ((bytes: Buffer) => Promise<ShapedImage>) | undefined;
  onBytesWritten?: ((written: { bytes: Buffer; name: string; mime: string; kind: string; mtime: number }) => void | Promise<void>) | undefined;
}

/** Persist every generated image through the same project-write boundary as other providers. */
export async function generateCodexImageFiles(options: CodexImageFilesOptions) {
  const outputs = await generateCodexImages({ ...options, dataRoot: codexImageDataRoot(options.dataRoot),
    images: options.references.map(ref => ref.abs) });
  const files = [];
  for (const [index, generated] of outputs.entries()) {
    const shaped = options.shape ? await options.shape(generated.bytes) : null;
    const output = shaped ? { bytes: shaped.bytes, ext: shaped.ext ?? generated.ext } : generated;
    const stem = options.output.slice(0, options.output.length - path.posix.extname(options.output).length);
    const name = `${stem}${outputs.length > 1 ? `-${index + 1}` : ''}${output.ext}`;
    const destination = await resolveProjectWritePath(options.projectsRoot, options.projectId, name, options.metadata);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, output.bytes);
    const info = await stat(destination);
    const file = { name, size: info.size, mtime: info.mtimeMs, kind: kindFor(name), mime: mimeFor(name),
      model: 'codex-image', surface: 'image' as const, providerId: 'codex-cli', providerNote: 'Codex · image_gen',
      providerError: null, usedStubFallback: false, intentionalStub: false, warnings: shaped?.warnings ?? [],
      ...(shaped?.width ? { width: shaped.width } : {}), ...(shaped?.height ? { height: shaped.height } : {}),
      ...(shaped?.sourceWidth && shaped.sourceHeight ? { renderedWidth: shaped.sourceWidth, renderedHeight: shaped.sourceHeight } : {}),
      ...(shaped?.transparent ? { transparent: true } : {}),
      assetProvenance: {
        contentHash: createHash('sha256').update(output.bytes).digest('hex'), provider: 'codex-cli', model: 'codex-image',
        promptText: options.prompt,
        params: { aspect: options.aspect, resolution: options.resolution, background: options.background, count: options.count ?? 1,
          ...(shaped ? { width: shaped.width, height: shaped.height, alpha: shaped.alpha } : {}),
          ...(options.finalSize ? { requestedWidth: options.finalSize.width, requestedHeight: options.finalSize.height } : {}) },
        referenceHashes: options.references.map(ref => createHash('sha256').update(Buffer.from(ref.dataUrl.split(',')[1]!, 'base64')).digest('hex')),
      } satisfies GeneratedProjectAssetFile['assetProvenance'],
    };
    try { await options.onBytesWritten?.({ bytes: output.bytes, ...file }); }
    catch (error) { console.warn('[media] Codex image snapshot capture failed', error); }
    files.push(file);
  }
  return { ...files[0]!, files };
}
