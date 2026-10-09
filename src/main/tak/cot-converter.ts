import type { MeshNode } from '../../renderer/lib/types';
import type { MeshProtocol } from '../../shared/meshProtocol';
import type { TakRelayExtras, TakUnitStyle } from '../../shared/tak-types';
import { escapeXml } from '../../shared/xmlEscape';
import { advertisedTakStyle } from './advertised-style';

/** ATAK hides an event this long after it was sent unless a newer one arrives. */
export const COT_STALE_MS = 10 * 60 * 1000;

/** Bounds on a tracker's own stale window (`stale_sec`). */
const MIN_TRACKER_STALE_MS = 30 * 1000;
const MAX_TRACKER_STALE_MS = 60 * 60 * 1000;

/**
 * CoT uid prefix per protocol. Node ids from the three protocols share one uint32 space,
 * so the prefix keeps a MeshCore node and a Meshtastic node with the same id apart in ATAK.
 */
const COT_UID_PREFIX: Record<MeshProtocol, string> = {
  meshtastic: 'MESH-',
  meshcore: 'MC-',
  reticulum: 'RN-',
};

/** Every uid prefix this app writes; inbound CoT with one of these is our own node echoed back. */
export const COT_UID_PREFIXES: readonly string[] = Object.values(COT_UID_PREFIX);

const PROTOCOL_LABEL: Record<MeshProtocol, string> = {
  meshtastic: 'Meshtastic',
  meshcore: 'MeshCore',
  reticulum: 'Reticulum',
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

export type CotRelayNode = MeshNode & TakRelayExtras;

export interface CotRenderOptions {
  /** Overrides the style the node advertises. */
  style?: TakUnitStyle;
  /** Overrides the callsign derived from the node's names. */
  callsign?: string;
  nowMs?: number;
}

/** The uid a node is sent under; also the identity main caches it by. */
export function cotUidFor(node: { node_id: number; uid?: string }, protocol: MeshProtocol): string {
  return node.uid ?? `${COT_UID_PREFIX[protocol]}${node.node_id}`;
}

/** The callsign a node is labelled with before any filter strips it. */
export function cotCallsignFor(node: CotRelayNode, protocol: MeshProtocol): string {
  return node[CALLSIGN_FIELD[protocol]] || String(node.node_id);
}

/** Feeds report last_heard in seconds (MeshCore, Reticulum) or milliseconds (MQTT). */
function lastHeardMs(lastHeard: number | undefined, nowMs: number): number | undefined {
  if (lastHeard == null || !Number.isFinite(lastHeard) || lastHeard <= 0) return undefined;
  const ms = lastHeard > 1e12 ? lastHeard : lastHeard * 1000;
  return Math.min(ms, nowMs);
}

function hopsOf(node: CotRelayNode): number | undefined {
  const hops = node.hops_away ?? node.hops;
  return hops != null && Number.isInteger(hops) && hops >= 0 ? hops : undefined;
}

/** ATAK reads `<color argb>` as a signed 32-bit integer. */
function hexToArgb(hex: string): number | undefined {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return undefined;
  return 0xff000000 | parseInt(m[1], 16) | 0;
}

function heardRemarks(node: CotRelayNode, protocol: MeshProtocol, heardMs?: number): string {
  const parts: string[] = [];
  if (node.long_name) parts.push(node.long_name);
  const viaMqtt =
    node.source === 'mqtt' || node.heard_via_mqtt_only === true || Boolean(node.via_mqtt);
  parts.push(`Heard via ${PROTOCOL_LABEL[protocol]} ${viaMqtt ? 'MQTT' : 'RF'}`);
  const hops = hopsOf(node);
  if (hops != null) parts.push(hops === 0 ? 'direct' : `${hops} hop${hops === 1 ? '' : 's'}`);
  if (heardMs != null) parts.push(`last heard ${new Date(heardMs).toISOString()}`);
  return parts.join(' | ');
}

function staleWindowMs(node: CotRelayNode): number {
  const s = node.stale_sec;
  if (s == null || !Number.isFinite(s) || s <= 0) return COT_STALE_MS;
  return Math.min(Math.max(s * 1000, MIN_TRACKER_STALE_MS), MAX_TRACKER_STALE_MS);
}

function finite(n: number | undefined): n is number {
  return n != null && Number.isFinite(n);
}

/** Standard CoT delete (`t-x-d-d`) telling TAK clients to remove the marker with `targetUid`. */
export function cotDeleteEvent(targetUid: string, nowMs: number = Date.now()): string {
  const time = new Date(nowMs).toISOString();
  const stale = new Date(nowMs + COT_STALE_MS).toISOString();
  const target = escapeXml(targetUid);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<event version="2.0" uid="${target}-delete-${nowMs}" type="t-x-d-d"` +
    ` time="${time}" start="${time}" stale="${stale}" how="h-g-i-g-o">` +
    `<point lat="0" lon="0" hae="9999999" ce="9999999" le="9999999"/>` +
    `<detail><link uid="${target}" relation="none" type="none"/><__forcedelete/></detail>` +
    `</event>`
  );
}

/**
 * CoT for a relayed node. `time` is when we send it, `start` is when we last heard the node, and
 * `stale` is when ATAK should drop it without a refresh. Returns null without a position.
 */
export function meshNodeToCot(
  node: CotRelayNode,
  protocol: MeshProtocol = 'meshtastic',
  opts: CotRenderOptions = {},
): string | null {
  if (node.latitude == null || node.longitude == null) return null;

  const now = opts.nowMs ?? Date.now();
  const heardMs = lastHeardMs(node.last_heard, now);
  const time = new Date(now).toISOString();
  const start = new Date(heardMs ?? now).toISOString();
  const stale = new Date(now + staleWindowMs(node)).toISOString();
  const style = opts.style ?? advertisedTakStyle(node, protocol);
  const hae = node.altitude ?? 0;
  const uid = escapeXml(cotUidFor(node, protocol));
  const callsign = escapeXml(opts.callsign || cotCallsignFor(node, protocol));
  const remarks = escapeXml(heardRemarks(node, protocol, heardMs));
  const battery = node.battery ?? 0;

  let detail = `<contact callsign="${callsign}"/>`;
  if (style.group || style.role) {
    const name = style.group ? ` name="${escapeXml(style.group)}"` : '';
    const role = style.role ? ` role="${escapeXml(style.role)}"` : '';
    detail += `<__group${name}${role}/>`;
  }
  const argb = style.color ? hexToArgb(style.color) : undefined;
  if (argb != null) detail += `<color argb="${argb}"/>`;
  detail += `<status battery="${battery}"/>`;
  if (finite(node.speed) || finite(node.course)) {
    const course = finite(node.course) ? ` course="${node.course}"` : '';
    const speed = finite(node.speed) ? ` speed="${node.speed}"` : '';
    detail += `<track${course}${speed}/>`;
  }
  detail += `<remarks>${remarks}</remarks>`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<event version="2.0" uid="${uid}" type="${escapeXml(style.cotType)}"` +
    ` time="${time}" start="${start}" stale="${stale}" how="m-g">` +
    `<point lat="${node.latitude}" lon="${node.longitude}"` +
    ` hae="${hae}" ce="9999999" le="9999999"/>` +
    `<detail>${detail}</detail>` +
    `</event>`
  );
}
