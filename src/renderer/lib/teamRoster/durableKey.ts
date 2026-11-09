import type { MeshProtocol } from '@/shared/meshProtocol';
import { normalizeTeamDurableKey } from '@/shared/teamRosterTypes';

export interface TeamLinkCandidate {
  protocol: MeshProtocol;
  durableKey: string;
  nodeId?: number | null;
  longName?: string | null;
  identityId?: string | null;
}

/** Build a link candidate for a Meshtastic / MeshCore node detail row. */
export function teamLinkFromLoraNode(opts: {
  protocol: 'meshtastic' | 'meshcore';
  nodeId: number;
  longName?: string | null;
  shortName?: string | null;
  publicKeyHex?: string | null;
  identityId?: string | null;
}): TeamLinkCandidate | null {
  const { protocol, nodeId, publicKeyHex, identityId } = opts;
  const durableRaw = protocol === 'meshtastic' ? String(nodeId >>> 0) : (publicKeyHex ?? '').trim();
  const durableKey = normalizeTeamDurableKey(protocol, durableRaw);
  if (!durableKey) return null;
  const longName = opts.longName?.trim() || opts.shortName?.trim() || null;
  return {
    protocol,
    durableKey,
    nodeId,
    longName,
    identityId: identityId ?? null,
  };
}

/** Build a link candidate for a Reticulum peer detail row. */
export function teamLinkFromReticulumPeer(opts: {
  destinationHash: string;
  displayName?: string | null;
  nodeId?: number | null;
  identityId?: string | null;
}): TeamLinkCandidate | null {
  const durableKey = normalizeTeamDurableKey('reticulum', opts.destinationHash);
  if (!durableKey) return null;
  return {
    protocol: 'reticulum',
    durableKey,
    nodeId: opts.nodeId ?? null,
    longName: opts.displayName?.trim() || null,
    identityId: opts.identityId ?? null,
  };
}
