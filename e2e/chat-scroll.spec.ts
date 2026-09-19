import { expect, test } from '@playwright/test';

import type { ElectronAPI } from '../src/shared/electron-api.types';
import { launchApp, type LaunchedApp, teardownApp } from './electronApp';

test.describe('chat scroll to latest', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('hides the button after scrolling down and after jumping to latest', async () => {
    launched = await launchApp();
    const { page } = launched;
    await page
      .getByRole('group', { name: 'Protocol switcher' })
      .getByRole('button', { name: 'Switch to MeshCore' })
      .click();
    await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
      const start = Date.now() - 120_000;
      for (let index = 0; index < 80; index++) {
        await api.db.saveMeshcoreMessage({
          sender_id: 42,
          sender_name: 'Scroll test',
          payload: `Scroll message ${index}\n${'Message with several lines.\n'.repeat(index % 4)}`,
          channel_idx: 0,
          timestamp: start + index * 1000,
          status: 'acked',
        });
      }
    });
    await page.reload();
    await page
      .getByRole('tablist', { name: 'Application panels' })
      .getByRole('tab', { name: 'Chat' })
      .click();
    const stream = page
      .locator('div.overflow-y-auto')
      .filter({ has: page.locator('[data-chat-message-key]') });
    await expect(stream).toBeVisible();
    const jump = page.getByRole('button', { name: 'Jump to Latest', exact: true });
    const distanceFromBottom = () =>
      stream.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);

    await stream.evaluate((el) => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
    });
    await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2);

    for (let cycle = 0; cycle < 3; cycle++) {
      await stream.evaluate((el) => {
        el.scrollBy({ top: -300, behavior: 'instant' });
      });
      await expect(jump).toBeVisible();
      await stream.evaluate((el) => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
      });
      await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2);
      await expect(jump).toBeHidden();

      await stream.evaluate((el) => {
        el.scrollBy({ top: -300, behavior: 'instant' });
      });
      await expect(jump).toBeVisible();
      await jump.click();
      await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2);
      await expect(jump).toBeHidden();
    }
    expect(launched.crashed).toBe(false);
  });
});
