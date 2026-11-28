/**
 * MeshCore over TCP against the desktop's companion-protocol radio fixture
 * (`e2e/fixtures/meshcore-radio.ts`: app start, device query, contacts, channels, messages).
 * The mobile app connects through the UI; bytes flow renderer (meshcore.js) → host worker (main's
 * TCP bridge) → net shim → MeshNet (web bridge) → fixture, exactly like the native plugins.
 */
import { expect, type Page, test } from '@playwright/test';

import { startMeshcoreRadio } from '../../e2e/fixtures/meshcore-radio';
import { bootApp, type Harness, startHarness, unexpectedErrors } from './harness';

/** MeshCore companion command: send a channel text message. */
const CMD_SEND_CHANNEL_TXT_MSG = 3;

let h: Harness;
let radio: Awaited<ReturnType<typeof startMeshcoreRadio>>;

test.beforeAll(async () => {
  h = await startHarness();
  radio = await startMeshcoreRadio();
});

test.afterAll(async () => {
  await radio.close();
  await h.close();
});

async function fromLauncher(page: Page, name: RegExp): Promise<void> {
  await page.locator('[data-nav-section="more"]').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name }).first().click();
}

test('connects to a MeshCore companion over TCP, loads channels, receives and sends', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const boot = await bootApp(page, h);

  // Protocol switcher lives in the More sheet on phones.
  await page.locator('[data-nav-section="more"]').click();
  await page.getByRole('radio', { name: 'Switch to MeshCore' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await fromLauncher(page, /^Connection/);
  await page.getByRole('radio', { name: 'TCP/IP', exact: true }).click();
  await page.locator('#connection-meshcore-tcp-host').fill('127.0.0.1');
  await page.locator('#connection-meshcore-tcp-port').fill(String(radio.port));
  await page.locator('[data-setting-anchor="connection.radio.connect"]').click();
  await expect(page.getByRole('button', { name: /^Disconnect$/ }).first()).toBeVisible({
    timeout: 60_000,
  });
  // The companion handshake ran: app start, device query, channel reads.
  await expect.poll(() => radio.commands.includes(1) && radio.commands.includes(22)).toBe(true);
  await expect.poll(() => radio.commands.filter((c) => c === 31).length).toBeGreaterThan(0);

  await page.getByRole('button', { name: /^Chat/ }).first().click();
  await expect(page.getByText('Zulu').first()).toBeVisible({ timeout: 30_000 });

  // A channel message from the mesh shows up and is stored in the mobile SQLite database.
  const incoming = `Ridge: mobile inbound ${Date.now()}`;
  radio.receiveChannel(0, incoming);
  const body = incoming.slice('Ridge: '.length);
  await expect(page.getByText(body).first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(async (text) => {
          const rows = (await window.electronAPI.db.getMeshcoreMessages(undefined, 200)) as {
            payload?: string;
          }[];
          return rows.some((r) => r.payload?.includes(text));
        }, body),
      { timeout: 20_000 },
    )
    .toBe(true);

  // Sending goes out as a channel text message command.
  const outgoing = `mobile outbound ${Date.now()}`;
  const composer = page.getByRole('textbox', { name: /message/i }).first();
  await composer.fill(outgoing);
  await composer.press('Enter');
  await expect(page.getByText(outgoing).first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => radio.commands.includes(CMD_SEND_CHANNEL_TXT_MSG)).toBe(true);

  await page.screenshot({ path: test.info().outputPath('meshcore-tcp-chat.png') });
  expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
  await context.close();
});
