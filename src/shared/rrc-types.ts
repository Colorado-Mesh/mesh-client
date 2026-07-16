/** Shared RRC types for sidecar API ↔ renderer. */

export type RrcHubSource = 'recommended' | 'discovered' | 'manual';

export type RrcSessionStatus =
  'disconnected' | 'connecting' | 'awaiting_welcome' | 'active' | 'reconnecting';

export type RrcChatMessageKind = 'msg' | 'notice' | 'action' | 'error' | 'system';

export interface RrcHubInfo {
  destination_hash: string;
  identity_hash?: string | null;
  display_name?: string | null;
  last_seen?: number | null;
  favorited?: boolean;
  hops?: number | null;
  status?: string | null;
  source?: RrcHubSource;
  /** True when hash is in the curated Recommended catalog. */
  recommended?: boolean;
}

export interface RrcRoomInfo {
  name: string;
  members?: RrcRoomMember[];
  member_count?: number;
}

export interface RrcRoomMember {
  identity_hash: string;
  nickname?: string | null;
}

export interface RrcChatMessage {
  id: string;
  room: string;
  kind: RrcChatMessageKind;
  body: string;
  sender_hash?: string | null;
  nickname?: string | null;
  timestamp: number;
}

export interface RrcSessionSnapshot {
  status: RrcSessionStatus;
  hub_dest_hash?: string | null;
  hub_name?: string | null;
  nickname?: string | null;
  rooms: RrcRoomInfo[];
  error?: string | null;
}

export interface RrcConnectRequest {
  dest_hash: string;
  nickname?: string;
}

export interface RrcJoinRequest {
  room: string;
}

export interface RrcPartRequest {
  room: string;
}

export interface RrcSendRequest {
  room: string;
  body: string;
  /** msg | notice | action — default msg */
  type?: 'msg' | 'notice' | 'action';
}

export interface RrcUpsertHubRequest {
  dest_hash: string;
  label?: string;
  favorited?: boolean;
}
