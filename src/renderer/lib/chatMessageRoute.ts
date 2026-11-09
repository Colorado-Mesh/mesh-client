/**
 * Find the route a received chat message took in this session's RF capture buffers, for the
 * Chat hop pill tooltip. Name resolution and wording live in `chatMessageRouteView.ts`, which
 * only the lazy-loaded Chat panel imports; this module stays small because App.tsx wires it.
 *
 * Lookups run when the pill is hovered or focused, never per render. They are display-only: a
 * missing capture gives an "unavailable" reason and never changes stored hop counts or the
 * signal report text.
 *
 * - MeshCore flood packets accumulate one path hash per repeater (firmware
 *   `Mesh::routeRecvPacket` appends `self_id.copyHashTo(...)`), so `path[0]` is the repeater
 *   nearest the sender and the last hash is the one our radio heard. A hash is the first
 *   1-3 bytes of the repeater's public key.
 * - Meshtastic packets carry `relay_node`, the low byte of the last relaying node's number.
 * - Reticulum packets carry a hop count only.
 */
import { meshcoreMessageReceptionStats } from './chatSignalReport';
import type { RxPacketEntry } from './meshcore/meshcoreHookTypes';
import type { MeshcoreChatChannelSource } from './meshcoreConfiguredChatChannels';
import type { ChatMessage } from './types';

/** Why no route can be shown for a message whose protocol normally records one. */
export type ChatMessageRouteUnavailableReason =
  /** MeshCore DMs and room posts cannot be matched to a captured packet by content. */
  | 'directOrRoomMessage'
  /** The packet is not in this session's capture buffer (older history, or evicted). */
  | 'notCaptured'
  /** Meshtastic packet captured, but the radio left `relay_node` unset. */
  | 'relayNotReported';

/** Capture lookup result before node names are resolved. */
export type ChatMessageRouteLookup =
  | { status: 'floodPath'; hashes: string[] }
  | { status: 'lastRelay'; relayByte: number }
  | { status: 'unavailable'; reason: ChatMessageRouteUnavailableReason };

/** Minimal Meshtastic capture row (device store `RawPacketEntry` or runtime log entry). */
export interface MeshtasticRouteCapture {
  fromNodeId: number | null;
  viaMqtt: boolean;
  packetId?: number;
  relayNode?: number;
}

const UNAVAILABLE_NOT_CAPTURED: ChatMessageRouteLookup = {
  status: 'unavailable',
  reason: 'notCaptured',
};

/** Same exact-content match the signal report uses; channel messages only. */
export function meshcoreChatMessageRoute(
  message: ChatMessage,
  packets: readonly RxPacketEntry[],
  channels: readonly MeshcoreChatChannelSource[],
): ChatMessageRouteLookup {
  if (message.to != null || message.roomServerId != null || message.channel < 0) {
    return { status: 'unavailable', reason: 'directOrRoomMessage' };
  }
  const path = meshcoreMessageReceptionStats(message, packets, channels)?.path;
  return path ? { status: 'floodPath', hashes: path } : UNAVAILABLE_NOT_CAPTURED;
}

/** Find the RF capture of a Meshtastic message by sender and packet id. */
export function meshtasticChatMessageRoute(
  message: Pick<ChatMessage, 'packetId' | 'sender_id'>,
  packets: readonly MeshtasticRouteCapture[],
): ChatMessageRouteLookup {
  const packetId = message.packetId;
  if (packetId == null || packetId === 0) return UNAVAILABLE_NOT_CAPTURED;
  for (let i = packets.length - 1; i >= 0; i--) {
    const packet = packets[i];
    if (packet.viaMqtt || packet.packetId !== packetId) continue;
    if (packet.fromNodeId !== message.sender_id) continue;
    // Only the low byte is defined; 0 means the radio did not report a relay.
    const relayByte = (packet.relayNode ?? 0) & 0xff;
    return relayByte > 0
      ? { status: 'lastRelay', relayByte }
      : { status: 'unavailable', reason: 'relayNotReported' };
  }
  return UNAVAILABLE_NOT_CAPTURED;
}
