import { randomUUID } from 'node:crypto';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFakeAgentRuntimes } from '@/fake-agents';
import { createOpenPixoGame } from '@/openpixo-fixture';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';

test('[P0] game assets filter, preview and stage real project files without copying originals', async ({ page, toolsDev }, testInfo) => {
  test.setTimeout(T.xlong);
  const root = join(toolsDev.root, 'scratch', `game-${randomUUID()}`);
  const game = await createOpenPixoGame(root);
  const fake = await createFakeAgentRuntimes({ root: join(toolsDev.root, 'scratch', `agent-${randomUUID()}`), runtimeIds: ['codex'] });
  const config = {
    mode: 'daemon', agentId: 'codex', onboardingCompleted: true, privacyDecisionAt: 1,
    agentCliEnv: { codex: fake.codex.env }, agentModels: { codex: { model: 'default', reasoning: 'default' } },
    skillId: null, telemetry: { metrics: false, content: false, artifactManifest: false },
  };
  expect((await page.request.put('/api/app-config', { data: config })).ok()).toBe(true);
  await page.addInitScript(value => {
    localStorage.setItem('pixo:config', JSON.stringify(value));
    localStorage.setItem('pixo:locale', 'en');
    localStorage.setItem('pixo:locale-source', 'manual');
  }, config);
  const importedResponse = await page.request.post('/api/import/folder', { data: { baseDir: root, name: 'OpenPixo UI game' } });
  expect(importedResponse.ok(), await importedResponse.text()).toBe(true);
  const imported = await importedResponse.json() as { project: { id: string }; conversationId: string };
  await page.goto(`/projects/${imported.project.id}/conversations/${imported.conversationId}`, { waitUntil: 'domcontentloaded' });
  const assets = page.getByRole('region', { name: 'Project assets', exact: true });
  await expect(assets).toBeVisible();
  const sprite = assets.getByRole('img', { name: 'assets/sprite.png', exact: true });
  await expect(sprite).toBeVisible();
  await expect(sprite).toHaveAttribute('src', /\/assets\/thumb\?.*size=256/);
  await expect.poll(() => sprite.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const audio = assets.locator('audio[aria-label="assets/jump.wav"]');
  await expect(audio).toHaveAttribute('controls', '');
  await expect(audio).toHaveAttribute('src', /\/raw\/assets\/jump\.wav/);
  const playback = await audio.evaluate(async element => {
    const media = element as HTMLAudioElement;
    media.muted = true;
    const ended = new Promise<void>((resolve, reject) => {
      media.addEventListener('ended', () => resolve(), { once: true });
      media.addEventListener('error', () => reject(new Error(media.error?.message ?? 'Audio decoding failed')), { once: true });
    });
    await media.play();
    await ended;
    return { ended: media.ended, currentTime: media.currentTime, duration: media.duration, error: media.error?.code ?? null };
  });
  expect(playback.ended).toBe(true);
  expect(playback.currentTime).toBeGreaterThan(0);
  expect(playback.duration).toBeGreaterThan(0);
  expect(playback.error).toBe(null);

  await assets.getByRole('combobox', { name: 'Asset type' }).selectOption('image');
  await expect(assets.getByRole('checkbox', { name: 'Select assets/jump.wav', exact: true })).toHaveCount(0);
  await assets.getByRole('checkbox', { name: 'Select assets/sprite.png', exact: true }).check();
  await assets.getByRole('combobox', { name: 'Asset type' }).selectOption('audio');
  await assets.getByRole('checkbox', { name: 'Select assets/jump.wav', exact: true }).check();
  await assets.getByRole('button', { name: 'Add to chat (2)', exact: true }).click();
  const tray = page.getByTestId('staged-attachments');
  await expect(tray.getByTestId('staged-attachment-image')).toHaveCount(1);
  await expect(tray).toContainText('jump.wav');
  await expect(assets.getByRole('status')).toHaveText('Added 2 project files to the chat.');

  await copyFile(join(root, 'assets', 'sprite.png'), join(root, 'assets', 'sprite-second.png'));
  await assets.getByRole('combobox', { name: 'Asset type' }).selectOption('all');
  const refreshed = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === `/api/projects/${imported.project.id}/files`);
  await assets.getByRole('button', { name: 'Refresh', exact: true }).click();
  expect((await refreshed).ok()).toBe(true);
  await assets.getByRole('searchbox', { name: 'Search file names or paths' }).fill('sprite-second');
  await expect(assets.getByRole('checkbox')).toHaveCount(1);
  await expect(assets.getByRole('checkbox', { name: 'Select assets/sprite-second.png', exact: true })).toBeVisible();
  expect(await readFile(join(root, 'assets', 'sprite.png'))).toEqual(game.png);
  await testInfo.attach('openpixo-assets', { body: await page.screenshot(), contentType: 'image/png' });
});

test('[P1] asset library filters server results and opens engine details', async ({ page, toolsDev }, testInfo) => {
  test.setTimeout(T.xlong);
  const root = join(toolsDev.root, 'scratch', `asset-details-${randomUUID()}`);
  await createOpenPixoGame(root);
  const fake = await createFakeAgentRuntimes({ root: join(toolsDev.root, 'scratch', `agent-${randomUUID()}`), runtimeIds: ['codex'] });
  const config = {
    mode: 'daemon', agentId: 'codex', onboardingCompleted: true, privacyDecisionAt: 1,
    agentCliEnv: { codex: fake.codex.env }, agentModels: { codex: { model: 'default', reasoning: 'default' } },
    skillId: null, telemetry: { metrics: false, content: false, artifactManifest: false },
  };
  expect((await page.request.put('/api/app-config', { data: config })).ok()).toBe(true);
  await page.addInitScript(value => {
    localStorage.setItem('pixo:config', JSON.stringify(value));
    localStorage.setItem('pixo:locale', 'en');
    localStorage.setItem('pixo:locale-source', 'manual');
  }, config);
  const response = await page.request.post('/api/import/folder', { data: { baseDir: root, name: 'Asset detail fixture' } });
  expect(response.ok(), await response.text()).toBe(true);
  const imported = await response.json() as { project: { id: string }; conversationId: string };
  const prefix = `/api/projects/${imported.project.id}/assets`;
  expect((await page.request.post(`${prefix}/tags`, { data: { paths: ['assets/sprite.png'], add: ['hero'] } })).ok()).toBe(true);
  expect((await page.request.put(`${prefix}/grid`, { data: { path: 'assets/sprite.png', grid: { cols: 1, rows: 1 } } })).ok()).toBe(true);
  await page.goto(`/projects/${imported.project.id}/conversations/${imported.conversationId}`, { waitUntil: 'domcontentloaded' });
  const assets = page.getByRole('region', { name: 'Project assets', exact: true });
  await expect(assets.getByRole('checkbox', { name: 'Select assets/sprite.png', exact: true })).toBeVisible();
  const filtered = page.waitForResponse(result => {
    const url = new URL(result.url());
    return result.request().method() === 'GET' && url.pathname === prefix
      && url.searchParams.get('kind') === 'image' && url.searchParams.get('tag') === 'hero'
      && url.searchParams.get('origin') === 'imported' && url.searchParams.get('semantic') === 'grid'
      && url.searchParams.get('query') === 'sprite';
  });
  await assets.getByRole('combobox', { name: 'Asset type' }).selectOption('image');
  // Tag / origin / use filters are folded behind "Filters".
  await assets.getByRole('button', { name: 'Filters', exact: true }).click();
  await assets.getByRole('textbox', { name: 'Filter by tag' }).fill('hero');
  await assets.getByRole('combobox', { name: 'Origin', exact: true }).selectOption('imported');
  await assets.getByRole('combobox', { name: 'Engine semantics' }).selectOption('grid');
  await assets.getByRole('searchbox', { name: 'Search file names or paths' }).fill('sprite');
  expect((await filtered).ok()).toBe(true);
  await expect(assets.getByRole('checkbox')).toHaveCount(1);
  const detailLoaded = page.waitForResponse(result => result.request().method() === 'GET'
    && new URL(result.url()).pathname === `${prefix}/info`);
  await assets.getByRole('button', { name: 'Details for assets/sprite.png', exact: true }).click();
  expect((await detailLoaded).ok()).toBe(true);
  const drawer = page.getByRole('dialog', { name: 'Asset details' });
  await expect(drawer).toContainText('assets/sprite.png');
  await expect(drawer.getByRole('heading', { name: 'Engine metadata' })).toBeVisible();
  await expect(drawer.getByRole('img', { name: 'Frame 1 / 1', exact: true })).toBeVisible();
  await expect(drawer).toContainText('No generation or processing history recorded.');
  await testInfo.attach('asset-library-details', { body: await page.screenshot(), contentType: 'image/png' });
});
