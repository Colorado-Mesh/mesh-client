import type { MeshProtocol } from '@/shared/meshProtocol';

import { RETICULUM_LXMF_PAYLOAD_LIMIT } from '../chatComposerLimits';

/**
 * Protocol-agnostic capability descriptor. Each radio protocol adapter exposes
 * one of these so UI and diagnostic engines can branch on features rather than
 * on protocol name strings.
 */
export interface ProtocolCapabilities {
  protocol: MeshProtocol;
  /** Whether hops_away is populated for peers (Meshtastic: true; MeshCore: false) */
  hasHopCount: boolean;
  /** [min, max] valid hop limit for this protocol */
  hopLimitRange: [number, number];
  /** Whether MQTT hybrid / MQTT-only nodes can appear in the node list */
  hasMqttHybrid: boolean;
  /** Whether environment sensor telemetry (temp, humidity, pressure, IAQ) is available */
  hasEnvironmentTelemetry: boolean;
  /** Whether LocalStats RF diagnostics (channel_utilization, air_util_tx, rx_bad, rx_dupe) are available */
  hasRfStats: boolean;
  /** Whether neighbor info packets are available */
  hasNeighborInfo: boolean;
  /** Whether channel / modem config can be read and written */
  hasChannelConfig: boolean;
  /** Whether named modem presets are supported */
  hasModemPresets: boolean;
  /** Whether trace route is available */
  hasTraceRoute: boolean;
  /** Whether per-hop SNR from tracePath is available (MeshCore unique strength) */
  hasPerHopSnr: boolean;
  /** Whether battery level / voltage telemetry is available */
  hasBatteryTelemetry: boolean;
  /** Whether repeater status (noise floor, air time, packet counts) is available */
  hasRepeaterStatus: boolean;
  /** Whether on-demand node status queries are supported */
  hasOnDemandNodeStatus: boolean;
  /** Whether Bluetooth config (enabled toggle, PIN) is available */
  hasBluetoothConfig: boolean;
  /** Whether device role selector is available */
  hasDeviceRoleConfig: boolean;
  /** Whether display config (screen on duration, units) is available */
  hasDisplayConfig: boolean;
  /** Whether power config (sleep timers, battery shutdown) is available */
  hasPowerConfig: boolean;
  /** Whether WiFi / Ethernet network config is available */
  hasWifiConfig: boolean;
  /** Whether telemetry device metrics update interval config is available */
  hasTelemetryIntervalConfig: boolean;
  /** User-defined contact groups + built-in filters on the Nodes/Contacts list */
  hasUserManagedContactGroups: boolean;
  /** MeshCore companion: contact auto-add / manual mode and related Radio UI */
  hasCompanionContactManagementConfig: boolean;
  /** MeshCore companion: telemetry request / location / environment privacy (NodePrefs telemetry modes) */
  hasCompanionTelemetryPrivacyConfig: boolean;
  /** Whether shutdown button is available */
  hasShutdown: boolean;
  /** Whether Reset NodeDB button is available */
  hasNodeDbReset: boolean;
  /** Whether factory reset buttons are available */
  hasFactoryReset: boolean;
  /** Whether full GPS position config is available; false = fixed lat/lon only */
  hasFullPositionConfig: boolean;
  /** Whether Security panel (PKI config) is available */
  hasSecurityPanel: boolean;
  /** Whether PKC remote node administration is available (Meshtastic 2.5+) */
  hasRemoteAdmin: boolean;
  /** Whether the TAK server panel is available (Meshtastic only) */
  hasTakPanel: boolean;
  /** Whether Remote Hardware (GPIO) control is available */
  hasRemoteHardware: boolean;
  /** Whether Serial Bridge is available */
  hasSerial: boolean;
  /** Whether Range Test packets are available */
  hasRangeTest: boolean;
  /** Whether Pax Counter (people counter) is available */
  hasPaxCounter: boolean;
  /** Whether Audio packets are available */
  hasAudio: boolean;
  /** Whether IP Tunnel is available */
  hasIpTunnel: boolean;
  /** Whether Detection Sensor packets are available */
  hasDetectionSensor: boolean;
  /** Whether Store & Forward is available */
  hasStoreForward: boolean;
  /** Whether ATAK Plugin integration is available */
  hasAtakPlugin: boolean;
  /** Whether Map Report packets are available */
  hasMapReport: boolean;
  /** Whether XMODEM file transfer is available (Meshtastic local radio) */
  hasXmodem: boolean;
  /** Whether contact import/export is available (MeshCore) */
  hasContactImportExport: boolean;
  /** Whether cryptographic signing/key export is available (MeshCore) */
  hasCryptoOperations: boolean;
  /** Whether the raw RF packet log viewer is available (MeshCore LOG_RX_DATA) */
  hasRawPacketLog: boolean;
  /** Node list tab label uses "Contacts" instead of "Nodes" */
  nodeListTabUsesContactsLabel: boolean;
  /** Node list tab label uses "Peers" instead of "Nodes" (Reticulum) */
  nodeListTabUsesPeersLabel: boolean;
  /** Modules tab shows repeater tooling (MeshCore "Repeaters" tab slot) */
  modulesTabUsesRepeatersLabel: boolean;
  /** Dedicated Rooms tab for MeshCore room server BBS */
  hasRoomServersPanel: boolean;
  /** Radio panel: import JSON device config (MeshCore companion) */
  hasJsonRadioConfigImport: boolean;
  /** Node stale threshold in milliseconds (for node status UI) */
  nodeStaleThresholdMs: number;
  /** Node offline threshold in milliseconds (for node status UI) */
  nodeOfflineThresholdMs: number;
  /** Whether Connection panel shows firmware update check on connect */
  hasFirmwareUpdateCheck: boolean;
  /** Meshtastic: hide queue badge count of 1 while a local message is still sending */
  dedupeQueueBadgeForLocalSending: boolean;
  /** Header self-node label prefers deviceOwner.longName over picker label */
  prefersDeviceOwnerLongNameInHeader: boolean;
  /** Meshtastic-centric routing/RF diagnostics (Hop Goblins, CU, foreign LoRa). */
  hasDiagnosticsPanel: boolean;
  /** Reticulum: Connection panel interface editor (TCP, Auto, serial) */
  hasReticulumInterfaceConfig: boolean;
  /** Reticulum: network / peers visibility panel */
  hasReticulumNetworkPanel: boolean;
  /** Reticulum: Radio tab (identity, interfaces, config) */
  hasReticulumRadioPanel: boolean;
  /** Reticulum: LXMF file/image attachments in chat */
  hasLxmfAttachments: boolean;
  /** Reticulum: RNode firmware flasher on Radio tab */
  hasRNodeFlasher: boolean;
  /** Reticulum: dedicated Peers list panel on tab 2 */
  hasReticulumPeersList: boolean;
  /** Reticulum: ping panel on Diagnostics tab */
  hasReticulumNativeDiagnostics: boolean;
  /** Reticulum: dedicated network topology tab */
  hasReticulumTopologyPanel: boolean;
  /** Reticulum: LXMF delivery status badge on chat messages */
  hasLxmfDeliveryStatus: boolean;
  /** Reticulum: dedicated peer detail modal (hash-based peers) */
  hasReticulumPeerDetailModal: boolean;
  /** Reticulum: Nomad Network sidebar tab */
  hasNomadNetworkPanel: boolean;
  /** Reticulum: Administration tab (flasher, factory reset) */
  hasReticulumAdminPanel: boolean;
  /** DM composer payload limit (Reticulum LXMF only) */
  lxmfPayloadLimit?: number;
}

export const MESHTASTIC_CAPABILITIES: ProtocolCapabilities = {
  protocol: 'meshtastic',
  hasHopCount: true,
  hopLimitRange: [1, 7],
  hasMqttHybrid: true,
  hasEnvironmentTelemetry: true,
  hasRfStats: true,
  hasNeighborInfo: true,
  hasChannelConfig: true,
  hasModemPresets: true,
  hasTraceRoute: true,
  hasPerHopSnr: false,
  hasBatteryTelemetry: true,
  hasRepeaterStatus: false,
  hasOnDemandNodeStatus: false,
  hasBluetoothConfig: true,
  hasDeviceRoleConfig: true,
  hasDisplayConfig: true,
  hasPowerConfig: true,
  hasWifiConfig: true,
  hasTelemetryIntervalConfig: true,
  hasUserManagedContactGroups: true,
  hasCompanionContactManagementConfig: false,
  hasCompanionTelemetryPrivacyConfig: false,
  hasShutdown: true,
  hasNodeDbReset: true,
  hasFactoryReset: true,
  hasFullPositionConfig: true,
  hasSecurityPanel: true,
  hasRemoteAdmin: true,
  hasTakPanel: true,
  hasRemoteHardware: true,
  hasSerial: true,
  hasRangeTest: true,
  hasPaxCounter: true,
  hasAudio: true,
  hasIpTunnel: true,
  hasDetectionSensor: true,
  hasStoreForward: true,
  hasAtakPlugin: true,
  hasMapReport: true,
  hasXmodem: true,
  hasContactImportExport: false,
  hasCryptoOperations: true,
  hasRawPacketLog: true,
  nodeListTabUsesContactsLabel: false,
  nodeListTabUsesPeersLabel: false,
  modulesTabUsesRepeatersLabel: false,
  hasRoomServersPanel: false,
  hasJsonRadioConfigImport: false,
  nodeStaleThresholdMs: 2 * 60 * 60 * 1000, // 2 hours
  nodeOfflineThresholdMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  hasFirmwareUpdateCheck: true,
  dedupeQueueBadgeForLocalSending: true,
  prefersDeviceOwnerLongNameInHeader: false,
  hasDiagnosticsPanel: true,
  hasReticulumInterfaceConfig: false,
  hasReticulumNetworkPanel: false,
  hasReticulumRadioPanel: false,
  hasLxmfAttachments: false,
  hasRNodeFlasher: false,
  hasReticulumPeersList: false,
  hasReticulumNativeDiagnostics: false,
  hasReticulumTopologyPanel: false,
  hasLxmfDeliveryStatus: false,
  hasReticulumPeerDetailModal: false,
  hasNomadNetworkPanel: false,
  hasReticulumAdminPanel: false,
};

export const MESHCORE_CAPABILITIES: ProtocolCapabilities = {
  protocol: 'meshcore',
  hasHopCount: true,
  hopLimitRange: [1, 64],
  /** MeshCore session is RF-first; MQTT bridge is optional and not shown as a node column. */
  hasMqttHybrid: false,
  hasEnvironmentTelemetry: true,
  hasRfStats: true,
  hasNeighborInfo: false,
  hasChannelConfig: false,
  hasModemPresets: false,
  hasTraceRoute: true,
  hasPerHopSnr: true,
  hasBatteryTelemetry: true,
  hasRepeaterStatus: true,
  hasOnDemandNodeStatus: true,
  hasBluetoothConfig: false,
  hasDeviceRoleConfig: false,
  hasDisplayConfig: false,
  hasPowerConfig: false,
  hasWifiConfig: false,
  hasTelemetryIntervalConfig: false,
  hasUserManagedContactGroups: true,
  hasCompanionContactManagementConfig: true,
  hasCompanionTelemetryPrivacyConfig: true,
  hasShutdown: false,
  hasNodeDbReset: false,
  hasFactoryReset: false,
  hasFullPositionConfig: false,
  hasSecurityPanel: true,
  hasRemoteAdmin: false,
  hasTakPanel: false,
  hasRemoteHardware: false,
  hasSerial: false,
  hasRangeTest: false,
  hasPaxCounter: false,
  hasAudio: false,
  hasIpTunnel: false,
  hasDetectionSensor: false,
  hasStoreForward: false,
  hasAtakPlugin: false,
  hasMapReport: false,
  hasXmodem: false,
  hasContactImportExport: true,
  hasCryptoOperations: true,
  hasRawPacketLog: true,
  nodeListTabUsesContactsLabel: true,
  nodeListTabUsesPeersLabel: false,
  modulesTabUsesRepeatersLabel: true,
  hasRoomServersPanel: true,
  hasJsonRadioConfigImport: true,
  nodeStaleThresholdMs: 48 * 60 * 60 * 1000, // 48 hours
  nodeOfflineThresholdMs: 96 * 60 * 60 * 1000, // 96 hours
  hasFirmwareUpdateCheck: true,
  dedupeQueueBadgeForLocalSending: false,
  prefersDeviceOwnerLongNameInHeader: true,
  hasDiagnosticsPanel: true,
  hasReticulumInterfaceConfig: false,
  hasReticulumNetworkPanel: false,
  hasReticulumRadioPanel: false,
  hasLxmfAttachments: false,
  hasRNodeFlasher: false,
  hasReticulumPeersList: false,
  hasReticulumNativeDiagnostics: false,
  hasReticulumTopologyPanel: false,
  hasLxmfDeliveryStatus: false,
  hasReticulumPeerDetailModal: false,
  hasNomadNetworkPanel: false,
  hasReticulumAdminPanel: false,
};

export const RETICULUM_CAPABILITIES: ProtocolCapabilities = {
  protocol: 'reticulum',
  hasHopCount: false,
  hopLimitRange: [1, 128],
  hasMqttHybrid: false,
  hasEnvironmentTelemetry: false,
  hasRfStats: false,
  hasNeighborInfo: false,
  hasChannelConfig: false,
  hasModemPresets: false,
  hasTraceRoute: true,
  hasPerHopSnr: false,
  hasBatteryTelemetry: false,
  hasRepeaterStatus: true,
  hasOnDemandNodeStatus: false,
  hasBluetoothConfig: false,
  hasDeviceRoleConfig: false,
  hasDisplayConfig: false,
  hasPowerConfig: false,
  hasWifiConfig: false,
  hasTelemetryIntervalConfig: false,
  hasUserManagedContactGroups: true,
  hasCompanionContactManagementConfig: false,
  hasCompanionTelemetryPrivacyConfig: false,
  hasShutdown: false,
  hasNodeDbReset: false,
  hasFactoryReset: false,
  hasFullPositionConfig: false,
  hasSecurityPanel: false,
  hasRemoteAdmin: false,
  hasTakPanel: false,
  hasRemoteHardware: false,
  hasSerial: false,
  hasRangeTest: false,
  hasPaxCounter: false,
  hasAudio: false,
  hasIpTunnel: false,
  hasDetectionSensor: false,
  hasStoreForward: false,
  hasAtakPlugin: false,
  hasMapReport: false,
  hasXmodem: false,
  hasContactImportExport: false,
  hasCryptoOperations: false,
  hasRawPacketLog: true,
  nodeListTabUsesContactsLabel: false,
  nodeListTabUsesPeersLabel: true,
  modulesTabUsesRepeatersLabel: false,
  hasRoomServersPanel: false,
  hasJsonRadioConfigImport: true,
  nodeStaleThresholdMs: 7 * 24 * 60 * 60 * 1000,
  nodeOfflineThresholdMs: 30 * 24 * 60 * 60 * 1000,
  hasFirmwareUpdateCheck: false,
  dedupeQueueBadgeForLocalSending: false,
  prefersDeviceOwnerLongNameInHeader: false,
  hasDiagnosticsPanel: true,
  hasReticulumInterfaceConfig: true,
  hasReticulumNetworkPanel: true,
  hasReticulumRadioPanel: true,
  hasLxmfAttachments: true,
  hasRNodeFlasher: true,
  hasReticulumPeersList: true,
  hasReticulumNativeDiagnostics: true,
  hasReticulumTopologyPanel: true,
  hasLxmfDeliveryStatus: true,
  hasReticulumPeerDetailModal: true,
  hasNomadNetworkPanel: true,
  hasReticulumAdminPanel: true,
  lxmfPayloadLimit: RETICULUM_LXMF_PAYLOAD_LIMIT,
};
