import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { motionCliTiming, runMotionCli } from '../../src/motion/cli.js';

const PORTRAIT = '11111111-2222-4333-8444-555555555555', CHARACTER = '22222222-2222-4333-8444-555555555555', JOB = '33333333-2222-4333-8444-555555555555';
const portrait = (state: string) => ({ id: PORTRAIT, state, text: 'a fox knight', fromPicture: false, used: false, errorCode: null, createdAt: '', expiresAt: '' });
const job = (state: string, more = {}) => ({ id: JOB, characterId: CHARACTER, state, progress: state === 'succeeded' ? 1 : 0.5, creditsReserved: 60, creditsCharged: state === 'succeeded' ? 60 : null, errorCode: null, createdAt: '', updatedAt: '', ...more });
const fox = { id: CHARACTER, name: 'Fox Knight', state: 'ready', portraitId: PORTRAIT, file: { bytes: 4, sha256: 'a'.repeat(64) }, job: null, createdAt: '', updatedAt: '' };
const service = { available: true, signedIn: true, service: { paused: false, priceVersion: 1, price: 60, portraitsPerDay: 10, portraitsLeft: 9 } };

let server: Server, url: string, dir: string, asked: { route: string; method: string; body: string; type: string }[], answers: (route: string, method: string) => [number, unknown] | 'drop' | Buffer, out: string[], err: string[];
beforeEach(async () => {
  asked = []; out = []; err = [];
  dir = await mkdtemp(path.join(os.tmpdir(), 'openpixo-motion-cli-'));
  motionCliTiming.pollMs = 1; motionCliTiming.tries = 6;
  vi.spyOn(console, 'log').mockImplementation(line => { out.push(String(line)); });
  vi.spyOn(console, 'error').mockImplementation(line => { err.push(String(line)); });
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const route = req.url!.replace('/api', ''), method = req.method!;
    asked.push({ route, method, body: Buffer.concat(chunks).toString('latin1'), type: String(req.headers['content-type'] ?? '') });
    const answer = answers(route, method);
    if (answer === 'drop') { req.socket.destroy(); return; }
    if (Buffer.isBuffer(answer)) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(answer); return; }
    res.writeHead(answer[0], { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer[1]));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', () => done()));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { vi.restoreAllMocks(); process.exitCode = 0; server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(dir, { recursive: true, force: true }); });
const run = async (...args: string[]): Promise<void> => { process.exitCode = 0; await runMotionCli([...args, '--daemon-url', url]); };
const AWAY: [number, unknown] = [503, { error: { code: 'CLOUD_UNAVAILABLE', message: 'away' } }];
const json = (): any => JSON.parse(out.join('\n'));

describe('pixo motion portrait', () => {
  it('reads the description from stdin and answers in JSON', async () => {
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(Readable.from(['a fox knight\n']) as never);
    answers = () => [200, portrait('painting')];
    await run('portrait', '--prompt-file', '-', '--json');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ route: '/motion/portraits', method: 'POST', type: expect.stringMatching(/^multipart\/form-data/u) });
    expect(asked[0]!.body).toContain('a fox knight');
    expect(json()).toEqual(portrait('painting'));
    expect(process.exitCode).toBe(0);
  });

  it('sends a picture, asks again under the same id, and waits until it is painted', async () => {
    const image = path.join(dir, 'fox.png');
    await writeFile(image, 'PICTURE-BYTES');
    let posts = 0, looks = 0;
    answers = (route) => route === '/motion/portraits' ? (posts++ === 0 ? 'drop' : [200, portrait('painting')]) : [200, portrait(looks++ < 2 ? 'painting' : 'ready')];
    await run('portrait', '--text', 'a fox knight', '--image', image, '--wait', '--json');
    const sent = asked.filter(a => a.route === '/motion/portraits');
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body).toContain('PICTURE-BYTES');
    const id = (body: string): string => /name="requestId"\r\n\r\n([^\r]+)/u.exec(body)![1]!;
    expect(id(sent[0]!.body)).toBe(id(sent[1]!.body));
    expect(json()).toMatchObject({ id: PORTRAIT, state: 'ready' });
  });
});

describe('pixo motion order', () => {
  it('shows the price and orders nothing without --yes', async () => {
    answers = () => [200, service];
    await run('order', PORTRAIT, '--name', 'Fox Knight');
    expect(asked.map(a => a.route)).toEqual(['/motion/service']);
    expect(out.join('\n')).toContain('Price: 60 credits');
  });

  it('orders once, whatever answers get lost on the way, and waits for the character', async () => {
    let orders = 0, looks = 0;
    answers = (route) => {
      if (route === '/motion/service') return [200, service];
      if (route === '/motion/jobs') return orders++ === 0 ? 'drop' : orders === 2 ? AWAY : [200, job('waiting')];
      if (route.startsWith('/motion/jobs/')) return looks++ < 3 ? AWAY : [200, job('succeeded')];
      return [200, fox];
    };
    await run('order', PORTRAIT, '--name', 'Fox Knight', '--yes', '--wait', '--json');
    const placed = asked.filter(a => a.route === '/motion/jobs').map(a => JSON.parse(a.body) as { requestId: string; name: string; portraitId: string });
    expect(placed).toHaveLength(3);
    expect(new Set(placed.map(p => p.requestId)).size).toBe(1);
    expect(placed[0]).toMatchObject({ portraitId: PORTRAIT, name: 'Fox Knight' });
    expect(json()).toMatchObject({ job: { state: 'succeeded' }, character: { id: CHARACTER } });
    expect(process.exitCode).toBe(0);
  });

  it('says what failed and that it was not charged', async () => {
    answers = (route) => route === '/motion/service' ? [200, service] : route === '/motion/jobs' ? [200, job('waiting')] : [200, job('failed', { errorCode: 'MOTION_BUILD_FAILED' })];
    await run('order', PORTRAIT, '--name', 'Fox', '--yes', '--wait');
    expect(err.join('\n')).toContain('Nothing was charged');
    expect(process.exitCode).toBe(5);
  });
});

describe('the other commands', () => {
  it('send what they say', async () => {
    answers = (route) => route.endsWith('/file') ? Buffer.from('PXMO') : route.endsWith('/poster') ? Buffer.from('PNG') : route.endsWith('/install')
      ? [200, { characterId: CHARACTER, slug: 'fox-knight', name: 'Fox Knight', file: 'assets/characters/fox-knight.pxmo', engine: 'godot', player: ['addons/pixo_motion/pixo_motion.gd'], playerState: 'written', usage: 'var hero := PixoMotion.new()' }]
      : route === `/motion/jobs/${JOB}` ? [200, job('building')] : [200, fox];
    await run('rename', CHARACTER, '--name', 'Fox');
    await run('install', CHARACTER, '--project', 'game');
    expect(out.at(-1)).toContain('var hero := PixoMotion.new()');
    await run('suggest', '--text', 'a fox knight', '--project', 'game');
    await run('delete', CHARACTER, '--yes');
    await run('status', JOB, '--json');
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ state: 'building' });
    await run('download', CHARACTER, '--output', dir, '--json');
    expect(JSON.parse(out.at(-1)!)).toEqual({ file: path.join(dir, 'fox-knight.pxmo'), poster: path.join(dir, 'fox-knight.png') });
    expect(await readFile(path.join(dir, 'fox-knight.pxmo'), 'utf8')).toBe('PXMO');
    expect(asked.map(a => [a.method, a.route, a.body ? JSON.parse(a.body) : undefined])).toEqual([
      ['PATCH', `/motion/characters/${CHARACTER}`, { name: 'Fox' }], ['POST', `/motion/characters/${CHARACTER}/install`, { projectId: 'game' }], ['POST', '/motion/suggestions', { projectId: 'game', text: 'a fox knight' }],
      ['DELETE', `/motion/characters/${CHARACTER}`, undefined], ['GET', `/motion/jobs/${JOB}`, undefined],
      ['GET', `/motion/characters/${CHARACTER}`, undefined], ['GET', `/motion/characters/${CHARACTER}/file`, undefined], ['GET', `/motion/characters/${CHARACTER}/poster`, undefined],
    ]);
  });

  it('looks at a portrait when there is no job of that id', async () => {
    answers = (route) => route.startsWith('/motion/jobs/') ? [404, { error: { code: 'MOTION_NOT_FOUND', message: 'none' } }] : [200, portrait('ready')];
    await run('status', PORTRAIT, '--json');
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ id: PORTRAIT, state: 'ready' });
  });

  it('refuse what makes no sense, and delete only when told twice', async () => {
    answers = () => [200, fox];
    for (const bad of [['portrait'], ['order', PORTRAIT], ['rename', CHARACTER], ['delete', CHARACTER], ['download', CHARACTER], ['suggest', '--project', 'game'], ['dance']]) {
      await run(...bad, '--json');
      expect(process.exitCode, bad.join(' ')).toBe(5);
      expect(JSON.parse(out.at(-1)!), bad.join(' ')).toMatchObject({ error: { message: expect.any(String) } });
    }
    expect(asked).toEqual([]);
  });
});
