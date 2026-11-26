import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** What agents proposed, until the user makes it or puts it away. */
export interface StoredMotionSuggestion { id: string; projectId: string; text: string; createdAt: string }
const MAX_SUGGESTIONS = 20;

const suggestion = (value: unknown): StoredMotionSuggestion | null => {
  const s = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  return typeof s.id === 'string' && typeof s.projectId === 'string' && typeof s.text === 'string' && typeof s.createdAt === 'string' ? { id: s.id, projectId: s.projectId, text: s.text, createdAt: s.createdAt } : null;
};

/** The little this module keeps on this computer besides downloaded files. */
export class MotionRecords {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(root: string) { this.file = path.join(root, 'suggestions.json'); }

  async read(): Promise<StoredMotionSuggestion[]> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { suggestions?: unknown };
      return (Array.isArray(raw.suggestions) ? raw.suggestions : []).map(suggestion).filter(s => s !== null);
    } catch { return []; }
  }

  private change<T>(edit: (all: StoredMotionSuggestion[]) => { all: StoredMotionSuggestion[]; result: T }): Promise<T> {
    const next = this.queue.then(async () => {
      const { all, result } = edit(await this.read()), part = `${this.file}.${randomUUID()}.tmp`;
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(part, JSON.stringify({ suggestions: all }));
      await rename(part, this.file);
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  suggest(projectId: string, text: string): Promise<StoredMotionSuggestion> {
    return this.change(all => {
      const same = all.find(s => s.projectId === projectId && s.text === text);
      if (same) return { all, result: same };
      const fresh = { id: randomUUID(), projectId, text, createdAt: new Date().toISOString() };
      return { all: [fresh, ...all].slice(0, MAX_SUGGESTIONS), result: fresh };
    });
  }

  drop(id: string): Promise<void> { return this.change(all => ({ all: all.filter(s => s.id !== id), result: undefined })); }
}
