import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, teardownApp } from './electronApp';

test.describe('protocol switch', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('switches protocols and updates sidebar tab set', async () => {
    launched = await launchApp();
    const { page } = launched;
    const switcher = page.getByRole('group', { name: 'Protocol switcher' });
    const tablist = page.getByRole('tablist', { name: 'Application panels' });

    await switcher.getByRole('button', { name: 'Switch to MeshCore' }).click();
    await expect(switcher.getByRole('button', { name: 'Switch to MeshCore' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(tablist.getByRole('tab', { name: 'Chat' })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: 'Rooms' })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: 'RRC' })).toHaveCount(0);

    await switcher.getByRole('button', { name: 'Switch to Reticulum' }).click();
    await expect(switcher.getByRole('button', { name: 'Switch to Reticulum' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(tablist.getByRole('tab', { name: 'RRC' })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: 'Nomad Network' })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: 'Chat' })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: 'Rooms' })).toHaveCount(0);

    await switcher.getByRole('button', { name: 'Switch to Meshtastic' }).click();
    await expect(switcher.getByRole('button', { name: 'Switch to Meshtastic' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(tablist.getByRole('tab', { name: 'Diagnostics' })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: 'RRC' })).toHaveCount(0);
  });
});
