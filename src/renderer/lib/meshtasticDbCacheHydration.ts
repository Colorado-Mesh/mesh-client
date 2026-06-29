import type { SavedMessage } from '@/shared/electron-api.types';

import { meshtasticShortNameAfterClearingDefault } from '../../shared/nodeNameUtils';
import { sanitizeUnicodeReactionScalar } from '../../shared/reactionEmoji';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from './chatInMemoryBuffer';
import { meshtasticHwModelName } from './hardwareModels';
import { meshcoreHwModelIsContactTypeLabel } from './meshcoreUtils';
import { getMeshtasticMessageLoadLimit } from './meshtasticMessageLoadLimit';
import type { ChatMessage, MeshNode } from './types';

const LEGACY_ROLE_STRINGS: Record<string, number> = {
  Client: 0,
  Mute: 1,
  Router: 2,
  'Rtr+Client': 3,
  Repeater: 4,
  Tracker: 5,
  Sensor: 6,
  TAK: 7,
  Hidden: 8,
  'L&F': 9,
  'TAK Tracker': 10,
  'Rtr Late': 11,
  Base: 12,
};

function parseNodeRole(val: unknown): number | undefined {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    if (!isNaN(n)) return n;
    return LEGACY_ROLE_STRINGS[val];
  }
  return undefined;
}

function parseNodePath(path: unknown): number[] | undefined {
  if (typeof path !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(path);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.every((v) => typeof v === 'number') ? parsed : undefined;
  } catch {
    // catch-no-log-ok corrupt path JSON from SQLite is ignored
    return undefined;
  }
}

type SavedNodeRow = Awaited<ReturnType<typeof window.electronAPI.db.getNodes>>[number];
interface MeshcoreContactHopRow {
  node_id: number;
  hops_away: number | null;
}

/** Build in-memory Meshtastic node map from SQLite rows (shared by mount/connect hydration). */
export function buildMeshtasticNodeMapFromDbRows(
  savedNodes: SavedNodeRow[],
  meshcoreContacts: MeshcoreContactHopRow[] = [],
): Map<number, MeshNode> {
  const nodeMap = new Map<number, MeshNode>();
  for (const n of savedNodes) {
    // MeshCore contact rows were incorrectly persisted via db.saveNode; keep them off the Meshtastic map.
    if (meshcoreHwModelIsContactTypeLabel(n.hw_model ?? undefined)) continue;
    const long_name = n.long_name ?? '';
    const rawHw = n.hw_model;
    const hw_model =
      typeof rawHw === 'string' && /^\d+$/.test(rawHw.trim())
        ? meshtasticHwModelName(parseInt(rawHw, 10))
        : (rawHw ?? '');
    nodeMap.set(n.node_id, {
      node_id: n.node_id,
      long_name,
      hw_model,
      short_name: meshtasticShortNameAfterClearingDefault(long_name, n.short_name ?? '', n.node_id),
      snr: n.snr ?? 0,
      rssi: n.rssi ?? undefined,
      battery: n.battery ?? 0,
      last_heard: n.last_heard ?? 0,
      latitude: n.latitude,
      longitude: n.longitude,
      role: parseNodeRole(n.role),
      hops_away: n.hops ?? n.hops_away ?? undefined,
      via_mqtt: n.via_mqtt ?? undefined,
      voltage: n.voltage ?? undefined,
      channel_utilization: n.channel_utilization ?? undefined,
      air_util_tx: n.air_util_tx ?? undefined,
      altitude: n.altitude ?? undefined,
      favorited: Boolean(n.favorited),
      source: n.source === 'mqtt' ? 'mqtt' : n.source === 'rf' ? 'rf' : undefined,
      num_packets_rx_bad: n.num_packets_rx_bad ?? undefined,
      num_rx_dupe: n.num_rx_dupe ?? undefined,
      num_packets_rx: n.num_packets_rx ?? undefined,
      num_packets_tx: n.num_packets_tx ?? undefined,
      heard_via_mqtt_only: n.source === 'mqtt',
      hops: n.hops ?? undefined,
      path: parseNodePath(n.path),
    });
  }
  for (const mc of meshcoreContacts) {
    if (mc.hops_away != null) {
      const existing = nodeMap.get(mc.node_id);
      if (existing && existing.hops_away === undefined) {
        nodeMap.set(mc.node_id, { ...existing, hops_away: mc.hops_away });
      }
    }
  }
  return nodeMap;
}

/** Loads persisted nodes for connect-time UI cache (before `configure()` completes). */
export async function loadMeshtasticNodeMapFromDb(): Promise<Map<number, MeshNode>> {
  const [savedNodes, meshcoreContacts] = await Promise.all([
    window.electronAPI.db.getNodes(),
    window.electronAPI.db.getMeshcoreContacts(),
  ]);
  return buildMeshtasticNodeMapFromDbRows(savedNodes, meshcoreContacts as MeshcoreContactHopRow[]);
}

const ORPHAN_OPTIMISTIC_WINDOW_MS = 120_000;

/**
 * Drop stale optimistic SQLite rows left when RF echo persisted the real packet_id
 * before updateMessagePacketId could rewrite the temp id (restart showed duplicates).
 */
export function dedupeMeshtasticHydrationOrphanSends(messages: ChatMessage[]): ChatMessage[] {
  const dropPacketIds = new Set<number>();
  for (const candidate of messages) {
    if (candidate.status !== 'sending' || candidate.packetId == null || candidate.packetId === 0) {
      continue;
    }
    const hasAckedTwin = messages.some(
      (other) =>
        other !== candidate &&
        other.sender_id === candidate.sender_id &&
        other.channel === candidate.channel &&
        other.payload === candidate.payload &&
        other.status !== 'sending' &&
        other.packetId != null &&
        other.packetId !== candidate.packetId &&
        Math.abs(other.timestamp - candidate.timestamp) <= ORPHAN_OPTIMISTIC_WINDOW_MS,
    );
    if (hasAckedTwin) dropPacketIds.add(candidate.packetId);
  }
  return messages.filter((m) => m.packetId == null || !dropPacketIds.has(m.packetId));
}

export function meshtasticLoosePersistenceMatchKey(msg: ChatMessage): string {
  return [
    msg.sender_id,
    msg.payload,
    msg.channel,
    msg.timestamp,
    msg.emoji ?? '',
    msg.replyId ?? '',
    msg.to ?? '',
  ].join('|');
}

/** RF/MQTT can deliver lines before SQLite hydration resolves; replacing state would drop them. */
export function mergeMeshtasticDbHydrationWithLive(
  prev: ChatMessage[],
  fromDb: ChatMessage[],
  opts?: { replaceFromDb?: boolean },
): ChatMessage[] {
  if (opts?.replaceFromDb) {
    const sorted = [...fromDb];
    sorted.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return (a.id ?? 0) - (b.id ?? 0);
    });
    return trimChatMessagesToMax(sorted, MAX_IN_MEMORY_CHAT_MESSAGES);
  }
  const dbIds = new Set(fromDb.map((d) => d.id).filter((id): id is number => id != null));
  const dbPacketIds = new Set(
    fromDb.map((d) => d.packetId).filter((pid): pid is number => pid != null && pid !== 0),
  );
  const dbLoose = new Set(fromDb.map(meshtasticLoosePersistenceMatchKey));
  const inFlight = prev.filter((m) => {
    if (m.id != null && dbIds.has(m.id)) return false;
    if (m.packetId != null && m.packetId !== 0 && dbPacketIds.has(m.packetId)) return false;
    return !dbLoose.has(meshtasticLoosePersistenceMatchKey(m));
  });
  const merged = [...fromDb, ...inFlight];
  merged.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return (a.id ?? 0) - (b.id ?? 0);
  });
  return trimChatMessagesToMax(merged, MAX_IN_MEMORY_CHAT_MESSAGES);
}

export function savedMessageToChatMessage(m: SavedMessage): ChatMessage {
  return {
    id: m.id,
    sender_id: m.sender_id,
    sender_name: m.sender_name,
    payload: m.payload,
    channel: m.channel,
    timestamp: m.timestamp,
    packetId: m.packetId ?? undefined,
    status: m.status as ChatMessage['status'],
    error: m.error ?? undefined,
    mqttStatus: (m.mqttStatus as ChatMessage['mqttStatus']) ?? undefined,
    emoji: m.emoji != null ? sanitizeUnicodeReactionScalar(m.emoji) : undefined,
    replyId: m.replyId ?? undefined,
    to: m.to,
    receivedVia: (m.receivedVia as ChatMessage['receivedVia']) ?? undefined,
    viaStoreForward: m.viaStoreForward,
  };
}

/** Sanitized Meshtastic messages from SQLite (newest-first, same order as legacy hydration). */
export async function loadMeshtasticMessagesFromDb(): Promise<ChatMessage[]> {
  const msgs = await window.electronAPI.db.getMessages(undefined, getMeshtasticMessageLoadLimit());
  const sanitized = msgs.map(savedMessageToChatMessage);
  return dedupeMeshtasticHydrationOrphanSends(sanitized).reverse();
}
