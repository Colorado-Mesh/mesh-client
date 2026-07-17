/** Pure GPX 1.1 track formatter for position_history rows. */

export interface GpxTrackPoint {
  node_id: number;
  latitude: number;
  longitude: number;
  recorded_at: number;
  name?: string;
}

export const GPX_EXPORT_MAX_POINTS = 50_000;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIsoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Build a GPX 1.1 document with one track per node_id (insertion order of first appearance).
 */
export function formatGpxTracks(
  points: readonly GpxTrackPoint[],
  opts?: { creator?: string },
): string {
  const creator = escapeXml(opts?.creator ?? 'mesh-client');
  const byNode = new Map<number, GpxTrackPoint[]>();
  for (const p of points) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    if (!Number.isFinite(p.recorded_at)) continue;
    const list = byNode.get(p.node_id) ?? [];
    list.push(p);
    byNode.set(p.node_id, list);
  }

  const tracks: string[] = [];
  for (const [nodeId, pts] of byNode) {
    const sorted = [...pts].sort((a, b) => a.recorded_at - b.recorded_at);
    const name = sorted.find((p) => p.name?.trim())?.name?.trim() || `node-${nodeId.toString(16)}`;
    const seg = sorted
      .map(
        (p) =>
          `      <trkpt lat="${p.latitude}" lon="${p.longitude}">\n` +
          `        <time>${toIsoUtc(p.recorded_at)}</time>\n` +
          `      </trkpt>`,
      )
      .join('\n');
    tracks.push(
      `  <trk>\n` +
        `    <name>${escapeXml(name)}</name>\n` +
        `    <trkseg>\n${seg}\n    </trkseg>\n` +
        `  </trk>`,
    );
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="${creator}" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    tracks.join('\n') +
    `\n</gpx>\n`
  );
}
