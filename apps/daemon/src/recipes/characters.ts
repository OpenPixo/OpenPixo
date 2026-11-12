import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { CharacterCardSchema, type CharacterCard, type CharacterUpdateRequest } from '@openpixo/contracts';
import { recipePath } from './paths.js';

async function cardPath(root: string, slug: string): Promise<string> {
  CharacterCardSchema.shape.slug.parse(slug);
  return recipePath(root, `.openpixo/characters/${slug}.json`);
}
export async function getCharacter(root: string, slug: string): Promise<CharacterCard> {
  const card = CharacterCardSchema.parse(JSON.parse(await readFile(await cardPath(root, slug), 'utf8')));
  if (card.slug !== slug) throw new Error('Character slug does not match filename');
  for (const ref of card.references) await recipePath(root, ref);
  return card;
}
export async function listCharacters(root: string): Promise<CharacterCard[]> {
  let names: string[];
  // Neither the project folder nor its characters folder has to exist yet.
  try { names = await readdir(await recipePath(root, '.openpixo/characters')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return Promise.all(names.filter(name => /^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(name)).sort().map(name => getCharacter(root, name.slice(0, -5))));
}
export async function createCharacter(root: string, input: unknown): Promise<CharacterCard> {
  const card = CharacterCardSchema.parse(input);
  for (const ref of card.references) await recipePath(root, ref);
  const file = await cardPath(root, card.slug);
  await mkdir(path.dirname(file), { recursive: true });
  await cardPath(root, card.slug);
  await writeFile(file, `${JSON.stringify(card, null, 2)}\n`, { flag: 'wx' });
  return card;
}
export async function updateCharacter(root: string, slug: string, patch: CharacterUpdateRequest): Promise<CharacterCard> {
  CharacterCardSchema.omit({ slug: true }).partial().strict().parse(patch);
  const card = CharacterCardSchema.parse({ ...await getCharacter(root, slug), ...patch, slug });
  for (const ref of card.references) await recipePath(root, ref);
  const file = await cardPath(root, slug);
  const temp = await recipePath(root, `.openpixo/characters/${slug}-${randomUUID()}.tmp`);
  try { await writeFile(temp, `${JSON.stringify(card, null, 2)}\n`, { flag: 'wx' }); await rename(temp, file); }
  finally { await unlink(temp).catch(() => {}); }
  return card;
}
export async function deleteCharacter(root: string, slug: string): Promise<void> { await unlink(await cardPath(root, slug)); }
