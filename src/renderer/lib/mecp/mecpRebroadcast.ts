import type { MeshProtocol } from '@/renderer/lib/types';

export interface MecpRebroadcastEndpoint {
  protocol: 'meshtastic' | 'meshcore';
  channelIndex: number;
}

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

function parseEndpoint(raw: unknown): MecpRebroadcastEndpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
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

export function fingerprintKey(payload: string, destProtocol: string, destChannel: number): string {
  return `${destProtocol}:${destChannel}:${payload}`;
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
}

export interface MecpRebroadcastSendTarget {
  protocol: 'meshtastic' | 'meshcore';
  channelIndex: number;
  ruleId: string;
  bidirectional: boolean;
  fromProtocol: string;
  fromChannel: number;
}

export type MecpRebroadcastSendFn = (
  target: MecpRebroadcastSendTarget,
  payload: string,
) => Promise<void>;

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
  if (candidate.protocol !== 'meshtastic' && candidate.protocol !== 'meshcore') return [];

  const targets: MecpRebroadcastSendTarget[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const matchA =
      rule.endpointA.protocol === candidate.protocol &&
      rule.endpointA.channelIndex === candidate.channelIndex;
    const matchB =
      rule.endpointB.protocol === candidate.protocol &&
      rule.endpointB.channelIndex === candidate.channelIndex;

    let dest: MecpRebroadcastEndpoint | null = null;
    if (matchA) {
      dest = rule.endpointB;
    } else if (matchB && rule.bidirectional) {
      dest = rule.endpointA;
    }
    if (!dest) continue;

    pruneFingerprints(now);
    const fp = fingerprintKey(candidate.payload, dest.protocol, dest.channelIndex);
    if (fingerprintSeenAt.has(fp)) continue;
    fingerprintSeenAt.set(fp, now);

    targets.push({
      protocol: dest.protocol,
      channelIndex: dest.channelIndex,
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
  for (const target of targets) {
    try {
      await sendFn(target, candidate.payload);
    } catch (e) {
      console.warn(
        '[mecp-rebroadcast] send failed',
        target.protocol,
        target.channelIndex,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return targets;
}
