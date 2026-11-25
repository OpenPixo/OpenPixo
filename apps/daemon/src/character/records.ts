import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHARACTER_STYLES, type CharacterStyle } from '@openpixo/contracts';

/** What agents proposed, until the user orders it or puts it away. Their games are the only ones that may be asked for. */
export interface StoredSuggestion { id: string; projectId: string; text: string; style: CharacterStyle | null; armor: boolean; gear: boolean; createdAt: string }

interface Records { suggestions: StoredSuggestion[]; /** Projects that a character was put into, so that not every game has to be searched. */ projects: string[] }
const MAX_SUGGESTIONS = 20;

const suggestion = (value: unknown): StoredSuggestion | null => {
  const s = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  return typeof s.id === 'string' && typeof s.projectId === 'string' && typeof s.text === 'string' && typeof s.createdAt === 'string'
    ? { id: s.id, projectId: s.projectId, text: s.text, style: CHARACTER_STYLES.find(x => x === s.style) ?? null, armor: s.armor === true, gear: s.gear === true, createdAt: s.createdAt } : null;
};

/** The little this module keeps on this computer. Everything else is the cloud's, or in the games themselves. */
export class CharacterRecords {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(root: string) { this.file = path.join(root, 'records.json'); }

  async read(): Promise<Records> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, unknown>;
      return {
        suggestions: (Array.isArray(raw.suggestions) ? raw.suggestions : []).map(suggestion).filter(s => s !== null),
        projects: (Array.isArray(raw.projects) ? raw.projects : []).filter((p): p is string => typeof p === 'string'),
      };
    } catch { return { suggestions: [], projects: [] }; }
  }

  private change<T>(edit: (records: Records) => T): Promise<T> {
    const next = this.queue.then(async () => {
      const records = await this.read(), result = edit(records), part = `${this.file}.${randomUUID()}.tmp`;
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(part, JSON.stringify(records));
      await rename(part, this.file);
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  suggest(input: Omit<StoredSuggestion, 'id' | 'createdAt'>): Promise<StoredSuggestion> {
    return this.change(records => {
      const same = records.suggestions.find(s => s.projectId === input.projectId && s.text === input.text);
      if (same) return Object.assign(same, input);
      const fresh = { id: randomUUID(), createdAt: new Date().toISOString(), ...input };
      records.suggestions = [fresh, ...records.suggestions].slice(0, MAX_SUGGESTIONS);
      return fresh;
    });
  }

  dropSuggestion(id: string): Promise<void> { return this.change(records => { records.suggestions = records.suggestions.filter(s => s.id !== id); }); }
  addProject(id: string): Promise<void> { return this.change(records => { if (!records.projects.includes(id)) records.projects.push(id); }); }
}
