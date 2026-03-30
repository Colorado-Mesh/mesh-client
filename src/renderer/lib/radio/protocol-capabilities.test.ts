/**
 * ProtocolCapabilities contract tests.
 *
 * These tests lock down the exact feature flags for each radio protocol preset.
 * Their purpose is to catch AI regressions that silently flip a capability flag
 * (e.g. turning hasPerHopSnr from true to false in MESHCORE_CAPABILITIES) or
 * drop a field from the interface without updating both presets.
 *
 * When a capability is intentionally added or changed, update the snapshot:
 *   npm run test:run -- --update-snapshots
 */
import { describe, expect, it } from 'vitest';

import type { ProtocolCapabilities } from './BaseRadioProvider';
import { MESHCORE_CAPABILITIES, MESHTASTIC_CAPABILITIES } from './BaseRadioProvider';

const REQUIRED_CAPABILITY_KEYS: (keyof ProtocolCapabilities)[] = [
  'protocol',
  'hasHopCount',
  'hopLimitRange',
  'hasMqttHybrid',
  'hasEnvironmentTelemetry',
  'hasRfStats',
  'hasNeighborInfo',
  'hasChannelConfig',
  'hasModemPresets',
  'hasTraceRoute',
  'hasPerHopSnr',
  'hasBatteryTelemetry',
  'hasRepeaterStatus',
  'hasOnDemandNodeStatus',
  'hasBluetoothConfig',
  'hasDeviceRoleConfig',
  'hasDisplayConfig',
  'hasPowerConfig',
  'hasWifiConfig',
  'hasTelemetryIntervalConfig',
  'hasUserManagedContactGroups',
  'hasCompanionContactManagementConfig',
  'hasCompanionTelemetryPrivacyConfig',
  'hasShutdown',
  'hasNodeDbReset',
  'hasFactoryReset',
  'hasFullPositionConfig',
  'hasSecurityPanel',
  'hasTakPanel',
  'nodeStaleThresholdMs',
  'nodeOfflineThresholdMs',
];

describe('ProtocolCapabilities contract', () => {
  it('REQUIRED_CAPABILITY_KEYS covers the full ProtocolCapabilities interface', () => {
    // This test validates that REQUIRED_CAPABILITY_KEYS itself is complete.
    // Since MESHTASTIC_CAPABILITIES is typed as ProtocolCapabilities, its key
    // set must equal REQUIRED_CAPABILITY_KEYS (TypeScript would catch extras/missing).
    const actualKeys = Object.keys(MESHTASTIC_CAPABILITIES).sort();
    const expectedKeys = [...REQUIRED_CAPABILITY_KEYS].sort();
    expect(actualKeys).toEqual(expectedKeys);
  });

  it('MESHTASTIC_CAPABILITIES has all required keys', () => {
    for (const key of REQUIRED_CAPABILITY_KEYS) {
      expect(MESHTASTIC_CAPABILITIES, `missing key: ${key}`).toHaveProperty(key);
    }
  });

  it('MESHCORE_CAPABILITIES has all required keys', () => {
    for (const key of REQUIRED_CAPABILITY_KEYS) {
      expect(MESHCORE_CAPABILITIES, `missing key: ${key}`).toHaveProperty(key);
    }
  });

  it('MESHTASTIC_CAPABILITIES exact values are stable', () => {
    expect(MESHTASTIC_CAPABILITIES).toMatchInlineSnapshot(`
      {
        "hasBatteryTelemetry": true,
        "hasBluetoothConfig": true,
        "hasChannelConfig": true,
        "hasCompanionContactManagementConfig": false,
        "hasCompanionTelemetryPrivacyConfig": false,
        "hasDeviceRoleConfig": true,
        "hasDisplayConfig": true,
        "hasEnvironmentTelemetry": true,
        "hasFactoryReset": true,
        "hasFullPositionConfig": true,
        "hasHopCount": true,
        "hasModemPresets": true,
        "hasMqttHybrid": true,
        "hasNeighborInfo": true,
        "hasNodeDbReset": true,
        "hasOnDemandNodeStatus": false,
        "hasPerHopSnr": false,
        "hasPowerConfig": true,
        "hasRepeaterStatus": false,
        "hasRfStats": true,
        "hasSecurityPanel": true,
        "hasShutdown": true,
        "hasTakPanel": true,
        "hasTelemetryIntervalConfig": true,
        "hasTraceRoute": true,
        "hasUserManagedContactGroups": true,
        "hasWifiConfig": true,
        "hopLimitRange": [
          1,
          7,
        ],
        "nodeOfflineThresholdMs": 86400000,
        "nodeStaleThresholdMs": 10800000,
        "protocol": "meshtastic",
      }
    `);
  });

  it('MESHCORE_CAPABILITIES exact values are stable', () => {
    expect(MESHCORE_CAPABILITIES).toMatchInlineSnapshot(`
      {
        "hasBatteryTelemetry": true,
        "hasBluetoothConfig": false,
        "hasChannelConfig": false,
        "hasCompanionContactManagementConfig": true,
        "hasCompanionTelemetryPrivacyConfig": true,
        "hasDeviceRoleConfig": false,
        "hasDisplayConfig": false,
        "hasEnvironmentTelemetry": true,
        "hasFactoryReset": false,
        "hasFullPositionConfig": false,
        "hasHopCount": true,
        "hasModemPresets": false,
        "hasMqttHybrid": false,
        "hasNeighborInfo": false,
        "hasNodeDbReset": false,
        "hasOnDemandNodeStatus": true,
        "hasPerHopSnr": true,
        "hasPowerConfig": false,
        "hasRepeaterStatus": true,
        "hasRfStats": false,
        "hasSecurityPanel": false,
        "hasShutdown": false,
        "hasTakPanel": false,
        "hasTelemetryIntervalConfig": false,
        "hasTraceRoute": true,
        "hasUserManagedContactGroups": true,
        "hasWifiConfig": false,
        "hopLimitRange": [
          1,
          64,
        ],
        "nodeOfflineThresholdMs": 172800000,
        "nodeStaleThresholdMs": 86400000,
        "protocol": "meshcore",
      }
    `);
  });

  it('MESHTASTIC and MESHCORE have different protocol identifiers', () => {
    expect(MESHTASTIC_CAPABILITIES.protocol).toBe('meshtastic');
    expect(MESHCORE_CAPABILITIES.protocol).toBe('meshcore');
  });
});
