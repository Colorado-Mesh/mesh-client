import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { computeTabMappings } from './appTabMappings';
import { RETICULUM_CAPABILITIES } from './radio/BaseRadioProvider';
import { TAB_SLOT_IDS } from './tabSlotIds';

const identityT = ((key: string) => key) as TFunction;

describe('computeTabMappings', () => {
  it('hides Diagnostics for Reticulum', () => {
    const tabs = computeTabMappings(identityT, 'reticulum', RETICULUM_CAPABILITIES);
    const diagnosticsPanelIndex = TAB_SLOT_IDS.indexOf('Diagnostics');
    expect(RETICULUM_CAPABILITIES.hasDiagnosticsPanel).toBe(false);
    expect(tabs.tabIndexToPanelIndex).not.toContain(diagnosticsPanelIndex);
  });
});
