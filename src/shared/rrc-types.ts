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
  /** Optional hub description when present in NOTICE/extensions. */
  description?: string | null;
  /** Optional connected user count when present in NOTICE/extensions. */
  user_count?: number | null;
}

export interface RrcRoomInfo {
  name: string;
  members?: RrcRoomMember[];
  member_count?: number;
  topic?: string | null;
}

export interface RrcRoomMember {
  identity_hash: string;
  nickname?: string | null;
}

export interface RrcListedRoom {
  name: string;
  topic?: string;
}

export interface RrcChatMessage {
  id: string;
  room: string;
  kind: RrcChatMessageKind;
  body: string;
  sender_hash?: string | null;
  nickname?: string | null;
  timestamp: number;
  /** Present on direct NOTICE (K_DST) whispers. */
  dst_hash?: string | null;
}

export interface RrcHubCapabilities {
  direct_notice?: boolean;
  action?: boolean;
  resource_envelope?: boolean;
}

export interface RrcSessionSnapshot {
  status: RrcSessionStatus;
  hub_dest_hash?: string | null;
  hub_name?: string | null;
  identity_hash?: string | null;
  nickname?: string | null;
  rooms: RrcRoomInfo[];
  error?: string | null;
  capabilities?: RrcHubCapabilities | null;
}

/** Multi-hub status from sidecar `GET /rrc/status`. */
export interface RrcMultiSessionSnapshot {
  sessions: RrcSessionSnapshot[];
  identity_hash?: string | null;
}

export interface RrcConnectRequest {
  dest_hash: string;
  nickname?: string;
}

export interface RrcDisconnectRequest {
  /** Omit or empty to disconnect every hub session. */
  dest_hash?: string;
}

export interface RrcJoinRequest {
  hub_dest_hash: string;
  room: string;
  /** Optional room key for rrcd +k rooms (JOIN body). */
  key?: string;
}

export interface RrcPartRequest {
  hub_dest_hash: string;
  room: string;
}

export interface RrcSendRequest {
  hub_dest_hash: string;
  /** Omit or empty for hub-global slash commands when no room is joined. */
  room?: string;
  body: string;
  /** msg | notice | action — default msg */
  type?: 'msg' | 'notice' | 'action';
  /**
   * When set, send a direct NOTICE (rrcd K_DST) and omit K_ROOM.
   * Requires hub CAP_DIRECT_NOTICE.
   */
  dst_hash?: string;
}

export interface RrcSetNicknameRequest {
  nickname: string;
  /** Omit to set nickname on every tracked hub. */
  hub_dest_hash?: string;
}

export interface RrcUpsertHubRequest {
  dest_hash: string;
  label?: string;
  favorited?: boolean;
}
