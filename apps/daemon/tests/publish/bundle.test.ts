import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { EngineProfile } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectBundle, findBuildOutput, htmlHasPasswordInput, publishPathProblem, PUBLISH_PRECHECK_CAPS, PublishBundleError } from '../../src/publish/bundle.js';
import { isWebProject, unsupportedEngineMessage, webProjectCwd } from '../../src/publish/web-project.js';

let root: string;

async function write(relative: string, contents: string | Buffer = 'x'): Promise<void> {
  const file = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}

const dist = () => ({ rootDir: path.join(root, 'dist'), staticRoot: false });

async function refusal(run: Promise<unknown>): Promise<PublishBundleError> {
  const error = await run.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(PublishBundleError);
  return error as PublishBundleError;
}

beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-bundle-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('finding the build output', () => {
  it('uses the folder a Vite config names ahead of the usual names', async () => {
    await write('vite.config.ts', "export default { build: { outDir: 'release/web' } };");
    await write('release/web/index.html');
    await write('dist/index.html');
    expect(await findBuildOutput(root, '.', true)).toMatchObject({ rootDir: expect.stringContaining(path.join('release', 'web')), staticRoot: false });
  });

  it.each(['dist', 'build'])('finds %s when it holds a root index.html', async name => {
    await write(`${name}/index.html`);
    expect((await findBuildOutput(root, '.', true)).rootDir.endsWith(name)).toBe(true);
  });

  it('skips a folder without a root index.html', async () => {
    await write('dist/assets/game.js');
    await write('build/index.html');
    expect((await findBuildOutput(root, '.', true)).rootDir.endsWith('build')).toBe(true);
  });

  it('refuses a configured folder outside the project', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'openpixo-outside-'));
    try {
      await writeFile(path.join(outside, 'index.html'), 'secret');
      await write('vite.config.ts', `export default { build: { outDir: ${JSON.stringify(path.relative(root, outside).split(path.sep).join('/'))} } };`);
      expect((await refusal(findBuildOutput(root, '.', true))).code).toBe('PUBLISH_NO_OUTPUT');
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  it('treats a project with no build script and a root index.html as a static game', async () => {
    await write('index.html');
    expect(await findBuildOutput(root, '.', false)).toMatchObject({ staticRoot: true });
    expect((await refusal(findBuildOutput(root, '.', true))).message).toContain('no folder with an index.html');
  });

  it('looks inside a nested game folder', async () => {
    await write('game/dist/index.html');
    expect((await findBuildOutput(root, 'game', true)).rootDir.endsWith(path.join('game', 'dist'))).toBe(true);
  });
});

describe('collecting a bundle', () => {
  it('lists nested files with sizes and SHA-256, skips dotfiles and keeps source maps', async () => {
    await write('dist/index.html', '<canvas></canvas>');
    await write('dist/assets/game.js', 'run()');
    await write('dist/assets/game.js.map', '{}');
    await write('dist/.DS_Store', 'junk');
    await write('dist/.git/config', 'secret');
    const bundle = await collectBundle(dist());
    expect(bundle.files.map(file => file.path)).toEqual(['assets/game.js', 'assets/game.js.map', 'index.html']);
    expect(bundle.files[0]).toEqual({ path: 'assets/game.js', size: 5, sha256: createHash('sha256').update('run()').digest('hex') });
    expect(bundle.totalBytes).toBe(5 + 2 + 17);
  });

  it('refuses a bundle with no root index.html', async () => {
    await write('dist/game.js');
    expect((await refusal(collectBundle(dist()))).code).toBe('PUBLISH_NO_OUTPUT');
  });

  it('names every refused file type and caps the list at 20', async () => {
    await write('dist/index.html');
    for (let index = 0; index < 25; index += 1) await write(`dist/tools/tool${index}.exe`);
    const error = await refusal(collectBundle(dist()));
    expect(error.code).toBe('PUBLISH_REFUSED');
    expect(error.refusedFiles).toHaveLength(20);
    expect(error.refusedFiles![0]).toMatch(/^tools\/tool\d+\.exe$/u);
    expect(error.message).toContain('25 files');
    expect(error.message).toContain('file type not allowed');
  });

  it('refuses a page with a password box', async () => {
    await write('dist/index.html');
    await write('dist/login.html', '<form><INPUT class="a" type="password"></form>');
    const error = await refusal(collectBundle(dist()));
    expect(error.refusedFiles).toEqual(['login.html']);
    expect(error.message).toContain('password');
  });

  it('refuses a file over the per-file cap without reading it into a hash', async () => {
    await write('dist/index.html');
    const large = path.join(root, 'dist', 'big.bin');
    await write('dist/big.bin', '');
    const handle = await import('node:fs/promises').then(fs => fs.open(large, 'r+'));
    await handle.truncate(PUBLISH_PRECHECK_CAPS.fileBytes + 1);
    await handle.close();
    expect((await refusal(collectBundle(dist()))).refusedFiles).toEqual(['big.bin']);
  });

  it('refuses a build over the total cap', async () => {
    await write('dist/index.html');
    const fs = await import('node:fs/promises');
    for (let index = 0; index < 5; index += 1) {
      const file = path.join(root, 'dist', `part${index}.bin`);
      await fs.writeFile(file, '');
      await fs.truncate(file, PUBLISH_PRECHECK_CAPS.fileBytes);
    }
    const error = await refusal(collectBundle(dist()));
    expect(error.code).toBe('PUBLISH_REFUSED');
    expect(error.message).toContain('200 MB');
  });

  it('refuses a link that leaves the build folder', async () => {
    await write('dist/index.html');
    await write('private/secret.txt', 'secret');
    // A junction needs no Windows symlink privilege, and it is the form a build tool would leave here.
    await symlink(path.join(root, 'private'), path.join(root, 'dist', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const error = await refusal(collectBundle(dist()));
    expect(error.refusedFiles).toEqual(['linked']);
    expect(error.message).toContain('outside the build');
  });

  it('leaves project files out of a static game but still names unknown files', async () => {
    await write('index.html');
    await write('package.json', '{}');
    await write('pnpm-lock.yaml', '');
    await write('README.md', '# game');
    await write('node_modules/phaser/index.js');
    await write('game.js');
    const staticGame = { rootDir: root, staticRoot: true };
    expect((await collectBundle(staticGame)).files.map(file => file.path)).toEqual(['game.js', 'index.html']);
    await write('notes.docx');
    expect((await refusal(collectBundle(staticGame))).refusedFiles).toEqual(['notes.docx']);
  });
});

describe('rule checks', () => {
  it.each([
    ['assets/hero.png', null],
    ['assets/map.TMJ', null],
    ['maps/level.tsx', null],
    ['song.opus', null],
    ['a\\b.png', "a file name that can't be used"],
    ['../secret.png', "a file name that can't be used"],
    ['/root.png', "a file name that can't be used"],
    ['assets/./x.png', "a file name that can't be used"],
    ['.hidden/x.png', "a file name that can't be used"],
    ['__rooms/x.json', 'a folder name OpenPixo reserves'],
    ['__openpixo/config.json', 'a folder name OpenPixo reserves'],
    ['assets/__rooms/x.json', null],
    ['run.exe', 'file type not allowed'],
    ['noextension', 'file type not allowed'],
    [`${'a'.repeat(PUBLISH_PRECHECK_CAPS.pathLength)}.png`, 'a file name that is too long'],
  ])('%s -> %s', (relative, problem) => {
    expect(publishPathProblem(relative)).toBe(problem);
  });

  it.each([
    ['<input type="password">', true],
    ["<input name=a type='password' />", true],
    ['<input type=password>', true],
    ['<input type="text" placeholder="password">', false],
    ['<p>type="password"</p>', false],
  ])('password box in %s is %s', (html, expected) => {
    expect(htmlHasPasswordInput(html)).toBe(expected);
  });
});

describe('web projects', () => {
  const profile = (engine: EngineProfile['engine'], extra: Partial<EngineProfile> = {}) => ({ engine, commands: {}, evidence: [], ...extra }) as EngineProfile;

  it.each(['phaser', 'threejs', 'web-generic'] as const)('accepts %s', engine => {
    expect(isWebProject(profile(engine), root)).toBe(true);
  });

  it.each([['godot', 'Godot'], ['unity', 'Unity'], ['unreal', 'Unreal Engine']] as const)('refuses %s by name', (engine, name) => {
    expect(isWebProject(profile(engine), root)).toBe(false);
    expect(unsupportedEngineMessage(profile(engine), 'be published')).toContain(`${name} games can't be published`);
  });

  it('accepts an unknown engine only with a root index.html', async () => {
    expect(isWebProject(profile('unknown'), root)).toBe(false);
    await write('index.html');
    expect(isWebProject(profile('unknown'), root)).toBe(true);
  });

  it('finds the folder of a nested web project', () => {
    expect(webProjectCwd(profile('web-generic', { evidence: ['game/package.json', 'game/index.html'] }))).toBe('game');
    expect(webProjectCwd(profile('web-generic', { evidence: ['package.json'] }))).toBe('.');
  });
});
