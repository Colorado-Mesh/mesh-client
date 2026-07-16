/** Shared RRC types for sidecar API ↔ renderer. */

export type RrcHubSource = 'recommended' | 'discovered' | 'manual';

export type RrcSessionStatus =
  'disconnected' | 'connecting' | 'awaiting_welcome' | 'active' | 'reconnecting';

export type RrcChatMessageKind = 'msg' | 'notice' | 'action' | 'error' | 'system';

/** How the current display_name was obtained (higher wins when merging). */
export type RrcHubNameSource = 'recommended' | 'welcome' | 'manual' | 'announce';

export interface RrcHubInfo {
  destination_hash: string;
  identity_hash?: string | null;
  display_name?: string | null;
  /** Priority for display_name: recommended > welcome > manual > announce. */
  name_source?: RrcHubNameSource;
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
  identity_hash?: string | null;
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
  /** Optional room key for rrcd +k rooms (JOIN body). */
  key?: string;
}

export interface RrcPartRequest {
  room: string;
}

export interface RrcSendRequest {
  /** Omit or empty for hub-global slash commands when no room is joined. */
  room?: string;
  body: string;
  /** msg | notice | action — default msg */
  type?: 'msg' | 'notice' | 'action';
}

export interface RrcUpsertHubRequest {
  dest_hash: string;
  label?: string;
  favorited?: boolean;
}
