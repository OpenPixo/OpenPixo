import { describe, expect, it } from 'vitest';
import { createProjectMutations } from '../../src/projects/mutations.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('local project mutations', () => {
  it('holds the project lane until completion while other projects continue', async () => {
    const mutations = createProjectMutations();
    const release = deferred();
    const entered = deferred();
    const order: string[] = [];
    const first = mutations.run('game-a', async () => { entered.resolve(); await release.promise; order.push('first'); });
    await entered.promise;
    const second = mutations.run('game-a', async () => { order.push('second'); });
    await mutations.run('game-b', async () => { order.push('other'); });
    expect(order).toEqual(['other']);
    release.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['other', 'first', 'second']);
  });

  it('lets a nested operation join only its active caller lane', async () => {
    const mutations = createProjectMutations();
    expect(await mutations.run('game', () => mutations.run('game', async () => 'nested', { joinCurrent: true }))).toBe('nested');
  });

  it('fences an async descendant after its inherited lane has ended', async () => {
    const mutations = createProjectMutations();
    const startDescendant = deferred();
    const attempted = deferred();
    const releaseBlocker = deferred();
    const blockerEntered = deferred();
    let child!: Promise<void>;
    let childEntered = false;
    await mutations.run('game', async () => {
      child = (async () => {
        await startDescendant.promise;
        attempted.resolve();
        await mutations.run('game', async () => { childEntered = true; }, { joinCurrent: true });
      })();
    });
    const blocker = mutations.run('game', async () => { blockerEntered.resolve(); await releaseBlocker.promise; });
    await blockerEntered.promise;
    startDescendant.resolve();
    await attempted.promise;
    expect(childEntered).toBe(false);
    releaseBlocker.resolve();
    await Promise.all([blocker, child]);
    expect(childEntered).toBe(true);
  });

  it('orders overlapping multi-project lanes consistently', async () => {
    const mutations = createProjectMutations();
    const entered = deferred(), release = deferred();
    const order: number[] = [];
    const first = mutations.run(['a', 'b'], async () => { entered.resolve(); await release.promise; order.push(1); });
    await entered.promise;
    const second = mutations.run(['b', 'a'], async () => { order.push(2); });
    await mutations.run('c', async () => { expect(order).toEqual([]); });
    release.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });
});
