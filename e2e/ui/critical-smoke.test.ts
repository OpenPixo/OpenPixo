import { expect, test } from '@/playwright/suite';
import { ensureRailOpen } from '@/playwright/rail';
import { createProjectViaApi, settingsSurface } from '@/playwright/local-project';
import type { Locator, Page } from '@playwright/test';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { T } from '@/timeouts';

test.describe.configure({ timeout: T.xlong });

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
  // Keep the compact local capability lane independent of workspace listings.
  await page.route('**/api/workspace/directory', async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
});

test('[P0] @critical home loads with the primary entry controls', async ({ page }) => {
  await gotoEntryHome(page);

  // The rail is open by default and carries its own toggle and search item.
  // `ensureRailOpen` is a no-op unless an earlier step collapsed it.
  await expect(page.getByTestId('entry-nav-rail-toggle')).toBeVisible();
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
  await ensureRailOpen(page);
  await expect(page.getByTestId('entry-nav-home')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('entry-nav-search-item')).toBeVisible();
});

test('[P0] @critical settings dialog is reachable from home', async ({ page }) => {
  await gotoEntryHome(page);

  // #5971 cut the rail-footer settings chip; signed out, Settings is the rail's
  // own nav item — `entry-settings-button` is the testid that item carries (see
  // EntryNavRail: it is the ONLY signed-out settings entry, and the e2e
  // contract). Collapsed, the rail is `inert` and it cannot be clicked, so
  // expand first.
  await ensureRailOpen(page);
  await clickVisible(page.getByTestId('entry-settings-button'));
  // From the entry, settings is now a routed page (`role="region"`), not a
  // modal — `.modal-settings` is the class both presentations share.
  const settingsDialog = settingsSurface(page);
  await expect(settingsDialog).toBeVisible();
  // The surface's own <h2> is consumed as its accessible name (aria-labelledby),
  // so assert on the section nav instead — that is what proves settings opened.
  await expect(settingsDialog.getByTestId('settings-nav-execution')).toBeVisible();
});

test('[P0] @critical API-created project reaches the workspace shell', async ({ page }) => {
  await gotoEntryHome(page);
  // NewGameDialog needs a native folder-picker signature; this browser smoke
  // exercises project loading through the production API without that picker.
  const projectId = `critical-smoke-${Date.now()}`;
  await createProjectViaApi(page, projectId, 'Critical smoke project');
  await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' });

  await expectWorkspaceReady(page);
});

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve OpenPixo' });
  if (await privacyDialog.isVisible()) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
    await expect(privacyDialog).toHaveCount(0);
  }
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
}

async function clickVisible(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: T.medium });
  await locator.evaluate((element: HTMLElement) => element.click());
}

async function expectWorkspaceReady(page: Page) {
  await waitForLoadingToClear(page);
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  await expect(page.getByTestId('file-workspace')).toBeVisible();
}

async function waitForLoadingToClear(page: Page) {
  await page.getByText('Loading OpenPixo…').waitFor({ state: 'hidden', timeout: T.long });
}
