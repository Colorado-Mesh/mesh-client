/**
 * Meshtastic over TCP against real firmware: `meshtasticd` (Linux native Meshtastic) in
 * simulated-radio mode, e.g. `docker run -p 4403:4403 meshtastic/meshtasticd meshtasticd -s`.
 * The mobile app connects through the UI; bytes flow renderer → host worker (main's TCP bridge)
 * → net shim → MeshNet (web bridge) → meshtasticd, exactly like the native plugins.
 * Skipped when MESHTASTICD (host:port, default 127.0.0.1:4403) is not reachable.
 */
import net from 'node:net';

import { expect, type Page, test } from '@playwright/test';

import { bootApp, type Harness, startHarness, unexpectedErrors } from './harness';

const TARGET = process.env.MESHTASTICD ?? '127.0.0.1:4403';

function reachable(target: string): Promise<boolean> {
  const [host, port] = target.split(':');
  return new Promise((resolve) => {
    const s = net.connect({ host, port: Number(port) });
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

async function openPanel(page: Page, name: RegExp): Promise<void> {
  const more = page.getByRole('button', { name: /^More/ });
  if (await more.count()) {
    await more.first().click();
    await page.getByRole('dialog').getByRole('button', { name }).first().click();
  } else {
    await page
      .getByRole('button', { name: /^Device/ })
      .first()
      .click();
  }
}

let h: Harness;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  await h.close();
});

test('connects to meshtasticd over TCP, loads the node, and sends on the primary channel', async ({
  browser,
}) => {
  test.skip(!(await reachable(TARGET)), `meshtasticd not reachable at ${TARGET}`);
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const boot = await bootApp(page, h);

  await openPanel(page, /^Connection/);
  await page
    .getByRole('radio', { name: /WiFi\/TCP/ })
    .or(page.getByRole('button', { name: /WiFi\/TCP/ }))
    .first()
    .click();
  const address = page.getByRole('textbox', { name: /Device Address/i });
  await address.fill(TARGET);
  await page
    .getByRole('button', { name: /^Connect$/ })
    .first()
    .click();

  // Config handshake completes: the radio link reports connected and the node shows its name.
  await expect(page.getByRole('button', { name: /^Disconnect$/ }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/^Firmware$/).first()).toBeVisible();
  const ownNode = await page.evaluate(async () => {
    const nodes = (await window.electronAPI.db.getNodes()) as {
      long_name?: string;
      node_id?: number;
    }[];
    return nodes.map((n) => n.long_name ?? String(n.node_id));
  });
  expect(ownNode.length).toBeGreaterThan(0);

  // Send on the primary channel; the message is persisted to the mobile SQLite store.
  await page.getByRole('button', { name: /^Chat/ }).first().click();
  const text = `mobile e2e ${Date.now()}`;
  const composer = page.getByRole('textbox', { name: /message/i }).first();
  await composer.fill(text);
  await composer.press('Enter');
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(async (t) => {
          const rows = (await window.electronAPI.db.getMessages(undefined, 200)) as {
            payload?: string;
          }[];
          return rows.some((r) => r.payload === t);
        }, text),
      { timeout: 20_000 },
    )
    .toBe(true);

  await page.screenshot({ path: test.info().outputPath('meshtastic-tcp-chat.png') });
  expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
  await context.close();
});
