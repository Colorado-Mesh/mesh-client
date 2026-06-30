import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { computeTabMappings } from './appTabMappings';
import { RETICULUM_CAPABILITIES } from './radio/BaseRadioProvider';
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

  it('uses Peers tab label for Reticulum nodes slot', () => {
    const tabs = computeTabMappings(identityT, 'reticulum', RETICULUM_CAPABILITIES);
    const nodesPanelIndex = TAB_SLOT_IDS.indexOf('Nodes');
    const nodesTabIndex = tabs.tabIndexToPanelIndex.indexOf(nodesPanelIndex);
    expect(nodesTabIndex).toBeGreaterThanOrEqual(0);
    expect(tabs.displayTabLabels[nodesTabIndex]).toBe('tabs.peers');
  });
});
