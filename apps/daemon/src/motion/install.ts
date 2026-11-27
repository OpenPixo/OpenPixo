import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EngineProfile, InstalledMotionCharacter, MotionCharacter, MotionPlayer } from '@openpixo/contracts';
import { isWebProject, webProjectCwd } from '../publish/web-project.js';
import { recipePath } from '../recipes/paths.js';
import { MotionError } from './errors.js';
import { MOTION_ID } from './wire.js';

/** Where the players are, under the game SDK folder. */
export const MOTION_SDK = 'openpixo-motion';
/** The Godot addon, file by file. */
export const GODOT_PLAYER_FILES = ['pixo_motion.gd', 'face_layer.gd', 'pixo_motion.gdshader', 'pixo_motion_brow.gdshader'] as const;
/** Beside the players in a game: what was written there last, so a file that was changed by hand is recognised and left alone. */
export const PLAYER_RECORD = '.pixo-motion.json';
/** Beside a character file in a game: whose it is. */
const CARD = '.motion.json';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);
const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const under = (...parts: string[]): string => parts.filter(p => p && p !== '.').join('/');

/** A file name that every engine takes. */
export function motionSlug(name: string, id: string): string {
  const slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40).replace(/-+$/u, '');
  return SLUG.test(slug) ? slug : `character-${id.slice(0, 6).toLowerCase().replace(/[^a-z0-9]/gu, '0')}`;
}

interface Place {
  engine: MotionPlayer;
  /** Project-relative folder of the character files. */
  folder: string;
  /** How the game's code names a file in it. */
  load: (slug: string) => string;
  /** Project-relative folder of the player, and its files from the SDK. */
  playerDir: string;
  players: { from: string; name: string }[];
}

async function placeFor(projectDir: string, profile: EngineProfile): Promise<Place | null> {
  if (profile.engine === 'godot') {
    const marker = profile.evidence.find(f => f === 'project.godot' || f.endsWith('/project.godot')) ?? 'project.godot', cwd = path.posix.dirname(marker);
    return {
      engine: 'godot', folder: under(cwd, 'assets/characters'), load: slug => `res://assets/characters/${slug}.pxmo`, playerDir: under(cwd, 'addons/pixo_motion'),
      players: GODOT_PLAYER_FILES.map(name => ({ from: `godot/addons/pixo_motion/${name}`, name })),
    };
  }
  if (!isWebProject(profile, projectDir)) return null;
  const cwd = webProjectCwd(profile), dir = path.join(projectDir, ...cwd.split('/')), manifest = await readFile(path.join(dir, 'package.json'), 'utf8').catch(() => '');
  // a bundler serves `public` at the root of the page; a plain page serves its own folder
  const served = await exists(path.join(dir, 'public')) || /\bvite\b/u.test(manifest);
  const home = (await Promise.all(['src', 'js', 'scripts'].map(async d => await stat(path.join(dir, d)).then(s => s.isDirectory(), () => false) ? d : null))).find(Boolean) ?? '.';
  const phaser = profile.engine === 'phaser';
  return {
    engine: phaser ? 'phaser' : 'web', folder: under(cwd, served ? 'public' : '', 'assets/characters'), load: slug => `assets/characters/${slug}.pxmo`, playerDir: under(cwd, home, 'pixo-motion'),
    players: [{ from: 'web/pixo-motion.min.js', name: 'pixo-motion.min.js' }, ...(phaser ? [{ from: 'phaser/pixo-motion-phaser.js', name: 'pixo-motion-phaser.js' }] : [])],
  };
}

async function writeWhole(file: string, data: Buffer | string): Promise<void> {
  const part = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  try { await writeFile(part, data); await rename(part, file); } catch (error) { await rm(part, { force: true }); throw error; }
}

/** Puts the player files there or brings them up to date. A file that was changed by hand is left alone. */
async function installPlayer(projectDir: string, sdkDir: string, place: Place): Promise<{ state: InstalledMotionCharacter['playerState']; files: string[] }> {
  const dir = await recipePath(projectDir, place.playerDir), recordFile = path.join(dir, PLAYER_RECORD);
  const record = await readFile(recordFile, 'utf8').then(text => (JSON.parse(text) as { files?: Record<string, string> }).files ?? {}, () => ({} as Record<string, string>));
  const states: InstalledMotionCharacter['playerState'][] = [], written: Record<string, string> = {};
  for (const player of place.players) {
    let source: Buffer;
    try { source = await readFile(path.join(sdkDir, MOTION_SDK, ...player.from.split('/'))); }
    catch { throw new MotionError('MOTION_INSTALL_FAILED', 'The player for this engine is missing from this copy of OpenPixo. Reinstall OpenPixo.'); }
    const file = path.join(dir, player.name), current = await readFile(file).catch(() => null), fresh = sha(source);
    if (current !== null) {
      const now = sha(current);
      if (now === fresh) { states.push('same'); written[player.name] = fresh; continue; }
      if ((await lstat(file)).isSymbolicLink() || record[player.name] !== now) { states.push('edited'); if (record[player.name]) written[player.name] = record[player.name]!; continue; }
    }
    await writeWhole(file, source);
    states.push('written');
    written[player.name] = fresh;
  }
  await writeWhole(recordFile, `${JSON.stringify({ format: 'pixo-motion-player', files: written }, null, 2)}\n`);
  return { state: states.includes('edited') ? 'edited' : states.includes('written') ? 'written' : 'same', files: place.players.map(p => `${place.playerDir}/${p.name}`) };
}

/** What the Godot player calls itself and its file, read from the addon; generic when it cannot be read. */
async function godotNames(sdkDir: string): Promise<{ type: string; property: string | null }> {
  const source = await readFile(path.join(sdkDir, MOTION_SDK, 'godot/addons/pixo_motion/pixo_motion.gd'), 'utf8').catch(() => '');
  const type = /^class_name\s+([A-Za-z_]\w*)/mu.exec(source)?.[1] ?? 'PixoMotion';
  const property = /@export_file\([^)]*\)\s*var\s+([A-Za-z_]\w*)/u.exec(source)?.[1] ?? /@export\s+var\s+([A-Za-z_]\w*)\s*:\s*String/u.exec(source)?.[1] ?? null;
  return { type, property };
}

/** A few lines that show the character in this game. */
async function usage(place: Place, slug: string, sdkDir: string): Promise<string> {
  const file = place.load(slug), from = `./${path.posix.basename(place.playerDir)}`;
  if (place.engine === 'godot') {
    const { type, property } = await godotNames(sdkDir);
    return [
      `var hero := ${type}.new()`,
      property ? `hero.${property} = "${file}"` : `# give it the file "${file}" (see addons/pixo_motion/pixo_motion.gd)`,
      'add_child(hero)',
      `# When exporting, add *.pxmo to the export preset's "Filters to export non-resource files".`,
    ].join('\n');
  }
  if (place.engine === 'phaser') {
    return [
      `import { addPixoMotion } from '${from}/pixo-motion-phaser.js';`,
      `// preload(): this.load.binary('${slug}', '${file}');`,
      `// create() (async): const hero = await addPixoMotion(this, x, y, '${slug}', { width: 512, height: 640 });`,
      `// hero is a Phaser Image; hero.motion.mood(name), hero.motion.talk(seconds), hero.motion.lookAt(x, y) with x and y from -1 to 1`,
    ].join('\n');
  }
  return [
    `import { createPixoMotion } from '${from}/pixo-motion.min.js';`,
    `const hero = await createPixoMotion(await (await fetch('${file}')).arrayBuffer(), { width: 512, height: 640 });`,
    'document.body.append(hero.canvas);',
    '// every frame: hero.update(seconds); hero.mood(name), hero.talk(seconds), hero.lookAt(x, y) with x and y from -1 to 1; hero.moods lists the moods',
  ].join('\n');
}

interface Card { characterId: string; name: string; slug: string; sha256: string }
async function readCard(file: string): Promise<Card | null> {
  try {
    const card = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    return card.format === 'pixo-motion' && typeof card.characterId === 'string' && MOTION_ID.test(card.characterId) && typeof card.name === 'string' && typeof card.slug === 'string' && typeof card.sha256 === 'string'
      ? { characterId: card.characterId, name: card.name, slug: card.slug, sha256: card.sha256 } : null;
  } catch { return null; }
}

export interface MotionInstallInput {
  projectDir: string;
  profile: EngineProfile;
  sdkDir: string;
  character: MotionCharacter;
  /** The folder with `character.pxmo`. */
  folder: string;
  slug?: string;
}

/** Puts a moving character's file and the player for the engine into a game, or updates them. */
export async function installMotionCharacter(input: MotionInstallInput): Promise<InstalledMotionCharacter> {
  const { projectDir, profile, character } = input, place = await placeFor(projectDir, profile);
  if (!place) throw new MotionError('MOTION_INSTALL_FAILED', profile.engine === 'unknown' ? 'This game has no engine project yet. Set the game up first.' : `There is no player for ${profile.engine} games yet. Moving characters work in web, Phaser and Godot games.`);
  const known = (await installedMotionCharacters(projectDir, profile)).find(c => c.characterId === character.id);
  let slug = input.slug ?? known?.slug ?? motionSlug(character.name, character.id);
  if (!SLUG.test(slug) || slug.length > 60) throw new MotionError('MOTION_REQUEST_INVALID', 'The file name takes small letters, numbers and hyphens.');
  const taken = async (s: string): Promise<boolean> => {
    const file = await recipePath(projectDir, `${place.folder}/${s}.pxmo`);
    return await exists(file) && (await readCard(await recipePath(projectDir, `${place.folder}/${s}${CARD}`)))?.characterId !== character.id;
  };
  if (await taken(slug)) {
    if (input.slug) throw new MotionError('MOTION_INSTALL_FAILED', `The file ${place.folder}/${slug}.pxmo holds something else.`);
    const base = slug;
    for (let i = 2; await taken(slug); i++) slug = `${base}-${i}`;
  }
  const data = await readFile(path.join(input.folder, 'character.pxmo')).catch(() => { throw new MotionError('MOTION_DOWNLOAD_FAILED'); });
  const file = `${place.folder}/${slug}.pxmo`;
  await writeWhole(await recipePath(projectDir, file), data);
  await writeWhole(await recipePath(projectDir, `${place.folder}/${slug}${CARD}`), `${JSON.stringify({ format: 'pixo-motion', version: 1, characterId: character.id, name: character.name, slug, sha256: sha(data) }, null, 2)}\n`);
  if (known && known.slug !== slug) {
    await rm(await recipePath(projectDir, known.file), { force: true });
    await rm(await recipePath(projectDir, `${place.folder}/${known.slug}${CARD}`), { force: true });
  }
  const player = await installPlayer(projectDir, input.sdkDir, place);
  return { characterId: character.id, slug, name: character.name, file, engine: place.engine, player: player.files, playerState: player.state, usage: await usage(place, slug, input.sdkDir) };
}

/** The moving characters in a game. What is in its folder counts, so a copied or restored game is right too. */
export async function installedMotionCharacters(projectDir: string, profile: EngineProfile): Promise<{ characterId: string; slug: string; name: string; file: string }[]> {
  const place = await placeFor(projectDir, profile).catch(() => null);
  if (!place) return [];
  let names: string[];
  try { names = await readdir(await recipePath(projectDir, place.folder)); } catch { return []; }
  const found = [];
  for (const name of names) {
    const slug = name.endsWith(CARD) ? name.slice(0, -CARD.length) : '';
    if (!SLUG.test(slug) || !names.includes(`${slug}.pxmo`)) continue;
    const card = await readCard(await recipePath(projectDir, `${place.folder}/${name}`));
    if (card) found.push({ characterId: card.characterId, slug, name: card.name, file: `${place.folder}/${slug}.pxmo` });
  }
  return found.sort((a, b) => a.slug.localeCompare(b.slug));
}
