import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import nodeModule from 'node:module';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { findRealTagEnd, HTML_TAG_PATTERNS, prependAfterDoctype } from '@openpixo/contracts/runtime/html-injection-points';
import { isLoopbackHostname, normalizeLocalAuthority } from '../http/local-daemon-request.js';
import { mimeForPath } from './export-playable.js';
import type { InstantPackages } from './templates.js';

const EVENTS_PATH = '/@openpixo/events';
const PACKAGES_PATH = '/@openpixo/packages/';
/** Where Vite looks for a path as the page asks for it: the public folder, the game, then a module's left-out extension. */
const LOOKUPS = [(file: string) => `public/${file}`, (file: string) => file, (file: string) => `${file}.ts`, (file: string) => `${file}.js`];
const RELOAD_DELAY_MS = 100;
const WARM_UP_MS = 30_000;
const WARM_UP_REQUESTS = 100;

/**
 * In the page before anything of the game's: a change to a file it loaded reloads it, as
 * Vite's own page does. A page that plays is not touched when the dev server is ready; one
 * that failed to load something only the dev server understands tries again there.
 */
const PAGE_SCRIPT = `(() => {
  let broken = false;
  addEventListener('error', () => { broken = true; }, true);
  const events = new EventSource(${JSON.stringify(EVENTS_PATH)});
  events.addEventListener('changed', () => location.reload());
  events.addEventListener('ready', () => { if (broken) location.reload(); });
})();`;

export interface InstantServer {
  readonly url: string;
  readonly handedOver: boolean;
  /** Sends every later load of the page to the dev server. The page on screen keeps playing. */
  handOver(devServerUrl: string): void;
  close(): Promise<void>;
}

/**
 * Whether this game can play on the packages its template ships: a plain Vite page that
 * needs nothing else at run time. Build tools do not count, since nothing is built.
 */
export async function playsBeforeInstall(cwd: string, packages: InstantPackages): Promise<boolean> {
  try {
    const files = await readdir(cwd);
    if (!files.includes('index.html') || files.some(file => /^vite\.config\./u.test(file))) return false;
    const manifest = JSON.parse((await readFile(path.join(cwd, 'package.json'), 'utf8')).replace(/^﻿/u, '')) as { dependencies?: Record<string, unknown> };
    return Object.entries(manifest.dependencies ?? {}).every(([name, version]) => Object.hasOwn(packages, name) && packages[name]!.version === version);
  } catch { return false; }
}

/**
 * Plays a game from its own source files while its packages are still being installed:
 * the few things Vite does for such a game (types removed, `?raw`, extensions and the
 * public folder), with the shipped packages in place of `node_modules`. It answers this
 * computer only, reads nothing outside the game and nothing hidden in it.
 */
export async function startInstantServer({ root: folder, packages, watch, log }: {
  root: string;
  packages: InstantPackages;
  /** Calls back with the game's changed files, relative to `root` with `/`. */
  watch: (onChange: (file: string) => void) => () => unknown;
  log: (line: string) => void;
}): Promise<InstantServer> {
  const root = await realpath(folder);
  const loaded = new Set<string>();
  const pages = new Set<ServerResponse>();
  let devServer: string | null = null;
  let reload: ReturnType<typeof setTimeout> | undefined;

  const announce = (event: 'changed' | 'ready') => { for (const page of pages) page.write(`event: ${event}\ndata: 1\n\n`); };
  const unwatch = watch(file => {
    if (!loaded.has(file.toLowerCase())) return;
    clearTimeout(reload);
    reload = setTimeout(() => announce('changed'), RELOAD_DELAY_MS);
  });

  /** The game's file this path names, or null for anything that is not plainly one of its own. */
  async function find(pathname: string): Promise<{ relative: string; contents: Buffer } | null> {
    const asked = pathname.slice(1);
    if (/[\\:\0]/u.test(asked)) return null;
    for (const lookup of LOOKUPS) {
      const relative = path.posix.normalize(lookup(asked));
      // Also when it is not there: the page wants to know when it is.
      loaded.add(relative.toLowerCase());
      try {
        const file = await realpath(path.join(root, relative));
        // Judged where it really is: a link, a short name or a trailing dot cannot hide that.
        const inside = path.relative(root, file);
        if (path.isAbsolute(inside) || inside.split(path.sep).some(part => part.startsWith('.') || part.toLowerCase() === 'node_modules')) return null;
        return { relative, contents: await readFile(file) };
      } catch { /* the next place */ }
    }
    return null;
  }

  async function answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, type: string, body: string | Buffer) => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
    };
    const refuse = (status: number, reason: string) => send(status, 'text/plain; charset=utf-8', reason);
    const script = (body: string | Buffer) => send(200, 'text/javascript', body);
    // A website that points its own name at this computer still sends that name.
    const host = normalizeLocalAuthority(req.headers.host);
    if (!host || !isLoopbackHostname(host.hostname)) return refuse(403, 'Forbidden');
    if (req.method !== 'GET' && req.method !== 'HEAD') return refuse(405, 'Method not allowed');
    const [rawPath = '', query = ''] = (req.url ?? '').split(/\?(.*)/su);
    let pathname: string;
    try { pathname = decodeURIComponent(rawPath); } catch { return refuse(400, 'Bad request'); }

    if (pathname === EVENTS_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.write(devServer ? 'event: ready\ndata: 1\n\n' : ':\n\n');
      pages.add(res);
      res.once('close', () => pages.delete(res));
      return;
    }
    if (pathname.startsWith(PACKAGES_PATH)) {
      const { name, file } = /^(?<name>.+?)(?<file>\.module)?\.js$/u.exec(pathname.slice(PACKAGES_PATH.length))?.groups ?? {};
      if (!name || !Object.hasOwn(packages, name)) return refuse(404, 'Not found');
      if (file) return script(await readFile(packages[name]!.file));
      // `import Phaser from 'phaser'` is how games write it; the shipped file has named exports only.
      const module = JSON.stringify(`./${encodeURIComponent(name)}.module.js`);
      return script(`import * as all from ${module};\nexport * from ${module};\nexport default all.default ?? all;\n`);
    }
    if (pathname === '/' || pathname === '/index.html') {
      if (devServer) { res.writeHead(302, { Location: devServer, 'Cache-Control': 'no-store' }); res.end(); return; }
      loaded.add('index.html');
      return send(200, 'text/html; charset=utf-8', withPageScript(await readFile(path.join(root, 'index.html'), 'utf8'), packages));
    }
    const found = await find(pathname);
    if (!found) return refuse(404, 'Not found');
    if (query.split('&').includes('raw')) return script(`export default ${JSON.stringify(found.contents.toString('utf8'))};\n`);
    if (!/\.m?ts$/u.test(found.relative)) return send(200, mimeForPath(found.relative), found.contents);
    try { return script(withoutTypes(found.contents.toString('utf8'))); }
    catch (error) {
      const reason = `${found.relative}: ${error instanceof Error ? error.message : String(error)}`;
      log(reason);
      return refuse(500, reason);
    }
  }

  const server = createServer((req, res) => {
    answer(req, res).catch(error => { if (!res.headersSent) res.writeHead(500); res.end(); log(error instanceof Error ? error.message : String(error)); });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  } catch (error) { await unwatch(); throw error; }
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
    get handedOver() { return devServer !== null; },
    handOver(devServerUrl) { devServer = devServerUrl; announce('ready'); },
    close: () => closing ??= (async () => {
      clearTimeout(reload);
      server.closeAllConnections();
      await Promise.all([unwatch(), new Promise<void>(resolve => server.close(() => resolve()))]);
    })(),
  };
}

function withPageScript(html: string, packages: InstantPackages): string {
  const imports = Object.fromEntries(Object.keys(packages).map(name => [name, `${PACKAGES_PATH}${encodeURIComponent(name)}.js`]));
  const head = `<script type="importmap">${JSON.stringify({ imports })}</script><script>${PAGE_SCRIPT}</script>`;
  const at = findRealTagEnd(html, HTML_TAG_PATTERNS.headOpen);
  return at < 0 ? prependAfterDoctype(html, head) : html.slice(0, at) + head + html.slice(at);
}

function withoutTypes(source: string): string {
  const { stripTypeScriptTypes } = nodeModule as unknown as { stripTypeScriptTypes?: (code: string, options: { mode: 'transform' }) => string };
  if (!stripTypeScriptTypes) throw new Error('This version of Node cannot run TypeScript directly');
  return stripTypeScriptTypes(source, { mode: 'transform' });
}

/**
 * Loads the page the way a browser would. Vite prepares a module when it is first asked
 * for, and Phaser takes it a few seconds; done here, the next reload is as quick as the last.
 */
export async function warmUpDevServer(url: string): Promise<void> {
  const signal = AbortSignal.timeout(WARM_UP_MS);
  const { origin } = new URL(url);
  const asked = new Set<string>([url]);
  for (const next of asked) {
    if (asked.size > WARM_UP_REQUESTS) return;
    try {
      const response = await fetch(next, { signal });
      // A package is one prepared file: having it answered is enough.
      if (next.includes('/node_modules/')) { await response.arrayBuffer(); continue; }
      const text = await response.text();
      const references = next === url ? text.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gu) : text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/gu);
      for (const [, reference] of references) {
        const absolute = new URL(reference!, next);
        if (absolute.origin === origin) asked.add(absolute.href);
      }
    } catch { /* it will be prepared when the page asks */ }
  }
}
