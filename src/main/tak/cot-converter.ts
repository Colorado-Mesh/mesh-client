import type { MeshNode } from '../../renderer/lib/types';

const TEN_MINUTES_MS = 10 * 60 * 1000;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function meshNodeToCot(node: MeshNode): string | null {
  if (node.latitude == null || node.longitude == null) return null;

  const now = Date.now();
  const time = new Date(now).toISOString();
  const stale = new Date(now + TEN_MINUTES_MS).toISOString();
  const hae = node.altitude ?? 0;
  const uid = `MESH-${node.node_id}`;
  const callsign = escapeXml(node.short_name || String(node.node_id));
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
