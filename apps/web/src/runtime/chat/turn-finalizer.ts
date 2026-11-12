/**
 * "A turn ended; work out what it produced."
 *
 * ProjectView reaches that question from five places (live completion, replay of
 * a terminal run, reattach done, reattach error, the persisted-message recovery
 * poll). `finalizeTurn` owns the one sequence all of them share:
 *
 *   refresh → pick the artifact → match a same-turn write, or persist it and
 *   refresh again → attribute files to the run → produced and trace files →
 *   choose and open the auto-open target.
 *
 * What differs between sources lives in `TURN_POLICIES`, one named field per
 * difference, so the drift between them can be read in one place. Patching the
 * message from the result, and any fence that is not a checkpoint of this
 * sequence, stay at the call site.
 *
 * No React and no refs: everything stateful arrives through `TurnPorts`.
 */
import { resolveHtmlPointerArtifactTarget } from '../../artifacts/pointer';
import { createArtifactParser } from '../../artifacts/parser';
import {
  recoverHtmlDocumentFromMarkdownFence,
  recoverStandaloneHtmlDocument,
  resolvePersistedArtifactHtml,
} from '../../artifacts/recover';
import {
  selectAutoOpenProducedArtifact,
  selectAutoOpenTurnArtifacts,
} from '../../components/auto-open-file';
import { filterImplicitProducedFiles } from '../../produced-files';
import type { Artifact, ProjectFile } from '../../types';

export interface RefreshOptions {
  fresh?: boolean;
  afterChange?: boolean;
}

export interface TurnPolicy {
  /** The read that opens the sequence. */
  firstRefresh: RefreshOptions | undefined;
  /** The read after the artifact was written. */
  postPersistRefresh: RefreshOptions | undefined;
  /** Whether a non-HTML artifact may bind to an identical same-turn HTML file. */
  sameTurnMatch: 'same-extension' | 'also-html-echo';
  /** Whether a manifest or file-name match since turn start also counts as already written. */
  matchExistingFile: boolean;
  /** Whether to forget the saved artifact name, so persist really writes instead of no-opping. */
  resetSavedArtifactBeforePersist: boolean;
  /** Whether an HTML pointer artifact may only target files written since turn start. */
  scopePointerToTurnStart: boolean;
  /** What proves the artifact's file once persist returned, and whether it joins the result. */
  afterPersist: 'trust-save-result' | 'rematch-file-list';
  /** Whether the daemon's artifact paths can add modified files to the produced list. */
  authoritativePathsReachProduced: boolean;
  /** Whether a matched file is added to produced and trace files if attribution missed it. */
  mergeMatchedFile: boolean;
  /** Whether trace object files are computed at all. */
  computeTraceObjects: boolean;
  /** How the auto-open target is chosen. */
  autoOpen: 'turn-artifacts' | 'turn-artifacts-ranked-with-live-writes' | 'best-produced';
}

const FRESH_AFTER_CHANGE: RefreshOptions = { fresh: true, afterChange: true };

/** The behaviour of each source. Comments name why a value differs from the others. */
export const TURN_POLICIES = {
  /** Replay of a run that went terminal before this page load. */
  replay: {
    // The terminal run's paths must resolve against a post-run read, not a
    // shared file-list result cached before its last write.
    firstRefresh: FRESH_AFTER_CHANGE,
    postPersistRefresh: undefined,
    sameTurnMatch: 'same-extension',
    matchExistingFile: true,
    resetSavedArtifactBeforePersist: true,
    scopePointerToTurnStart: true,
    afterPersist: 'trust-save-result',
    authoritativePathsReachProduced: true,
    mergeMatchedFile: true,
    computeTraceObjects: true,
    autoOpen: 'turn-artifacts',
  },
  /** A reattached stream reported done. */
  reattachDone: {
    // Match live completion: the terminal artifact list can be newer than the
    // GET coalescer's last successful file read.
    firstRefresh: FRESH_AFTER_CHANGE,
    postPersistRefresh: undefined,
    sameTurnMatch: 'same-extension',
    matchExistingFile: true,
    resetSavedArtifactBeforePersist: true,
    scopePointerToTurnStart: true,
    afterPersist: 'trust-save-result',
    authoritativePathsReachProduced: true,
    mergeMatchedFile: true,
    computeTraceObjects: true,
    autoOpen: 'turn-artifacts',
  },
  /** A reattached stream failed but its text holds a recoverable artifact. */
  reattachError: {
    // Drift, no recorded reason: best-effort rescue, keeps the coalesced read.
    firstRefresh: undefined,
    postPersistRefresh: undefined,
    sameTurnMatch: 'same-extension',
    matchExistingFile: true,
    resetSavedArtifactBeforePersist: true,
    scopePointerToTurnStart: true,
    // A failed run rescues an artifact rather than delivering a turn, so the
    // file has to be seen on disk before it counts.
    afterPersist: 'rematch-file-list',
    // Drift, no recorded reason: the paths still prove attribution, but cannot
    // add a modified existing file here.
    authoritativePathsReachProduced: false,
    mergeMatchedFile: true,
    // The message keeps whatever trace files it already has.
    computeTraceObjects: false,
    autoOpen: 'best-produced',
  },
  /** The poll over persisted terminal messages that still hold an unsaved artifact. */
  recovery: {
    // Polled every second, so a coalesced read is enough.
    firstRefresh: undefined,
    postPersistRefresh: undefined,
    sameTurnMatch: 'same-extension',
    matchExistingFile: true,
    resetSavedArtifactBeforePersist: true,
    scopePointerToTurnStart: true,
    // Same rescue reasoning as `reattachError`.
    afterPersist: 'rematch-file-list',
    // Drift, no recorded reason: same gap as `reattachError`.
    authoritativePathsReachProduced: false,
    mergeMatchedFile: true,
    // The caller filters the message's existing trace files instead.
    computeTraceObjects: false,
    autoOpen: 'best-produced',
  },
  /** The stream this page started reported done. */
  live: {
    // A settled file-list read from before the daemon exit can otherwise win
    // the race with the change invalidation and leave producedFiles empty.
    firstRefresh: FRESH_AFTER_CHANGE,
    // The artifact write is this turn's last change, so read past it.
    postPersistRefresh: { fresh: true },
    // Drift, no recorded reason: a non-HTML artifact echoing an HTML write binds.
    sameTurnMatch: 'also-html-echo',
    // Drift, no recorded reason: only a same-turn write counts, not a name match.
    matchExistingFile: false,
    // Already reset when the turn started, and nothing writes it before here.
    resetSavedArtifactBeforePersist: false,
    // Drift, no recorded reason.
    scopePointerToTurnStart: false,
    afterPersist: 'trust-save-result',
    authoritativePathsReachProduced: true,
    // A same-turn write already comes from this turn's produced files.
    mergeMatchedFile: false,
    computeTraceObjects: true,
    // Only this source saw the writes as they happened, so it can rank them.
    autoOpen: 'turn-artifacts-ranked-with-live-writes',
  },
} as const satisfies Record<string, TurnPolicy>;

/** The turn's facts. `read*` are called when the sequence needs them, because they change during it. */
export interface TurnFacts {
  projectId: string;
  projectRoot: string | null | undefined;
  /** File names when the turn began; absent on legacy rows, which fall back to the first read. */
  preTurnFileNames: ReadonlySet<string> | readonly string[] | undefined;
  turnStartedAt: number | undefined;
  /** Only the `turn-artifacts` selections read this. */
  turnEndedAt?: number | null;
  autoOpenOptions: { preferSiteEntry?: boolean };
  readOutput(): { artifact: Artifact | null; sourceText: string };
  readTouchedPaths(): Iterable<string>;
  readAuthoritativeArtifactPaths(): readonly string[] | undefined;
  readManualWrites(): ReadonlyMap<string, ProjectFile>;
  /** Only `autoOpen: 'turn-artifacts-ranked-with-live-writes'` reads this. */
  readLiveWrittenFiles?(): ReadonlyArray<{ name: string; path?: string; mtime?: number }>;
}

export interface PersistArtifactOptions {
  pointerMinMtime?: number;
  isCurrent?: () => boolean;
  shouldOpen?: () => boolean;
}

export type PersistArtifactOutcome =
  | { ok: true; fileName: string }
  | { ok: false; error?: string; cancelled?: boolean };

/**
 * Points in the sequence where a caller's fence may abandon it. Named rather
 * than a single predicate because recovery asks a different question at each.
 */
export type TurnCheckpoint =
  | 'after-first-refresh'
  | 'after-match'
  | 'during-persist'
  | 'after-persist'
  | 'before-attribution';

export interface TurnPorts {
  refreshProjectFiles(options?: RefreshOptions): Promise<ProjectFile[]>;
  readProjectHtml(name: string): Promise<string | null>;
  persistArtifact(
    artifact: Artifact,
    files: ProjectFile[],
    sourceText: string,
    options: PersistArtifactOptions,
  ): Promise<PersistArtifactOutcome>;
  requestOpenFile(name: string): void;
  requestOpenTurnArtifacts(names: readonly string[], focused: string): void;
  readSavedArtifact(): string | null;
  writeSavedArtifact(name: string | null): void;
  /** Asked at every automatic open. A "no" keeps the user's tab; the run's files are still written. */
  shouldOpen(): boolean;
  isCurrent?: (checkpoint: TurnCheckpoint, matched: ProjectFile | null) => boolean;
}

export interface FinalizedTurn {
  producedFiles: ProjectFile[];
  traceObjectFiles: ProjectFile[];
  /** The file the artifact was bound to, whether it was matched or rematched after persist. */
  recoveredArtifact: ProjectFile | null;
  persistenceSucceeded: boolean;
  persistenceError: string | undefined;
  /** What the sequence chose to auto-open, whether or not `shouldOpen` let it. */
  autoOpen: { focused: string; open: readonly string[] } | null;
  /** The same manual-write filter the turn's files went through, for files the caller holds. */
  attributeFiles(files: ProjectFile[]): ProjectFile[];
}

/**
 * Runs the sequence. Resolves to `null` only when `ports.isCurrent` abandoned it,
 * so a caller with no fence gets a `FinalizedTurn` without a null check.
 */
export function finalizeTurn(
  facts: TurnFacts,
  policy: TurnPolicy,
  ports: TurnPorts & { isCurrent?: undefined },
): Promise<FinalizedTurn>;
export function finalizeTurn(
  facts: TurnFacts,
  policy: TurnPolicy,
  ports: TurnPorts,
): Promise<FinalizedTurn | null>;
export async function finalizeTurn(
  facts: TurnFacts,
  policy: TurnPolicy,
  ports: TurnPorts,
): Promise<FinalizedTurn | null> {
  const { projectId, projectRoot } = facts;
  const isCurrent = (checkpoint: TurnCheckpoint, matched: ProjectFile | null) =>
    ports.isCurrent ? ports.isCurrent(checkpoint, matched) : true;

  let files = await ports.refreshProjectFiles(policy.firstRefresh);
  if (!isCurrent('after-first-refresh', null)) return null;

  // Use the turn-start snapshot when available so reload recovers files produced
  // before the artifact write too; fall back to the current list for legacy rows.
  const before = new Set<string>(facts.preTurnFileNames ?? files.map((f) => f.name));
  const { artifact, sourceText } = facts.readOutput();
  let matched: ProjectFile | null = null;
  let persistenceSucceeded = false;
  let persistenceError: string | undefined;

  if (artifact?.html) {
    matched = await matchWrittenArtifact(artifact, sourceText, before, files, facts, policy, ports);
    if (!isCurrent('after-match', matched)) return null;
    if (matched) {
      persistenceSucceeded = true;
      ports.writeSavedArtifact(matched.name);
      if (ports.shouldOpen()) ports.requestOpenFile(matched.name);
    } else {
      if (policy.resetSavedArtifactBeforePersist) ports.writeSavedArtifact(null);
      const persistence = await ports.persistArtifact(artifact, files, sourceText, {
        ...(policy.scopePointerToTurnStart ? { pointerMinMtime: facts.turnStartedAt } : {}),
        ...(ports.isCurrent ? { isCurrent: () => isCurrent('during-persist', null) } : {}),
        shouldOpen: () => ports.shouldOpen(),
      });
      if (persistence.ok) persistenceSucceeded = true;
      else persistenceError = persistence.error;
      if (!isCurrent('after-persist', null)) return null;
      files = await ports.refreshProjectFiles(policy.postPersistRefresh);
      if (policy.afterPersist === 'rematch-file-list') {
        matched = findExistingArtifactProjectFile(artifact, files, { minMtime: facts.turnStartedAt });
      }
    }
  }
  if (!isCurrent('before-attribution', matched)) return null;

  const manualWrites = facts.readManualWrites();
  const authoritativePaths = facts.readAuthoritativeArtifactPaths();
  const agentPaths = [...facts.readTouchedPaths(), ...(authoritativePaths ?? [])];
  const provenArtifactName = policy.afterPersist === 'rematch-file-list'
    ? matched?.name
    : persistenceSucceeded ? ports.readSavedArtifact() : undefined;
  const attributeFiles = (candidates: ProjectFile[]) => attributableRunFiles(
    candidates, manualWrites, agentPaths, projectId, projectRoot, provenArtifactName,
  );
  const owned = attributeFiles(files);

  const diff = (policy.authoritativePathsReachProduced
    ? computeProducedFiles(before, owned, authoritativePaths, projectId, projectRoot)
    : computeProducedFiles(before, owned)) ?? [];
  const producedFiles = policy.mergeMatchedFile ? mergeRecoveredArtifact(diff, matched) : diff;
  const trace = policy.computeTraceObjects
    ? computeTraceObjectFiles(before, owned, agentPaths, projectId, projectRoot) ?? []
    : [];
  const traceObjectFiles = policy.computeTraceObjects && policy.mergeMatchedFile
    ? mergeRecoveredTraceObjectFile(trace, matched)
    : trace;

  const autoOpen = selectAutoOpen(producedFiles, files, before, agentPaths, facts, policy);
  if (autoOpen && ports.shouldOpen()) {
    if (policy.autoOpen === 'best-produced') ports.requestOpenFile(autoOpen.focused);
    else ports.requestOpenTurnArtifacts(autoOpen.open, autoOpen.focused);
  }

  return {
    producedFiles,
    traceObjectFiles,
    recoveredArtifact: matched,
    persistenceSucceeded,
    persistenceError,
    autoOpen,
    attributeFiles,
  };
}

async function matchWrittenArtifact(
  artifact: Artifact,
  sourceText: string,
  before: ReadonlySet<string>,
  files: ProjectFile[],
  facts: TurnFacts,
  policy: TurnPolicy,
  ports: TurnPorts,
): Promise<ProjectFile | null> {
  const producedFiles = computeProducedFiles(before, files) ?? [];
  const readProjectText = ports.readProjectHtml;
  const sameTurnWrite = policy.sameTurnMatch === 'same-extension'
    ? await findSameTurnWriteForRecoveredArtifact({ artifact, sourceText, producedFiles, readProjectText })
    : await findSameTurnNonHtmlWriteForRecoveredArtifact({ artifact, producedFiles, readProjectText })
      ?? await findSameTurnHtmlWriteForRecoveredArtifact({
        artifactHtml: resolvePersistedArtifactHtml({
          artifactHtml: artifact.html,
          identifier: artifact.identifier,
          sourceText,
        }),
        producedFiles,
        readProjectHtml: readProjectText,
      });
  if (sameTurnWrite || !policy.matchExistingFile) return sameTurnWrite;
  return findExistingArtifactProjectFile(artifact, files, { minMtime: facts.turnStartedAt });
}

function selectAutoOpen(
  producedFiles: readonly ProjectFile[],
  files: readonly ProjectFile[],
  before: ReadonlySet<string>,
  agentPaths: readonly string[],
  facts: TurnFacts,
  policy: TurnPolicy,
): FinalizedTurn['autoOpen'] {
  const options = { ...facts.autoOpenOptions, preTurnFileNames: before };
  if (policy.autoOpen === 'best-produced') {
    const focused = selectAutoOpenProducedArtifact(producedFiles, options);
    return focused ? { focused, open: [focused] } : null;
  }
  // OPEND-2588 (product ruling 2026-09-04): the turn is over, so open ALL of its
  // primary artifacts, not just the best one. Replaying or reattaching a turn
  // opens the same set; the user cannot tell those apart from a live completion.
  const turnArtifacts = selectAutoOpenTurnArtifacts(producedFiles, files, {
    ...options,
    turnStartedAt: facts.turnStartedAt,
    turnEndedAt: facts.turnEndedAt ?? null,
    agentTouchedFileNames: resolveAgentTouchedFileNames(
      agentPaths, files, facts.projectId, facts.projectRoot,
    ),
  });
  const focused = turnArtifacts.focused;
  if (policy.autoOpen === 'turn-artifacts') {
    return focused ? { focused, open: turnArtifacts.open } : null;
  }
  const ranked = selectAutoOpenProducedArtifact(
    [
      ...(facts.readLiveWrittenFiles?.() ?? []),
      ...(focused ? [files.find((file) => file.name === focused) ?? { name: focused, path: focused }] : []),
    ],
    options,
  );
  return ranked ? { focused: ranked, open: turnArtifacts.open } : null;
}

/** The artifact a reply delivers: the parsed `<artifact>` if it has a body, else HTML recovered from the text. */
export function chooseArtifactToPersist(
  parsedArtifact: Artifact | null,
  sourceText: string,
): Artifact | null {
  return parsedArtifact?.html ? parsedArtifact : artifactFromRecoverableSourceText(sourceText);
}

export function artifactFromRecoverableSourceText(sourceText: string): Artifact | null {
  const parser = createArtifactParser();
  let parsedArtifact: Artifact | null = null;
  let liveHtml = '';
  for (const ev of [...parser.feed(sourceText), ...parser.flush()]) {
    if (ev.type === 'artifact:start') {
      liveHtml = '';
      parsedArtifact = {
        identifier: ev.identifier,
        artifactType: ev.artifactType,
        title: ev.title,
        html: '',
      };
    } else if (ev.type === 'artifact:chunk') {
      liveHtml += ev.delta;
      parsedArtifact = artifactWithHtml(parsedArtifact, ev.identifier, liveHtml);
    } else if (ev.type === 'artifact:end') {
      parsedArtifact = artifactWithHtml(parsedArtifact, ev.identifier, ev.fullContent);
    }
  }
  if (parsedArtifact?.html) return parsedArtifact;

  const html = recoverStandaloneHtmlDocument(sourceText)
    ?? recoverHtmlDocumentFromMarkdownFence(sourceText);
  if (!html) return null;
  return {
    identifier: 'response',
    artifactType: 'text/html',
    title: 'Response',
    html,
  };
}

export function artifactWithHtml(
  artifact: Artifact | null,
  fallbackIdentifier: string,
  html: string,
): Artifact {
  return artifact
    ? { ...artifact, html }
    : {
        identifier: fallbackIdentifier,
        title: '',
        html,
      };
}

export function artifactExtensionFor(art: Artifact): '.html' | '.jsx' | '.tsx' | '.css' | '.svg' | '.md' {
  const type = (art.artifactType || '').toLowerCase();
  const identifier = (art.identifier || '').toLowerCase();
  if (type.includes('tsx') || identifier.endsWith('.tsx')) return '.tsx';
  if (type.includes('jsx') || type.includes('react') || identifier.endsWith('.jsx')) {
    return '.jsx';
  }
  if (type.includes('css') || identifier.endsWith('.css')) return '.css';
  if (type.includes('svg') || identifier.endsWith('.svg')) return '.svg';
  if (type.includes('markdown') || type === 'md' || identifier.endsWith('.md')) {
    return '.md';
  }
  return '.html';
}


export function artifactBaseNameFor(art: Artifact): string {
  return (
    (art.identifier || art.title || 'artifact')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'artifact'
  );
}

function artifactFileNamePattern(baseName: string, ext: string): RegExp {
  const escapedBaseName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escapedBaseName}(?:-\\d+)?${escapedExt}$`);
}

export function findExistingArtifactProjectFile(
  art: Artifact,
  projectFiles: ProjectFile[],
  options: { minMtime?: number } = {},
): ProjectFile | null {
  const ext = artifactExtensionFor(art);
  const baseName = artifactBaseNameFor(art);
  const candidateFileName = `${baseName}${ext}`;
  const currentRunFiles = filterProjectFilesByMinMtime(projectFiles, options.minMtime);

  if (ext === '.html') {
    const pointerTarget = resolveHtmlPointerArtifactTarget({
      content: art.html,
      candidateFileName,
      projectFiles: currentRunFiles,
    });
    const pointerFile = pointerTarget
      ? currentRunFiles.find((file) => file.name === pointerTarget || file.path === pointerTarget)
      : null;
    if (pointerFile) return pointerFile;
  }

  const identifier = art.identifier || '';
  if (identifier) {
    const manifestMatches = currentRunFiles
      .filter((file) => file.artifactManifest?.metadata?.identifier === identifier)
      .sort((a, b) => b.mtime - a.mtime);
    if (manifestMatches[0]) return manifestMatches[0];
  }

  if (ext === '.html') {
    const exactNameMatch = currentRunFiles.find((file) => file.name === candidateFileName);
    if (exactNameMatch) return exactNameMatch;
  }
  return null;
}

export function findExistingNonHtmlArtifactProjectFile(
  art: Artifact,
  projectFiles: ProjectFile[],
  options: { minMtime?: number } = {},
): ProjectFile | null {
  if (artifactExtensionFor(art) === '.html') return null;
  return findExistingArtifactProjectFile(art, projectFiles, options);
}

export async function findSameTurnNonHtmlWriteForRecoveredArtifact({
  artifact,
  producedFiles,
  readProjectText,
}: {
  artifact: Artifact;
  producedFiles: readonly ProjectFile[];
  readProjectText: (name: string) => Promise<string | null>;
}): Promise<ProjectFile | null> {
  const ext = artifactExtensionFor(artifact);
  if (ext === '.html') return null;

  const baseName = artifactBaseNameFor(artifact);
  const candidateFileName = `${baseName}${ext}`;
  const namePattern = artifactFileNamePattern(baseName, ext);
  const identifier = artifact.identifier || '';
  const candidates = producedFiles
    .filter((file) => {
      if (identifier && file.artifactManifest?.metadata?.identifier === identifier) {
        return file.name.toLowerCase().endsWith(ext);
      }
      return file.name === candidateFileName || namePattern.test(file.name);
    })
    .sort((a, b) => b.mtime - a.mtime);

  const expected = normalizeProjectTextForArtifactComparison(artifact.html);
  for (const file of candidates) {
    const text = await readProjectText(file.name);
    if (text === null) continue;
    const actual = normalizeProjectTextForArtifactComparison(text);
    if (actual === expected) return file;
  }
  return null;
}

async function findSameTurnWriteForRecoveredArtifact({
  artifact,
  sourceText,
  producedFiles,
  readProjectText,
}: {
  artifact: Artifact;
  sourceText: string;
  producedFiles: readonly ProjectFile[];
  readProjectText: (name: string) => Promise<string | null>;
}): Promise<ProjectFile | null> {
  const nonHtmlWrite = await findSameTurnNonHtmlWriteForRecoveredArtifact({
    artifact,
    producedFiles,
    readProjectText,
  });
  if (nonHtmlWrite || artifactExtensionFor(artifact) !== '.html') return nonHtmlWrite;
  return findSameTurnHtmlWriteForRecoveredArtifact({
    artifactHtml: resolvePersistedArtifactHtml({
      artifactHtml: artifact.html,
      identifier: artifact.identifier,
      sourceText,
    }),
    producedFiles,
    readProjectHtml: readProjectText,
  });
}

function normalizeProjectTextForArtifactComparison(value: string | null | undefined): string {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
}

export function filterProjectFilesByMinMtime(
  projectFiles: readonly ProjectFile[],
  minMtime?: number,
): ProjectFile[] {
  return typeof minMtime === 'number' && Number.isFinite(minMtime)
    ? projectFiles.filter((file) => file.mtime >= minMtime)
    : [...projectFiles];
}

export function attributableRunFiles(
  files: ProjectFile[],
  manualWrites: ReadonlyMap<string, ProjectFile>,
  agentPaths: Iterable<string>,
  projectId: string,
  projectRoot: string | null | undefined,
  persistedArtifactName?: string | null,
): ProjectFile[] {
  const provenNames = new Set<string>();
  for (const path of agentPaths) {
    const file = findTouchedProjectFile(path, files, projectId, projectRoot);
    if (file) provenNames.add(file.name);
  }
  if (persistedArtifactName) provenNames.add(persistedArtifactName);
  return files.filter((file) => {
    const manual = manualWrites.get(file.name);
    // Only an unchanged, explicit manual-write receipt is excluded. Unknown
    // later changes retain the existing fallback, without assigning an actor.
    return !manual || provenNames.has(file.name)
      || manual.mtime !== file.mtime || manual.size !== file.size;
  });
}

export function computeProducedFiles(
  beforeNames: ReadonlySet<string> | readonly string[] | undefined,
  next: readonly ProjectFile[],
  authoritativePaths?: readonly string[],
  projectId?: string,
  projectRoot?: string | null,
): ProjectFile[] | undefined {
  const beforeSet = beforeNames
    ? beforeNames instanceof Set
      ? beforeNames
      : new Set(beforeNames)
    : null;
  if (authoritativePaths !== undefined) {
    const byName = new Map<string, ProjectFile>();
    // The daemon's authoritative list intentionally covers user-facing
    // artifacts and render dependencies, not every file an agent can create
    // (for example plugin manifests and Markdown). Preserve all files that are
    // provably new from the turn baseline, then use authoritative paths to add
    // modified existing artifacts without attributing untouched inputs.
    if (beforeSet) {
      for (const file of next) {
        if (!beforeSet.has(file.name)) byName.set(file.name, file);
      }
    }
    for (const rawPath of authoritativePaths) {
      const file = findTouchedProjectFile(rawPath, next, projectId, projectRoot);
      if (file) byName.set(file.name, file);
    }
    return filterImplicitProducedFiles([...byName.values()]);
  }
  if (!beforeSet) return undefined;
  return filterImplicitProducedFiles(next.filter((f) => !beforeSet.has(f.name)));
}

export function computeTraceObjectFiles(
  beforeNames: ReadonlySet<string> | readonly string[] | undefined,
  next: readonly ProjectFile[],
  touchedPaths: Iterable<string> = [],
  projectId?: string,
  projectRoot?: string | null,
): ProjectFile[] | undefined {
  if (!beforeNames) return undefined;
  const set = beforeNames instanceof Set ? beforeNames : new Set(beforeNames);
  const byName = new Map<string, ProjectFile>();
  for (const file of filterImplicitProducedFiles(next.filter((f) => !set.has(f.name)))) {
    byName.set(file.name, { ...file, traceObjectReason: 'new' });
  }
  for (const rawPath of touchedPaths) {
    const file = findTouchedProjectFile(rawPath, next, projectId, projectRoot);
    if (!file) continue;
    byName.set(file.name, {
      ...file,
      traceObjectReason: set.has(file.name) ? 'modified' : 'new',
    });
  }
  return [...byName.values()];
}

function findTouchedProjectFile(
  rawPath: string,
  files: readonly ProjectFile[],
  projectId?: string,
  projectRoot?: string | null,
): ProjectFile | null {
  const slashed = rawPath.replace(/\\/g, '/');
  // Lexically resolve `.`/`..` first: a path whose `..` climbs above its own
  // anchor can never be proven to stay anywhere, so it is rejected outright —
  // before any suffix matching could pair it with an in-project file.
  const segments = lexicallyNormalizePathSegments(slashed);
  if (!segments || segments.length === 0) return null;
  let normalized = segments.join('/');
  // A managed-project alias (`…/projects/<projectId>/…`) identifies the file's
  // project-relative form regardless of where the alias mount lives, so it is
  // trusted as-is; containment below only anchors paths without that marker.
  const managedProjectRelativePath = relativePathFromManagedProjectAlias(normalized, projectId);
  if (!managedProjectRelativePath && isAbsoluteToolPath(slashed)) {
    const rootSegments = projectRoot
      ? lexicallyNormalizePathSegments(projectRoot.replace(/\\/g, '/'))
      : null;
    if (rootSegments && rootSegments.length > 0) {
      // An absolute tool path is only trusted when it provably lives under
      // the project root: require the root's segments as a prefix and match
      // on the remaining project-relative form (/workspace/index.html →
      // index.html). Out-of-root paths (including `..` escapes that resolve
      // outside the root) are rejected here rather than falling through to
      // suffix matching, where /tmp/site/index.html could otherwise pick the
      // project's own index.html.
      if (segments.length <= rootSegments.length) return null;
      for (let i = 0; i < rootSegments.length; i += 1) {
        if (segments[i] !== rootSegments[i]) return null;
      }
      normalized = segments.slice(rootSegments.length).join('/');
    }
    // Without a usable root there is no anchor to judge containment against;
    // keep the legacy suffix behavior below.
  }
  const comparablePaths = managedProjectRelativePath
    ? [normalized, managedProjectRelativePath]
    : [normalized];
  const hasPathSeparator = comparablePaths.every((candidate) => candidate.includes('/'));
  const basename = normalized.split('/').pop() ?? normalized;
  const normalizedFiles = files.map((file) => ({
    file,
    candidates: [
      normalizeComparableFilePath(file.path ?? ''),
      normalizeComparableFilePath(file.name),
    ].filter(Boolean),
  }));

  const matches = (predicate: (candidate: string) => boolean): ProjectFile[] => {
    const matched: ProjectFile[] = [];
    for (const { file, candidates } of normalizedFiles) {
      if (candidates.some(predicate)) matched.push(file);
    }
    return matched;
  };

  const exact = matches((candidate) => comparablePaths.includes(candidate));
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;

  const suffix = matches((candidate) =>
    candidate.includes('/') &&
    comparablePaths.some((comparablePath) =>
      candidate.endsWith(`/${comparablePath}`) || comparablePath.endsWith(`/${candidate}`),
    ),
  );
  if (suffix.length === 1) return suffix[0]!;
  if (suffix.length > 1) return null;

  if (hasPathSeparator) return null;

  const basenameMatches = normalizedFiles.filter(({ candidates }) =>
    candidates.some((candidate) => candidate.split('/').pop() === basename),
  );
  return basenameMatches.length === 1 ? basenameMatches[0]!.file : null;
}

// Return a project-relative tool path only when an absolute Write/Edit path
// can be proven to live under the resolved project root. This runs before the
// refreshed inventory is available, so aliases, relative paths, and paths with
// only a matching `projects/<id>` suffix must wait for that later authoritative
// match instead of creating a persistent placeholder tab.
export function provenProjectRelativeToolPath(
  rawPath: string,
  projectRoot?: string | null,
): string | null {
  const slashed = rawPath.replace(/\\/g, '/');
  if (!isAbsoluteToolPath(slashed) || !projectRoot) return null;
  const segments = lexicallyNormalizePathSegments(slashed);
  if (!segments || segments.length === 0) return null;
  const rootSegments = lexicallyNormalizePathSegments(projectRoot.replace(/\\/g, '/'));
  if (!rootSegments || segments.length <= rootSegments.length) return null;
  for (let index = 0; index < rootSegments.length; index += 1) {
    if (segments[index] !== rootSegments[index]) return null;
  }
  return segments.slice(rootSegments.length).join('/');
}

function relativePathFromManagedProjectAlias(
  normalizedPath: string,
  projectId: string | undefined,
): string | null {
  const normalizedProjectId = normalizeComparableFilePath(projectId ?? '');
  if (!normalizedProjectId || normalizedProjectId.includes('/')) return null;
  const marker = `projects/${normalizedProjectId}/`;
  const markerIndex = normalizedPath.lastIndexOf(marker);
  if (markerIndex < 0 || (markerIndex > 0 && normalizedPath[markerIndex - 1] !== '/')) return null;
  return normalizedPath.slice(markerIndex + marker.length);
}

function normalizeComparableFilePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');
}

// Lexically resolve `.`/`..` segments. Returns null when a `..` climbs above
// the path's own anchor — such a path cannot be proven to resolve anywhere.
function lexicallyNormalizePathSegments(path: string): string[] | null {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

function isAbsoluteToolPath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path);
}

// Resolve the agent's raw Write/Edit tool paths (absolute or partial) to
// project file NAMES for selectAutoOpenTurnArtifact's touched-file
// restriction. Paths that do not resolve to a project file (out-of-project
// writes) are dropped; ambiguous matches resolve to null inside
// findTouchedProjectFile and are dropped the same way.
export function resolveAgentTouchedFileNames(
  touchedPaths: Iterable<string>,
  files: readonly ProjectFile[],
  projectId?: string,
  projectRoot?: string | null,
): Set<string> {
  const names = new Set<string>();
  for (const rawPath of touchedPaths) {
    const file = findTouchedProjectFile(rawPath, files, projectId, projectRoot);
    if (file) names.add(file.name);
  }
  return names;
}

// Reattach with a recovered (on-disk) artifact must still include any
// other files the turn produced before the artifact write — replacing
// the diff with a single file was the regression noted on PR #2383.
export function mergeRecoveredArtifact(
  diff: readonly ProjectFile[],
  recovered: ProjectFile | null,
): ProjectFile[] {
  if (!recovered) return [...diff];
  if (diff.some((f) => f.name === recovered.name)) return [...diff];
  return [...diff, recovered];
}

export async function findSameTurnHtmlWriteForRecoveredArtifact({
  artifactHtml,
  producedFiles,
  readProjectHtml,
}: {
  artifactHtml: string;
  producedFiles: readonly ProjectFile[];
  readProjectHtml: (name: string) => Promise<string | null>;
}): Promise<ProjectFile | null> {
  const recovered = normalizeHtmlForRecoveredArtifactComparison(artifactHtml);
  if (!recovered) return null;
  const candidates = producedFiles.filter(isHtmlProjectFile);
  if (candidates.length === 0) return null;
  const contents = await Promise.all(candidates.map((file) => readProjectHtml(file.name)));
  const normalized = contents.map(normalizeHtmlForRecoveredArtifactComparison);
  // Bind only on an exact normalized-content match. This is inherently
  // agent-agnostic (#4308): whenever a filesystem-backed CLI writes an HTML
  // file and echoes the same document as an artifact, the normalized contents
  // are equal and we suppress the duplicate — no Claude-specific gate needed.
  //
  // We deliberately do NOT bind on a content *mismatch*. A differing same-turn
  // HTML file is a genuinely different document and must persist on its own.
  // A blind single-file bind also mis-fired across queued runs: the pre-turn
  // file snapshot for a queued run can predate the previous run's persist, so
  // computeProducedFiles() reports that earlier artifact as "produced this
  // turn" and we'd bind the echo to the wrong, unrelated file.
  const exact = candidates.find((_file, i) => normalized[i] === recovered);
  return exact ?? null;
}

function isHtmlProjectFile(file: ProjectFile): boolean {
  const name = (file.path || file.name).toLowerCase();
  return file.kind === 'html' || /\.(?:html?|xhtml)$/u.test(name);
}

function normalizeHtmlForRecoveredArtifactComparison(value: string | null | undefined): string {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

export function mergeRecoveredTraceObjectFile(
  files: readonly ProjectFile[],
  recovered: ProjectFile | null,
): ProjectFile[] {
  const out = [...files];
  if (!recovered) return out;
  const existing = out.findIndex((file) => file.name === recovered.name);
  const tagged = { ...recovered, traceObjectReason: 'recovered' as const };
  if (existing >= 0) {
    out[existing] = { ...out[existing]!, traceObjectReason: out[existing]!.traceObjectReason ?? 'recovered' };
    return out;
  }
  return [...out, tagged];
}
