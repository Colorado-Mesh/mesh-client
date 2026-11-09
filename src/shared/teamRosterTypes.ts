/** App-global contact cards / team roster (SQLite `team_members` + `team_member_links`). */

import type { MeshProtocol } from './meshProtocol';
import { isMeshProtocol } from './meshProtocol';

export const TEAM_UNIT_ID_MIN = 1;
export const TEAM_UNIT_ID_MAX = 65535;
export const TEAM_CALLSIGN_MAX = 64;
export const TEAM_ROLE_MAX = 32;
export const TEAM_LONG_NAME_MAX = 128;
export const TEAM_DURABLE_KEY_MAX = 128;

export interface TeamMemberLink {
  protocol: MeshProtocol;
  /** Meshtastic: decimal node num string; MeshCore: 64-hex pubkey; Reticulum: 32-hex dest hash. */
  durableKey: string;
  nodeId?: number | null;
  longName?: string | null;
  /** Identity the link was created from (display refresh only). */
  identityId?: string | null;
  /** When true, this device is selected for the Team Roster event set. */
  onRoster: boolean;
}

export interface TeamMember {
  unitId: number;
  callsign: string;
  role?: string | null;
  isSelf: boolean;
  /**
   * Derived mirror: true iff any linked device has `onRoster`.
   * Roster UI filters on this; device selection is per-link.
   */
  onRoster: boolean;
  createdAt: number;
  updatedAt: number;
  links: TeamMemberLink[];
}

/** Create/update member fields; `unitId` required. Links are managed via set/remove link APIs. */
export interface TeamMemberInput {
  unitId: number;
  callsign: string;
  role?: string | null;
  isSelf?: boolean;
  /**
   * When `false`, clears every link’s roster flag (remove person from roster).
   * When `true`, does not auto-select all devices — set link `onRoster` separately.
   * Member `onRoster` is always re-synced from links after write.
   */
  onRoster?: boolean;
}

export interface TeamMemberLinkInput {
  unitId: number;
  protocol: MeshProtocol;
  durableKey: string;
  nodeId?: number | null;
  longName?: string | null;
  identityId?: string | null;
  /** Optional; defaults to false on insert, preserved on update when omitted. */
  onRoster?: boolean;
}

export interface TeamMemberLinkRosterInput {
  unitId: number;
  protocol: MeshProtocol;
  durableKey: string;
  onRoster: boolean;
}

const MESHCORE_PUBKEY_RE = /^[0-9a-fA-F]{64}$/;
const RETICULUM_HASH_RE = /^[0-9a-fA-F]{32}$/;
const MESHTASTIC_NODE_RE = /^\d+$/;

export function isValidTeamUnitId(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= TEAM_UNIT_ID_MIN &&
    (value as number) <= TEAM_UNIT_ID_MAX
  );
}

/** Links selected for the Team Roster event set. */
export function rosterLinksOf(member: TeamMember): TeamMemberLink[] {
  return member.links.filter((l) => l.onRoster);
}

/** Normalize and validate a durable link key for the given protocol. */
export function normalizeTeamDurableKey(protocol: MeshProtocol, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > TEAM_DURABLE_KEY_MAX) return null;
  if (protocol === 'meshtastic') {
    if (!MESHTASTIC_NODE_RE.test(trimmed)) return null;
    // Reject leading zeros except "0"
    if (trimmed.length > 1 && trimmed.startsWith('0')) return null;
    return trimmed;
  }
  if (protocol === 'meshcore') {
    // Prefer 64-hex pubkey when known; otherwise allow decimal node id (heard without key).
    if (MESHCORE_PUBKEY_RE.test(trimmed)) return trimmed.toLowerCase();
    if (!MESHTASTIC_NODE_RE.test(trimmed)) return null;
    if (trimmed.length > 1 && trimmed.startsWith('0')) return null;
    return trimmed;
  }
  // reticulum
  if (!RETICULUM_HASH_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function assertTeamProtocol(value: unknown): MeshProtocol {
  if (typeof value !== 'string' || !isMeshProtocol(value)) {
    throw new TypeError('protocol must be meshtastic, meshcore, or reticulum');
  }
  return value;
}
