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
};

export const MESHCORE_CAPABILITIES: ProtocolCapabilities = {
  protocol: 'meshcore',
  hasHopCount: false,
  hopLimitRange: [1, 64],
  hasMqttHybrid: false,
  hasEnvironmentTelemetry: false,
  hasRfStats: false,
  hasNeighborInfo: false,
  hasChannelConfig: false,
  hasModemPresets: false,
  hasTraceRoute: true,
  hasPerHopSnr: true,
  hasBatteryTelemetry: true,
  hasRepeaterStatus: true,
  hasOnDemandNodeStatus: true,
};
