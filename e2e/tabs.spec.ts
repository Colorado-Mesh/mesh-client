import { expect, test } from '@playwright/test';

import { expectTabSelected, launchApp, type LaunchedApp, teardownApp } from './electronApp';

test.describe('tabs', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('opens App, Chat, and Diagnostics without crashing', async () => {
    launched = await launchApp();
    const { page } = launched;
    const tablist = page.getByRole('tablist', { name: 'Application panels' });

    for (const name of ['App', 'Chat', 'Diagnostics'] as const) {
      await tablist.getByRole('tab', { name }).click();
      await expectTabSelected(page, name);
      await expect(page.locator('#root')).toBeVisible();
      expect(launched.crashed).toBe(false);
    }
  });
});
