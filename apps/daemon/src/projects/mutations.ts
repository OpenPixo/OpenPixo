import { AsyncLocalStorage } from 'node:async_hooks';

export interface ProjectMutations {
  run<T>(projectId: string | readonly string[], operation: () => Promise<T>, options?: { joinCurrent?: true }): Promise<T>;
}

/** Serialize local file mutations until each operation settles. Projects remain independent. */
export function createProjectMutations(): ProjectMutations {
  const tails = new Map<string, Promise<void>>();
  const ownership = new AsyncLocalStorage<ReadonlyMap<string, { active: boolean }>>();
  async function run<T>(projectId: string | readonly string[], operation: () => Promise<T>, options?: { joinCurrent?: true }): Promise<T> {
    const keys = [...new Set(typeof projectId === 'string' ? [projectId] : projectId)].sort();
    const inherited = ownership.getStore();
    if (options?.joinCurrent && keys.every(key => inherited?.get(key)?.active)) return operation();
    async function acquire(index: number): Promise<T> {
      const key = keys[index];
      if (key === undefined) {
        const lease = { active: true };
        const owned = new Map(inherited);
        for (const heldKey of keys) owned.set(heldKey, lease);
        try { return await ownership.run(owned, operation); }
        finally { lease.active = false; }
      }
      const previous = tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>(resolve => { release = resolve; });
      tails.set(key, current);
      await previous;
      try { return await acquire(index + 1); }
      finally {
        release();
        if (tails.get(key) === current) tails.delete(key);
      }
    }
    return acquire(0);
  }
  return { run };
}
