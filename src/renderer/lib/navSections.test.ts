import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { computeTabMappings } from './appTabMappings';
import {
  computeNavSections,
  findNavSectionForTab,
  findTabIndexForSlot,
  NAV_SECTION_ORDER,
  navSectionForSlot,
  resolveSectionTargetTab,
} from './navSections';
import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from './radio/BaseRadioProvider';
import { TAB_SLOT_IDS } from './tabSlotIds';

const identityT = ((key: string) => key) as TFunction;

const PROTOCOLS = [
  ['meshtastic', MESHTASTIC_CAPABILITIES],
  ['meshcore', MESHCORE_CAPABILITIES],
  ['reticulum', RETICULUM_CAPABILITIES],
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

  it('groups MeshCore tabs as in the Option B mockups', () => {
    expect(slotsBySection(PROTOCOLS[1])).toEqual({
      chat: ['Chat', 'Rooms'],
      network: ['Nodes', 'Modules', 'Graph'],
      map: ['Map'],
      monitor: ['Diagnostics', 'Telemetry', 'Stats', 'Sniffer', 'RF'],
      device: ['Connection', 'Radio', 'Admin', 'Security', 'TAK'],
      incident: ['Incident'],
      app: ['App'],
    });
  });

  it('places Reticulum-only panels in Chat and Network', () => {
    const sections = slotsBySection(PROTOCOLS[2]);
    expect(sections.chat).toEqual(expect.arrayContaining(['Chat', 'RRC', 'Games']));
    expect(sections.network).toEqual(
      expect.arrayContaining(['Nodes', 'Topology', 'NomadNetwork', 'Remote']),
    );
    expect(sections.device).toContain('Radio');
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

  it('returns -1 for slots hidden on the protocol', () => {
    expect(findTabIndexForSlot(mappings, 'RRC')).toBe(-1);
  });

  it('reopens the last panel shown in a section, else the first tab', () => {
    const monitor = sections.find((s) => s.id === 'monitor');
    if (!monitor) throw new Error('monitor section missing');
    const sniffer = monitor.tabs.find((tab) => tab.slot === 'Sniffer');
    expect(resolveSectionTargetTab(monitor, sniffer?.panelIndex)).toBe(sniffer?.tabIndex);
    expect(resolveSectionTargetTab(monitor, undefined)).toBe(monitor.tabs[0]?.tabIndex);
    expect(resolveSectionTargetTab(monitor, TAB_SLOT_IDS.indexOf('RRC'))).toBe(
      monitor.tabs[0]?.tabIndex,
    );
  });
});
