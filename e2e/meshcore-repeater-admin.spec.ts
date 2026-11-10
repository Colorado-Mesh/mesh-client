import { expect, type Page, test } from '@playwright/test';

import { launchApp, type LaunchedApp, openPanel, teardownApp } from './electronApp';
import {
  REPEATER_ADMIN_PASSWORD,
  type RepeaterRadioEvent,
  startMeshcoreRepeaterRadio,
} from './fixtures/meshcore-repeater-radio';

type Radio = Awaited<ReturnType<typeof startMeshcoreRepeaterRadio>>;
type RequestKind = Extract<RepeaterRadioEvent['kind'], 'status' | 'binary'>;

let launched: LaunchedApp;
let radio: Radio;
test.afterEach(async () => {
  if (launched) await teardownApp(launched);
  if (radio) await radio.close();
});

/** One line per radio event, e.g. `status:direct` or `reply:flood:status`. */
const trace = (events: RepeaterRadioEvent[]) =>
  events.map((e) =>
    [e.kind, e.route, e.kind === 'reply' ? e.detail : undefined].filter(Boolean).join(':'),
  );

async function connect(page: Page, port: number) {
  await page.getByRole('radio', { name: 'Switch to MeshCore' }).click();
  await openPanel(page, 'Device', 'Connection');
  await page.getByRole('radio', { name: 'TCP/IP', exact: true }).click();
  await page.locator('#connection-meshcore-tcp-host').fill('127.0.0.1');
  await page.locator('#connection-meshcore-tcp-port').fill(String(port));
  await page.locator('[data-setting-anchor="connection.radio.connect"]').click();
  await openPanel(page, 'Network', 'Repeaters');
  await page.getByRole('button', { name: `More actions for ${radio.repeaterName}` }).waitFor();
}

/**
 * Choose a row-menu request, answer the admin password dialog if it opens, and wait for the
 * repeater's reply to reach the app. Returns the radio events the request produced.
 */
async function request(
  page: Page,
  menuItem: 'Request status' | 'Neighbors',
  kind: RequestKind,
  dialogChoice: 'none' | 'admin',
) {
  const before = radio.events.length;
  await page.getByRole('button', { name: `More actions for ${radio.repeaterName}` }).click();
  await page.getByRole('menuitem', { name: menuItem }).click();
  const dialog = page.getByRole('dialog', { name: 'Admin password' });
  const prompted = await dialog
    .waitFor({ timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  if (prompted) {
    if (dialogChoice === 'admin') {
      await dialog.locator('input[type="password"]').fill(REPEATER_ADMIN_PASSWORD);
      await dialog.getByRole('button', { name: 'Continue' }).click();
    } else {
      await dialog.getByRole('button', { name: 'No password' }).click();
    }
  }
  await expect
    .poll(() => trace(radio.events.slice(before)).some((line) => line.endsWith(`:${kind}`)), {
      timeout: 45_000,
      message: `${menuItem} was never answered: ${trace(radio.events.slice(before)).join(', ')}`,
    })
    .toBe(true);
  return trace(radio.events.slice(before));
}

async function expectNoRowError(page: Page, menuItem: 'Request status' | 'Neighbors') {
  await page.getByRole('button', { name: `More actions for ${radio.repeaterName}` }).click();
  await expect(page.getByRole('menuitem', { name: menuItem })).not.toContainText(/error/i);
  await page.keyboard.press('Escape');
}

test('status on a repeater that knows this companion sends no login and no flood', async () => {
  radio = await startMeshcoreRepeaterRadio();
  radio.setRepeaterClient({ admin: true, returnPath: 'good' });
  launched = await launchApp();
  await connect(launched.page, radio.port);

  expect(await request(launched.page, 'Request status', 'status', 'none')).toEqual([
    'status:direct',
    'reply:direct:status',
  ]);
  await expectNoRowError(launched.page, 'Request status');
});

test('status recovers a zero-hop route whose return path went stale', async () => {
  test.setTimeout(120_000);
  radio = await startMeshcoreRepeaterRadio();
  radio.setRepeaterClient({ admin: true, returnPath: 'stale' });
  launched = await launchApp();
  await connect(launched.page, radio.port);

  // The direct request is heard but its reply is lost; one flood resend repairs the path.
  expect(await request(launched.page, 'Request status', 'status', 'none')).toEqual([
    'status:direct',
    'lost:direct',
    'resetPath',
    'status:flood',
    'pathLearned',
    'reply:flood:status',
  ]);
  await expectNoRowError(launched.page, 'Request status');
  expect(await request(launched.page, 'Request status', 'status', 'none')).toEqual([
    'status:direct',
    'reply:direct:status',
  ]);
});

for (const scenario of [
  { name: 'status', menuItem: 'Request status', kind: 'status' },
  { name: 'neighbors', menuItem: 'Neighbors', kind: 'binary' },
] as const) {
  test(`${scenario.name} logs in once when the repeater does not know this companion`, async () => {
    test.setTimeout(120_000);
    radio = await startMeshcoreRepeaterRadio();
    radio.setRepeaterClient(null);
    launched = await launchApp();
    await connect(launched.page, radio.port);

    const events = await request(launched.page, scenario.menuItem, scenario.kind, 'admin');
    // First attempt carries no login and is dropped; the flood resend logs in first.
    expect(events.slice(0, 3)).toEqual([`${scenario.kind}:direct`, 'drop', 'resetPath']);
    expect(events.filter((line) => line.startsWith('login'))).toEqual(['login:flood']);
    expect(events.at(-1)).toBe(`reply:direct:${scenario.kind}`);
    await expectNoRowError(launched.page, scenario.menuItem);
  });
}
