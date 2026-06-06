import { isMeshtasticBroadcastNodeNum } from '@/shared/nodeNameUtils';
import { meshtasticWireUint32NonZero, sanitizeUnicodeReactionScalar } from '@/shared/reactionEmoji';

import { normalizeReactionEmoji } from '../reactions';
import type { ChatMessage } from '../types';

export type MeshtasticMqttChatWire = Omit<ChatMessage, 'id'> & { from_mqtt?: boolean };

function normalizeMeshtasticMqttTo(to: unknown): number | undefined {
  if (typeof to !== 'number' || !Number.isFinite(to)) return undefined;
  return isMeshtasticBroadcastNodeNum(to) ? undefined : to;
}

/**
 * Normalize and validate an MQTT chat payload before ingest.
 * Failure point: malformed broker JSON — returns null; caller skips insert.
 */
export function normalizeMeshtasticMqttChatMessage(
  raw: unknown,
): (MeshtasticMqttChatWire & { from_mqtt: true }) | null {
  if (typeof raw !== 'object' || raw === null) {
    console.warn('[meshtasticMqttChatNormalize] dropped non-object MQTT chat payload');
    return null;
  }
  const wire = raw as Record<string, unknown>;
  const senderId = wire.sender_id;
  const timestamp = wire.timestamp;
  const payload = wire.payload;
  if (typeof senderId !== 'number' || !Number.isFinite(senderId) || senderId <= 0) {
    console.warn('[meshtasticMqttChatNormalize] dropped MQTT chat: invalid sender_id');
    return null;
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    console.warn('[meshtasticMqttChatNormalize] dropped MQTT chat: invalid timestamp');
    return null;
  }
  if (typeof payload !== 'string') {
    console.warn('[meshtasticMqttChatNormalize] dropped MQTT chat: invalid payload');
    return null;
  }

  const cleanedReplyId = meshtasticWireUint32NonZero(wire.replyId);
  const wireEmojiRaw = meshtasticWireUint32NonZero(wire.emoji);
  const cleanedEmoji =
    wireEmojiRaw != null && wireEmojiRaw >= 1 && wireEmojiRaw <= 0x10ffff
      ? wireEmojiRaw
      : undefined;

  let cleanedPayload = payload;
  const trimmed = cleanedPayload.trim();
  if (trimmed === '0' && cleanedReplyId == null && cleanedEmoji == null) {
    cleanedPayload = '';
  }

  const baseMsg: MeshtasticMqttChatWire & { from_mqtt: true } = {
    sender_id: senderId,
    sender_name: typeof wire.sender_name === 'string' ? wire.sender_name : '',
    payload: cleanedPayload,
    channel: typeof wire.channel === 'number' && Number.isFinite(wire.channel) ? wire.channel : 0,
    timestamp,
    packetId:
      typeof wire.packetId === 'number' && Number.isFinite(wire.packetId)
        ? wire.packetId
        : undefined,
    replyId: cleanedReplyId,
    emoji: cleanedEmoji,
    to: normalizeMeshtasticMqttTo(wire.to),
    receivedVia: 'mqtt',
    from_mqtt: true,
    ...(wire.viaStoreForward === true ? { viaStoreForward: true } : {}),
    ...(typeof wire.rxHops === 'number' ? { rxHops: wire.rxHops } : {}),
  };

  if (baseMsg.emoji != null && baseMsg.replyId != null) {
    return {
      ...baseMsg,
      emoji:
        normalizeReactionEmoji(baseMsg.emoji, baseMsg.payload) ??
        sanitizeUnicodeReactionScalar(baseMsg.emoji),
    };
  }
  return baseMsg;
}
