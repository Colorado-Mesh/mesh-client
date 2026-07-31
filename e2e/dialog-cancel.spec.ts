import { expect, test } from '@playwright/test';

import {
  launchApp,
  type LaunchedApp,
  openAppTab,
  stubSaveDialogCanceled,
  teardownApp,
} from './electronApp';

test.describe('dialog cancel', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('Export for GitHub cancel leaves UI usable', async () => {
    test.setTimeout(90_000);
    launched = await launchApp();
    const restore = await stubSaveDialogCanceled(launched.app);

    try {
      await openAppTab(launched.page);
      // Accessible name is aria-label (appPanel.exportForGitHub), not the visible button text.
      const exportBtn = launched.page.getByRole('button', {
        name: 'Export support bundle for GitHub',
      });
      await exportBtn.scrollIntoViewIfNeeded();
      await expect(exportBtn).toBeVisible();
      await exportBtn.click();

      // Cancel path should return promptly; button remains enabled and App stays selected.
      await expect(exportBtn).toBeEnabled({ timeout: 15_000 });
      await expect(launched.page.locator('#root')).toBeVisible();
      await expect(
        launched.page
          .getByRole('tablist', { name: 'Application panels' })
          .getByRole('tab', { name: 'App' }),
      ).toHaveAttribute('aria-selected', 'true');
    } finally {
      await restore();
    }
  });
});
