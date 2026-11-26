import type { MeshProtocol } from '@/shared/meshProtocol';

import type { ChatMessage } from './types';

export interface GlobalMessageSearchHit {
  protocol: MeshProtocol;
  /** Database row id when available. */
  dbId: number | null;
  /** Stamped time, as the bubble shows it. */
  timestamp: number;
  /** When this app received the row, if saved with it; hits are ordered and dated by it. */
  receivedAt?: number;
  senderId: number | null;
  senderName: string;
  payload: string;
  /** Channel index for broadcast; null for DM / Reticulum DM-only. */
  channel: number | null;
  /** LoRa DM peer node id, or Reticulum synthetic node id after open. */
  dmPeer: number | null;
  /** LoRa DM recipient (`to_node`). Kept so an inbound row still names our node. */
  toNode?: number | null;
  /** Reticulum conversation peer hash (counterparty), not necessarily the wire sender. */
  reticulumPeerHash: string | null;
  /** Reticulum `sender_id` / from-hash for direction filtering (preserved separately from peer). */
  reticulumSenderHash?: string | null;
  /** LXMF message hash for scroll targeting. */
  reticulumMessageHash: string | null;
  packetId: number | null;
}

/** Pending ChatPanel focus after opening a search hit. */
export interface PendingMessageFocus {
  timestamp: number;
  packetId?: number | null;
  reticulumMessageHash?: string | null;
  dbId?: number | null;
  /** Highlight query for in-bubble mark tags. The dialog query, never a payload prefix. */
  highlightQuery?: string;
  /** Row to insert when the open thread does not already contain the hit. */
  focusRow?: ChatMessage;
  /** Protocol the focus belongs to, so a panel can keep the row after focus is consumed. */
  protocol?: MeshProtocol;
}
