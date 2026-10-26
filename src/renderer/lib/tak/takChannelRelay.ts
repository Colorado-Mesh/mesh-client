import { isMeshtasticBroadcastNodeNum } from '@/shared/nodeNameUtils';
import { TAK_GEOCHAT_CALLSIGN_MAX_LEN, TAK_GEOCHAT_TEXT_MAX_LEN } from '@/shared/tak-types';

import { getConnection } from '../../stores/connectionStore';
import { type NodeRecord, useNodeStore } from '../../stores/nodeStore';
import { getTakRelayPrefs } from '../../stores/takRelayPrefsStore';
import { isTakSinkActive } from '../../stores/takSinkStore';
import { recordTakTrackerFix } from '../../stores/takTrackerStore';
import { parseMt1Payload } from '../meshcore/mt1Tracker';
import { effectiveMessageTimestampMs } from '../nodeStatus';
import type { ChatMessage, IdentityId } from '../types';
import { relayDirectMessageToTak } from './takDirectMessages';
import { consumeTakEcho } from './takEchoGuard';
import { pushTakGeochat } from './takGeochatPush';
import { isFirstSeen } from './takSeenOnce';
import { findServedChannel } from './takServedChannels';

export interface TakChannelMessage {
  channelIndex: number;
  /** Sender name as heard; a tracker's callsign. */
  senderName: string;
  /** Message text without the `NAME: ` prefix. */
  text: string;
  timestampMs: number;
  /**
   * The packet's id where the protocol has one (Meshtastic), so two packets alike in every other
   * way are two messages; every copy of one packet carries the same id.
   */
  packetId?: number;
  hops?: number;
  /**
   * Known to come from another node, so it cannot be this radio's own send heard back. Matters
   * for a message sent without a callsign, whose text another node may well send too (`!ping`).
   */
  fromOther?: boolean;
  /** Sender's last known position, for the GeoChat point. */
  latitude?: number;
  longitude?: number;
}

/** Another copy of a channel message arrives within this long of the first. */
const RELAYED_CHANNEL_TTL_MS = 10 * 60 * 1000;
const RELAYED_CHANNEL_MAX = 512;
/** Channel messages already handed to TAK, by radio, channel, sender, send time and text. */
const relayedChannelLines = new Map<string, number>();

/**
 * True the first time a channel message is seen within the window. ATAK gives every message it
 * is handed a new id, so a second copy shows twice there. The radio can hand mesh-client the
 * same packet more than once, and Chat merges the copies by parsing them, which a reply or
 * reaction can come out of differently each time; the sender's own send time and text do not.
 */
function isFirstChannelCopy(key: string, nowMs: number): boolean {
  return isFirstSeen(relayedChannelLines, key, nowMs, RELAYED_CHANNEL_TTL_MS, RELAYED_CHANNEL_MAX);
}

/** Forget which channel messages were relayed; for tests. */
export function resetTakRelayedChannelLines(): void {
  relayedChannelLines.clear();
}

/** Hand one channel message to TAK clients, if its channel is served to them. */
function bridgeChannelToGeochat(identityId: IdentityId, msg: TakChannelMessage): void {
  const channel = findServedChannel(identityId, msg.channelIndex);
  const text = msg.text.trim().slice(0, TAK_GEOCHAT_TEXT_MAX_LEN);
  const sender = msg.senderName.trim().slice(0, TAK_GEOCHAT_CALLSIGN_MAX_LEN);
  if (!channel || !text) return;
  if (!sender) {
    // Never shown, but it can still be this radio's own send heard back: clear its echo so a
    // later message with the same words is not taken for it.
    if (!msg.fromOther) consumeTakEcho(identityId, msg.channelIndex, text);
    return;
  }
  // Before the echo check: a TAK client's own message can be heard back more than once, and the
  // echo guard only catches the first copy.
  const copyKey = [
    identityId,
    msg.channelIndex,
    msg.packetId ?? '',
    sender,
    msg.timestampMs,
    text,
  ].join('\u0000');
  if (!isFirstChannelCopy(copyKey, Date.now())) return;
  // A TAK client's own message heard back off the mesh: the clients already have it.
  if (!msg.fromOther && consumeTakEcho(identityId, msg.channelIndex, text)) return;
  pushTakGeochat({
    channelKey: channel.key,
    senderCallsign: sender,
    text,
    timeMs: msg.timestampMs,
    ...(msg.latitude != null && msg.longitude != null
      ? { latitude: msg.latitude, longitude: msg.longitude }
      : {}),
  });
}

/**
 * Hand one newly heard MeshCore channel message to the TAK relay: a `!MT1` fix on a tracker
 * channel becomes a marker, and a message on a served channel goes to TAK clients.
 * Does nothing unless a TAK sink is up and the user enabled the channel. This direction never
 * transmits on RF; TAK-to-mesh sending is `relayTakChatToMesh`.
 */
export function relayMeshcoreChannelToTak(identityId: IdentityId, msg: TakChannelMessage): void {
  if (!isTakSinkActive()) return;
  const prefs = getTakRelayPrefs(identityId);
  if (prefs.trackerChannels.includes(msg.channelIndex)) {
    const fix = parseMt1Payload(msg.text, msg.senderName);
    if (fix) {
      recordTakTrackerFix(fix, Date.now(), msg.hops);
      return;
    }
  }
  bridgeChannelToGeochat(identityId, msg);
}

/**
 * Hand one newly heard Meshtastic message (RF or MQTT) to TAK clients: a channel message if its
 * channel is served, a direct message to this radio if direct messages are on for it. Skips
 * reactions, history replay and DMs between other nodes. This direction never transmits on RF.
 */
export function relayMeshtasticChatToTak(identityId: IdentityId, chat: ChatMessage): void {
  if (!isTakSinkActive()) return;
  if (chat.emoji || chat.isHistory) return;
  if (chat.to != null && !isMeshtasticBroadcastNodeNum(chat.to)) {
    const myNodeNum = getConnection(identityId)?.myNodeNum ?? 0;
    if (myNodeNum <= 0 || chat.to !== myNodeNum || chat.sender_id === myNodeNum) return;
    relayDirectMessageToTak(identityId, 'meshtastic', {
      nodeId: chat.sender_id,
      senderName: chat.sender_name,
      text: chat.payload,
      timestampMs: effectiveMessageTimestampMs(chat.timestamp),
    });
    return;
  }
  const identityNodes = useNodeStore.getState().nodes[identityId] as
    Record<number, NodeRecord | undefined> | undefined;
  const sender = identityNodes?.[chat.sender_id];
  const myNodeNum = getConnection(identityId)?.myNodeNum ?? 0;
  bridgeChannelToGeochat(identityId, {
    channelIndex: chat.channel,
    senderName: chat.sender_name,
    ...(chat.packetId != null && chat.packetId !== 0 ? { packetId: chat.packetId } : {}),
    ...(myNodeNum > 0 && chat.sender_id !== myNodeNum ? { fromOther: true } : {}),
    text: chat.payload,
    timestampMs: effectiveMessageTimestampMs(chat.timestamp),
    ...(sender?.latitude != null && sender.longitude != null
      ? { latitude: sender.latitude, longitude: sender.longitude }
      : {}),
  });
}
