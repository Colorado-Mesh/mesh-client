import { expect, type Page, test } from '@playwright/test';

import { closeApp, disposeUserData, launchApp, type LaunchedApp, teardownApp } from './electronApp';

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

const picker = (page: Page) => page.getByRole('dialog', { name: 'Choose your protocols' });
const tour = (page: Page) => page.getByRole('region', { name: 'Protocol setup' });
const switcher = (page: Page) => page.getByRole('radiogroup', { name: 'Protocol switcher' });

async function withProfile(run: (first: LaunchedApp) => Promise<LaunchedApp>): Promise<void> {
  let launched = await launchApp({ retainUserData: true, firstRun: true });
  const userDataDir = launched.userDataDir;
  let testError: unknown;
  let cleanupError: unknown;
  try {
    launched = await run(launched);
  } catch (err) {
    testError = err;
  } finally {
    try {
      await teardownApp(launched);
    } catch (err) {
      cleanupError = err;
    }
    try {
      await disposeUserData(userDataDir);
    } catch (err) {
      cleanupError ??= err;
    }
  }
  if (testError != null) throw asError(testError);
  if (cleanupError != null) throw asError(cleanupError);
}

test.describe('first-run protocol wizard', () => {
  test('a fresh install picks protocols, tours each one, and never asks again', async () => {
    test.setTimeout(120_000);
    await withProfile(async (first) => {
      const { page } = first;
      await expect(picker(page)).toBeVisible({ timeout: 30_000 });
      await picker(page).getByRole('checkbox', { name: 'MeshCore' }).uncheck();
      await picker(page).getByRole('button', { name: 'Continue' }).click();
      await expect(picker(page)).toBeHidden();

      await expect(tour(page)).toContainText('Set up Meshtastic (1 of 2)');
      await expect(switcher(page).getByRole('radio')).toHaveCount(2);
      await expect(switcher(page).getByRole('radio', { name: 'Switch to MeshCore' })).toHaveCount(
        0,
      );
      await tour(page).getByRole('button', { name: 'Next' }).click();
      await expect(tour(page)).toContainText('Set up Reticulum (2 of 2)');
      await expect(
        switcher(page).getByRole('radio', { name: 'Switch to Reticulum' }),
      ).toHaveAttribute('aria-checked', 'true');
      await tour(page).getByRole('button', { name: 'Done' }).click();
      await expect(tour(page)).toBeHidden();

      await closeApp(first);
      const again = await launchApp({
        userDataDir: first.userDataDir,
        retainUserData: true,
        firstRun: true,
      });
      await expect(switcher(again.page).getByRole('radio')).toHaveCount(2);
      // Give the startup check time to answer before asserting it stayed closed.
      await again.page.waitForTimeout(2_000);
      await expect(picker(again.page)).toHaveCount(0);
      return again;
    });
  });

  test('quitting on the picker brings it back on the next launch', async () => {
    test.setTimeout(120_000);
    await withProfile(async (first) => {
      await expect(picker(first.page)).toBeVisible({ timeout: 30_000 });
      await closeApp(first);
      const again = await launchApp({
        userDataDir: first.userDataDir,
        retainUserData: true,
        firstRun: true,
      });
      await expect(picker(again.page)).toBeVisible({ timeout: 30_000 });
      await picker(again.page).getByRole('button', { name: 'Skip setup' }).click();
      await expect(picker(again.page)).toBeHidden();
      await expect(tour(again.page)).toHaveCount(0);
      return again;
    });
  });

  test('an existing install never sees the picker', async () => {
    test.setTimeout(120_000);
    // First launch without opting in: the database is created, the status stays unseen.
    let launched = await launchApp({ retainUserData: true });
    const userDataDir = launched.userDataDir;
    let testError: unknown;
    let cleanupError: unknown;
    try {
      await closeApp(launched);
      // Relaunch with the real fresh-database answer: the database already exists.
      launched = await launchApp({ userDataDir, retainUserData: true, firstRun: true });
      await launched.page.waitForTimeout(2_000);
      const status = await launched.page.evaluate(() => {
        const raw = localStorage.getItem('mesh-client:firstRunWizard');
        return raw == null
          ? null
          : (JSON.parse(raw) as { state?: { status?: string } }).state?.status;
      });
      expect([null, 'unseen']).toContain(status);
      await expect(picker(launched.page)).toHaveCount(0);
    } catch (err) {
      testError = err;
    } finally {
      try {
        await teardownApp(launched);
      } catch (err) {
        cleanupError = err;
      }
      try {
        await disposeUserData(userDataDir);
      } catch (err) {
        cleanupError ??= err;
      }
    }
    if (testError != null) throw asError(testError);
    if (cleanupError != null) throw asError(cleanupError);
  });

  test('specs that do not opt in start on the app', async () => {
    const launched = await launchApp();
    try {
      await launched.page.waitForTimeout(2_000);
      await expect(picker(launched.page)).toHaveCount(0);
    } finally {
      await teardownApp(launched);
    }
  });
});
