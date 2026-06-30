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
import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from './BaseRadioProvider';

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
  'hasRoomServersPanel',
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
  'hasRemoteAdmin',
  'hasTakPanel',
  'hasRemoteHardware',
  'hasSerial',
  'hasRangeTest',
  'hasRawPacketLog',
  'hasPaxCounter',
  'hasAudio',
  'hasIpTunnel',
  'hasDetectionSensor',
  'hasStoreForward',
  'hasAtakPlugin',
  'hasMapReport',
  'hasXmodem',
  'hasContactImportExport',
  'hasCryptoOperations',
  'nodeListTabUsesContactsLabel',
  'nodeListTabUsesPeersLabel',
  'modulesTabUsesRepeatersLabel',
  'hasJsonRadioConfigImport',
  'hasFirmwareUpdateCheck',
  'dedupeQueueBadgeForLocalSending',
  'prefersDeviceOwnerLongNameInHeader',
  'hasReticulumInterfaceConfig',
  'hasReticulumNetworkPanel',
  'hasReticulumRadioPanel',
  'hasLxmfAttachments',
  'hasRNodeFlasher',
  'hasReticulumPeersList',
  'hasReticulumNativeDiagnostics',
  'hasLxmfDeliveryStatus',
  'hasReticulumPeerDetailModal',
  'hasDiagnosticsPanel',
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
        "dedupeQueueBadgeForLocalSending": true,
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
        "hasDiagnosticsPanel": true,
        "hasDisplayConfig": true,
        "hasEnvironmentTelemetry": true,
        "hasFactoryReset": true,
        "hasFirmwareUpdateCheck": true,
        "hasFullPositionConfig": true,
        "hasHopCount": true,
        "hasIpTunnel": true,
        "hasJsonRadioConfigImport": false,
        "hasLxmfAttachments": false,
        "hasLxmfDeliveryStatus": false,
        "hasMapReport": true,
        "hasModemPresets": true,
        "hasMqttHybrid": true,
        "hasNeighborInfo": true,
        "hasNodeDbReset": true,
        "hasOnDemandNodeStatus": false,
        "hasPaxCounter": true,
        "hasPerHopSnr": false,
        "hasPowerConfig": true,
        "hasRNodeFlasher": false,
        "hasRangeTest": true,
        "hasRawPacketLog": true,
        "hasRemoteAdmin": true,
        "hasRemoteHardware": true,
        "hasRepeaterStatus": false,
        "hasReticulumInterfaceConfig": false,
        "hasReticulumNativeDiagnostics": false,
        "hasReticulumNetworkPanel": false,
        "hasReticulumPeerDetailModal": false,
        "hasReticulumPeersList": false,
        "hasReticulumRadioPanel": false,
        "hasRfStats": true,
        "hasRoomServersPanel": false,
        "hasSecurityPanel": true,
        "hasSerial": true,
        "hasShutdown": true,
        "hasStoreForward": true,
        "hasTakPanel": true,
        "hasTelemetryIntervalConfig": true,
        "hasTraceRoute": true,
        "hasUserManagedContactGroups": true,
        "hasWifiConfig": true,
        "hasXmodem": true,
        "hopLimitRange": [
          1,
          7,
        ],
        "modulesTabUsesRepeatersLabel": false,
        "nodeListTabUsesContactsLabel": false,
        "nodeListTabUsesPeersLabel": false,
        "nodeOfflineThresholdMs": 604800000,
        "nodeStaleThresholdMs": 7200000,
        "prefersDeviceOwnerLongNameInHeader": false,
        "protocol": "meshtastic",
      }
    `);
  });

  it('MESHCORE_CAPABILITIES exact values are stable', () => {
    expect(MESHCORE_CAPABILITIES).toMatchInlineSnapshot(`
      {
        "dedupeQueueBadgeForLocalSending": false,
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
        "hasDiagnosticsPanel": true,
        "hasDisplayConfig": false,
        "hasEnvironmentTelemetry": true,
        "hasFactoryReset": false,
        "hasFirmwareUpdateCheck": true,
        "hasFullPositionConfig": false,
        "hasHopCount": true,
        "hasIpTunnel": false,
        "hasJsonRadioConfigImport": true,
        "hasLxmfAttachments": false,
        "hasLxmfDeliveryStatus": false,
        "hasMapReport": false,
        "hasModemPresets": false,
        "hasMqttHybrid": false,
        "hasNeighborInfo": false,
        "hasNodeDbReset": false,
        "hasOnDemandNodeStatus": true,
        "hasPaxCounter": false,
        "hasPerHopSnr": true,
        "hasPowerConfig": false,
        "hasRNodeFlasher": false,
        "hasRangeTest": false,
        "hasRawPacketLog": true,
        "hasRemoteAdmin": false,
        "hasRemoteHardware": false,
        "hasRepeaterStatus": true,
        "hasReticulumInterfaceConfig": false,
        "hasReticulumNativeDiagnostics": false,
        "hasReticulumNetworkPanel": false,
        "hasReticulumPeerDetailModal": false,
        "hasReticulumPeersList": false,
        "hasReticulumRadioPanel": false,
        "hasRfStats": true,
        "hasRoomServersPanel": true,
        "hasSecurityPanel": true,
        "hasSerial": false,
        "hasShutdown": false,
        "hasStoreForward": false,
        "hasTakPanel": false,
        "hasTelemetryIntervalConfig": false,
        "hasTraceRoute": true,
        "hasUserManagedContactGroups": true,
        "hasWifiConfig": false,
        "hasXmodem": false,
        "hopLimitRange": [
          1,
          64,
        ],
        "modulesTabUsesRepeatersLabel": true,
        "nodeListTabUsesContactsLabel": true,
        "nodeListTabUsesPeersLabel": false,
        "nodeOfflineThresholdMs": 345600000,
        "nodeStaleThresholdMs": 172800000,
        "prefersDeviceOwnerLongNameInHeader": true,
        "protocol": "meshcore",
      }
    `);
  });

  it('RETICULUM_CAPABILITIES has all required keys', () => {
    for (const key of REQUIRED_CAPABILITY_KEYS) {
      expect(RETICULUM_CAPABILITIES).toHaveProperty(key);
    }
  });

  it('RETICULUM_CAPABILITIES exact values are stable', () => {
    expect(RETICULUM_CAPABILITIES).toMatchInlineSnapshot(`
      {
        "dedupeQueueBadgeForLocalSending": false,
        "hasAtakPlugin": false,
        "hasAudio": false,
        "hasBatteryTelemetry": false,
        "hasBluetoothConfig": false,
        "hasChannelConfig": false,
        "hasCompanionContactManagementConfig": false,
        "hasCompanionTelemetryPrivacyConfig": false,
        "hasContactImportExport": false,
        "hasCryptoOperations": false,
        "hasDetectionSensor": false,
        "hasDeviceRoleConfig": false,
        "hasDiagnosticsPanel": true,
        "hasDisplayConfig": false,
        "hasEnvironmentTelemetry": false,
        "hasFactoryReset": false,
        "hasFirmwareUpdateCheck": false,
        "hasFullPositionConfig": false,
        "hasHopCount": false,
        "hasIpTunnel": false,
        "hasJsonRadioConfigImport": true,
        "hasLxmfAttachments": true,
        "hasLxmfDeliveryStatus": true,
        "hasMapReport": false,
        "hasModemPresets": false,
        "hasMqttHybrid": false,
        "hasNeighborInfo": true,
        "hasNodeDbReset": false,
        "hasOnDemandNodeStatus": false,
        "hasPaxCounter": false,
        "hasPerHopSnr": false,
        "hasPowerConfig": false,
        "hasRNodeFlasher": true,
        "hasRangeTest": false,
        "hasRawPacketLog": false,
        "hasRemoteAdmin": false,
        "hasRemoteHardware": false,
        "hasRepeaterStatus": true,
        "hasReticulumInterfaceConfig": true,
        "hasReticulumNativeDiagnostics": true,
        "hasReticulumNetworkPanel": true,
        "hasReticulumPeerDetailModal": true,
        "hasReticulumPeersList": true,
        "hasReticulumRadioPanel": true,
        "hasRfStats": false,
        "hasRoomServersPanel": false,
        "hasSecurityPanel": false,
        "hasSerial": false,
        "hasShutdown": false,
        "hasStoreForward": false,
        "hasTakPanel": false,
        "hasTelemetryIntervalConfig": false,
        "hasTraceRoute": true,
        "hasUserManagedContactGroups": true,
        "hasWifiConfig": false,
        "hasXmodem": false,
        "hopLimitRange": [
          1,
          128,
        ],
        "lxmfPayloadLimit": 4096,
        "modulesTabUsesRepeatersLabel": false,
        "nodeListTabUsesContactsLabel": false,
        "nodeListTabUsesPeersLabel": true,
        "nodeOfflineThresholdMs": 2592000000,
        "nodeStaleThresholdMs": 604800000,
        "prefersDeviceOwnerLongNameInHeader": false,
        "protocol": "reticulum",
      }
    `);
  });

  it('MESHTASTIC and MESHCORE have different protocol identifiers', () => {
    expect(MESHTASTIC_CAPABILITIES.protocol).toBe('meshtastic');
    expect(MESHCORE_CAPABILITIES.protocol).toBe('meshcore');
  });
});
