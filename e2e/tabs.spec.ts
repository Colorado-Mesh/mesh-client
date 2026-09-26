import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, openPanel, teardownApp } from './electronApp';

test.describe('tabs', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('opens App, Chat, and Diagnostics without crashing', async () => {
    launched = await launchApp();
    const { page } = launched;

    const panels: { section: string; tab?: string }[] = [
      { section: 'App' },
      { section: 'Chat' },
      { section: 'Monitor', tab: 'Diagnostics' },
    ];
    for (const { section, tab } of panels) {
      await openPanel(page, section, tab);
      await expect(page.locator('#root')).toBeVisible();
      expect(launched.crashed).toBe(false);
    }
  });

  test('opens a panel from the Ctrl/Cmd+K launcher', async () => {
    launched = await launchApp();
    const { page } = launched;
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    await page.keyboard.press(`${modifier}+KeyK`);
    const launcher = page.getByRole('dialog', { name: 'All panels' });
    await expect(launcher).toBeVisible();
    await launcher.getByRole('textbox', { name: 'Search panels' }).fill('sniff');
    await page.keyboard.press('Enter');
    await expect(launcher).toBeHidden();
    await expect(page.getByRole('banner').getByRole('tab', { name: 'Sniffer' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(launched.crashed).toBe(false);
  });
});
