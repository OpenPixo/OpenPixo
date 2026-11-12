import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCodexImages, generateCodexImageFiles, type CodexImageOptions } from '../../src/media/codex-image.js';

const fixture = fileURLToPath(new URL('../fixtures/codex-image-cli.ts', import.meta.url));
let root: string;
let executable: string;
let recordFile: string;
let mode: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'pixo-t6-codex-'));
  recordFile = path.join(root, 'record.json');
  mode = '';
  executable = path.join(root, process.platform === 'win32' ? 'fake codex.cmd' : 'fake-codex');
  await writeFile(executable, process.platform === 'win32'
    ? '@echo off\r\n"' + process.execPath + '" "' + fixture + '" %*\r\n'
    : '#!/bin/sh\nexec "' + process.execPath + '" "' + fixture + '" "$@"\n', { mode: 0o755 });
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});
function options(extra: Partial<CodexImageOptions> = {}): CodexImageOptions {
  return { dataRoot: path.join(root, 'data'), prompt: 'pixel art sword', resolveRuntime: async () => ({
    status: { available: true, keyless: true }, executable,
    env: { ...process.env, NODE_OPTIONS: '', CODEX_HOME: path.join(root, 'codex-home'),
      T6_CODEX_MODE: mode, T6_CODEX_RECORD: recordFile },
  }), ...extra };
}
const record = async () => JSON.parse(await readFile(recordFile, 'utf8'));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('Codex image CLI adapter (fake executable only)', () => {
  it('generates an image in a fresh read-only working directory under the resolved data root', async () => {
    const images = await generateCodexImages(options());
    expect(images).toHaveLength(1);
    expect(images[0]!.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const invocation = await record();
    expect(invocation.args).toEqual(['exec', '--skip-git-repo-check', '-s', 'read-only', '--json', '--color', 'never', '-C', invocation.cwd, '-']);
    expect(invocation.cwd.startsWith(path.join(root, 'data', 'tmp', 'codex-image') + path.sep)).toBe(true);
    expect(invocation.entries).toEqual([]);
    expect(invocation.dataRoot).toBe(path.join(root, 'data'));
    expect(await readdir(path.dirname(invocation.cwd))).toEqual([]);
  });
  it('supports multiple images, attachments, transparency, size, and a negative prompt', async () => {
    const ref = path.join(root, 'reference with spaces.png');
    await writeFile(ref, 'reference');
    expect(await generateCodexImages(options({ count: 3, images: [ref], background: 'transparent',
      aspect: '16:9', resolution: '1024x1536', negativePrompt: 'no text' }))).toHaveLength(3);
    const invocation = await record();
    expect(invocation.args).toContain('--image=' + ref);
    expect(invocation.input).toContain('exactly 3 image');
    expect(invocation.input).toContain('transparent background');
    expect(invocation.input).toContain('16:9');
    expect(invocation.input).toContain('1024x1536');
    expect(invocation.input).toContain('Avoid:\nno text');
  });
  it.each(['none', 'foreign'])('reports no output for %s and never steals another thread image', async value => {
    mode = value;
    await expect(generateCodexImages(options())).rejects.toMatchObject({ code: 'CODEX_IMAGE_NO_OUTPUT' });
  });
  it.each([
    ['auth', 'CODEX_CLI_AUTH_REQUIRED'], ['quota', 'CODEX_IMAGE_QUOTA_EXCEEDED'], ['rate', 'CODEX_IMAGE_RATE_LIMITED'],
  ])('classifies the %s failure without exposing raw CLI diagnostics', async (value, code) => {
    mode = value;
    await expect(generateCodexImages(options())).rejects.toMatchObject({ code });
  });
  it('refuses missing Codex and missing sign-in before starting a process', async () => {
    for (const code of ['CODEX_CLI_NOT_FOUND', 'CODEX_CLI_AUTH_REQUIRED'] as const) {
      await expect(generateCodexImages(options({ resolveRuntime: async () => ({
        status: { available: false, keyless: true, reasonCode: code },
      }) }))).rejects.toMatchObject({ code });
    }
    await expect(readFile(recordFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('returns every image as a project output with its own capture and provenance', async () => {
    const projectsRoot = path.join(root, 'projects');
    await mkdir(path.join(projectsRoot, 'game', 'files'), { recursive: true });
    const capture = vi.fn();
    const result = await generateCodexImageFiles({ ...options(), projectsRoot, projectId: 'game',
      output: 'assets/sword.png', count: 2, references: [], onBytesWritten: capture });
    expect(result.name).toBe('assets/sword-1.png');
    expect(result.files.map(file => file.name)).toEqual(['assets/sword-1.png', 'assets/sword-2.png']);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(result.files.every(file => file.assetProvenance.provider === 'codex-cli')).toBe(true);
  });
  it.each(['timeout', 'cancel'] as const)('kills the process tree on %s and removes the working directory', async action => {
    mode = 'hang';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const pending = generateCodexImages(options({ signal: controller.signal, timeoutMs: 5_000, onProgress: started }));
    const rejected = expect(pending).rejects.toMatchObject({
      code: action === 'timeout' ? 'CODEX_IMAGE_TIMEOUT' : 'CODEX_IMAGE_CANCELLED',
    });
    await ready;
    const invocation = await record();
    expect(alive(invocation.pid)).toBe(true);
    expect(alive(invocation.childPid)).toBe(true);
    if (action === 'cancel') controller.abort();
    else await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(alive(invocation.pid)).toBe(false);
    expect(alive(invocation.childPid)).toBe(false);
    expect(await readdir(path.dirname(invocation.cwd))).toEqual([]);
  });
});
