import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cliTiming, runAnimatedCharacterCli } from '../../src/character/cli.js';
import { runCharacterCli } from '../../src/recipes/character-cli.js';

const ID = '11111111-2222-4333-8444-555555555555', JOB = '33333333-2222-4333-8444-555555555555';
const job = (state: string, more = {}) => ({ id: JOB, characterId: ID, kind: 'character', state, creditsReserved: 80, creditsCharged: state === 'succeeded' ? 80 : null, delivered: state === 'succeeded' ? ['hero'] : null, errorCode: null, createdAt: '', updatedAt: '', ...more });
const hero = { id: ID, name: 'Cook', body: 'round', style: 'ink', state: 'ready', revision: 1, items: { sets: [], weapons: [], capes: [] }, fits: [], outfits: [], motions: [], changed: false, job: null, games: [], createdAt: '', updatedAt: '' };
const brief = { briefId: 'b', kind: 'character', characterId: null, name: 'Cook', body: 'round', style: 'ink', shown: { look: 'a cook', clothes: '', colours: '', gear: '', note: '' }, parts: [{ part: 'hero', credits: 40 }], credits: 40, available: 100, expiresAt: '' };

let server: Server, url: string, asked: { route: string; method: string; body: any }[], answers: (route: string, method: string) => [number, unknown] | 'drop', out: string[], err: string[];
beforeEach(async () => {
  asked = []; out = []; err = [];
  cliTiming.pollMs = 1; cliTiming.tries = 6;
  vi.spyOn(console, 'log').mockImplementation(line => { out.push(String(line)); });
  vi.spyOn(console, 'error').mockImplementation(line => { err.push(String(line)); });
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += String(chunk);
    const route = req.url!.replace('/api', ''), method = req.method!;
    asked.push({ route, method, body: raw ? JSON.parse(raw) : undefined });
    const answer = answers(route, method);
    if (answer === 'drop') { req.socket.destroy(); return; }
    res.writeHead(answer[0], { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer[1]));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', () => done()));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { vi.restoreAllMocks(); process.exitCode = 0; server.closeAllConnections(); await new Promise(done => server.close(done)); });
const run = async (...args: string[]): Promise<void> => { process.exitCode = 0; await runAnimatedCharacterCli([...args, '--daemon-url', url]); };
const AWAY: [number, unknown] = [503, { error: { code: 'CLOUD_UNAVAILABLE', message: 'away' } }];

describe('pixo character make', () => {
  it('shows the price and orders nothing without --yes', async () => {
    answers = () => [200, brief];
    await run('make', '--text', 'a cook', '--armor');
    expect(asked).toEqual([{ route: '/characters/briefs', method: 'POST', body: { kind: 'character', text: 'a cook', armor: true, gear: false } }]);
    expect(out.join('\n')).toContain('Add --yes to order it');
    expect(process.exitCode).toBe(0);
  });

  it('orders once, whatever answers get lost on the way', async () => {
    let orders = 0, looks = 0;
    answers = (route, method) => {
      if (route === '/characters/briefs') return [200, brief];
      if (route === '/characters/orders') return orders++ === 0 ? 'drop' : orders === 2 ? AWAY : [200, job('waiting')];
      if (route.startsWith('/characters/jobs/')) return looks++ < 4 ? AWAY : [200, job('succeeded')];
      return [200, hero];
    };
    await run('make', '--text', 'a cook', '--yes', '--json');
    const placed = asked.filter(a => a.route === '/characters/orders').map(a => a.body.requestId);
    expect(placed).toHaveLength(3);
    expect(new Set(placed).size).toBe(1);
    expect(JSON.parse(out.join('\n'))).toMatchObject({ job: { id: JOB, state: 'succeeded' }, character: { id: ID } });
    expect(process.exitCode).toBe(0);
  });

  it('names the job when it cannot be looked at any more, so that nobody orders again', async () => {
    answers = (route) => route === '/characters/briefs' ? [200, brief] : route === '/characters/orders' ? [200, job('waiting')] : AWAY;
    await run('make', '--text', 'a cook', '--yes', '--json');
    expect(JSON.parse(out.join('\n'))).toMatchObject({ jobId: JOB, error: { message: expect.stringMatching(/do not order again/u) } });
    expect(process.exitCode).toBe(5);
  });

  it('says what failed and that it was not charged', async () => {
    answers = (route) => route === '/characters/briefs' ? [200, brief] : route === '/characters/orders' ? [200, job('waiting')] : [200, job('failed', { errorCode: 'CHARACTER_DRAWING_FAILED' })];
    await run('make', '--text', 'a cook', '--yes');
    expect(err.join('\n')).toContain('Nothing was charged');
    expect(process.exitCode).toBe(5);
    // a refusal is not asked again
    answers = (route) => route === '/characters/briefs' ? [200, brief] : [402, { error: { code: 'INSUFFICIENT_CREDITS', message: 'Not enough credits for this.' } }];
    asked = [];
    await run('make', '--text', 'a cook', '--yes');
    expect(asked.filter(a => a.route === '/characters/orders')).toHaveLength(1);
  });
});

describe('the other commands', () => {
  it('send what they say', async () => {
    answers = (route) => route === '/characters/gear' ? [200, { designs: [], motions: [] }] : route === '/projects/game/heroes' ? [200, { characters: [], slug: 'cook', name: 'Cook', revision: 1, folder: 'f', player: 'p', playerState: 'same' }] : [200, hero];
    await run('wear', ID, '--pieces', 'weapon1, cape0');
    await run('tune', ID, 'attack', '--set', 'speed=1.2', '--set', 'windup=0.8');
    await run('tune', ID, 'dodge', '--off');
    await run('install', ID, '--project', 'game');
    await run('suggest', '--text', 'a cook', '--weapons', '--project', 'game');
    expect(asked.map(a => [a.method, a.route, a.body])).toEqual([
      ['PATCH', `/characters/${ID}`, { gear: ['weapon1', 'cape0'] }], ['PUT', `/characters/${ID}/motions/attack`, { tuning: { speed: 1.2, windup: 0.8 } }], ['DELETE', `/characters/${ID}/motions/dodge`, undefined],
      ['POST', '/projects/game/heroes', { characterId: ID }], ['POST', '/projects/game/heroes/suggest', { text: 'a cook', armor: false, gear: true }],
    ]);
  });

  it('refuse what makes no sense, and delete only when told twice', async () => {
    answers = () => [200, hero];
    for (const bad of [['tune', ID, 'attack', '--set', 'height=2'], ['add', ID, 'boss', '--text', 'x'], ['wear', ID], ['remove', ID], ['make'], ['info']]) { await run(...bad); expect(process.exitCode, bad.join(' ')).toBe(5); }
    expect(asked).toEqual([]);
    await run('remove', ID, '--yes');
    expect(asked.map(a => a.method)).toEqual(['DELETE']);
  });

  it('live beside the character cards under one name', async () => {
    answers = () => [200, hero];
    await runCharacterCli(['info', ID, '--daemon-url', url]);
    expect(asked.map(a => a.route)).toEqual([`/characters/${ID}`]);
    await runCharacterCli(['--help']);
    expect(out.join('\n')).toMatch(/Character cards[\s\S]*Animated characters/u);
  });
});
