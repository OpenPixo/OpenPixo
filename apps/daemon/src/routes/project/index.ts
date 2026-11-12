
import { removeCheckpointStore } from '../../projects/checkpoint-store.js';
import { type ProjectMutations } from '../../projects/mutations.js';


import { injectMotionSourcePlayer, isMotionVideoComposition, markMotionHostedPreview, MOTION_PREVIEW_OUTPUT_HEADER } from '@openpixo/contracts/runtime/motion-source-player';
import { createHash, randomUUID } from 'node:crypto';

import type { ProjectDeleteResponse } from '@openpixo/contracts';
import { publicFileMutationHandler } from '../public-file-mutation-handler.js';

import { rm } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import {
  deleteWorkspaceArtifact,
  deleteWorkspaceArtifactsInFolder,
  renameWorkspaceArtifactPath,
} from '../../chat-artifacts/store.js';
import type { Express, Response } from 'express';
import type { LintArtifactRequest, LintArtifactResponse } from '@openpixo/contracts';
import {
  PREVIEW_OBSERVABILITY_BRIDGE_MARKER,
  buildPreviewBaseHrefBridge,
  buildPreviewObservabilityBridge,
} from '@openpixo/contracts/runtime/preview-observability';
import {
  PREVIEW_BUILD_FOCUS_BRIDGE_MARKER,
  buildPreviewBuildFocusBridge,
} from '@openpixo/contracts/runtime/preview-build-focus';
import {
  buildPreviewFocusGuard,
  buildPreviewVisibilityGuard,
  buildPreviewRedirectGuard,
  buildPreviewSandboxShim,
  PREVIEW_URL_GUARD_MAX_HTML_BYTES,
  previewHtmlHasLoadTimeLocationNavigation,
} from '@openpixo/contracts/runtime/preview-guards';
import {
  endOfTag,
  findRealElementRange,
  findRealTagOffset,
  HTML_TAG_PATTERNS,
  prependAfterDoctype,
} from '@openpixo/contracts/runtime/html-injection-points';
import { defaultScenarioPluginIdForProjectMetadata, type ChatSessionMode, type PluginManifest, type ProjectFile, type ProjectFileTextPreviewResponse, type ProjectFileVersion, type ProjectFileVersionPromptSource, type ProjectFileVersionSource, type ProjectFileVersionWarning, type ProjectMetadata, type RestoreProjectAutomaticScenarioRequest, type RestoreProjectAutomaticScenarioResponse } from '@openpixo/contracts';
import { createProjectArtifactFile } from '../../artifacts/create.js';
import { ArtifactPublicationBlockedError } from '../../artifacts/publication-guard.js';
import { ArtifactRegressionError } from '../../artifacts/stub-guard.js';
import {
  ensureCurrentProjectFileVersion,
  isProjectFileVersionPath,
  listProjectFileVersions,
  markProjectFileVersionStoreDeleted,
  readProjectFileVersion,
  renameProjectFileVersionStore,
  withProjectFileVersionLock,
} from '../../project-file-versions.js';
import { FIRST_PARTY_ATOMS, getInstalledPlugin, listInstalledPlugins, automaticScenarioTaskProfile, createProjectExampleBinding, digestExampleSkillManifest, InvalidProjectExampleBindingError, readVerifiedProjectScenarioBinding, resolvePluginSnapshot, type ResolveSnapshotError, type ResolveSnapshotOk } from '../../plugins/index.js';
import type { RouteDeps } from '../../server-context.js';
import { gamePlanAppliesToKind, newGamePlan } from '../../game/plan.js';
import { listSkills } from '../../skills.js';
import { isSafeId, validateProjectPath } from '../../projects.js';
import {
  getFirstProjectConversation,
} from '../../db.js';
import {
  BUILT_IN_PROJECT_LOCATION_ID,
  allProjectLocations,
  createLocationProjectDir,
  ensureProjectLocation,
  scanProjectLocation,
  writeProjectManifest,
} from '../../project-locations.js';
import { parseOrchestratorWorkspace } from '../../workspace-contract.js';
import { registerProjectConversationRoutes } from './conversations.js';


import { createAuthorizeProjectRequest, type AuthorizeProjectRequest } from '../../projects/project-access.js';


import { cancelRunsOwnedBy } from './cancel-owned-runs.js';

export function rewriteOutsideExecutableHtmlRanges(
  html: string,
  rewriteChunk: (chunk: string) => string,
): string {
  const $ = load(html, { sourceCodeLocationInfo: true }, false);
  const scriptRanges = $('script')
    .toArray()
    .flatMap((node) => {
      const location = node.sourceCodeLocation;
      if (!location?.startTag) return [];
      const startTag = html.slice(location.startTag.startOffset, location.startTag.endOffset);
      const isSelfClosingForeignScript = node.namespace !== 'http://www.w3.org/1999/xhtml'
        && startTag.endsWith('/>');
      return [{
        start: location.startTag.endOffset,
        end: location.endTag?.startOffset
          ?? (isSelfClosingForeignScript ? location.startTag.endOffset : html.length),
      }];
    });
  const executableAttributeRanges = $('*')
    .toArray()
    .flatMap((node) => {
      const sourceLocation = node.sourceCodeLocation;
      if (!sourceLocation || !('attrs' in sourceLocation)) return [];
      const attributes = sourceLocation.attrs as Record<string, {
        startOffset: number;
        endOffset: number;
      }> | undefined;
      const element = node as Extract<typeof node, { attribs: Record<string, string> }>;
      // parse5 stores namespaced values by local name and keeps their source prefix separately.
      const valuesBySourceName = new Map(Object.entries(element.attribs).map(([localName, value]) => {
        const prefix = element['x-attribsPrefix']?.[localName];
        return [(prefix ? `${prefix}:${localName}` : localName).toLowerCase(), value] as const;
      }));
      return Object.entries(attributes ?? {}).flatMap(([name, location]) => {
        const normalizedName = name.toLowerCase();
        const value = valuesBySourceName.get(normalizedName) ?? '';
        const normalizedSchemeValue = value.replace(/[\t\n\r]/g, '');
        if (
          normalizedName.startsWith('on')
          || normalizedName === 'srcdoc'
          || /^\s*(?:javascript|vbscript|data):/i.test(normalizedSchemeValue)
        ) {
          return [{ start: location.startOffset, end: location.endOffset }];
        }
        return [];
      });
    });
  const protectedRanges = [...scriptRanges, ...executableAttributeRanges]
    .sort((left, right) => left.start - right.start)
    .reduce<Array<{ start: number; end: number }>>((ranges, range) => {
      const previous = ranges.at(-1);
      if (!previous || range.start > previous.end) {
        ranges.push({ ...range });
      } else {
        previous.end = Math.max(previous.end, range.end);
      }
      return ranges;
    }, []);

  let markerPrefix: string | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = `__PIXO_PROTECTED_HTML_RANGE_${randomUUID()}_`;
    if (!html.includes(candidate)) {
      markerPrefix = candidate;
      break;
    }
  }
  if (!markerPrefix) throw new Error('Unable to allocate protected HTML marker');

  const protectedValues: Array<{ marker: string; value: string }> = [];
  let maskedHtml = '';
  let cursor = 0;
  for (const [index, range] of protectedRanges.entries()) {
    const marker = `${markerPrefix}${index}__`;
    maskedHtml += html.slice(cursor, range.start);
    maskedHtml += marker;
    protectedValues.push({ marker, value: html.slice(range.start, range.end) });
    cursor = range.end;
  }
  maskedHtml += html.slice(cursor);

  let rewrittenHtml = rewriteChunk(maskedHtml);
  for (const { marker, value } of protectedValues) {
    rewrittenHtml = rewrittenHtml.split(marker).join(value);
  }
  return rewrittenHtml;
}

/**
 * Upper bound for every asynchronous read POST /api/projects performs before
 * its project/conversation transaction. The Web enters an optimistic project
 * surface the moment it sends the request, so a stalled catalogue scan must
 * turn into a definite 504 the client can roll back from rather than an
 * open-ended wait; see `PROJECT_CREATE_PREPARATION_TIMEOUT` in contracts.
 */
export const DEFAULT_PROJECT_CREATE_PREPARATION_TIMEOUT_MS = 15_000;

class ProjectCreatePreparationTimeoutError extends Error {
  constructor(readonly stage: string) {
    super(`Project preparation timed out while ${stage}. Please try again.`);
    this.name = 'ProjectCreatePreparationTimeoutError';
  }
}

/**
 * Bound the read-only work that must finish before the project/conversation
 * transaction starts. A rejected race never continues into that transaction,
 * so a stalled local catalogue scan cannot leave the Web on an endless
 * optimistic project route or create a half-initialized project later.
 */
async function awaitProjectCreatePreparation<T>(
  promise: Promise<T>,
  deadlineMs: number,
  stage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const remainingMs = Math.max(0, deadlineMs - Date.now());
    if (remainingMs === 0) {
      throw new ProjectCreatePreparationTimeoutError(stage);
    }
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ProjectCreatePreparationTimeoutError(stage)),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assertProjectCreatePreparationWithinDeadline(
  deadlineMs: number,
  stage: string,
): void {
  if (Date.now() >= deadlineMs) {
    throw new ProjectCreatePreparationTimeoutError(stage);
  }
}

export interface RegisterProjectRoutesDeps extends RouteDeps<'db' | 'design' | 'http' | 'paths' | 'projectStore' | 'projectFiles' | 'conversations' | 'templates' | 'status' | 'events' | 'ids' | 'telemetry' | 'appConfig' | 'agents' | 'validation'> {
  publicFileMutations?: ProjectMutations;
  projectCreatePreparationTimeoutMs?: number;
  authorizeProjectRequest?: AuthorizeProjectRequest;
  /** Ends the game and terminals a project runs and closes the asset index's watcher, waiting for them to go. */
  projectHolds?: { release: (projectId: string) => Promise<void> };
  prepareCommentFile?: (projectId: string, filePath: string) => Promise<string | undefined>;
  pluginScope?: {
    loadRegistry: (options?: {}) => Promise<Parameters<typeof resolvePluginSnapshot>[0]['registry']>;
    getPlugin: (id: string, options?: {}) => Promise<unknown | null>;
    getLocalPluginBySource?: (id: string, source: string) => Promise<Parameters<typeof resolvePluginSnapshot>[0]['plugin'] | null>;
  };
}

// `WorkspaceProjectContext`/`WorkspaceProjectMutationCapability`/
// `WorkspaceProjectAccessInput` and the header-reading helpers used to be
// defined here, hard-coded to "project". They now live in

// `WorkspaceResource*` shapes (imported above and aliased back to these
// project-flavored names) so plugin/skill/design-system callers share the
// exact same header-parsing and mutation-gate logic instead of forking it.


/**
 * The non-rejecting counterpart of `createEnforceWorkspaceProjectMutation`,
 * for a read route that would otherwise write as a local side effect.
 */


function projectDetailResolvedDir(
  projectsRoot: string,
  project: any,
  resolveProjectDir: (
    projectsRoot: string,
    projectId: string,
    metadata?: unknown,
    opts?: { allowUnavailableSandboxImportedProject?: boolean },
  ) => string,
): string {
  const baseDir = typeof project?.metadata?.baseDir === 'string'
    ? path.normalize(project.metadata.baseDir)
    : null;
  if (baseDir && path.isAbsolute(baseDir)) return baseDir;
  return resolveProjectDir(projectsRoot, project.id, project.metadata, {
    allowUnavailableSandboxImportedProject: true,
  });
}

/**
 * Materialize a *managed* project's folder before it is referenced as
 * read-only context for another run.
 *
 * Invariant: after this resolves for a managed project, `PROJECTS_DIR/<id>`
 * exists on disk. A brand-new project has a DB row but no on-disk directory
 * until its first file write, so without this a reference resolves to a path
 * that fails both the composer's existence probe and the daemon's
 * all-or-nothing linkedDirs validation. External / imported roots (an absolute
 * `metadata.baseDir`) are the user's own folders and are never created here.
 * Materialization failures are required failures: callers must surface them
 * instead of continuing with a resolvedDir that may not exist.
 */
export async function ensureReferencedProjectDir(
  projectsRoot: string,
  project: { id: string; metadata?: unknown },
  ensureProject: (projectsRoot: string, projectId: string, metadata?: unknown) => Promise<string>,
): Promise<void> {
  const metadata = (project?.metadata ?? null) as { baseDir?: unknown } | null;
  const baseDir = typeof metadata?.baseDir === 'string'
    ? path.normalize(metadata.baseDir)
    : null;
  const managedRoot = !(baseDir && path.isAbsolute(baseDir));
  if (!managedRoot) return;
  await ensureProject(projectsRoot, project.id, project.metadata);
}

const URL_PREVIEW_SCROLL_BRIDGE = `<script data-pixo-url-scroll-bridge>
(function(){
  if (window.__pixoUrlScrollBridge) return;
  window.__pixoUrlScrollBridge = true;
  var pending = false;
  var contentSizePending = false;
  var lastContentSizeRequest = null;
  var contentSizeDocumentEpoch = '';
  try {
    contentSizeDocumentEpoch = new URLSearchParams(window.location.search).get('pixoPreviewEpoch') || '';
  } catch (_) {}
  function scrollElement(){
    return document.querySelector('.design-canvas') || document.scrollingElement || document.documentElement;
  }
  function num(value){
    var next = Number(value || 0);
    return Number.isFinite(next) ? next : 0;
  }
  function measureContentSize(){
    var root = document.documentElement;
    var body = document.body || root;
    if (!root) return null;
    var scrollValues = [
      root.scrollWidth,
      body && body.scrollWidth
    ];
    var clientValues = [
      root.clientWidth,
      body && body.clientWidth
    ];
    var scrollWidth = 0;
    var clientWidth = 0;
    for (var i = 0; i < scrollValues.length; i += 1) {
      var nextScroll = num(scrollValues[i]);
      if (nextScroll > scrollWidth) scrollWidth = nextScroll;
    }
    for (var j = 0; j < clientValues.length; j += 1) {
      var nextClient = num(clientValues[j]);
      if (nextClient > clientWidth) clientWidth = nextClient;
    }
    return {
      scrollWidth: scrollWidth > 0 ? Math.ceil(scrollWidth) : null,
      clientWidth: clientWidth > 0 ? Math.ceil(clientWidth) : null
    };
  }
  function postContentSize(){
    if (!lastContentSizeRequest) return;
    var size = measureContentSize();
    window.parent.postMessage({
      type: 'pixo:preview-content-size',
      measurementId: lastContentSizeRequest.measurementId,
      generation: lastContentSizeRequest.generation,
      documentEpoch: contentSizeDocumentEpoch,
      scrollWidth: size && size.scrollWidth,
      clientWidth: size && size.clientWidth
    }, '*');
  }
  function scheduleContentSize(){
    if (contentSizePending) return;
    contentSizePending = true;
    window.requestAnimationFrame(function(){
      contentSizePending = false;
      postContentSize();
    });
  }
  function post(){
    var el = scrollElement();
    if (!el) return;
    var frame = document.scrollingElement || document.documentElement;
    window.parent.postMessage({
      type: 'pixo:preview-scroll',
      canvasLeft: Math.round(el.scrollLeft || 0),
      canvasTop: Math.round(el.scrollTop || 0),
      frameLeft: Math.round(frame.scrollLeft || 0),
      frameTop: Math.round(frame.scrollTop || 0)
    }, '*');
  }
  function schedule(){
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function(){
      pending = false;
      post();
    });
  }
  function scrollTo(el, left, top){
    if (!el) return;
    if (typeof el.scrollTo === 'function') el.scrollTo(num(left), num(top));
    else {
      el.scrollLeft = num(left);
      el.scrollTop = num(top);
    }
  }
  function scrollBy(el, left, top){
    if (!el) return;
    var dx = num(left);
    var dy = num(top);
    if (!dx && !dy) return;
    if (typeof el.scrollBy === 'function') el.scrollBy({ left: dx, top: dy, behavior: 'auto' });
    else {
      el.scrollLeft = (el.scrollLeft || 0) + dx;
      el.scrollTop = (el.scrollTop || 0) + dy;
    }
  }
  function requestRestore(){
    window.parent.postMessage({ type: 'pixo:preview-scroll-request' }, '*');
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || !data.type) return;
    if (data.type === 'pixo:preview-scroll-restore') {
      scrollTo(document.scrollingElement || document.documentElement, data.frameLeft, data.frameTop);
      scrollTo(scrollElement(), data.canvasLeft, data.canvasTop);
      setTimeout(post, 0);
      return;
    }
    if (data.type === 'pixo:preview-scroll-by') {
      scrollBy(scrollElement(), data.left, data.top);
      schedule();
      scheduleContentSize();
      return;
    }
    if (data.type === 'pixo:preview-content-size-request') {
      if (typeof data.measurementId !== 'string' || typeof data.generation !== 'string') return;
      lastContentSizeRequest = {
        measurementId: data.measurementId,
        generation: data.generation
      };
      scheduleContentSize();
    }
  });
  window.addEventListener('scroll', schedule, true);
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', function(){
    schedule();
    scheduleContentSize();
  });
  if (typeof ResizeObserver !== 'undefined') {
    try {
      var observer = new ResizeObserver(scheduleContentSize);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    } catch (_) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      requestRestore();
      schedule();
      scheduleContentSize();
    });
  } else {
    setTimeout(function(){
      requestRestore();
      schedule();
      scheduleContentSize();
    }, 0);
  }
  setTimeout(scheduleContentSize, 80);
  setTimeout(scheduleContentSize, 260);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleContentSize).catch(function(){});
  }
})();
</script>`;

function sameOrchestratorWorkspace(a: unknown, b: unknown): boolean {
  const parsedA = parseOrchestratorWorkspace(a);
  const parsedB = parseOrchestratorWorkspace(b);
  if (!parsedA.ok || !parsedB.ok) return false;
  return JSON.stringify(parsedA.value) === JSON.stringify(parsedB.value);
}

const URL_PREVIEW_SNAPSHOT_BRIDGE = `<script data-pixo-url-snapshot-bridge>
(function(){
  if (window.__pixoUrlSnapshotBridge) return;
  window.__pixoUrlSnapshotBridge = true;
  var SNAPSHOT_STYLE_PROPS = [
    'display','position','box-sizing','width','height','min-width','max-width','min-height','max-height',
    'margin','margin-top','margin-right','margin-bottom','margin-left',
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    'border','border-top','border-right','border-bottom','border-left','border-radius',
    'font','font-family','font-size','font-weight','font-style','line-height','letter-spacing',
    'color','background-color','opacity','transform','transform-origin','overflow','overflow-x','overflow-y',
    'white-space','text-align','vertical-align','object-fit','object-position',
    'flex','flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis',
    'grid','grid-template-columns','grid-template-rows','grid-column','grid-row',
    'gap','row-gap','column-gap','align-items','align-content','align-self',
    'justify-items','justify-content','justify-self','inset','top','right','bottom','left',
    'z-index','box-shadow','text-shadow'
  ];
  function copyComputedStyle(source, target){
    if (!source || !target || source.nodeType !== 1 || target.nodeType !== 1) return;
    var computed = window.getComputedStyle(source);
    var style = target.getAttribute('style') || '';
    for (var i = 0; i < SNAPSHOT_STYLE_PROPS.length; i++){
      var prop = SNAPSHOT_STYLE_PROPS[i];
      var value = computed.getPropertyValue(prop);
      if (value) style += prop + ':' + value + ';';
    }
    target.setAttribute('style', style);
  }
  function syncElementState(source, target){
    var tag = source.tagName ? source.tagName.toLowerCase() : '';
    if (tag === 'img' && source.currentSrc) target.setAttribute('src', source.currentSrc);
    if (tag === 'input' || tag === 'textarea') target.setAttribute('value', source.value || '');
    if (tag === 'canvas') {
      try {
        var img = document.createElement('img');
        img.setAttribute('src', source.toDataURL('image/png'));
        img.setAttribute('style', target.getAttribute('style') || '');
        target.parentNode && target.parentNode.replaceChild(img, target);
      } catch (_) {}
    }
  }
  function inlineSnapshotStyles(originalRoot, cloneRoot){
    copyComputedStyle(originalRoot, cloneRoot);
    syncElementState(originalRoot, cloneRoot);
    var originals = originalRoot.querySelectorAll('*');
    var clones = cloneRoot.querySelectorAll('*');
    var count = Math.min(originals.length, clones.length, 3500);
    for (var i = 0; i < count; i++){
      copyComputedStyle(originals[i], clones[i]);
      syncElementState(originals[i], clones[i]);
    }
  }
  // Must run AFTER pruneHiddenSnapshotNodes: prune pairs originalRoot/cloneRoot
  // querySelectorAll('*') lists by index, so removing clone nodes (scripts,
  // links) before it shifts every later clone under the wrong original and the
  // misdirected removals can delete the visible content (or the body itself),
  // yielding a uniform "empty-render" frame.
  function stripSnapshotResources(cloneRoot){
    var scripts = cloneRoot.querySelectorAll('script');
    for (var s = scripts.length - 1; s >= 0; s--) scripts[s].remove();
    var links = cloneRoot.querySelectorAll('link[rel~="stylesheet"], link[rel~="preload"], link[rel~="preconnect"]');
    for (var l = links.length - 1; l >= 0; l--) links[l].remove();
    var styles = cloneRoot.querySelectorAll('style');
    for (var st = 0; st < styles.length; st++) {
      styles[st].textContent = (styles[st].textContent || '')
        .replace(/@import[^;]+;/gi, '')
        .replace(/@font-face\\s*\\{[^}]*\\}/gi, '');
    }
    // HTML tolerates attribute names XML rejects (@click, :href, {shorthand}).
    // One such attribute anywhere makes the whole foreignObject SVG unparseable,
    // so drop any attribute whose name is not a valid XML Name.
    var XML_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;
    var all = cloneRoot.querySelectorAll('*');
    for (var e = 0; e < all.length; e++) {
      var attrs = all[e].attributes;
      for (var a = attrs.length - 1; a >= 0; a--) {
        if (!XML_NAME.test(attrs[a].name)) all[e].removeAttribute(attrs[a].name);
      }
    }
  }
  // innerHTML uses the HTML serializer, which emits void elements (<br>, <img>)
  // without self-closing slashes — invalid XML, so the foreignObject SVG image
  // fails to parse (img.onerror → 'snapshot image failed'). XMLSerializer emits
  // well-formed XHTML instead.
  function serializeSnapshotXhtml(node){
    try {
      var serializer = new XMLSerializer();
      var out = '';
      for (var i = 0; i < node.childNodes.length; i++) out += serializer.serializeToString(node.childNodes[i]);
      return out;
    } catch (_) { return node.innerHTML || ''; }
  }
  function pruneHiddenSnapshotNodes(originalRoot, cloneRoot){
    var originals = originalRoot.querySelectorAll('*');
    var clones = cloneRoot.querySelectorAll('*');
    var count = Math.min(originals.length, clones.length);
    var removals = [];
    for (var i = 0; i < count; i++){
      var original = originals[i];
      var clone = clones[i];
      if (!original || !clone || !clone.parentNode) continue;
      var computed = window.getComputedStyle(original);
      if (computed && (computed.display === 'none' || computed.visibility === 'hidden')) removals.push(clone);
    }
    for (var r = removals.length - 1; r >= 0; r--) {
      if (removals[r].parentNode) removals[r].parentNode.removeChild(removals[r]);
    }
  }
  function waitForImages(){
    var imgs = Array.prototype.slice.call(document.images || []);
    return Promise.all(imgs.map(function(img){
      if (img.complete) return Promise.resolve();
      return new Promise(function(resolve){
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
  }
  function scrollOffset(){
    var doc = document.documentElement;
    var body = document.body;
    return {
      x: Math.max(window.scrollX || 0, doc ? doc.scrollLeft || 0 : 0, body ? body.scrollLeft || 0 : 0),
      y: Math.max(window.scrollY || 0, doc ? doc.scrollTop || 0 : 0, body ? body.scrollTop || 0 : 0)
    };
  }
  function escapeAttribute(value){
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function snapshotBackgroundColor(){
    try {
      var probe = window.getComputedStyle(document.body || document.documentElement);
      var bg = probe && probe.backgroundColor || '';
      if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return '#ffffff';
      return bg;
    } catch (_) { return '#ffffff'; }
  }
  function canvasLooksBlank(ctx, cw, ch){
    try {
      var data = ctx.getImageData(0, 0, cw, ch).data;
      var step = Math.max(4, Math.floor((cw * ch) / 4096)) * 4;
      var first = null, samples = 0;
      for (var i = 0; i + 3 < data.length; i += step){
        samples++;
        if (!first){ first = [data[i], data[i+1], data[i+2], data[i+3]]; continue; }
        if (Math.abs(data[i]-first[0]) > 6 || Math.abs(data[i+1]-first[1]) > 6 ||
            Math.abs(data[i+2]-first[2]) > 6 || Math.abs(data[i+3]-first[3]) > 6) return false;
      }
      return samples > 8;
    } catch (_) { return false; }
  }
  function renderSnapshot(id){
    var w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    var h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    var dpr = window.devicePixelRatio || 1;
    var bgColor = snapshotBackgroundColor();
    var docW = Math.max(w, document.documentElement.scrollWidth || 0, document.body ? document.body.scrollWidth : 0);
    var docH = Math.max(h, document.documentElement.scrollHeight || 0, document.body ? document.body.scrollHeight : 0);
    var clone = document.documentElement.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    inlineSnapshotStyles(document.documentElement, clone);
    pruneHiddenSnapshotNodes(document.documentElement, clone);
    stripSnapshotResources(clone);
    var scroll = scrollOffset();
    var cloneBody = clone.querySelector('body');
    var rootStyle = clone.getAttribute('style') || '';
    var bodyStyle = cloneBody ? cloneBody.getAttribute('style') || '' : '';
    var bodyContent = serializeSnapshotXhtml(cloneBody || clone);
    var wrapperStyle = rootStyle + bodyStyle +
      'margin:0;position:relative;left:' + (-scroll.x) + 'px;top:' + (-scroll.y) + 'px;' +
      'width:' + docW + 'px;height:' + docH + 'px;overflow:visible;';
    var html = '<div xmlns="http://www.w3.org/1999/xhtml" style="' + escapeAttribute(wrapperStyle) + '">' + bodyContent + '</div>';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<foreignObject x="0" y="0" width="' + docW + '" height="' + docH + '">' + html + '</foreignObject></svg>';
    var img = new Image();
    img.onload = function(){
      try {
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(w * dpr));
        canvas.height = Math.max(1, Math.floor(h * dpr));
        var ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.scale(dpr, dpr);
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        if (canvasLooksBlank(ctx, canvas.width, canvas.height)) {
          window.parent.postMessage({ type: 'pixo:snapshot:result', id: id, error: 'empty-render' }, '*');
          return;
        }
        window.parent.postMessage({ type: 'pixo:snapshot:result', id: id, dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height }, '*');
      } catch (err) {
        window.parent.postMessage({ type: 'pixo:snapshot:result', id: id, error: String(err && err.message || err) }, '*');
      }
    };
    img.onerror = function(){
      window.parent.postMessage({ type: 'pixo:snapshot:result', id: id, error: 'snapshot image failed' }, '*');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'pixo:snapshot' || !data.id) return;
    waitForImages().then(function(){ renderSnapshot(String(data.id)); });
  });
})();
</script>`;

function previewBridgeTokens(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(previewBridgeTokens);
  if (typeof value !== 'string') return [];
  return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function wantsUrlPreviewScrollBridge(value: unknown): boolean {
  return previewBridgeTokens(value).some((token) => token === 'scroll' || token === '1' || token === 'true');
}

function wantsUrlPreviewSnapshotBridge(value: unknown): boolean {
  return previewBridgeTokens(value).some((token) => token === 'snapshot' || token === 'image' || token === 'capture');
}

function wantsUrlPreviewObservabilityBridge(value: unknown): boolean {
  return previewBridgeTokens(value).some((token) => token === 'observability' || token === 'errors' || token === 'diagnostics');
}

/** The build-focus bridge: lets the host park a cursor on the part of the page
 *  the agent is writing right now (see the contracts module for the protocol). */
function wantsUrlPreviewBuildFocusBridge(value: unknown): boolean {
  return previewBridgeTokens(value).some((token) => token === 'buildfocus' || token === 'build-focus');
}

function wantsUrlPreviewSandboxGuard(value: unknown): boolean {
  return previewBridgeTokens(value).some((token) => token === 'sandbox' || token === 'storage');
}

function wantsUrlPreviewFocusGuard(value: unknown): boolean {
  return previewBridgeTokens(value).some((token) => token === 'focus');
}

function wantsUrlPreviewRedirectGuard(value: unknown): boolean {
  return previewBridgeTokens(value).some((token) => token === 'redirect');
}

function injectBeforeBodyClose(html: string, marker: string, injection: string): string {
  if (html.includes(marker)) return html;
  const bodyCloseIndex = findRealTagOffset(html, /<\/body(?=[\t\n\f\r >])/i);
  if (bodyCloseIndex >= 0) {
    return `${html.slice(0, bodyCloseIndex)}${injection}${html.slice(bodyCloseIndex)}`;
  }
  // No boundary: appending is not a safe fallback, because the reason there is
  // no boundary is often that the document ends inside a construct that
  // swallows whatever follows — `<plaintext>` never leaves PLAINTEXT, an
  // unterminated comment or script runs to EOF. Appended markup would become
  // text there and the bridge would never run. Going in near the top instead
  // costs the "end of body" placement but keeps the bridge live.
  const headStart = findRealTagOffset(html, /<head(?=[\t\n\f\r />])/i);
  const headEnd = headStart >= 0 ? endOfTag(html, headStart) : -1;
  if (headEnd >= 0) return `${html.slice(0, headEnd + 1)}${injection}${html.slice(headEnd + 1)}`;
  const htmlStart = findRealTagOffset(html, /<html(?=[\t\n\f\r />])/i);
  const htmlEnd = htmlStart >= 0 ? endOfTag(html, htmlStart) : -1;
  if (htmlEnd >= 0) return `${html.slice(0, htmlEnd + 1)}<head>${injection}</head>${html.slice(htmlEnd + 1)}`;
  return prependAfterDoctype(html, injection);
}

function injectAfterHeadOpen(html: string, marker: string, injection: string): string {
  if (html.includes(marker)) return html;
  const headOpenIndex = findRealTagOffset(html, /<head(?=[\t\n\f\r />])/i);
  if (headOpenIndex >= 0) {
    const openTagEnd = endOfTag(html, headOpenIndex);
    if (openTagEnd >= 0) {
      return `${html.slice(0, openTagEnd + 1)}${injection}${html.slice(openTagEnd + 1)}`;
    }
  }
  const htmlOpenIndex = findRealTagOffset(html, /<html(?=[\t\n\f\r />])/i);
  if (htmlOpenIndex >= 0) {
    const openTagEnd = endOfTag(html, htmlOpenIndex);
    if (openTagEnd >= 0) {
      return `${html.slice(0, openTagEnd + 1)}<head>${injection}</head>${html.slice(openTagEnd + 1)}`;
    }
  }
  return prependAfterDoctype(html, injection);
}

function injectUrlPreviewBridge(
  html: string,
  bridge:
    | 'scroll'

    | 'snapshot'
    | 'observability'
    | 'buildfocus'
    | 'sandbox'
    | 'focus'
    | 'redirect',
): string {
  if (bridge === 'sandbox') {
    return injectAfterHeadOpen(html, 'data-pixo-sandbox-shim', buildPreviewSandboxShim());
  }
  if (bridge === 'focus') {
    return injectAfterHeadOpen(html, 'data-pixo-preview-focus-guard', buildPreviewFocusGuard());
  }
  if (bridge === 'redirect') {
    return injectAfterHeadOpen(
      html,
      'data-pixo-preview-redirect-guard',
      buildPreviewRedirectGuard({
        blockLoadTimeScriptRedirect: previewHtmlHasLoadTimeLocationNavigation(html),
      }),
    );
  }
  if (bridge === 'observability') {
    return injectAfterHeadOpen(
      html,
      PREVIEW_OBSERVABILITY_BRIDGE_MARKER,
      buildPreviewObservabilityBridge(),
    );
  }
  if (bridge === 'buildfocus') {
    // Before </body>, like the scroll bridge: it walks the rendered DOM, so it
    // must not run before the document it measures exists.
    return injectBeforeBodyClose(
      html,
      PREVIEW_BUILD_FOCUS_BRIDGE_MARKER,
      buildPreviewBuildFocusBridge(),
    );
  }
  if (bridge === 'scroll') {
    return injectBeforeBodyClose(html, 'data-pixo-url-scroll-bridge', URL_PREVIEW_SCROLL_BRIDGE);
  }
  return injectBeforeBodyClose(html, 'data-pixo-url-snapshot-bridge', URL_PREVIEW_SNAPSHOT_BRIDGE);
}

function applyUrlPreviewBridgesToHtml(
  transformed: string | Buffer,
  mime: string,
  requestedBridge: unknown,
  requestedMotionPreview?: unknown,
): string | Buffer {
  if (
    !/^text\/html(?:;|$)/i.test(mime) ||
    !(wantsUrlPreviewScrollBridge(requestedBridge) ||
      wantsUrlPreviewSnapshotBridge(requestedBridge) ||
      wantsUrlPreviewObservabilityBridge(requestedBridge) ||
      wantsUrlPreviewBuildFocusBridge(requestedBridge) ||
      wantsUrlPreviewSandboxGuard(requestedBridge) ||
      wantsUrlPreviewFocusGuard(requestedBridge) ||
      wantsUrlPreviewRedirectGuard(requestedBridge) ||
      requestedMotionPreview === '1')
  ) return transformed;
  let html = Buffer.isBuffer(transformed) ? transformed.toString('utf8') : transformed;
  html = injectAfterHeadOpen(html, 'data-pixo-preview-hidden-guard', buildPreviewVisibilityGuard());
  // Sanitize the <title> so Cmd+P -> "Save as PDF" produces a Teams-safe
  // filename. URL-load iframes cannot rely on the host rewriting the document
  // title after load, and powered previews are intentionally cross-origin.
  html = injectMotionSourcePlayer(daemonSanitizeTitleInDoc(html));
  // Guards must run before authored scripts. injectAfterHeadOpen prepends at
  // the start of <head>; apply in reverse runtime order so the final document
  // executes sandbox -> redirect -> observability -> focus.
  if (wantsUrlPreviewFocusGuard(requestedBridge)) {
    html = injectUrlPreviewBridge(html, 'focus');
  }
  if (wantsUrlPreviewObservabilityBridge(requestedBridge)) {
    html = injectUrlPreviewBridge(html, 'observability');
  }
  if (wantsUrlPreviewRedirectGuard(requestedBridge)) {
    html = injectUrlPreviewBridge(html, 'redirect');
  }
  if (wantsUrlPreviewSandboxGuard(requestedBridge)) {
    html = injectUrlPreviewBridge(html, 'sandbox');
  }
  if (wantsUrlPreviewBuildFocusBridge(requestedBridge)) {
    // Only marked video motion waits for the building preview host. Legacy
    // HyperFrames and ordinary documents retain their authored playback.
    html = markMotionHostedPreview(html);
    html = injectUrlPreviewBridge(html, 'buildfocus');
  }
  if (wantsUrlPreviewScrollBridge(requestedBridge)) {
    html = injectUrlPreviewBridge(html, 'scroll');
  }
  if (wantsUrlPreviewSnapshotBridge(requestedBridge)) {
    html = injectUrlPreviewBridge(html, 'snapshot');
  }
  return html;
}

// ---------------------------------------------------------------------------
// Teams-safe title sanitization for the URL-load preview path (issue #3918).
//
// When a user prints an HTML preview via Cmd+P → "Save as PDF", Chromium uses
// the iframe's document <title> as the default filename. The URL-load iframe
// uses sandbox="allow-scripts allow-downloads" (no allow-same-origin), so the
// host page cannot access contentDocument to rewrite the title after load.
// Instead we rewrite it here, in the daemon response, before the browser
// parses the document. The web srcDoc path has its own sanitizeTitleInDoc in
// apps/web/src/runtime/srcdoc.ts — keep the two in sync when the logic changes.
// ---------------------------------------------------------------------------

/** Named non-ASCII entities common in business/design document titles. */
const DAEMON_NAMED_ENTITY_MAP: Record<string, string> = {
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å',
  aelig: 'æ', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  eth: 'ð', ntilde: 'ñ',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', thorn: 'þ', yuml: 'ÿ',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å',
  AElig: 'Æ', Ccedil: 'Ç',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë',
  Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  ETH: 'Ð', Ntilde: 'Ñ',
  Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø',
  Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
  Yacute: 'Ý', THORN: 'Þ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', hellip: '…', trade: '™', reg: '®',
  copy: '©', deg: '°', euro: '€', pound: '£', yen: '¥',
};

function daemonSafeFromCodePoint(cp: number): string {
  if (cp < 0 || cp > 0x10ffff) return '�';
  return String.fromCodePoint(cp);
}

function daemonDecodeHtmlEntitiesForTitle(encoded: string): string {
  return encoded
    .replace(/&([A-Za-z]+);/g, (match: string, name: string) => DAEMON_NAMED_ENTITY_MAP[name] ?? match)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_: string, n: string) => daemonSafeFromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_: string, h: string) => daemonSafeFromCodePoint(parseInt(h, 16)));
}

function daemonSanitizePreviewTitle(text: string): string {
  // Trim first so that leading whitespace cannot hide a ~$ prefix from the
  // anchor-based check below (e.g. "  ~$Invoice" would otherwise survive).
  let result = text.trim();
  // Remove every leading ~$ prefix. A single replace(/^~\$/, '') is not
  // enough when the prefix is doubled ("~$~$Doc"). Loop until stable, then
  // re-trim in case a space followed the prefix ("~$ Invoice" → " Invoice").
  let prev: string;
  do {
    prev = result;
    result = result.replace(/^~\$/, '').trim();
  } while (result !== prev);
  // Replace each disallowed character (or run of them) with a single hyphen.
  // Character class: : # % & * { } \ < > ? / + | "
  // eslint-disable-next-line no-useless-escape
  result = result.replace(/[:#%&*{}\\<>?/+|"]+/g, '-');
  // Final trim to remove any spaces exposed by the substitution.
  return result.trim();
}

/**
 * Rewrite the `<title>` in html so the resulting PDF filename is Teams-safe.
 * Only the real `<head>` title is changed; `<title>` inside comments or script
 * blocks is left untouched. Mirrors sanitizeTitleInDoc in srcdoc.ts.
 *
 * Exported for unit testing; not part of the public API surface.
 */
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

export function daemonSanitizeTitleInDoc(html: string): string {
  // Only the head's own <title> names the document; an <svg><title> in the body
  // is an accessible label for that graphic. Both boundaries are located
  // structurally, so a `</head>` or `<body>` an author wrote into a script
  // string cannot move the limit.
  const headClose = findRealTagOffset(html, HTML_TAG_PATTERNS.headClose);
  const bodyOpen = findRealTagOffset(html, HTML_TAG_PATTERNS.bodyOpen);
  const searchLimit = headClose >= 0 ? headClose : bodyOpen >= 0 ? bodyOpen : html.length;

  // Both ends of the element by the parser's rules: the open tag through
  // `endOfTag`, so a `>` inside a quoted attribute cannot cut it short, and the
  // close by the raw-text rule, so `</title >` closes it while `</title-page>`
  // does not. A plain `indexOf('</title>')` accepted only one spelling.
  const range = findRealElementRange(html, HTML_TAG_PATTERNS.titleOpen, 'title');
  if (!range || range.start >= searchLimit) return html;

  const titleStart = range.start;
  const closingTagEnd = range.end - 1;
  const openTag = html.slice(range.start, range.contentStart);
  const rawContent = html.slice(range.contentStart, range.contentEnd);
  const closeTag = html.slice(range.contentEnd, range.end);

  const decoded = daemonDecodeHtmlEntitiesForTitle(rawContent);
  const safe = daemonSanitizePreviewTitle(decoded);

  return html.slice(0, titleStart) + openTag + safe + closeTag + html.slice(closingTagEnd + 1);
}

function normalizeChatSessionMode(value: unknown): ChatSessionMode {
  return value === 'chat' || value === 'plan' ? value : 'design';
}

function normalizeProjectDuplicateName(value: unknown, sourceProject: any): string {
  const explicit = typeof value === 'string' ? value.trim() : '';
  if (explicit) return explicit.slice(0, 160);
  const sourceName = typeof sourceProject?.name === 'string' && sourceProject.name.trim()
    ? sourceProject.name.trim()
    : 'Untitled';
  return `${sourceName} Copy`.slice(0, 160);
}

function cloneProjectMetadataForDuplicate(sourceProject: any): Record<string, unknown> {
  const sourceMetadata =
    sourceProject?.metadata && typeof sourceProject.metadata === 'object'
      ? { ...sourceProject.metadata }
      : {};
  delete sourceMetadata._commentFiles;
  delete sourceMetadata.baseDir;
  delete sourceMetadata.engineProfile;
  delete sourceMetadata.gameRunSucceededAt;
  // A copy must not overwrite the original's public link.
  delete sourceMetadata.publishShareId;
  delete sourceMetadata.starterChecklistDismissed;
  delete sourceMetadata.projectLocationId;
  delete sourceMetadata.fromTrustedPicker;
  delete sourceMetadata.orchestratorWorkspace;
  return {
    ...sourceMetadata,
    sourceProjectId: sourceProject.id,
    sourceProjectName: sourceProject.name,
  };
}

export function registerProjectRoutes(app: Express, ctx: RegisterProjectRoutesDeps) {
  const { db, design } = ctx;
  const projectCreatePreparationTimeoutMs =
    typeof ctx.projectCreatePreparationTimeoutMs === 'number'
    && Number.isFinite(ctx.projectCreatePreparationTimeoutMs)
    && ctx.projectCreatePreparationTimeoutMs > 0
      ? ctx.projectCreatePreparationTimeoutMs
      : DEFAULT_PROJECT_CREATE_PREPARATION_TIMEOUT_MS;
  const { sendApiError, createSseResponse } = ctx.http;
  const { PROJECTS_DIR, SKILLS_DIR, } = ctx.paths;
  const { readAppConfig, writeAppConfig } = ctx.appConfig;
  const {
    insertProject,
    validateLinkedDirs,
    getProject,
    updateProject,
    dbDeleteProject,
    removeProjectDir,
    stageProjectDirsForDelete,
  } = ctx.projectStore;
  const { writeProjectFile, readProjectFile, ensureProject, listFiles, listTabs, setTabs, resolveProjectDir } = ctx.projectFiles;
  const { insertConversation } = ctx.conversations;
  const { getTemplate, listTemplates, deleteTemplate, insertTemplate, findTemplateByNameAndProject, updateTemplate } = ctx.templates;
  const { listLatestProjectRunStatuses, listProjectsAwaitingInput, normalizeProjectDisplayStatus, composeProjectDisplayStatus, listProjects, listUnboundProjects } = ctx.status;
  const { subscribeFileEvents, activeProjectEventSinks } = ctx.events;
  const projectEventStreamClosers = new Map<string, Set<() => Promise<void>>>();
  const projectDeletions = new Map<string, Promise<void>>();
  // What the daemon itself keeps open in a project: watchers on every subfolder
  // and running processes. Windows will not detach the folder until they let go.
  const releaseProjectHolds = async (projectId: string) => {
    await ctx.projectHolds?.release(projectId).catch((error: unknown) => {
      console.warn('Failed to release project folder', projectId, error);
    });
    await Promise.all([...(projectEventStreamClosers.get(projectId) ?? [])].map((close) => close()));
  };
  const { randomId } = ctx.ids;
  const { validateProjectSkillId } = ctx.validation;
  const authorizeProjectRequest =
    ctx.authorizeProjectRequest ??
    createAuthorizeProjectRequest({ db, PROJECTS_DIR, getProject, sendApiError });
  async function loadPluginRegistryView() {
    if (ctx.pluginScope) return ctx.pluginScope.loadRegistry({});
    const [skills] = await Promise.all([
      listSkills(
        SKILLS_DIR,
      ),
    ]);
    return {
      skills: skills.map((s) => ({ id: s.id, title: s.name, description: s.description })),
      atoms: FIRST_PARTY_ATOMS.map((a) => ({ id: a.id, label: a.label })),
      scenarios: collectBundledScenarios(),
    };
  }

  function collectBundledScenarios() {
    type ScenarioEntry = {
      id: string;
      taskKind: 'new-generation' | 'figma-migration' | 'code-migration' | 'tune-collab';
      pipeline: NonNullable<NonNullable<PluginManifest['pixo']>['pipeline']>;
    };
    const byTaskKind = new Map<ScenarioEntry['taskKind'], ScenarioEntry>();
    try {
      const all = listInstalledPlugins(db);
      for (const row of all) {
        if (row.sourceKind !== 'bundled') continue;
        const pixo = row.manifest.pixo;
        if (!pixo || pixo.kind !== 'scenario') continue;
        if (!pixo.pipeline || !Array.isArray(pixo.pipeline.stages) || pixo.pipeline.stages.length === 0) continue;
        const taskKind = (pixo.taskKind ?? 'new-generation') as ScenarioEntry['taskKind'];
        if (
          taskKind !== 'new-generation' &&
          taskKind !== 'figma-migration' &&
          taskKind !== 'code-migration' &&
          taskKind !== 'tune-collab'
        ) {
          continue;
        }
        const entry: ScenarioEntry = { id: row.id, taskKind, pipeline: pixo.pipeline };
        const existing = byTaskKind.get(taskKind);
        if (!existing || entry.id === `pixo-${taskKind}`) {
          byTaskKind.set(taskKind, entry);
        }
      }
    } catch {
      return [];
    }
    return Array.from(byTaskKind.values());
  }

  async function configuredProjectLocations() {
    const config = await readAppConfig(ctx.paths.RUNTIME_DATA_DIR);
    const all = allProjectLocations(PROJECTS_DIR, config.projectLocations);
    const valid = all[0] ? [all[0]] : [];
    for (const location of all.slice(1)) {
      const validated = validateLinkedDirs([location.path]);
      if (validated.error) continue;
      const canonical = validated.dirs[0];
      if (!canonical) continue;
      if (locationOverlapsDaemonData(canonical)) continue;
      valid.push({ ...location, path: canonical });
    }
    return valid;
  }

  function locationOverlapsDaemonData(locationPath: string): boolean {
    const runtimeDir = ctx.paths.RUNTIME_DATA_DIR_CANONICAL || ctx.paths.RUNTIME_DATA_DIR;
    const projectsDir = path.join(runtimeDir, 'projects');
    const relativeToRuntime = pathRelative(runtimeDir, locationPath);
    const runtimeInsideLocation = pathRelative(locationPath, runtimeDir);
    const relativeToProjects = pathRelative(projectsDir, locationPath);
    const projectsInsideLocation = pathRelative(locationPath, projectsDir);
    return isInsideOrSame(relativeToRuntime) || isInsideOrSame(runtimeInsideLocation)
      || isInsideOrSame(relativeToProjects) || isInsideOrSame(projectsInsideLocation);
  }

  function pathRelative(from: string, to: string): string {
    return path.relative(from, to);
  }

  function isInsideOrSame(relative: string): boolean {
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  function projectBelongsToLocation(project: any, location: { id: string; path: string }): boolean {
    const metadata = project?.metadata;
    if (typeof metadata?.baseDir !== 'string') return metadata?.projectLocationId === location.id;
    const relative = path.relative(location.path, metadata.baseDir);
    return isInsideOrSame(relative) && relative !== '';
  }

  function isProjectLocationProject(project: any): boolean {
    const metadata = project?.metadata;
    return metadata?.importedFrom === 'project-location'
      || typeof metadata?.projectLocationId === 'string';
  }

  function projectVisibleForLocations(
    project: any,
    locations: Array<{ id: string; path: string; builtIn?: boolean }>,
  ): boolean {
    if (!isProjectLocationProject(project)) return true;
    return locations.some((location) => !location.builtIn && projectBelongsToLocation(project, location));
  }

  async function resolveCreateProjectLocationId(explicitProjectLocationId: unknown): Promise<string> {
    if (typeof explicitProjectLocationId === 'string' && explicitProjectLocationId.trim()) {
      return explicitProjectLocationId.trim();
    }
    const config = await readAppConfig(ctx.paths.RUNTIME_DATA_DIR);
    const configuredDefault = typeof config.defaultProjectLocationId === 'string'
      ? config.defaultProjectLocationId.trim()
      : '';
    if (!configuredDefault || configuredDefault === BUILT_IN_PROJECT_LOCATION_ID) {
      return BUILT_IN_PROJECT_LOCATION_ID;
    }
    const locations = await configuredProjectLocations();
    return locations.some((location) => !location.builtIn && location.id === configuredDefault)
      ? configuredDefault
      : BUILT_IN_PROJECT_LOCATION_ID;
  }

  function unregisterProjectsForRemovedLocations(
    previousLocations: Array<{ id: string; path: string; builtIn?: boolean }>,
    nextLocations: Array<{ id?: string; path: string }>,
  ): string[] {
    const nextIds = new Set(nextLocations.map((location) => location.id).filter(Boolean));
    const nextPaths = new Set(nextLocations.map((location) => location.path));
    const removed = previousLocations.filter(
      (location) => !location.builtIn && !nextIds.has(location.id) && !nextPaths.has(location.path),
    );
    if (removed.length === 0) return [];
    return listProjects(db)
      .filter((project: any) => removed.some((location) => projectBelongsToLocation(project, location)))
      .map((project: any) => project.id);
  }

  app.get('/api/project-locations', async (_req, res) => {
    try {
      const locations = await configuredProjectLocations();
      /** @type {import('@openpixo/contracts').ProjectLocationsResponse} */
      const body = { locations };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  app.put('/api/project-locations', async (req, res) => {
    try {
      const requested = Array.isArray(req.body?.locations) ? req.body.locations : null;
      if (!requested) return sendApiError(res, 400, 'BAD_REQUEST', 'locations must be an array');
      const previousLocations = await configuredProjectLocations();
      const prepared = [];
      for (const loc of requested) {
        if (!loc || typeof loc !== 'object' || typeof loc.path !== 'string') continue;
        const canonicalPath = await ensureProjectLocation(loc.path);
        const validated = validateLinkedDirs([canonicalPath]);
        if (validated.error) return sendApiError(res, 400, 'BAD_REQUEST', validated.error);
        if (locationOverlapsDaemonData(canonicalPath)) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'project location cannot overlap daemon data');
        }
        prepared.push({
          id: typeof loc.id === 'string' ? loc.id : undefined,
          name: typeof loc.name === 'string' ? loc.name : undefined,
          path: canonicalPath,
        });
      }
      const config = await writeAppConfig(ctx.paths.RUNTIME_DATA_DIR, { projectLocations: prepared });
      const locations = allProjectLocations(PROJECTS_DIR, config.projectLocations);
      const removedProjectIds = unregisterProjectsForRemovedLocations(previousLocations, config.projectLocations ?? []);
      /** @type {import('@openpixo/contracts').ProjectLocationsResponse} */
      const body = { locations, removedProjectIds };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.post('/api/project-locations/scan', async (req, res) => {
    try {
      // Resolve once before scanning or inserting anything. An explicitly
      // scoped request whose membership is removed/unavailable must not leave
      // partially imported unbound projects behind.
            const locations = (await configuredProjectLocations()).filter((loc: any) => !loc.builtIn);
      const imported = [];
      const existing: string[] = [];
      const skipped: Array<{ path: string; reason: string }> = [];
      let scanned = 0;
      const now = Date.now();
      for (const location of locations) {
        let found;
        try {
          found = await scanProjectLocation(location);
        } catch (err: any) {
          skipped.push({ path: location.path, reason: String(err?.message ?? err) });
          continue;
        }
        scanned += found.length;
        for (const entry of found) {
          const { manifest } = entry;
          if (getProject(db, manifest.id)) {
            existing.push(manifest.id);
            continue;
          }
          try {
            const project = insertProject(db, {
              id: manifest.id,
              name: manifest.name,
              skillId: manifest.skillId ?? null,
              pendingPrompt: null,
              metadata: {
                kind: 'prototype',
                baseDir: entry.dir,
                importedFrom: 'project-location',
                projectLocationId: location.id,
              },
              customInstructions: null,
              createdAt: manifest.createdAt,
              updatedAt: manifest.updatedAt,
            });
            insertConversation(db, {
              id: randomId(),
              projectId: manifest.id,
              title: null,
              createdAt: now,
              updatedAt: now,
            });
            if (project) imported.push(project);
          } catch (err: any) {
            skipped.push({ path: entry.dir, reason: String(err?.message ?? err) });
          }
        }
      }
      /** @type {import('@openpixo/contracts').ScanProjectLocationsResponse} */
      const body = { scanned, imported, existing, skipped };
      res.json(body);
    } catch (err: any) {

      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects', async (_req, res) => {
    try {
      const locations = await configuredProjectLocations();
      const latestRunStatuses = listLatestProjectRunStatuses(db);
      const awaitingInputProjects = listProjectsAwaitingInput(db);
      const activeRunStatuses = new Map();
      for (const run of design.runs.list()) {
        if (!run.projectId) continue;
        const runStatus = projectStatusFromRun(run);
        if (design.runs.isTerminal(run.status)) {
          const existing = latestRunStatuses.get(run.projectId);
          if (!existing || run.updatedAt > (existing.updatedAt ?? 0)) {
            latestRunStatuses.set(run.projectId, runStatus);
          }
        } else {
          const existing = activeRunStatuses.get(run.projectId);
          if (!existing || run.updatedAt > (existing.updatedAt ?? 0)) {
            activeRunStatuses.set(run.projectId, runStatus);
          }
        }
      }

      /** @type {import('@openpixo/contracts').ProjectsResponse} */
      const body = {
        projects: listProjects(db)
          .filter((project: any) => projectVisibleForLocations(project, locations))
          .map((project: any) => ({
            ...project,

            status: composeProjectDisplayStatus(
                activeRunStatuses.get(project.id) ??
                  latestRunStatuses.get(project.id) ?? { value: 'not_started' },
                awaitingInputProjects,
                project.id,
              ),
          })),
      };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });


  function projectStatusFromRun(run: any) {
    const normalized = normalizeProjectDisplayStatus(run.status);
    // A just-finished in-memory run overrides the DB-derived status for its
    // project (it is newer), so it must carry the same incomplete signal the
    // persisted projection derives — otherwise the pill flashes "Completed" for
    // the ~30 min the run stays in memory before the DB-derived `incomplete`
    // takes over (#1247 / #1060). run.endedWithUnfinishedWork is set at finish().
    const value =
      normalized === 'succeeded' && run.endedWithUnfinishedWork ? 'incomplete' : normalized;
    return {
      value,
      updatedAt: run.updatedAt,
      runId: run.id,
    };
  }

  app.post('/api/projects', async (req, res) => {
    try {
      // One request-wide deadline covers every asynchronous read before the
      // transaction. Resetting a full timeout for each stage would still let a
      // sequence of merely slow reads outlive the Web's optimistic route.
      const projectCreatePreparationDeadline =
        Date.now() + projectCreatePreparationTimeoutMs;
      // Ordinary project creation is local. Capture any complete identity that
      // the Web already has for local attribution, but do not turn Workspace
      // directory availability into a Send dependency. Remote share/sync/move
      // routes retain their authoritative checks.

      const { id, name, projectLocationId, skillId, pendingPrompt, metadata, customInstructions, skipDiscoveryBrief } =
        req.body || {};
      if (typeof id !== 'string' || !isSafeId(id)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'invalid project id');
      }
      const requestedConversationId = req.body?.conversationId;
      if (
        requestedConversationId !== undefined
        && (typeof requestedConversationId !== 'string' || !isSafeId(requestedConversationId))
      ) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'invalid conversation id');
      }
      if (typeof name !== 'string' || !name.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'name required');
      }
      // baseDir is privileged: it lets a project root directly inside the
      // user's filesystem. The /api/import/folder endpoint is the only
      // path that's allowed to set it, because that's where realpath() +
      // RUNTIME_DATA_DIR reentry checks live. Block client-supplied
      // metadata.baseDir on this generic create endpoint so an attacker
      // can't smuggle e.g. /etc through here. Same rule for
      // originalBaseDir / importedFrom='folder' — only the import path
      // owns those state fields.
      if (metadata && typeof metadata === 'object') {
        if ('_commentFiles' in metadata) return sendApiError(res, 400, 'BAD_REQUEST', '_commentFiles is daemon-owned');
        if ('engineProfile' in metadata) return sendApiError(res, 400, 'BAD_REQUEST', 'engineProfile is daemon-owned');
        if ('artStyleId' in metadata) return sendApiError(res, 400, 'BAD_REQUEST', 'artStyleId must be changed through the art-style endpoint');
        if ('styleReference' in metadata) return sendApiError(res, 400, 'BAD_REQUEST', 'styleReference must be changed through the style-reference endpoint');
        if ('gameRunSucceededAt' in metadata) return sendApiError(res, 400, 'BAD_REQUEST', 'gameRunSucceededAt is daemon-owned');
        if ('gamePlan' in metadata) return sendApiError(res, 400, 'BAD_REQUEST', 'gamePlan is daemon-owned');
        if ('publishShareId' in metadata) return sendApiError(res, 400, 'BAD_REQUEST', 'publishShareId is daemon-owned');
        if ('baseDir' in metadata) {
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'baseDir can only be set via POST /api/import/folder',
          );
        }
        if ('fromTrustedPicker' in metadata) {
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'fromTrustedPicker can only be set via POST /api/import/folder',
          );
        }
        if ('orchestratorWorkspace' in metadata) {
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'orchestratorWorkspace can only be set via POST /api/import/folder or POST /api/projects/:id/working-dir',
          );
        }
        // Reject invalid linked working directories up front (consistent with
        // PATCH /api/projects/:id) instead of silently dropping them. The
        // caller promises the agent `--add-dir` access to this folder; if the
        // path is deleted/inaccessible/a system dir, fail loudly so the client
        // can surface it rather than creating a project + auto-running a turn
        // whose linked-dir access never materialises.
        if (Array.isArray(metadata.linkedDirs)) {
          const validated = validateLinkedDirs(metadata.linkedDirs);
          if (validated.error) {
            return sendApiError(res, 400, 'INVALID_LINKED_DIR', validated.error);
          }
        }
      }
      if (customInstructions !== undefined
          && typeof customInstructions !== 'string'
          && customInstructions !== null) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'customInstructions must be a string or null');
      }
      if (typeof customInstructions === 'string' && customInstructions.length > 5000) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'customInstructions exceeds 5 000 character limit');
      }
      if (skipDiscoveryBrief !== undefined && typeof skipDiscoveryBrief !== 'boolean') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'skipDiscoveryBrief must be a boolean');
      }
      const skillValidation = await awaitProjectCreatePreparation<
        Awaited<ReturnType<typeof validateProjectSkillId>>
      >(
        validateProjectSkillId(skillId),
        projectCreatePreparationDeadline,
        'validating the selected skill',
      );
      if (!skillValidation.ok) {
        return sendApiError(res, 400, skillValidation.code, skillValidation.message);
      }
      const normalizedSkillId = skillValidation.id;
      const requestedPluginId =
        typeof req.body?.pluginId === 'string' && req.body.pluginId.trim().length > 0
          ? req.body.pluginId.trim()
          : null;
      const requestedPluginSource =
        typeof req.body?.pluginSource === 'string' && req.body.pluginSource.trim().length > 0
          ? req.body.pluginSource.trim()
          : null;
      // Local identity resolution only. Do not compare this historical source
      // with the project's current Workspace or perform a membership request:
      // Home already reconciles staged selections against its current local
      // catalogue, and this project is local until a later share/sync/move.
      const selectedLocalPlugin = requestedPluginId && requestedPluginSource
        ? await awaitProjectCreatePreparation(
            ctx.pluginScope?.getLocalPluginBySource?.(
              requestedPluginId,
              requestedPluginSource,
            ) ?? Promise.resolve(null),
            projectCreatePreparationDeadline,
            'resolving the selected plugin',
          )
        : null;
      if (requestedPluginId) {
        // Once a source is supplied, never substitute a same-id Personal or
        // other catalogue record. A missing local source is a missing plugin,
        // not a Workspace authorization verdict.
        const visiblePlugin = requestedPluginSource
          ? selectedLocalPlugin
          : ctx.pluginScope
            ? await awaitProjectCreatePreparation(
                ctx.pluginScope.getPlugin(requestedPluginId, {}),
                projectCreatePreparationDeadline,
                'resolving the selected plugin',
              )
            : getInstalledPlugin(db, requestedPluginId);
        if (!visiblePlugin) {
          return sendApiError(res, 404, 'PLUGIN_NOT_FOUND', 'plugin not found');
        }
      }
      const selectedLocationId = await awaitProjectCreatePreparation(
        resolveCreateProjectLocationId(projectLocationId),
        projectCreatePreparationDeadline,
        'resolving the project location',
      );
      let externalProjectDir: string | null = null;
      if (selectedLocationId !== BUILT_IN_PROJECT_LOCATION_ID) {
        const locations = await awaitProjectCreatePreparation(
          configuredProjectLocations(),
          projectCreatePreparationDeadline,
          'reading project locations',
        );
        const location = locations.find((loc: any) => loc.id === selectedLocationId);
        if (!location || location.builtIn) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'unknown project location');
        }
        if (getProject(db, id)) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'project id already exists');
        }
        externalProjectDir = await createLocationProjectDir(location, id);
      }
      // Website Clone projects that already carry the target URL explicitly
      // skip the project-opening discovery brief: the URL *is* the brief —
      // the user asked for a reproduction, not a requirements interview, and
      // an unanswered question form just stalls the run (the agent then
      // "answers" it with conservative defaults). An explicit client-provided
      // skipDiscoveryBrief still wins in both directions.
      const webCloneUrlSkipsDiscovery =
        skipDiscoveryBrief === undefined
        && metadata && typeof metadata === 'object'
        && (metadata as { intent?: unknown }).intent === 'web-clone'
        && typeof pendingPrompt === 'string'
        && /https?:\/\/\S+/i.test(pendingPrompt);
      // This metadata is daemon-owned. A caller may supply provenance through
      // the typed top-level fields, but cannot smuggle a different partition
      // inside the otherwise extensible project metadata object.
      const clientMetadata = metadata && typeof metadata === 'object'
        ? Object.fromEntries(
            Object.entries(metadata).filter(([key]) => (
              key !== 'scenarioBinding'
              && key !== 'exampleBinding'
            )),
          )
        : null;
      const baseProjectMetadata =
        clientMetadata
          ? {
              ...clientMetadata,
              ...(skipDiscoveryBrief === true || webCloneUrlSkipsDiscovery
                ? { skipDiscoveryBrief: true }
                : {}),
              ...(externalProjectDir
                ? {
                    baseDir: externalProjectDir,
                    importedFrom: 'project-location',
                    projectLocationId: selectedLocationId,
                  }
                : {}),
              ...(Array.isArray(clientMetadata.linkedDirs)
                ? (() => {
                    const v = validateLinkedDirs(clientMetadata.linkedDirs);
                    return v.error ? {} : { linkedDirs: v.dirs };
                  })()
                : {}),
            }
          : skipDiscoveryBrief === true
            ? {
                skipDiscoveryBrief: true,
                ...(externalProjectDir
                  ? {
                      baseDir: externalProjectDir,
                      importedFrom: 'project-location',
                      projectLocationId: selectedLocationId,
                    }
                  : {}),
              }
            : externalProjectDir
              ? {
                  kind: 'prototype',
                  baseDir: externalProjectDir,
                  importedFrom: 'project-location',
                  projectLocationId: selectedLocationId,
                }
              : null;
      const now = Date.now();
      const cid = requestedConversationId ?? randomId();
      const initialSessionMode = normalizeChatSessionMode(
        req.body?.conversationMode ?? req.body?.sessionMode,
      );
      const explicitPlugin =
        typeof req.body?.pluginId === 'string' && req.body.pluginId.trim().length > 0
          ? true
          : typeof req.body?.appliedPluginSnapshotId === 'string'
            && req.body.appliedPluginSnapshotId.trim().length > 0;
      // An official example card picked under a task type. It is a reference,
      // not a strategy: the project keeps its automatic retired Next-strategy route and the
      // example's SKILL.md travels as a user-selected Skill at run start. It
      // therefore deliberately does NOT participate in `explicitPlugin` — the
      // whole point is to stop pinning an executable plugin.
      //
      // Fail-closed like `automaticStrategyTaskProfile` above: a present but
      // unusable reference is a 400, never a silent drop, because a dropped
      // reference produces a run that looks correct and quietly lost the
      // example the user picked.
      const rawExampleReference = req.body?.exampleReference;
      let exampleBinding: ProjectMetadata['exampleBinding'] | null = null;
      if (rawExampleReference !== undefined) {
        const exampleReference =
          rawExampleReference && typeof rawExampleReference === 'object'
          && !Array.isArray(rawExampleReference)
            ? rawExampleReference as Record<string, unknown>
            : null;
        const examplePluginId = typeof exampleReference?.pluginId === 'string'
          ? exampleReference.pluginId.trim()
          : '';
        const exampleSource = typeof exampleReference?.source === 'string'
          ? exampleReference.source.trim()
          : '';
        if (!examplePluginId || !exampleSource) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'exampleReference is invalid');
        }
        // Contradictory claims. `pluginId`/`appliedPluginSnapshotId` say "run
        // this plugin as the strategy"; `exampleReference` says "keep the
        // automatic route and carry this example as reference material". A
        // request asserting both has no single correct reading, and guessing
        // one would silently decide the route for the user.
        if (explicitPlugin) {
          return sendApiError(
            res,
            400,
            'BAD_REQUEST',
            'exampleReference cannot be combined with pluginId or appliedPluginSnapshotId',
          );
        }
        // Re-resolve server-side through the same local lookup
        // `/api/plugins/:id/apply-local` uses, then read the example's bytes
        // from the record's own path. The request body contributes an identity
        // claim only; it never contributes content.
        const resolvedExample = await awaitProjectCreatePreparation(
          ctx.pluginScope?.getLocalPluginBySource?.(
            examplePluginId,
            exampleSource,
          ) ?? Promise.resolve(null),
          projectCreatePreparationDeadline,
          'resolving the selected example',
        );
        const resolvedExampleRecord = resolvedExample as
          { id?: unknown; source?: unknown; fsPath?: unknown } | null;
        if (
          !resolvedExampleRecord
          || resolvedExampleRecord.id !== examplePluginId
          || resolvedExampleRecord.source !== exampleSource
          || typeof resolvedExampleRecord.fsPath !== 'string'
          || !resolvedExampleRecord.fsPath
        ) {
          return sendApiError(res, 404, 'PLUGIN_NOT_FOUND', 'example plugin not found');
        }
        try {
          exampleBinding = createProjectExampleBinding({
            pluginId: examplePluginId,
            pluginSource: exampleSource,
            manifestSourceDigest: await awaitProjectCreatePreparation(
              digestExampleSkillManifest(resolvedExampleRecord.fsPath),
              projectCreatePreparationDeadline,
              'reading the selected example',
            ),
            boundAt: now,
          });
        } catch (error) {
          if (error instanceof InvalidProjectExampleBindingError) {
            return sendApiError(res, 400, 'BAD_REQUEST', error.message);
          }
          throw error;
        }
      }
      // Every new game is planned in chat first. A caller that opted out, a
      // chosen plugin or example, and anything that cannot be a game have no plan.
      const needsGamePlan = gamePlanAppliesToKind(baseProjectMetadata?.kind)
        && skipDiscoveryBrief !== true
        && !webCloneUrlSkipsDiscovery
        && !explicitPlugin
        && !exampleBinding;
      const projectMetadata = exampleBinding || needsGamePlan
        ? {
            ...(baseProjectMetadata ?? {}),
            ...(exampleBinding ? { exampleBinding } : {}),
            ...(needsGamePlan ? { gamePlan: newGamePlan(now) } : {}),
          }
        : baseProjectMetadata;
      const defaultScenarioPluginId = defaultScenarioPluginIdForProjectMetadata(
        projectMetadata && typeof projectMetadata.kind === 'string'
          ? projectMetadata as Parameters<
              typeof defaultScenarioPluginIdForProjectMetadata
            >[0]
          : null,
      );
      const automaticDefaultRouting = initialSessionMode === 'design'
        && Boolean(defaultScenarioPluginId)
        && !explicitPlugin;
      let resolveBody =
        explicitPlugin ? (req.body as Record<string, unknown>) : null;
      if (!resolveBody && initialSessionMode === 'design') {
        if (defaultScenarioPluginId && getInstalledPlugin(db, defaultScenarioPluginId)) {
          resolveBody = { ...(req.body || {}), pluginId: defaultScenarioPluginId };
        }
      }
      let project;
      let managedTemplateDirPrepared = false;
      const pluginResolutionState: {
        snapshot: ResolveSnapshotOk | null;
        failure: ResolveSnapshotError | null;
      } = { snapshot: null, failure: null };
      try {
        if (externalProjectDir) {
          await writeProjectManifest(externalProjectDir, {
            schemaVersion: 1,
            id,
            name: name.trim(),
            createdAt: now,
            updatedAt: now,
            skillId: normalizedSkillId,
          });
        }
        const registry = resolveBody
          ? await awaitProjectCreatePreparation(
              loadPluginRegistryView(),
              projectCreatePreparationDeadline,
              'loading plugin resources',
            )
          : null;
        let pluginForSnapshot = selectedLocalPlugin;
        if (requestedPluginId && requestedPluginSource) {
          // All preparation above is asynchronous. Re-resolve the exact local
          // source immediately before the synchronous SQLite transaction so a
          // reconciliation tombstone cannot leave a project/conversation or
          // snapshot behind. This is local catalogue freshness only: do not
          // turn it into a remote membership or current-Workspace gate.
          pluginForSnapshot = await awaitProjectCreatePreparation(
            ctx.pluginScope?.getLocalPluginBySource?.(
              requestedPluginId,
              requestedPluginSource,
            ) ?? Promise.resolve(null),
            projectCreatePreparationDeadline,
            'confirming the selected plugin',
          );
          if (!pluginForSnapshot) {
            if (externalProjectDir) {
              await rm(externalProjectDir, { recursive: true, force: true }).catch(() => {});
            }
            return sendApiError(res, 404, 'PLUGIN_NOT_FOUND', 'plugin not found');
          }
        }
        // Seed saved-template files before the atomic database commit. The
        // first Chat turn must never race a project row whose initial files are
        // still being copied. Managed directories are compensated below if a
        // later deadline, disconnect, or transaction failure prevents commit.
        if (
          metadata
          && typeof metadata === 'object'
          && metadata.kind === 'template'
          && typeof metadata.templateId === 'string'
        ) {
          const tpl = getTemplate(db, metadata.templateId);
          if (tpl && Array.isArray(tpl.files) && tpl.files.length > 0) {
            assertProjectCreatePreparationWithinDeadline(
              projectCreatePreparationDeadline,
              'preparing template files',
            );
            managedTemplateDirPrepared = externalProjectDir == null;
            await ensureProject(PROJECTS_DIR, id, projectMetadata);
            for (const f of tpl.files) {
              if (
                !f
                || typeof f.name !== 'string'
                || typeof f.content !== 'string'
              ) {
                continue;
              }
              try {
                await writeProjectFile(
                  PROJECTS_DIR,
                  id,
                  f.name,
                  Buffer.from(f.content, 'utf8'),
                  {},
                  projectMetadata,
                );
              } catch {
                // The template is also embedded in the agent prompt. Preserve
                // the existing best-effort behavior for individual bad files.
              }
            }
          }
        }
        // Filesystem preparation is not raced because those writes cannot be
        // cancelled safely. If it was slow, stop here and let the catch below
        // compensate the external directory before any SQLite row is written.
        assertProjectCreatePreparationWithinDeadline(
          projectCreatePreparationDeadline,
          'finalizing project preparation',
        );
        // The Web proxy propagates an aborted optimistic create to this
        // request. Never cross the persistence boundary after its caller has
        // gone away, even if the final catalogue read happened to settle at
        // the same moment as the disconnect.
        if (req.aborted || res.destroyed) {
          if (externalProjectDir) {
            await rm(externalProjectDir, { recursive: true, force: true }).catch(() => {});
          } else if (managedTemplateDirPrepared) {
            await removeProjectDir(PROJECTS_DIR, id).catch(() => {});
          }
          return;
        }
        project = db.transaction(() => {
          let createdProject = insertProject(db, {
            id,
            name: name.trim(),
            skillId: normalizedSkillId,
            pendingPrompt: pendingPrompt || null,
            metadata: projectMetadata,
            customInstructions:
              typeof customInstructions === 'string'
                ? customInstructions
                : null,
            createdAt: now,
            updatedAt: now,
          });
          // Create the project and its seed conversation in one transaction.
          insertConversation(db, {
            id: cid,
            projectId: id,
            title: null,
            sessionMode: initialSessionMode,
            createdAt: now,
            updatedAt: now,
          });

          if (resolveBody && registry) {
            const resolved = resolvePluginSnapshot({
              db,
              body: resolveBody,
              projectId: id,
              conversationId: cid,
              registry,
              ...(pluginForSnapshot ? { plugin: pluginForSnapshot } : {}),
              ...(automaticDefaultRouting && defaultScenarioPluginId
                ? {
                    projectBinding: {
                      provenance: 'automatic_default' as const,
                      taskProfile: automaticScenarioTaskProfile({
                        metadata: projectMetadata as ProjectMetadata | null,
                        pluginId: defaultScenarioPluginId,
                      }),
                    },
                  }
                : {}),
            });
            if (resolved && !resolved.ok) {
              if (!explicitPlugin) {
                console.warn(
                  `[plugins] default-scenario fallback skipped for project ${id}: ${resolved.body?.error?.code ?? 'unknown'}`,
                );
              } else {
                pluginResolutionState.failure = resolved;
                throw new Error('explicit plugin resolution failed');
              }
            } else {
              pluginResolutionState.snapshot = resolved;
              if (resolved) createdProject = getProject(db, id) ?? createdProject;
            }
          }
          return createdProject;
        })();
      } catch (err) {
        // Filesystem preparation cannot participate in SQLite's transaction.
        // Compensate external locations and managed template staging on any
        // deadline, disconnect, or database transaction failure.
        if (externalProjectDir) {
          await rm(externalProjectDir, { recursive: true, force: true }).catch(() => {});
        } else if (managedTemplateDirPrepared) {
          await removeProjectDir(PROJECTS_DIR, id).catch(() => {});
        }
        if (pluginResolutionState.failure) {
          return res
            .status(pluginResolutionState.failure.status)
            .json(pluginResolutionState.failure.body);
        }
        throw err;
      }
      /** @type {import('@openpixo/contracts').CreateProjectResponse} */
      const createdProject = pluginResolutionState.snapshot
        ? getProject(db, id) ?? project
        : project;
      const body = {
        // The binding above is part of the same transaction as the project and
        // seed conversation. Return that authority immediately so the Web can
        // scope its very first conversation/file reads without waiting for a
        // later list/detail round trip. Headerless legacy creates remain
        // explicitly unbound and therefore keep the original payload shape.
        project: createdProject,
        conversationId: cid,
        ...(pluginResolutionState.snapshot
          ? { appliedPluginSnapshotId: pluginResolutionState.snapshot.snapshotId }
          : {}),
      };
      res.json(body);
    } catch (err: any) {
      if (err instanceof ProjectCreatePreparationTimeoutError) {
        return sendApiError(
          res,
          504,
          'PROJECT_CREATE_PREPARATION_TIMEOUT',
          err.message,
          { retryable: true, details: { stage: err.stage } },
        );
      }
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.post('/api/projects/:id/scenario/restore-automatic', async (req, res) => {
    const project = getProject(db, String(req.params.id));
    if (!project) {
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    }
    if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write', capability: 'rename' })) return;

    const request = req.body as Partial<RestoreProjectAutomaticScenarioRequest> | null;
    if (!request || !Object.prototype.hasOwnProperty.call(request, 'expectedCurrentSnapshotId')) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        'expectedCurrentSnapshotId is required',
      );
    }
    if (
      request.expectedCurrentSnapshotId !== null
      && typeof request.expectedCurrentSnapshotId !== 'string'
    ) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        'expectedCurrentSnapshotId must be a string or null',
      );
    }
    const currentSnapshotId = project.appliedPluginSnapshotId ?? null;
    if (request.expectedCurrentSnapshotId !== currentSnapshotId) {
      return sendApiError(
        res,
        409,
        'PROJECT_SCENARIO_CONFLICT',
        'project scenario changed; refresh before restoring the automatic scenario',
      );
    }

    const defaultPluginId = defaultScenarioPluginIdForProjectMetadata(project.metadata);
    if (!defaultPluginId || !getInstalledPlugin(db, defaultPluginId)) {
      return sendApiError(
        res,
        409,
        'DEFAULT_SCENARIO_UNAVAILABLE',
        'no installed automatic scenario is available for this project',
      );
    }
    const taskProfile = automaticScenarioTaskProfile({
      metadata: project.metadata,
      pluginId: defaultPluginId,
    });
    const currentBinding = readVerifiedProjectScenarioBinding(db, {
      projectId: project.id,
      appliedPluginSnapshotId: currentSnapshotId,
      metadata: project.metadata,
    });
    if (
      currentBinding?.provenance === 'automatic_default'
      && currentBinding.snapshotId === currentSnapshotId
      && currentBinding.pluginId === defaultPluginId
      && (currentBinding.taskProfile ?? null) === taskProfile
    ) {
      const body: RestoreProjectAutomaticScenarioResponse = {
        project,
        scenarioBinding: currentBinding,
        changed: false,
      };
      return res.json(body);
    }

    const registry = await ctx.pluginScope?.loadRegistry();
    if (!registry) {
      return sendApiError(res, 503, 'PLUGIN_REGISTRY_UNAVAILABLE', 'plugin registry unavailable');
    }
    const conversationId = getFirstProjectConversation(db, project.id)?.id ?? null;
    const restore = db.transaction(():
      | { ok: true; resolved: ResolveSnapshotOk; project: NonNullable<ReturnType<typeof getProject>> }
      | { ok: false; failure: ResolveSnapshotError | null } => {
      const resolved = resolvePluginSnapshot({
        db,
        body: { pluginId: defaultPluginId },
        projectId: project.id,
        conversationId,
        registry,
        projectBinding: {
          provenance: 'automatic_default',
          taskProfile,
        },
      });
      if (!resolved || !resolved.ok) {
        return { ok: false, failure: resolved && !resolved.ok ? resolved : null };
      }
      const updated = getProject(db, project.id);
      if (!updated?.metadata?.scenarioBinding) {
        throw new Error('automatic scenario binding was not persisted');
      }
      return { ok: true, resolved, project: updated };
    });
    try {
      const outcome = restore();
      if (!outcome.ok) {
        if (outcome.failure) {
          return res.status(outcome.failure.status).json(outcome.failure.body);
        }
        return sendApiError(
          res,
          409,
          'DEFAULT_SCENARIO_RESTORE_FAILED',
          'automatic scenario restoration failed',
        );
      }
      const body: RestoreProjectAutomaticScenarioResponse = {
        project: outcome.project,
        scenarioBinding: outcome.project.metadata!.scenarioBinding!,
        changed: outcome.resolved.snapshotId !== currentSnapshotId,
      };
      return res.json(body);
    } catch (error) {
      console.warn('[projects] automatic scenario restore failed', error);
      return sendApiError(
        res,
        409,
        'DEFAULT_SCENARIO_RESTORE_FAILED',
        'automatic scenario restoration failed; the existing project pin was preserved',
      );
    }
  });

  app.post('/api/projects/:id/duplicate', async (req, res) => {
    const sourceProject = getProject(db, String(req.params.id));
    try {
      const locations = await configuredProjectLocations();
      if (!sourceProject || !projectVisibleForLocations(sourceProject, locations)) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      }
      if (!await authorizeProjectRequest(req, res, sourceProject.id, { mode: 'write', capability: 'duplicate' })) return;

      const targetProjectId = randomId();
      const targetName = normalizeProjectDuplicateName(req.body?.name, sourceProject);
      const metadata = cloneProjectMetadataForDuplicate(sourceProject);
      let insertedProject = false;
      try {
        await ensureProject(PROJECTS_DIR, targetProjectId, metadata);
        const sourceFiles = await listFiles(PROJECTS_DIR, sourceProject.id, {
          metadata: sourceProject.metadata,
        });
        const copiedFiles: string[] = [];
        for (const file of sourceFiles) {
          if (!file?.name || typeof file.name !== 'string') continue;
          const sourceFile = await readProjectFile(
            PROJECTS_DIR,
            sourceProject.id,
            file.name,
            sourceProject.metadata,
          );
          await writeProjectFile(
            PROJECTS_DIR,
            targetProjectId,
            sourceFile.name,
            sourceFile.buffer,
            {
              overwrite: true,
              ...(sourceFile.artifactManifest ? { artifactManifest: sourceFile.artifactManifest } : {}),
            },
            metadata,
          );
          copiedFiles.push(sourceFile.name);
        }

        const now = Date.now();
        const project = insertProject(db, {
          id: targetProjectId,
          name: targetName,
          skillId: sourceProject.skillId ?? null,
          pendingPrompt: null,
          metadata,
          customInstructions: sourceProject.customInstructions ?? null,
          createdAt: now,
          updatedAt: now,
        });
        insertedProject = true;

        const conversationId = randomId();
        insertConversation(db, {
          id: conversationId,
          projectId: targetProjectId,
          title: null,
          sessionMode: 'design',
          createdAt: now,
          updatedAt: now,
        });
        try {
          const tabs = listTabs(db, sourceProject.id);
          setTabs(db, targetProjectId, tabs);
        } catch {
          // Open-tabs state is convenience metadata; file duplication succeeds
          // without it.
        }
        /** @type {import('@openpixo/contracts').DuplicateProjectResponse} */
        const body = {
          project,
          conversationId,
          copiedFiles,
        };
        res.json(body);
      } catch (err) {
        if (insertedProject) dbDeleteProject(db, targetProjectId);
        await removeProjectDir(PROJECTS_DIR, targetProjectId).catch(() => {});
        throw err;
      }
    } catch (err: any) {

      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects/:id', async (req, res) => {
    const project = getProject(db, String(req.params.id));
    const locations = await configuredProjectLocations();
    if (!project || !projectVisibleForLocations(project, locations))
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
    if (!await authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
    // When a caller is about to *reference* this project (add it as read-only
    // context for another run), materialize its managed folder first so the
    // reference resolves to a real directory. See ensureReferencedProjectDir.
    if (req.query.ensureDir === '1' || req.query.ensureDir === 'true') {
      try {
        await ensureReferencedProjectDir(PROJECTS_DIR, project, ensureProject);
      } catch (err: any) {
        return sendApiError(
          res,
          500,
          'PROJECT_DIR_MATERIALIZATION_FAILED',
          String(err?.message || err),
        );
      }
    }
    const resolvedDir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);
    /** @type {import('@openpixo/contracts').ProjectResponse} */
    const body = {
      project,
      resolvedDir,
    };
    res.json(body);
  });


  app.patch('/api/projects/:id', async (req, res) => {
    try {
      const patch = req.body || {};
      let patchProject = getProject(db, String(req.params.id));

      if (!patchProject) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      }
      if (!await authorizeProjectRequest(req, res, patchProject.id, { mode: 'write', capability: 'rename' })) return;
      // baseDir / folder-import state is privileged: it's set only by the
      // import endpoint and otherwise immutable. Two failure modes to
      // guard against here:
      //   1. Explicit attempt to change baseDir → reject with 400.
      //   2. A regular metadata patch that *omits* baseDir (e.g. a UI
      //      that only edits linkedDirs sends `{ metadata: { kind, linkedDirs } }`).
      //      updateProject() replaces metadata wholesale, so without
      //      preservation the existing baseDir gets wiped and the project
      //      detaches from the user's folder — subsequent reads/writes
      //      silently fall back to .pixo/projects/<id>.
      // For case 2 we re-stamp the immutable fields from the existing
      // project record onto the incoming patch so the user can keep
      // patching other metadata without ever losing their import root.
      if (patch.metadata === null) {
        const styledProject = getProject(db, String(req.params.id));
        if (typeof styledProject?.metadata?.artStyleId === 'string') return sendApiError(res, 400, 'BAD_REQUEST', 'clear the project art style before clearing metadata');
        const existing = getProject(db, String(req.params.id));
        if (existing?.metadata?._commentFiles) return sendApiError(res, 400, 'BAD_REQUEST', '_commentFiles is daemon-owned');
        if (existing?.metadata?.gamePlan) return sendApiError(res, 400, 'BAD_REQUEST', 'gamePlan is daemon-owned');
        if (existing?.metadata?.exampleBinding) {
          return sendApiError(
            res,
            400,
            'BAD_REQUEST',
            'metadata cannot be cleared while exampleBinding is daemon-owned',
          );
        }
        if (existing?.metadata?.baseDir) {
          return sendApiError(
            res,
            400,
            'BAD_REQUEST',
            'metadata cannot be cleared for imported projects',
          );
        }
      }
      if (patch.metadata && typeof patch.metadata === 'object') {
        const existing = getProject(db, String(req.params.id));
        const existingMeta = existing?.metadata;
        if ('_commentFiles' in patch.metadata) return sendApiError(res, 400, 'BAD_REQUEST', '_commentFiles is daemon-owned');
        if ('engineProfile' in patch.metadata) return sendApiError(res, 400, 'BAD_REQUEST', 'engineProfile is daemon-owned');
        if ('artStyleId' in patch.metadata && patch.metadata.artStyleId !== existingMeta?.artStyleId) return sendApiError(res, 400, 'BAD_REQUEST', 'artStyleId must be changed through the art-style endpoint');
        if (existingMeta?.artStyleId !== undefined) patch.metadata.artStyleId = existingMeta.artStyleId;
        if ('styleReference' in patch.metadata && patch.metadata.styleReference !== existingMeta?.styleReference) return sendApiError(res, 400, 'BAD_REQUEST', 'styleReference must be changed through the style-reference endpoint');
        if (existingMeta?.styleReference !== undefined) patch.metadata.styleReference = existingMeta.styleReference;
        if ('gameRunSucceededAt' in patch.metadata) return sendApiError(res, 400, 'BAD_REQUEST', 'gameRunSucceededAt is daemon-owned');
        if ('gamePlan' in patch.metadata && JSON.stringify(patch.metadata.gamePlan) !== JSON.stringify(existingMeta?.gamePlan)) return sendApiError(res, 400, 'BAD_REQUEST', 'gamePlan is daemon-owned');
        delete patch.metadata.gamePlan;
        if (existingMeta?.gamePlan) patch.metadata.gamePlan = existingMeta.gamePlan;
        if ('publishShareId' in patch.metadata) return sendApiError(res, 400, 'BAD_REQUEST', 'publishShareId is daemon-owned');
        if (existingMeta?.engineProfile) patch.metadata.engineProfile = existingMeta.engineProfile;
        if (Number.isFinite(existingMeta?.gameRunSucceededAt)) patch.metadata.gameRunSucceededAt = existingMeta.gameRunSucceededAt;
        if (existingMeta?.publishShareId) patch.metadata.publishShareId = existingMeta.publishShareId;
        if (!Object.prototype.hasOwnProperty.call(patch.metadata, 'starterChecklistDismissed')
            && typeof existingMeta?.starterChecklistDismissed === 'boolean') {
          patch.metadata.starterChecklistDismissed = existingMeta.starterChecklistDismissed;
        }
        if (existingMeta?._commentFiles) patch.metadata._commentFiles = existingMeta._commentFiles;
        if (
          'scenarioBinding' in patch.metadata
          && JSON.stringify(patch.metadata.scenarioBinding)
            !== JSON.stringify(existingMeta?.scenarioBinding)
        ) {
          return sendApiError(
            res,
            400,
            'BAD_REQUEST',
            'scenarioBinding is daemon-owned',
          );
        }
        if (
          'exampleBinding' in patch.metadata
          && JSON.stringify(patch.metadata.exampleBinding)
            !== JSON.stringify(existingMeta?.exampleBinding)
        ) {
          return sendApiError(
            res,
            400,
            'BAD_REQUEST',
            'exampleBinding is daemon-owned',
          );
        }
        if ('fromTrustedPicker' in patch.metadata
            && patch.metadata.fromTrustedPicker !== existingMeta?.fromTrustedPicker) {
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'fromTrustedPicker can only be set via POST /api/import/folder',
          );
        }
        if ('orchestratorWorkspace' in patch.metadata) {
          const parsedOrchestratorWorkspace = parseOrchestratorWorkspace(
            patch.metadata.orchestratorWorkspace,
          );
          if (!parsedOrchestratorWorkspace.ok) {
            return sendApiError(
              res,
              400,
              'BAD_REQUEST',
              parsedOrchestratorWorkspace.message,
            );
          }
        }
        if (existingMeta?.baseDir) {
          if ('orchestratorWorkspace' in patch.metadata) {
            if (
              existingMeta.orchestratorWorkspace == null ||
              !sameOrchestratorWorkspace(
                patch.metadata.orchestratorWorkspace,
                existingMeta.orchestratorWorkspace,
              )
            ) {
              return sendApiError(
                res, 400, 'BAD_REQUEST',
                'orchestratorWorkspace is immutable after import; use the working-dir route to change it',
              );
            }
          }
          if ('baseDir' in patch.metadata && patch.metadata.baseDir !== existingMeta.baseDir) {
            return sendApiError(
              res, 400, 'BAD_REQUEST',
              'baseDir is immutable after import; use a new import to change it',
            );
          }
          patch.metadata = {
            ...patch.metadata,
            baseDir: existingMeta.baseDir,
            ...(existingMeta.importedFrom === 'folder'
              ? { importedFrom: 'folder' }
              : {}),
            ...(existingMeta.importedFrom === 'project-location'
              ? { importedFrom: 'project-location' }
              : {}),
            ...(typeof existingMeta.projectLocationId === 'string'
              ? { projectLocationId: existingMeta.projectLocationId }
              : {}),
            ...(existingMeta.fromTrustedPicker === true
              ? { fromTrustedPicker: true as const }
              : {}),
            ...(existingMeta.orchestratorWorkspace
              ? { orchestratorWorkspace: existingMeta.orchestratorWorkspace }
              : {}),
          };
        } else if ('baseDir' in patch.metadata) {
          // Non-imported project trying to acquire a baseDir → reject (only
          // /api/import/folder can set it).
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'baseDir can only be set via POST /api/import/folder',
          );
        } else if ('orchestratorWorkspace' in patch.metadata) {
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'orchestratorWorkspace can only be set via POST /api/import/folder or POST /api/projects/:id/working-dir',
          );
        }
        if (existingMeta?.scenarioBinding) {
          patch.metadata = {
            ...patch.metadata,
            scenarioBinding: existingMeta.scenarioBinding,
          };
        }
        // `updateProject` replaces metadata wholesale, so a patch that simply
        // omits the daemon-owned example binding would erase the user's
        // example without ever naming it.
        if (existingMeta?.exampleBinding) {
          patch.metadata = {
            ...patch.metadata,
            exampleBinding: existingMeta.exampleBinding,
          };
        }
      }
      if (patch.metadata?.linkedDirs) {
        const existing = getProject(db, String(req.params.id));
        const validated = validateLinkedDirs(patch.metadata.linkedDirs);
        if (validated.error) {
          return sendApiError(res, 400, 'INVALID_LINKED_DIR', validated.error);
        }
        patch.metadata.linkedDirs =
          existing?.metadata?.fromTrustedPicker === true
            ? patch.metadata.linkedDirs
            : validated.dirs;
      }
      if (patch.customInstructions !== undefined
          && typeof patch.customInstructions !== 'string'
          && patch.customInstructions !== null) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'customInstructions must be a string or null');
      }
      if (typeof patch.customInstructions === 'string' && patch.customInstructions.length > 5000) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'customInstructions exceeds 5 000 character limit');
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'skillId')) {
                const skillValidation = await validateProjectSkillId(patch.skillId);
        if (!skillValidation.ok) {
          return sendApiError(res, 400, skillValidation.code, skillValidation.message);
        }
        patch.skillId = skillValidation.id;
      }
      const project = updateProject(db, req.params.id, patch);
      if (!project)
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      /** @type {import('@openpixo/contracts').ProjectResponse} */
      const body = { project };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.delete('/api/projects/:id', publicFileMutationHandler(ctx.publicFileMutations, async (req, res) => {
    try {
      const project = getProject(db, String(req.params.id));
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write', capability: 'delete' })) return;
      // Stop any live agent run in this project before its row and directory
      // are removed, otherwise the CLI subprocess is orphaned — it keeps
      // billing and writes into a directory that no longer exists (#5468).
      await cancelRunsOwnedBy(design.runs, { projectId: project.id });
      let settleDeletion = () => {};
      projectDeletions.set(project.id, new Promise<void>((resolve) => { settleDeletion = resolve; }));
      try {
        await releaseProjectHolds(project.id);
        // A page still open on the project can reopen a hold between attempts.
        const staged = await stageProjectDirsForDelete(PROJECTS_DIR, [project.id], randomId(), {
          beforeRetry: () => releaseProjectHolds(project.id),
        });
        try {
          dbDeleteProject(db, project.id);
        } catch (error) {
          await staged.rollback();
          throw error;
        }
        const body: ProjectDeleteResponse = { ok: true };
        res.json(body);
        // The directory is detached before acknowledging deletion; walking its
        // contents must not delay the response or hold the mutation queue.
        void staged.commit().catch((error: unknown) => {
          console.warn('Failed to remove staged project directory', project.id, error);
        });
      } finally {
        projectDeletions.delete(project.id);
        settleDeletion();
      }
    } catch (err: any) {
      if (err?.code === 'PROJECT_FILES_IN_USE') {
        return sendApiError(res, 409, 'PROJECT_FILES_IN_USE',
          'Some of this project\'s files are open in another program. Close it and try again. Nothing was deleted.');
      }
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  }));

  // SSE stream of file-changed events for a project. Drives preview live-reload.
  // Receipt of a `file-changed` event triggers a file-list refresh, which
  // propagates new mtimes through to FileViewer iframes (the URL-load
  // `?v=${mtime}` cache-bust from PR #384 then reloads the iframe automatically).
  // Subscribers come and go as users open/close project tabs; the underlying
  // chokidar watcher is refcounted in project-watchers.ts so we never hold
  // descriptors for projects no UI is looking at.
  app.get('/api/projects/:id/events', async (req, res) => {
    // A client reconnecting mid-delete must not put the watcher back on the
    // folder being detached; it gets the outcome instead.
    await projectDeletions.get(req.params.id);
    if (!getProject(db, req.params.id)) {
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
    }
    if (!await authorizeProjectRequest(
      req,
      res,
      req.params.id,
      { mode: 'read', allowNavigationQuery: true },
    )) return;
    let sub: any;
    try {
      const sse = createSseResponse(res);
      const projectEventSink = (payload: any) => {
        sse.send(payload.type, payload);
      };
      let sinks = activeProjectEventSinks.get(req.params.id);
      if (!sinks) {
        sinks = new Set();
        activeProjectEventSinks.set(req.params.id, sinks);
      }
      sinks.add(projectEventSink);
      const watchProject = getProject(db, String(req.params.id));
      sub = subscribeFileEvents(PROJECTS_DIR, req.params.id, (evt: any) => {
        sse.send('file-changed', evt);
      }, { metadata: watchProject?.metadata });
      sub.ready.then(() => sse.send('ready', { projectId: req.params.id })).catch(() => {});
      const cleanup = async () => {
        const currentClosers = projectEventStreamClosers.get(req.params.id);
        currentClosers?.delete(closeStream);
        if (currentClosers?.size === 0) projectEventStreamClosers.delete(req.params.id);
        const currentSinks = activeProjectEventSinks.get(req.params.id);
        currentSinks?.delete(projectEventSink);
        if (currentSinks?.size === 0) activeProjectEventSinks.delete(req.params.id);
        if (sub) {
          const { unsubscribe } = sub;
          sub = null;
          await Promise.resolve(unsubscribe()).catch(() => {});
        }
      };
      const closeStream = async () => {
        await cleanup();
        sse.end();
      };
      let streamClosers = projectEventStreamClosers.get(req.params.id);
      if (!streamClosers) {
        streamClosers = new Set();
        projectEventStreamClosers.set(req.params.id, streamClosers);
      }
      streamClosers.add(closeStream);
      res.on('close', () => { void cleanup(); });
      res.on('finish', () => { void cleanup(); });
    } catch (err: any) {
      if (sub) Promise.resolve(sub.unsubscribe()).catch(() => {});
      if (!res.headersSent) sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  });

  // Comments use the same local project authorization as file mutations.
  registerProjectConversationRoutes(app, {
    ...ctx,
    authorizeProjectRequest,
    sendApiError,
  });

  // ---- Tabs -----------------------------------------------------------------

  app.get('/api/projects/:id/tabs', async (req, res) => {
    if (!getProject(db, req.params.id)) {
      return res.status(404).json({ error: 'project not found' });
    }
    if (!await authorizeProjectRequest(req, res, req.params.id, { mode: 'read' })) return;
    res.json(listTabs(db, req.params.id));
  });

  app.put('/api/projects/:id/tabs', async (req, res) => {
    if (!getProject(db, req.params.id)) {
      return res.status(404).json({ error: 'project not found' });
    }
    if (!await authorizeProjectRequest(req, res, req.params.id, { mode: 'write', capability: 'writeFiles' })) return;
    const { tabs = [], active = null, browserTabs = [] } = req.body || {};
    if (!Array.isArray(tabs) || !tabs.every((t) => typeof t === 'string')) {
      return res.status(400).json({ error: 'tabs must be string[]' });
    }
    if (!Array.isArray(browserTabs)) {
      return res.status(400).json({ error: 'browserTabs must be an array' });
    }
    const result = setTabs(
      db,
      req.params.id,
      {
        tabs,
        active: typeof active === 'string' ? active : null,
        browserTabs,
      },
    );
    res.json(result);
  });

  // ---- Templates ----------------------------------------------------------
  // User-saved snapshots of a project's HTML files. Surfaced in the
  // "From template" tab of the new-project panel so a user can spin up
  // a fresh project pre-seeded with another project's design as a
  // starting point. Created via the project's Share menu (snapshots
  // every .html file in the project folder at the moment of save).

  app.get('/api/templates', (_req, res) => {
    res.json({ templates: listTemplates(db) });
  });

  app.get('/api/templates/:id', (req, res) => {
    const t = getTemplate(db, req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json({ template: t });
  });

  app.post('/api/templates', async (req, res) => {
    try {
      const { name, description, sourceProjectId } = req.body || {};
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name required' });
      }
      if (name.length > 100) {
        return res.status(400).json({ error: 'name must be 100 characters or fewer' });
      }
      if (typeof sourceProjectId !== 'string') {
        return res.status(400).json({ error: 'sourceProjectId required' });
      }
      const sourceProject = getProject(db, sourceProjectId);
      if (!sourceProject) {
        return res.status(404).json({ error: 'source project not found' });
      }
      // Snapshot every HTML / sketch / text file in the source project.
      // We deliberately skip binary uploads — templates are about the
      // generated design, not the user's reference imagery.
      const files = await listFiles(PROJECTS_DIR, sourceProjectId, {
        metadata: sourceProject.metadata,
      });
      const snapshot = [];
      for (const f of files) {
        if (f.kind !== 'html' && f.kind !== 'text' && f.kind !== 'code')
          continue;
        const entry = await readProjectFile(
          PROJECTS_DIR,
          sourceProjectId,
          f.name,
          sourceProject.metadata,
        );
        if (entry && Buffer.isBuffer(entry.buffer)) {
          snapshot.push({
            name: f.name,
            content: entry.buffer.toString('utf8'),
          });
        }
      }
      const trimmedName = name.trim();
      const descValue = typeof description === 'string' ? description : null;
      const existing = findTemplateByNameAndProject(db, trimmedName, sourceProjectId);
      let t;
      if (existing) {
        t = updateTemplate(db, existing.id, {
          description: descValue,
          files: snapshot,
        });
      } else {
        t = insertTemplate(db, {
          id: randomId(),
          name: trimmedName,
          description: descValue,
          sourceProjectId,
          files: snapshot,
          createdAt: Date.now(),
        });
      }
      res.json({ template: t });
    } catch (err: any) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.delete('/api/templates/:id', (req, res) => {
    deleteTemplate(db, req.params.id);
    res.json({ ok: true });
  });

}

export interface RegisterProjectArtifactRoutesDeps extends RouteDeps<'http' | 'uploads' | 'paths' | 'node' | 'artifacts'> {}

export function registerProjectArtifactRoutes(app: Express, ctx: RegisterProjectArtifactRoutesDeps) {
  const { upload } = ctx.uploads;
  const { ARTIFACTS_DIR } = ctx.paths;
  const { path, fs } = ctx.node;
  const { sanitizeSlug, lintArtifact, renderFindingsForAgent } = ctx.artifacts;
  app.post('/api/upload', upload.array('images', 8), (req, res) => {
    const files = ((req.files || []) as any[]).map((f: any) => ({
      name: f.originalname,
      path: f.path,
      size: f.size,
    }));
    res.json({ files });
  });

  // Persist a generated artifact (HTML) to disk so the user can re-open it
  // in their browser or hand it off. Returns the on-disk path + a served URL.
  // The body is also passed through the anti-slop linter; findings are
  // returned alongside the path so the UI can render a P0/P1 badge and the
  // chat layer can splice them into a system reminder for the agent.
  app.post('/api/artifacts/save', (req, res) => {
    try {
      const { identifier, title, html } = req.body || {};
      if (typeof html !== 'string' || html.length === 0) {
        return res.status(400).json({ error: 'html required' });
      }
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const slug = sanitizeSlug(identifier || title || 'artifact');
      const dir = path.join(ARTIFACTS_DIR, `${stamp}-${slug}`);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'index.html');
      fs.writeFileSync(file, html, 'utf8');
      const findings = lintArtifact(html);
      res.json({
        path: file,
        url: `/artifacts/${path.basename(dir)}/index.html`,
        lint: findings,
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Standalone lint endpoint — POST raw HTML, get findings back.
  // The chat layer uses this to lint streamed-in artifacts without writing
  // them to disk first, so a P0 issue can be surfaced before save.
  // Request/response are typed against the shared contract so a producer
  // change that breaks the wire shape fails compilation here.
  app.post('/api/artifacts/lint', (req, res) => {
    try {
      const { html } = (req.body ?? {}) as Partial<LintArtifactRequest>;
      if (typeof html !== 'string' || html.length === 0) {
        return res.status(400).json({ error: 'html required' });
      }
      const findings = lintArtifact(html);
      const payload: LintArtifactResponse = {
        findings,
        agentMessage: renderFindingsForAgent(findings),
      };
      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

}

export interface RegisterProjectFileRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'uploads' | 'node' | 'projectStore' | 'projectFiles' | 'documents' | 'artifacts' | 'projectPreviewScopes'> {
  isProjectEditingBusy?: (projectId: string) => boolean;
  publicFileMutations?: ProjectMutations;
  authorizeProjectRequest?: AuthorizeProjectRequest;
  /** Startup-hydrated O(1) quarantine lookup for stale Team mirrors. */
  isProjectRevoked?: (projectId: string) => boolean;
  /** Durable first-open placeholder stamp lookup. */
  isProjectUnmaterializedPlaceholder?: (projectId: string) => boolean;
}

export function registerProjectFileRoutes(app: Express, ctx: RegisterProjectFileRoutesDeps) {
  const { db } = ctx;
  const { sendApiError, sendMulterError } = ctx.http;
  // The design-token suggestion route reads the design-system roots to resolve
  // a project's tokens, so this scope needs them alongside PROJECTS_DIR.
  const { PROJECTS_DIR, } = ctx.paths;
  const { upload } = ctx.uploads;
  const { fs } = ctx.node;
  const { getProject } = ctx.projectStore;
  const authorizeProjectRequest =
    ctx.authorizeProjectRequest ??
    createAuthorizeProjectRequest({ db, PROJECTS_DIR, getProject, sendApiError });
      const { listFiles, listProjectFolders, createProjectFolder, deleteProjectFolder, searchProjectFiles, readProjectFile, resolveProjectDir, resolveProjectFilePath, resolveProjectDeletePath, parseByteRange, renameProjectFile, deleteProjectFile, writeProjectFile, sanitizeName, sanitizePath, ensureProject } = ctx.projectFiles;
  const { buildDocumentPreview } = ctx.documents;
  const { validateArtifactManifestInput } = ctx.artifacts;
  const { projectPreviewScopes } = ctx;
  const projectPreviewIframeSandbox = 'allow-scripts allow-forms';
  const HTML_POWERED_PREVIEW_HINT_SCAN_MAX_BYTES = 128 * 1024 * 1024;
  const projectPreviewCsp = [
    `sandbox ${projectPreviewIframeSandbox}`,
    "default-src 'self' data: blob:",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
  const previewScopeRe = /^[A-Za-z0-9_-]{8,128}$/u;

  function setProjectPreviewHeaders(res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', projectPreviewCsp);
  }

  // "Powered preview" headers — the opposite trade-off from setProjectPreviewHeaders.
  // Real WebGL / Web Worker / WASM sites (Gaussian-splat viewers, physics demos,
  // ffmpeg.wasm, threaded renderers) need capabilities the opaque-origin preview
  // sandbox blocks: same-origin Workers, real Web Storage, and — for threaded
  // WASM — SharedArrayBuffer, which requires the document to be crossOriginIsolated.
  //
  // `Document-Isolation-Policy: isolate-and-credentialless` grants the SERVED
  // document its own cross-origin-isolated agent cluster WITHOUT requiring the
  // embedding app to opt the whole page into COOP/COEP. That is the key that
  // unlocks SharedArrayBuffer for just this iframe. The `credentialless` variant
  // (vs `require-corp`) still lets artifacts pull no-cors cross-origin
  // subresources (CDN fonts/images) — those loads just drop credentials — so
  // enabling isolation does not blank out otherwise-working artifacts.
  //
  // The web host renders the powered iframe with `allow-same-origin` at the
  // daemon's host-swapped preview origin (see
  // apps/web/src/runtime/powered-preview.ts), so this document gets same-origin
  // Workers/storage for sibling /powered assets while the shared /api
  // middleware rejects browser requests from that origin to normal daemon APIs.
  function setPoweredPreviewHeaders(res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Document-Isolation-Policy', 'isolate-and-credentialless');
    // Let cross-origin-isolated contexts embed these bytes (the doc + its
    // worker/wasm/asset subresources under the same /powered prefix).
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // No CORS headers: powered documents and their relative subresources load
    // from the same /powered loopback origin. Foreign browser origins must not
    // get read access to project files by adding an Origin header.
    res.removeHeader('Content-Security-Policy');
  }

  function rejectInternalVersionPath(res: Response, value: unknown): boolean {
    if (!isProjectFileVersionPath(value)) return false;
    sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
    return true;
  }

  function normalizeProjectFileVersionSource(value: unknown): ProjectFileVersionSource | undefined {
    return value === 'ai' || value === 'manual' || value === 'restore' ? value : undefined;
  }

  function parseProjectFileVersionSourceInput(
    value: unknown,
    fieldName: 'source' | 'versionSource',
  ): ProjectFileVersionSource | undefined {
    if (value === undefined || value === null) return undefined;
    const normalized = normalizeProjectFileVersionSource(value);
    if (normalized) return normalized;
    throw new Error(`invalid ${fieldName}; expected one of: ai, manual, restore`);
  }

  function requestProjectFileVersionSource(value: unknown): ProjectFileVersionSource {
    return parseProjectFileVersionSourceInput(value, 'source') ?? 'manual';
  }

  function requestProjectFileVersionUploadSource(body: any): ProjectFileVersionSource {
    const hasVersionSource = body?.versionSource !== undefined && body?.versionSource !== null;
    return parseProjectFileVersionSourceInput(
      hasVersionSource ? body.versionSource : body?.source,
      hasVersionSource ? 'versionSource' : 'source',
    ) ?? 'manual';
  }

  function latestProjectPrompt(project: any): { prompt: string | null; promptSource?: Extract<ProjectFileVersionPromptSource, 'message' | 'project'> } {
    try {
      const row = db.prepare(
        `SELECT m.content
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
          WHERE c.project_id = ?
            AND m.role = 'user'
            AND LENGTH(TRIM(m.content)) > 0
          ORDER BY COALESCE(m.ended_at, m.started_at, m.created_at, 0) DESC,
                   m.position DESC
          LIMIT 1`,
      ).get(project?.id) as { content?: string } | undefined;
      if (typeof row?.content === 'string' && row.content.trim()) {
        return { prompt: row.content.trim(), promptSource: 'message' };
      }
    } catch {
      // Prompt provenance is best-effort; versions still save without it.
    }
    if (typeof project?.pendingPrompt === 'string' && project.pendingPrompt.trim()) {
      return { prompt: project.pendingPrompt.trim(), promptSource: 'project' };
    }
    if (typeof project?.pending_prompt === 'string' && project.pending_prompt.trim()) {
      return { prompt: project.pending_prompt.trim(), promptSource: 'project' };
    }
    return { prompt: null };
  }

  type HtmlVersionOverride = {
    prompt?: string | null;
    promptSource?: ProjectFileVersionPromptSource;
    source?: ProjectFileVersionSource;
    label?: string | null;
    parentVersionId?: string;
  };

  function htmlVersionOptions(
    project: any,
    override?: HtmlVersionOverride,
  ): {
    prompt: string | null;
    promptSource?: ProjectFileVersionPromptSource;
    source?: ProjectFileVersionSource;
    label?: string;
    parentVersionId?: string;
  } {
    const fallbackPromptInfo = latestProjectPrompt(project);
    const prompt = override?.prompt !== undefined
      ? (typeof override.prompt === 'string' && override.prompt.trim() ? override.prompt.trim() : null)
      : (override?.source === 'manual' || override?.source === 'restore' ? null : fallbackPromptInfo.prompt);
    const promptSource = override?.promptSource
      ?? (override?.source === 'manual'
        ? 'manual'
        : override?.source === 'restore'
          ? 'restore'
          : fallbackPromptInfo.promptSource);
    const versionOptions: {
      prompt: string | null;
      promptSource?: ProjectFileVersionPromptSource;
      source?: ProjectFileVersionSource;
      label?: string;
      parentVersionId?: string;
    } = {
      prompt,
    };
    if (promptSource) versionOptions.promptSource = promptSource;
    if (override?.source) versionOptions.source = override.source;
    if (typeof override?.label === 'string' && override.label.trim()) {
      versionOptions.label = override.label.trim();
    }
    if (typeof override?.parentVersionId === 'string' && override.parentVersionId.trim()) {
      versionOptions.parentVersionId = override.parentVersionId.trim();
    }
    return versionOptions;
  }

  type HtmlVersionLock = {
    ensureCurrentVersion: (
      content: string,
      options?: ReturnType<typeof htmlVersionOptions>,
    ) => Promise<ProjectFileVersion | null>;
    createVersion: (
      content: string,
      options?: ReturnType<typeof htmlVersionOptions>,
    ) => Promise<ProjectFileVersion>;
    matchVersionContent: (
      content: string,
      versionId?: string,
    ) => Promise<{
      status: 'matched' | 'missing_version' | 'digest_mismatch' | 'unknown';
      version: ProjectFileVersion | null;
    }>;
  };

  async function matchedHtmlParentVersionId(
    project: any,
    fileName: string,
    requestedParentVersionId: unknown,
    versionLock: HtmlVersionLock,
  ): Promise<string | undefined> {
    if (typeof requestedParentVersionId !== 'string' || !requestedParentVersionId.trim()) {
      return undefined;
    }
    const parentVersionId = requestedParentVersionId.trim();
    try {
      const existing = await readProjectFile(
        PROJECTS_DIR,
        project.id,
        fileName,
        project.metadata,
      );
      const match = await versionLock.matchVersionContent(
        existing.buffer.toString('utf8'),
        parentVersionId,
      );
      return match.status === 'matched' && match.version?.id === parentVersionId
        ? parentVersionId
        : undefined;
    } catch {
      // Missing/unreadable pre-edit bytes cannot prove lineage. The write may
      // still proceed, but the new checkpoint must not inherit an origin.
      return undefined;
    }
  }

  function htmlVersionCaptureWarning(err: unknown): ProjectFileVersionWarning {
    const message = err instanceof Error ? err.message : String(err);
    return {
      code: 'PROJECT_FILE_VERSION_CAPTURE_FAILED',
      message: `HTML version could not be saved: ${message}`,
    };
  }

  async function tryEnsureLockedHtmlCurrentVersion(
    project: any,
    fileName: string,
    content: string,
    ensureCurrentVersion: HtmlVersionLock['ensureCurrentVersion'],
    override?: HtmlVersionOverride,
  ): Promise<{ version: ProjectFileVersion | null; versionWarning?: ProjectFileVersionWarning }> {
    if (!/\.html?$/i.test(fileName)) return { version: null };
    try {
      return { version: await ensureCurrentVersion(content, htmlVersionOptions(project, override)) };
    } catch (err) {
      return { version: null, versionWarning: htmlVersionCaptureWarning(err) };
    }
  }

  function fileFromVersionHistory(fileName: string, versions: ProjectFileVersion[]): ProjectFile | null {
    const latest = versions.at(-1);
    if (!latest) return null;
    return {
      name: latest.fileName || fileName,
      path: latest.fileName || fileName,
      type: 'file',
      size: latest.size,
      mtime: latest.createdAt,
      kind: latest.kind,
      mime: latest.mime,
    };
  }

  // Lets a browser (or the desktop export window, which shares the same Chromium
  // session/cache as the web UI) reuse already-downloaded fonts/CSS/images
  // across loads instead of re-fetching them every time — covers, live preview,
  // and screenshot export all hit /raw/. The ETag/Last-Modified are derived from
  // the file's size+mtime, so any agent rewrite changes them and busts the cache
  // immediately; `no-cache` means "always revalidate" (never serve stale without
  // asking), so a 304 only happens when the bytes are genuinely unchanged.
  function setRawRevalidationHeaders(res: Response, meta: { size: number; mtime: number }): string {
    const mtime = Math.floor(meta.mtime);
    const etag = `W/"${meta.size.toString(16)}-${mtime.toString(16)}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', new Date(mtime).toUTCString());
    res.setHeader('Cache-Control', 'no-cache');
    return etag;
  }

  function rawRequestIsFresh(req: any, etag: string, mtimeMs: number): boolean {
    // If-None-Match is authoritative when present (RFC 9110 §13.1.3): freshness
    // is decided solely by whether the ETag matches — do NOT fall through to
    // If-Modified-Since. Otherwise a same-second rewrite (ETag changes
    // immediately, but Last-Modified is identical at HTTP-date second
    // granularity) would 304 stale-but-changed bytes when a client sends both a
    // non-matching ETag and the current If-Modified-Since.
    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string') {
      return ifNoneMatch.split(',').some((tag) => tag.trim() === etag);
    }
    const ifModifiedSince = req.headers['if-modified-since'];
    if (typeof ifModifiedSince === 'string') {
      const since = Date.parse(ifModifiedSince);
      // Last-Modified is second-resolution, so compare at second granularity.
      if (Number.isFinite(since) && Math.floor(mtimeMs / 1000) * 1000 <= since) return true;
    }
    return false;
  }

  // RFC 9110 §13.1.5: a Range request with If-Range may only be served as 206
  // when the If-Range validator still matches the current representation; if it
  // doesn't (the file changed), the range must be ignored and the full current
  // file returned, so a resumed download can't splice stale + fresh bytes.
  //
  // §13.1.5 also requires the entity-tag form to use a STRONG validator. Our
  // ETag is weak (`W/"size-mtime"` — size+mtime is not byte-exact), so an
  // entity-tag If-Range can never authorize partial content: a same-size rewrite
  // or mtime-granularity collision could otherwise splice stale + fresh bytes
  // under a matching weak tag. We therefore reject ALL entity-tag If-Range values
  // (weak ones explicitly; a strong `"…"` never equals our weak ETag anyway) and
  // honor only the date form.
  function ifRangeAllowsPartial(req: any, _etag: string, mtimeMs: number): boolean {
    const ifRange = req.headers['if-range'];
    if (typeof ifRange !== 'string' || ifRange.length === 0) return true; // no If-Range → honor Range
    const value = ifRange.trim();
    // Any entity-tag (weak `W/"…"` or strong `"…"`) → not a strong match against
    // our weak validator → fall back to the full 200.
    if (value.startsWith('"') || value.startsWith('W/')) return false;
    // Date form: honor the range only if the file has NOT changed since (its
    // current Last-Modified is at/before the If-Range date).
    const since = Date.parse(value);
    return Number.isFinite(since) && Math.floor(mtimeMs / 1000) * 1000 <= since;
  }

  function htmlHasPoweredPreviewSignal(source: string): boolean {
    if (/\b(?:local|session)Storage\b/.test(source)) return true;
    if (/\bSharedArrayBuffer\b/.test(source)) return true;
    if (/\bnew\s+(?:Worker|SharedWorker)\s*\(/.test(source)) return true;
    if (/\bimportScripts\s*\(/.test(source)) return true;
    if (/\bWebAssembly\s*\.\s*(?:instantiateStreaming|compileStreaming)\b/.test(source)) return true;
    if (/\.wasm\b/.test(source)) return true;
    if (/getContext\s*\(\s*["'`]webgl2["'`]/.test(source)) return true;
    if (/\bOffscreenCanvas\b/.test(source)) return true;
    if (/\bnavigator\s*\.\s*gpu\b/.test(source)) return true;
    return false;
  }

  async function detectPoweredPreviewHint(meta: {
    filePath: string;
    mime: string;
    size: number;
  }): Promise<ProjectFileTextPreviewResponse['poweredPreview']> {
    if (!/^text\/html(?:;|$)/i.test(meta.mime)) {
      return { required: false, scannedBytes: 0, complete: true };
    }
    const scanLimit = Math.min(meta.size, HTML_POWERED_PREVIEW_HINT_SCAN_MAX_BYTES);
    if (scanLimit <= 0) {
      return { required: false, scannedBytes: 0, complete: true };
    }

    let scannedBytes = 0;
    let tail = '';
    for await (const chunk of fs.createReadStream(meta.filePath, {
      start: 0,
      end: scanLimit - 1,
      highWaterMark: 256 * 1024,
    })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      scannedBytes += buffer.byteLength;
      const sample = tail + buffer.toString('utf8');
      if (htmlHasPoweredPreviewSignal(sample)) {
        return {
          required: true,
          scannedBytes,
          complete: scannedBytes >= meta.size,
        };
      }
      tail = sample.slice(-512);
    }

    return {
      required: false,
      scannedBytes,
      complete: scannedBytes >= meta.size,
    };
  }

  async function sendProjectFile(
    req: any,
    res: Response,
    projectId: string,
    relPath: string,
    metadata?: unknown,
    beforeSend?: (mime: string) => void,
    transformFile?: (file: { mime: string; buffer: Buffer }) => Buffer | string | Promise<Buffer | string>,
    revalidate = false,
  ) {
    const meta = await resolveProjectFilePath(
      PROJECTS_DIR,
      projectId,
      relPath,
      metadata,
    );
    beforeSend?.(meta.mime);

    const isStreamed = meta.mime.startsWith('video/') || meta.mime.startsWith('audio/');
    const shouldStreamBody = isStreamed || !transformFile;
    // A transform (the Vite dev-entry -> dist/index.html substitution, or preview
    // bridge injection) can replace the response bytes — but only for HTML. For
    // HTML the source file's mtime/size is NOT a valid validator, so its ETag is
    // computed from the actual sent bytes after the transform. Everything else
    // (assets, fonts, images, streamed media — where the transform is a no-op)
    // keeps the fast mtime ETag with an early 304.
    const willSubstitute =
      !isStreamed && !!transformFile && /^text\/html(?:;|$)/i.test(meta.mime);

    let currentEtag: string | null = null;
    if (revalidate && !willSubstitute) {
      currentEtag = setRawRevalidationHeaders(res, meta);
      if (rawRequestIsFresh(req, currentEtag, meta.mtime)) {
        return res.status(304).end();
      }
    }

    if (shouldStreamBody) {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', meta.mime);

      if (meta.size === 0) {
        res.setHeader('Content-Length', '0');
        return res.status(200).end();
      }

      // Honor Range only when If-Range still matches the current file — otherwise
      // a resumed download after a rewrite would splice stale + fresh bytes.
      const range =
        currentEtag === null || ifRangeAllowsPartial(req, currentEtag, meta.mtime)
          ? parseByteRange(req.headers.range, meta.size)
          : null;

      if (range === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${meta.size}`);
        return res.status(416).end();
      }

      let start;
      let end;
      let statusCode;
      if (range) {
        ({ start, end } = range);
        statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${meta.size}`);
        res.setHeader('Content-Length', String(end - start + 1));
      } else {
        start = 0;
        end = meta.size - 1;
        statusCode = 200;
        res.setHeader('Content-Length', String(meta.size));
      }

      res.status(statusCode);
      const stream = fs.createReadStream(meta.filePath, { start, end });
      stream.on('error', (streamErr: any) => {
        if (!res.headersSent) {
          sendApiError(res, 500, 'STREAM_ERROR', String(streamErr));
        } else {
          res.destroy(streamErr);
        }
      });
      stream.pipe(res);
      return;
    }

    const file = await readProjectFile(PROJECTS_DIR, projectId, relPath, metadata);
    const body = transformFile ? await transformFile(file) : file.buffer;
    if (revalidate && willSubstitute) {
      // Validator from the ACTUAL response bytes, so a change to the substituted
      // content (e.g. dist/index.html) busts the cache even when the source
      // file's mtime is unchanged.
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      const etag = `W/"${createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Last-Modified', new Date(Math.floor(meta.mtime)).toUTCString());
      const ifNoneMatch = req.headers['if-none-match'];
      if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((tag) => tag.trim() === etag)) {
        return res.status(304).end();
      }
      return res.type(file.mime).send(buf);
    }
    res.type(file.mime).send(body);
  }

  function previewFilePathForProject(project: any, queryFile: unknown): string {
    if (typeof queryFile === 'string' && queryFile.trim().length > 0) {
      return queryFile;
    }
    const entryFile = project?.metadata?.entryFile;
    return typeof entryFile === 'string' && entryFile.length > 0 ? entryFile : 'index.html';
  }

  function encodeProjectPathForUrl(filePath: string): string {
    return filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  }

  /**
   * Whether the document contains a `<base>` the browser would actually honour.
   *
   * Parsed rather than scanned, because the answer depends on namespace and on
   * template content: a `<base>` directly under `<svg>` is an SVG element and
   * inert, and one inside an HTML `<template>` belongs to an inert fragment.
   * Both look identical to a linear scan.
   *
   * The template test is by namespace as well as name. A foreign element may
   * also be called `template` — `<svg><template><foreignObject><base>` — and it
   * creates no inert fragment, so the base under it is live and a name-only
   * test would wrongly discard it.
   */
  function hasAuthoredHtmlBase(html: string): boolean {
    const $ = load(html);
    return $('base').toArray().some((element) => {
      if (element.namespace !== HTML_NAMESPACE) return false;
      for (let node: typeof element.parent = element.parent; node; node = node.parent) {
        const candidate = node as { name?: string; namespace?: string };
        if (candidate.name === 'template' && candidate.namespace === HTML_NAMESPACE) return false;
      }
      return true;
    });
  }

  function injectProjectPreviewBase(
    html: string,
    projectId: string,
    ownerFilePath: string,
    scope: string,
    expiresAt: number,
  ): string {
    // Respect an artifact-authored base URL. Only generated documents without
    // one need the containment base that keeps runtime-created relative URLs
    // (for example `img.src = payload.logo`) on the minted preview scope. A
    // `<base>` an author merely wrote into a string does not govern this
    // document, so it must not suppress containment.
    if (findRealTagOffset(html, /<base(?=[\t\n\f\r />])/i) >= 0) return html;
    // A `<base>` can also sit inside an HTML integration point — under
    // `<foreignObject>`, `<desc>`, or an `annotation-xml` that names an HTML
    // encoding — where the structural scan deliberately does not go, because
    // for its own purpose the whole foreign subtree is skippable. Such a base
    // is an HTML-namespace element and governs the document; the generated one
    // would land in `<head>` ahead of it and win, silently repointing every
    // authored relative URL. Only foreign content can hide one, so the parse
    // below is gated on the document having some — 10% of this repository's
    // HTML files reach it, at a few milliseconds each.
    if (/<(svg|math)[\t\n\f\r />]/i.test(html) && hasAuthoredHtmlBase(html)) return html;
    const ownerDir = path.posix.dirname(ownerFilePath);
    const dirSuffix = ownerDir === '.'
      ? ''
      : `${encodeProjectPathForUrl(ownerDir)}/`;
    const baseTag = `<base href="/api/projects/${encodeURIComponent(projectId)}`
      + `/preview/${encodeURIComponent(scope)}/${dirSuffix}" data-pixo-project-preview-base>`;
    const baseHref = `/api/projects/${encodeURIComponent(projectId)}`
      + `/preview/${encodeURIComponent(scope)}/${dirSuffix}`;
    const bridge = buildPreviewBaseHrefBridge({ href: baseHref, expiresAt });
    // Same structural rule as the bridge injectors above: a `<head>` inside a
    // script string is text, not this document's head.
    const headOpenIndex = findRealTagOffset(html, /<head(?=[\t\n\f\r />])/i);
    if (headOpenIndex >= 0) {
      const openTagEnd = endOfTag(html, headOpenIndex);
      if (openTagEnd >= 0) {
        return `${html.slice(0, openTagEnd + 1)}${baseTag}${bridge}${html.slice(openTagEnd + 1)}`;
      }
    }
    return prependAfterDoctype(html, `${baseTag}${bridge}`);
  }

  async function maybeResolveVitePreviewHtml({
    file,
    projectId,
    relPath,
    metadata,
    projectsRoot,
    readProjectFile,
  }: {
    file: { mime: string; buffer: Buffer };
    projectId: string;
    relPath: string;
    metadata?: unknown;
    projectsRoot: string;
    readProjectFile: (projectsRoot: string, projectId: string, relPath: string, metadata?: unknown) => Promise<{ buffer: Buffer }>;
  }): Promise<Buffer | string> {
    if (!/^text\/html(?:;|$)/i.test(file.mime)) return file.buffer;
    const html = file.buffer.toString('utf8');
    if (!isViteDevHtmlEntry(html)) return file.buffer;

    const ownerDir = path.posix.dirname(relPath);
    const distRelPath = ownerDir === '.' ? 'dist/index.html' : `${ownerDir}/dist/index.html`;
    try {
      const distFile = await readProjectFile(projectsRoot, projectId, distRelPath, metadata);
      return rewriteViteDistAssetUrlsForPreview(distFile.buffer.toString('utf8'));
    } catch {
      return file.buffer;
    }
  }

  /**
   * While a preview shows a Vite game, the folder its `index.html` sits in is
   * previewed as that game's build folder.
   *
   * The preview serves a Vite dev entry as its built `dist/index.html` (see
   * `maybeResolveVitePreviewHtml`) but keeps the source URL. Everything the
   * built game asks for relative to that page exists only in `dist/`, because
   * Vite copies `public/` there — above all the paths its code builds at run
   * time, such as a Phaser loader's `assets/art/hero.png`, which no HTML
   * rewrite and no `<base>` on one transport can reach. So a path missing from
   * the source folder is served from the build folder of the nearest enclosing
   * folder whose `index.html` is a Vite dev entry. Source files keep
   * precedence, a path missing from both stays missing, and a folder whose
   * `index.html` is not a Vite dev entry gets no fallback.
   */
  async function resolvePreviewServedPath(
    projectId: string,
    relPath: string,
    metadata?: unknown,
  ): Promise<string> {
    try {
      await resolveProjectFilePath(PROJECTS_DIR, projectId, relPath, metadata);
      return relPath;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }
    const segments = relPath.split('/');
    for (let depth = segments.length - 1; depth >= 0; depth -= 1) {
      const rest = segments.slice(depth).join('/');
      if (rest === 'dist' || rest.startsWith('dist/')) continue;
      const prefix = depth === 0 ? '' : `${segments.slice(0, depth).join('/')}/`;
      try {
        const entry = await readProjectFile(PROJECTS_DIR, projectId, `${prefix}index.html`, metadata);
        if (!isViteDevHtmlEntry(entry.buffer.toString('utf8'))) continue;
        const built = `${prefix}dist/${rest}`;
        await resolveProjectFilePath(PROJECTS_DIR, projectId, built, metadata);
        return built;
      } catch {
        continue;
      }
    }
    return relPath;
  }

  function isViteDevHtmlEntry(html: string): boolean {
    return /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']\/src\/[^"']+["'][^>]*>\s*<\/script>/i.test(html);
  }

  function rewriteViteDistAssetUrlsForPreview(html: string): string {
    return html.replace(
      /\b(href|src)\s*=\s*(["'])\/assets\//gi,
      (_match, attr: string, quote: string) => `${attr}=${quote}dist/assets/`,
    );
  }

  // Project files. Each project owns a flat folder under .pixo/projects/<id>/
  // containing every file the user has uploaded, pasted, sketched, or that
  // the agent has generated. Names are sanitized; paths are confined to the
  // project's own folder (see apps/daemon/src/projects.ts).
  app.get('/api/projects/:id/files', async (req, res) => {
    try {
      const since = Number(req.query?.since);
      const project = getProject(db, String(req.params.id));
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
      if (project?.metadata?.teamMirrorRevokedAt) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      }
      const files = await listFiles(PROJECTS_DIR, req.params.id, {
        since: Number.isFinite(since) ? since : undefined,
        metadata: project?.metadata,
      });
      // The directory is mutated outside HTTP by agent CLIs and filesystem
      // tools. A cached 200 can therefore outlive a completed Write even when
      // the daemon's fresh scan already sees the new file, leaving the
      // workspace on the previous snapshot. The web layer owns its own short
      // request-coalescing window, so transport caches must always revalidate
      // this dynamic inventory.
      res.setHeader('Cache-Control', 'no-store');
      /** @type {import('@openpixo/contracts').ProjectFilesResponse} */
      const body = { files };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects/:id/search', async (req, res) => {
    try {
      const searchProject = getProject(db, String(req.params.id));
      if (!searchProject) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, searchProject.id, { mode: 'read' })) return;
      const query = String(req.query.q ?? '');
      if (!query) {
        sendApiError(res, 400, 'BAD_REQUEST', 'q query parameter is required');
        return;
      }
      const pattern = req.query.pattern ? String(req.query.pattern) : null;
      const max = Math.min(Number(req.query.max) || 200, 1000);
      const matches = await searchProjectFiles(PROJECTS_DIR, req.params.id, query, {
        pattern,
        max,
        metadata: searchProject?.metadata,
      });
      res.json({ query, matches });
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects/:id/folders', async (req, res) => {
    try {
      const project = getProject(db, String(req.params.id));
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
      const folders = await listProjectFolders(PROJECTS_DIR, req.params.id, {
        metadata: project.metadata,
      });
      /** @type {import('@openpixo/contracts').ProjectFoldersResponse} */
      const body = { folders };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.post('/api/projects/:id/folders', async (req, res) => {
    try {
      const { name } = req.body || {};
      if (typeof name !== 'string' || !name.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'name required');
      }
      const project = getProject(db, String(req.params.id));
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write', capability: 'writeFiles' })) return;
      const folder = await createProjectFolder(
        PROJECTS_DIR,
        req.params.id,
        name,
        project.metadata,
      );
      /** @type {import('@openpixo/contracts').ProjectFolderResponse} */
      const body = { folder };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  });

  app.delete('/api/projects/:id/folders', publicFileMutationHandler(ctx.publicFileMutations, async (req, res) => {
    try {
      const { path: folderPath } = req.body || {};
      if (typeof folderPath !== 'string' || !folderPath.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'path required');
      }
      const project = getProject(db, String(req.params.id));
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write', capability: 'writeFiles' })) return;
      const target = await resolveProjectDeletePath(PROJECTS_DIR, project.id, folderPath, project.metadata);
      if (!target.name) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'target must be a non-root folder');
      }
      await (async () => {
        if (!(await ctx.node.fs.promises.stat(target.filePath)).isDirectory()) throw new Error('target must be a non-root folder');
        await deleteProjectFolder(PROJECTS_DIR, req.params.id, folderPath, project.metadata);
      })();
      deleteWorkspaceArtifactsInFolder(db, project.id, target.name);
      /** @type {import('@openpixo/contracts').DeleteProjectFolderResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  }));

  app.get('/api/projects/:id/preview-url', async (req, res) => {
    try {
      const project = getProject(db, String(req.params.id));
      if (!project) {
        sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        return;
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
      const requestedPath = previewFilePathForProject(project, req.query.file);
      const meta = await resolveProjectFilePath(
        PROJECTS_DIR,
        project.id,
        requestedPath,
        project.metadata,
      );
      const scope = projectPreviewScopes.mint(project.id);
      const expiresAt = projectPreviewScopes.expiresAt(project.id, scope);
      if (expiresAt === undefined) {
        sendApiError(res, 503, 'PREVIEW_SCOPE_NOT_FOUND', 'preview scope not found');
        return;
      }
      /** @type {import('@openpixo/contracts').ProjectPreviewUrlResponse} */
      const body = {
        url: `/api/projects/${encodeURIComponent(project.id)}/preview/${scope}/${encodeProjectPathForUrl(meta.name)}`,
        file: meta.name,
        csp: projectPreviewCsp,
        iframeSandbox: projectPreviewIframeSandbox,
        opaqueOrigin: true,
        expiresAt,
      };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  app.post('/api/projects/:id/preview/:scope/renew', async (req, res) => {
    try {
      const projectId = String(req.params.id ?? '');
      const scope = String(req.params.scope ?? '');
      // The scope is embedded in untrusted preview HTML. Requiring a custom
      // header makes renewal a host-only operation: an opaque-origin iframe
      // cannot set it without a CORS preflight, and this route grants no CORS.
      if (req.get('x-pixo-preview-scope-renewal') !== '1') {
        sendApiError(res, 403, 'FORBIDDEN', 'preview scope renewal requires host authorization');
        return;
      }
      if (!previewScopeRe.test(scope)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'invalid preview scope');
        return;
      }
      const project = getProject(db, projectId);
      if (!project) {
        sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        return;
      }
      if (!projectPreviewScopes.validate(project.id, scope)) {
        sendApiError(res, 404, 'PREVIEW_SCOPE_NOT_FOUND', 'preview scope not found');
        return;
      }
      if (!await authorizeProjectRequest(
        req,
        res,
        project.id,
        { mode: 'read', allowNavigationQuery: true },
      )) return;
      const expiresAt = projectPreviewScopes.renew(project.id, scope);
      if (expiresAt === undefined) {
        sendApiError(res, 404, 'PREVIEW_SCOPE_NOT_FOUND', 'preview scope not found');
        return;
      }
      /** @type {import('@openpixo/contracts').ProjectPreviewScopeRenewResponse} */
      const body = { expiresAt };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/text-preview\/(.+)$/u, async (req, res) => {
    let handle: import('fs/promises').FileHandle | null = null;
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const relPath = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, relPath)) return;
      const requestedLimit = Number(req.query.limit);
      const limit = Math.max(
        1024,
        Math.min(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 96 * 1024, 512 * 1024),
      );
      const project = getProject(db, projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(
        req,
        res,
        projectId,
        { mode: 'read', allowNavigationQuery: true },
      )) return;
      const meta = await resolveProjectFilePath(
        PROJECTS_DIR,
        projectId,
        relPath,
        project?.metadata,
      );
      const bytesToRead = Math.min(meta.size, limit);
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const opened = await fs.promises.open(meta.filePath, 'r');
      handle = opened;
      const result = bytesToRead > 0
        ? await opened.read(buffer, 0, bytesToRead, 0)
        : { bytesRead: 0 };
      const text = buffer.subarray(0, result.bytesRead).toString('utf8');
      const poweredPreview = await detectPoweredPreviewHint(meta);
      const body: ProjectFileTextPreviewResponse = {
        text,
        truncated: meta.size > result.bytesRead,
        size: meta.size,
        limit,
        mime: meta.mime,
        kind: meta.kind,
        poweredPreview,
      };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/preview\/([^/]+)\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string; 2?: string };
      const projectId = String(params[0] ?? '');
      const scope = String(params[1] ?? '');
      const requestedPath = String(params[2] ?? '');
      if (!previewScopeRe.test(scope)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'invalid preview scope');
        return;
      }
      const project = getProject(db, projectId);
      if (!project) {
        sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        return;
      }
      if (!projectPreviewScopes.validate(project.id, scope)) {
        sendApiError(res, 404, 'PREVIEW_SCOPE_NOT_FOUND', 'preview scope not found');
        return;
      }
      if (!await authorizeProjectRequest(
        req,
        res,
        projectId,
        { mode: 'read', allowNavigationQuery: true },
      )) return;
      if (req.headers.origin === 'null') {
        res.header('Access-Control-Allow-Origin', '*');
      }
      const relPath = await resolvePreviewServedPath(project.id, requestedPath, project.metadata);
      await sendProjectFile(
        req,
        res,
        project.id,
        relPath,
        project.metadata,
        () => setProjectPreviewHeaders(res),
        async (file) => maybeResolveVitePreviewHtml({
          file,
          projectId: project.id,
          relPath,
          metadata: project.metadata,
          projectsRoot: PROJECTS_DIR,
          readProjectFile,
        }),
      );
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });


  // Preflight for the raw file route. Current artifact fetches are simple GETs
  // (no preflight needed), but an explicit handler future-proofs the route if
  // artifacts ever add custom request headers.
  app.options(/^\/api\/projects\/([^/]+)\/raw\/(.+)$/u, (req, res) => {
    if (req.headers.origin === 'null') {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
    }
    res.sendStatus(204);
  });

  app.get(/^\/api\/projects\/([^/]+)\/raw\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const requestedPath = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, requestedPath)) return;
      const project = getProject(db, projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(
        req,
        res,
        projectId,
        { mode: 'read', allowNavigationQuery: true },
      )) return;
      if (project?.metadata?.teamMirrorRevokedAt) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      }
      const relPath = await resolvePreviewServedPath(projectId, requestedPath, project?.metadata);
      // PreviewModal loads artifact HTML via srcdoc, giving the iframe Origin: "null".
      // data: URIs, file://, and some sandboxed iframes also send null — all are
      // local-only callers, so this is safe. Real cross-origin sites send a real
      // origin and remain blocked by the browser's same-origin policy.
      if (req.headers.origin === 'null') {
        res.header('Access-Control-Allow-Origin', '*');
      }
      const meta = await resolveProjectFilePath(
        PROJECTS_DIR,
        projectId,
        relPath,
        project?.metadata,
      );
      const skipHtmlPreviewBridge =
        /^text\/html(?:;|$)/i.test(meta.mime) && meta.size > PREVIEW_URL_GUARD_MAX_HTML_BYTES;
      // Large HTML keeps its original streamed GET path. The existing cover
      // HEAD still needs actual identity, including self-contained video sources.
      if (skipHtmlPreviewBridge && req.method === 'HEAD') {
        const file = await readProjectFile(PROJECTS_DIR, projectId, relPath, project?.metadata);
        res.setHeader(MOTION_PREVIEW_OUTPUT_HEADER, isMotionVideoComposition(file.buffer.toString('utf8')) ? 'video' : 'html');
      }

      await sendProjectFile(
        req,
        res,
        projectId,
        relPath,
        project?.metadata,
        undefined,
        skipHtmlPreviewBridge ? undefined : async (file) => {
          const transformed = await maybeResolveVitePreviewHtml({
            file,
            projectId,
            relPath,
            metadata: project?.metadata,
            projectsRoot: PROJECTS_DIR,
            readProjectFile,
          });
          if (/^text\/html(?:;|$)/i.test(file.mime)) {
            const html = Buffer.isBuffer(transformed) ? transformed.toString('utf8') : String(transformed);
            res.setHeader(MOTION_PREVIEW_OUTPUT_HEADER, isMotionVideoComposition(html) ? 'video' : 'html');
          }
          const bridged = applyUrlPreviewBridgesToHtml(
            transformed,
            file.mime,
            req.query.pixoPreviewBridge,
            req.query.pixoMotionPreview,
          );
          if (!/^text\/html(?:;|$)/i.test(file.mime)) {
            return bridged;
          }
          let html = Buffer.isBuffer(bridged) ? bridged.toString('utf8') : String(bridged);
          // Plain raw-file reads (code view, download, API clients) must keep
          // returning the same bytes as before. The containment base is only a
          // URL-preview transport detail requested by FileViewer.
          if (req.query.pixoPreviewBridge === undefined) return html;
          const scope = projectPreviewScopes.acquire(projectId);
          // The document's own expiry, not the live one: renewal must keep the
          // scope alive without changing a single byte of what this read
          // returns.
          const expiresAt = projectPreviewScopes.documentExpiresAt(projectId, scope);
          if (expiresAt === undefined) return html;
          return injectProjectPreviewBase(
            html,
            projectId,
            relPath,
            scope,
            expiresAt,
          );
        },
        true, // revalidate: emit ETag/Last-Modified so covers/preview/export reuse cached assets
      );
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  // Explicitly do not grant CORS for powered previews. Same-origin subresource
  // reads under the powered loopback URL do not preflight; foreign preflights
  // should complete without ACAO so browsers block the read.
  app.options(/^\/api\/projects\/([^/]+)\/powered\/(.+)$/u, (_req, res) => {
    res.sendStatus(204);
  });

  // "Powered preview" file serving. Mirrors /raw but stamps every response
  // (the HTML document AND its relatively-referenced worker/wasm/asset
  // subresources, which resolve under the same /powered/ prefix) with the
  // cross-origin-isolation headers from setPoweredPreviewHeaders. This is the
  // serving half of WebGL/Worker/WASM/SharedArrayBuffer support; the web host
  // decides when to route a preview here (see file-viewer-render-mode.ts).
  app.get(/^\/api\/projects\/([^/]+)\/powered\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const requestedPath = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, requestedPath)) return;
      const project = getProject(db, projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(
        req,
        res,
        projectId,
        { mode: 'read', allowNavigationQuery: true },
      )) return;
      const relPath = await resolvePreviewServedPath(projectId, requestedPath, project?.metadata);
      const meta = await resolveProjectFilePath(
        PROJECTS_DIR,
        projectId,
        relPath,
        project?.metadata,
      );
      const skipPoweredTransform =
        /^text\/html(?:;|$)/i.test(meta.mime) && meta.size > PREVIEW_URL_GUARD_MAX_HTML_BYTES;
      if (skipPoweredTransform && req.method === 'HEAD') {
        const file = await readProjectFile(PROJECTS_DIR, projectId, relPath, project?.metadata);
        res.setHeader(MOTION_PREVIEW_OUTPUT_HEADER, isMotionVideoComposition(file.buffer.toString('utf8')) ? 'video' : 'html');
      }
      await sendProjectFile(
        req,
        res,
        projectId,
        relPath,
        project?.metadata,
        () => setPoweredPreviewHeaders(res),
        skipPoweredTransform ? undefined : async (file) => {
          const transformed = await maybeResolveVitePreviewHtml({
            file,
            projectId,
            relPath,
            metadata: project?.metadata,
            projectsRoot: PROJECTS_DIR,
            readProjectFile,
          });
          if (/^text\/html(?:;|$)/i.test(file.mime)) {
            const html = Buffer.isBuffer(transformed) ? transformed.toString('utf8') : String(transformed);
            res.setHeader(MOTION_PREVIEW_OUTPUT_HEADER, isMotionVideoComposition(html) ? 'video' : 'html');
          }
          return applyUrlPreviewBridgesToHtml(transformed, file.mime, req.query.pixoPreviewBridge, req.query.pixoMotionPreview);
        },
      );
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  app.delete(/^\/api\/projects\/([^/]+)\/raw\/(.+)$/u, publicFileMutationHandler(ctx.publicFileMutations, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const rawSplat = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, rawSplat)) return;
      const project = getProject(db, projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write', capability: 'writeFiles' })) return;
      const target = await resolveProjectDeletePath(PROJECTS_DIR, projectId, rawSplat, project?.metadata);
      await (async () => {
        await deleteProjectFile(PROJECTS_DIR, projectId, rawSplat, project?.metadata);
      })();
      await markProjectFileVersionStoreDeleted(PROJECTS_DIR, projectId, rawSplat, project?.metadata);
      // Tombstone, not delete: an HTML card must be able to say "the current
      // file is gone" rather than silently opening whatever later takes the
      // name. Image cards keep resolving their own snapshot either way.
      try {
        deleteWorkspaceArtifact(db, projectId, rawSplat);
      } catch (error) {
        console.warn('[chat-artifacts] delete bookkeeping failed', error);
      }
      /** @type {import('@openpixo/contracts').DeleteProjectFileResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        // Never expose filesystem error messages: they contain daemon-owned paths.
        status === 404 ? 'file not found'
          : 'file could not be deleted',
      );
    }
  }));

  app.get('/api/projects/:id/files/:name/preview', async (req, res) => {
    try {
      const project = getProject(db, String(req.params.id));
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(
        req,
        res,
        project.id,
        { mode: 'read', allowNavigationQuery: true },
      )) return;
      const file = await readProjectFile(
        PROJECTS_DIR,
        req.params.id,
        req.params.name,
        project?.metadata,
      );
      const preview = await buildDocumentPreview(file);
      res.json(preview);
    } catch (err: any) {
      const status =
        err && err.statusCode
          ? err.statusCode
          : err && err.code === 'ENOENT'
            ? 404
            : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        err?.message || 'preview unavailable',
      );
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/files\/(.+)\/versions$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const fileName = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, fileName)) return;
      const project = getProject(db, projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
      if (!/\.html?$/i.test(fileName)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'versions are only available for HTML files');
      }
      let file: ProjectFile | null = null;
      let historyFileName = fileName;
      let workingFileContent: string | null = null;
      try {
        const workingFile = await readProjectFile(PROJECTS_DIR, project.id, fileName, project.metadata);
        if (!/\.html?$/i.test(workingFile.name)) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'versions are only available for HTML files');
        }
        file = workingFile;
        historyFileName = workingFile.name;
        workingFileContent = workingFile.buffer.toString('utf8');
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err;
      }
      let versions = await listProjectFileVersions(PROJECTS_DIR, project.id, historyFileName, project.metadata);
      // Bootstrapping a baseline version is a WRITE, so it belongs only to a
      // caller with write authority over this project. A readonly member
      // reading a mirror of someone else's shared project gets the truthful
      // empty history instead — the owner's real history can never be here
      // (`.file-versions` is excluded from member mirrors), so synthesizing
      // one would only manufacture history that never existed, inside a
      // project the member is told they cannot modify. The read itself is
      // never refused: browsing history stays open (飞书 recvq56vFjQKfT).
      // Passive preparation-proof reads must never manufacture history.
      // Default history browsing retains the existing authorized bootstrap.
      if (req.query.bootstrap !== '0' && workingFileContent !== null && versions.length === 0
        && await authorizeProjectRequest(req, res, project.id, { mode: 'write', capability: 'writeFiles' })) {
        const initial = await ensureCurrentProjectFileVersion(
          PROJECTS_DIR,
          project.id,
          historyFileName,
          workingFileContent,
          { source: 'manual', promptSource: 'manual' },
          project.metadata,
        );
        if (initial) {
          versions = await listProjectFileVersions(PROJECTS_DIR, project.id, historyFileName, project.metadata);
        }
      }
      file ??= fileFromVersionHistory(historyFileName, versions);
      if (!file) {
        return sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
      }
      /** @type {import('@openpixo/contracts').ProjectFileVersionsResponse} */
      const body = { file, versions };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err?.message || err),
      );
    }
  });

  app.post(/^\/api\/projects\/([^/]+)\/files\/(.+)\/versions$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const fileName = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, fileName)) return;
      const project = getProject(db, projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write', capability: 'writeFiles' })) return;
      const requestedFile = await readProjectFile(PROJECTS_DIR, project.id, fileName, project.metadata);
      if (!/\.html?$/i.test(requestedFile.name)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'versions are only available for HTML files');
      }
      const manualPrompt = typeof req.body?.prompt === 'string' && req.body.prompt.trim()
        ? req.body.prompt.trim()
        : null;
      const requestedSource = requestProjectFileVersionSource(req.body?.source);
      const fallbackPromptInfo = requestedSource === 'ai' && !manualPrompt ? latestProjectPrompt(project) : null;
      const versionOptions: {
        prompt: string | null;
        promptSource?: ProjectFileVersionPromptSource;
        source: ProjectFileVersionSource;
        label?: string | null;
        parentVersionId?: string;
      } = {
        prompt: manualPrompt ?? fallbackPromptInfo?.prompt ?? null,
        source: requestedSource,
        label: typeof req.body?.label === 'string' ? req.body.label : null,
      };
      if (manualPrompt) {
        versionOptions.promptSource = 'manual';
      } else if (requestedSource === 'manual') {
        versionOptions.promptSource = 'manual';
      } else if (requestedSource === 'restore') {
        versionOptions.promptSource = 'restore';
      } else if (fallbackPromptInfo?.promptSource) {
        versionOptions.promptSource = fallbackPromptInfo.promptSource;
      }
      const version = await withProjectFileVersionLock(
        PROJECTS_DIR,
        project.id,
        requestedFile.name,
        project.metadata,
        async (versionLock) => {
          const currentFile = await readProjectFile(
            PROJECTS_DIR,
            project.id,
            requestedFile.name,
            project.metadata,
          );
          const parentVersionId = requestedSource === 'manual'
            ? await matchedHtmlParentVersionId(
              project,
              currentFile.name,
              req.body?.parentVersionId,
              versionLock,
            )
            : undefined;
          return versionLock.createVersion(
            currentFile.buffer.toString('utf8'),
            {
              ...versionOptions,
              ...(parentVersionId ? { parentVersionId } : {}),
            },
          );
        },
      );
      if (!version) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'version could not be created');
      }
      /** @type {import('@openpixo/contracts').CreateProjectFileVersionResponse} */
      const body = { version };
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err?.message || err),
      );
    }
  });

  app.post(/^\/api\/projects\/([^/]+)\/files\/(.+)\/versions\/([^/]+)\/restore$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string; 2?: string };
      const projectId = String(params[0] ?? '');
      const fileName = String(params[1] ?? '');
      const versionId = String(params[2] ?? '');
      if (rejectInternalVersionPath(res, fileName)) return;
      const project = getProject(db, projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write', capability: 'writeFiles' })) return;
      const restored = await readProjectFileVersion(
        PROJECTS_DIR,
        project.id,
        fileName,
        versionId,
        project.metadata,
      );
      const requestPrompt = typeof req.body?.prompt === 'string' && req.body.prompt.trim()
        ? req.body.prompt.trim()
        : null;
      const prompt = requestPrompt
        ?? restored.version.prompt
        ?? latestProjectPrompt(project).prompt;
      const { file, version, versionWarning } = await withProjectFileVersionLock(
        PROJECTS_DIR,
        project.id,
        fileName,
        project.metadata,
        async (versionLock) => {
          const file = await writeProjectFile(
            PROJECTS_DIR,
            project.id,
            fileName,
            Buffer.from(restored.content, 'utf8'),
            {},
            project.metadata,
          );
          let version: ProjectFileVersion | null = null;
          let versionWarning: ProjectFileVersionWarning | undefined;
          try {
            version = await versionLock.createVersion(restored.content, {
              prompt,
              promptSource: requestPrompt ? 'manual' : 'restore',
              source: 'restore',
              restoreFromVersionId: restored.version.id,
            });
          } catch (err) {
            versionWarning = htmlVersionCaptureWarning(err);
          }
          return { file, version, versionWarning };
        },
      );
      /** @type {import('@openpixo/contracts').RestoreProjectFileVersionResponse} */
      const body = { file, version, ...(versionWarning ? { versionWarning } : {}) };
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'VERSION_NOT_FOUND' : 'BAD_REQUEST',
        String(err?.message || err),
      );
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/files\/(.+)\/versions\/([^/]+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string; 2?: string };
      const projectId = String(params[0] ?? '');
      const fileName = String(params[1] ?? '');
      const versionId = String(params[2] ?? '');
      if (rejectInternalVersionPath(res, fileName)) return;
      const project = getProject(db, projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
      const body = await readProjectFileVersion(
        PROJECTS_DIR,
        project.id,
        fileName,
        versionId,
        project.metadata,
      );
      /** @type {import('@openpixo/contracts').ProjectFileVersionResponse} */
      const typedBody = body;
      res.setHeader('Cache-Control', 'no-store');
      res.json(typedBody);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'VERSION_NOT_FOUND' : 'BAD_REQUEST',
        String(err?.message || err),
      );
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/files\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const fileSplat = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, fileSplat)) return;
      const project = getProject(db, projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(
        req,
        res,
        project.id,
        { mode: 'read', allowNavigationQuery: true },
      )) return;
      if (project?.metadata?.teamMirrorRevokedAt) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      }
      const file = await readProjectFile(
        PROJECTS_DIR,
        projectId,
        fileSplat,
        project?.metadata,
      );
      res.type(file.mime).send(file.buffer);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  // Two ways to upload: multipart for binary files (images), and JSON
  // {name, content, encoding} for sketches and pasted text. The frontend
  // uses both depending on the file source.
  app.post(
    '/api/projects/:id/files',
    (req, res, next) => {
      upload.single('file')(req, res, (err: any) => {
        if (err) return sendMulterError(res, err);
        next();
      });
    },
    publicFileMutationHandler(ctx.publicFileMutations, async (req, res) => {
      try {
        const projectId = typeof req.params.id === 'string' ? req.params.id : '';
        const uploadProject = getProject(db, projectId);
        const cleanupRejectedUpload = () => {
          if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
        };
        if (!uploadProject) {
          cleanupRejectedUpload();
          return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        }
        if (!await authorizeProjectRequest(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
        await ensureProject(PROJECTS_DIR, projectId, uploadProject?.metadata);
        if (req.file) {
          try {
            const buf = await fs.promises.readFile(req.file.path);
            // A caller-supplied `name` may carry an intentional subdirectory
            // (e.g. "imagery/hero.png" from the design-kit uploader). Preserve it
            // with sanitizePath (sanitizes each segment, keeps the slashes) so the
            // file lands where brand.json references it; sanitizeName would flatten
            // the slash to "_" and orphan the asset at the project root. Raw
            // multipart originalnames are plain basenames, so sanitizeName fits.
            const desiredName = req.body?.name
              ? sanitizePath(req.body.name)
              : sanitizeName(req.file.originalname);
            if (rejectInternalVersionPath(res, desiredName)) return;
            const requestedSource = uploadProject && /\.html?$/i.test(desiredName)
              ? requestProjectFileVersionUploadSource(req.body)
              : null;
            const writeAndCapture = async (versionLock?: HtmlVersionLock) => {
              const parentVersionId = uploadProject && requestedSource === 'manual' && versionLock
                ? await matchedHtmlParentVersionId(
                  uploadProject,
                  desiredName,
                  req.body?.parentVersionId,
                  versionLock,
                )
                : undefined;
              const meta = await writeProjectFile(
                PROJECTS_DIR,
                projectId,
                desiredName,
                buf,
                {},
                uploadProject?.metadata,
              );
              const versionCapture = uploadProject && requestedSource && /\.html?$/i.test(meta.name) && versionLock
                ? await (async () => {
                  const savedFile = await readProjectFile(PROJECTS_DIR, uploadProject.id, meta.name, uploadProject.metadata);
                  return tryEnsureLockedHtmlCurrentVersion(
                    uploadProject,
                    meta.name,
                    savedFile.buffer.toString('utf8'),
                    versionLock.ensureCurrentVersion,
                    {
                      prompt: typeof req.body?.versionPrompt === 'string' ? req.body.versionPrompt : null,
                      promptSource: 'manual',
                      source: requestedSource,
                      label: typeof req.body?.versionLabel === 'string' ? req.body.versionLabel : null,
                      ...(parentVersionId ? { parentVersionId } : {}),
                    },
                  );
                })()
                : null;
              return { meta, versionCapture };
            };
            const { meta, versionCapture } = uploadProject && requestedSource
              ? await withProjectFileVersionLock(
                PROJECTS_DIR,
                projectId,
                desiredName,
                uploadProject.metadata,
                (versionLock) => writeAndCapture(versionLock),
              )
              : await writeAndCapture();
            /** @type {import('@openpixo/contracts').ProjectFileResponse} */
            const body = {
              file: meta,
              ...(versionCapture ? { version: versionCapture.version } : {}),
              ...(versionCapture?.versionWarning ? { versionWarning: versionCapture.versionWarning } : {}),
            };
            return res.json(body);
          } finally {
            fs.promises.unlink(req.file.path).catch(() => {});
          }
        }
        const {
          name,
          content,
          encoding,
          artifactManifest,
          artifact,
          overwrite,
          versionLabel,
          versionPrompt,
          parentVersionId: requestedParentVersionId,
        } = req.body || {};
        if (typeof name !== 'string' || typeof content !== 'string') {
          return sendApiError(
            res,
            400,
            'BAD_REQUEST',
            'name and content required',
          );
        }
        if (rejectInternalVersionPath(res, name)) return;
        const desiredName = sanitizePath(name);
        if (rejectInternalVersionPath(res, desiredName)) return;
        const requestedSource = uploadProject && /\.html?$/i.test(desiredName)
          ? requestProjectFileVersionUploadSource(req.body)
          : null;
        if (artifactManifest !== undefined && artifactManifest !== null) {
          const validated = validateArtifactManifestInput(
            artifactManifest,
            name,
          );
          if (!validated.ok) {
            return sendApiError(
              res,
              400,
              'BAD_REQUEST',
              `invalid artifactManifest: ${validated.error}`,
            );
          }
        }
        const buf =
          encoding === 'base64'
            ? Buffer.from(content, 'base64')
            : Buffer.from(content, 'utf8');
        const writeAndCapture = async (versionLock?: HtmlVersionLock) => {
          const parentVersionId = uploadProject && requestedSource === 'manual' && versionLock
            ? await matchedHtmlParentVersionId(
              uploadProject,
              desiredName,
              requestedParentVersionId,
              versionLock,
            )
            : undefined;
          const meta = artifact === true
            ? await createProjectArtifactFile({
              projectsRoot: PROJECTS_DIR,
              projectId: projectId,
              input: { name, content, encoding, artifactManifest },
              metadata: uploadProject?.metadata,
              writeProjectFile,
            })
            : await writeProjectFile(
              PROJECTS_DIR,
              projectId,
              name,
              buf,
              {
                artifactManifest,
                ...(overwrite === false ? { overwrite: false } : {}),
              },
              uploadProject?.metadata,
            );
          const versionCapture = uploadProject && requestedSource && /\.html?$/i.test(meta.name) && versionLock
            ? await (async () => {
              const savedFile = await readProjectFile(PROJECTS_DIR, uploadProject.id, meta.name, uploadProject.metadata);
              const versionOverride: HtmlVersionOverride = {
                source: requestedSource,
                label: typeof versionLabel === 'string' ? versionLabel : null,
                ...(parentVersionId ? { parentVersionId } : {}),
              };
              if (typeof versionPrompt === 'string') {
                versionOverride.prompt = versionPrompt;
              }
              if (requestedSource === 'manual') {
                versionOverride.promptSource = 'manual';
              } else if (requestedSource === 'restore') {
                versionOverride.promptSource = 'restore';
              }
              return tryEnsureLockedHtmlCurrentVersion(
                uploadProject,
                meta.name,
                savedFile.buffer.toString('utf8'),
                versionLock.ensureCurrentVersion,
                versionOverride,
              );
            })()
            : null;
          return { meta, versionCapture };
        };
        const { meta, versionCapture } = uploadProject && requestedSource
          ? await withProjectFileVersionLock(
            PROJECTS_DIR,
            projectId,
            desiredName,
            uploadProject.metadata,
            (versionLock) => writeAndCapture(versionLock),
          )
          : await writeAndCapture();
        /** @type {import('@openpixo/contracts').ProjectFileResponse} */
        const body = {
          file: meta,
          ...(versionCapture ? { version: versionCapture.version } : {}),
          ...(versionCapture?.versionWarning ? { versionWarning: versionCapture.versionWarning } : {}),
        };
        res.json(body);
      } catch (err: any) {
        const message = String(err?.message || err);
        if (/^invalid (source|versionSource);/u.test(message)) {
          return sendApiError(res, 400, 'BAD_REQUEST', message);
        }
        if (err instanceof ArtifactRegressionError) {
          return sendApiError(res, 422, 'ARTIFACT_REGRESSION', err.message, {
            details: {
              identifier: err.identifier,
              newSize: err.newSize,
              priorSize: err.priorSize,
              priorName: err.priorName,
            },
          });
        }
        if (err instanceof ArtifactPublicationBlockedError) {
          return sendApiError(res, 422, 'ARTIFACT_PUBLICATION_BLOCKED', err.message, {
            details: { placeholders: err.placeholders },
          });
        }
        if (err?.code === 'EEXIST') {
          return sendApiError(res, 409, 'FILE_EXISTS', 'file already exists');
        }
        if (err?.code === 'ARTIFACT_MANIFEST_REQUIRED') {
          return sendApiError(res, 400, 'ARTIFACT_MANIFEST_REQUIRED', err.message);
        }
        if (err?.code === 'ARTIFACT_MANIFEST_INVALID') {
          return sendApiError(res, 400, 'BAD_REQUEST', err.message);
        }
        sendApiError(res, 500, 'INTERNAL_ERROR', 'upload failed');
      }
    }),
  );

  app.post('/api/projects/:id/files/rename', publicFileMutationHandler(ctx.publicFileMutations, async (req, res) => {
    try {
      const projectId = typeof req.params.id === 'string' ? req.params.id : '';
      const { from, to } = req.body || {};
      if (typeof from !== 'string' || typeof to !== 'string') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'from and to required');
      }
      if (rejectInternalVersionPath(res, from) || rejectInternalVersionPath(res, to)) return;
      const project = getProject(db, projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write', capability: 'writeFiles' })) return;
      // Use the exact validation/sanitization of renameProjectFile BEFORE any
      // filesystem, version-store, artifact or alias mutation.
      const oldName = validateProjectPath(from);
      const newName = sanitizePath(to);
      const result = await renameProjectFile(
        PROJECTS_DIR,
        projectId,
        oldName,
        newName,
        project?.metadata,
      );
      await renameProjectFileVersionStore(
        PROJECTS_DIR,
        projectId,
        result.oldName,
        result.newName,
        project?.metadata,
      );
      // The workspace identity follows the file. History does not: a snapshot's
      // `source_path_at_capture` records where the bytes came from at the time
      // and stays put, so an HTML card keeps opening the renamed latest while
      // an image card keeps opening its own frozen bytes.
      try {
        renameWorkspaceArtifactPath(db, projectId, result.oldName, result.newName);
      } catch (error) {
        console.warn('[chat-artifacts] rename bookkeeping failed', error);
      }
      /** @type {import('@openpixo/contracts').RenameProjectFileResponse} */
      const body = result;
      res.json(body);
    } catch (err: any) {
      if (err?.code === 'EEXIST') {
        return sendApiError(res, 409, 'CONFLICT', String(err?.message || err));
      }
      const message = String(err?.message || err);
      if (err?.code === 'ENOENT' || message.includes('ENOENT') || message.includes('no such file or directory')) {
        return sendApiError(res, 404, 'FILE_NOT_FOUND', message);
      }
      sendApiError(res, 400, 'BAD_REQUEST', message);
    }
  }));

  app.delete('/api/projects/:id/files/:name', publicFileMutationHandler(ctx.publicFileMutations, async (req, res) => {
    try {
      if (typeof req.params.id !== 'string' || typeof req.params.name !== 'string') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'project and file path are required');
      }
      if (rejectInternalVersionPath(res, req.params.name)) return;
      const delProject = getProject(db, String(req.params.id));
      if (!delProject) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, delProject.id, { mode: 'write', capability: 'writeFiles' })) return;
      const target = await resolveProjectDeletePath(PROJECTS_DIR, req.params.id, req.params.name, delProject?.metadata);
      await (async () => {
        await deleteProjectFile(PROJECTS_DIR, req.params.id, req.params.name, delProject?.metadata);
      })();
      await markProjectFileVersionStoreDeleted(PROJECTS_DIR, req.params.id, req.params.name, delProject?.metadata);
      try {
        deleteWorkspaceArtifact(db, req.params.id, req.params.name);
      } catch (error) {
        console.warn('[chat-artifacts] delete bookkeeping failed', error);
      }
      /** @type {import('@openpixo/contracts').DeleteProjectFileResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        // Never expose filesystem error messages: they contain daemon-owned paths.
        status === 404 ? 'file not found'
          : 'file could not be deleted',
      );
    }
  }));

}

export interface RegisterProjectUploadRoutesDeps extends RouteDeps<'db' | 'http' | 'uploads' | 'node' | 'paths' | 'projectStore' | 'projectFiles'> {
  authorizeProjectRequest?: AuthorizeProjectRequest;
  /** Durable first-open placeholder stamp lookup. */
  isProjectUnmaterializedPlaceholder?: (projectId: string) => boolean;
}

export function registerProjectUploadRoutes(app: Express, ctx: RegisterProjectUploadRoutesDeps) {
  const { db } = ctx;
  const { sendApiError } = ctx.http;
  const { handleProjectUpload } = ctx.uploads;
  const { PROJECTS_DIR } = ctx.paths;
  const { getProject } = ctx.projectStore;
  const { readProjectFile } = ctx.projectFiles;
  const { fs } = ctx.node;
  const authorizeProjectRequest =
    ctx.authorizeProjectRequest ??
    createAuthorizeProjectRequest({ db, PROJECTS_DIR, getProject, sendApiError });

  app.post(
    '/api/projects/:id/upload',
    handleProjectUpload,
    async (req, res) => {
      try {
        const incoming = Array.isArray(req.files) ? req.files : [];
        const cleanupRejectedUpload = () => {
          for (const f of incoming) {
            if (f?.path) fs.promises.unlink(f.path).catch(() => {});
          }
        };
        if (!await authorizeProjectRequest(req, res, req.params.id, { mode: 'write', capability: 'writeFiles' })) return;
        // Subfolder the upload targeted (sanitized, forward-slash, '' for root),
        // stashed by the multer destination resolver. Prepend it so callers
        // get the file's true project-relative path, not just its basename.
        const relDir = typeof (req as any)._uploadRelDir === 'string' ? (req as any)._uploadRelDir : '';
        const project = getProject(db, String(req.params.id));
        const out = [];
        for (const f of incoming) {
          try {
            const stat = await fs.promises.stat(f.path);
            const rel = relDir ? `${relDir}/${f.filename}` : f.filename;
            out.push({
              name: rel,
              path: rel,
              size: stat.size,
              mtime: stat.mtimeMs,
              originalName: f.originalname,
            });
            if (project && /\.html?$/i.test(rel)) {
              const savedFile = await readProjectFile(PROJECTS_DIR, req.params.id, rel, project.metadata);
              await ensureCurrentProjectFileVersion(
                PROJECTS_DIR,
                project.id,
                savedFile.name,
                savedFile.buffer.toString('utf8'),
                { source: 'manual', promptSource: 'manual' },
                project.metadata,
              );
            }
          } catch {
            // skip files that vanished mid-flight
          }
        }
        /** @type {import('@openpixo/contracts').UploadProjectFilesResponse} */
        const body = { files: out };
        res.json(body);
      } catch {
        sendApiError(res, 500, 'INTERNAL_ERROR', 'upload failed');
      }
    },
  );
}
