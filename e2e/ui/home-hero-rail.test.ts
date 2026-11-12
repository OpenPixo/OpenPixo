import { expect, test } from '@/playwright/suite';
import type { Page } from '@playwright/test';
import {
  HOME_TYPE_PRIMARY_CHIP_IDS,
  HOME_TYPE_OTHER_CHIP_IDS,
  homeTemplateTrigger,
  openHomeTemplates,
  pickHomeTemplate,
} from '@/playwright/home-hero';
import {
  routeAgents,
  routeSuccessfulRuns,
  successfulRunEventBody,
  suppressWhatsNew,
  trackRunRequests,
} from '@/playwright/mock-factory';
import { ensureRailOpen } from '@/playwright/rail';
import { T } from '@/timeouts';

test.describe.configure({ timeout: T.xlong });

const STORAGE_KEY = 'pixo:config';
const LOCALE_KEY = 'pixo:locale';
const LOCALE_SOURCE_KEY = 'pixo:locale-source';

const HOME_CONFIG = {
  mode: 'daemon',
  apiKey: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  agentId: 'codex',
  skillId: null,
  onboardingCompleted: true,
  agentModels: { codex: { model: 'default', reasoning: 'default' } },
  privacyDecisionAt: 1,
  telemetry: { metrics: false, content: false, artifactManifest: false },
};

const HOME_DESIGN_SYSTEMS = [
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
];

const BRAND_DESIGN_SYSTEM = {
  id: 'user:brand-acme',
  title: 'Acme Brand Kit',
  category: 'Brand',
  summary: 'Acme brand kit.',
  source: 'user',
  isEditable: true,
  surface: 'web',
  status: 'published',
  swatches: ['#0b5fff', '#0a0a0a'],
};

const ACME_BRAND = {
  meta: {
    id: 'brand-acme',
    sourceUrl: 'https://acme.example.com',
    createdAt: 0,
    updatedAt: 0,
    status: 'ready',
    projectId: 'brand-project-acme',
  },
  brand: {
    name: 'Acme',
    tagline: 'Build the future, faster.',
    description: 'Acme is a bold engineering brand for fast-moving teams.',
    sourceUrl: 'https://acme.example.com',
    logo: { primary: 'logos/acme.svg', alternates: [], notes: '' },
    colors: [
      { role: 'accent', hex: '#0b5fff', oklch: '', name: 'Signal Blue', usage: 'Primary actions' },
      { role: 'background', hex: '#0a0a0a', oklch: '', name: 'Ink', usage: 'Surfaces' },
    ],
    typography: {
      display: { family: 'Space Grotesk', fallbacks: ['sans-serif'], weights: [500, 700] },
      body: { family: 'Inter', fallbacks: ['sans-serif'], weights: [400, 600] },
    },
    voice: { adjectives: [], tone: '', messagingPillars: [], vocabulary: { use: [], avoid: [] } },
    imagery: { style: '', subjects: [], treatment: '', avoid: [], samples: [] },
    layout: { radius: '', borderWeight: '', spacing: '', postureRules: [] },
  },
};

const HOME_PLUGINS = [
  {
    id: 'pixo-media-generation',
    title: 'Media generation',
    version: '0.1.0',
    trust: 'bundled',
    sourceKind: 'bundled',
    source: '/tmp/media-generation',
    fsPath: '/tmp/media-generation',
    capabilitiesGranted: ['prompt:inject'],
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: 'pixo-media-generation',
      title: 'Media generation',
      version: '0.1.0',
      description: 'Create image, video, and audio assets.',
      pixo: {
        kind: 'scenario',
        taskKind: 'new-generation',
        useCase: {
          query: 'Create media.',
        },
        inputs: [],
      },
    },
  },
  {
    id: 'example-hyperframes',
    title: 'HyperFrames',
    version: '0.1.0',
    trust: 'bundled',
    sourceKind: 'bundled',
    source: '/tmp/example-hyperframes',
    fsPath: '/tmp/example-hyperframes',
    capabilitiesGranted: ['prompt:inject'],
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: 'example-hyperframes',
      title: 'HyperFrames',
      version: '0.1.0',
      description: 'Create a game trailer with HyperFrames.',
      pixo: {
        kind: 'scenario',
        taskKind: 'new-generation',
        useCase: {
          query: 'Create a HyperFrames game trailer.',
        },
        inputs: [],
      },
    },
  },
];

const PROMPT_TEMPLATES = [
  {
    id: 'image-product',
    surface: 'image',
    title: 'Image product concept',
    summary: 'A polished product image prompt.',
    category: 'product',
    model: 'gpt-image-2',
    aspect: '16:9',
    source: { repo: 'openpixo/image-prompts', license: 'MIT' },
  },
  {
    id: 'video-reveal',
    surface: 'video',
    title: 'Video reveal',
    summary: 'A short reveal video prompt.',
    category: 'product',
    model: 'doubao-seedance-2-0-260128',
    aspect: '16:9',
    source: { repo: 'openpixo/video-prompts', license: 'MIT' },
  },
  {
    id: 'hyperframes-caption',
    surface: 'video',
    title: 'HyperFrames captions',
    summary: 'A caption-led HyperFrames prompt.',
    category: 'motion',
    model: 'hyperframes-html',
    aspect: '16:9',
    source: { repo: 'heygen-com/hyperframes', license: 'MIT' },
  },
];

async function waitForLoadingToClear(page: Page) {
  await page.getByText('Loading OpenPixo…').waitFor({ state: 'hidden', timeout: 15_000 });
}

async function seedBrowserConfig(page: Page, config: Record<string, unknown>) {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STORAGE_KEY, value: config },
  );
}

async function seedBrowserLocale(page: Page, locale: string) {
  await page.addInitScript(
    ({ localeKey, sourceKey, value }) => {
      window.localStorage.setItem(localeKey, value);
      window.localStorage.setItem(sourceKey, 'manual');
    },
    { localeKey: LOCALE_KEY, sourceKey: LOCALE_SOURCE_KEY, value: locale },
  );
}

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve OpenPixo' });
  if (await privacyDialog.isVisible().catch(() => false)) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
  }
  // #5517 moved the settings entry into the collapsed-by-default nav rail, so it
  // is not in the accessibility tree on load; the hero is the ready signal now.
  await expect(page.getByTestId('home-hero')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await suppressWhatsNew(page);
  await page.addInitScript(({ key, value }) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value: HOME_CONFIG });

  await routeAgents(page, [
    {
      id: 'codex',
      name: 'Codex CLI',
      bin: 'codex',
      available: true,
      version: '0.80.0',
      path: '/usr/local/bin/codex',
      models: [{ id: 'default', label: 'Default' }],
    },
    {
      id: 'mock',
      name: 'Mock Agent',
      bin: 'mock-agent',
      available: true,
      version: 'test',
      models: [{ id: 'default', label: 'Default' }],
    },
  ]);

  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        config: HOME_CONFIG,
      },
    });
  });

  // These Home composer scenarios exercise the signed-out/local path. Settle
  // workspace bootstrap explicitly so strict workspace write guards do not
  // confuse an unresolved test fixture with an authenticated cloud identity.
  await page.route('**/api/workspace/directory', async (route) => {
    await route.fulfill({ json: { items: [] } });
  });

  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { projects: [] } });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/prompt-templates', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ promptTemplates: PROMPT_TEMPLATES }),
    });
  });
  await page.route('**/api/plugins', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ plugins: HOME_PLUGINS }),
    });
  });
  await page.route('**/api/mcp/servers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        servers: [
          {
            id: 'docs',
            label: 'Docs MCP',
            transport: 'stdio',
            enabled: true,
            command: 'npx',
          },
        ],
        templates: [],
      }),
    });
  });

  // These cases defer preset application until submit. Keep unexpected
  // apply requests hermetic for both current and older daemon routes.
  await page.route('**/api/plugins/*/apply*', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unexpected plugin apply route' }),
    });
  });
});

test('[P0] cold-start Home keeps creation pills styled and disabled while plugins settle', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem('pixo:home-composer:chip');
  });
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 800, height: 900 },
    { width: 540, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.unroute('**/api/plugins');

    let releasePlugins!: () => void;
    const pluginsReady = new Promise<void>((resolve) => {
      releasePlugins = resolve;
    });
    await page.route('**/api/plugins', async (route) => {
      await pluginsReady;
      await route.fulfill({ json: { plugins: HOME_PLUGINS } });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForLoadingToClear(page);
    const typeRow = homeTemplateTrigger(page);
    try {
      await expect(typeRow).toBeVisible();
      await expect(page.getByTestId('home-hero-examples-loading')).toHaveCount(0);
      await expect(page.getByTestId('home-hero-plugin-presets')).toHaveCount(0);
      await expect(typeRow).toBeDisabled();
      const primaryPill = page.getByTestId('home-hero-type-pill-image');
      await expect(primaryPill).toBeDisabled();
      const pillBackground = await primaryPill.evaluate((element) => getComputedStyle(element).backgroundColor);
      await expect(typeRow).toHaveCSS('background-color', pillBackground);
      await expect(typeRow).toHaveCSS('border-top-width', '1px');
      await expect(typeRow).toHaveCSS('box-shadow', 'none');
      await expect(page.getByTestId('home-hero-template-picker')).toHaveCount(0);
      await expect(page.getByTestId('home-hero-submit')).toBeDisabled();
      await testInfo.attach(`home-type-loading-${viewport.width}`, {
        body: await page.screenshot(), contentType: 'image/png',
      });
    } finally {
      releasePlugins();
    }

    await waitForLoadingToClear(page);
    await expect(typeRow).toBeEnabled();
    await expect(page.getByTestId('home-hero-type-pills')).toBeVisible();
    await expect(page.getByTestId('home-hero-template-picker')).toHaveCount(0);

    await pickHomeTemplate(page, 'image');
    await expect(page.getByTestId('home-hero-plugin-presets')).toBeVisible();
    await expect(typeRow).toBeVisible();
    await pickHomeTemplate(page, 'audio');
  }
});

test('[P0] failed initial catalog releases the type picker without claiming a default selection', async ({ page }) => {
  let failCatalog = true;
  await page.route('**/api/plugins', async (route) => {
    await route.fulfill(failCatalog
      ? { status: 503, json: { error: 'Catalog temporarily unavailable' } }
      : { json: { plugins: HOME_PLUGINS } });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  await expect(homeTemplateTrigger(page)).toBeEnabled();
  await expect(page.getByTestId('home-hero-template-picker')).toHaveCount(0);
  const menu = await openHomeTemplates(page);
  await expect(menu.locator('[aria-selected="true"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  failCatalog = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  await expect(homeTemplateTrigger(page)).toBeEnabled();
  await expect(page.getByTestId('home-hero-type-pills')).toBeVisible();
  await expect(page.getByTestId('home-hero-template-picker')).toHaveCount(0);
});

test('[P1] last project list row keeps its overflow menu inside the viewport', async ({ page }) => {
  const recentProjects = Array.from({ length: 3 }, (_, index) => ({
    id: `recent-list-menu-${index + 1}`,
    name: `List Project ${index + 1}`,
    skillId: null,
    createdAt: Date.now() - (index + 1) * 10_000,
    updatedAt: Date.now() - (index + 1) * 5_000,
    metadata: { kind: 'prototype', nameSource: 'user' },
  }));
  const lastProject = recentProjects.at(-1)!;

  await page.setViewportSize({ width: 1280, height: 500 });
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { projects: recentProjects } });
      return;
    }
    await route.continue();
  });
  await gotoEntryHome(page);

  await page.getByRole('button', { name: 'Sort projects · View mode' }).click();
  await page.getByRole('menuitemradio', { name: 'List view' }).click();
  const lastRow = page.locator(`[data-project-id="${lastProject.id}"]`);
  await expect(lastRow).toBeVisible();
  await page.evaluate((projectId) => {
    const scroller = document.querySelector<HTMLElement>('.entry-main--scroll');
    const row = document.querySelector<HTMLElement>(`[data-project-id="${projectId}"]`);
    const trigger = row?.querySelector<HTMLElement>('.recent-projects__card-more');
    if (!scroller || !row || !trigger) {
      throw new Error('Recent project list-menu fixture is missing');
    }

    const desiredTop = scroller.getBoundingClientRect().bottom - 60;
    scroller.scrollTop += trigger.getBoundingClientRect().top - desiredTop;
  }, lastProject.id);

  await lastRow.hover();
  const trigger = lastRow.getByRole('button', { name: /more actions/i });
  await trigger.click();

  const menu = lastRow.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeInViewport();

  const triggerBox = await trigger.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThan(triggerBox?.y ?? 0);
});

test('[P1] bottom-row project card keeps its overflow menu inside the viewport', async ({ page }) => {
  // Grid is the default view (RecentProjectsStrip.tsx `useState<'grid' | 'list'>('grid')`),
  // and the card menu shares one render site with the list rows, so a regression in the
  // placement effect surfaces here first. The list-row case above covers the other layout.
  const recentProjects = Array.from({ length: 6 }, (_, index) => ({
    id: `recent-card-menu-${index + 1}`,
    name: `Card Project ${index + 1}`,
    skillId: null,
    createdAt: Date.now() - (index + 1) * 10_000,
    updatedAt: Date.now() - (index + 1) * 5_000,
    metadata: { kind: 'prototype', nameSource: 'user' },
  }));
  const lastProject = recentProjects.at(-1)!;

  await page.setViewportSize({ width: 1280, height: 500 });
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { projects: recentProjects } });
      return;
    }
    await route.continue();
  });
  await gotoEntryHome(page);

  const lastCard = page.locator(`[data-project-id="${lastProject.id}"]`);
  await expect(lastCard).toBeVisible();
  await page.evaluate((projectId) => {
    const scroller = document.querySelector<HTMLElement>('.entry-main--scroll');
    const card = document.querySelector<HTMLElement>(`[data-project-id="${projectId}"]`);
    const trigger = card?.querySelector<HTMLElement>('.recent-projects__card-more');
    if (!scroller || !card || !trigger) {
      throw new Error('Recent project card-menu fixture is missing');
    }

    const desiredTop = scroller.getBoundingClientRect().bottom - 60;
    scroller.scrollTop += trigger.getBoundingClientRect().top - desiredTop;
  }, lastProject.id);

  await lastCard.hover();
  const trigger = lastCard.getByRole('button', { name: /more actions/i });
  await trigger.click();

  const menu = lastCard.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeInViewport();

  const triggerBox = await trigger.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThan(triggerBox?.y ?? 0);
});

test('[P1] home left rail expands and collapses from the shell controls', async ({ page }) => {
  await gotoEntryHome(page);

  const shell = page.locator('.entry');
  const rail = page.locator('.entry-nav-rail');
  // #7635: the toggle lives in the chrome row's search/toggle cluster and
  // owns both directions; the pinned Home pill is hidden in the entry chrome.
  const expand = page.getByTestId('entry-rail-collapse');

  await expect(shell).not.toHaveClass(/entry--rail-open/);
  await expect(rail).toHaveAttribute('aria-hidden', 'true');
  await expect(expand).toHaveAttribute('aria-expanded', 'false');

  await expand.click();
  await expect(shell).toHaveClass(/entry--rail-open/);
  await expect(rail).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByTestId('entry-nav-home')).toBeVisible();
  // #5517's rail dropped the single "Projects" destination; Design systems is
  // the stable second destination in both the signed-out and team rails.
  await expect(page.getByTestId('entry-nav-design-systems')).toBeVisible();

  // The rail has no in-rail collapse control (the header is chrome-free);
  // the same chrome-row toggle folds it back.
  await expect(expand).toHaveAttribute('aria-expanded', 'true');
  await expand.click();
  await expect(shell).not.toHaveClass(/entry--rail-open/);
  await expect(rail).toHaveAttribute('aria-hidden', 'true');
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
});

test('[P1] home composer plus menu exposes attachment, plugin, and MCP entries', async ({ page }) => {
  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');

  await page.getByTestId('home-hero-plus-trigger').click();
  await expect(page.getByTestId('composer-plus-attach')).toBeVisible();
  await expect(page.getByTestId('composer-plus-plugins')).toBeVisible();
  await expect(page.getByTestId('composer-plus-mcp')).toBeVisible();


  await page.getByTestId('composer-plus-plugins').click();
  await page.getByRole('menuitem', { name: /HyperFrames/i }).click();
  await expect(input).toContainText(/HyperFrames/i);

  await page.getByTestId('home-hero-plus-trigger').click();
  await page.getByTestId('composer-plus-mcp').click();
  await page.getByRole('menuitem', { name: /Docs MCP/i }).click();
  await expect(input).toContainText(/Docs MCP/i);

  await page.getByTestId('home-hero-file-input').setInputFiles('../package.json');
  await expect(page.getByTestId('home-hero-staged-files')).toContainText('package.json');
});

test('[P1] home composer sends referenced workspace context into project creation', async ({ page }) => {
  const createBodies: Array<Record<string, any>> = [];
  const referenceProject = {
    id: 'ref-home-payload',
    name: 'Reference Home Payload',
    skillId: null,
    createdAt: Date.now() - 1_000,
    updatedAt: Date.now(),
    metadata: {
      kind: 'prototype',
      nameSource: 'user',
    },
  };

  await page.route('**/api/projects', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ json: { projects: [referenceProject] } });
      return;
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, any>;
      createBodies.push(body);
      const id = body.id ?? 'home-context-project';
      await route.fulfill({
        json: {
          project: {
            id,
            name: body.name ?? 'Untitled project',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: body.metadata ?? {},
          },
          conversationId: `conv-${id}`,
        },
      });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/projects/ref-home-payload**', async (route) => {
    await route.fulfill({
      json: {
        project: referenceProject,
        resolvedDir: '/tmp/openpixo/reference-home-payload',
      },
    });
  });
  await page.route('**/api/dialog/open-folder', async (route) => {
    await route.fulfill({ json: { path: '/tmp/openpixo/local-code-home-payload' } });
  });
  await page.route('**/api/dir-exists', async (route) => {
    await route.fulfill({ json: { exists: true } });
  });
  await routeRunsAccepted(page);

  await gotoEntryHome(page);
  const input = page.getByTestId('home-hero-input');

  await page.getByTestId('home-hero-plus-trigger').click();
  await page.getByTestId('composer-plus-reference-project').click();
  const referenceDialog = page.getByRole('dialog', { name: 'Reference another project' });
  await expect(referenceDialog.getByRole('option', { name: /Reference Home Payload/i })).toHaveAttribute('aria-selected', 'true');
  await referenceDialog.getByRole('button', { name: 'Reference project' }).click();
  await expect(page.getByTestId('working-dir-trigger')).toContainText('Reference Home Payload');
  await expect(input).toHaveText('');

  // The working-directory row holds ONE pick; linking a checkout replaces the
  // reference, and only the survivor rides into project creation.
  await page.getByTestId('home-hero-plus-trigger').click();
  await page.getByTestId('composer-plus-local-code').click();
  await expect(page.getByTestId('working-dir-trigger')).toContainText('local-code-home-payload');

  await input.fill('Create a project using the referenced workspace context.');
  await Promise.all([
    page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/projects'),
    page.getByTestId('home-hero-submit').click(),
  ]);

  await expect.poll(() => createBodies.length).toBe(1);
  const metadata = createBodies[0]?.metadata as { linkedDirs?: string[] } | undefined;
  expect(metadata?.linkedDirs ?? []).toEqual([
    '/tmp/openpixo/local-code-home-payload',
  ]);
});

test('[P1] home staged workspace context auto-sends into the first project run', async ({ page }) => {
  const prompt = 'Create a project and immediately use the Home-staged context.';
  const projectId = 'home-autosend-context-project';
  const conversationId = 'conv-home-autosend-context';
  const runBodies: Array<Record<string, unknown>> = [];
  let createdProjectMetadata: Record<string, unknown> = {};
  const referenceProject = {
    id: 'ref-home-autosend',
    name: 'Reference Home Autosend',
    skillId: null,
    createdAt: Date.now() - 1_000,
    updatedAt: Date.now(),
    metadata: {
      kind: 'prototype',
      nameSource: 'user',
    },
  };

  await page.route('**/api/projects', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ json: { projects: [referenceProject] } });
      return;
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { metadata?: Record<string, unknown>; name?: string; pendingPrompt?: string };
      createdProjectMetadata = body.metadata ?? {};
      await route.fulfill({
        json: {
          project: {
            id: projectId,
            name: body.name ?? 'Home autosend context project',
            skillId: null,
            pendingPrompt: body.pendingPrompt ?? prompt,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: createdProjectMetadata,
          },
          conversationId,
        },
      });
      return;
    }
    await route.fallback();
  });
  await page.route(`**/api/projects/${referenceProject.id}**`, async (route) => {
    await route.fulfill({
      json: {
        project: referenceProject,
        resolvedDir: '/tmp/openpixo/reference-home-autosend',
      },
    });
  });
  await page.route(`**/api/projects/${projectId}`, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        json: {
          project: {
            id: projectId,
            name: 'Home autosend context project',
            skillId: null,
            pendingPrompt: prompt,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: createdProjectMetadata,
          },
        },
      });
      return;
    }
    if (request.method() === 'PATCH') {
      await route.fulfill({
        json: {
          project: {
            id: projectId,
            name: 'Home autosend context project',
            skillId: null,
            pendingPrompt: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: createdProjectMetadata,
          },
        },
      });
      return;
    }
    await route.fallback();
  });
  await page.route(`**/api/projects/${projectId}/conversations`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        conversations: [
          {
            id: conversationId,
            projectId,
            title: null,
            sessionMode: 'design',
            messageCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      },
    });
  });
  await page.route(`**/api/projects/${projectId}/conversations/${conversationId}/messages`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: { messages: [] } });
  });
  await page.route(`**/api/projects/${projectId}/conversations/${conversationId}/messages/*`, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.route(`**/api/projects/${projectId}/conversations/${conversationId}/comments`, async (route) => {
    await route.fulfill({ json: { comments: [] } });
  });
  await page.route(`**/api/projects/${projectId}/files`, async (route) => {
    await route.fulfill({ json: { files: [] } });
  });
  await page.route('**/api/live-artifacts**', async (route) => {
    await route.fulfill({ json: { liveArtifacts: [] } });
  });
  const runRequests = await routeSuccessfulRuns(page, {
    bodies: runBodies,
    runId: 'home-autosend-context-run',
  });
  await page.route('**/api/dialog/open-folder', async (route) => {
    await route.fulfill({ json: { path: '/tmp/openpixo/local-code-home-autosend' } });
  });
  await page.route('**/api/dir-exists', async (route) => {
    await route.fulfill({ json: { exists: true } });
  });

  await gotoEntryHome(page);
  const input = page.getByTestId('home-hero-input');

  await page.getByTestId('home-hero-plus-trigger').click();
  await page.getByTestId('composer-plus-reference-project').click();
  const referenceDialog = page.getByRole('dialog', { name: 'Reference another project' });
  await expect(referenceDialog.getByRole('option', { name: /Reference Home Autosend/i })).toHaveAttribute('aria-selected', 'true');
  await referenceDialog.getByRole('button', { name: 'Reference project' }).click();
  await expect(page.getByTestId('working-dir-trigger')).toContainText('Reference Home Autosend');
  await expect(input).toHaveText('');

  // One slot: the linked checkout replaces the reference before the send.
  await page.getByTestId('home-hero-plus-trigger').click();
  await page.getByTestId('composer-plus-local-code').click();
  await expect(page.getByTestId('working-dir-trigger')).toContainText('local-code-home-autosend');

  await input.fill(prompt);
  await Promise.all([
    page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/projects'),
    page.getByTestId('home-hero-submit').click(),
  ]);

  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
  await runRequests.expectCount(1, { timeout: 15_000 });
  expect(runBodies[0]?.message).toContain(prompt);
  expect(runBodies[0]?.projectId).toBe(projectId);
  expect(runBodies[0]?.conversationId).toBe(conversationId);
  const context = runBodies[0]?.context as { workspaceItems?: Array<{ id?: string; label?: string; absolutePath?: string }> } | undefined;
  expect(context?.workspaceItems ?? []).toEqual([
    expect.objectContaining({
      id: 'local-code:/tmp/openpixo/local-code-home-autosend',
      label: 'local-code-home-autosend',
      absolutePath: '/tmp/openpixo/local-code-home-autosend',
    }),
  ]);
  await expect
    .poll(() => page.evaluate((id) => window.sessionStorage.getItem(`pixo:auto-send-context:${id}`), projectId))
    .toBeNull();
});

test('[P2] home hero exposes the composer footer pickers and the full template set', async ({ page }) => {
  await gotoEntryHome(page);

  await expect(page.getByTestId('home-hero-template-picker')).toBeVisible();
  await expect(page.getByTestId('home-hero-design-system-picker')).toBeVisible();
  await expect(page.getByTestId('working-dir-picker')).toBeVisible();

  // #5517 removed Home's inline scenario rail ("Start from a template… / …or
  // create a blank project") together with its More-shortcuts menu. Every
  // project-type template now lives on the composer footer picker's radial
  // menu, so that ring is the entry point this smoke has to see.
  await expect(page.getByTestId('home-hero-type-tabs')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-shortcuts-trigger')).toHaveCount(0);

  // The row is a curated entry set (product, 2026-09-16 / OPEND-3146): three
  // inline, every other create type behind 更多 in product order, so no kind
  // is stranded outside the row.
  const menu = await openHomeTemplates(page);
  for (const id of [...HOME_TYPE_PRIMARY_CHIP_IDS, ...HOME_TYPE_OTHER_CHIP_IDS]) {
    await expect(menu.locator(`[data-chip="${id}"]`)).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

// This spec used to drive the Home mode chip: pick 「提问」, submit, and check
// the request switched to `conversationMode: 'chat'` with no plugin. The chip
// left the Home composer (2026-09-08, product — see the comment at its old slot
// in `HomeHero.tsx`), so Home has no surface that can select Ask any more and
// that half is unreachable from here rather than broken.
//
// What survives is the half that still describes Home: with no picker on
// screen, every Home submission routes Design and carries a plugin. Ask/Plan
// routing itself is untouched and still covered where it is still reachable —
// the project side keeps its stored session mode (`project-management-flows`
// "project detail turns carry the stored design session mode…").
test('[P1] home composer routes every request as design with no mode picker on screen', async ({ page }) => {
  await routeProjectCreates(page);
  await routeRunsAccepted(page);
  await gotoEntryHome(page);

  await expect(page.getByTestId('composer-mode-trigger')).toHaveCount(0);
  await expect(page.getByTestId('composer-mode-clear')).toHaveCount(0);
  await expect(page.getByTestId('composer-mode-menu')).toHaveCount(0);

  await page.getByTestId('home-hero-input').fill('Design the screens from this brief.');

  const designRequestPromise = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/projects',
  );
  await page.getByTestId('home-hero-submit').click();
  const designBody = await designRequestPromise.then((request) => request.postDataJSON() as {
    conversationMode?: string;
    pluginId?: string | null;
  });

  expect(designBody.conversationMode).toBe('design');
  // Typeless Home (#7635): a naked prompt carries no plugin pin — the daemon's
  // scenario-default table owns the route.
  expect(designBody.pluginId).toBeUndefined();
});


test('[P2] home template dropdown switches types and dismisses with Escape', async ({ page }) => {
  await gotoEntryHome(page);
  await pickHomeTemplate(page, 'audio');
  await expect(page.getByTestId('home-hero-template-clear')).toHaveCount(0);
  const menu = await openHomeTemplates(page);
  await expect(menu.locator('[data-chip="audio"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(homeTemplateTrigger(page)).toBeFocused();
  await pickHomeTemplate(page, 'video');
});

test('[P1] home suggestion entry remains retryable after create failures', async ({ page }) => {
  const projectCreateCount = await routeProjectCreates(page, { failFirstCreate: true });
  await routeRunsAccepted(page);
  const runRequests = trackRunRequests(page);
  await gotoEntryHome(page);

  await page.getByTestId('home-hero-submit').click();
  await expect.poll(projectCreateCount).toBe(1);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('home-hero-submit')).toBeEnabled();
  await expect(page.getByRole('alert').filter({ hasText: /Failed to start the run/i })).toBeVisible();
  await runRequests.expectNone({ message: 'failed blank project create should not start a run' });

  await page.getByTestId('home-hero-submit').click();
  await expect.poll(projectCreateCount).toBe(2);
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
});

test('[P1] home dropdown switches between types', async ({ page }) => {
  await gotoEntryHome(page);
  const typeRow = homeTemplateTrigger(page);
  await expect(typeRow).toBeVisible();
  await expect(typeRow).toBeVisible();

  await pickHomeTemplate(page, 'audio');
  await expect(page.getByTestId('home-hero-template-trigger')).toContainText(/Audio|音频|音訊/i);

  await pickHomeTemplate(page, 'video');
  await expect(page.getByTestId('home-hero-footer-option-speakerNotes')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-template-trigger')).toContainText(/Video|视频|影片/i);
});

test('[P1] home template picker defers media settings for image, video, hyperframes, and audio', async ({ page }) => {
  await gotoEntryHome(page);

  await pickHomeTemplate(page, 'image');
  await expect(page.getByTestId('home-hero-design-system-trigger')).toBeVisible();
  await expect(page.getByTestId('home-hero-footer-option-ratio')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-footer-option-resolution')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-footer-option-duration')).toHaveCount(0);

  await pickHomeTemplate(page, 'video');
  await expect(page.getByTestId('home-hero-design-system-trigger')).toBeVisible();
  await expect(page.getByTestId('home-hero-footer-option-ratio')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-footer-option-resolution')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-footer-option-duration')).toHaveCount(0);

  await pickHomeTemplate(page, 'hyperframes');
  await expect(page.getByTestId('home-hero-footer-option-ratio')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-footer-option-duration')).toHaveCount(0);

  await pickHomeTemplate(page, 'audio');
  await expect(page.getByTestId('home-hero-footer-option-audioType')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-footer-option-duration')).toHaveCount(0);
});

test('[P1] expired plugin refresh keeps known Home creation types actionable after a real remount', async ({
  page,
}) => {
  await gotoEntryHome(page);
  await expect(homeTemplateTrigger(page)).toBeEnabled();

  // Age the module-level catalog past its 10-second TTL, then leave Home
  // through an in-app route so HomeView really unmounts while the JS module and
  // its last successful snapshot remain alive.
  await page.evaluate(() => {
    const expiredNow = Date.now() + 11_000;
    Date.now = () => expiredNow;
  });
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let refreshRequests = 0;
  await page.route('**/api/plugins', async (route) => {
    refreshRequests += 1;
    await refreshGate;
    await route.fulfill({ json: { plugins: HOME_PLUGINS } });
  });

  try {
    await ensureRailOpen(page);
    await page.getByTestId('entry-settings-button').click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goBack();
    await expect(page.getByTestId('home-hero')).toBeVisible();
    await expect.poll(() => refreshRequests).toBeGreaterThan(0);

    // The revalidation is deliberately unresolved. The latest successful
    // catalog must seed the remount synchronously instead of greying every
    // creation type until this request finishes.
    const remountedRow = homeTemplateTrigger(page);
    await expect(remountedRow).toBeEnabled();
    await expect(remountedRow).toBeEnabled();
  } finally {
    releaseRefresh();
  }
});

test('[P1] home hero example preset card has no hover overlay and applies the template directly', async ({ page }) => {
  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');
  await expect(input).toHaveText('');

  await pickHomeTemplate(page, 'hyperframes');
  await expect(page.getByTestId('home-hero-plugin-presets')).toBeVisible();

  const card = page.locator(
    '[data-testid="home-hero-plugin-preset"][data-plugin-id="example-hyperframes"]',
  );
  await card.hover();
  // 2026-07 product decision: drop the hover-revealed Use/Remix overlay
  // (#4861) and restore the #5517 baseline where the whole card is the
  // single click-to-use affordance — no separate button, no preview modal.
  await expect(
    page.getByTestId('home-hero-plugin-preset-use-example-hyperframes'),
  ).toHaveCount(0);
  await expect(page.locator('.home-hero__plugin-preset-actions')).toHaveCount(0);

  await card.click();

  await expect(page.getByTestId('home-hero-active-plugin')).toBeVisible();
  await expect(input).toHaveText(
    'Create a HyperFrames game trailer.',
  );
});

test('[P1] home hero prompt example cards fill the composer for fallback modes', async ({ page }) => {
  await gotoEntryHome(page);

  const input = page.getByTestId('home-hero-input');
  await pickHomeTemplate(page, 'audio');
  await expect(page.getByTestId('home-hero-prompt-examples')).toBeVisible();
  await expect(page.getByTestId('home-hero-plugin-presets')).toHaveCount(0);

  const firstExample = page.getByTestId('home-hero-prompt-example').first();
  const exampleText = (await firstExample.textContent())?.trim();
  expect(exampleText).toBeTruthy();
  await firstExample.click();

  await expect(input).toHaveText(exampleText ?? '');
});

/**
 * Apply an example preset to the composer. The preset card itself is the
 * single click-to-use affordance (2026-07 removed the separate
 * hover-revealed "Use"/"Remix" overlay buttons and restored the #5517
 * baseline), so this is just a plain click on the card.
 */
async function usePreset(page: Page, pluginId: string) {
  const card = page.locator(
    `[data-testid="home-hero-plugin-preset"][data-plugin-id="${pluginId}"]`,
  );
  await expect(card).toBeVisible();
  await card.click();
}

// Template selection / clearing now lives in `@/playwright/home-hero`
// (`pickHomeTemplate` / `clearHomeTemplate`): both used to be local helpers
// built on the deleted `home-hero-rail-*` cards and `home-hero-active-type-chip`.
//
// Historical alias from when picking a preset was a two-step hover + Use
// button flow (`usePreset` hovered/asserted, `useExamplePreset` clicked);
// kept so existing call-site pairs still resolve without churning every
// caller now that both steps collapse into one click.
async function useExamplePreset(page: Page, pluginId: string) {
  const card = page.locator(
    `[data-testid="home-hero-plugin-preset"][data-plugin-id="${pluginId}"]`,
  );
  await card.click();
}

function activeHeroChip(page: Page) {
  return page.getByTestId('home-hero-active-type-chip').or(page.getByTestId('home-hero-active-plugin'));
}

async function clearActiveChip(page: Page) {
  const activeChip = activeHeroChip(page);
  if ((await activeChip.count()) > 0) {
    const clearPlugin = page.getByRole('button', { name: /Clear active plugin|清除/i });
    if ((await clearPlugin.count()) > 0) {
      await clearPlugin.click();
    } else {
      await activeChip.click();
    }
    await expect(activeHeroChip(page)).toHaveCount(0);
  }
  // The creation type itself has no clear affordance any more (per product);
  // only the active example plugin above is droppable.
  await expect(page.getByTestId('home-hero-type-tabs')).toBeVisible();
}

async function routeMinimalProjectWorkspace(
  page: Page,
  projectId: string,
  conversationId: string,
  options: { name: string; metadata?: Record<string, unknown> },
) {
  const project = {
    id: projectId,
    name: options.name,
    skillId: null,
    pendingPrompt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: options.metadata ?? { kind: 'prototype', nameSource: 'user' },
  };
  await page.route(`**/api/projects/${projectId}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { project } });
      return;
    }
    await route.fallback();
  });
  await page.route(`**/api/projects/${projectId}/conversations`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        conversations: [
          {
            id: conversationId,
            projectId,
            title: null,
            sessionMode: 'design',
            messageCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      },
    });
  });
  await page.route(`**/api/projects/${projectId}/conversations/${conversationId}/messages`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: { messages: [] } });
  });
  await page.route(`**/api/projects/${projectId}/conversations/${conversationId}/comments`, async (route) => {
    await route.fulfill({ json: { comments: [] } });
  });
  await page.route(`**/api/projects/${projectId}/files`, async (route) => {
    await route.fulfill({ json: { files: [] } });
  });
  await page.route('**/api/live-artifacts**', async (route) => {
    await route.fulfill({ json: { liveArtifacts: [] } });
  });
}

async function routeRunsAccepted(page: Page) {
  await routeSuccessfulRuns(page, {
    runId: 'home-run-smoke',
    eventBody: successfulRunEventBody(),
  });
}

async function routeProjectCreates(page: Page, options: { failFirstCreate?: boolean } = {}) {
  let createCount = 0;
  await page.route('**/api/projects', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ json: { projects: [] } });
      return;
    }
    if (request.method() === 'POST') {
      createCount += 1;
      if (options.failFirstCreate && createCount === 1) {
        await route.fulfill({ status: 500, body: 'create failed' });
        return;
      }
      const body = request.postDataJSON() as { id?: string; name?: string; metadata?: Record<string, unknown> };
      const id = body.id ?? `home-created-${createCount}`;
      await route.fulfill({
        json: {
          project: {
            id,
            name: body.name ?? 'Untitled project',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: body.metadata ?? {},
          },
          conversationId: `conv-${id}`,
        },
      });
      return;
    }
    await route.continue();
  });
  return () => createCount;
}

async function routeHomeDesignSystems(page: Page, options: { includeBrandKit?: boolean } = {}) {
  const systems = options.includeBrandKit
    ? [BRAND_DESIGN_SYSTEM, ...HOME_DESIGN_SYSTEMS]
    : HOME_DESIGN_SYSTEMS;
  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { config: HOME_CONFIG } });
      return;
    }
    if (route.request().method() === 'PUT') {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/design-systems', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { } });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/brands', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          brands: options.includeBrandKit ? [ACME_BRAND] : [],
        },
      });
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
}
