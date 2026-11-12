import {
  GAME_ART_STYLE_BLOCK_HEADING,
  GAME_MEDIA_CONTRACT_HEADING,
  GAME_SETUP_BLOCK_HEADING,
  type ApiErrorResponse,
  type CreateGameFromTemplateResponse,
  type GameProjectSetup,
  type GameProjectSetupResponse,
  type ProjectArtStyleResponse,
  type ProjectResponse,
} from '@openpixo/contracts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeGameSystemPrompt, gamePromptProjectInputs } from '../../src/game/prompt.js';
import { gameSetupFromCliFlags } from '../../src/game/setup-cli.js';
import { computeStableSectionHashes, diffStableSections } from '../../src/runtimes/stable-prompt-sections.js';

const setup: GameProjectSetup = {
  genre: 'platformer',
  pitch: 'A fox explores a sunken city.',
  platforms: ['desktop', 'web'],
  art: { styleId: 'pixel-16-bit', direction: 'Moody teal caves', palette: ['#182238', '#f0d8a8'], pixelSize: 16, sample: true },
  display: { width: 640, height: 360, scaling: 'pixel-perfect' },
  controls: ['keyboard', 'gamepad'],
  notes: 'No blood.',
};

describe('game setup at the daemon HTTP boundary', () => {
  let server: Server | undefined;
  let base = '';
  let parent = '';

  beforeAll(async () => {
    const { startServer } = await import('../../src/server.js');
    const started = await startServer({ port: 0, returnServer: true }) as { url: string; server: Server };
    server = started.server;
    base = started.url;
    parent = await mkdtemp(path.join(tmpdir(), 'openpixo-game-setup-'));
    // A full daemon boot (catalogue install, migrations) can exceed the default hook timeout.
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (parent) await rm(parent, { recursive: true, force: true });
  });

  const json = { 'Content-Type': 'application/json' };
  const post = (body: unknown) => fetch(`${base}/api/projects/game-from-template`, {
    method: 'POST', headers: { ...json, Origin: base }, body: JSON.stringify(body),
  });

  it('names the project after the game title while the folder keeps its own name', async () => {
    const response = await post({ templateId: 'phaser3-vite', parentDir: parent, name: 'hollow-fox', setup: { title: 'Hollow Fox' } });
    const created = await response.json() as CreateGameFromTemplateResponse;
    expect(response.status, JSON.stringify(created)).toBe(200);
    expect(created.project.name).toBe('Hollow Fox');
    const { project } = await (await fetch(`${base}/api/projects/${created.project.id}`)).json() as ProjectResponse;
    expect(path.basename(project.metadata?.baseDir ?? '')).toBe('hollow-fox');
  });

  it('stores wizard answers on the created project, sets its art style, and feeds the game prompt', async () => {
    const response = await post({ templateId: 'phaser3-vite', parentDir: parent, name: 'fox-game', setup });
    const created = await response.json() as CreateGameFromTemplateResponse;
    expect(response.status, JSON.stringify(created)).toBe(200);
    const projectId = created.project.id;

    const stored = await (await fetch(`${base}/api/projects/${projectId}/game-setup`)).json() as GameProjectSetupResponse;
    expect(stored.missingSteps).toEqual([]);
    // Normalized on the way in: palette upper-cased.
    expect(stored.setup).toEqual({ ...setup, art: { ...setup.art, palette: ['#182238', '#F0D8A8'] } });

    const style = await (await fetch(`${base}/api/projects/${projectId}/art-style`)).json() as ProjectArtStyleResponse;
    expect(style.styleId).toBe('pixel-16-bit');

    // The chat run reads the prompt inputs from the stored project through this mapping.
    const { project } = await (await fetch(`${base}/api/projects/${projectId}`)).json() as ProjectResponse;
    const prompt = composeGameSystemPrompt({ baseDir: '/game', ...gamePromptProjectInputs(project.metadata) });
    expect(prompt).toContain('## Game setup');
    expect(prompt).toContain('- Genre: platformer');
    expect(prompt).toContain('- Target platforms: desktop, web browser');
    expect(prompt).toContain('- Art style: pixel-16-bit');
    expect(prompt).toContain('- Palette: #182238, #F0D8A8');
    expect(prompt).toContain('- Pixel grid: 16px');
    expect(prompt).toContain('- Pixel resolution: 640x360 world pixels on screen (landscape; not the canvas size), scaling: pixel-perfect');
    expect(prompt).toContain('- Controls: keyboard, gamepad');
    expect(prompt).toContain('- Notes from the user: No blood.');
    // Fixed block order: art style, then setup, then the media contract.
    expect(prompt.indexOf(GAME_ART_STYLE_BLOCK_HEADING)).toBeLessThan(prompt.indexOf(GAME_SETUP_BLOCK_HEADING));
    expect(prompt.indexOf(GAME_SETUP_BLOCK_HEADING)).toBeLessThan(prompt.indexOf(GAME_MEDIA_CONTRACT_HEADING));
  });

  it('rejects an invalid setup or an unknown style before writing anything', async () => {
    const invalid = await post({ templateId: 'phaser3-vite', parentDir: parent, name: 'bad-setup', setup: { platforms: ['console'] } });
    expect(invalid.status).toBe(400);
    expect((await invalid.json() as ApiErrorResponse).error.message).toMatch(/Invalid game setup at platforms/);
    const unknown = await post({ templateId: 'phaser3-vite', parentDir: parent, name: 'bad-style', setup: { art: { styleId: 'no-such-style' } } });
    expect(unknown.status).toBe(400);
    await expect(readFile(path.join(parent, 'bad-setup', 'package.json'))).rejects.toThrow();
    await expect(readFile(path.join(parent, 'bad-style', 'package.json'))).rejects.toThrow();
  });

  it('lets an imported or CLI-created game finish its setup later', async () => {
    const response = await post({ templateId: 'godot4-2d', parentDir: parent, name: 'plain-game' });
    const created = await response.json() as CreateGameFromTemplateResponse;
    expect(response.status).toBe(200);
    const url = `${base}/api/projects/${created.project.id}/game-setup`;
    const before = await (await fetch(url)).json() as GameProjectSetupResponse;
    expect(before).toEqual({ setup: null, missingSteps: ['basics', 'art', 'setup'] });

    const put = (body: unknown, origin = base) => fetch(url, { method: 'PUT', headers: { ...json, Origin: origin }, body: JSON.stringify(body) });
    expect((await put({ setup: { genre: 'puzzle' } }, 'http://evil.example')).status).toBe(403);
    expect((await put({ setup: { genre: 'puzzle', extra: true } })).status).toBe(400);

    // A setup from today's dialog has a size and no release answers; it is not unfinished for that.
    const sized = await (await put({ setup: { genre: 'puzzle', scope: 'quick' } })).json() as GameProjectSetupResponse;
    expect(sized.missingSteps).toEqual(['art', 'setup']);
    const partial = await (await put({ setup: { genre: 'puzzle', platforms: ['mobile'] } })).json() as GameProjectSetupResponse;
    expect(partial.missingSteps).toEqual(['art', 'setup']);
    const done = await (await put({ setup: { ...partial.setup, art: { direction: 'Soft paper cut-outs' },
      display: { width: 720, height: 1280 }, controls: ['touch'] } })).json() as GameProjectSetupResponse;
    expect(done.missingSteps).toEqual([]);
    const { project } = await (await fetch(`${base}/api/projects/${created.project.id}`)).json() as ProjectResponse;
    expect(composeGameSystemPrompt({ baseDir: '/game', ...gamePromptProjectInputs(project.metadata) }))
      .toContain('- Base resolution: 720x1280 (portrait)');
  });
});

describe('game setup prompt inputs', () => {
  it('omits the block without a setup and attributes changes to the project section', () => {
    expect(composeGameSystemPrompt({ baseDir: '/game' })).not.toContain('## Game setup');
    const base = { baseDir: '/game', locale: 'en' };
    const without = computeStableSectionHashes(base);
    const withSetup = computeStableSectionHashes({ ...base, gameSetup: setup });
    expect(diffStableSections(without, withSetup)).toEqual(['project']);
    expect(diffStableSections(withSetup, computeStableSectionHashes({ ...base, gameSetup: { ...setup, genre: 'shooter' } }))).toEqual(['project']);
  });

  it('keeps plain text-only providers free of tool instructions', () => {
    const plain = composeGameSystemPrompt({ baseDir: '/game', streamFormat: 'plain',
      gameSetup: { art: { references: ['art/references/01-cave.png'] } } });
    expect(plain).toContain('- Reference images (project-relative): art/references/01-cave.png');
    expect(plain).not.toContain('Open them before creating art.');
  });
});

describe('pixo project setup flags', () => {
  it('builds a validated setup from flags on top of a setup file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'openpixo-setup-flags-'));
    try {
      const file = path.join(dir, 'setup.json');
      await writeFile(file, JSON.stringify({ genre: 'racing', notes: 'Kept from the file' }));
      expect(await gameSetupFromCliFlags({ json: true })).toBeUndefined();
      expect(await gameSetupFromCliFlags({
        'setup-file': file, genre: 'platformer', platform: 'desktop, web', style: 'pixel-16-bit',
        palette: '#182238,#f0d8a8', 'pixel-size': '16', resolution: '640x360', scaling: 'pixel-perfect', controls: 'keyboard',
      })).toEqual({
        genre: 'platformer', notes: 'Kept from the file', platforms: ['desktop', 'web'],
        art: { styleId: 'pixel-16-bit', palette: ['#182238', '#F0D8A8'], pixelSize: 16 },
        display: { width: 640, height: 360, scaling: 'pixel-perfect' }, controls: ['keyboard'],
      });
      // The release answers, and a store sets the build it needs unless the flag says otherwise.
      expect(await gameSetupFromCliFlags({
        title: 'Hollow Fox', studio: 'Tiny Lantern', perspective: 'side-2d', comparable: 'Hollow Knight, Ori', players: 'single,online-coop',
        store: 'steam,web', os: 'windows,steam-deck', 'steam-app-id': '480', 'steam-features': 'achievements,cloud-saves',
        milestone: 'demo', playtime: '5-15h', price: '10-20', language: 'zh-Hans,en', 'art-source': 'mixed',
      })).toEqual({
        title: 'Hollow Fox', studio: 'Tiny Lantern', perspective: 'side-2d', comparables: ['Hollow Knight', 'Ori'], players: ['single', 'online-coop'],
        platforms: ['desktop', 'web'],
        release: { stores: ['steam', 'web'], os: ['windows', 'steam-deck'], steamAppId: '480', steamFeatures: ['achievements', 'cloud-saves'], milestone: 'demo', playtime: '5-15h', price: '10-20', languages: ['zh-Hans', 'en'] },
        art: { source: 'mixed' },
      });
      // Changing one release answer keeps the others.
      expect((await gameSetupFromCliFlags({ milestone: 'full-release' }, { release: { stores: ['steam'], milestone: 'demo' } }))?.release)
        .toEqual({ stores: ['steam'], milestone: 'full-release' });
      // Changing only the scaling keeps the stored resolution.
      expect((await gameSetupFromCliFlags({ scaling: 'fit' }, { display: { width: 320, height: 180 } }))?.display)
        .toEqual({ width: 320, height: 180, scaling: 'fit' });
      // The size of the game, and the one Steam answer a long project keeps.
      expect(await gameSetupFromCliFlags({ genre: 'puzzle', scope: 'long', 'steam-later': 'yes', language: 'en' }))
        .toEqual({ genre: 'puzzle', scope: 'long', release: { languages: ['en'], steamLater: true } });
      expect((await gameSetupFromCliFlags({ 'steam-later': 'no' }, { scope: 'long', release: { steamLater: true } })))
        .toEqual({ scope: 'long' });
      await expect(gameSetupFromCliFlags({ scope: 'huge' })).rejects.toThrow(/Invalid game setup at scope/);
      await expect(gameSetupFromCliFlags({ 'steam-later': 'maybe' })).rejects.toThrow(/--steam-later/);
      await expect(gameSetupFromCliFlags({ resolution: '10x10' })).rejects.toThrow(/--resolution/);
      await expect(gameSetupFromCliFlags({ platform: 'console' })).rejects.toThrow(/Invalid game setup at platforms/);
      await expect(gameSetupFromCliFlags({ store: 'epic' })).rejects.toThrow(/Invalid game setup at release\.stores/);
      await expect(gameSetupFromCliFlags({ 'steam-app-id': 'abc' })).rejects.toThrow(/Steam App ID/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
