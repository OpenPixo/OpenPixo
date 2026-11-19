/**
 * Checks the whole story: `pnpm run check:story` (and `pnpm run check`, which
 * also typechecks). Node 24 runs this TypeScript file as it is. It prints each
 * problem with its file and line and exits 1, or prints "STORY CHECK passed".
 * The checks themselves are in src/story/check.ts.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStory } from '../src/story/check.ts';
import { emptyBook, parseInto, type Book } from '../src/story/parser.ts';
import { ASSET_FOLDERS, AUDIO_TYPES, IMAGE_TYPES } from '../src/story/assets.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storyRoot = path.join(root, 'story');

const books = new Map<string, Book>();
const languages = existsSync(storyRoot)
  ? readdirSync(storyRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort() : [];
for (const language of languages) {
  const book = emptyBook();
  const files = readdirSync(path.join(storyRoot, language)).filter(file => file.endsWith('.story')).sort();
  for (const file of files) parseInto(book, readFileSync(path.join(storyRoot, language, file), 'utf8'), `story/${language}/${file}`);
  if (!book.order.length) book.errors.push(`story/${language}: no .story file with a label in it`);
  books.set(language, book);
}

let characters: Record<string, unknown> = {};
const charactersFile = path.join(storyRoot, 'characters.json');
if (existsSync(charactersFile)) {
  try { characters = JSON.parse(readFileSync(charactersFile, 'utf8')) as Record<string, unknown>; }
  catch (error) { console.error(`problem: story/characters.json is not valid JSON: ${(error as Error).message}`); process.exit(1); }
}

const exists = (folder: string, stem: string, types: readonly string[]) => types.some(type => existsSync(path.join(root, folder, `${stem}.${type}`)));
const result = checkStory({
  books,
  characters,
  asset: (kind, name, expression) => {
    if (kind === 'portrait') {
      const folder = ASSET_FOLDERS.portrait;
      const found = (expression && exists(folder, `${name}_${expression}`, IMAGE_TYPES)) || exists(folder, name, IMAGE_TYPES);
      return { found, hint: `${folder}/${name}.png${expression ? ` or ${name}_${expression}.png` : ''}` };
    }
    const folder = ASSET_FOLDERS[kind];
    const types = kind === 'background' ? IMAGE_TYPES : AUDIO_TYPES;
    return { found: exists(folder, name, types), hint: `${folder}/${name}.${types[0]}` };
  },
});

for (const note of result.notes) console.log(`note: ${note}`);
if (result.problems.length) {
  for (const problem of result.problems) console.error(`problem: ${problem}`);
  console.error(`STORY CHECK failed: ${result.problems.length} problem(s)`);
  process.exit(1);
}
console.log(`STORY CHECK passed: ${result.summary}`);
