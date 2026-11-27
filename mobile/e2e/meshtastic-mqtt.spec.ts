/**
 * Meshtastic over MQTT against a real broker (Eclipse Mosquitto, anonymous, e.g.
 * `docker run -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf`). The app is
 * configured through the Connection panel's MQTT form, connects (renderer → host worker's
 * mqtt-manager → net shim → MeshNet → broker), and a firmware-style JSON text message published to
 * the channel topic shows up in Chat and in the mobile SQLite database.
 * Skipped when MQTT_BROKER (host:port, default 127.0.0.1:1883) is unreachable, unless required.
 */
import net from 'node:net';

import { expect, test } from '@playwright/test';
import mqtt from 'mqtt';

import { bootApp, type Harness, requireService, startHarness, unexpectedErrors } from './harness';

const [HOST, PORT] = (process.env.MQTT_BROKER ?? '127.0.0.1:1883').split(':');

function reachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: HOST, port: Number(PORT) });
    s.setTimeout(2000);
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => {
      resolve(false);
    });
    s.once('timeout', () => {
      s.destroy();
      resolve(false);
    });
  });
}

let h: Harness;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  await h.close();
});

test('connects to an MQTT broker and receives a channel message', async ({ browser }) => {
  test.setTimeout(120_000);
  requireService('mqtt', await reachable(), `MQTT broker not reachable at ${HOST}:${PORT}`);
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const boot = await bootApp(page, h);

  await page.locator('[data-nav-section="more"]').click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Connection/ })
    .first()
    .click();
  await page.locator('#conn-meshtastic-network-preset-select').selectOption('custom');
  await page.locator('#mqtt-server').fill(HOST);
  await page.locator('#mqtt-port').fill(PORT);
  for (const id of ['#mqtt-tls-enabled', '#mqtt-websocket']) {
    const box = page.locator(id);
    if (await box.isChecked()) await box.uncheck();
  }
  await page.locator('#mqtt-username').fill('');
  await page.locator('#mqtt-password').fill('');
  await page.locator('#mqtt-topic-prefix').fill('msh/US/');
  await page.locator('[data-setting-anchor="connection.mqtt.connect"]').click();
  await expect(page.locator('[data-setting-anchor="connection.mqtt.disconnect"]')).toBeVisible({
    timeout: 30_000,
  });

  // A gateway publishes a firmware-style JSON text message on the default channel.
  const text = `mobile mqtt ${Date.now()}`;
  const client = await mqtt.connectAsync(`mqtt://${HOST}:${PORT}`);
  await client.publishAsync(
    'msh/US/2/json/LongFast/!7e57a1b2',
    JSON.stringify({ type: 'text', from: 2119672242, channel: 0, payload: { text } }),
  );
  await client.endAsync();

  await expect
    .poll(
      async () =>
        page.evaluate(async (t) => {
          const rows = (await window.electronAPI.db.getMessages(undefined, 200)) as {
            payload?: string;
          }[];
          return rows.some((r) => r.payload === t);
        }, text),
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.getByRole('button', { name: /^Chat/ }).first().click();
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });

  await page.screenshot({ path: test.info().outputPath('meshtastic-mqtt.png') });
  expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
  await context.close();
});
