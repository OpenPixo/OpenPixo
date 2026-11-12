import {
  panelFileLabel,
  openPanelFile,
  selectPanelView,
  expectAllProjectFilesActive,
  expectAllProjectFilesInactive,
  openAllProjectFiles,
} from '@/playwright/workspace';
import { expect, test } from '@/playwright/suite';
import { ensureRailOpen } from '@/playwright/rail';
import { createProjectViaApi } from '@/playwright/local-project';
import type { Locator, Page, Response } from '@playwright/test';
import { applyStandardMocks, routeSuccessfulRuns, successfulRunEventBody } from '@/playwright/mock-factory';

const CHAT_PANEL_WIDTH_STORAGE_KEY = 'openpixo.project.chatPanelWidth';

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
});

test('[P1] quick switcher opens from keyboard and activates the selected file', async ({ page }) => {
  await gotoEntryHome(page);
  await createProject(page, 'Quick switcher keyboard flow');
  await expectWorkspaceReady(page);

  await uploadTinyPng(page, 'alpha-file.png');
  await uploadTinyPng(page, 'beta-file.png');

  const alphaItem = panelFileLabel(page, 'alpha-file.png');
  const betaItem = panelFileLabel(page, 'beta-file.png');
  await expect(betaItem).toBeVisible();
  await expect(alphaItem).toBeHidden();
  await openPanelFile(page, 'alpha-file.png');
  await expect(alphaItem).toBeVisible();

  await openQuickSwitcher(page);
  const quickSwitcher = page.locator('.qs-overlay');
  const quickSwitcherInput = page.locator('.qs-input');
  await expect(quickSwitcher).toBeVisible();
  await expect(quickSwitcherInput).toBeVisible();

  await quickSwitcherInput.fill('beta');
  await expect(page.getByRole('option', { name: /beta-file\.png/i }).first()).toBeVisible();
  await quickSwitcherInput.press('Enter');

  await expect(quickSwitcher).toBeHidden();
  await expect(betaItem).toBeVisible();
  await expect(alphaItem).toBeHidden();

  await openQuickSwitcher(page);
  await expect(quickSwitcher).toBeVisible();
  await quickSwitcherInput.press('Escape');
  await expect(quickSwitcher).toBeHidden();
});

test('[P1] quick switcher keeps the current file when search has no matches', async ({ page }) => {
  await gotoEntryHome(page);
  await createProject(page, 'Quick switcher empty search flow');
  await expectWorkspaceReady(page);

  await uploadTinyPng(page, 'alpha-empty-search.png');
  await uploadTinyPng(page, 'beta-empty-search.png');

  const alphaItem = panelFileLabel(page, 'alpha-empty-search.png');
  await openPanelFile(page, 'alpha-empty-search.png');
  await expect(alphaItem).toBeVisible();

  await openQuickSwitcher(page);
  const quickSwitcher = page.locator('.qs-overlay');
  const quickSwitcherInput = page.locator('.qs-input');
  await expect(quickSwitcher).toBeVisible();

  await quickSwitcherInput.fill('no-file-with-this-name');
  await expect(page.locator('.qs-empty')).toBeVisible();
  // Scoped to the switcher: the composer's permission <select> has options too.
  await expect(quickSwitcher.getByRole('option')).toHaveCount(0);

  await quickSwitcherInput.press('Enter');
  await expect(quickSwitcher).toBeVisible();
  await quickSwitcherInput.press('Escape');
  await expect(quickSwitcher).toBeHidden();
  await expect(alphaItem).toBeVisible();
});

test('[P1] quick switcher arrow keys move selection before opening a file', async ({ page }) => {
  await gotoEntryHome(page);
  await createProject(page, 'Quick switcher arrow navigation flow');
  await expectWorkspaceReady(page);

  await uploadTinyPng(page, 'arrow-alpha.png');
  await uploadTinyPng(page, 'arrow-beta.png');
  await uploadTinyPng(page, 'arrow-gamma.png');

  await openQuickSwitcher(page);
  const quickSwitcher = page.locator('.qs-overlay');
  const quickSwitcherInput = page.locator('.qs-input');
  const selectedOption = quickSwitcher.getByRole('option', { selected: true });
  await expect(quickSwitcher).toBeVisible();
  expect(await quickSwitcher.getByRole('option').count()).toBeGreaterThanOrEqual(3);

  const initialSelection = await selectedOption.textContent();
  await quickSwitcherInput.press('ArrowDown');
  const nextSelection = await selectedOption.textContent();
  expect(nextSelection).not.toBe(initialSelection);

  await quickSwitcherInput.press('Enter');
  await expect(quickSwitcher).toBeHidden();

  const selectedFileName = selectedBaseName(nextSelection);
  await expect(panelFileLabel(page, selectedFileName)).toBeVisible();
});

test('[P1] panel menu opens file search and pushes the selected preview onto Library', async ({ page }) => {
  await gotoEntryHome(page);
  await createProject(page, 'Workspace launcher file search');
  await expectWorkspaceReady(page);

  const projectId = currentProjectId(page);
  await seedProjectFile(page, projectId, 'launcher-alpha.png', TINY_PNG_B64, 'base64');
  await seedProjectFile(page, projectId, 'launcher-beta.png', TINY_PNG_B64, 'base64');
  await page.reload();
  await expectWorkspaceReady(page);

  await openAllProjectFiles(page);
  await expectAllProjectFilesActive(page);

  await page.getByTestId('panel-more-menu').click();
  await page.getByTestId('panel-menu-open-file').click();
  const palette = page.locator('.qs-overlay');
  await expect(palette).toBeVisible();
  await palette.locator('.qs-input').fill('launcher-beta');
  await palette.getByRole('option', { name: /launcher-beta\.png/i }).click();
  await expect(palette).toBeHidden();
  await expectAllProjectFilesInactive(page);
  await expect(panelFileLabel(page, 'launcher-beta.png')).toBeVisible();
});

test('[P1] panel views keep independent stacks and Back or Esc releases only the current item', async ({ page }) => {
  await createProject(page, 'Independent panel stacks');
  await expectWorkspaceReady(page);
  const projectId = currentProjectId(page);
  await expect(page.getByTestId('file-workspace')).toHaveAttribute('data-panel-view', 'game');
  let created = 0;
  const killed: string[] = [];
  await page.route(`**/api/projects/${projectId}/terminals**`, async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/terminals')) {
      const id = `panel-terminal-${++created}`;
      await route.fulfill({ json: { terminal: { id, projectId, cwd: '.', shell: 'mock', cols: 80, rows: 24,
        status: 'running', createdAt: 1, updatedAt: 1, exitCode: null, signal: null } } });
    } else if (pathname.endsWith('/stream')) {
      await route.fulfill({ contentType: 'text/event-stream', body: 'event: exit\ndata: {"code":0,"signal":null}\n\n' });
    } else {
      if (pathname.endsWith('/kill')) killed.push(pathname.split('/').at(-2)!);
      await route.fulfill({ json: { ok: true } });
    }
  });
  const newTerminal = async () => {
    await page.getByTestId('panel-more-menu').click();
    await page.getByTestId('panel-menu-new-terminal').click();
    await expect(page.getByTestId('terminal-viewer')).toBeVisible();
  };
  await newTerminal();
  await expect(page.getByTestId('panel-stack-label')).toHaveAttribute('title', 'terminal:panel-terminal-1');
  await selectPanelView(page, 'changes');
  await expect(page.getByTestId('panel-stack-back')).toBeHidden();
  await newTerminal();
  await expect(page.getByTestId('panel-stack-label')).toHaveAttribute('title', 'terminal:panel-terminal-2');
  await selectPanelView(page, 'library');
  await uploadTinyPng(page, 'stack-file.png');
  await selectPanelView(page, 'game');
  await expect(page.getByTestId('panel-stack-label')).toHaveAttribute('title', 'terminal:panel-terminal-1');
  await page.getByTestId('panel-more-menu').click();
  await page.getByTestId('panel-menu-extensions').press('Escape');
  await expect(page.getByTestId('panel-more-menu')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('panel-stack-label')).toHaveAttribute('title', 'terminal:panel-terminal-1');
  await page.getByTestId('panel-stack-back').press('Escape');
  await expect(page.getByTestId('panel-stack-back')).toBeHidden();
  await expect.poll(() => killed).toEqual(['panel-terminal-1']);
  await selectPanelView(page, 'changes');
  await expect(page.getByTestId('panel-stack-label')).toHaveAttribute('title', 'terminal:panel-terminal-2');
  await page.getByTestId('panel-stack-back').click();
  await expect.poll(() => killed).toEqual(['panel-terminal-1', 'panel-terminal-2']);
  await selectPanelView(page, 'library');
  await expect(panelFileLabel(page, 'stack-file.png')).toBeVisible();
  await page.getByTestId('panel-stack-back').press('Escape');
  await expectAllProjectFilesActive(page);
  await selectPanelView(page, 'changes');
  await page.reload();
  await expect(page.getByTestId('file-workspace')).toHaveAttribute('data-panel-view', 'changes');
  await expect(page.getByTestId('panel-view-switcher').getByRole('tab', { name: 'Changes', exact: true }))
    .toHaveAttribute('aria-selected', 'true');
});

test('[P1] project tab shortcuts keep their project scope while a panel file is open', async ({ page }) => {
  await createProject(page, 'Project shortcut scope');
  await expectWorkspaceReady(page);
  const projectId = currentProjectId(page);
  await uploadTinyPng(page, 'shortcut-file.png');
  await page.getByTestId('panel-stack-back').focus();
  const projectUrl = new RegExp(`/projects/${projectId}(?:/|$)`);
  // Ctrl/Cmd+T shows the one permanent Home tab; Ctrl/Cmd+W never closes it.
  await page.keyboard.press('ControlOrMeta+T');
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press('ControlOrMeta+W');
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press('Control+Tab');
  await expect(page).toHaveURL(projectUrl);
  await expect(panelFileLabel(page, 'shortcut-file.png')).toBeVisible();
  await page.keyboard.press('Control+Shift+Tab');
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press('Control+Tab');
  await expect(panelFileLabel(page, 'shortcut-file.png')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+1');
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press('ControlOrMeta+2');
  await expect(panelFileLabel(page, 'shortcut-file.png')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+9');
  await expect(panelFileLabel(page, 'shortcut-file.png')).toBeVisible();
  await page.getByTestId('panel-stack-back').press('Escape');
  await expectAllProjectFilesActive(page);
});

test('[P1] keyboard chat panel resize persists after reload', async ({ page }) => {
  await gotoEntryHome(page);
  await createProject(page, 'Chat panel resize persistence');
  await expectWorkspaceReady(page);

  await page.evaluate((key) => {
    window.localStorage.removeItem(key);
  }, CHAT_PANEL_WIDTH_STORAGE_KEY);
  await page.reload();
  await expectWorkspaceReady(page);

  const handle = page.locator('.split-resize-handle');
  await expect(handle).toBeVisible();

  const initialWidth = await readChatPanelWidth(handle);
  await handle.focus();
  await page.keyboard.press('End');
  let resizedWidth = await readChatPanelWidth(handle);
  if (resizedWidth === initialWidth) {
    await page.keyboard.press('Home');
    resizedWidth = await readChatPanelWidth(handle);
  }
  expect(resizedWidth).not.toBe(initialWidth);

  const savedWidth = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    CHAT_PANEL_WIDTH_STORAGE_KEY,
  );
  expect(savedWidth).toBe(String(resizedWidth));

  await page.reload();
  await expectWorkspaceReady(page);
  const restoredWidth = await readChatPanelWidth(handle);
  expect(restoredWidth).toBe(resizedWidth);
});

test('[P0] @critical project chat Enter sends while Shift+Enter inserts a newline', async ({ page }) => {
  const runRequests = await routeSuccessfulRuns(page, {
    runIdPrefix: 'keyboard-run',
    eventBody: successfulRunEventBody([
      'event: start',
      'data: {"bin":"mock-agent"}',
      '',
      'event: stdout',
      `data: ${JSON.stringify({
        chunk:
          '<artifact identifier="keyboard-artifact" type="text/html" title="Keyboard Artifact"><!doctype html><html><body><main><h1>Keyboard Artifact</h1></main></body></html></artifact>',
      })}`,
      '',
    ]),
  });

  await gotoEntryHome(page);
  await createProject(page, 'Project chat keyboard send');
  await expectWorkspaceReady(page);

  const input = page.getByTestId('chat-composer-input');
  await input.click();
  await input.fill('first line');
  await input.press('Shift+Enter');
  await input.pressSequentially('second line');
  // Lexical renders the soft break as separate block nodes, so the editor's
  // textContent collapses the newline; assert both lines are present rather
  // than an exact "\n"-joined value. The newline reaching the sent message is
  // verified by the `.msg.user` assertions below.
  await expect(input).toContainText('first line');
  await expect(input).toContainText('second line');
  await runRequests.expectNone({ timeout: 100 });

  await Promise.all([
    page.waitForResponse(isCreateRunResponse, { timeout: 5_000 }),
    input.press('Enter'),
  ]);

  await runRequests.expectCount(1);
  await expect(input).toHaveText('');
  await expect(page.locator('.msg.user', { hasText: 'first line' })).toHaveCount(1);
  await expect(page.locator('.msg.user', { hasText: 'second line' })).toHaveCount(1);
  await selectPanelView(page, 'library');
  await expect(panelFileLabel(page, /keyboard-artifact\.html/i)).toBeVisible();
});

test('[P1] quick switcher still activates another file after the project reloads', async ({ page }) => {
  await gotoEntryHome(page);
  await createProject(page, 'Quick switcher after reload');
  await expectWorkspaceReady(page);
  const projectId = currentProjectId(page);

  await uploadTinyPng(page, 'reload-alpha.png');
  await uploadTinyPng(page, 'reload-beta.png');

  const alphaItem = panelFileLabel(page, 'reload-alpha.png');
  const betaItem = panelFileLabel(page, 'reload-beta.png');
  await openPanelFile(page, 'reload-alpha.png');
  await expect(alphaItem).toBeVisible();
  await expect(betaItem).toBeHidden();

  await page.reload();
  await expectWorkspaceReady(page);
  await expect(alphaItem).toBeVisible();

  await openQuickSwitcher(page);
  const quickSwitcher = page.locator('.qs-overlay');
  const quickSwitcherInput = page.locator('.qs-input');
  await expect(quickSwitcher).toBeVisible();

  await quickSwitcherInput.fill('reload-beta');
  await expect(quickSwitcher.getByRole('option', { name: /reload-beta\.png/i }).first()).toBeVisible();
  await quickSwitcherInput.press('Enter');

  await expect(quickSwitcher).toBeHidden();
  await expect(betaItem).toBeVisible();
  await expect(alphaItem).toBeHidden();
  await expectProjectFilesToIncludeSuffixes(page, projectId, ['reload-alpha.png', 'reload-beta.png']);
});

test('[P1] quick switcher only lists files from the active project after switching projects', async ({ page }) => {
  await gotoEntryHome(page);
  await createProject(page, 'Quick switcher Project Alpha');
  await expectWorkspaceReady(page);
  const alphaProjectId = currentProjectId(page);

  await uploadTinyPng(page, 'alpha-project-file.png');
  await uploadTinyPng(page, 'alpha-project-secondary.png');
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await expectProjectsView(page);

  await createProject(page, 'Quick switcher Project Beta');
  await expectWorkspaceReady(page);
  const betaProjectId = currentProjectId(page);

  await uploadTinyPng(page, 'beta-project-file.png');
  await uploadTinyPng(page, 'beta-project-secondary.png');

  await openQuickSwitcher(page);
  const quickSwitcher = page.locator('.qs-overlay');
  const quickSwitcherInput = page.locator('.qs-input');
  await expect(quickSwitcher).toBeVisible();

  await quickSwitcherInput.fill('project');
  await expect(quickSwitcher.getByRole('option', { name: /beta-project-file\.png/i }).first()).toBeVisible();
  await expect(quickSwitcher.getByRole('option', { name: /beta-project-secondary\.png/i }).first()).toBeVisible();
  await expect(quickSwitcher.getByRole('option', { name: /alpha-project-file\.png/i })).toHaveCount(0);
  await expect(quickSwitcher.getByRole('option', { name: /alpha-project-secondary\.png/i })).toHaveCount(0);
  await expectProjectFilesToIncludeSuffixes(page, betaProjectId, ['beta-project-file.png', 'beta-project-secondary.png']);
  await expectProjectFilesToIncludeSuffixes(page, alphaProjectId, ['alpha-project-file.png', 'alpha-project-secondary.png']);

  await quickSwitcherInput.press('Escape');
  await expect(quickSwitcher).toBeHidden();
});

test('[P1] quick switcher leaves the Files panel and pushes the selected file onto the Library stack', async ({ page }) => {
  await gotoEntryHome(page);
  await createProject(page, 'Quick switcher from Files');
  await expectWorkspaceReady(page);

  await uploadTinyPng(page, 'file-list-alpha.png');
  await uploadTinyPng(page, 'file-list-beta.png');

  await openAllProjectFiles(page);
  await expectAllProjectFilesActive(page);

  // #5517 deleted the preview pane, so "parked on the Files panel" is
  // now expressed by the panel being the active surface with its rows on
  // screen. Clicking a row would open that file and leave the panel, which is
  // exactly the transition this test wants the quick switcher to perform.
  await expect(rowBySuffix(page, 'file-list-beta.png')).toBeVisible();

  await openQuickSwitcher(page);
  const quickSwitcher = page.locator('.qs-overlay');
  const quickSwitcherInput = page.locator('.qs-input');
  await expect(quickSwitcher).toBeVisible();

  await quickSwitcherInput.fill('file-list-alpha');
  await expect(quickSwitcher.getByRole('option', { name: /file-list-alpha\.png/i }).first()).toBeVisible();
  await quickSwitcherInput.press('Enter');

  await expect(quickSwitcher).toBeHidden();
  await expectAllProjectFilesInactive(page);
  await expect(panelFileLabel(page, /file-list-alpha\.png/i)).toBeVisible();
  await expect(page.getByTestId('design-file-preview')).toHaveCount(0);
});

test('[P1] quick switcher can switch from an uploaded file back to a generated artifact in the stack', async ({ page }) => {
  const artifact =
    '<artifact identifier="quick-switcher-artifact" type="text/html" title="Quick Switcher Artifact">' +
    '<!doctype html><html><body><main><h1>Quick Switcher Artifact</h1></main></body></html>' +
    '</artifact>';
  await routeSuccessfulRuns(page, {
    runIdPrefix: 'mock-run',
    eventBody: successfulRunEventBody([
      'event: start',
      'data: {"bin":"mock-agent"}',
      '',
      'event: stdout',
      `data: ${JSON.stringify({ chunk: artifact })}`,
      '',
    ]),
  });

  await gotoEntryHome(page);
  await createProject(page, 'Quick switcher artifact mix');
  await expectWorkspaceReady(page);

  // Review generated output in Library; background turns never switch views.
  await selectPanelView(page, 'library');
  await sendPrompt(page, 'Create a quick switcher artifact');
  await expect(page.getByTestId('file-workspace')).toHaveAttribute('data-panel-view', 'library');
  const artifactItem = panelFileLabel(page, /quick-switcher-artifact\.html/i);
  await expect(artifactItem).toBeVisible();

  await uploadTinyPng(page, 'artifact-mix-file.png');
  const fileItem = panelFileLabel(page, 'artifact-mix-file.png');
  await openPanelFile(page, 'artifact-mix-file.png');
  await expect(fileItem).toBeVisible();
  await expect(artifactItem).toBeHidden();

  await openQuickSwitcher(page);
  const quickSwitcher = page.locator('.qs-overlay');
  const quickSwitcherInput = page.locator('.qs-input');
  await expect(quickSwitcher).toBeVisible();

  await quickSwitcherInput.fill('quick-switcher-artifact');
  await expect(quickSwitcher.getByRole('option', { name: /quick-switcher-artifact\.html/i }).first()).toBeVisible();
  await quickSwitcherInput.press('Enter');

  await expect(quickSwitcher).toBeHidden();
  await expect(artifactItem).toBeVisible();
  await expect(fileItem).toBeHidden();
  const current = new URL(page.url());
  const [, projects, projectId] = current.pathname.split('/');
  if (projects !== 'projects' || !projectId) throw new Error(`unexpected project route: ${current.pathname}`);
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/projects/${projectId}/files/quick-switcher-artifact.html`);
      if (!response.ok()) return '';
      return response.text();
    })
    .toContain('Quick Switcher Artifact');
});


async function createProject(
  page: Page,
  projectName: string,
) {
  const projectId = `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await createProjectViaApi(page, projectId, projectName);
  await page.goto(`/projects/${projectId}`);
}

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Loading OpenPixo…').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve OpenPixo' });
  if (await privacyDialog.isVisible()) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
    await expect(privacyDialog).toHaveCount(0);
  }
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
}

async function expectProjectsView(page: Page) {
  const legacyProjectsToolbar = page.locator('.tab-panel-toolbar');
  const projectsHeading = page.getByRole('heading', { name: /^Projects$/i });
  const homeRecentProjects = page.getByRole('heading', { name: /recent projects|最近项目/i });
  if (await legacyProjectsToolbar.isVisible().catch(() => false)) return;
  if (await projectsHeading.isVisible().catch(() => false)) return;
  if (await homeRecentProjects.isVisible().catch(() => false)) return;

  await ensureRailOpen(page);
  const projectsNav = page.getByTestId('entry-nav-projects');
  if (await projectsNav.isVisible().catch(() => false)) {
    await projectsNav.click();
    await expect(legacyProjectsToolbar).toBeVisible();
    return;
  }

  await expect(projectsHeading.or(homeRecentProjects)).toBeVisible();
}

async function expectWorkspaceReady(page: Page) {
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByText('Loading OpenPixo…')).toHaveCount(0);
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  await expect(page.getByTestId('file-workspace')).toBeVisible();
}

async function uploadTinyPng(
  page: Page,
  name: string,
) {
  const pngBytes = Buffer.from(TINY_PNG_B64, 'base64');
  await page.getByTestId('file-list-upload-input').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: pngBytes,
  });
  await expect(panelFileLabel(page, name)).toBeVisible();
}

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W6McAAAAASUVORK5CYII=';

async function seedProjectFile(
  page: Page,
  projectId: string,
  name: string,
  content: string,
  encoding?: 'base64',
) {
  const response = await page.request.post(`/api/projects/${projectId}/files`, {
    data: {
      name,
      content,
      ...(encoding ? { encoding } : {}),
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function listProjectFiles(page: Page, projectId: string) {
  const response = await page.request.get(`/api/projects/${projectId}/files`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { files: Array<{ name: string }> };
  return body.files;
}

async function expectProjectFilesToIncludeSuffixes(
  page: Page,
  projectId: string,
  suffixes: string[],
) {
  await expect
    .poll(async () => {
      const names = (await listProjectFiles(page, projectId)).map((file) => file.name);
      return suffixes.every((suffix) => names.some((name) => name.endsWith(suffix)));
    })
    .toBe(true);
}

async function readChatPanelWidth(handle: Locator): Promise<number> {
  const raw = await handle.getAttribute('aria-valuenow');
  const parsed = Number.parseInt(raw ?? '', 10);
  expect(Number.isFinite(parsed)).toBeTruthy();
  return parsed;
}

async function openQuickSwitcher(page: Page) {
  const quickSwitcher = page.locator('.qs-overlay');
  await page.keyboard.press('Meta+P');
  if (await quickSwitcher.isVisible()) return;
  await page.keyboard.press('Control+P');
  await expect(quickSwitcher).toBeVisible();
}

async function sendPrompt(page: Page, prompt: string) {
  const input = page.getByTestId('chat-composer-input');
  const sendButton = page.getByTestId('chat-send');
  await input.click();
  await input.fill(prompt);
  await expect(input).toHaveText(prompt, { timeout: 1500 });
  await expect(sendButton).toBeEnabled({ timeout: 1500 });
  const chatResponse = page.waitForResponse(isCreateRunResponse, { timeout: 2000 });
  await sendButton.evaluate((button: HTMLButtonElement) => button.click());
  await chatResponse;
}


// Uploaded files can land under a deduplicated name, and #5517 image cards
// carry no visible filename text, so match the row by its `data-testid`
// suffix instead of by rendered text.
function rowBySuffix(page: Page, name: string): Locator {
  return page.locator(`[data-testid^="design-file-row-"][data-testid$="${name}"]`).first();
}

function currentProjectId(page: Page): string {
  const url = new URL(page.url());
  const [, projectId] = url.pathname.match(/\/projects\/([^/]+)/) ?? [];
  expect(projectId).toBeTruthy();
  return projectId!;
}

function selectedBaseName(selectionText: string | null): string {
  const normalized = selectionText?.replace(/\s+/g, ' ').trim() ?? '';
  const match = normalized.match(/arrow-(alpha|beta|gamma)\.png/i);
  expect(match?.[0]).toBeTruthy();
  return match![0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCreateRunResponse(resp: Response): boolean {
  const url = new URL(resp.url());
  return url.pathname === '/api/runs' && resp.request().method() === 'POST';
}
