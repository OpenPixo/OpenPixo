import { expect, type Page, type Response } from '@playwright/test';
import { dismissWhatsNewPopup, ensureRailOpen } from './rail.js';
import { T } from '@/timeouts';

export const STORAGE_KEY = 'pixo:config';
export const OPEN_SETTINGS_LABEL = /Open settings|打开设置|開啟設定|Account & settings/i;

export async function waitForLoadingToClear(page: Page) {
  await page.getByText('Loading OpenPixo…').waitFor({ state: 'hidden', timeout: T.long }).catch(() => {});
}
export async function dismissPrivacyDialog(page: Page) {
  const privacySurface = page.locator('.privacy-consent-banner').first();
  await privacySurface.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => {});
  if (await privacySurface.isVisible().catch(() => false)) {
    await privacySurface.getByRole('button', { name: /don['’]?t share|不分享|not now|i get it|got it/i }).click();
    await expect(privacySurface).toBeHidden();
  }
}
export async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  await dismissPrivacyDialog(page);
}
export async function expectWorkspaceReady(page: Page) {
  await waitForLoadingToClear(page);
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await expect(page.getByTestId('chat-composer-input')).toBeEditable({ timeout: T.medium });
}
async function ensureEntryRailOpenIfPresent(page: Page) {
  if ((await page.locator('.entry').count()) === 0) return;
  await ensureRailOpen(page).catch(() => {});
}
export function settingsSurface(page: Page) {
  return page.locator('.modal-settings').first();
}
async function openSettingsFromProjectSurface(page: Page): Promise<boolean> {
  const switcherChip = page.getByTestId('inline-model-switcher-chip').first();
  if (await switcherChip.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await switcherChip.click();
    const openSettings = page.getByTestId('inline-model-switcher-open-settings').first();
    if (await openSettings.isVisible({ timeout: T.short }).catch(() => false)) {
      await openSettings.click();
      return true;
    }
    await page.keyboard.press('Escape').catch(() => {});
  }
  return false;
}
export async function openSettingsDialog(page: Page) {
  await waitForLoadingToClear(page);
  await dismissPrivacyDialog(page);
  await ensureEntryRailOpenIfPresent(page);
  const dialog = settingsSurface(page);
  const settingsTrigger = page.getByTestId('entry-settings-button')
    .or(page.getByTestId('entry-settings-menu-trigger'))
    .or(page.getByRole('button', { name: OPEN_SETTINGS_LABEL })).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await dialog.isVisible().catch(() => false)) return dialog;
    await dismissPrivacyDialog(page);
    await dismissWhatsNewPopup(page);
    if (await settingsTrigger.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await settingsTrigger.evaluate((element: HTMLElement) => element.click());
    } else if (!(await openSettingsFromProjectSurface(page))) {
      const fallback = page.getByRole('button', { name: OPEN_SETTINGS_LABEL }).first();
      await expect(fallback).toBeVisible({ timeout: T.medium });
      await fallback.evaluate((element: HTMLElement) => element.click());
    }
    const detailsTrigger = page.getByTestId('entry-settings-open-details')
      .or(page.getByTestId('inline-model-switcher-open-settings')).first();
    if (await detailsTrigger.isVisible({ timeout: T.short }).catch(() => false)) await detailsTrigger.click();
    await expect.poll(async () => await dialog.isVisible().catch(() => false) ? 'dialog' : 'pending',
      { timeout: T.medium }).not.toBe('pending').catch(() => {});
    if (await dialog.isVisible().catch(() => false)) return dialog;
  }
  await expect(dialog).toBeVisible({ timeout: T.medium });
  return dialog;
}
export async function sendPrompt(page: Page, prompt: string) {
  const input = page.getByTestId('chat-composer-input');
  await expect(input).toBeVisible({ timeout: T.medium });
  await input.click();
  await input.fill(prompt);
  await expect(page.getByTestId('chat-send')).toBeEnabled();
  await input.press('Enter');
}
export async function createProjectViaApi(
  page: Page,
  projectId: string,
  name: string,
  conversationMode?: 'design' | 'chat' | 'plan',
  headers?: Readonly<Record<string, string>>,
) {
  const response = await page.request.post('/api/projects', {
    ...(headers ? { headers: { ...headers } } : {}),
    data: {
      id: projectId, name, skillId: null, pendingPrompt: null, metadata: { kind: 'prototype' },
      // Fixture projects stand in for existing games; they have no plan to approve.
      skipDiscoveryBrief: true,
      ...(conversationMode ? { conversationMode } : {}),
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as { conversationId: string };
}
export async function gotoProject(page: Page, projectId: string) {
  try { await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' }); }
  catch (error) {
    if (!/ERR_ABORTED|frame was detached/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }
  await dismissPrivacyDialog(page);
  await expectWorkspaceReady(page);
}
export async function putAppConfig(page: Page, config: Record<string, unknown>) {
  const response = await page.request.put('/api/app-config', { data: config });
  expect(response.ok(), await response.text()).toBeTruthy();
}
/**
 * Resolves on the next config write. Arm it before the action that causes the
 * write. Boot ends with one too: the app merges the daemon's config into its own
 * and writes the result back.
 */
export function waitForAppConfigWrite(page: Page): Promise<Response> {
  return page.waitForResponse((response) =>
    response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/app-config');
}
export async function readAppConfig(page: Page) {
  const response = await page.request.get('/api/app-config');
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as { config?: Record<string, unknown> };
}
export async function seedBrowserConfig(page: Page, value: Record<string, unknown>) {
  const payload = { key: STORAGE_KEY, config: value };
  await page.addInitScript(({ key, config }) => window.localStorage.setItem(key, JSON.stringify(config)), payload);
  await page.evaluate(({ key, config }) => window.localStorage.setItem(key, JSON.stringify(config)), payload).catch(() => {});
}
