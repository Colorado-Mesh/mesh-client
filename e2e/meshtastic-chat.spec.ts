import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, openPanel, teardownApp } from './electronApp';
import { startMeshtasticTcpRadio } from './fixtures/meshtastic-tcp-radio';

let launched: LaunchedApp | undefined;
let radio: Awaited<ReturnType<typeof startMeshtasticTcpRadio>> | undefined;

test.afterEach(async () => {
  const app = launched;
  const fakeRadio = radio;
  launched = undefined;
  radio = undefined;
  try {
    if (app) {
      app.retainUserData = false;
      await teardownApp(app);
    }
  } finally {
    if (fakeRadio) await fakeRadio.close();
  }
});

test('Meshtastic TCP fake companion: connect, send, echo receive', async () => {
  test.setTimeout(120_000);
  radio = await startMeshtasticTcpRadio();
  launched = await launchApp();
  const { page } = launched;

  await page.getByRole('radio', { name: 'Switch to Meshtastic' }).click();
  await openPanel(page, 'Device', 'Connection');
  await page.getByRole('radio', { name: 'WiFi/TCP (fast)', exact: true }).click();
  await page.locator('#connection-meshtastic-tcp-host').fill(radio.address);
  await page.locator('[data-setting-anchor="connection.radio.connect"]').click();

  await expect(page.getByRole('heading', { name: 'Radio Connection' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  expect(radio.lastWantConfigId).not.toBeNull();

  await openPanel(page, 'Chat');
  const composer = page.getByRole('textbox', { name: /message|compose|chat/i }).first();
  await expect(composer).toBeVisible({ timeout: 30_000 });
  const outbound = `e2e-mesh-${Date.now()}`;
  await composer.fill(outbound);
  await page.getByRole('button', { name: /^send$/i }).click();

  await expect
    .poll(() => radio!.outboundTexts.some((t) => t.includes(outbound)), { timeout: 45_000 })
    .toBe(true);

  // exact: the hidden new-message announcer also contains this text, prefixed with the sender.
  const echo = page.getByText(`echo:${outbound}`, { exact: true });
  await expect(echo).toBeVisible({ timeout: 20_000 });
});
