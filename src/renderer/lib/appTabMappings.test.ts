import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  computeTabMappings,
  findFilteredTabIndexForPanel,
  NODES_PANEL_INDEX,
  RADIO_TAB_PANEL_INDEX,
} from './appTabMappings';
import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from './radio/BaseRadioProvider';
import { TAB_SLOT_IDS } from './tabSlotIds';

const identityT = ((key: string) => key) as TFunction;

describe('computeTabMappings', () => {
  it('shows Radio tab but not Graph for Reticulum', () => {
    const tabs = computeTabMappings(identityT, 'reticulum', RETICULUM_CAPABILITIES);
    const radioPanelIndex = TAB_SLOT_IDS.indexOf('Radio');
    const graphPanelIndex = TAB_SLOT_IDS.indexOf('Graph');
    expect(RETICULUM_CAPABILITIES.hasReticulumRadioPanel).toBe(true);
    expect(RETICULUM_CAPABILITIES.hasNeighborInfo).toBe(false);
    expect(tabs.tabIndexToPanelIndex).toContain(radioPanelIndex);
    expect(tabs.tabIndexToPanelIndex).not.toContain(graphPanelIndex);
  });

  it('shows Diagnostics for Reticulum when native engine is enabled', () => {
    const tabs = computeTabMappings(identityT, 'reticulum', RETICULUM_CAPABILITIES);
    const diagnosticsPanelIndex = TAB_SLOT_IDS.indexOf('Diagnostics');
    expect(RETICULUM_CAPABILITIES.hasDiagnosticsPanel).toBe(true);
    expect(tabs.tabIndexToPanelIndex).toContain(diagnosticsPanelIndex);
  });

  it('shows Admin tab for Reticulum', () => {
    const tabs = computeTabMappings(identityT, 'reticulum', RETICULUM_CAPABILITIES);
    const adminPanelIndex = TAB_SLOT_IDS.indexOf('Admin');
    expect(RETICULUM_CAPABILITIES.hasReticulumAdminPanel).toBe(true);
    expect(tabs.tabIndexToPanelIndex).toContain(adminPanelIndex);
  });

  it('uses Peers tab label for Reticulum nodes slot', () => {
    const tabs = computeTabMappings(identityT, 'reticulum', RETICULUM_CAPABILITIES);
    const nodesPanelIndex = TAB_SLOT_IDS.indexOf('Nodes');
    const nodesTabIndex = tabs.tabIndexToPanelIndex.indexOf(nodesPanelIndex);
    expect(nodesTabIndex).toBeGreaterThanOrEqual(0);
    expect(tabs.displayTabLabels[nodesTabIndex]).toBe('tabs.peers');
  });

  it('shows Topology tab for Reticulum only', () => {
    const reticulumTabs = computeTabMappings(identityT, 'reticulum', RETICULUM_CAPABILITIES);
    const meshtasticTabs = computeTabMappings(identityT, 'meshtastic', MESHTASTIC_CAPABILITIES);
    const topologyPanelIndex = TAB_SLOT_IDS.indexOf('Topology');
    expect(RETICULUM_CAPABILITIES.hasReticulumTopologyPanel).toBe(true);
    expect(reticulumTabs.tabIndexToPanelIndex).toContain(topologyPanelIndex);
    expect(meshtasticTabs.tabIndexToPanelIndex).not.toContain(topologyPanelIndex);
  });

  it('maps Nodes panel to Peers tab index, not Nomad Network', () => {
    const tabs = computeTabMappings(identityT, 'reticulum', RETICULUM_CAPABILITIES);
    const peersTabIndex = findFilteredTabIndexForPanel(tabs, NODES_PANEL_INDEX);
    const nomadPanelIndex = TAB_SLOT_IDS.indexOf('NomadNetwork');
    const nomadTabIndex = findFilteredTabIndexForPanel(tabs, nomadPanelIndex);
    expect(peersTabIndex).toBeGreaterThanOrEqual(0);
    expect(nomadTabIndex).toBeGreaterThanOrEqual(0);
    expect(peersTabIndex).not.toBe(nomadTabIndex);
    expect(tabs.tabIndexToPanelIndex[peersTabIndex]).toBe(NODES_PANEL_INDEX);
  });

  it('shows Nomad Network tab after Chat for Reticulum only', () => {
    const reticulumTabs = computeTabMappings(identityT, 'reticulum', RETICULUM_CAPABILITIES);
    const nomadIndex = reticulumTabs.tabIndexToPanelIndex.indexOf(
      TAB_SLOT_IDS.indexOf('NomadNetwork'),
    );
    const chatIndex = reticulumTabs.tabIndexToPanelIndex.indexOf(TAB_SLOT_IDS.indexOf('Chat'));
    expect(nomadIndex).toBeGreaterThan(chatIndex);
    expect(reticulumTabs.displayTabLabels[nomadIndex]).toBe('tabs.nomadnetwork');

    const meshtasticTabs = computeTabMappings(identityT, 'meshtastic', MESHTASTIC_CAPABILITIES);
    expect(meshtasticTabs.tabIndexToPanelIndex).not.toContain(TAB_SLOT_IDS.indexOf('NomadNetwork'));
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
