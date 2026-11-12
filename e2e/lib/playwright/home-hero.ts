import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export function homeTemplateTrigger(page: Page): Locator {
  return page.getByTestId('home-hero-template-trigger').getByRole('button')
    .or(page.getByTestId('home-hero-type-pills-more'));
}

export const HOME_TYPE_PRIMARY_CHIP_IDS = ['image', 'webgl'] as const;
export const HOME_TYPE_OTHER_CHIP_IDS = ['hyperframes', 'video', 'audio'] as const;


export async function openHomeTemplates(page: Page): Promise<Locator> {
  const trigger = homeTemplateTrigger(page);
  await expect(trigger).toBeEnabled();
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const menu = page.getByTestId('home-hero-template-menu')
    .or(page.getByTestId('home-hero-type-pills-popover'));
  await expect(menu).toBeVisible();
  return menu;
}

export async function pickHomeTemplate(page: Page, chipId: string): Promise<void> {
  const clear = page.getByTestId('home-hero-template-clear');
  if (await clear.isVisible()) {
    // Selected types expose a clear action; choosing another starts from the pills.
    await expect(clear).toBeEnabled();
    await clear.click();
    await expect(page.getByTestId('home-hero-type-pills')).toBeVisible();
  }
  if (await page.getByTestId(`home-hero-type-pill-${chipId}`).isVisible()) {
    await page.getByTestId(`home-hero-type-pill-${chipId}`).click();
  } else {
    const menu = await openHomeTemplates(page);
    await menu.locator(`[data-chip="${chipId}"]`).click();
    await expect(menu).toHaveCount(0);
  }
  await expect(page.getByTestId('home-hero-template-picker')).toHaveAttribute(
    'data-type', chipId,
  );
}
