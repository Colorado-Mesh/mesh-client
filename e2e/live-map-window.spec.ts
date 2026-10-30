import { expect, type Page, test } from '@playwright/test';

import {
  filterUnexpectedConsoleErrors,
  launchApp,
  type LaunchedApp,
  openPanel,
  teardownApp,
} from './electronApp';
import { startMeshcoreRadio } from './fixtures/meshcore-radio';

let launched: LaunchedApp | undefined;
let radio: Awaited<ReturnType<typeof startMeshcoreRadio>> | undefined;
test.afterEach(async () => {
  if (launched) await teardownApp(launched);
  if (radio) await radio.close();
  launched = undefined;
  radio = undefined;
});

/** A flood ADVERT with a location and name, as a MeshCore radio hears it on air. */
function advertPacket(name: string, lat: number, lon: number): Buffer {
  const timestamp = Buffer.alloc(4);
  timestamp.writeUInt32LE(Math.floor(Date.now() / 1000));
  const location = Buffer.alloc(8);
  location.writeInt32LE(Math.round(lat * 1e6), 0);
  location.writeInt32LE(Math.round(lon * 1e6), 4);
  return Buffer.concat([
    Buffer.from([0x11, 0x00]), // flood route, ADVERT payload; no path hops
    Buffer.alloc(32, 0x5a), // public key
    timestamp,
    Buffer.alloc(64), // signature
    Buffer.from([0x92]), // repeater role, has location, has name
    location,
    Buffer.from(name),
  ]);
}

async function openPopOut(launchedApp: LaunchedApp): Promise<Page> {
  const opened = launchedApp.app.waitForEvent('window');
  await launchedApp.page.getByRole('button', { name: 'Open in new window' }).click();
  const popOut = await opened;
  await popOut.waitForLoadState('domcontentloaded');
  await expect(popOut.getByRole('heading', { name: 'MeshCore live traffic' })).toBeAttached();
  return popOut;
}

test('pops the MeshCore live map into its own window and back', async () => {
  test.setTimeout(120_000);
  radio = await startMeshcoreRadio();
  launched = await launchApp();
  const { page, app } = launched;

  await page.getByRole('radio', { name: 'Switch to MeshCore' }).click();
  await openPanel(page, 'Device', 'Connection');
  await page.getByRole('radio', { name: 'TCP/IP', exact: true }).click();
  await page.locator('#connection-meshcore-tcp-host').fill('127.0.0.1');
  await page.locator('#connection-meshcore-tcp-port').fill(String(radio.port));
  await page.locator('[data-setting-anchor="connection.radio.connect"]').click();
  await openPanel(page, 'Chat');
  await expect(page.getByRole('button', { name: 'Zulu', exact: true })).toBeVisible();

  await openPanel(page, 'Map');
  await page.getByRole('button', { name: 'Live traffic', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  const popOut = await openPopOut(launched);
  const popOutErrors: string[] = [];
  popOut.on('pageerror', (error) => popOutErrors.push(String(error)));
  popOut.on('console', (message) => {
    if (message.type() === 'error') popOutErrors.push(message.text());
  });
  expect(new URL(popOut.url()).pathname).toMatch(/\/live-map\.html$/);
  expect(new URL(popOut.url()).searchParams.get('protocol')).toBe('meshcore');
  await expect(popOut).toHaveTitle('MeshCore live traffic');
  await expect(page.getByText('Live traffic is open in another window')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeHidden();

  // Packets the radio hears in the main window reach the pop-out.
  radio.pushRxLog(advertPacket('E2E Repeater', 39.7392, -104.9903));
  await expect(popOut.getByText('1 packet', { exact: true })).toBeVisible();
  await popOut.getByRole('button', { name: 'Expand or collapse packet feed' }).click();
  await expect(
    popOut.getByRole('list', { name: 'Recent packet observations' }).getByText('ADVERT'),
  ).toBeVisible();

  const keepOnTop = popOut.getByRole('button', { name: 'Keep on top' });
  await keepOnTop.click();
  await expect(keepOnTop).toHaveAttribute('aria-pressed', 'true');
  const onTop = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => window.isAlwaysOnTop()),
  );
  expect(onTop).toContain(true);
  await keepOnTop.click();
  await expect(keepOnTop).toHaveAttribute('aria-pressed', 'false');

  const closed = popOut.waitForEvent('close');
  await popOut.getByRole('button', { name: 'Return to main window' }).click();
  await closed;
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(page.getByText('Live traffic is open in another window')).toBeHidden();

  // Closing the window itself also brings the map back.
  const second = await openPopOut(launched);
  await expect(page.getByText('Live traffic is open in another window')).toBeVisible();
  await second.close();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

  const unexpected = filterUnexpectedConsoleErrors([
    ...launched.rendererConsoleErrors,
    ...popOutErrors,
  ]);
  expect(unexpected, `unexpected console.error: ${unexpected.join(' | ')}`).toEqual([]);
});
