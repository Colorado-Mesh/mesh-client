import { expect, type Locator, type Page, test } from '@playwright/test';

import { TAB_SLOT_IDS, type TabSlotId } from '../src/renderer/lib/tabSlotIds';
import {
  expectPanelSettled,
  launchApp,
  type LaunchedApp,
  navName,
  newPanelErrors,
  openSectionById,
  teardownApp,
} from './electronApp';
import { startMeshcoreRadio } from './fixtures/meshcore-radio';
import {
  assertPanelAnchorContractComplete,
  GENERIC_CONTENT_SLOTS,
  PANEL_CONTENT_ANCHORS,
} from './panelAnchors';

type Protocol = 'meshtastic' | 'meshcore' | 'reticulum';

interface MatrixTab {
  label: string;
  slot: TabSlotId;
}

interface MatrixSection {
  id: string;
  /** Empty = single-panel section rendered as a heading, no tablist. */
  tabs: MatrixTab[];
}

const EXPECTED_MATRIX: Record<Protocol, { radio: string; sections: MatrixSection[] }> = {
  meshtastic: {
    radio: 'Switch to Meshtastic',
    sections: [
      {
        id: 'chat',
        tabs: [
          { label: 'Chat', slot: 'Chat' },
          { label: 'Broadcasts', slot: 'ScheduledBroadcasts' },
        ],
      },
      {
        id: 'network',
        tabs: [
          { label: 'Nodes', slot: 'Nodes' },
          { label: 'Contact Cards', slot: 'TeamContacts' },
          { label: 'Team Roster', slot: 'TeamRoster' },
          { label: 'Graph', slot: 'Graph' },
          { label: 'TAK', slot: 'TAK' },
        ],
      },
      { id: 'map', tabs: [] },
      {
        id: 'monitor',
        tabs: [
          { label: 'Diagnostics', slot: 'Diagnostics' },
          { label: 'Stats', slot: 'Stats' },
          { label: 'Sniffer', slot: 'Sniffer' },
          { label: 'RF', slot: 'RF' },
        ],
      },
      {
        id: 'device',
        tabs: [
          { label: 'Connection', slot: 'Connection' },
          { label: 'Radio', slot: 'Radio' },
          { label: 'Modules', slot: 'Modules' },
          { label: 'Telemetry', slot: 'Telemetry' },
          { label: 'Administration', slot: 'Admin' },
          { label: 'Security', slot: 'Security' },
        ],
      },
      { id: 'incident', tabs: [] },
      { id: 'app', tabs: [] },
    ],
  },
  meshcore: {
    radio: 'Switch to MeshCore',
    sections: [
      {
        id: 'chat',
        tabs: [
          { label: 'Chat', slot: 'Chat' },
          { label: 'Rooms', slot: 'Rooms' },
          { label: 'Broadcasts', slot: 'ScheduledBroadcasts' },
        ],
      },
      {
        id: 'network',
        tabs: [
          { label: 'Contacts', slot: 'Nodes' },
          { label: 'Contact Cards', slot: 'TeamContacts' },
          { label: 'Team Roster', slot: 'TeamRoster' },
          { label: 'Repeaters', slot: 'Modules' },
          { label: 'Graph', slot: 'Graph' },
          { label: 'TAK', slot: 'TAK' },
        ],
      },
      { id: 'map', tabs: [] },
      {
        id: 'monitor',
        tabs: [
          { label: 'Diagnostics', slot: 'Diagnostics' },
          { label: 'Stats', slot: 'Stats' },
          { label: 'Sniffer', slot: 'Sniffer' },
          { label: 'RF', slot: 'RF' },
        ],
      },
      {
        id: 'device',
        tabs: [
          { label: 'Connection', slot: 'Connection' },
          { label: 'Radio', slot: 'Radio' },
          { label: 'Telemetry', slot: 'Telemetry' },
          { label: 'Administration', slot: 'Admin' },
          { label: 'Security', slot: 'Security' },
        ],
      },
      { id: 'incident', tabs: [] },
      { id: 'app', tabs: [] },
    ],
  },
  reticulum: {
    radio: 'Switch to Reticulum',
    sections: [
      {
        id: 'chat',
        tabs: [
          { label: 'Chat', slot: 'Chat' },
          { label: 'RRC', slot: 'RRC' },
          { label: 'Games', slot: 'Games' },
          { label: 'Broadcasts', slot: 'ScheduledBroadcasts' },
        ],
      },
      {
        id: 'network',
        tabs: [
          { label: 'Peers', slot: 'Nodes' },
          { label: 'Contact Cards', slot: 'TeamContacts' },
          { label: 'Team Roster', slot: 'TeamRoster' },
          { label: 'Network topology', slot: 'Topology' },
          { label: 'Remote', slot: 'Remote' },
          { label: 'TAK', slot: 'TAK' },
        ],
      },
      { id: 'map', tabs: [] },
      { id: 'nomad', tabs: [] },
      {
        id: 'monitor',
        tabs: [
          { label: 'Diagnostics', slot: 'Diagnostics' },
          { label: 'Stats', slot: 'Stats' },
          { label: 'Sniffer', slot: 'Sniffer' },
        ],
      },
      {
        id: 'device',
        tabs: [
          { label: 'Connection', slot: 'Connection' },
          { label: 'Network', slot: 'Radio' },
          { label: 'Administration', slot: 'Admin' },
        ],
      },
      { id: 'incident', tabs: [] },
      { id: 'app', tabs: [] },
    ],
  },
};

/** Single-panel sections label their panel from the section heading. */
const SINGLE_PANEL_SLOT: Record<string, TabSlotId> = {
  map: 'Map',
  nomad: 'NomadNetwork',
  incident: 'Incident',
  app: 'App',
};

/** Copy-proof minimum: an interactive/visual element or enough rendered text. */
const RICHNESS_SELECTOR = 'button, input, select, textarea, a[href], canvas, svg, table, li';

async function resolvePanel(page: Page, tab: Locator | null, label: string): Promise<Locator> {
  if (!tab) return page.getByRole('tabpanel', { name: navName(label) });
  const controls = await tab.getAttribute('aria-controls');
  if (!controls) throw new Error(`tab "${label}" has no aria-controls`);
  return page.locator(`#${controls}`);
}

async function assertPanel(
  launched: LaunchedApp,
  sectionId: string,
  slot: TabSlotId,
  label: string,
  panel: Locator,
): Promise<void> {
  await expect(panel).toBeVisible();
  await expectPanelSettled(panel);

  await expect(panel.locator('[data-error-boundary="default"]')).toHaveCount(0);

  const anchor = panel.locator(`[data-panel-anchor="${slot}"]`);
  await expect(anchor, `${sectionId}/${label} renders slot ${slot}`).toHaveCount(1);
  await expect(anchor).toBeVisible();

  const contentAnchor = PANEL_CONTENT_ANCHORS[slot];
  if (contentAnchor) {
    // App (and some settings panels) keep sections collapsed; assert attached, not visible.
    await expect(
      panel.locator(contentAnchor.selector).first(),
      `${sectionId}/${label}: ${contentAnchor.note}`,
    ).toBeAttached();
  }

  const rich = await panel.locator(RICHNESS_SELECTOR).count();
  const textLength = (await panel.innerText()).trim().length;
  // Empty states like Graph/RF ("No nodes observed yet") are short but still real UI.
  expect(rich > 0 || textLength >= 15, `${sectionId}/${label} renders content`).toBe(true);

  expect(launched.crashed).toBe(false);
}

async function walkProtocol(launched: LaunchedApp, protocol: Protocol): Promise<string[]> {
  const { page } = launched;
  const matrix = EXPECTED_MATRIX[protocol];
  const switcher = page.getByRole('radiogroup', { name: 'Protocol switcher' });
  await switcher.getByRole('radio', { name: matrix.radio }).click();
  await expect(switcher.getByRole('radio', { name: matrix.radio })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  const rail = page.getByRole('navigation', { name: 'Application panels' });
  const sectionIds = await rail
    .locator('[data-nav-section]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-nav-section') ?? ''));
  expect(sectionIds, `${protocol} rail sections`).toEqual(matrix.sections.map((s) => s.id));

  const visited: string[] = [];
  for (const section of matrix.sections) {
    await openSectionById(page, section.id);
    const header = page.getByRole('banner');
    const tabs = header.getByRole('tab');

    if (section.tabs.length === 0) {
      await expect(tabs).toHaveCount(0);
      const label = await header.locator('h2').innerText();
      const slot = SINGLE_PANEL_SLOT[section.id];
      if (!slot) throw new Error(`Unknown single-panel section ${section.id}`);
      const before = launched.rendererConsoleErrors.length;
      const panel = await resolvePanel(page, null, label);
      await assertPanel(launched, section.id, slot, label, panel);
      expect(newPanelErrors(launched, before), `${section.id}/${label} console`).toEqual([]);
      visited.push(`${section.id}/${slot}`);
      continue;
    }

    await expect(tabs).toHaveCount(section.tabs.length);
    for (const [index, tabDef] of section.tabs.entries()) {
      const tab = tabs.nth(index);
      await expect(tab).toHaveAccessibleName(navName(tabDef.label));
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');

      const before = launched.rendererConsoleErrors.length;
      const panel = await resolvePanel(page, tab, tabDef.label);
      await assertPanel(launched, section.id, tabDef.slot, tabDef.label, panel);
      expect(newPanelErrors(launched, before), `${section.id}/${tabDef.label} console`).toEqual([]);
      visited.push(`${section.id}/${tabDef.slot}`);
    }
  }
  return visited;
}

test.describe('panel matrix', () => {
  let launched: LaunchedApp | undefined;
  let radio: Awaited<ReturnType<typeof startMeshcoreRadio>> | undefined;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
    if (radio) await radio.close();
    launched = undefined;
    radio = undefined;
  });

  test('every tab slot has an anchor contract', () => {
    expect(() => {
      assertPanelAnchorContractComplete();
    }).not.toThrow();
    expect(GENERIC_CONTENT_SLOTS.length + Object.keys(PANEL_CONTENT_ANCHORS).length).toBe(
      TAB_SLOT_IDS.length,
    );
  });

  for (const protocol of ['meshtastic', 'meshcore', 'reticulum'] as const) {
    test(`every ${protocol} panel mounts`, async () => {
      test.setTimeout(180_000);
      launched = await launchApp();
      const pageErrors: string[] = [];
      launched.page.on('pageerror', (err) => pageErrors.push(String(err)));

      const visited = await walkProtocol(launched, protocol);
      expect(visited.length).toBe(
        EXPECTED_MATRIX[protocol].sections.reduce((n, s) => n + Math.max(s.tabs.length, 1), 0),
      );
      expect(pageErrors).toEqual([]);
      await test.info().attach(`panel-matrix-${protocol}.json`, {
        body: JSON.stringify({ protocol, visited }, null, 2),
        contentType: 'application/json',
      });
    });
  }

  test('every meshcore panel mounts with a connected radio', async () => {
    test.setTimeout(180_000);
    radio = await startMeshcoreRadio();
    launched = await launchApp();

    const { page } = launched;
    await page.getByRole('radio', { name: 'Switch to MeshCore' }).click();
    await openSectionById(page, 'device');
    await page.getByRole('tab', { name: navName('Connection') }).click();
    await page.getByRole('radio', { name: 'TCP/IP', exact: true }).click();
    await page.locator('#connection-meshcore-tcp-host').fill('127.0.0.1');
    await page.locator('#connection-meshcore-tcp-port').fill(String(radio.port));
    await page.locator('[data-setting-anchor="connection.radio.connect"]').click();
    await expect.poll(() => radio!.commands.length).toBeGreaterThan(0);

    await walkProtocol(launched, 'meshcore');

    await openSectionById(page, 'chat');
    await page
      .getByRole('banner')
      .getByRole('tab', { name: navName('Chat') })
      .click();
    await expect(page.getByRole('button', { name: 'Zulu', exact: true })).toBeVisible();
  });
});
