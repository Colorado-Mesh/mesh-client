import { isMeshtasticBroadcastNodeNum } from '@/shared/nodeNameUtils';
import { TAK_GEOCHAT_CALLSIGN_MAX_LEN, TAK_GEOCHAT_TEXT_MAX_LEN } from '@/shared/tak-types';

import { type NodeRecord, useNodeStore } from '../../stores/nodeStore';
import { getTakRelayPrefs } from '../../stores/takRelayPrefsStore';
import { isTakSinkActive } from '../../stores/takSinkStore';
import { recordTakTrackerFix } from '../../stores/takTrackerStore';
import { parseMt1Payload } from '../meshcore/mt1Tracker';
import { effectiveMessageTimestampMs } from '../nodeStatus';
import type { ChatMessage, IdentityId } from '../types';
import { pushTakGeochat } from './takGeochatPush';

export interface TakChannelMessage {
  channelIndex: number;
  /** Sender name as heard; a tracker's callsign. */
  senderName: string;
  /** Message text without the `NAME: ` prefix. */
  text: string;
  timestampMs: number;
  hops?: number;
  /** Sender's last known position, for the GeoChat point. */
  latitude?: number;
  longitude?: number;
}

/** Mirror one channel message into the GeoChat room bridged to its channel, if any. */
function bridgeChannelToGeochat(identityId: IdentityId, msg: TakChannelMessage): void {
  const room = getTakRelayPrefs(identityId).chatBridges[msg.channelIndex];
  const text = msg.text.trim().slice(0, TAK_GEOCHAT_TEXT_MAX_LEN);
  const sender = msg.senderName.trim().slice(0, TAK_GEOCHAT_CALLSIGN_MAX_LEN);
  if (room && text && sender) {
    pushTakGeochat({
      room,
      senderCallsign: sender,
      text,
      timeMs: msg.timestampMs,
      ...(msg.latitude != null && msg.longitude != null
        ? { latitude: msg.latitude, longitude: msg.longitude }
        : {}),
    });
  }
}

/**
 * Hand one newly heard MeshCore channel message to the TAK relay: a `!MT1` fix on a tracker
 * channel becomes a marker, and a message on a bridged channel is mirrored into its GeoChat room.
 * Does nothing unless a TAK sink is up and the user enabled the channel; never transmits on RF.
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
 * Mirror one newly heard Meshtastic channel message (RF or MQTT) into the GeoChat room bridged to
 * its channel. Skips DMs, reactions and history replay; never transmits on RF.
 */
export function relayMeshtasticChatToTak(identityId: IdentityId, chat: ChatMessage): void {
  if (!isTakSinkActive()) return;
  if (chat.emoji || chat.isHistory) return;
  if (chat.to != null && !isMeshtasticBroadcastNodeNum(chat.to)) return;
  const identityNodes = useNodeStore.getState().nodes[identityId] as
    Record<number, NodeRecord | undefined> | undefined;
  const sender = identityNodes?.[chat.sender_id];
  bridgeChannelToGeochat(identityId, {
    channelIndex: chat.channel,
    senderName: chat.sender_name,
    text: chat.payload,
    timestampMs: effectiveMessageTimestampMs(chat.timestamp),
    ...(sender?.latitude != null && sender.longitude != null
      ? { latitude: sender.latitude, longitude: sender.longitude }
      : {}),
  });
}
