import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';

// A real pointer press and release anywhere on a Workshop card must open the item.
// The card zooms its cover on hover; that animation must not take the release.
test('[P1] clicking anywhere on a Workshop card opens its item page', async ({ page }) => {
  test.setTimeout(T.xlong);
  const config = { mode: 'daemon', onboardingCompleted: true, privacyDecisionAt: 1, skillId: null,
    telemetry: { metrics: false, content: false, artifactManifest: false } };
  expect((await page.request.put('/api/app-config', { data: config })).ok()).toBe(true);
  await page.addInitScript(value => {
    localStorage.setItem('pixo:config', JSON.stringify(value));
    localStorage.setItem('pixo:locale', 'en');
    localStorage.setItem('pixo:locale-source', 'manual');
  }, config);

  for (const kind of ['asset-pack', 'skill']) {
    await page.goto('/store', { waitUntil: 'domcontentloaded' });
    const card = page.locator(`article[data-kind="${kind}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    // Start outside the card so the press arrives together with the hover animation.
    await page.mouse.move(box.x + box.width + 200, box.y + box.height + 200);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.25);
    await expect(page).toHaveURL(/\/store\/openpixo%2F/, { timeout: T.medium });
    const itemPage = page.getByTestId('store-item-page');
    await expect(itemPage).toBeVisible();
    // The grid already loaded this cover, so the page's copies arrive from cache and must still show.
    const covers = itemPage.locator('[data-cover-state]');
    await expect.poll(() => covers.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.coverState)),
      { timeout: T.medium }).toEqual(['loaded', 'loaded']);
  }

  // The card's own action keeps its meaning: Buy opens the purchase dialog, not the item page.
  await page.goto('/store', { waitUntil: 'domcontentloaded' });
  const pack = page.locator('article[data-kind="asset-pack"]').first();
  await pack.scrollIntoViewIfNeeded();
  await pack.getByRole('button', { name: /^Buy / }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/store$/);
});
