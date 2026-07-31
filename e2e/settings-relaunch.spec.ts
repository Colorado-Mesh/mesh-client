import { expect, test } from '@playwright/test';

import { closeApp, disposeUserData, launchApp, openAppTab, teardownApp } from './electronApp';

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

test.describe('settings relaunch', () => {
  test('persists Reduce motion across process relaunch', async () => {
    test.setTimeout(90_000);

    let launched = await launchApp({ retainUserData: true });
    const userDataDir = launched.userDataDir;

    let testError: unknown;
    let cleanupError: unknown;
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
    } catch (err) {
      testError = err;
    } finally {
      try {
        await teardownApp(launched);
      } catch (err) {
        cleanupError = err;
      }
      // retainUserData: true — teardown skips dispose; always dispose explicitly.
      try {
        await disposeUserData(userDataDir);
      } catch (err) {
        cleanupError ??= err;
      }
    }

    if (testError != null) {
      throw asError(testError);
    }
    if (cleanupError != null) {
      throw asError(cleanupError);
    }
  });
});
