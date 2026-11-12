import {
  panelFileLabel,
  openPanelFile,
  selectPanelView,
  expectAllProjectFilesActive,
  openAllProjectFiles,
  answerDeleteConfirm,
  libraryTypeFilter,
  selectLibraryType,
  setLibraryLayout,
} from '@/playwright/workspace';
import { expect, test } from '@/playwright/suite';
import { createProjectViaApi as createProjectApi } from '@/playwright/local-project';
import { applyStandardMocks, routeAgents } from '@/playwright/mock-factory';
import type { Locator, Page, Request } from '@playwright/test';
import { automatedUiScenarios } from '@/playwright/resources';
import type { UiScenario } from '@/playwright/resources';
import { T } from '@/timeouts';
import {
  PREVIEW_WHITE_SCREEN_CONFIRMATION_MS,
  PREVIEW_WHITE_SCREEN_TIMEOUT_MS,
} from '@openpixo/contracts/runtime/preview-observability';

const STORAGE_KEY = 'pixo:config';
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W6McAAAAASUVORK5CYII=';

interface CapturedSafetyEvent {
  event?: string;
  properties?: Record<string, unknown>;
}

test.describe.configure({ timeout: T.xlong });

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
});

const designFileFlows = new Set([
  'file-list-upload',
  'file-list-delete',
  'panel-stack-persistence',
  'uploaded-image-renders-in-preview',
  'python-source-preview',
]);
const CRITICAL_DESIGN_FILE_SCENARIO_IDS = new Set([
  'file-list-upload',
  'file-list-delete',
  'panel-stack-persistence',
]);

async function routeMockAgents(page: Page) {
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
}

async function captureSafetyTelemetry(page: Page): Promise<CapturedSafetyEvent[]> {
  const events: CapturedSafetyEvent[] = [];
  await page.unroute('**/api/app-config').catch(() => {});
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
        privacyDecisionAt: 1,
        telemetry: { metrics: true, content: false, artifactManifest: false },
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
          agentId: 'mock',
          skillId: null,
          agentModels: {},
          privacyDecisionAt: 1,
          telemetry: { metrics: true, content: false, artifactManifest: false },
        },
      },
    });
  });
  await page.route('**/api/analytics/config', async (route) => {
    await route.fulfill({
      json: {
        enabled: true,
        env: 'e2e',
        key: 'phc_e2e',
        host: 'https://analytics.openpixo.test',
        installationId: 'e2e-installation',
      },
    });
  });
  await page.route('https://analytics.openpixo.test/**', async (route) => {
    const body = route.request().postData();
    if (body) {
      try {
        events.push(JSON.parse(body) as CapturedSafetyEvent);
      } catch {
        // posthog-js can use non-JSON batch encodings; this witness owns only
        // the direct JSON safety-telemetry transport.
      }
    }
    await route.fulfill({ status: 200, json: { status: 1 } });
  });
  return events;
}

function capturedWhiteScreenEvents(
  events: CapturedSafetyEvent[],
): CapturedSafetyEvent[] {
  return events.filter((event) => event.event === 'client_preview_white_screen');
}

for (const entry of automatedUiScenarios().filter((scenario) => designFileFlows.has(scenario.flow ?? ''))) {
  test(`[${designFileScenarioPriority(entry)}]${criticalDesignFileScenarioTag(entry)} ${entry.id}: ${entry.title}`, async ({ page }) => {
    await routeMockAgents(page);

    await gotoEntryHome(page);
    await createProject(page, entry);
    await expectWorkspaceReady(page);

    if (entry.flow === 'file-list-upload') {
      await runDesignFilesUploadFlow(page);
      return;
    }
    if (entry.flow === 'file-list-delete') {
      await runDesignFilesDeleteFlow(page);
      return;
    }
    if (entry.flow === 'panel-stack-persistence') {
      await runPanelStackPersistenceFlow(page);
      return;
    }
    if (entry.flow === 'uploaded-image-renders-in-preview') {
      await runUploadedImageRendersInPreviewFlow(page, entry);
      return;
    }
    if (entry.flow === 'python-source-preview') {
      await runPythonSourcePreviewFlow(page, entry);
    }
  });
}

async function createProject(page: Page, entry: UiScenario) {
  await openProjectViaApi(page, entry.create.projectName);
}

async function openProjectViaApi(page: Page, name: string) {
  const projectId = await createProjectViaApi(page, name);
  await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
}

async function createProjectViaApi(page: Page, name: string): Promise<string> {
  const projectId = `markdown-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await createProjectApi(page, projectId, name);
  return projectId;
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
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  await expect(page.getByTestId('file-workspace')).toBeVisible();
}

async function getCurrentProjectContext(page: Page): Promise<{ projectId: string; conversationId: string }> {
  const current = new URL(page.url());
  const [, projects, projectId, maybeConversations, conversationId] = current.pathname.split('/');
  if (projects !== 'projects' || !projectId) {
    throw new Error(`unexpected project route: ${current.pathname}`);
  }
  if (maybeConversations === 'conversations' && conversationId) {
    return { projectId, conversationId };
  }

  const response = await page.request.get(`/api/projects/${projectId}/conversations`);
  expect(response.ok()).toBeTruthy();
  const { conversations } = (await response.json()) as {
    conversations: Array<{ id: string; updatedAt: number }>;
  };
  const active = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!active) throw new Error(`no conversations found for project ${projectId}`);
  return { projectId, conversationId: active.id };
}

async function seedProjectFile(
  page: Page,
  projectId: string,
  name: string,
  content: string,
  encoding?: 'base64',
  artifactManifest?: Record<string, unknown>,
) {
  const response = await page.request.post(
    `/api/projects/${projectId}/files`,
    {
      data: {
        name,
        content,
        ...(encoding ? { encoding } : {}),
        ...(artifactManifest ? { artifactManifest } : {}),
      },
      timeout: 15_000,
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function seedHtmlArtifact(page: Page, projectId: string, fileName: string, content: string) {
  const resp = await page.request.post(
    `/api/projects/${projectId}/files`,
    {
      data: {
        name: fileName,
        content,
        artifactManifest: {
          version: 1,
          kind: 'html',
          title: fileName,
          entry: fileName,
          renderer: 'html',
          exports: ['html'],
        },
      },
      timeout: 15_000,
    },
  );
  expect(resp.ok()).toBeTruthy();
}

async function listProjectFilesFromApi(
  page: Page,
  projectId: string,
): Promise<Array<{ name: string; kind: string }>> {
  const response = await page.request.get(`/api/projects/${projectId}/files`);
  expect(response.ok()).toBeTruthy();
  const { files } = (await response.json()) as { files: Array<{ name: string; kind: string }> };
  return files;
}

async function expectProjectFileToContain(
  page: Page,
  projectId: string,
  fileName: string,
  expected: string,
) {
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/projects/${projectId}/files/${fileName}`);
      if (!response.ok()) return '';
      return response.text();
    }, { timeout: 15_000 })
    .toContain(expected);
}

async function readProjectFileText(page: Page, projectId: string, fileName: string): Promise<string> {
  const response = await page.request.get(`/api/projects/${projectId}/files/${fileName}`);
  expect(response.ok()).toBeTruthy();
  return response.text();
}

async function expectScenarioFiles(
  page: Page,
  entry: UiScenario,
  projectId: string,
) {
  if (!entry.expectedFiles?.length) return;
  const files = await listProjectFilesFromApi(page, projectId);
  for (const expectedFile of entry.expectedFiles) {
    const actual = files.find((file) => file.name === expectedFile.name);
    expect(actual, `missing expected file ${expectedFile.name}`).toBeDefined();
    if (expectedFile.kind) {
      expect(actual?.kind).toBe(expectedFile.kind);
    }
    if (expectedFile.previewText) {
      await expectProjectFileToContain(page, projectId, expectedFile.name, expectedFile.previewText);
    }
  }
}

async function expectScenarioPreviewText(page: Page, entry: UiScenario) {
  if (!entry.expectedPreviewText) return;
  const frame = page.frameLocator('[data-testid="artifact-preview-frame"]');
  await expect(frame.getByText(entry.expectedPreviewText, { exact: false })).toBeVisible();
}

async function expectScenarioProjectState(
  page: Page,
  entry: UiScenario,
  projectId: string,
) {
  await expectScenarioFiles(page, entry, projectId);
  await expectScenarioPreviewText(page, entry);
}

async function expectProjectFilesToIncludeSuffixes(
  page: Page,
  projectId: string,
  suffixes: string[],
) {
  await expect
    .poll(async () => {
      const names = (await listProjectFilesFromApi(page, projectId)).map((file) => file.name);
      return suffixes.every((suffix) => names.some((name) => name.endsWith(suffix)));
    })
    .toBe(true);
}

async function waitForSingleSketchFile(page: Page, projectId: string): Promise<string> {
  let sketchName = '';
  await expect
    .poll(async () => {
      const sketches = (await listProjectFilesFromApi(page, projectId))
        .filter((file) => file.kind === 'sketch' && file.name.endsWith('.sketch.json'));
      sketchName = sketches[0]?.name ?? '';
      return sketches.length;
    }, { timeout: 15_000 })
    .toBe(1);
  return sketchName;
}

async function openPixoFile(page: Page, fileName: string) {
  await openPanelFile(page, fileName);
}

// Uploaded files can land under a deduplicated name, and image cards render
// no filename text, so match 资源库 rows on the `data-testid` suffix rather
// than on rendered text.
function designFileRow(page: Page, fileName: string): Locator {
  return page.locator(`[data-testid^="design-file-row-"][data-testid$="${fileName}"]`).first();
}

// 资源库 lists every type under 全部; a narrower type filter left over from an
// earlier step would hide the row, so land on it the way a user would.
async function revealDesignFileRow(page: Page, fileName: string): Promise<Locator> {
  const row = designFileRow(page, fileName);
  if (await row.isVisible().catch(() => false)) return row;
  await selectLibraryType(page, 'all');
  await expect(row).toBeVisible();
  return row;
}

async function waitForLoadingToClear(page: Page) {
  await page.getByText('Loading OpenPixo…').waitFor({ state: 'hidden', timeout: T.long });
}

async function expectVisibleAcrossAnimationFrames(locator: Locator) {
  await expect(locator).toBeVisible();
  const stayedVisible = await locator.evaluate(async (element) => {
    const isVisible = () => {
      const style = window.getComputedStyle(element);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 &&
        element.getClientRects().length > 0
      );
    };

    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (!isVisible()) return false;
    }
    return true;
  });
  expect(stayedVisible).toBe(true);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runUploadedImageRendersInPreviewFlow(page: Page, entry: UiScenario) {
  const { projectId } = await getCurrentProjectContext(page);
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W6McAAAAASUVORK5CYII=',
    'base64',
  );
  await page.getByTestId('file-list-upload-input').setInputFiles({
    name: 'brand.png',
    mimeType: 'image/png',
    buffer: pngBytes,
  });
  await expect(panelFileLabel(page, /brand\.png/i)).toBeVisible();

  const uploadedImage = await page.request.get(
    `/api/projects/${encodeURIComponent(projectId)}/raw/brand.png`,
  );
  expect(uploadedImage.ok(), `uploaded image: ${await uploadedImage.text()}`).toBeTruthy();
  expect(uploadedImage.headers()['content-type']).toContain('image/png');

  await seedHtmlArtifact(
    page,
    projectId,
    'image-preview.html',
    // Generated pages commonly use site-root paths. Before the preview asset
    // normalization fix, this resolved against the OpenPixo app origin and
    // left the uploaded image broken even though its project raw URL was valid.
    '<!doctype html><html><body><main><h1>Image Preview</h1><img alt="Brand logo" src="/brand.png"></main></body></html>',
  );
  await page.reload();
  await expectWorkspaceReady(page);
  await openPixoFile(page, 'image-preview.html');

  const image = page.frameLocator('[data-testid="artifact-preview-frame"]').getByRole('img', { name: 'Brand logo' });
  await expect(image).toBeVisible();
  await expect
    .poll(async () => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await expectScenarioProjectState(page, entry, projectId);
}

async function runPythonSourcePreviewFlow(page: Page, entry: UiScenario) {
  const { projectId } = await getCurrentProjectContext(page);
  await seedProjectFile(page, projectId, 'app.py', 'def greet():\n    return "hello from python"\n');
  await page.reload();
  await openPixoFile(page, 'app.py');

  await expect(page.locator('.code-viewer')).toContainText('def greet');
  await expect(page.locator('.code-viewer')).toContainText('hello from python');
  await expectScenarioFiles(page, entry, projectId);
}

async function runDesignFilesUploadFlow(page: Page) {
  const { projectId } = await getCurrentProjectContext(page);
  await page.getByTestId('file-list-upload-input').setInputFiles({
    name: 'moodboard.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W6McAAAAASUVORK5CYII=',
      'base64',
    ),
  });

  await expect(panelFileLabel(page, /moodboard\.png/i)).toBeVisible();
  await openAllProjectFiles(page);
  // The 资源库 type filter is what states the kind: uploading an image has to
  // file it under 图片 (and nothing else there), and the row reopens it on a
  // single click. (The row's ⋯ menu still carries Download — covered by the
  // single-file actions spec.)
  const imagesTab = libraryTypeFilter(page, 'image');
  await expect(imagesTab).toBeVisible();
  await expect(imagesTab).toContainText('1');
  await selectLibraryType(page, 'image');
  const fileRow = designFileRow(page, 'moodboard.png');
  await expect(fileRow).toBeVisible();
  await expect(page.locator('[data-testid^="design-file-row-"]')).toHaveCount(1);

  await fileRow.getByRole('button').first().click();
  await expect(panelFileLabel(page, /moodboard\.png/i)).toBeVisible();
  await expectProjectFilesToIncludeSuffixes(page, projectId, ['moodboard.png']);
}

async function runDesignFilesDeleteFlow(page: Page) {
  const { projectId } = await getCurrentProjectContext(page);

  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W6McAAAAASUVORK5CYII=',
    'base64',
  );

  await page.getByTestId('file-list-upload-input').setInputFiles({
    name: 'keep-me.png',
    mimeType: 'image/png',
    buffer: pngBytes,
  });
  await expect(panelFileLabel(page, /keep-me\.png/i)).toBeVisible();

  await page.getByTestId('file-list-upload-input').setInputFiles({
    name: 'trash-me.png',
    mimeType: 'image/png',
    buffer: pngBytes,
  });

  await expect(panelFileLabel(page, /trash-me\.png/i)).toBeVisible();
  await openAllProjectFiles(page);

  const fileRow = designFileRow(page, 'trash-me.png');
  await expect(fileRow).toBeVisible();
  await fileRow.hover();
  await fileRow.locator('[data-testid^="design-file-menu-"]').click();
  await expect(page.getByTestId('design-file-menu-popover')).toBeVisible();
  await page.locator('[data-testid^="design-file-delete-"]').click();
  await answerDeleteConfirm(page, 'delete', /trash-me\.png/i);

  await expect(fileRow).toHaveCount(0);
  await expect(panelFileLabel(page, /trash-me\.png/i)).toHaveCount(0);
  await expectAllProjectFilesActive(page);
  await expect(designFileRow(page, 'keep-me.png')).toBeVisible();
  await expect
    .poll(async () => {
      const names = (await listProjectFilesFromApi(page, projectId)).map((file) => file.name);
      return (
        names.length === 1 &&
        names.some((name) => name.endsWith('keep-me.png')) &&
        names.every((name) => !name.endsWith('trash-me.png'))
      );
    })
    .toBe(true);
}

test('[P1] design files page keeps the current single-file menu actions', async ({ page }) => {
  await routeMockAgents(page);

  await gotoEntryHome(page);
  await openProjectViaApi(page, 'Design files current surface');
  await expectWorkspaceReady(page);

  const { projectId } = await getCurrentProjectContext(page);
  await seedProjectFile(page, projectId, 'alpha.html', '<!doctype html><title>alpha</title><h1>alpha</h1>');
  await page.reload();
  await expectWorkspaceReady(page);
  await openAllProjectFiles(page);

  await expect(page.getByRole('button', { name: /filter by kind/i })).toHaveCount(0);
  await expect(page.getByTestId('file-list-batch-delete')).toHaveCount(0);

  const fileRow = page.getByTestId('design-file-row-alpha.html');
  await expect(fileRow).toBeVisible();
  await fileRow.hover();
  await page.getByTestId('design-file-menu-alpha.html').click();

  const menu = page.getByTestId('design-file-menu-popover');
  await expect(menu).toBeVisible();
  // There are no file tabs any more: Open pushes the file onto 资源库's stack.
  await expect(menu.getByTestId('design-file-menu-open')).toHaveText(/^open$/i);
  await expect(menu.getByRole('menuitem', { name: /rename/i })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /download/i })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /delete/i })).toBeVisible();
});

test('[P1] markdown plan documents support code, split, preview, and autosaved edits', async ({ page }) => {
  await routeMockAgents(page);

  await gotoEntryHome(page);
  await openProjectViaApi(page, 'Markdown plan editor modes');
  await expectWorkspaceReady(page);
  const { projectId } = await getCurrentProjectContext(page);
  await seedProjectFile(
    page,
    projectId,
    'plan.md',
    [
      '# Seeded Plan',
      '',
      '## Scope',
      '- Confirm markdown editing modes.',
      '',
    ].join('\n'),
  );

  await page.goto(`/projects/${projectId}/files/plan.md`, { waitUntil: 'domcontentloaded' });
  await expectWorkspaceReady(page);
  await expect(panelFileLabel(page, /plan\.md/i)).toBeVisible();

  const markdownModes = page.getByRole('tablist', { name: /markdown view mode/i });
  const codeTab = markdownModes.getByRole('tab', { name: /^Code$/ });
  const splitTab = markdownModes.getByRole('tab', { name: /^Split$/ });
  const previewTab = markdownModes.getByRole('tab', { name: /^Preview$/ });
  const editor = page.getByRole('textbox', { name: /markdown editor/i });
  const preview = page.getByLabel(/markdown preview/i);

  await expect(codeTab).toBeEnabled();
  await expect(splitTab).toBeEnabled();
  await previewTab.click();
  await expect(previewTab).toHaveAttribute('aria-selected', 'true');
  await expect(editor).toHaveCount(0);
  await expect(preview).toContainText('Scope');

  await codeTab.click();
  await expect(codeTab).toHaveAttribute('aria-selected', 'true');
  await expect(editor).toBeVisible();
  await expect(preview).toHaveCount(0);
  await editor.fill(`${await editor.inputValue()}\n## Code Edit\n- Edited from code mode.\n`);
  await expectProjectFileToContain(page, projectId, 'plan.md', 'Edited from code mode.');

  await splitTab.click();
  await expect(splitTab).toHaveAttribute('aria-selected', 'true');
  await expect(editor).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Code Edit');
  await editor.fill(`${await readProjectFileText(page, projectId, 'plan.md')}\n## Split Edit\n- Edited from split mode.\n`);
  await expectProjectFileToContain(page, projectId, 'plan.md', 'Edited from split mode.');
  await expect(preview).toContainText('Split Edit');

  await previewTab.click();
  await expect(previewTab).toHaveAttribute('aria-selected', 'true');
  await expect(editor).toHaveCount(0);
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Edited from code mode.');
  await expect(preview).toContainText('Edited from split mode.');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectWorkspaceReady(page);
  await expect(codeTab).toBeEnabled();
  await previewTab.click();
  await expect(previewTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel(/markdown preview/i)).toContainText('Edited from split mode.');
  await codeTab.click();
  await expect(page.getByRole('textbox', { name: /markdown editor/i })).toHaveValue(/Edited from code mode/);
});

test('[P1] design files batch delete removes selected files and keeps cancel retryable', async ({ page }) => {
  await routeMockAgents(page);

  await gotoEntryHome(page);
  await openProjectViaApi(page, 'Design files batch delete');
  await expectWorkspaceReady(page);

  const { projectId } = await getCurrentProjectContext(page);
  await seedProjectFile(page, projectId, 'batch-alpha.txt', 'alpha');
  await seedProjectFile(page, projectId, 'batch-beta.txt', 'beta');
  await seedProjectFile(page, projectId, 'batch-keep.txt', 'keep');
  await page.reload();
  await expectWorkspaceReady(page);
  await openAllProjectFiles(page);

  const alpha = page.getByTestId('design-file-row-batch-alpha.txt');
  const beta = page.getByTestId('design-file-row-batch-beta.txt');
  const keep = page.getByTestId('design-file-row-batch-keep.txt');
  await expect(alpha).toBeVisible();
  await expect(beta).toBeVisible();
  await expect(keep).toBeVisible();
  await alpha.getByRole('checkbox').click();
  await beta.getByRole('checkbox').click();

  const batchBar = page.getByTestId('file-list-batch-bar');
  await expect(batchBar).toBeVisible();
  await expect(batchBar).toContainText('2');

  await page.getByTestId('file-list-batch-delete').click();
  await answerDeleteConfirm(page, 'cancel', '2');
  await expect(batchBar).toBeVisible();
  await expect(alpha.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  await expect(beta.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');

  await expect(page.getByTestId('file-list-batch-delete')).toBeEnabled();
  await page.getByTestId('file-list-batch-delete').click();
  await answerDeleteConfirm(page, 'delete', '2');

  await expect(alpha).toHaveCount(0);
  await expect(beta).toHaveCount(0);
  await expect(keep).toBeVisible();
  await expect(page.getByTestId('file-list-batch-bar')).toHaveCount(0);
  await expect
    .poll(async () => {
      const names = (await listProjectFilesFromApi(page, projectId)).map((file) => file.name);
      return (
        names.includes('batch-keep.txt') &&
        !names.includes('batch-alpha.txt') &&
        !names.includes('batch-beta.txt')
      );
    })
    .toBe(true);
});

test('[P1] design files batch download posts selected names to the archive endpoint', async ({ page }) => {
  await routeMockAgents(page);

  await gotoEntryHome(page);
  await openProjectViaApi(page, 'Design files batch download');
  await expectWorkspaceReady(page);

  const { projectId } = await getCurrentProjectContext(page);
  let archiveRequest: { files?: string[] } | null = null;
  await page.route(`**/api/projects/${projectId}/archive/batch`, async (route) => {
    archiveRequest = route.request().postDataJSON() as { files?: string[] };
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': "attachment; filename*=UTF-8''selected-design-files.zip",
      },
      body: Buffer.from('PK\x05\x06batch-download'),
    });
  });

  await seedProjectFile(page, projectId, 'download-alpha.txt', 'alpha');
  await seedProjectFile(page, projectId, 'download-beta.txt', 'beta');
  await seedProjectFile(page, projectId, 'download-skip.txt', 'skip');
  await page.reload();
  await expectWorkspaceReady(page);
  await openAllProjectFiles(page);

  const alpha = page.getByTestId('design-file-row-download-alpha.txt');
  const beta = page.getByTestId('design-file-row-download-beta.txt');
  await expect(alpha).toBeVisible();
  await expect(beta).toBeVisible();
  await alpha.getByRole('checkbox').click();
  await beta.getByRole('checkbox').click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('file-list-batch-bar').getByRole('button', { name: /^Download$/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('selected-design-files.zip');
  expect(archiveRequest).toEqual({ files: ['download-alpha.txt', 'download-beta.txt'] });
});

test('[P0] @critical file workspace restores HTML preview after switching through a source file', async ({ page }) => {
  await routeMockAgents(page);

  await gotoEntryHome(page);
  await openProjectViaApi(page, 'File workspace preview restore');
  await expectWorkspaceReady(page);

  const { projectId } = await getCurrentProjectContext(page);
  await seedHtmlArtifact(
    page,
    projectId,
    'dashboard.html',
    '<!doctype html><html><body><main><h1>Risk Dashboard</h1><p>Preview survives file switches.</p></main></body></html>',
  );
  await seedProjectFile(page, projectId, 'logic.ts', 'export const riskScore = 17.3;\n');
  await page.reload();
  await expectWorkspaceReady(page);

  await openPixoFile(page, 'dashboard.html');
  await expect(panelFileLabel(page, /dashboard\.html/i)).toBeVisible();
  await expect(page.frameLocator('[data-testid="artifact-preview-frame"]').getByRole('heading', {
    name: 'Risk Dashboard',
  })).toBeVisible();

  await openAllProjectFiles(page);
  const sourceRow = await revealDesignFileRow(page, 'logic.ts');
  // #5517: one click on the row opens the file — no preview card in between.
  await sourceRow.getByRole('button').first().click();
  await expect(panelFileLabel(page, /logic\.ts/i)).toBeVisible();
  await expect(page.locator('.code-viewer')).toContainText('riskScore');

  await openPanelFile(page, 'dashboard.html');
  await expect(panelFileLabel(page, /dashboard\.html/i)).toBeVisible();
  await expect(page.frameLocator('[data-testid="artifact-preview-frame"]').getByRole('heading', {
    name: 'Risk Dashboard',
  })).toBeVisible();
  await expect(page.getByTestId('file-workspace')).toBeVisible();
});

test('[P0] @critical HTML preview permits client-side form submission while isolating the host', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createProjectViaApi(page, 'Interactive form preview');
  await seedHtmlArtifact(page, projectId, 'form.html', `<!doctype html><html><head><style>
    .modal-layer { display: grid; position: fixed; inset: 0; z-index: 10; }
    .authored[hidden] { display: block; }
  </style></head><body>
    <h1>Interactive form</h1>
    <div class="modal-layer" hidden>Hidden popup</div>
    <p class="authored" hidden>Intentional authored override</p>
    <p hidden="until-found">Findable content</p>
    <p hidden="UNTIL-FOUND">Findable content with an uppercase attribute</p>
    <form><label>Task name<input name="task"></label><button>Save task</button></form>
    <output aria-label="Saved task"></output>
    <script>document.querySelector('form').addEventListener('submit', function(event) {
      event.preventDefault();
      document.querySelector('output').textContent = document.querySelector('input').value;
    });</script>
  </body></html>`);

  for (const query of ['', '?forceInline=1']) {
    await page.goto(`/projects/${projectId}${query}`, { waitUntil: 'domcontentloaded' });
    await expectWorkspaceReady(page);
    await openPixoFile(page, 'form.html');
    const preview = page.frameLocator('[data-testid="artifact-preview-frame"]');
    await expect(preview.locator('.modal-layer')).toHaveCount(1);
    await expect(preview.locator('.modal-layer')).toBeHidden();
    await expect(preview.locator('.authored')).toBeVisible();
    const findableStyles = await preview.locator('[hidden="until-found" i]').evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return { display: style.display, contentVisibility: style.contentVisibility };
    }));
    expect(findableStyles).toHaveLength(2);
    for (const style of findableStyles) {
      expect(style.display).not.toBe('none');
      expect(style.contentVisibility).toBe('hidden');
    }
    await preview.getByLabel('Task name').fill('Created through the preview');
    await preview.getByRole('button', { name: 'Save task' }).click();
    await expect(preview.getByLabel('Saved task')).toHaveText('Created through the preview');
    expect(await preview.locator('body').evaluate(() => {
      try { void window.parent.document.body; return true; } catch { return false; }
    })).toBe(false);
  }
});

test('[P0] @critical storage-backed HTML keeps project state isolated across preview reloads', async ({ page }) => {
  await routeMockAgents(page);
  const projectIds = [
    await createProjectViaApi(page, 'Persistent form preview A'),
    await createProjectViaApi(page, 'Persistent form preview B'),
  ];
  // Generated pages commonly use the same ordinary key in separate projects.
  // A project-specific artifact key would hide an origin-isolation regression.
  const storageKey = JSON.stringify('task-board-state');
  for (const [index, projectId] of projectIds.entries()) {
    await seedHtmlArtifact(page, projectId, 'saved-form.html', `<!doctype html><html><body>
    <h1>Persistent form ${index === 0 ? 'A' : 'B'}</h1>
    <form><label>Task name<input name="task"></label><button>Save task</button></form>
    <output aria-label="Saved task"></output>
    <script>const key=${storageKey};
    document.querySelector('output').textContent=localStorage.getItem(key)||'';
    document.querySelector('form').addEventListener('submit', function(event) {
      event.preventDefault();
      const value=document.querySelector('input').value;
      localStorage.setItem(key,value);
      document.querySelector('output').textContent=value;
    });</script>
  </body></html>`);
  }
  const openProject = async (index: number) => {
    await page.goto(`/projects/${projectIds[index]}`, { waitUntil: 'domcontentloaded' });
    await expectWorkspaceReady(page);
    await openPixoFile(page, 'saved-form.html');
    await expect(preview.getByRole('heading', { name: `Persistent form ${index === 0 ? 'A' : 'B'}` })).toBeVisible();
  };
  const frame = page.locator('[data-testid="artifact-preview-frame"]');
  const preview = page.frameLocator('[data-testid="artifact-preview-frame"]');
  await openProject(0);
  await preview.getByLabel('Task name').fill('Project A saved across reload');
  await preview.getByRole('button', { name: 'Save task' }).click();
  await expect(preview.getByLabel('Saved task')).toHaveText('Project A saved across reload');
  await expect(frame).toHaveAttribute('data-pixo-render-mode', 'srcdoc');
  expect(await frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  expect(await preview.locator('body').evaluate(() => {
    try { void window.parent.document.body; return true; } catch { return false; }
  })).toBe(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectWorkspaceReady(page);
  await openPixoFile(page, 'saved-form.html');
  await expect(preview.getByLabel('Saved task')).toHaveText('Project A saved across reload');

  // Presentation mode was removed with the design-tool preview surfaces
  // (78216c3f5), so the reload above is the only second document checked.

  await openProject(1);
  await expect(preview.getByLabel('Saved task')).toHaveText('');
  await preview.getByLabel('Task name').fill('Project B saved separately');
  await preview.getByRole('button', { name: 'Save task' }).click();
  await expect(preview.getByLabel('Saved task')).toHaveText('Project B saved separately');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectWorkspaceReady(page);
  await openPixoFile(page, 'saved-form.html');
  await expect(preview.getByLabel('Saved task')).toHaveText('Project B saved separately');

  await openProject(0);
  await expect(preview.getByLabel('Saved task')).toHaveText('Project A saved across reload');
  const blockedRoutes = await preview.locator('body').evaluate(async (_, otherProjectId) => {
    const paths = ['/api/projects', `/api/projects/${otherProjectId}/powered/saved-form.html`];
    return Promise.all(paths.map(async (path) => {
      try { return { path, readable: (await fetch(path)).ok }; }
      catch { return { path, readable: false }; }
    }));
  }, projectIds[1]);
  expect(blockedRoutes.map((route) => route.readable)).toEqual([false, false]);
});

test('[P0] @critical white-screen monitoring recovers layout stalls and confirms persistent blanks', async ({ page }) => {
  const safetyEvents = await captureSafetyTelemetry(page);
  await routeMockAgents(page);

  const projectId = await createProjectViaApi(page, 'Preview white-screen monitoring');
  await seedHtmlArtifact(
    page,
    projectId,
    'recoverable-blank.html',
    `<!doctype html>
      <html>
        <head><style>main { display: none; }</style></head>
        <body data-monitor-fixture="recoverable" data-monitor-recovered="false">
          <main><h1>Recovered preview paint</h1></main>
          <script>
            window.__monitorFixtureStartedAt = performance.now();
            window.addEventListener('resize', function () {
              if (performance.now() - window.__monitorFixtureStartedAt < 4500) return;
              document.querySelector('main').style.display = 'block';
              document.body.dataset.monitorRecovered = 'true';
            });
          </script>
        </body>
      </html>`,
  );
  await seedHtmlArtifact(
    page,
    projectId,
    'persistent-blank.html',
    `<!doctype html>
      <html>
        <body data-monitor-fixture="persistent">
          <script>window.__monitorFixtureReady = true;</script>
        </body>
      </html>`,
  );

  await page.goto(`/projects/${projectId}?forceInline=1`, { waitUntil: 'domcontentloaded' });
  await expectWorkspaceReady(page);
  await openPixoFile(page, 'recoverable-blank.html');

  const activePreview = page.frameLocator('[data-testid="artifact-preview-frame"]');
  const recoverableBody = activePreview.locator('body[data-monitor-fixture="recoverable"]');
  const recoverableMain = recoverableBody.locator('main');
  await expect(recoverableBody).toBeVisible();
  await expect(recoverableBody).toHaveAttribute('data-monitor-recovered', 'true', {
    timeout: PREVIEW_WHITE_SCREEN_TIMEOUT_MS + T.short,
  });
  await expect(recoverableMain).toHaveCSS('display', 'block', {
    timeout: PREVIEW_WHITE_SCREEN_TIMEOUT_MS + T.short,
  });
  await page.waitForTimeout(PREVIEW_WHITE_SCREEN_CONFIRMATION_MS + 100);
  expect(capturedWhiteScreenEvents(safetyEvents)).toEqual([]);

  await openAllProjectFiles(page);
  const persistentRow = await revealDesignFileRow(page, 'persistent-blank.html');
  await persistentRow.getByRole('button').first().click();
  await expect(panelFileLabel(page, /persistent-blank\.html/i))
    .toBeVisible();
  const persistentBody = activePreview.locator('body[data-monitor-fixture="persistent"]');
  await expect(persistentBody).toBeAttached();

  await page.waitForTimeout(PREVIEW_WHITE_SCREEN_TIMEOUT_MS - 500);
  expect(capturedWhiteScreenEvents(safetyEvents)).toEqual([]);

  await expect.poll(
    () => capturedWhiteScreenEvents(safetyEvents).length,
    { timeout: PREVIEW_WHITE_SCREEN_CONFIRMATION_MS + T.short },
  ).toBe(1);
  const [whiteScreen] = capturedWhiteScreenEvents(safetyEvents);
  expect(whiteScreen?.properties).toMatchObject({
    blank_observation_count: 2,
    sample_interval_ms: PREVIEW_WHITE_SCREEN_CONFIRMATION_MS,
    visible_element_count: 0,
    visibility_state: 'visible',
  });
});

test('[P0] @critical HTML previews stay mounted across view and stack switches and Back restores the browser', async ({ page }) => {
  await routeMockAgents(page);

  const projectId = await createProjectViaApi(page, 'Uploaded file switching stability');
  const seededHtml = new Map([
    ['stable-alpha.html', '<!doctype html><html><body><main><h1>Stable Alpha</h1></main></body></html>'],
    ['stable-beta.html', '<!doctype html><html><body><main><h1>Stable Beta</h1></main></body></html>'],
  ]);
  const seededFiles = [...seededHtml.keys()].map((name, index) => ({
    name,
    size: Buffer.byteLength(seededHtml.get(name) ?? ''),
    mtime: 1_785_570_000_000 + index,
    kind: 'html',
    mime: 'text/html',
  }));
  await page.route(`**/api/projects/${projectId}/files`, async (route) => {
    await route.fulfill({ json: { files: seededFiles } });
  });
  await page.route(`**/api/projects/${projectId}/text-preview/*`, async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) ?? '');
    const text = seededHtml.get(name) ?? '';
    await route.fulfill({
      json: {
        text,
        truncated: false,
        size: Buffer.byteLength(text),
        limit: 131_072,
        mime: 'text/html',
        kind: 'html',
        poweredPreview: { required: false, scannedBytes: Buffer.byteLength(text), complete: true },
      },
    });
  });
  await page.route(`**/api/projects/${projectId}/raw/*`, async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) ?? '');
    await route.fulfill({ contentType: 'text/html', body: seededHtml.get(name) ?? '' });
  });
  await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
  await expectWorkspaceReady(page);
  await openAllProjectFiles(page);
  const alphaRow = await revealDesignFileRow(page, 'stable-alpha.html');
  await expectVisibleAcrossAnimationFrames(alphaRow);
  await expectVisibleAcrossAnimationFrames(designFileRow(page, 'stable-beta.html'));
  await alphaRow.getByRole('button').first().click();

  type WarmFrame = HTMLIFrameElement & { __pixoWarmLoadCount?: number };
  const capture = async (name: string) => {
    await expect(page.frameLocator('[data-testid="artifact-preview-frame"]')
      .getByRole('heading', { name: name.includes('alpha') ? 'Stable Alpha' : 'Stable Beta' })).toBeVisible();
    const handle = await page.locator(`iframe[title="${name}"][data-pixo-active="true"]`).elementHandle();
    if (!handle) throw new Error(`Missing active preview for ${name}`);
    await handle.evaluate(node => {
      const frame = node as WarmFrame;
      frame.__pixoWarmLoadCount = 0;
      frame.addEventListener('load', () => { frame.__pixoWarmLoadCount = (frame.__pixoWarmLoadCount ?? 0) + 1; });
    });
    return handle;
  };
  const alphaFrame = await capture('stable-alpha.html');
  await openPanelFile(page, 'stable-beta.html');
  const betaFrame = await capture('stable-beta.html');
  const assertWarm = async (handle: Awaited<ReturnType<typeof capture>>, active: boolean) => {
    expect(await handle.evaluate(node => node.isConnected), 'preview iframe detached').toBe(true);
    expect(await handle.evaluate(node => node.getAttribute('aria-hidden'))).toBe(active ? null : 'true');
    expect(await handle.evaluate(node => (node as WarmFrame).__pixoWarmLoadCount)).toBe(0);
  };
  const rawReads: string[] = [];
  const recordRead = (request: Request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname.startsWith(`/api/projects/${projectId}/raw/`)) rawReads.push(request.url());
  };
  await page.evaluate(() => {
    const witness = { loadingSeen: false };
    const observer = new MutationObserver(() => {
      witness.loadingSeen ||= Array.from(document.querySelectorAll('.viewer-loading')).some(element => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden'
          && Number(style.opacity) > 0 && element.getClientRects().length > 0;
      });
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    (window as typeof window & { __panelLoadingWitness?: typeof witness }).__panelLoadingWitness = witness;
  });
  page.on('request', recordRead);
  for (let round = 0; round < 3; round += 1) {
    await selectPanelView(page, 'game');
    await assertWarm(alphaFrame, false);
    await assertWarm(betaFrame, false);
    await selectPanelView(page, 'changes');
    await expect(page.getByTestId('panel-stack-back')).toBeHidden();
    await selectPanelView(page, 'library');
    await expect(panelFileLabel(page, 'stable-beta.html')).toBeVisible();
    await assertWarm(betaFrame, true);
    await openPanelFile(page, 'stable-alpha.html');
    await expectVisibleAcrossAnimationFrames(page.getByTestId('artifact-preview-frame'));
    await assertWarm(alphaFrame, true);
    await assertWarm(betaFrame, false);
    await openPanelFile(page, 'stable-beta.html');
    await expectVisibleAcrossAnimationFrames(page.getByTestId('artifact-preview-frame'));
    await assertWarm(alphaFrame, false);
    await assertWarm(betaFrame, true);
  }
  page.off('request', recordRead);
  expect(rawReads, 'warm view and stack switches reloaded raw HTML').toEqual([]);
  expect(await page.evaluate(() => (window as typeof window & {
    __panelLoadingWitness?: { loadingSeen: boolean };
  }).__panelLoadingWitness?.loadingSeen)).toBe(false);
  // Returning to the browser pops viewers; the Library root mounts its browser
  // afresh. Warm viewer retention applies while items remain on a stack.
  await openAllProjectFiles(page);
  // Page thumbnails are drawn on grid cards; the default list has none.
  await setLibraryLayout(page, 'grid');
  const warmAlphaRow = await revealDesignFileRow(page, 'stable-alpha.html');
  await expectVisibleAcrossAnimationFrames(warmAlphaRow);
  await expect(warmAlphaRow.locator('.df-card-thumb iframe')).toHaveCSS('width', '1200px');
  await expect(warmAlphaRow.locator('.df-card-thumb iframe')).toHaveCSS('height', '675px');
  await expect(warmAlphaRow.frameLocator('.df-card-thumb iframe').getByRole('heading', { name: 'Stable Alpha' })).toBeVisible();
  await expectVisibleAcrossAnimationFrames(designFileRow(page, 'stable-beta.html'));

});

async function runPanelStackPersistenceFlow(page: Page) {
  const pngBytes = Buffer.from(TINY_PNG_FOR_STACK, 'base64');
  for (const name of ['first-tab.png', 'second-tab.png']) {
    const uploaded = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/upload'));
    await page.getByTestId('file-list-upload-input').setInputFiles({ name, mimeType: 'image/png', buffer: pngBytes });
    expect((await uploaded).ok()).toBe(true);
    await expect(panelFileLabel(page, name)).toBeVisible();
  }
  await openPanelFile(page, 'first-tab.png');
  await selectPanelView(page, 'game');
  await expect(page.getByTestId('panel-stack-back')).toBeHidden();
  await selectPanelView(page, 'library');
  await expect(panelFileLabel(page, 'first-tab.png')).toBeVisible();
  await page.reload();
  await expect(panelFileLabel(page, 'first-tab.png')).toBeVisible();
  await openPanelFile(page, 'second-tab.png');
  await expect(panelFileLabel(page, 'first-tab.png')).toBeHidden();
  await page.getByTestId('panel-stack-back').click();
  await expect(panelFileLabel(page, 'first-tab.png')).toBeVisible();
  await page.getByTestId('panel-stack-back').press('Escape');
  await expectAllProjectFilesActive(page);
  await expect(page.getByTestId('design-file-row-first-tab.png')).toBeVisible();
  await expect(page.getByTestId('design-file-row-second-tab.png')).toBeVisible();
}

const TINY_PNG_FOR_STACK = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W6McAAAAASUVORK5CYII=';

function homeDesignCard(page: Page, name: string): Locator {
  return page.locator('.design-card', {
    has: page.locator('.design-card-name', { hasText: name }),
  });
}

function designFileScenarioPriority(entry: UiScenario): 'P0' | 'P1' {
  switch (entry.flow) {
    case 'file-list-upload':
    case 'file-list-delete':
    case 'panel-stack-persistence':
      return 'P0';
    case 'uploaded-image-renders-in-preview':
    case 'python-source-preview':
    default:
      return 'P1';
  }
}

function criticalDesignFileScenarioTag(entry: UiScenario): string {
  return CRITICAL_DESIGN_FILE_SCENARIO_IDS.has(entry.id) ? ' @critical' : '';
}
