import { rrcRoomMatchKey } from '@/renderer/lib/rrcRoomName';
import type { RoomMacroTarget } from '@/renderer/stores/chatMacrosStore';
import type { DeviceRecord } from '@/renderer/stores/deviceStore';
import type { IdentityRecord } from '@/renderer/stores/identityStore';
import type { LiveChannelKeys } from '@/renderer/stores/liveChannelKeyStore';
import type { NodeRecord } from '@/renderer/stores/nodeStore';
import { bytesToHex } from '@/shared/hexBytes';

export interface RoomJumpCandidate {
  target: RoomMacroTarget;
  key: string;
}

export interface RoomJumpChannelSlot {
  index: number;
  name: string;
  channelKey?: string;
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
  /** Live channel-key maps per LoRa protocol (connected radio slots). */
  liveChannelKeysByProtocol?: Partial<Record<'meshtastic' | 'meshcore', LiveChannelKeys | null>>;
  /** Device records for channel display names when live keys are present. */
  devicesByIdentity?: Record<string, DeviceRecord | undefined>;
}

function meshcoreCandidateKey(identityId: string, pubHex: string): string {
  return `meshcore:${identityId}:${pubHex}`;
}

function channelCandidateKey(
  kind: 'meshcore-channel' | 'meshtastic-channel',
  identityId: string,
  channelKey: string | undefined,
  channelIndex: number,
): string {
  if (channelKey) return `${kind}:${identityId}:key:${channelKey.toLowerCase()}`;
  return `${kind}:${identityId}:idx:${channelIndex}`;
}

function rrcCandidateKey(hub: string, room: string): string {
  return `rrc:${hub}:${rrcRoomMatchKey(room) || room.trim().toLowerCase()}`;
}

function formatChannelLabel(name: string, index: number): string {
  const trimmed = name.trim();
  if (!trimmed) return `#${index}`;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function channelSlotsForIdentity(
  protocol: 'meshtastic' | 'meshcore',
  identityId: string,
  live: LiveChannelKeys | null | undefined,
  device: DeviceRecord | undefined,
): RoomJumpChannelSlot[] {
  if (live) {
    return Object.keys(live.keyByIndex)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b)
      .map((index) => {
        const channelKey = live.keyByIndex[index];
        const name =
          protocol === 'meshtastic'
            ? (device?.channels.find((c) => c.index === index)?.name ??
              device?.channelConfigs.find((c) => c.index === index)?.name ??
              '')
            : (device?.meshcoreChannels?.find((c) => c.index === index)?.name ?? '');
        return {
          index,
          name,
          ...(channelKey ? { channelKey } : {}),
        };
      });
  }
  if (protocol === 'meshtastic') {
    const fromChannels = device?.channels ?? [];
    if (fromChannels.length > 0) {
      return fromChannels
        .filter((c) => Number.isInteger(c.index) && c.index >= 0)
        .map((c) => ({ index: c.index, name: c.name }));
    }
    return (device?.channelConfigs ?? [])
      .filter((c) => Number.isInteger(c.index) && c.index >= 0)
      .map((c) => ({ index: c.index, name: c.name }));
  }
  return (device?.meshcoreChannels ?? [])
    .filter((c) => Number.isInteger(c.index) && c.index >= 0)
    .map((c) => ({ index: c.index, name: c.name }));
}

/** Build MeshCore BBS rooms, Chat #channels, and RRC room-jump candidates for the macro picker. */
export function buildRoomJumpCandidates(input: RoomJumpCandidatesInput): RoomJumpCandidate[] {
  const out: RoomJumpCandidate[] = [];
  const seen = new Set<string>();

  const meshcoreRooms: { candidate: RoomJumpCandidate; favorited: boolean }[] = [];
  for (const identity of Object.values(input.identities)) {
    if (identity.protocol.type !== 'meshcore') continue;
    const nodes = input.nodesByIdentity[identity.id] ?? {};
    for (const node of Object.values(nodes)) {
      if (node?.hwModel !== 'Room') continue;
      const fromHex = (node.publicKeyHex ?? '').trim().toLowerCase();
      const fromBytes =
        node.publicKey && node.publicKey.length > 0 ? bytesToHex(node.publicKey) : '';
      const pub = fromHex || fromBytes;
      if (!/^[0-9a-f]{64}$/.test(pub)) continue;
      const key = meshcoreCandidateKey(identity.id, pub);
      if (seen.has(key)) continue;
      seen.add(key);
      const label = (node.longName || node.shortName || pub.slice(0, 8)).trim();
      meshcoreRooms.push({
        favorited: Boolean(node.favorited),
        candidate: {
          key,
          target: {
            kind: 'meshcore-room',
            identityId: identity.id,
            roomPubKeyHex: pub,
            label,
          },
        },
      });
    }
  }
  // Prefer favorited (joined-ish) MeshCore rooms first in the picker.
  meshcoreRooms.sort((a, b) => Number(b.favorited) - Number(a.favorited));
  for (const row of meshcoreRooms) out.push(row.candidate);

  for (const identity of Object.values(input.identities)) {
    const protocol = identity.protocol.type;
    if (protocol !== 'meshcore' && protocol !== 'meshtastic') continue;
    const kind = protocol === 'meshcore' ? 'meshcore-channel' : 'meshtastic-channel';
    const live = input.liveChannelKeysByProtocol?.[protocol];
    const device = input.devicesByIdentity?.[identity.id];
    for (const slot of channelSlotsForIdentity(protocol, identity.id, live, device)) {
      const key = channelCandidateKey(kind, identity.id, slot.channelKey, slot.index);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        target: {
          kind,
          identityId: identity.id,
          channelIndex: slot.index,
          ...(slot.channelKey ? { channelKey: slot.channelKey.toLowerCase() } : {}),
          label: formatChannelLabel(slot.name, slot.index),
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
  if (target.kind === 'meshcore-channel' || target.kind === 'meshtastic-channel') {
    return channelCandidateKey(
      target.kind,
      target.identityId,
      target.channelKey,
      target.channelIndex,
    );
  }
  // Remaining variant is rrc-room (RoomMacroTarget exhaustiveness).
  return rrcCandidateKey(target.hubDestHash.toLowerCase(), target.room);
}
