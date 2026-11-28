/**
 * MeshCom over EXTUDP (UDP 1799) against a node stand-in (`fixtures/meshcom-extudp-node.mjs`):
 * enable MeshCom (amateur-radio notice), switch protocol, connect to the node's address, receive a
 * broadcast chat line (shown in Chat) and send one (the stand-in prints the JSON the app sent).
 * No RF and no firmware: a synthetic test of the mobile UDP path (renderer → host worker's
 * udp-bridge → dgram shim → MeshNet → node). Both ends need port 1799, so the harness binds the
 * app's socket to 127.0.0.1 and the node binds 127.0.0.2.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { bootApp, type Harness, startHarness, unexpectedErrors } from './harness';

const APP_ADDRESS = '127.0.0.1';
const NODE_ADDRESS = '127.0.0.2';
const FIXTURE = path.resolve(import.meta.dirname, 'fixtures/meshcom-extudp-node.mjs');

let h: Harness;
let node: ChildProcess | null = null;
let nodeOutput = '';

test.beforeAll(async () => {
  h = await startHarness({ udpBindAddress: APP_ADDRESS });
});

test.afterAll(async () => {
  node?.kill();
  await h.close();
});

async function fromMore(page: Page, name: RegExp): Promise<void> {
  await page.locator('[data-nav-section="more"]').click();
  await page.getByRole('dialog').getByRole('button', { name }).first().click();
}

test('connects to a MeshCom node over EXTUDP, receives and sends', async ({ browser }) => {
  test.setTimeout(150_000);
  const inbound = `mobile meshcom inbound ${Date.now()}`;
  node = spawn(process.execPath, [FIXTURE, NODE_ADDRESS, APP_ADDRESS, inbound, 'OE1MOB-1']);
  node.stdout?.on('data', (chunk: Buffer) => {
    nodeOutput += chunk.toString('utf8');
  });
  await expect.poll(() => nodeOutput.includes('"ready":true')).toBe(true);

  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const boot = await bootApp(page, h);

  // Enable MeshCom (App panel) and acknowledge the amateur-radio notice.
  await fromMore(page, /^App/);
  // Settings sections are native <details>; open Protocols by its <summary>.
  await page
    .locator('summary', { hasText: /^Protocols/ })
    .first()
    .click();
  // The first click opens the amateur-radio notice instead of ticking the box.
  await page.getByRole('checkbox', { name: 'Enable MeshCom' }).click();
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByRole('checkbox', { name: 'Enable MeshCom' })).toBeChecked();

  await page.locator('[data-nav-section="more"]').click();
  await page.getByRole('radio', { name: 'Switch to MeshCom' }).click();
  await page.keyboard.press('Escape');

  await fromMore(page, /^Connection/);
  await page
    .getByRole('radio', { name: /EXTUDP/ })
    .first()
    .click();
  await page.locator('#connection-meshcom-host').fill(NODE_ADDRESS);
  await page.locator('[data-setting-anchor="connection.radio.connect"]').click();
  await expect(page.getByRole('button', { name: /^Disconnect$/ }).first()).toBeVisible({
    timeout: 30_000,
  });

  // The node's broadcast line arrives in Chat. (MeshCom rows are keyed by an internal identity id
  // the page does not expose; storage is covered by the Meshtastic and MeshCore specs, which go
  // through the same SQLite layer.)
  await page.getByRole('button', { name: /^Chat/ }).first().click();
  await expect(page.getByText(inbound).first()).toBeVisible({ timeout: 30_000 });

  // Sending goes to the node as an EXTUDP msg.
  const outgoing = `mobile meshcom outbound ${Date.now()}`;
  const composer = page.getByRole('textbox', { name: /message/i }).first();
  await composer.fill(outgoing);
  await composer.press('Enter');
  await expect.poll(() => nodeOutput.includes(outgoing), { timeout: 20_000 }).toBe(true);

  await page.screenshot({ path: test.info().outputPath('meshcom-extudp.png') });
  expect(unexpectedErrors(boot.pageErrors)).toEqual([]);
  await context.close();
});
