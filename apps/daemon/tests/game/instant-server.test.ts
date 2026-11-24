import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest, createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { playsBeforeInstall, startInstantServer, warmUpDevServer, type InstantServer } from '../../src/game/instant-server.js';
import { readInstantPackages, type InstantPackages } from '../../src/game/templates.js';

const templatesRoot = fileURLToPath(new URL('../../../../game-templates/', import.meta.url));
const SAMPLE = 'phaser3-sample-platformer';
const sampleDir = path.join(templatesRoot, SAMPLE);

let root: string, game: string, packages: InstantPackages;
let changed: (file: string) => void;
const unwatch = vi.fn();
const servers: InstantServer[] = [];
const others: Server[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pixo-instant-'));
  game = path.join(root, 'game');
  await cp(path.join(sampleDir, 'files'), game, { recursive: true });
  packages = (await readInstantPackages(templatesRoot, SAMPLE))!;
  changed = () => {};
  unwatch.mockClear();
});
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const server of others.splice(0)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(root, { recursive: true, force: true });
});

async function start(): Promise<InstantServer> {
  const server = await startInstantServer({ root: game, packages, log: () => {}, watch: onChange => { changed = onChange; return unwatch; } });
  servers.push(server);
  return server;
}
const get = (server: InstantServer, file: string, init?: RequestInit) => fetch(new URL(file, server.url), { redirect: 'manual', ...init });
const text = async (server: InstantServer, file: string) => (await get(server, file)).text();

/** The server-sent event names the page has received so far. */
async function listen(server: InstantServer): Promise<{ names: string[]; stop: () => void }> {
  const controller = new AbortController();
  const response = await get(server, '/@openpixo/events', { signal: controller.signal });
  const names: string[] = [];
  void (async () => {
    try {
      for await (const chunk of response.body!.pipeThrough(new TextDecoderStream())) {
        for (const match of chunk.matchAll(/^event: (\w+)$/gmu)) names.push(match[1]!);
      }
    } catch { /* stopped */ }
  })();
  return { names, stop: () => controller.abort() };
}

it('ships the sample’s one package, at the version the sample installs, with its licence', async () => {
  const manifest = JSON.parse(await readFile(path.join(sampleDir, 'files', 'package.json'), 'utf8'));
  expect(Object.fromEntries(Object.entries(packages).map(([name, { version }]) => [name, version]))).toEqual(manifest.dependencies);
  const bytes = await readFile(packages.phaser!.file);
  // dist/phaser.esm.min.js of the npm package phaser@3.90.0, unchanged.
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('9327deb5e2f7d382cd054842f641fd504b9a784a730a2bdb94ea63516790ead1');
  expect(await readFile(path.join(sampleDir, 'instant', 'LICENSE-phaser.md'), 'utf8')).toContain('Richard Davey');
  expect(await playsBeforeInstall(game, packages)).toBe(true);
});

it('reads shipped packages only from a template that has them', async () => {
  expect(await readInstantPackages(templatesRoot, 'phaser3-vite')).toBeNull();
  expect(await readInstantPackages(templatesRoot, '../phaser3-sample-platformer')).toBeNull();
  expect(await readInstantPackages(templatesRoot, undefined)).toBeNull();
  const templates = path.join(root, 'templates');
  await mkdir(path.join(templates, 'bad', 'instant'), { recursive: true });
  await writeFile(path.join(templates, 'bad', 'instant', 'packages.json'), JSON.stringify({ phaser: { version: '3.90.0', file: '../../secret.js' } }));
  expect(await readInstantPackages(templates, 'bad')).toBeNull();
});

it('serves every module the sample loads as JavaScript a browser accepts', async () => {
  const server = await start();
  const page = await get(server, '/');
  expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
  const html = await page.text();
  const imports = JSON.parse(/<script type="importmap">(.*?)<\/script>/su.exec(html)![1]!).imports as Record<string, string>;
  expect(Object.keys(imports)).toEqual(['phaser']);
  // The browser reads an import map only ahead of the first module.
  expect(html.indexOf('importmap')).toBeLessThan(html.indexOf('type="module"'));

  const seen = new Set<string>();
  const queue = [...html.matchAll(/<script type="module" src="([^"]+)"/gu)].map(match => new URL(match[1]!, server.url).href);
  expect(queue).toHaveLength(1);
  while (queue.length) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const response = await fetch(url);
    expect(response.status, url).toBe(200);
    expect(response.headers.get('content-type'), url).toBe('text/javascript');
    const source = await response.text();
    if (url.includes('.module.js')) continue; // the shipped package itself
    for (const match of source.matchAll(/(?:from|import)\s*["']([^"']+)["']/gu)) {
      const specifier = match[1]!;
      expect(/^\.{0,2}\//u.test(specifier) || specifier in imports, `${url} imports ${specifier}`).toBe(true);
      queue.push(new URL(imports[specifier] ?? specifier, url).href);
    }
  }
  const paths = [...seen].map(url => new URL(url).pathname + new URL(url).search).sort();
  expect(paths).toEqual(['/@openpixo/packages/phaser.js', '/@openpixo/packages/phaser.module.js', '/src/main.ts', '/src/text', '/src/tuning', '/src/tuning.json?raw']);
  const main = await text(server, '/src/main.ts');
  expect(main).toContain('new Phaser.Game(');
  expect(main).not.toMatch(/private player|: void|as typeof/u);
});

it('gives the game a package with a default export, which the shipped file lacks', async () => {
  const server = await start();
  const shim = await text(server, '/@openpixo/packages/phaser.js');
  const module = await import(`data:text/javascript,${encodeURIComponent(shim.replaceAll('./phaser.module.js', 'data:text/javascript,export const VERSION=1;'))}`);
  expect(module.VERSION).toBe(1);
  expect(module.default.VERSION).toBe(1);
});

it('serves the game’s own files as they are now, and its media', async () => {
  const server = await start();
  expect(await text(server, '/src/tuning.json?raw')).toContain('\\"jumpPower\\": {\\"value\\": 460');
  const tuning = path.join(game, 'src', 'tuning.json');
  await writeFile(tuning, (await readFile(tuning, 'utf8')).replace('"value": 460', '"value": 700'));
  expect(await text(server, '/src/tuning.json?raw')).toContain('\\"jumpPower\\": {\\"value\\": 700');
  const main = path.join(game, 'src', 'main.ts');
  await writeFile(main, (await readFile(main, 'utf8')) + '\nenum Extra { One = 1 }\nexport const extra: Extra = Extra.One;\n');
  expect(await text(server, '/src/main.ts')).toContain('extra = 1');
  const image = await get(server, '/assets/player.png');
  expect(image.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await image.arrayBuffer()).equals(await readFile(path.join(game, 'public', 'assets', 'player.png')))).toBe(true);
  expect((await get(server, '/assets/jump.wav')).headers.get('content-type')).toBe('audio/wav');
  expect((await get(server, '/', { method: 'HEAD' })).status).toBe(200);
});

it('reloads the page when a file it loaded changes, and only then', async () => {
  const server = await start();
  await text(server, '/');
  await text(server, '/src/main.ts');
  await text(server, '/src/tuning.json?raw');
  await text(server, '/src/text');
  await text(server, '/assets/player.png');
  const page = await listen(server);
  for (const file of ['README.md', 'src/unused.ts', 'package-lock.json']) changed(file);
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(page.names).toEqual([]);
  // A burst is one reload.
  for (const file of ['src/tuning.json', 'src/main.ts', 'src/text.ts', 'public/assets/player.png']) changed(file);
  await vi.waitFor(() => expect(page.names).toEqual(['changed']));
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(page.names).toEqual(['changed']);
  page.stop();
});

it.each([
  ['a half-written module is finished', 'src/main.ts', 500, 'src/main.ts'],
  ['a module the game imports before it exists appears', 'src/enemy', 404, 'src/enemy.ts'],
])('reloads the page when %s', async (_name, asked, status, file) => {
  const server = await start();
  await writeFile(path.join(game, 'src', 'main.ts'), 'const broken: = {');
  expect((await get(server, `/${asked}`)).status).toBe(status);
  const page = await listen(server);
  changed(file);
  await vi.waitFor(() => expect(page.names).toEqual(['changed']));
  page.stop();
});

it('sends the next load to the dev server once it is ready, and leaves the page on screen alone', async () => {
  const server = await start();
  const page = await listen(server);
  expect(server.handedOver).toBe(false);
  server.handOver('http://127.0.0.1:5999/');
  expect(server.handedOver).toBe(true);
  const next = await get(server, '/');
  expect([next.status, next.headers.get('location'), next.headers.get('cache-control')]).toEqual([302, 'http://127.0.0.1:5999/', 'no-store']);
  expect((await get(server, '/index.html')).status).toBe(302);
  // The page already playing still finds its files, and is told only that it could reload if it is broken.
  expect((await get(server, '/assets/player.png')).status).toBe(200);
  await vi.waitFor(() => expect(page.names).toEqual(['ready']));
  const late = await listen(server);
  await vi.waitFor(() => expect(late.names).toEqual(['ready']));
  page.stop(); late.stop();
});

it('answers only the game’s own files, to this computer', async () => {
  const server = await start();
  await writeFile(path.join(root, 'secret.txt'), 'secret');
  await writeFile(path.join(game, '.env'), 'secret');
  await mkdir(path.join(game, 'node_modules', 'phaser'), { recursive: true });
  await writeFile(path.join(game, 'node_modules', 'phaser', 'package.json'), 'secret');
  // A junction needs no rights on Windows; elsewhere this is a plain link.
  await symlink(root, path.join(game, 'src', 'outside'), 'junction');
  await symlink(path.join(game, 'node_modules'), path.join(game, 'src', 'modules'), 'junction');
  for (const file of ['/src/outside/secret.txt', '/src/modules/phaser/package.json', '/node_modules./phaser/package.json', '/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/.env', '/src/../.env', '/node_modules/phaser/package.json',
    '/NODE_MODULES/phaser/package.json', '/src', '/%00', '/%E0%A4%A', '/@openpixo/packages/..%2f..%2ftemplate.json', '/@openpixo/packages/toString.js', '/missing.ts']) {
    // Not fetch: it would tidy the path before sending it.
    const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const { port } = new URL(server.url);
      httpRequest({ host: '127.0.0.1', port, path: file }, response => {
        let body = ''; response.on('data', chunk => { body += chunk; }).on('end', () => resolve({ status: response.statusCode!, body }));
      }).on('error', reject).end();
    });
    expect([400, 404], file).toContain(status);
    expect(body, file).not.toContain('secret');
  }
  expect((await get(server, '/', { method: 'POST' })).status).toBe(405);
  const status = await new Promise<number>((resolve, reject) => {
    httpRequest({ host: '127.0.0.1', port: new URL(server.url).port, path: '/', headers: { host: 'games.example.com' } }, response => { response.resume(); resolve(response.statusCode!); })
      .on('error', reject).end();
  });
  expect(status).toBe(403);
  expect((await get(server, '/')).headers.get('access-control-allow-origin')).toBeNull();
});

it('stops answering and watching when the game stops', async () => {
  const server = await start();
  const page = await listen(server);
  await server.close();
  await server.close();
  expect(unwatch).toHaveBeenCalledOnce();
  await expect(get(server, '/')).rejects.toThrow();
  page.stop();
});

it.each<[string, () => Promise<void>]>([
  ['needs a package it does not ship', async () => writeFile(path.join(game, 'package.json'), JSON.stringify({ dependencies: { phaser: '3.90.0', howler: '2.2.4' } }))],
  ['wants another version of one', async () => writeFile(path.join(game, 'package.json'), JSON.stringify({ dependencies: { phaser: '3.80.1' } }))],
  ['configures Vite', async () => writeFile(path.join(game, 'vite.config.ts'), 'export default {}')],
  ['has no page', async () => rm(path.join(game, 'index.html'))],
  ['has no readable package.json', async () => writeFile(path.join(game, 'package.json'), '{')],
])('waits for the install when the game %s', async (_name, edit) => {
  await edit();
  expect(await playsBeforeInstall(game, packages)).toBe(false);
});

it('asks the dev server for everything the page will load, and survives one that answers nothing', async () => {
  const asked: string[] = [];
  const dev = createServer((req, res) => {
    asked.push(req.url!);
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<script type="module" src="/@vite/client"></script><script type="module" src="/src/main.ts"></script>'); return; }
    res.setHeader('content-type', 'text/javascript');
    res.end(req.url === '/src/main.ts' ? 'import __dep from "/node_modules/.vite/deps/phaser.js?v=1"; import { words } from "/src/text.ts";\nimport "http://elsewhere.example/x.js";'
      : req.url === '/src/text.ts' ? 'import "/src/main.ts";' : '');
  });
  others.push(dev);
  await new Promise<void>(resolve => dev.listen(0, '127.0.0.1', resolve));
  const port = (dev.address() as { port: number }).port;
  await warmUpDevServer(`http://127.0.0.1:${port}/`);
  expect(asked.sort()).toEqual(['/', '/@vite/client', '/node_modules/.vite/deps/phaser.js?v=1', '/src/main.ts', '/src/text.ts']);
  await new Promise(resolve => { dev.closeAllConnections(); dev.close(resolve); });
  others.splice(0);
  await warmUpDevServer(`http://127.0.0.1:${port}/`);
});
