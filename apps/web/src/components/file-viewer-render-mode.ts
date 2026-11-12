/**
 * Decide between two HTML preview render strategies in FileViewer:
 *
 *   - URL-load: <iframe src="/api/projects/:id/raw/:file"> — the browser
 *     fetches each <script src> / <link href> as its own request. Source
 *     maps work, DevTools shows real filenames, per-asset HTTP caching
 *     applies, and a single broken file no longer takes down the whole
 *     iframe. This is the right default for multi-file artifacts (e.g.
 *     React prototypes that ship dozens of `.jsx` files).
 *
 *   - srcDoc inline: build a self-contained document (via buildSrcdoc),
 *     optionally with relative assets concatenated in by inlineRelative-
 *     Assets, and pass it via the iframe's srcDoc attribute. Used for project asset rewriting, local interactions and passive guards;
 *     also available as an explicit opt-in for self-contained previews.
 *
 * The two helpers below isolate the decision so it's directly unit-
 * testable without dragging the whole FileViewer React tree into a
 * jsdom harness.
 */

export interface UrlLoadDecision {
  /** Whether the viewer is showing the rendered preview vs. the raw source. */
  mode: 'preview' | 'source';
  /** User explicitly opted into the inline path via ?forceInline=1. */
  forceInline: boolean;
  /** The artifact needs the opaque-origin Web Storage/history sandbox shim. */
  needsSandboxShim?: boolean;
  /** Local forms/hash routers require the current client interaction bridge. */
  needsLocalInteractionBridge?: boolean;
  /** The daemon-served URL response includes the sandbox shim. */
  urlSandboxGuard?: boolean;
  /**
   * The source references project files by site-root path (`/assets/x.css`),
   * confirmed against the project's file list (see
   * `file-viewer-preview-assets.ts`). URL-load resolves those against the app
   * origin root and 404s; only the srcDoc pipeline rewrites them into
   * resolvable asset URLs.
   */
  projectRootAssetRefs?: boolean;
  /**
   * The HTML source contains patterns that steal focus on load (e.g.
   * `window.focus()`, `element.focus()`). When true, forces the srcDoc path
   * so `injectPreviewFocusGuard` can suppress the focus grab.
   */
  needsFocusGuard?: boolean;
  /** The daemon-served URL response includes the focus guard. */
  urlFocusGuard?: boolean;
  /**
   * The HTML source contains a self-redirecting directive (a
   * `<meta http-equiv="refresh">`, or a load-time `location` navigation /
   * `location.reload()`) that can loop forever and freeze the preview. When
   * true, forces the srcDoc path so `injectPreviewRedirectGuard` (injected by
   * buildSrcdoc) is present to detect and break the loop.
   */
  needsRedirectGuard?: boolean;
  /** The daemon-served URL response includes the redirect-loop guard. */
  urlRedirectGuard?: boolean;
}

/**
 * Returns true when an HTML file's preview iframe should load directly
 * from its raw URL (via `<iframe src=...>`) rather than through the
 * srcDoc inline path. Pure function — caller is responsible for the
 * non-HTML / source-mode early returns.
 */
export function shouldUrlLoadHtmlPreview(d: UrlLoadDecision): boolean {
  if (d.mode !== 'preview') return false;
  if (d.forceInline) return false;
  if (d.needsLocalInteractionBridge) return false;
  if (d.needsSandboxShim && !d.urlSandboxGuard) return false;
  if (d.needsFocusGuard && !d.urlFocusGuard) return false;
  // A self-redirecting document needs the redirect-loop guard on whichever
  // transport owns the document, or the iframe can reload itself forever
  // (inherited issue #710).
  if (d.needsRedirectGuard && !d.urlRedirectGuard) return false;
  // Root-relative project asset refs only resolve after the srcDoc pipeline
  // normalizes them (normalizeRootRelativeProjectAssetRefs); the URL-load
  // path serves the document untouched and the browser 404s each asset.
  if (d.projectRootAssetRefs) return false;
  return true;
}

/**
 * Read the `forceInline` opt-out from a URL search string or an existing
 * URLSearchParams. Accepts `1`, `true`, `yes`, `on` (case-insensitive).
 * Anything else — including `0`, `false`, an unrelated value, or a
 * missing parameter — returns false.
 */
export function parseForceInline(search: string | URLSearchParams | null | undefined): boolean {
  if (!search) return false;
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const value = params.get('forceInline');
  if (value === null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * Return true when the HTML source may call `.focus()` at load time, which
 * would steal focus from the host page in a URL-loaded iframe. The daemon URL
 * response or srcDoc path injects `injectPreviewFocusGuard` to suppress this.
 *
 * Detection covers two cases:
 *
 *   1. Inline `.focus(` calls and `autofocus` attributes — directly visible
 *      in the document source.
 *   2. External `<script src=...>` references — we cannot inspect the linked
 *      file's content, so we conservatively assume it may call focus.
 *
 * False positives add a passive focus guard, which is the safe direction.
 */
export function htmlNeedsFocusGuard(source: string): boolean {
  if (/\.\s*focus\s*\(/i.test(source)) return true;
  if (/\bautofocus\b/i.test(source)) return true;
  if (/<script\b[^>]*\bsrc\s*=/i.test(source)) return true;
  return false;
}

/**
 * Return true when the HTML source shows hallmarks of a real GPU/compute app
 * that the default opaque-origin preview sandbox cannot run correctly: it
 * needs same-origin Web Workers, real Web Storage, WASM, or SharedArrayBuffer
 * (cross-origin isolation). These are the WebGL/Worker artifacts from issue
 * #724 — Gaussian-splat viewers, ffmpeg.wasm, threaded renderers.
 *
 * When true, FileViewer routes the artifact through the "powered preview"
 * path (a cross-origin-isolated iframe with allow-same-origin) instead of the
 * opaque sandbox. Plain single-canvas WebGL1 demos are intentionally NOT
 * matched — they already run fine under the default sandbox, and powered mode
 * carries a (documented, opt-in) larger trust surface, so we only escalate for
 * artifacts that genuinely need it.
 *
 * Pure string scan over the same `source` already fetched for preview. False
 * positives just take the powered path (still correct, slightly larger trust
 * surface); false negatives keep the current opaque-sandbox behavior.
 */
export function htmlNeedsPoweredPreview(source: string | null | undefined): boolean {
  if (!source) return false;
  // Web Storage stays in srcDoc: the host restores localStorage within the
  // workspace/member/project/file scope; sessionStorage remains document-local.
  // Hard requirement — SharedArrayBuffer only exists in a crossOriginIsolated
  // document, which ONLY the powered path provides.
  if (/\bSharedArrayBuffer\b/.test(source)) return true;
  // Web Workers / SharedWorker: external-file workers throw SecurityError at an
  // opaque origin; even blob workers commonly pair with storage/WASM here.
  if (/\bnew\s+(?:Worker|SharedWorker)\s*\(/.test(source)) return true;
  if (/\bimportScripts\s*\(/.test(source)) return true;
  // WASM streaming instantiation reads a same-origin .wasm the opaque origin
  // cannot fetch; and threaded WASM needs SAB.
  if (/\bWebAssembly\s*\.\s*(?:instantiateStreaming|compileStreaming)\b/.test(source)) return true;
  if (/\.wasm\b/.test(source)) return true;
  // WebGL2 / OffscreenCanvas / WebGPU — the modern rendering stack these
  // artifacts drive, usually from a worker.
  if (/getContext\s*\(\s*["'`]webgl2["'`]/.test(source)) return true;
  if (/\bOffscreenCanvas\b/.test(source)) return true;
  if (/\bnavigator\s*\.\s*gpu\b/.test(source)) return true;
  return false;
}

export function htmlNeedsLocalInteractionBridge(source: string): boolean {
  return /<form\b/i.test(source) || /\bhref\s*=\s*["']#(?:\/|!)/i.test(source);
}

export function htmlNeedsSandboxShim(source: string): boolean {
  // Quote-optional: HTML5 permits unquoted attribute values
  // (`<script type=text/babel src=app.jsx>`). The trailing `\b` rejects
  // same-prefix word continuations like `text/babelish`. Hyphenated variants
  // (`text/babel-other`) still match because `\b` treats `-` as a non-word
  // boundary, but that's a harmless false positive — srcDoc fallback is
  // the safe direction. Tightening to a `(?=[\s>"'])` lookahead would also
  // reject hyphenated variants if a real case ever surfaces.
  if (/<script\s[^>]*\btype\s*=\s*["']?text\/babel\b/i.test(source)) return true;
  if (/\b(?:local|session)Storage\b/.test(source)) return true;
  // External `<script ... src=...>` — see issue #2361. `\s[^>]*?` requires at
  // least one whitespace after `<script` (so we don't match `<scripts>`-like
  // text or self-closing-ish edge cases) and stays non-greedy to keep the
  // search bounded to the tag itself. Lazy match avoids spilling into
  // unrelated `src=` attributes on later tags in the same document.
  if (/<script\s[^>]*?\bsrc\s*=/i.test(source)) return true;
  return false;
}

/**
 * Return true when the HTML source contains a self-redirecting directive that
 * can loop forever and freeze the preview iframe (inherited issue #710).
 * When true, FileViewer requires `injectPreviewRedirectGuard` on whichever
 * transport owns the document so the loop can be detected and broken.
 *
 * Detection covers the two families that produce the freeze:
 *
 *   1. `<meta http-equiv="refresh">` — the canonical HTML redirect; a
 *      self-target or a cycle reloads the frame endlessly.
 *   2. Inline load-time `location` navigation — `location.reload()`,
 *      `location.replace(...)`, `location.assign(...)`, or assigning
 *      `location`/`location.href`/`window.location`. Any of these run at parse
 *      time can re-navigate the frame in a loop. A redirect hidden exclusively
 *      in an external script is not statically visible to this source scan.
 *
 * Pure string scan over the same `source` already fetched for preview — no
 * extra I/O. Heuristic by design: a false positive adds a passive guard; a
 * false negative is the same unguarded preview as before.
 */
export function htmlNeedsRedirectGuard(source: string | null | undefined): boolean {
  if (!source) return false;
  // <meta http-equiv="refresh" ...> in any attribute order / quoting.
  if (/<meta\b[^>]*\bhttp-equiv\s*=\s*["']?\s*refresh\b/i.test(source)) return true;
  // location.reload() / location.replace(...) / location.assign(...).
  if (/\blocation\s*\.\s*(?:reload|replace|assign)\s*\(/i.test(source)) return true;
  // location.href = ...  (an assignment, not a read — `=` not followed by `=`).
  if (/\blocation\s*\.\s*href\s*=[^=]/i.test(source)) return true;
  // window.location = ... / document.location = ... / self|top|parent.location = ...
  if (/\b(?:window|document|self|top|parent)\s*\.\s*location\s*=[^=]/i.test(source)) return true;
  return false;
}
