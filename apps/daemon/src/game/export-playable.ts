/**
 * A built web game as one HTML file that plays offline, opened straight from disk.
 *
 * Chromium refuses module scripts, `fetch` and XHR for files next to a page opened
 * from `file://`, so a build folder's index.html is blank there (2026-11-10 beginner
 * audit). Everything therefore goes inside the one page:
 *   - the game's scripts are inlined, still as modules when they were;
 *   - stylesheets and the page's own src/href references become data URIs;
 *   - every other built file is embedded, and a small loader that runs first answers
 *     the game's run-time requests for them (XHR, fetch, image, audio and worker URLs)
 *     with blob URLs, which a file:// page may load.
 * A game split into several script files is refused: an inline module cannot import a
 * sibling file under file://. The usual Vite build of a starter is one script.
 */
import type { GameExportErrorCode } from '@openpixo/contracts';
import { findRealTagEnd, findRealTagOffset, HTML_TAG_PATTERNS, prependAfterDoctype } from '@openpixo/contracts/runtime/html-injection-points';

export class GameExportError extends Error {
  constructor(readonly code: GameExportErrorCode, message: string) { super(message); }
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  ico: 'image/x-icon', bmp: 'image/bmp', json: 'application/json', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain',
  xml: 'application/xml', csv: 'text/csv', wasm: 'application/wasm', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
  bin: 'application/octet-stream', fnt: 'text/plain', atlas: 'text/plain', tmx: 'application/xml', tsx: 'application/xml',
};

export function mimeForPath(relative: string): string {
  return MIME[relative.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** A page reference as a key of `files`, or null when it points outside the build. */
function localKey(reference: string, files: ReadonlyMap<string, Buffer>, from = ''): string | null {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu.test(reference)) return null;
  const clean = reference.replace(/[?#].*$/u, '');
  let decoded: string;
  try { decoded = decodeURIComponent(clean); } catch { return null; }
  const parts: string[] = decoded.startsWith('/') ? [] : from.split('/').filter(Boolean);
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(part);
  }
  const key = parts.join('/');
  return files.has(key) ? key : null;
}

function dataUri(key: string, files: ReadonlyMap<string, Buffer>): string {
  return `data:${mimeForPath(key)};base64,${files.get(key)!.toString('base64')}`;
}

/** Inline code must not end its own script element. */
function inlineScriptText(code: string): string {
  return code.replace(/<\/(script)/giu, '<\\/$1');
}

const LOCAL_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'`]((?:\.{1,2})?\/[^"'`\s]+?\.m?js)["'`]/gu;

function attribute(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu').exec(tag)?.slice(1).find(value => value !== undefined) ?? null;
}

function dirOf(key: string): string {
  return key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
}

/**
 * The loader that runs before the game. Kept as source text so the page carries
 * no dependency; `F` maps a build-relative path to [mime, base64].
 */
const LOADER = `(()=>{const F=__FILES__;const U={};
const base=location.href.replace(/[#?].*$/,'').replace(/[^/]*$/,'');
const drive=/^file:\\/\\/\\/[A-Za-z]:\\//;
const key=(u)=>{try{let s=String(u);if(/^(blob|data):/i.test(s))return null;s=new URL(s,base).href.replace(/[#?].*$/,'');
let r=null;if(s.startsWith(base))r=s.slice(base.length);else if(s.startsWith('file:///'))r=s.replace(drive,'').replace(/^file:\\/\\/\\//,'');else if(s.startsWith(location.origin+'/'))r=s.slice(location.origin.length+1);
if(r===null)return null;r=decodeURIComponent(r);return F[r]?r:null}catch{return null}};
const url=(u)=>{const k=key(u);if(!k)return u;if(!U[k]){const b=atob(F[k][1]);const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);U[k]=URL.createObjectURL(new Blob([a],{type:F[k][0]}))}return U[k]};
const o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...r){return o.call(this,m,url(u),...r)};
const f=window.fetch;window.fetch=(i,init)=>f(typeof i==='string'||i instanceof URL?url(i):i instanceof Request?new Request(url(i.url),i):i,init);
for(const [C,p] of [[HTMLImageElement,'src'],[HTMLMediaElement,'src'],[HTMLSourceElement,'src'],[HTMLLinkElement,'href'],[HTMLScriptElement,'src']]){const d=Object.getOwnPropertyDescriptor(C.prototype,p);if(d&&d.set)Object.defineProperty(C.prototype,p,{...d,set(v){d.set.call(this,url(v))}})}
const sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){return sa.call(this,n,/^(src|href)$/i.test(n)?url(v):v)};
const A=window.Audio;if(A){const P=function(s){return s===undefined?new A():new A(url(s))};P.prototype=A.prototype;window.Audio=P}
const W=window.Worker;if(W){window.Worker=class extends W{constructor(u,o){super(url(u),o)}}}
})();`;

export interface PlayableHtml { html: string; embedded: number }

export function buildPlayableHtml(indexHtml: string, files: ReadonlyMap<string, Buffer>): PlayableHtml {
  const inlined = new Set<string>();
  const atEnd: string[] = [];
  let html = indexHtml;

  // Scripts the page loads from the build become inline scripts.
  html = html.replace(/<script\b([^>]*)>\s*<\/script>/giu, (whole, attrs: string) => {
    const src = attribute(whole, 'src');
    const key = src ? localKey(src, files) : null;
    if (!key) return whole;
    const code = files.get(key)!.toString('utf8');
    const module = /\btype\s*=\s*["']?module/iu.test(attrs);
    if (module) {
      for (const match of code.matchAll(LOCAL_IMPORT)) {
        if (localKey(match[1]!, files, dirOf(key))) {
          throw new GameExportError('GAME_EXPORT_SPLIT_SCRIPTS',
            'This game is built as several script files, and a single offline file can only hold one. Ask the agent to build it as one script (for Vite: no dynamic imports, or build.rollupOptions.output.inlineDynamicImports), then export again.');
        }
      }
    }
    inlined.add(key);
    const element = `<script${module ? ' type="module"' : ''}>${inlineScriptText(code)}</script>`;
    // An inline classic script runs where it stands; a deferred one expected the whole page.
    if (!module && /\s(defer|async)\b/iu.test(attrs)) { atEnd.push(element); return ''; }
    return element;
  });
  if (atEnd.length) {
    // The real `</body>`: inlined game code may well contain the string.
    const bodyClose = findRealTagOffset(html, HTML_TAG_PATTERNS.bodyClose);
    const moved = `${atEnd.join('\n')}\n`;
    html = bodyClose < 0 ? `${html}\n${moved}` : `${html.slice(0, bodyClose)}${moved}${html.slice(bodyClose)}`;
  }

  // Preload hints point at files that are now inline.
  html = html.replace(/<link\b[^>]*\brel\s*=\s*["']?modulepreload["']?[^>]*>/giu, '');

  // Stylesheets become <style>, with their own url() references embedded.
  html = html.replace(/<link\b[^>]*>/giu, tag => {
    if (!/\brel\s*=\s*["']?stylesheet/iu.test(tag)) return tag;
    const href = attribute(tag, 'href');
    const key = href ? localKey(href, files) : null;
    if (!key) return tag;
    inlined.add(key);
    const css = files.get(key)!.toString('utf8').replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/giu, (whole, _quote: string, ref: string) => {
      const target = localKey(ref, files, dirOf(key));
      return target ? `url(${dataUri(target, files)})` : whole;
    });
    return `<style>${css.replace(/<\/(style)/giu, '<\\/$1')}</style>`;
  });

  // The page's own static references (icons, images, audio) as data URIs.
  html = html.replace(/(\s(?:src|href|poster)\s*=\s*)(["'])([^"']+)\2/giu, (whole, prefix: string, quote: string, ref: string) => {
    const key = localKey(ref, files);
    return key ? `${prefix}${quote}${dataUri(key, files)}${quote}` : whole;
  });
  html = html.replace(/\scrossorigin(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=[\s>])/giu, '');

  // Everything else is served at run time by the loader, which runs first.
  const embedded: Record<string, [string, string]> = {};
  for (const [key, bytes] of files) {
    if (key === 'index.html' || inlined.has(key)) continue;
    embedded[key] = [mimeForPath(key), bytes.toString('base64')];
  }
  const loader = `<script>${LOADER.replace('__FILES__', () => JSON.stringify(embedded).replace(/</gu, '\\u003c'))}</script>`;
  const headEnd = findRealTagEnd(html, HTML_TAG_PATTERNS.headOpen);
  html = headEnd < 0 ? prependAfterDoctype(html, `${loader}\n`) : `${html.slice(0, headEnd)}\n${loader}${html.slice(headEnd)}`;
  return { html, embedded: Object.keys(embedded).length };
}
