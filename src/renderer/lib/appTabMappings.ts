import type { TFunction } from 'i18next';

import type { ProtocolCapabilities } from './radio/BaseRadioProvider';
import { TAB_SLOT_IDS, type TabIconSlotId } from './tabSlotIds';
import type { MeshProtocol } from './types';

export const NOMAD_NETWORK_PANEL_INDEX = TAB_SLOT_IDS.indexOf('NomadNetwork');
export const TOPOLOGY_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Topology');
export const NODES_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Nodes');
export const MAP_TAB_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Map');
export const ROOMS_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Rooms');
export const RADIO_TAB_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Radio');
export const MODULES_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Modules');
export const SECURITY_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Security');

type TabCapabilityRequirement = keyof ProtocolCapabilities | { or: (keyof ProtocolCapabilities)[] };

const TAB_CAPABILITY_REQUIREMENTS: (TabCapabilityRequirement | undefined)[] = [
  undefined, // Connection
  undefined, // Chat
  'hasNomadNetworkPanel', // Nomad Network
  undefined, // Nodes/Contacts
  { or: ['hasFullPositionConfig', 'nodeListTabUsesContactsLabel'] }, // Map
  { or: ['hasChannelConfig', 'hasReticulumRadioPanel', 'hasJsonRadioConfigImport'] }, // Radio
  { or: ['modulesTabUsesRepeatersLabel', 'hasChannelConfig'] }, // Modules or Repeaters
  { or: ['hasSecurityPanel', 'hasReticulumAdminPanel'] }, // Admin
  'hasRoomServersPanel', // Rooms
  'hasEnvironmentTelemetry', // Telemetry
  'hasSecurityPanel', // Security
  'hasTakPanel', // TAK
  undefined, // App
  'hasDiagnosticsPanel', // Diagnostics
  'hasRawPacketLog', // Stats
  'hasRawPacketLog', // Sniffer
  'hasRfStats', // RF
  { or: ['hasNeighborInfo', 'nodeListTabUsesContactsLabel'] }, // Graph
  'hasReticulumTopologyPanel', // Topology
];

function tabVisible(
  capabilities: ProtocolCapabilities,
  requirement: TabCapabilityRequirement,
): boolean {
  if (typeof requirement === 'object') {
    return requirement.or.some((key) => capabilities[key]);
  }
  return Boolean(capabilities[requirement]);
}

function tabLabelKey(capabilities: ProtocolCapabilities, panelIndex: number): `tabs.${string}` {
  if (panelIndex === NOMAD_NETWORK_PANEL_INDEX) return 'tabs.nomadnetwork';
  if (panelIndex === NODES_PANEL_INDEX && capabilities.nodeListTabUsesContactsLabel) {
    return 'tabs.contacts';
  }
  if (panelIndex === NODES_PANEL_INDEX && capabilities.nodeListTabUsesPeersLabel)
    return 'tabs.peers';
  if (panelIndex === MODULES_PANEL_INDEX && capabilities.modulesTabUsesRepeatersLabel) {
    return 'tabs.repeaters';
  }
  if (panelIndex === ROOMS_PANEL_INDEX && capabilities.hasRoomServersPanel) return 'tabs.rooms';
  return `tabs.${TAB_SLOT_IDS[panelIndex].toLowerCase()}`;
}

function tabIconSlotId(capabilities: ProtocolCapabilities, panelIndex: number): TabIconSlotId {
  if (panelIndex === MODULES_PANEL_INDEX && capabilities.modulesTabUsesRepeatersLabel) {
    return 'Repeaters';
  }
  return TAB_SLOT_IDS[panelIndex];
}

export interface ProtocolTabMappings {
  displayTabLabels: string[];
  tabSlotIds: TabIconSlotId[];
  tabIndexToPanelIndex: number[];
}

export function computeTabMappings(
  translate: TFunction,
  _targetProtocol: MeshProtocol,
  targetCapabilities: ProtocolCapabilities,
): ProtocolTabMappings {
  const filtered: { label: string; slotId: TabIconSlotId; panelIndex: number }[] = [];
  TAB_SLOT_IDS.forEach((_slot, panelIndex) => {
    const requiredCap = TAB_CAPABILITY_REQUIREMENTS[panelIndex];
    if (requiredCap !== undefined && !tabVisible(targetCapabilities, requiredCap)) return;
    filtered.push({
      label: translate(tabLabelKey(targetCapabilities, panelIndex)),
      slotId: tabIconSlotId(targetCapabilities, panelIndex),
      panelIndex,
    });
  });
  return {
    displayTabLabels: filtered.map((row) => row.label),
    tabSlotIds: filtered.map((row) => row.slotId),
    tabIndexToPanelIndex: filtered.map((row) => row.panelIndex),
  };
}

export function findFilteredTabIndexForPanel(
  tabs: ProtocolTabMappings,
  panelIndex: number,
): number {
  return tabs.tabIndexToPanelIndex.findIndex((p) => p === panelIndex);
}

export function resolveSavedTabOnProtocolSwitch(
  tabs: ProtocolTabMappings,
  savedPanel: number | null,
  savedTab: number,
): number {
  if (savedPanel != null) {
    const foundFilteredIndex = findFilteredTabIndexForPanel(tabs, savedPanel);
    if (foundFilteredIndex !== -1 && foundFilteredIndex < tabs.displayTabLabels.length) {
      return foundFilteredIndex;
    }
  }
  return savedTab < tabs.displayTabLabels.length ? savedTab : 0;
}
