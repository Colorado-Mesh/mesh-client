import type { MeshProtocol } from '@/shared/meshProtocol';
import { MS_PER_DAY, MS_PER_HOUR } from '@/shared/timeConstants';

/**
 * Protocol-agnostic capability descriptor. Each radio protocol adapter exposes
 * one of these so UI and diagnostic engines can branch on features rather than
 * on protocol name strings.
 */
export interface ProtocolCapabilities {
  protocol: MeshProtocol;
  /**
   * Max `[i/N]` chunks the composer may emit per outbound text send.
   * MeshCore is 1 (single-packet; no multi-split). Meshtastic uses 9
   * (keep in sync with `MAX_CHUNKS` in `chatComposerLimits.ts`).
   */
  composerMaxChunks: number;
  /** Whether hops_away is populated for peers (Meshtastic / MeshCore: true) */
  hasHopCount: boolean;
  /** [min, max] valid hop limit for this protocol */
  hopLimitRange: [number, number];
  /** Whether MQTT hybrid / MQTT-only nodes can appear in the node list */
  hasMqttHybrid: boolean;
  /** Whether the Connection panel exposes MQTT connect/disconnect UI and header status */
  hasMqttConnectionPanel: boolean;
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
  /**
   * Whether GPS+hop distance heuristics (hop_goblin, close-in bad_route warning) apply.
   * Meshtastic: true. MeshCore: false — multi-hop nearby contacts are poorly connected /
   * repeater-mediated, not Meshtastic-style critical over-hopping.
   */
  hasDistanceBasedHopAnomalies: boolean;
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
  /** Whether the TAK panel (local CoT server + remote relay) is available */
  hasTakPanel: boolean;
  /** Whether channel `!MT1` tracker fixes can feed TAK markers (MeshCore tracker firmware) */
  hasTakTrackerChannels: boolean;
  /** Whether Serial Bridge is available */
  hasSerial: boolean;
  /** Whether Range Test packets are available */
  hasRangeTest: boolean;
  /** Whether Pax Counter (people counter) is available */
  hasPaxCounter: boolean;
  /** Whether Audio packets are available */
  hasAudio: boolean;
  /** Whether Detection Sensor packets are available */
  hasDetectionSensor: boolean;
  /** Whether Store & Forward is available */
  hasStoreForward: boolean;
  /** Whether ATAK Plugin integration is available */
  hasAtakPlugin: boolean;
  /** Whether the firmware reports lockdown status and accepts LockdownAuth (Meshtastic) */
  hasLockdown: boolean;
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
  /**
   * Chat: when an own message has both device `status` and `mqttStatus`, show only the
   * device badge (MeshCore — MQTT ✓ was masking RF heard-by). Meshtastic keeps dual badges.
   */
  prefersDeviceDeliveryStatusOverMqtt: boolean;
  /**
   * Channel (group) sends get a delivery signal that can fail (Meshtastic implicit ACK). MeshCore
   * channel floods only report companion accept, so failed-send auto-resend skips them.
   */
  hasChannelDeliveryAck: boolean;
  /** Meshtastic-centric routing/RF diagnostics (Hop Goblins, CU, foreign LoRa). */
  hasDiagnosticsPanel: boolean;
  /**
   * Whether peers have short numeric node ids shown as `!xxxxxxxx` (Meshtastic only).
   * MeshCore ids are pubkey-derived; UI shows names and opens detail on click.
   */
  showsNodeNumHexId: boolean;
  /** Whether Cancel/disconnect should stop GATT BLE scanning (Meshtastic/MeshCore). */
  hasGattBleScanning: boolean;
}

export const MESHTASTIC_CAPABILITIES: ProtocolCapabilities = {
  protocol: 'meshtastic',
  composerMaxChunks: 9,
  hasHopCount: true,
  hopLimitRange: [1, 7],
  hasMqttHybrid: true,
  hasMqttConnectionPanel: true,
  hasEnvironmentTelemetry: true,
  hasRfStats: true,
  hasNeighborInfo: true,
  hasChannelConfig: true,
  hasModemPresets: true,
  hasTraceRoute: true,
  hasPerHopSnr: false,
  hasDistanceBasedHopAnomalies: true,
  hasBatteryTelemetry: true,
  hasRepeaterStatus: false,
  hasOnDemandNodeStatus: false,
  hasBluetoothConfig: true,
  hasDeviceRoleConfig: true,
  hasDisplayConfig: true,
  hasPowerConfig: true,
  hasWifiConfig: true,
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
  hasTakTrackerChannels: false,
  hasSerial: true,
  hasRangeTest: true,
  hasPaxCounter: true,
  hasAudio: true,
  hasDetectionSensor: true,
  hasStoreForward: true,
  hasAtakPlugin: true,
  hasLockdown: true,
  hasMapReport: true,
  hasXmodem: true,
  hasContactImportExport: false,
  hasCryptoOperations: true,
  hasRawPacketLog: true,
  nodeListTabUsesContactsLabel: false,
  modulesTabUsesRepeatersLabel: false,
  hasRoomServersPanel: false,
  hasJsonRadioConfigImport: false,
  nodeStaleThresholdMs: 2 * MS_PER_HOUR,
  nodeOfflineThresholdMs: 7 * MS_PER_DAY,
  hasFirmwareUpdateCheck: true,
  dedupeQueueBadgeForLocalSending: true,
  prefersDeviceOwnerLongNameInHeader: false,
  prefersDeviceDeliveryStatusOverMqtt: false,
  hasChannelDeliveryAck: true,
  hasDiagnosticsPanel: true,
  showsNodeNumHexId: true,
  hasGattBleScanning: true,
};

export const MESHCORE_CAPABILITIES: ProtocolCapabilities = {
  protocol: 'meshcore',
  composerMaxChunks: 1,
  hasHopCount: true,
  hopLimitRange: [1, 64],
  /** MeshCore session is RF-first; MQTT bridge is optional and not shown as a node column. */
  hasMqttHybrid: false,
  hasMqttConnectionPanel: true,
  hasEnvironmentTelemetry: true,
  hasRfStats: true,
  hasNeighborInfo: false,
  hasChannelConfig: false,
  hasModemPresets: false,
  hasTraceRoute: true,
  hasPerHopSnr: true,
  hasDistanceBasedHopAnomalies: false,
  hasBatteryTelemetry: true,
  hasRepeaterStatus: true,
  hasOnDemandNodeStatus: true,
  hasBluetoothConfig: false,
  hasDeviceRoleConfig: false,
  hasDisplayConfig: false,
  hasPowerConfig: false,
  hasWifiConfig: false,
  hasUserManagedContactGroups: true,
  hasCompanionContactManagementConfig: true,
  hasCompanionTelemetryPrivacyConfig: true,
  hasShutdown: false,
  hasNodeDbReset: false,
  hasFactoryReset: false,
  hasFullPositionConfig: false,
  hasSecurityPanel: true,
  hasRemoteAdmin: false,
  hasTakPanel: true,
  hasTakTrackerChannels: true,
  hasSerial: false,
  hasRangeTest: false,
  hasPaxCounter: false,
  hasAudio: false,
  hasDetectionSensor: false,
  hasStoreForward: false,
  hasAtakPlugin: false,
  hasLockdown: false,
  hasMapReport: false,
  hasXmodem: false,
  hasContactImportExport: true,
  hasCryptoOperations: true,
  hasRawPacketLog: true,
  nodeListTabUsesContactsLabel: true,
  modulesTabUsesRepeatersLabel: true,
  hasRoomServersPanel: true,
  hasJsonRadioConfigImport: true,
  nodeStaleThresholdMs: 48 * MS_PER_HOUR,
  nodeOfflineThresholdMs: 96 * MS_PER_HOUR,
  hasFirmwareUpdateCheck: true,
  dedupeQueueBadgeForLocalSending: false,
  prefersDeviceOwnerLongNameInHeader: true,
  prefersDeviceDeliveryStatusOverMqtt: true,
  hasChannelDeliveryAck: false,
  hasDiagnosticsPanel: true,
  showsNodeNumHexId: false,
  hasGattBleScanning: true,
};
