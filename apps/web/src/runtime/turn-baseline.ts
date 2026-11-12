/**
 * The files a turn starts from: what the end-of-turn diff treats as already there.
 *
 * A turn can start before the page has ever loaded the project's file list: the
 * new-game dialog creates the project and its kickoff turn starts at once. Taken from
 * that empty list, the baseline made every starter file look made by the first,
 * read-only planning turn (「改了 7 个文件」, 2026-11-10 beginner audit).
 *
 * So when the list was never loaded, the baseline is filled from a fresh load, and
 * `ready` settles once it is. The end-of-turn diff awaits `ready`; nothing at the start
 * of a turn waits. The load answers long before an agent writes its first file.
 */
export interface TurnStartBaseline {
  /** The names, in a list a message can keep. Filled in place when the load returns. */
  names: string[];
  set: Set<string>;
  ready: Promise<void>;
}

export function turnStartBaseline(
  loadedFiles: readonly { name: string }[],
  loaded: boolean,
  load: () => Promise<readonly { name: string }[]>,
): TurnStartBaseline {
  const names = loadedFiles.map(file => file.name);
  const set = new Set(names);
  const ready = loaded ? Promise.resolve() : load().then(files => {
    for (const file of files) {
      if (set.has(file.name)) continue;
      set.add(file.name);
      names.push(file.name);
    }
  }, () => { /* A failed load is not an empty folder: keep what we had. */ });
  return { names, set, ready };
}
