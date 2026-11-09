import { getNodeStatus, type NodeStatus } from '@/renderer/lib/nodeStatus';
import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from '@/renderer/lib/radio/BaseRadioProvider';
import { reticulumHashToNodeId } from '@/renderer/lib/reticulum/destHash';
import type { MeshNode } from '@/renderer/lib/types';
import type { MeshProtocol } from '@/shared/meshProtocol';
import type { TeamMember, TeamMemberLink } from '@/shared/teamRosterTypes';

export interface LinkPresenceSnapshot {
  link: TeamMemberLink;
  /** Resolved LoRa / synthetic node id when known. */
  peerNodeId: number | null;
  lastHeardMs: number;
  status: NodeStatus;
  displayName: string | null;
}

export interface MemberPresenceSnapshot {
  unitId: number;
  links: LinkPresenceSnapshot[];
  /** Best (most online) status across links. */
  aggregateStatus: NodeStatus;
  /** Link with newest lastHeardMs, if any heard. */
  lastActive: LinkPresenceSnapshot | null;
}

export type NodesByProtocol = Readonly<
  Partial<Record<MeshProtocol, ReadonlyMap<number, MeshNode>>>
>;

/** Reticulum peers keyed by lowercase destination hash. */
export type ReticulumHeardByHash = ReadonlyMap<
  string,
  { lastHeardMs: number; displayName?: string | null }
>;

const STATUS_RANK: Record<NodeStatus, number> = {
  online: 2,
  stale: 1,
  offline: 0,
};

/** Stale/offline thresholds for a protocol radio provider. */
function thresholdsFor(protocol: MeshProtocol): { stale: number; offline: number } {
  const caps =
    protocol === 'meshcore'
      ? MESHCORE_CAPABILITIES
      : protocol === 'reticulum'
        ? RETICULUM_CAPABILITIES
        : MESHTASTIC_CAPABILITIES;
  return { stale: caps.nodeStaleThresholdMs, offline: caps.nodeOfflineThresholdMs };
}

/** Parse a Meshtastic node id from link fields. */
function parseMeshtasticNodeId(durableKey: string, nodeId?: number | null): number | null {
  if (nodeId != null && Number.isInteger(nodeId) && nodeId >= 0) return nodeId >>> 0;
  if (/^\d+$/.test(durableKey)) return Number.parseInt(durableKey, 10) >>> 0;
  return null;
}

/** Resolve a MeshCore node id from link or pubkey map. */
function resolveMeshcoreNodeId(
  link: TeamMemberLink,
  nodes: ReadonlyMap<number, MeshNode> | undefined,
): number | null {
  if (link.nodeId != null && Number.isInteger(link.nodeId) && link.nodeId >= 0) {
    return link.nodeId >>> 0;
  }
  if (/^\d+$/.test(link.durableKey)) {
    return Number.parseInt(link.durableKey, 10) >>> 0;
  }
  if (!nodes || link.durableKey.length !== 64) return null;
  const want = link.durableKey.toLowerCase();
  for (const node of nodes.values()) {
    if (node.public_key_hex?.toLowerCase() === want) return node.node_id >>> 0;
  }
  return null;
}

/** Resolve presence for one link from live node/peer maps. */
/** Compute live presence for one linked device. */
export function resolveLinkPresence(
  link: TeamMemberLink,
  nodesByProtocol: NodesByProtocol,
  reticulumByHash: ReticulumHeardByHash,
  nowMs = Date.now(),
): LinkPresenceSnapshot {
  const { stale, offline } = thresholdsFor(link.protocol);
  let peerNodeId: number | null;
  let lastHeardMs: number;
  let displayName: string | null = link.longName?.trim() || null;

  if (link.protocol === 'reticulum') {
    const hash = link.durableKey.toLowerCase();
    const heard = reticulumByHash.get(hash);
    lastHeardMs = heard?.lastHeardMs ?? 0;
    displayName = heard?.displayName?.trim() || displayName;
    peerNodeId = reticulumHashToNodeId(hash) >>> 0;
  } else if (link.protocol === 'meshcore') {
    const nodes = nodesByProtocol.meshcore;
    peerNodeId = resolveMeshcoreNodeId(link, nodes);
    const node = peerNodeId != null ? nodes?.get(peerNodeId) : undefined;
    lastHeardMs = node?.last_heard ?? 0;
    displayName = node
      ? node.long_name.trim() || node.short_name.trim() || displayName
      : displayName;
  } else {
    const nodes = nodesByProtocol.meshtastic;
    peerNodeId = parseMeshtasticNodeId(link.durableKey, link.nodeId);
    const node = peerNodeId != null ? nodes?.get(peerNodeId) : undefined;
    lastHeardMs = node?.last_heard ?? 0;
    displayName = node
      ? node.long_name.trim() || node.short_name.trim() || displayName
      : displayName;
  }

  const status = getNodeStatus(lastHeardMs, stale, offline, nowMs);
  return { link, peerNodeId, lastHeardMs, status, displayName };
}

/** Pick the more-online of two NodeStatus values. */
function betterStatus(a: NodeStatus, b: NodeStatus): NodeStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export interface ResolveMemberPresenceOpts {
  /** When true, only links with `onRoster` contribute (Team Roster views / fan-out). */
  rosterLinksOnly?: boolean;
}

/** Aggregate presence for a contact card / roster member. */
export function resolveMemberPresence(
  member: TeamMember,
  nodesByProtocol: NodesByProtocol,
  reticulumByHash: ReticulumHeardByHash,
  nowMs?: number,
  opts?: ResolveMemberPresenceOpts,
): MemberPresenceSnapshot;
export function resolveMemberPresence(
  member: TeamMember,
  nodesByProtocol: NodesByProtocol,
  reticulumByHash: ReticulumHeardByHash,
  opts: ResolveMemberPresenceOpts,
): MemberPresenceSnapshot;
export function resolveMemberPresence(
  member: TeamMember,
  nodesByProtocol: NodesByProtocol,
  reticulumByHash: ReticulumHeardByHash,
  nowMsOrOpts?: number | ResolveMemberPresenceOpts,
  opts?: ResolveMemberPresenceOpts,
): MemberPresenceSnapshot {
  const resolvedOpts = typeof nowMsOrOpts === 'object' ? nowMsOrOpts : opts;
  const at = typeof nowMsOrOpts === 'number' ? nowMsOrOpts : Date.now();
  const source = resolvedOpts?.rosterLinksOnly
    ? member.links.filter((l) => l.onRoster)
    : member.links;
  const links = source.map((link) =>
    resolveLinkPresence(link, nodesByProtocol, reticulumByHash, at),
  );
  let aggregateStatus: NodeStatus = 'offline';
  let lastActive: LinkPresenceSnapshot | null = null;
  for (const snap of links) {
    aggregateStatus = betterStatus(aggregateStatus, snap.status);
    if (snap.lastHeardMs <= 0) continue;
    if (!lastActive || snap.lastHeardMs > lastActive.lastHeardMs) lastActive = snap;
  }
  return { unitId: member.unitId, links, aggregateStatus, lastActive };
}
