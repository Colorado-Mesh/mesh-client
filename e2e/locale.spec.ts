import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, openPanel, teardownApp } from './electronApp';

test.describe('locale', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('switches to German and back to English', async () => {
    launched = await launchApp();
    const { page } = launched;

    await openPanel(page, 'Monitor', 'Diagnostics');
    const header = page.getByRole('banner');

    await page.getByRole('button', { name: 'Select language' }).click();
    const listbox = page.getByRole('listbox', { name: 'Select language' });
    await expect(listbox).toBeVisible();
    await listbox.getByRole('button', { name: 'Deutsch' }).click();

    // Rail and sub-tab labels follow the locale.
    await expect(
      page.getByRole('navigation', { name: 'Anwendungspanels' }).getByRole('button').first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(header.getByRole('tab', { name: 'Diagnostik' })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: 'Sprache auswählen' }).click();
    const listboxDe = page.getByRole('listbox', { name: 'Sprache auswählen' });
    await expect(listboxDe).toBeVisible();
    await listboxDe.getByRole('button', { name: 'English' }).click();

    await expect(header.getByRole('tab', { name: 'Diagnostics' })).toBeVisible({
      timeout: 30_000,
    });
  });
});
