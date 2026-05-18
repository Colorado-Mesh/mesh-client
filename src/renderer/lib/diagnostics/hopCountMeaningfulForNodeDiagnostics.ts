import type { MeshNode } from '../types';

/**
 * hops_away on MQTT-only nodes reflects distance to the MQTT bridge, not RF hops
 * to this client. Skip hop-based routing diagnostics for those nodes.
 */
export function hopCountMeaningfulForNodeDiagnostics(node: MeshNode): boolean {
  return !node.heard_via_mqtt_only;
}
