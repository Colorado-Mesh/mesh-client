import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, teardownApp } from './electronApp';

test.describe('locale', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('switches to German and back to English', async () => {
    launched = await launchApp();
    const { page } = launched;

    await expect(
      page
        .getByRole('tablist', { name: 'Application panels' })
        .getByRole('tab', { name: 'Diagnostics' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Select language' }).click();
    const listbox = page.getByRole('listbox', { name: 'Select language' });
    await expect(listbox).toBeVisible();
    await listbox.getByRole('button', { name: 'Deutsch' }).click();

    // Tablist aria-label is translated with the locale.
    const tablistDe = page.getByRole('tablist', { name: 'Anwendungspanels' });
    await expect(tablistDe.getByRole('tab', { name: 'Diagnostik' })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: 'Sprache auswählen' }).click();
    const listboxDe = page.getByRole('listbox', { name: 'Sprache auswählen' });
    await expect(listboxDe).toBeVisible();
    await listboxDe.getByRole('button', { name: 'English' }).click();

    await expect(
      page
        .getByRole('tablist', { name: 'Application panels' })
        .getByRole('tab', { name: 'Diagnostics' }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
