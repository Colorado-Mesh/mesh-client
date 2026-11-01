import type { MeshProtocol } from '@/renderer/lib/types';

export interface MecpLoraEndpoint {
  protocol: 'meshtastic' | 'meshcore';
  channelIndex: number;
}

/**
 * Reticulum has no numbered channels. An endpoint is either an RRC hub room (`kind: 'rrc'`) or an
 * LXMF peer (`kind: 'lxmf'`, direct message to `destinationHash`). As a rule's *source* an LXMF
 * endpoint matches inbound traffic from that peer (`'*'` = any peer); as a *destination* it must
 * be a concrete 32-hex hash. RRC endpoints are destination-only today (inbound RRC rooms are not
 * fed through the MECP watcher).
 */
export interface MecpReticulumRrcEndpoint {
  protocol: 'reticulum';
  kind: 'rrc';
  hubDestHash: string;
  room: string;
}

export interface MecpReticulumLxmfEndpoint {
  protocol: 'reticulum';
  kind: 'lxmf';
  destinationHash: string;
}

export type MecpReticulumEndpoint = MecpReticulumRrcEndpoint | MecpReticulumLxmfEndpoint;

export type MecpRebroadcastEndpoint = MecpLoraEndpoint | MecpReticulumEndpoint;

export const MECP_REBROADCAST_ANY_PEER = '*';

const HEX32_RE = /^[0-9a-f]{32}$/;
const RRC_ROOM_MAX = 64;

export interface MecpRebroadcastRule {
  id: string;
  enabled: boolean;
  /** When false (default): A → B only. When true: also B → A. */
  bidirectional: boolean;
  endpointA: MecpRebroadcastEndpoint;
  endpointB: MecpRebroadcastEndpoint;
}

export const MECP_REBROADCAST_SETTINGS_KEY = 'mecpRebroadcastRules';

const FINGERPRINT_TTL_MS = 8 * 60 * 1000;
const fingerprintSeenAt = new Map<string, number>();

export function createEmptyMecpRebroadcastRules(): MecpRebroadcastRule[] {
  return [];
}

export function parseMecpRebroadcastRules(raw: unknown): MecpRebroadcastRule[] {
  if (!Array.isArray(raw)) return [];
  const out: MecpRebroadcastRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const endpointA = parseEndpoint(o.endpointA);
    const endpointB = parseEndpoint(o.endpointB);
    if (!endpointA || !endpointB) continue;
    if (typeof o.id !== 'string' || !o.id) continue;
    out.push({
      id: o.id,
      enabled: o.enabled === true,
      bidirectional: o.bidirectional === true,
      endpointA,
      endpointB,
    });
  }
  return out;
}

function parseReticulumEndpoint(o: Record<string, unknown>): MecpReticulumEndpoint | null {
  if (o.kind === 'lxmf') {
    if (typeof o.destinationHash !== 'string') return null;
    const hash = o.destinationHash.trim().toLowerCase();
    if (hash !== MECP_REBROADCAST_ANY_PEER && !HEX32_RE.test(hash)) return null;
    return { protocol: 'reticulum', kind: 'lxmf', destinationHash: hash };
  }
  if (o.kind === 'rrc') {
    if (typeof o.hubDestHash !== 'string' || typeof o.room !== 'string') return null;
    const hub = o.hubDestHash.trim().toLowerCase();
    const room = o.room.trim();
    if (!HEX32_RE.test(hub) || !room || room.length > RRC_ROOM_MAX) return null;
    return { protocol: 'reticulum', kind: 'rrc', hubDestHash: hub, room };
  }
  return null;
}

function parseEndpoint(raw: unknown): MecpRebroadcastEndpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.protocol === 'reticulum') return parseReticulumEndpoint(o);
  if (o.protocol !== 'meshtastic' && o.protocol !== 'meshcore') return null;
  if (typeof o.channelIndex !== 'number' || !Number.isFinite(o.channelIndex)) return null;
  const channelIndex = Math.trunc(o.channelIndex);
  // Match mqtt-manager MeshPacket.channel wire range (0–7).
  if (channelIndex < 0 || channelIndex > 7) return null;
  return { protocol: o.protocol, channelIndex };
}

function pruneFingerprints(now: number): void {
  for (const [k, ts] of fingerprintSeenAt) {
    if (now - ts > FINGERPRINT_TTL_MS) fingerprintSeenAt.delete(k);
  }
}

export function fingerprintKey(
  payload: string,
  destProtocol: string,
  destChannel: number | string,
): string {
  return `${destProtocol}:${destChannel}:${payload}`;
}

/** Stable identity of an endpoint's destination (channel index, RRC room, or LXMF peer). */
export function mecpEndpointKey(endpoint: MecpRebroadcastEndpoint): string | number {
  if (endpoint.protocol !== 'reticulum') return endpoint.channelIndex;
  return endpoint.kind === 'rrc'
    ? `rrc:${endpoint.hubDestHash}:${endpoint.room.toLowerCase()}`
    : `lxmf:${endpoint.destinationHash}`;
}

/** @internal */
export function clearMecpRebroadcastFingerprintsForTests(): void {
  fingerprintSeenAt.clear();
}

export interface MecpRebroadcastCandidate {
  protocol: MeshProtocol;
  channelIndex: number;
  payload: string;
  receivedVia?: string | null;
  isOwn: boolean;
  isDrill: boolean;
  isHistory?: boolean;
  viaStoreForward?: boolean;
  /** Display name / node id for the follow-up bridge notice. */
  senderLabel?: string;
  /** Human channel name on the source protocol (never the numeric index). */
  sourceChannelName?: string;
  /** Reticulum LXMF sender destination hash (lowercase hex); matches `lxmf` source endpoints. */
  reticulumSenderHash?: string;
}

export interface MecpRebroadcastSendTarget {
  protocol: 'meshtastic' | 'meshcore' | 'reticulum';
  /** LoRa channel index; always 0 for Reticulum targets (see {@link reticulum}). */
  channelIndex: number;
  /** Set when `protocol === 'reticulum'`: concrete RRC room or LXMF peer to send to. */
  reticulum?: MecpReticulumEndpoint;
  ruleId: string;
  bidirectional: boolean;
  fromProtocol: string;
  fromChannel: number;
}

/** Audit/log label for a send target's destination channel (index or Reticulum room / peer). */
export function describeMecpTargetChannel(target: MecpRebroadcastSendTarget): number | string {
  const r = target.reticulum;
  if (!r) return target.channelIndex;
  return r.kind === 'rrc' ? `${r.hubDestHash.slice(0, 8)}/${r.room}` : r.destinationHash;
}

export type MecpRebroadcastSendFn = (
  target: MecpRebroadcastSendTarget,
  payload: string,
) => Promise<void>;

const NOTICE_TOKEN_MAX = 48;

function sanitizeNoticeToken(value: string, maxLen = NOTICE_TOKEN_MAX): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Short follow-up after a cross-protocol MECP rebroadcast (wire English).
 * Must not match {@link MECP_REGEX} (`MECP/<0-3>/…`) so it cannot loop.
 */
export function formatMecpRebroadcastNotice(args: {
  senderLabel: string;
  fromProtocol: 'meshtastic' | 'meshcore' | 'reticulum';
  fromChannelName: string;
}): string {
  const sender = sanitizeNoticeToken(args.senderLabel) || 'unknown';
  const channel = sanitizeNoticeToken(args.fromChannelName) || 'unnamed';
  const protocolLabel =
    args.fromProtocol === 'meshtastic'
      ? 'Meshtastic'
      : args.fromProtocol === 'reticulum'
        ? 'Reticulum'
        : 'MeshCore';
  return `MECP from ${sender} via ${protocolLabel} (${channel})`;
}

function endpointMatchesCandidate(
  endpoint: MecpRebroadcastEndpoint,
  candidate: MecpRebroadcastCandidate,
): boolean {
  if (endpoint.protocol !== candidate.protocol) return false;
  if (endpoint.protocol === 'reticulum') {
    // RRC rooms are destination-only; an inbound LXMF message matches by sender.
    if (endpoint.kind !== 'lxmf') return false;
    return (
      endpoint.destinationHash === MECP_REBROADCAST_ANY_PEER ||
      endpoint.destinationHash === candidate.reticulumSenderHash?.toLowerCase()
    );
  }
  return endpoint.channelIndex === candidate.channelIndex;
}

/**
 * Decide whether / where to rebroadcast. Returns targets to send (usually 0–1).
 * Does not perform I/O; caller invokes sendFn.
 */
export function resolveMecpRebroadcastTargets(
  candidate: MecpRebroadcastCandidate,
  rules: readonly MecpRebroadcastRule[],
  now = Date.now(),
): MecpRebroadcastSendTarget[] {
  if (candidate.isOwn) return [];
  if (candidate.isDrill) return [];
  if (candidate.isHistory || candidate.viaStoreForward) return [];
  const via = candidate.receivedVia ?? 'rf';
  if (via === 'mqtt') return [];

  const targets: MecpRebroadcastSendTarget[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const matchA = endpointMatchesCandidate(rule.endpointA, candidate);
    const matchB = endpointMatchesCandidate(rule.endpointB, candidate);

    let dest: MecpRebroadcastEndpoint | null = null;
    if (matchA) {
      dest = rule.endpointB;
    } else if (matchB && rule.bidirectional) {
      dest = rule.endpointA;
    }
    if (!dest) continue;
    // Wildcard peers can only be a source; there is nowhere concrete to send.
    if (dest.protocol === 'reticulum' && dest.kind === 'lxmf') {
      if (dest.destinationHash === MECP_REBROADCAST_ANY_PEER) continue;
      // Never bounce a report straight back to the peer it came from.
      if (dest.destinationHash === candidate.reticulumSenderHash?.toLowerCase()) continue;
    }

    pruneFingerprints(now);
    const fp = fingerprintKey(candidate.payload, dest.protocol, mecpEndpointKey(dest));
    if (fingerprintSeenAt.has(fp)) continue;
    fingerprintSeenAt.set(fp, now);

    targets.push({
      protocol: dest.protocol,
      channelIndex: dest.protocol === 'reticulum' ? 0 : dest.channelIndex,
      ...(dest.protocol === 'reticulum' ? { reticulum: dest } : {}),
      ruleId: rule.id,
      bidirectional: rule.bidirectional,
      fromProtocol: candidate.protocol,
      fromChannel: candidate.channelIndex,
    });
  }
  return targets;
}

export async function executeMecpRebroadcast(
  candidate: MecpRebroadcastCandidate,
  rules: readonly MecpRebroadcastRule[],
  sendFn: MecpRebroadcastSendFn,
): Promise<MecpRebroadcastSendTarget[]> {
  const targets = resolveMecpRebroadcastTargets(candidate, rules);
  if (targets.length === 0) return targets;

  const fromProtocol: 'meshtastic' | 'meshcore' | 'reticulum' =
    candidate.protocol === 'meshcore' || candidate.protocol === 'reticulum'
      ? candidate.protocol
      : 'meshtastic';
  const notice = formatMecpRebroadcastNotice({
    senderLabel: candidate.senderLabel ?? 'unknown',
    fromProtocol,
    fromChannelName: candidate.sourceChannelName ?? 'unnamed',
  });

  for (const target of targets) {
    try {
      await sendFn(target, candidate.payload);
    } catch (e) {
      console.warn(
        '[mecp-rebroadcast] send failed',
        target.protocol,
        describeMecpTargetChannel(target),
        e instanceof Error ? e.message : e,
      );
      continue;
    }
    try {
      await sendFn(target, notice);
    } catch (e) {
      console.warn(
        '[mecp-rebroadcast] notice send failed',
        target.protocol,
        describeMecpTargetChannel(target),
        e instanceof Error ? e.message : e,
      );
    }
  }
  return targets;
}
