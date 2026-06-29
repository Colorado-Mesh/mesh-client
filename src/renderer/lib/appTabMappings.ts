import type { TFunction } from 'i18next';

import type { ProtocolCapabilities } from './radio/BaseRadioProvider';
import { TAB_SLOT_IDS, type TabIconSlotId } from './tabSlotIds';
import type { MeshProtocol } from './types';

export const MAP_TAB_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Map');
export const ROOMS_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Rooms');
export const RADIO_TAB_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Radio');

const TAB_CAPABILITY_REQUIREMENTS: (keyof ProtocolCapabilities | undefined)[] = [
  undefined, // Connection
  undefined, // Chat
  undefined, // Nodes/Contacts
  'hasFullPositionConfig', // Map
  'hasChannelConfig', // Radio
  'modulesTabUsesRepeatersLabel', // Modules or Repeaters
  'hasSecurityPanel', // Admin
  'hasRoomServersPanel', // Rooms
  'hasEnvironmentTelemetry', // Telemetry
  'hasSecurityPanel', // Security
  'hasTakPanel', // TAK
  undefined, // App
  undefined, // Diagnostics
  'hasRawPacketLog', // Stats
  'hasRawPacketLog', // Sniffer
  'hasRfStats', // RF
  'hasNeighborInfo', // Graph
];

function tabLabelKey(capabilities: ProtocolCapabilities, panelIndex: number): `tabs.${string}` {
  if (panelIndex === 2 && capabilities.nodeListTabUsesContactsLabel) return 'tabs.contacts';
  if (panelIndex === 5 && capabilities.modulesTabUsesRepeatersLabel) return 'tabs.repeaters';
  if (panelIndex === 7 && capabilities.hasRoomServersPanel) return 'tabs.rooms';
  return `tabs.${TAB_SLOT_IDS[panelIndex].toLowerCase()}`;
}

function tabIconSlotId(capabilities: ProtocolCapabilities, panelIndex: number): TabIconSlotId {
  if (panelIndex === 5 && capabilities.modulesTabUsesRepeatersLabel) return 'Repeaters';
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
    if (requiredCap !== undefined && !targetCapabilities[requiredCap]) return;
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
