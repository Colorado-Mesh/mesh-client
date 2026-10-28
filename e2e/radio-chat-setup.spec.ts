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

async function resizeChatWindow({ app, page }: LaunchedApp, width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error('Missing app window');
      win.setMinimumSize(320, 600);
      win.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await expect
    .poll(async () => {
      const actual = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getContentSize(),
      );
      return page.evaluate(
        ([width, height]) => innerWidth === width && innerHeight === height,
        actual,
      );
    })
    .toBe(true);
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
}

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
  const testInfo = test.info();
  test.setTimeout(120_000);
  launched = await launchApp();
  const { page } = launched;
  for (const name of ['Meshtastic', 'MeshCore', 'Reticulum']) {
    await resizeChatWindow(launched, 1280, 900);
    await page.getByRole('radio', { name: `Switch to ${name}` }).click();
    await openPanel(page, 'Chat');
    for (const width of [1024, 768, 390]) {
      await resizeChatWindow(launched, width, 844);
      await expect(page.getByText('DMs', { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(
        page
          .getByRole('group', { name: 'DMs', exact: true })
          .getByRole('button', { name: 'Order chats' }),
      ).toBeVisible();
    }
    const tools = page.getByRole('group', { name: 'Conversation tools', exact: true });
    await expect(
      tools
        .getByRole('group', { name: 'DMs', exact: true })
        .getByRole('button', { name: 'Order chats' }),
    ).toBeDisabled();
  }
  await page.evaluate(() => {
    for (const protocol of ['meshtastic', 'meshcore', 'reticulum'])
      localStorage.setItem(`mesh-client:openDmTabs:${protocol}`, '[42,43,44]');
  });
  await page.reload();
  for (const name of ['Meshtastic', 'MeshCore', 'Reticulum']) {
    await resizeChatWindow(launched, 1280, 900);
    await page.getByRole('radio', { name: `Switch to ${name}` }).click();
    await openPanel(page, 'Chat');
    await expect(page.getByText('DMs', { exact: true })).toHaveCount(0);
    const orderButton = page
      .getByRole('group', { name: 'DMs', exact: true })
      .getByRole('button', { name: 'Order chats' });
    await expect(orderButton).toBeEnabled();
    await expect(orderButton).toHaveAttribute('title', 'Order chats: DMs');
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
    for (const [width, height] of [
      [768, 844],
      [390, 844],
      [390, 645],
    ]) {
      await resizeChatWindow(launched, width, height);
      if (height === 645) {
        await expect.poll(() => page.evaluate(() => innerHeight)).toBe(645);
        await expect
          .poll(() => page.getByTestId('chat-conversation-row').evaluate((row) => row.clientHeight))
          .toBeGreaterThan(0);
      }
      if (height === 645 && name !== 'Reticulum') {
        await expect(
          page.getByRole('button', { name: 'Dismiss location prompt for this session' }),
        ).toBeVisible();
      }
      await expect(orderButton).toBeVisible();
      await orderButton.click();
      await expect(page.getByRole('dialog').locator('li')).toHaveCount(3);
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.screenshot({ path: testInfo.outputPath(`dm-${name}-phone.png`) });
    await orderButton.click();
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
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp.detach();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }

  expect(launched.crashed).toBe(false);
});

test('stalled radio sync closes the old stream and reconnect recovers', async () => {
  test.setTimeout(90_000);
  radio = await startMeshcoreRadio();
  launched = await launchApp();
  const { page } = launched;
  await page.getByRole('radio', { name: 'Switch to MeshCore' }).click();
  await openPanel(page, 'Device', 'Connection');
  await page.getByRole('radio', { name: 'TCP/IP', exact: true }).click();
  await page.locator('#connection-meshcore-tcp-host').fill('127.0.0.1');
  await page.locator('#connection-meshcore-tcp-port').fill(String(radio.port));
  await page.locator('[data-setting-anchor="connection.radio.connect"]').click();
  await openPanel(page, 'Chat');
  await expect(page.getByRole('button', { name: 'Zulu', exact: true })).toBeVisible();
  radio.setContactStall(true);
  const sync = page
    .locator('header')
    .getByRole('button', { name: /^(Sync chats from radio|Reading chats from radio…)$/ });
  await sync.click();
  await expect(sync).toHaveAttribute('aria-busy', 'true');
  await expect(sync).toBeDisabled();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not read chats' })).toBeVisible({
    timeout: 35_000,
  });
  await expect(sync).toBeDisabled();
  radio.setContactStall(false);
  await openPanel(page, 'Device', 'Connection');
  await page.locator('[data-setting-anchor="connection.radio.connect"]').click();
  await openPanel(page, 'Chat');
  await expect(sync).toBeEnabled();
  await sync.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Chats synced from radio.' }),
  ).toBeVisible();
  expect(radio.commands).not.toContain(14);
  expect(launched.crashed).toBe(false);
});

test('header sync leaves every channel reachable at desktop, narrow and phone widths', async () => {
  const testInfo = test.info();
  test.setTimeout(120_000);
  radio = await startMeshcoreRadio();
  const channels = Array.from({ length: 24 }, (_, index) => `Channel ${index + 1}`);
  radio.setChats(channels, ['Test Room']);
  launched = await launchApp();
  const { page } = launched;
  await page.getByRole('radio', { name: 'Switch to MeshCore' }).click();
  const sync = page.locator('header').getByRole('button', { name: 'Sync chats from radio' });
  await expect(sync).toBeDisabled();
  await openPanel(page, 'Device', 'Connection');
  await page.getByRole('radio', { name: 'TCP/IP', exact: true }).click();
  await page.locator('#connection-meshcore-tcp-host').fill('127.0.0.1');
  await page.locator('#connection-meshcore-tcp-port').fill(String(radio.port));
  await page.locator('[data-setting-anchor="connection.radio.connect"]').click();
  await openPanel(page, 'Chat');
  await expect(sync).toBeEnabled();
  const region = page.getByRole('region', { name: 'Channels', exact: true });
  await expect(region.getByRole('button')).toHaveCount(24);
  await expect(page.getByText('DMs', { exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole('group', { name: 'DMs', exact: true })
      .getByRole('button', { name: 'Order chats' }),
  ).toBeDisabled();
  await sync.focus();
  await expect(sync).toHaveAttribute('title', '');
  await expect(
    page.getByRole('tooltip').filter({ hasText: 'Sync chats from radio' }),
  ).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'Chats synced from radio.' }),
  ).toBeAttached();
  await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
    await api.ai.setEnabled(true);
    await api.ai.setConfig({
      engine: 'local',
      wireFormat: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'layout-test',
    });
  });
  await openPanel(page, 'App');
  await page.getByText('AI conversation summaries', { exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Enable AI summaries', exact: true }),
  ).toBeChecked();
  await openPanel(page, 'Chat');
  await page.getByRole('combobox', { name: 'Summary range' }).selectOption('custom');
  for (const [width, height] of [
    [1440, 900],
    [1024, 900],
    [768, 900],
    [390, 900],
    [360, 900],
    [390, 645],
  ]) {
    await resizeChatWindow(launched, width, height);
    if (height === 645) {
      await expect.poll(() => page.evaluate(() => innerHeight)).toBe(645);
      await expect.poll(() => region.evaluate((list) => list.clientHeight)).toBeGreaterThan(0);
      await expect(
        page.getByRole('button', { name: 'Dismiss location prompt for this session' }),
      ).toBeVisible();
      const outerScrollTop = () =>
        region.evaluate((list) => {
          let parent = list.parentElement;
          while (parent) {
            if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)) {
              return parent.scrollTop;
            }
            parent = parent.parentElement;
          }
          throw new Error('Missing chat scroll parent');
        });
      await region.hover();
      await page.mouse.wheel(0, -4000);
      await expect.poll(() => region.evaluate((list) => list.scrollTop)).toBe(0);
      await page.mouse.wheel(0, -4000);
      await expect.poll(outerScrollTop).toBe(0);
      await page.mouse.wheel(0, 4000);
      await expect
        .poll(() =>
          region.evaluate((list) => list.scrollHeight - list.clientHeight - list.scrollTop),
        )
        .toBeLessThanOrEqual(1);
      await page.mouse.wheel(0, 4000);
      await expect.poll(outerScrollTop).toBeGreaterThan(0);
    }
    await expect(sync).toBeVisible();
    const advert = page.getByRole('button', { name: 'Send flood advert', exact: true });
    await expect(advert).toBeVisible();
    const boxes = await page.locator('header button:visible').evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }),
    );
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
    }
    if (width <= 390) {
      for (const section of ['Network', 'Monitor', 'Device']) {
        if (section === 'Network') await openPanel(page, section);
        else {
          await page
            .getByRole('navigation', { name: 'Application panels' })
            .getByRole('button', { name: 'More', exact: true })
            .click();
          await page
            .getByRole('dialog')
            .getByRole('button', {
              name: section === 'Monitor' ? 'Stats' : 'Connection',
              exact: true,
            })
            .click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
        }
        const bounds = await sync.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await openPanel(page, 'Chat');
    }
    await page.getByRole('combobox', { name: 'Summary range' }).selectOption('custom');
    await expect(page.getByRole('spinbutton', { name: 'Custom hours', exact: true })).toBeVisible();
    const toolbar = page.getByRole('group', { name: 'Conversation tools', exact: true });
    const controls = await toolbar
      .locator('button:visible, select:visible, input:visible')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
      );
    for (const box of controls) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
    }
    const syncBox = await sync.boundingBox();
    const advertBox = await advert.boundingBox();
    expect(syncBox).not.toBeNull();
    expect(advertBox).not.toBeNull();
    expect(syncBox!.x).toBeGreaterThan(advertBox!.x + advertBox!.width);
    for (const channel of channels)
      await expect(region.getByRole('button', { name: channel, exact: true })).toBeVisible();
    await region.getByRole('button', { name: 'Channel 24', exact: true }).click();
    await expect(region.getByRole('button', { name: 'Channel 24', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`toolbar-${width}-${height}.png`) });
  }
  radio.setReadFailure(true);
  await sync.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not read chats' })).toBeAttached();
  const toast = page.locator('[data-toast-stack]').getByText(/Could not read chats/);
  await expect(toast).toBeVisible();
  await expect(
    page.locator('[data-toast-stack] > div').filter({ hasText: 'Could not read chats' }),
  ).toHaveClass(/opacity-100/);
  await expect
    .poll(() => toast.evaluate((element) => getComputedStyle(element.parentElement!).opacity))
    .toBe('1');
  const toastBox = await toast.boundingBox();
  expect(toastBox!.x).toBeGreaterThanOrEqual(0);
  expect(toastBox!.x + toastBox!.width).toBeLessThanOrEqual(360);
  await page.screenshot({ path: testInfo.outputPath('toolbar-error-phone.png') });
  await expect(region.getByRole('button')).toHaveCount(24);
  radio.setReadFailure(false);
  await sync.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Chats synced from radio.' }),
  ).toBeAttached();
  expect(launched.crashed).toBe(false);
});
