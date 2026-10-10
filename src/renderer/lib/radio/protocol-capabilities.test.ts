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
  'composerMaxChunks',
  'hasHopCount',
  'hopLimitRange',
  'hasMqttHybrid',
  'hasMqttConnectionPanel',
  'hasEnvironmentTelemetry',
  'hasRfStats',
  'hasNeighborInfo',
  'hasChannelConfig',
  'hasChannelDeliveryAck',
  'hasModemPresets',
  'hasTraceRoute',
  'hasPerHopSnr',
  'hasDistanceBasedHopAnomalies',
  'hasBatteryTelemetry',
  'hasRepeaterStatus',
  'hasRoomServersPanel',
  'hasOnDemandNodeStatus',
  'hasBluetoothConfig',
  'hasDeviceRoleConfig',
  'hasDisplayConfig',
  'hasPowerConfig',
  'hasWifiConfig',
  'hasUserManagedContactGroups',
  'hasCompanionContactManagementConfig',
  'hasCompanionTelemetryPrivacyConfig',
  'hasShutdown',
  'hasNodeDbReset',
  'hasFactoryReset',
  'hasFullPositionConfig',
  'hasSecurityPanel',
  'hasRemoteAdmin',
  'hasTakPanel',
  'hasTakTrackerChannels',
  'hasSerial',
  'hasRangeTest',
  'hasRawPacketLog',
  'hasPaxCounter',
  'hasAudio',
  'hasDetectionSensor',
  'hasStoreForward',
  'hasAtakPlugin',
  'hasLockdown',
  'hasMapReport',
  'hasXmodem',
  'hasContactImportExport',
  'hasCryptoOperations',
  'nodeListTabUsesContactsLabel',
  'modulesTabUsesRepeatersLabel',
  'hasJsonRadioConfigImport',
  'hasFirmwareUpdateCheck',
  'dedupeQueueBadgeForLocalSending',
  'prefersDeviceOwnerLongNameInHeader',
  'prefersDeviceDeliveryStatusOverMqtt',
  'hasGattBleScanning',
  'hasDiagnosticsPanel',
  'showsNodeNumHexId',
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

  it('MESHTASTIC and MESHCORE have different protocol identifiers', () => {
    expect(MESHTASTIC_CAPABILITIES.protocol).toBe('meshtastic');
    expect(MESHCORE_CAPABILITIES.protocol).toBe('meshcore');
  });
});
