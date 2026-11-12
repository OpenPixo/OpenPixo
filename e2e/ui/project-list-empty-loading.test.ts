import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';
import { applyStandardMocks } from '../lib/playwright/mock-factory.js';

test('[P1] empty personal list, blank project return, and denied-list recovery @merge-extra', async ({ page, request, toolsDev }, testInfo) => {
  await applyStandardMocks(page);
  const listPath = '/api/projects';
  const emptyText = 'Create a project here first. It stays private until you move it into the team space.';
  const failures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && /\/api\/(workspaces\/.*\/projects|runs)/.test(response.url())) failures.push(response.url());
  });

  await page.goto('/drafts');
  await expect(page.getByText(emptyText)).toBeVisible({ timeout: T.long });
  await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('empty-list.png') });

  const projectId = `empty-loading-${Date.now()}`;
  const create = await request.post(toolsDev.url.daemon('/api/projects'), {
    data: { id: projectId, name: 'Blank project loading regression', skillId: null, },
  });
  expect(create.ok()).toBeTruthy();
  try {
    const list = await request.get(toolsDev.url.daemon(listPath), {
      params: { view: 'all' },
    });
    expect(list.status()).toBe(200);
    expect((await list.json()).projects.some((row: { id: string }) => row.id === projectId)).toBe(true);
    await page.reload();
    await expect(page.getByTestId('recent-projects-strip').getByText('Blank project loading regression')).toBeVisible({ timeout: T.long });
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: T.long });
    await page.goBack();
    await expect(page.getByTestId('recent-projects-strip').getByText('Blank project loading regression')).toBeVisible({ timeout: T.long });
    expect(failures).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('blank-project-return.png') });
  } finally {
    const removed = await request.delete(toolsDev.url.daemon(`/api/projects/${projectId}`), {
    });
    expect(removed.ok()).toBeTruthy();
  }

  let denied = true;
  await page.route(`**${listPath}*`, async (route) => {
    if (!denied) return route.fallback();
    await route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', retryable: true } } });
  });
  await page.reload();
  const error = page.getByRole('alert').filter({ hasText: 'Could not load projects' });
  await expect(error).toBeVisible({ timeout: T.long });
  await page.screenshot({ path: testInfo.outputPath('list-failure.png') });
  denied = false;
  await error.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText(emptyText)).toBeVisible({ timeout: T.long });
  await expect(error).toHaveCount(0);
});
