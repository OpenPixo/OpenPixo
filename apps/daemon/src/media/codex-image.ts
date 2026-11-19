import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCommandInvocation, forceStopWindowsProcessTree } from '@openpixo/platform';
import type { CodexImageReasonCode, GeneratedProjectAssetFile, ImageOutputSize, ProjectMetadata } from '@openpixo/contracts';
import { kindFor, mimeFor, resolveProjectWritePath } from '../projects.js';
import { clampCodexReasoning } from '../runtimes/defs/shared.js';
import { codexImageDataRoot, resolveCodexImageRuntime, type CodexImageRuntime } from './codex-image-runtime.js';
import { finalSizeInstruction, keyedBackgroundInstruction, type RgbColor, type ShapedImage } from './image-output.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DIAGNOSTIC_LIMIT = 16 * 1024;

/**
 * An image job carries only what one image_gen call needs. A build makes
 * 50–160 images on the user's own ChatGPT plan, and each turn otherwise loads
 * the user's whole Codex setup: on Codex CLI 0.160.0 a real thread carried
 * ~42 KB of global skill instructions, ~34 KB of AGENTS.md found by walking up
 * from the temp cwd, the multi-agent role blocks and the recommended-plugin
 * list, about 45k input tokens per request. The skill list also sent the model
 * looking for an "imagegen skill" through a 41 KB tool listing before it drew.
 *
 * - `project_doc_max_bytes=0`: no AGENTS.md discovery.
 * - `skills.include_instructions=false`: no skills block.
 * - `agents.enabled=false`: no multi-agent role/mode blocks. The model catalogue
 *   turns multi-agent v2 on for some models, so `--disable multi_agent` alone
 *   does not remove them.
 * - `--disable plugins` / `--disable apps`: no plugin or connector instructions.
 *
 * Measured with `codex debug prompt-input`: 85.7k → 10.7k characters of input
 * items. A real image with the same reference then took two requests,
 * 12.9k + 15.4k input tokens (28k), where the old thread took 167k. The user's MCP servers stay configured: an empty `mcp_servers` table
 * merges instead of clearing them. Image runs only; the agent runtime keeps the
 * user's full setup.
 */
export const CODEX_IMAGE_CONTEXT_ARGS: readonly string[] = [
  '-c', 'project_doc_max_bytes=0',
  '-c', 'skills.include_instructions=false',
  '-c', 'agents.enabled=false',
  '--disable', 'plugins',
  '--disable', 'apps',
];

/**
 * An image job runs on the Codex model the user picked in OpenPixo, at low
 * reasoning. The model only turns the request into one image_gen call, so the
 * user's agent reasoning (often `high`) would think for nothing on each of a
 * build's 50–160 images. With no picked model the CLI's own default applies.
 * `low` is clamped the way agent runs clamp it (`gpt-5.1-codex-mini` → `medium`).
 */
export function codexImageModelArgs(model: string | undefined): string[] {
  return [...(model ? ['-m', model] : []), '-c', `model_reasoning_effort="${clampCodexReasoning(model, 'low')}"`];
}

export class CodexImageError extends Error {
  /**
   * Codex's own short reason, for the daemon log only (`[media] … "detail"`).
   * Never copied into task state, CLI output or the UI.
   */
  logDetail?: string;
  constructor(readonly code: CodexImageReasonCode, message: string,
    readonly status = 502, readonly retryable = false) {
    super(message);
    this.name = 'CodexImageError';
  }
}

const LOG_DETAIL_LIMIT = 300;

/**
 * The reason inside one Codex `error` / `turn.failed` message. The API's error
 * body arrives as a JSON string there; its inner message and code are what say
 * why (`The 'gpt-6.2-sol' model is not supported … (model_not_found)`).
 */
export function codexFailureReason(message: string): string | undefined {
  let reason = message;
  try {
    const body = JSON.parse(message);
    const inner = body?.error && typeof body.error === 'object' ? body.error : body;
    if (typeof inner?.message === 'string' && inner.message.trim()) {
      reason = inner.message + (typeof inner.code === 'string' && inner.code ? ` (${inner.code})` : '');
    }
  } catch { /* A plain sentence is already the reason. */ }
  const trimmed = reason.replace(/\s+/g, ' ').trim().slice(0, LOG_DETAIL_LIMIT);
  return trimmed || undefined;
}

/** Attach Codex's last reported reason to a failure, for the daemon log. */
function withLogDetail(error: CodexImageError, reason: string | undefined): CodexImageError {
  if (reason) error.logDetail = reason;
  return error;
}

// Codex's answer when the model it runs on is not offered to this sign-in (a
// ChatGPT login and a config.toml default it cannot use). Every image fails the
// same way, so it is not retryable, and the fix is another Codex model.
const MODEL_UNSUPPORTED_RE = /model_not_found|model is not supported/i;

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

/** Width over height of `WxH` or `W:H`, or null for anything else (`1k`, `720p`). */
function shapeRatio(value: string | undefined): number | null {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*[x:×]\s*(\d+(?:\.\d+)?)$/iu);
  if (!match) return null;
  const width = Number(match[1]), height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

/**
 * The resolution hint image_gen may be given, or undefined. A hint whose shape
 * differs from the requested aspect or final size contradicted them: a style's
 * recommended 1024x1024 went out as "Aspect ratio: 16:9. Size hint: 1024x1024.
 * Final asset size: 1536x864". The aspect and final size are what the host
 * produces, so a hint that does not match their shape is left out.
 */
export function codexSizeHint(options: Pick<CodexImageOptions, 'aspect' | 'resolution' | 'finalSize'>): string | undefined {
  const resolution = options.resolution?.trim();
  if (!resolution) return undefined;
  const target = options.finalSize ? options.finalSize.width / options.finalSize.height : shapeRatio(options.aspect);
  if (target === null) return options.aspect ? undefined : resolution;
  const hinted = shapeRatio(resolution);
  return hinted !== null && Math.abs(hinted / target - 1) <= 0.02 ? resolution : undefined;
}

export function codexImageInstruction(options: CodexImageOptions): string {
  const sizeHint = codexSizeHint(options);
  return [
    `Use your built-in image_gen tool to generate exactly ${options.count ?? 1} image(s).`,
    'Make one image_gen call per image. Do not use API/CLI fallbacks, write code, or run shell commands.',
    ...(options.images?.length ? ['The attached images are references or edit targets. Preserve what the request does not ask to change.'] : []),
    ...(options.background === 'transparent' ? ['Use a genuinely transparent background and preserve the alpha channel.',
      ...(options.keyColor ? [`If you cannot return alpha: ${keyedBackgroundInstruction(options.keyColor)}`] : [])] : []),
    ...(options.aspect ? [`Aspect ratio: ${options.aspect}.`] : []),
    ...(sizeHint ? [`Size hint: ${sizeHint}.`] : []),
    ...(options.finalSize ? [finalSizeInstruction(options.finalSize)] : []),
    '', 'Image request:', options.prompt,
    ...(options.negativePrompt ? ['', 'Avoid:', options.negativePrompt] : []),
    '', 'When finished, reply only with DONE.',
  ].join('\n');
}

// What Codex reports when OpenAI's safety system refuses an image_gen call: the tool error carries
// `moderation_blocked` / "rejected by the safety system", and the thread's last agent message says
// it was "blocked by the safety system". The thread still exits 0 with no image, so without this
// check the refusal reads as an empty result and the agent is told to switch models.
const SAFETY_BLOCK_RE = /moderation_blocked|(?:blocked|rejected) by (?:the |OpenAI'?s )?safety system|content[ _]polic(?:y|ies)/i;

function failureFromDiagnostic(diagnostic: string): CodexImageError {
  if (SAFETY_BLOCK_RE.test(diagnostic)) {
    return new CodexImageError('CODEX_IMAGE_CONTENT_BLOCKED', 'The image request was blocked by the safety system. Reword it and try again.', 400, false);
  }
  if (MODEL_UNSUPPORTED_RE.test(diagnostic)) {
    return new CodexImageError('CODEX_IMAGE_MODEL_UNSUPPORTED',
      'Codex cannot use its model with this sign-in. Pick a different Codex model in OpenPixo, then try again.', 400, false);
  }
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
      ...CODEX_IMAGE_CONTEXT_ARGS, ...codexImageModelArgs(runtime.model),
      ...(options.images ?? []).map(image => `--image=${path.resolve(image)}`), '-C', cwd, '-'];
    const invocation = createCommandInvocation({ command: runtime.executable, args, env });
    let threadId: string | undefined;
    let diagnostic = '';
    // The last reason Codex's own error events gave, for the daemon log.
    let failureReason: string | undefined;
    const failed = (error: CodexImageError) => withLogDetail(error, failureReason);
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
        if (event.type === 'error' || event.type === 'turn.failed') {
          appendDiagnostic(line);
          const message = event.type === 'error' ? event.message : event.error?.message;
          if (typeof message === 'string') failureReason = codexFailureReason(message) ?? failureReason;
        }
        if (event.item?.type === 'agent_message' && typeof event.item.text === 'string') appendDiagnostic(event.item.text);
      } catch { /* Non-JSON CLI diagnostics are not output paths. */ }
    };
    const spawnedAtMs = Date.now();
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
        if (process.platform === 'win32') await forceStopWindowsProcessTree(child.pid, { spawnedAtMs });
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
      if (exit !== 0) throw failed(failureFromDiagnostic(diagnostic));
      if (!threadId || existingThreads.has(threadId)) {
        const failure = failureFromDiagnostic(diagnostic);
        if (failure.code !== 'CODEX_IMAGE_FAILED') throw failed(failure);
        throw failed(new CodexImageError('CODEX_IMAGE_NO_OUTPUT', 'Codex did not produce an image. Try another prompt or image provider.'));
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
        if (failure.code !== 'CODEX_IMAGE_FAILED') throw failed(failure);
        throw failed(new CodexImageError('CODEX_IMAGE_NO_OUTPUT', 'Codex did not produce an image. Try another prompt or image provider.'));
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
