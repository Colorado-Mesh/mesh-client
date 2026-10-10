import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  computeTabMappings,
  findFilteredTabIndexForPanel,
  RADIO_TAB_PANEL_INDEX,
  TAB_CAPABILITY_REQUIREMENTS,
} from './appTabMappings';
import { MESHCORE_CAPABILITIES, MESHTASTIC_CAPABILITIES } from './radio/BaseRadioProvider';
import { TAB_SLOT_IDS } from './tabSlotIds';

const identityT = ((key: string) => key) as TFunction;

describe('computeTabMappings', () => {
  it('keeps TAB_CAPABILITY_REQUIREMENTS parallel to TAB_SLOT_IDS', () => {
    expect(TAB_CAPABILITY_REQUIREMENTS).toHaveLength(TAB_SLOT_IDS.length);
  });

  it('shows Meshtastic sidebar panels including Radio, Map, and Modules', () => {
    const tabs = computeTabMappings(identityT, 'meshtastic', MESHTASTIC_CAPABILITIES);
    const expectedSlots: (typeof TAB_SLOT_IDS)[number][] = [
      'Connection',
      'Chat',
      'Nodes',
      'Map',
      'Radio',
      'Modules',
      'Admin',
      'Telemetry',
      'Security',
      'TAK',
      'App',
      'Diagnostics',
      'Stats',
      'Sniffer',
      'RF',
      'Graph',
    ];
    for (const slot of expectedSlots) {
      expect(tabs.tabIndexToPanelIndex).toContain(TAB_SLOT_IDS.indexOf(slot));
    }
  });

  it('shows MeshCore sidebar panels including Radio, Map, and Repeaters', () => {
    const tabs = computeTabMappings(identityT, 'meshcore', MESHCORE_CAPABILITIES);
    const radioTabIndex = findFilteredTabIndexForPanel(tabs, RADIO_TAB_PANEL_INDEX);
    expect(radioTabIndex).toBeGreaterThanOrEqual(0);
    expect(tabs.displayTabLabels[radioTabIndex]).toBe('tabs.radio');

    const expectedSlots: (typeof TAB_SLOT_IDS)[number][] = [
      'Connection',
      'Chat',
      'Nodes',
      'Map',
      'Radio',
      'Modules',
      'Admin',
      'Rooms',
      'Telemetry',
      'Security',
      'TAK',
      'App',
      'Diagnostics',
      'Stats',
      'Sniffer',
      'RF',
      'Graph',
    ];
    for (const slot of expectedSlots) {
      expect(tabs.tabIndexToPanelIndex).toContain(TAB_SLOT_IDS.indexOf(slot));
    }
    expect(
      tabs.displayTabLabels[tabs.tabIndexToPanelIndex.indexOf(TAB_SLOT_IDS.indexOf('Modules'))],
    ).toBe('tabs.repeaters');
  });
});
