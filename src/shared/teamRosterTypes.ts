/** App-global team contacts / roster (SQLite `team_members` + `team_member_links`). */

import type { MeshProtocol } from './meshProtocol';
import { isMeshProtocol } from './meshProtocol';

export const TEAM_UNIT_ID_MIN = 1;
export const TEAM_UNIT_ID_MAX = 65535;
export const TEAM_CALLSIGN_MAX = 64;
export const TEAM_ROLE_MAX = 32;
export const TEAM_COLOR_MAX = 32;
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
}

export interface TeamMember {
  unitId: number;
  callsign: string;
  role?: string | null;
  color?: string | null;
  isSelf: boolean;
  createdAt: number;
  updatedAt: number;
  links: TeamMemberLink[];
}

/** Create/update member fields; `unitId` required. Links are managed via set/remove link APIs. */
export interface TeamMemberInput {
  unitId: number;
  callsign: string;
  role?: string | null;
  color?: string | null;
  isSelf?: boolean;
}

export interface TeamMemberLinkInput {
  unitId: number;
  protocol: MeshProtocol;
  durableKey: string;
  nodeId?: number | null;
  longName?: string | null;
  identityId?: string | null;
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
    if (!MESHCORE_PUBKEY_RE.test(trimmed)) return null;
    return trimmed.toLowerCase();
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
