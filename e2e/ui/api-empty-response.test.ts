import { expect, test } from '@/playwright/suite';
import {
  fulfillAgentsRoute,
  routeSuccessfulRuns,
  suppressWhatsNew,
} from '@/playwright/mock-factory';
import { createProjectViaApi } from '@/playwright/local-project';
import type { Page } from '@playwright/test';
import { T } from '@/timeouts';

const STORAGE_KEY = 'pixo:config';

test.describe.configure({ timeout: T.xlong });

test.beforeEach(async ({ page }) => {
  /*
   * 版本更新弹窗会**盖住整条顶部 chrome**,而这条用例要从那里点开新建项目。
   *
   * 它不是一直如此:共享 `Dialog` 的遮罩原来是 `z-index: 100`,压不过
   * `.workspace-tabs-chrome`(120),于是弹窗开着也照样点得到侧栏开关 ——
   * 这条用例一直在**借那个缺陷**过关。`8d0b542d0a`(产品裁决 2026-09-07「那都修掉」)
   * 把 `packages/components/src/dialog.module.css` 的 `.backdrop` 抬到 1500,
   * 遮罩终于兑现了「我后面的东西都失效」这句承诺,这条用例随之卡死在
   * `ensureRailOpen` 的那次点击上(`timeout: 0`,一直等到整条用例超时)。
   *
   * 处置和其余 17 个走 `applyStandardMocks` 的 UI 文件一致:把这条**与本用例无关**
   * 的发版公告挡在外面。本用例考的是「空流应当显示批准的失败标题而不是 Done」。
   */
  await suppressWhatsNew(page);
  await page.addInitScript((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        mode: 'api',
        apiProtocol: 'openai',
        apiKey: 'test-byok-key',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        agentId: null,
        skillId: null,
        onboardingCompleted: true,
        agentModels: {},
        privacyDecisionAt: 1,
        telemetry: { metrics: false, content: false, artifactManifest: false },
      }),
    );
  }, STORAGE_KEY);

  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        config: {
          onboardingCompleted: true,
          agentId: null,
          skillId: null,
          agentModels: {},
          privacyDecisionAt: 1,
          telemetry: { metrics: false, content: false, artifactManifest: false },
        },
      },
    });
  });
  // DeepSeek's own endpoint runs through native Codex
  // (`nativeCodexProviderForConfig`), so that is the agent the send preflight
  // needs; without it ProjectView refuses the send before POST /api/runs.
  await page.route('**/api/agents**', async (route) => {
    await fulfillAgentsRoute(route, [
      {
        id: 'codex',
        name: 'Codex CLI',
        bin: 'codex',
        available: true,
        version: 'test',
        models: [{ id: 'default', label: 'Default' }],
      },
    ]);
  });
});

test('[P0] @critical API empty stream shows approved failure status instead of Done', async ({ page }) => {
  const runRequests = await routeSuccessfulRuns(page, { runIdPrefix: 'api-empty-response-run' });

  await gotoEntryHome(page);
  await createProject(page, 'API empty response smoke');
  await expectWorkspaceReady(page);
  await sendPrompt(page, 'Create a login page');

  await runRequests.expectCount(1);
  await expect(page.locator('.assistant-label', { hasText: 'The task could not be completed' })).toBeVisible();
  await expect(page.getByText('This task failed to run. Please retry. If it fails again, please contact support.', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.assistant-label', { hasText: 'Done' })).toHaveCount(0);
});

async function createProject(page: Page, name: string) {
  const projectId = `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await createProjectViaApi(page, projectId, name);
  await page.goto(`/projects/${projectId}`);
}

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

async function expectWorkspaceReady(page: Page) {
  await waitForLoadingToClear(page);
  await expect(page).toHaveURL(/\/projects\//, { timeout: T.long });
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  await expect(page.getByTestId('file-workspace')).toBeVisible();
}

async function sendPrompt(page: Page, prompt: string) {
  const input = page.getByTestId('chat-composer-input');
  const sendButton = page.getByTestId('chat-send');
  await expect(input).toBeVisible({ timeout: 3_000 });
  await input.fill(prompt);
  await expect(sendButton).toBeEnabled();
  await Promise.all([
    page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return url.pathname === '/api/runs' && response.request().method() === 'POST';
      },
      { timeout: T.long },
    ),
    sendButton.click(),
  ]);
}

async function waitForLoadingToClear(page: Page) {
  await page.getByText('Loading OpenPixo…').waitFor({ state: 'hidden', timeout: T.medium });
}
