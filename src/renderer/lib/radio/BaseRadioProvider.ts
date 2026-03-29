/**
 * Protocol-agnostic capability descriptor. Each radio protocol adapter exposes
 * one of these so UI and diagnostic engines can branch on features rather than
 * on protocol name strings.
 */
export interface ProtocolCapabilities {
  protocol: 'meshtastic' | 'meshcore';
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
  /** Whether the TAK server panel is available (Meshtastic only) */
  hasTakPanel: boolean;
  /** Node stale threshold in milliseconds (for node status UI) */
  nodeStaleThresholdMs: number;
  /** Node offline threshold in milliseconds (for node status UI) */
  nodeOfflineThresholdMs: number;
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
  hasTakPanel: true,
  nodeStaleThresholdMs: 3 * 60 * 60 * 1000, // 3 hours
  nodeOfflineThresholdMs: 24 * 60 * 60 * 1000, // 24 hours
};

export const MESHCORE_CAPABILITIES: ProtocolCapabilities = {
  protocol: 'meshcore',
  hasHopCount: false,
  hopLimitRange: [1, 64],
  /** MeshCore session is RF-first; MQTT bridge is optional and not shown as a node column. */
  hasMqttHybrid: false,
  hasEnvironmentTelemetry: true,
  hasRfStats: false,
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
  hasSecurityPanel: false,
  hasTakPanel: false,
  nodeStaleThresholdMs: 24 * 60 * 60 * 1000, // 24 hours
  nodeOfflineThresholdMs: 48 * 60 * 60 * 1000, // 48 hours
};
