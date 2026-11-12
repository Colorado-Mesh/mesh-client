import { expect, type Page, test } from '@playwright/test';

import { launchApp, type LaunchedApp, openPanel, teardownApp } from './electronApp';
import {
  FAR_REPEATER_NAME,
  REPEATER_ADMIN_PASSWORD,
  type RepeaterRadioEvent,
  type RepeaterRadioOptions,
  startMeshcoreRepeaterRadio,
} from './fixtures/meshcore-repeater-radio';

type Radio = Awaited<ReturnType<typeof startMeshcoreRepeaterRadio>>;
type RequestKind = Extract<RepeaterRadioEvent['kind'], 'status' | 'binary'>;

/** The current test's radio; helpers read it. Teardown tracks its own copies below. */
let radio: Radio;
let appToClose: LaunchedApp | undefined;
let radioToClose: Radio | undefined;
test.afterEach(async () => {
  // Clear first: a later test whose setup throws must not tear these down a second time.
  const app = appToClose;
  const fixture = radioToClose;
  appToClose = undefined;
  radioToClose = undefined;
  if (app) await teardownApp(app);
  if (fixture) await fixture.close();
});

/** Start the radio in the given state, launch the app and open the Repeaters panel. */
async function start(
  configure: (fixture: Radio) => void,
  options?: RepeaterRadioOptions,
): Promise<Page> {
  radio = await startMeshcoreRepeaterRadio(undefined, options);
  radioToClose = radio;
  configure(radio);
  const launched = await launchApp();
  appToClose = launched;
  await connect(launched.page, radio.port);
  return launched.page;
}

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

/** Choose a row-menu request and answer the admin password dialog if it opens. */
async function startRequest(
  page: Page,
  menuItem: 'Request status' | 'Neighbors',
  dialogChoice: 'none' | 'admin',
) {
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
  await startRequest(page, menuItem, dialogChoice);
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
  const page = await start((fixture) => {
    fixture.setRepeaterClient({ admin: true, returnPath: 'good' });
  });

  expect(await request(page, 'Request status', 'status', 'none')).toEqual([
    'status:direct',
    'reply:direct:status',
  ]);
  await expectNoRowError(page, 'Request status');
});

test('status recovers a zero-hop route whose return path went stale', async () => {
  test.setTimeout(120_000);
  const page = await start((fixture) => {
    fixture.setRepeaterClient({ admin: true, returnPath: 'stale' });
  });

  // The direct request is heard but its reply is lost; one flood resend repairs the path.
  expect(await request(page, 'Request status', 'status', 'none')).toEqual([
    'status:direct',
    'lost:direct',
    'resetPath',
    'status:flood',
    'pathLearned',
    'reply:flood:status',
  ]);
  await expectNoRowError(page, 'Request status');
  expect(await request(page, 'Request status', 'status', 'none')).toEqual([
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
    const page = await start((fixture) => {
      fixture.setRepeaterClient(null);
    });

    const events = await request(page, scenario.menuItem, scenario.kind, 'admin');
    // First attempt carries no login and is dropped; the flood resend logs in first.
    expect(events.slice(0, 3)).toEqual([`${scenario.kind}:direct`, 'drop', 'resetPath']);
    expect(events.filter((line) => line.startsWith('login'))).toEqual(['login:flood']);
    expect(events.at(-1)).toBe(`reply:direct:${scenario.kind}`);
    await expectNoRowError(page, scenario.menuItem);
  });
}

for (const scenario of [
  // Plain length 0: a zero-hop route with 1-byte path hashes.
  { name: '1-byte', contactPathLen: 0, sent: 'pathLen=1 flags=0' },
  // Packed length 0x40: zero hops with 2-byte path hashes. Sent with flags 0 the two bytes
  // are read as two 1-byte hops and the trace never completes.
  { name: '2-byte', contactPathLen: 0x40, sent: 'pathLen=2 flags=1' },
] as const) {
  test(`ping reaches a zero-hop repeater stored with ${scenario.name} path hashes`, async () => {
    test.setTimeout(120_000);
    const page = await start((fixture) => {
      fixture.setRepeaterClient({ admin: true, returnPath: 'good' });
      fixture.setContactPathLen(scenario.contactPathLen);
    });

    await page.getByRole('button', { name: 'Ping trace' }).click();
    const traces = () => radio.events.filter((e) => e.kind === 'trace').map((e) => e.detail);
    await expect
      .poll(() => radio.events.some((e) => e.kind === 'reply' && e.detail === 'trace'), {
        timeout: 60_000,
        message: `ping was never answered; traces sent: ${traces().join(' | ')}`,
      })
      .toBe(true);
    // One trace, sized so firmware reads it as a single hop to the repeater.
    expect(traces()).toEqual([scenario.sent]);
  });
}

for (const scenario of [
  // relay, far, relay as three 1-byte entries; the leftover path buffer byte is not a hop.
  { name: 'one relay, 1-byte', relays: 1, hashSizeBytes: 1, sent: 'pathLen=3 flags=0' },
  { name: 'one relay, 2-byte', relays: 1, hashSizeBytes: 2, sent: 'pathLen=6 flags=1' },
  // 3-byte hashes go out as 2-byte entries: firmware trace entries are 1, 2, 4 or 8 bytes.
  { name: 'one relay, 3-byte', relays: 1, hashSizeBytes: 3, sent: 'pathLen=6 flags=1' },
  { name: 'two relays, 2-byte', relays: 2, hashSizeBytes: 2, sent: 'pathLen=10 flags=1' },
] as const) {
  test(`ping returns from a repeater behind ${scenario.name} path hashes`, async () => {
    test.setTimeout(120_000);
    const page = await start(
      (fixture) => {
        fixture.setRepeaterClient({ admin: true, returnPath: 'good' });
      },
      { farRepeater: { relays: scenario.relays, hashSizeBytes: scenario.hashSizeBytes } },
    );

    const farRow = page.getByRole('row').filter({ hasText: FAR_REPEATER_NAME });
    await farRow.getByRole('button', { name: 'Ping trace' }).click();
    const traces = () => radio.events.filter((e) => e.kind === 'trace').map((e) => e.detail);
    await expect
      .poll(() => radio.events.some((e) => e.kind === 'reply' && e.detail === 'trace'), {
        timeout: 60_000,
        message: `ping was never answered; traces sent: ${traces().join(' | ')}`,
      })
      .toBe(true);
    // One trace: out through the relays, the far repeater, and back through the relays.
    expect(traces()).toEqual([scenario.sent]);
  });
}

/**
 * Click the zero-hop repeater's Ping and wait for the radio to answer a trace. Returns the
 * traces sent and the traces that died on air.
 */
async function pingRepeater(page: Page, name: string = radio.repeaterName) {
  const before = radio.events.length;
  const row = page.getByRole('row').filter({ hasText: name });
  await row.getByRole('button', { name: 'Ping trace' }).click();
  const since = () => radio.events.slice(before);
  const traces = () => since().filter((e) => e.kind === 'trace');
  await expect
    .poll(() => since().some((e) => e.kind === 'reply' && e.detail === 'trace'), {
      timeout: 60_000,
      message: `ping was never answered; traces sent: ${traces()
        .map((e) => e.detail)
        .join(' | ')}`,
    })
    .toBe(true);
  // The app finished the ping: the row shows the SNR the fixture reports (40 / 4 = 10.0 dB)
  // and no ping error.
  await expect(row).toContainText('10.0');
  await expect(row).not.toContainText(/error|timed out|no route/i);
  return {
    sent: traces().map((e) => e.detail),
    lost: since().filter((e) => e.kind === 'lost' && e.detail?.startsWith('trace')),
  };
}

// Firmware keeps an older route's relay hashes in a contact's path buffer after the radio
// starts reaching it direct; only the length byte says where the route ends. These relays are
// not in range, so a trace sent through them dies on air.
for (const scenario of [
  // One leftover 1-byte hash: the row still shows zero hops.
  { name: 'one 1-byte relay hash', contactPathLen: 0, leftover: [0x9b], sent: 'pathLen=1 flags=0' },
  // Two leftover 1-byte hashes: the row reads them as one hop.
  {
    name: 'two 1-byte relay hashes',
    contactPathLen: 0,
    leftover: [0x9b, 0x4e],
    sent: 'pathLen=1 flags=0',
  },
  // A 2-byte relay hash under a packed zero-hop length (0x40): the row reads it as one hop.
  {
    name: 'one 2-byte relay hash',
    contactPathLen: 0x40,
    leftover: [0x9b, 0x4e],
    sent: 'pathLen=2 flags=1',
  },
  // The route was reset to unknown (0xFF), as a Status flood resend does, and not relearned.
  // The ping tries the repeater direct first, as one 8-byte entry only its key matches.
  {
    name: 'two 1-byte relay hashes after a route reset',
    contactPathLen: -1,
    leftover: [0x9b, 0x4e],
    sent: 'pathLen=8 flags=3',
  },
] as const) {
  test(`ping reaches a zero-hop repeater whose contact keeps ${scenario.name}`, async () => {
    test.setTimeout(120_000);
    const page = await start((fixture) => {
      fixture.setRepeaterClient({ admin: true, returnPath: 'good' });
      fixture.setContactPathLen(scenario.contactPathLen);
      fixture.setRepeaterLeftoverPath(scenario.leftover);
    });

    const { sent, lost } = await pingRepeater(page);
    // One trace straight to the repeater; nothing sent through the old relays.
    expect(lost).toEqual([]);
    expect(sent).toEqual([scenario.sent]);
  });
}

test('ping falls back to the route when a far repeater does not answer the direct try', async () => {
  test.setTimeout(120_000);
  const page = await start(
    (fixture) => {
      fixture.setRepeaterClient({ admin: true, returnPath: 'good' });
      // The radio forgot the far route; its buffer still holds the relay and one older byte.
      fixture.setFarRouteKnown(false);
    },
    { farRepeater: { relays: 1, hashSizeBytes: 1, staleTail: [0xee] } },
  );

  const { sent, lost } = await pingRepeater(page, FAR_REPEATER_NAME);
  // The 8-byte direct try dies on air; the ping then goes out and back through the relay.
  expect(sent).toEqual(['pathLen=8 flags=3', 'pathLen=3 flags=0']);
  expect(lost.map((e) => e.detail)).toEqual(['trace needs 1 hops of 8 byte(s)']);
});

test('ping reaches a zero-hop repeater after a status request reset its route', async () => {
  test.setTimeout(180_000);
  const page = await start((fixture) => {
    // The repeater does not know this companion, so status is dropped direct and by flood,
    // and the path is never relearned.
    fixture.setRepeaterClient(null);
    fixture.setRepeaterLeftoverPath([0x9b, 0x4e]);
  });

  const before = radio.events.length;
  await startRequest(page, 'Request status', 'none');
  await expect
    .poll(() => trace(radio.events.slice(before)), {
      timeout: 60_000,
      message: 'status never reset the route and flooded',
    })
    .toEqual(expect.arrayContaining(['resetPath', 'status:flood']));
  expect(radio.getContactPathLen()).toBe(-1);

  const { sent, lost } = await pingRepeater(page);
  expect(lost).toEqual([]);
  expect(sent).toEqual(['pathLen=8 flags=3']);
});
