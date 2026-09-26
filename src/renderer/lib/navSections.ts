import type { ProtocolTabMappings } from './appTabMappings';
import type { ProtocolCapabilities } from './radio/BaseRadioProvider';
import { TAB_SLOT_IDS, type TabIconSlotId, type TabSlotId } from './tabSlotIds';

/**
 * Two-level navigation (issue #1062, Option B): the rail shows sections, each section shows its
 * panels as sub-tabs. Panel ids, labels and capability gating still come from `appTabMappings`;
 * this module only groups the visible tabs.
 */
export type NavSectionId = 'chat' | 'network' | 'map' | 'monitor' | 'device' | 'incident' | 'app';

/** Rail order, top to bottom. `incident` and `app` sit at the bottom of the rail. */
export const NAV_SECTION_ORDER: readonly NavSectionId[] = [
  'chat',
  'network',
  'map',
  'monitor',
  'device',
  'incident',
  'app',
];

/** Sections pinned to the foot of the rail. */
export const NAV_FOOTER_SECTIONS: ReadonlySet<NavSectionId> = new Set(['incident', 'app']);

/**
 * i18n keys for section names (static so `check:i18n` sees them). Sections that share a word with
 * a tab reuse the tab key, so the section and its tab read the same in every locale.
 */
export const NAV_SECTION_LABEL_KEYS: Record<NavSectionId, string> = {
  chat: 'tabs.chat',
  network: 'tabs.network',
  map: 'tabs.map',
  monitor: 'shell.section.monitor',
  device: 'shell.section.device',
  incident: 'tabs.incident',
  app: 'tabs.app',
};

/**
 * Panel slots per section, in sub-tab order. `Modules` is listed in both Network (MeshCore
 * Repeaters) and Device (Meshtastic module config); `navSectionForSlot` picks one by capability.
 */
const SECTION_SLOT_ORDER: Record<NavSectionId, readonly TabSlotId[]> = {
  chat: ['Chat', 'Rooms', 'RRC', 'Games'],
  network: ['Nodes', 'Modules', 'Graph', 'Topology', 'NomadNetwork', 'Remote'],
  map: ['Map'],
  monitor: ['Diagnostics', 'Telemetry', 'Stats', 'Sniffer', 'RF'],
  device: ['Connection', 'Radio', 'Modules', 'Admin', 'Security', 'TAK'],
  incident: ['Incident'],
  app: ['App'],
};

export function navSectionForSlot(
  slot: TabSlotId,
  capabilities: Pick<ProtocolCapabilities, 'modulesTabUsesRepeatersLabel'>,
): NavSectionId {
  if (slot === 'Modules') {
    return capabilities.modulesTabUsesRepeatersLabel ? 'network' : 'device';
  }
  for (const id of NAV_SECTION_ORDER) {
    if (SECTION_SLOT_ORDER[id].includes(slot)) return id;
  }
  // Every TAB_SLOT_IDS entry is listed above (enforced by navSections.test.ts).
  return 'app';
}

export interface NavSectionTab {
  /** Index into the protocol's filtered tab list (the value App keeps in `activeTab`). */
  tabIndex: number;
  /** Stable panel index into `TAB_SLOT_IDS`. */
  panelIndex: number;
  slot: TabSlotId;
  iconSlot: TabIconSlotId;
  label: string;
}

export interface NavSection {
  id: NavSectionId;
  tabs: NavSectionTab[];
}

/** Groups the protocol's visible tabs into rail sections; empty sections are dropped. */
export function computeNavSections(
  mappings: ProtocolTabMappings,
  capabilities: Pick<ProtocolCapabilities, 'modulesTabUsesRepeatersLabel'>,
): NavSection[] {
  const bySection = new Map<NavSectionId, NavSectionTab[]>();
  mappings.tabIndexToPanelIndex.forEach((panelIndex, tabIndex) => {
    const slot = TAB_SLOT_IDS[panelIndex];
    const sectionId = navSectionForSlot(slot, capabilities);
    const list = bySection.get(sectionId) ?? [];
    list.push({
      tabIndex,
      panelIndex,
      slot,
      iconSlot: mappings.tabSlotIds[tabIndex] ?? slot,
      label: mappings.displayTabLabels[tabIndex] ?? slot,
    });
    bySection.set(sectionId, list);
  });

  const sections: NavSection[] = [];
  for (const id of NAV_SECTION_ORDER) {
    const tabs = bySection.get(id);
    if (!tabs || tabs.length === 0) continue;
    const order = SECTION_SLOT_ORDER[id];
    tabs.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
    sections.push({ id, tabs });
  }
  return sections;
}

export function findNavSectionForTab(
  sections: readonly NavSection[],
  tabIndex: number,
): NavSection | undefined {
  return sections.find((section) => section.tabs.some((tab) => tab.tabIndex === tabIndex));
}

/**
 * Tab to open when a rail section is clicked: the panel last shown in that section when it is
 * still visible, otherwise the section's first tab.
 */
export function resolveSectionTargetTab(
  section: NavSection,
  lastPanelIndex: number | undefined,
): number {
  if (lastPanelIndex !== undefined) {
    const remembered = section.tabs.find((tab) => tab.panelIndex === lastPanelIndex);
    if (remembered) return remembered.tabIndex;
  }
  return section.tabs[0]?.tabIndex ?? 0;
}

/** Index of `slot` in the protocol's flat tab list, or -1 when hidden for this protocol. */
export function findTabIndexForSlot(mappings: ProtocolTabMappings, slot: TabSlotId): number {
  return mappings.tabIndexToPanelIndex.indexOf(TAB_SLOT_IDS.indexOf(slot));
}
