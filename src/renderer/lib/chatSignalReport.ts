import { decodeMeshcoreGroupText } from '@/shared/meshcoreGroupText';
import { parseMeshCoreRfPacket } from '@/shared/meshcoreRfPacketParse';

import { countMessageWireBytes } from './chatComposerLimits';
import type { RxPacketEntry } from './meshcore/meshcoreHookTypes';
import { normalizeMeshcoreIncomingText } from './meshcoreChannelText';
import type { MeshcoreChatChannelSource } from './meshcoreConfiguredChatChannels';
import type { ChatMessage } from './types';

export interface MessageReceptionStats {
  snr?: number;
  rssi?: number;
  hops?: number;
  path?: string[];
}

/** Message transport evidence, independent of the active protocol or current peer route. */
export function hasRfMessageReception(message: Pick<ChatMessage, 'receivedVia'>): boolean {
  const via = message.receivedVia;
  return (
    via === 'both' || (via?.split('+').some((atom) => atom === 'rf' || atom === 'ble') ?? false)
  );
}

export function messageReceptionStats(
  message: ChatMessage,
  captured?: MessageReceptionStats,
): MessageReceptionStats {
  const snr = captured?.snr;
  const rssi = captured?.rssi;
  return {
    snr: snr != null && Number.isFinite(snr) ? snr : message.rxSnr,
    rssi: rssi != null && Number.isFinite(rssi) ? rssi : message.rxRssi,
    hops: captured?.hops ?? message.rxHops,
    path: captured?.path,
  };
}

/** Match captured channel text exactly; timing proximity alone cannot identify an RF packet. */
export function meshcoreMessageReceptionStats(
  message: ChatMessage,
  packets: readonly RxPacketEntry[],
  channels: readonly MeshcoreChatChannelSource[],
): MessageReceptionStats | undefined {
  if (message.to != null || message.roomServerId != null) return undefined;
  const secret = channels.find((channel) => channel.index === message.channel)?.secret;
  if (!secret) return undefined;
  // The first matching reception is stable even when later rebroadcasts take different routes.
  for (const packet of packets) {
    if (packet.source !== 'rf' || !packet.parseOk || packet.payloadTypeString !== 'GRP_TXT')
      continue;
    const parsed = parseMeshCoreRfPacket(packet.raw);
    if (!parsed.ok || parsed.payloadTypeString !== 'GRP_TXT') continue;
    const decoded = decodeMeshcoreGroupText(secret, parsed.innerPayload);
    if (decoded?.timestampSec !== Math.floor(message.timestamp / 1000)) continue;
    const normalized = normalizeMeshcoreIncomingText(decoded.text);
    if (normalized.senderName !== message.sender_name || normalized.payload !== message.payload)
      continue;
    const path: string[] = [];
    for (let i = 0; i < parsed.pathBytes.length; i += parsed.pathHashSizeBytes) {
      path.push(
        parsed.pathBytes
          .slice(i, i + parsed.pathHashSizeBytes)
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase(),
      );
    }
    return { snr: packet.snr, rssi: packet.rssi, hops: parsed.hopCount, path };
  }
  return undefined;
}

/** Fixed wire copy keeps signal reports readable by other clients, regardless of UI language. */
export function formatChatSignalReport(
  stats: MessageReceptionStats,
  byteBudget: number,
  receivedVia?: ChatMessage['receivedVia'],
): string | null {
  const parts: string[] = [];
  if (stats.snr != null && Number.isFinite(stats.snr)) parts.push(`SNR ${stats.snr.toFixed(1)} dB`);
  if (stats.rssi != null && Number.isFinite(stats.rssi))
    parts.push(`RSSI ${Math.round(stats.rssi)} dBm`);
  if (stats.hops != null && Number.isInteger(stats.hops) && stats.hops >= 0)
    parts.push(`${stats.hops} ${stats.hops === 1 ? 'hop' : 'hops'}`);
  if (parts.length === 0) {
    if (!hasRfMessageReception({ receivedVia })) return null;
    parts.push(`received via ${receivedVia === 'both' ? 'RF' : receivedVia?.toUpperCase()}`);
  }
  const body = `ack: ${parts.join(', ')}`;
  if (countMessageWireBytes(body) > byteBudget) return null;
  if (
    stats.path?.length &&
    stats.path.every((hash) => [2, 4, 6].includes(hash.length) && /^[0-9A-Fa-f]+$/.test(hash))
  ) {
    const withPath = `${body} via ${stats.path.join(', ')}`;
    if (countMessageWireBytes(withPath) <= byteBudget) return withPath;
  }
  return body;
}
