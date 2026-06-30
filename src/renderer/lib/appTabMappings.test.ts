import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { computeTabMappings } from './appTabMappings';
import { MESHTASTIC_CAPABILITIES, RETICULUM_CAPABILITIES } from './radio/BaseRadioProvider';
import { TAB_SLOT_IDS } from './tabSlotIds';

const identityT = ((key: string) => key) as TFunction;

describe('computeTabMappings', () => {
  it('shows Radio and Graph tabs for Reticulum', () => {
    const tabs = computeTabMappings(identityT, 'reticulum', RETICULUM_CAPABILITIES);
    const radioPanelIndex = TAB_SLOT_IDS.indexOf('Radio');
    const graphPanelIndex = TAB_SLOT_IDS.indexOf('Graph');
    expect(RETICULUM_CAPABILITIES.hasReticulumRadioPanel).toBe(true);
    expect(RETICULUM_CAPABILITIES.hasNeighborInfo).toBe(true);
    expect(tabs.tabIndexToPanelIndex).toContain(radioPanelIndex);
    expect(tabs.tabIndexToPanelIndex).toContain(graphPanelIndex);
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
});
