import { expect, test } from '@playwright/test';

import { closeApp, disposeUserData, launchApp, openAppTab, teardownApp } from './electronApp';

test.describe('settings relaunch', () => {
  test('persists Reduce motion across process relaunch', async () => {
    test.setTimeout(90_000);

    let launched = await launchApp({ retainUserData: true });
    const userDataDir = launched.userDataDir;

    try {
      await openAppTab(launched.page);
      const reduceMotion = launched.page.getByRole('checkbox', { name: 'Reduce motion' });
      await reduceMotion.scrollIntoViewIfNeeded();
      await expect(reduceMotion).toBeVisible();
      if (!(await reduceMotion.isChecked())) {
        await reduceMotion.check();
      }
      await expect(reduceMotion).toBeChecked();

      await closeApp(launched);

      launched = await launchApp({ userDataDir, retainUserData: true });
      await openAppTab(launched.page);
      const reduceMotionAgain = launched.page.getByRole('checkbox', { name: 'Reduce motion' });
      await reduceMotionAgain.scrollIntoViewIfNeeded();
      await expect(reduceMotionAgain).toBeChecked();
    } finally {
      await teardownApp(launched);
      await disposeUserData(userDataDir);
    }
  });
});
