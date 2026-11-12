import { describe, expect, it } from 'vitest';
import {
  finalizeTurn,
  TURN_POLICIES,
  type FinalizedTurn,
  type RefreshOptions,
  type TurnCheckpoint,
  type TurnFacts,
  type TurnPolicy,
  type TurnPorts,
} from '../../../src/runtime/chat/turn-finalizer';
import type { Artifact, ProjectFile } from '../../../src/types';

const HTML = '<!doctype html><html><head><title>t</title></head><body><main>game</main></body></html>';
const ARTIFACT: Artifact = {
  identifier: 'game',
  artifactType: 'text/html',
  title: 'Game',
  html: HTML,
};

const TURN_START = 1_000_000;

function file(name: string, overrides: Partial<ProjectFile> = {}): ProjectFile {
  return { name, path: name, kind: 'html', size: 10, mtime: TURN_START + 100, ...overrides } as ProjectFile;
}

/** Written long before the turn, so its mtime never reads as a rewrite by this turn. */
const OLD = file('old.html', { mtime: 1 });

/** For the tests where nothing fences: the sequence always reaches its end. */
async function finalize(
  turnFacts: TurnFacts,
  policy: TurnPolicy,
  ports: TurnPorts,
): Promise<FinalizedTurn> {
  const result = await finalizeTurn(turnFacts, policy, ports);
  if (!result) throw new Error('the sequence was abandoned');
  return result;
}

interface Harness {
  log: string[];
  refreshOptions: Array<RefreshOptions | undefined>;
  persistOptions: Array<Parameters<TurnPorts['persistArtifact']>[3]>;
  saved: { name: string | null };
  ports: TurnPorts;
}

/** Fake ports that record the order things happen in. `fileLists` feeds successive refreshes. */
function harness(options: {
  fileLists: ProjectFile[][];
  fileText?: Record<string, string>;
  persist?: (name: string) => Awaited<ReturnType<TurnPorts['persistArtifact']>>;
  shouldOpen?: () => boolean;
  isCurrent?: (checkpoint: TurnCheckpoint, matched: ProjectFile | null) => boolean;
}): Harness {
  const log: string[] = [];
  const refreshOptions: Array<RefreshOptions | undefined> = [];
  const persistOptions: Harness['persistOptions'] = [];
  const saved: Harness['saved'] = { name: 'stale.html' };
  let refreshes = 0;
  const ports: TurnPorts = {
    refreshProjectFiles: async (refresh) => {
      refreshOptions.push(refresh);
      const list = options.fileLists[Math.min(refreshes, options.fileLists.length - 1)]!;
      refreshes += 1;
      log.push(`refresh:${refreshes}`);
      return list;
    },
    readProjectHtml: async (name) => options.fileText?.[name] ?? null,
    persistArtifact: async (artifact, _files, _text, persistOption) => {
      persistOptions.push(persistOption);
      log.push('persist');
      const name = `${artifact.identifier}.html`;
      const outcome = options.persist?.(name) ?? { ok: true as const, fileName: name };
      if (outcome.ok) saved.name = outcome.fileName;
      return outcome;
    },
    requestOpenFile: (name) => {
      log.push(`open:${name}`);
    },
    requestOpenTurnArtifacts: (names, focused) => {
      log.push(`open-turn:${focused}:${names.join(',')}`);
    },
    readSavedArtifact: () => saved.name,
    writeSavedArtifact: (name) => {
      log.push(`saved:${name}`);
      saved.name = name;
    },
    shouldOpen: options.shouldOpen ?? (() => true),
    ...(options.isCurrent ? { isCurrent: options.isCurrent } : {}),
  };
  return { log, refreshOptions, persistOptions, saved, ports };
}

function facts(overrides: Partial<TurnFacts> = {}, log?: string[]): TurnFacts {
  return {
    projectId: 'project-1',
    projectRoot: '/work/project',
    preTurnFileNames: ['old.html'],
    turnStartedAt: TURN_START,
    turnEndedAt: TURN_START + 100_000,
    autoOpenOptions: {},
    readOutput: () => {
      log?.push('read-output');
      return { artifact: ARTIFACT, sourceText: `<artifact>${HTML}</artifact>` };
    },
    readTouchedPaths: () => [],
    readAuthoritativeArtifactPaths: () => undefined,
    readManualWrites: () => {
      log?.push('read-manual-writes');
      return new Map();
    },
    ...overrides,
  };
}

const ALL_SOURCES: Array<[keyof typeof TURN_POLICIES, TurnPolicy]> = [
  ['replay', TURN_POLICIES.replay],
  ['reattachDone', TURN_POLICIES.reattachDone],
  ['reattachError', TURN_POLICIES.reattachError],
  ['recovery', TURN_POLICIES.recovery],
  ['live', TURN_POLICIES.live],
];

describe('finalizeTurn ordering, for every source', () => {
  it.each(ALL_SOURCES)('%s refreshes before attributing and persists before the second refresh', async (_name, policy) => {
    const h = harness({ fileLists: [[OLD], [OLD, file('game.html')]] });

    const result = await finalize(facts({}, h.log), policy, h.ports);

    const order = (entry: string) => h.log.indexOf(entry);
    expect(order('refresh:1')).toBeGreaterThanOrEqual(0);
    expect(order('refresh:1')).toBeLessThan(order('read-output'));
    expect(order('read-output')).toBeLessThan(order('persist'));
    expect(order('persist')).toBeLessThan(order('refresh:2'));
    expect(order('refresh:2')).toBeLessThan(order('read-manual-writes'));
    expect(result.producedFiles.map((f) => f.name)).toEqual(['game.html']);
    expect(result.persistenceSucceeded).toBe(true);
    expect(result.persistenceError).toBeUndefined();
  });

  it.each(ALL_SOURCES)('%s skips persist and the second refresh when the reply has no artifact', async (_name, policy) => {
    const h = harness({ fileLists: [[OLD, file('new.html')]] });

    const result = await finalize(
      facts({ readOutput: () => ({ artifact: null, sourceText: 'just prose' }) }),
      policy,
      h.ports,
    );

    expect(h.log).not.toContain('persist');
    expect(h.refreshOptions).toHaveLength(1);
    expect(result.producedFiles.map((f) => f.name)).toEqual(['new.html']);
  });

  it('falls back to the first read as the baseline for a legacy row', async () => {
    const h = harness({
      fileLists: [[OLD, file('unrelated.html')]],
    });

    const result = await finalize(
      facts({
        preTurnFileNames: undefined,
        readOutput: () => ({ artifact: null, sourceText: '' }),
      }),
      TURN_POLICIES.replay,
      h.ports,
    );

    expect(result.producedFiles).toEqual([]);
  });
});

describe('the refresh each source asks for', () => {
  it.each([
    ['replay', TURN_POLICIES.replay, { fresh: true, afterChange: true }, undefined],
    ['reattachDone', TURN_POLICIES.reattachDone, { fresh: true, afterChange: true }, undefined],
    ['reattachError', TURN_POLICIES.reattachError, undefined, undefined],
    ['recovery', TURN_POLICIES.recovery, undefined, undefined],
    ['live', TURN_POLICIES.live, { fresh: true, afterChange: true }, { fresh: true }],
  ] as const)('%s', async (_name, policy, first, second) => {
    const h = harness({ fileLists: [[OLD], [OLD, file('game.html')]] });

    await finalize(facts(), policy, h.ports);

    expect(h.refreshOptions).toEqual([first, second]);
  });
});

describe('failed persistence', () => {
  it.each(['replay', 'reattachDone', 'live'] as const)(
    '%s reports the error and does not prove the old saved name',
    async (name) => {
      const h = harness({
        fileLists: [[OLD], [OLD]],
        persist: () => ({ ok: false, error: 'disk full' }),
      });

      const result = await finalize(facts(), TURN_POLICIES[name], h.ports);

      expect(result.persistenceSucceeded).toBe(false);
      expect(result.persistenceError).toBe('disk full');
      expect(result.producedFiles).toEqual([]);
      expect(h.log.some((entry) => entry.startsWith('open'))).toBe(false);
    },
  );

  it.each(['reattachError', 'recovery'] as const)(
    '%s still ends with what the file list shows, because it rematches after persist',
    async (name) => {
      const onDisk = file('game.html', { artifactManifest: { metadata: { identifier: 'game' } } } as never);
      const h = harness({
        fileLists: [[OLD], [OLD, onDisk]],
        persist: () => ({ ok: false, error: 'response lost' }),
      });

      const result = await finalize(facts({ preTurnFileNames: ['old.html', 'game.html'] }), TURN_POLICIES[name], h.ports);

      expect(result.recoveredArtifact?.name).toBe('game.html');
      expect(result.producedFiles.map((f) => f.name)).toEqual(['game.html']);
    },
  );

  it('live does not rematch, so a write it could not confirm stays out of produced', async () => {
    const onDisk = file('game.html', { artifactManifest: { metadata: { identifier: 'game' } } } as never);
    const h = harness({
      fileLists: [[OLD], [OLD, onDisk]],
      persist: () => ({ ok: false, error: 'response lost' }),
    });

    const result = await finalize(
      facts({ preTurnFileNames: ['old.html', 'game.html'] }),
      TURN_POLICIES.live,
      h.ports,
    );

    expect(result.recoveredArtifact).toBeNull();
    expect(result.producedFiles).toEqual([]);
  });
});

describe('isCurrent turning false mid-sequence', () => {
  const checkpoints: TurnCheckpoint[] = ['after-first-refresh', 'after-persist', 'before-attribution'];

  it.each(checkpoints)('recovery abandons at %s and stops there', async (stopAt) => {
    const h = harness({
      fileLists: [[OLD], [OLD, file('game.html')]],
      isCurrent: (checkpoint) => checkpoint !== stopAt,
    });

    const result = await finalizeTurn(facts({}, h.log), TURN_POLICIES.recovery, h.ports);

    expect(result).toBeNull();
    expect(h.log).not.toContain('read-manual-writes');
    if (stopAt === 'after-first-refresh') {
      expect(h.log).toEqual(['refresh:1']);
    } else if (stopAt === 'after-persist') {
      expect(h.log).toContain('persist');
      expect(h.log).not.toContain('refresh:2');
    } else {
      expect(h.log).toContain('refresh:2');
    }
  });

  it('abandoning after the match leaves the saved name and the open alone', async () => {
    const written = file('game.html');
    const h = harness({
      fileLists: [[OLD, written]],
      isCurrent: (checkpoint) => checkpoint !== 'after-match',
    });

    const result = await finalizeTurn(facts(), TURN_POLICIES.recovery, h.ports);

    expect(result).toBeNull();
    expect(h.saved.name).toBe('stale.html');
    expect(h.log.some((entry) => entry.startsWith('open'))).toBe(false);
  });

  it('gives the persist the same fence, and hands before-attribution the file it matched', async () => {
    const seen: Array<[TurnCheckpoint, string | null]> = [];
    const onDisk = file('game.html', { artifactManifest: { metadata: { identifier: 'game' } } } as never);
    const h = harness({
      fileLists: [[OLD], [OLD, onDisk]],
      isCurrent: (checkpoint, matched) => {
        seen.push([checkpoint, matched?.name ?? null]);
        return true;
      },
    });

    await finalize(facts(), TURN_POLICIES.recovery, h.ports);
    expect(h.persistOptions[0]?.isCurrent?.()).toBe(true);

    expect(seen).toEqual([
      ['after-first-refresh', null],
      ['after-match', null],
      ['after-persist', null],
      ['before-attribution', 'game.html'],
      ['during-persist', null],
    ]);
  });

  it('a source with no fence never asks, and its persist carries none', async () => {
    const h = harness({ fileLists: [[OLD], [OLD, file('game.html')]] });

    await finalize(facts(), TURN_POLICIES.live, h.ports);

    expect(h.persistOptions[0]).not.toHaveProperty('isCurrent');
  });
});

describe('same-turn writes', () => {
  it.each(['replay', 'reattachDone', 'reattachError', 'recovery', 'live'] as const)(
    '%s binds an identical same-turn HTML file instead of persisting a duplicate',
    async (name) => {
      const h = harness({
        fileLists: [[OLD, file('written.html')]],
        fileText: { 'written.html': HTML },
      });

      const result = await finalize(facts(), TURN_POLICIES[name], h.ports);

      expect(h.log).not.toContain('persist');
      expect(h.saved.name).toBe('written.html');
      expect(h.log).toContain('open:written.html');
      expect(result.recoveredArtifact?.name).toBe('written.html');
      expect(result.persistenceSucceeded).toBe(true);
    },
  );

  it('only live binds a non-HTML artifact to an identical same-turn HTML file', async () => {
    const svg: Artifact = { identifier: 'game.svg', artifactType: 'image/svg+xml', title: 'G', html: HTML };
    const output = () => ({ artifact: svg, sourceText: HTML });
    const live = harness({
      fileLists: [[OLD, file('echo.html')]],
      fileText: { 'echo.html': HTML },
    });
    const replay = harness({
      fileLists: [[OLD, file('echo.html')]],
      fileText: { 'echo.html': HTML },
    });

    await finalize(facts({ readOutput: output }), TURN_POLICIES.live, live.ports);
    await finalize(facts({ readOutput: output }), TURN_POLICIES.replay, replay.ports);

    expect(live.log).not.toContain('persist');
    expect(replay.log).toContain('persist');
  });

  it('only live ignores a name match it did not see written this turn', async () => {
    const existing = file('game.html', { mtime: TURN_START + 60 });
    const live = harness({ fileLists: [[existing], [existing]] });
    const replay = harness({ fileLists: [[existing]] });

    await finalize(facts({ preTurnFileNames: ['game.html'] }), TURN_POLICIES.live, live.ports);
    const replayed = await finalize(facts({ preTurnFileNames: ['game.html'] }), TURN_POLICIES.replay, replay.ports);

    expect(live.log).toContain('persist');
    expect(replay.log).not.toContain('persist');
    expect(replayed.producedFiles.map((f) => f.name)).toEqual(['game.html']);
  });

  it('every source but live forgets the saved name before persisting', async () => {
    for (const [name, policy] of ALL_SOURCES) {
      const h = harness({ fileLists: [[OLD], [OLD, file('game.html')]] });
      await finalize(facts(), policy, h.ports);
      expect(h.log.includes('saved:null'), name).toBe(name !== 'live');
    }
  });

  it('only live persists without scoping a pointer to the turn start', async () => {
    for (const [name, policy] of ALL_SOURCES) {
      const h = harness({ fileLists: [[OLD], [OLD, file('game.html')]] });
      await finalize(facts(), policy, h.ports);
      expect(h.persistOptions[0]?.pointerMinMtime, name).toBe(name === 'live' ? undefined : TURN_START);
    }
  });
});

describe('authoritative artifact paths', () => {
  const edited = file('edited.html');
  const lists = [[OLD, edited]];
  const noArtifact = {
    preTurnFileNames: ['old.html', 'edited.html'],
    readOutput: () => ({ artifact: null, sourceText: '' }),
    readAuthoritativeArtifactPaths: () => ['edited.html'],
  };

  it.each(['replay', 'reattachDone', 'live'] as const)('%s lets them add a modified file', async (name) => {
    const result = await finalize(facts(noArtifact), TURN_POLICIES[name], harness({ fileLists: lists }).ports);
    expect(result.producedFiles.map((f) => f.name)).toEqual(['edited.html']);
  });

  it.each(['reattachError', 'recovery'] as const)('%s drops them from the produced list', async (name) => {
    const result = await finalize(facts(noArtifact), TURN_POLICIES[name], harness({ fileLists: lists }).ports);
    expect(result.producedFiles).toEqual([]);
  });
});

describe('manual writes', () => {
  const manual = file('notes.html');

  it('reads the receipt after persist, so a late manual save still counts', async () => {
    const receipt = new Map<string, ProjectFile>();
    const h = harness({
      fileLists: [[OLD], [OLD, manual]],
      persist: (name) => {
        receipt.set('notes.html', manual);
        return { ok: true, fileName: name };
      },
    });

    const result = await finalize(facts({ readManualWrites: () => receipt }), TURN_POLICIES.reattachDone, h.ports);

    expect(result.producedFiles).toEqual([]);
  });

  it('attributeFiles filters what the caller holds the same way', async () => {
    const h = harness({ fileLists: [[OLD], [OLD]] });
    const result = await finalize(
      facts({ readManualWrites: () => new Map([['notes.html', manual]]) }),
      TURN_POLICIES.recovery,
      h.ports,
    );

    expect(result.attributeFiles([manual, file('other.html')]).map((f) => f.name)).toEqual(['other.html']);
  });
});

describe('trace object files', () => {
  it.each(['replay', 'reattachDone'] as const)('%s tags a matched file as recovered', async (name) => {
    const h = harness({
      fileLists: [[file('game.html', { mtime: TURN_START + 60 })]],
    });

    const result = await finalize(facts({ preTurnFileNames: ['game.html'] }), TURN_POLICIES[name], h.ports);

    expect(result.traceObjectFiles).toEqual([
      expect.objectContaining({ name: 'game.html', traceObjectReason: 'recovered' }),
    ]);
  });

  it('live computes them without merging', async () => {
    const h = harness({ fileLists: [[OLD], [OLD, file('game.html')]] });

    const result = await finalize(facts(), TURN_POLICIES.live, h.ports);

    expect(result.traceObjectFiles).toEqual([
      expect.objectContaining({ name: 'game.html', traceObjectReason: 'new' }),
    ]);
  });

  it.each(['reattachError', 'recovery'] as const)('%s does not compute them', async (name) => {
    const h = harness({ fileLists: [[OLD], [OLD, file('game.html')]] });

    const result = await finalize(facts(), TURN_POLICIES[name], h.ports);

    expect(result?.traceObjectFiles).toEqual([]);
  });
});

describe('auto-open', () => {
  const lists = [[OLD, file('a.html')]];
  const noArtifact = { readOutput: () => ({ artifact: null, sourceText: '' }) };

  it.each(['replay', 'reattachDone', 'live'] as const)('%s opens the turn as a batch', async (name) => {
    const h = harness({ fileLists: lists });

    const result = await finalize(facts(noArtifact), TURN_POLICIES[name], h.ports);

    expect(h.log).toContain('open-turn:a.html:a.html');
    expect(result.autoOpen).toEqual({ focused: 'a.html', open: ['a.html'] });
  });

  it.each(['reattachError', 'recovery'] as const)('%s opens the best produced file alone', async (name) => {
    const h = harness({ fileLists: lists });

    const result = await finalize(facts(noArtifact), TURN_POLICIES[name], h.ports);

    expect(h.log).toContain('open:a.html');
    expect(result?.autoOpen).toEqual({ focused: 'a.html', open: ['a.html'] });
  });

  it('live ranks the turn pick against what it saw written', async () => {
    const h = harness({ fileLists: [[OLD, file('notes.md', { kind: 'text' } as never)]] });

    const result = await finalize(
      facts({
        ...noArtifact,
        readLiveWrittenFiles: () => [{ name: 'written.html', path: 'written.html', mtime: 0 }],
      }),
      TURN_POLICIES.live,
      h.ports,
    );

    expect(result.autoOpen?.focused).toBe('written.html');
  });

  it.each(ALL_SOURCES)('%s still reports the choice when shouldOpen declines it', async (_name, policy) => {
    const h = harness({ fileLists: lists, shouldOpen: () => false });

    const result = await finalize(facts(noArtifact), policy, h.ports);

    expect(result.autoOpen?.focused).toBe('a.html');
    expect(h.log.some((entry) => entry.startsWith('open'))).toBe(false);
  });

  it('opens nothing when the turn produced nothing', async () => {
    for (const [name, policy] of ALL_SOURCES) {
      const h = harness({ fileLists: [[OLD]] });
      const result = await finalize(facts(noArtifact), policy, h.ports);
      expect(result?.autoOpen ?? null, name).toBeNull();
    }
  });
});

describe('a user who took the preview over', () => {
  const declined = { shouldOpen: () => false };
  const writesNewFile = [[OLD], [OLD, file('game.html')]];
  const sameTurnWrite = [[OLD, file('written.html')]];

  it.each(ALL_SOURCES)('%s leaves the matched file closed', async (_name, policy) => {
    const h = harness({ ...declined, fileLists: sameTurnWrite, fileText: { 'written.html': HTML } });

    await finalize(facts(), policy, h.ports);

    expect(h.log.some((entry) => entry.startsWith('open'))).toBe(false);
    expect(h.saved.name).toBe('written.html');
  });

  it.each(ALL_SOURCES)('%s hands the guard to persist', async (_name, policy) => {
    const h = harness({ ...declined, fileLists: writesNewFile });

    await finalize(facts(), policy, h.ports);

    expect(h.persistOptions[0]?.shouldOpen?.()).toBe(false);
  });
});
