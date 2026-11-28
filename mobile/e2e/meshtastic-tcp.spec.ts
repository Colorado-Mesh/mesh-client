/**
 * Meshtastic over TCP against real firmware: `meshtasticd` (Linux native Meshtastic) in
 * simulated-radio mode, e.g. `docker run -p 4403:4403 meshtastic/meshtasticd meshtasticd -s`.
 * The mobile app connects through the UI; bytes flow renderer → host worker (main's TCP bridge)
 * → net shim → MeshNet (web bridge) → meshtasticd, exactly like the native plugins.
 * Skipped when MESHTASTICD (host:port, default 127.0.0.1:4403) is not reachable.
 */
import net from 'node:net';

import { expect, type Page, test } from '@playwright/test';

import { bootApp, type Harness, requireService, startHarness, unexpectedErrors } from './harness';

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
  requireService('meshtasticd', await reachable(TARGET), `meshtasticd not reachable at ${TARGET}`);
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
  // Phone widths show Send as its icon only (mobileShell.css); the button keeps its name.
  const send = page.getByRole('button', { name: 'Send', exact: true });
  const sendShape = await send.evaluate((b) => ({
    icon: b.querySelector('svg') !== null,
    labelSize: getComputedStyle(b).fontSize,
    width: b.getBoundingClientRect().width,
  }));
  expect(sendShape).toEqual({ icon: true, labelSize: '0px', width: expect.any(Number) });
  expect(sendShape.width).toBeLessThan(64);
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

  // Touch screens (viewport/touchMessageActions.ts): the hover-only message actions take no width
  // and no taps until the message is tapped; then each is on screen, hit-testable and touch-sized.
  const row = page.locator('[class~="group/msg"]').filter({ hasText: text }).last();
  const measure = () =>
    row.evaluate((r) => {
      const bar = r.querySelector('.message-actions-bar');
      if (!bar) return null;
      const buttons = [...bar.querySelectorAll('button')];
      const boxes = buttons.map((b) => b.getBoundingClientRect());
      const hits = buttons.filter((b, i) => {
        const x = boxes[i];
        const el = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2);
        return el?.closest('button') === b;
      }).length;
      return {
        touch: window.matchMedia('(hover: none)').matches,
        barWidth: bar.getBoundingClientRect().width,
        count: buttons.length,
        hits,
        minSide: Math.min(...boxes.map((x) => Math.min(x.width, x.height))),
        onScreen: boxes.every((x) => x.left >= 0 && x.right <= window.innerWidth),
      };
    });
  const closed = await measure();
  expect(closed).not.toBeNull();
  expect(closed?.touch).toBe(true);
  expect(closed?.barWidth).toBeLessThanOrEqual(1);
  expect(closed?.hits).toBe(0);
  await row.getByText(text, { exact: true }).tap();
  await expect(row).toHaveAttribute('data-mobile-actions-open', '');
  const opened = await measure();
  expect(opened?.count).toBeGreaterThanOrEqual(5);
  expect(opened?.hits).toBe(opened?.count);
  expect(opened?.minSide).toBeGreaterThanOrEqual(44);
  expect(opened?.onScreen).toBe(true);
  await page.screenshot({ path: test.info().outputPath('meshtastic-tcp-actions-open.png') });
  await row.getByText(text, { exact: true }).tap();
  await expect(row).not.toHaveAttribute('data-mobile-actions-open');

  // Keyboard and screen reader focus still reveal the closed actions: the hidden rule ends at
  // :focus-within (display: none would have made them unfocusable).
  await row.locator('.message-actions-bar button').first().focus();
  const focusState = () =>
    row.evaluate((r) => {
      const bar = r.querySelector('.message-actions-bar');
      const first = bar?.querySelector('button');
      if (!bar || !first) return null;
      const box = first.getBoundingClientRect();
      const el = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        active: document.activeElement === first,
        wide: bar.getBoundingClientRect().width > 1,
        opacity: Number(getComputedStyle(bar).opacity),
        hit: el?.closest('button') === first,
      };
    });
  await expect
    .poll(focusState, { timeout: 5_000 })
    .toEqual({ active: true, wide: true, opacity: 1, hit: true });
  await expect(row).not.toHaveAttribute('data-mobile-actions-open');
  await row.locator('.message-actions-bar button').first().blur();

  await page.screenshot({ path: test.info().outputPath('meshtastic-tcp-chat.png') });
  expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
  await context.close();
});
