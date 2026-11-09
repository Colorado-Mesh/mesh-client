import type { ChatMessage } from '@/renderer/lib/types';
import type { MeshProtocol } from '@/shared/meshProtocol';
import type { TeamMemberLink } from '@/shared/teamRosterTypes';

import type { LinkPresenceSnapshot } from './contactPresence';

export const CONTACT_MESSAGE_HISTORY_LIMIT = 200;

const LORA_BROADCAST = 0xffffffff;

export interface ContactTimelineItem {
  key: string;
  protocol: MeshProtocol;
  message: ChatMessage;
  isDirectMessage: boolean;
  /** Peer node id for Jump to Chat (LoRa / synthetic Reticulum). */
  dmPeer: number | null;
  reticulumPeerHash: string | null;
  channel: number | null;
}

export type MessagesByProtocol = Readonly<Record<MeshProtocol, readonly ChatMessage[]>>;

function isDirect(protocol: MeshProtocol, msg: ChatMessage): boolean {
  if (protocol === 'reticulum') return true;
  return msg.to != null && msg.to !== 0 && msg.to !== LORA_BROADCAST;
}

function messageKey(protocol: MeshProtocol, msg: ChatMessage): string {
  const id = msg.id != null ? String(msg.id) : `${msg.timestamp}-${msg.packetId ?? 'x'}`;
  return `${protocol}:${id}`;
}

interface PeerFilter {
  protocol: MeshProtocol;
  nodeIds: Set<number>;
  reticulumHashes: Set<string>;
}

function buildPeerFilters(snaps: readonly LinkPresenceSnapshot[]): PeerFilter[] {
  const byProtocol = new Map<MeshProtocol, PeerFilter>();
  for (const snap of snaps) {
    let filter = byProtocol.get(snap.link.protocol);
    if (!filter) {
      filter = {
        protocol: snap.link.protocol,
        nodeIds: new Set(),
        reticulumHashes: new Set(),
      };
      byProtocol.set(snap.link.protocol, filter);
    }
    if (snap.peerNodeId != null) filter.nodeIds.add(snap.peerNodeId >>> 0);
    if (snap.link.protocol === 'reticulum') {
      filter.reticulumHashes.add(snap.link.durableKey.toLowerCase());
    }
    // MeshCore pubkey-only link without resolved node: still match durable decimal if present.
    if (snap.link.protocol !== 'reticulum' && /^\d+$/.test(snap.link.durableKey)) {
      filter.nodeIds.add(Number.parseInt(snap.link.durableKey, 10) >>> 0);
    }
  }
  return [...byProtocol.values()];
}

function messageTouchesPeer(protocol: MeshProtocol, msg: ChatMessage, filter: PeerFilter): boolean {
  if (protocol === 'reticulum') {
    const sender = msg.reticulum_sender_hash?.toLowerCase();
    const dest = msg.reticulum_destination_hash?.toLowerCase();
    if (sender && filter.reticulumHashes.has(sender)) return true;
    if (dest && filter.reticulumHashes.has(dest)) return true;
    // Fallback: synthetic ids when hashes missing on older rows.
    if (filter.nodeIds.has(msg.sender_id >>> 0)) return true;
    if (msg.to != null && filter.nodeIds.has(msg.to >>> 0)) return true;
    return false;
  }
  if (filter.nodeIds.has(msg.sender_id >>> 0)) return true;
  if (msg.to != null && filter.nodeIds.has(msg.to >>> 0)) return true;
  return false;
}

/**
 * Merge in-memory chat rows that involve any of the contact's linked peers.
 * Newest first; capped for UI.
 */
export function buildContactMessageTimeline(
  snaps: readonly LinkPresenceSnapshot[],
  messagesByProtocol: MessagesByProtocol,
  limit = CONTACT_MESSAGE_HISTORY_LIMIT,
): ContactTimelineItem[] {
  const filters = buildPeerFilters(snaps);
  if (filters.length === 0) return [];
  const items: ContactTimelineItem[] = [];

  for (const filter of filters) {
    const messages = messagesByProtocol[filter.protocol];
    for (const msg of messages) {
      if (!msg.payload) continue;
      if (msg.emoji && (msg.replyId != null || msg.reticulum_reply_to_hash)) continue;
      if (!messageTouchesPeer(filter.protocol, msg, filter)) continue;
      const direct = isDirect(filter.protocol, msg);
      let dmPeer: number | null = null;
      let reticulumPeerHash: string | null = null;
      let channel: number | null = null;
      if (filter.protocol === 'reticulum') {
        const sender = msg.reticulum_sender_hash?.toLowerCase() ?? null;
        const dest = msg.reticulum_destination_hash?.toLowerCase() ?? null;
        // Prefer a filter-matched peer hash for Jump to Chat; never fall back to an
        // unmatched sender/dest hash (can be the local identity).
        reticulumPeerHash =
          (sender && filter.reticulumHashes.has(sender) ? sender : null) ??
          (dest && filter.reticulumHashes.has(dest) ? dest : null);
        dmPeer = filter.nodeIds.has(msg.sender_id >>> 0) ? msg.sender_id : (msg.to ?? null);
      } else if (direct) {
        dmPeer = filter.nodeIds.has(msg.sender_id >>> 0) ? msg.sender_id : (msg.to ?? null);
      } else {
        channel = msg.channel;
      }
      items.push({
        key: messageKey(filter.protocol, msg),
        protocol: filter.protocol,
        message: msg,
        isDirectMessage: direct,
        dmPeer,
        reticulumPeerHash,
        channel,
      });
    }
  }

  items.sort((a, b) => b.message.timestamp - a.message.timestamp);
  return items.slice(0, limit);
}

/** Resolve a DM peer node id for Jump / Message from a presence snapshot. */
export function dmPeerFromPresence(snap: LinkPresenceSnapshot): number | null {
  return snap.peerNodeId;
}

export function reticulumHashFromLink(link: TeamMemberLink): string | null {
  return link.protocol === 'reticulum' ? link.durableKey.toLowerCase() : null;
}
