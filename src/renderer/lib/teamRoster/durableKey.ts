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
  // MeshCore: prefer a valid pubkey; fall back to node id when key is missing/invalid.
  let durableKey: string | null;
  if (protocol === 'meshtastic') {
    durableKey = normalizeTeamDurableKey(protocol, String(nodeId >>> 0));
  } else {
    const pubkey = (publicKeyHex ?? '').trim();
    durableKey = pubkey ? normalizeTeamDurableKey(protocol, pubkey) : null;
    if (!durableKey) {
      durableKey = normalizeTeamDurableKey(protocol, String(nodeId >>> 0));
    }
  }
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
