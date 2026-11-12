import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { findInstalledRoomsSdk, installRoomsSdk, renderRoomsSdk, RoomsSdkEditedError, ROOMS_SDK_RELATIVE_PATH } from '../../src/rooms/sdk-install.js';

const SDK_DIR = path.resolve(import.meta.dirname, '../../../../game-sdk');

let projectDir: string;
const install = (cwd = '.', sdkDir = SDK_DIR) => installRoomsSdk({ sdkDir, projectDir, cwd });

beforeEach(async () => { projectDir = await mkdtemp(path.join(os.tmpdir(), 'openpixo-sdk-')); });
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
  expect(await install()).toEqual({ sdkPath: 'src/openpixo-rooms.ts', changed: true });
  const installed = await read('src/openpixo-rooms.ts');
  expect(installed).toContain('openpixo-rooms-sdk sha256=');
  expect(installed).toContain('hostMigration?: boolean');
});

it('counts a typescript dependency as a TypeScript project', async () => {
  await touch('package.json', JSON.stringify({ devDependencies: { typescript: '5.9.3' } }));
  expect((await install()).sdkPath).toBe('openpixo-rooms.ts');
});

it('strips the types for a plain JavaScript project', async () => {
  await touch('src/main.js', '');
  expect(await install()).toEqual({ sdkPath: 'src/openpixo-rooms.js', changed: true });
  const installed = await read('src/openpixo-rooms.js');
  expect(installed).toContain('export async function createRoom');
  expect(installed).not.toMatch(/\binterface\b|: Promise<Room>|hostMigration\?:/u);
});

it.each([['js/game.js', 'js/openpixo-rooms.js'], ['scripts/game.js', 'scripts/openpixo-rooms.js'], ['game.js', 'openpixo-rooms.js']])('finds the home of %s', async (existing, sdkPath) => {
  await touch(existing, '');
  expect((await install()).sdkPath).toBe(sdkPath);
});

it('uses the nested game folder and reports the path from the project root', async () => {
  await touch('game/tsconfig.json');
  await touch('game/src/main.ts', '');
  expect((await install('game')).sdkPath).toBe('game/src/openpixo-rooms.ts');
  expect(await findInstalledRoomsSdk(projectDir, 'game')).toBe('game/src/openpixo-rooms.ts');
});

it('is a no-op when the same version is present, without touching the file', async () => {
  await touch('tsconfig.json');
  await touch('src/main.ts', '');
  await install();
  const before = await stat(path.join(projectDir, 'src', 'openpixo-rooms.ts'));
  expect(await install()).toEqual({ sdkPath: 'src/openpixo-rooms.ts', changed: false });
  expect((await stat(path.join(projectDir, 'src', 'openpixo-rooms.ts'))).mtimeMs).toBe(before.mtimeMs);
});

it('still counts as unchanged after a checkout rewrites the line endings', async () => {
  await touch('tsconfig.json');
  await install();
  const installed = await read('openpixo-rooms.ts');
  await writeFile(path.join(projectDir, 'openpixo-rooms.ts'), installed.replace(/\n/gu, '\r\n'));
  expect((await install()).changed).toBe(false);
});

it('updates an older unedited copy', async () => {
  await touch('tsconfig.json');
  await writeFile(path.join(projectDir, 'openpixo-rooms.ts'), renderRoomsSdk('export const old = 1;\n', 'ts'));
  expect(await install()).toEqual({ sdkPath: 'openpixo-rooms.ts', changed: true });
  expect(await read('openpixo-rooms.ts')).toContain('export async function createRoom');
});

it('keeps the language already installed', async () => {
  await writeFile(path.join(projectDir, 'openpixo-rooms.js'), renderRoomsSdk('export const old = 1;\n', 'js'));
  await touch('tsconfig.json');
  expect((await install()).sdkPath).toBe('openpixo-rooms.js');
});

it('refuses an edited copy, says why and leaves it alone', async () => {
  await touch('tsconfig.json');
  await install();
  const edited = `${await read('openpixo-rooms.ts')}\n// my change\n`;
  await writeFile(path.join(projectDir, 'openpixo-rooms.ts'), edited);
  await expect(install()).rejects.toThrow(RoomsSdkEditedError);
  await expect(install()).rejects.toThrow(/openpixo-rooms\.ts was changed by hand/u);
  expect(await read('openpixo-rooms.ts')).toBe(edited);
});

it('refuses a file of the same name it did not write', async () => {
  await touch('src/openpixo-rooms.ts', 'export const mine = 1;\n');
  await expect(install()).rejects.toThrow(RoomsSdkEditedError);
  expect(await read('src/openpixo-rooms.ts')).toBe('export const mine = 1;\n');
});

it('reads the SDK from the resource folder it is given, as a packaged app does', async () => {
  const packaged = path.join(projectDir, '..', `${path.basename(projectDir)}-resources`);
  await mkdir(path.join(packaged, path.dirname(ROOMS_SDK_RELATIVE_PATH)), { recursive: true });
  await writeFile(path.join(packaged, ROOMS_SDK_RELATIVE_PATH), 'export const packaged = true;\n');
  await touch('tsconfig.json');
  try {
    await install('.', packaged);
    expect(await read('openpixo-rooms.ts')).toContain('packaged = true');
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
  expect(await findInstalledRoomsSdk(projectDir, '.')).toBeNull();
});
