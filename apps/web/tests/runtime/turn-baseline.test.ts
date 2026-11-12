/**
 * The files a turn starts from.
 *
 * 2026-11-10 beginner audit: the first, read-only planning turn of a new game showed
 * 「改了 7 个文件」. The setup dialog creates the project and the kickoff turn starts at
 * once, before the page has loaded the project's file list, so the turn's baseline was
 * empty and every starter file counted as made by that turn. (With a git checkpoint the
 * card uses the daemon's diff instead; a beginner without Git has none.)
 */
import { describe, expect, it } from 'vitest';
import { turnStartBaseline } from '../../src/runtime/turn-baseline';

const starter = [{ name: 'package.json' }, { name: 'src/main.ts' }, { name: 'index.html' }];

describe('the files a turn starts from', () => {
  it('uses the loaded list as it is', async () => {
    let fetched = 0;
    const baseline = turnStartBaseline(starter, true, async () => { fetched++; return []; });
    await baseline.ready;
    expect([...baseline.set]).toEqual(['package.json', 'src/main.ts', 'index.html']);
    expect(fetched).toBe(0);
  });

  it('loads the list first when the page never had it, so starter files are not new', async () => {
    const baseline = turnStartBaseline([], false, async () => starter);
    await baseline.ready;
    expect(baseline.set.has('package.json')).toBe(true);
    expect(baseline.names).toEqual(['package.json', 'src/main.ts', 'index.html']);
  });

  it('settles even when that load fails, keeping what it had', async () => {
    const baseline = turnStartBaseline([], false, async () => { throw new Error('offline'); });
    await baseline.ready;
    expect(baseline.set.size).toBe(0);
  });
});
