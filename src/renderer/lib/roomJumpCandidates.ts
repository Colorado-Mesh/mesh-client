import { rrcRoomMatchKey } from '@/renderer/lib/rrcRoomName';
import type { RoomMacroTarget } from '@/renderer/stores/chatMacrosStore';
import type { IdentityRecord } from '@/renderer/stores/identityStore';
import type { NodeRecord } from '@/renderer/stores/nodeStore';

export interface RoomJumpCandidate {
  target: RoomMacroTarget;
  key: string;
}

export interface RoomJumpCandidatesInput {
  identities: Record<string, IdentityRecord>;
  nodesByIdentity: Record<string, Record<number, NodeRecord | undefined>>;
  rrcHubDestHash: string | null;
  /** Joined / known rooms for the focused hub (keys are room names). */
  rrcRoomsByHub: ReadonlyMap<string, ReadonlyMap<string, unknown>> | undefined;
  /** Recent rooms for the focused hub (may include `#`). */
  rrcRecentRooms?: readonly string[];
  rrcHubDisplayName?: string;
}

function meshcoreCandidateKey(identityId: string, pubHex: string): string {
  return `meshcore:${identityId}:${pubHex}`;
}

function rrcCandidateKey(hub: string, room: string): string {
  return `rrc:${hub}:${rrcRoomMatchKey(room) || room.trim().toLowerCase()}`;
}

/** Build MeshCore + RRC room-jump candidates for the macro picker. */
export function buildRoomJumpCandidates(input: RoomJumpCandidatesInput): RoomJumpCandidate[] {
  const out: RoomJumpCandidate[] = [];
  const seen = new Set<string>();

  for (const identity of Object.values(input.identities)) {
    if (identity.protocol.type !== 'meshcore') continue;
    const nodes = input.nodesByIdentity[identity.id] ?? {};
    for (const node of Object.values(nodes)) {
      if (node?.hwModel !== 'Room') continue;
      const pub = (node.publicKeyHex ?? '').trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(pub)) continue;
      const key = meshcoreCandidateKey(identity.id, pub);
      if (seen.has(key)) continue;
      seen.add(key);
      const label = (node.longName || node.shortName || pub.slice(0, 8)).trim();
      out.push({
        key,
        target: {
          kind: 'meshcore-room',
          identityId: identity.id,
          roomPubKeyHex: pub,
          label,
        },
      });
    }
  }

  const hub = input.rrcHubDestHash?.trim().toLowerCase() ?? '';
  if (hub) {
    const hubRooms = input.rrcRoomsByHub?.get(hub);
    const roomNames = new Set<string>();
    if (hubRooms) {
      for (const room of hubRooms.keys()) roomNames.add(room);
    }
    for (const room of input.rrcRecentRooms ?? []) {
      if (typeof room === 'string' && room.trim()) roomNames.add(room);
    }
    const hubLabel = (input.rrcHubDisplayName ?? hub.slice(0, 8)).trim();
    for (const room of roomNames) {
      const trimmed = room.trim();
      if (!trimmed) continue;
      const key = rrcCandidateKey(hub, trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        target: {
          kind: 'rrc-room',
          hubDestHash: hub,
          room: trimmed,
          label: `${hubLabel} — ${trimmed}`,
        },
      });
    }
  }

  return out;
}

/** Stable option value for a saved target (used by the picker select). */
export function roomJumpTargetKey(target: RoomMacroTarget): string {
  if (target.kind === 'meshcore-room') {
    return meshcoreCandidateKey(target.identityId, target.roomPubKeyHex.toLowerCase());
  }
  return rrcCandidateKey(target.hubDestHash.toLowerCase(), target.room);
}
