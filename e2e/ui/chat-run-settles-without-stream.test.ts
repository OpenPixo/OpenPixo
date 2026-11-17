import { join } from 'node:path';
import type { Page, Response } from '@playwright/test';
import { expect, test } from '@/playwright/suite';
import { createProjectViaApi } from '@/playwright/local-project';
import { createFakeAgentRuntimes } from '@/playwright/fake-agents';
import { T } from '@/timeouts';

/*
 * Red spec for the chat that kept saying a run was going after it had ended
 * (stop button, run status line and a disabled 批准 card, for over an hour).
 *
 * The browser's view of a run came only from that run's own event stream. When
 * the stream never answered, nothing asked the daemon again, so a run the
 * daemon had finished stayed "running" on the page until a reload. Here the
 * browser holds every `/api/runs/:id/events` request open and never answers it;
 * the daemon still runs the turn to the end. The chat must settle on its own.
 */

const STORAGE_KEY = 'pixo:config';
// The fake agent takes about 15 s for this prompt.
const SLOW_PROMPT = 'Create a slow reload deterministic smoke artifact';
let fakeRuntimes: Awaited<ReturnType<typeof createFakeAgentRuntimes>>;

test.beforeAll(async ({ toolsDev }) => {
  fakeRuntimes = await createFakeAgentRuntimes({
    root: join(toolsDev.root, 'scratch', 'fake-agent-runtimes'),
    runtimeIds: ['opencode'],
  });
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('[P1] a run that ended settles the chat even when its event stream never answers', async ({ page }) => {
  test.setTimeout(Math.max(T.xlong, 150_000));
  const env = fakeRuntimes.opencode.env;
  const config = await page.request.put('/api/app-config', {
    data: {
      onboardingCompleted: true,
      agentId: 'opencode',
      agentModels: { opencode: { model: 'default', reasoning: 'default' } },
      agentCliEnv: { opencode: env },
      skillId: null,
    },
  });
  expect(config.ok()).toBeTruthy();
  await page.addInitScript(({ key, agentEnv }) => {
    window.localStorage.setItem(key, JSON.stringify({
      mode: 'daemon', apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'default',
      agentId: 'opencode', skillId: null, onboardingCompleted: true,
      agentModels: { opencode: { model: 'default', reasoning: 'default' } },
      agentCliEnv: { opencode: agentEnv },
    }));
  }, { key: STORAGE_KEY, agentEnv: env });

  const projectId = `stale-stream-${Date.now()}`;
  const { conversationId } = await createProjectViaApi(page, projectId, 'Stale stream');
  await page.goto(`/projects/${projectId}/conversations/${conversationId}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Loading OpenPixo…').waitFor({ state: 'hidden', timeout: T.long });
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve OpenPixo' });
  if (await privacyDialog.isVisible()) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
  }

  // The run's event stream is held: the request is sent and never answered.
  await page.route(/\/api\/runs\/[^/]+\/events(\?|$)/, () => new Promise<void>(() => {}));

  const input = page.getByTestId('chat-composer-input');
  await expect(input).toBeVisible();
  await input.click();
  await input.fill(SLOW_PROMPT);
  const [created] = await Promise.all([
    page.waitForResponse(isCreateRunResponse, { timeout: T.medium }),
    page.getByTestId('chat-send').click(),
  ]);
  expect(created.ok()).toBeTruthy();
  const { runId } = (await created.json()) as { runId: string };
  await expect(page.getByTestId('chat-stop')).toBeVisible();

  await expect
    .poll(async () => runStatus(page, runId), { timeout: 60_000 })
    .toBe('succeeded');

  // The daemon has finished the run; the page has heard nothing from its stream.
  await expect(page.getByTestId('chat-stop')).toHaveCount(0, { timeout: 45_000 });
  await expect(page.getByTestId('chat-send')).toBeVisible();
  await expect(page.getByTestId('chat-run-status')).not.toHaveAttribute('data-tone', 'busy');
});

async function runStatus(page: Page, runId: string): Promise<string> {
  const response = await page.request.get(`/api/runs/${runId}`);
  if (!response.ok()) return `http-${response.status()}`;
  return ((await response.json()) as { status: string }).status;
}

function isCreateRunResponse(response: Response): boolean {
  return new URL(response.url()).pathname === '/api/runs' && response.request().method() === 'POST';
}
