import type { TFunction } from 'i18next';

import type { ProtocolCapabilities } from './radio/BaseRadioProvider';
import { TAB_SLOT_IDS, type TabIconSlotId } from './tabSlotIds';
import type { MeshProtocol } from './types';

export const RRC_PANEL_INDEX = TAB_SLOT_IDS.indexOf('RRC');
export const REMOTE_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Remote');
export const NOMAD_NETWORK_PANEL_INDEX = TAB_SLOT_IDS.indexOf('NomadNetwork');
export const TOPOLOGY_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Topology');
export const NODES_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Nodes');
export const MAP_TAB_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Map');
export const ROOMS_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Rooms');
export const RADIO_TAB_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Radio');
export const MODULES_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Modules');
export const ADMIN_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Admin');
export const TELEMETRY_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Telemetry');
export const SECURITY_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Security');
export const TAK_PANEL_INDEX = TAB_SLOT_IDS.indexOf('TAK');
export const APP_PANEL_INDEX = TAB_SLOT_IDS.indexOf('App');
export const DIAGNOSTICS_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Diagnostics');
export const STATS_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Stats');
export const SNIFFER_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Sniffer');
export const RF_PANEL_INDEX = TAB_SLOT_IDS.indexOf('RF');
export const GRAPH_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Graph');

type TabCapabilityRequirement = keyof ProtocolCapabilities | { or: (keyof ProtocolCapabilities)[] };

const TAB_CAPABILITY_REQUIREMENTS: (TabCapabilityRequirement | undefined)[] = [
  undefined, // Connection
  undefined, // Chat
  'hasRrcPanel', // RRC
  'hasNomadNetworkPanel', // Nomad Network
  'hasReticulumRemotePanel', // Remote
  undefined, // Nodes/Contacts
  { or: ['hasFullPositionConfig', 'nodeListTabUsesContactsLabel', 'hasReticulumDiscoveryMap'] }, // Map
  { or: ['hasChannelConfig', 'hasReticulumNetworkPanel', 'hasJsonRadioConfigImport'] }, // Radio
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
  if (panelIndex === RADIO_TAB_PANEL_INDEX && capabilities.hasReticulumNetworkPanel) {
    return 'tabs.network';
  }
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
  return tabs.tabIndexToPanelIndex.indexOf(panelIndex);
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
