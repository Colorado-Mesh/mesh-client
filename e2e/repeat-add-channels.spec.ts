import { expect, test } from '@playwright/test';

import { closeApp, launchApp, type LaunchedApp, openPanel, teardownApp } from './electronApp';
import { startMeshcoreRadio } from './fixtures/meshcore-radio';

let launched: LaunchedApp;
let radio: Awaited<ReturnType<typeof startMeshcoreRadio>>;
test.afterEach(async () => {
  if (launched) await teardownApp(launched);
  if (radio) await radio.close();
});

test('repeat add channels: opt-in, private/public, duplicates, retries, busy guard and persistence', async () => {
  test.setTimeout(180_000);
  radio = await startMeshcoreRadio();
  launched = await launchApp({ retainUserData: true });
  let page = launched.page;
  await page.getByRole('radio', { name: 'Switch to MeshCore' }).click();
  await openPanel(page, 'Device', 'Connection');
  await page.getByRole('radio', { name: 'TCP/IP', exact: true }).click();
  await page.locator('#connection-meshcore-tcp-host').fill('127.0.0.1');
  await page.locator('#connection-meshcore-tcp-port').fill(String(radio.port));
  await page.locator('[data-setting-anchor="connection.radio.connect"]').click();
  await openPanel(page, 'Chat');
  const add = page.getByRole('button', { name: '+ Add Channel', exact: true });
  await expect(add).toBeEnabled();
  await page.getByRole('button', { name: 'Dismiss location prompt for this session' }).click();
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Add Channel' });
  const name = dialog.getByRole('textbox', { name: 'Name', exact: true });
  const repeat = dialog.getByRole('switch', { name: 'Keep open after adding' });
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await expect(name).toBeFocused();
  await expect(repeat).not.toBeChecked();
  await expect(save).toBeDisabled();
  await name.fill('one');
  await name.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
  expect(radio.getChannel(3).name).toBe('#one');

  await add.click();
  await repeat.click();
  for (const channel of ['two', 'three', 'two']) {
    await name.fill(channel);
    await save.click();
    await expect(name).toHaveValue('');
    await expect(name).toBeFocused();
    await expect(repeat).toBeChecked();
  }
  await expect(dialog.getByRole('status')).toHaveText('#two is already added.');
  expect(radio.commands.filter((command) => command === 32)).toHaveLength(3);
  expect(radio.getChannel(4).name).toBe('#two');
  expect(radio.getChannel(5).name).toBe('#three');
  const privateMode = dialog.getByRole('checkbox', { name: 'Private channel (enter key)' });
  await privateMode.check();
  const key = dialog.getByLabel('Key (32 hex chars = 16 bytes)');
  await name.fill('Team');
  await key.fill('invalid');
  await expect(save).toBeDisabled();
  await key.press('Enter');
  await expect(key).toHaveValue('invalid');
  await key.fill('ab'.repeat(16));
  radio.setSaveFailure(true);
  await save.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(name).toHaveValue('Team');
  await expect(key).toHaveValue('ab'.repeat(16));
  await expect(repeat).toBeChecked();
  radio.setSaveFailure(false);
  radio.holdSaves(true);
  await save.click();
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect(dialog.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await expect(repeat).toBeDisabled();
  await name.press('Enter');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  const writes = radio.commands.filter((command) => command === 32).length;
  radio.holdSaves(false);
  await expect(name).toHaveValue('');
  await expect(key).toHaveValue('');
  await expect(privateMode).toBeChecked();
  await expect(name).toBeFocused();
  expect(radio.commands.filter((command) => command === 32)).toHaveLength(writes);
  expect(radio.getChannel(6).secret).toEqual(Buffer.alloc(16, 0xab));

  // Re-enter the same private name/key: select it without another device write.
  await name.fill('Team');
  await key.fill('ab'.repeat(16));
  await save.click();
  await expect(dialog.getByRole('status')).toHaveText('Team is already added.');
  expect(radio.commands.filter((command) => command === 32)).toHaveLength(writes);
  await privateMode.uncheck();
  await repeat.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(repeat).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
  await add.click();
  await expect(repeat).not.toBeChecked();
  await expect(privateMode).not.toBeChecked();
  await expect(name).toHaveValue('');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  for (const [width, height, scale] of [
    [1024, 768, 1],
    [390, 720, 1],
    [390, 600, 1.5],
  ]) {
    await launched.app.evaluate(
      ({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setMinimumSize(360, 400);
        win.setContentSize(size.width, size.height);
      },
      { width, height },
    );
    await page.evaluate((fontScale) => {
      document.documentElement.style.fontSize = `${fontScale * 100}%`;
    }, scale);
    await add.click();
    await privateMode.check();
    await repeat.click();
    await key.fill('cd'.repeat(16));
    await name.fill(`responsive-${width}-${scale}`);
    await save.click();
    await expect(name).toHaveValue('');
    await expect(key).toHaveValue('');
    await expect(name).toBeFocused();
    const fits = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
      );
    });
    expect(fits).toBe(true);
    await repeat.focus();
    await page.keyboard.press('Space');
    await expect(repeat).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(add).toBeFocused();
  }

  // Added channels survive a renderer reload and an app restart in this test profile.
  await page.reload();
  await openPanel(page, 'Chat');
  await expect(page.getByRole('button', { name: '#three', exact: true })).toBeVisible();
  const profile = launched.userDataDir;
  await closeApp(launched);
  launched = await launchApp({ userDataDir: profile });
  page = launched.page;
  await openPanel(page, 'Chat');
  await expect(page.getByRole('button', { name: '#three', exact: true })).toBeVisible();
  expect(launched.crashed).toBe(false);
  expect(launched.didFailLoad).toBe(false);
});
