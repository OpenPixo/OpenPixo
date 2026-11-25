import { createHash, randomBytes } from 'node:crypto';
import nodeModule from 'node:module';
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnimatedCharacter, CharacterPlayer, EngineProfile, InstalledCharacter } from '@openpixo/contracts';
import { isSameCharacter, isSampleCharacter, PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { isWebProject, webProjectCwd } from '../publish/web-project.js';
import { recipePath } from '../recipes/paths.js';
import { CharacterError } from './errors.js';
import { CHARACTER_ID, FILE_NAME } from './wire.js';

/** Beside the package in a game: whose it is and what its pieces are called. The game may read it, the player does not need it. */
export const CARD = 'character.json';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

/** A folder name that every engine takes. */
export function characterSlug(name: string, id: string): string {
  const slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40).replace(/-+$/u, '');
  return SLUG.test(slug) ? slug : `character-${id.slice(0, 6)}`;
}

interface Place {
  engine: CharacterPlayer;
  /** Project-relative folder that holds the characters. */
  characters: string;
  /** Project-relative player script. */
  player: string;
  /** The player's source under `game-sdk/openpixo-character`. */
  source: string;
  comment: '#' | '//';
  /** What the game's code calls the folder of a character. */
  path: (slug: string) => string;
}

const under = (cwd: string, ...parts: string[]): string => [cwd, ...parts].filter(p => p && p !== '.').join('/');

/** Where the characters of this game go. Null: there is no player for its engine. */
export async function placeFor(projectDir: string, profile: EngineProfile): Promise<Place | null> {
  if (profile.engine === 'godot') {
    const marker = profile.evidence.find(f => f === 'project.godot' || f.endsWith('/project.godot')) ?? 'project.godot', cwd = path.posix.dirname(marker);
    return { engine: 'godot', characters: under(cwd, 'characters'), player: under(cwd, 'characters', 'pixo_character.gd'), source: 'godot/pixo_character.gd', comment: '#', path: slug => `res://characters/${slug}` };
  }
  if (profile.engine === 'unity') {
    const marker = profile.evidence.find(f => f.endsWith('ProjectSettings/ProjectVersion.txt')) ?? 'ProjectSettings/ProjectVersion.txt', cwd = path.posix.dirname(path.posix.dirname(marker));
    return { engine: 'unity', characters: under(cwd, 'Assets/StreamingAssets/Characters'), player: under(cwd, 'Assets/OpenPixo/PixoCharacter.cs'), source: 'unity/PixoCharacter.cs', comment: '//', path: slug => `Characters/${slug}` };
  }
  if (!isWebProject(profile, projectDir)) return null;
  const cwd = webProjectCwd(profile), dir = path.join(projectDir, ...cwd.split('/')), manifest = await readFile(path.join(dir, 'package.json'), 'utf8').catch(() => '');
  // a bundler serves `public` at the root of the page; a plain page serves its own folder
  const served = await exists(path.join(dir, 'public')) || /\bvite\b/u.test(manifest), typescript = await exists(path.join(dir, 'tsconfig.json')) || /"typescript"\s*:/u.test(manifest);
  const home = (await Promise.all(['src', 'js', 'scripts'].map(async d => await stat(path.join(dir, d)).then(s => s.isDirectory(), () => false) ? d : null))).find(Boolean) ?? '.';
  return {
    engine: 'web', characters: under(cwd, served ? 'public/characters' : 'characters'), player: under(cwd, home, `pixo-character.${typescript ? 'ts' : 'js'}`), source: 'web/pixo-character.ts', comment: '//', path: slug => `characters/${slug}`,
  };
}

const NAME = 'openpixo-character';
const normalized = (text: string): string => text.replace(/\r\n/gu, '\n');
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const marker = (comment: string): RegExp => new RegExp(`^${comment === '#' ? '#' : '//'} ${NAME} sha256=([0-9a-f]{64})\\n`, 'mu');

/** The player for a game. The first lines say where it came from and record its content, so a copy that was changed by hand is recognised. */
export function renderPlayer(source: string, place: Pick<Place, 'comment' | 'player'>): string {
  let body = normalized(source);
  if (place.player.endsWith('.js')) {
    const strip = (nodeModule as unknown as { stripTypeScriptTypes?: (code: string, options?: { mode?: 'strip' }) => string }).stripTypeScriptTypes;
    if (!strip) throw new CharacterError('CHARACTER_INSTALL_FAILED', 'This version of Node cannot convert the player to JavaScript. Add a tsconfig.json to the game, or update OpenPixo.');
    body = strip(body, { mode: 'strip' });
  }
  return `${place.comment} Plays OpenPixo characters. Added by "${PRODUCT_CLI_NAME} character install", which keeps it up to date; editing it stops updates.\n${place.comment} ${NAME} sha256=${hash(body)}\n${body}`;
}

async function writeWhole(file: string, text: string): Promise<void> {
  const part = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  try { await writeFile(part, text, 'utf8'); await rename(part, file); } catch (error) { await rm(part, { force: true }); throw error; }
}

/** Puts the player there or brings it up to date. One that was changed by hand is left alone. */
async function installPlayer(projectDir: string, sdkDir: string, place: Place): Promise<'written' | 'same' | 'edited'> {
  const rendered = renderPlayer(await readFile(path.join(sdkDir, NAME, ...place.source.split('/')), 'utf8'), place), file = await recipePath(projectDir, place.player);
  const current = await readFile(file, 'utf8').catch(() => null);
  if (current !== null) {
    const text = normalized(current);
    if (text === rendered) return 'same';
    const found = marker(place.comment).exec(text);
    if ((await lstat(file)).isSymbolicLink() || !found || hash(text.slice(found.index + found[0].length)) !== found[1]) return 'edited';
  }
  await writeWhole(file, rendered);
  return 'written';
}

/** How a game's code uses the character: for the agent that writes it, and for anyone who looks into the folder. */
function guide(character: AnimatedCharacter, place: Place, slug: string): string {
  const weapon = character.items.weapons[0]?.id ?? 'weapon0', motions = character.motions.map(m => m.name), folder = place.path(slug);
  const use = place.engine === 'godot' ? `\`\`\`gdscript
var hero := PixoCharacter.new()
add_child(hero)
hero.open("${folder}")
hero.play("run")
hero.put_on("weapon", "${weapon}")
hero.hit.connect(func(): pass) # the moment a blow lands
\`\`\`` : place.engine === 'unity' ? `\`\`\`csharp
var hero = new GameObject("${slug}").AddComponent<PixoCharacter>();
hero.Open(System.IO.Path.Combine(Application.streamingAssetsPath, "${folder}"));
hero.Play("run");
hero.PutOn("weapon", "${weapon}");
hero.Hit += () => { }; // the moment a blow lands
hero.Order = 5; // in front of what has a lower sorting order; two characters never mix
\`\`\`

On Android and in browsers StreamingAssets are not files: load \`hero.json\`, \`hero.bin\` and the files that its \`pics\` name with UnityWebRequest, then \`hero.Open(name => bytes[name])\`.` : `\`\`\`ts
import { PixoCharacterPack } from './${path.posix.basename(place.player).replace(/\.(?:ts|js)$/u, '')}';
const pack = await PixoCharacterPack.load('${folder}');
const hero = pack.create();
hero.play('run');
hero.putOn('weapon', '${weapon}');
hero.onHit = () => {}; // the moment a blow lands
// every frame: hero.update(seconds); hero.draw(gl, view) on a WebGL canvas, or hero.addToPhaser(scene, x, y)
\`\`\``;
  const list = (title: string, items: readonly { id: string; label: string }[]): string => items.length ? `- ${title}: ${items.map(i => `\`${i.id}\`${i.label ? ` (${i.label})` : ''}`).join(', ')}\n` : '';
  return `# ${character.name}

Made with OpenPixo. Do not edit the files here: \`${PRODUCT_CLI_NAME} character install\` replaces this folder. The player is \`${place.player}\`.

${use}

The character stands on its origin and faces right; flip it to face left. Pieces go on and off while it moves. Sizes are in package pixels: scale the node.

- Motions: ${motions.map(m => `\`${m}\``).join(', ')}
${list('Sets, for the slots `head`, `body`, `arm` and `leg`', character.items.sets)}${list('Weapons, for the slot `weapon`', character.items.weapons)}${list('Capes, for the slot `cape`', character.items.capes)}${character.outfits.length ? `- Outfits, put on by name: ${character.outfits.map(o => `\`${o.name}\`${o.start ? ' (worn at the start)' : ''}`).join(', ')}\n` : ''}
${isSampleCharacter(character.id) ? 'This is the free sample. Its pieces are its own: the same id is another piece on the characters of an account, so keep them apart in an inventory.' : 'An id means the same piece for every character of this account, so one inventory serves them all.'} \`icon-<id>.png\` is a small picture of a piece, \`portrait.png\` one of the character.${['jump', 'fall', 'land'].every(m => motions.includes(m)) ? ' `walk`, `run`, `jump`, `fall` and `land` are played in place, the game moves the character: play `jump` when it leaves the ground (it stays in its last pose), `fall` once it comes down, `land` when it touches, then what it does next.' : ' There is no jumping motion unless one is listed.'}${motions.includes('down') ? ' `down` ends lying on the ground and stays there.' : ''}
`;
}

/** The character as this package holds it: what was saved since is not in it, and the game must not be told of it. */
async function asPacked(character: AnimatedCharacter, folder: string): Promise<AnimatedCharacter> {
  let data: { items?: Record<string, unknown>; motions?: object; outfits?: unknown };
  try { data = JSON.parse(await readFile(path.join(folder, 'hero.json'), 'utf8')) as typeof data; } catch { throw new CharacterError('CHARACTER_DOWNLOAD_FAILED'); }
  const has = (slot: string): ReadonlySet<unknown> => new Set(Array.isArray(data.items?.[slot]) ? data.items[slot] as unknown[] : []), names = new Set((Array.isArray(data.outfits) ? data.outfits as { name?: unknown }[] : []).map(o => o?.name)), motions = new Set(Object.keys(data.motions ?? {}));
  const of = <T extends { id: string }>(list: readonly T[], slot: string): T[] => { const ids = has(slot); return list.filter(i => ids.has(i.id)); };
  return {
    ...character, items: { sets: of(character.items.sets, 'head'), weapons: of(character.items.weapons, 'weapon'), capes: of(character.items.capes, 'cape') },
    motions: character.motions.filter(m => motions.has(m.name)), outfits: character.outfits.filter(o => names.has(o.name)),
  };
}

export interface InstallInput {
  projectDir: string;
  profile: EngineProfile;
  sdkDir: string;
  character: AnimatedCharacter;
  package: { revision: number; folder: string };
  slug?: string;
}

/**
 * Puts a character's package and the player for the engine into a game. The folder is replaced in one
 * rename, so a failed install leaves the game as it was.
 */
export async function installCharacter(input: InstallInput): Promise<InstalledCharacter & { playerState: 'written' | 'same' | 'edited' }> {
  const { projectDir, profile } = input, character = await asPacked(input.character, input.package.folder), place = await placeFor(projectDir, profile);
  if (!place) throw new CharacterError('CHARACTER_INSTALL_FAILED', profile.engine === 'unknown' ? 'This game has no engine project yet. Set the game up first.' : `There is no character player for ${profile.engine} games yet. It works in Godot, Unity and web games.`);
  const known = (await installedCharacters(projectDir, profile)).find(c => isSameCharacter(c.characterId, character.id));
  let slug = input.slug ?? known?.slug ?? characterSlug(character.name, character.id);
  if (!SLUG.test(slug) || slug.length > 60) throw new CharacterError('CHARACTER_REQUEST_INVALID', 'The folder name takes small letters, numbers and hyphens.');
  const taken = async (s: string): Promise<boolean> => {
    const folder = await recipePath(projectDir, `${place.characters}/${s}`);
    return await exists(folder) && !isSameCharacter((await readCard(folder))?.characterId ?? '', character.id);
  };
  if (await taken(slug)) {
    if (input.slug) throw new CharacterError('CHARACTER_INSTALL_FAILED', `The folder ${place.characters}/${slug} holds something else.`);
    const base = slug;
    for (let i = 2; await taken(slug); i++) slug = `${base}-${i}`;
  }
  const folder = `${place.characters}/${slug}`, target = await recipePath(projectDir, folder), parent = path.dirname(target);
  const stage = path.join(parent, `.${slug}.partial-${randomBytes(4).toString('hex')}`), previous = path.join(parent, `.${slug}.previous-${randomBytes(4).toString('hex')}`);
  await mkdir(stage, { recursive: true });
  try {
    const names = (await readdir(input.package.folder)).filter(n => FILE_NAME.test(n));
    if (!names.includes('hero.json')) throw new CharacterError('CHARACTER_DOWNLOAD_FAILED');
    for (const name of names) {
      const from = path.join(input.package.folder, name);
      if (place.engine === 'godot' && name === 'hero.bin') {
        // an exported game takes along only kinds of files Godot knows, and this is none of them
        await writeFile(path.join(stage, 'hero-bin.json'), JSON.stringify({ format: 'pixo-hero-bin', data: (await readFile(from)).toString('base64') }));
        continue;
      }
      await copyFile(from, path.join(stage, name));
      // Godot would turn pictures into textures of its own; the player reads them as they are, also in an exported game
      if (place.engine === 'godot' && name.endsWith('.png')) await writeFile(path.join(stage, `${name}.import`), '[remap]\n\nimporter="keep"\n');
    }
    const { id, name, style, items, motions, outfits } = character;
    await writeFile(path.join(stage, CARD), `${JSON.stringify({ format: 'pixo-character', version: 1, characterId: id, name, slug, revision: input.package.revision, style, items, outfits, motions: motions.map(m => m.name) }, null, 2)}\n`);
    await writeFile(path.join(stage, 'README.md'), guide(character, place, slug));
    const had = await rename(target, previous).then(() => true, error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; });
    try { await rename(stage, target); } catch (error) { if (had) await rename(previous, target).catch(() => {}); throw error; }
    if (had) await rm(previous, { recursive: true, force: true });
    if (known && known.slug !== slug) await removeCharacter(projectDir, profile, known.slug);
  } finally { await rm(stage, { recursive: true, force: true }); }
  const playerState = await installPlayer(projectDir, input.sdkDir, place);
  return { characterId: character.id, slug, name: character.name, revision: input.package.revision, folder, player: place.player, engine: place.engine, playerState };
}

async function readCard(folder: string): Promise<{ characterId: string; name: string; revision: number } | null> {
  try {
    const card = JSON.parse(await readFile(path.join(folder, CARD), 'utf8')) as Record<string, unknown>;
    return card.format === 'pixo-character' && typeof card.characterId === 'string' && CHARACTER_ID.test(card.characterId) && typeof card.name === 'string' && Number.isSafeInteger(card.revision)
      ? { characterId: card.characterId, name: card.name, revision: card.revision as number } : null;
  } catch { return null; }
}

/** The characters in a game. What is in its folder counts, so a copied or restored game is right too. */
export async function installedCharacters(projectDir: string, profile: EngineProfile): Promise<InstalledCharacter[]> {
  const place = await placeFor(projectDir, profile);
  if (!place) return [];
  let entries;
  try { entries = await readdir(await recipePath(projectDir, place.characters), { withFileTypes: true }); } catch { return []; }
  const found: InstalledCharacter[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SLUG.test(entry.name)) continue;
    const folder = `${place.characters}/${entry.name}`, card = await readCard(await recipePath(projectDir, folder));
    if (card) found.push({ ...card, slug: entry.name, folder, player: place.player, engine: place.engine });
  }
  return found.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Takes a character out of a game. Its player stays, and only a folder that is one of ours goes. */
export async function removeCharacter(projectDir: string, profile: EngineProfile, slug: string): Promise<void> {
  const place = await placeFor(projectDir, profile);
  if (!place || !SLUG.test(slug)) throw new CharacterError('CHARACTER_NOT_FOUND');
  const folder = await recipePath(projectDir, `${place.characters}/${slug}`);
  if (!await readCard(folder)) throw new CharacterError('CHARACTER_NOT_FOUND');
  await rm(folder, { recursive: true, force: true });
}
