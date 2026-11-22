import { expect, type Page, test } from '@playwright/test';

import { closeApp, disposeUserData, launchApp, type LaunchedApp, teardownApp } from './electronApp';

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

const picker = (page: Page) => page.getByRole('dialog', { name: 'Choose your protocols' });
const tour = (page: Page) => page.getByRole('region', { name: 'Protocol setup' });
const switcher = (page: Page) => page.getByRole('radiogroup', { name: 'Protocol switcher' });

interface ProfileSession {
  /** Closes the current app and launches the same profile again (wizard opted in). */
  relaunch: () => Promise<LaunchedApp>;
}

/**
 * Runs `run` on a fresh profile with the wizard opted in. Cleanup always closes whichever app
 * is current, including one launched by `relaunch` just before a failing assertion.
 */
async function withProfile(
  run: (first: LaunchedApp, session: ProfileSession) => Promise<void>,
  options: { firstRun?: boolean } = { firstRun: true },
): Promise<void> {
  let launched = await launchApp({ retainUserData: true, firstRun: options.firstRun });
  const userDataDir = launched.userDataDir;
  const session: ProfileSession = {
    relaunch: async () => {
      await closeApp(launched);
      launched = await launchApp({ userDataDir, retainUserData: true, firstRun: true });
      return launched;
    },
  };
  let testError: unknown;
  let cleanupError: unknown;
  try {
    await run(launched, session);
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
    await withProfile(async ({ page }, session) => {
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

      const again = await session.relaunch();
      await expect(switcher(again.page).getByRole('radio')).toHaveCount(2);
      // Give the startup check time to answer before asserting it stayed closed.
      await again.page.waitForTimeout(2_000);
      await expect(picker(again.page)).toHaveCount(0);
    });
  });

  test('a one-protocol pick relaunches without a protocol switcher', async () => {
    test.setTimeout(120_000);
    await withProfile(async ({ page }, session) => {
      await expect(picker(page)).toBeVisible({ timeout: 30_000 });
      await picker(page).getByRole('checkbox', { name: 'Meshtastic' }).uncheck();
      await picker(page).getByRole('checkbox', { name: 'MeshCore' }).uncheck();
      await picker(page).getByRole('button', { name: 'Continue' }).click();
      await expect(tour(page)).toContainText('Set up Reticulum (1 of 1)');
      await expect(switcher(page)).toHaveCount(0);
      await tour(page).getByRole('button', { name: 'Done' }).click();

      // launchApp must treat the app as ready although no switcher is drawn.
      const again = await session.relaunch();
      await expect(switcher(again.page)).toHaveCount(0);
      await again.page.waitForTimeout(2_000);
      await expect(picker(again.page)).toHaveCount(0);
    });
  });

  test('quitting on the picker brings it back on the next launch', async () => {
    test.setTimeout(120_000);
    await withProfile(async ({ page }, session) => {
      await expect(picker(page)).toBeVisible({ timeout: 30_000 });
      const again = await session.relaunch();
      await expect(picker(again.page)).toBeVisible({ timeout: 30_000 });
      await picker(again.page).getByRole('button', { name: 'Skip setup' }).click();
      await expect(picker(again.page)).toBeHidden();
      await expect(tour(again.page)).toHaveCount(0);
    });
  });

  test('an existing install never sees the picker', async () => {
    test.setTimeout(120_000);
    // First launch without opting in: the database is created, the status stays unseen.
    await withProfile(
      async (_first, session) => {
        // Relaunch with the real fresh-database answer: the database already exists.
        const again = await session.relaunch();
        await again.page.waitForTimeout(2_000);
        const status = await again.page.evaluate(() => {
          const raw = localStorage.getItem('mesh-client:firstRunWizard');
          return raw == null
            ? null
            : (JSON.parse(raw) as { state?: { status?: string } }).state?.status;
        });
        expect([null, 'unseen']).toContain(status);
        await expect(picker(again.page)).toHaveCount(0);
      },
      { firstRun: false },
    );
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
