import { PRODUCT_NAME } from '@openpixo/contracts';
import { isProductSiteUrl } from '@openpixo/contracts';

import { boundedRequestErrorCode } from '../analytics/workspace';

import type { ReplaceProjectWorkingDirResponse, ProjectFileTextPreviewResponse, ProjectFileResponse, ProjectPreviewScopeRenewResponse, ProjectPreviewUrlResponse, ProjectFileVersion, ProjectFileVersionSource, ProjectFileVersionResponse, ProjectFileVersionsResponse, ProjectMediaTasksResponse, RestoreProjectFileVersionResponse, SocialShareRequest, SocialShareResponse } from '@openpixo/contracts';
import type { AgentInfo, AppVersionInfo, AppVersionResponse, WhatsNewResponse, ChatAttachment, InstallSkillRequest, InstallSkillResponse, PromptTemplateDetail, PromptTemplateSummary, ProjectFile, ProjectFolder, RenameProjectFileResponse, SkillDetail, SkillSummary, } from '../types';
import type { ArtifactManifest } from '../artifacts/types';
import {
  isOpenPixoHostAvailable,
  openHostExternalUrl,
} from '@openpixo/host';
import {
  coalescedGet,
  evictCoalescedGet,
} from '../lib/coalesced-get';
import {
  evictSharedCancellableGet,
  forceSharedCancellableGet,
  sharedCancellableGet,
} from '../lib/shared-cancellable-get';


import { clientRequestIdHeaders, withDaemonFailure } from '../analytics/failure-detail';

/**
 * `coalescedGet` ttl for reads that may only JOIN a request still on the wire.
 *
 * Zero means nothing is retained once the read settles: a caller that starts
 * after the previous one finished always issues its own request. That is the
 * whole safety argument — such a read can never hand anyone a body it did not
 * itself trigger, so it cannot serve stale state. It can only remove a request
 * the browser would have opened *concurrently* with an identical one.
 *
 * Why that is worth doing: several of these endpoints are read by one effect
 * that legitimately runs twice (React StrictMode replays mount effects in dev;
 * a settling dependency replays them in prod), and the replay always lands
 * while the first request is still open. Measured on one cold conversation
 * open: /api/editors ×2 1ms apart, /deployments ×2 6ms apart, /folders ×2 2ms
 * apart, /api/health ×2 4ms apart. The daemon answers each in 3-7ms, so the
 * cost is not server time — it is a slot in the browser's ~6-connection budget
 * for this origin, which the same page is already oversubscribing.
 *
 * Use this ttl, not a positive one, unless the endpoint has an explicit reason
 * a settled body stays true for a while.
 */
const IN_FLIGHT_SHARE_ONLY_MS = 0;

export async function fetchAgents(options?: { throwOnError?: boolean; refresh?: boolean }): Promise<AgentInfo[]> {
  try {
    const resp = await fetch(options?.refresh ? '/api/agents?refresh=1' : '/api/agents', { cache: 'no-store' });
    if (!resp.ok) {
      if (options?.throwOnError) throw new Error(`agents ${resp.status}`);
      return [];
    }
    const json = (await resp.json()) as { agents: AgentInfo[] };
    return json.agents ?? [];
  } catch (err) {
    if (options?.throwOnError) throw err;
    return [];
  }
}

// Incremental agent detection over Server-Sent Events: `onAgent` fires once
// per agent from the daemon's cache, or as a fresh probe settles, so callers
// can paint cards without waiting for the slowest CLI. Resolves with every
// agent collected once the stream's terminal `done` event arrives. Explicit
// rescans set `refresh`; normal reads allow the daemon's stale-while-revalidate
// cache. Pass an AbortSignal to cancel the underlying request.
export async function fetchAgentsStream(args: {
  onAgent: (agent: AgentInfo) => void;
  signal?: AbortSignal;
  refresh?: boolean;
}): Promise<AgentInfo[]> {
  const { onAgent, signal, refresh } = args;
  const resp = await fetch(refresh ? '/api/agents?stream=1&refresh=1' : '/api/agents?stream=1', {
    cache: 'no-store',
    headers: { Accept: 'text/event-stream' },
    ...(signal ? { signal } : {}),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`agents stream ${resp.status}`);
  }
  const collected: AgentInfo[] = [];
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  const errorMessageFromData = (data: string): string => {
    if (!data.trim()) return 'agents stream error';
    try {
      const parsed = JSON.parse(data) as { error?: unknown; message?: unknown };
      const message = parsed.error ?? parsed.message;
      if (typeof message === 'string' && message.trim()) return message;
    } catch {
      // Fall through to the raw data string below.
    }
    return data;
  };

  const handleEvent = (rawEvent: string) => {
    // Each SSE record is `event: <name>\ndata: <json>`; we act on `agent`
    // (one AgentInfo), `error` (terminal failure), and `done` (terminal
    // success). Unknown events are ignored so the protocol can grow without
    // breaking older clients.
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    const data = dataLines.join('\n');
    if (eventName === 'done') {
      done = true;
      return;
    }
    if (eventName === 'error') {
      throw new Error(errorMessageFromData(data));
    }
    if (eventName === 'agent' && data) {
      try {
        const agent = JSON.parse(data) as AgentInfo;
        collected.push(agent);
        onAgent(agent);
      } catch {
        // Ignore a malformed record rather than aborting the whole stream.
      }
    }
  };

  try {
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      // SSE records are separated by a blank line ("\n\n").
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (rawEvent.trim().length > 0) handleEvent(rawEvent);
        if (done) break;
      }
    }
    if (!done && buffer.trim().length > 0) {
      handleEvent(buffer);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Reader may already be closed; nothing to do.
    }
  }
  if (!done) {
    throw new Error('agents stream ended before done');
  }
  return collected;
}

// `workspaceContext`, when present, attaches the same workspace identity
// headers project/plugin reads already carry (`workspaceProjectHeaders`) so
// the daemon's `GET /api/skills` can apply its workspace-scoped filter
// (skills.ts's `skillVisibleFromWorkspace`, mirroring `listInstalledPlugins`'s
// one-way "unclaimed visible everywhere, claimed elsewhere hidden" rule).
// Omit for callers that want the unfiltered, pre-workspace-isolation list.
type CatalogReadObserver = { onReadResult?: (success: boolean) => void };
function observeCatalogRead(options: CatalogReadObserver | undefined, success: boolean): void {
  try { options?.onReadResult?.(success); } catch { /* Observation cannot affect catalog reads. */ }
}

export async function fetchSkills(
  options?: CatalogReadObserver,
): Promise<SkillSummary[]> {
  try {
    const resp = await fetch(
      '/api/skills',
      undefined,
    );
    if (!resp.ok) { observeCatalogRead(options, false); return []; }
    const json = (await resp.json()) as { skills: SkillSummary[] };
    observeCatalogRead(options, Array.isArray(json.skills));
    return Array.isArray(json.skills) ? json.skills : [];
  } catch {
    observeCatalogRead(options, false);
    return [];
  }
}

export async function fetchProjectMediaTasks(
  projectId: string
): Promise<ProjectMediaTasksResponse> {
  const resp = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/media/tasks?includeDone=1`,
    {
      cache: 'no-store',
      ...({}),
    },
  );
  if (!resp.ok) throw new Error(`media tasks ${resp.status}`);
  return await resp.json() as ProjectMediaTasksResponse;
}

// Design templates — the rendering catalogue (decks, prototypes, image/
// video/audio templates). Same SkillSummary shape as functional skills,
// fetched from a separate registry root so the EntryView Templates tab
// and Settings → Skills surface stay decoupled. See
// specs/current/skills-and-design-templates.md.
export async function fetchDesignTemplates(options?: CatalogReadObserver): Promise<SkillSummary[]> {
  try {
    const resp = await fetch('/api/design-templates');
    if (!resp.ok) { observeCatalogRead(options, false); return []; }
    const json = (await resp.json()) as { designTemplates: SkillSummary[] };
    observeCatalogRead(options, Array.isArray(json.designTemplates));
    return json.designTemplates ?? [];
  } catch {
    observeCatalogRead(options, false);
    return [];
  }
}

export async function fetchDesignTemplate(id: string): Promise<SkillDetail | null> {
  try {
    const resp = await fetch(`/api/design-templates/${encodeURIComponent(id)}`);
    if (!resp.ok) return null;
    return (await resp.json()) as SkillDetail;
  } catch {
    return null;
  }
}

export interface SkillImportInput {
  name: string;
  description?: string;
  body: string;
  triggers?: string[];
}

export interface SkillImportError {
  code?: string;
  message: string;
  status?: number;
}

async function readSkillOperationError(resp: Response): Promise<SkillImportError> {
  try {
    const payload = await resp.json() as {
      error?: string | { code?: unknown; message?: unknown };
      code?: unknown;
      message?: unknown;
    };
    const envelope = payload.error && typeof payload.error === 'object'
      ? payload.error
      : null;
    const rawCode = envelope?.code ?? payload.code;
    const boundedCode = boundedRequestErrorCode(rawCode);
    const rawMessage = envelope?.message
      ?? payload.message
      ?? (typeof payload.error === 'string' ? payload.error : undefined);
    return {
      message: typeof rawMessage === 'string' && rawMessage.trim()
        ? rawMessage
        : `Request failed (${resp.status}).`,
      ...(boundedCode ? { code: boundedCode } : {}),
      status: resp.status,
    };
  } catch {
    return { message: `Request failed (${resp.status}).`, status: resp.status };
  }
}

// `workspaceContext`, when present, stamps the imported skill with the
// acting workspace (see `fetchSkills` above) so the daemon's
// `bindImportedSkillToWorkspace` (routes/static-resource.ts) has a workspace
// identity to bind against. Omit for callers that intentionally leave the
// skill unclaimed (visible everywhere).
export async function importSkill(
  input: SkillImportInput
): Promise<{ skill: SkillSummary } | { error: SkillImportError }> {
  try {
    const resp = await fetch('/api/skills/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...({}),
      },
      body: JSON.stringify(input),
    });
    if (!resp.ok) {
      return { error: await readSkillOperationError(resp) };
    }
    return (await resp.json()) as { skill: SkillSummary };
  } catch (err) {
    return {
      error: {
        code: 'network_error',
        message: err instanceof Error ? err.message : 'Import request failed.',
      },
    };
  }
}

// Update an existing skill's body. For built-in skills the daemon writes
// a "shadow" copy under the user-skills root; the next listSkills() pass
// surfaces it in place of the bundled copy. The id passed here must
// match the SKILL.md frontmatter `name` — the daemon refuses cross-id
// renames so callers can drop "edit" into the same surface they use for
// "edit my own draft".
export interface SkillUpdateInput {
  name?: string;
  description?: string;
  body: string;
  triggers?: string[];
}

// `workspaceContext`, when present, proves the caller's workspace membership
// against the daemon's `enforceWorkspaceResourceMutation` gate (see
// `fetchSkills` above) — required once the skill being edited carries a
// `workspace_resources` binding row; a no-op for an unbound (legacy) skill.
export async function updateSkill(
  id: string,
  input: SkillUpdateInput
): Promise<{ skill: SkillSummary } | { error: SkillImportError }> {
  try {
    const resp = await fetch(`/api/skills/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...({}),
      },
      body: JSON.stringify(input),
    });
    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as
        | { error?: SkillImportError }
        | null;
      return {
        error: {
          code: payload?.error?.code,
          message:
            payload?.error?.message ?? `Update failed (${resp.status}).`,
        },
      };
    }
    return (await resp.json()) as { skill: SkillSummary };
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : 'Update request failed.',
      },
    };
  }
}

export interface SkillFileEntry {
  path: string;
  kind: 'file' | 'directory';
  size: number | null;
}

export async function fetchSkillFiles(
  id: string
): Promise<SkillFileEntry[]> {
  try {
    const resp = await fetch(
      `/api/skills/${encodeURIComponent(id)}/files`,
      undefined,
    );
    if (!resp.ok) return [];
    const json = (await resp.json()) as { files: SkillFileEntry[] };
    return json.files ?? [];
  } catch {
    return [];
  }
}

// `workspaceContext`, when present, proves the caller's workspace membership
// against the daemon's `enforceWorkspaceResourceMutation` gate (see
// `fetchSkills` above) — required once the skill being deleted carries a
// `workspace_resources` binding row (installed/imported by someone else, or
// pulled in from a team share); a no-op for an unbound (legacy) skill.
export async function deleteSkill(
  id: string
): Promise<{ ok: true } | { error: SkillImportError }> {
  try {
    const resp = await fetch(`/api/skills/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      ...({}),
    });
    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as
        | { error?: SkillImportError }
        | null;
      return {
        error: {
          code: payload?.error?.code,
          message: payload?.error?.message ?? `Delete failed (${resp.status}).`,
        },
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : 'Delete request failed.',
      },
    };
  }
}

export async function fetchSkill(
  id: string
): Promise<SkillDetail | null> {
  try {
    const resp = await fetch(
      `/api/skills/${encodeURIComponent(id)}`,
      undefined,
    );
    if (!resp.ok) return null;
    return (await resp.json()) as SkillDetail;
  } catch {
    return null;
  }
}

export class DesignSystemDeleteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'DesignSystemDeleteError';
  }
}


export async function fetchPromptTemplates(options?: CatalogReadObserver): Promise<PromptTemplateSummary[]> {
  try {
    const resp = await fetch('/api/prompt-templates');
    if (!resp.ok) { observeCatalogRead(options, false); return []; }
    const json = (await resp.json()) as { promptTemplates: PromptTemplateSummary[] };
    observeCatalogRead(options, Array.isArray(json.promptTemplates));
    return json.promptTemplates ?? [];
  } catch {
    observeCatalogRead(options, false);
    return [];
  }
}

export async function fetchPromptTemplate(
  surface: 'image' | 'video',
  id: string,
): Promise<PromptTemplateDetail | null> {
  try {
    const resp = await fetch(
      `/api/prompt-templates/${encodeURIComponent(surface)}/${encodeURIComponent(id)}`,
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { promptTemplate: PromptTemplateDetail };
    return json.promptTemplate ?? null;
  } catch {
    return null;
  }
}

export async function daemonIsLive(): Promise<boolean> {
  return coalescedGet(
    'daemon-health',
    async () => {
      try {
        const resp = await fetch('/api/health');
        return resp.ok;
      } catch {
        return false;
      }
    },
    IN_FLIGHT_SHARE_ONLY_MS,
  );
}

function popupBlockedMessage(): string {
  return `Popup blocked. Allow popups for ${PRODUCT_NAME} and try again.`;
}

export async function openExternalUrl(url: string): Promise<boolean> {
  const bridgedUrl = await bridgeFirstPartyUrl(url);
  const targetUrl = bridgedUrl ?? url;
  if (isOpenPixoHostAvailable()) {
    const opened = await openHostExternalUrl(targetUrl);
    if (opened.ok) return true;
  }
  try {
    const resp = await fetch('/api/system/open-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl }),
    });
    if (resp.ok) {
      const json = (await resp.json().catch(() => null)) as { ok?: unknown } | null;
      if (json?.ok === true) return true;
    }
  } catch {
    // Fall through to current-tab navigation below.
  }
  try {
    window.location.assign(targetUrl);
  } catch {
    return false;
  }
  return false;
}

async function bridgeFirstPartyUrl(url: string): Promise<string | null> {
  try {
    const target = new URL(url);
    if (!isProductSiteUrl(url)) return null;
    const resp = await fetch('/api/attribution/bridge-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: target.toString() }),
    });
    if (!resp.ok) return null;
    const body = await resp.json() as { url?: unknown };
    return typeof body.url === 'string' ? body.url : null;
  } catch {
    return null;
  }
}


function isAppVersionInfo(value: unknown): value is AppVersionInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppVersionInfo>;
  // `capabilities` is optional so an older daemon's response stays valid; a
  // present-but-wrong shape is rejected rather than half-trusted.
  const caps = candidate.capabilities as { slideRenderer?: unknown } | undefined;
  if (caps !== undefined && (!caps || typeof caps.slideRenderer !== 'boolean')) return false;
  return (
    typeof candidate.version === 'string' &&
    typeof candidate.channel === 'string' &&
    typeof candidate.packaged === 'boolean' &&
    typeof candidate.platform === 'string' &&
    typeof candidate.arch === 'string'
  );
}

export async function fetchAppVersionInfo(): Promise<AppVersionInfo | null> {
  try {
    const resp = await fetch('/api/version');
    if (!resp.ok) return null;
    const json = (await resp.json()) as Partial<AppVersionResponse>;
    return isAppVersionInfo(json?.version) ? json.version : null;
  } catch {
    return null;
  }
}

export async function fetchWhatsNew(): Promise<WhatsNewResponse | null> {
  try {
    const resp = await fetch('/api/whats-new');
    if (!resp.ok) return null;
    const json = (await resp.json()) as Partial<WhatsNewResponse>;
    if (typeof json.version !== 'string') {
      return null;
    }
    return {
      version: json.version,
      id: typeof json.id === 'string' ? json.id : null,
      content: json.content ?? null,
    };
  } catch {
    return null;
  }
}

export type SkillExampleResult =
  | { html: string }
  // The skill declares a non-HTML preview surface (image / markdown / …)
  // and the daemon's `/example` endpoint only ships HTML, so calling it
  // would 404 into a misleading "failed to fetch" state. The modal
  // renders a calm "no shipped preview" affordance instead. The `kind`
  // is the raw `od.preview.type` from SKILL.md so future preview kinds
  // can be picked up by name without a registry change. Issue #897.
  | { unavailable: true; kind: string }
  | { error: string };

// Returns a discriminated result so callers can distinguish a real
// failure (network error, daemon unreachable, server error) from a
// normal load or a missing shipped preview. Previously this collapsed
// every failure into `null`, which left the example preview modal stuck
// at its loading state with no recovery affordance. Issue #860.
//
// `previewType` is the skill's `od.preview.type` (defaults to `'html'`
// daemon-side). Anything other than `'html'` short-circuits to an
// `unavailable` result so we don't fire a network call against a
// daemon endpoint that only resolves HTML files. Issue #897.
export async function fetchSkillExample(
  id: string,
  previewType: string = 'html'
): Promise<SkillExampleResult> {
  if (previewType !== 'html') {
    return { unavailable: true, kind: previewType };
  }
  try {
    const url = `/api/skills/${encodeURIComponent(id)}/example`;
    const resp = await fetch(url);
    if (!resp.ok) {
      if (resp.status === 404) {
        return { unavailable: true, kind: 'html' };
      }
      return { error: `HTTP ${resp.status}` };
    }
    return { html: await resp.text() };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    return { error: message };
  }
}

export async function createSocialSharePayload(
  input: SocialShareRequest,
): Promise<SocialShareResponse> {
  const resp = await fetch('/api/social-share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!resp.ok) {
    const payload = await resp.json().catch(() => null) as {
      error?: { message?: string };
      message?: string;
    } | null;
    throw new Error(payload?.error?.message || payload?.message || `Share payload failed (${resp.status})`);
  }
  return (await resp.json()) as SocialShareResponse;
}

// Project files — all paths are scoped under .pixo/projects/<id>/ on disk.

function projectFilesCacheKey(
  projectId: string
): string {
  return `project-files:${projectId}:${"local"}`;
}

const projectFilesCacheGenerations = new Map<string, number>();

/**
 * Announce that one authority-scoped project file list is obsolete.
 *
 * This drops a settled shared read and advances the generation fence checked
 * by any request already in flight. The next reader therefore cannot reuse a
 * pre-event snapshot, and an overtaken request re-reads before it resolves to
 * its caller.
 */
export function invalidateProjectFilesCache(
  projectId: string
): void {
  const key = projectFilesCacheKey(projectId);
  projectFilesCacheGenerations.set(key, (projectFilesCacheGenerations.get(key) ?? 0) + 1);
  evictSharedCancellableGet(key);
}

export async function fetchProjectFiles(
  projectId: string,
  options?: {
    signal?: AbortSignal;

    fresh?: boolean;
    /** External writes (for example an Agent run ending) obsolete earlier reads. */
    afterChange?: boolean;
    requireAuthoritative?: boolean;
  },
): Promise<ProjectFile[]> {
  // Every reader of the same project's file list shares one request
  // (Batch A §4.3). Cancellable callers (project-card cover scans aborted
  // when Home unmounts) detach individually; the shared request is aborted
  // only when no reader is left awaiting it, so a foreground project read
  // can never be killed by an abandoned card scan.
  try {
    // A semantic write boundary must advance the domain fence even when it
    // lands inside the shared reader's identity-broadcast coalescing window.
    if (options?.afterChange) {
      invalidateProjectFilesCache(projectId);
    }
    const cacheKey = projectFilesCacheKey(projectId);
    const cacheGeneration = projectFilesCacheGenerations.get(cacheKey) ?? 0;
    const get = options?.fresh ? forceSharedCancellableGet : sharedCancellableGet;
    return await get(
      cacheKey,
      async (signal): Promise<ProjectFile[]> => {
        const url = `/api/projects/${encodeURIComponent(projectId)}/files`;
        const resp = await fetch(url, {
          signal,
          // Agent CLIs write directly to the project directory, so the same
          // URL can change without an HTTP mutation. Keep caching confined to
          // sharedCancellableGet's explicit one-second window; a forced/fresh
          // read must reach the daemon instead of reusing a browser/proxy 200.
          cache: 'no-store',
          ...({}),
        });
        if (!resp.ok) {
          throw new Error(`Project files request failed (${resp.status})`);
        }
        const json = (await resp.json()) as { files?: unknown };
        if (!Array.isArray(json.files)) {
          throw new Error('Project files response was malformed');
        }
        if ((projectFilesCacheGenerations.get(cacheKey) ?? 0) !== cacheGeneration) {
          // Join the newest generation without announcing the same write
          // again or evicting a newer boundary's already-authoritative read.
          return fetchProjectFiles(projectId, { ...options, afterChange: false, fresh: false });
        }
        return json.files as ProjectFile[];
      },
      { signal: options?.signal },
    );
  } catch (error) {
    // Preserve the historical empty fallback for broad list/card callers.
    // State owners that must distinguish an authoritative empty directory
    // from transport failure opt into rejection explicitly.
    if (
      options?.signal?.aborted
      && error instanceof DOMException
      && error.name === 'AbortError'
    ) {
      return [];
    }
    if (options?.requireAuthoritative) throw error;
    return [];
  }
}

export type ProjectDesignTokenSuggestion = import('@openpixo/contracts').ProjectDesignTokenSuggestion;
export type ProjectDesignTokenSuggestionProp = import('@openpixo/contracts').ProjectDesignTokenSuggestionProp;

export async function fetchProjectDesignTokenSuggestions(
  projectId: string,
  input: {
    file?: string;
    targetId?: string;
    props?: ProjectDesignTokenSuggestionProp[];
    values?: Partial<Record<ProjectDesignTokenSuggestionProp, string>>;
  }
): Promise<ProjectDesignTokenSuggestion[]> {
  const params = new URLSearchParams();
  if (input.file) params.set('file', input.file);
  if (input.targetId) params.set('targetId', input.targetId);
  if (input.props?.length) params.set('props', input.props.join(','));
  for (const [prop, value] of Object.entries(input.values ?? {})) {
    if (value) params.set(`value_${prop}`, value);
  }
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/design-token-suggestions?${params.toString()}`, {
      cache: 'no-store',
      ...({}),
    });
    if (!resp.ok) return [];
    const json = (await resp.json()) as { suggestions?: ProjectDesignTokenSuggestion[] };
    return json.suggestions ?? [];
  } catch {
    return [];
  }
}

export async function fetchProjectFolders(
  projectId: string
): Promise<ProjectFolder[]> {
  // Keyed by the authority the request is made under as well as the project:
  // two readers may only share a request that carries the same Workspace
  // headers, or one identity's answer could satisfy another's read.
  return coalescedGet(
    `project-folders:${projectId}:${"local"}`,
    async () => {
      try {
        const resp = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/folders`,
          undefined,
        );
        if (!resp.ok) return [];
        const json = (await resp.json()) as { folders?: ProjectFolder[] };
        return json.folders ?? [];
      } catch {
        return [];
      }
    },
    IN_FLIGHT_SHARE_ONLY_MS,
  );
}

export async function createProjectFolder(
  projectId: string,
  name: string
): Promise<ProjectFolder | null> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/folders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...({}),
      },
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { folder?: ProjectFolder };
    return json.folder ?? null;
  } catch {
    return null;
  }
}

export async function deleteProjectFolder(
  projectId: string,
  folderPath: string
): Promise<boolean> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/folders`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...({}),
      },
      body: JSON.stringify({ path: folderPath }),
    });
    if (!resp.ok) return false;
    invalidateProjectFilesCache(projectId);
    return true;
  } catch {
    return false;
  }
}

async function readApiErrorBody(resp: Response): Promise<{ message: string; code?: string }> {
  try {
    const json = (await resp.json()) as { error?: { code?: string; message?: string } | string; message?: string };
    const message = typeof json.error === 'string' ? json.error : json.error?.message ?? json.message;
    return {
      message: typeof message === 'string' && message.length > 0 ? message : `Request failed (${resp.status}).`,
      ...(typeof json.error === 'object' && typeof json.error?.code === 'string' ? { code: json.error.code } : {}),
    };
  } catch {
    return { message: `Request failed (${resp.status}).` };
  }
}

export function projectFileUrl(
  projectId: string,
  name: string
): string {
  return projectRawUrl(projectId, name);
}

/**
 * Mint the daemon-owned, project-scoped preview capability and return its
 * directory URL for srcDoc relative-resource resolution. Project ownership is
 * persisted by the daemon, so the browser must not duplicate that authority in
 * query parameters or headers. The opaque preview scope authorizes subsequent
 * asset navigation without exposing Workspace identifiers in iframe URLs.
 */
export interface ProjectPreviewBaseScope {
  href: string;
  expiresAt: number;
}

// Newer daemons return the authoritative scope expiry. During a rolling
// desktop/web update the web bundle can briefly run against an older daemon,
// so retain a conservative refresh horizon instead of rejecting an otherwise
// valid preview URL and dropping relative assets altogether.
const LEGACY_PREVIEW_SCOPE_REFRESH_MS = 45 * 60 * 1000;

function previewCapabilityHref(pathname: string): string {
  const runtimeHref = typeof globalThis.location?.href === 'string'
    ? globalThis.location.href
    : 'http://openpixo.local/';
  return new URL(pathname, runtimeHref).href;
}

export async function fetchProjectPreviewBaseHref(
  projectId: string,
  name: string
): Promise<ProjectPreviewBaseScope | null> {
  const params = new URLSearchParams({ file: name });
  const requestUrl =
    `/api/projects/${encodeURIComponent(projectId)}/preview-url?${params.toString()}`;
  try {
    const response = await fetch(requestUrl, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as ProjectPreviewUrlResponse;
    if (typeof body.url !== 'string' || !body.url.startsWith('/')) return null;
    const parsed = new URL(body.url, 'http://openpixo.local');
    const expectedPrefix = `/api/projects/${encodeURIComponent(projectId)}/preview/`;
    if (!parsed.pathname.startsWith(expectedPrefix)) return null;
    const directoryEnd = parsed.pathname.lastIndexOf('/') + 1;
    if (directoryEnd <= expectedPrefix.length) return null;
    const expiresAt = typeof body.expiresAt === 'number' && Number.isFinite(body.expiresAt)
      ? body.expiresAt
      : Date.now() + LEGACY_PREVIEW_SCOPE_REFRESH_MS;
    return {
      // Electron renders injected HTML from blob:openpixo:// URLs. A root-relative
      // <base> is ignored in a Blob document, leaving document.baseURI on the
      // Blob and breaking lazy or script-created relative assets. Resolve the
      // capability against the host document while it still has a real origin.
      href: previewCapabilityHref(parsed.pathname.slice(0, directoryEnd)),
      expiresAt,
    };
  } catch {
    return null;
  }
}

export async function renewProjectPreviewBaseScope(
  projectId: string,
  href: string,
): Promise<number | null> {
  try {
    const parsed = new URL(href, 'http://openpixo.local');
    const expectedPrefix = `/api/projects/${encodeURIComponent(projectId)}/preview/`;
    if (!parsed.pathname.startsWith(expectedPrefix)) return null;
    const scopeEnd = parsed.pathname.indexOf('/', expectedPrefix.length);
    if (scopeEnd <= expectedPrefix.length) return null;
    const scope = parsed.pathname.slice(expectedPrefix.length, scopeEnd);
    if (!/^[A-Za-z0-9_-]{8,128}$/u.test(scope)) return null;
    const response = await fetch(
      `${expectedPrefix}${encodeURIComponent(scope)}/renew`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: { 'x-pixo-preview-scope-renewal': '1' },
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as ProjectPreviewScopeRenewResponse;
    return typeof body.expiresAt === 'number' && Number.isFinite(body.expiresAt)
      ? body.expiresAt
      : null;
  } catch {
    return null;
  }
}

export interface ProjectFilePreviewSection {
  title: string;
  lines: string[];
}

export interface ProjectFilePreview {
  kind: 'pdf' | 'document' | 'presentation' | 'spreadsheet';
  title: string;
  sections: ProjectFilePreviewSection[];
}

export async function fetchProjectFilePreview(
  projectId: string,
  name: string
): Promise<ProjectFilePreview | null> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(name)}/preview`,
      undefined,
    );
    if (!resp.ok) return null;
    return (await resp.json()) as ProjectFilePreview;
  } catch {
    return null;
  }
}

export async function fetchProjectFileText(
  projectId: string,
  name: string,
  options?: {
    cache?: RequestCache;
    cacheBustKey?: string | number;
    signal?: AbortSignal;

  },
): Promise<string | null> {
  const url = projectFileUrl(projectId, name);
  const cacheBustKey = options?.cacheBustKey;
  const requestUrl =
    cacheBustKey == null
      ? url
      : `${url}${url.includes('?') ? '&' : '?'}cacheBust=${encodeURIComponent(String(cacheBustKey))}`;
  const init: RequestInit = {};
  if (options?.cache) init.cache = options.cache;
  if (options?.signal) init.signal = options.signal;


  try {
    const resp = await fetch(requestUrl, init);
    if (options?.signal?.aborted) return null;
    if (!resp.ok) {
      console.warn('[fetchProjectFileText] failed:', {
        name,
        projectId,
        status: resp.status,
        statusText: resp.statusText,
        url: requestUrl,
      });
      return null;
    }
    return await resp.text();
  } catch (err) {
    if (
      options?.signal?.aborted ||
      (err instanceof DOMException && err.name === 'AbortError')
    ) {
      return null;
    }
    console.warn('[fetchProjectFileText] failed:', {
      error: err,
      name,
      projectId,
      url: requestUrl,
    });
    return null;
  }
}

export async function fetchProjectFileTextPreview(
  projectId: string,
  name: string,
  options?: {
    limit?: number;
    cacheBustKey?: string | number;

  },
): Promise<ProjectFileTextPreviewResponse | null> {
  const segments = name
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
  if (!segments) return null;
  const params = new URLSearchParams();
  if (options?.limit != null) params.set('limit', String(options.limit));
  if (options?.cacheBustKey != null) params.set('cacheBust', String(options.cacheBustKey));
  const query = params.toString();
  const url = `/api/projects/${encodeURIComponent(projectId)}/text-preview/${segments}${query ? `?${query}` : ''}`;

  try {
    const resp = await fetch(url, {
      cache: 'no-store',
      ...({}),
    });
    if (!resp.ok) {
      console.warn('[fetchProjectFileTextPreview] failed:', {
        name,
        projectId,
        status: resp.status,
        statusText: resp.statusText,
        url,
      });
      return null;
    }
    return (await resp.json()) as ProjectFileTextPreviewResponse;
  } catch (err) {
    console.warn('[fetchProjectFileTextPreview] failed:', {
      error: err,
      name,
      projectId,
      url,
    });
    return null;
  }
}

function projectFileVersionsUrl(projectId: string, name: string): string {
  const safePath = name
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `/api/projects/${encodeURIComponent(projectId)}/files/${safePath}/versions`;
}

export async function fetchProjectFileVersions(
  projectId: string,
  name: string
): Promise<ProjectFileVersionsResponse | null> {
  try {
    const resp = await fetch(projectFileVersionsUrl(projectId, name), {
      cache: 'no-store',
      ...({}),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as ProjectFileVersionsResponse;
  } catch {
    return null;
  }
}

export async function fetchProjectFileVersion(
  projectId: string,
  name: string,
  versionId: string
): Promise<ProjectFileVersionResponse | null> {
  try {
    const resp = await fetch(
      `${projectFileVersionsUrl(projectId, name)}/${encodeURIComponent(versionId)}`,
      {
        cache: 'no-store',
        ...({}),
      },
    );
    if (!resp.ok) return null;
    return (await resp.json()) as ProjectFileVersionResponse;
  } catch {
    return null;
  }
}

export async function restoreProjectFileVersion(
  projectId: string,
  name: string,
  version: Pick<ProjectFileVersion, 'id'>
): Promise<RestoreProjectFileVersionResponse | null> {
  try {
    const resp = await fetch(
      `${projectFileVersionsUrl(projectId, name)}/${encodeURIComponent(version.id)}/restore`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...({}),
        },
        body: JSON.stringify({}),
      },
    );
    if (!resp.ok) return null;
    invalidateProjectFilesCache(projectId);
    return (await resp.json()) as RestoreProjectFileVersionResponse;
  } catch {
    return null;
  }
}

export async function writeProjectTextFile(
  projectId: string,
  name: string,
  content: string,
  options?: {
    artifactManifest?: ArtifactManifest;
    versionSource?: ProjectFileVersionSource;
    versionLabel?: string;
    versionPrompt?: string | null;
    parentVersionId?: string;
  }
): Promise<ProjectFile | null> {
  const result = await writeProjectTextFileDetailed(projectId, name, content, options);
  return result.ok ? result.file : null;
}

export type WriteProjectTextFileResult =
  | { ok: true; file: ProjectFile; version?: ProjectFileVersion | null }
  | { ok: false; status?: number; code?: string; message: string };

export async function writeProjectTextFileDetailed(
  projectId: string,
  name: string,
  content: string,
  options?: {
    artifactManifest?: ArtifactManifest;
    versionSource?: ProjectFileVersionSource;
    versionLabel?: string;
    versionPrompt?: string | null;
    parentVersionId?: string;
  }
): Promise<WriteProjectTextFileResult> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...({}),
      },
      body: JSON.stringify({
        name,
        content,
        artifactManifest: options?.artifactManifest,
        versionSource: options?.versionSource,
        versionLabel: options?.versionLabel,
        versionPrompt: options?.versionPrompt,
        parentVersionId: options?.parentVersionId,
      }),
    });
    if (!resp.ok) {
      const body = await readApiErrorBody(resp);
      return {
        ok: false,
        status: resp.status,
        code: body.code,
        message: body.message || resp.statusText || 'Save failed',
      };
    }
    invalidateProjectFilesCache(projectId);
    const json = (await resp.json()) as ProjectFileResponse;
    return {
      ok: true,
      file: json.file,
      ...(json.version !== undefined ? { version: json.version } : {}),
    };
  } catch {
    return { ok: false, message: 'Network error while saving the file' };
  }
}

export async function writeProjectBase64File(
  projectId: string,
  name: string,
  base64: string
): Promise<ProjectFile | null> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...({}),
      },
      body: JSON.stringify({ name, content: base64, encoding: 'base64' }),
    });
    if (!resp.ok) return null;
    invalidateProjectFilesCache(projectId);
    const json = (await resp.json()) as { file: ProjectFile };
    return json.file;
  } catch {
    return null;
  }
}

export async function uploadProjectFile(
  projectId: string,
  file: File,
  desiredName?: string
): Promise<ProjectFile | null> {
  try {
    const form = new FormData();
    form.append('file', file);
    if (desiredName) form.append('name', desiredName);
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, {
      method: 'POST',
      ...({}),
      body: form,
    });
    if (!resp.ok) return null;
    invalidateProjectFilesCache(projectId);
    const json = (await resp.json()) as { file: ProjectFile };
    return json.file;
  } catch {
    return null;
  }
}

// Multi-file project upload used by the chat composer's paste / drop /
// picker. Each file lands flat in the project folder; the response is
// reshaped into ChatAttachments so the composer can stage them without a
// follow-up listFiles round-trip.
const PROJECT_UPLOAD_BATCH_SIZE = 12;

export interface ProjectUploadFailure {
  name: string;
  code?: string;
  error?: string;
}

export interface UploadProjectFilesResult {
  uploaded: ChatAttachment[];
  failed: ProjectUploadFailure[];
  error?: string;
}

export async function uploadProjectFiles(
  projectId: string,
  files: File[],
  dir?: string
): Promise<UploadProjectFilesResult> {
  if (files.length === 0) return { uploaded: [], failed: [] };

  const uploaded: ChatAttachment[] = [];
  const failed: ProjectUploadFailure[] = [];
  let error: string | undefined;
  const targetDir = dir?.trim() ?? '';

  for (let i = 0; i < files.length; i += PROJECT_UPLOAD_BATCH_SIZE) {
    const batch = files.slice(i, i + PROJECT_UPLOAD_BATCH_SIZE);
    const remaining = files.slice(i + PROJECT_UPLOAD_BATCH_SIZE);
    const form = new FormData();
    // The `dir` field MUST be appended before the file parts: the daemon's
    // multer destination resolver reads req.body.dir as each file streams in,
    // and busboy only exposes fields parsed earlier in the multipart body.
    if (targetDir) form.append('dir', targetDir);
    for (const f of batch) form.append('files', f);

    try {
      const resp = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/upload`,
        {
          method: 'POST',
          ...({}),
          body: form,
        },
      );

      if (!resp.ok) {
        const payload = (await resp.json().catch(() => null)) as
          | { code?: string; error?: string }
          | null;
        error = payload?.error ?? `upload failed (${resp.status})`;
        for (const f of batch) {
          failed.push({ name: f.name, code: payload?.code, error: error });
        }
        for (const f of remaining) {
          failed.push({ name: f.name, code: payload?.code, error: error });
        }
        break;
      }

      invalidateProjectFilesCache(projectId);
      const json = (await resp.json()) as {
        files: { name: string; path: string; size?: number; originalName?: string }[];
      };
      const responseFiles = json.files ?? [];
      uploaded.push(
        ...responseFiles.map((f) => ({
          path: f.path,
          name: f.originalName ?? f.name,
          kind: looksLikeImage(f.name) ? ('image' as const) : ('file' as const),
          size: f.size,
        })),
      );
      // Server preserves request order; any dropped files are unmatched at the batch tail.
      if (responseFiles.length < batch.length) {
        error ??= 'some files could not be stored';
        for (const f of batch.slice(responseFiles.length)) {
          failed.push({
            name: f.name,
            error: error ?? 'some files could not be stored',
          });
        }
      }
    } catch {
      error = 'upload request failed';
      for (const f of batch) {
        failed.push({ name: f.name, error });
      }
      for (const f of remaining) {
        failed.push({ name: f.name, error });
      }
      break;
    }
  }

  return { uploaded, failed, error };
}

// Stable URL that serves a project file with its original mime — for
// thumbnails in the staged-attachment chips and for any preview iframe
// that needs to point at the live file (not a srcDoc).
export function projectRawUrl(
  projectId: string,
  filePath: string
): string {
  // Encode each path segment individually so a slash inside the file
  // path stays a path separator, not %2F.
  const safePath = filePath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `/api/projects/${encodeURIComponent(projectId)}/raw/${safePath}`;
}

function looksLikeImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(name);
}

export async function deleteProjectFile(
  projectId: string,
  name: string
): Promise<boolean> {
  try {
    const resp = await fetch(
      projectRawUrl(projectId, name),
      {
        method: 'DELETE',
        ...({}),
      },
    );
    if (!resp.ok) return false;
    invalidateProjectFilesCache(projectId);
    return true;
  } catch {
    return false;
  }
}

export async function renameProjectFile(
  projectId: string,
  from: string,
  to: string
): Promise<RenameProjectFileResponse> {
  const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/rename`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...({}),
    },
    body: JSON.stringify({ from, to }),
  });
  if (!resp.ok) {
    const errorBody = await readApiErrorBody(resp);
    throw new Error(errorBody.message);
  }
  invalidateProjectFilesCache(projectId);
  return (await resp.json()) as RenameProjectFileResponse;
}

export async function openFolderDialog(options: { throwOnError?: boolean } = {}): Promise<string | null> {
  try {
    const resp = await fetch('/api/dialog/open-folder', { method: 'POST' });
    if (!resp.ok) {
      if (options.throwOnError) {
        const errorBody = await readApiErrorBody(resp);
        throw new Error(errorBody.message);
      }
      return null;
    }
    const data = await resp.json();
    return typeof data.path === 'string' && data.path.length > 0 ? data.path : null;
  } catch (err) {
    if (options.throwOnError) {
      throw err instanceof Error ? err : new Error('Could not open folder picker');
    }
    return null;
  }
}

// Probe whether a local directory still exists on disk. Used by the composer
// to flag a working directory in red the moment its folder is deleted.
export async function dirExists(path: string): Promise<boolean> {
  try {
    const resp = await fetch('/api/dir-exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!resp.ok) return true; // can't tell → don't false-flag
    const data = await resp.json();
    return data?.exists !== false;
  } catch {
    return true; // daemon unreachable → don't false-flag
  }
}

// Global most-recently-used working directories (the local folders the user
// grants the agent read-only awareness of). Persisted in the daemon's
// app-config so they survive browser resets and are shared across projects
// and the `pixo` CLI. Returns most-recent-first.
export async function fetchRecentLinkedDirs(): Promise<string[]> {
  try {
    // `/api/recent-dirs` returns the list pruned to folders that still exist
    // on disk (and persists the pruning), so deleted folders never linger.
    // Concurrent consumers (composer pickers, project panels) share one read
    // per burst (Batch A §4.3); pushRecentLinkedDir evicts after writing.
    return await coalescedGet('recent-dirs', async () => {
      const resp = await fetch('/api/recent-dirs');
      if (!resp.ok) return [] as string[];
      const data = await resp.json();
      const list = data?.dirs;
      return Array.isArray(list)
        ? list.filter((d: unknown): d is string => typeof d === 'string')
        : [];
    });
  } catch {
    return [];
  }
}

// Record `dir` as the most-recently-used working directory and return the
// updated list. PUT /api/app-config merges per-key, so sending only
// `recentLinkedDirs` leaves every other preference untouched. The daemon
// also trims/de-dupes/caps the list, but we do it client-side too so the
// optimistic UI matches what gets persisted.
export async function pushRecentLinkedDir(dir: string): Promise<string[]> {
  const existing = await fetchRecentLinkedDirs();
  const next = [dir, ...existing.filter((d) => d !== dir)].slice(0, 5);
  try {
    await fetch('/api/app-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recentLinkedDirs: next }),
    });
  } catch {
    // Daemon offline — the picked dir still applies to this project; the
    // recents list just won't persist for next time.
  }
  // Thin invalidation: the daemon list changed, so the next read must not be
  // answered by the shared burst cache.
  evictCoalescedGet('recent-dirs');
  return next;
}

// "Replace working directory" — points an existing project at a new
// folder. Mirrors the import-folder trust gate but updates the current
// project record instead of creating a new project.
export async function replaceProjectWorkingDir(
  projectId: string,
  baseDir: string,
  desktopImportToken?: string
): Promise<ReplaceProjectWorkingDirResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (desktopImportToken) {
    headers['x-pixo-desktop-import-token'] = desktopImportToken;
  }

  const resp = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/working-dir`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ baseDir }),
    },
  );
  if (!resp.ok) {
    const body = await readApiErrorBody(resp);
    throw new Error(body.message);
  }
  return (await resp.json()) as ReplaceProjectWorkingDirResponse;
}

// Hand-off (open project in local app). The daemon enumerates installed
// editors on demand (PATH probe + macOS bundle scan), and the POST
// endpoint spawns the chosen app with the project's resolvedDir.
export async function fetchHostEditors(): Promise<
  import('@openpixo/contracts').HostEditorsResponse
> {
  return coalescedGet(
    'host-editors',
    async () => {
      const resp = await fetch('/api/editors');
      if (!resp.ok) throw new Error(`GET /api/editors failed: ${resp.status}`);
      return (await resp.json()) as import('@openpixo/contracts').HostEditorsResponse;
    },
    IN_FLIGHT_SHARE_ONLY_MS,
  );
}

export async function openProjectInEditor(
  projectId: string,
  editorId: import('@openpixo/contracts').HostEditorId,
  fileName?: string,
): Promise<import('@openpixo/contracts').OpenProjectInEditorResponse> {
  const resp = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/open-in`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...({}),
      },
      body: JSON.stringify({ editorId, ...(fileName === undefined ? {} : { fileName }) }),
    },
  );
  if (!resp.ok) {
    const body = await readApiErrorBody(resp);
    throw new Error(body.message);
  }
  return (await resp.json()) as import('@openpixo/contracts').OpenProjectInEditorResponse;
}

// Fetch the sandboxed HTML preview the daemon serves for a plugin.
// Mirrors fetchSkillExample's discriminated result so the modal can
// surface a Retry button instead of staying stuck at "Loading…" when
// a plugin ships no preview entry or the asset is missing on disk.
//
// 404 is mapped to `unavailable` (mirroring the skill helper's #897
// behavior) because the daemon returns 404 when the manifest's
// `preview.entry` points at a file that doesn't ship — a missing
// asset for an otherwise valid plugin is not an error the user can
// retry their way out of. Surfacing the calm "no shipped preview"
// placeholder is the truthful UX.
export async function fetchPluginPreviewHtml(
  id: string
): Promise<SkillExampleResult> {
  try {
    const url = `/api/plugins/${encodeURIComponent(id)}/preview`;
    const resp = await fetch(url);
    if (!resp.ok) {
      if (resp.status === 404) return { unavailable: true, kind: 'html' };
      return { error: `HTTP ${resp.status}` };
    }
    return { html: await resp.text() };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    return { error: message };
  }
}

// Fetch a single example output by stem (matches the basename of the
// `od.useCase.exampleOutputs[].path` minus its extension). 404 is
// mapped to `unavailable` for the same reason as fetchPluginPreviewHtml.
export async function fetchPluginExampleHtml(
  pluginId: string,
  stem: string
): Promise<SkillExampleResult> {
  try {
    const url =
      `/api/plugins/${encodeURIComponent(pluginId)}/example/${encodeURIComponent(stem)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      if (resp.status === 404) return { unavailable: true, kind: 'html' };
      return { error: `HTTP ${resp.status}` };
    }
    return { html: await resp.text() };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    return { error: message };
  }
}

// Fetch a raw text asset shipped inside a plugin (DESIGN.md,
// SKILL.md, README.md, etc.). Returns null on any error so the
// caller can fall back to a placeholder; callers that need a
// distinguishable failure should switch to the discriminated
// SkillExampleResult shape used by the HTML helpers above.
export async function fetchPluginAssetText(
  pluginId: string,
  relpath: string
): Promise<string | null> {
  try {
    const url =
      `/api/plugins/${encodeURIComponent(pluginId)}/asset/${encodePluginAssetPath(relpath)}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

function encodePluginAssetPath(relpath: string): string {
  return relpath
    .replace(/^\.\//, '')
    .split(/[\\/]/)
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export async function installSkill(
  input: InstallSkillRequest
): Promise<{ skill: SkillSummary } | { error: SkillImportError }> {
  try {
    const resp = await fetch('/api/skills/install', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...({}),
      },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return { error: await readSkillOperationError(resp) };
    const json = await resp.json();
    return json as InstallSkillResponse;
  } catch {
    return { error: { code: 'network_error', message: 'Network error' } };
  }
}

// `workspaceContext`, when present, proves the caller's workspace membership
// against the daemon's `enforceWorkspaceResourceMutation` gate — see
// `deleteSkill` above for the same pattern on the user-authored skill CRUD
// surface; this is the counterpart for the marketplace "已安装" uninstall
// action.
export async function uninstallSkill(
  id: string
): Promise<{ ok: true } | { error: string }> {
  try {
    const resp = await fetch(`/api/skills/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      ...({}),
    });
    const json = await resp.json();
    if (!resp.ok) return { error: json.error ?? 'Uninstall failed' };
    return { ok: true };
  } catch {
    return { error: 'Network error' };
  }
}
