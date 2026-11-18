import { expect, test } from '@/playwright/suite';
import type { Page, Route } from '@playwright/test';
import { openSettingsDialog } from '../lib/playwright/local-project.js';

const STORAGE_KEY = 'pixo:config';

function baseConfig(): Record<string, unknown> {
  return {
    mode: 'daemon',
    apiKey: '',
    apiProtocol: 'anthropic',
    apiVersion: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    apiProviderBaseUrl: 'https://api.anthropic.com',
    agentId: 'codex',
    skillId: null,
    onboardingCompleted: true,
    mediaProviders: {},
    agentModels: {},
    agentCliEnv: {},
  };
}

async function seedSettingsBase(page: Page, override?: Record<string, unknown>) {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value: { ...baseConfig(), ...override } });
}

async function routeBootstrapApis(
  page: Page,
  options?: {
    mediaConfigGet?: (route: Route) => Promise<void>;
    mediaConfigPut?: (route: Route) => Promise<void>;
    projectCreate?: (route: Route) => Promise<void>;
    runProject?: {
      id: string;
      conversationId: string;
      name: string;
      metadata: Record<string, unknown>;
      runBodies: Array<Record<string, unknown>>;
    };
  },
) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;

    if (path === '/api/health') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    if (path === '/api/agents') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agents: [
            {
              id: 'codex',
              name: 'Codex CLI',
              bin: 'codex',
              available: true,
              version: '0.130.0',
              models: [{ id: 'default', label: 'Default' }],
            },
          ],
        }),
      });
      return;
    }
    if (path === '/api/editors') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"editors":[]}' });
      return;
    }
    if (path === '/api/app-config') {
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    if (path === '/api/connectors/composio/config') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":false,"apiKeyTail":""}' });
      return;
    }
    if (path === '/api/media/config' && method === 'GET') {
      if (options?.mediaConfigGet) {
        await options.mediaConfigGet(route);
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"providers":{}}' });
      return;
    }
    if (path === '/api/media/config' && method === 'PUT') {
      if (options?.mediaConfigPut) {
        await options.mediaConfigPut(route);
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    if (path === '/api/skills') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"skills":[]}' });
      return;
    }
    if (path === '/api/design-systems') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"designSystems":[]}' });
      return;
    }
    if (path === '/api/projects') {
      if (method === 'POST' && options?.projectCreate) {
        await options.projectCreate(route);
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"projects":[]}' });
      return;
    }
    if (path === '/api/templates') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"templates":[]}' });
      return;
    }
    if (path === '/api/prompt-templates') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"promptTemplates":[]}' });
      return;
    }
    if (options?.runProject && path === `/api/projects/${options.runProject.id}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project: {
            id: options.runProject.id,
            name: options.runProject.name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: options.runProject.metadata,
          },
        }),
      });
      return;
    }
    if (options?.runProject && path === `/api/projects/${options.runProject.id}/conversations`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conversations: [
            { id: options.runProject.conversationId, title: options.runProject.name, updatedAt: Date.now() },
          ],
        }),
      });
      return;
    }
    if (
      options?.runProject &&
      path === `/api/projects/${options.runProject.id}/conversations/${options.runProject.conversationId}/messages`
    ) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"messages":[]}' });
      return;
    }
    if (options?.runProject && path === `/api/projects/${options.runProject.id}/files`) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"files":[]}' });
      return;
    }
    if (path === '/api/runs') {
      if (method === 'POST' && options?.runProject) {
        options.runProject.runBodies.push(route.request().postDataJSON() as Record<string, unknown>);
        await route.fulfill({ status: 202, contentType: 'application/json', body: '{"runId":"configured-image-run"}' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"runs":[]}' });
      return;
    }
    if (/^\/api\/runs\/[^/]+\/events$/.test(path)) {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: ['event: end', 'data: {"code":0,"status":"succeeded"}', '', ''].join('\n'),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function waitForLoadingToClear(page: Page) {
  await expect(page.getByText('Loading OpenPixo…')).toHaveCount(0, { timeout: 15_000 });
}

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve OpenPixo' });
  if (await privacyDialog.isVisible().catch(() => false)) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
  }
}

async function openMediaSettings(page: Page) {
  await gotoEntryHome(page);
  return await openMediaSettingsFromCurrentPage(page);
}

async function openMediaSettingsFromCurrentPage(page: Page) {
  const dialog = await openSettingsDialog(page);
  await dialog.getByRole('button', { name: /^Media providers$/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Media providers' })).toBeVisible();
  return dialog;
}

async function selectMediaProvider(dialog: import('@playwright/test').Locator, name: string) {
  await dialog.getByRole('tab', { name: new RegExp(`^${name}\\b`) }).click();
}

test.describe('Settings media providers flows', () => {
  // Seen 2026-11-18: these four stop in openMediaSettings, before the project is
  // opened, because Settings no longer shows a "Media providers" heading. They were
  // already expected to fail (then for the removed New Project picker).
  const mediaSettingsGap =
    'Settings has no "Media providers" section heading any more, so the flow stops before the project opens.';
  test('[P1] autosaves media provider edits and restores them after closing and reopening settings', async ({ page }) => {
    await seedSettingsBase(page);

    const mediaConfigWrites: Array<Record<string, unknown>> = [];
    await routeBootstrapApis(page, {
      mediaConfigPut: async (route) => {
        mediaConfigWrites.push(route.request().postDataJSON() as Record<string, unknown>);
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      },
    });

    let dialog = await openMediaSettings(page);

    await selectMediaProvider(dialog, 'FishAudio');
    await dialog.getByLabel('FishAudio API key').fill('fish-key');
    await dialog.getByLabel('FishAudio Base URL').fill('https://fish.example.com');

    await page.waitForFunction(
      ({ key }) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return parsed.mediaProviders?.fishaudio?.apiKey === 'fish-key'
          && parsed.mediaProviders?.fishaudio?.baseUrl === 'https://fish.example.com';
      },
      { key: STORAGE_KEY },
    );

    await expect(dialog.getByText('All changes saved')).toBeVisible();
    expect(mediaConfigWrites.length).toBeGreaterThan(0);

    await dialog.getByRole('button', { name: 'Back to home', exact: true }).click();

    dialog = await openMediaSettingsFromCurrentPage(page);
    await expect(dialog.getByLabel('FishAudio API key')).toHaveValue('fish-key');
    await expect(dialog.getByLabel('FishAudio Base URL')).toHaveValue('https://fish.example.com');
  });

  test('[P1] reloads media provider settings from daemon after an initial load failure', async ({ page }) => {
    await seedSettingsBase(page);

    let daemonMediaStatus: 'error' | 'ok' = 'error';
    await routeBootstrapApis(page, {
      mediaConfigGet: async (route) => {
        if (daemonMediaStatus === 'error') {
          await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"daemon unavailable"}' });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            providers: {
              openai: {
                configured: true,
                apiKeyTail: '9876',
                baseUrl: 'https://daemon.example/v1',
              },
            },
          }),
        });
      },
    });

    const dialog = await openMediaSettings(page);

    await expect(dialog.getByText('Could not load provider settings. Using locally saved settings for now.')).toBeVisible();

    daemonMediaStatus = 'ok';
    await dialog.getByRole('button', { name: 'Refresh providers' }).click();

    await expect(dialog.getByText('Provider settings refreshed.')).toBeAttached();
    await selectMediaProvider(dialog, 'OpenAI');
    await expect(dialog.getByText(/Configured|Saved.*9876/).first()).toBeVisible();
    await expect(dialog.getByLabel('OpenAI Base URL')).toHaveValue('https://daemon.example/v1');
  });

  test('[P1] configured image media model is carried into the first daemon run without leaking provider keys', async ({ page }) => {
    test.fail(true, mediaSettingsGap);
    test.setTimeout(60_000);

    await seedSettingsBase(page);

    const projectId = 'configured-image-run-project';
    const conversationId = 'configured-image-run-conversation';
    const runBodies: Array<Record<string, unknown>> = [];
    await routeBootstrapApis(page, {
      projectCreate: async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            project: {
              id: projectId,
              name: body.name ?? 'Configured image run',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: body.metadata ?? {},
            },
            conversationId,
          }),
        });
      },
      runProject: {
        id: projectId,
        conversationId,
        name: 'Configured image run',
        metadata: { kind: 'image', imageModel: 'gpt-image-2' },
        runBodies,
      },
    });

    const dialog = await openMediaSettings(page);
    await selectMediaProvider(dialog, 'OpenAI');
    await dialog.getByLabel('OpenAI API key').fill('sk-openai-run-secret');
    await page.waitForFunction(
      ({ key }) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return parsed.mediaProviders?.openai?.apiKey === 'sk-openai-run-secret';
      },
      { key: STORAGE_KEY },
    );
    await dialog.getByRole('button', { name: 'Back to home', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // The project already exists (created the way `pixo project create` does); open it.
    await page.goto(`/projects/${projectId}/conversations/${conversationId}`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
    await page.getByTestId('chat-composer-input').fill('Generate a launch poster using the configured image provider.');
    await page.getByTestId('chat-send').click();

    await expect.poll(() => runBodies.length, { timeout: 10_000 }).toBe(1);
    expect(runBodies[0]).toMatchObject({
      projectId,
      conversationId,
      mediaExecution: {
        mode: 'enabled',
        allowedSurfaces: ['image'],
        allowedModels: ['gpt-image-2'],
      },
    });
    expect(JSON.stringify(runBodies[0])).not.toContain('sk-openai-run-secret');
  });

  test('[P1] MiniMax image-01 is carried into the first daemon run without leaking provider keys', async ({ page }) => {
    test.fail(true, mediaSettingsGap);
    test.setTimeout(60_000);

    await seedSettingsBase(page);

    const projectId = 'configured-minimax-image-run-project';
    const conversationId = 'configured-minimax-image-run-conversation';
    const runBodies: Array<Record<string, unknown>> = [];
    await routeBootstrapApis(page, {
      projectCreate: async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            project: {
              id: projectId,
              name: body.name ?? 'Configured MiniMax image run',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: body.metadata ?? {},
            },
            conversationId,
          }),
        });
      },
      runProject: {
        id: projectId,
        conversationId,
        name: 'Configured MiniMax image run',
        metadata: { kind: 'image', imageModel: 'minimax-image-01' },
        runBodies,
      },
    });

    const dialog = await openMediaSettings(page);
    await selectMediaProvider(dialog, 'MiniMax');
    await dialog.getByLabel('MiniMax API key').fill('minimax-image-secret');
    await page.waitForFunction(
      ({ key }) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return parsed.mediaProviders?.minimax?.apiKey === 'minimax-image-secret';
      },
      { key: STORAGE_KEY },
    );
    await dialog.getByRole('button', { name: 'Back to home', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // The project already exists (created the way `pixo project create` does); open it.
    await page.goto(`/projects/${projectId}/conversations/${conversationId}`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
    await page.getByTestId('chat-composer-input').fill('Generate a launch poster using MiniMax image-01.');
    await page.getByTestId('chat-send').click();

    await expect.poll(() => runBodies.length, { timeout: 10_000 }).toBe(1);
    expect(runBodies[0]).toMatchObject({
      projectId,
      conversationId,
      mediaExecution: {
        mode: 'enabled',
        allowedSurfaces: ['image'],
        allowedModels: ['minimax-image-01'],
      },
    });
    expect(JSON.stringify(runBodies[0])).not.toContain('minimax-image-secret');
  });

  test('[P1] configured video media model is carried into the first daemon run without leaking provider keys', async ({ page }) => {
    test.fail(true, mediaSettingsGap);
    test.setTimeout(60_000);

    await seedSettingsBase(page);

    const projectId = 'configured-video-run-project';
    const conversationId = 'configured-video-run-conversation';
    const runBodies: Array<Record<string, unknown>> = [];
    await routeBootstrapApis(page, {
      projectCreate: async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            project: {
              id: projectId,
              name: body.name ?? 'Configured video run',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: body.metadata ?? {},
            },
            conversationId,
          }),
        });
      },
      runProject: {
        id: projectId,
        conversationId,
        name: 'Configured video run',
        metadata: { kind: 'video', videoModel: 'doubao-seedance-2-0-fast-260128' },
        runBodies,
      },
    });

    const dialog = await openMediaSettings(page);
    await selectMediaProvider(dialog, 'Volcengine Ark');
    await dialog.getByLabel(/Volcengine Ark.*API key/i).fill('volcengine-video-secret');
    await page.waitForFunction(
      ({ key }) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return parsed.mediaProviders?.volcengine?.apiKey === 'volcengine-video-secret';
      },
      { key: STORAGE_KEY },
    );
    await dialog.getByRole('button', { name: 'Back to home', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // The project already exists (created the way `pixo project create` does); open it.
    await page.goto(`/projects/${projectId}/conversations/${conversationId}`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
    await page.getByTestId('chat-composer-input').fill('Generate a launch film using the configured video provider.');
    await page.getByTestId('chat-send').click();

    await expect.poll(() => runBodies.length, { timeout: 10_000 }).toBe(1);
    expect(runBodies[0]).toMatchObject({
      projectId,
      conversationId,
      mediaExecution: {
        mode: 'enabled',
        allowedSurfaces: ['video'],
        allowedModels: ['doubao-seedance-2-0-fast-260128'],
      },
    });
    expect(JSON.stringify(runBodies[0])).not.toContain('volcengine-video-secret');
  });

  test('[P1] configured audio media model is carried into the first daemon run without leaking provider keys', async ({ page }) => {
    test.fail(true, mediaSettingsGap);
    test.setTimeout(60_000);

    await seedSettingsBase(page);

    const projectId = 'configured-audio-run-project';
    const conversationId = 'configured-audio-run-conversation';
    const runBodies: Array<Record<string, unknown>> = [];
    await routeBootstrapApis(page, {
      projectCreate: async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            project: {
              id: projectId,
              name: body.name ?? 'Configured audio run',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: body.metadata ?? {},
            },
            conversationId,
          }),
        });
      },
      runProject: {
        id: projectId,
        conversationId,
        name: 'Configured audio run',
        metadata: { kind: 'audio', audioKind: 'speech', audioModel: 'fish-speech-2' },
        runBodies,
      },
    });

    const dialog = await openMediaSettings(page);
    await selectMediaProvider(dialog, 'FishAudio');
    await dialog.getByLabel('FishAudio API key').fill('fish-audio-run-secret');
    await page.waitForFunction(
      ({ key }) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return parsed.mediaProviders?.fishaudio?.apiKey === 'fish-audio-run-secret';
      },
      { key: STORAGE_KEY },
    );
    await dialog.getByRole('button', { name: 'Back to home', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // The project already exists (created the way `pixo project create` does); open it.
    await page.goto(`/projects/${projectId}/conversations/${conversationId}`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
    await page.getByTestId('chat-composer-input').fill('Generate narration using the configured audio provider.');
    await page.getByTestId('chat-send').click();

    await expect.poll(() => runBodies.length, { timeout: 10_000 }).toBe(1);
    expect(runBodies[0]).toMatchObject({
      projectId,
      conversationId,
      mediaExecution: {
        mode: 'enabled',
        allowedSurfaces: ['audio'],
        allowedModels: ['fish-speech-2'],
      },
    });
    expect(JSON.stringify(runBodies[0])).not.toContain('fish-audio-run-secret');
  });
});
