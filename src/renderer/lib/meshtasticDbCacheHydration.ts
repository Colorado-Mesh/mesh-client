import { meshtasticShortNameAfterClearingDefault } from '../../shared/nodeNameUtils';
import { sanitizeUnicodeReactionScalar } from '../../shared/reactionEmoji';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from './chatInMemoryBuffer';
import { meshtasticHwModelName } from './hardwareModels';
import { getMeshtasticMessageLoadLimit } from './legacySideEffects/meshtasticDbHydration';
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
    const long_name = n.long_name ?? '';
    const rawHw = n.hw_model;
    const hw_model =
      typeof rawHw === 'string' && /^\d+$/.test(rawHw.trim())
        ? meshtasticHwModelName(parseInt(rawHw, 10))
        : (rawHw ?? '');
    nodeMap.set(n.node_id, {
      ...n,
      long_name,
      hw_model,
      short_name: meshtasticShortNameAfterClearingDefault(long_name, n.short_name ?? '', n.node_id),
      role: parseNodeRole(n.role),
      favorited: Boolean(n.favorited),
      heard_via_mqtt_only: n.source === 'mqtt',
      hops: n.hops ?? undefined,
      path: parseNodePath(n.path),
      hops_away: n.hops ?? n.hops_away ?? undefined,
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
): ChatMessage[] {
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

/** Sanitized Meshtastic messages from SQLite (newest-first, same order as legacy hydration). */
export async function loadMeshtasticMessagesFromDb(): Promise<ChatMessage[]> {
  const msgs = await window.electronAPI.db.getMessages(undefined, getMeshtasticMessageLoadLimit());
  const sanitized = msgs.map((m) => ({
    ...m,
    emoji: m.emoji != null ? sanitizeUnicodeReactionScalar(m.emoji) : undefined,
  }));
  return sanitized.reverse();
}
