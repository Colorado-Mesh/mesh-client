import { expect, test } from '@playwright/test';

import type { ElectronAPI } from '../src/shared/electron-api.types';
import { closeApp, launchApp, type LaunchedApp, openPanel, teardownApp } from './electronApp';
import { startMeshcoreRadio } from './fixtures/meshcore-radio';

let launched: LaunchedApp;
let radio: Awaited<ReturnType<typeof startMeshcoreRadio>>;
test.afterEach(async () => {
  if (launched) {
    launched.retainUserData = false;
    await teardownApp(launched);
  }
  if (radio) await radio.close();
});

test('fresh opt-in defaults, radio import/sync, drag/A–Z and restart persistence', async () => {
  test.setTimeout(120_000);
  radio = await startMeshcoreRadio();
  launched = await launchApp({ retainUserData: true });
  let page = launched.page;
  await openPanel(page, 'App');
  await page.getByText('GPS / Location', { exact: true }).click();
  const sharing = page.getByRole('checkbox', { name: 'Share my location', exact: true });
  await expect(sharing).not.toBeChecked();
  await sharing.check();
  await page.reload();
  await openPanel(page, 'App');
  await page.getByText('GPS / Location', { exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Share my location', exact: true }),
  ).toBeChecked();
  await page.getByRole('checkbox', { name: 'Share my location', exact: true }).uncheck();

  await page.getByRole('radio', { name: 'Switch to MeshCore' }).click();
  await openPanel(page, 'Device', 'Connection');
  await page.getByRole('radio', { name: 'TCP/IP', exact: true }).click();
  await page.locator('#connection-meshcore-tcp-host').fill('127.0.0.1');
  await page.locator('#connection-meshcore-tcp-port').fill(String(radio.port));
  await page.locator('[data-setting-anchor="connection.radio.connect"]').click();
  await openPanel(page, 'Chat');
  await expect(page.getByRole('button', { name: 'Zulu', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Alpha', exact: true })).toBeVisible();
  expect(radio.commands).not.toContain(14);

  await page.getByRole('button', { name: 'Order chats' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Order chats' });
  await dialog.getByRole('button', { name: 'Sort A–Z' }).click();
  await expect(dialog.locator('li')).toHaveText(['Alpha', 'Beta', 'Zulu']);
  // Real pointer events on the drag handle; keep pointer capture throughout movement.
  const handle = dialog.getByRole('button', { name: 'Drag Zulu' });
  const from = await handle.boundingBox();
  const target = await dialog.getByRole('button', { name: 'Drag Alpha' }).boundingBox();
  if (!from || !target) throw new Error('Missing drag handles');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(dialog.locator('li')).toHaveText(['Zulu', 'Alpha', 'Beta']);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  radio.setChats(['Zulu', 'Alpha', 'Beta', 'Delta'], ['Zulu Room', 'Alpha Room', 'Delta Room']);
  await page.getByRole('button', { name: 'Sync chats from radio', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Chats synced from radio.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delta', exact: true })).toBeVisible();
  radio.setReadFailure(true);
  await page.getByRole('button', { name: 'Sync chats from radio', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not read chats' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delta', exact: true })).toBeVisible();
  radio.setReadFailure(false);
  await page.getByRole('button', { name: 'Sync chats from radio', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Chats synced from radio.' }),
  ).toBeVisible();

  // A complete snapshot clears stale on-radio flags without deleting stored rooms.
  radio.setChats(['Zulu', 'Alpha', 'Beta', 'Delta'], ['Zulu Room', 'Delta Room']);
  await page.getByRole('button', { name: 'Sync chats from radio', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Chats synced from radio.' }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
        const contacts = (await api.db.getMeshcoreContacts()) as {
          adv_name: string;
          on_radio: number;
        }[];
        return contacts
          .filter((contact) => contact.adv_name.endsWith('Room'))
          .map((contact) => [contact.adv_name, contact.on_radio])
          .sort();
      }),
    )
    .toEqual([
      ['Alpha Room', 0],
      ['Delta Room', 1],
      ['Zulu Room', 1],
    ]);

  await openPanel(page, 'Chat', 'Rooms');
  await expect(page.getByRole('button', { name: /Delta Room/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Order chats' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sort A–Z' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await launched.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setMinimumSize(360, 600);
    win?.setContentSize(390, 844);
  });
  await page.getByRole('button', { name: 'Order chats' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Move Zulu Room up' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const profile = launched.userDataDir;
  await closeApp(launched);
  launched = await launchApp({ userDataDir: profile });
  page = launched.page;
  await openPanel(page, 'Chat', 'Rooms');
  await expect(page.getByRole('button', { name: /Delta Room/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Order chats' }).click();
  await expect(page.getByRole('dialog').locator('li')).toHaveText([
    'Alpha Room',
    'Zulu Room',
    'Delta Room',
  ]);
  await page.keyboard.press('Escape');
  expect(launched.crashed).toBe(false);
});

test('shared DM ordering works across protocols, reload, keyboard and touch', async () => {
  test.setTimeout(120_000);
  launched = await launchApp();
  const { page, app } = launched;
  await page.evaluate(() => {
    for (const protocol of ['meshtastic', 'meshcore', 'reticulum'])
      localStorage.setItem(`mesh-client:openDmTabs:${protocol}`, '[42,43,44]');
  });
  await page.reload();
  for (const name of ['Meshtastic', 'MeshCore', 'Reticulum']) {
    await page.getByRole('radio', { name: `Switch to ${name}` }).click();
    await openPanel(page, 'Chat');
    const orderButton = page.getByRole('button', { name: 'Order chats' }).last();
    await expect(orderButton).toBeEnabled();
    await orderButton.click();
    const dialog = page.getByRole('dialog', { name: 'Order chats' });
    await expect(dialog.locator('li')).toHaveCount(3);
    const before = await dialog
      .locator('li')
      .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.chatOrderId));
    const lastHandle = dialog.getByRole('button', { name: /^Drag / }).last();
    await lastHandle.focus();
    await page.keyboard.press('ArrowUp');
    const desired = [before[0], before[2], before[1]];
    await expect
      .poll(() =>
        dialog
          .locator('li')
          .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.chatOrderId)),
      )
      .toEqual(desired);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await page.reload();
    await openPanel(page, 'Chat');
    await page.getByRole('button', { name: 'Order chats' }).last().click();
    await expect
      .poll(() =>
        page
          .getByRole('dialog')
          .locator('li')
          .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.chatOrderId)),
      )
      .toEqual(desired);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Order chats' }).last()).toBeEnabled();
  }
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setMinimumSize(360, 600);
    win?.setContentSize(390, 844);
  });
  await page.getByRole('button', { name: 'Order chats' }).last().click();
  const dialog = page.getByRole('dialog');
  const handles = dialog.getByRole('button', { name: /^Drag / });
  const first = await handles.first().boundingBox();
  const last = await handles.last().boundingBox();
  if (!first || !last) throw new Error('Touch handles missing');
  const original = await dialog.locator('li').first().getAttribute('data-chat-order-id');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: first.x + 12, y: first.y + 12 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: last.x + 12, y: last.y + 12 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(dialog.locator('li').last()).toHaveAttribute('data-chat-order-id', original!);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(launched.crashed).toBe(false);
});
