import sourceLineStyles from './FileViewer.source-line.module.css';
import { ConfirmDialog } from '@openpixo/components';
import { bindMotionPreviewActivity, unbindMotionPreviewActivity } from '../runtime/motion-preview-activity';
import { CenteredLoader } from './Loading';
import { HandoffButton } from './HandoffButton';
import { ViewerAddToChat } from './files/ViewerAddToChat';
import { previewStorageKey, readPreviewStorage, savePreviewStorageMessage } from '../runtime/preview-storage';
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { ArtifactExportFormat } from '../runtime/chat/artifact-export';

import { AnchoredMenuShell } from './chat/AnchoredMenuShell';
import { createPortal, flushSync } from 'react-dom';
import {
  getLatestHostPreviewNavigationFailure,
  subscribeHostPreviewNavigationFailure,
  type OpenPixoHostPreviewNavigationFailure,
} from '@openpixo/host';
import { APP_CHROME_FILE_ACTIONS_ID, APP_CHROME_FILE_ACTIONS_SELECTOR } from './AppChromeHeader';
import { type AgentInfo, type GameExportStatusResponse, type ProjectFileVersion, } from '@openpixo/contracts';
import { PREVIEW_OBSERVABILITY_HOST_STATE_MESSAGE_TYPE } from '@openpixo/contracts/runtime/preview-observability';
import { PREVIEW_URL_GUARD_MAX_HTML_BYTES } from '@openpixo/contracts/runtime/preview-guards';
import { appendResourceQuery } from "../lib/resource-url";
import { anonymizeArtifactId, artifactKindToTracking, type TrackingFileVersionSource, type TrackingArtifactKind, type TrackingProjectKind, } from '@openpixo/contracts/analytics';
import { useAnalytics } from '../analytics/provider';
import { exportErrorCode } from '../analytics/export-error-code';

import {
  reportPreviewIframeMessage,
  reportPreviewTransportRecovery,
  subscribePreviewIframeMessages,
  trackVisiblePreview,
  isPreviewFrameVisible,
  type PreviewTransportDocumentState,
  type PreviewTransportRecoverySignal,
} from '../observability/iframe-error';
import { trackArtifactExportResult, trackArtifactHeaderClick, trackArtifactToolbarClick, trackFileVersionModalClick, trackFileVersionModalSurfaceView, trackFileVersionRestoreResult, trackPageView, trackShareOptionPopoverClick } from '../analytics/events';
import { MarkdownRenderer, artifactRendererRegistry } from '../artifacts/renderer-registry';
import { renderMarkdownToSafeHtml } from '../artifacts/markdown';
import {
  artifactExportOriginProps,
  type ArtifactExportOriginProps,
} from '../artifacts/version-origin';
import {
  buildScrollAnchors,
  extractMarkdownBlockLines,
  mapScrollPosition,
  measureEditorBlockOffsets,
  measurePreviewBlockOffsets,
} from './markdown-scroll-sync';
import { useT, useI18n } from '../i18n';
import { useDismissOnOutsideInteraction } from '../hooks/useDismissOnOutsideInteraction';


import type { Dict, Locale } from '../i18n/types';
import { Model3dViewer } from './Model3dViewer';
import { fetchProjectFileVersion, fetchProjectFileVersions, fetchProjectFilePreview, fetchProjectPreviewBaseHref, fetchProjectFiles, fetchProjectFileText, fetchProjectFileTextPreview, uploadProjectFiles, projectFileUrl, projectRawUrl, renewProjectPreviewBaseScope, restoreProjectFileVersion, type ProjectPreviewBaseScope, writeProjectTextFile, } from '../providers/registry';
import type { ProjectFilePreview } from '../providers/registry';
import {
  downloadImageDataUrl,
  exportAsHtml,
  exportAsJsx,
  exportAsMd,
  exportAsPdf,
  exportAsZip,
  exportProjectAsHtml,
  exportPlayableGame,
  fetchGameExportStatus,
  exportProjectAsPdf,
  exportProjectAsZip,
  exportProjectImageDataUrl,
  exportProjectScreenshotPdf,
  exportSnapshotAsPdf,
  exportReactComponentAsHtml,
  exportReactComponentAsZip,
  captureHostIframeSnapshot,
  imageDataUrlToBlob,
  isOpenPixoHostAvailable,
  openSandboxedPreviewInNewTab,
  prepareImageExportTarget,
  requestPreviewSnapshot,
  type ExportProgress,
  type ImageExportFormat,
} from '../runtime/exports';
import { fetchAppVersionInfo } from '../providers/registry';

import { buildReactComponentSrcdoc } from '../runtime/react-component';
import { projectFileKind } from './files/file-kind';
import { actionRequestKey, shouldConsumeActionRequest } from '../runtime/action-request';
import { findHtmlEntriesReferencing } from '../runtime/jsx-module-refs';
import {
  buildLazySrcdocTransport,
  buildRedirectLoopBlockedDoc,
  buildSrcdoc,
  canActivateSrcDocTransport,
  htmlHasAuthoredBase,
  PREVIEW_REDIRECT_LOOP_MESSAGE,
} from '../runtime/srcdoc';
import {
  htmlNeedsFocusGuard,
  htmlNeedsLocalInteractionBridge,
  htmlNeedsPoweredPreview,
  htmlNeedsRedirectGuard,
  htmlNeedsSandboxShim,
  parseForceInline,
  shouldUrlLoadHtmlPreview,
  type UrlLoadDecision,
} from './file-viewer-render-mode';
import { htmlHasRelativeProjectAssetRefs, htmlHasRootRelativeProjectAssetRefs, normalizeRootRelativeProjectAssetRefs, rewriteInlinedCssAssetRefs, rewriteInlinedScriptAssetRefs } from './file-viewer-preview-assets';
import { resolvePoweredPreviewUrl } from '../runtime/powered-preview';
import { saveTemplate } from '../state/projects';
import type {
  ProjectFile,
} from '../types';
import { Icon } from './Icon';
import { RemixIcon } from './RemixIcon';
import { Toast } from './Toast';
import {
  LocalizedExportError,
  exportFailureToast,
  genericExportFailedToast,
} from './export-failure-toast';
import {
  useProjectPreviewContext,
  type ProjectResourceAuthority,
} from "./project-preview-context";
import { TopStackedToast } from './share/TopStackedToast';
import {
  PIXO_PREVIEW_KEEP_ALIVE,
  PooledIframe,
  previewIframeKeepAliveKey,
  useIframeKeepAlivePool,
} from './IframeKeepAlivePool';
import {
  getHtmlSourceSnapshot,
  htmlSourceSnapshotRefreshKey,
  invalidateHtmlSourceSnapshotFile,
  invalidateHtmlSourceSnapshotProject,
  setHtmlSourceSnapshot,
} from './html-source-snapshot-cache';


function resolveChromeActionsHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>(APP_CHROME_FILE_ACTIONS_SELECTOR)
    ?? document.getElementById(APP_CHROME_FILE_ACTIONS_ID);
}

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;
type PreviewViewportId = 'desktop' | 'tablet' | 'mobile';
type PreviewCanvasSize = { width: number; height: number; scrollLeft?: number; scrollTop?: number };
type PreviewScaleOptions = {
  canvasPadding?: number;
};
type PreviewViewportPreset = {
  id: PreviewViewportId;
  width: number | null;
  height: number | null;
  labelKey: keyof Dict;
  titleKey: keyof Dict;
};
const IMAGE_EXPORT_FORMAT_OPTIONS: Array<{
  value: ImageExportFormat;
  label: string;
  extension: string;
}> = [
  { value: 'png', label: 'PNG', extension: '.png' },
  { value: 'jpeg', label: 'JPEG', extension: '.jpg' },
  { value: 'webp', label: 'WebP', extension: '.webp' },
];
// Client-side prototype forms need submit events in every interactive preview.
// The ordinary sandbox retains its opaque origin and cannot access host APIs.
const HTML_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-downloads';
const SRC_DOC_PARSING_RECHECK_MS = 1500;
const SRC_DOC_PARSING_COMPLETION_TIMEOUT_MS = 10_000;
const BASE_PREVIEW_BRIDGE_QUERY = 'pixoPreviewBridge=scroll&pixoPreviewBridge=snapshot&pixoPreviewBridge=observability';
const HTML_PASSIVE_PREVIEW_FULL_TEXT_LIMIT = 2 * 1024 * 1024;
const HTML_ROUTING_TEXT_PREVIEW_LIMIT = 96 * 1024;

type HtmlSourceLoadMode = 'full' | 'routing-preview';
type PreviewAssetWarning = { filePath: string };

function previewTextNeedsFullSourceForSafeInline(source: string | null): boolean {
  if (!source) return false;
  return (
    htmlNeedsSandboxShim(source) ||
    htmlNeedsFocusGuard(source) ||
    htmlNeedsRedirectGuard(source)
  );
}


const PREVIEW_VIEWPORT_PRESETS: PreviewViewportPreset[] = [
  {
    id: 'desktop',
    width: null,
    height: null,
    labelKey: 'fileViewer.viewportDesktop',
    titleKey: 'fileViewer.viewportDesktopTitle',
  },
  {
    id: 'tablet',
    width: 820,
    height: 1180,
    labelKey: 'fileViewer.viewportTablet',
    titleKey: 'fileViewer.viewportTabletTitle',
  },
  {
    id: 'mobile',
    width: 390,
    height: 844,
    labelKey: 'fileViewer.viewportMobile',
    titleKey: 'fileViewer.viewportMobileTitle',
  },
];

function previewViewportIcon(viewport: PreviewViewportId): string {
  if (viewport === 'tablet') return 'tablet-line';
  if (viewport === 'mobile') return 'smartphone-line';
  return 'computer-line';
}

const EXPORT_READY_NUDGE_STORAGE_PREFIX = 'pixo:export-ready-nudge:';
const MAX_CACHED_PREVIEW_VIEWPORTS = 128;
const htmlPreviewViewportState = new Map<string, PreviewViewportId>();
// Desktop-preview zoom, keyed the same way as `htmlPreviewViewportState` above.
// HtmlViewer fully unmounts whenever the workspace tab switches away from this
// file (e.g. to the Files grid) and remounts when the user switches
// back — a plain `useState(100)` would reset to a fresh auto-fit pass on every
// such remount, silently overwriting a zoom the user had already landed on
// (issue rec:recvqaeMAGUdN2, seen as an unexplained snap to 85%). Caching the
// last known {zoom, zoomMode} per file lets the remount effect below restore
// it instead of defaulting, while a genuinely new file (no cache entry yet)
// still gets the normal auto-fit default.
const MAX_CACHED_PREVIEW_ZOOMS = 128;
const htmlPreviewZoomState = new Map<string, { zoom: number; zoomMode: 'auto' | 'manual' }>();
// Last measured desktop-preview content width per file, same key/cap shape as
// the zoom cache above. Seeding a remount from the last confirmed measurement
// (instead of `null`) avoids re-deriving auto-fit zoom from a cold "assume no
// overflow" guess while the fresh in-iframe measurement round-trip is still
// pending — that cold-start window was the other half of the 85% snap
// (rec:recvqaeMAGUdN2). A genuinely stale value still self-corrects once the
// real measurement message arrives (see onContentSizeMessage below) or the
// canvas-grow recovery in the auto-fit effect fires.
const MAX_CACHED_PREVIEW_CONTENT_WIDTHS = 128;
const PREVIEW_CONTENT_WIDTH_CACHE_VERSION = 2;
const SRC_DOC_ACTIVATION_RECOVERY_TIMEOUT_MS = 1500;
const SRC_DOC_READY_PROBE_TIMEOUT_MS = 1500;
const PREVIEW_SCOPE_RENEW_MARGIN_MS = 5 * 60 * 1000;
const PREVIEW_SCOPE_RETRY_MS = 15 * 1000;
const SRC_DOC_PREVIEW_FRAME_NAME_PREFIX = 'pixo-artifact-preview-srcdoc-';
const SRC_DOC_PREVIEW_FAILURE_FRESHNESS_MS = 10_000;
const MAX_CACHED_SRC_DOC_TRANSPORTS = 128;
let previewContentMeasurementDocumentEpochSequence = 0;
let previewContentMeasurementHostInstanceSequence = 0;
let previewTransportGenerationSequence = 0;
type SrcDocTransportCacheEntry = {
  sourceFingerprint: string;
  generation: string;
  srcDoc: string;
};
const htmlPreviewSrcDocTransportState = new Map<string, SrcDocTransportCacheEntry>();
const sharedPreviewBootstrapUrls = new WeakMap<typeof URL.createObjectURL, Map<string, string>>();
function nextPreviewContentMeasurementDocumentEpoch(): string {
  previewContentMeasurementDocumentEpochSequence += 1;
  return `preview-document-${previewContentMeasurementDocumentEpochSequence}`;
}
function nextPreviewContentMeasurementHostInstance(): string {
  previewContentMeasurementHostInstanceSequence += 1;
  return `preview-host-${previewContentMeasurementHostInstanceSequence}`;
}
function nextPreviewTransportGeneration(): string {
  previewTransportGenerationSequence += 1;
  return `preview-transport-${previewTransportGenerationSequence}`;
}
function previewSourceFingerprint(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  }
  return `${source.length}:${(hash >>> 0).toString(16)}`;
}
function cacheSrcDocTransport(key: string, entry: SrcDocTransportCacheEntry) {
  htmlPreviewSrcDocTransportState.delete(key);
  htmlPreviewSrcDocTransportState.set(key, entry);
  if (htmlPreviewSrcDocTransportState.size > MAX_CACHED_SRC_DOC_TRANSPORTS) {
    const oldest = htmlPreviewSrcDocTransportState.keys().next().value;
    if (oldest != null) htmlPreviewSrcDocTransportState.delete(oldest);
  }
}
function persistentPreviewBootstrapUrl(html: string, forceBlob = false): string | null {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (
    !html
    || typeof navigator === 'undefined'
    || /\bjsdom\b/i.test(userAgent)
    || (!forceBlob && !/\bElectron\//.test(userAgent))
    || typeof URL === 'undefined'
    || typeof URL.createObjectURL !== 'function'
    || typeof Blob === 'undefined'
  ) return null;
  const createObjectURL = URL.createObjectURL;
  const urlsByHtml = sharedPreviewBootstrapUrls.get(createObjectURL);
  const existing = urlsByHtml?.get(html);
  if (existing) return existing;

  // The bootstrap is intentionally tiny and immutable. Electron reliably
  // paints a Blob-backed document after the activation bridge replaces its
  // contents; the equivalent data: document can remain visually stale until
  // the user interacts even though its DOM is already complete. This URL is
  // shared for the app lifetime and never revoked because retained viewers can
  // keep referencing it while they are parked behind another file/project.
  // The full artifact never appears in the Blob; it arrives only through the
  // generation-checked activation bridge after this listener is ready.
  const url = createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const nextUrlsByHtml = urlsByHtml ?? new Map<string, string>();
  nextUrlsByHtml.set(html, url);
  if (!urlsByHtml) sharedPreviewBootstrapUrls.set(createObjectURL, nextUrlsByHtml);
  return url;
}

/**
 * Resolve a daemon resource against the actual app runtime origin.
 *
 * `projectRawUrl` intentionally returns a root-relative path for normal host
 * fetches. Injected documents are different: Electron loads them through an
 * origin-less bootstrap document, where `/api/...` has no useful project
 * origin. Pinning an absolute runtime URL keeps relative CSS, scripts, images,
 * and recovery navigation on the same daemon-backed origin as the app shell.
 */
function previewRuntimeUrl(href: string): string {
  const runtimeHref = typeof globalThis.location?.href === 'string'
    ? globalThis.location.href
    : 'http://openpixo.local/';
  return new URL(href, runtimeHref).href;
}
type PreviewContentWidthCacheEntry = {
  version: typeof PREVIEW_CONTENT_WIDTH_CACHE_VERSION;
  width: number;
  measuredClientWidth: number;
  overflow: boolean;
};
const htmlPreviewContentWidthState = new Map<string, PreviewContentWidthCacheEntry>();
const htmlPreviewDocumentEpochState = new Map<string, string>();
const MARKDOWN_CODE_BLOCK_ATTR = 'data-markdown-code-block';
const MARKDOWN_CODE_LANGUAGE_ATTR = 'data-code-language';
const MARKDOWN_COPY_BLOCK_ATTR = 'data-copy-code-block';
const MARKDOWN_COPY_BUTTON_CLASS = 'markdown-code-copy';
const MARKDOWN_COPY_TOAST_CLASS = 'markdown-code-toast';
const ABSOLUTE_MARKDOWN_IMAGE_SOURCE_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
      if (priorFocus?.isConnected) {
        try {
          priorFocus.focus({ preventScroll: true });
        } catch {
          priorFocus.focus();
        }
      }
    }
  }
}

function decorateMarkdownCodeBlocks(html: string): string {
  let blockIndex = 0;
  return html.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/g, (_match, attrs: string, content: string) => {
    const blockId = String(blockIndex++);
    const language = markdownCodeBlockLanguage(content);
    const languageAttr = language ? ` ${MARKDOWN_CODE_LANGUAGE_ATTR}="${escapeHtmlAttribute(language.label)}"` : '';
    return `<div class="markdown-code-block" ${MARKDOWN_CODE_BLOCK_ATTR}="${blockId}"${languageAttr}><pre${attrs}>${content}</pre></div>`;
  });
}

type MarkdownCodeLanguage = {
  lang: string;
  label: string;
};

function markdownCodeBlockLanguage(content: string): MarkdownCodeLanguage | null {
  const codeMatch = content.match(/<code\b([^>]*)>/);
  if (!codeMatch) return null;
  const classMatch = codeMatch[1]?.match(/\bclass=(["'])(.*?)\1/);
  const className = classMatch?.[2] ?? '';
  const languageClass = className
    .split(/\s+/)
    .map((item) => item.trim())
    .find((item) => /^(?:language|lang)-/i.test(item));
  if (!languageClass) return null;
  const raw = languageClass.replace(/^(?:language|lang)-/i, '').replace(/[^a-z0-9+#.-]/gi, '');
  if (!raw) return null;
  const aliases: Record<string, MarkdownCodeLanguage> = {
    bash: { lang: 'bash', label: 'Bash' },
    c: { lang: 'c', label: 'C' },
    cpp: { lang: 'cpp', label: 'C++' },
    css: { lang: 'css', label: 'CSS' },
    diff: { lang: 'diff', label: 'Diff' },
    dockerfile: { lang: 'dockerfile', label: 'Dockerfile' },
    go: { lang: 'go', label: 'Go' },
    graphql: { lang: 'graphql', label: 'GraphQL' },
    html: { lang: 'html', label: 'HTML' },
    java: { lang: 'java', label: 'Java' },
    js: { lang: 'javascript', label: 'JS' },
    javascript: { lang: 'javascript', label: 'JS' },
    json: { lang: 'json', label: 'JSON' },
    jsx: { lang: 'jsx', label: 'JSX' },
    markdown: { lang: 'markdown', label: 'Markdown' },
    md: { lang: 'markdown', label: 'Markdown' },
    php: { lang: 'php', label: 'PHP' },
    py: { lang: 'python', label: 'Python' },
    python: { lang: 'python', label: 'Python' },
    rb: { lang: 'ruby', label: 'Ruby' },
    ruby: { lang: 'ruby', label: 'Ruby' },
    rust: { lang: 'rust', label: 'Rust' },
    shell: { lang: 'shell', label: 'Shell' },
    sh: { lang: 'shell', label: 'Shell' },
    sql: { lang: 'sql', label: 'SQL' },
    swift: { lang: 'swift', label: 'Swift' },
    toml: { lang: 'toml', label: 'TOML' },
    ts: { lang: 'typescript', label: 'TS' },
    tsx: { lang: 'tsx', label: 'TSX' },
    typescript: { lang: 'typescript', label: 'TS' },
    xml: { lang: 'xml', label: 'XML' },
    yaml: { lang: 'yaml', label: 'YAML' },
    yml: { lang: 'yaml', label: 'YAML' },
  };
  return aliases[raw.toLowerCase()] ?? { lang: raw.toLowerCase(), label: raw.toUpperCase() };
}

async function highlightMarkdownCodeBlocks(html: string): Promise<string> {
  if (typeof document === 'undefined') return html;
  // renderMarkdownToSafeHtml supplies sanitized markup; parse it in an inert
  // document rather than assigning HTML into a live DOM element.
  const root = new DOMParser().parseFromString(html, 'text/html').body;
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(`[${MARKDOWN_CODE_BLOCK_ATTR}]`));
  if (blocks.length === 0) return html;
  const { highlightCode } = await import('../runtime/shiki');
  let changed = false;
  await Promise.all(blocks.map(async (block) => {
    const code = block.querySelector<HTMLElement>('pre > code');
    if (!code) return;
    const language = markdownCodeBlockLanguage(code.outerHTML);
    if (!language) return;
    const source = (code.textContent ?? '').replace(/\n$/, '');
    const highlighted = await highlightCode(source, language.lang);
    if (!highlighted) return;
    // Shiki's markup is library-generated, but its parser must also remain inert.
    const highlightedPre = new DOMParser().parseFromString(highlighted, 'text/html').body.firstElementChild;
    if (!(highlightedPre instanceof HTMLElement)) return;
    highlightedPre.classList.add('markdown-shiki');
    highlightedPre.setAttribute('data-lang', language.label);
    code.closest('pre')?.replaceWith(highlightedPre);
    block.setAttribute(MARKDOWN_CODE_LANGUAGE_ATTR, language.label);
    changed = true;
    return highlightedPre;
  }));
  return changed ? root.innerHTML : html;
}

function rewriteMarkdownImageSources(
  html: string,
  projectId: string,
  markdownPath: string
): string {
  return html.replace(/<img\b([^>]*?)\bsrc="([^"]*)"([^>]*)>/g, (match, before: string, src: string, after: string) => {
    const resolved = markdownImageSourceUrl(
      projectId,
      markdownPath,
      decodeHtmlAttribute(src)
    );
    if (!resolved) return match;
    const attrs = `${before}${after}`;
    const loadingAttr = /\sloading=/.test(attrs) ? '' : ' loading="lazy"';
    return `<img${before}src="${escapeHtmlAttribute(resolved)}"${loadingAttr}${after}>`;
  });
}

export function markdownImageSourceUrl(
  projectId: string,
  markdownPath: string,
  src: string
): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (ABSOLUTE_MARKDOWN_IMAGE_SOURCE_RE.test(trimmed)) return trimmed;
  const relativePath = trimmed.startsWith('/')
    ? normalizeMarkdownProjectPath(trimmed.slice(1))
    : normalizeMarkdownProjectPath(`${markdownDirectory(markdownPath)}/${trimmed}`);
  return relativePath
    ? projectFileUrl(projectId, relativePath)
    : null;
}

function markdownDirectory(path: string): string {
  const normalized = normalizeMarkdownProjectPath(path);
  const slash = normalized.lastIndexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : '';
}

function normalizeMarkdownProjectPath(path: string): string {
  const parts: string[] = [];
  for (const raw of path.replace(/\\/g, '/').split('/')) {
    const part = raw.trim();
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function markdownRelativeProjectPath(fromPath: string, targetPath: string): string {
  const fromDir = markdownDirectory(fromPath);
  const target = normalizeMarkdownProjectPath(targetPath);
  if (!fromDir) return target;
  if (target.startsWith(`${fromDir}/`)) return target.slice(fromDir.length + 1);
  const fromParts = fromDir.split('/').filter(Boolean);
  const targetParts = target.split('/').filter(Boolean);
  let common = 0;
  while (common < fromParts.length && common < targetParts.length && fromParts[common] === targetParts[common]) {
    common += 1;
  }
  const up = Array.from({ length: fromParts.length - common }, () => '..');
  const down = targetParts.slice(common);
  return [...up, ...down].join('/') || target;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setMarkdownCodeBlockCopiedState(block: HTMLElement, copied: boolean, t: TranslateFn) {
  const button = block.querySelector<HTMLButtonElement>(`.${MARKDOWN_COPY_BUTTON_CLASS}`);
  if (!button) return;
  const label = copied ? t('fileViewer.copied') : t('fileViewer.copy');
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.title = t('fileViewer.copyTitle');

  const existingToast = block.querySelector(`.${MARKDOWN_COPY_TOAST_CLASS}`);
  if (copied) {
    if (existingToast instanceof HTMLElement) {
      existingToast.textContent = t('fileViewer.copied');
      return;
    }
    const toast = document.createElement('span');
    toast.className = MARKDOWN_COPY_TOAST_CLASS;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = t('fileViewer.copied');
    button.insertAdjacentElement('afterend', toast);
    return;
  }

  existingToast?.remove();
}

function PreviewViewportControls({
  viewport,
  onViewport,
  t,
  tabIndex,
}: {
  viewport: PreviewViewportId;
  onViewport: (viewport: PreviewViewportId) => void;
  t: TranslateFn;
  tabIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const activePreset =
    PREVIEW_VIEWPORT_PRESETS.find((preset) => preset.id === viewport) ?? PREVIEW_VIEWPORT_PRESETS[0]!;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // The click-outside above can only see pointer events that reach THIS
    // document, and the preview is a sandboxed opaque-origin iframe: a click
    // landing on it dispatches inside the frame and never reaches the host.
    // Since the preview is the largest surface on screen, that left the menu
    // stuck open exactly where users reach to dismiss it (OPEND-2035).
    //
    // Focus moving into a frame is the one signal the host does get for that
    // click. Requiring the frame to actually hold focus keeps an ordinary
    // app switch — which blurs the window without handing focus to a frame —
    // from closing a menu the user never dismissed.
    const onWindowBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [open]);

  return (
    <div className="viewer-viewport-switcher" ref={menuRef}>
      <button
        type="button"
        className={`viewer-action viewer-viewport-trigger${open ? '' : ' pixo-tooltip'}`}
        aria-label={t('fileViewer.viewportAria')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        title={t(activePreset.titleKey)}
        data-tooltip={open ? undefined : t(activePreset.titleKey)}
        data-tooltip-placement="bottom"
        tabIndex={tabIndex}
        onClick={() => setOpen((value) => !value)}
      >
        <RemixIcon
          name={previewViewportIcon(activePreset.id)}
          size={14}
          className="viewer-viewport-icon"
        />
        <span>{t(activePreset.labelKey)}</span>
        <RemixIcon name="arrow-down-s-line" size={14} />
      </button>
      {open ? (
        <div className="viewer-viewport-menu" id={listboxId} role="listbox" aria-label={t('fileViewer.viewportAria')}>
          {PREVIEW_VIEWPORT_PRESETS.map((preset) => {
            const selected = viewport === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={`viewer-viewport-menu-item${selected ? ' active' : ''}`}
                role="option"
                aria-selected={selected}
                title={t(preset.titleKey)}
                onClick={() => {
                  onViewport(preset.id);
                  setOpen(false);
                }}
              >
                <span className="viewer-viewport-menu-label">
                  <RemixIcon name={previewViewportIcon(preset.id)} size={14} />
                  <span>{t(preset.labelKey)}</span>
                </span>
                {selected ? <Icon name="check" size={13} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function effectivePreviewScale(
  viewport: PreviewViewportId,
  previewScale: number,
  canvasSize?: PreviewCanvasSize,
  options?: PreviewScaleOptions,
) {
  if (viewport === 'desktop') return previewScale;
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport);
  if (!preset?.width || !preset.height || !canvasSize?.width || !canvasSize.height) return previewScale;
  const canvasPadding = options?.canvasPadding ?? 48;
  const availableWidth = Math.max(1, canvasSize.width - canvasPadding);
  const availableHeight = Math.max(1, canvasSize.height - canvasPadding);
  const fitScale = Math.min(1, availableWidth / preset.width, availableHeight / preset.height);
  return Math.min(previewScale, fitScale);
}

export function desktopPreviewAutoFitZoomPercent(
  canvasSize: PreviewCanvasSize | undefined,
  contentWidth?: number | null,
): number {
  if (!canvasSize?.width || !Number.isFinite(canvasSize.width)) return 100;
  if (!contentWidth || !Number.isFinite(contentWidth) || contentWidth <= canvasSize.width) return 100;
  return Math.max(1, Math.min(100, (canvasSize.width / contentWidth) * 100));
}

export type PreviewContentMeasurementRequest = {
  measurementId: string;
  generation: string;
  documentEpoch: string;
  canvasWidth: number;
  previewScale: number;
};

export type PreviewContentMeasurementResponse = {
  measurementId: string;
  generation: string;
  documentEpoch: string;
  scrollWidth: number | null;
  clientWidth: number | null;
};

type PreviewContentMeasurementResolution =
  | {
    action: 'accept';
    contentWidth: number;
    measuredClientWidth: number;
    overflow: boolean;
  }
  | { action: 'preserve' }
  | { action: 'remeasure-neutral' }
  | { action: 'ignore' };

const PREVIEW_CONTENT_WIDTH_EPSILON = 1;
const PREVIEW_SCALE_EPSILON = 0.0001;

/**
 * Resolves a content-width report against the exact viewport state that asked
 * for it. At a non-neutral zoom, html/body clientWidth expands inversely with
 * the scale shell. An equal scrollWidth/clientWidth report is therefore only
 * the viewport floor, not evidence that the artifact itself is that wide.
 */
export function resolveDesktopPreviewContentMeasurement(params: {
  request: PreviewContentMeasurementRequest;
  response: PreviewContentMeasurementResponse;
  currentGeneration: string;
  latestMeasurementId: string | null;
  currentCanvasWidth: number;
  currentPreviewScale: number;
  confirmedContentWidth: number | null;
  confirmedOverflow?: boolean | null;
}): PreviewContentMeasurementResolution {
  const {
    request,
    response,
    currentGeneration,
    latestMeasurementId,
    currentCanvasWidth,
    currentPreviewScale,
    confirmedContentWidth,
    confirmedOverflow,
  } = params;
  if (
    response.measurementId !== request.measurementId ||
    response.generation !== request.generation ||
    response.documentEpoch !== request.documentEpoch ||
    request.measurementId !== latestMeasurementId ||
    request.generation !== currentGeneration ||
    Math.abs(request.canvasWidth - currentCanvasWidth) > PREVIEW_CONTENT_WIDTH_EPSILON ||
    Math.abs(request.previewScale - currentPreviewScale) > PREVIEW_SCALE_EPSILON
  ) {
    return { action: 'ignore' };
  }

  const scrollWidth = typeof response.scrollWidth === 'number' &&
    Number.isFinite(response.scrollWidth) &&
    response.scrollWidth > 0
    ? Math.ceil(response.scrollWidth)
    : null;
  const clientWidth = typeof response.clientWidth === 'number' &&
    Number.isFinite(response.clientWidth) &&
    response.clientWidth > 0
    ? Math.ceil(response.clientWidth)
    : null;
  if (scrollWidth == null || clientWidth == null) return { action: 'ignore' };

  if (
    scrollWidth > clientWidth + PREVIEW_CONTENT_WIDTH_EPSILON &&
    Math.abs(request.previewScale - 1) > PREVIEW_SCALE_EPSILON
  ) {
    return confirmedContentWidth != null && confirmedOverflow === true
      ? { action: 'preserve' }
      : { action: 'remeasure-neutral' };
  }
  if (scrollWidth > clientWidth + PREVIEW_CONTENT_WIDTH_EPSILON) {
    return {
      action: 'accept',
      contentWidth: scrollWidth,
      measuredClientWidth: clientWidth,
      overflow: true,
    };
  }
  if (Math.abs(request.previewScale - 1) <= PREVIEW_SCALE_EPSILON) {
    return {
      action: 'accept',
      contentWidth: Math.max(1, Math.ceil(request.canvasWidth)),
      measuredClientWidth: clientWidth,
      overflow: false,
    };
  }
  return confirmedContentWidth == null || confirmedOverflow !== true
    ? { action: 'remeasure-neutral' }
    : { action: 'preserve' };
}

export function previewMeasurementFrameIsUsable(params: {
  connected: boolean;
  active: boolean;
  frameRect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>;
  canvasRect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>;
}): boolean {
  const { connected, active, frameRect, canvasRect } = params;
  if (!connected || !active) return false;
  if (frameRect.width <= 1 || frameRect.height <= 1) return false;
  if (canvasRect.width <= 1 || canvasRect.height <= 1) return false;
  const horizontalOverlap = Math.min(frameRect.right, canvasRect.right) - Math.max(frameRect.left, canvasRect.left);
  const verticalOverlap = Math.min(frameRect.bottom, canvasRect.bottom) - Math.max(frameRect.top, canvasRect.top);
  return horizontalOverlap > 1 && verticalOverlap > 1;
}

/**
 * The zoom percent a desktop preview opens at. Auto mode fits wide, single-scroll
 * HTML pages whose content overflows the canvas horizontally. Decks are the
 * explicit exception: they paginate and fit one slide to the iframe viewport
 * internally, so their measured document scrollWidth spans the whole slide
 * filmstrip. Running that filmstrip width through the wide-page fit collapses the
 * zoom toward the ~1% floor (issue rec:recvq3NXctofXr), so decks keep the manual
 * zoom (100% by default) and let their in-iframe fit do the work. Non-desktop
 * viewports and manual mode always use the caller's zoom.
 */
export function resolveDesktopPreviewZoomPercent(params: {
  zoomMode: 'auto' | 'manual';
  viewport: PreviewViewportId;
  manualZoomPercent: number;
  canvasSize: PreviewCanvasSize | undefined;
  contentWidth?: number | null;
}): number {
  const { zoomMode, viewport, manualZoomPercent, canvasSize, contentWidth } = params;
  if (zoomMode !== 'auto' || viewport !== 'desktop') return manualZoomPercent;
  return desktopPreviewAutoFitZoomPercent(canvasSize, contentWidth);
}

export function desktopPreviewDocumentContentWidth(doc: Document | null | undefined): number | null {
  if (!doc) return null;
  const root = doc.documentElement;
  const body = doc.body;
  const widths = [
    root?.scrollWidth,
    body?.scrollWidth,
    root?.offsetWidth,
    body?.offsetWidth,
    root?.clientWidth,
    body?.clientWidth,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return widths.length ? Math.max(...widths) : null;
}

function zoomPercentLabel(zoomPercent: number): string {
  return `${Math.round(zoomPercent)}%`;
}

type PreviewOverlayTransform = { scale: number; offsetX: number; offsetY: number };

export function previewOverlayTransform(
  viewport: PreviewViewportId,
  previewScale: number,
  canvasSize?: PreviewCanvasSize,
): PreviewOverlayTransform {
  const scale = effectivePreviewScale(viewport, previewScale, canvasSize);
  if (viewport === 'desktop') return { scale, offsetX: 0, offsetY: 0 };
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport);
  const pad = 24;
  if (!preset?.width || !preset.height) return { scale, offsetX: pad, offsetY: pad };
  const availableWidth = Math.max(1, (canvasSize?.width ?? preset.width * scale + pad * 2) - pad * 2);
  const scaledWidth = preset.width * scale;
  return {
    scale,
    offsetX: pad + Math.max(0, (availableWidth - scaledWidth) / 2),
    offsetY: pad,
  };
}

function usePreviewCanvasSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<PreviewCanvasSize | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({
        width: rect.width,
        height: rect.height,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
      });
    };
    measure();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);

  return [ref, size] as const;
}

function ensureMarkdownCodeBlockControls(root: HTMLElement, t: TranslateFn) {
  for (const block of root.querySelectorAll<HTMLElement>(`[${MARKDOWN_CODE_BLOCK_ATTR}]`)) {
    let button = block.querySelector<HTMLButtonElement>(`.${MARKDOWN_COPY_BUTTON_CLASS}`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = MARKDOWN_COPY_BUTTON_CLASS;
      const blockId = block.getAttribute(MARKDOWN_CODE_BLOCK_ATTR) ?? '';
      button.setAttribute(MARKDOWN_COPY_BLOCK_ATTR, blockId);
      block.prepend(button);
    }
    setMarkdownCodeBlockCopiedState(block, false, t);
  }
}

function waitForIframeLoadOrTimeout(iframe: HTMLIFrameElement, timeout = 750): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      iframe.removeEventListener('load', finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeout);
    iframe.addEventListener('load', finish, { once: true });
  });
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    window.setTimeout(resolve, 0);
  });
}

function temporarilyExposeIframeForSnapshot(iframe: HTMLIFrameElement): () => void {
  const previousVisibility = iframe.style.visibility;
  const previousOpacity = iframe.style.opacity;
  const previousPointerEvents = iframe.style.pointerEvents;
  iframe.style.visibility = 'visible';
  iframe.style.opacity = '0.001';
  iframe.style.pointerEvents = 'none';
  return () => {
    iframe.style.visibility = previousVisibility;
    iframe.style.opacity = previousOpacity;
    iframe.style.pointerEvents = previousPointerEvents;
  };
}

async function requestPreviewSnapshotWithRetry(
  iframe: HTMLIFrameElement,
  options?: { full?: boolean },
): Promise<Awaited<ReturnType<typeof requestPreviewSnapshot>>> {
  const timeouts = [1500, 3000, 6000];
  for (const timeout of timeouts) {
    const snapshot = await requestPreviewSnapshot(iframe, timeout, options);
    if (snapshot) return snapshot;
    await waitForAnimationFrame();
  }
  return null;
}

function previewViewportStateKey(projectId: string, file: Pick<ProjectFile, 'name' | 'path'>): string {
  return `${projectId}:${file.path || file.name}`;
}

function setPreviewViewportCached(key: string, viewport: PreviewViewportId) {
  htmlPreviewViewportState.set(key, viewport);
  if (htmlPreviewViewportState.size > MAX_CACHED_PREVIEW_VIEWPORTS) {
    const oldest = htmlPreviewViewportState.keys().next().value;
    if (oldest != null) htmlPreviewViewportState.delete(oldest);
  }
}

function setPreviewZoomCached(key: string, zoom: number, zoomMode: 'auto' | 'manual') {
  htmlPreviewZoomState.set(key, { zoom, zoomMode });
  if (htmlPreviewZoomState.size > MAX_CACHED_PREVIEW_ZOOMS) {
    const oldest = htmlPreviewZoomState.keys().next().value;
    if (oldest != null) htmlPreviewZoomState.delete(oldest);
  }
}

function setPreviewContentWidthCached(key: string, entry: Omit<PreviewContentWidthCacheEntry, 'version'> | null) {
  if (entry == null) {
    htmlPreviewContentWidthState.delete(key);
    return;
  }
  htmlPreviewContentWidthState.set(key, {
    version: PREVIEW_CONTENT_WIDTH_CACHE_VERSION,
    ...entry,
  });
  if (htmlPreviewContentWidthState.size > MAX_CACHED_PREVIEW_CONTENT_WIDTHS) {
    const oldest = htmlPreviewContentWidthState.keys().next().value;
    if (oldest != null) htmlPreviewContentWidthState.delete(oldest);
  }
}

function getPreviewContentWidthCached(key: string): PreviewContentWidthCacheEntry | null {
  const entry = htmlPreviewContentWidthState.get(key);
  return entry?.version === PREVIEW_CONTENT_WIDTH_CACHE_VERSION ? entry : null;
}

function getPreviewDocumentEpoch(key: string): string {
  const cached = htmlPreviewDocumentEpochState.get(key);
  if (cached) return cached;
  const epoch = nextPreviewContentMeasurementDocumentEpoch();
  htmlPreviewDocumentEpochState.set(key, epoch);
  if (htmlPreviewDocumentEpochState.size > MAX_CACHED_PREVIEW_CONTENT_WIDTHS) {
    const oldest = htmlPreviewDocumentEpochState.keys().next().value;
    if (oldest != null) htmlPreviewDocumentEpochState.delete(oldest);
  }
  return epoch;
}

interface Props {
  projectId: string;
  projectKind: TrackingProjectKind;
  file: ProjectFile;
  liveHtml?: string;
  filesRefreshKey?: number;
  streaming?: boolean;
  /** Actual run state; unlike streaming, excludes read-only/loading UI locks. */
  motionPreviewMuted?: boolean;
  onFileSaved?: () => Promise<void> | void;
  onFileWritten?: (file: ProjectFile) => void;
  // Open `openName` as a tab (focusing it) and close `closeName` in one
  // atomic tab-state update. The React module pointer uses this to jump to the
  // HTML entry that renders a module and drop the dead-end module tab.
  onOpenFileReplacing?: (openName: string, closeName: string) => void;
  // Bumped nonce asking this viewer to open its Download/Export menu (chat-side
  // "Download" next-step action).
  downloadRequest?: { nonce: number; anchorId?: string } | null;
  sourceLineRequest?: { line: number; nonce: number } | null;
  // Read-only viewer of a team-shared project: the viewer can comment but not
  // edit, export, share, download, or send changes to Chat.
  viewerOnly?: boolean;
  projectName?: string;
  projectDir?: string | null;
  agents?: AgentInfo[];
  artifactId?: string;
  artifactKind?: TrackingArtifactKind;
  metricsConsent?: boolean;
  installationId?: string | null;
  /** False while this viewer is retained offscreen for an instant tab revisit. */
  workspaceActive?: boolean;
}

function FileViewerLoadingSkeleton() {
  const t = useT();
  return (
    <div
      className="viewer-loading"
      role="status"
      aria-busy="true"
      aria-label={t('fileViewer.loading')}
    >
      <div className="viewer-loading-stage" aria-hidden="true">
        <span className="viewer-loading-card viewer-loading-card-back viewer-loading-card-back-two" />
        <span className="viewer-loading-card viewer-loading-card-back viewer-loading-card-back-one" />
        <span className="viewer-loading-card viewer-loading-card-main">
          <span className="viewer-loading-kicker" />
          <span className="viewer-loading-title" />
          <span className="viewer-loading-title viewer-loading-title-short" />
          <span className="viewer-loading-rule" />
          <span className="viewer-loading-content">
            <span className="viewer-loading-copy">
              <span className="viewer-loading-line" />
              <span className="viewer-loading-line viewer-loading-line-medium" />
              <span className="viewer-loading-line viewer-loading-line-short" />
            </span>
            <span className="viewer-loading-chart">
              <span className="viewer-loading-bar viewer-loading-bar-one" />
              <span className="viewer-loading-bar viewer-loading-bar-two" />
              <span className="viewer-loading-bar viewer-loading-bar-three" />
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

// Memoized so FileWorkspace-local state churn (tab drag hover, closing a
// NEIGHBORING tab, launcher toggles) skips this whole subtree — the live
// preview iframes below are the most expensive thing on screen. Relies on
// FileWorkspace passing identity-stable props (see the activeFile* memos
// there).
type PendingShareUpdateAfterLogin = {
  projectId: string; fileName: string; slug: string; authorizationScopeKey: string; expiresAt: number;
};

export const FileViewer = memo(function FileViewer({
  projectId,
  projectKind,
  file,
  liveHtml,
  filesRefreshKey = 0,
  streaming,
  motionPreviewMuted = false,
  onFileSaved,
  onFileWritten,
  onOpenFileReplacing,
  downloadRequest,
  sourceLineRequest = null,
  viewerOnly = false,
  projectName,
  projectDir,
  agents,
  artifactId,
  artifactKind,
  metricsConsent,
  installationId,
  workspaceActive = true,
}: Props) {
  const t = useT();
  // Survives a temporary HtmlViewer unmount while workspace authority refreshes.
  const pendingShareUpdateAfterLoginRef = useRef<PendingShareUpdateAfterLogin | null>(null);

  if (pendingShareUpdateAfterLoginRef.current
    && (pendingShareUpdateAfterLoginRef.current.projectId !== projectId
      || pendingShareUpdateAfterLoginRef.current.fileName !== file.name)) {
    pendingShareUpdateAfterLoginRef.current = null;
  }
  const projectPreviewContext = useProjectPreviewContext();
  const projectResourceAuthority = projectPreviewContext.projectResourceAuthority
    ?? ('local');
  const projectResourceReadAllowed = projectResourceAuthority === 'local';
  const rendererMatch = artifactRendererRegistry.resolve({
    file,
  });

  // studio_view artifact — fire once per (project, file) pair so the
  // activation funnel can attribute "user opened the produced artifact"
  // even when the sub-viewer below is HtmlViewer / MarkdownViewer / etc.
  // artifact_id is anonymized to satisfy the CSV's no-filename rule.
  const analytics = useAnalytics();
  const studioViewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!workspaceActive) return;
    const key = `${projectId}::${file.name}`;
    if (studioViewKeyRef.current === key) return;
    studioViewKeyRef.current = key;
    trackPageView(analytics.track, {
      page_name: 'artifact',
    });
  }, [projectId, projectKind, file.name, file.kind, rendererMatch?.renderer.id, analytics.track, workspaceActive]);
  useEffect(() => {
    if (projectResourceReadAllowed) return;
    invalidateHtmlSourceSnapshotProject(projectId);
  }, [projectId, projectResourceReadAllowed]);

  if (!projectResourceReadAllowed) {
    if (projectResourceAuthority === 'denied') {
      return (
        <div className="viewer">
          <div className="viewer-body">
            <div className="viewer-empty">{t('fileViewer.previewUnavailable')}</div>
          </div>
        </div>
      );
    }
    return <FileViewerLoadingSkeleton />;
  }

  if (sourceLineRequest) return <TextViewer projectId={projectId} file={file} sourceLineRequest={sourceLineRequest} />;

  if (rendererMatch?.renderer.id === 'html') {
    return (
      <HtmlViewer
        projectId={projectId}
        projectKind={projectKind}
        file={file}
        pendingShareUpdateAfterLoginRef={pendingShareUpdateAfterLoginRef}


        liveHtml={liveHtml}
        filesRefreshKey={filesRefreshKey}
        streaming={Boolean(streaming)}
        motionPreviewMuted={motionPreviewMuted}
        onFileSaved={onFileSaved}
        onOpenFileReplacing={onOpenFileReplacing}
        downloadRequest={downloadRequest}
        viewerOnly={viewerOnly}
        projectName={projectName}
        projectDir={projectDir}
        agents={agents}
        artifactId={artifactId}
        artifactKind={artifactKind}
        metricsConsent={metricsConsent}
        installationId={installationId}
        workspaceActive={workspaceActive}
      />
    );
  }
  if (rendererMatch?.renderer.id === 'react-component') {
    return (
      <ReactComponentViewer
        projectId={projectId}
        projectKind={projectKind}
        file={file}
        onOpenFileReplacing={onOpenFileReplacing}
        projectName={projectName}
        projectDir={projectDir}
        agents={agents}
        artifactId={artifactId}
        artifactKind={artifactKind}
        metricsConsent={metricsConsent}
        installationId={installationId}
        viewerOnly={viewerOnly}
        workspaceActive={workspaceActive}
      />
    );
  }
  if (rendererMatch?.renderer.id === 'markdown') {
    return (
      <MarkdownViewer
        projectId={projectId}
        file={file}
        onFileSaved={onFileSaved}
        onFileWritten={onFileWritten}
        viewerOnly={viewerOnly}
      />
    );
  }
  if (rendererMatch?.renderer.id === 'svg') {
    return <SvgViewer projectId={projectId} file={file} />;
  }
  if (file.kind === 'image') {
    return <ImageViewer projectId={projectId} file={file} />;
  }
  if (file.kind === 'video') {
    return <VideoViewer projectId={projectId} file={file} />;
  }
  if (file.kind === 'audio') {
    return <AudioViewer projectId={projectId} file={file} />;
  }
  if (file.kind === 'model3d') {
    return <ModelViewer projectId={projectId} file={file} />;
  }
  const fileKind = projectFileKind(file);
  if (fileKind === 'text' || fileKind === 'code') {
    return <TextViewer projectId={projectId} file={file} />;
  }
  if (
    file.kind === 'pdf' ||
    file.kind === 'document' ||
    file.kind === 'presentation' ||
    file.kind === 'spreadsheet'
  ) {
    return <DocumentPreviewViewer projectId={projectId} file={file} />;
  }
  return <BinaryViewer projectId={projectId} file={file} />;
});

export function FileActions({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();

  return (
    <div className="viewer-toolbar-actions">
      <ViewerAddToChat file={file} />
      <a
        className="ghost-link"
        href={projectFileUrl(projectId, file.name)}
        download={file.name}
      >
        {t('fileViewer.download')}
      </a>
      <a
        className="ghost-link"
        href={projectFileUrl(projectId, file.name)}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t('fileViewer.open')}
      </a>
    </div>
  );
}

function formatVersionDateTime(value: number | undefined, locale: Locale): string {
  const date = new Date(Number(value) || Date.now());
  try {
    return date.toLocaleString(locale, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toLocaleString();
  }
}

function isHtmlVersionableFile(file: ProjectFile): boolean {
  return file.kind === 'html' || /\.html?$/i.test(file.name);
}

function fileVersionSourceLabel(version: ProjectFileVersion, t: TranslateFn): string {
  if (version.source === 'sync') return t('fileViewer.versions.sourceSync');
  if (version.source === 'manual') return t('fileViewer.versions.sourceManual');
  if (version.source === 'restore') return t('fileViewer.versions.sourceRestore');
  return t('fileViewer.versions.sourceAi');
}

function fileVersionSourceClassName(version: ProjectFileVersion): string {
  if (version.source === 'sync') return 'sync';
  if (version.source === 'manual') return 'manual';
  if (version.source === 'restore') return 'restore';
  return 'ai';
}

// Any unknown/legacy source value counts as 'ai', matching the label and
// class-name fallbacks above.
function fileVersionSourceToTracking(version: ProjectFileVersion): TrackingFileVersionSource {
  if (version.source === 'sync') return 'sync';
  if (version.source === 'manual') return 'manual';
  if (version.source === 'restore') return 'restore';
  return 'ai';
}

export function fileVersionPreviewOptions(
  projectId: string,
  fileName: string,
  source: string | null | undefined
) {
  return {
    baseHref: projectRawUrl(projectId, baseDirFor(fileName)),
  };
}

function fileVersionPreviewSrcDoc(
  projectId: string,
  fileName: string,
  source: string
) {
  return buildSrcdoc(source, {
    ...fileVersionPreviewOptions(projectId, fileName, source),
    previewFocusGuard: true,
  });
}

function fileVersionExportTitle(fileName: string, version: ProjectFileVersion): string {
  const base = fileName.replace(/\.html?$/i, '') || fileName;
  return `${base}-v${version.version}`;
}

type HtmlVersionExportContext = {
  content: string;
  title: string;
  versionId?: string;
  version?: ProjectFileVersion;
};

type ExportToastState = {
  message: string;
  details?: string | null;
  tone: 'default' | 'success' | 'error' | 'loading';
};

function FileVersionManagerModal({
  projectId,
  projectKind,
  file,
  currentSource,
  entryFrom,
  onExportPdf,
  onOpenImageExport,
  onExportZip,
  onExportHtml,
  exportToast,
  onExportToastDismiss,
  onClose,
  onRestored,
  viewerOnly = false,
}: {
  projectId: string;
  projectKind: TrackingProjectKind;
  file: ProjectFile;
  currentSource: string | null;
  entryFrom: 'toolbar' | 'more_menu';
  onExportPdf?: (context: HtmlVersionExportContext) => void;
  onOpenImageExport?: (context: HtmlVersionExportContext) => Promise<void> | void;
  onExportZip?: (context: HtmlVersionExportContext) => void;
  onExportHtml?: (context: HtmlVersionExportContext) => void;
  exportToast?: ExportToastState | null;
  onExportToastDismiss?: () => void;
  onClose: () => void;
  onRestored: (content: string, version: ProjectFileVersion) => Promise<void> | void;
  // Read-only viewer of a team-shared project can browse versions but not restore.
  viewerOnly?: boolean;
}) {
  const { locale, t } = useI18n();
  const analytics = useAnalytics();

  const tRef = useRef(t);
  const [versions, setVersions] = useState<ProjectFileVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(currentSource);
  const [selectedContentVersionId, setSelectedContentVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [search, setSearch] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const restorePopoverId = useId();
  const [downloadMenuVersionId, setDownloadMenuVersionId] = useState<string | null>(null);
  const [versionExportToast, setVersionExportToast] = useState<ExportToastState | null>(null);
  const [versionImageExportVersionId, setVersionImageExportVersionId] = useState<string | null>(null);
  const [versionImageExportFormat, setVersionImageExportFormat] = useState<ImageExportFormat>('png');
  const [versionImageExportInFlight, setVersionImageExportInFlight] = useState(false);
  const versionImageExportTitleId = useId();
  const versionPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);
  // Track which srcDoc the iframe has finished rendering. Deriving readiness by
  // comparing to the current srcDoc during render (rather than toggling a bool
  // in a post-paint effect) keeps the overlay up across a switch with no
  // one-frame flicker while the new document reparses.
  const [loadedSrcDoc, setLoadedSrcDoc] = useState<string | null>(null);
  // Client-side cache of fetched version HTML keyed by version id. Revisiting a
  // version is then zero-fetch (and, because the srcDoc string value is stable,
  // zero-reparse). `inFlightRef` dedupes concurrent hover-prefetch + click.
  const contentCacheRef = useRef<Map<string, string>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const trackingArtifactId = useMemo(
    () => anonymizeArtifactId({ projectId, fileName: file.name }),
    [projectId, file.name],
  );
  const trackingArtifactKind = artifactKindToTracking({ fileKind: file.kind ?? null });
  const fireModalClick = (
    element:
      | 'version_item'
      | 'open_in_new_tab'
      | 'restore'
      | 'restore_confirm'
      | 'restore_cancel',
    extra?: {
      version_source?: TrackingFileVersionSource;
      version_is_current?: boolean;
      viewport?: PreviewViewportId;
    },
  ) => {
    trackFileVersionModalClick(analytics.track, {
      page_name: 'artifact',
      area: 'file_version_modal',
      element,
      artifact_id: trackingArtifactId,
      artifact_kind: trackingArtifactKind,
      project_id: projectId,
      project_kind: projectKind,
      version_count: versions.length,
      ...extra,
    });
  };
  // One impression per modal open. The component unmounts on close, so a
  // fire-once ref is enough — no dependency bookkeeping needed.
  const surfaceViewFiredRef = useRef(false);
  useEffect(() => {
    if (surfaceViewFiredRef.current) return;
    surfaceViewFiredRef.current = true;
    trackFileVersionModalSurfaceView(analytics.track, {
      page_name: 'artifact',
      area: 'file_version_modal',
      entry_from: entryFrom,
      artifact_id: trackingArtifactId,
      artifact_kind: trackingArtifactKind,
      project_id: projectId,
      project_kind: projectKind,
    });
  }, [analytics.track, entryFrom, projectId, projectKind, trackingArtifactId, trackingArtifactKind]);
  const versionById = useMemo(() => {
    const map = new Map<string, ProjectFileVersion>();
    for (const version of versions) map.set(version.id, version);
    return map;
  }, [versions]);
  const selectedVersion =
    (selectedId ? versionById.get(selectedId) : undefined) ??
    versions.find((version) => version.current) ??
    versions[0] ??
    null;
  const versionCountLabel = versions.length === 1
    ? t('fileViewer.versions.countOne')
    : t('fileViewer.versions.countMany', { count: versions.length });
  // Show the filter box only once the list is long enough to need it.
  const showSearch = versions.length > 3;
  const normalizedSearch = search.trim().toLowerCase();
  const visibleVersions = useMemo(() => {
    if (!showSearch || !normalizedSearch) return versions;
    return versions.filter((version) => {
      const restoredFrom = version.restoreFromVersionId
        ? versionById.get(version.restoreFromVersionId)
        : null;
      const haystack = [
        `v${version.version}`,
        `version ${version.version}`,
        version.prompt ?? '',
        version.label ?? '',
        fileVersionSourceLabel(version, t),
        formatVersionDateTime(version.createdAt, locale),
        restoredFrom ? `v${restoredFrom.version}` : '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [showSearch, normalizedSearch, versions, versionById, t, locale]);
  const panelFileName = file.name.split('/').pop() || file.name;
  const selectedDate = selectedVersion ? formatVersionDateTime(selectedVersion.createdAt, locale) : file.name;
  const versionImageExportVersion = versionImageExportVersionId
    ? versionById.get(versionImageExportVersionId) ?? null
    : null;
  const visibleExportToast = versionExportToast ?? exportToast ?? null;
  const selectedContentMatchesVersion = Boolean(selectedId && selectedContentVersionId === selectedId && selectedContent);
  const restoreDisabled =
    viewerOnly || !selectedVersion || selectedVersion.current || restoring || loadingContent || !selectedContentMatchesVersion;
  const srcDoc = useMemo(() => {
    if (!selectedContent) return '';
    return fileVersionPreviewSrcDoc(projectId, file.name, selectedContent);
  }, [file.name, projectId, selectedContent]);
  const frameReady = loadedSrcDoc === srcDoc;

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Fetch a single version's HTML into the cache exactly once. Reused by the
  // selection effect and by hover/focus prefetch so a click lands on warm data.
  const primeVersionContent = useCallback((versionId: string): Promise<void> => {
    if (contentCacheRef.current.has(versionId)) return Promise.resolve();
    const pending = inFlightRef.current.get(versionId);
    if (pending) return pending;
    const request = fetchProjectFileVersion(
      projectId,
      file.name,
      versionId
    )
      .then((result) => {
        if (result) contentCacheRef.current.set(versionId, result.content);
      })
      .catch(() => {})
      .finally(() => {
        inFlightRef.current.delete(versionId);
      });
    inFlightRef.current.set(versionId, request);
    return request;
  }, [file.name, projectId,]);

  const loadVersions = useCallback(async (preferredId?: string | null) => {
    setLoading(true);
    setError(null);
    const result = await fetchProjectFileVersions(projectId, file.name);
    if (!result) {
      setError(tRef.current('fileViewer.versions.loadFailed'));
      setLoading(false);
      return;
    }
    const nextVersions = [...result.versions].sort((a, b) => b.version - a.version);
    setVersions(nextVersions);
    // Seed the cache with the live document so opening the modal renders the
    // current version instantly — no round-trip for the version you're on.
    const currentVersion = nextVersions.find((version) => version.current);
    if (currentVersion && currentSource != null && !contentCacheRef.current.has(currentVersion.id)) {
      contentCacheRef.current.set(currentVersion.id, currentSource);
    }
    const nextSelected =
      (preferredId ? nextVersions.find((version) => version.id === preferredId) : null) ??
      currentVersion ??
      nextVersions[0] ??
      null;
    setSelectedId(nextSelected?.id ?? null);
    setLoading(false);
  }, [currentSource, file.name, projectId,]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    setConfirmRestore(false);
    setDownloadMenuVersionId(null);
  }, [selectedId]);

  useEffect(() => {
    if (!downloadMenuVersionId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.file-version-download-menu, .artifact-version-panel__download')) return;
      setDownloadMenuVersionId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [downloadMenuVersionId]);

  // Clicking anywhere outside dismisses the panel, like every other popover
  // on this surface — but dismissal is LAYERED: while an inner popover
  // (download menu / restore confirm) is open, the outside click belongs to
  // that layer's own dismiss handler and must not also tear down the whole
  // panel. The toolbar entry that toggles the panel is excluded so its own
  // toggle keeps working without a close/reopen race.
  useEffect(() => {
    if (confirmRestore || downloadMenuVersionId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          '.artifact-version-panel, .file-version-download-menu, .file-version-restore-confirm, [data-pixo-version-entry]',
        )
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose, confirmRestore, downloadMenuVersionId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedContent(null);
      setSelectedContentVersionId(null);
      return;
    }
    // Cache hit: swap instantly with no fetch, no flash.
    const cached = contentCacheRef.current.get(selectedId);
    if (cached !== undefined) {
      setSelectedContent(cached);
      setSelectedContentVersionId(selectedId);
      setLoadingContent(false);
      setError(null);
      return;
    }
    // Cache miss: keep the previous preview mounted under the loading overlay
    // (do NOT clear selectedContent) so switching never blanks to white.
    let cancelled = false;
    setLoadingContent(true);
    setError(null);
    void primeVersionContent(selectedId).then(() => {
      if (cancelled) return;
      const next = contentCacheRef.current.get(selectedId);
      if (next === undefined) {
        setSelectedContent(null);
        setSelectedContentVersionId(null);
        setError(tRef.current('fileViewer.versions.previewFailed'));
      } else {
        setSelectedContent(next);
        setSelectedContentVersionId(selectedId);
      }
      setLoadingContent(false);
    });
    return () => {
      cancelled = true;
    };
  }, [primeVersionContent, selectedId]);

  // Safety net: if the iframe's load event is ever missed, clear the overlay
  // after a grace period so it can't get stuck over a rendered document.
  useEffect(() => {
    if (!srcDoc || loadedSrcDoc === srcDoc) return;
    const fallback = window.setTimeout(() => setLoadedSrcDoc(srcDoc), 6000);
    return () => window.clearTimeout(fallback);
  }, [srcDoc, loadedSrcDoc]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (versionImageExportVersionId) {
        if (!versionImageExportInFlight) setVersionImageExportVersionId(null);
        return;
      }
      if (downloadMenuVersionId) {
        setDownloadMenuVersionId(null);
        return;
      }
      if (confirmRestore) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    onClose,
    confirmRestore,
    downloadMenuVersionId,
    versionImageExportVersionId,
    versionImageExportInFlight,
  ]);

  async function ensureVersionContent(version: ProjectFileVersion): Promise<string | null> {
    const cached = contentCacheRef.current.get(version.id);
    if (cached !== undefined) return cached;
    await primeVersionContent(version.id);
    const content = contentCacheRef.current.get(version.id);
    if (content === undefined) {
      setError(t('fileViewer.versions.previewFailed'));
      return null;
    }
    return content;
  }

  async function runVersionExport(
    version: ProjectFileVersion,
    action: (content: string, title: string) => Promise<unknown> | unknown,
  ): Promise<void> {
    setDownloadMenuVersionId(null);
    setError(null);
    setVersionExportToast({ message: t('fileViewer.exportingProgress'), tone: 'loading' });
    const content = await ensureVersionContent(version);
    if (!content) {
      setVersionExportToast(genericExportFailedToast(t));
      return;
    }
    try {
      contentCacheRef.current.set(version.id, content);
      setSelectedId(version.id);
      setSelectedContent(content);
      setSelectedContentVersionId(version.id);
      setLoadingContent(false);
      await waitForAnimationFrame();
      await waitForAnimationFrame();
      const result = await action(content, fileVersionExportTitle(file.name, version));
      if (result === 'cancelled') {
        setVersionExportToast(null);
        return;
      }
      setVersionExportToast({ message: t('fileViewer.exportDone'), tone: 'success' });
    } catch (err) {
      setVersionExportToast(exportFailureToast(err, t));
    }
  }

  async function captureVersionPreviewSnapshot(options?: { full?: boolean }) {
    const iframe = versionPreviewIframeRef.current;
    if (!iframe) return null;
    await waitForIframeLoadOrTimeout(iframe, 250);
    await waitForAnimationFrame();
    await waitForAnimationFrame();
    if (options?.full) return requestPreviewSnapshotWithRetry(iframe, options);
    const hostSnapshot = await captureHostIframeSnapshot(iframe);
    if (hostSnapshot) return hostSnapshot;
    return requestPreviewSnapshotWithRetry(iframe, options);
  }

  async function runProjectVersionExport(
    version: ProjectFileVersion,
    action: (context: HtmlVersionExportContext) => Promise<unknown> | unknown,
  ): Promise<void> {
    setDownloadMenuVersionId(null);
    setError(null);
    setVersionExportToast({ message: t('fileViewer.exportingProgress'), tone: 'loading' });
    const content = await ensureVersionContent(version);
    if (!content) {
      setVersionExportToast(genericExportFailedToast(t));
      return;
    }
    const context: HtmlVersionExportContext = {
      content,
      title: version.current ? file.name.replace(/\.html?$/i, '') || file.name : fileVersionExportTitle(file.name, version),
      version,
      ...(version.current ? {} : { versionId: version.id }),
    };
    setVersionExportToast(null);
    await action(context);
  }

  async function exportVersionPdf(version: ProjectFileVersion) {
    if (onExportPdf) {
      await runProjectVersionExport(version, onExportPdf);
      return;
    }
    await runVersionExport(version, async (_content, title) => {
      const snapshot = await captureVersionPreviewSnapshot({ full: true });
      if (!snapshot) throw new Error('version PDF snapshot unavailable');
      await exportSnapshotAsPdf(snapshot, title);
    });
  }

  async function exportVersionImage(version: ProjectFileVersion, format: ImageExportFormat) {
    await runVersionExport(version, async (_content, title) => {
      const snapshot = await captureVersionPreviewSnapshot({ full: true });
      if (!snapshot) throw new LocalizedExportError(t('fileViewer.exportImageFailed'));
      const blob = await imageDataUrlToBlob(snapshot.dataUrl, format);
      if (blob.size <= 0) throw new LocalizedExportError(t('fileViewer.exportImageFailed'));
      const target = await prepareImageExportTarget(title, format, { useNativePicker: false });
      if (!target) return 'cancelled';
      if (target.method === 'download' && format === 'png') {
        downloadImageDataUrl(snapshot.dataUrl, target.filename);
      } else {
        await target.save(blob);
      }
    });
  }

  async function handleVersionImageExportSave() {
    if (!versionImageExportVersion || versionImageExportInFlight) return;
    setVersionImageExportInFlight(true);
    const version = versionImageExportVersion;
    const format = versionImageExportFormat;
    setVersionImageExportVersionId(null);
    try {
      await exportVersionImage(version, format);
    } finally {
      setVersionImageExportInFlight(false);
    }
  }

  function openVersionImageExport(version: ProjectFileVersion) {
    setDownloadMenuVersionId(null);
    if (onOpenImageExport) {
      void runProjectVersionExport(version, (context) => {
        onClose();
        window.requestAnimationFrame(() => {
          void onOpenImageExport(context);
        });
      });
      return;
    }
    setSelectedId(version.id);
    void primeVersionContent(version.id);
    setVersionImageExportFormat('png');
    setVersionImageExportVersionId(version.id);
  }

  function exportVersionZip(version: ProjectFileVersion) {
    if (onExportZip) {
      void runProjectVersionExport(version, onExportZip);
      return;
    }
    void runVersionExport(version, (content, title) => exportAsZip(content, title));
  }

  function exportVersionHtml(version: ProjectFileVersion) {
    if (onExportHtml) {
      void runProjectVersionExport(version, onExportHtml);
      return;
    }
    void runVersionExport(version, (content, title) => exportAsHtml(content, title));
  }

  function openVersionInNewTab() {
    if (loadingContent || !selectedContentMatchesVersion || !selectedContent || !selectedVersion) return;
    fireModalClick('open_in_new_tab', {
      version_source: fileVersionSourceToTracking(selectedVersion),
    });
    openSandboxedPreviewInNewTab(
      selectedContent,
      `${file.name} · v${selectedVersion.version}`,
      fileVersionPreviewOptions(projectId, file.name, selectedContent),
    );
  }

  async function restoreVersion() {
    if (restoreDisabled || !selectedVersion || !selectedContentMatchesVersion || !selectedContent) return;
    setRestoring(true);
    setError(null);
    let closingAfterRestore = false;
    const restoreStarted = performance.now();
    // `versions` is sorted newest-first, so the index is "how many versions
    // back from the newest" the restore target sits.
    const fireRestoreResult = (result: 'success' | 'failed', errorCode?: string) => {
      trackFileVersionRestoreResult(analytics.track, {
        page_name: 'artifact',
        area: 'file_version_modal',
        artifact_id: trackingArtifactId,
        artifact_kind: trackingArtifactKind,
        project_id: projectId,
        project_kind: projectKind,
        version_source: fileVersionSourceToTracking(selectedVersion),
        version_gap: Math.max(0, versions.findIndex((version) => version.id === selectedVersion.id)),
        version_count: versions.length,
        result,
        ...(errorCode ? { error_code: errorCode } : {}),
        restore_duration_ms: Math.round(performance.now() - restoreStarted),
      });
    };
    try {
      const result = await restoreProjectFileVersion(
        projectId,
        file.name,
        selectedVersion
      );
      if (!result) {
        fireRestoreResult('failed', 'restore_request_failed');
        setError(t('fileViewer.versions.restoreFailed'));
        return;
      }
      fireRestoreResult('success', result.versionWarning?.code);
      const restoredVersion = result.version ?? selectedVersion;
      await onRestored(selectedContent, restoredVersion);
      if (result.versionWarning) {
        await loadVersions(result.version?.id ?? selectedVersion.id);
        setError(result.versionWarning.message);
        return;
      }
      closingAfterRestore = true;
      onClose();
    } finally {
      if (!closingAfterRestore) setRestoring(false);
    }
  }

  return createPortal(
    <>
      <aside
        className="artifact-version-panel"
        role="dialog"
        aria-label={t('fileViewer.versions.title')}
      >
        <header className="artifact-version-panel__head">
          {/* Title first, the 历史版本·N count as a subline under it. */}
          <div>
            <strong title={panelFileName}>{panelFileName}</strong>
            <p>{`${t('fileViewer.versions.entryFull')} · ${versionCountLabel}`}</p>
          </div>
          <div className="artifact-version-panel__head-actions">
            <button
              type="button"
              className="artifact-version-panel__open"
              aria-label={t('fileViewer.versions.open')}
              title={t('fileViewer.versions.open')}
              disabled={!selectedContentMatchesVersion || loadingContent}
              onClick={openVersionInNewTab}
            >
              <RemixIcon name="external-link-line" size={15} />
            </button>
            <button
              type="button"
              className="artifact-version-panel__close"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={onClose}
            >
              <RemixIcon name="close-line" size={17} />
            </button>
          </div>
        </header>
        <div className="artifact-version-panel__preview">
          {srcDoc ? (
            <iframe
              ref={versionPreviewIframeRef}
              title={selectedVersion ? `${file.name} v${selectedVersion.version}` : file.name}
              sandbox={HTML_PREVIEW_SANDBOX}
              srcDoc={srcDoc}
              onLoad={() => setLoadedSrcDoc(srcDoc)}
            />
          ) : null}
          {selectedVersion ? (
            <div className="artifact-version-panel__preview-caption">
              <span>{`v${selectedVersion.version}`}</span>
              <strong>{selectedDate}</strong>
            </div>
          ) : null}
          {loading || loadingContent || (srcDoc && !frameReady) ? (
            <div
              className="file-version-preview-overlay"
              role="status"
              aria-label={t('fileViewer.versions.previewLoading')}
            >
              <span className="file-version-preview-spinner" aria-hidden="true" />
            </div>
          ) : null}
        </div>
        {error ? (
          <p className="artifact-version-panel__note" role="alert">{error}</p>
        ) : null}
        {showSearch ? (
          <div className="file-version-search">
            <RemixIcon name="search-line" size={14} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('common.searchEllipsis')}
              aria-label={t('common.searchEllipsis')}
            />
            {search ? (
              <button
                type="button"
                className="file-version-search-clear"
                aria-label={t('common.clear')}
                onClick={() => setSearch('')}
              >
                <RemixIcon name="close-line" size={14} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="artifact-version-list" role="listbox" aria-label={t('fileViewer.versions.listAria')}>
          {loading ? (
            <div
              className="file-version-skeleton-list"
              role="status"
              aria-label={t('fileViewer.versions.loading')}
            >
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="file-version-skeleton-item" aria-hidden="true">
                  <div className="file-version-skeleton-row">
                    <span className="file-version-skeleton-line badge" />
                    <span className="file-version-skeleton-line time" />
                  </div>
                  <span className="file-version-skeleton-line title" />
                  <span className="file-version-skeleton-line meta" />
                </div>
              ))}
            </div>
          ) : versions.length === 0 ? (
            <div className="file-version-empty">{t('fileViewer.versions.empty')}</div>
          ) : visibleVersions.length === 0 ? (
            <div className="file-version-empty">{t('homeHero.noResults', { query: search.trim() })}</div>
          ) : (
            visibleVersions.map((version) => {
              const selected = version.id === selectedVersion?.id;
              const itemRestoredFrom = version.restoreFromVersionId
                ? versionById.get(version.restoreFromVersionId)
                : null;
              const prefetch = () => {
                void primeVersionContent(version.id);
              };
              const selectVersion = () => {
                if (!selected) {
                  fireModalClick('version_item', {
                    version_source: fileVersionSourceToTracking(version),
                    version_is_current: Boolean(version.current),
                  });
                }
                setSelectedId(version.id);
              };
              // The daemon fills an absent label with a hardcoded English
              // `Version N` (project-file-versions.ts). Rendering that as the
              // card title put an untranslated "Version 2" directly above the
              // localized "版本 2" meta line — the same fact, twice, in two
              // languages. A card only earns a bespoke title when it has
              // something the `v{n}` mark does not already say.
              const autoVersionLabel = /^v(?:ersion)?\s*\.?\s*\d+$/i.test(version.label?.trim() ?? '');
              const versionTitle =
                version.prompt?.trim()
                || (autoVersionLabel ? '' : version.label?.trim() ?? '');
              return (
                <button
                  key={version.id}
                  type="button"
                  className={`artifact-version-card${selected ? ' is-selected' : ''}${version.current ? ' is-current' : ''}`}
                  role="option"
                  aria-selected={selected}
                  onClick={selectVersion}
                  onMouseEnter={prefetch}
                  onFocus={prefetch}
                >
                  <span className="artifact-version-card__mark">{`v${version.version}`}</span>
                  <span className="artifact-version-card__body">
                    {versionTitle || version.current ? (
                      <span className="artifact-version-card__title">
                        {versionTitle ? (
                          <span className="artifact-version-card__title-text">{versionTitle}</span>
                        ) : null}
                        {version.current ? <em>{t('fileViewer.versions.current')}</em> : null}
                      </span>
                    ) : null}
                    <span className="artifact-version-card__meta">
                      <span className={`file-version-source-badge ${fileVersionSourceClassName(version)}`}>
                        {fileVersionSourceLabel(version, t)}
                      </span>
                      <span>{formatVersionDateTime(version.createdAt, locale)}</span>
                    </span>
                    {itemRestoredFrom ? (
                      <span className="artifact-version-card__summary">
                        {t('fileViewer.versions.restoredFrom', { version: itemRestoredFrom.version })}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <footer className="artifact-version-panel__foot">
          <button
            type="button"
            className={`artifact-version-panel__restore${confirmRestore ? ' active' : ''}`}
            disabled={restoreDisabled}
            title={viewerOnly ? t('studio.readOnly') : undefined}
            aria-haspopup="dialog"
            aria-expanded={confirmRestore}
            aria-controls={confirmRestore ? restorePopoverId : undefined}
            onClick={() => {
              if (!selectedVersion) return;
              if (!confirmRestore) {
                fireModalClick('restore', {
                  version_source: fileVersionSourceToTracking(selectedVersion),
                });
              }
              setConfirmRestore((value) => !value);
            }}
          >
            <RemixIcon name={restoring ? 'loader-4-line' : 'arrow-go-back-line'} size={15} />
            {restoring ? t('fileViewer.versions.restoring') : t('fileViewer.versions.restore')}
          </button>
          <button
            type="button"
            className="artifact-version-panel__download"
            aria-haspopup="menu"
            aria-expanded={Boolean(selectedVersion) && downloadMenuVersionId === selectedVersion?.id}
            aria-label={selectedVersion
              ? `${t('fileViewer.download')} ${t('fileViewer.versions.versionLabel', { version: selectedVersion.version })}`
              : t('fileViewer.download')}
            disabled={!selectedVersion}
            onClick={() => {
              if (!selectedVersion) return;
              void primeVersionContent(selectedVersion.id);
              setDownloadMenuVersionId((current) => current === selectedVersion.id ? null : selectedVersion.id);
            }}
          >
            <RemixIcon name="download-line" size={15} />
            {t('fileViewer.download')}
          </button>
        </footer>
        {selectedVersion && <ConfirmDialog open={confirmRestore} title={t('fileViewer.versions.restoreConfirmTitle')}
          confirmLabel={t('fileViewer.versions.restoreConfirmCta')} cancelLabel={t('common.cancel')} busy={restoreDisabled}
          onCancel={() => { fireModalClick('restore_cancel', { version_source: fileVersionSourceToTracking(selectedVersion) }); setConfirmRestore(false); }}
          onConfirm={() => {
            fireModalClick('restore_confirm', { version_source: fileVersionSourceToTracking(selectedVersion) });
            setConfirmRestore(false); void restoreVersion();
          }}>{t('fileViewer.versions.restoreHelp')}</ConfirmDialog>}
        {selectedVersion && downloadMenuVersionId === selectedVersion.id ? (
          <div
            className="artifact-version-panel__popover share-menu-popover file-version-download-menu"
            role="menu"
          >
            <button
              type="button"
              className="share-menu-item"
              role="menuitem"
              onClick={() => {
                void exportVersionPdf(selectedVersion);
              }}
            >
              <span className="share-menu-icon"><RemixIcon name="file-line" size={15} /></span>
              <span>{t('fileViewer.exportPdf')}</span>
            </button>
            <button
              type="button"
              className="share-menu-item"
              role="menuitem"
              onClick={() => {
                openVersionImageExport(selectedVersion);
              }}
            >
              <span className="share-menu-icon"><RemixIcon name="image-line" size={15} /></span>
              <span>{t('fileViewer.exportImage')}</span>
            </button>
            <button
              type="button"
              className="share-menu-item"
              role="menuitem"
              onClick={() => {
                exportVersionZip(selectedVersion);
              }}
            >
              <span className="share-menu-icon"><RemixIcon name="file-zip-line" size={15} /></span>
              <span>{t('fileViewer.exportZip')}</span>
            </button>
            {selectedVersion.current ? (
              <button
                type="button"
                className="share-menu-item"
                role="menuitem"
                onClick={() => {
                  exportVersionHtml(selectedVersion);
                }}
              >
                <span className="share-menu-icon"><RemixIcon name="file-code-line" size={15} /></span>
                <span>{t('fileViewer.exportHtml')}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </aside>
      {versionImageExportVersion ? (
        <div className="modal-backdrop viewer-modal-backdrop image-export-backdrop file-version-export-backdrop" role="presentation">
          <div
            className="modal export-modal image-export-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={versionImageExportTitleId}
          >
            <div className="modal-head">
              <div className="kicker">IMAGE</div>
              <h2 id={versionImageExportTitleId}>{t('fileViewer.exportImage')}</h2>
              <p className="subtitle">{t('fileViewer.exportImageModalSubtitle')}</p>
            </div>
            <div className="export-form image-export-form">
              <fieldset className="image-export-format-field">
                <legend>{t('fileViewer.exportImageFormatLabel')}</legend>
                <div className="image-export-format-options">
                  {IMAGE_EXPORT_FORMAT_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={`image-export-format-option${versionImageExportFormat === option.value ? ' active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="version-image-export-format"
                        value={option.value}
                        aria-label={option.label}
                        checked={versionImageExportFormat === option.value}
                        onChange={() => setVersionImageExportFormat(option.value)}
                      />
                      <span className="image-export-format-text">
                        <strong>{option.label}</strong>
                        <span aria-hidden="true">{option.extension}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="ghost-link button-like"
                disabled={versionImageExportInFlight}
                onClick={() => setVersionImageExportVersionId(null)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="viewer-action primary"
                disabled={versionImageExportInFlight}
                onClick={() => {
                  void handleVersionImageExportSave();
                }}
              >
                {versionImageExportInFlight ? t('fileViewer.exportImageSaving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {visibleExportToast ? (
        <Toast
          className="file-version-export-toast"
          message={visibleExportToast.message}
          details={visibleExportToast.details}
          tone={visibleExportToast.tone}
          role={visibleExportToast.tone === 'error' ? 'alert' : 'status'}
          ttlMs={visibleExportToast.tone === 'loading' ? 60000 : 2200}
          placement="top"
          onDismiss={visibleExportToast.tone === 'loading'
            ? undefined
            : () => {
                if (versionExportToast) {
                  setVersionExportToast(null);
                } else {
                  onExportToastDismiss?.();
                }
              }}
        />
      ) : null}
    </>,
    document.body,
  );
}

function ReactModulePointer({
  entries,
  onOpenEntry,
}: {
  entries: string[];
  onOpenEntry?: (name: string) => void;
}) {
  const t = useT();
  return (
    <div className="viewer-module-pointer" role="note">
      <Icon name="info" size={20} />
      <h2 className="viewer-module-pointer__title">{t('fileViewer.jsxModuleTitle')}</h2>
      <p className="viewer-module-pointer__body">{t('fileViewer.jsxModuleBody')}</p>
      <p className="viewer-module-pointer__cta">{t('fileViewer.jsxModuleCta')}</p>
      <ul className="viewer-module-pointer__entries">
        {entries.map((name) => (
          <li key={name}>
            <button
              type="button"
              className="viewer-module-pointer__link"
              onClick={() => onOpenEntry?.(name)}
              disabled={!onOpenEntry}
            >
              <Icon name="external-link" size={14} />
              <span>{name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReactComponentViewer({
  projectId,
  projectKind,
  file,
  onOpenFileReplacing,
  projectName,
  projectDir,
  agents,
  artifactId,
  artifactKind: handoffArtifactKind,
  metricsConsent = false,
  installationId,
  viewerOnly = false,
  workspaceActive = true,
}: {
  projectId: string;
  projectKind: TrackingProjectKind;
  file: ProjectFile;
  onOpenFileReplacing?: (openName: string, closeName: string) => void;
  projectName?: string;
  projectDir?: string | null;
  agents?: AgentInfo[];
  artifactId?: string;
  artifactKind?: TrackingArtifactKind;
  metricsConsent?: boolean;
  installationId?: string | null;
  viewerOnly?: boolean;
  workspaceActive?: boolean;
}) {
  const t = useT();

  // `FileWorkspace` keeps a non-active viewer mounted, so an in-flight publish
  // can settle after the user has switched away. The ref carries the LIVE value
  // into those continuations; the captured prop would still read the
  // render-time `true`.
  const workspaceActiveRef = useRef(workspaceActive);
  workspaceActiveRef.current = workspaceActive;

  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [source, setSource] = useState<string | null>(null);
  // Tiled XML tilesets share .tsx with TypeScript JSX components.
  const isTiledTileset = useMemo(
    () => /\.tsx$/i.test(file.name) && source !== null
      && new DOMParser().parseFromString(source, 'application/xml').documentElement.localName === 'tileset',
    [file.name, source],
  );
  const [srcDoc, setSrcDoc] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareAccess, setShareAccess] = useState<'private' | 'workspace'>('private');
  const shareRef = useRef<HTMLDivElement | null>(null);
  // HTML entries that load this file as a Babel module. `null` = still
  // checking; `[]` = standalone artifact; non-empty = a module of a
  // multi-file React prototype, which has no standalone preview. Issue #2744.
  const [moduleEntries, setModuleEntries] = useState<string[] | null>(null);
  const isModule = (moduleEntries?.length ?? 0) > 0;
  const viewerOnlyDisabledTitle = t('studio.readOnly');

  useEffect(() => {
    setSource(null);
    let cancelled = false;
    void fetchProjectFileText(projectId, file.name, {  }).then((text) => {
      if (!cancelled) setSource(text ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, reloadKey,]);

  // Detect whether this .jsx/.tsx is a module loaded by a sibling HTML entry.
  // Runs before any srcdoc is built so a module never flashes the raw
  // "No React component export found" error from the React runtime.
  useEffect(() => {
    setModuleEntries(null);
    let cancelled = false;
    void (async () => {
      try {
        const files = await fetchProjectFiles(projectId, {  });
        const htmlNames = files
          .filter((entry) => /\.html?$/i.test(entry.name))
          .map((entry) => entry.name);
        const htmlSources = new Map<string, string>();
        await Promise.all(
          htmlNames.map(async (name) => {
            const text = await fetchProjectFileText(projectId, name, {

            }).catch(() => null);
            if (text != null) htmlSources.set(name, text);
            return text;
          }),
        );
        if (cancelled) return;
        setModuleEntries(findHtmlEntriesReferencing(file.name, htmlSources));
      } catch {
        if (!cancelled) setModuleEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, reloadKey,]);

  useEffect(() => {
    if (!shareMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!shareRef.current) return;
      if (!shareRef.current.contains(e.target as Node)) setShareMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShareMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [shareMenuOpen]);

  // Mirror the selected share access level onto the document body so shell-level
  // chrome can react to it (matches the demo's `data-artifact-share-access`).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.dataset.artifactShareAccess = shareAccess;
    return () => {
      delete document.body.dataset.artifactShareAccess;
    };
  }, [shareAccess]);


  useEffect(() => {
    // A Share popover must not outlive the standalone-file classification it
    // was opened under. Classification resets to null while a file is checked.
    // Export remains available during that check, so only close its menu when
    // the active tab is Share.
    if (viewerOnly) {
      setShareMenuOpen(false);
    }
  }, [viewerOnly, moduleEntries, isModule]);

  const exportTitle = file.name.replace(/\.(jsx|tsx)$/i, '') || file.name;
  const sourceExtension = file.name.toLowerCase().endsWith('.tsx') ? '.tsx' : '.jsx';

  useEffect(() => {
    if (source === null || moduleEntries === null || isModule || isTiledTileset) {
      // No source yet, still checking module status, or this file is a module
      // with no standalone preview — never build the React runtime srcdoc.
      setSrcDoc('');
      return;
    }

    let cancelled = false;
    const buildSrcDoc = () => {
      const nextSrcDoc = buildReactComponentSrcdoc(source, { title: exportTitle });
      if (!cancelled) setSrcDoc(nextSrcDoc);
    };

    if (source.length > 100_000) {
      setSrcDoc('');
      const timeout = window.setTimeout(buildSrcDoc, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(timeout);
      };
    }

    buildSrcDoc();
    return () => {
      cancelled = true;
    };
  }, [source, exportTitle, moduleEntries, isModule, isTiledTileset]);

  if (isTiledTileset) return <TextViewer projectId={projectId} file={file} />;

  return (
    <div className="viewer react-component-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <button
            type="button"
            className="icon-only pixo-tooltip"
            onClick={() => setReloadKey((n) => n + 1)}
            title={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
            data-tooltip={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
            data-tooltip-placement="bottom"
            aria-label={`${t('fileViewer.reloadAria')} ${t('fileViewer.preview')}`}
          >
            <Icon name="reload" size={14} />
          </button>
          <span className="viewer-meta">
            {t('fileViewer.reactMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <div className="viewer-toolbar-actions">
          <div className="viewer-tabs">
            <button
              type="button"
              className={`viewer-tab ${mode === 'preview' ? 'active' : ''}`}
              onClick={() => setMode('preview')}
            >
              {t('fileViewer.preview')}
            </button>
            <button
              type="button"
              className={`viewer-tab ${mode === 'source' ? 'active' : ''}`}
              onClick={() => setMode('source')}
            >
              {t('fileViewer.source')}
            </button>
          </div>
          {source !== null ? (
            <>
              <span className="viewer-divider" aria-hidden />
              <div className="share-menu chrome-share-menu chrome-share-menu--unified" ref={shareRef}>
                {/* Share and Export are separate toolbar intents again (the
                    0.18.0 unified tabs buried Export one level deep); they
                    still share one popover shell so switching keeps the menu
                    anchored in place. Export leads — it is the far more used
                    of the two (see the chrome header copy). */}
                <button
                  type="button"
                  className="viewer-action primary viewer-action-export pixo-tooltip"
                  aria-haspopup="menu"
                  aria-expanded={shareMenuOpen}
                  disabled={viewerOnly}
                  title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                  data-tooltip={viewerOnly ? viewerOnlyDisabledTitle : t('fileViewer.unifiedExportTab')}
                  data-tooltip-placement="bottom"
                  onClick={() => setShareMenuOpen((v) => !v)}
                >
                  <span className="export-action-spacer" aria-hidden />
                  <span>{t('fileViewer.unifiedExportTab')}</span>
                  <RemixIcon name="arrow-down-s-line" size={14} />
                </button>
                {shareMenuOpen ? (
                  <div className="share-menu-popover chrome-unified-popover" role="menu">
                    {(
                      <div className="chrome-unified-panel">
                        <button
                          type="button"
                          className="share-menu-item"
                          role="menuitem"
                          disabled={viewerOnly}
                          title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                          onClick={() => {
                            if (viewerOnly) return;
                            setShareMenuOpen(false);
                            exportAsJsx(source, exportTitle, sourceExtension);
                          }}
                        >
                          <span className="share-menu-icon"><RemixIcon name="file-code-line" size={15} /></span>
                          <span>{t('fileViewer.exportJsx')}</span>
                        </button>
                        <button
                          type="button"
                          className="share-menu-item"
                          role="menuitem"
                          disabled={viewerOnly}
                          title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                          onClick={() => {
                            if (viewerOnly) return;
                            setShareMenuOpen(false);
                            exportReactComponentAsHtml(source, exportTitle);
                          }}
                        >
                          <span className="share-menu-icon"><RemixIcon name="file-line" size={15} /></span>
                          <span>{t('fileViewer.exportReactHtml')}</span>
                        </button>
                        <div className="share-menu-divider" />
                        <button
                          type="button"
                          className="share-menu-item"
                          role="menuitem"
                          disabled={viewerOnly}
                          title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                          onClick={() => {
                            if (viewerOnly) return;
                            setShareMenuOpen(false);
                            exportReactComponentAsZip(source, exportTitle, sourceExtension);
                          }}
                        >
                          <span className="share-menu-icon"><RemixIcon name="file-zip-line" size={15} /></span>
                          <span>{t('fileViewer.exportZip')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
{viewerOnly ? null : (
                <HandoffButton
                  projectId={projectId}
                  projectKind={projectKind}
                  projectName={projectName}
                  projectDir={projectDir}
                  agents={agents}
                  artifactId={artifactId}
                  artifactKind={handoffArtifactKind}
                  metricsConsent={metricsConsent}
                  installationId={installationId}
                />
              )}
            </>
          ) : null}
        </div>
      </div>
      <div className="viewer-body">
        {isModule && mode === 'preview' ? (
          // Module of a multi-file prototype: no standalone preview, so the
          // Preview tab shows a pointer to the HTML entry. The Source tab still
          // renders the raw code below. Issue #2744.
          <ReactModulePointer
            entries={moduleEntries ?? []}
            onOpenEntry={(htmlName) => onOpenFileReplacing?.(htmlName, file.name)}
          />
        ) : source === null || (mode === 'preview' && !srcDoc) ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : mode === 'preview' ? (

            <iframe
              data-testid="react-component-preview-frame"
              title={file.name}
              sandbox={HTML_PREVIEW_SANDBOX}
              srcDoc={srcDoc}
              style={{ width: '100%', height: '100%', border: 0 }}
            />

        ) : (
          <CodeWithLines text={source} />
        )}
      </div>
    </div>
  );
}

function BinaryViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  return (
    <div className="viewer binary-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.binaryMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body">
        <div className="viewer-empty">
          {t('fileViewer.binaryNote', { size: file.size })}
        </div>
      </div>
    </div>
  );
}

function DocumentPreviewViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();

  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    void fetchProjectFilePreview(projectId, file.name).then((next) => {
      if (!cancelled) {
        setPreview(next);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime,]);

  return (
    <div className="viewer document-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {documentMetaLabel(file, t)} · {humanSize(file.size)}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body">
        {loading ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : preview ? (
          <div className="document-preview">
            <h2>{preview.title}</h2>
            {preview.sections.map((section, idx) => (
              <section key={`${section.title}-${idx}`}>
                <h3>{section.title}</h3>
                {section.lines.map((line, lineIdx) => (
                  <p key={`${lineIdx}-${line}`}>{line}</p>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="viewer-empty">{t('fileViewer.previewUnavailable')}</div>
        )}
      </div>
    </div>
  );
}

export function fileViewerSourceAuthorizationScopeKey(authority: ProjectResourceAuthority = 'local'): string | null {
    return authority === 'local' ? 'local' : null;
  }

function previewViewportStyle(
  viewport: PreviewViewportId,
  previewScale = 1,
  canvasSize?: PreviewCanvasSize,
  options?: PreviewScaleOptions,
): CSSProperties & Record<string, string | number> {
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport) ?? PREVIEW_VIEWPORT_PRESETS[0]!;
  if (!preset.width) return {};
  const effectiveScale = effectivePreviewScale(viewport, previewScale, canvasSize, options);
  return {
    '--preview-viewport-width': `${preset.width}px`,
    '--preview-viewport-height': `${preset.height}px`,
    '--preview-scale': effectiveScale,
    '--preview-user-scale': previewScale,
  };
}
  function previewScaleShellStyle(
  viewport: PreviewViewportId,
  previewScale: number,
): CSSProperties & Record<string, string | number> {
  if (viewport === 'desktop') {
    return {
      width: `${100 / previewScale}%`,
      height: `${100 / previewScale}%`,
      transform: `scale(${previewScale})`,
      transformOrigin: '0 0',
    };
  }
  return {
    width: 'var(--preview-viewport-width)',
    height: 'var(--preview-viewport-height)',
    transform: 'scale(var(--preview-scale, 1))',
    transformOrigin: '0 0',
  };
}
  const POWERED_PREVIEW_SANDBOX =
  'allow-scripts allow-same-origin allow-downloads allow-popups allow-forms allow-modals allow-pointer-lock';
  const POWERED_PREVIEW_ALLOW =
  'accelerometer; autoplay; camera; cross-origin-isolated; fullscreen; gamepad; gyroscope; microphone; xr-spatial-tracking';
  function HtmlViewer({
  projectId,
  projectKind,
  file,
  pendingShareUpdateAfterLoginRef,
  liveHtml,
  filesRefreshKey = 0,
  streaming,
  motionPreviewMuted = false,
  onFileSaved,
  onOpenFileReplacing,
  downloadRequest,
  viewerOnly = false,
  projectName,
  projectDir,
  agents,
  artifactId,
  artifactKind: handoffArtifactKind,
  metricsConsent = false,
  installationId,
  workspaceActive = true,
}: {
  projectId: string;
  projectKind: TrackingProjectKind;
  file: ProjectFile;
  pendingShareUpdateAfterLoginRef: { current: PendingShareUpdateAfterLogin | null };


  liveHtml?: string;
  filesRefreshKey?: number;
  streaming: boolean;
  motionPreviewMuted?: boolean;
  onFileSaved?: () => Promise<void> | void;
  onOpenFileReplacing?: (openName: string, closeName: string) => void;
  downloadRequest?: { nonce: number; anchorId?: string } | null;
  viewerOnly?: boolean;
  projectName?: string;
  projectDir?: string | null;
  agents?: AgentInfo[];
  artifactId?: string;
  artifactKind?: TrackingArtifactKind;
  metricsConsent?: boolean;
  installationId?: string | null;
  workspaceActive?: boolean;
}) {
  const { locale, t } = useI18n();
  const iframeKeepAlivePool = useIframeKeepAlivePool();
  // Retained viewers prewarm new file revisions behind the active tab. Keeping
  // the live metadata here is what lets an agent edit finish loading before
  // the user switches back; activation itself must not promote a stale
  // snapshot and start a visible navigation.
  const {


    projectResourceAuthority,
  } = useProjectPreviewContext();
  const observedSourceAuthorizationScopeKey = fileViewerSourceAuthorizationScopeKey(projectResourceAuthority);
  // Project context providers may re-materialize an equivalent object while
  // ambient focus/presence settles. Requests are scoped by the fields encoded
  // in this key, so preserve the existing object until that wire identity
  // actually changes. Otherwise every provider refresh retriggers raw/file-list
  // effects and reloads a byte-identical preview.
  const sourceAuthorizationScopeKey = observedSourceAuthorizationScopeKey;
  const projectResourceReadBlocked =
    sourceAuthorizationScopeKey === null;
  // File-watch pulses are debounced by the URL refresh effect below. Consume
  // them while retained so the hidden document is already current when its tab
  // becomes visible.
  const appliedFilesRefreshKeyRef = useRef(filesRefreshKey);
  const workspaceActiveRef = useRef(workspaceActive);
  workspaceActiveRef.current = workspaceActive;
  const filesRefreshPending = filesRefreshKey !== 0
    && appliedFilesRefreshKeyRef.current !== filesRefreshKey;
  const analytics = useAnalytics();
  // Latest per-slide capture progress for the programmatic exporters, read by
  // the loading-toast ticker in fireShareExport to render elapsed time + ETA.
  const exportProgressRef = useRef<{ done: number; total: number } | null>(null);
  const unknownExportOrigin = (
    status: ArtifactExportOriginProps['artifact_origin_status'] = 'missing_version',
  ): ArtifactExportOriginProps => ({
    entry_surface: 'openpixo_ui',
    artifact_origin_status: status,
    origin_entry_surface: 'unknown',
  });
  const resolveArtifactExportOrigin = async (
    context?: HtmlVersionExportContext | null,
  ): Promise<ArtifactExportOriginProps> => {
    const content = context?.content ?? sourceRef.current;
    if (content == null) return unknownExportOrigin();
    let version = context?.version ?? null;
    if (!version) {
      const result = await fetchProjectFileVersions(projectId, file.name);
      version = result?.versions.find((candidate) => candidate.current) ?? null;
    }
    return artifactExportOriginProps(content, version);
  };
  // Shared helper for the share menu: emit studio_click share_option on
  // entry and artifact_export_result on resolution. Sync exports report
  // success immediately after the call returns; async exports get .then
  // / .catch. The same request_id threads both events so PostHog can
  // stitch click → result via $insert_id correlation.
  const fireShareExport = (
    format:
      | 'pdf'
      | 'pptx'
      | 'zip'
      | 'html'
      | 'image'
      | 'markdown'
      | 'template'
      | 'share_link'
      | 'share_page'
      | 'playable_game',
    fn: () => Promise<unknown> | unknown,
    context?: HtmlVersionExportContext | null,
  ) => {
    if (!workspaceActive) return;
    const requestId = analytics.newRequestId();
    const artifactId = anonymizeArtifactId({ projectId, fileName: file.name });
    const artifactKind = artifactKindToTracking({ fileKind: file.kind ?? null });
    const trackingFormat = format;
    trackShareOptionPopoverClick(
      analytics.track,
      {
        page_name: 'artifact',
        area: 'share_option_popover',
        artifact_id: artifactId,
        artifact_kind: artifactKind,
        element: trackingFormat,
        project_id: projectId,
        project_kind: projectKind,
      },
      { requestId },
    );
    const started = performance.now();
    const originPromise = resolveArtifactExportOrigin(context)
      .catch(() => unknownExportOrigin());

    const finish = async (result: 'success' | 'failed' | 'cancelled', errorCode?: string, saveCompleted = false) => {
      // Only an acknowledged native save may offer the guide. Older hosts and
      // browsers report download initiation without claiming disk persistence.

      const originProps = await originPromise;
      trackArtifactExportResult(
        analytics.track,
        {
          page_name: 'artifact',
          area: 'share_option_popover',
          artifact_id: artifactId,
          artifact_kind: artifactKind,
          project_id: projectId,
          project_kind: projectKind,
          export_format: trackingFormat,
          result,
          ...originProps,
          ...(errorCode ? { error_code: errorCode } : {}),
          export_duration_ms: Math.round(performance.now() - started),
        },
        { requestId },
      );
    };
    const toastFormats = new Set(['pdf', 'pptx', 'zip', 'html', 'image', 'markdown', 'playable_game']);
    exportProgressRef.current = null;
    const startedAt = performance.now();
    let ticker: ReturnType<typeof setInterval> | null = null;
    const renderLoadingToast = () => {
      if (!toastFormats.has(format)) return;
      const elapsedS = Math.max(0, Math.round((performance.now() - startedAt) / 1000));
      const p = exportProgressRef.current;
      let message: string;
      if (p && p.total > 1 && p.done > 0) {
        const remainingS = Math.max(
          1,
          Math.round(((performance.now() - startedAt) / p.done) * (p.total - p.done) / 1000),
        );
        message = t('fileViewer.exportSlideEta', { current: p.done, total: p.total, seconds: remainingS });
      } else if (p && p.total > 1) {
        message = t('fileViewer.exportSlideProgress', { current: p.done, total: p.total });
      } else {
        message = elapsedS > 0
          ? t('fileViewer.exportingElapsed', { seconds: elapsedS })
          : t('fileViewer.exportingProgress');
      }
      setExportToast({ message, tone: 'loading' });
    };
    const stopTicker = () => {
      if (ticker != null) {
        clearInterval(ticker);
        ticker = null;
      }
    };
    if (toastFormats.has(format)) {
      renderLoadingToast();
      ticker = setInterval(renderLoadingToast, 1000);
    }
    const failToast = (err?: unknown) => {
      stopTicker();
      if (toastFormats.has(format)) setExportToast(exportFailureToast(err, t));
    };
    try {
      const out = fn();
      if (out && typeof (out as Promise<unknown>).then === 'function') {
        (out as Promise<unknown>).then(
          (result) => {
            stopTicker();
            if (result === 'cancelled') {
              void finish('cancelled');
              if (toastFormats.has(format)) setExportToast(null);
              return;
            }
            void finish('success', undefined, result === 'desktop');
            if (toastFormats.has(format)) setExportToast({ message: t('fileViewer.exportDone'), tone: 'success' });
          },
          (err) => {
            void finish('failed', exportErrorCode(err));
            failToast(err);
          },
        );
      } else {
        stopTicker();
        if (out === 'cancelled') {
          void finish('cancelled');
          if (toastFormats.has(format)) setExportToast(null);
          return;
        }
        void finish('success', undefined, out === 'desktop');
        if (toastFormats.has(format)) setExportToast({ message: t('fileViewer.exportDone'), tone: 'success' });
      }
    } catch (err) {
      void finish('failed', exportErrorCode(err));
      failToast(err);
    }
  };
  // Feeds per-slide capture progress into the ref the loading-toast ticker reads
  // (apps/web/src/runtime/exports.ts drives this for the PDF exporter).
  const onExportProgress: ExportProgress = (done, total) => {
    exportProgressRef.current = { done, total };
  };
  // P0 helpers — keep the artifact_id + artifact_kind derivation in one place
  // so each per-button onClick stays a one-liner. We compute lazily inside the
  // closure because `file.kind` / `file.name` can change as the user navigates
  // tabs without remounting HtmlViewer.
  const fireArtifactToolbarClick = (
    element:
      | 'reload'
      | 'preview'
      | 'source'
      | 'screenshot'
      | 'zoom_out'
      | 'zoom_level_dropdown'
      | 'zoom_in'
      | 'versions',
    entryFrom?: 'toolbar' | 'more_menu',
  ) => {
    if (!workspaceActive) return;
    trackArtifactToolbarClick(analytics.track, {
      page_name: 'artifact',
      area: 'artifact_toolbar',
      element,
      artifact_id: anonymizeArtifactId({ projectId, fileName: file.name }),
      artifact_kind: artifactKindToTracking({ fileKind: file.kind ?? null }),
      project_id: projectId,
      project_kind: projectKind,
      ...(entryFrom ? { entry_from: entryFrom } : {}),
    });
  };
  const fireArtifactHeaderClick = (
    element:
      | 'back'
      | 'present_dropdown'
      | 'download_dropdown'
      | 'share_dropdown'
      | 'settings',
  ) => {
    if (!workspaceActive) return;
    trackArtifactHeaderClick(analytics.track, {
      page_name: 'artifact',
      area: 'artifact_header',
      element,
      artifact_id: anonymizeArtifactId({ projectId, fileName: file.name }),
      artifact_kind: artifactKindToTracking({ fileKind: file.kind ?? null }),
      project_id: projectId,
      project_kind: projectKind,
    });
  };
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const sourceSnapshotRefreshKey = htmlSourceSnapshotRefreshKey(file, filesRefreshKey);
  const [initialSourceSnapshot] = useState(() => (
    liveHtml === undefined && sourceAuthorizationScopeKey
      ? getHtmlSourceSnapshot(
          sourceAuthorizationScopeKey,
          projectId,
          file.name,
          sourceSnapshotRefreshKey,
        )
      : null
  ));
  const initialSource = liveHtml ?? initialSourceSnapshot?.source ?? null;
  const [source, setSource] = useState<string | null>(initialSource);
  const [routingSource, setRoutingSource] = useState<string | null>(initialSource);
  const srcDocPreviewBaseIdentity =
    `${sourceAuthorizationScopeKey ?? 'pending'}\0${projectId}\0${file.name}`;
  const currentSourceIdentity =
    `${srcDocPreviewBaseIdentity}\0${liveHtml === undefined ? 'raw' : 'live'}`;
  const [routingSourceIdentity, setRoutingSourceIdentity] = useState<string | null>(
    initialSource !== null ? currentSourceIdentity : null,
  );
  const [scopedSrcDocPreviewBase, setScopedSrcDocPreviewBase] = useState<{
    identity: string;
    scope: ProjectPreviewBaseScope;
  } | null>(null);
  const activeSrcDocPreviewBaseRef = useRef<{
    identity: string;
    scope: ProjectPreviewBaseScope;
  } | null>(null);
  const effectiveScopedSrcDocPreviewBase =
    scopedSrcDocPreviewBase?.identity === srcDocPreviewBaseIdentity
      ? scopedSrcDocPreviewBase.scope
      : null;
  const [auxiliarySrcDocPreviewBase, setAuxiliarySrcDocPreviewBase] = useState<{
    identity: string;
    href: string;
  } | null>(null);
  const [urlLoadedPreviewBase, setUrlLoadedPreviewBase] = useState<{
    identity: string;
    scope: ProjectPreviewBaseScope;
  } | null>(null);
  const urlLoadedPreviewBaseRef = useRef<{
    identity: string;
    scope: ProjectPreviewBaseScope;
  } | null>(null);
  const [serverPoweredPreviewRequired, setServerPoweredPreviewRequired] = useState(false);
  const [previewAssetWarning, setPreviewAssetWarning] = useState<PreviewAssetWarning | null>(null);
  const [inlinedSource, setInlinedSource] = useState<string | null>(null);
  const fileViewportKey = previewViewportStateKey(projectId, file);
  // Content width is valid only for this exact file revision/authorization
  // snapshot. Viewport and manual zoom preferences intentionally persist
  // across revisions, but an intrinsic-width witness must not.
  const previewContentWidthCacheBaseKey =
    `${fileViewportKey}:${sourceSnapshotRefreshKey}:${sourceAuthorizationScopeKey ?? ''}`;
  // Lazily seed from the cache (not a hardcoded 100/'auto') so a remount that
  // lands back on a file the user already zoomed doesn't flash the wrong
  // value for a frame before the reset effect below corrects it.
  const [zoom, setZoom] = useState<number>(
    () => htmlPreviewZoomState.get(fileViewportKey)?.zoom ?? 100,
  );
  const [zoomMode, setZoomMode] = useState<'auto' | 'manual'>(
    () => htmlPreviewZoomState.get(fileViewportKey)?.zoomMode ?? 'auto',
  );
  const [previewViewport, setPreviewViewportState] = useState<PreviewViewportId>(
    () => htmlPreviewViewportState.get(fileViewportKey) ?? 'desktop',
  );
  const setPreviewViewport = useCallback((viewport: PreviewViewportId) => {
    setPreviewViewportCached(fileViewportKey, viewport);
    setPreviewViewportState(viewport);
  }, [fileViewportKey]);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  // Single open-state for the unified chrome share/export/send popover; the
  // active tab is `unifiedActionTab`. External share/download requests below just
  // preselect the tab and open this one popover.
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [shareAccess, setShareAccess] = useState<'private' | 'workspace'>('private');
  const [shareAccessMenuOpen, setShareAccessMenuOpen] = useState(false);

  // False when closed; otherwise records which entry opened the modal so the
  // surface_view impression can carry entry_from.
  const [toolbarMoreOpen, setToolbarMoreOpen] = useState(false);
  const toolbarMoreRef = useRef<HTMLDivElement | null>(null);
  const toolbarMoreTriggerRef = useRef<HTMLButtonElement | null>(null);
  useDismissOnOutsideInteraction(toolbarMoreOpen, toolbarMoreRef, () => setToolbarMoreOpen(false));
  const [versionModalOpen, setVersionModalOpen] = useState<false | 'toolbar' | 'more_menu'>(false);
  const [exportReadyNudge, setExportReadyNudge] = useState(false);
  const exportReadyNudgeSeenRef = useRef<Set<string>>(new Set());
  // Template save UX. We surface a transient "Saved" pill in the share
  // menu so the user gets feedback without a noisy toast layer.
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [, setTemplateNote] = useState<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    setPreviewViewportState(htmlPreviewViewportState.get(fileViewportKey) ?? 'desktop');
    // Restore this file's last zoom instead of hard-resetting to 100/auto —
    // this effect also fires on every HtmlViewer remount (e.g. switching to
    // the Files tab and back), not just on a genuine file change, and
    // a hardcoded reset was clobbering a zoom the user had already landed on
    // (rec:recvqaeMAGUdN2). A file with no cache entry yet (first open) still
    // falls back to the normal auto-fit default.
    const cachedZoom = htmlPreviewZoomState.get(fileViewportKey);
    setZoom(cachedZoom?.zoom ?? 100);
    setZoomMode(cachedZoom?.zoomMode ?? 'auto');
  }, [fileViewportKey]);
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  // Mirror the selected share access level onto the document body so shell-level
  // chrome can react to it (matches the demo's `data-artifact-share-access`).
  useEffect(() => {
    if (!workspaceActive || typeof document === 'undefined') return;
    document.body.dataset.artifactShareAccess = shareAccess;
    return () => {
      delete document.body.dataset.artifactShareAccess;
    };
  }, [shareAccess, workspaceActive]);


  // Collapse the nested workspace-access listbox whenever the unified share
  // popover itself closes, so it never re-opens mid-flight.
  useEffect(() => {
    if (!exportMenuOpen) setShareAccessMenuOpen(false);
  }, [exportMenuOpen]);

  // Sharing actions require complete content; inspecting the menu does not.
  // Async publish completions must also observe the current streaming state.
  const shareContentStreamingRef = useRef(streaming);
  shareContentStreamingRef.current = streaming;
  const [reloadKey, setReloadKey] = useState(0);
  const nextPreviewContentWidthCacheKey = `${previewContentWidthCacheBaseKey}:${reloadKey}`;
  // Set to true permanently once `source` has been populated for the first
  // time. After the first load, we never show the "loading" skeleton again —
  // even if a reload temporarily clears `source` to null (issue #4650).
  const sourceEverLoadedRef = useRef(source !== null);
  // Files whose source has been shown at least once (projectId + name). A
  // revisit skips the loading skeleton entirely — the fetch still runs, but
  // the pane doesn't flash a skeleton for content the user has already seen.
  const sourceLoadedFileKey =
    `${sourceAuthorizationScopeKey ?? 'pending'}\u0000${projectId}\u0000${file.name}`;
  const sourceLoadedKeysRef = useRef<Set<string>>(
    new Set(source !== null ? [sourceLoadedFileKey] : []),
  );
  // URL-load previews that have painted at least once (keep-alive key). The
  // loading skeleton above only waits for `source` (the file TEXT fetch); in
  // URL-load mode the iframe then issues its OWN network navigation, which can
  // sit queued behind heavy same-origin traffic (e.g. drafts-grid cover
  // iframes still streaming in) — leaving a bare white pane with no feedback.
  // Until that first load event lands, keep a loader over the transport stack.
  const urlPreviewLoadedKeysRef = useRef<Set<string>>(new Set());
  const [urlPreviewFirstLoadPending, setUrlPreviewFirstLoadPending] = useState(false);
  const [previewBodyRef, previewBodySize] = usePreviewCanvasSize<HTMLDivElement>();
  const [previewCanvasNode, setPreviewCanvasRef] = useState<HTMLDivElement | null>(null);
  const frozenPreviewContentWidthCacheKeyRef = useRef({
    fileViewportKey,
    key: nextPreviewContentWidthCacheKey,
  });
  {
    frozenPreviewContentWidthCacheKeyRef.current = {
      fileViewportKey,
      key: nextPreviewContentWidthCacheKey,
    };
  }
  const previewContentWidthCacheKey =
    frozenPreviewContentWidthCacheKeyRef.current.key;
  const initialPreviewContentWidthEntry = getPreviewContentWidthCached(previewContentWidthCacheKey);
  const [desktopPreviewContentWidthEntry, setDesktopPreviewContentWidthRaw] =
    useState<PreviewContentWidthCacheEntry | null>(
      initialPreviewContentWidthEntry,
    );
  const desktopPreviewContentWidth = desktopPreviewContentWidthEntry?.width ?? null;
  const desktopPreviewContentWidthEntryRef = useRef<PreviewContentWidthCacheEntry | null>(
    desktopPreviewContentWidthEntry,
  );
  const setDesktopPreviewContentWidth = useCallback((
    entry: Omit<PreviewContentWidthCacheEntry, 'version'> | null,
  ) => {
    const cachedEntry: PreviewContentWidthCacheEntry | null = entry == null
      ? null
      : { version: PREVIEW_CONTENT_WIDTH_CACHE_VERSION, ...entry };
    desktopPreviewContentWidthEntryRef.current = cachedEntry;
    setPreviewContentWidthCached(previewContentWidthCacheKey, entry);
    setDesktopPreviewContentWidthRaw((current) => (
      current?.width === cachedEntry?.width &&
      current?.measuredClientWidth === cachedEntry?.measuredClientWidth &&
      current?.overflow === cachedEntry?.overflow
        ? current
        : cachedEntry
    ));
  }, [previewContentWidthCacheKey]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const urlPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const srcDocPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const setUnpooledUrlPreviewIframe = useCallback((frame: HTMLIFrameElement | null) => {
    const previous = urlPreviewIframeRef.current;
    if (previous && previous !== frame) unbindMotionPreviewActivity(previous);
    urlPreviewIframeRef.current = frame;
    if (frame) bindMotionPreviewActivity(frame);
  }, []);
  const viewerRootRef = useRef<HTMLDivElement | null>(null);
  const srcDocNavigationCommittedRef = useRef<{
    frame: HTMLIFrameElement;
    generation: string;
  } | null>(null);
  const handledHostPreviewNavigationFailureRef = useRef<{
    eventId: number;
    generation: string;
  } | null>(null);
  const srcDocContentReadyRef = useRef<{
    frame: HTMLIFrameElement;
    generation: string;
  } | null>(null);
  const previewContentMeasurementSequenceRef = useRef(0);
  const previewContentMeasurementGenerationSequenceRef = useRef(0);
  const previewContentMeasurementHostInstanceRef = useRef<string | null>(null);
  if (previewContentMeasurementHostInstanceRef.current == null) {
    previewContentMeasurementHostInstanceRef.current =
      nextPreviewContentMeasurementHostInstance();
  }
  const srcDocPreviewFrameName = `${SRC_DOC_PREVIEW_FRAME_NAME_PREFIX}${anonymizeArtifactId({
    projectId,
    fileName: file.name,
  })}`;
  const previewContentMeasurementGenerationRef = useRef(
    `${previewContentMeasurementHostInstanceRef.current}:generation-0`,
  );
  const previewContentMeasurementRevisionRef = useRef(
    `${previewContentWidthCacheKey}:${reloadKey}`,
  );
  const previewContentMeasurementDocumentEpoch =
    getPreviewDocumentEpoch(previewContentWidthCacheKey);
  const previewContentMeasurementReadyRef = useRef<{
    frame: HTMLIFrameElement;
    generation: string;
  } | null>(null);
  const previewContentMeasurementExpectedDocumentEpochRef = useRef(
    previewContentMeasurementDocumentEpoch,
  );
  const previewContentMeasurementCurrentDocumentEpochRef = useRef(
    previewContentMeasurementDocumentEpoch,
  );
  previewContentMeasurementCurrentDocumentEpochRef.current =
    previewContentMeasurementDocumentEpoch;
  previewContentMeasurementExpectedDocumentEpochRef.current =
    previewContentMeasurementDocumentEpoch;
  const latestPreviewContentMeasurementRef = useRef<{
    request: PreviewContentMeasurementRequest;
    source: Window;
  } | null>(null);
  const previewContentMeasurementContextRef = useRef({
    canvasWidth: 0,
    previewScale: 1,
    eligible: false,
  });
  const desktopPreviewContentWidthRef = useRef(desktopPreviewContentWidth);
  desktopPreviewContentWidthRef.current = desktopPreviewContentWidth;
  const previewContentMeasurementRevision = `${previewContentWidthCacheKey}:${reloadKey}`;
  if (previewContentMeasurementRevisionRef.current !== previewContentMeasurementRevision) {
    previewContentMeasurementRevisionRef.current = previewContentMeasurementRevision;
    previewContentMeasurementGenerationSequenceRef.current += 1;
    previewContentMeasurementGenerationRef.current =
      `${previewContentMeasurementHostInstanceRef.current}:generation-${previewContentMeasurementGenerationSequenceRef.current}`;
    previewContentMeasurementReadyRef.current = null;
    latestPreviewContentMeasurementRef.current = null;
  }
  const previewFileIdentityRef = useRef(`${projectId}\u0000${file.name}`);
  previewFileIdentityRef.current = `${projectId}\u0000${file.name}`;
  const activatedSrcDocTransportHtmlRef = useRef<string | null>(null);
  const srcDocFrameDedupeResetForRef = useRef<HTMLIFrameElement | null>(null);
  const isActivePreviewIframeSource = useCallback((source: MessageEventSource | null) => {
    return workspaceActive && !!source && source === iframeRef.current?.contentWindow;
  }, [workspaceActive]);
  const isOurPreviewIframeSource = useCallback((source: MessageEventSource | null) => {
    if (!workspaceActive || !source) return false;
    return (
      source === iframeRef.current?.contentWindow ||
      source === urlPreviewIframeRef.current?.contentWindow ||
      source === srcDocPreviewIframeRef.current?.contentWindow
    );
  }, [workspaceActive]);
  const requestDesktopPreviewContentMeasure = useCallback((target: HTMLIFrameElement | null = iframeRef.current) => {
    if (!workspaceActive) return;
    const source = target?.contentWindow;
    if (!target || !source || target !== iframeRef.current) return;
    if (
      previewContentMeasurementExpectedDocumentEpochRef.current !==
      previewContentMeasurementCurrentDocumentEpochRef.current
    ) {
      return;
    }
    const ready = previewContentMeasurementReadyRef.current;
    if (
      !ready ||
      ready.frame !== target ||
      ready.generation !== previewContentMeasurementGenerationRef.current
    ) {
      return;
    }
    const canvas = previewCanvasNode;
    if (!previewMeasurementFrameIsUsable({
      connected: target.isConnected,
      active: target.dataset.pixoActive === 'true',
      frameRect: target.getBoundingClientRect(),
      canvasRect: canvas?.getBoundingClientRect() ?? target.getBoundingClientRect(),
    })) {
      return;
    }
    const {
      canvasWidth,
      previewScale: requestedPreviewScale,
      eligible,
    } = previewContentMeasurementContextRef.current;
    if (!eligible || !Number.isFinite(canvasWidth) || canvasWidth <= 0) return;
    const measurementId =
      `${previewContentMeasurementHostInstanceRef.current}:measurement-${++previewContentMeasurementSequenceRef.current}`;
    const request: PreviewContentMeasurementRequest = {
      measurementId,
      generation: previewContentMeasurementGenerationRef.current,
      documentEpoch: previewContentMeasurementExpectedDocumentEpochRef.current,
      canvasWidth,
      previewScale: requestedPreviewScale,
    };
    latestPreviewContentMeasurementRef.current = { request, source };
    source.postMessage({
      type: 'pixo:preview-content-size-request',
      ...request,
    }, '*');
  }, [previewCanvasNode, workspaceActive]);
  const beginDesktopPreviewContentMeasurementGeneration = useCallback((
    target: HTMLIFrameElement | null,
  ) => {
    if (!workspaceActive) return;
    if (!target || target !== iframeRef.current || target.dataset.pixoActive !== 'true') return;
    previewContentMeasurementGenerationSequenceRef.current += 1;
    previewContentMeasurementGenerationRef.current =
      `${previewContentMeasurementHostInstanceRef.current}:generation-${previewContentMeasurementGenerationSequenceRef.current}`;
    latestPreviewContentMeasurementRef.current = null;
    previewContentMeasurementReadyRef.current = {
      frame: target,
      generation: previewContentMeasurementGenerationRef.current,
    };
  }, [previewContentWidthCacheKey, reloadKey, workspaceActive]);
  const scheduleDesktopPreviewContentMeasure = useCallback((target: HTMLIFrameElement | null = iframeRef.current) => {
    requestDesktopPreviewContentMeasure(target);
    window.requestAnimationFrame(() => {
      requestDesktopPreviewContentMeasure(target);
      window.setTimeout(() => requestDesktopPreviewContentMeasure(target), 80);
      window.setTimeout(() => requestDesktopPreviewContentMeasure(target), 260);
    });
  }, [requestDesktopPreviewContentMeasure]);
  const previewScrollRestoreRef = useRef<{
    hostLeft: number;
    hostTop: number;
    frameLeft: number;
    frameTop: number;
    canvasLeft: number;
    canvasTop: number;
    expiresAt: number;
  } | null>(null);
  const previewScrollPositionRef = useRef({
    frameLeft: 0,
    frameTop: 0,
    canvasLeft: 0,
    canvasTop: 0,
  });
  const previewScrollRequestAtRef = useRef(0);
  const previewScrollCaptureSequenceRef = useRef(0);
  const pendingPreviewScrollCapturesRef = useRef(new Map<string, {
    resolve: (position: {
      frameLeft: number;
      frameTop: number;
      canvasLeft: number;
      canvasTop: number;
    } | null) => void;
    timeout: number;
  }>());
  const dcViewportRef = useRef({
    x: 0,
    y: 0,
    scale: 1,
  });
  const dcViewportRestoreAtRef = useRef(0);
  const capturePreviewScrollPosition = useCallback(async (): Promise<void> => {
    const host = previewBodyRef.current;
    const frame = iframeRef.current;
    let position = previewScrollPositionRef.current;
    const sandbox = frame?.getAttribute('sandbox');
    const sandboxTokens = new Set((sandbox ?? '').split(/\s+/).filter(Boolean));
    // An iframe with a sandbox attribute but no allow-same-origin has an
    // opaque origin even when it renders our own srcDoc. jsdom does not model
    // that security boundary, so derive readability from the authored iframe
    // contract instead of optimistically touching contentWindow.document.
    let frameReadable = sandbox === null || sandboxTokens.has('allow-same-origin');
    if (frameReadable) {
      try {
        const frameDocument = frame?.contentWindow?.document;
        const frameScroll = frameDocument?.scrollingElement;
        const canvasScroll = frameDocument?.querySelector<HTMLElement>('.design-canvas');
        if (frameDocument && frameScroll) {
          position = {
            frameLeft: frameScroll.scrollLeft,
            frameTop: frameScroll.scrollTop,
            canvasLeft: canvasScroll?.scrollLeft ?? frameScroll.scrollLeft,
            canvasTop: canvasScroll?.scrollTop ?? frameScroll.scrollTop,
          };
          previewScrollPositionRef.current = position;
        } else {
          frameReadable = false;
        }
      } catch {
        frameReadable = false;
      }
    }
    const snapshot = {
      hostLeft: host?.scrollLeft ?? 0,
      hostTop: host?.scrollTop ?? 0,
      frameLeft: position.frameLeft,
      frameTop: position.frameTop,
      canvasLeft: position.canvasLeft,
      canvasTop: position.canvasTop,
      expiresAt: Date.now() + 5000,
    };
    previewScrollRestoreRef.current = snapshot;
    if (frameReadable || !frame?.contentWindow) return;

    const requestId = `preview-scroll-${previewScrollCaptureSequenceRef.current += 1}`;
    const exactPositionPromise = new Promise<typeof position | null>((resolve) => {
      const timeout = window.setTimeout(() => {
        pendingPreviewScrollCapturesRef.current.delete(requestId);
        resolve(null);
      }, 120);
      pendingPreviewScrollCapturesRef.current.set(requestId, { resolve, timeout });
      try {
        frame.contentWindow?.postMessage({
          type: 'pixo:preview-scroll-capture',
          requestId,
        }, '*');
      } catch {
        window.clearTimeout(timeout);
        pendingPreviewScrollCapturesRef.current.delete(requestId);
        resolve(null);
      }
    });
    const installExactPosition = (exactPosition: typeof position | null) => {
      // A newer mode transition may have installed its own snapshot while
      // this opaque-frame round trip was in flight. Never let the older
      // response overwrite that newer restore intent.
      if (!exactPosition || previewScrollRestoreRef.current !== snapshot) return;
      previewScrollPositionRef.current = exactPosition;
      previewScrollRestoreRef.current = {
        ...snapshot,
        ...exactPosition,
        expiresAt: Date.now() + 5000,
      };
    };
    const hasKnownNonZeroScroll = (
      snapshot.hostLeft !== 0
      || snapshot.hostTop !== 0
      || position.frameLeft !== 0
      || position.frameTop !== 0
      || position.canvasLeft !== 0
      || position.canvasTop !== 0
    );
    if (!hasKnownNonZeroScroll) {
      // At the origin there is no jump-to-top to prevent. Keep the precise
      // capture in flight for subsequent transitions, but do not serialize an
      // otherwise instant save behind a bridge timeout if the iframe is gone.
      void exactPositionPromise.then(installExactPosition);
      return;
    }
    installExactPosition(await exactPositionPromise);
  }, []);
  useEffect(() => () => {
    for (const pending of pendingPreviewScrollCapturesRef.current.values()) {
      window.clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    pendingPreviewScrollCapturesRef.current.clear();
  }, []);
  const restorePreviewScrollPosition = useCallback(() => {
    const snapshot = previewScrollRestoreRef.current;
    if (!snapshot) return;
    if (Date.now() > snapshot.expiresAt) {
      previewScrollRestoreRef.current = null;
      return;
    }
    const apply = () => {
      const previewBody = previewBodyRef.current;
      if (typeof previewBody?.scrollTo === 'function') {
        previewBody.scrollTo(snapshot.hostLeft, snapshot.hostTop);
      }
      try {
        const frameDocument = iframeRef.current?.contentWindow?.document;
        frameDocument?.scrollingElement?.scrollTo(snapshot.frameLeft, snapshot.frameTop);
        frameDocument?.querySelector<HTMLElement>('.design-canvas')?.scrollTo(snapshot.canvasLeft, snapshot.canvasTop);
        iframeRef.current?.contentWindow?.postMessage({
          type: 'pixo:preview-scroll-restore',
          frameLeft: snapshot.frameLeft,
          frameTop: snapshot.frameTop,
          canvasLeft: snapshot.canvasLeft,
          canvasTop: snapshot.canvasTop,
        }, '*');
      } catch (error) {
        // The host still restores its own scroll when the iframe denies DOM access.
        if (error instanceof DOMException && error.name === 'SecurityError') return;
        console.warn('Could not restore preview frame scroll', error);
      }
    };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        apply();
        window.setTimeout(apply, 80);
        window.setTimeout(() => {
          if (previewScrollRestoreRef.current === snapshot) {
            apply();
          }
        }, 260);
      });
    });
  }, []);
  const sourceRef = useRef<string | null>(source);
  // Holds the last-good source snapshot taken just before reloadHtmlPreview
  // clears source to null on the srcDoc path.  The fetch effect restores this
  // value if fetchProjectFileText returns null (non-2xx / transient network
  // error), so the iframe never goes blank on a failed reload attempt.
  //
  // The snapshot is keyed by projectId + fileName so that:
  //   (a) a rapid second Reload click — which sees source===null from the
  //       first click's setSource(null) — does not overwrite the ref with null
  //       and destroy the fallback (double-click race, PR #4652 review);
  //   (b) switching to a different file while a reload fetch is in flight
  //       does not restore the previous file's HTML into the new preview
  //       (file-switch contamination race, PR #4652 review).
  const prevSourceBeforeReloadRef = useRef<{
    source: string;
    projectId: string;
    fileName: string;
  } | null>(null);
  // Holds the most recently fetched non-null source for routing-predicate
  // stability.  Content-derived predicates (needsSandboxShim, needsFocusGuard,
  // looksLikeDeck) fall back to this ref when source is null (i.e. during the
  // reload window between setSource(null) and the fetch resolving), so
  // urlLoadDecision stays stable and the srcDoc iframe does not briefly flip
  // to URL-load (Codex P2, issue #4650).  Cleared on file/project switch so
  // a new file never inherits the previous file's routing predicates.
  const lastGoodSourceForRoutingRef = useRef<string | null>(null);
  const sourceFileKeyRef = useRef<string | null>(
    source !== null ? currentSourceIdentity : null,
  );
  const sourceLoadInFlightRef = useRef<{
    key: string;
    promise: Promise<{
      text: string | null;
      poweredPreviewRequired: boolean;
      sourceLoadMode: HtmlSourceLoadMode;
    }>;
  } | null>(null);

  const renderedSourceAuthorizationScopeKeyRef = useRef(sourceAuthorizationScopeKey);
  if (renderedSourceAuthorizationScopeKeyRef.current !== sourceAuthorizationScopeKey) {
    renderedSourceAuthorizationScopeKeyRef.current = sourceAuthorizationScopeKey;
    // Clear preview and edit state before a local access boundary changes.
    setSource(null);
    setRoutingSource(null);
    setRoutingSourceIdentity(null);
    setServerPoweredPreviewRequired(false);
    sourceRef.current = null;
    sourceFileKeyRef.current = null;
    sourceEverLoadedRef.current = false;
    lastGoodSourceForRoutingRef.current = null;
    prevSourceBeforeReloadRef.current = null;
  }
  const templateNameId = useId();
  const templateDescriptionId = useId();
  const imageExportTitleId = useId();
  const forceInline = useMemo(
    () => (typeof window === 'undefined' ? false : parseForceInline(window.location.search)),
    [],
  );
  const [templateSavedToast, setTemplateSavedToast] = useState<string | null>(null);
  const [versionRestoredToast, setVersionRestoredToast] = useState<{ id: number; message: string } | null>(null);
  const versionRestoredToastIdRef = useRef(0);
  const [imageExportModalOpen, setImageExportModalOpen] = useState(false);
  const [imageExportContext, setImageExportContext] = useState<HtmlVersionExportContext | null>(null);
  const [imageExportFormat, setImageExportFormat] = useState<ImageExportFormat>('png');
  const [imageExportError, setImageExportError] = useState<string | null>(null);
  // Ask the daemon whether it can render slides each time an export surface
  // opens, and let the answer live no longer than that surface. This is the
  // whole capability contract, stated once:
  //
  //   1. An answer never outlives the surface opening that fetched it. The
  //      export surface is the popover's Export tab or the PPTX modal — not
  //      the popover shell, which can open on Share and sit there across a
  //      daemon swap before the tab is switched. Every way the surface can
  //      become visible (opening onto the Export tab, switching Share to
  //      Export, the menu-to-modal handoff) starts from unknown and asks
  //      again. Transitions arrive as batched updates whose OR can stay
  //      unchanged, so the effect depends on the raw inputs, not a derived
  //      boolean.
  //   2. Unknown fails open. A pending probe and a daemon predating the
  //      capability field both show the entry; only a resolved `false` — from
  //      this daemon, during this opening — hides it.
  //   3. The daemon stays the authority of last resort. A swap after the
  //      probe resolves is unclosable client-side (time-of-check vs
  //      time-of-use); it is caught by the export POST itself, whose 501
  //      surfaces the no-renderer message rather than a generic failure.
  //
  // Anything beyond this — background caches, retries, cross-surface
  // carryover — reintroduces the replica-of-remote-state problem this shape
  // exists to avoid.
  const [slideRendererAvailable, setSlideRendererAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    const exportSurfaceVisible =
      exportMenuOpen;
    if (!exportSurfaceVisible) return;
    let cancelled = false;
    setSlideRendererAvailable(null);
    void (async () => {
      // A probe that FAILS (daemon starting up, transient network) is retried
      // briefly, because leaving the whole opening at unknown would fail open
      // for its entire lifetime. A probe that SUCCEEDS without the capability
      // field is an old daemon: asking again cannot teach us more, so it
      // stops at unknown immediately. The retry lives and dies with this
      // opening — cancelled on any surface transition — so nothing here
      // crosses surfaces either.
      const retryDelaysMs = [1_000, 3_000];
      for (let attempt = 0; !cancelled; attempt += 1) {
        const info = await fetchAppVersionInfo();
        if (cancelled) return;
        if (info) {
          const next = info.capabilities?.slideRenderer;
          setSlideRendererAvailable(typeof next === 'boolean' ? next : null);
          return;
        }
        const delay = retryDelaysMs[attempt];
        if (delay === undefined) return;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exportMenuOpen,]);
  const imageExportSnapshotDataUrlRef = useRef<string | null>(null);
  // Threads the share-popover click → artifact_export_result(image) pair, the
  // same correlation other export formats get via fireShareExport. The image
  // export is a separate modal flow, so it owns its own request id / start.
  const imageExportRequestIdRef = useRef<string | null>(null);
  const imageExportStartedRef = useRef(0);
  const imageExportOriginPromiseRef = useRef<Promise<ArtifactExportOriginProps> | null>(null);
  // Guards against double-emitting the image export result: each modal
  // session (reset in openImageExportModal) resolves to exactly one
  // success / failed / cancelled, no matter which exit path runs.
  const imageExportResolvedRef = useRef(false);
  // Same click→result correlation for Save as template, which now reports the
  // export result only after the template is actually saved (not on open).
  const templateExportRequestIdRef = useRef<string | null>(null);
  const templateExportStartedRef = useRef(0);
  const templateExportOriginPromiseRef = useRef<Promise<ArtifactExportOriginProps> | null>(null);
  // Same one-terminal-result guard as image export: a template session
  // (reset in _openSaveAsTemplateModal) emits exactly one success/failed/
  // cancelled, whether it ends in a save or a modal dismiss.
  const templateExportResolvedRef = useRef(false);
  const imageExportInFlightRef = useRef(false);
  // "Screenshot to chat" uploads the captured PNG into the project's own file
  // tree (registry.ts: uploadProjectFiles lands it flat in the project root).
  // The daemon's chokidar watcher sees that add like any other file change and
  // pushes `file-changed`, which — via the live-reload effect below — force-
  // reloads THIS SAME preview iframe a moment later even though the artifact
  // itself never changed. Users saw that as a visible flash/jitter on every
  // screenshot (issue: "「截图」也会有抖动"). Arm this timestamp right before
  // the screenshot's annotation event goes out so the live-reload effect can
  // recognize the incoming refresh as self-inflicted and skip the reload.
  // 5s comfortably covers the upload round-trip + chokidar + SSE + the
  // effect's own 180ms debounce (measured ~1.4s locally).
  const suppressLiveReloadUntilRef = useRef(0);
  const [exportToast, setExportToast] = useState<ExportToastState | null>(null);
  const shareRef = useRef<HTMLDivElement | null>(null);
  /*
   * 菜单开在哪儿。
   *
   * `null` = 工具栏点开的那一条路,菜单原地长在 `.chrome-share-menu` 里,和搬动
   * 之前完全一样。有值 = 产物卡上那枚胶囊点开的,菜单要开在**那枚按钮**旁边
   * (产品 2026-08-27)—— 菜单本身是同一块,只是换个地方渲染。
   */
  const [menuAnchorId, setMenuAnchorId] = useState<string | null>(null);
  const toolbarMenuAnchorId = useId();
  const [menuOrigin, setMenuOrigin] = useState<'toolbar' | 'artifact-card'>('toolbar');
  /*
   * 稳定身份 —— 这个回调会进 `AnchoredMenuShell` 里那条 effect 的依赖数组。
   * 传内联箭头的话它每次渲染都是新的,effect 于是每帧重跑;菜单已隐藏期间
   * 每帧都会再调一次关闭。行为上无害(幂等),但白烧一遍,而且把「翻真时发
   * 一次」变成「只要还真就一直发」,读起来会误导。
   */
  /*
   * 只关「开」这一个状态就够了 —— `menuAnchorId` 不用在这里清:每一条会把菜单
   * 打开的路都会自己设它(卡片那两条 effect 各自设成锚点 id,工具栏那条设成
   * null),所以不存在「带着上一次的锚点被重新打开」的路径。
   * 试过在这里也清一遍,消融时没有任何用例因此变红 —— 那就是没用的代码,不留。
   */
  const closeExportMenu = useCallback(() => setExportMenuOpen(false), []);

  // portal 出去的那一份要单独算「点在里面」,否则外点关闭会把它自己关掉
  const anchoredMenuRef = useRef<HTMLDivElement | null>(null);
  const [chromeActionsHost, setChromeActionsHost] = useState<HTMLElement | null>(
    () => (typeof document === 'undefined' ? null : resolveChromeActionsHost()),
  );
  useLayoutEffect(() => {
    if (!workspaceActive || typeof document === 'undefined') return;
    setChromeActionsHost(resolveChromeActionsHost());
  }, [workspaceActive]);

  const shouldDeferPassivePreviewSource =
    liveHtml === undefined &&
    file.size > HTML_PASSIVE_PREVIEW_FULL_TEXT_LIMIT &&
    mode === 'preview';

  useEffect(() => {
    // Open HTML tabs stay mounted at the real viewport size. Keep refreshing
    // retained source snapshots in the background so activation is only a
    // visibility swap, including after an agent edits an inactive file.
    // Never turn a pending or denied bound-project authority into a legal
    // local/headerless read. The authorization key changes when an exact
    // Workspace witness resolves, which reruns this effect with scoped URL and
    // headers. Only an explicit daemon `unbound` result receives the local key.
    if (projectResourceReadBlocked) return;
    const sourceFileKey = currentSourceIdentity;
    if (liveHtml !== undefined) {
      sourceFileKeyRef.current = sourceFileKey;
      sourceEverLoadedRef.current = true;
      sourceLoadedKeysRef.current.add(sourceLoadedFileKey);
      setSource(liveHtml);
      setRoutingSource(liveHtml);
      setRoutingSourceIdentity(sourceFileKey);
      setServerPoweredPreviewRequired(false);
      sourceRef.current = liveHtml;
      return;
    }
    const fileChanged = sourceFileKeyRef.current !== sourceFileKey;
    sourceFileKeyRef.current = sourceFileKey;
    const cachedSnapshot = sourceAuthorizationScopeKey
      ? getHtmlSourceSnapshot(
          sourceAuthorizationScopeKey,
          projectId,
          file.name,
          sourceSnapshotRefreshKey,
        )
      : null;
    if (fileChanged) {
      const cachedSource = cachedSnapshot?.source ?? null;
      setSource(cachedSource);
      setRoutingSource(cachedSource);
      setRoutingSourceIdentity(cachedSource === null ? null : sourceFileKey);
      setServerPoweredPreviewRequired(false);
      sourceRef.current = cachedSource;
      if (cachedSource !== null) {
        sourceEverLoadedRef.current = true;
        sourceLoadedKeysRef.current.add(sourceLoadedFileKey);
        lastGoodSourceForRoutingRef.current = cachedSource;
      }
      // Note: prevSourceBeforeReloadRef is cleared by the [projectId,
      // file.name] reset effect that runs on file/project switch.  The
      // identity check in the null-restore branch below is defense-in-depth
      // for races where an in-flight async callback fires after the file
      // switches but before the effect has run.
    }
    let cancelled = false;
    // A snapshot with the exact authorization and content-version identity is
    // authoritative until the file event path invalidates it or the file
    // metadata / Workspace identity changes. Re-reading the same bytes on
    // every ordinary viewer remount made Files ↔ preview round-trips
    // perform one uncached raw request apiece.
    if (cachedSnapshot !== null) {
      return () => {
        cancelled = true;
      };
    }
    if (
      shouldDeferPassivePreviewSource &&
      sourceRef.current !== null &&
      !previewTextNeedsFullSourceForSafeInline(sourceRef.current)
    ) {
      setRoutingSource(sourceRef.current);
      setRoutingSourceIdentity(sourceFileKey);
      sourceEverLoadedRef.current = true;
      sourceLoadedKeysRef.current.add(sourceLoadedFileKey);
      return () => {
        cancelled = true;
      };
    }
    const cacheBustKey = `${file.mtime}-${reloadKey}-${filesRefreshKey}`;
    const sourceLoadKey = [
      sourceAuthorizationScopeKey ?? 'pending',
      projectId,
      file.name,
      cacheBustKey,
      shouldDeferPassivePreviewSource ? 'routing-preview' : 'full',
    ].join('\0');
    let sourceLoad = sourceLoadInFlightRef.current;
    if (sourceLoad?.key !== sourceLoadKey) {
      const promise = shouldDeferPassivePreviewSource
        ? fetchProjectFileTextPreview(projectId, file.name, {
          limit: HTML_ROUTING_TEXT_PREVIEW_LIMIT,
          cacheBustKey,

        }).then(async (preview) => {
          const previewText = preview?.text ?? null;
          if (previewTextNeedsFullSourceForSafeInline(previewText)) {
            const fullText = await fetchProjectFileText(projectId, file.name, {
              cache: 'no-store',
              cacheBustKey,

            });
            if (fullText !== null) {
              return {
                text: fullText,
                poweredPreviewRequired: preview?.poweredPreview.required === true,
                sourceLoadMode: 'full' as HtmlSourceLoadMode,
              };
            }
          }
          return {
            text: previewText,
            poweredPreviewRequired: preview?.poweredPreview.required === true,
            sourceLoadMode: 'routing-preview' as HtmlSourceLoadMode,
          };
        })
      : fetchProjectFileText(projectId, file.name, {
          cache: 'no-store',
          cacheBustKey,

        }).then((text) => ({
        text,
        poweredPreviewRequired: false,
        sourceLoadMode: 'full' as HtmlSourceLoadMode,
      }));
      sourceLoad = { key: sourceLoadKey, promise };
      sourceLoadInFlightRef.current = sourceLoad;
      void promise.finally(() => {
        if (sourceLoadInFlightRef.current?.key === sourceLoadKey) {
          sourceLoadInFlightRef.current = null;
        }
      });
    }
    void sourceLoad.promise.then(({ text, poweredPreviewRequired, sourceLoadMode }) => {
      if (cancelled) return;
      setServerPoweredPreviewRequired(poweredPreviewRequired);
      // Chokidar emits agent rewrites as unlink+add+change bursts; a
      // transient null mid-burst would blank source → srcDoc empty →
      // shell stays on prior frame. Keep the last good text instead.
      if (text == null) {
        if (shouldDeferPassivePreviewSource) {
          sourceEverLoadedRef.current = true;
      sourceLoadedKeysRef.current.add(sourceLoadedFileKey);
          setRoutingSource('');
          setRoutingSourceIdentity(sourceFileKey);
          setServerPoweredPreviewRequired(false);
          return;
        }
        // A srcDoc Reload may have cleared source to null just before this
        // fetch resolved.  If the fetch failed (non-2xx, network error),
        // restore the pre-reload source so the iframe doesn't go blank.
        // prevSourceBeforeReloadRef is null on a normal file-change fetch,
        // so this branch is a no-op outside of the Reload failure case.
        //
        // Guard: only restore if the snapshot was taken for the current
        // file.  A file-switch clears the ref (see fileChanged block above),
        // but we double-check the identity here to prevent cross-file
        // contamination in case the ref was not yet cleared by the time this
        // async callback fires (file-switch race, PR #4652 review).
        const snap = prevSourceBeforeReloadRef.current;
        if (
          snap != null &&
          snap.projectId === projectId &&
          snap.fileName === file.name
        ) {
          setSource(snap.source);
          setRoutingSource(snap.source);
          setRoutingSourceIdentity(sourceFileKey);
          sourceRef.current = snap.source;
          prevSourceBeforeReloadRef.current = null;
        } else if (snap != null) {
          // Identity mismatch: the snapshot belongs to a different file or
          // project. Clear it now so it cannot leak forward and be consumed by
          // a later normal failed load on the original file (PR #4652
          // third-pass review, Codex P2 finding).
          prevSourceBeforeReloadRef.current = null;
        }
        return;
      }
      prevSourceBeforeReloadRef.current = null;
      sourceEverLoadedRef.current = true;
      sourceLoadedKeysRef.current.add(sourceLoadedFileKey);
      lastGoodSourceForRoutingRef.current = text;
      setRoutingSource(text);
      setRoutingSourceIdentity(sourceFileKey);
      if (sourceLoadMode === 'routing-preview') {
        sourceRef.current = null;
      } else {
        if (sourceAuthorizationScopeKey) {
          setHtmlSourceSnapshot({
            authorizationScopeKey: sourceAuthorizationScopeKey,
            projectId,
            fileName: file.name,
            refreshKey: sourceSnapshotRefreshKey,
            source: text,
          });
        }
        setSource(text);
        sourceRef.current = text;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    file.name,
    file.mtime,
    liveHtml,
    reloadKey,
    filesRefreshKey,
    sourceSnapshotRefreshKey,
    sourceAuthorizationScopeKey,
    currentSourceIdentity,
    shouldDeferPassivePreviewSource,
    projectResourceReadBlocked,
  ]);

  const routingHtmlSource = source ?? routingSource ?? lastGoodSourceForRoutingRef.current;
  const passiveLargeHtmlPreview = shouldDeferPassivePreviewSource && source === null;
  const previewZoomPercent = resolveDesktopPreviewZoomPercent({
    zoomMode,
    viewport: previewViewport,
    manualZoomPercent: zoom,
    canvasSize: previewBodySize,
    contentWidth: desktopPreviewContentWidthEntry?.overflow
      ? desktopPreviewContentWidth
      : null,
  });
  const previewScale = previewZoomPercent / 100;
  previewContentMeasurementContextRef.current = {
    canvasWidth: previewBodySize?.width ?? 0,
    previewScale,
    eligible: mode === 'preview' &&
      previewViewport === 'desktop' &&
      zoomMode === 'auto',
  };
  if (!previewContentMeasurementContextRef.current.eligible) {
    latestPreviewContentMeasurementRef.current = null;
  }
  useEffect(() => {
    if (previewViewport !== 'desktop' || zoomMode !== 'auto') return;
    scheduleDesktopPreviewContentMeasure();
  }, [
    previewScale,
    previewViewport,
    scheduleDesktopPreviewContentMeasure,
    zoomMode,
  ]);
  const previewZoomText = zoomPercentLabel(previewZoomPercent);
  const zoomLevelActive = (level: number) => Math.abs(previewZoomPercent - level) < 0.001;
  const relativeProjectAssetRefs = useMemo(
    () => source != null && htmlHasRelativeProjectAssetRefs(source, file.name, null),
    [source, file.name],
  );
  // Browser-owned iframe subresource requests cannot attach Workspace headers,
  // and URL resolution does not inherit the query string from the document's
  // scoped raw URL. Hold the Team preview until every confirmed relative asset
  // has been rewritten to its own scoped raw URL; otherwise the first srcDoc
  // paint can leak an unscoped font/image request before the async rewrite
  // finishes.

  const livePreviewSource = inlinedSource ?? source;
  const assetInliningSource = source;
  const previewSource = livePreviewSource;
  const needsSandboxShim = useMemo(() => {
    if (passiveLargeHtmlPreview) return false;
    const s = routingHtmlSource;
    return s != null && htmlNeedsSandboxShim(s);
  }, [passiveLargeHtmlPreview, routingHtmlSource]);
  const needsLocalInteractionBridge = useMemo(() => {
    if (passiveLargeHtmlPreview) return false;
    return routingHtmlSource != null && htmlNeedsLocalInteractionBridge(routingHtmlSource);
  }, [passiveLargeHtmlPreview, routingHtmlSource]);
  const needsFocusGuard = useMemo(() => {
    if (passiveLargeHtmlPreview) return false;
    const s = routingHtmlSource;
    return s != null && htmlNeedsFocusGuard(s);
  }, [passiveLargeHtmlPreview, routingHtmlSource]);
  // A self-redirecting artifact needs the redirect-loop guard on whichever
  // transport owns the document (inherited issue #710).
  const needsRedirectGuard = useMemo(() => {
    if (passiveLargeHtmlPreview) return false;
    const s = routingHtmlSource;
    return s != null && htmlNeedsRedirectGuard(s);
  }, [passiveLargeHtmlPreview, routingHtmlSource]);
  const needsPersistentStorage = Boolean(routingHtmlSource && /\blocalStorage\b/.test(routingHtmlSource));
  const urlDocumentGuardsAvailable =
    liveHtml === undefined && file.size <= PREVIEW_URL_GUARD_MAX_HTML_BYTES;
  // Set by the injected guard's `pixo:redirect-loop-blocked` postMessage. The
  // browser makes `window.location` unforgeable, so a runaway reload can only be
  // stopped host-side — parking the srcDoc iframe on static content below. File-
  // scoped: reset whenever the file, project, or reload key changes.
  const [redirectLoopBlocked, setRedirectLoopBlocked] = useState(false);
  // Project file paths, for confirming root-relative asset refs
  // (`/reference-assets/main.css`) against real files instead of guessing
  // from path shape. `null` while the list is in flight — the detection memo
  // below then runs in conservative candidate mode so a clone artifact never
  // flashes through the (unstyled) URL-load path before the list lands.
  const [projectFilePathSet, setProjectFilePathSet] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    // Do not include workspaceActive itself in this effect's dependencies:
    // every retained viewer is first mounted while active. A same-token
    // inactive -> active transition must reuse the loaded path snapshot,
    // while a file-watch token accumulated during inactivity changes
    // filesRefreshKey and therefore still runs this effect on activation.
    if (!workspaceActiveRef.current) return;
    const controller = new AbortController();
    setProjectFilePathSet(null);
    void fetchProjectFiles(projectId, {  signal: controller.signal })
      .then((files) => {
        if (!controller.signal.aborted) {
          setProjectFilePathSet(new Set(files.map((entry) => entry.name)));
        }
      })
      .catch(() => {
        // Keep the conservative `null` state: a failed read is not proof that
        // the project has no root-relative assets.
      });
    return () => {
      controller.abort();
    };
  }, [projectId, file.mtime, filesRefreshKey, reloadKey,]);
  const projectRootAssetRefs = useMemo(
    () => source != null && htmlHasRootRelativeProjectAssetRefs(source, projectFilePathSet),
    [source, projectFilePathSet],
  );
  useEffect(() => {
    if (!workspaceActive) return;
    setPreviewAssetWarning(null);
    // Personal/local project resources do not need Team authorization
    // headers, so the iframe's own subresource requests are the source of
    // truth. Probing
    // the same paths here duplicates every image/font read before first paint
    // (large landing pages can exceed 20 MB) and competes with Chromium's
    // renderer for the exact files it is already loading. Team previews keep
    // the preflight because browser-owned iframe requests cannot surface the
    // daemon's scoped raw-route refusal safely to the host UI.
    return;

  }, [
    file.mtime,
    file.name,
    filesRefreshKey,
    mode,
    projectFilePathSet,
    projectId,
    reloadKey,
    routingHtmlSource,
    workspaceActive,
  ]);
  const needsPowered = useMemo(() => {
    if (serverPoweredPreviewRequired) return true;
    const s = routingHtmlSource;
    return s != null && htmlNeedsPoweredPreview(s);
  }, [routingHtmlSource, serverPoweredPreviewRequired]);
  const previewBridgeQuery = useMemo(() => {
    const query = [BASE_PREVIEW_BRIDGE_QUERY];
    // Preserve the old URL-load behavior for ordinary passive documents. Only
    // request a guard when the source heuristic says this artifact needs it;
    // this avoids suppressing authored focus/navigation in unrelated pages.
    // Keep guards on the ordinary URL fallback if isolation is unavailable.
    // The powered URL below uses only BASE_PREVIEW_BRIDGE_QUERY.
    if (needsSandboxShim) query.push('pixoPreviewBridge=sandbox');
    if (needsFocusGuard) query.push('pixoPreviewBridge=focus');
    if (needsRedirectGuard) query.push('pixoPreviewBridge=redirect');
    return query.join('&');
  }, [needsFocusGuard, needsPowered, needsRedirectGuard, needsSandboxShim]);
  const urlLoadDecision: UrlLoadDecision = {
    mode,
    forceInline: (forceInline || needsPersistentStorage) && !needsPowered,
    needsSandboxShim: needsSandboxShim && !needsPowered,
    needsLocalInteractionBridge: needsLocalInteractionBridge && !needsPowered,
    // Daemon guards wrap the settled on-disk response. Streaming/in-memory
    // HTML has no matching URL representation, so keep it on srcDoc until it
    // lands on disk instead of showing stale bytes from the raw route.
    urlSandboxGuard: urlDocumentGuardsAvailable,
    needsFocusGuard: needsFocusGuard && !needsPowered,
    urlFocusGuard: urlDocumentGuardsAvailable,
    needsRedirectGuard: needsRedirectGuard && !needsPowered,
    urlRedirectGuard: urlDocumentGuardsAvailable,
    projectRootAssetRefs: projectRootAssetRefs,
  };
  const urlLoadPreviewSupported = shouldUrlLoadHtmlPreview({
    ...urlLoadDecision,
    mode: 'preview',
  });
  const useUrlLoadPreview = mode === 'preview' && urlLoadPreviewSupported;
  // Wait for source discovery before minting. A committed file switch can
  // still carry the previous file's state until the source-loading effect
  // clears/replaces it, so only inspect bytes witnessed for this identity.
  const setSrcDocPreviewIframe = useCallback((frame: HTMLIFrameElement | null) => {
    if (srcDocPreviewIframeRef.current !== frame) {
      if (srcDocPreviewIframeRef.current) unbindMotionPreviewActivity(srcDocPreviewIframeRef.current);
      srcDocNavigationCommittedRef.current = null;
      srcDocContentReadyRef.current = null;
    }
    // Reset before the shell can announce readiness. Its ready message may
    // precede the first load; resetting in onLoad would activate it twice.
    if (frame && srcDocFrameDedupeResetForRef.current !== frame) {
      srcDocFrameDedupeResetForRef.current = frame;
      activatedSrcDocTransportHtmlRef.current = null;
    }
    srcDocPreviewIframeRef.current = frame;
    if (frame) bindMotionPreviewActivity(frame);
    // A ref callback is the only synchronous witness when React replaces or
    // reattaches the active document. Keeping the generic active ref aligned
    // here prevents edit/style messages from being sent to the previous
    // iframe until a later load event happens to repair it.
    if (!useUrlLoadPreview) iframeRef.current = frame;
  }, [useUrlLoadPreview]);
  const authoredSrcDocBase = useMemo(
    () => (
      routingSourceIdentity !== currentSourceIdentity || routingHtmlSource == null
        ? null
        : htmlHasAuthoredBase(routingHtmlSource)
    ),
    [currentSourceIdentity, routingHtmlSource, routingSourceIdentity],
  );

  const urlPreviewBaseIdentity = `url\0${srcDocPreviewBaseIdentity}`;
  const effectiveUrlLoadedPreviewBase =
    urlLoadedPreviewBase?.identity === urlPreviewBaseIdentity
      ? urlLoadedPreviewBase.scope
      : null;
  useEffect(() => {
    if (!workspaceActive) return;
    const frame = urlPreviewIframeRef.current;
    function onMessage(ev: MessageEvent) {
      if (ev.source !== frame?.contentWindow) return;
      const data = ev.data as {
        type?: unknown;
        href?: unknown;
        expiresAt?: unknown;
      } | null;
      if (
        data?.type !== 'pixo:preview-base-scope'
        || typeof data.href !== 'string'
        || typeof data.expiresAt !== 'number'
        || !Number.isFinite(data.expiresAt)
      ) return;
      let matchesProject = false;
      try {
        const parsed = new URL(data.href, window.location.href);
        matchesProject = parsed.pathname.startsWith(
          `/api/projects/${encodeURIComponent(projectId)}/preview/`,
        );
      } catch { /* invalid preview base */ }
      if (!matchesProject) return;
      const next = {
        identity: urlPreviewBaseIdentity,
        scope: { href: data.href, expiresAt: data.expiresAt },
      };
      urlLoadedPreviewBaseRef.current = next;
      setUrlLoadedPreviewBase(next);
    }
    window.addEventListener('message', onMessage);
    frame?.contentWindow?.postMessage({ type: 'pixo:preview-base-scope-probe' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, [projectId, urlPreviewBaseIdentity, workspaceActive]);
  const postPreviewBaseUpdate = useCallback((href: string) => {
    const requestId = `preview-base-${Date.now()}`;
    const message = { type: 'pixo:preview-base-update', requestId, href };
    const frames = viewerRootRef.current?.querySelectorAll('iframe') ?? [];
    for (const frame of frames) frame.contentWindow?.postMessage(message, '*');
  }, []);
  useEffect(() => {
    let renewableScope: ProjectPreviewBaseScope | null = null;
    if (useUrlLoadPreview) {
      renewableScope = effectiveUrlLoadedPreviewBase;
    } else if (authoredSrcDocBase === false) {
      renewableScope = effectiveScopedSrcDocPreviewBase;
    }
    if (
      !workspaceActive
      || mode !== 'preview'
      || !renewableScope
      || projectResourceReadBlocked
    ) return;
    const identity = useUrlLoadPreview
      ? urlPreviewBaseIdentity
      : srcDocPreviewBaseIdentity;
    let cancelled = false;
    let timeout: number | null = null;

    const schedule = (scope: ProjectPreviewBaseScope, retry = false) => {
      if (cancelled) return;
      const delay = retry
        ? PREVIEW_SCOPE_RETRY_MS
        : Math.max(0, scope.expiresAt - Date.now() - PREVIEW_SCOPE_RENEW_MARGIN_MS);
      timeout = window.setTimeout(() => void refresh(scope), delay);
    };
    const refresh = async (scope: ProjectPreviewBaseScope) => {
      const renewedExpiresAt = await renewProjectPreviewBaseScope(projectId, scope.href);
      if (cancelled) return;
      if (renewedExpiresAt !== null) {
        const renewed = { href: scope.href, expiresAt: renewedExpiresAt };
        if (useUrlLoadPreview) {
          urlLoadedPreviewBaseRef.current = { identity, scope: renewed };
        } else {
          activeSrcDocPreviewBaseRef.current = { identity, scope: renewed };
        }
        schedule(renewed);
        return;
      }

      // A daemon restart or a suspended browser can invalidate the in-memory
      // capability. Replace only the live <base>; do not navigate the iframe.
      const replacement = await fetchProjectPreviewBaseHref(projectId, file.name);
      if (cancelled) return;
      if (!replacement) {
        schedule(scope, true);
        return;
      }
      if (useUrlLoadPreview) {
        urlLoadedPreviewBaseRef.current = { identity, scope: replacement };
      } else {
        activeSrcDocPreviewBaseRef.current = { identity, scope: replacement };
        setAuxiliarySrcDocPreviewBase({ identity, href: replacement.href });
      }
      postPreviewBaseUpdate(replacement.href);
      schedule(replacement);
    };

    const active = useUrlLoadPreview
      ? urlLoadedPreviewBaseRef.current
      : activeSrcDocPreviewBaseRef.current;
    schedule(active?.identity === identity ? active.scope : renewableScope);
    return () => {
      cancelled = true;
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [
    authoredSrcDocBase,
    effectiveScopedSrcDocPreviewBase,
    effectiveUrlLoadedPreviewBase,
    file.name,
    mode,
    postPreviewBaseUpdate,
    projectId,
    projectResourceReadBlocked,
    srcDocPreviewBaseIdentity,
    useUrlLoadPreview,
    urlPreviewBaseIdentity,
    workspaceActive,
  ]);
  const basePreviewSrcUrl = useMemo(
    () => appendResourceQuery(
      projectRawUrl(projectId, file.name),
      `v=${Math.round(file.mtime)}&r=${reloadKey}&${previewBridgeQuery}`,
    ),
    [projectId, file.name, file.mtime, previewBridgeQuery, reloadKey,],
  );
  const [previewSrcUrl, setPreviewSrcUrl] = useState(basePreviewSrcUrl);
  // Hold the iframe URL still (it carries file.mtime) while the user is mid
  // annotation/edit, mirroring the source freeze above. Otherwise a
  // background file change bumps mtime → basePreviewSrcUrl → a URL-load
  // reload right under an active mark/edit/inspect. Captured once at
  // mode entry via a ref and released on exit, so the deferred reload lands
  // exactly once when the user is done.
  useEffect(() => {
    setSrcDocMaterialized(false);
    // Re-arm the loading skeleton ONLY for files this pane has never shown:
    // a brand-new file's slow fetch must show the indicator, not a blank
    // iframe (codex P2 finding, issue #4650) — but revisiting a file the
    // pane already rendered skips the skeleton instead of flashing it on
    // every tab switch (per-file memory in sourceLoadedKeysRef).
    //
    // The snapshot ref (prevSourceBeforeReloadRef) is the restore branch only —
    // it must NOT gate this sentinel. Keeping the guard caused a new file's
    // preview to bypass the loading skeleton entirely and mount an empty srcDoc
    // iframe when a reload snapshot was non-null at switch time (PR #4652
    // third-pass review, PerishCode finding).
    sourceEverLoadedRef.current = sourceLoadedKeysRef.current.has(sourceLoadedFileKey);
    lastGoodSourceForRoutingRef.current = null;
    prevSourceBeforeReloadRef.current = null;
  }, [projectId, file.name, sourceLoadedFileKey]);
  const previewSrcMatchesCurrentBase = previewSrcUrl === basePreviewSrcUrl
    || previewSrcUrl.startsWith(`${basePreviewSrcUrl}&`);
  const activePreviewSrcUrl = filesRefreshPending || previewSrcMatchesCurrentBase
    ? previewSrcUrl
    : basePreviewSrcUrl;
  const previewSrcCarriesCurrentRefresh = filesRefreshKey !== 0
    && new RegExp(`[?&]fr=${filesRefreshKey}(?:&|$)`).test(previewSrcUrl);
  useEffect(() => {
    if (filesRefreshPending || previewSrcCarriesCurrentRefresh) return;
    setPreviewSrcUrl(basePreviewSrcUrl);
  }, [basePreviewSrcUrl, filesRefreshPending, previewSrcCarriesCurrentRefresh]);
  useEffect(() => {
    if (!workspaceActive || mode !== 'preview' || (!useUrlLoadPreview && previewSource === null)) return;
    const frame = useUrlLoadPreview ? urlPreviewIframeRef.current : srcDocPreviewIframeRef.current;
    if (!frame) return;
    return trackVisiblePreview({ iframe: frame, renderMode: useUrlLoadPreview ? 'url_load' : 'srcdoc',
      artifactKind: handoffArtifactKind ?? artifactKindToTracking({ fileKind: file.kind ?? null }) ?? null });
  }, [workspaceActive, mode, useUrlLoadPreview, projectId, file.name, file.kind, handoffArtifactKind, reloadKey, activePreviewSrcUrl, previewSource]);
  const previewObservabilitySeenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    previewObservabilitySeenRef.current = new Set();
  }, [projectId, file.name, reloadKey]);
  useEffect(() => {
    if (mode !== 'preview') return undefined;
    return subscribePreviewIframeMessages(({ source: messageSource, data }) => {
      if (!workspaceActiveRef.current || document.visibilityState !== 'visible') return;
      const activeFrame = useUrlLoadPreview
        ? urlPreviewIframeRef.current
        : srcDocPreviewIframeRef.current;
      if (!activeFrame || !isPreviewFrameVisible(activeFrame) || messageSource !== activeFrame.contentWindow) return;
      reportPreviewIframeMessage(data, {
        surface: 'artifact_preview',
        renderMode: useUrlLoadPreview ? 'url_load' : 'srcdoc',
        artifactId: anonymizeArtifactId({ projectId, fileName: file.name }),
        artifactKind: handoffArtifactKind ?? artifactKindToTracking({ fileKind: file.kind ?? null }),
        projectId,
      }, previewObservabilitySeenRef.current);
    });
  }, [file.kind, file.name, handoffArtifactKind, mode, projectId, useUrlLoadPreview]);
  useEffect(() => {
    const activeFrame = useUrlLoadPreview
      ? urlPreviewIframeRef.current
      : srcDocPreviewIframeRef.current;
    iframeRef.current = activeFrame;
    if (
      activeFrame?.dataset.pixoLoadedPreviewEpoch === previewContentMeasurementDocumentEpoch
    ) {
      beginDesktopPreviewContentMeasurementGeneration(activeFrame);
      scheduleDesktopPreviewContentMeasure(activeFrame);
    }
  }, [
    beginDesktopPreviewContentMeasurementGeneration,
    previewContentMeasurementDocumentEpoch,
    scheduleDesktopPreviewContentMeasure,
    useUrlLoadPreview,
  ]);
  // Clear a redirect-loop park whenever the artifact changes or the user hits
  // reload (reloadKey bump): the previewed content is fresh, so give it a clean
  // run rather than staying pinned on the "loop detected" placeholder.
  useEffect(() => {
    setRedirectLoopBlocked(false);
  }, [projectId, file.name, reloadKey]);
  // The injected redirect guard posts `pixo:redirect-loop-blocked` when a preview
  // reloads itself past its hop budget. Only trust our own two preview frames,
  // then park the srcDoc iframe on static content so the loop cannot continue.
  useEffect(() => {
    if (!workspaceActive) return;
    function onMessage(ev: MessageEvent) {
      const fromPreview =
        ev.source === srcDocPreviewIframeRef.current?.contentWindow ||
        ev.source === urlPreviewIframeRef.current?.contentWindow;
      if (!fromPreview) return;
      const data = ev.data as { type?: string } | null;
      if (data?.type !== PREVIEW_REDIRECT_LOOP_MESSAGE) return;
      setRedirectLoopBlocked(true);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [workspaceActive]);

  // Resolve the cross-origin powered-preview URL for artifacts that need it.
  // `resolved:false` means the (cached) daemon isolation probe is still in
  // flight — the URL iframe stays parked at about:blank until it settles so a
  // large artifact is never loaded twice (once opaque, once powered). A null
  // `url` after resolution means powered mode is unavailable (e.g. no
  // cross-origin loopback base); the viewer then falls back to the normal
  // opaque URL-load path, which still runs WebGL/blob-Workers/WASM.
  const [powered, setPowered] = useState<{ resolved: boolean; url: string | null }>({
    resolved: false,
    url: null,
  });
  useEffect(() => {
    if (!(needsPowered && useUrlLoadPreview)) {
      setPowered({ resolved: false, url: null });
      return;
    }
    let cancelled = false;
    setPowered({ resolved: false, url: null });
    void resolvePoweredPreviewUrl(projectId, file.name).then((base) => {
      if (cancelled) return;
      setPowered({
        resolved: true,
        url: base ? `${base}?v=${Math.round(file.mtime)}&r=${reloadKey}&${BASE_PREVIEW_BRIDGE_QUERY}` : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    needsPowered,
    useUrlLoadPreview,
    projectId,
    file.name,
    file.mtime,
    previewBridgeQuery,
    reloadKey,
  ]);
  const usePoweredPreview = needsPowered && useUrlLoadPreview && powered.url != null;
  const poweredResolving = needsPowered && useUrlLoadPreview && !powered.resolved;
  const [poweredPreviewSrcOverride, setPoweredPreviewSrcOverride] = useState<{
    projectId: string;
    fileName: string;
    mtime: number;
    size: number;
    refreshKey: number;
    reloadKey: number;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (filesRefreshKey === 0) return;
    if (appliedFilesRefreshKeyRef.current === filesRefreshKey) return;
    // Defer the file-watcher live-reload while annotating; the effect re-runs
    // when the mode closes (interactivePreviewModeActive flips) and applies
    // the now-current URL in one pass.

    // Skip a refresh this viewer caused itself (screenshot-to-chat's own
    // upload landing in the project folder) — see suppressLiveReloadUntilRef
    // above. Reloading the live preview for a file-changed echo of our own
    // unrelated attachment upload is exactly the flash users reported.
    if (Date.now() < suppressLiveReloadUntilRef.current) return;
    if (needsPowered && useUrlLoadPreview && !powered.resolved) return;
    const refreshBasePreviewSrcUrl = usePoweredPreview && powered.url
      ? powered.url
      : basePreviewSrcUrl;
    const refreshPreviewSrcUrl = appendResourceQuery(
      refreshBasePreviewSrcUrl,
      `pixoPreviewEpoch=${encodeURIComponent(previewContentMeasurementDocumentEpoch)}`,
    );
    const nextSrc = appendResourceQuery(refreshPreviewSrcUrl, `fr=${filesRefreshKey}`);
    const timeout = window.setTimeout(() => {
      appliedFilesRefreshKeyRef.current = filesRefreshKey;
      if (usePoweredPreview) {
        setPoweredPreviewSrcOverride({
          projectId,
          fileName: file.name,
          mtime: file.mtime,
          size: file.size,
          refreshKey: filesRefreshKey,
          reloadKey,
          url: nextSrc,
        });
      } else {
        // The final URL transport layer appends the document epoch. Keep the
        // base state epoch-free so React does not emit duplicate query keys.
        setPreviewSrcUrl(appendResourceQuery(refreshBasePreviewSrcUrl, `fr=${filesRefreshKey}`));
      }
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [
    basePreviewSrcUrl,
    filesRefreshKey,
    useUrlLoadPreview,
    needsPowered,
    powered.resolved,
    powered.url,
    projectId,
    file.name,
    file.mtime,
    file.size,
    reloadKey,
    previewContentMeasurementDocumentEpoch,
    usePoweredPreview,
  ]);

  useEffect(() => {
    setInlinedSource(null);
    if (useUrlLoadPreview) return;
    if (!assetInliningSource) return;
    // Personal-project srcDoc previews already have a stable raw-file base,
    // so Chromium can resolve ordinary relative assets itself. Re-fetching
    // and inlining every stylesheet/script here replaces an already-visible
    // document after asynchronous file discovery settles. Team previews are
    // different: iframe subresource requests cannot carry workspace auth, so
    // they still require per-asset materialization. Personal root-relative
    // refs also keep this pass because they first need project-file-list
    // normalization before the stable base can resolve them correctly.
    const requiresAssetMaterialization =
      projectRootAssetRefs;
    if (!requiresAssetMaterialization) return;
    // Root-relative project asset refs need the confirmed file list before
    // they can be normalized; wait for it rather than inlining a half-fixed
    // document (the effect re-runs when the set lands).
    if ((projectRootAssetRefs) && projectFilePathSet === null) return;
    if (!relativeProjectAssetRefs && !projectRootAssetRefs) return;
    let cancelled = false;
    void inlineRelativeAssets(
      assetInliningSource,
      projectId,
      file.name,
      projectFilePathSet
    ).then((next) => {
      if (!cancelled) setInlinedSource(next);
    });
    return () => {
      cancelled = true;
    };
  }, [
    assetInliningSource,
    projectId,
    file.name,
    reloadKey,
    useUrlLoadPreview,
    projectRootAssetRefs,
    relativeProjectAssetRefs,
    projectFilePathSet,
  ]);

  const srcDocBaseSeedHref = effectiveScopedSrcDocPreviewBase?.href
    ?? previewRuntimeUrl(projectRawUrl(projectId, baseDirFor(file.name)));
  const srcDocBaseSelectionIdentity = [
    srcDocPreviewBaseIdentity,
    sourceSnapshotRefreshKey,
    reloadKey,
    previewContentMeasurementDocumentEpoch,
    'html',
    previewSource === null ? 'pending' : previewSourceFingerprint(previewSource),
    srcDocBaseSeedHref,
  ].join('\0');
  const srcDocBaseSelectionRef = useRef({ identity: '', href: srcDocBaseSeedHref });
  if (srcDocBaseSelectionRef.current.identity !== srcDocBaseSelectionIdentity) {
    const active = activeSrcDocPreviewBaseRef.current;
    srcDocBaseSelectionRef.current = {
      identity: srcDocBaseSelectionIdentity,
      href: active?.identity === srcDocPreviewBaseIdentity
        ? active.scope.href
        : srcDocBaseSeedHref,
    };
  }
  // A replacement capability updates the already-running document through
  // postMessage. Pinning this build-time value prevents unrelated React
  // renders (slide state, toolbar state, comments) from changing srcdoc.
  const srcDocBaseHref = srcDocBaseSelectionRef.current.href;
  const srcDocTransportIdentity = [
    srcDocPreviewBaseIdentity,
    sourceSnapshotRefreshKey,
    reloadKey,
    previewContentMeasurementDocumentEpoch,
    'html',
    srcDocBaseHref,
  ].join('\0');
  const previewStorageScopeKey = previewStorageKey(sourceAuthorizationScopeKey, projectId, file.name);
  const candidateSrcDocTransport = useMemo(
    () => {
      const sourceFingerprint = previewSource === null
        ? null
        : previewSourceFingerprint(previewSource);
      const cached = htmlPreviewSrcDocTransportState.get(srcDocTransportIdentity);
      // A remount can begin before its source fetch resolves. Reuse the last
      // complete transport for this exact file revision so React reattaches
      // the parked iframe without changing a single srcdoc byte.
      if (
        cached
        && (sourceFingerprint === null || cached.sourceFingerprint === sourceFingerprint)
      ) {
        cacheSrcDocTransport(srcDocTransportIdentity, cached);
        return cached;
      }
      const generation = nextPreviewTransportGeneration();
      const entry: SrcDocTransportCacheEntry = {
        sourceFingerprint: sourceFingerprint ?? '',
        generation,
        srcDoc: previewSource ? buildSrcdoc(previewSource, {
          motionPreview: true,
          previewStorage: Boolean(previewStorageScopeKey),
          baseHref: srcDocBaseHref,
          previewFocusGuard: true,
          previewObservability: true,
          deferFontStylesheets: true,
          // Embed the reload counter so the srcdoc string differs across reloads
          // even when the fetched HTML bytes are identical (issue #4650).
          reloadKey,
          previewMeasurementEpoch: previewContentMeasurementDocumentEpoch,
          transportActivationGeneration: generation,
        }) : '',
      };
      if (sourceFingerprint !== null) cacheSrcDocTransport(srcDocTransportIdentity, entry);
      return entry;
    },
    [
      previewSource,
      srcDocTransportIdentity,
      previewStorageScopeKey,
      fileViewportKey,
      reloadKey,
      previewContentMeasurementDocumentEpoch,
      srcDocBaseHref,
    ],
  );
  // A retained file tab stays full-sized but transparent, so a newer srcDoc can
  // finish its navigation before activation. Deferring this assignment until
  // activation made the first visible frame both resize and navigate, which is
  // the white flash reported after agent edits.
  const srcDocTransportGeneration = candidateSrcDocTransport.generation;
  const srcDoc = candidateSrcDocTransport.srcDoc;
  const expectedSrcDocTransportGenerationRef = useRef(srcDocTransportGeneration);
  expectedSrcDocTransportGenerationRef.current = srcDocTransportGeneration;
  useEffect(() => {
    const onStorage = (event: MessageEvent) => {
      savePreviewStorageMessage(event, srcDocPreviewIframeRef.current?.contentWindow ?? null,
        expectedSrcDocTransportGenerationRef.current, previewStorageScopeKey);
    };
    window.addEventListener('message', onStorage);
    return () => window.removeEventListener('message', onStorage);
  }, [previewStorageScopeKey]);
  const readySrcDocTransportRef = useRef<{
    frame: HTMLIFrameElement;
    generation: string;
  } | null>(null);
  // Eager readiness keeps the existing bridge features responsive. Navigation
  // recovery uses the separately challenged witness below because Chromium can
  // abort about:srcdoc after the head bridge has already announced itself.
  const verifiedSrcDocTransportRef = useRef<{
    frame: HTMLIFrameElement;
    generation: string;
  } | null>(null);
  const srcDocTransportProbeSequenceRef = useRef(0);
  const pendingSrcDocTransportProbeRef = useRef<{
    frame: HTMLIFrameElement;
    generation: string;
    probeId: string;
    recoverOnFailure: boolean;
  } | null>(null);
  const srcDocTransportTimeoutsRef = useRef<Set<number>>(new Set());
  const srcDocParsingGraceRef = useRef<{
    generation: string;
    deadline: number;
  } | null>(null);
  const srcDocTransportActivationEpochRef = useRef(0);
  const previousSrcDocTransportWorkspaceActiveRef = useRef(false);
  const srcDocRecoveryAttemptRef = useRef<{
    generation: string;
    activationEpoch: number;
  } | null>(null);
  useEffect(() => {
    if (workspaceActive && !previousSrcDocTransportWorkspaceActiveRef.current) {
      srcDocTransportActivationEpochRef.current += 1;
    }
    previousSrcDocTransportWorkspaceActiveRef.current = workspaceActive;
  }, [workspaceActive]);
  const clearSrcDocTransportTimeouts = useCallback(() => {
    for (const timeout of srcDocTransportTimeoutsRef.current) {
      window.clearTimeout(timeout);
    }
    srcDocTransportTimeoutsRef.current.clear();
  }, []);
  const scheduleSrcDocTransportTimeout = useCallback((callback: () => void, delay: number) => {
    const timeout = window.setTimeout(() => {
      srcDocTransportTimeoutsRef.current.delete(timeout);
      callback();
    }, delay);
    srcDocTransportTimeoutsRef.current.add(timeout);
  }, []);
  const cancelPendingSrcDocTransport = useCallback(() => {
    clearSrcDocTransportTimeouts();
    pendingSrcDocTransportProbeRef.current = null;
    srcDocParsingGraceRef.current = null;
  }, [clearSrcDocTransportTimeouts]);
  useEffect(() => {
    // Hidden viewers keep their committed-document witness, but any in-flight
    // challenge timer belongs to the visible activation that started it. Pause
    // those timers so Code mode and retained project/file tabs cannot trigger
    // a background recovery; an unverified frame is challenged again when it
    // becomes visible, while an already verified frame needs no new work.
    if (!workspaceActive || mode !== 'preview') cancelPendingSrcDocTransport();
  }, [cancelPendingSrcDocTransport, mode, workspaceActive]);
  const postPreviewObservabilityHostState = useCallback((target: HTMLIFrameElement | null) => {
    const win = target?.contentWindow;
    if (!win) return;
    win.postMessage({
      type: PREVIEW_OBSERVABILITY_HOST_STATE_MESSAGE_TYPE,
      active: workspaceActive && mode === 'preview',
    }, '*');
  }, [mode, workspaceActive]);
  useEffect(() => {
    const urlFrame = urlPreviewIframeRef.current;
    const srcDocFrame = srcDocPreviewIframeRef.current;
    postPreviewObservabilityHostState(urlFrame);
    if (srcDocFrame !== urlFrame) postPreviewObservabilityHostState(srcDocFrame);
  }, [postPreviewObservabilityHostState]);
  // Only materialized while the in-tab presentation overlay is up — building
  // it eagerly would re-run buildSrcdoc on every source edit for a document
  // nobody is presenting.
  const srcDocUsesQuirksMode = Boolean(srcDoc && !/^\s*<!doctype\b/i.test(srcDoc));
  const lazySrcDocTransport = useMemo(
    () => buildLazySrcdocTransport({ quirksMode: srcDocUsesQuirksMode }),
    [srcDocUsesQuirksMode],
  );
  const persistentSrcDocTransportUrl = useMemo(
    () => persistentPreviewBootstrapUrl(lazySrcDocTransport, srcDocUsesQuirksMode),
    [lazySrcDocTransport, srcDocUsesQuirksMode],
  );
  const usesPersistentSrcDocTransport = persistentSrcDocTransportUrl !== null;
  const [srcDocTransportResetKey, setSrcDocTransportResetKey] = useState(0);
  const [srcDocShellReady, setSrcDocShellReady] = useState(false);
  const [srcDocRecoveryGeneration, setSrcDocRecoveryGeneration] = useState<string | null>(null);
  const recoverUnacknowledgedSrcDocTransport = useCallback((
    generation: string,
    signal: PreviewTransportRecoverySignal,
    documentState?: PreviewTransportDocumentState,
  ) => {
    if (
      !workspaceActiveRef.current
      || expectedSrcDocTransportGenerationRef.current !== generation
    ) {
      return;
    }
    const frame = srcDocPreviewIframeRef.current;
    const verified = verifiedSrcDocTransportRef.current;
    if (frame && verified?.frame === frame && verified.generation === generation) return;
    const recoveryAttempt = srcDocRecoveryAttemptRef.current;
    const activationEpoch = srcDocTransportActivationEpochRef.current;
    if (
      recoveryAttempt?.generation === generation
      && recoveryAttempt.activationEpoch === activationEpoch
    ) return;
    srcDocRecoveryAttemptRef.current = { generation, activationEpoch };
    const ready = readySrcDocTransportRef.current;
    cancelPendingSrcDocTransport();
    frame?.dispatchEvent(new Event('pixo:preview-transport-recovery'));
    if (frame && isPreviewFrameVisible(frame)) reportPreviewTransportRecovery({
      surface: 'artifact_preview',
      renderMode: 'srcdoc',
      artifactId: anonymizeArtifactId({ projectId, fileName: file.name }),
      artifactKind:
        handoffArtifactKind
        ?? artifactKindToTracking({ fileKind: file.kind ?? null }),
      projectId,
      signal,
      activationAcknowledged:
        ready?.frame === frame && ready.generation === generation,
      documentState,
      viewportWidth: frame?.clientWidth,
      viewportHeight: frame?.clientHeight,
      timeoutMs: signal === 'probe_timeout' ? SRC_DOC_READY_PROBE_TIMEOUT_MS : undefined,
    });
    verifiedSrcDocTransportRef.current = null;
    readySrcDocTransportRef.current = null;
    activatedSrcDocTransportHtmlRef.current = null;
    setSrcDocShellReady(false);
    if (!usesPersistentSrcDocTransport) {
      setSrcDocRecoveryGeneration(generation);
    }
    // Recovery always remounts the shell. Rewriting an already-activated
    // document would reuse its JavaScript realm and can reject authored
    // top-level let/const declarations before their script executes.
    setSrcDocTransportResetKey((key) => key + 1);
  }, [
    cancelPendingSrcDocTransport,
    file.kind,
    file.name,
    handoffArtifactKind,
    projectId,
    usesPersistentSrcDocTransport,
  ]);
  useEffect(() => {
    if (!workspaceActive || mode !== 'preview' || useUrlLoadPreview || !srcDoc) return;
    const generation = srcDocTransportGeneration;
    const previousAttempt = srcDocRecoveryAttemptRef.current;
    if (
      previousAttempt?.generation !== generation
      || previousAttempt.activationEpoch === srcDocTransportActivationEpochRef.current
    ) return;
    const frame = srcDocPreviewIframeRef.current;
    const verified = verifiedSrcDocTransportRef.current;
    if (frame && verified?.frame === frame && verified.generation === generation) return;
    // A previous visible activation already consumed its one recovery, but the
    // replacement navigation was interrupted while this retained viewer was
    // hidden. Treat returning to the file/project as a new bounded navigation
    // epoch and replace the still-unverified shell immediately. Waiting for a
    // second probe timeout leaves the user staring at the aborted white frame.
    recoverUnacknowledgedSrcDocTransport(generation, 'reactivation_unverified');
  }, [
    mode,
    recoverUnacknowledgedSrcDocTransport,
    srcDoc,
    srcDocTransportGeneration,
    useUrlLoadPreview,
    workspaceActive,
  ]);
  const probeSrcDocTransport = useCallback((
    generation: string,
    recoverOnFailure: boolean,
  ) => {
    if (
      !workspaceActiveRef.current
      || expectedSrcDocTransportGenerationRef.current !== generation
    ) {
      return;
    }
    const frame = srcDocPreviewIframeRef.current;
    if (!frame) return;
    const pending = pendingSrcDocTransportProbeRef.current;
    const pendingRecoveryProbeMatches = (
      pending?.frame === frame
      && pending.generation === generation
      && pending.recoverOnFailure
    );
    // Recovery probes can be shared by the timer and onLoad paths. A passive
    // prewarm probe may target the lazy shell, so the real srcDoc must replace it.
    if (pendingRecoveryProbeMatches) return;
    clearSrcDocTransportTimeouts();
    srcDocTransportProbeSequenceRef.current += 1;
    const probeId = `${generation}:probe-${srcDocTransportProbeSequenceRef.current}`;
    pendingSrcDocTransportProbeRef.current = {
      frame,
      generation,
      probeId,
      recoverOnFailure,
    };
    // An eager acknowledgement from the injected head bridge is provisional:
    // Chromium can still abort the about:srcdoc navigation after it was sent.
    // Only this exact challenge response, together with the body-end witness,
    // proves the current browsing context is alive and fully parsed after the
    // navigation had a chance to commit.
    verifiedSrcDocTransportRef.current = null;
    frame.contentWindow?.postMessage({
      type: 'pixo:srcdoc-transport-ready-probe',
      generation,
      probeId,
    }, '*');
    scheduleSrcDocTransportTimeout(() => {
      const pending = pendingSrcDocTransportProbeRef.current;
      if (
        !pending
        || pending.frame !== frame
        || pending.generation !== generation
        || pending.probeId !== probeId
      ) {
        return;
      }
      pendingSrcDocTransportProbeRef.current = null;
      if (pending.recoverOnFailure) {
        recoverUnacknowledgedSrcDocTransport(generation, 'probe_timeout');
      }
    }, SRC_DOC_READY_PROBE_TIMEOUT_MS);
  }, [
    clearSrcDocTransportTimeouts,
    recoverUnacknowledgedSrcDocTransport,
    scheduleSrcDocTransportTimeout,
  ]);
  const handleHostPreviewNavigationFailure = useCallback((
    failure: OpenPixoHostPreviewNavigationFailure,
  ) => {
    const aboutSrcDocFailure = failure.validatedUrl === 'about:srcdoc';
    const localBlobFailure = failure.validatedUrl.startsWith('blob:openpixo://app/');
    if (
      failure.errorCode !== -3
      || (!aboutSrcDocFailure && !localBlobFailure)
      || !Number.isSafeInteger(failure.eventId)
      || !Number.isFinite(failure.occurredAtMs)
      || Date.now() - failure.occurredAtMs > SRC_DOC_PREVIEW_FAILURE_FRESHNESS_MS
    ) return;
    const frame = srcDocPreviewIframeRef.current;
    const generation = expectedSrcDocTransportGenerationRef.current;
    if (
      !workspaceActiveRef.current
      || mode !== 'preview'
      || useUrlLoadPreview
      || !frame?.isConnected
      || frame.dataset.pixoActive !== 'true'
      || (failure.frameName !== undefined && failure.frameName !== frame.name)
    ) return;
    const handled = handledHostPreviewNavigationFailureRef.current;
    if (handled?.generation === generation && failure.eventId <= handled.eventId) return;
    handledHostPreviewNavigationFailureRef.current = {
      eventId: failure.eventId,
      generation,
    };
    const verified = verifiedSrcDocTransportRef.current;
    if (verified?.frame === frame && verified.generation === generation) {
      // Electron can report ERR_ABORTED after a newer srcdoc has already
      // committed and painted. Treat that late cancellation as diagnostics;
      // hiding or replacing a verified frame manufactures the visible
      // HTML -> white -> HTML flash we are trying to prevent.
      return;
    }
    if (
      localBlobFailure
      && failure.frameName === frame.name
      && frame.getAttribute('src') === failure.validatedUrl
    ) {
      // Unlike an eager about:srcdoc acknowledgement, an exact failure for
      // the active OpenPixo Blob URL identifies the navigation that owns
      // this frame. Recover immediately instead of adding the fixed 1.5s
      // probe timeout to every affected file-tab activation.
      recoverUnacknowledgedSrcDocTransport(generation, 'host_navigation_abort');
      return;
    }
    // An independently unverified document is challenged immediately. When
    // Chromium destroys the failed frame before Electron can resolve its
    // name, challenge the one active srcdoc frame instead. A healthy frame
    // acknowledges without mutation; the existing bounded recovery path can
    // replace at most one shell per visible activation, so an unscoped host
    // signal cannot create a reload loop or disturb a verified preview.
    probeSrcDocTransport(generation, true);
  }, [mode, probeSrcDocTransport, recoverUnacknowledgedSrcDocTransport, useUrlLoadPreview]);
  useEffect(() => {
    const unsubscribe = subscribeHostPreviewNavigationFailure(
      handleHostPreviewNavigationFailure,
    );
    const latestFailure = getLatestHostPreviewNavigationFailure();
    if (latestFailure) handleHostPreviewNavigationFailure(latestFailure);
    return unsubscribe;
  }, [handleHostPreviewNavigationFailure, workspaceActive]);
useEffect(() => {
    if (!workspaceActive) return;
    function onMessage(ev: MessageEvent) {
      const frame = srcDocPreviewIframeRef.current;
      if (ev.source !== frame?.contentWindow) return;
      const data = ev.data as {
        type?: unknown;
        generation?: unknown;
        id?: unknown;
        probeId?: unknown;
        bodyComplete?: unknown;
        documentReadyState?: unknown;
        bodyPresent?: unknown;
        bodyChildCount?: unknown;
        documentElementChildCount?: unknown;
      } | null;
      if (
        data?.type === 'pixo:srcdoc-transport-reset-required'
        && typeof data.generation === 'string'
        && data.generation === expectedSrcDocTransportGenerationRef.current
      ) {
        clearSrcDocTransportTimeouts();
        pendingSrcDocTransportProbeRef.current = null;
        verifiedSrcDocTransportRef.current = null;
        readySrcDocTransportRef.current = null;
        activatedSrcDocTransportHtmlRef.current = null;
        setSrcDocShellReady(false);
        setSrcDocTransportResetKey((key) => key + 1);
        return;
      }
      const pending = pendingSrcDocTransportProbeRef.current;
      if (
        data?.type !== 'pixo:srcdoc-transport-activated'
        || typeof data.generation !== 'string'
        || data.generation !== expectedSrcDocTransportGenerationRef.current
      ) {
        return;
      }
      readySrcDocTransportRef.current = { frame, generation: data.generation };
      if (
        typeof data.probeId === 'string'
        && pending
        && pending.frame === frame
        && pending.generation === data.generation
        && pending.probeId === data.probeId
        && data.bodyComplete === true
      ) {
        clearSrcDocTransportTimeouts();
        pendingSrcDocTransportProbeRef.current = null;
        srcDocParsingGraceRef.current = null;
        verifiedSrcDocTransportRef.current = { frame, generation: data.generation };
        const readyGeneration = data.generation;
        srcDocNavigationCommittedRef.current = { frame, generation: data.generation };
      } else if (
        typeof data.probeId === 'string'
        && pending
        && pending.frame === frame
        && pending.generation === data.generation
        && pending.probeId === data.probeId
        && pending.recoverOnFailure
      ) {
        if (data.documentReadyState === 'loading') {
          // A healthy parser can remain in `loading` while it waits on an
          // authored parser-blocking resource. The head bridge is responsive,
          // so keep challenging this generation without remounting and risk
          // running earlier authored side effects twice. A bounded grace
          // period still recovers Chromium's permanently-aborted half-document.
          clearSrcDocTransportTimeouts();
          pendingSrcDocTransportProbeRef.current = null;
          const now = Date.now();
          const currentGrace = srcDocParsingGraceRef.current;
          const grace = currentGrace?.generation === data.generation
            ? currentGrace
            : {
                generation: data.generation,
                deadline: now + SRC_DOC_PARSING_COMPLETION_TIMEOUT_MS,
              };
          srcDocParsingGraceRef.current = grace;
          if (now >= grace.deadline) {
            recoverUnacknowledgedSrcDocTransport(data.generation, 'body_incomplete', {
              readyState: 'loading',
              bodyPresent: typeof data.bodyPresent === 'boolean' ? data.bodyPresent : undefined,
              bodyChildCount: typeof data.bodyChildCount === 'number' ? data.bodyChildCount : undefined,
              documentElementChildCount:
                typeof data.documentElementChildCount === 'number'
                  ? data.documentElementChildCount
                  : undefined,
            });
            return;
          }
          scheduleSrcDocTransportTimeout(() => {
            if (expectedSrcDocTransportGenerationRef.current !== data.generation) return;
            const verified = verifiedSrcDocTransportRef.current;
            probeSrcDocTransport(data.generation, true);
          }, Math.min(SRC_DOC_PARSING_RECHECK_MS, grace.deadline - now));
          return;
        }
        // The exact challenged head bridge answered, but it could not observe
        // the inert marker placed after all authored body content. This is the
        // characteristic half-document state from an aborted about:srcdoc;
        // recover immediately instead of waiting for the probe timeout.
        recoverUnacknowledgedSrcDocTransport(data.generation, 'body_incomplete', {
          readyState:
            typeof data.documentReadyState === 'string'
              ? data.documentReadyState
              : undefined,
          bodyPresent:
            typeof data.bodyPresent === 'boolean'
              ? data.bodyPresent
              : undefined,
          bodyChildCount:
            typeof data.bodyChildCount === 'number'
              ? data.bodyChildCount
              : undefined,
          documentElementChildCount:
            typeof data.documentElementChildCount === 'number'
              ? data.documentElementChildCount
              : undefined,
        });
        return;
      }
      const verified = verifiedSrcDocTransportRef.current;
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [
    clearSrcDocTransportTimeouts,
    probeSrcDocTransport,
    recoverUnacknowledgedSrcDocTransport,
    scheduleSrcDocTransportTimeout,
    workspaceActive,
  ]);
  const [srcDocMaterialized, setSrcDocMaterialized] = useState(false);
  const wasUrlLoadPreviewRef = useRef(useUrlLoadPreview);
  // Segregate the pooled-iframe cache by powered-ness: a powered frame carries
  // a different origin + sandbox, so reusing a plain frame's DOM node for it
  // (or vice-versa) would leave a stale sandbox attribute on a live iframe.
  const urlPreviewKeepAliveKey =
    `${previewIframeKeepAliveKey(projectId, file.name)}`
    + `:scope:${encodeURIComponent(sourceAuthorizationScopeKey ?? 'pending')}`
    + (usePoweredPreview ? ':powered' : '');
  const previousUrlPreviewKeepAliveKeyRef = useRef(urlPreviewKeepAliveKey);
  useEffect(() => {
    const previousKey = previousUrlPreviewKeepAliveKeyRef.current;
    previousUrlPreviewKeepAliveKeyRef.current = urlPreviewKeepAliveKey;
    if (previousKey !== urlPreviewKeepAliveKey) iframeKeepAlivePool.evict(previousKey);
  }, [iframeKeepAlivePool, urlPreviewKeepAliveKey]);
  // Reset the shell-ready latch whenever the srcDoc iframe re-mounts. The
  // next shell will post `pixo:srcdoc-transport-ready` (or fire onLoad) and
  // flip this back to true. See #2253.
  useEffect(() => {
    setSrcDocShellReady(false);
  }, [srcDocTransportResetKey]);
  // The workspace keeps FileViewer mounted when a user switches between
  // projects that expose the same file tab. The frame name still changes with
  // the project identity, so React replaces the actual iframe. Never let that
  // new shell inherit the previous frame's ready latch: its first activation
  // would otherwise race ahead of the bootstrap listener and be dropped.
  useLayoutEffect(() => {
    setSrcDocShellReady(false);
  }, [srcDocPreviewFrameName]);
  useEffect(() => {
    if (!workspaceActive) return;
    function onMessage(ev: MessageEvent) {
      if (ev.source !== srcDocPreviewIframeRef.current?.contentWindow) return;
      const data = ev.data as { type?: string } | null;
      if (data?.type !== 'pixo:srcdoc-transport-ready') return;
      setSrcDocShellReady(true);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [workspaceActive]);
  // React can commit a fresh `srcdoc` attribute while Chromium aborts the
  // corresponding about:srcdoc navigation. The injected head bridge may run
  // and announce eagerly before that abort, so a plain generation ACK is not a
  // committed-document witness. Challenge the current browsing context after
  // the navigation had time to settle and require both the exact probe token
  // and an inert body-end marker; otherwise retry through the small lazy shell
  // automatically. Chromium can
  // commit that shell even when it aborts a large direct srcDoc navigation,
  // after which the existing ready handshake safely document.write's the
  // latest HTML. One fallback per visible activation avoids a loop when an
  // authored document is fundamentally unable to execute scripts, while a
  // later file/project reactivation can recover a replacement that was itself
  // interrupted while retained in the background.
  useEffect(() => {
    if (!workspaceActive || mode !== 'preview' || useUrlLoadPreview || !srcDoc) return;
    const generation = srcDocTransportGeneration;
    const timeout = window.setTimeout(() => {
      const frame = srcDocPreviewIframeRef.current;
      const verified = verifiedSrcDocTransportRef.current;
      if (frame && verified?.frame === frame && verified.generation === generation) return;
      probeSrcDocTransport(generation, true);
    }, SRC_DOC_ACTIVATION_RECOVERY_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [
    mode,
    probeSrcDocTransport,
    srcDoc,
    srcDocTransportGeneration,
    useUrlLoadPreview,
    workspaceActive,
  ]);
  // Once `srcDocMaterialized` is set (after the first mode entry), keep the
  // srcDoc iframe warm behind URL-load so re-entering a mode is an instant
  // visibility swap rather than a remount and reload.
  const useLazySrcDocTransport =
    usesPersistentSrcDocTransport
    || (needsPersistentStorage && !needsPowered)
    || srcDocRecoveryGeneration === srcDocTransportGeneration
    || (useUrlLoadPreview && !srcDocMaterialized);
  // Park on a static "loop detected" document once the guard reports a runaway
  // redirect. A self-redirecting artifact is forced onto the srcDoc iframe by
  // `needsRedirectGuard`, so swapping this content is the reliable stop — the
  // placeholder carries no redirect, so the frame settles the moment it loads.
  const redirectLoopBlockedDoc = useMemo(() => buildRedirectLoopBlockedDoc(), []);
  const srcDocActivationContent = redirectLoopBlocked
    ? redirectLoopBlockedDoc
    : srcDoc;
  useEffect(() => {
    if (!useUrlLoadPreview && !srcDocMaterialized) setSrcDocMaterialized(true);
  }, [useUrlLoadPreview, srcDocMaterialized]);
  const srcDocTransportContent = usesPersistentSrcDocTransport
    ? lazySrcDocTransport
    : useLazySrcDocTransport
      ? lazySrcDocTransport
      : srcDoc;
  const srcDocTransportUrl = persistentSrcDocTransportUrl;
  // Source mode visually hides the artifact, but it must not destroy a URL
  // document that is otherwise eligible for passive preview. Replacing the
  // URL with about:blank on every Preview -> Code transition creates a fresh
  // navigation on the way back; rapid toggles can abort that navigation in
  // Electron and leave a structurally active iframe with no painted content.
  // Keep that one browsing context warm so Code -> Preview is a visibility
  // swap, just like returning to an already-open file tab.
  const keepUrlTransportWarmInSourceMode = mode === 'source' && urlLoadPreviewSupported;
  const urlTransportSrc = projectResourceReadBlocked
    ? 'about:blank'
    : useUrlLoadPreview
        || keepUrlTransportWarmInSourceMode
      ? activePreviewSrcUrl
      : 'about:blank';
  const activePoweredPreviewSrcOverride = poweredPreviewSrcOverride
    && poweredPreviewSrcOverride.projectId === projectId
    && poweredPreviewSrcOverride.fileName === file.name
    && poweredPreviewSrcOverride.mtime === file.mtime
    && poweredPreviewSrcOverride.size === file.size
    && poweredPreviewSrcOverride.refreshKey === filesRefreshKey
    && poweredPreviewSrcOverride.reloadKey === reloadKey
    ? poweredPreviewSrcOverride.url
    : null;
  // Powered preview: swap the URL-load iframe to the cross-origin isolated
  // daemon origin + `allow-same-origin` so Workers/Storage/WASM/SAB work.
  // While the isolation probe resolves, park at about:blank instead of loading
  // the opaque URL, so a large artifact isn't fetched twice.
  const urlFrameBaseSrc = usePoweredPreview
    ? (powered.url as string)
    : poweredResolving
      ? 'about:blank'
      : urlTransportSrc;
  const computedUrlFrameSrc = urlFrameBaseSrc === 'about:blank'
    ? urlFrameBaseSrc
    : appendResourceQuery(
        urlFrameBaseSrc,
        [
          `pixoPreviewEpoch=${encodeURIComponent(previewContentMeasurementDocumentEpoch)}`,
          0 > 0
            ? `pixoEditStandby=${0}`
            : '',
        ].filter(Boolean).join('&'),
      );
  const lastRenderedUrlFrameSrcRef = useRef(computedUrlFrameSrc);
  const selectedUrlFrameSrc = filesRefreshPending
    ? lastRenderedUrlFrameSrcRef.current
    : activePoweredPreviewSrcOverride ?? computedUrlFrameSrc;
  lastRenderedUrlFrameSrcRef.current = selectedUrlFrameSrc;
  const urlFrameSrc = selectedUrlFrameSrc === 'about:blank'
    ? selectedUrlFrameSrc
    : appendResourceQuery(selectedUrlFrameSrc, 'pixoMotionPreview=1');
  // Arm the first-load overlay only for URL-load previews this pane has never
  // painted (per keep-alive key, so tab revisits and pooled re-attaches skip
  // it). about:blank parks (powered probe, srcDoc-active) never arm.
  useEffect(() => {
    if (!useUrlLoadPreview || urlFrameSrc === 'about:blank') {
      setUrlPreviewFirstLoadPending(false);
      return;
    }
    setUrlPreviewFirstLoadPending(!urlPreviewLoadedKeysRef.current.has(urlPreviewKeepAliveKey));
  }, [useUrlLoadPreview, urlFrameSrc, urlPreviewKeepAliveKey]);
  const urlFrameSandbox = usePoweredPreview
    ? POWERED_PREVIEW_SANDBOX
    : HTML_PREVIEW_SANDBOX;
  const urlFrameAllow = usePoweredPreview ? POWERED_PREVIEW_ALLOW : undefined;
  const activateSrcDocTransport = useCallback((target: HTMLIFrameElement | null = srcDocPreviewIframeRef.current) => {
    const activationInputs = {
      srcDoc: srcDocActivationContent,
      useUrlLoadPreview: useUrlLoadPreview && !srcDocMaterialized,
      useLazySrcDocTransport,
      shellReady: srcDocShellReady,
      activatedHtml: activatedSrcDocTransportHtmlRef.current,
    };
    if (!canActivateSrcDocTransport(activationInputs)) {
      // A shared Electron Blob can finish its cached bootstrap navigation
      // before React attaches either the iframe onLoad callback or the parent
      // message listener. If real content is otherwise ready to activate,
      // challenge the shell explicitly. A live shell echoes `ready` and this
      // callback reruns with shellReady=true; a shell that has not installed
      // its listener yet still has its normal load/ready paths. This closes
      // the missed-one-shot handshake without a timer or iframe navigation.
      if (
        activationInputs.srcDoc
        && !activationInputs.useUrlLoadPreview
        && activationInputs.useLazySrcDocTransport
        && !activationInputs.shellReady
      ) {
        target?.contentWindow?.postMessage({
          type: 'pixo:srcdoc-transport-shell-probe',
        }, '*');
      }
      return false;
    }

    const win = target?.contentWindow;
    if (!win) return false;
    win.postMessage({
      type: 'pixo:srcdoc-transport-activate',
      html: srcDocActivationContent,
      generation: srcDocTransportGeneration,
      previewStorage: previewStorageScopeKey ? readPreviewStorage(previewStorageScopeKey) : undefined,
    }, '*');
    activatedSrcDocTransportHtmlRef.current = srcDocActivationContent;
    return true;
  }, [
    srcDocActivationContent,
    previewStorageScopeKey,
    srcDocMaterialized,
    srcDocShellReady,
    srcDocTransportGeneration,
    useLazySrcDocTransport,
    useUrlLoadPreview,
    usesPersistentSrcDocTransport,
  ]);
  const activateLoadedSrcDocTransport = useCallback((target: HTMLIFrameElement | null = srcDocPreviewIframeRef.current) => {
    if (!canActivateSrcDocTransport({
      srcDoc: srcDocActivationContent,
      useUrlLoadPreview: useUrlLoadPreview && !srcDocMaterialized,
      useLazySrcDocTransport,
      shellReady: true,
      activatedHtml: activatedSrcDocTransportHtmlRef.current,
    })) return false;
    const win = target?.contentWindow;
    if (!win) return false;
    win.postMessage({
      type: 'pixo:srcdoc-transport-activate',
      html: srcDocActivationContent,
      generation: srcDocTransportGeneration,
      previewStorage: previewStorageScopeKey ? readPreviewStorage(previewStorageScopeKey) : undefined,
    }, '*');
    activatedSrcDocTransportHtmlRef.current = srcDocActivationContent;
    return true;
  }, [
    srcDocActivationContent,
    previewStorageScopeKey,
    srcDocMaterialized,
    srcDocTransportGeneration,
    useLazySrcDocTransport,
    useUrlLoadPreview,
  ]);
  const activateSrcDocSnapshotTransport = useCallback((target: HTMLIFrameElement | null = srcDocPreviewIframeRef.current) => {
    if (!srcDocActivationContent) return false;
    const win = target?.contentWindow;
    if (!win) return false;
    win.postMessage({
      type: 'pixo:srcdoc-transport-activate',
      html: srcDocActivationContent,
      generation: srcDocTransportGeneration,
      previewStorage: previewStorageScopeKey ? readPreviewStorage(previewStorageScopeKey) : undefined,
    }, '*');
    return true;
  }, [srcDocActivationContent, srcDocTransportGeneration, previewStorageScopeKey]);
  useEffect(() => {
    if (useUrlLoadPreview) {
      if (!usesPersistentSrcDocTransport) {
        activatedSrcDocTransportHtmlRef.current = null;
      }
      // Remounting the srcDoc iframe on a render-mode flip resets it to a fresh
      // lazy shell — needed ONLY for the lazy postMessage-activation path
      // (#2253 shell-ready handshake). When the srcDoc iframe is direct-mounted
      // (prewarmed, or an annotation mode), its content lives in the srcdoc
      // attribute, so a remount would just throw away the warm render and force
      // a reload. That is exactly the thrash users saw toggling Comment
      // (URL-load) ↔ Mark (srcDoc): each flip remounted and reloaded. Keep the
      // iframe alive in the direct-mount case so the toggle is a pure
      // visibility swap.
      if (
        !usesPersistentSrcDocTransport
        && !wasUrlLoadPreviewRef.current
        && useLazySrcDocTransport
      ) {
        setSrcDocTransportResetKey((key) => key + 1);
      }
      wasUrlLoadPreviewRef.current = true;
      return;
    }
    if (
      !usesPersistentSrcDocTransport
      && wasUrlLoadPreviewRef.current
      && useLazySrcDocTransport
    ) {
      setSrcDocTransportResetKey((key) => key + 1);
      activatedSrcDocTransportHtmlRef.current = null;
    }
    wasUrlLoadPreviewRef.current = false;
    activateSrcDocTransport();
  }, [
    activateSrcDocTransport,
    srcDocTransportResetKey,
    useLazySrcDocTransport,
    useUrlLoadPreview,
    usesPersistentSrcDocTransport,
  ]);

  useEffect(() => {
    if (!workspaceActive) return;
    restorePreviewScrollPosition();
  }, [ srcDoc, restorePreviewScrollPosition, workspaceActive]);

  useEffect(() => {
    if (!workspaceActive) return;
    function onMessage(ev: MessageEvent) {
      if (!isOurPreviewIframeSource(ev.source)) return;
      if (!isActivePreviewIframeSource(ev.source)) return;
      const data = ev.data as {
        type?: string;
        requestId?: string;
        frameLeft?: number;
        frameTop?: number;
        canvasLeft?: number;
        canvasTop?: number;
      } | null;
      if (!data || data.type !== 'pixo:preview-scroll') return;
      const position = {
        frameLeft: Number(data.frameLeft || 0),
        frameTop: Number(data.frameTop || 0),
        canvasLeft: Number(data.canvasLeft || 0),
        canvasTop: Number(data.canvasTop || 0),
      };
      if (data.requestId) {
        const pending = pendingPreviewScrollCapturesRef.current.get(data.requestId);
        if (!pending) return;
        pendingPreviewScrollCapturesRef.current.delete(data.requestId);
        window.clearTimeout(pending.timeout);
        pending.resolve(position);
        return;
      }
      if (previewScrollRestoreRef.current && Number(data.canvasLeft || 0) === 0 && Number(data.canvasTop || 0) === 0) return;
      if (
        previewScrollPositionRef.current.canvasLeft !== 0 ||
        previewScrollPositionRef.current.canvasTop !== 0
      ) {
        const isInitialZeroReport = Number(data.canvasLeft || 0) === 0 && Number(data.canvasTop || 0) === 0;
        if (isInitialZeroReport && Date.now() - previewScrollRequestAtRef.current < 1200) return;
      }
      previewScrollPositionRef.current = position;
    }
    function onRestoreRequest(ev: MessageEvent) {
      if (!isOurPreviewIframeSource(ev.source)) return;
      if (!isActivePreviewIframeSource(ev.source)) return;
      const data = ev.data as { type?: string } | null;
      if (!data || data.type !== 'pixo:preview-scroll-request') return;
      previewScrollRequestAtRef.current = Date.now();
      const snapshot = previewScrollRestoreRef.current;
      const scroll = snapshot ?? {
        frameLeft: previewScrollPositionRef.current.frameLeft,
        frameTop: previewScrollPositionRef.current.frameTop,
        canvasLeft: previewScrollPositionRef.current.canvasLeft,
        canvasTop: previewScrollPositionRef.current.canvasTop,
      };
      iframeRef.current?.contentWindow?.postMessage({
        type: 'pixo:preview-scroll-restore',
        frameLeft: scroll.frameLeft,
        frameTop: scroll.frameTop,
        canvasLeft: scroll.canvasLeft,
        canvasTop: scroll.canvasTop,
      }, '*');
    }
    function onDcViewportMessage(ev: MessageEvent) {
      if (!isOurPreviewIframeSource(ev.source)) return;
      if (!isActivePreviewIframeSource(ev.source)) return;
      const data = ev.data as {
        type?: string;
        x?: number;
        y?: number;
        scale?: number;
      } | null;
      if (!data || !data.type) return;
      if (data.type === '__dc_viewport') {
        const x = Number(data.x || 0);
        const y = Number(data.y || 0);
        const scale = Number(data.scale || 1);
        const hasExistingPosition = dcViewportRef.current.x !== 0 || dcViewportRef.current.y !== 0;
        const isInitialZeroReport = x === 0 && y === 0 && scale === 1;
        if (hasExistingPosition && isInitialZeroReport && Date.now() - dcViewportRestoreAtRef.current < 1500) return;
        dcViewportRef.current = {
          x: Number.isFinite(x) ? x : 0,
          y: Number.isFinite(y) ? y : 0,
          scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
        };
        return;
      }
      if (data.type === '__dc_viewport_request') {
        dcViewportRestoreAtRef.current = Date.now();
        iframeRef.current?.contentWindow?.postMessage({
          type: '__dc_set_viewport',
          ...dcViewportRef.current,
        }, '*');
      }
    }
    function onContentSizeMessage(ev: MessageEvent) {
      if (!isOurPreviewIframeSource(ev.source)) return;
      if (!isActivePreviewIframeSource(ev.source)) return;
      const data = ev.data as ({
        type?: string;
      } & Partial<PreviewContentMeasurementResponse>) | null;
      if (!data || data.type !== 'pixo:preview-content-size') return;
      const latest = latestPreviewContentMeasurementRef.current;
      const frame = iframeRef.current;
      if (
        !previewContentMeasurementContextRef.current.eligible ||
        previewContentMeasurementExpectedDocumentEpochRef.current !==
          previewContentMeasurementCurrentDocumentEpochRef.current ||
        !latest ||
        latest.source !== ev.source ||
        !frame ||
        !previewMeasurementFrameIsUsable({
          connected: frame.isConnected,
          active: frame.dataset.pixoActive === 'true',
          frameRect: frame.getBoundingClientRect(),
          canvasRect: previewCanvasNode?.getBoundingClientRect() ?? frame.getBoundingClientRect(),
        })
      ) {
        return;
      }
      const response: PreviewContentMeasurementResponse = {
        measurementId: typeof data.measurementId === 'string' ? data.measurementId : '',
        generation: typeof data.generation === 'string' ? data.generation : '',
        documentEpoch: typeof data.documentEpoch === 'string' ? data.documentEpoch : '',
        scrollWidth: typeof data.scrollWidth === 'number' ? data.scrollWidth : null,
        clientWidth: typeof data.clientWidth === 'number' ? data.clientWidth : null,
      };
      const resolution = resolveDesktopPreviewContentMeasurement({
        request: latest.request,
        response,
        currentGeneration: previewContentMeasurementGenerationRef.current,
        latestMeasurementId: latest.request.measurementId,
        currentCanvasWidth: previewContentMeasurementContextRef.current.canvasWidth,
        currentPreviewScale: previewContentMeasurementContextRef.current.previewScale,
        confirmedContentWidth: desktopPreviewContentWidthRef.current,
        confirmedOverflow: desktopPreviewContentWidthEntryRef.current?.overflow ?? null,
      });
      if (resolution.action === 'accept') {
        setDesktopPreviewContentWidth({
          width: resolution.contentWidth,
          measuredClientWidth: resolution.measuredClientWidth,
          overflow: resolution.overflow,
        });
      } else if (resolution.action === 'remeasure-neutral') {
        setDesktopPreviewContentWidth(null);
      }
    }
    window.addEventListener('message', onMessage);
    window.addEventListener('message', onRestoreRequest);
    window.addEventListener('message', onDcViewportMessage);
    window.addEventListener('message', onContentSizeMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('message', onRestoreRequest);
      window.removeEventListener('message', onDcViewportMessage);
      window.removeEventListener('message', onContentSizeMessage);
    };
  }, [
    previewCanvasNode,
    isActivePreviewIframeSource,
    isOurPreviewIframeSource,
    setDesktopPreviewContentWidth,
    workspaceActive,
  ]);

  useEffect(() => {
    if (!workspaceActive) return;
    function onMessage(ev: MessageEvent) {
      if (!isActivePreviewIframeSource(ev.source)) return;
      const data = ev.data as { type?: unknown; fileName?: unknown } | null;
      if (
        data?.type !== 'pixo:preview-open-file' ||
        typeof data.fileName !== 'string' ||
        data.fileName.length > 4096 ||
        !/\.html?$/i.test(data.fileName) ||
        data.fileName.split('/').some((part) => !part || part === '.' || part === '..')
      ) {
        return;
      }
      onOpenFileReplacing?.(data.fileName, file.name);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [file.name, isActivePreviewIframeSource, onOpenFileReplacing, workspaceActive]);

  // Snapshot this project as a reusable template. The daemon snapshots
  // EVERY html/text/code file in the project (not just the file open in
  // the viewer), so the template captures the whole design, not a single
  // page. Surfaced here in the Download menu because templates are saved
  // from the same artifact output surface as files.
  // Reserved for the gated template entry; the current Share menu exposes only deployment providers.


  // Component-scoped so both the save flow and the modal Cancel button emit
  // the one terminal result for a template export session.
  function verifyLoadedSrcDocTransport(target: HTMLIFrameElement | null) {
    if (!target || target !== srcDocPreviewIframeRef.current) return;
    const generation = srcDocTransportGeneration;
    probeSrcDocTransport(generation, !useUrlLoadPreview && Boolean(srcDoc));
  }
  const fireTemplateExportResult = (
    result: 'success' | 'failed' | 'cancelled',
    errorCode?: string,
  ) => {
    if (templateExportResolvedRef.current) return;
    templateExportResolvedRef.current = true;
    const requestId = templateExportRequestIdRef.current ?? analytics.newRequestId();
    const started = templateExportStartedRef.current || performance.now();
    const originPromise = templateExportOriginPromiseRef.current
      ?? resolveArtifactExportOrigin().catch(() => unknownExportOrigin());
    void originPromise.then((originProps) => {
      trackArtifactExportResult(
        analytics.track,
        {
          page_name: 'artifact',
          area: 'share_option_popover',
          artifact_id: anonymizeArtifactId({ projectId, fileName: file.name }),
          artifact_kind: artifactKindToTracking({ fileKind: file.kind ?? null }),
          export_format: 'template',
          result,
          ...originProps,
          ...(errorCode ? { error_code: errorCode } : {}),
          export_duration_ms: Math.round(performance.now() - started),
          project_id: projectId,
          project_kind: projectKind,
        },
        { requestId },
      );
    });
  };

  async function handleSaveAsTemplate() {
    const name = templateName.trim();
    if (!name) return;
    setSavingTemplate(true);
    setTemplateNote(null);
    setTemplateSaveError(null);
    let savedName: string | null = null;
    // Default to failed; flips to success only when the save resolves. The
    // finally block reports exactly one artifact_export_result(template),
    // covering the !tpl branch and any thrown error too.
    let templateOutcome: 'success' | 'failed' = 'failed';
    let templateErrorCode: string | undefined = 'UNKNOWN';
    try {
      const tpl = await saveTemplate({
        name,
        description: templateDescription.trim() || undefined,
        sourceProjectId: projectId,
      });
      if (!tpl) {
        setTemplateSaveError(t('fileViewer.savedTemplateFail'));
        templateErrorCode = 'SAVE_FAILED';
        return;
      }
      savedName = tpl.name;
      setTemplateModalOpen(false);
      setTemplateName('');
      setTemplateDescription('');
      setTemplateNote(t('fileViewer.savedTemplate', { name: tpl.name }));
      // Show success toast
      setTemplateSavedToast(t('fileViewer.savedTemplate', { name: tpl.name }));
      templateOutcome = 'success';
      templateErrorCode = undefined;
    } finally {
      setSavingTemplate(false);
      fireTemplateExportResult(templateOutcome, templateErrorCode);
      if (savedName) {
        // Auto-clear the note so the menu doesn't keep stale state next open.
        setTimeout(() => setTemplateNote(null), 4000);
      }
    }
  }


useEffect(() => {
    if (!workspaceActive || !zoomMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!zoomMenuRef.current) return;
      if (!zoomMenuRef.current.contains(e.target as Node)) setZoomMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [workspaceActive, zoomMenuOpen]);
  useEffect(() => {
    if (!workspaceActive || !exportMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!shareRef.current) return;
      if (shareRef.current.contains(e.target as Node)) return;
      /*
       * 搬到产物卡旁边的那一份 portal 在 `<body>` 下,不在 `shareRef` 的子树里 ——
       * 不单独认它,点自己的菜单项会先把菜单关掉(`useDismissOnOutsideInteraction`
       * 的 docblock 早写过这条前提)。锚点那枚按钮也算「里面」,否则点它等于
       * 「关掉 + 再开一次」。
       */
      const target = e.target as Node;
      // Independently portaled share layers must survive the press until click selects an action.
      if (target instanceof Element && target.closest('[data-share-overlay-layer]')) return;
      if (anchoredMenuRef.current?.contains(target)) return;
      if (
        menuAnchorId &&
        (target as Element)?.closest?.(`[data-artifact-anchor="${menuAnchorId}"]`)
      ) return;
      setExportMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportMenuOpen, workspaceActive, menuAnchorId]);
  async function reloadHtmlPreview() {
    fireArtifactToolbarClick('reload');
    if (sourceAuthorizationScopeKey) {
      invalidateHtmlSourceSnapshotFile(
        sourceAuthorizationScopeKey,
        projectId,
        file.name,
      );
    }
    void capturePreviewScrollPosition();
    imageExportSnapshotDataUrlRef.current = null;
    setInlinedSource(null);
    setReloadKey((key) => key + 1);
    if (!useUrlLoadPreview) {
      if (source !== null) {
        prevSourceBeforeReloadRef.current = { source, projectId, fileName: file.name };
      }
      setSource(null);
      activatedSrcDocTransportHtmlRef.current = null;
      if (!usesPersistentSrcDocTransport) {
        setSrcDocShellReady(false);
        setSrcDocTransportResetKey((key) => key + 1);
      }
    }
  }

  async function handleVersionRestored(content: string) {
    setSource(content);
    sourceRef.current = content;
    setInlinedSource(null);
    setReloadKey((key) => key + 1);
    await onFileSaved?.();
    setVersionRestoredToast({
      id: (versionRestoredToastIdRef.current += 1),
      message: t('fileViewer.versions.restoreSuccess'),
    });
  }

  function selectMode(nextMode: 'preview' | 'source') {
    // Read-only viewer of a team-shared project can preview but not inspect source.
    if (viewerOnly && nextMode === 'source') return;
    setMode(nextMode);
  }

  const exportTitle = file.name.replace(/\.html?$/i, '') || file.name;
  const artifactKind = file.artifactManifest?.kind ?? file.artifactKind ?? null;
  const rendererId = file.artifactManifest?.renderer ?? null;
  const isMarkdownArtifact =
    artifactKind === 'markdown-document' ||
    rendererId === 'markdown' ||
    file.kind === 'text' && /\.mdx?$/i.test(file.name);
  const isHtmlArtifact =
    file.kind === 'html' ||
    artifactKind === 'html' ||
    rendererId === 'html';


  const rawCanDownload = source !== null && (isHtmlArtifact || isMarkdownArtifact);
  const canDownload = rawCanDownload && !viewerOnly;
  const canExportHtml = isHtmlArtifact && !viewerOnly && source !== null;
  const showMarkdownExport = source !== null && isMarkdownArtifact && !viewerOnly;
  const showImageExport = canExportHtml;
  const viewerOnlyDisabledTitle = t('studio.readOnly');

  // If viewerOnly flips on while an edit surface / export menu is open, close it
  // so the read-only viewer never lands in an editing mode it can't act on.
  useEffect(() => {
    if (!viewerOnly) return;
    setVersionModalOpen(false);
    if (mode === 'source') setMode('preview');

  }, [viewerOnly, mode,]);

  async function exportHtmlPdf(context?: HtmlVersionExportContext | null) {
    const pdfTitle = context?.title ?? exportTitle;
    const pdfSource = context?.content ?? source ?? '';
    if (isOpenPixoHostAvailable()) {
      const res = await exportProjectScreenshotPdf({
        projectId,
        fileName: file.name,
        title: pdfTitle,
        ...(context?.versionId ? { versionId: context.versionId } : {}),
      });
      if (res.ok) return res.completion;
      if (!('unavailable' in res)) throw new Error(res.error);
    }
    return exportProjectAsPdf({
      fallbackPdf: () => exportAsPdf(pdfSource, pdfTitle, { onProgress: onExportProgress }),
      filePath: file.name,
      projectId,
      title: pdfTitle,

      ...(context?.versionId ? { versionId: context.versionId } : {}),
    });
  }

  function triggerPdfExport(context?: HtmlVersionExportContext) {
    fireShareExport('pdf', () => exportHtmlPdf(context), context);
  }

  function triggerZipExport(context?: HtmlVersionExportContext) {
    fireShareExport('zip', () => exportProjectAsZip({
      projectId,
      filePath: file.name,
      fallbackHtml: context?.content ?? source ?? '',
      fallbackTitle: context?.title ?? exportTitle,

      ...(context?.versionId ? { versionId: context.versionId } : {}),
    }), context);
  }

  function triggerHtmlExport(context?: HtmlVersionExportContext) {
    fireShareExport('html', () => exportProjectAsHtml({
      projectId,
      filePath: file.name,
      fallbackTitle: context?.title ?? exportTitle,

      ...(context?.versionId ? { versionId: context.versionId } : {}),
    }), context);
  }

  useEffect(() => {
    const nudgeKey = `${projectId}\n${file.name}`;
    if (!canExportHtml || exportReadyNudgeSeenRef.current.has(nudgeKey)) return;
    exportReadyNudgeSeenRef.current.add(nudgeKey);
    if (hasSeenExportReadyNudge(projectId, file.name)) return;
    markExportReadyNudgeSeen(projectId, file.name);
    setExportReadyNudge(true);
    const timeout = window.setTimeout(() => setExportReadyNudge(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [canExportHtml, file.name, projectId]);

  // Parallel to shareRequest, but opens the Download / Export menu instead — the
  // assistant "next step" card's Download row routes here so it surfaces the same
  // PDF / image / zip / standalone-HTML / template options the toolbar exposes.
  useEffect(() => {
    const nonce = downloadRequest?.nonce;
    if (nonce == null) return;
    if (!canDownload) return;
    // 同分享那条:消费记录在组件外,重挂之后不重放。
    if (!shouldConsumeActionRequest(actionRequestKey('download', projectId, file.name), nonce)) return;
    setExportReadyNudge(false);
    markExportReadyNudgeSeen(projectId, file.name);
    /* 与分享同一条路,换成导出菜单。 */
    const nextAnchorId = downloadRequest?.anchorId ?? null;
    const wasOpenOnThisEntry = exportMenuOpen
      && menuAnchorId === nextAnchorId;
    setMenuAnchorId(nextAnchorId);
    setMenuOrigin(nextAnchorId ? 'artifact-card' : 'toolbar');
    setExportMenuOpen(!wasOpenOnThisEntry);
  }, [
    downloadRequest?.nonce,
    downloadRequest?.anchorId,
    canDownload,
    projectId,
    file.name,
    exportMenuOpen,
    menuAnchorId,
  ]);

  // Share and Download are separate toolbar intents, but they share the same
  // popover shell so switching between them keeps the menu anchored in place.
  /*
   * A web game's own page exports as a game, not a document: one HTML file that plays
   * offline (`exportPlayableGame`). PDF, image and the standalone-HTML snapshot of a
   * game are a canvas frozen mid-load, so they are not offered for it (2026-11-10
   * beginner audit). Asked once per project; an older daemon answers nothing.
   */
  const [gameExport, setGameExport] = useState<GameExportStatusResponse | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    void fetchGameExportStatus(projectId, controller.signal).then(status => {
      if (!controller.signal.aborted) setGameExport(status);
    });
    return () => controller.abort();
  }, [projectId]);
  const isGameEntry = Boolean(gameExport?.available && gameExport.entry === file.name);
  const runPlayableExport = () => {
    setExportMenuOpen(false);
    fireShareExport('playable_game', () => exportPlayableGame({ projectId, fallbackTitle: exportTitle }));
  };
  const openDownloadMenu = () => {
    fireArtifactHeaderClick('download_dropdown');
    setExportReadyNudge(false);
    markExportReadyNudgeSeen(projectId, file.name);
    setMenuAnchorId(null);
    setMenuOrigin('toolbar');
    setExportMenuOpen((open) => !(open && menuAnchorId === null));
  };
  const captureExportImageSnapshot = useCallback(async (
    options?: { context?: HtmlVersionExportContext | null },
  ) => {
    const exportContext = options?.context ?? null;
    captureFailureStageRef.current = null;
    await waitForAnimationFrame();
    await waitForAnimationFrame();
    if (isOpenPixoHostAvailable() && projectId && file.name) {

        const exportViewport = previewViewport !== 'desktop'
          ? PREVIEW_VIEWPORT_PRESETS.find((preset) => preset.id === previewViewport)
          : null;
        const rendered = await exportProjectImageDataUrl({
          projectId,
          fileName: file.name,
          ...(exportViewport?.width != null ? { width: exportViewport.width } : {}),
          ...(exportViewport?.height != null ? { height: exportViewport.height } : {}),
          ...(exportContext?.versionId ? { versionId: exportContext.versionId } : {}),
        });
        if (rendered.ok) return rendered.snapshot;
        // A semantic failure (e.g. "page is too tall — export as PDF") must surface,
        // NOT silently downgrade to a partial visible-viewport screenshot. Only when
        // the off-screen renderer is genuinely unavailable do we fall through.
        if ('error' in rendered) {
          // Attach the daemon's own code/status to the error so
          // `exportErrorCode` can report it verbatim instead of falling back
          // to message-regex guessing (and ultimately to the useless
          // `err.name === 'Error'`).
          throw Object.assign(new Error(rendered.error), {
            ...(rendered.code ? { code: rendered.code } : {}),
            ...(rendered.status ? { status: rendered.status } : {}),
          });
        }
    }

    if (exportContext?.versionId) {
      captureFailureStageRef.current = 'VERSIONED_NO_RENDERER';
      return null;
    }

    // Fallback: desktop compositor screenshot of the visible preview region.
    // Returns real rendered pixels and is never tainted, unlike the in-iframe
    // SVG-foreignObject bridge. Used on pure web (no host) or if the render
    // above is unavailable. Works for both srcDoc and URL-load previews.
    const visibleIframe = iframeRef.current ?? srcDocPreviewIframeRef.current;
    const hostSnapshot = await captureHostIframeSnapshot(visibleIframe);
    if (hostSnapshot) return hostSnapshot;

    if (!useUrlLoadPreview) {
      const activeIframe = srcDocPreviewIframeRef.current ?? iframeRef.current;
      if (!activeIframe) {
        captureFailureStageRef.current = 'NO_SRCDOC_IFRAME';
        return null;
      }
      await waitForIframeLoadOrTimeout(activeIframe, 250);
      await waitForAnimationFrame();
      return requestPreviewSnapshotWithRetry(activeIframe);
    }

    const urlIframe = iframeRef.current ?? urlPreviewIframeRef.current;
    if (urlIframe) {
      await waitForIframeLoadOrTimeout(urlIframe, 250);
      await waitForAnimationFrame();
      const urlSnapshot = await requestPreviewSnapshotWithRetry(urlIframe);
      if (urlSnapshot) return urlSnapshot;
    }

    const srcDocIframe = srcDocPreviewIframeRef.current;
    if (!srcDocIframe) {
      const activeIframe = iframeRef.current;
      if (!activeIframe) {
        captureFailureStageRef.current = 'NO_URL_IFRAME';
        return null;
      }
      return requestPreviewSnapshotWithRetry(activeIframe);
    }

    if (useLazySrcDocTransport && !srcDocShellReady) {
      await waitForIframeLoadOrTimeout(srcDocIframe, 500);
    }
    if (useLazySrcDocTransport && activateSrcDocSnapshotTransport(srcDocIframe)) {
      await waitForIframeLoadOrTimeout(srcDocIframe);
    }
    const restoreVisibility = temporarilyExposeIframeForSnapshot(srcDocIframe);
    try {
      await waitForAnimationFrame();
      return requestPreviewSnapshotWithRetry(srcDocIframe);
    } finally {
      restoreVisibility();
    }
  }, [
    activateSrcDocSnapshotTransport,
    srcDocShellReady,
    useLazySrcDocTransport,
    useUrlLoadPreview,
    fileViewportKey,
    previewViewport,
    projectId,
    file.name,
  ]);

  const openImageExportModal = async (context?: HtmlVersionExportContext) => {
    // Don't reopen while an export is still running: reopening resets the shared
    // request/result bookkeeping refs, which would mis-attribute or drop the
    // in-flight export's analytics result.
    if (imageExportInFlightRef.current) return;
    flushSync(() => {
      setExportMenuOpen(false);
    });
    // Start the image export's own click→result correlation (separate modal
    // flow, so it can't ride fireShareExport).
    const requestId = analytics.newRequestId();
    imageExportRequestIdRef.current = requestId;
    imageExportStartedRef.current = performance.now();
    imageExportOriginPromiseRef.current = resolveArtifactExportOrigin(context)
      .catch(() => unknownExportOrigin());
    imageExportResolvedRef.current = false;
    trackShareOptionPopoverClick(
      analytics.track,
      {
        page_name: 'artifact',
        area: 'share_option_popover',
        artifact_id: anonymizeArtifactId({ projectId, fileName: file.name }),
        artifact_kind: artifactKindToTracking({ fileKind: file.kind ?? null }),
        element: 'image',
        project_id: projectId,
        project_kind: projectKind,
      },
      { requestId },
    );
    setImageExportError(null);
    imageExportSnapshotDataUrlRef.current = null;
    setImageExportContext(context ?? null);
    // Just open the modal. Rendering happens on Save, after the user picks a
    // format — not eagerly on open.
    setImageExportModalOpen(true);
  };

  const changeImageExportFormat = (format: ImageExportFormat) => {
    setImageExportFormat(format);
  };

  /*
   * 一种导出格式一段动作 —— 菜单项和「产物卡格式浮层直接点名的那一种」共用同一份。
   *
   * 原来这四段各自内联在菜单项的 `onClick` 里,只有从这个菜单点进来才跑得到。
   * 产物卡上的〔导出〕现在会带着选好的格式过来(`downloadRequest.format`),
   * 它需要**同一段**动作而不是「把菜单展开让人再选一次」;两份实现必然分叉,
   * 所以先收成一处。
   *
   * PPTX / Markdown 不在这里:前者要先开导出参数弹窗,后者只有 markdown 产物
   * 才有,而 markdown 根本不走这个 viewer —— 两条都留在菜单里各自的入口。
   */
  const runExportFormat = (format: ArtifactExportFormat) => {
    if (format === 'image') {
      void openImageExportModal();
      return;
    }
    setExportMenuOpen(false);
    if (format === 'zip') {
      fireShareExport('zip', () => exportProjectAsZip({
        projectId,
        filePath: file.name,
        fallbackHtml: source ?? '',
        fallbackTitle: exportTitle,

      }));
      return;
    }
    if (format === 'html') {
      fireShareExport('html', () => exportProjectAsHtml({
        projectId,
        filePath: file.name,
        fallbackTitle: exportTitle,

      }));
      return;
    }
    // Pixel-perfect screenshot PDF (matches the preview, same renderer as
    // image/PPTX). Chosen over Chromium's vector printToPDF because that path
    // drops CJK glyphs in the packaged runtime (no embedded fonts) —
    // unacceptable for a Chinese-first product. Falls back to the
    // vector/browser print path on web or on failure.
    fireShareExport('pdf', async () => {
      if (isOpenPixoHostAvailable()) {
        const res = await exportProjectScreenshotPdf({
          projectId,
          fileName: file.name,
          title: exportTitle,
        });
        if (res.ok) return res.completion;
        if (!('unavailable' in res)) throw new Error(res.error);
      }
      return exportProjectAsPdf({
        fallbackPdf: () => exportAsPdf(source ?? '', exportTitle, { onProgress: onExportProgress }),
        filePath: file.name,
        projectId,
        title: exportTitle,

      });
    });
  };

  // Component-scoped so both the save flow and the modal Cancel button can
  // emit the one terminal result for an image export session.
  // Which step of the capture fallback chain gave up. `captureExportImageSnapshot`
  // can return null from five different places — no active iframe, a version-scoped
  // export with no off-screen render, or any of the bridge snapshot attempts — and
  // they all used to report the same flat `CAPTURE_FAILED` (90 events / 37 users in
  // 14 days), which says a capture failed but never which stage. Recording the stage
  // makes the bucket actionable.
  const captureFailureStageRef = useRef<string | null>(null);

  const fireImageExportResult = (
    result: 'success' | 'failed' | 'cancelled',
    errorCode?: string,
  ) => {
    if (imageExportResolvedRef.current) return;
    imageExportResolvedRef.current = true;
    const requestId = imageExportRequestIdRef.current ?? analytics.newRequestId();
    const started = imageExportStartedRef.current || performance.now();
    const originPromise = imageExportOriginPromiseRef.current
      ?? resolveArtifactExportOrigin().catch(() => unknownExportOrigin());
    void originPromise.then((originProps) => {
      trackArtifactExportResult(
        analytics.track,
        {
          page_name: 'artifact',
          area: 'share_option_popover',
          artifact_id: anonymizeArtifactId({ projectId, fileName: file.name }),
          artifact_kind: artifactKindToTracking({ fileKind: file.kind ?? null }),
          export_format: 'image',
          result,
          ...originProps,
          ...(errorCode ? { error_code: errorCode } : {}),
          export_duration_ms: Math.round(performance.now() - started),
          project_id: projectId,
          project_kind: projectKind,
        },
        { requestId },
      );
    });
  };

  async function handleImageExportSave() {
    // Single-shot guard: closing the modal is async, so a fast double-click /
    // Enter-repeat on Save could otherwise enqueue two concurrent exports
    // (duplicate captures, downloads, and result bookkeeping) before the first
    // re-render removes the button.
    if (imageExportInFlightRef.current) return;
    imageExportInFlightRef.current = true;

    // Unify with the PPTX/PDF flow: close the modal and surface progress through
    // the same portaled, viewport-centered export toast instead of an in-modal
    // spinner + a separate (non-portaled, off-center) saved toast.
    setImageExportError(null);
    setImageExportModalOpen(false);
    setExportToast({ message: t('fileViewer.exportStarted'), tone: 'loading' });
    // Let the modal unmount before capturing so the web-only host-compositor
    // snapshot can't catch the overlay (the desktop off-screen renderer ignores
    // it either way).
    await waitForAnimationFrame();
    await waitForAnimationFrame();
    try {
      const context = imageExportContext;
      const targetTitle = context?.title ?? exportTitle;
      let dataUrl = imageExportSnapshotDataUrlRef.current;
      if (!dataUrl) {
        const snap = await captureExportImageSnapshot({ context });
        if (!snap) {
          setExportToast({ message: t('fileViewer.exportImageFailed'), tone: 'error' });
          fireImageExportResult(
            'failed',
            // The bridge attempts return null without a stage of their own; they
            // are the "we tried and got nothing back" case.
            `CAPTURE_FAILED_${captureFailureStageRef.current ?? 'BRIDGE_EMPTY'}`,
          );
          return;
        }
        dataUrl = snap.dataUrl;
        imageExportSnapshotDataUrlRef.current = dataUrl;
      }
      const blob = await imageDataUrlToBlob(dataUrl, imageExportFormat);
      if (blob.size <= 0) {
        setExportToast({ message: t('fileViewer.exportImageFailed'), tone: 'error' });
        fireImageExportResult('failed', 'EMPTY_IMAGE');
        return;
      }
      const target = await prepareImageExportTarget(targetTitle, imageExportFormat, { useNativePicker: false });
      if (!target) {
        // User dismissed the save picker — clear the loading toast.
        setExportToast(null);
        fireImageExportResult('cancelled');
        return;
      }
      let saved: void | 'desktop' | 'cancelled' | 'download' = undefined;
      if (!isOpenPixoHostAvailable() && target.method === 'download' && imageExportFormat === 'png' && dataUrl) {
        downloadImageDataUrl(dataUrl, target.filename);
      } else {
        saved = await target.save(blob);
      }
      if (saved === 'cancelled') {
        setExportToast(null);
        fireImageExportResult('cancelled');
        return;
      }

      fireImageExportResult('success');
      setExportToast({
        message:
          target.method === 'picker'
            ? t('fileViewer.exportImageSaved')
            : t('fileViewer.exportImageDownloadStarted'),
        tone: 'success',
      });
    } catch (err) {
      console.warn('[exportAsImage] failed to save snapshot:', err);
      setExportToast(exportFailureToast(err, t));
      fireImageExportResult('failed', exportErrorCode(err));
    } finally {
      imageExportInFlightRef.current = false;
    }
  }
  const initialPreviewLoading = source === null && !sourceEverLoadedRef.current;
  const sourceModeLoading = mode === 'source' && source === null;
  const showPreviewToolbarControls = mode === 'preview';
  const versioningAvailable = isHtmlVersionableFile(file);

  return (
    <div ref={viewerRootRef} className={`viewer html-viewer${viewerOnly ? ' html-viewer--viewer-only' : ''}`}>
      <div className="viewer-toolbar" style={workspaceActive ? undefined : { visibility: 'hidden' }}>
        <div className="viewer-toolbar-left">

          <button
            type="button"
            className="icon-only pixo-tooltip"
            onClick={reloadHtmlPreview}
            title={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
            data-tooltip={`${t('fileViewer.reload')} ${t('fileViewer.preview')}`}
            data-tooltip-placement="bottom"
            aria-label={`${t('fileViewer.reloadAria')} ${t('fileViewer.preview')}`}
          >
            <Icon name="reload" size={14} />
          </button>
          {/* Two-segment pill tablist: both destinations stay visible and the
              active one is legible at a glance. A single toggle that flips its
              own label reads as "what am I looking at now?" and forces the user
              to click to find out. */}
          <div className="viewer-tabs viewer-mode-tabs" role="tablist" aria-label={t('fileViewer.viewModeAria')}>
            {([
              ['preview', t('fileViewer.preview'), 'eye-line'],
              ['source', t('fileViewer.source'), 'code-s-slash-line'],
            ] as const).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={`viewer-tab ${mode === id ? 'active' : ''}`}
                aria-label={label}
                aria-selected={mode === id}
                disabled={viewerOnly && id === 'source'}
                title={viewerOnly && id === 'source' ? viewerOnlyDisabledTitle : label}
                onClick={() => {
                  fireArtifactToolbarClick(id);
                  selectMode(id);
                }}
              >
                <RemixIcon name={icon} size={14} className="viewer-tab-icon" />
                <span className="viewer-tab-label">{label}</span>
              </button>
            ))}
          </div>
          {showPreviewToolbarControls ? (
            <span className="viewer-preview-toolbar-inline">
              <PreviewViewportControls
                viewport={previewViewport}
                onViewport={setPreviewViewport}
                t={t}
              />
            </span>
          ) : null}

        </div>
        <div className="viewer-toolbar-actions">
          {showPreviewToolbarControls ? (
            <div className="viewer-toolbar-inline-actions">

              <div className="artifact-tool-menu-anchor">

              </div>

              <span className="viewer-toolbar-tool-divider" aria-hidden />

              <span className="viewer-toolbar-tool-divider" aria-hidden />

              {source !== null && mode === 'preview' ? (
                <div className="zoom-menu viewer-toolbar-zoom" ref={zoomMenuRef}>
                  <button
                    type="button"
                    className="viewer-action zoom-trigger pixo-tooltip"
                    aria-haspopup="menu"
                    aria-expanded={zoomMenuOpen}
                    title={t('fileViewer.resetZoom')}
                    data-tooltip={t('fileViewer.resetZoom')}
                    data-tooltip-placement="bottom"
                    onClick={() => {
                      fireArtifactToolbarClick('zoom_level_dropdown');
                      setZoomMenuOpen((v) => !v);
                    }}
                  >
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{previewZoomText}</span>
                  </button>
                  {zoomMenuOpen ? (
                    <div className="zoom-menu-popover" role="menu">
                      {[50, 75, 100, 125, 150, 200].map((level) => (
                        <button
                          key={level}
                          type="button"
                          className={`zoom-menu-item${zoomLevelActive(level) ? ' active' : ''}`}
                          role="menuitem"
                          onClick={() => {
                            setPreviewZoomCached(fileViewportKey, level, 'manual');
                            setZoomMode('manual');
                            setZoom(level);
                            setZoomMenuOpen(false);
                          }}
                        >
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{level}%</span>
                          {zoomLevelActive(level) ? (
                            <Icon name="check" size={13} />
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="viewer-toolbar-more" ref={toolbarMoreRef}>
            <button
              ref={toolbarMoreTriggerRef}
              type="button"
              className="viewer-action viewer-action-icon pixo-tooltip"
              aria-label={t('nextStep.more')}
              aria-haspopup="menu"
              aria-expanded={toolbarMoreOpen}
              data-tooltip={t('nextStep.more')}
              data-tooltip-placement="bottom"
              title={t('nextStep.more')}
              onClick={() => setToolbarMoreOpen((value) => !value)}
            >
              <RemixIcon name="more-2-line" size={16} />
            </button>
            {toolbarMoreOpen ? (
              <div className="viewer-toolbar-more-menu" role="menu">
                {versioningAvailable ? (
                  <button
                    type="button"
                    data-pixo-version-entry="true"
                    className="viewer-toolbar-more-item"
                    role="menuitem"
                    disabled={source === null}
                    onClick={() => {
                      fireArtifactToolbarClick('versions', 'more_menu');
                      setVersionModalOpen('more_menu');
                      setToolbarMoreOpen(false);
                    }}
                  >
                    <RemixIcon name="history-line" size={15} />
                    <span>{t('fileViewer.versions.entry')}</span>
                  </button>
                ) : null}
                {showPreviewToolbarControls ? (
                  <>
                    <div className="viewer-toolbar-more-separator" role="separator" />
                    {PREVIEW_VIEWPORT_PRESETS.map((preset) => {
                      const selected = previewViewport === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`viewer-toolbar-more-item${selected ? ' active' : ''}`}
                          role="menuitem"
                          title={t(preset.titleKey)}
                          onClick={() => {
                            setPreviewViewport(preset.id);
                            setToolbarMoreOpen(false);
                          }}
                        >
                          <RemixIcon name={previewViewportIcon(preset.id)} size={15} />
                          <span>{t(preset.labelKey)}</span>
                          {selected ? <Icon name="check" size={13} /> : null}
                        </button>
                      );
                    })}

                    {source !== null && mode === 'preview' ? (
                      <>
                        <div className="viewer-toolbar-more-separator" role="separator" />
                        {[50, 75, 100, 125, 150, 200].map((level) => (
                          <button
                            key={level}
                            type="button"
                            className={`viewer-toolbar-more-item${zoomLevelActive(level) ? ' active' : ''}`}
                            role="menuitem"
                            onClick={() => {
                              setPreviewZoomCached(fileViewportKey, level, 'manual');
                              setZoomMode('manual');
                              setZoom(level);
                              setToolbarMoreOpen(false);
                            }}
                          >
                            <RemixIcon name="zoom-in-line" size={15} />
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{level}%</span>
                            {zoomLevelActive(level) ? <Icon name="check" size={13} /> : null}
                          </button>
                        ))}
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {((filePrimaryActions: ReactNode) => (
        chromeActionsHost
          ? createPortal(
              <div
                data-pixo-file-actions-owner={file.name}
                style={{ display: workspaceActive ? 'contents' : 'none' }}
              >
                {filePrimaryActions}
              </div>,
              chromeActionsHost,
            )
          : workspaceActive
            ? filePrimaryActions
            : null
      ))(<>

          {versioningAvailable && rawCanDownload ? (
            <button
              type="button"
              data-pixo-version-entry="true"
              className={`chrome-action chrome-action-secondary chrome-action-icon pixo-tooltip${versionModalOpen ? ' is-active' : ''}`}
              // Same disabled contract as the Share button directly below:
              // `viewerOnly` + `viewerOnlyDisabledTitle`. A readonly shared
              // project has no history to show a member in the first place —
              // `.file-versions` is excluded from member mirrors, so the
              // owner's real history never arrives — so an openable entry only
              // ever led to an empty panel. This supersedes recvq56vFjQKfT,
              // which had un-gated the entry on the reasoning that browsing
              // history is a read action.
              disabled={source === null || viewerOnly}
              aria-label={t('fileViewer.versions.entry')}
              aria-expanded={Boolean(versionModalOpen)}
              data-tooltip={viewerOnly ? viewerOnlyDisabledTitle : t('fileViewer.versions.entryFull')}
              data-tooltip-placement="bottom"
              title={viewerOnly ? viewerOnlyDisabledTitle : t('fileViewer.versions.entryFull')}
              onClick={() => {
                // The version history is a floating panel now, not a modal, so
                // the toolbar icon is a toggle: a second click dismisses it.
                if (versionModalOpen) {
                  setVersionModalOpen(false);
                  return;
                }
                fireArtifactToolbarClick('versions', 'toolbar');
                setVersionModalOpen('toolbar');
              }}
            >
              <RemixIcon name="history-line" size={15} />
            </button>
          ) : null}
            <div className="chrome-file-action-menus">
              {/* Outside-click dismissal is scoped to the Share/Export pair —
                  the handoff split button next door must count as "outside" so
                  opening it closes this popover (and vice versa via the
                  handoff button's own dismiss listener). */}
              <div className="share-menu chrome-share-menu chrome-share-menu--unified" ref={shareRef}>
                {/* Share and Export are separate header intents again (the
                    0.18.0 unified tabs buried Export one level deep and export
                    reach halved); they still share one popover shell so
                    switching between them keeps the menu anchored in place.
                    Export keeps the leading slot; Owner C0 gives Share the
                    dark primary treatment and Export the quiet secondary one. */}
                {rawCanDownload ? (
                  <button
                    type="button"
                    className={
                      `chrome-action chrome-action-secondary chrome-action-with-label chrome-action-text-only chrome-action-unified ` +
                      (exportReadyNudge ? ' export-ready-nudge' : '')
                    }
                    aria-haspopup="menu"
                    aria-expanded={exportMenuOpen}
                    data-artifact-anchor={toolbarMenuAnchorId}
                    aria-label={t('fileViewer.unifiedExportTab')}
                    disabled={viewerOnly}
                    title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                    onClick={openDownloadMenu}
                  >
                    <RemixIcon name="download-line" size={15} />
                    <span>{t('fileViewer.unifiedExportTab')}</span>
                  </button>
                ) : null}


                {exportMenuOpen && rawCanDownload ? (
                  /*
                    * **同一块菜单,只是可能换个地方开。**
                    *
                    * 工具栏和产物卡入口都从按钮锚定并 portal 到 body，避免右侧面板
                    * 的裁切/层叠上下文盖住菜单；入口仍共用这一份菜单与状态。
                    * (产品 2026-08-27:「为啥这个发布弹窗是这样的?? 为啥不直接复用
                    *  现在那个分享弹窗??」「导出这个样式也不对呢, 为啥不直接复用?」)。
                    *
                    * 下面两块面板一行都没动 —— 这正是「一份实现」的意思。
                    */
                  <AnchoredMenuShell
                    anchorId={menuAnchorId ?? toolbarMenuAnchorId}
                    wrapperClassName="share-menu chrome-share-menu chrome-share-menu--unified"
                    className={
                      'share-menu-popover chrome-unified-popover'
                    }
                    portalRef={anchoredMenuRef}
                    /*
                     * 锚点滚出可视区(或整条消息被虚拟化掉)就把菜单收起来 ——
                     * 产品 2026-08-27:「在界面中如果原 button 不可见, 就自动
                     * 收起来 下拉框吧?」壳那一层已经先做了可逆的视觉隐藏,
                     * 这里是**真的关掉**:菜单里有发布/部署这类会改状态的动作,
                     * 留着一块看不见但仍可被键盘走到的面板不合适。
                     * 仓库里同样的取舍已有两处先例(`InlineModelSwitcher`、
                     * `ModelSelectSearchable` 都是锚点离开边界即 `setOpen(false)`)。
                     */
                    onAnchorHidden={closeExportMenu}
                  >

                    {rawCanDownload ? (
                      <div className="chrome-unified-panel">
                  {isGameEntry ? (
                    <button
                      type="button"
                      className="share-menu-item"
                      role="menuitem"
                      disabled={viewerOnly}
                      title={viewerOnly ? viewerOnlyDisabledTitle : t('fileViewer.exportPlayableHint')}
                      onClick={runPlayableExport}
                      data-testid="export-playable-game"
                    >
                      <span className="share-menu-icon"><RemixIcon name="play-line" size={15} /></span>
                      <span>{t('fileViewer.exportPlayable')}</span>
                    </button>
                  ) : (
                  <button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    disabled={viewerOnly}
                    title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                    onClick={() => runExportFormat('pdf')}
                  >
                    <span className="share-menu-icon"><RemixIcon name="file-line" size={15} /></span>
                    <span>{t('fileViewer.exportPdf')}</span>
                  </button>
                  )}

                  {showImageExport && !isGameEntry ? (
                    <button
                      type="button"
                      className="share-menu-item"
                      role="menuitem"
                      onClick={() => runExportFormat('image')}
                    >
                      <span className="share-menu-icon"><RemixIcon name="image-line" size={15} /></span>
                      <span>{t('fileViewer.exportImage')}</span>
                    </button>
                  ) : null}
                  {/* NOTE: no clipboard-capture ("截图") row here. Export is the
                      "produce a file/link out of this artifact" menu; a capture
                      that only lands on the clipboard is a different job and the
                      toolbar's screenshot-to-chat already leads with it. */}
                  <button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    disabled={viewerOnly}
                    title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                    onClick={() => runExportFormat('zip')}
                  >
                    <span className="share-menu-icon"><RemixIcon name="file-zip-line" size={15} /></span>
                    <span>{t('fileViewer.exportZip')}</span>
                  </button>
                  {isGameEntry ? null : (
                  <button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    disabled={viewerOnly}
                    title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                    onClick={() => runExportFormat('html')}
                  >
                    <span className="share-menu-icon"><RemixIcon name="file-code-line" size={15} /></span>
                    <span>{t('fileViewer.exportHtml')}</span>
                  </button>
                  )}
                  {showMarkdownExport ? (
                    <button
                      type="button"
                      className="share-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setExportMenuOpen(false);
                        fireShareExport('markdown', () => exportAsMd(source ?? '', exportTitle));
                      }}
                    >
                      <span className="share-menu-icon"><RemixIcon name="file-line" size={15} /></span>
                      <span>{t('fileViewer.exportMd')}</span>
                    </button>
                  ) : null}
                      </div>
                    ) : null}
                  </AnchoredMenuShell>
                ) : null}
              </div>
{viewerOnly ? null : (
                <HandoffButton
                  projectId={projectId}
                  projectKind={projectKind}
                  projectName={projectName}
                  projectDir={projectDir}
                  agents={agents}
                  artifactId={artifactId}
                  artifactKind={handoffArtifactKind}
                  metricsConsent={metricsConsent}
                  installationId={installationId}
                />
              )}
            </div>
      </>)}
      <div className="viewer-body" ref={previewBodyRef}>
        {initialPreviewLoading ? (
          <FileViewerLoadingSkeleton />
        ) : (
          <>
            <div
            hidden={mode !== 'preview'}
            aria-hidden={mode !== 'preview' ? true : undefined}
            className={`${'preview-canvas-layout'} preview-viewport preview-viewport-${previewViewport}`}
            data-testid={'preview-layout'}

            style={{
              ...previewViewportStyle(
                previewViewport,
                previewScale,
                previewBodySize,
                undefined,
              ),
              ...(mode !== 'preview' ? { display: 'none' } : {}),
            }}
            onMouseLeave={undefined}
          >

            <div
              className={'preview-canvas'}
              data-testid={'preview-canvas'}
              ref={setPreviewCanvasRef}
            >
              <div className={'preview-frame-clip'} style={undefined}>
                <div
                  style={
                    previewScaleShellStyle(previewViewport, previewScale)
                  }
                >

                    <div className="artifact-preview-transport-stack">
                      {PIXO_PREVIEW_KEEP_ALIVE ? (
                        <PooledIframe
                          ref={urlPreviewIframeRef}
                          cacheKey={urlPreviewKeepAliveKey}
                          data-testid={workspaceActive
                            ? (useUrlLoadPreview ? 'artifact-preview-frame' : 'artifact-preview-frame-url-load')
                            : `artifact-preview-frame-retained-${file.name}`}
                          data-pixo-render-mode="url-load"
                          data-pixo-active={mode === 'preview' && useUrlLoadPreview ? 'true' : 'false'}
                          data-pixo-motion-muted={motionPreviewMuted ? 'true' : 'false'}
                          data-pixo-motion-active={workspaceActive && mode === 'preview' && useUrlLoadPreview ? 'true' : 'false'}


                          aria-hidden={workspaceActive && mode === 'preview' && useUrlLoadPreview ? undefined : true}
                          tabIndex={workspaceActive && mode === 'preview' && useUrlLoadPreview ? 0 : -1}
                          title={file.name}
                          data-pixo-powered={usePoweredPreview ? 'true' : undefined}
                          sandbox={urlFrameSandbox}
                          allow={urlFrameAllow}
                          src={urlFrameSrc}
                          onLoad={() => {
                            const frame = urlPreviewIframeRef.current;

                            if (useUrlLoadPreview) {
                              iframeRef.current = frame;
                              // A new document cannot finish the old in-progress lasso.

                            }
                            if (frame) frame.dataset.pixoLoadedSrc = frame.getAttribute('src') ?? '';
                            if (frame) {
                              frame.dataset.pixoLoadedPreviewEpoch =
                                new URL(frame.getAttribute('src') ?? '', window.location.href)
                                  .searchParams.get('pixoPreviewEpoch') ?? '';
                            }
                            if (useUrlLoadPreview) beginDesktopPreviewContentMeasurementGeneration(frame);
                            // First real paint of this artifact URL — drop the
                            // first-load overlay. about:blank parks don't count.
                            if ((frame?.getAttribute('src') ?? 'about:blank') !== 'about:blank') {
                              urlPreviewLoadedKeysRef.current.add(urlPreviewKeepAliveKey);
                              setUrlPreviewFirstLoadPending(false);
                            }

                            dcViewportRestoreAtRef.current = Date.now();
                            frame?.contentWindow?.postMessage({
                              type: '__dc_set_viewport',
                              ...dcViewportRef.current,
                            }, '*');
                            postPreviewObservabilityHostState(frame);
                            if (useUrlLoadPreview) restorePreviewScrollPosition();
                            if (useUrlLoadPreview) scheduleDesktopPreviewContentMeasure(frame);
                          }}
                        />
                      ) : (
                        <iframe
                          ref={setUnpooledUrlPreviewIframe}
                          data-testid={workspaceActive
                            ? (useUrlLoadPreview ? 'artifact-preview-frame' : 'artifact-preview-frame-url-load')
                            : `artifact-preview-frame-retained-${file.name}`}
                          data-pixo-render-mode="url-load"
                          data-pixo-active={mode === 'preview' && useUrlLoadPreview ? 'true' : 'false'}
                          data-pixo-motion-muted={motionPreviewMuted ? 'true' : 'false'}
                          data-pixo-motion-active={workspaceActive && mode === 'preview' && useUrlLoadPreview ? 'true' : 'false'}


                          aria-hidden={workspaceActive && mode === 'preview' && useUrlLoadPreview ? undefined : true}
                          tabIndex={workspaceActive && mode === 'preview' && useUrlLoadPreview ? 0 : -1}
                          title={file.name}
                          data-pixo-powered={usePoweredPreview ? 'true' : undefined}
                          sandbox={urlFrameSandbox}
                          allow={urlFrameAllow}
                          src={urlFrameSrc}
                          onLoad={() => {
                            const frame = urlPreviewIframeRef.current;

                            if (useUrlLoadPreview) {
                              iframeRef.current = frame;
                              // A new document cannot finish the old in-progress lasso.

                            }
                            if (frame) frame.dataset.pixoLoadedSrc = frame.getAttribute('src') ?? '';
                            if (frame) {
                              frame.dataset.pixoLoadedPreviewEpoch =
                                new URL(frame.getAttribute('src') ?? '', window.location.href)
                                  .searchParams.get('pixoPreviewEpoch') ?? '';
                            }
                            if (useUrlLoadPreview) beginDesktopPreviewContentMeasurementGeneration(frame);
                            // First real paint of this artifact URL — drop the
                            // first-load overlay. about:blank parks don't count.
                            if ((frame?.getAttribute('src') ?? 'about:blank') !== 'about:blank') {
                              urlPreviewLoadedKeysRef.current.add(urlPreviewKeepAliveKey);
                              setUrlPreviewFirstLoadPending(false);
                            }

                            dcViewportRestoreAtRef.current = Date.now();
                            frame?.contentWindow?.postMessage({
                              type: '__dc_set_viewport',
                              ...dcViewportRef.current,
                            }, '*');
                            postPreviewObservabilityHostState(frame);
                            if (useUrlLoadPreview) restorePreviewScrollPosition();
                            if (useUrlLoadPreview) scheduleDesktopPreviewContentMeasure(frame);
                          }}
                        />
                      )}
                      <iframe
                        key={usesPersistentSrcDocTransport
                          ? `${srcDocPreviewFrameName}:persistent:${srcDocTransportResetKey}`
                          : srcDocTransportResetKey}
                        ref={setSrcDocPreviewIframe}
                        name={srcDocPreviewFrameName}
                        data-testid={workspaceActive
                          ? (useUrlLoadPreview ? 'artifact-preview-frame-srcdoc' : 'artifact-preview-frame')
                          : `artifact-preview-frame-srcdoc-retained-${file.name}`}
                        data-pixo-render-mode="srcdoc"
                        data-pixo-active={mode === 'preview' && !useUrlLoadPreview ? 'true' : 'false'}
                        data-pixo-motion-muted={motionPreviewMuted ? 'true' : 'false'}
                        data-pixo-motion-active={workspaceActive && mode === 'preview' && !useUrlLoadPreview ? 'true' : 'false'}


                        aria-hidden={workspaceActive && mode === 'preview' && !useUrlLoadPreview ? undefined : true}
                        tabIndex={workspaceActive && mode === 'preview' && !useUrlLoadPreview ? 0 : -1}
                        title={file.name}
                        sandbox={HTML_PREVIEW_SANDBOX}
                        src={srcDocTransportUrl ?? 'about:blank'}
                        srcDoc={srcDocTransportUrl ? undefined : srcDocTransportContent}
                        onLoad={() => {
                          const frame = srcDocPreviewIframeRef.current;

                          if (!useUrlLoadPreview) iframeRef.current = frame;
                          if (frame) {
                            frame.dataset.pixoLoadedPreviewEpoch =
                              previewContentMeasurementDocumentEpoch;
                          }
                          if (!useUrlLoadPreview) beginDesktopPreviewContentMeasurementGeneration(frame);
                          if (useLazySrcDocTransport) setSrcDocShellReady(true);
                          const activatedTransport = activateLoadedSrcDocTransport(frame);
                          if (frame && activatedTransport) {
                            // The shell is about to replace its document. Any
                            // readiness witnessed for this DOM node belongs to
                            // the previous navigation and must not allow an
                            // abort to consume recovery before the replacement
                            // document's final load.
                            srcDocNavigationCommittedRef.current = null;
                            srcDocContentReadyRef.current = null;
                          }
                          verifyLoadedSrcDocTransport(frame);
                          dcViewportRestoreAtRef.current = Date.now();
                          frame?.contentWindow?.postMessage({
                            type: '__dc_set_viewport',
                            ...dcViewportRef.current,
                          }, '*');
                          postPreviewObservabilityHostState(frame);

                          if (!useUrlLoadPreview) restorePreviewScrollPosition();
                          if (!useUrlLoadPreview) scheduleDesktopPreviewContentMeasure(frame);
                          if (frame && !activatedTransport) {
                            // The lazy shell's first load immediately starts a
                            // second document.write navigation. Recovering in
                            // that first callback is too early: the following
                            // navigation can discard the newly-created surface
                            // again. Consume a cached host failure synchronously
                            // from the final load callback, before Chromium can
                            // present the document and turn the compositor
                            // refresh into a visible second flash.
                            srcDocNavigationCommittedRef.current = {
                              frame,
                              generation: srcDocTransportGeneration,
                            };
                          }
                        }}
                      />
                      {useUrlLoadPreview && urlPreviewFirstLoadPending ? (
                        // First-ever URL-load of this artifact: the iframe's own
                        // navigation may still be queued behind heavy same-origin
                        // traffic (drafts/all-projects cover iframes) — without
                        // this cover the pane reads as a dead white screen.
                        <div
                          className="artifact-preview-first-load"
                          role="status"
                          aria-busy="true"
                          aria-label={t('fileViewer.loading')}
                          data-testid="artifact-preview-first-load"
                        >
                          <CenteredLoader label={t('fileViewer.loading')} />
                        </div>
                      ) : null}
                      {!useUrlLoadPreview && previewSource === null ? (
                        <div
                          className="artifact-preview-first-load"
                          role="status"
                          aria-busy="true"
                          aria-label={t('fileViewer.loading')}
                          data-testid="artifact-preview-first-load"
                        >
                          <CenteredLoader label={t('fileViewer.loading')} />
                        </div>
                      ) : null}
                    </div>

                  {previewAssetWarning ? (
                    <div className="preview-asset-warning" role="alert" data-testid="preview-asset-warning">
                      <strong>{t('fileViewer.previewAssetBlockedTitle')}</strong>
                      <span>
                        {t('fileViewer.previewAssetBlockedDetail', { filePath: previewAssetWarning.filePath })}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>


              {/* Portaled to <body> so the screenshot/export toast escapes the
                  preview pane's transform + overflow:hidden. */}
              {workspaceActive && exportToast && !versionModalOpen
                ? createPortal(
                    <TopStackedToast
                      message={exportToast.message}
                      details={exportToast.details}
                      tone={exportToast.tone}
                      role={exportToast.tone === 'error' ? 'alert' : 'status'}
                      ttlMs={exportToast.tone === 'loading' ? 60000 : 2200}
                      onDismiss={exportToast.tone === 'loading' ? undefined : () => setExportToast(null)}
                    />,
                    document.body,
                  )
                : null}

              {workspaceActive && templateSavedToast ? (
                <div className="preview-toast-anchor">
                  <Toast
                    message={templateSavedToast}
                    ttlMs={2200}
                    onDismiss={() => setTemplateSavedToast(null)}
                  />
                </div>
              ) : null}

            </div>

            </div>
            {mode !== 'preview' ? (
              sourceModeLoading ? (
                <div className="viewer-empty">{t('fileViewer.loading')}</div>
              ) : (
                <pre className="viewer-source">{source}</pre>
              )
            ) : null}
          </>
        )}
      </div>


      {/* No `!viewerOnly` here: the modal already fails closed on the one
          write action it hosts — `restoreDisabled` includes `viewerOnly` —
          so re-blocking the whole panel only stopped a read-only viewer from
          BROWSING versions (recvq56vFjQKfT). */}
      {workspaceActive && versionModalOpen && versioningAvailable && typeof document !== 'undefined' ? (
        <FileVersionManagerModal
          projectId={projectId}
          projectKind={projectKind}
          file={file}
          currentSource={source}
          entryFrom={versionModalOpen}
          onExportPdf={triggerPdfExport}
          onOpenImageExport={openImageExportModal}
          onExportZip={triggerZipExport}
          onExportHtml={triggerHtmlExport}
          exportToast={exportToast}
          onExportToastDismiss={() => setExportToast(null)}
          onClose={() => setVersionModalOpen(false)}
          onRestored={handleVersionRestored}
          viewerOnly={viewerOnly}
        />
      ) : null}

      {workspaceActive && imageExportModalOpen && typeof document !== 'undefined' ? createPortal(
        <div
          className="modal-backdrop viewer-modal-backdrop image-export-backdrop"
          role="presentation"
        >
          <div
            className="modal export-modal image-export-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={imageExportTitleId}
          >
            <div className="modal-head">
              <div className="kicker">IMAGE</div>
              <h2 id={imageExportTitleId}>{t('fileViewer.exportImage')}</h2>
              <p className="subtitle">{t('fileViewer.exportImageModalSubtitle')}</p>
            </div>
            <div className="export-form image-export-form">
              <fieldset className="image-export-format-field">
                <legend>{t('fileViewer.exportImageFormatLabel')}</legend>
                <div className="image-export-format-options">
                  {IMAGE_EXPORT_FORMAT_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={`image-export-format-option${imageExportFormat === option.value ? ' active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="image-export-format"
                        value={option.value}
                        aria-label={option.label}
                        checked={imageExportFormat === option.value}
                        onChange={() => changeImageExportFormat(option.value)}
                      />
                      <span className="image-export-format-text">
                        <strong>{option.label}</strong>
                        <span aria-hidden="true">{option.extension}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {imageExportError ? (
                <p className="export-error" role="alert">{imageExportError}</p>
              ) : null}
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="ghost-link button-like"
                onClick={() => {
                  // User dismissed the image export modal without saving —
                  // close the ui_click(image)→result funnel as cancelled.
                  fireImageExportResult('cancelled', 'MODAL_DISMISSED');
                  setImageExportModalOpen(false);
                  setImageExportError(null);
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="viewer-action primary"
                onClick={() => {
                  void handleImageExportSave();
                }}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
      {workspaceActive && templateModalOpen && typeof document !== 'undefined' ? createPortal(
        <div className="modal-backdrop viewer-modal-backdrop" role="presentation">
          <div className="modal export-modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div className="kicker">TEMPLATE</div>
              <h2>{t('fileViewer.saveAsTemplate')}</h2>
              <p className="subtitle">{t('fileViewer.templateDescPrompt')}</p>
            </div>
            <div className="export-form">
              <label className="field" htmlFor={templateNameId}>
                <span className="field-label">{t('fileViewer.templateNamePrompt')}</span>
                <input
                  id={templateNameId}
                  type="text"
                  value={templateName}
                  placeholder={t('fileViewer.templateNameDefault')}
                  autoFocus
                  onChange={(e) => setTemplateName(e.target.value)}
                />
              </label>
              <label className="field" htmlFor={templateDescriptionId}>
                <span className="field-label">{t('fileViewer.templateDescPrompt')}</span>
                <textarea
                  id={templateDescriptionId}
                  rows={3}
                  value={templateDescription}
                  placeholder={t('fileViewer.optional')}
                  onChange={(e) => setTemplateDescription(e.target.value)}
                />
              </label>
              {templateSaveError ? <p className="export-error">{templateSaveError}</p> : null}
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="ghost-link button-like"
                disabled={savingTemplate}
                onClick={() => {
                  // Dismissed without saving — close the ui_click(template)→
                  // result funnel as cancelled.
                  fireTemplateExportResult('cancelled', 'MODAL_DISMISSED');
                  setTemplateModalOpen(false);
                  setTemplateSaveError(null);
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="viewer-action primary"
                disabled={savingTemplate || !templateName.trim()}
                onClick={() => {
                  void handleSaveAsTemplate();
                }}
              >
                {savingTemplate ? t('fileViewer.savingTemplate') : t('common.save')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      {/* Item 5 (2026 refactor): deploy result feedback reached from the
          share ··· menu now takes the same ShareFeedbackToast look as the
          update-link toast above (tone maps cleanly: deploySavedToast is
          always a success, deployActionToast is always a token/config
          error) instead of the generic Toast — see AGENTS.md item 5. Its
          own stacking fix keeps this from overlapping updateToast/
          shareGuideToast if more than one is up at once. */}


      {workspaceActive && versionRestoredToast && typeof document !== 'undefined' ? createPortal(
        <TopStackedToast
          key={versionRestoredToast.id}
          message={versionRestoredToast.message}
          tone="success"
          ttlMs={2400}
          onDismiss={() => setVersionRestoredToast(null)}
        />,
        document.body,
      ) : null}
    </div>
  );
}

function baseDirFor(fileName: string): string {
  const idx = fileName.lastIndexOf('/');
  return idx >= 0 ? fileName.slice(0, idx + 1) : '';
}

function isBlockedPreviewAssetScheme(assetRef: string): boolean {
  const clean = assetRef.replace(/[\s\u0000-\u001F\u007F-\u009F]/g, '');
  return /^(?:javascript|data):/i.test(clean);
}

async function inlineRelativeAssets(
  html: string,
  projectId: string,
  fileName: string,
  projectFilePaths: ReadonlySet<string> | null = null
): Promise<string> {
  const toRawUrl = (projectPath: string) =>
    projectRawUrl(projectId, projectPath);
  // Root-relative project asset refs (confirmed against the real file list)
  // become owner-relative first, so the stylesheet/script inlining below and
  // the srcDoc <base href> rebasing treat them like any other relative ref.
  const normalized = projectFilePaths
    ? normalizeRootRelativeProjectAssetRefs(html, fileName, projectFilePaths)
    : html;

  const replacements: Array<Promise<{ from: string; to: string } | null>> = [];
  const links = normalized.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of links) {
    const rel = readHtmlAttr(tag, 'rel');
    const href = readHtmlAttr(tag, 'href');
    if (!rel || !/\bstylesheet\b/i.test(rel) || !href) continue;
    replacements.push(
      fetchProjectRelativeText(projectId, fileName, href).then((asset) =>
        asset == null
          ? null
          : {
              from: tag,
              to:
                `<style data-pixo-inline-asset="${escapeHtmlAttr(href)}">\n` +
                `${rewriteInlinedCssAssetRefs(asset.text, asset.filePath, projectFilePaths, toRawUrl)
                  .replace(/<\/style/gi, '<\\/style')}\n</style>`,
            },
      ),
    );
  }

  const scripts = normalized.match(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>/gi) ?? [];
  for (const tag of scripts) {
    const src = readHtmlAttr(tag, 'src');
    if (!src) continue;
    replacements.push(
      fetchProjectRelativeText(projectId, fileName, src).then((asset) => {
        if (asset == null) return null;
        const js = projectFilePaths
          ? rewriteInlinedScriptAssetRefs(asset.text, asset.filePath, projectFilePaths, toRawUrl)
          : asset.text;
        const open = tag.match(/^<script\b[^>]*>/i)?.[0] ?? '<script>';
        const attrs = open
          .replace(/^<script/i, '')
          .replace(/>$/i, '')
          .replace(/\ssrc\s*=\s*(['"])[\s\S]*?\1/i, '');
        return {
          from: tag,
          to: `<script${attrs}>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`,
        };
      }),
    );
  }

  const resolved = (await Promise.all(replacements)).filter(
    (item): item is { from: string; to: string } => item !== null,
  );
  const inlined = resolved.reduce(
    (next, { from, to }) => next.replace(from, () => to),
    normalized,
  );
  return inlined;
}

async function fetchProjectRelativeText(
  projectId: string,
  ownerFileName: string,
  assetRef: string
): Promise<{ filePath: string; text: string } | null> {
  const filePath = resolveProjectRelativePath(ownerFileName, assetRef);
  if (!filePath) return null;
  try {
    const resp = await fetch(
      projectRawUrl(projectId, filePath),
      undefined,
    );
    if (!resp.ok) return null;
    return { filePath, text: await resp.text() };
  } catch {
    return null;
  }
}

function resolveProjectRelativePath(ownerFileName: string, assetRef: string): string | null {
  if (isBlockedPreviewAssetScheme(assetRef)) return null;
  if (/^(?:https?:|data:|blob:|mailto:|tel:|#|\/)/i.test(assetRef)) return null;
  try {
    const url = new URL(assetRef, `https://pixo.local/${baseDirFor(ownerFileName)}`);
    if (url.origin !== 'https://pixo.local') return null;
    const decodedPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const parts = decodedPath.split(/[/\\]/);
    if (parts.some((part) => part === '..' || part.trim() === '..')) return null;
    return decodedPath;
  } catch {
    return null;
  }
}

function readHtmlAttr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, 'i'));
  return match?.[2] ?? null;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function ImageViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();

  const url = appendResourceQuery(
    projectFileUrl(projectId, file.name),
    `v=${Math.round(file.mtime)}`,
  );
  return (
    <div className="viewer image-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {file.kind === 'sketch'
              ? t('fileViewer.sketchMeta', { size: humanSize(file.size) })
              : t('fileViewer.imageMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <div className="viewer-toolbar-actions">
          <ViewerAddToChat file={file} />
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name)}
            download={file.name}
          >
            {t('fileViewer.download')}
          </a>
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('fileViewer.open')}
          </a>
        </div>
      </div>
      <div className="viewer-body image-body">
        <img alt={file.name} src={url} />
      </div>
    </div>
  );
}

function VideoViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();

  const url = appendResourceQuery(
    projectFileUrl(projectId, file.name),
    `v=${Math.round(file.mtime)}`,
  );
  return (
    <div className="viewer video-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.videoMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body video-body">
        <video src={url} controls playsInline preload="metadata" />
      </div>
    </div>
  );
}

function ModelViewer({ projectId, file }: { projectId: string; file: ProjectFile }) {
  const t = useT();
  const url = appendResourceQuery(projectFileUrl(projectId, file.name), `v=${Math.round(file.mtime)}`);
  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">{t('fileViewer.model3dMeta', { size: humanSize(file.size) })}</span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body">
        <Model3dViewer src={url} name={file.name} />
      </div>
    </div>
  );
}

function AudioViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();

  const url = appendResourceQuery(
    projectFileUrl(projectId, file.name),
    `v=${Math.round(file.mtime)}`,
  );
  return (
    <div className="viewer audio-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.audioMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body audio-body">
        <div className="audio-card">
          <Icon name="mic" size={28} />
          <div className="audio-card-name">{file.name}</div>
          <audio src={url} controls preload="metadata" />
        </div>
      </div>
    </div>
  );
}

type SvgViewerMode = 'preview' | 'source';

interface SvgViewerProps {
  projectId: string;
  file: ProjectFile;
  initialMode?: SvgViewerMode;
  initialSource?: string | null | undefined;
}

export function SvgViewer({
  projectId,
  file,
  initialMode = 'preview',
  initialSource,
}: SvgViewerProps) {
  const t = useT();

  const [mode, setMode] = useState<SvgViewerMode>(initialMode);
  const [source, setSource] = useState<string | null>(initialSource ?? null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const url = appendResourceQuery(
    projectFileUrl(projectId, file.name),
    `v=${Math.round(file.mtime)}&r=${reloadKey}`,
  );

  useEffect(() => {
    if (mode !== 'source') return;
    if (initialSource !== undefined && reloadKey === 0) return;
    let cancelled = false;
    setLoadingSource(true);
    setSourceError(false);
    void fetchProjectFileText(projectId, file.name, {
      cache: 'no-store',
      cacheBustKey: `${Math.round(file.mtime)}-${reloadKey}`,

    }).then((next) => {
      if (cancelled) return;
      if (next === null) {
        setSource('');
        setSourceError(true);
      } else {
        setSource(next);
      }
      setLoadingSource(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    file.name,
    file.mtime,
    initialSource,
    mode,
    reloadKey,
  ]);

  return (
    <div className="viewer svg-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.imageMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <div className="viewer-toolbar-actions">
          <div className="viewer-tabs">
            <button
              type="button"
              className={`viewer-tab ${mode === 'preview' ? 'active' : ''}`}
              aria-pressed={mode === 'preview'}
              onClick={() => setMode('preview')}
            >
              {t('fileViewer.preview')}
            </button>
            <button
              type="button"
              className={`viewer-tab ${mode === 'source' ? 'active' : ''}`}
              aria-pressed={mode === 'source'}
              onClick={() => setMode('source')}
            >
              {t('fileViewer.source')}
            </button>
          </div>
          <span className="viewer-divider" aria-hidden />
          <button
            type="button"
            className="viewer-action"
            onClick={() => setReloadKey((n) => n + 1)}
            title={t('fileViewer.reloadDisk')}
          >
            <Icon name="reload" size={13} />
            <span>{t('fileViewer.reload')}</span>
          </button>
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name)}
            download={file.name}
          >
            {t('fileViewer.download')}
          </a>
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('fileViewer.open')}
          </a>
        </div>
      </div>
      <div className={`viewer-body ${mode === 'preview' ? 'image-body' : ''}`}>
        {mode === 'preview' ? (
          <img alt={file.name} src={url} />
        ) : loadingSource ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : sourceError ? (
          <div className="viewer-empty">{t('fileViewer.previewUnavailable')}</div>
        ) : (
          <pre className="viewer-source">{source ?? ''}</pre>
        )}
      </div>
    </div>
  );
}

// Read-only fallback viewer for `text` / `code` files (JSON tokens, configs,
// source dumps). It renders the file body through `CodeWithLines` / `<pre>` and
// owns no editable buffer, so there is no state in which a save could ever
// apply. Its toolbar therefore exposes only reload + copy: a Save control here
// would be permanently unreachable, not merely idle. Viewers that DO own an
// editable buffer (MarkdownViewer's autosave, HtmlViewer's manual-edit save)
// keep their save affordance even while it is momentarily disabled, because
// there the disabled state is transient rather than structural.
function TextViewer({
  projectId,
  file,
  sourceLineRequest,
}: {
  projectId: string;
  file: ProjectFile;
  sourceLineRequest?: { line: number; nonce: number } | null;
}) {
  const t = useT();

  const [text, setText] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setText(null);
    let cancelled = false;
    void fetchProjectFileText(projectId, file.name, {  }).then((t) => {
      if (!cancelled) setText(t ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, reloadKey,]);

  async function copy() {
    if (text == null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // best-effort fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  const displayText = useMemo(
    () => (text == null ? null : sourceLineRequest ? text : formatJsonFileTextForDisplay(file, text)),
    [file.name, file.mime, text, sourceLineRequest],
  );
  const lineCount = displayText ? displayText.split('\n').length : 0;

  return (
    <div className="viewer text-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left" />
        <div className="viewer-toolbar-actions">
          <button
            type="button"
            className="viewer-action"
            onClick={() => setReloadKey((n) => n + 1)}
            title={t('fileViewer.reloadDisk')}
          >
            <Icon name="reload" size={13} />
            <span>{t('fileViewer.reload')}</span>
          </button>
          <button
            type="button"
            className="viewer-action"
            onClick={() => void copy()}
            title={t('fileViewer.copyTitle')}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            <span>{copied ? t('fileViewer.copied') : t('fileViewer.copy')}</span>
          </button>
        </div>
      </div>
      <div className="viewer-body">
        {text === null ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : displayText !== null && lineCount > 0 ? (
          <CodeWithLines text={displayText} navigation={sourceLineRequest} />
        ) : (
          <pre className="viewer-source">{displayText}</pre>
        )}
      </div>
    </div>
  );
}

function formatJsonFileTextForDisplay(file: ProjectFile, text: string): string {
  if (!isJsonFile(file)) return text;
  try {
    if (hasPrecisionSensitiveJsonNumberText(text)) return text;
    const parsed = JSON.parse(text) as unknown;
    if (hasUnsafeJsonNumber(parsed)) return text;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function hasPrecisionSensitiveJsonNumberText(text: string): boolean {
  let inString = false;
  let escaped = false;
  const numberTokenPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      i += 1;
      continue;
    }

    numberTokenPattern.lastIndex = i;
    const match = numberTokenPattern.exec(text);
    if (!match) {
      i += 1;
      continue;
    }

    const token = match[0];
    if (isSignedNegativeZeroJsonNumberToken(token)) return true;
    if (/[.eE]/.test(token) && isPrecisionSensitiveJsonNumberToken(token)) return true;
    i = numberTokenPattern.lastIndex;
  }
  return false;
}

function isSignedNegativeZeroJsonNumberToken(token: string): boolean {
  return /^-0(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(token);
}

function isPrecisionSensitiveJsonNumberToken(token: string): boolean {
  const parsed = Number(token);
  if (!Number.isFinite(parsed)) return true;
  const rendered = JSON.stringify(parsed);
  if (!rendered) return true;
  const originalValue = parseJsonNumberTokenAsDecimal(token);
  const renderedValue = parseJsonNumberTokenAsDecimal(rendered);
  return (
    !originalValue ||
    !renderedValue ||
    originalValue.coefficient !== renderedValue.coefficient ||
    originalValue.exponent !== renderedValue.exponent
  );
}

function parseJsonNumberTokenAsDecimal(token: string): { coefficient: bigint; exponent: number } | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) return null;
  const [, sign, integerPart, fractionPart = '', exponentPart = '0'] = match;
  const coefficient = BigInt(`${sign ?? ''}${integerPart}${fractionPart}`);
  const exponent = Number(exponentPart) - fractionPart.length;
  return normalizeDecimalParts(coefficient, exponent);
}

function normalizeDecimalParts(coefficient: bigint, exponent: number): { coefficient: bigint; exponent: number } {
  if (coefficient === 0n) return { coefficient: 0n, exponent: 0 };
  let normalizedCoefficient = coefficient;
  let normalizedExponent = exponent;
  while (normalizedCoefficient % 10n === 0n) {
    normalizedCoefficient /= 10n;
    normalizedExponent += 1;
  }
  return { coefficient: normalizedCoefficient, exponent: normalizedExponent };
}

function hasUnsafeJsonNumber(value: unknown): boolean {
  if (typeof value === 'number') {
    return !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value));
  }
  if (Array.isArray(value)) return value.some(hasUnsafeJsonNumber);
  if (value && typeof value === 'object') return Object.values(value).some(hasUnsafeJsonNumber);
  return false;
}

function isJsonFile(file: ProjectFile): boolean {
  return file.name.toLowerCase().endsWith('.json') || file.mime.toLowerCase().startsWith('application/json');
}

type MarkdownViewerMode = 'edit' | 'split' | 'preview';
type MarkdownSaveState = 'idle' | 'saving' | 'saved' | 'error';
type MarkdownScrollPane = 'editor' | 'preview';
type MarkdownSaveOptions = {
  refreshFiles?: boolean;
  showSaving?: boolean;
};

function markdownScrollRange(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function markdownScrollRatio(element: HTMLElement): number {
  const range = markdownScrollRange(element);
  return range > 0 ? element.scrollTop / range : 0;
}

function markdownScrollTopForRatio(element: HTMLElement, ratio: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return markdownScrollRange(element) * clamped;
}

function mergeMarkdownSaveOptions(a: MarkdownSaveOptions, b: MarkdownSaveOptions): MarkdownSaveOptions {
  return {
    refreshFiles: a.refreshFiles !== false || b.refreshFiles !== false,
    showSaving: a.showSaving !== false || b.showSaving !== false,
  };
}

function MarkdownViewer({
  projectId,
  file,
  onFileSaved,
  onFileWritten,
  viewerOnly = false,
}: {
  projectId: string;
  file: ProjectFile;
  onFileSaved?: () => Promise<void> | void;
  onFileWritten?: (file: ProjectFile) => void;
  viewerOnly?: boolean;
}) {
  const { t, locale } = useI18n();

  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsideInteraction(downloadMenuOpen, downloadMenuRef, () => setDownloadMenuOpen(false));
  const [mode, setMode] = useState<MarkdownViewerMode>(viewerOnly ? 'preview' : 'split');
  const [saveState, setSaveState] = useState<MarkdownSaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<{ source: string; html: string; themeRevision: number } | null>(null);
  const [highlightThemeRevision, setHighlightThemeRevision] = useState(0);
  const [, bumpSavedRevision] = useState(0);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const markdownPreviewPaneRef = useRef<HTMLElement | null>(null);
  const markdownArticleRef = useRef<HTMLElement | null>(null);
  const copyBlockTimerRef = useRef<number | null>(null);
  const copiedMarkdownBlockRef = useRef<HTMLElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const programmaticScrollClearFrameRef = useRef<number | null>(null);
  const pendingScrollSyncRef = useRef<{ sourcePane: MarkdownScrollPane; targetPane: MarkdownScrollPane } | null>(null);
  const programmaticScrollRef = useRef<{ pane: MarkdownScrollPane; top: number } | null>(null);
  const activeMarkdownScrollPaneRef = useRef<MarkdownScrollPane>('editor');
  const editorBlockOffsetsRef = useRef<{ width: number; offsets: number[] } | null>(null);
  const previousModeRef = useRef<MarkdownViewerMode>(viewerOnly ? 'preview' : 'split');
  const saveInFlightRef = useRef(false);
  const pendingSaveAfterFlightRef = useRef<MarkdownSaveOptions | null>(null);
  const textRef = useRef('');
  const lastSavedTextRef = useRef<string | null>(null);
  const loadedFileKeyRef = useRef<string | null>(null);
  const markdownFileKey = `${projectId}::${file.name}`;
  const status = file.artifactManifest?.status ?? 'complete';
  const isStreaming = status === 'streaming';
  const isError = status === 'error';
  const exportTitle = file.name.replace(/\.mdx?$/i, '') || file.name;
  const viewerOnlyDisabledTitle = t('studio.readOnly');

  useEffect(() => {
    if (!viewerOnly) return;
    setMode('preview');
    setDownloadMenuOpen(false);
  }, [viewerOnly]);

  useEffect(() => {
    const sameLoadedFile = loadedFileKeyRef.current === markdownFileKey;
    if (
      sameLoadedFile &&
      lastSavedTextRef.current !== null &&
      textRef.current !== lastSavedTextRef.current
    ) {
      return undefined;
    }
    if (!sameLoadedFile) setText(null);
    copiedMarkdownBlockRef.current = null;
    if (copyBlockTimerRef.current) {
      window.clearTimeout(copyBlockTimerRef.current);
      copyBlockTimerRef.current = null;
    }
    let cancelled = false;
    void fetchProjectFileText(projectId, file.name, {  }).then((next) => {
      if (cancelled) return;
      if (
        loadedFileKeyRef.current === markdownFileKey &&
        lastSavedTextRef.current !== null &&
        textRef.current !== lastSavedTextRef.current
      ) {
        return;
      }
      const loaded = next ?? '';
      if (
        sameLoadedFile &&
        lastSavedTextRef.current !== null &&
        textRef.current === lastSavedTextRef.current &&
        loaded === lastSavedTextRef.current
      ) {
        loadedFileKeyRef.current = markdownFileKey;
        pendingSaveAfterFlightRef.current = null;
        setSaveState((current) => current === 'saved' ? current : 'idle');
        return;
      }
      textRef.current = loaded;
      lastSavedTextRef.current = loaded;
      loadedFileKeyRef.current = markdownFileKey;
      pendingSaveAfterFlightRef.current = null;
      setSaveState('idle');
      setText(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, markdownFileKey]);

  useEffect(() => {
    return () => {
      copiedMarkdownBlockRef.current = null;
      if (copyBlockTimerRef.current) {
        window.clearTimeout(copyBlockTimerRef.current);
      }
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (scrollSyncFrameRef.current) {
        window.cancelAnimationFrame(scrollSyncFrameRef.current);
        scrollSyncFrameRef.current = null;
      }
      if (programmaticScrollClearFrameRef.current) {
        window.cancelAnimationFrame(programmaticScrollClearFrameRef.current);
        programmaticScrollClearFrameRef.current = null;
      }
      pendingScrollSyncRef.current = null;
      programmaticScrollRef.current = null;
      activeMarkdownScrollPaneRef.current = 'editor';
    };
  }, []);

  const saveMarkdownText = useCallback(
    (value: string, options: MarkdownSaveOptions = {}) => {
      if (viewerOnly) return;
      const run = async (nextValue: string, saveOptions: MarkdownSaveOptions): Promise<void> => {
        if (lastSavedTextRef.current === nextValue) {
          const showSaving = saveOptions.showSaving !== false;
          if (textRef.current === nextValue) setSaveState(showSaving ? 'saved' : 'idle');
          if (saveOptions.refreshFiles !== false && onFileSaved) {
            void Promise.resolve(onFileSaved()).catch(() => undefined);
          }
          return;
        }
        if (saveInFlightRef.current) {
          pendingSaveAfterFlightRef.current = pendingSaveAfterFlightRef.current
            ? mergeMarkdownSaveOptions(pendingSaveAfterFlightRef.current, saveOptions)
            : saveOptions;
          return;
        }
        saveInFlightRef.current = true;
        const showSaving = saveOptions.showSaving !== false;
        if (showSaving) setSaveState('saving');
        try {
          const saved = await writeProjectTextFile(projectId, file.name, nextValue, undefined);
          if (!saved) throw new Error('write failed');
          // A successful write remains a write when autosave deliberately
          // avoids refreshing the file list. No-op saves emit no receipt.
          onFileWritten?.(saved);
          lastSavedTextRef.current = nextValue;
          bumpSavedRevision((n) => n + 1);
          setSavedAt(Date.now());
          if (textRef.current === nextValue) setSaveState(showSaving ? 'saved' : 'idle');
          if (saveOptions.refreshFiles !== false && onFileSaved) {
            void Promise.resolve(onFileSaved()).catch(() => undefined);
          }
        } catch {
          if (textRef.current === nextValue) setSaveState('error');
        } finally {
          saveInFlightRef.current = false;
          const pending = pendingSaveAfterFlightRef.current;
          if (pending) {
            pendingSaveAfterFlightRef.current = null;
            const latest = textRef.current;
            if (latest !== lastSavedTextRef.current) {
              void run(latest, pending);
            } else {
              const showPendingSaving = pending.showSaving !== false;
              if (textRef.current === latest) setSaveState(showPendingSaving ? 'saved' : 'idle');
              if (pending.refreshFiles !== false && onFileSaved) {
                void Promise.resolve(onFileSaved()).catch(() => undefined);
              }
            }
          }
        }
      };
      void run(value, options);
    },
    [file.name, onFileSaved, onFileWritten, projectId, viewerOnly],
  );

  const flushPendingMarkdownSave = useCallback(() => {
    if (viewerOnly) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const latest = textRef.current;
    if (lastSavedTextRef.current !== null && latest !== lastSavedTextRef.current) {
      saveMarkdownText(latest, { refreshFiles: false, showSaving: false });
    }
  }, [saveMarkdownText, viewerOnly]);

  useEffect(() => {
    return () => {
      flushPendingMarkdownSave();
    };
  }, [flushPendingMarkdownSave]);

  useEffect(() => {
    if (text === null) return undefined;
    textRef.current = text;
    if (viewerOnly) return undefined;
    if (text === lastSavedTextRef.current) return undefined;
    setSaveState((current) => current === 'saved' ? 'idle' : current);
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      saveMarkdownText(textRef.current, { refreshFiles: false, showSaving: false });
    }, 700);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [saveMarkdownText, text, viewerOnly]);

  useEffect(() => {
    const root = document.documentElement;
    const bump = () => setHighlightThemeRevision((revision) => revision + 1);
    const observer = new MutationObserver(bump);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', bump);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', bump);
    };
  }, []);

  async function copy() {
    if (text == null) return;
    const didCopy = await copyTextToClipboard(text);
    if (didCopy) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  const insertTextAtSelection = useCallback((insert: string) => {
    setText((current) => {
      if (viewerOnly) return current;
      if (current === null) return current;
      const editor = editorRef.current;
      if (!editor) return `${current}${insert}`;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const next = `${current.slice(0, start)}${insert}${current.slice(end)}`;
      window.requestAnimationFrame(() => {
        const nextCursor = start + insert.length;
        editor.focus();
        editor.setSelectionRange(nextCursor, nextCursor);
      });
      return next;
    });
  }, [viewerOnly]);

  const insertImageFiles = useCallback(
    async (files: File[]): Promise<boolean> => {
      if (viewerOnly) return false;
      const images = files.filter((item) => isMarkdownImageFile(item));
      if (images.length === 0) return false;
      const targetDir = markdownDirectory(file.name);
      const result = await uploadProjectFiles(projectId, images, targetDir);
      if (result.uploaded.length > 0) {
        await onFileSaved?.();
        const snippet = result.uploaded
          .map((item) => {
            const alt = markdownImageAlt(item.name);
            const path = markdownRelativeProjectPath(file.name, item.path);
            return `![${alt}](${path})`;
          })
          .join('\n');
        insertTextAtSelection(`\n${snippet}\n`);
      }
      return true;
    },
    [file.name, insertTextAtSelection, onFileSaved, projectId, viewerOnly],
  );

  function handleEditorPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    if (viewerOnly) return;
    const files = Array.from(event.clipboardData.files ?? []);
    if (!files.some(isMarkdownImageFile)) return;
    event.preventDefault();
    void insertImageFiles(files);
  }

  function handleEditorDrop(event: ReactDragEvent<HTMLTextAreaElement>) {
    if (viewerOnly) return;
    const files = Array.from(event.dataTransfer.files ?? []);
    if (!files.some(isMarkdownImageFile)) return;
    event.preventDefault();
    void insertImageFiles(files);
  }

  // The markdown doc auto-saves on a debounce, so the toolbar shows a passive
  // status (when it last auto-saved) instead of a manual Save button that is
  // disabled almost all the time. Typing stays quiet: the indicator keeps the
  // last auto-saved time and only refreshes once the debounced save lands, so
  // there is no per-keystroke "Saving…" flicker. `saving` is reserved for an
  // explicit, foreground write (the error-retry path).
  const autoSaveStatus: 'error' | 'saving' | 'saved' | 'idle' =
    saveState === 'error'
      ? 'error'
      : saveState === 'saving'
        ? 'saving'
        : savedAt != null
          ? 'saved'
          : 'idle';
  const autoSaveTime =
    savedAt != null
      ? new Date(savedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      : null;
  const autoSaveLabel =
    autoSaveStatus === 'error'
      ? t('fileViewer.markdownSaveFailed')
      : autoSaveStatus === 'saving'
        ? t('fileViewer.markdownSaving')
        : autoSaveStatus === 'saved' && autoSaveTime
          ? t('fileViewer.markdownAutoSaved', { time: autoSaveTime })
          : t('fileViewer.markdownAutoSaveHint');
  const showEditor = mode === 'edit' || mode === 'split';
  const showPreview = mode === 'preview' || mode === 'split';

  const baseHtml = useMemo(() => {
    if (text === null) return null;
    const renderPartial = MarkdownRenderer.renderPartial ?? renderMarkdownToSafeHtml;
    return rewriteMarkdownImageSources(
      decorateMarkdownCodeBlocks(renderPartial(text)),
      projectId,
      file.name
    );
  }, [file.name, projectId, text,]);
  const html = highlightedHtml?.source === baseHtml && highlightedHtml.themeRevision === highlightThemeRevision
    ? highlightedHtml.html
    : baseHtml;
  const markdownBlockLines = useMemo(() => extractMarkdownBlockLines(text ?? ''), [text]);

  // The cached editor block offsets become stale whenever the source text
  // changes (line positions move) — drop them so the next sync remeasures.
  useEffect(() => {
    editorBlockOffsetsRef.current = null;
  }, [text]);

  useEffect(() => {
    if (!baseHtml) {
      setHighlightedHtml(null);
      return undefined;
    }
    let cancelled = false;
    highlightMarkdownCodeBlocks(baseHtml).then((nextHtml) => {
      if (cancelled) return;
      setHighlightedHtml(nextHtml === baseHtml ? null : { source: baseHtml, html: nextHtml, themeRevision: highlightThemeRevision });
    }).catch(() => {
      if (!cancelled) setHighlightedHtml(null);
    });
    return () => {
      cancelled = true;
    };
  }, [baseHtml, highlightThemeRevision]);

  const clearProgrammaticScrollSoon = useCallback(() => {
    if (programmaticScrollClearFrameRef.current) {
      window.cancelAnimationFrame(programmaticScrollClearFrameRef.current);
    }
    programmaticScrollClearFrameRef.current = window.requestAnimationFrame(() => {
      programmaticScrollClearFrameRef.current = window.requestAnimationFrame(() => {
        programmaticScrollRef.current = null;
        programmaticScrollClearFrameRef.current = null;
      });
    });
  }, []);

  const getEditorBlockOffsets = useCallback((): number[] | null => {
    const editor = editorRef.current;
    if (!editor || markdownBlockLines.length === 0) return null;
    const width = editor.clientWidth;
    const cached = editorBlockOffsetsRef.current;
    if (cached && cached.width === width && cached.offsets.length === markdownBlockLines.length) {
      return cached.offsets;
    }
    const offsets = measureEditorBlockOffsets(editor, markdownBlockLines, textRef.current);
    if (!offsets) return null;
    editorBlockOffsetsRef.current = { width, offsets };
    return offsets;
  }, [markdownBlockLines]);

  // Align the panes by matching each top-level markdown block's source line to
  // its rendered element, then interpolating scroll position between those
  // anchors. Falls back to proportional (ratio) sync when block anchors are
  // unavailable (e.g. raw-HTML blocks change the rendered child count).
  const computeMarkdownSyncTarget = useCallback(
    (sourcePane: MarkdownScrollPane, source: HTMLElement, target: HTMLElement): number => {
      const previewPane = markdownPreviewPaneRef.current;
      if (markdownBlockLines.length > 0 && previewPane) {
        const editorOffsets = getEditorBlockOffsets();
        const previewOffsets = editorOffsets
          ? measurePreviewBlockOffsets(previewPane, markdownBlockLines.length)
          : null;
        if (editorOffsets && previewOffsets) {
          const isEditorSource = sourcePane === 'editor';
          const sourceOffsets = isEditorSource ? editorOffsets : previewOffsets;
          const targetOffsets = isEditorSource ? previewOffsets : editorOffsets;
          const sourceAnchors = buildScrollAnchors(sourceOffsets, source.scrollHeight);
          const targetAnchors = buildScrollAnchors(targetOffsets, target.scrollHeight);
          const mapped = mapScrollPosition(source.scrollTop, sourceAnchors, targetAnchors);
          return Math.max(0, Math.min(markdownScrollRange(target), mapped));
        }
      }
      return markdownScrollTopForRatio(target, markdownScrollRatio(source));
    },
    [getEditorBlockOffsets, markdownBlockLines],
  );

  const applyMarkdownScrollSync = useCallback(
    (sourcePane: MarkdownScrollPane, targetPane: MarkdownScrollPane) => {
      const source = sourcePane === 'editor' ? editorRef.current : markdownPreviewPaneRef.current;
      const target = targetPane === 'editor' ? editorRef.current : markdownPreviewPaneRef.current;
      if (mode !== 'split' || !source || !target) return;
      const targetTop = computeMarkdownSyncTarget(sourcePane, source, target);
      if (Math.abs(target.scrollTop - targetTop) < 1) return;
      programmaticScrollRef.current = { pane: targetPane, top: targetTop };
      target.scrollTop = targetTop;
      clearProgrammaticScrollSoon();
    },
    [clearProgrammaticScrollSoon, computeMarkdownSyncTarget, mode],
  );

  const scheduleMarkdownScrollSync = useCallback(
    (sourcePane: MarkdownScrollPane, targetPane: MarkdownScrollPane) => {
      if (mode !== 'split') {
        pendingScrollSyncRef.current = null;
        return;
      }
      pendingScrollSyncRef.current = { sourcePane, targetPane };
      if (scrollSyncFrameRef.current !== null) return;
      scrollSyncFrameRef.current = window.requestAnimationFrame(() => {
        scrollSyncFrameRef.current = null;
        const pending = pendingScrollSyncRef.current;
        pendingScrollSyncRef.current = null;
        if (!pending) return;
        applyMarkdownScrollSync(pending.sourcePane, pending.targetPane);
      });
    },
    [applyMarkdownScrollSync, mode],
  );

  const shouldIgnoreMarkdownScroll = useCallback((pane: MarkdownScrollPane, element: HTMLElement): boolean => {
    const programmatic = programmaticScrollRef.current;
    if (programmatic?.pane !== pane) return false;
    if (Math.abs(element.scrollTop - programmatic.top) > 1 && activeMarkdownScrollPaneRef.current === pane) {
      return false;
    }
    programmaticScrollRef.current = null;
    return true;
  }, []);

  const handleMarkdownEditorScroll = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || shouldIgnoreMarkdownScroll('editor', editor)) return;
    activeMarkdownScrollPaneRef.current = 'editor';
    scheduleMarkdownScrollSync('editor', 'preview');
  }, [scheduleMarkdownScrollSync, shouldIgnoreMarkdownScroll]);

  const handleMarkdownPreviewScroll = useCallback(() => {
    const previewPane = markdownPreviewPaneRef.current;
    if (!previewPane || shouldIgnoreMarkdownScroll('preview', previewPane)) return;
    if (activeMarkdownScrollPaneRef.current !== 'preview') return;
    scheduleMarkdownScrollSync('preview', 'editor');
  }, [scheduleMarkdownScrollSync, shouldIgnoreMarkdownScroll]);

  const activateMarkdownScrollPane = useCallback((pane: MarkdownScrollPane) => {
    activeMarkdownScrollPaneRef.current = pane;
  }, []);

  useEffect(() => {
    const article = markdownArticleRef.current;
    if (!article) return;
    ensureMarkdownCodeBlockControls(article, t);
    if (copiedMarkdownBlockRef.current?.isConnected) {
      setMarkdownCodeBlockCopiedState(copiedMarkdownBlockRef.current, true, t);
    }
  }, [html, t]);

  useEffect(() => {
    if (mode !== 'split') {
      if (scrollSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollSyncFrameRef.current);
        scrollSyncFrameRef.current = null;
      }
      if (programmaticScrollClearFrameRef.current !== null) {
        window.cancelAnimationFrame(programmaticScrollClearFrameRef.current);
        programmaticScrollClearFrameRef.current = null;
      }
      pendingScrollSyncRef.current = null;
      programmaticScrollRef.current = null;
      activeMarkdownScrollPaneRef.current = 'editor';
      previousModeRef.current = mode;
      return;
    }
    const sourcePane = activeMarkdownScrollPaneRef.current ?? (previousModeRef.current === 'preview' ? 'preview' : 'editor');
    const targetPane = sourcePane === 'preview' ? 'editor' : 'preview';
    scheduleMarkdownScrollSync(sourcePane, targetPane);
    previousModeRef.current = mode;
  }, [html, mode, scheduleMarkdownScrollSync]);

  async function handleMarkdownBodyClick(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(`button[${MARKDOWN_COPY_BLOCK_ATTR}]`);
    if (!button) return;
    const block = button.closest('.markdown-code-block');
    if (!(block instanceof HTMLElement)) return;
    const pre = block.querySelector('pre');
    if (!pre) return;
    const didCopy = await copyTextToClipboard((pre.textContent ?? '').replace(/\n$/, ''));
    if (!didCopy) return;
    if (copiedMarkdownBlockRef.current && copiedMarkdownBlockRef.current !== block) {
      setMarkdownCodeBlockCopiedState(copiedMarkdownBlockRef.current, false, t);
    }
    copiedMarkdownBlockRef.current = block;
    setMarkdownCodeBlockCopiedState(block, true, t);
    if (copyBlockTimerRef.current) {
      window.clearTimeout(copyBlockTimerRef.current);
    }
    copyBlockTimerRef.current = window.setTimeout(() => {
      if (copiedMarkdownBlockRef.current) {
        setMarkdownCodeBlockCopiedState(copiedMarkdownBlockRef.current, false, t);
      }
      copiedMarkdownBlockRef.current = null;
      copyBlockTimerRef.current = null;
    }, 1800);
  }

  return (
    <div className="viewer text-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          {isStreaming ? <span className="viewer-meta">{t('fileViewer.markdownStreamingMeta')}</span> : null}
          {isError ? <span className="viewer-meta">{t('fileViewer.markdownErrorMeta')}</span> : null}
          <div className="viewer-tabs markdown-mode-tabs" role="tablist" aria-label={t('fileViewer.markdownViewMode')}>
            {(['edit', 'split', 'preview'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                className={`viewer-tab ${mode === item ? 'active' : ''}`}
                disabled={viewerOnly && item !== 'preview'}
                title={viewerOnly && item !== 'preview' ? viewerOnlyDisabledTitle : undefined}
                onClick={() => setMode(item)}
              >
                {item === 'edit'
                  ? t('fileViewer.source')
                  : item === 'split'
                    ? t('fileViewer.split')
                    : t('fileViewer.preview')}
              </button>
            ))}
          </div>
        </div>
        <div className="viewer-toolbar-actions">
          {viewerOnly ? (
            <span className="viewer-meta markdown-autosave markdown-autosave-idle">
              {viewerOnlyDisabledTitle}
            </span>
          ) : autoSaveStatus === 'error' ? (
            <button
              type="button"
              className="viewer-action markdown-autosave markdown-autosave-error"
              onClick={() => {
                if (text !== null) saveMarkdownText(text);
              }}
              title={t('fileViewer.save')}
            >
              <Icon name="alert-triangle" size={13} />
              <span>{autoSaveLabel}</span>
            </button>
          ) : (
            <span
              className={`viewer-meta markdown-autosave markdown-autosave-${autoSaveStatus}`}
            >
              {autoSaveStatus === 'saving' ? (
                <Icon name="spinner" size={13} className="icon-spin" />
              ) : autoSaveStatus === 'saved' ? (
                <Icon name="check" size={13} />
              ) : null}
              <span>{autoSaveLabel}</span>
            </span>
          )}
          <button
            type="button"
            className="viewer-action"
            onClick={() => void copy()}
            title={t('fileViewer.copyTitle')}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            <span>{copied ? t('fileViewer.copied') : t('fileViewer.copy')}</span>
          </button>
          {text !== null ? (
            <div className="share-menu chrome-share-menu" ref={downloadMenuRef}>
              <button
                type="button"
                className="viewer-action"
                aria-haspopup="menu"
                aria-expanded={downloadMenuOpen}
                disabled={viewerOnly}
                title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                onClick={() => setDownloadMenuOpen((v) => !v)}
              >
                <Icon name="download" size={13} />
                <span>{t('fileViewer.download')}</span>
              </button>
              {downloadMenuOpen ? (
                <div className="share-menu-popover" role="menu">
                  <button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    disabled={viewerOnly}
                    title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                    onClick={() => {
                      if (viewerOnly) return;
                      setDownloadMenuOpen(false);
                      exportAsMd(text, exportTitle);
                    }}
                  >
                    <span className="share-menu-icon"><RemixIcon name="file-line" size={15} /></span>
                    <span>{t('fileViewer.exportMd')}</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className={`viewer-body markdown-workbench markdown-workbench-${mode}`}>
        {text === null || html === null ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : (
          <>
            {showEditor ? (
              <section className="markdown-editor-pane" aria-label={t('fileViewer.markdownEditor')}>
                <textarea
                  ref={editorRef}
                  className="markdown-editor"
                  value={text}
                  aria-label={t('fileViewer.markdownEditor')}
                  placeholder={t('fileViewer.markdownEditorPlaceholder')}
                  spellCheck
                  autoFocus
                  onFocus={() => activateMarkdownScrollPane('editor')}
                  onChange={(event) => {
                    activateMarkdownScrollPane('editor');
                    setText(event.currentTarget.value);
                  }}
                  onScroll={handleMarkdownEditorScroll}
                  onPaste={handleEditorPaste}
                  onDrop={handleEditorDrop}
                />
              </section>
            ) : null}
            {showPreview ? (
              <div className="markdown-preview-pane-wrap">
                <section
                  ref={markdownPreviewPaneRef}
                  className="markdown-preview-pane"
                  aria-label={t('fileViewer.markdownPreview')}
                  onPointerDown={() => activateMarkdownScrollPane('preview')}
                  onWheel={() => activateMarkdownScrollPane('preview')}
                  onTouchStart={() => activateMarkdownScrollPane('preview')}
                  onKeyDown={() => activateMarkdownScrollPane('preview')}
                  onFocus={() => activateMarkdownScrollPane('preview')}
                  onScroll={handleMarkdownPreviewScroll}
                >
                  {isStreaming ? <div className="markdown-status">{t('fileViewer.markdownStreamingStatus')}</div> : null}
                  {isError ? <div className="markdown-status markdown-status-error">{t('fileViewer.markdownErrorStatus')}</div> : null}
                  {/* Safe by contract: renderMarkdownToSafeHtml escapes raw HTML and rejects unsafe link protocols. */}
                  <article
                    ref={markdownArticleRef}
                    className="markdown-rendered"
                    onClick={(event) => void handleMarkdownBodyClick(event)}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                </section>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function isMarkdownImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
}

function markdownImageAlt(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'image';
}

function CodeWithLines({ text, navigation }: { text: string; navigation?: { line: number; nonce: number } | null }) {
  const lines = text.split('\n');
  const activeLine = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (navigation) activeLine.current?.scrollIntoView?.({ block: 'center' });
  }, [text, navigation?.line, navigation?.nonce]);
  // Trailing newline produces a phantom empty line — keep gutter aligned.
  const gutter = lines.map((_, i) => `${i + 1}`).join('\n');
  return (
    <pre className="code-viewer">
      <code className="gutter" aria-hidden>
        {gutter}
      </code>
      <code className="lines">{navigation ? lines.map((line, index) => <span key={index}
        ref={index + 1 === navigation.line ? activeLine : undefined} data-source-line={index + 1}
        data-highlighted={index + 1 === navigation.line} className={sourceLineStyles.line}>
        {line}{index < lines.length - 1 ? '\n' : ''}
      </span>) : text}</code>
    </pre>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function documentMetaLabel(file: ProjectFile, t: TranslateFn): string {
  if (file.kind === 'pdf') return t('fileViewer.pdfMeta');
  if (file.kind === 'document') return t('fileViewer.documentMeta');
  if (file.kind === 'presentation') return t('fileViewer.presentationMeta');
  if (file.kind === 'spreadsheet') return t('fileViewer.spreadsheetMeta');
  return t('fileViewer.binaryMeta', { size: humanSize(file.size) });
}

function hasSeenExportReadyNudge(projectId: string, fileName: string): boolean {
  try {
    return window.sessionStorage.getItem(exportReadyNudgeKey(projectId, fileName)) === '1';
  } catch {
    return false;
  }
}

function markExportReadyNudgeSeen(projectId: string, fileName: string) {
  try {
    window.sessionStorage.setItem(exportReadyNudgeKey(projectId, fileName), '1');
  } catch {
    // Ignore storage-denied contexts; the in-memory state still prevents loops.
  }
}

function exportReadyNudgeKey(projectId: string, fileName: string): string {
  return `${EXPORT_READY_NUDGE_STORAGE_PREFIX}${projectId}:${fileName}`;
}
