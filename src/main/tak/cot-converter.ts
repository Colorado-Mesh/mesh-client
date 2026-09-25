import type { MeshNode } from '../../renderer/lib/types';
import type { MeshProtocol } from '../../shared/meshProtocol';
import { escapeXml } from '../../shared/xmlEscape';

const TEN_MINUTES_MS = 10 * 60 * 1000;

/**
 * CoT uid prefix per protocol. Node ids from the three protocols share one uint32 space,
 * so the prefix keeps a MeshCore node and a Meshtastic node with the same id apart in ATAK.
 */
const COT_UID_PREFIX: Record<MeshProtocol, string> = {
  meshtastic: 'MESH-',
  meshcore: 'MC-',
  reticulum: 'RN-',
};

/**
 * Meshtastic nodes advertise a 4-char short name, which fits an ATAK callsign. MeshCore and
 * Reticulum nodes usually leave short_name empty and carry the advert/display name in long_name.
 */
const CALLSIGN_FIELD: Record<MeshProtocol, 'short_name' | 'long_name'> = {
  meshtastic: 'short_name',
  meshcore: 'long_name',
  reticulum: 'long_name',
};

export function meshNodeToCot(
  node: MeshNode,
  protocol: MeshProtocol = 'meshtastic',
): string | null {
  if (node.latitude == null || node.longitude == null) return null;

  const now = Date.now();
  const time = new Date(now).toISOString();
  const stale = new Date(now + TEN_MINUTES_MS).toISOString();
  const hae = node.altitude ?? 0;
  const uid = `${COT_UID_PREFIX[protocol]}${node.node_id}`;
  const callsign = escapeXml(node[CALLSIGN_FIELD[protocol]] || String(node.node_id));
  const remarks = escapeXml(node.long_name || '');
  const battery = node.battery ?? 0;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<event version="2.0" uid="${uid}" type="a-f-G-U-C"` +
    ` time="${time}" start="${time}" stale="${stale}" how="m-g">` +
    `<point lat="${node.latitude}" lon="${node.longitude}"` +
    ` hae="${hae}" ce="9999999" le="9999999"/>` +
    `<detail>` +
    `<contact callsign="${callsign}"/>` +
    `<__group name="Cyan" role="Team Member"/>` +
    `<status battery="${battery}"/>` +
    `<remarks>${remarks}</remarks>` +
    `</detail>` +
    `</event>`
  );
}
