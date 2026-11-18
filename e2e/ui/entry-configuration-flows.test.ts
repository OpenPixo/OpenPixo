import { expect, test } from '@/playwright/suite';
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

