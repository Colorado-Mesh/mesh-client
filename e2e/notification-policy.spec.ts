import { expect, type Page, test } from '@playwright/test';

import {
  closeApp,
  disposeUserData,
  launchApp,
  openAppTab,
  openPanel,
  revealSettingInPage,
  teardownApp,
} from './electronApp';
import { startMeshcoreRadio } from './fixtures/meshcore-radio';

async function probe(page: Page) {
  await page.evaluate(() => {
    const state = {
      sounds: 0,
      previews: [] as { title: string; body: string; silent: boolean }[],
      permissions: 0,
    };
    Object.assign(window, { notificationProbe: state });
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      state.sounds++;
      return create.call(this);
    };
    // Test-owned renderer substitute: never request OS permission or emit a real preview.
    class Preview {
      static permission = 'granted';
      static requestPermission() {
        state.permissions++;
        return Promise.resolve('denied');
      }
      constructor(
        readonly title: string,
        options: NotificationOptions,
      ) {
        state.previews.push({ title, body: options.body ?? '', silent: options.silent ?? false });
      }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: Preview });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
async function counts(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          notificationProbe: { sounds: number; previews: unknown[]; permissions: number };
        }
      ).notificationProbe,
  );
}
async function connect(page: Page, port: number) {
  await page.getByRole('radio', { name: 'Switch to MeshCore' }).click();
  await openPanel(page, 'Device', 'Connection');
  await page.getByRole('radio', { name: 'TCP/IP', exact: true }).click();
  await page.locator('#connection-meshcore-tcp-host').fill('127.0.0.1');
  await page.locator('#connection-meshcore-tcp-port').fill(String(port));
  await page.locator('[data-setting-anchor="connection.radio.connect"]').click();
  await openPanel(page, 'Chat');
  await expect(page.getByRole('button', { name: 'Zulu', exact: true })).toBeVisible();
}

test('mentions, mute/unmute and previews through a synthetic TCP radio, with restart and responsive controls', async () => {
  test.setTimeout(180_000);
  const radio = await startMeshcoreRadio();
  let launched = await launchApp({ retainUserData: true });
  const profile = launched.userDataDir;
  try {
    await launched.app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true);
    });
    let page = launched.page;
    await openAppTab(page);
    await revealSettingInPage(page, 'app.notifications.mode');
    const mode = page.getByRole('combobox', { name: 'Chat notifications', exact: true });
    await expect(mode).toHaveValue('all');
    await mode.selectOption('mentions');
    await connect(page, radio.port);
    await probe(page);
    const timestamp = Math.floor(Date.now() / 1000);
    radio.receiveChannel(0, 'Other: baseline', timestamp);
    await expect(page.getByText('baseline', { exact: true })).toBeVisible();
    radio.receiveChannel(0, 'Other: ordinary filtered message', timestamp + 1);
    await expect(page.getByText('ordinary filtered message', { exact: true })).toBeVisible();
    expect((await counts(page)).previews).toHaveLength(0);
    radio.receiveChannel(0, 'Other: @[Test Radio] check in', timestamp + 2);
    await expect.poll(async () => (await counts(page)).previews.length).toBe(1);
    expect((await counts(page)).sounds).toBe(1);
    radio.receiveChannel(0, 'Other: @[Test Radio] check in', timestamp + 2);
    await expect.poll(async () => page.getByText('check in', { exact: false }).count()).toBe(1);
    expect((await counts(page)).previews).toHaveLength(1);
    await page.getByRole('button', { name: 'Mute this conversation', exact: true }).last().click();
    await expect(
      page.getByRole('button', { name: 'Unmute this conversation', exact: true }).last(),
    ).toHaveAttribute('aria-pressed', 'true');
    radio.receiveChannel(0, 'Other: @[Test Radio] muted but visible', timestamp + 3);
    await expect(page.getByText('muted but visible', { exact: false })).toBeVisible();
    expect((await counts(page)).previews).toHaveLength(1);
    await page
      .getByRole('button', { name: 'Unmute this conversation', exact: true })
      .last()
      .click();
    radio.receiveChannel(0, 'Other: @[Test Radio] unmuted', timestamp + 4);
    await expect.poll(async () => (await counts(page)).previews.length).toBe(2);
    expect((await counts(page)).permissions).toBe(0);
    await page.getByRole('button', { name: 'Mute this conversation', exact: true }).last().click();
    await openPanel(page, 'Chat', 'Rooms');
    await page.getByRole('button', { name: 'Alpha Room 0 posts', exact: true }).click();
    await page.getByRole('button', { name: 'Continue read-only', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Mute this conversation', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Mute this conversation', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Unmute this conversation', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Unmute this conversation', exact: true }).click();
    await closeApp(launched);
    launched = await launchApp({ userDataDir: profile, retainUserData: true });
    page = launched.page;
    await launched.app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true);
    });
    await openAppTab(page);
    await revealSettingInPage(page, 'app.notifications.mode');
    await expect(
      page.getByRole('combobox', { name: 'Chat notifications', exact: true }),
    ).toHaveValue('mentions');
    await launched.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setMinimumSize(360, 600);
      window?.setContentSize(390, 844);
    });
    await expect(
      page.getByRole('combobox', { name: 'Chat notifications', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath('notification-policy-phone.png') });
    await page
      .getByRole('combobox', { name: 'Chat notifications', exact: true })
      .selectOption('all');
    await openPanel(page, 'Chat');
    await expect(
      page.getByRole('button', { name: 'Unmute this conversation', exact: true }).last(),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Unmute this conversation', exact: true })
      .last()
      .click();
  } finally {
    await teardownApp(launched);
    await disposeUserData(profile);
    await radio.close();
  }
});
