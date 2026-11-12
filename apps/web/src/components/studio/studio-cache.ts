import { useEffect, useState, useSyncExternalStore } from 'react';
import type {
  CharacterCard, EngineProfile, EngineProfileResponse, GetMediaCapabilitiesResponse, OpenPixoGenerationServicesResponse,
  ProjectAsset, ProjectDetailResponse, RecipeDetail, RecipeListResponse,
} from '@openpixo/contracts';
import { fetchCloudMediaServices } from '../../providers/openpixo-cloud-media';
import { listProjectAssets } from '../../providers/project-assets';
import { getStudioRecipe, listStudioCharacters, listStudioRecipes } from '../../providers/studio';
import { getStudioMediaCapabilities } from './media-capabilities';

/**
 * What the Generate sheet reads, kept in memory for as long as this page talks
 * to this daemon, so opening the sheet shows real content at once and refreshes
 * it behind the scenes. A failed refresh keeps what is on screen.
 *
 * Nothing here persists, and `value === null` always means "not known yet", so
 * the panel can tell that apart from "known to be empty" and never flashes a
 * "no provider" message while the answer is on its way.
 */
export interface CacheState<T> {
  value: T | null;
  /** The last read failed. Only worth showing while `value` is still null. */
  failed: boolean;
  pending: boolean;
}

export interface CacheEntry<T> {
  get(): CacheState<T>;
  subscribe(listener: () => void): () => void;
  /** Joins a read already under way unless `force`, or unless that read has hung. */
  refresh(options?: { force?: boolean }): Promise<void>;
  /** The caller knows the answer (it just wrote it); a read in flight is dropped. */
  set(value: T): void;
}

/** A capability probe can legitimately take seconds; past this a later refresh stops waiting for it. */
const IN_FLIGHT_PATIENCE_MS = 30_000;
const PROJECTS_KEPT = 12;

function createEntry<T>(load: (signal: AbortSignal, previous: T | null) => Promise<T>): CacheEntry<T> {
  let state: CacheState<T> = { value: null, failed: false, pending: false };
  let inFlight: { controller: AbortController; startedAt: number; done: Promise<void> } | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: CacheState<T>) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh({ force = false } = {}) {
      if (inFlight && !force && Date.now() - inFlight.startedAt < IN_FLIGHT_PATIENCE_MS) return inFlight.done;
      inFlight?.controller.abort();
      const controller = new AbortController();
      publish({ ...state, pending: true });
      const settle = (next: Omit<CacheState<T>, 'pending'>) => {
        // A newer read replaced this one; its answer is the one that counts.
        if (inFlight?.controller !== controller) return;
        inFlight = null;
        publish({ ...next, pending: false });
      };
      const done = load(controller.signal, state.value).then(
        value => settle({ value, failed: false }),
        () => settle({ value: state.value, failed: true }),
      );
      inFlight = { controller, startedAt: Date.now(), done };
      return done;
    },
    set(value) {
      inFlight?.controller.abort();
      inFlight = null;
      publish({ value, failed: false, pending: false });
    },
  };
}

export interface StudioProjectFacts {
  profile: EngineProfile | null;
  templateId?: string;
  assets: ProjectAsset[];
  engineFailed: boolean;
}

async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Managed (non-imported) projects have no engine folder to inspect; the daemon
 * answers 400 for them. That means "no engine yet", not a failed read, so it
 * must not surface as a retryable error.
 */
async function readEngine(url: string, signal: AbortSignal): Promise<EngineProfileResponse | null> {
  const response = await fetch(url, { signal });
  if (response.status === 400) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadProjectFacts(projectId: string, signal: AbortSignal, previous: StudioProjectFacts | null): Promise<StudioProjectFacts> {
  const base = `/api/projects/${encodeURIComponent(projectId)}`;
  const [engine, project, images] = await Promise.allSettled([
    readEngine(`${base}/engine`, signal),
    read<ProjectDetailResponse>(base, signal),
    listProjectAssets(projectId, { limit: 48 }, signal),
  ]);
  const profile = engine.status === 'fulfilled' ? engine.value?.profile ?? null : previous?.profile ?? null;
  return {
    profile,
    templateId: project.status === 'fulfilled' ? project.value.project?.metadata?.templateId : previous?.templateId,
    assets: images.status === 'fulfilled' ? images.value.assets : previous?.assets ?? [],
    // A refresh that fails keeps the engine already known; only "never known" is worth saying.
    engineFailed: engine.status === 'rejected' && !profile,
  };
}

function createStore() {
  return {
    recipes: createEntry<RecipeListResponse>(signal => listStudioRecipes(signal)),
    media: createEntry<GetMediaCapabilitiesResponse>(signal => getStudioMediaCapabilities(signal)),
    services: createEntry<OpenPixoGenerationServicesResponse>(signal => fetchCloudMediaServices(signal)),
    details: new Map<string, CacheEntry<RecipeDetail>>(),
    projects: new Map<string, { facts: CacheEntry<StudioProjectFacts>; characters: CacheEntry<CharacterCard[]> }>(),
  };
}

let store = createStore();

export const studioRecipes = () => store.recipes;
export const studioMedia = () => store.media;
export const studioServices = () => store.services;

export function studioRecipeDetail(recipeId: string): CacheEntry<RecipeDetail> {
  let entry = store.details.get(recipeId);
  if (!entry) {
    entry = createEntry<RecipeDetail>(signal => getStudioRecipe(recipeId, signal));
    store.details.set(recipeId, entry);
  }
  return entry;
}

function projectEntries(projectId: string) {
  let entries = store.projects.get(projectId);
  if (entries) {
    // Most recently used last, so the oldest project is the one dropped.
    store.projects.delete(projectId);
  } else {
    entries = {
      facts: createEntry<StudioProjectFacts>((signal, previous) => loadProjectFacts(projectId, signal, previous)),
      characters: createEntry<CharacterCard[]>(signal => listStudioCharacters(projectId, signal)),
    };
  }
  store.projects.set(projectId, entries);
  if (store.projects.size > PROJECTS_KEPT) {
    const oldest = store.projects.keys().next().value;
    if (oldest !== undefined) store.projects.delete(oldest);
  }
  return entries;
}

export const studioProjectFacts = (projectId: string) => projectEntries(projectId).facts;
export const studioCharacters = (projectId: string) => projectEntries(projectId).characters;

/** Reads everything the sheet shows for this project. Never rejects: a failure just leaves nothing cached. */
export function prefetchStudioProject(projectId: string): Promise<unknown> {
  return Promise.all([
    studioRecipes().refresh(),
    studioMedia().refresh(),
    studioProjectFacts(projectId).refresh(),
    studioCharacters(projectId).refresh(),
  ]);
}

const UNKNOWN: CacheState<never> = { value: null, failed: false, pending: false };
const subscribeToNothing = () => () => {};

export function useCacheEntry<T>(entry: CacheEntry<T> | null): CacheState<T> {
  const get = entry ? entry.get : () => UNKNOWN as CacheState<T>;
  return useSyncExternalStore(entry ? entry.subscribe : subscribeToNothing, get, get);
}

/** True once `active` has held for `ms`: a read only earns a loading line when it is actually slow. */
export function useDelayedFlag(active: boolean, ms = 300): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) { setElapsed(false); return; }
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && elapsed;
}

/** Test seam: forget every cached read between cases. */
export function resetStudioCacheForTests() {
  store = createStore();
}
