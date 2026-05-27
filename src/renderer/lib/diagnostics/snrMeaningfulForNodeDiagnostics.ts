import type { ProtocolCapabilities } from '../radio/BaseRadioProvider';
import type { NodeRecord } from '../../stores/nodeStore';

/**
 * SNR on MeshPacket is the last hop into the client, not link quality to the
 * originator. It is also meaningless for MQTT-only (or stale hybrid) nodes.
 * Use this before any diagnostic that interprets node.snr as "RF to this node."
 *
 * When `capabilities.hasPerHopSnr` is true (MeshCore), SNR comes from tracePath
 * or repeater status — always meaningful, not last-hop ambiguous.
 */
export function snrMeaningfulForNodeDiagnostics(
  node: NodeRecord,
  capabilities?: ProtocolCapabilities,
): boolean {
  // MeshCore SNR comes from tracePath / repeater_status — always meaningful
  if (capabilities?.hasPerHopSnr) return true;
  if (node.heardViaMqttOnly) return false;
  // Hybrid / MQTT-touched nodes may carry stale SNR from before MQTT
  if (node.heardViaMqtt) return false;
  if (node.source === 'mqtt') return false;
  // Only when hop count is explicitly 0. Undefined/null means unknown/stale (panel
  // shows "-" for hops) — do not treat as direct; SNR/RSSI would still be last-hop only.
  if (node.hopsAway !== 0) return false;
  return true;
}
