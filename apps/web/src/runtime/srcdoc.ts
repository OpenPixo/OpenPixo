import { buildPreviewStorageBridge } from './preview-storage';
import { injectMotionSourcePlayer, markMotionHostedPreview } from '@openpixo/contracts/runtime/motion-source-player';
import {
  buildPreviewBaseHrefBridge,
  buildPreviewObservabilityBridge,
} from '@openpixo/contracts/runtime/preview-observability';
import {
  buildPreviewVisibilityGuard,
  buildPreviewSandboxShim,
  PREVIEW_REDIRECT_GUARD_MAX_HOPS,
  PREVIEW_REDIRECT_GUARD_SELF_REFRESH_MIN_DELAY_MS,
  PREVIEW_REDIRECT_GUARD_WINDOW_MS,
  PREVIEW_REDIRECT_LOOP_MESSAGE,
} from '@openpixo/contracts/runtime/preview-guards';

import { findRealElementRange, findRealTagEnd, findRealTagOffset, HTML_TAG_PATTERNS, prependAfterDoctype } from '@openpixo/contracts/runtime/html-injection-points';

export {
  PREVIEW_REDIRECT_GUARD_MAX_HOPS,
  PREVIEW_REDIRECT_GUARD_SELF_REFRESH_MIN_DELAY_MS,
  PREVIEW_REDIRECT_GUARD_WINDOW_MS,
  PREVIEW_REDIRECT_LOOP_MESSAGE,
} from '@openpixo/contracts/runtime/preview-guards';
import { isApprovedFontStylesheetHref } from './preview-fonts';

export type SrcdocOptions = {
  /** Host-scoped local progress, seeded before authored scripts by the lazy shell. */
  previewStorage?: boolean;
  previewStorageSeed?: { generation: string; values: Record<string, string> };
  /** Live embedded motion preview only; do not enable for exports/captures. */
  motionPreview?: boolean;
  baseHref?: string;
  previewFocusGuard?: boolean;
  /** Install the live-preview error and white-screen reporting bridge. Keep
   * this disabled for exports, captures, thumbnails, and historical previews. */
  previewObservability?: boolean;
  /** Let trusted font-CDN stylesheets load without blocking the live preview's
   * first paint. Keep disabled for exports and other capture surfaces. */
  deferFontStylesheets?: boolean;
  /**
   * Force every CSS animation/transition to complete instantly so the
   * document settles at its final visual state and stops repainting. Meant
   * for static miniatures: a looping animation in
   * N thumbnail iframes otherwise keeps N compositor layers rasterizing
   * forever.
   */
  freezeMotion?: boolean;
  /** Monotonically-increasing reload counter. When provided, it is embedded as
   * a `data-pixo-reload-key` attribute on `<html>` so that the srcdoc string
   * differs across reloads even when the underlying HTML bytes are identical.
   * This guarantees that the iframe's `srcdoc` attribute is updated in the DOM
   * and the browser re-parses the document (issue #4650). */
  reloadKey?: number;
  /** Document-owned identity for preview content-size reports. The host rejects
   * reports from a previous srcdoc document even if it echoed a newer request. */
  previewMeasurementEpoch?: string;
  /** Identity of this exact srcdoc artifact generation. The injected bridge
   * echoes it only after all document-side listeners are installed, allowing
   * the host to reject a stale ready signal from the document being replaced. */
  transportActivationGeneration?: string;
};

// --- Redirect-loop guard -------------------------------------------------
//
// A generated (or hand-edited) artifact can carry a self-redirecting "script"
// — most reliably a `<meta http-equiv="refresh">` that reloads the same
// document, or a chain of meta refreshes that cycles (A → B → A → …). In the
// preview iframe that redirect fires forever, pegging the main thread until the
// whole design workspace freezes (inherited issue #710). buildSrcdoc always
// injects `injectPreviewRedirectGuard`, an in-iframe circuit breaker that:
//
//   1. counts meta-refresh navigations across reloads (persisted in
//      `window.name`, the one store that survives an iframe navigating itself),
//   2. resets that count once a full window passes with no further refresh, so
//      a slow, legitimate auto-refresh never accumulates (the timeout half of
//      the safeguard), and
//   3. once the count crosses `PREVIEW_REDIRECT_GUARD_MAX_HOPS` inside the
//      window — or immediately for a near-instant self-refresh, which can only
//      loop in a static preview — strips the offending `<meta>` and posts
//      `PREVIEW_REDIRECT_LOOP_MESSAGE` to the host so it can park the iframe.
//
// The message is the reliable stop: the browser makes `window.location`
// unforgeable, so a JS `location.reload()` storm can only be halted host-side
// by swapping the iframe to static content (see FileViewer). The in-iframe half
// still fully covers the canonical meta-refresh redirect loop on its own.

export interface RedirectGuardState {
  /** Meta-refresh navigations counted in the current window. */
  hops: number;
  /** Timestamp (ms) the current window started at. */
  windowStart: number;
}

/**
 * Pure hop-accounting used by the injected guard (and exercised directly in
 * tests). Given the previous state (or `null` on the first refresh) and the
 * current time, return the next state and whether the hop budget is now
 * exceeded. The window resets whenever more than `windowMs` has elapsed since
 * it started, so only a tight burst of refreshes accumulates toward the cap.
 */
export function nextRedirectGuardState(
  prev: RedirectGuardState | null,
  now: number,
  opts: { maxHops?: number; windowMs?: number } = {},
): { state: RedirectGuardState; tripped: boolean } {
  const maxHops = opts.maxHops ?? PREVIEW_REDIRECT_GUARD_MAX_HOPS;
  const windowMs = opts.windowMs ?? PREVIEW_REDIRECT_GUARD_WINDOW_MS;
  const withinWindow =
    prev != null &&
    Number.isFinite(prev.windowStart) &&
    now - prev.windowStart <= windowMs;
  const windowStart = withinWindow ? prev!.windowStart : now;
  const hops = (withinWindow ? prev!.hops : 0) + 1;
  return { state: { hops, windowStart }, tripped: hops > maxHops };
}

/**
 * A static, self-contained document the host swaps into the preview iframe once
 * a redirect loop is detected. It carries no meta refresh and no script, so it
 * ends the loop the moment it loads; the user re-runs the artifact with the
 * viewer's existing reload control.
 */
export function buildRedirectLoopBlockedDoc(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { height: 100%; margin: 0; }
      body {
        display: flex; align-items: center; justify-content: center;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        background: #0d1117; color: #e6edf3; text-align: center; padding: 24px;
      }
      .card { max-width: 420px; }
      h1 { font-size: 15px; font-weight: 600; margin: 0 0 8px; }
      p { font-size: 13px; line-height: 1.5; margin: 0; color: #9ba7b4; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Preview stopped: redirect loop detected</h1>
      <p>This document kept redirecting to itself, which would freeze the
      preview. Reload the preview to try again.</p>
    </div>
  </body>
</html>`;
}

/**
 * Sanitize a document title string so the resulting PDF filename is accepted by
 * Microsoft Teams. Teams rejects filenames that contain any of:
 *   : # % & * { } \ < > ? / + | "
 * as well as leading/trailing spaces and the prefix sequence "~$".
 *
 * Each disallowed character (or run of disallowed characters) is replaced with
 * a single hyphen. The result is trimmed of leading and trailing whitespace.
 * Titles that are already safe pass through unchanged.
 *
 * Invariant: the returned string contains none of the Teams-disallowed
 * characters and has no leading or trailing spaces, and does not start
 * with the ~$ prefix.
 */
export function sanitizePreviewTitle(text: string): string {
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
 * A small set of common named non-ASCII entities that appear in real-world
 * titles (e.g. &ccedil; → ç, &eacute; → é). Keeping this narrow avoids
 * shipping a full HTML entity table while still preventing the "orphaned
 * name;" garbage that results when & is stripped before entity detection.
 * Characters produced here that are Teams-disallowed get cleaned up by the
 * subsequent sanitizePreviewTitle pass.
 */
const NAMED_ENTITY_MAP: Record<string, string> = {
  // Latin-1 letters most likely to appear in design/business titles
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
  // Common punctuation / symbols that can appear in business document titles
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', hellip: '…', trade: '™', reg: '®',
  copy: '©', deg: '°', euro: '€', pound: '£', yen: '¥',
};

/**
 * Safe wrapper around String.fromCodePoint that returns U+FFFD for
 * out-of-range values instead of throwing RangeError.
 */
function safeFromCodePoint(cp: number): string {
  if (cp < 0 || cp > 0x10ffff) return '�';
  return String.fromCodePoint(cp);
}

/**
 * Decode the minimal HTML entities that browsers render in <title> text:
 * &amp; → & , &lt; → < , &gt; → > , &quot; → " , &apos; → ' , &#N; / &#xN;
 * Also decodes a small set of common named non-ASCII entities (e.g. &ccedil;)
 * so they do not leave orphaned "name;" fragments after the & is sanitized.
 * Numeric entities with out-of-range code points fall back to U+FFFD instead
 * of throwing RangeError.
 */
function decodeHtmlEntitiesForTitle(encoded: string): string {
  return encoded
    // Named non-ASCII entities first — before the standard 5 named entities
    // below, so &amp; still converts to & (not left as a lookup miss).
    .replace(/&([A-Za-z]+);/g, (match, name: string) => NAMED_ENTITY_MAP[name] ?? match)
    // Standard 5 named entities.
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    // Numeric entities — range-checked to avoid RangeError on huge code points.
    .replace(/&#(\d+);/g, (_, n: string) => safeFromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeFromCodePoint(parseInt(h, 16)));
}


/**
 * Rewrite the <title> element in an HTML string so its text content is
 * Teams-filename-safe. Only the real `<title>` in the `<head>` region is
 * changed — `<title>` occurrences inside HTML comments, `<script>` blocks,
 * or `<style>` blocks are left untouched.
 *
 * Strategy:
 *   1. Locate the `<head>`…`</head>` region (or the area before `<body>`).
 *   2. Within that region, scan past comments and script/style blocks to find
 *      the first unambiguous `<title>` start tag.
 *   3. Decode HTML entities in its text, sanitize, and splice back.
 *
 * Pure string operations — no DOMParser — so it works identically in Node
 * test environments and in the browser.
 *
 * @public — exported for daemon-side URL-load title sanitization.
 */
export function sanitizeTitleInDoc(html: string): string {
  // Only the head's own <title> names the document; an <svg><title> in the body
  // is an accessible label for that graphic. Bound the search to the head
  // region, located structurally so a </head> or <body> an author wrote into a
  // script string cannot move the boundary.
  const headClose = findRealTagOffset(html, HTML_TAG_PATTERNS.headClose);
  const bodyOpen = findRealTagOffset(html, HTML_TAG_PATTERNS.bodyOpen);
  const searchLimit = headClose >= 0 ? headClose : bodyOpen >= 0 ? bodyOpen : html.length;

  // Both ends by the parser's rules: the open tag through `endOfTag`, so a `>`
  // inside a quoted attribute cannot cut it short, and the close by the
  // raw-text rule, so `</title >` and `</title\n>` close it while
  // `</title-page>` does not. `indexOf('</title>')` accepted one spelling, and
  // the next `</title>` in a later script string became the rewrite range.
  const range = findRealElementRange(html, HTML_TAG_PATTERNS.titleOpen, 'title');
  if (!range || range.start >= searchLimit) return html;

  const titleStart = range.start;
  const closingTagEnd = range.end - 1;
  const openTag = html.slice(range.start, range.contentStart);
  const rawContent = html.slice(range.contentStart, range.contentEnd);
  const closeTag = html.slice(range.contentEnd, range.end);

  const decoded = decodeHtmlEntitiesForTitle(rawContent);
  const safe = sanitizePreviewTitle(decoded);

  return html.slice(0, titleStart) + openTag + safe + closeTag + html.slice(closingTagEnd + 1);
}

export function buildSrcdoc(
  html: string,
  options: SrcdocOptions = {}
): string {
  const head = html.trimStart().slice(0, 64).toLowerCase();
  const isFullDoc = head.startsWith("<!doctype") || head.startsWith("<html");
  const wrapped = isFullDoc
    ? html
    : normalizeHtmlFragmentLikeNavigation(html);
  // Sanitize <title> text before any other transformation so that when the
  // user prints the preview iframe (Cmd+P → Save as PDF), Chromium uses the
  // sanitized title as the default filename — one that Microsoft Teams will
  // accept. Only the title text changes; visible page content is untouched.
  const motionSource = options.motionPreview && !options.freezeMotion ? markMotionHostedPreview(wrapped) : wrapped;
  const withSafeTitle = sanitizeTitleInDoc(options.freezeMotion ? motionSource : injectMotionSourcePlayer(motionSource));
  const withVisibilityGuard = injectAfterHeadOpen(withSafeTitle, buildPreviewVisibilityGuard());

  const withBase = options.baseHref ? injectBaseHref(withVisibilityGuard, options.baseHref) : withVisibilityGuard;
  const withPreviewBaseBridge = options.baseHref
    ? injectPreviewBaseHrefBridge(withBase)
    : withBase;
  const withDeferredFonts = options.deferFontStylesheets
    ? deferTrustedFontStylesheets(withPreviewBaseBridge)
    : withPreviewBaseBridge;
  const withShim = injectSandboxShim(withDeferredFonts, options.previewStorage, options.previewStorageSeed);
  const blockLoadTimeScriptRedirect = htmlHasLoadTimeLocationNavigation(withPreviewBaseBridge);
  // Always on: a redirect loop can freeze ANY previewed artifact, and the guard
  // is inert on documents that never self-redirect. Injected right after the
  // sandbox shim so it is installed before any author script or meta refresh.
  const withRedirectGuard = injectPreviewRedirectGuard(withShim, { blockLoadTimeScriptRedirect });
  // Runtime errors stay in the iframe's Window and never bubble to the host.
  // Live previews opt in so exports and other off-screen srcdoc consumers do
  // not emit diagnostics that no host observer is prepared to consume.
  const withObservability = options.previewObservability
    ? injectAfterHeadOpen(withRedirectGuard, buildPreviewObservabilityBridge())
    : withRedirectGuard;
  const withTransport = injectSrcdocTransportActivationBridge(
    injectExportCaptureBridge(injectSnapshotBridge(injectPreviewContentSizeBridge(
      options.freezeMotion ? injectMotionFreeze(options.previewFocusGuard ? injectPreviewFocusGuard(withObservability) : withObservability) : options.previewFocusGuard ? injectPreviewFocusGuard(withObservability) : withObservability,
      options.previewMeasurementEpoch ?? '',
    ))),
    options.transportActivationGeneration ?? '',
  );
  // Embed the reload counter so the srcdoc string differs across reloads even
  // when the underlying HTML bytes are identical.  This ensures the browser
  // sees a changed `srcdoc` attribute and re-parses the document (issue #4650).
  return options.reloadKey !== undefined
    ? withTransport.replace(/(<html\b)([^>]*>)/i, `$1 data-pixo-reload-key="${options.reloadKey}"$2`)
    : withTransport;
}

/**
 * Give fragment-shaped artifacts the same document structure and compat mode
 * they receive when Chromium navigates directly to the raw URL.
 *
 * Wrapping every fragment in a standards-mode `<body>` changes two observable
 * browser behaviours:
 *   - a source without a doctype switches from URL-load quirks mode to srcDoc
 *     standards mode; and
 *   - leading metadata such as `<title>`, `<link>`, and `<style>` becomes a
 *     body child. Runtime-state handoff later replaces `body.innerHTML`, which
 *     deletes those authored styles and leaves Edit visibly unstyled.
 *
 * DOMParser applies the same tree-builder rules as a document navigation: it
 * synthesizes html/head/body, promotes leading metadata into head, and retains
 * the absence of a doctype. In non-DOM environments, leaving the fragment
 * untouched lets the eventual iframe parser perform that normalization.
 */
function normalizeHtmlFragmentLikeNavigation(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  try {
    return serializeHtmlDocument(new DOMParser().parseFromString(html, 'text/html'));
  } catch {
    return html;
  }
}

/**
 * Build the lazy transport shell.
 *
 * The shell does two things:
 *   1. Register a listener for `pixo:srcdoc-transport-activate` that replaces
 *      its own document with the real artifact HTML.
 *   2. Post `pixo:srcdoc-transport-ready` to the parent as soon as the listener
 *      is installed. This `ready` signal is the only reliable way for the
 *      host to know the listener is live; without it, the host risks posting
 *      `activate` before the iframe's script has executed (e.g. right after a
 *      key-driven re-mount), in which case the message is dropped and the
 *      iframe stays stuck on the empty shell. See #2253.
 */
export function buildLazySrcdocTransport(options: { quirksMode?: boolean } = {}): string {
  const doctype = options.quirksMode ? '' : '<!doctype html>\n';
  return `${doctype}<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script data-pixo-lazy-srcdoc-transport>(function(){
      var readyInterval = null;
      var readyAttempts = 0;
      function stopReadyAnnouncements(){
        if (readyInterval !== null && typeof clearInterval === 'function') {
          clearInterval(readyInterval);
        }
        readyInterval = null;
      }
      function announceReady(){
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'pixo:srcdoc-transport-ready' }, '*');
          }
        } catch (_) { /* sandboxed parent — host falls back to onLoad */ }
      }
      function handleTransportMessage(ev){
        if (ev.source !== window.parent) return;
        var data = ev && ev.data;
        if (data && data.type === 'pixo:srcdoc-transport-shell-probe') {
          announceReady();
          return;
        }
        if (!data || data.type !== 'pixo:srcdoc-transport-activate' || typeof data.html !== 'string' || typeof data.generation !== 'string' || !data.generation) return;
        stopReadyAnnouncements();
        if (typeof window.removeEventListener === 'function') {
          window.removeEventListener('message', handleTransportMessage);
        }
        document.open();
        window.__pixoPreviewStorageSeed = data.previewStorage
          ? { generation: data.generation, values: data.previewStorage }
          : null;
        document.write(data.html);
        document.close();
      }
      window.addEventListener('message', handleTransportMessage);
      announceReady();
      // A cached app-lifetime Blob can finish long before React attaches the
      // parent's listener. Keep announcing until activation instead of
      // guessing a host-mount delay; cap the retries so a broken host cannot
      // leave a background timer running forever. The host's probe remains a
      // recovery path after this ten-second window.
      if (window.parent && window.parent !== window && typeof setInterval === 'function') {
        readyInterval = setInterval(function(){
          announceReady();
          readyAttempts += 1;
          if (readyAttempts >= 100) stopReadyAnnouncements();
        }, 100);
      }
    })();</script>
  </head>
  <body></body>
</html>`;
}

export interface SrcDocActivationInputs {
  /** The real artifact HTML the host wants to inject into the shell. */
  srcDoc: string;
  /** Host is currently showing the URL-loaded iframe (srcDoc iframe is hidden). */
  useUrlLoadPreview: boolean;
  /** Host's render pipeline is routing through the lazy transport shell. */
  useLazySrcDocTransport: boolean;
  /** The shell document has loaded AND posted `pixo:srcdoc-transport-ready`. */
  shellReady: boolean;
  /** Which artifact HTML has already been pushed into this shell (dedupe). */
  activatedHtml: string | null;
}

/**
 * Pure decision for whether the host should now post
 * `pixo:srcdoc-transport-activate` to the shell iframe.
 *
 * Gating on `shellReady` is the fix for #2253: without it, an activation
 * triggered by `useUrlLoadPreview` flipping to false (e.g. opening the
 * preview controls) can fire while the iframe's shell script has not yet
 * registered its message listener. The message is dropped, the shell stays
 * on its empty 536-byte body, and the dedupe check then suppresses the
 * follow-up activation from the iframe's onLoad path.
 */
export function canActivateSrcDocTransport(state: SrcDocActivationInputs): boolean {
  if (!state.srcDoc) return false;
  if (state.useUrlLoadPreview) return false;
  if (!state.useLazySrcDocTransport) return false;
  if (!state.shellReady) return false;
  if (state.activatedHtml === state.srcDoc) return false;
  return true;
}

function injectSrcdocTransportActivationBridge(doc: string, generation: string): string {
  const encodedGeneration = JSON.stringify(generation);
  const markerGeneration = generation
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const script = `<script data-pixo-srcdoc-transport-activation>(function(){
  var generation = ${encodedGeneration};
  var bodyComplete = false;
  function containsCompletionMarker(node){
    if (!node || node.nodeType !== 1) return false;
    if (node.tagName === 'TEMPLATE' && node.getAttribute('data-pixo-srcdoc-transport-body-complete') === generation) return true;
    var candidates = node.querySelectorAll ? node.querySelectorAll('template[data-pixo-srcdoc-transport-body-complete]') : [];
    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i].getAttribute('data-pixo-srcdoc-transport-body-complete') === generation) return true;
    }
    return false;
  }
  var completionObserver = typeof MutationObserver === 'function' ? new MutationObserver(function(records){
    if (bodyComplete) return;
    for (var i = 0; i < records.length; i += 1) {
      var added = records[i].addedNodes || [];
      for (var j = 0; j < added.length; j += 1) {
        if (!containsCompletionMarker(added[j])) continue;
        bodyComplete = true;
        completionObserver.disconnect();
        return;
      }
    }
  }) : null;
  if (completionObserver && document.documentElement) {
    completionObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  function announceReady(probeId){
    if (!generation) return;
    try {
      if (window.parent && window.parent !== window) {
        var message = { type: 'pixo:srcdoc-transport-activated', generation: generation };
        if (typeof probeId === 'string' && probeId) message.probeId = probeId;
        message.bodyComplete = bodyComplete;
        message.documentReadyState = document.readyState;
        message.bodyPresent = !!document.body;
        message.bodyChildCount = document.body ? document.body.children.length : 0;
        message.documentElementChildCount = document.documentElement ? document.documentElement.children.length : 0;
        window.parent.postMessage(message, '*');
      }
    } catch (_) { /* sandboxed parent */ }
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (data && data.type === 'pixo:srcdoc-transport-ready-probe') {
      if (data.generation === generation) announceReady(data.probeId);
      return;
    }
    if (!data || data.type !== 'pixo:srcdoc-transport-activate' || typeof data.html !== 'string' || typeof data.generation !== 'string' || !data.generation) return;
    // document.open/write keeps the current Window realm. Re-running an
    // authored classic script there can fail before execution when it declares
    // a top-level let/const that the previous document already declared. Ask
    // the host to remount the shared bootstrap so this generation gets a fresh
    // realm, then let the one-shot shell perform the initial write.
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'pixo:srcdoc-transport-reset-required',
          generation: data.generation
        }, '*');
      }
    } catch (_) { /* sandboxed parent — host recovery will remount on timeout */ }
  });
  announceReady();
})();</script>`;
  // Install the activation witness before authored styles/scripts. A srcDoc
  // navigation can otherwise be healthy but spend seconds in a blocking
  // external script before reaching a body-end bridge, which makes the host's
  // missing-ACK recovery indistinguishable from a genuinely aborted
  // `about:srcdoc` navigation. Placing the bridge first also runs it before an
  // authored meta CSP can disable later inline scripts.
  // The generation-specific inert tail marker distinguishes a fully parsed artifact from the
  // half-document Chromium can leave behind after aborting about:srcdoc. The
  // head bridge latches its insertion permanently, so later authored DOM
  // replacement cannot erase the parser witness. A template is inert and
  // remains compatible with authored CSPs.
  const bodyCompleteMarker = `<template data-pixo-srcdoc-transport-body-complete="${markerGeneration}"></template>`;
  return injectBeforeBodyEnd(injectAfterHeadOpen(doc, script), bodyCompleteMarker);
}

function injectSnapshotBridge(doc: string): string {
  const script = `<script data-pixo-snapshot-bridge>(function(){
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
      if (computed && (computed.display === 'none' || computed.visibility === 'hidden')) {
        removals.push(clone);
      }
    }
    for (var r = removals.length - 1; r >= 0; r--){
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
  // After painting, sample the canvas: a uniform (single-color) bitmap means
  // the foreignObject rasterizer painted nothing — Chromium frequently refuses
  // to paint <foreignObject> HTML loaded via <img>. Treating that as an honest
  // 'empty-render' error (instead of shipping the background-only frame) lets
  // the host fall back / surface a real failure rather than a silent black PNG.
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
  // Rasterize the current view (or the whole document, when opts.full) via an
  // SVG <foreignObject>. Returns a Promise so it can be reused by both the
  // pixo:snapshot message handler AND the export-capture bridge (image export /
  // PDF) — the foreignObject path is fast and never blocks on external
  // image network loads the way a DOM-cloning rasterizer does.
  function captureSnapshot(opts){
    opts = opts || {};
    return new Promise(function(resolve, reject){
      var w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
      var h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
      var dpr = window.devicePixelRatio || 1;
      var bgColor = snapshotBackgroundColor();
      var docW = Math.max(w, document.documentElement.scrollWidth || 0, document.body ? document.body.scrollWidth : 0);
      var docH = Math.max(h, document.documentElement.scrollHeight || 0, document.body ? document.body.scrollHeight : 0);
      var full = !!opts.full;
      var capW = full ? docW : w;
      var capH = full ? docH : h;
      var clone = document.documentElement.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      inlineSnapshotStyles(document.documentElement, clone);
      pruneHiddenSnapshotNodes(document.documentElement, clone);
      stripSnapshotResources(clone);
      var scroll = full ? { x: 0, y: 0 } : scrollOffset();
      var cloneBody = clone.querySelector('body');
      var rootStyle = clone.getAttribute('style') || '';
      var bodyStyle = cloneBody ? cloneBody.getAttribute('style') || '' : '';
      var bodyContent = serializeSnapshotXhtml(cloneBody || clone);
      var wrapperStyle = rootStyle + bodyStyle +
        'margin:0;position:relative;left:' + (-scroll.x) + 'px;top:' + (-scroll.y) + 'px;' +
        'width:' + docW + 'px;height:' + docH + 'px;overflow:visible;';
      var html = '<div xmlns="http://www.w3.org/1999/xhtml" style="' + escapeAttribute(wrapperStyle) + '">' + bodyContent + '</div>';
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + capW + '" height="' + capH + '" viewBox="0 0 ' + capW + ' ' + capH + '">' +
        '<foreignObject x="0" y="0" width="' + docW + '" height="' + docH + '">' +
        html +
        '</foreignObject></svg>';
      var img = new Image();
      img.onload = function(){
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(capW * dpr));
          canvas.height = Math.max(1, Math.floor(capH * dpr));
          var ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          ctx.scale(dpr, dpr);
          // Opaque base so a transparent (un-painted) raster never flattens to
          // pure black in clipboards / PNG viewers.
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, capW, capH);
          ctx.drawImage(img, 0, 0, capW, capH);
          if (canvasLooksBlank(ctx, canvas.width, canvas.height)) {
            reject(new Error('empty-render'));
            return;
          }
          resolve({ dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err && err.message || err)));
        }
      };
      img.onerror = function(){ reject(new Error('snapshot image failed')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  // Exposed so the export-capture bridge (same document) can reuse this renderer.
  window.__pixoCaptureSnapshot = function(opts){
    return waitForImages().then(function(){ return captureSnapshot(opts || {}); });
  };
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'pixo:snapshot' || !data.id) return;
    window.__pixoCaptureSnapshot({ full: !!data.full }).then(function(res){
      window.parent.postMessage({ type: 'pixo:snapshot:result', id: String(data.id), dataUrl: res.dataUrl, w: res.w, h: res.h }, '*');
    }, function(err){
      window.parent.postMessage({ type: 'pixo:snapshot:result', id: String(data.id), error: String(err && err.message || err) }, '*');
    });
  });
})();</script>`;
  return injectBeforeBodyEnd(doc, script);
}

function injectPreviewContentSizeBridge(doc: string, documentEpoch: string): string {
  const serializedDocumentEpoch = JSON.stringify(documentEpoch).replace(/</g, '\\u003c');
  const script = `<script data-pixo-preview-content-size-bridge>(function(){
  if (window.__pixoPreviewContentSizeBridge) return;
  window.__pixoPreviewContentSizeBridge = true;
  var pending = false;
  var lastRequest = null;
  var documentEpoch = ${serializedDocumentEpoch};
  function measure(){
    var root = document.documentElement;
    var body = document.body || root;
    if (!root) return null;
    var scrollValues = [
      root.scrollWidth,
      body && body.scrollWidth,
    ];
    var clientValues = [
      root.clientWidth,
      body && body.clientWidth
    ];
    var scrollWidth = 0;
    var clientWidth = 0;
    for (var i = 0; i < scrollValues.length; i += 1) {
      var nextScroll = Number(scrollValues[i] || 0);
      if (Number.isFinite(nextScroll) && nextScroll > scrollWidth) scrollWidth = nextScroll;
    }
    for (var j = 0; j < clientValues.length; j += 1) {
      var nextClient = Number(clientValues[j] || 0);
      if (Number.isFinite(nextClient) && nextClient > clientWidth) clientWidth = nextClient;
    }
    return {
      scrollWidth: scrollWidth > 0 ? Math.ceil(scrollWidth) : null,
      clientWidth: clientWidth > 0 ? Math.ceil(clientWidth) : null
    };
  }
  function post(){
    if (!lastRequest) return;
    var size = measure();
    try {
      window.parent.postMessage({
        type: 'pixo:preview-content-size',
        measurementId: lastRequest.measurementId,
        generation: lastRequest.generation,
        documentEpoch: documentEpoch,
        scrollWidth: size && size.scrollWidth,
        clientWidth: size && size.clientWidth
      }, '*');
    } catch (_) {}
  }
  function schedule(){
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function(){
      pending = false;
      post();
    });
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'pixo:preview-content-size-request') return;
    if (typeof data.measurementId !== 'string' || typeof data.generation !== 'string') return;
    lastRequest = {
      measurementId: data.measurementId,
      generation: data.generation
    };
    schedule();
  });
  window.addEventListener('resize', schedule);
  if (typeof ResizeObserver !== 'undefined') {
    try {
      var observer = new ResizeObserver(schedule);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    } catch (_) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    setTimeout(schedule, 0);
  }
  setTimeout(schedule, 80);
  setTimeout(schedule, 260);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(schedule).catch(function(){});
  }
})();</script>`;
  return injectBeforeBodyEnd(doc, script);
}

// Export-capture bridge: the in-iframe half of the programmatic PDF /
// image exporters (apps/web/src/runtime/exports.ts). The preview iframe is
// sandbox="allow-scripts" WITHOUT allow-same-origin, so the host cannot read
// iframe.contentDocument — capture must run inside the frame, exactly like the
// snapshot bridge above. The orchestrator (host) creates a hidden, full-
// resolution export iframe, posts `pixo:export-capture`, and assembles the
// returned per-slide images with jsPDF.
//
// Protocol:
//   in:  { type:'pixo:export-capture', id, mode:'image', deck:boolean,
//          single?:boolean, delay:number }
//   out: { type:'pixo:export-capture:slide', id, index, total,
//          dataUrl, w, h, notes }   (one per slide)
//   out: { type:'pixo:export-capture:done',  id, total }
//   out: { type:'pixo:export-capture:error', id, error }
//
function injectExportCaptureBridge(doc: string): string {
  const script = `<script data-pixo-export-capture-bridge>(function(){
  function raf(){ return new Promise(function(r){ requestAnimationFrame(function(){ r(); }); }); }
  function settle(){
    var fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready.catch(function(){}) : Promise.resolve();
    var imgs = Promise.all(Array.prototype.slice.call(document.images||[]).map(function(img){
      if (img.complete) return Promise.resolve();
      return new Promise(function(r){ img.addEventListener('load', r, {once:true}); img.addEventListener('error', r, {once:true}); });
    }));
    return Promise.all([fonts, imgs]).then(raf).then(raf);
  }
  function send(msg){ try { window.parent.postMessage(msg, '*'); } catch(_){} }
  function run(req){
    var id = req.id;
    settle().then(function(){
      if (typeof window.__pixoCaptureSnapshot !== 'function') throw new Error('snapshot renderer unavailable');
      return window.__pixoCaptureSnapshot({ full: true });
    }).then(function(img){
      send({ type:'pixo:export-capture:slide', id:id, index:0, total:1, dataUrl:img.dataUrl, w:img.w, h:img.h, notes:'' });
      send({ type:'pixo:export-capture:done', id:id, total:1 });
    }).catch(function(err){
      send({ type:'pixo:export-capture:error', id:id, error:String(err && err.message || err) });
    });
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'pixo:export-capture' || !data.id) return;
    run(data);
  });
})();</script>`;
  return injectBeforeBodyEnd(doc, script);
}

function serializeHtmlDocument(doc: Document): string {
  const doctype = doc.doctype ? '<!doctype html>\n' : '';
  return `${doctype}${doc.documentElement.outerHTML}`;
}

const DEFERRED_FONT_STYLESHEET_ATTR = 'data-pixo-deferred-font-stylesheet';

function deferTrustedFontStylesheets(doc: string): string {
  if (typeof DOMParser === 'undefined') return doc;
  let parsed: Document;
  try {
    parsed = new DOMParser().parseFromString(doc, 'text/html');
  } catch {
    return doc;
  }

  let deferred = false;
  parsed.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]').forEach((link) => {
    const href = link.getAttribute('href') ?? '';
    if (!isApprovedFontStylesheetHref(href)) return;
    const authoredMedia = link.getAttribute('media')?.trim() ?? '';
    if (authoredMedia.toLowerCase() === 'print') return;
    link.setAttribute(DEFERRED_FONT_STYLESHEET_ATTR, authoredMedia);
    link.setAttribute('media', 'print');
    deferred = true;
  });
  if (!deferred) return doc;

  const script = `<script data-pixo-font-stylesheet-loader>(function(){
  var attr = '${DEFERRED_FONT_STYLESHEET_ATTR}';
  var selector = 'link[' + attr + ']';
  function activate(link){
    if (!link || !link.hasAttribute(attr)) return;
    var media = link.getAttribute(attr) || 'all';
    link.setAttribute('media', media);
    link.removeAttribute(attr);
  }
  function watch(link){
    if (!link || link.__pixoFontStylesheetWatched) return;
    link.__pixoFontStylesheetWatched = true;
    link.addEventListener('load', function(){ activate(link); }, { once: true });
    try { if (link.sheet) activate(link); } catch (_) {}
  }
  function scan(root){
    if (!root) return;
    if (root.matches && root.matches(selector)) watch(root);
    var links = root.querySelectorAll ? root.querySelectorAll(selector) : [];
    for (var i = 0; i < links.length; i += 1) watch(links[i]);
  }
  var observer = typeof MutationObserver === 'function' ? new MutationObserver(function(records){
    for (var i = 0; i < records.length; i += 1) {
      var added = records[i].addedNodes || [];
      for (var j = 0; j < added.length; j += 1) scan(added[j]);
    }
  }) : null;
  if (observer && document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
})();</script>`;
  return injectAfterHeadOpen(serializeHtmlDocument(parsed), script);
}

/**
 * Install a bridge as early as the document allows: inside `<head>` when there
 * is one, otherwise at the top of `<body>`, otherwise ahead of the whole
 * document. Guards that must beat every authored script share this — it is the
 * one place that decides "as early as possible".
 *
 * The boundaries are located structurally (see `findRealTagEnd`), so a `<head>`
 * or `<body>` an author wrote into a script string or an attribute is not
 * mistaken for this document's own (inherited issue #7410).
 */
function injectAtDocumentStart(doc: string, payload: string): string {
  const headEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.headOpen);
  if (headEnd >= 0) return doc.slice(0, headEnd) + payload + doc.slice(headEnd);
  const bodyEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.bodyOpen);
  if (bodyEnd >= 0) return doc.slice(0, bodyEnd) + payload + doc.slice(bodyEnd);
  return payload + doc;
}

function injectAfterHeadOpen(doc: string, payload: string): string {
  const headEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.headOpen);
  if (headEnd >= 0) return doc.slice(0, headEnd) + payload + doc.slice(headEnd);
  const htmlEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.htmlOpen);
  if (htmlEnd >= 0) return `${doc.slice(0, htmlEnd)}<head>${payload}</head>${doc.slice(htmlEnd)}`;
  return prependAfterDoctype(doc, payload);
}

function injectBeforeHeadEnd(doc: string, payload: string): string {
  // String-first: a plain splice before the real </head> (or after <head…>) is
  // correct for well-formed documents and avoids a full DOMParser parse +
  // re-serialize. Every bridge calls this, so the parse path was the dominant
  // srcdoc-build cost; DOMParser is now only the fallback for head-less
  // fragments where we can't locate an insertion point textually. Find the real
  // </head> (last one before <body>) to skip </head> literals in <script>/<style>.
  const idx = findRealTagOffset(doc, HTML_TAG_PATTERNS.headClose);
  if (idx >= 0) return doc.slice(0, idx) + payload + doc.slice(idx);
  const headEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.headOpen);
  if (headEnd >= 0) return doc.slice(0, headEnd) + payload + doc.slice(headEnd);
  // No recognizable <head>: let DOMParser normalize (it synthesizes a head).
  if (typeof DOMParser !== 'undefined') {
    try {
      const parsed = new DOMParser().parseFromString(doc, 'text/html');
      if (parsed.head) parsed.head.append(parsed.createRange().createContextualFragment(payload));
      return serializeHtmlDocument(parsed);
    } catch { /* fall through to prepend */ }
  }
  return payload + doc;
}

function injectBeforeBodyEnd(doc: string, payload: string): string {
  // String-first (see injectBeforeHeadEnd). Find the real </body> (last one
  // before </html>) to skip </body> literals inside <script>/<style>.
  const idx = findRealTagOffset(doc, HTML_TAG_PATTERNS.bodyClose);
  if (idx >= 0) return doc.slice(0, idx) + payload + doc.slice(idx);
  // No recognizable </body>: let DOMParser normalize (it synthesizes a body).
  if (typeof DOMParser !== 'undefined') {
    try {
      const parsed = new DOMParser().parseFromString(doc, 'text/html');
      if (parsed.body) parsed.body.append(parsed.createRange().createContextualFragment(payload));
      return serializeHtmlDocument(parsed);
    } catch { /* fall through to append */ }
  }
  return doc + payload;
}

export function htmlHasAuthoredBase(doc: string): boolean {
  return findRealTagOffset(doc, HTML_TAG_PATTERNS.baseOpen) >= 0;
}

function injectBaseHref(doc: string, baseHref: string): string {
  if (htmlHasAuthoredBase(doc)) return doc;
  const safeHref = escapeAttr(baseHref);
  const tag = `<base href="${safeHref}" data-pixo-project-preview-base>`;
  const headEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.headOpen);
  if (headEnd >= 0) return doc.slice(0, headEnd) + tag + doc.slice(headEnd);
  const htmlEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.htmlOpen);
  if (htmlEnd >= 0) return `${doc.slice(0, htmlEnd)}<head>${tag}</head>${doc.slice(htmlEnd)}`;
  return tag + doc;
}

function injectPreviewBaseHrefBridge(doc: string): string {
  return injectAfterHeadOpen(doc, buildPreviewBaseHrefBridge());
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Sandboxed iframes (we use `sandbox="allow-scripts"`) without
// `allow-same-origin` raise a SecurityError on first `localStorage` /
// `sessionStorage` access. Many freeform-generated decks call
// `localStorage.getItem(...)` at the top of their IIFE without a
// try/catch — when it throws, the whole script aborts and the deck
// becomes a static, unnavigable preview. We install a same-origin
// in-memory shim BEFORE any user script runs so those decks degrade
// gracefully. Live host previews may additionally seed isolated local progress;
// exports and unhosted documents retain the in-memory fallback.
// allow-popups and allow-popups-to-escape-sandbox are needed for
// links with target="_blank" to work in the sandboxed preview.
// Empty hrefs return to the top; element anchors scroll into view.
// Hash routers keep their same-document route and browser history.
function injectSandboxShim(doc: string, persistStorage = false, seed?: SrcdocOptions['previewStorageSeed']): string {
  const seedScript = persistStorage && seed
    ? `<script>window.__pixoPreviewStorageSeed=${JSON.stringify(seed).replace(/</g, '\\u003c')};</script>`
    : '';
  return injectAtDocumentStart(doc, buildPreviewSandboxShim() + seedScript + (persistStorage ? buildPreviewStorageBridge() : ''));
}

function injectPreviewFocusGuard(doc: string): string {
  const script = `<script data-pixo-preview-focus-guard>(function(){
  var lastTrustedInputAt = 0;
  function userActivated(){
    return Date.now() - lastTrustedInputAt < 1000;
  }
  function markTrustedInput(event){
    if (event && event.isTrusted) lastTrustedInputAt = Date.now();
  }
  document.addEventListener('pointerdown', function(event){
    markTrustedInput(event);
  }, true);
  document.addEventListener('keydown', function(event){
    markTrustedInput(event);
  }, true);
  try {
    var nativeWindowFocus = window.focus && window.focus.bind(window);
    Object.defineProperty(window, 'focus', {
      configurable: true,
      writable: true,
      value: function(){
        if (userActivated() && nativeWindowFocus) return nativeWindowFocus();
      }
    });
  } catch (_) {}
  try {
    var nativeElementFocus = HTMLElement.prototype.focus;
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      configurable: true,
      writable: true,
      value: function(options){
        if (userActivated()) return nativeElementFocus.call(this, options);
      }
    });
  } catch (_) {}
})();</script>`;
  return injectAtDocumentStart(doc, script);
}

// In-iframe redirect-loop circuit breaker. See the "Redirect-loop guard"
// section near the top of this file for the full rationale. The script mirrors
// `nextRedirectGuardState` for the hop accounting; both must stay in sync (the
// constants are interpolated so they never drift). It reads/writes `window.name`
// because that is the only per-context store that survives the iframe navigating
// itself, and it runs its check on DOMContentLoaded so the author's `<meta>`
// tags (parsed after this head script) are already in the DOM.
function htmlHasLoadTimeLocationNavigation(source: string): boolean {
  if (/\blocation\s*\.\s*(?:reload|replace|assign)\s*\(/i.test(source)) return true;
  if (/\blocation\s*\.\s*href\s*=[^=]/i.test(source)) return true;
  if (/\b(?:window|document|self|top|parent)\s*\.\s*location\s*=[^=]/i.test(source)) return true;
  return false;
}

function injectPreviewRedirectGuard(
  doc: string,
  opts: { blockLoadTimeScriptRedirect?: boolean } = {},
): string {
  const script = `<script data-pixo-preview-redirect-guard>(function(){
  var NAME_PREFIX = '__pixoRedirectGuard=';
  var MAX_HOPS = ${PREVIEW_REDIRECT_GUARD_MAX_HOPS};
  var WINDOW_MS = ${PREVIEW_REDIRECT_GUARD_WINDOW_MS};
  var SELF_MIN_DELAY_MS = ${PREVIEW_REDIRECT_GUARD_SELF_REFRESH_MIN_DELAY_MS};
  var MESSAGE_TYPE = ${JSON.stringify(PREVIEW_REDIRECT_LOOP_MESSAGE)};
  var BLOCK_LOAD_TIME_SCRIPT_REDIRECT = ${opts.blockLoadTimeScriptRedirect ? 'true' : 'false'};
  function nowMs(){ try { return Date.now(); } catch (_) { return 0; } }
  function readState(){
    try {
      var raw = window.name;
      if (typeof raw === 'string' && raw.indexOf(NAME_PREFIX) === 0) {
        var parsed = JSON.parse(raw.slice(NAME_PREFIX.length));
        if (parsed && typeof parsed.hops === 'number' && typeof parsed.windowStart === 'number') return parsed;
      }
    } catch (_) {}
    return null;
  }
  function writeState(state){
    try { window.name = NAME_PREFIX + JSON.stringify({ hops: state.hops, windowStart: state.windowStart }); } catch (_) {}
  }
  function clearState(){
    try { if (typeof window.name === 'string' && window.name.indexOf(NAME_PREFIX) === 0) window.name = ''; } catch (_) {}
  }
  function nextState(){
    var t = nowMs();
    var prev = readState();
    var withinWindow = prev && (t - prev.windowStart) <= WINDOW_MS;
    return { hops: (withinWindow ? prev.hops : 0) + 1, windowStart: withinWindow ? prev.windowStart : t };
  }
  function scheduleCandidateReset(state){
    try {
      if (typeof setTimeout !== 'function') return;
      setTimeout(function(){
        try {
          var current = readState();
          if (current && current.hops === state.hops && current.windowStart === state.windowStart) clearState();
        } catch (_) {}
      }, WINDOW_MS + 1);
    } catch (_) {}
  }
  function recordScriptRedirectCandidate(){
    if (!BLOCK_LOAD_TIME_SCRIPT_REDIRECT) return;
    var state = nextState();
    if (state.hops > MAX_HOPS) {
      clearState();
      report(state.hops);
      return;
    }
    writeState(state);
    scheduleCandidateReset(state);
  }
  function metaRefreshes(){
    var out = [];
    try {
      var metas = document.getElementsByTagName('meta');
      for (var i = 0; i < metas.length; i++) {
        var equiv = metas[i].getAttribute ? metas[i].getAttribute('http-equiv') : null;
        if (equiv && String(equiv).toLowerCase() === 'refresh') out.push(metas[i]);
      }
    } catch (_) {}
    return out;
  }
  function parseContent(meta){
    var content = '';
    try { content = String(meta.getAttribute('content') || ''); } catch (_) {}
    var delayMatch = content.match(/^\\s*([0-9]+(?:\\.[0-9]+)?)/);
    var delayMs = delayMatch ? Math.round(parseFloat(delayMatch[1]) * 1000) : 0;
    var urlMatch = content.match(/[;,]\\s*url\\s*=\\s*['"]?\\s*([^'"\\s]+)/i);
    return { delayMs: delayMs, url: urlMatch ? urlMatch[1] : '' };
  }
  function currentArtifactHref(){
    try {
      var href = String(location.href || '');
      if (href === 'about:srcdoc') {
        return String(document.baseURI || href);
      }
      return href;
    } catch (_) {
      return '';
    }
  }
  function isSelfTarget(url){
    if (!url) return true; // no url => refresh the current document
    try {
      var base = (document.baseURI) || location.href;
      return new URL(url, base).href === currentArtifactHref();
    } catch (_) { return false; }
  }
  function isFastSrcdocUrlHop(parsed){
    if (!parsed.url || parsed.delayMs > SELF_MIN_DELAY_MS) return false;
    try { return String(location.href || '') === 'about:srcdoc'; } catch (_) { return false; }
  }
  function neutralize(metas){
    for (var i = 0; i < metas.length; i++) {
      try { metas[i].parentNode && metas[i].parentNode.removeChild(metas[i]); } catch (_) {}
    }
    try { if (window.stop) window.stop(); } catch (_) {}
  }
  function report(hops){
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: MESSAGE_TYPE, hops: hops }, '*');
      }
    } catch (_) {}
  }
  function evaluate(){
    var metas = metaRefreshes();
    if (!metas.length) {
      // No refresh directive: this document breaks any accumulating chain.
      if (!BLOCK_LOAD_TIME_SCRIPT_REDIRECT) clearState();
      return;
    }
    var selfLoop = false;
    for (var i = 0; i < metas.length; i++) {
      var parsed = parseContent(metas[i]);
      if (parsed.delayMs <= SELF_MIN_DELAY_MS && isSelfTarget(parsed.url)) { selfLoop = true; break; }
      if (isFastSrcdocUrlHop(parsed)) { selfLoop = true; break; }
    }
    var state = nextState();
    if (selfLoop || state.hops > MAX_HOPS) {
      neutralize(metas);
      clearState();
      report(state.hops);
      return;
    }
    writeState(state);
  }
  recordScriptRedirectCandidate();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', evaluate);
  } else {
    evaluate();
  }
})();</script>`;
  return injectAtDocumentStart(doc, script);
}

export const PREVIEW_MOTION_FREEZE_CSS = `*, *::before, *::after {
  animation-duration: 0.001s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}`;

function injectMotionFreeze(doc: string): string {
  return injectBeforeHeadEnd(doc, `<style data-pixo-motion-freeze>
${PREVIEW_MOTION_FREEZE_CSS}
</style>`);
}
