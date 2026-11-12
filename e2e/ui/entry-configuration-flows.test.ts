import { expect, test } from '@/playwright/suite';
import { ensureRailOpen, openNewProjectModal } from '@/playwright/rail';
import { expectStableCount } from '@/playwright/assertions';
import { routeAgents, suppressWhatsNew } from '@/playwright/mock-factory';
import { T } from '@/timeouts';
import type { Locator, Page } from '@playwright/test';

const STORAGE_KEY = 'pixo:config';

test.describe.configure({ timeout: T.xlong });

const CONNECTORS = [
  {
    id: 'github',
    name: 'GitHub',
    provider: 'composio',
    category: 'Developer tools',
    description: 'Read repository issues and pull requests.',
    status: 'available',
    auth: { provider: 'composio', configured: true },
    tools: [
      {
        name: 'list_issues',
        title: 'List issues',
        description: 'List recent issues from a repository.',
        safety: {
          sideEffect: 'read',
          approval: 'auto',
          reason: 'Read-only issue lookup.',
        },
        refreshEligible: true,
      },
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    provider: 'composio',
    category: 'Communication',
    description: 'Search channels and messages.',
    status: 'connected',
    accountLabel: 'design-team',
    auth: { provider: 'composio', configured: true },
    tools: [],
  },
];

const IMAGE_TEMPLATE = {
  id: 'editorial-poster',
  surface: 'image',
  title: 'Editorial Poster',
  summary: 'A punchy launch poster for a product announcement.',
  category: 'Marketing',
  tags: ['poster', 'launch'],
  model: 'gpt-image-1',
  aspect: '4:5',
  source: {
    repo: 'openpixo/test-prompts',
    license: 'MIT',
    author: 'OpenPixo QA',
  },
};

async function readSavedConfig(page: Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, STORAGE_KEY);
}

test.beforeEach(async ({ page }) => {
  // The entry home mounts `WhatsNewPopup` (EntryShell.tsx) and its backdrop sits
  // at z-index 1500 — above the z-index 120 chrome that owns the rail/settings
  // controls this spec clicks. A live release card would swallow those clicks.
  await suppressWhatsNew(page);
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
        onboardingCompleted: true,
        agentModels: {},
      }),
    );
  }, STORAGE_KEY);

  await routeAgents(page, [
    {
      id: 'mock',
      name: 'Mock Agent',
      bin: 'mock-agent',
      available: true,
      version: 'test',
      models: [{ id: 'default', label: 'Default' }],
    },
  ]);
});

test('[P1] prompt template retry preserves the edited body in project metadata', async ({ page }) => {
  let detailRequests = 0;
  await page.route('**/api/prompt-templates', async (route) => {
    await route.fulfill({ json: { promptTemplates: [IMAGE_TEMPLATE] } });
  });
  await page.route('**/api/prompt-templates/image/editorial-poster', async (route) => {
    detailRequests += 1;
    if (detailRequests === 1) {
      await route.fulfill({ status: 500, body: 'template unavailable' });
      return;
    }
    await route.fulfill({
      json: {
        promptTemplate: {
          ...IMAGE_TEMPLATE,
          prompt: 'Original poster prompt with dramatic type and product photography.',
        },
      },
    });
  });

  await gotoEntryHome(page);
  await openNewProjectModal(page);
  await page.getByTestId('new-project-media-surface-image').click();
  await page.getByTestId('new-project-name').fill('Prompt template retry metadata');

  await page.getByTestId('prompt-template-trigger').click();
  await page.getByTestId('prompt-template-search').fill('poster');
  await page.getByRole('option', { name: /Editorial Poster/i }).click();

  await expect(page.getByTestId('prompt-template-error')).toBeVisible();
  await page.getByTestId('prompt-template-retry').click();
  await expect(page.getByTestId('prompt-template-error')).toHaveCount(0);
  await expect(page.getByTestId('prompt-template-body')).toContainText('Original poster prompt');

  await page.getByTestId('prompt-template-body').fill('');
  await expect(page.getByTestId('prompt-template-empty-hint')).toBeVisible();
  await page.getByTestId('prompt-template-body').fill(
    'Edited QA prompt: bold poster, one hero product, crisp headline.',
  );
  await expect(page.getByTestId('create-project')).toBeEnabled();
  const createResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/projects') &&
    response.request().method() === 'POST',
  );
  await page.getByTestId('create-project').click();
  const createResponse = await createResponsePromise;
  expect(createResponse.ok(), await createResponse.text()).toBeTruthy();

  const project = await fetchCurrentProject(page);
  expect(project.metadata?.promptTemplate).toMatchObject({
    id: 'editorial-poster',
    surface: 'image',
    title: 'Editorial Poster',
    prompt: 'Edited QA prompt: bold poster, one hero product, crisp headline.',
  });
});

test('[P1] typing a draft replacement Composio key does not trigger global autosave', async ({ page }) => {
  await routeConnectors(page, CONNECTORS);
  await routeComposioConfig(page, { configured: true, apiKeyTail: '1234' });
  await page.addInitScript((key) => {
    const next = {
      mode: 'daemon',
      apiKey: '',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
      agentId: 'mock',
      skillId: null,
      onboardingCompleted: true,
      agentModels: {},
      composio: {
        apiKey: '',
        apiKeyConfigured: true,
        apiKeyTail: '1234',
      },
    };
    window.localStorage.setItem(key, JSON.stringify(next));
  }, STORAGE_KEY);

  const appConfigPersistBodies: unknown[] = [];
  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, json: { config: null } });
      return;
    }
    appConfigPersistBodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, body: '{}' });
  });

  await gotoEntryHome(page);
  const settingsDialog = await openIntegrationsConnectors(page);
  await expect(settingsDialog.getByTestId('connector-grid-wrap')).toBeVisible();
  await expect(settingsDialog.getByText('Saved · ••••1234')).toBeVisible();

  const appConfigPersistCountBeforeDraftEdit = await expectQuietCount(
    () => appConfigPersistBodies.length,
    {
      timeout: 1_200,
    },
  );

  const replacementInput = settingsDialog.getByPlaceholder(/new key to replace the saved key/i);
  await replacementInput.fill('cmp-draft-secret-9999');
  await expect(settingsDialog.getByRole('button', { name: 'Save key', exact: true })).toBeEnabled();

  await expectStableCount(() => appConfigPersistBodies.length, appConfigPersistCountBeforeDraftEdit, {
    timeout: 900,
    message: 'typing a draft Composio replacement key should not trigger global app-config autosave',
  });
  const savedConfig = await readSavedConfig(page);
  expect(savedConfig?.composio).toMatchObject({
    apiKey: '',
    apiKeyConfigured: true,
    apiKeyTail: '1234',
  });
});

async function expectQuietCount(
  readCount: () => number | Promise<number>,
  options: { timeout: number; interval?: number },
): Promise<number> {
  let settledCount = await readCount();
  const interval = options.interval ?? 100;
  let quietDeadline = Date.now() + options.timeout;
  while (Date.now() < quietDeadline) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const currentCount = await readCount();
    if (currentCount !== settledCount) {
      settledCount = currentCount;
      quietDeadline = Date.now() + options.timeout;
    }
  }
  return settledCount;
}

async function routeConnectors(page: Page, connectors: typeof CONNECTORS) {
  await page.route('**/api/connectors', async (route) => {
    await route.fulfill({ json: { connectors } });
  });
  await page.route('**/api/connectors/status', async (route) => {
    const statuses = Object.fromEntries(
      connectors.map((connector) => [
        connector.id,
        {
          status: connector.status,
          accountLabel: connector.accountLabel,
        },
      ]),
    );
    await route.fulfill({ json: { statuses } });
  });
  await page.route('**/api/connectors/discovery*', async (route) => {
    await route.fulfill({
      json: {
        connectors,
        meta: { provider: 'composio' },
      },
    });
  });
}

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Loading OpenPixo…').waitFor({ state: 'hidden', timeout: T.long });
  await expect(page.getByTestId('home-hero')).toBeVisible({ timeout: T.long });
  await expect(page.getByTestId('home-hero-input')).toBeVisible({ timeout: T.long });
}

// Connectors live on the /integrations page, not in the Settings dialog. The
// Settings left nav was converged to eight items and no longer carries a
// Connectors entry, so this drives the surface users actually reach.
async function openIntegrationsConnectors(page: Page): Promise<Locator> {
  await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
  const view = page.locator('.integrations-view');
  await expect(view).toBeVisible({ timeout: T.long });
  await view.getByTestId('integrations-tab-connectors').click();
  await expect(view.getByTestId('connector-grid-wrap')).toBeVisible();
  return view;
}

async function routeComposioConfig(
  page: Page,
  config: { configured: boolean; apiKeyTail?: string },
) {
  await page.route('**/api/connectors/composio/config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: config });
      return;
    }

    await route.fulfill({ json: { ok: true } });
  });
}

function connectorCard(scope: Page | Locator, id: string) {
  return scope.locator(`article.connector-card[data-connector-id="${id}"]`);
}

async function fetchCurrentProject(page: Page) {
  await expect(page).toHaveURL(/\/projects\/[^/]+/);
  const url = new URL(page.url());
  const [, projectId] = url.pathname.match(/\/projects\/([^/]+)/) ?? [];
  expect(projectId).toBeTruthy();

  const response = await page.request.get(`/api/projects/${projectId}`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    project: {
      metadata?: {
        promptTemplate?: {
          id: string;
          surface: string;
          title: string;
          prompt: string;
        };
      };
    };
  };
  return body.project;
}
