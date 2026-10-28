// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POWER_SAVE_MODE,
  normalizePowerSaveLinkType,
  type PowerSaveConnectionSnapshot,
  powerSaveModeFromStored,
  shouldHoldPowerSaveBlocker,
} from './powerSavePolicy';

function snap(partial: Partial<PowerSaveConnectionSnapshot> = {}): PowerSaveConnectionSnapshot {
  return {
    meshtastic: { connected: false, link: null },
    meshcore: { connected: false, link: null },
    mqtt: false,
    reticulumSidecar: false,
    reticulumLocalRadio: false,
    ...partial,
  };
}

describe('powerSaveModeFromStored', () => {
  it.each([undefined, null, '', '1', '0', 'true', 'RF', 'garbage'] as const)(
    'falls back to default for %j',
    (value) => {
      expect(powerSaveModeFromStored(value)).toBe(DEFAULT_POWER_SAVE_MODE);
      expect(powerSaveModeFromStored(value)).toBe('rf');
    },
  );

  it.each(['off', 'rf', 'always'] as const)('round-trips %j', (mode) => {
    expect(powerSaveModeFromStored(mode)).toBe(mode);
  });
});

describe('normalizePowerSaveLinkType', () => {
  it.each(['ble', 'serial', 'tcp', 'http'] as const)('accepts %j', (link) => {
    expect(normalizePowerSaveLinkType(link)).toBe(link);
  });

  it.each(['BLE', '', null, 42, {}, 'wifi'] as const)('rejects %j', (value) => {
    expect(normalizePowerSaveLinkType(value)).toBeNull();
  });
});

describe('shouldHoldPowerSaveBlocker', () => {
  it('off never holds', () => {
    expect(
      shouldHoldPowerSaveBlocker('off', snap({ meshtastic: { connected: true, link: 'ble' } })),
    ).toBe(false);
    expect(
      shouldHoldPowerSaveBlocker(
        'off',
        snap({ mqtt: true, reticulumSidecar: true, reticulumLocalRadio: true }),
      ),
    ).toBe(false);
  });

  it('rf holds for Meshtastic ble and MeshCore serial', () => {
    expect(
      shouldHoldPowerSaveBlocker('rf', snap({ meshtastic: { connected: true, link: 'ble' } })),
    ).toBe(true);
    expect(
      shouldHoldPowerSaveBlocker('rf', snap({ meshcore: { connected: true, link: 'serial' } })),
    ).toBe(true);
  });

  it('rf releases for reported MeshCore TCP + mqtt + sidecar (no local radio)', () => {
    expect(
      shouldHoldPowerSaveBlocker(
        'rf',
        snap({
          meshcore: { connected: true, link: 'tcp' },
          mqtt: true,
          reticulumSidecar: true,
          reticulumLocalRadio: false,
        }),
      ),
    ).toBe(false);
  });

  it('rf releases for http / mqtt-only / sidecar-without-local-radio', () => {
    expect(
      shouldHoldPowerSaveBlocker('rf', snap({ meshtastic: { connected: true, link: 'http' } })),
    ).toBe(false);
    expect(shouldHoldPowerSaveBlocker('rf', snap({ mqtt: true }))).toBe(false);
    expect(
      shouldHoldPowerSaveBlocker(
        'rf',
        snap({ reticulumSidecar: true, reticulumLocalRadio: false }),
      ),
    ).toBe(false);
  });

  it('rf holds when connected with unknown link (conservative)', () => {
    expect(
      shouldHoldPowerSaveBlocker('rf', snap({ meshtastic: { connected: true, link: null } })),
    ).toBe(true);
  });

  it('rf ignores stale link when disconnected', () => {
    expect(
      shouldHoldPowerSaveBlocker('rf', snap({ meshtastic: { connected: false, link: 'ble' } })),
    ).toBe(false);
  });

  it('rf holds for Reticulum local radio', () => {
    expect(
      shouldHoldPowerSaveBlocker('rf', snap({ reticulumSidecar: true, reticulumLocalRadio: true })),
    ).toBe(true);
  });

  it('always holds for mqtt / sidecar / tcp / ble and releases when idle', () => {
    expect(shouldHoldPowerSaveBlocker('always', snap({ mqtt: true }))).toBe(true);
    expect(shouldHoldPowerSaveBlocker('always', snap({ reticulumSidecar: true }))).toBe(true);
    expect(
      shouldHoldPowerSaveBlocker('always', snap({ meshcore: { connected: true, link: 'tcp' } })),
    ).toBe(true);
    expect(
      shouldHoldPowerSaveBlocker('always', snap({ meshtastic: { connected: true, link: 'ble' } })),
    ).toBe(true);
    expect(shouldHoldPowerSaveBlocker('always', snap())).toBe(false);
  });
});
