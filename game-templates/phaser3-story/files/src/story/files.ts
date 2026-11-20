import { ASSET_FOLDERS, AUDIO_TYPES, IMAGE_TYPES } from './assets.ts';
import { emptyBook, parseInto, type Book } from './parser.ts';

/**
 * The story's files as the game sees them. Vite bundles every .story file,
 * characters.json and every picture and sound under assets/ at build time, so
 * adding a file needs no code change, and a missing one is simply not there.
 */

const STORY = import.meta.glob<string>('/story/*/*.story', { query: '?raw', import: 'default', eager: true });
const CAST = import.meta.glob<Record<string, Character>>('/story/characters.json', { import: 'default', eager: true });
const PICTURES = import.meta.glob<string>('/assets/**/*.{png,webp,jpg}', { query: '?url', import: 'default', eager: true });
const SOUNDS = import.meta.glob<string>('/assets/**/*.{ogg,mp3,wav}', { query: '?url', import: 'default', eager: true });

export interface Character {
  /** Per language, or one name for every language. */
  name?: Record<string, string> | string;
  /** The colour of their name, such as "#e8b86b". */
  color?: string;
}

export const characters: Record<string, Character> = Object.values(CAST)[0] ?? {};

/** Language folders under story/, such as "en" and "zh_CN", sorted. */
export function languages(): string[] {
  return [...new Set(Object.keys(STORY).map(file => file.split('/')[2]!))].sort();
}

/** The folder to read for a browser locale ("zh-CN"): same locale, same language, English, then the first. */
export function pickLanguage(locale: string): string {
  const available = languages();
  const wanted = locale.replace('-', '_');
  if (available.includes(wanted)) return wanted;
  const base = wanted.split('_')[0];
  return available.find(language => language.split('_')[0] === base)
    ?? (available.includes('en') ? 'en' : available[0] ?? '');
}

/** Every .story file of one language, in file-name order, as one book. */
export function loadBook(language: string): Book {
  const book = emptyBook();
  for (const file of Object.keys(STORY).filter(file => file.startsWith(`/story/${language}/`)).sort()) {
    parseInto(book, STORY[file]!, file.slice(1));
  }
  if (!book.order.length) book.errors.push(`story/${language}: no .story file with a label in it`);
  return book;
}

export function characterName(id: string, language: string): string {
  const name = characters[id]?.name;
  if (typeof name === 'string') return name;
  if (name && Object.keys(name).length) return name[language] ?? Object.values(name)[0]!;
  return id;
}

/** The character's colour as a number for Phaser, or a soft grey-blue. */
export function characterColor(id: string): number {
  const value = characters[id]?.color ?? '';
  return /^#[0-9a-f]{6}$/i.test(value) ? parseInt(value.slice(1), 16) : 0xd1dbef;
}

function first(table: Record<string, string>, stem: string, types: readonly string[]): string {
  for (const type of types) {
    const url = table[`/${stem}.${type}`];
    if (url) return url;
  }
  return '';
}

/** A picture or sound by name: its URL, or '' when there is none yet. */
export const asset = {
  background: (name: string) => first(PICTURES, `${ASSET_FOLDERS.background}/${name}`, IMAGE_TYPES),
  /** The picture for a character's expression, or their plain picture when it has none. */
  portrait: (character: string, expression: string) =>
    (expression && first(PICTURES, `${ASSET_FOLDERS.portrait}/${character}_${expression}`, IMAGE_TYPES))
    || first(PICTURES, `${ASSET_FOLDERS.portrait}/${character}`, IMAGE_TYPES),
  music: (name: string) => first(SOUNDS, `${ASSET_FOLDERS.music}/${name}`, AUDIO_TYPES),
  sound: (name: string) => first(SOUNDS, `${ASSET_FOLDERS.sound}/${name}`, AUDIO_TYPES),
};

/** Every picture and sound, so the title screen can load them before the story starts. */
export const allAssets = { pictures: Object.values(PICTURES), sounds: Object.values(SOUNDS) };
