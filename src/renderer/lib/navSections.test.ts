import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { computeTabMappings } from './appTabMappings';
import {
  computeNavSections,
  findNavSectionForTab,
  findTabIndexForSlot,
  NAV_SECTION_ORDER,
  navSectionForSlot,
} from './navSections';
import { MESHCORE_CAPABILITIES, MESHTASTIC_CAPABILITIES } from './radio/BaseRadioProvider';
import { TAB_SLOT_IDS } from './tabSlotIds';

const identityT = ((key: string) => key) as TFunction;

const PROTOCOLS = [
  ['meshtastic', MESHTASTIC_CAPABILITIES],
  ['meshcore', MESHCORE_CAPABILITIES],
] as const;

function slotsBySection(protocol: (typeof PROTOCOLS)[number]) {
  const [name, caps] = protocol;
  const sections = computeNavSections(computeTabMappings(identityT, name, caps), caps);
  return Object.fromEntries(sections.map((s) => [s.id, s.tabs.map((tab) => tab.slot)]));
}

describe('navSectionForSlot', () => {
  it('assigns every tab slot to a section', () => {
    for (const slot of TAB_SLOT_IDS) {
      expect(NAV_SECTION_ORDER).toContain(
        navSectionForSlot(slot, { modulesTabUsesRepeatersLabel: false }),
      );
    }
  });

  it('puts MeshCore Repeaters under Network and Meshtastic Modules under Device', () => {
    expect(navSectionForSlot('Modules', { modulesTabUsesRepeatersLabel: true })).toBe('network');
    expect(navSectionForSlot('Modules', { modulesTabUsesRepeatersLabel: false })).toBe('device');
  });
});

describe('computeNavSections', () => {
  it.each(PROTOCOLS)('keeps every visible %s tab reachable exactly once', (name, caps) => {
    const mappings = computeTabMappings(identityT, name, caps);
    const sections = computeNavSections(mappings, caps);
    const tabIndexes = sections
      .flatMap((s) => s.tabs.map((tab) => tab.tabIndex))
      .sort((a, b) => a - b);
    expect(tabIndexes).toEqual(mappings.displayTabLabels.map((_, i) => i));
  });

  it.each(PROTOCOLS)('keeps rail order and drops empty sections for %s', (name, caps) => {
    const sections = computeNavSections(computeTabMappings(identityT, name, caps), caps);
    const ids = sections.map((s) => s.id);
    expect(ids).toEqual(NAV_SECTION_ORDER.filter((id) => ids.includes(id)));
    expect(sections.every((s) => s.tabs.length > 0)).toBe(true);
    expect(ids.slice(-2)).toEqual(['incident', 'app']);
  });

  it('groups MeshCore tabs as in the Option B mockups, with the maintainer moves', () => {
    // Telemetry sits with the device it reports on; TAK is a network bridge, not a device.
    expect(slotsBySection(PROTOCOLS[1])).toEqual({
      chat: ['Chat', 'Rooms'],
      network: ['Nodes', 'Modules', 'Graph', 'TAK'],
      map: ['Map'],
      monitor: ['Diagnostics', 'Stats', 'Sniffer', 'RF'],
      device: ['Connection', 'Radio', 'Telemetry', 'Admin', 'Security'],
      incident: ['Incident'],
      app: ['App'],
    });
  });

  it('keeps Meshtastic Modules in Device', () => {
    const sections = slotsBySection(PROTOCOLS[0]);
    expect(sections.device).toContain('Modules');
    expect(sections.network).not.toContain('Modules');
  });

  it('carries translated labels and icon aliases', () => {
    const caps = MESHCORE_CAPABILITIES;
    const sections = computeNavSections(computeTabMappings(identityT, 'meshcore', caps), caps);
    const network = sections.find((s) => s.id === 'network');
    expect(network?.tabs.map((tab) => tab.label)).toEqual([
      'tabs.contacts',
      'tabs.repeaters',
      'tabs.graph',
      'tabs.tak',
    ]);
    expect(network?.tabs[1]?.iconSlot).toBe('Repeaters');
  });
});

describe('section lookups', () => {
  const caps = MESHCORE_CAPABILITIES;
  const mappings = computeTabMappings(identityT, 'meshcore', caps);
  const sections = computeNavSections(mappings, caps);

  it('finds the section that owns a tab', () => {
    const graphTab = findTabIndexForSlot(mappings, 'Graph');
    expect(graphTab).toBeGreaterThanOrEqual(0);
    expect(findNavSectionForTab(sections, graphTab)?.id).toBe('network');
    expect(findNavSectionForTab(sections, 999)).toBeUndefined();
  });
});
