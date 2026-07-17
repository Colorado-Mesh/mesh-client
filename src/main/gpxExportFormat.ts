/** Pure GPX 1.1 track formatter for position_history rows. */

import { escapeXml } from '../shared/xmlEscape';

export interface GpxTrackPoint {
  node_id: number;
  latitude: number;
  longitude: number;
  recorded_at: number;
  name?: string;
}

export const GPX_EXPORT_MAX_POINTS = 50_000;

function toIsoUtc(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  // ECMAScript Date valid range roughly ±100M days from epoch.
  if (Math.abs(ms) > 8.64e15) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    // catch-no-log-ok Invalid Date range — skip point in caller.
    return null;
  }
}

function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
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
    if (!Number.isFinite(p.node_id) || !Number.isInteger(p.node_id)) continue;
    if (!isValidLatLon(p.latitude, p.longitude)) continue;
    if (!Number.isFinite(p.recorded_at)) continue;
    if (toIsoUtc(p.recorded_at) == null) continue;
    const list = byNode.get(p.node_id) ?? [];
    list.push(p);
    byNode.set(p.node_id, list);
  }

  const tracks: string[] = [];
  for (const [nodeId, pts] of byNode) {
    const sorted = [...pts].sort((a, b) => a.recorded_at - b.recorded_at);
    const name = sorted.find((p) => p.name?.trim())?.name?.trim() || `node-${nodeId.toString(16)}`;
    const seg = sorted
      .map((p) => {
        const time = toIsoUtc(p.recorded_at);
        if (!time) return null;
        return (
          `      <trkpt lat="${p.latitude}" lon="${p.longitude}">\n` +
          `        <time>${time}</time>\n` +
          `      </trkpt>`
        );
      })
      .filter((line): line is string => line != null)
      .join('\n');
    if (!seg) continue;
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
