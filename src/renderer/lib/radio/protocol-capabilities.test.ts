/**
 * ProtocolCapabilities contract tests.
 *
 * These tests lock down the exact feature flags for each radio protocol preset.
 * Their purpose is to catch AI regressions that silently flip a capability flag
 * (e.g. turning hasPerHopSnr from true to false in MESHCORE_CAPABILITIES) or
 * drop a field from the interface without updating both presets.
 *
 * When a capability is intentionally added or changed, update the snapshot:
 *   pnpm run test:run -- --update-snapshots
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
  'hasRemoteHardware',
  'hasSerial',
  'hasRangeTest',
  'hasPaxCounter',
  'hasAudio',
  'hasIpTunnel',
  'hasDetectionSensor',
  'hasStoreForward',
  'hasAtakPlugin',
  'hasMapReport',
  'hasContactImportExport',
  'hasCryptoOperations',
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
      expect(MESHTASTIC_CAPABILITIES).toHaveProperty(key);
    }
  });

  it('MESHCORE_CAPABILITIES has all required keys', () => {
    for (const key of REQUIRED_CAPABILITY_KEYS) {
      expect(MESHCORE_CAPABILITIES).toHaveProperty(key);
    }
  });

  it('MESHTASTIC_CAPABILITIES exact values are stable', () => {
    expect(MESHTASTIC_CAPABILITIES).toMatchInlineSnapshot(`
      {
        "hasAtakPlugin": true,
        "hasAudio": true,
        "hasBatteryTelemetry": true,
        "hasBluetoothConfig": true,
        "hasChannelConfig": true,
        "hasCompanionContactManagementConfig": false,
        "hasCompanionTelemetryPrivacyConfig": false,
        "hasContactImportExport": false,
        "hasCryptoOperations": true,
        "hasDetectionSensor": true,
        "hasDeviceRoleConfig": true,
        "hasDisplayConfig": true,
        "hasEnvironmentTelemetry": true,
        "hasFactoryReset": true,
        "hasFullPositionConfig": true,
        "hasHopCount": true,
        "hasIpTunnel": true,
        "hasMapReport": true,
        "hasModemPresets": true,
        "hasMqttHybrid": true,
        "hasNeighborInfo": true,
        "hasNodeDbReset": true,
        "hasOnDemandNodeStatus": false,
        "hasPaxCounter": true,
        "hasPerHopSnr": false,
        "hasPowerConfig": true,
        "hasRangeTest": true,
        "hasRemoteHardware": true,
        "hasRepeaterStatus": false,
        "hasRfStats": true,
        "hasSecurityPanel": true,
        "hasSerial": true,
        "hasShutdown": true,
        "hasStoreForward": true,
        "hasTakPanel": true,
        "hasTelemetryIntervalConfig": true,
        "hasTraceRoute": true,
        "hasUserManagedContactGroups": true,
        "hasWifiConfig": true,
        "hopLimitRange": [
          1,
          7,
        ],
        "nodeOfflineThresholdMs": 604800000,
        "nodeStaleThresholdMs": 7200000,
        "protocol": "meshtastic",
      }
    `);
  });

  it('MESHCORE_CAPABILITIES exact values are stable', () => {
    expect(MESHCORE_CAPABILITIES).toMatchInlineSnapshot(`
      {
        "hasAtakPlugin": false,
        "hasAudio": false,
        "hasBatteryTelemetry": true,
        "hasBluetoothConfig": false,
        "hasChannelConfig": false,
        "hasCompanionContactManagementConfig": true,
        "hasCompanionTelemetryPrivacyConfig": true,
        "hasContactImportExport": true,
        "hasCryptoOperations": true,
        "hasDetectionSensor": false,
        "hasDeviceRoleConfig": false,
        "hasDisplayConfig": false,
        "hasEnvironmentTelemetry": true,
        "hasFactoryReset": false,
        "hasFullPositionConfig": false,
        "hasHopCount": true,
        "hasIpTunnel": false,
        "hasMapReport": false,
        "hasModemPresets": false,
        "hasMqttHybrid": false,
        "hasNeighborInfo": false,
        "hasNodeDbReset": false,
        "hasOnDemandNodeStatus": true,
        "hasPaxCounter": false,
        "hasPerHopSnr": true,
        "hasPowerConfig": false,
        "hasRangeTest": false,
        "hasRemoteHardware": false,
        "hasRepeaterStatus": true,
        "hasRfStats": false,
        "hasSecurityPanel": false,
        "hasSerial": false,
        "hasShutdown": false,
        "hasStoreForward": false,
        "hasTakPanel": false,
        "hasTelemetryIntervalConfig": false,
        "hasTraceRoute": true,
        "hasUserManagedContactGroups": true,
        "hasWifiConfig": false,
        "hopLimitRange": [
          1,
          64,
        ],
        "nodeOfflineThresholdMs": 345600000,
        "nodeStaleThresholdMs": 172800000,
        "protocol": "meshcore",
      }
    `);
  });

  it('MESHTASTIC and MESHCORE have different protocol identifiers', () => {
    expect(MESHTASTIC_CAPABILITIES.protocol).toBe('meshtastic');
    expect(MESHCORE_CAPABILITIES.protocol).toBe('meshcore');
  });
});
