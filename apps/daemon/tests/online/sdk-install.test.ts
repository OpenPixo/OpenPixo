import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { installRoomsSdk } from '../../src/rooms/sdk-install.js';
import { findInstalledOnlineSdk, installOnlineSdk, OnlineSdkEditedError, ONLINE_SDK_RELATIVE_PATH, renderOnlineSdk } from '../../src/online/sdk-install.js';

const SDK_DIR = path.resolve(import.meta.dirname, '../../../../game-sdk');

let projectDir: string;
const install = (cwd = '.', sdkDir = SDK_DIR) => installOnlineSdk({ sdkDir, projectDir, cwd });

beforeEach(async () => { projectDir = await mkdtemp(path.join(os.tmpdir(), 'openpixo-online-install-')); });
afterEach(async () => { await rm(projectDir, { recursive: true, force: true }); });

async function touch(relative: string, contents = '{}'): Promise<void> {
  const file = path.join(projectDir, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}
const read = (relative: string) => readFile(path.join(projectDir, ...relative.split('/')), 'utf8');

it('puts TypeScript in src for a TypeScript project', async () => {
  await touch('tsconfig.json');
  await touch('src/main.ts');
  expect(await install()).toEqual({ sdkPath: 'src/openpixo-online.ts', changed: true });
  const installed = await read('src/openpixo-online.ts');
  expect(installed).toContain('openpixo-online-sdk sha256=');
  expect(installed).toContain('readonly code: OnlineErrorCode');
});

it('counts a typescript dependency as a TypeScript project', async () => {
  await touch('package.json', JSON.stringify({ devDependencies: { typescript: '5.9.3' } }));
  expect((await install()).sdkPath).toBe('openpixo-online.ts');
});

it('strips the types for a plain JavaScript project', async () => {
  await touch('src/main.js', '');
  expect(await install()).toEqual({ sdkPath: 'src/openpixo-online.js', changed: true });
  const installed = await read('src/openpixo-online.js');
  expect(installed).toContain('export const online');
  expect(installed).not.toMatch(/\binterface\b|: Promise<OnlineDoc|readonly code:/u);
});

it.each([['js/game.js', 'js/openpixo-online.js'], ['scripts/game.js', 'scripts/openpixo-online.js'], ['game.js', 'openpixo-online.js']])('finds the home of %s', async (existing, sdkPath) => {
  await touch(existing, '');
  expect((await install()).sdkPath).toBe(sdkPath);
});

it('uses the nested game folder and reports the path from the project root', async () => {
  await touch('game/tsconfig.json');
  await touch('game/src/main.ts', '');
  expect((await install('game')).sdkPath).toBe('game/src/openpixo-online.ts');
  expect(await findInstalledOnlineSdk(projectDir, 'game')).toBe('game/src/openpixo-online.ts');
});

it('is a no-op when the same version is present, without touching the file', async () => {
  await touch('tsconfig.json');
  await touch('src/main.ts', '');
  await install();
  const before = await stat(path.join(projectDir, 'src', 'openpixo-online.ts'));
  expect(await install()).toEqual({ sdkPath: 'src/openpixo-online.ts', changed: false });
  expect((await stat(path.join(projectDir, 'src', 'openpixo-online.ts'))).mtimeMs).toBe(before.mtimeMs);
});

it('still counts as unchanged after a checkout rewrites the line endings', async () => {
  await touch('tsconfig.json');
  await install();
  const installed = await read('openpixo-online.ts');
  await writeFile(path.join(projectDir, 'openpixo-online.ts'), installed.replace(/\n/gu, '\r\n'));
  expect((await install()).changed).toBe(false);
});

it('updates an older unedited copy', async () => {
  await touch('tsconfig.json');
  await writeFile(path.join(projectDir, 'openpixo-online.ts'), renderOnlineSdk('export const old = 1;\n', 'ts'));
  expect(await install()).toEqual({ sdkPath: 'openpixo-online.ts', changed: true });
  expect(await read('openpixo-online.ts')).toContain('export const online');
});

it('keeps the language already installed', async () => {
  await writeFile(path.join(projectDir, 'openpixo-online.js'), renderOnlineSdk('export const old = 1;\n', 'js'));
  await touch('tsconfig.json');
  expect((await install()).sdkPath).toBe('openpixo-online.js');
});

it('refuses an edited copy, says why and leaves it alone', async () => {
  await touch('tsconfig.json');
  await install();
  const edited = `${await read('openpixo-online.ts')}\n// my change\n`;
  await writeFile(path.join(projectDir, 'openpixo-online.ts'), edited);
  await expect(install()).rejects.toThrow(OnlineSdkEditedError);
  await expect(install()).rejects.toThrow(/openpixo-online\.ts was changed by hand/u);
  expect(await read('openpixo-online.ts')).toBe(edited);
});

it('refuses a file of the same name it did not write', async () => {
  await touch('src/openpixo-online.ts', 'export const mine = 1;\n');
  await expect(install()).rejects.toThrow(OnlineSdkEditedError);
  expect(await read('src/openpixo-online.ts')).toBe('export const mine = 1;\n');
});

it('reads the SDK from the resource folder it is given, as a packaged app does', async () => {
  const packaged = path.join(projectDir, '..', `${path.basename(projectDir)}-resources`);
  await mkdir(path.join(packaged, path.dirname(ONLINE_SDK_RELATIVE_PATH)), { recursive: true });
  await writeFile(path.join(packaged, ONLINE_SDK_RELATIVE_PATH), 'export const packaged = true;\n');
  await touch('tsconfig.json');
  try {
    await install('.', packaged);
    expect(await read('openpixo-online.ts')).toContain('packaged = true');
  } finally { await rm(packaged, { recursive: true, force: true }); }
});

it('refuses a game folder that leaves the project', async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'openpixo-sdk-outside-'));
  try {
    await symlink(outside, path.join(projectDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(install('linked')).rejects.toThrow('outside the project');
    await expect(install(path.relative(projectDir, outside))).rejects.toThrow('outside the project');
  } finally { await rm(outside, { recursive: true, force: true }); }
});

it('finds nothing before it is installed', async () => {
  expect(await findInstalledOnlineSdk(projectDir, '.')).toBeNull();
});

it('sits beside the rooms SDK without either touching the other', async () => {
  await touch('tsconfig.json');
  await touch('src/main.ts', '');
  await installRoomsSdk({ sdkDir: SDK_DIR, projectDir, cwd: '.' });
  expect(await install()).toEqual({ sdkPath: 'src/openpixo-online.ts', changed: true });
  expect(await read('src/openpixo-rooms.ts')).toContain('openpixo-rooms-sdk sha256=');
  expect(await findInstalledOnlineSdk(projectDir, '.')).toBe('src/openpixo-online.ts');
});
