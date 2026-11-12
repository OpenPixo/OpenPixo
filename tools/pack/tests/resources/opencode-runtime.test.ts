import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyOptionalOpenCodeTree, OPEN_CODE_TREE_ENV,
  resolveOptionalOpenCodeDistribution, resolveOptionalOpenCodeTree,
} from '@/opencode-runtime.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(platform: NodeJS.Platform = 'win32', arch = 'x64') {
  const prefix = fileURLToPath(new URL('../../../../.tmp/opencode-resolver-', import.meta.url));
  await mkdir(dirname(prefix), { recursive: true });
  const root = await mkdtemp(prefix);
  roots.push(root);
  const npmPlatform = platform === 'win32' ? 'windows' : platform;
  const packageName = `opencode-${npmPlatform}-${arch}${arch === 'x64' ? '-baseline' : ''}`;
  const metaRoot = join(root, 'opencode-ai');
  const nativeRoot = join(root, packageName);
  const source = join(nativeRoot, 'bin');
  const binaryName = platform === 'win32' ? 'opencode.exe' : 'opencode';
  await mkdir(metaRoot, { recursive: true });
  await mkdir(source, { recursive: true });
  await writeFile(join(source, binaryName), 'official binary');
  await writeFile(join(metaRoot, 'LICENSE'), 'OpenCode MIT license');
  await writeFile(join(nativeRoot, 'NOTICE.txt'), 'native notice');
  await writeFile(join(metaRoot, 'package.json'), JSON.stringify({
    version: '1.18.35', optionalDependencies: { [packageName]: '1.18.35' },
  }));
  await writeFile(join(nativeRoot, 'package.json'), JSON.stringify({ version: '1.18.35' }));
  const resolvePackage = vi.fn((specifier: string, _from?: string) => join(root, specifier));
  const options = { env: {}, platform, arch, resolvePackage, requireBundled: true };
  return { root, source, nativeRoot, metaRoot, binaryName, packageName, resolvePackage, options };
}

describe('official bundled OpenCode', () => {
  it.each([
    ['win32', 'x64'], ['win32', 'arm64'], ['darwin', 'x64'],
    ['darwin', 'arm64'], ['linux', 'x64'], ['linux', 'arm64'],
  ] as const)('resolves the target %s/%s package through the official meta package', async (platform, arch) => {
    const f = await fixture(platform, arch);
    expect(await resolveOptionalOpenCodeTree(f.options)).toBe(f.source);
    expect(f.resolvePackage.mock.calls).toEqual([
      ['opencode-ai/package.json'],
      [`${f.packageName}/package.json`, join(f.metaRoot, 'package.json')],
    ]);
    expect(await resolveOptionalOpenCodeDistribution(f.options)).toMatchObject({
      source: f.source, packageName: f.packageName, version: '1.18.35',
    });
  });

  it.each(['win32', 'linux'] as const)('copies the %s binary and package notices at the runtime contract path', async platform => {
    const f = await fixture(platform);
    const resourceRoot = join(f.root, 'resources');
    const result = await copyOptionalOpenCodeTree({ ...f.options, resourceRoot });
    const target = join(resourceRoot, 'bin', 'libexec', 'opencode');
    expect(result).toEqual({ source: f.source, target });
    expect(await readFile(join(target, f.binaryName), 'utf8')).toBe('official binary');
    expect(await readFile(join(target, 'licenses', 'opencode-ai', 'LICENSE'), 'utf8')).toBe('OpenCode MIT license');
    expect(await readFile(join(target, 'licenses', f.packageName, 'NOTICE.txt'), 'utf8')).toBe('native notice');
    expect(await readdir(join(resourceRoot, 'bin'))).toEqual(['libexec']);
    if (platform !== 'win32' && process.platform !== 'win32') {
      expect((await stat(join(target, f.binaryName))).mode & 0o777).toBe(0o755);
    }
  });

  it('preserves a complete explicit tree and skips npm resolution', async () => {
    const f = await fixture();
    await writeFile(join(f.source, 'runtime.dll'), 'override dependency');
    const result = await copyOptionalOpenCodeTree({
      ...f.options, env: { [OPEN_CODE_TREE_ENV]: ` ${f.source} ` }, resourceRoot: join(f.root, 'resources'),
    });
    expect(await readFile(join(result!.target, 'runtime.dll'), 'utf8')).toBe('override dependency');
    expect(f.resolvePackage).not.toHaveBeenCalled();
  });

  it('fails required packages and permits optional development omission', async () => {
    const resolvePackage = () => { throw new Error('missing official package'); };
    const options = { env: {}, platform: 'win32' as const, arch: 'x64', resolvePackage };
    expect(await resolveOptionalOpenCodeTree(options)).toBeNull();
    await expect(resolveOptionalOpenCodeTree({ ...options, requireBundled: true }))
      .rejects.toThrow('install opencode-ai with its target optional dependencies or set PIXO_OPENCODE_DIR');
  });

  it('rejects a missing native package or binary even when the directory exists', async () => {
    const f = await fixture();
    await rm(join(f.nativeRoot, 'package.json'));
    await expect(resolveOptionalOpenCodeTree(f.options)).rejects.toThrow('Unable to bundle official OpenCode');
    await writeFile(join(f.nativeRoot, 'package.json'), JSON.stringify({ version: '1.18.35' }));
    await rm(join(f.source, f.binaryName));
    await expect(resolveOptionalOpenCodeTree(f.options)).rejects.toThrow('Unable to bundle official OpenCode');
  });

  it('rejects mismatched native versions', async () => {
    const f = await fixture();
    await writeFile(join(f.nativeRoot, 'package.json'), JSON.stringify({ version: '1.18.36' }));
    await expect(resolveOptionalOpenCodeDistribution(f.options)).rejects.toThrow('Unable to bundle official OpenCode');
  });

  it('does not silently replace an invalid override with an installed package', async () => {
    const f = await fixture();
    const options = { ...f.options, env: { [OPEN_CODE_TREE_ENV]: f.root } };
    await expect(resolveOptionalOpenCodeTree(options)).rejects.toThrow('Unable to bundle official OpenCode');
    expect(await resolveOptionalOpenCodeTree({ ...options, requireBundled: false })).toBeNull();
    expect(f.resolvePackage).not.toHaveBeenCalled();
  });

  it('never substitutes the host package for an unsupported build target', async () => {
    const resolvePackage = vi.fn();
    expect(await resolveOptionalOpenCodeTree({ env: {}, platform: 'freebsd', arch: 'x64', resolvePackage })).toBeNull();
    await expect(resolveOptionalOpenCodeTree({ env: {}, platform: 'win32', arch: 'ia32', resolvePackage, requireBundled: true }))
      .rejects.toThrow('Unable to bundle official OpenCode');
    expect(resolvePackage).not.toHaveBeenCalled();
  });
});
