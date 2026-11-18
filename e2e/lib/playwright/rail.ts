import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { T } from '@/timeouts';

/**
 * Close the release announcement if it is up. `WhatsNewPopup` is a shared
 * `<Dialog>`, which mounts its scrim on <body> above every piece of chrome
 * (#7635) — while it is open nothing behind it, the rail toggle included, can
 * be clicked. Specs that apply the standard mocks never see it
 * (`suppressWhatsNew`); the ones that drive a real daemon do, whenever the
 * running build ships highlights. Idempotent — no-ops when there is none.
 */
export async function dismissWhatsNewPopup(page: Page): Promise<void> {
  const popup = page.getByTestId('whats-new-popup');
  await popup.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => {});
  if (await popup.isVisible().catch(() => false)) {
    await popup.getByTestId('whats-new-dismiss').click();
    await expect(popup).toBeHidden();
  }
}

/**
 * The entry nav rail is open by default (only an explicit collapse is
 * persisted, under `pixo.entry.railOpen.v2`); its destinations (`entry-nav-*`)
 * are interactable only while it is expanded. The expand affordance is the
 * toggle in the rail's own header (`entry-nav-rail-toggle`), which stays
 * rendered while the rail is collapsed, so no Home round-trip is needed.
 * Idempotent — no-ops when the rail is already open.
 *
 * It asserts on the entry shell's `.entry` layout, so call it from an entry
 * surface, not from a project workspace.
 */
export async function ensureRailOpen(page: Page): Promise<void> {
  await dismissWhatsNewPopup(page);
  const shell = page.locator('.entry');
  const alreadyOpen = await shell
    .evaluate((el) => el.classList.contains('entry--rail-open'))
    .catch(() => false);
  if (!alreadyOpen) {
    const toggle = page.getByTestId('entry-nav-rail-toggle');
    if (!(await toggle.isVisible().catch(() => false))) {
      const homeNav = page.getByTestId('workspace-home-nav');
      if (await homeNav.isVisible().catch(() => false)) {
        await homeNav.click();
      }
    }
    await expect(toggle).toBeVisible();
    // Bounded on purpose. This config sets no `actionTimeout`, so a bare
    // `click()` inherits Playwright's default of 0 — no limit — and an
    // unclickable toggle does not reject, it hangs until the whole test's
    // budget runs out. Callers that wrap this helper in `.catch(() => {})`
    // can only swallow a rejection, so without a bound their opt-out silently becomes
    // the opposite — the flow dies rather than skipping the rail. That is not
    // hypothetical: 8d0b542d0a raised `.backdrop` to `z-index: 1500` over the
    // `z-index: 120` tabs bar, the hit-target check stopped passing, and a UI
    // P0 burned ~120s before failing on the NEXT action (`page.goto`), naming
    // the wrong culprit.
    //
    // `T.short` (3s local / 6s CI) rather than a longer tier: visibility was
    // just asserted above, so all that remains is Playwright's stability /
    // hit-target / enabled polling, and this repo's UI transitions budget
    // ~200ms (root AGENTS.md) — 3s is an order of magnitude of headroom, and
    // `T` already doubles it on CI for slower machines. Longer would not fit:
    // `test:ui:extended` runs rail consumers under `PIXO_PLAYWRIGHT_TIMEOUT=10000`,
    // where a 10s+ bound is no bound at all. A bound can only turn an
    // unbounded hang into a fast, attributable failure; it cannot fail a click
    // that would have landed inside it.
    await toggle.click({ timeout: T.short });
  }
  await expect(page.locator('.entry')).toHaveClass(/entry--rail-open/);
  await expect(page.locator('.entry-nav-rail')).not.toHaveAttribute('aria-hidden', 'true');
}

/**
 * Puts the entry shell on its `projects` view.
 *
 * Prefer a real navigation over synthetic `history.pushState` + `popstate`.
 * Next.js App Router patches History in dev; a foreign pushState can leave
 * `window.location` on `/` while the custom client router never commits
 * `/projects`, which is exactly the CI signature that times out waiting for
 * `/\/projects$/`. `page.goto` is the same path every other projects-entry
 * helper already uses (`openNewProjectFromProjectsView`, entry-chrome).
 *
 * `apps/web` mounts `src/App` through `dynamic(..., { ssr: false })`, so
 * `domcontentloaded` resolves while the DOM still holds the boot shell —
 * wait that out with `T.long` before asserting the destination.
 */
async function openProjectsEntryView(page: Page): Promise<void> {
  const alreadyThere = /\/projects\/?$/.test(new URL(page.url()).pathname);
  if (!alreadyThere) {
    await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  }
  await page
    .getByText('Loading OpenPixo…')
    .waitFor({ state: 'hidden', timeout: T.long })
    .catch(() => {});
  await expect(page).toHaveURL(/\/projects\/?$/, { timeout: T.long });
  await expect(page.getByTestId('entry-view-projects')).toBeVisible({ timeout: T.long });
}

/**
 * Clicks 我的游戏's New game button and waits for the game setup dialog, the same
 * one the rail's New game opens. (It used to open a media-project form, removed
 * 2026-11-18; tests that need a media project create it through the API.)
 */
export async function openNewGameFromProjectsView(page: Page): Promise<void> {
  await openProjectsEntryView(page);
  await dismissWhatsNewPopup(page);
  const projectsView = page.getByTestId('entry-view-projects');
  const createButton = projectsView
    .getByTestId('designs-new-project')
    .or(projectsView.getByTestId('designs-empty-new-project'))
    .first();
  await expect(createButton).toBeVisible({ timeout: T.long });
  await createButton.click();
  await expect(page.getByRole('dialog').filter({ hasText: /Step 1 of/ })).toBeVisible({ timeout: T.long });
  await expect(page.getByTestId('new-project-modal')).toHaveCount(0);
}
