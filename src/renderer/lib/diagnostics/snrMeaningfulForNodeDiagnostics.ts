import type { MeshNode } from '../types';

/**
 * SNR on MeshPacket is the last hop into the client, not link quality to the
 * originator. It is also meaningless for MQTT-only (or stale hybrid) nodes.
 * Use this before any diagnostic that interprets node.snr as "RF to this node."
 */
export function snrMeaningfulForNodeDiagnostics(node: MeshNode): boolean {
  if (node.heard_via_mqtt_only) return false;
  // Hybrid / MQTT-touched nodes may carry stale SNR from before MQTT
  if (node.heard_via_mqtt) return false;
  if (node.source === 'mqtt') return false;
  // Only when hop count is explicitly 0. Undefined/null means unknown/stale (panel
  // shows "-" for hops) — do not treat as direct; SNR/RSSI would still be last-hop only.
  if (node.hops_away !== 0) return false;
  return true;
}
