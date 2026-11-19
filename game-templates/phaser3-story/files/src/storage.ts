import { GAME } from './config.ts';
import type { Saved } from './story/runner.ts';

/**
 * Settings, the save and the endings found, in the browser's localStorage under
 * GAME.storageKey. Storage can be missing or full (a private window, a blocked
 * site), so every read falls back and every write is allowed to fail.
 */

export interface Settings {
  /** A story folder such as "zh_CN", or "" to follow the system language. */
  language: string;
  music: number;
  sfx: number;
}

const DEFAULTS: Settings = { language: '', music: 0.8, sfx: 0.8 };

function read<T>(name: string): T | null {
  try {
    const text = localStorage.getItem(`${GAME.storageKey}:${name}`);
    return text ? JSON.parse(text) as T : null;
  } catch {
    return null;
  }
}

function write(name: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(`${GAME.storageKey}:${name}`);
    else localStorage.setItem(`${GAME.storageKey}:${name}`, JSON.stringify(value));
  } catch { /* The game keeps working without storage. */ }
}

export function loadSettings(): Settings {
  const saved = read<Partial<Settings>>('settings') ?? {};
  return {
    language: typeof saved.language === 'string' ? saved.language : DEFAULTS.language,
    music: typeof saved.music === 'number' ? Math.min(1, Math.max(0, saved.music)) : DEFAULTS.music,
    sfx: typeof saved.sfx === 'number' ? Math.min(1, Math.max(0, saved.sfx)) : DEFAULTS.sfx,
  };
}

export function saveSettings(settings: Settings): void {
  write('settings', settings);
}

/** Where the player is: saved after every choice, on quitting to the title and when the page closes. */
export function loadGame(): Saved | null {
  return read<Saved>('save');
}

export function saveGame(saved: Saved | null): void {
  write('save', saved);
}

/** Endings reached in any playthrough, kept apart from the save. */
export function loadEndings(): string[] {
  const found = read<unknown>('endings');
  return Array.isArray(found) ? found.filter((id): id is string => typeof id === 'string') : [];
}

export function recordEnding(id: string): string[] {
  const found = loadEndings();
  if (id && !found.includes(id)) {
    found.push(id);
    write('endings', found);
  }
  return found;
}
