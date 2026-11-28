// A moving character installed into one of OpenPixo's own TypeScript templates: the game's code that uses the player still
// passes the template's `tsc --noEmit` (strict, no allowJs), so the players go in with their declarations.
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { MotionCharacter } from '@openpixo/contracts';
import { detectEngineProfile } from '../../src/game/engine-detect.js';
import { installMotionCharacter } from '../../src/motion/install.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SDK = path.join(REPO, 'game-sdk');
const TSC = path.join(path.dirname(createRequire(import.meta.url).resolve('@typescript/native/package.json')), 'bin', 'tsc');
const CHARACTER: MotionCharacter = {
  id: '22222222-2222-4333-8444-555555555555', name: 'Fox Knight', state: 'ready', portraitId: '11111111-2222-4333-8444-555555555555',
  file: { bytes: 4, sha256: 'a'.repeat(64) }, job: null, createdAt: '2026-11-27T00:00:00.000Z', updatedAt: '2026-11-27T00:00:00.000Z',
};

/** Game code that uses everything the usage lines tell a game to use. */
const PHASER_PROBE = `import { addPixoMotion } from './pixo-motion/pixo-motion-phaser.js';
declare const scene: { add: { image(x: number, y: number, texture: string): { setDepth(depth: number): unknown } } };
export async function show(): Promise<void> {
  const hero = await addPixoMotion(scene, 640, 360, 'fox-knight', { width: 512, height: 640 });
  hero.setDepth(2);
  const mood: string = hero.motion.mood('happy');
  hero.motion.talk(2.5);
  hero.motion.lookAt(mood ? 0.5 : 0, -1);
  // @ts-expect-error the player has no such call
  hero.motion.fly();
}
`;
const WEB_PROBE = `import { createPixoMotion } from './pixo-motion/pixo-motion.min.js';
export async function show(): Promise<void> {
  const hero = await createPixoMotion(await (await fetch('assets/characters/fox-knight.pxmo')).arrayBuffer(), { width: 512, height: 640 });
  document.body.append(hero.canvas);
  hero.update(1 / 60);
  const moods: readonly string[] = hero.moods;
  hero.mood(moods[0] ?? 'calm');
  hero.talk();
  hero.lookAt(0, 0);
  hero.lookAway();
}
`;

const run = promisify(execFile);
async function typecheck(dir: string, probe: string): Promise<string> {
  await writeFile(path.join(dir, 'src', 'motion-probe.ts'), probe);
  // the template's own settings, on the probe and what it imports; the declarations are checked too
  await writeFile(path.join(dir, 'tsconfig.probe.json'), JSON.stringify({ extends: './tsconfig.json', compilerOptions: { skipLibCheck: false, types: [] }, include: ['src/motion-probe.ts'] }));
  try { await run(process.execPath, [TSC, '--noEmit', '-p', 'tsconfig.probe.json'], { cwd: dir }); return ''; }
  catch (error) { const e = error as { stdout?: string; stderr?: string }; return `${e.stdout ?? ''}${e.stderr ?? ''}` || String(error); }
}

let made: string[] = [];
afterEach(async () => { await Promise.all(made.map(dir => rm(dir, { recursive: true, force: true }))); made = []; });

async function template(name: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-motion-types-')), dir = path.join(root, 'game');
  made.push(root);
  await cp(path.join(REPO, 'game-templates', name, 'files'), dir, { recursive: true });
  return dir;
}

async function install(dir: string): Promise<Awaited<ReturnType<typeof installMotionCharacter>>> {
  const folder = path.join(dir, '..', 'download');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'character.pxmo'), 'PXMO');
  return installMotionCharacter({ projectDir: dir, profile: detectEngineProfile(dir), sdkDir: SDK, character: CHARACTER, folder });
}

describe('a moving character in a TypeScript game', () => {
  it.each(['phaser3-vite', 'phaser3-story', 'phaser3-sample-platformer'])('keeps %s type-checking', async name => {
    const dir = await template(name), installed = await install(dir);
    expect(installed.engine).toBe('phaser');
    expect(await typecheck(dir, PHASER_PROBE)).toBe('');
    expect(await typecheck(dir, WEB_PROBE)).toBe('');
    expect(installed.player).toEqual(['src/pixo-motion/pixo-motion.min.js', 'src/pixo-motion/pixo-motion-phaser.js', 'src/pixo-motion/pixo-motion.min.d.ts', 'src/pixo-motion/pixo-motion-phaser.d.ts']);
  }, 60_000);

  it('keeps a TypeScript web game type-checking', async () => {
    const dir = await template('threejs-vite'), installed = await install(dir);
    expect(await typecheck(dir, WEB_PROBE)).toBe('');
    expect(installed.player).toEqual(['src/pixo-motion/pixo-motion.min.js', 'src/pixo-motion/pixo-motion.min.d.ts']);
  }, 60_000);

  it('gives a JavaScript game the players alone', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-motion-types-')), dir = path.join(root, 'game');
    made.push(root);
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { phaser: '3.90.0' }, devDependencies: { vite: '7.0.0' } }));
    await writeFile(path.join(dir, 'index.html'), '<!doctype html>');
    expect((await install(dir)).player).toEqual(['src/pixo-motion/pixo-motion.min.js', 'src/pixo-motion/pixo-motion-phaser.js']);
    expect((await readdir(path.join(dir, 'src', 'pixo-motion'))).filter(f => f.endsWith('.d.ts'))).toEqual([]);
  });

  it('declares what the players export', async () => {
    // the players are built elsewhere: a declaration that names something they do not export would lie to a game
    for (const [js, dts] of [['web/pixo-motion.min.js', 'web/pixo-motion.min.d.ts'], ['phaser/pixo-motion-phaser.js', 'phaser/pixo-motion-phaser.d.ts']] as const) {
      const exported = (text: string): string[] => [...text.matchAll(/\bexport (?:declare )?(?:async )?function ([A-Za-z_$][\w$]*)/gu)].map(m => m[1]!).sort();
      const source = await readFile(path.join(SDK, 'openpixo-motion', js), 'utf8'), declared = await readFile(path.join(SDK, 'openpixo-motion', dts), 'utf8');
      expect(exported(source).length).toBeGreaterThan(0);
      expect(exported(declared)).toEqual(exported(source));
    }
  });
});
