import { describe, expect, it } from 'vitest';

import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from './BaseRadioProvider';
import { getCapabilityUnavailableReason } from './capabilityUnavailable';

describe('getCapabilityUnavailableReason', () => {
  it('returns null when capabilities are missing', () => {
    expect(getCapabilityUnavailableReason(undefined, 'shutdown')).toBeNull();
  });

  it.each(['factoryReset', 'nodeDbReset', 'shutdown'] as const)(
    'returns null for Meshtastic %s (supported)',
    (feature) => {
      expect(getCapabilityUnavailableReason(MESHTASTIC_CAPABILITIES, feature)).toBeNull();
    },
  );

  it.each([
    ['factoryReset', 'capabilityUnavailable.factoryReset.meshcore'],
    ['nodeDbReset', 'capabilityUnavailable.nodeDbReset.meshcore'],
    ['shutdown', 'capabilityUnavailable.shutdown.meshcore'],
  ] as const)('uses MeshCore-specific reason for %s', (feature, reasonKey) => {
    expect(getCapabilityUnavailableReason(MESHCORE_CAPABILITIES, feature)).toEqual({
      feature,
      protocol: 'meshcore',
      reasonKey,
    });
  });

  it('uses Reticulum-specific factory reset reason and default for other features', () => {
    expect(getCapabilityUnavailableReason(RETICULUM_CAPABILITIES, 'factoryReset')?.reasonKey).toBe(
      'capabilityUnavailable.factoryReset.reticulum',
    );
    expect(getCapabilityUnavailableReason(RETICULUM_CAPABILITIES, 'shutdown')?.reasonKey).toBe(
      'capabilityUnavailable.shutdown.default',
    );
  });

  it('handler-gated features are available until the handler is missing', () => {
    expect(getCapabilityUnavailableReason(MESHTASTIC_CAPABILITIES, 'rebootOta')).toBeNull();
    expect(
      getCapabilityUnavailableReason(MESHTASTIC_CAPABILITIES, 'rebootOta', {
        handlerMissing: true,
      })?.reasonKey,
    ).toBe('capabilityUnavailable.rebootOta.default');
    expect(
      getCapabilityUnavailableReason(MESHCORE_CAPABILITIES, 'enterDfu', { handlerMissing: true })
        ?.reasonKey,
    ).toBe('capabilityUnavailable.enterDfu.meshcore');
  });

  it('firmwareFlash is available for Meshtastic and MeshCore, unavailable for Reticulum', () => {
    expect(getCapabilityUnavailableReason(MESHTASTIC_CAPABILITIES, 'firmwareFlash')).toBeNull();
    expect(getCapabilityUnavailableReason(MESHCORE_CAPABILITIES, 'firmwareFlash')).toBeNull();
    expect(getCapabilityUnavailableReason(RETICULUM_CAPABILITIES, 'firmwareFlash')?.reasonKey).toBe(
      'capabilityUnavailable.firmwareFlash.reticulum',
    );
  });
});
