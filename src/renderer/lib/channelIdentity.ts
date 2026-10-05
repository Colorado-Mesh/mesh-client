import {
  type ChannelIdentityProtocol,
  computeChannelIdentityKey,
} from '../../shared/channelIdentityKey';
import { isMeshtasticBroadcastNodeNum } from '../../shared/nodeNameUtils';
import { getLiveChannelKeys } from '../stores/liveChannelKeyStore';
import { MESHCORE_UNCONFIGURED_CHANNEL_SECRET_HEX } from './meshcoreConfiguredChatChannels';
import type { ChatMessage } from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function bytesHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** MeshCore runtime channels (`{ index, name, secret }`) → slot → channel identity key. */
export function buildMeshcoreChannelKeyByIndex(
  channels: readonly unknown[],
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const ch of channels) {
    const rec = asRecord(ch);
    if (!rec) continue;
    const { index, name, secret } = rec;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) continue;
    if (typeof name !== 'string' || !(secret instanceof Uint8Array)) continue;
    if (secret.length !== 16 || bytesHex(secret) === MESHCORE_UNCONFIGURED_CHANNEL_SECRET_HEX) {
      continue;
    }
    if (index in out) continue;
    out[index] = computeChannelIdentityKey('meshcore', name, secret);
  }
  return out;
}

/**
 * Meshtastic channel configs (`{ index, name, role, psk }`) → slot → channel identity key.
 * Disabled slots (role 0) are skipped; the raw config name is used so an unnamed primary
 * channel keys the same on every radio sharing its PSK.
 */
export function buildMeshtasticChannelKeyByIndex(
  channelConfigs: readonly unknown[],
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const cfg of channelConfigs) {
    const rec = asRecord(cfg);
    if (!rec) continue;
    const { index, name, role, psk } = rec;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) continue;
    if (role === 0 || !(psk instanceof Uint8Array)) continue;
    out[index] = computeChannelIdentityKey('meshtastic', typeof name === 'string' ? name : '', psk);
  }
  return out;
}

/**
 * Channel key to persist with a group-channel row. Keeps a key the message already carries;
 * otherwise uses the connected radio's slot mapping, but only when the row was recorded by that
 * radio (never stamp another radio's history with this radio's layout).
 * `channelIndex` < 0 (DM / room) never gets a key.
 */
export function resolveChannelKeyForPersist(
  protocol: ChannelIdentityProtocol,
  msg: { channelKey?: string; radioNodeId?: number },
  channelIndex: number,
  radioNodeId?: number | null,
): string | null {
  if (!Number.isInteger(channelIndex) || channelIndex < 0) return null;
  if (msg.channelKey) return msg.channelKey;
  const live = getLiveChannelKeys(protocol);
  if (!live) return null;
  if (msg.radioNodeId != null && msg.radioNodeId !== live.radioNodeId) return null;
  if (radioNodeId != null && radioNodeId > 0 && radioNodeId !== live.radioNodeId) return null;
  return live.keyByIndex[channelIndex] ?? null;
}

/** True for a Meshtastic group-channel message (not a DM). */
export function isMeshtasticChannelMessage(msg: { to?: number }): boolean {
  return msg.to == null || msg.to === 0 || isMeshtasticBroadcastNodeNum(msg.to);
}

/**
 * Meshtastic `db:saveMessage` payload with the recording radio and channel identity attached.
 * MQTT-only sessions (no radio) persist without a radio id.
 */
export function withMeshtasticChannelIdentity<T extends ChatMessage>(msg: T): T {
  const live = getLiveChannelKeys('meshtastic');
  const radioNodeId = msg.radioNodeId ?? live?.radioNodeId ?? undefined;
  const channelKey = isMeshtasticChannelMessage(msg)
    ? resolveChannelKeyForPersist('meshtastic', msg, msg.channel, radioNodeId)
    : null;
  if (radioNodeId === msg.radioNodeId && (channelKey ?? undefined) === msg.channelKey) return msg;
  return {
    ...msg,
    ...(radioNodeId != null ? { radioNodeId } : {}),
    ...(channelKey ? { channelKey } : {}),
  };
}
