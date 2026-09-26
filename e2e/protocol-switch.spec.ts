import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, navName, teardownApp } from './electronApp';

test.describe('protocol switch', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('switches protocols and updates the rail sections and sub-tabs', async () => {
    launched = await launchApp();
    const { page } = launched;
    const switcher = page.getByRole('radiogroup', { name: 'Protocol switcher' });
    const rail = page.getByRole('navigation', { name: 'Application panels' });
    const header = page.getByRole('banner');
    const openSection = (name: string) => rail.getByRole('button', { name: navName(name) }).click();

    await switcher.getByRole('radio', { name: 'Switch to MeshCore' }).click();
    await expect(switcher.getByRole('radio', { name: 'Switch to MeshCore' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await openSection('Chat');
    await expect(header.getByRole('tab', { name: navName('Chat') })).toBeVisible();
    await expect(header.getByRole('tab', { name: navName('Rooms') })).toBeVisible();
    await expect(header.getByRole('tab', { name: navName('RRC') })).toHaveCount(0);

    await switcher.getByRole('radio', { name: 'Switch to Reticulum' }).click();
    await expect(switcher.getByRole('radio', { name: 'Switch to Reticulum' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await openSection('Chat');
    await expect(header.getByRole('tab', { name: navName('RRC') })).toBeVisible();
    await expect(header.getByRole('tab', { name: navName('Rooms') })).toHaveCount(0);
    await openSection('Network');
    await expect(header.getByRole('tab', { name: 'Nomad Network' })).toBeVisible();

    await switcher.getByRole('radio', { name: 'Switch to Meshtastic' }).click();
    await expect(switcher.getByRole('radio', { name: 'Switch to Meshtastic' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await openSection('Monitor');
    await expect(header.getByRole('tab', { name: 'Diagnostics' })).toBeVisible();
    await openSection('Chat');
    await expect(header.getByRole('tab', { name: navName('RRC') })).toHaveCount(0);
  });
});
