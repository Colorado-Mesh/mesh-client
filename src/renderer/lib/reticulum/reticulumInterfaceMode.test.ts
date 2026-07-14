import { describe, expect, it } from 'vitest';

import {
  defaultModeForIfaceType,
  normalizeReticulumInterfaceMode,
  RETICULUM_HUB_INTERFACE_MODE,
  RETICULUM_INTERFACE_MODES,
  reticulumInterfaceModeLabelKey,
} from '@/renderer/lib/reticulum/reticulumInterfaceMode';

describe('reticulumInterfaceMode', () => {
  it('normalizes canonical values and aliases', () => {
    expect(normalizeReticulumInterfaceMode('boundary')).toBe('boundary');
    expect(normalizeReticulumInterfaceMode('  AP ')).toBe('access_point');
    expect(normalizeReticulumInterfaceMode('gw')).toBe('gateway');
    expect(normalizeReticulumInterfaceMode('')).toBeNull();
    expect(normalizeReticulumInterfaceMode(null)).toBeNull();
    expect(normalizeReticulumInterfaceMode('nonsense')).toBeNull();
  });

  it('defaults modes by interface type', () => {
    expect(defaultModeForIfaceType('tcp')).toBe('boundary');
    expect(defaultModeForIfaceType('udp')).toBe('boundary');
    expect(defaultModeForIfaceType('i2p')).toBe(RETICULUM_HUB_INTERFACE_MODE);
    expect(defaultModeForIfaceType('rnode')).toBe('access_point');
    expect(defaultModeForIfaceType('rnode_multi')).toBe('access_point');
    expect(defaultModeForIfaceType('auto')).toBeNull();
    expect(defaultModeForIfaceType('ble_peer')).toBeNull();
  });

  it('builds i18n label keys', () => {
    expect(reticulumInterfaceModeLabelKey('gateway')).toBe(
      'connectionPanel.reticulumInterfaces.modeOption.gateway',
    );
  });

  it('keeps TS mode catalog aligned with sidecar contract', () => {
    // Mirror INTERFACE_MODES + defaults in reticulum-sidecar/src/stack/config.rs.
    expect([...RETICULUM_INTERFACE_MODES]).toEqual([
      'full',
      'point_to_point',
      'access_point',
      'roaming',
      'boundary',
      'gateway',
    ]);
    expect(normalizeReticulumInterfaceMode('ap')).toBe('access_point');
    expect(normalizeReticulumInterfaceMode('gw')).toBe('gateway');
    expect(defaultModeForIfaceType('tcp')).toBe('boundary');
    expect(defaultModeForIfaceType('udp')).toBe('boundary');
    expect(defaultModeForIfaceType('i2p')).toBe('boundary');
    expect(defaultModeForIfaceType('rnode')).toBe('access_point');
    expect(defaultModeForIfaceType('rnode_multi')).toBe('access_point');
  });
});
