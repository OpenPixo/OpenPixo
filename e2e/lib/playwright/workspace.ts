import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export type PanelView = 'game' | 'changes' | 'library';

export async function selectPanelView(page: Page, view: PanelView): Promise<void> {
  const labels = { game: 'Game', changes: 'Changes', library: 'Files' };
  const tab = page.getByTestId('panel-view-switcher').getByRole('tab', {
    name: labels[view], exact: true,
  });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('file-workspace')).toHaveAttribute('data-panel-view', view);
}

/** The visible item's identity, including its full relative path in title. */
export function panelFileLabel(page: Page, name: string | RegExp): Locator {
  const label = page.getByTestId('panel-stack-label');
  if (typeof name === 'string' && /[\\/]/.test(name)) {
    return label.and(page.getByTitle(name, { exact: true }));
  }
  return label.filter({
    hasText: typeof name === 'string' ? new RegExp(`${escapeRegExp(name)}$`, 'i') : name,
  });
}

/** Open through the panel's file palette without discarding any view's stack. */
export async function openPanelFile(page: Page, name: string): Promise<void> {
  await page.getByTestId('panel-more-menu').click();
  await page.getByTestId('panel-menu-open-file').click();
  const palette = page.locator('.qs-overlay');
  await expect(palette).toBeVisible();
  await palette.locator('.qs-input').fill(name);
  await palette.getByRole('option', { name: new RegExp(escapeRegExp(name), 'i') }).first().click();
  await expect(palette).toBeHidden();
  await expect(panelFileLabel(page, name)).toBeVisible();
  await expect(page.getByTestId('panel-stack-back')).toBeVisible();
}

// File browsing lives at the Library root. Selecting Library preserves its
// stack, so explicitly go back through opened items before using the browser,
// then show every type (the filter bar only renders once the project has files).
export async function openAllProjectFiles(page: Page): Promise<void> {
  await selectPanelView(page, 'library');
  const back = page.getByTestId('panel-stack-back');
  while (await back.isVisible()) await back.click();
  await expectAllProjectFilesActive(page);
  const allTypes = libraryTypeFilter(page, 'all');
  if (await allTypes.isVisible()) await selectLibraryType(page, 'all');
}

export type LibraryType = 'all' | 'image' | 'audio' | 'script' | 'scene' | 'other';

/** One button of the 资源库 type filter (全部 · 图片 · 音频 · 脚本 · 场景 · 其它). */
export function libraryTypeFilter(page: Page, type: LibraryType): Locator {
  return page.locator(`#library-type-${type}`);
}

export async function selectLibraryType(page: Page, type: LibraryType): Promise<void> {
  const tab = libraryTypeFilter(page, type);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/**
 * Answer the in-app delete confirmation (`useConfirmDialog`, an alertdialog;
 * not a native `window.confirm`, so Playwright `dialog` events never fire).
 * `mentions` asserts the body names what is being deleted.
 */
export async function answerDeleteConfirm(
  page: Page,
  answer: 'delete' | 'cancel',
  mentions?: string | RegExp,
): Promise<void> {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  if (mentions) await expect(dialog).toContainText(mentions);
  await dialog.getByRole('button', { name: answer === 'delete' ? /^(Delete|删除)$/ : /^(Cancel|取消)$/ }).click();
  await expect(dialog).toBeHidden();
}

/** Switch the 资源库 browser between rows (`library-list`) and cards (`library-grid`). */
export async function setLibraryLayout(page: Page, layout: 'list' | 'grid'): Promise<void> {
  const toggle = page.getByTestId(`library-layout-${layout}`);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`library-${layout}`)).toBeVisible();
}

export async function expectAllProjectFilesActive(page: Page): Promise<void> {
  await expect(page.getByTestId('file-workspace')).toHaveAttribute('data-panel-view', 'library');
  await expect(page.getByTestId('panel-library-view')).toBeVisible();
  await expect(page.getByTestId('panel-stack-back')).toBeHidden();
}

export async function expectAllProjectFilesInactive(page: Page): Promise<void> {
  await expect(page.getByTestId('panel-library-view')).toBeHidden();
  await expect(page.getByTestId('panel-stack-back')).toBeVisible();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function clickDeckNextSlide(page: Page): Promise<void> {
  await revealDeckNavigation(page);
  const button = page.locator('button[aria-label="Next slide"]:visible');
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
}

export async function clickDeckPreviousSlide(page: Page): Promise<void> {
  await revealDeckNavigation(page);
  const button = page.locator('button[aria-label="Previous slide"]:visible');
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
}

export async function openPreviewToolbarMoreMenu(page: Page): Promise<Locator> {
  const workspace = page.locator('[data-testid="file-workspace"]:visible').first();
  await expect(workspace).toBeVisible();
  const toolbar = workspace.locator('.viewer-toolbar:visible').first();
  await expect(toolbar).toBeVisible();
  const trigger = toolbar.locator('.viewer-toolbar-more > button');
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = toolbar.locator('.viewer-toolbar-more-menu[role="menu"]');
  await expect(menu).toBeVisible();
  return menu;
}

export async function clickPreviewToolbarAction(
  page: Page,
  inlineTestId: string,
  overflowName: RegExp,
): Promise<void> {
  const workspace = page.locator('[data-testid="file-workspace"]:visible').first();
  await expect(workspace).toBeVisible();
  const inlineAction = workspace.locator(`[data-testid="${inlineTestId}"]:visible`).first();
  if (await inlineAction.isVisible()) {
    await inlineAction.click();
    return;
  }

  const menu = await openPreviewToolbarMoreMenu(page);
  await menu.getByRole('menuitem', { name: overflowName }).click();
}

async function revealDeckNavigation(page: Page): Promise<void> {
  const canvas = page.getByTestId('preview-canvas');
  if (await canvas.isVisible().catch(() => false)) {
    await canvas.hover();
  }
}
