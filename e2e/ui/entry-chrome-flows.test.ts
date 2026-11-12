import { expect, test } from '@/playwright/suite';
import { ensureRailOpen, openNewProjectModal } from '@/playwright/rail';
import { settingsSurface } from '@/playwright/local-project';
import { expectStableCount } from '@/playwright/assertions';
import type { Page, Request } from '@playwright/test';
import {
  applyStandardMocks,
  fulfillAgentsRoute,
  routeSuccessfulRuns,
  STORAGE_KEY,
} from '@/playwright/mock-factory';
import { T } from '@/timeouts';
const LOCAL_CLI_LABEL = /Local CLI|Local coding agent|本机 CLI|本地 CLI/i;
const STARTER_PLUGIN = makeStarterPlugin({
  id: 'localized-plugin',
  title: 'Localized Plugin',
  mode: 'prototype',
  featured: true,
  query: 'Make a {{topic}} brief.',
  inputs: [{ name: 'topic', type: 'string', default: 'design systems' }],
});
const DESIGN_SYSTEMS = [
  {
    id: 'agentic',
    title: 'Agentic',
    category: 'Productivity & SaaS',
    summary: 'Conversational AI-first interface with minimal controls.',
    surface: 'web',
    swatches: ['#ff5a1f', '#111827'],
  },
  {
    id: 'airbnb',
    title: 'Airbnb',
    category: 'E-Commerce & Retail',
    summary: 'Travel marketplace with warm coral accents.',
    surface: 'web',
    swatches: ['#a3165b', '#ff385c'],
  },
  {
    id: 'motion-poster',
    title: 'Motion Poster',
    category: 'Design & Creative',
    summary: 'Motion-first visual system for video concepts.',
    surface: 'video',
    swatches: ['#111827', '#38bdf8'],
  },
] as const;

test.describe.configure({ timeout: T.xlong });

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
});

test('[P0] @critical entry chrome exposes the primary home creation surface and settings entry', async ({ page }, testInfo) => {
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { projects: [] } });
      return;
    }
    await route.continue();
  });

  await gotoEntryHome(page);
  await expect(page.getByTestId('recent-projects-strip')).toHaveCount(0);
  // The nav rail is open by default and carries its own toggle and search item.
  await expect(page.getByTestId('entry-nav-search-item')).toBeVisible();
  await expect(page.getByTestId('entry-nav-rail-toggle')).toBeVisible();
  await ensureRailOpen(page);
  await expect(page.locator('.entry-nav-rail')).toBeVisible();
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
  await expect(page.getByTestId('home-hero-plus-trigger')).toBeVisible();
  // Send needs a prompt or a staged file; the creation-type pills and the
  // placeholder carousel it could once run are gone (37eafa2cc, pinned by
  // HomeHero.creation-types-removed.test.tsx).
  await expect(page.getByTestId('home-hero-submit')).toBeDisabled();
  await expect(page.getByTestId('working-dir-picker')).toBeVisible();
  await testInfo.attach('home-composer', { body: await page.screenshot(), contentType: 'image/png' });

  // The pet picker rail was removed; pet adoption now lives in
  // Settings → Pet exclusively. Make sure no rail leaks back into the
  // entry layout.
  await expect(page.locator('.pet-rail')).toHaveCount(0);

  await page.getByTestId('entry-settings-button').click();
  // From the entry, settings routes to a page surface rather than a modal.
  const settingsDialog = settingsSurface(page);
  await expect(settingsDialog).toBeVisible();
  // The surface's own <h2> is consumed as its accessible name (aria-labelledby),
  // so assert on the section nav instead.
  await expect(settingsDialog.getByTestId('settings-nav-execution')).toBeVisible();
  await expect(settingsDialog.getByRole('button', { name: /hide pet picker/i })).toHaveCount(0);
  await expect(settingsDialog.getByRole('button', { name: /show pet picker/i })).toHaveCount(0);
});

test('[P0] @critical home hero submit creates a project and lands on a usable workspace', async ({ page }) => {
  await routeSuccessfulRuns(page, { runIdPrefix: 'home-entry-workspace-smoke' });

  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');
  await input.fill('Create a risk dashboard workspace smoke.');
  await expect(page.getByTestId('home-hero-submit')).toBeEnabled();

  const projectRequestPromise = page.waitForRequest(isCreateProjectRequest);
  await page.getByTestId('home-hero-submit').click();
  const projectRequest = await projectRequestPromise;
  const projectBody = projectRequest.postDataJSON() as {
    pendingPrompt?: string;
    metadata?: { kind?: string };
  };
  expect(projectBody.pendingPrompt).toBe('Create a risk dashboard workspace smoke.');
  expect(typeof projectBody.metadata?.kind).toBe('string');

  await expect(page).toHaveURL(/\/projects\//, { timeout: 15_000 });
  // The project is named from the prompt and titled at the head of the chat column.
  await expect(page.getByRole('heading', { level: 1, name: /Risk Dashboard Workspace Smoke/i })).toBeVisible();
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  await expect(page.getByTestId('file-workspace')).toBeVisible();
});

test('[P1] onboarding lands on the home composer without a recommended-start strip', async ({ page }) => {
  const createdBodies: Array<Record<string, unknown>> = [];
  const runBodies: Array<Record<string, unknown>> = [];
  const runRequests = await routeSuccessfulRuns(page, {
    bodies: runBodies,
    runIdPrefix: 'recommendation-should-not-auto-send',
    events: false,
  });
  const projectId = `onboarding-recommendation-${Date.now()}`;
  await page.addInitScript((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        mode: 'daemon',
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        agentId: 'mock',
        skillId: null,
        onboardingCompleted: false,
        agentModels: {},
        privacyDecisionAt: 1,
        telemetry: { metrics: false, content: false, artifactManifest: false },
      }),
    );
  }, STORAGE_KEY);
  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          config: {
            onboardingCompleted: false,
            agentId: 'mock',
            skillId: null,
            agentModels: {},
            privacyDecisionAt: 1,
            telemetry: { metrics: false, content: false, artifactManifest: false },
          },
        },
      });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    createdBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      json: {
        project: {
          id: projectId,
          name: 'Product UI Prototype',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          pendingPrompt: createdBodies[0]?.pendingPrompt,
          metadata: createdBodies[0]?.metadata ?? { kind: 'prototype' },
        },
        conversationId: `${projectId}-conversation`,
      },
    });
  });
  await page.route('**/api/agents/test', route => route.fulfill({ json: { ok: true, latencyMs: 1 } }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Loading OpenPixo…').waitFor({ state: 'hidden', timeout: T.long });

  const primary = page.getByTestId('onboarding-primary');
  await expect(primary).toBeEnabled();
  await primary.click();

  // Finishing onboarding lands the user on Home with the composer
  // ready — and NOT on the old recommended-start strip. That strip (sparkle +
  // 「Start with your first project」 + 全部类型 / 开始创作) sat between the
  // composer and the template line, offering a third way to say what the two
  // around it already said, and has been removed. Nothing may create a project
  // or start a run on the user's behalf on the way here.
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
  await expect(page.getByTestId('home-recommendation')).toHaveCount(0);
  await expect(page.getByTestId('home-recommendation-start')).toHaveCount(0);

  await expectStableCount(() => createdBodies.length, 0, {
    timeout: T.short,
    message: 'finishing onboarding should not create a project automatically',
  });
  await runRequests.expectNone({
    message: 'finishing onboarding should not start a run automatically',
  });
});

test('[P1] entry top navigation matches the current home tab structure', async ({ page }) => {
  await gotoEntryHome(page);
  await ensureRailOpen(page);

  // The rail is header-free: no logo, no in-rail search row — the column
  // starts at the workspace switcher / 首页, and both search and folding live
  // in the chrome row's cluster beside the tabs (#7635).
  await expect(page.getByTestId('entry-nav-logo')).toHaveCount(0);
  await expect(page.getByTestId('entry-nav-collapse')).toHaveCount(0);
  await expect(page.locator('.entry-nav-rail').getByTestId('entry-nav-search')).toHaveCount(0);
  await expect(page.locator('.workspace-tabs-rail-actions').getByTestId('entry-nav-search')).toBeVisible();
  // OPEND-2685: the rail toggle is the cluster's FIRST control (right after
  // the traffic-light space on macOS), the search second.
  await expect(
    page.locator('.workspace-tabs-rail-actions > [data-testid]').first(),
  ).toHaveAttribute('data-testid', 'entry-rail-collapse');
  await expect(page.getByTestId('entry-nav-home')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('entry-nav-community')).toBeVisible();
  await expect(page.locator('.entry-nav-rail__group').getByTestId('entry-nav-design-systems')).toBeVisible();
  await expect(page.locator('.entry-nav-rail__group').getByTestId('entry-nav-plugins')).toBeVisible();
  // #5517's rail dropped the "+ New project", Projects, Automations and
  // Integrations destinations. New project is now the Projects view's own CTA;
  // the removed destinations must not reappear as rail controls.
  await expect(page.getByTestId('entry-nav-new-project')).toHaveCount(0);
  await expect(page.getByTestId('entry-nav-projects')).toHaveCount(0);
  await expect(page.getByTestId('entry-nav-tasks')).toHaveCount(0);
  await expect(page.getByTestId('entry-nav-integrations')).toHaveCount(0);
  // Signed-out settings is the nav group's own item right under 扩展 — #5517
  // dropped the footer settings chip, so the footer carries no settings entry
  // (nor any other nav destination, e.g. plugins).
  await expect(page.locator('.entry-nav-rail__group').getByTestId('entry-settings-button')).toBeVisible();
  await expect(page.locator('.entry-nav-rail__footer').getByTestId('entry-settings-button')).toHaveCount(0);
  await expect(page.locator('.entry-nav-rail__footer').getByTestId('entry-nav-plugins')).toHaveCount(0);

  await expect(page.getByTestId('home-hero-template-picker')).toBeVisible();
  // Nothing is applied on a fresh Home: no plugin chip, no template-driven
  // footer options or presets.
  await expect(page.getByTestId('home-hero-active-plugin')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-footer-options')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-plugin-presets')).toHaveCount(0);
});

test('[P1] home view exposes the redesigned hero, rail recent projects, and the 项目 page', async ({ page }) => {
  await createProject(page, 'Home structure recent project');
  await gotoEntryHome(page);

  const home = page.getByTestId('entry-view-home');
  // OPEND-3140: Home carries no recent-projects grid on the local branch
  // either — the rail's 最近项目 section lists the catalogue.
  await expect(page.getByTestId('recent-projects-strip')).toHaveCount(0);
  await expect(home.locator('.recent-projects')).toHaveCount(0);
  await expect(home.getByTestId('home-hero-template-picker')).toBeVisible();
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(page.getByTestId('entry-nav-home')).toHaveAttribute('aria-current', 'page');
  await ensureRailOpen(page);
  await expect(
    page.getByTestId('entry-nav-recent-item').filter({ hasText: 'Home structure recent project' }),
  ).toBeVisible();

  // The rail's 项目 item opens the browsable catalogue with its controls.
  await page.getByTestId('entry-nav-drafts').click();
  await expect(page).toHaveURL(/\/drafts$/);
  await expect(page.getByTestId('recent-projects-strip')).toBeVisible();
  await expect(
    page.getByTestId('recent-projects-strip').getByText('Home structure recent project', { exact: true }),
  ).toBeVisible();
});

test('[P0] @critical the rail\'s recent projects open a project from Home', async ({ page }) => {
  const created = await createProject(page, 'Recent project entry point');
  await gotoEntryHome(page);
  await ensureRailOpen(page);

  const row = page.getByTestId('entry-nav-recent-item').filter({ hasText: 'Recent project entry point' });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${created.project.id}`));
});

test('[P2] entry chrome avoids horizontal overflow on compact desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await gotoEntryHome(page);

  // The entry topbar is gone (#5517), so the composer card is the widest fixed
  // chrome left on the entry: neither it nor the page may scroll sideways.
  const { pageOverflow, composerOverflow } = await page.evaluate(() => {
    const composer = document.querySelector('[data-testid="home-hero"]');
    return {
      pageOverflow: Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      composerOverflow:
        composer instanceof HTMLElement
          ? Math.max(0, composer.scrollWidth - composer.clientWidth)
          : null,
    };
  });

  expect(composerOverflow).not.toBeNull();
  expect(composerOverflow!).toBeLessThanOrEqual(2);
  expect(pageOverflow).toBeLessThanOrEqual(2);
});

test('[P0] @critical entry execution pill opens the Local CLI and BYOK switcher from Home', async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        mode: 'daemon',
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        agentId: 'codex',
        skillId: null,
        onboardingCompleted: true,
        agentModels: { codex: { model: 'default' } },
        privacyDecisionAt: 1,
        telemetry: { metrics: false, content: false, artifactManifest: false },
      }),
    );
  }, STORAGE_KEY);
  await page.route('**/api/agents**', async (route) => {
    await fulfillAgentsRoute(route, [
      {
        id: 'claude',
        name: 'Claude Code',
        bin: 'claude',
        available: true,
        version: '1.0.0',
        models: [{ id: 'default', label: 'Default' }],
      },
      {
        id: 'codex',
        name: 'Codex CLI',
        bin: 'codex',
        available: true,
        version: '0.80.0',
        models: [{ id: 'default', label: 'Default' }],
      },
      {
        id: 'opencode',
        name: 'OpenCode',
        bin: 'opencode',
        available: true,
        version: '0.5.0',
        models: [{ id: 'default', label: 'Default' }],
      },
    ]);
  });
  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        config: {
          onboardingCompleted: true,
          agentId: 'codex',
          skillId: null,
          agentModels: { codex: { model: 'default' } },
          privacyDecisionAt: 1,
          telemetry: { metrics: false, content: false, artifactManifest: false },
        },
      },
    });
  });

  await gotoEntryHome(page);

  // The pill now lives in the Home composer footer as the compact, icon-only
  // variant: the selected agent + model are on its accessible name, and the
  // popover drops the Local CLI / BYOK segmented control in favour of the
  // agent list plus an Execution-settings entry.
  const pill = page.getByTestId('inline-model-switcher-chip');
  await expect(pill).toHaveAttribute('aria-label', /Codex CLI/i);
  await pill.click();

  const popover = page.getByTestId('inline-model-switcher-popover');
  await expect(popover).toBeVisible();
  await expect(popover.getByTestId('inline-model-switcher-mode-daemon')).toHaveCount(0);
  await expect(popover.getByTestId('inline-model-switcher-agent-claude')).toHaveCount(0);
  await expect(popover.getByTestId('inline-model-switcher-open-settings')).toBeVisible();

  await page.getByTestId('inline-model-switcher-open-settings').click();
  const settings = settingsSurface(page);
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('tab', { name: LOCAL_CLI_LABEL })).toBeVisible();
});

test('[P1] Settings About reads desktop updater status and runs a manual update check', async ({ page }) => {
  await page.addInitScript(() => {
    const idleStatus = {
      arch: 'arm64',
      capabilities: {
        canApplyInPlace: false,
        canDownload: true,
        canOpenInstaller: true,
        requiresManualInstall: false,
      },
      channel: 'beta',
      currentVersion: '0.13.4',
      enabled: true,
      mode: 'package-launcher',
      platform: 'darwin',
      state: 'idle',
      supported: true,
    };
    const checkedStatus = {
      ...idleStatus,
      lastCheckedAt: '2026-06-30T00:00:00.000Z',
      state: 'not-available',
    };
    (window as unknown as { __pixoUpdaterCalls?: string[] }).__pixoUpdaterCalls = [];
    (window as unknown as { __pixo__?: unknown }).__pixo__ = {
      version: 2,
      client: { type: 'desktop', platform: 'darwin', osLocale: 'en-US' },
      browser: { clearData: async () => ({ ok: true }) },
      capture: { page: async () => ({ ok: false, reason: 'not mocked' }) },
      pdf: { print: async () => ({ ok: true }) },
      pet: { setVisible: () => {} },
      project: {
        pickAndImport: async () => ({ ok: false, canceled: true }),
        pickAndReplaceWorkingDir: async () => ({ ok: false, canceled: true }),
      },
      shell: {
        openExternal: async () => ({ ok: true }),
        openPath: async () => ({ ok: true }),
      },
      updater: {
        status: async () => idleStatus,
        check: async () => {
          (window as unknown as { __pixoUpdaterCalls: string[] }).__pixoUpdaterCalls.push('check');
          return checkedStatus;
        },
        download: async () => checkedStatus,
        install: async () => checkedStatus,
        quit: async () => ({ ok: true }),
        setMenuLabels: async () => ({ ok: true }),
        subscribe: () => () => {},
        subscribeOpenDialog: () => () => {},
      },
    };
  });
  await page.route('**/api/version', async (route) => {
    await route.fulfill({
      json: {
        version: {
          version: '0.13.4',
          channel: 'beta',
          packaged: true,
          platform: 'darwin',
          arch: 'arm64',
        },
      },
    });
  });

  await gotoEntryHome(page);
  await page.getByTestId('entry-settings-menu-trigger').click();
  await page.getByTestId('entry-settings-open-details').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: /^About\b/i }).click();
  await expect(dialog.locator('.settings-about-version-num')).toContainText('0.13.4');
  await expect(dialog.locator('.settings-about-update-status')).toContainText('Not checked yet');

  await dialog.getByRole('button', { name: 'Check for updates' }).click();
  await expect(dialog.locator('.settings-about-update-status')).toContainText('You are already on the latest version.');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __pixoUpdaterCalls?: string[] }).__pixoUpdaterCalls ?? []))
    .toEqual(['check']);
});

// The entry help launcher (the X + Discord community links) went away with the
// entry topbar in #5517, as did the topbar's "Use everywhere" button. Its spec
// is gone; the Use-everywhere guide itself
// still lives on the Integrations view and is covered below.
test('[P1] Settings About surfaces prerelease updater check failures with retry affordance', async ({ page }) => {
  await page.addInitScript(() => {
    const idleStatus = {
      arch: 'arm64',
      capabilities: {
        canApplyInPlace: false,
        canDownload: true,
        canOpenInstaller: true,
        requiresManualInstall: false,
      },
      channel: 'prerelease',
      currentVersion: '0.16.0-prerelease.1',
      enabled: true,
      mode: 'package-launcher',
      platform: 'darwin',
      state: 'idle',
      supported: true,
    };
    const failedStatus = {
      ...idleStatus,
      error: {
        code: 'metadata-fetch-failed',
        message: 'prerelease metadata returned 503',
      },
      lastCheckedAt: '2026-07-21T12:00:00.000Z',
      state: 'error',
    };
    (window as unknown as { __pixoUpdaterCalls?: string[] }).__pixoUpdaterCalls = [];
    (window as unknown as { __pixo__?: unknown }).__pixo__ = {
      version: 2,
      client: { type: 'desktop', platform: 'darwin', osLocale: 'en-US' },
      browser: { clearData: async () => ({ ok: true }) },
      capture: { page: async () => ({ ok: false, reason: 'not mocked' }) },
      pdf: { print: async () => ({ ok: true }) },
      pet: { setVisible: () => {} },
      project: {
        pickAndImport: async () => ({ ok: false, canceled: true }),
        pickAndReplaceWorkingDir: async () => ({ ok: false, canceled: true }),
      },
      shell: {
        openExternal: async () => ({ ok: true }),
        openPath: async () => ({ ok: true }),
      },
      updater: {
        status: async () => idleStatus,
        check: async () => {
          (window as unknown as { __pixoUpdaterCalls: string[] }).__pixoUpdaterCalls.push('check');
          return failedStatus;
        },
        download: async () => failedStatus,
        install: async () => failedStatus,
        quit: async () => ({ ok: true }),
        setMenuLabels: async () => ({ ok: true }),
        subscribe: () => () => {},
        subscribeOpenDialog: () => () => {},
      },
    };
  });
  await page.route('**/api/version', async (route) => {
    await route.fulfill({
      json: {
        version: {
          version: '0.16.0-prerelease.1',
          channel: 'prerelease',
          packaged: true,
          platform: 'darwin',
          arch: 'arm64',
        },
      },
    });
  });

  await gotoEntryHome(page);
  await page.getByTestId('entry-settings-menu-trigger').click();
  await page.getByTestId('entry-settings-open-details').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: /^About\b/i }).click();
  await expect(dialog.locator('.settings-about-version-num')).toContainText('0.16.0-prerelease.1');
  await expect(dialog.locator('.settings-about-update-status')).toContainText('Not checked yet');

  await dialog.getByRole('button', { name: 'Check for updates' }).click();
  await expect(dialog.locator('.settings-about-update-status')).toContainText('Update failed');
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __pixoUpdaterCalls?: string[] }).__pixoUpdaterCalls ?? []))
    .toEqual(['check']);
});

test('[P1] Settings BYOK connection failures emit a classified analytics error code', async ({ page }) => {
  const byokConfig = {
    mode: 'api',
    apiKey: 'sk-openai-e2e',
    apiProtocol: 'openai',
    apiVersion: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiProviderBaseUrl: 'https://api.openai.com/v1',
    agentId: 'codex',
    skillId: null,
    onboardingCompleted: true,
    privacyDecisionAt: 1,
    telemetry: { metrics: true, content: false, artifactManifest: false },
    agentModels: { codex: { model: 'default' } },
  };
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STORAGE_KEY, value: byokConfig },
  );

  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({ json: { config: byokConfig } });
  });
  await page.route('**/api/analytics/config', async (route) => {
    const origin = new URL(route.request().url()).origin;
    await route.fulfill({
      json: {
        enabled: true,
        key: 'phc_e2e',
        host: origin,
        env: 'test',
        installationId: 'e2e-byok-error-device',
      },
    });
  });

  const analyticsPayloads: string[] = [];
  for (const pattern of ['**/e/**', '**/batch/**', '**/capture/**', '**/decide/**']) {
    await page.route(pattern, async (route) => {
      analyticsPayloads.push(route.request().postData() ?? route.request().url());
      await route.fulfill({ json: { status: 1 } });
    });
  }

  await page.route('**/api/test/connection', async (route) => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({
      mode: 'provider',
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai-e2e',
      model: 'gpt-4o-mini',
    });
    await route.fulfill({
      json: {
        ok: false,
        kind: 'unknown',
        status: 402,
        latencyMs: 12,
        model: 'gpt-4o-mini',
        detail: 'provider reported insufficient credits',
      },
    });
  });

  await gotoEntryHome(page);
  await page.getByTestId('entry-settings-menu-trigger').click();
  await page.getByTestId('entry-settings-open-details').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const connectionTest = dialog.locator('.settings-byok-connection-test');
  await expect(connectionTest).toBeVisible();
  await connectionTest.getByRole('button', { name: /^Test$/ }).click();
  await expect(dialog.getByRole('alert')).toContainText(/insufficient credits/i);

  await expect
    .poll(() => analyticsPayloads.join('\n'), { timeout: 15_000 })
    .toContain('settings_byok_test_result');
  const captured = analyticsPayloads.join('\n');
  expect(captured).toContain('HTTP_402');
  expect(captured).toContain('unknown');
});


test('[P1] Use everywhere guide uses daemon MCP install info and copies an agent guide', async ({ page }) => {
  await page.addInitScript(() => {
    const store: string[] = [];
    Object.defineProperty(window, '__copiedTexts', {
      value: store,
      configurable: true,
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText(text: string) {
          store.push(text);
          return Promise.resolve();
        },
      },
      configurable: true,
    });
  });
  await page.route('**/api/mcp/install-info', async (route) => {
    await route.fulfill({
      json: {
        command: '/Applications/OpenPixo.app/Contents/MacOS/od',
        args: ['mcp', '--daemon-url', 'http://127.0.0.1:7456'],
        env: {
          PIXO_DATA_DIR: '/Users/test/.openpixo',
        },
      },
    });
  });

  await gotoEntryHome(page);
  // With the topbar's "Use everywhere" button gone (#5517) the Integrations
  // route is the entry; its default tab is still the Use everywhere guide.
  await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
  await page.getByText('Loading OpenPixo…').waitFor({ state: 'hidden', timeout: T.long });
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  // Landing on the route directly opens the view's own default tab, so select
  // the Use everywhere guide explicitly.
  await page.getByTestId('integrations-tab-use-everywhere').click();
  await expect(page.getByTestId('integrations-tab-use-everywhere')).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByTestId('use-everywhere-tab-mcp').click();
  const mcpSection = page.getByTestId('use-everywhere-section-mcp');
  await expect(mcpSection).toContainText('/Applications/OpenPixo.app/Contents/MacOS/od');
  await expect(mcpSection).toContainText('PIXO_DATA_DIR');

  await page.getByTestId('use-everywhere-copy-guide').click();
  await expect(page.getByTestId('use-everywhere-copy-guide')).toContainText(/Copied|已复制|已複製/i);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copiedTexts?: string[] }).__copiedTexts?.at(-1) ?? ''))
    .toContain('/Applications/OpenPixo.app/Contents/MacOS/od');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copiedTexts?: string[] }).__copiedTexts?.at(-1) ?? ''))
    .toMatch(/http:\/\/127\.0\.0\.1:\d+\/api\/mcp\/install-info/);

  await page.getByTestId('use-everywhere-open-settings').click();
  await expect(page.getByTestId('integrations-tab-mcp')).toHaveAttribute('aria-selected', 'true');
});

test('[P2] home topbar overlays close on outside click, Escape, and Settings open', async ({ page }) => {
  await gotoEntryHome(page);

  const pill = page.getByTestId('inline-model-switcher-chip');
  const executionPopover = page.getByTestId('inline-model-switcher-popover');

  await pill.click();
  await expect(executionPopover).toBeVisible();

  // Settings is a rail nav item now, and the collapsed rail is `inert`.
  await ensureRailOpen(page);
  await page.getByTestId('entry-settings-button').click();
  await expect(executionPopover).toHaveCount(0);
  await expect(settingsSurface(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settingsSurface(page)).toHaveCount(0);

  await pill.click();
  await expect(executionPopover).toBeVisible();

  await page.getByTestId('home-hero').click();
  await expect(executionPopover).toHaveCount(0);

  await pill.click();
  await expect(executionPopover).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(executionPopover).toHaveCount(0);
});

// The execution pill is no longer entry-wide chrome: with the topbar gone
// (#5517) `EntryShell` hands the switcher to `HomeView` only, so it renders
// inside the Home composer footer and does not follow the user to secondary
// entry pages. This spec now pins the rail's surviving destinations plus the
// pill at its new, Home-only home.
test('[P0] signed-out Local setup can navigate the surviving rail destinations', async ({ page }) => {
  await routeDesignSystems(page);
  await gotoEntryHome(page);

  const destinations = [
    { nav: 'entry-nav-design-systems', url: /\/design-systems$/ },
    { nav: 'entry-nav-plugins', url: /\/plugins$/ },
    { nav: 'entry-nav-community', url: /\/community$/ },
  ];

  for (const destination of destinations) {
    await ensureRailOpen(page);
    await page.getByTestId(destination.nav).click();
    await expect(page).toHaveURL(destination.url);
    await expect(page.getByTestId(destination.nav)).toHaveAttribute('aria-current', 'page');
  }

  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-home').click();
  await expect(page.getByTestId('home-hero')).toBeVisible();

  const pill = page.getByTestId('inline-model-switcher-chip');
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(page.getByTestId('inline-model-switcher-popover')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inline-model-switcher-popover')).toHaveCount(0);
});

test('[P0] @critical home working directory creates the project with linked dirs instead of importing files', async ({ page }) => {
  const workingDir = '/Users/mac/Projects/Dashboard-UI-Liquid-Glass';
  await page.route('**/api/recent-dirs', async (route) => {
    await route.fulfill({ json: { dirs: [workingDir] } });
  });
  await page.route('**/api/dialog/open-folder', async (route) => {
    await route.fulfill({ json: { path: workingDir } });
  });
  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        json: {
          config: {
            recentLinkedDirs: [workingDir],
          },
        },
      });
      return;
    }
    await route.fallback();
  });

  await gotoEntryHome(page);

  await page.getByTestId('working-dir-trigger').click();
  await page.getByTestId('working-dir-pick').click();
  await expect(page.getByTestId('working-dir-trigger')).toContainText('Dashboard-UI-Liquid-Glass');

  const input = page.getByTestId('home-hero-input');
  await input.fill('Create a premium dashboard for operations review.');

  const projectRequestPromise = page.waitForRequest(isCreateProjectRequest);
  await page.getByTestId('home-hero-submit').click();

  const request = await projectRequestPromise;
  const body = request.postDataJSON() as {
    metadata?: { linkedDirs?: string[]; baseDir?: string; userWorkingDir?: string };
    pendingPrompt?: string;
    conversationMode?: string;
  };
  expect(body.pendingPrompt).toBe('Create a premium dashboard for operations review.');
  expect(body.conversationMode).toBe('design');
  expect(body.metadata?.linkedDirs).toEqual([workingDir]);
  expect(body.metadata?.baseDir).toBeUndefined();
  expect(body.metadata?.userWorkingDir).toBeUndefined();
});

test('[P0] @critical clearing the home working directory removes linked dirs from project creation', async ({ page }) => {
  const workingDir = '/Users/mac/Projects/Dashboard-UI-Liquid-Glass';
  await page.route('**/api/recent-dirs', async (route) => {
    await route.fulfill({ json: { dirs: [workingDir] } });
  });
  await page.route('**/api/dialog/open-folder', async (route) => {
    await route.fulfill({ json: { path: workingDir } });
  });
  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        json: {
          config: {
            recentLinkedDirs: [workingDir],
          },
        },
      });
      return;
    }
    await route.fallback();
  });

  await gotoEntryHome(page);

  await page.getByTestId('working-dir-trigger').click();
  await page.getByTestId('working-dir-pick').click();
  await expect(page.getByTestId('working-dir-trigger')).toContainText('Dashboard-UI-Liquid-Glass');

  await page.getByTestId('working-dir-trigger').click();
  await page.getByTestId('working-dir-clear').click();
  await expect(page.getByTestId('working-dir-trigger')).toContainText('Working directory');

  await page.getByTestId('home-hero-input').fill('Create a premium dashboard without local folder context.');

  const projectRequestPromise = page.waitForRequest(isCreateProjectRequest);
  await page.getByTestId('home-hero-submit').click();

  const request = await projectRequestPromise;
  const body = request.postDataJSON() as {
    metadata?: { linkedDirs?: string[]; baseDir?: string; userWorkingDir?: string };
    pendingPrompt?: string;
  };
  expect(body.pendingPrompt).toBe('Create a premium dashboard without local folder context.');
  expect(body.metadata?.linkedDirs).toBeUndefined();
  expect(body.metadata?.baseDir).toBeUndefined();
  expect(body.metadata?.userWorkingDir).toBeUndefined();
});

test('[P0] @critical home hero input keeps Shift+Enter as a newline and submits on Enter', async ({ page }) => {
  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');
  const submit = page.getByTestId('home-hero-submit');

  await expect(submit).toBeDisabled();
  await input.click();
  await input.fill('Line one');
  await input.press('Shift+Enter');
  await input.type('Line two');
  // Lexical renders the soft break as separate block nodes, so the editor's
  // textContent collapses the newline; assert both lines are present rather
  // than an exact "\n"-joined value. The newline itself is verified below
  // against the create-project/run payloads.
  await expect(input).toContainText('Line one');
  await expect(input).toContainText('Line two');
  await expect(page).toHaveURL(/\/$/);
  await expect(submit).toBeEnabled();

  const projectRequestPromise = page.waitForRequest(isCreateProjectRequest);
  const runRequestPromise = page.waitForRequest(isCreateRunRequest);
  await input.press('Enter');

  const projectRequest = await projectRequestPromise;
  const projectBody = projectRequest.postDataJSON() as { pendingPrompt?: string };
  expect(projectBody.pendingPrompt).toBe('Line one\nLine two');

  const runRequest = await runRequestPromise;
  const runBody = runRequest.postDataJSON() as { message?: string };
  expect(runBody.message).toContain('Line one\nLine two');
  await expect(page).toHaveURL(/\/projects\//);
});

test('[P0] signed-out Local setup can apply a plugin from the Home composer', async ({ page }) => {
  await page.route('**/api/plugins', async (route) => {
    await route.fulfill({
      json: {
        plugins: [STARTER_PLUGIN],
      },
    });
  });

  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');
  await input.click();
  await input.fill('@local');

  const picker = page.getByTestId('home-hero-plugin-picker');
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('option', { name: /Localized Plugin/i })).toBeVisible();

  await input.press('Enter');

  await expect(picker).toHaveCount(0);
  await expect(input).toHaveText('@Localized Plugin');
});

test('[P1] disabled skills are filtered from the home hero mention picker', async ({ page }) => {
  await page.route('**/api/skills', async (route) => {
    await route.fulfill({
      json: {
        skills: [
          skillSummary('enabled-home-skill', 'Enabled Home Skill', 'prototype', 'web', []),
          skillSummary('disabled-home-skill', 'Disabled Home Skill', 'prototype', 'web', []),
        ],
      },
    });
  });
  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        config: {
          onboardingCompleted: true,
          agentId: 'mock',
          skillId: null,
          disabledSkills: ['disabled-home-skill'],
          agentModels: {},
          privacyDecisionAt: 1,
          telemetry: { metrics: false, content: false, artifactManifest: false },
        },
      },
    });
  });

  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');
  await input.click();
  await input.fill('@skill');

  const picker = page.getByTestId('home-hero-plugin-picker');
  await expect(picker).toBeVisible();
  await picker.getByRole('tab', { name: /Skills/i }).click();
  await expect(picker.getByRole('option', { name: /Enabled Home Skill/i })).toBeVisible();
  await expect(picker.getByRole('option', { name: /Disabled Home Skill/i })).toHaveCount(0);
});

test('[P0] @critical home hero attachment input stages files, enables submit, and supports removal', async ({ page }) => {
  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-file-input');
  const submit = page.getByTestId('home-hero-submit');
  // With no prompt, the staged file is the only thing that makes Send available.
  await expect(submit).toBeDisabled();

  await input.setInputFiles({
    name: 'brief.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Attachment staged from the home hero.\n', 'utf8'),
  });

  const staged = page.getByTestId('home-hero-staged-files');
  await expect(staged).toBeVisible();
  await expect(staged.getByText('brief.txt', { exact: true })).toBeVisible();
  await expect(submit).toBeEnabled();

  await page.getByRole('button', { name: /Remove brief\.txt/i }).click();
  await expect(staged).toHaveCount(0);
  await expect(submit).toBeDisabled();
});

test('[P0] @critical home hero attachment-only submit uploads the file and sends it with the first message', async ({ page }) => {
  await gotoEntryHome(page);

  const uploadResponse = page.waitForResponse(
    (resp) =>
      /\/api\/projects\/[^/]+\/upload$/.test(new URL(resp.url()).pathname) &&
      resp.request().method() === 'POST',
  );

  await page.getByTestId('home-hero-file-input').setInputFiles({
    name: 'reference.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Attachment-only home submission.\n', 'utf8'),
  });

  await expect(page.getByTestId('home-hero-staged-files')).toBeVisible();
  await expect(page.getByTestId('home-hero-staged-files')).toContainText('reference.txt');
  await expect(page.getByTestId('home-hero-submit')).toBeEnabled();

  await page.getByTestId('home-hero-submit').click();
  await expect((await uploadResponse).ok()).toBeTruthy();

  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.locator('.user-attachments').getByText('reference.txt', { exact: true })).toBeVisible();
});

test('[P1] collapsed rail stays out of the keyboard tab order on the home view', async ({ page }) => {
  await gotoEntryHome(page);

  // Collapsed by default: the rail must be inert so its still-mounted logo and
  // nav buttons cannot receive keyboard focus before the visible toggle/hero.
  const rail = page.locator('.entry-nav-rail');
  await expect(rail).toHaveAttribute('inert', '');

  // Tabbing from the top of the document must never land inside the rail.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const inRail = await page.evaluate(
      () => !!document.activeElement?.closest('.entry-nav-rail'),
    );
    expect(inRail).toBe(false);
  }

  // Once expanded the rail becomes interactive again and drops inert.
  await ensureRailOpen(page);
  await expect(rail).not.toHaveAttribute('inert', '');
  await expect(page.getByTestId('entry-nav-home')).toBeVisible();
});

test('[P1] rail can be collapsed again on coarse-pointer / non-hover devices', async ({ page }) => {
  // Emulate a touch device where `(hover: none)` matches. The rail has no
  // in-rail collapse control, so folding must work through the pinned Home
  // tab's toggle — which must stay tappable without any hover affordance.
  // emulateMedia() doesn't cover `hover`, so use CDP.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'hover', value: 'none' },
      { name: 'pointer', value: 'coarse' },
    ],
  });

  await gotoEntryHome(page);
  await ensureRailOpen(page);

  const toggle = page.getByTestId('entry-rail-collapse');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator('.entry')).not.toHaveClass(/entry--rail-open/);
});

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Loading OpenPixo…').waitFor({ state: 'hidden', timeout: T.long });
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve OpenPixo' });
  if (await privacyDialog.isVisible()) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
    await expect(privacyDialog).toHaveCount(0);
  }
  if (!(await page.getByTestId('home-hero').isVisible().catch(() => false))) {
    const homeWorkspaceTab = page.getByRole('tab', { name: /^Home$/ }).first();
    if (await homeWorkspaceTab.isVisible().catch(() => false)) {
      await homeWorkspaceTab.click();
    } else if (await page.getByTestId('entry-nav-home').isVisible().catch(() => false)) {
      await page.getByTestId('entry-nav-home').click();
    }
  }
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
}

async function createProject(page: Page, name: string) {
  const id = `entry-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await page.request.post('/api/projects', {
    data: {
      id,
      name,
      skillId: null,
      metadata: { kind: 'prototype' },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<{ project: { id: string; name: string } }>;
}


async function routeDesignSystems(page: Page) {
  await page.route('**/api/design-systems', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { } });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/design-systems/*/showcase', async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2) ?? '');
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><main><h1>${id} showcase</h1></main></body></html>`,
    });
  });
  await page.route('**/api/design-systems/*/preview', async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2) ?? '');
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><main><h1>${id} tokens</h1></main></body></html>`,
    });
  });
  await page.route('**/api/design-systems/*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) ?? '');
    const system = DESIGN_SYSTEMS.find((item) => item.id === id) ?? DESIGN_SYSTEMS[0];
    await route.fulfill({
      json: {
      },
    });
  });
}

function isCreateRunRequest(request: Request): boolean {
  const url = new URL(request.url());
  return url.pathname === '/api/runs' && request.method() === 'POST';
}

function isCreateProjectRequest(request: Request): boolean {
  const url = new URL(request.url());
  return url.pathname === '/api/projects' && request.method() === 'POST';
}


function skillSummary(
  id: string,
  name: string,
  mode: 'prototype' | 'deck' | 'image',
  surface: 'web' | 'image',
  defaultFor: string[],
) {
  return {
    id,
    name,
    description: `${name} fixture for entry coverage.`,
    triggers: [],
    mode,
    surface,
    platform: 'desktop',
    scenario: 'qa',
    previewType: 'html',
    defaultFor,
    upstream: null,
    featured: null,
    fidelity: null,
    speakerNotes: null,
    animations: null,
    hasBody: true,
    examplePrompt: '',
  };
}

function makeStarterPlugin({
  id,
  title,
  description = 'A localized fixture',
  mode = 'prototype',
  taskKind = 'new-generation',
  featured = false,
  tags = [],
  query,
  inputs = [],
  previewEntry,
  authorName,
  authorUrl,
  homepage,
  context,
  pipeline,
}: {
  id: string;
  title: string;
  description?: string;
  mode?: string;
  taskKind?: 'new-generation' | 'figma-migration' | 'code-migration' | 'tune-collab';
  featured?: boolean;
  tags?: string[];
  query?: string;
  inputs?: Array<{
    name: string;
    type: string;
    default?: string;
    label?: string;
    required?: boolean;
    options?: string[];
  }>;
  previewEntry?: string;
  authorName?: string;
  authorUrl?: string;
  homepage?: string;
  context?: Record<string, unknown>;
  pipeline?: Record<string, unknown>;
}) {
  return {
    id,
    title,
    version: '1.0.0',
    trust: 'trusted',
    sourceKind: 'bundled',
    source: `/tmp/${id}`,
    capabilitiesGranted: ['prompt:inject'],
    fsPath: `/tmp/${id}`,
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: id,
      title,
      version: '1.0.0',
      description,
      ...(authorName || authorUrl
        ? {
            author: {
              ...(authorName ? { name: authorName } : {}),
              ...(authorUrl ? { url: authorUrl } : {}),
            },
          }
        : {}),
      ...(homepage ? { homepage } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      pixo: {
        kind: 'scenario',
        taskKind,
        mode,
        ...(featured ? { featured: true } : {}),
        ...(previewEntry
          ? {
              preview: {
                type: 'html',
                entry: previewEntry,
              },
            }
          : {}),
        ...(query
          ? {
              useCase: {
                query: {
                  en: query,
                },
              },
            }
          : {}),
        ...(inputs.length > 0 ? { inputs } : {}),
        ...(context ? { context } : {}),
        ...(pipeline ? { pipeline } : {}),
      },
    },
  } as const;
}
