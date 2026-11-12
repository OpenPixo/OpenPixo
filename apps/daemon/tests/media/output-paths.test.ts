import { access, mkdir, mkdtemp, readFile, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ProjectMetadata } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMedia } from '../../src/media/index.js';
const providerFetch = vi.fn();

vi.mock('../../src/media/config.js', () => ({
  resolveModelAlias: async (_root: string, model: string) => model,
  resolveProviderConfig: async () => ({ apiKey: 'synthetic-provider-key' }),
}));


describe('media output paths', () => {
  let root: string;
  let projectsRoot: string;
  const bytes = Buffer.from('fake provider image');

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'openpixo-media-output-'));
    projectsRoot = path.join(root, 'projects');
    vi.stubGlobal('fetch', providerFetch);
    providerFetch.mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), { status: 200 }));
  });

  afterEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  });

  function generate(output: string, metadata?: ProjectMetadata) {
    return generateMedia({
      projectRoot: root, projectsRoot, projectId: 'game', ...(metadata ? { metadata } : {}),
      surface: 'image', model: 'gpt-image-1', output,
    });
  }

  it.each([false, true])('creates subdirectories in the actual project root (imported=%s)', async (imported) => {
    const baseDir = path.join(root, 'imported-game');
    if (imported) await mkdir(baseDir);
    const projectDir = imported ? baseDir : path.join(projectsRoot, 'game');
    const file = await generate('assets/icons/sword.png', imported ? { kind: 'prototype', baseDir } : undefined);

    expect(file.name).toBe('assets/icons/sword.png');
    expect(await readFile(path.join(projectDir, file.name))).toEqual(bytes);
    if (imported) await expect(access(path.join(projectsRoot, 'game'))).rejects.toThrow();
  });

  it('rejects traversal and absolute output paths before calling a provider', async () => {
    for (const output of ['../x.png', 'assets/../x.png', '..\\x.png', '/x.png', 'C:\\x.png', 'C:x.png', '\\\\server\\share\\x.png']) {
      await expect(generate(output)).rejects.toThrow();
    }
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('rejects a symlink/junction ancestor before creating its missing tail (imported=%s)', async (imported) => {
    const baseDir = path.join(root, 'imported-game');
    const projectDir = imported ? baseDir : path.join(projectsRoot, 'game');
    const outside = path.join(root, 'outside');
    await mkdir(projectDir, { recursive: true });
    await mkdir(outside);
    await symlink(outside, path.join(projectDir, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(generate('assets/icons/sword.png', imported ? { kind: 'prototype', baseDir } : undefined)).rejects.toThrow(/symlink/);
    await expect(access(path.join(outside, 'icons'))).rejects.toThrow();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('keeps dotted directory names when applying the provider extension', async () => {
    const file = await generate('assets.v2/icons/sword');
    expect(file.name).toBe('assets.v2/icons/sword.png');
    expect(await readFile(path.join(projectsRoot, 'game', file.name))).toEqual(bytes);
  });

  it('rechecks containment if a directory becomes a junction during generation', async () => {
    const projectDir = path.join(projectsRoot, 'game');
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    providerFetch.mockImplementationOnce(async () => {
      await rename(path.join(projectDir, 'assets'), path.join(projectDir, 'previous-assets'));
      await symlink(outside, path.join(projectDir, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
      return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), { status: 200 });
    });
    await expect(generate('assets/sword.webp')).rejects.toThrow(/symlink/);
    await expect(access(path.join(outside, 'sword.png'))).rejects.toThrow();
  });
});
