import {
  buildMeshcoreNodeMapFromDb,
  isMeshcoreRoomChatMessage,
  mapMeshcoreDbRowsToChatMessages,
  type MeshcoreSavedNodeHopRow,
  persistMeshcoreMessageSenderRepairs,
} from '../hooks/meshcore/meshcoreHookPreamble';
import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '../hooks/meshcore/meshcoreHookPreamble';
import {
  replaceMessageRecordsForIdentity,
  upsertMessageRecordsForIdentity,
} from '../stores/messageStore';
import { type NodeRecord, upsertNodeRecordsForIdentity } from '../stores/nodeStore';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from './chatInMemoryBuffer';
import { errLikeToLogString } from './errLikeToLogString';
import { beginIdentityHydration } from './identityHydrationCoordinator';
import type { MeshcoreContactDbRow, MeshcoreMessageDbRow } from './meshcore/meshcoreHookTypes';
import {
  meshcoreRoomServerIdsFromContacts,
  repairMeshcoreHydratedMessages,
} from './meshcoreDbCacheHydration';
import { loadPersistedMeshcoreSelfNodeId } from './meshcoreLastSelfNodeId';
import { rebuildMeshcoreDedupeIndex } from './meshcoreMessageDedupeIndex';
import { meshcoreMessageStoreId } from './meshcoreStoreDedup';
import { ensureMeshtasticChatSenderInNodeStore } from './meshtastic/meshtasticChatSenderNode';
import {
  buildMeshtasticNodeMapFromDbRows,
  dedupeMeshtasticHydrationOrphanSends,
  loadMeshtasticNodeMapFromDb,
  savedMessageToChatMessage,
} from './meshtasticDbCacheHydration';
import { getMeshtasticMessageLoadLimit } from './meshtasticMessageLoadLimit';
import {
  chatMessageToMessageRecord,
  meshNodeToNodeRecord,
  reticulumDbRowToMessageRecord,
} from './storeRecordAdapters';
import type { IdentityId, MeshNode, MeshProtocol } from './types';

/** MeshCore SQLite message load cap (matches runtime mount hydration). */
export const MESHCORE_DB_MESSAGE_LOAD_LIMIT = 500;

/** Extra room BBS rows loaded by channel (-2) and merged with the global window. */
export const MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT = 200;

/** Merge global + room-channel SQLite rows for hydration (dedupe by row id). */
export function mergeMeshcoreDbMessageRowsForHydration(
  globalRows: MeshcoreMessageDbRow[],
  roomRows: MeshcoreMessageDbRow[],
): MeshcoreMessageDbRow[] {
  const byId = new Map<number, MeshcoreMessageDbRow>();
  for (const row of globalRows) {
    if (typeof row.id === 'number') byId.set(row.id, row);
  }
  for (const row of roomRows) {
    if (typeof row.id === 'number') byId.set(row.id, row);
  }
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

export async function loadMeshcoreMessagesForHydration(): Promise<MeshcoreMessageDbRow[]> {
  const [globalRows, roomRows] = await Promise.all([
    window.electronAPI.db.getMeshcoreMessages(undefined, MESHCORE_DB_MESSAGE_LOAD_LIMIT),
    window.electronAPI.db.getMeshcoreMessages(
      MESHCORE_ROOM_MESSAGE_CHANNEL,
      MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT,
    ),
  ]);
  return mergeMeshcoreDbMessageRowsForHydration(
    globalRows as MeshcoreMessageDbRow[],
    roomRows as MeshcoreMessageDbRow[],
  );
}

function meshcoreHydratedMessageRecords(
  messages: ReturnType<typeof mapMeshcoreDbRowsToChatMessages>,
) {
  return messages.map((msg) => {
    const record = chatMessageToMessageRecord(msg);
    if (isMeshcoreRoomChatMessage(msg)) {
      record.id = meshcoreMessageStoreId(msg);
    }
    return record;
  });
}

export interface HydrateIdentityStoresOptions {
  nodes?: boolean;
  messages?: boolean;
  /** `replace` reloads the store slice from SQLite (post-delete); default upserts only. */
  messagesMode?: 'upsert' | 'replace';
}

/** Options for post-delete message refresh (runtime + store). */
export interface MessageClearRefreshOptions {
  replaceFromDb?: boolean;
  messagesMode?: 'upsert' | 'replace';
  clearedChannel?: number;
  clearedAll?: boolean;
}

export async function hydrateMeshtasticNodesFromDb(identityId: IdentityId): Promise<void> {
  const nodeMap = await loadMeshtasticNodeMapFromDb();
  syncMeshtasticNodesMapToIdentityStore(identityId, nodeMap);
}

export async function hydrateMeshtasticMessagesFromDb(
  identityId: IdentityId,
  messagesMode: 'upsert' | 'replace' = 'upsert',
): Promise<void> {
  const msgs = await window.electronAPI.db.getMessages(undefined, getMeshtasticMessageLoadLimit());
  const sanitized = dedupeMeshtasticHydrationOrphanSends(msgs.map(savedMessageToChatMessage));
  const reversed = sanitized.reverse();
  const trimmed = trimChatMessagesToMax(reversed, MAX_IN_MEMORY_CHAT_MESSAGES);
  const records = trimmed.map((msg) => chatMessageToMessageRecord(msg));
  if (messagesMode === 'replace') {
    replaceMessageRecordsForIdentity(identityId, records);
  } else {
    upsertMessageRecordsForIdentity(identityId, records);
  }
  for (const msg of trimmed) {
    if (msg.sender_id <= 0) continue;
    ensureMeshtasticChatSenderInNodeStore(identityId, msg.sender_id, {
      lastHeardAt: msg.timestamp,
      source: msg.receivedVia === 'mqtt' ? 'mqtt' : 'rf',
    });
  }
}

/** Merge nodes-table hop stubs with meshcore_hop_history for hydration backfill. */
export function mergeMeshcoreSavedHopRowsForHydration(
  nodesTableRows: MeshcoreSavedNodeHopRow[],
  hopHistoryRows: readonly { node_id: number; hops: number | null }[],
): MeshcoreSavedNodeHopRow[] {
  const byId = new Map<number, MeshcoreSavedNodeHopRow>();
  for (const row of nodesTableRows) {
    byId.set(row.node_id, row);
  }
  for (const row of hopHistoryRows) {
    const hopCount = row.hops;
    if (hopCount == null) continue;
    const existing = byId.get(row.node_id);
    if (existing?.hops_away != null || existing?.hops != null) continue;
    byId.set(row.node_id, {
      node_id: row.node_id,
      hops_away: hopCount,
      hops: hopCount,
    });
  }
  return Array.from(byId.values());
}

export async function loadMeshcoreSavedHopRowsForHydration(): Promise<MeshcoreSavedNodeHopRow[]> {
  const [nodesTableRows, hopHistoryRows] = await Promise.all([
    window.electronAPI.db.getNodes(),
    window.electronAPI.db.getAllMeshcoreHopHistory(),
  ]);
  const hopRows: MeshcoreSavedNodeHopRow[] = nodesTableRows.map((row) => ({
    node_id: row.node_id,
    hops_away: row.hops_away ?? null,
    hops: row.hops ?? null,
  }));
  return mergeMeshcoreSavedHopRowsForHydration(hopRows, hopHistoryRows);
}

export async function hydrateMeshcoreNodesFromDb(identityId: IdentityId): Promise<void> {
  const [rows, savedNodes] = await Promise.all([
    window.electronAPI.db.getMeshcoreContacts(),
    loadMeshcoreSavedHopRowsForHydration(),
  ]);
  const dbMsgs = await loadMeshcoreMessagesForHydration();
  const mapped = mapMeshcoreDbRowsToChatMessages(dbMsgs);
  const nodeMap = buildMeshcoreNodeMapFromDb(rows as MeshcoreContactDbRow[], savedNodes, mapped);
  syncMeshcoreNodesMapToIdentityStore(identityId, nodeMap);
}

/** Push an in-memory MeshCore node map into identity-scoped Zustand (e.g. after radio contact sync). */
export function syncMeshcoreNodesMapToIdentityStore(
  identityId: IdentityId,
  nodes: Map<number, MeshNode>,
): void {
  upsertNodeRecordsForIdentity(
    identityId,
    Array.from(nodes.values(), (node) => meshNodeToNodeRecord(node)),
  );
}

/** Push an in-memory Meshtastic node map into identity-scoped Zustand (e.g. connect-time DB cache). */
export function syncMeshtasticNodesMapToIdentityStore(
  identityId: IdentityId,
  nodes: Map<number, MeshNode>,
): void {
  upsertNodeRecordsForIdentity(
    identityId,
    Array.from(nodes.values(), (node) => meshNodeToNodeRecord(node)),
  );
}

export async function hydrateMeshcoreMessagesFromDb(
  identityId: IdentityId,
  messagesMode: 'upsert' | 'replace' = 'upsert',
): Promise<void> {
  const [dbMsgs, contactRows] = await Promise.all([
    loadMeshcoreMessagesForHydration(),
    window.electronAPI.db.getMeshcoreContacts(),
  ]);
  const rows = dbMsgs;
  const roomServerIds = meshcoreRoomServerIdsFromContacts(contactRows as MeshcoreContactDbRow[]);
  const mapped = repairMeshcoreHydratedMessages(
    mapMeshcoreDbRowsToChatMessages(rows),
    roomServerIds,
    loadPersistedMeshcoreSelfNodeId(),
  );
  void persistMeshcoreMessageSenderRepairs(rows, mapped);
  const trimmed = trimChatMessagesToMax(mapped, MAX_IN_MEMORY_CHAT_MESSAGES);
  const records = meshcoreHydratedMessageRecords(trimmed);
  if (messagesMode === 'replace') {
    replaceMessageRecordsForIdentity(identityId, records);
    rebuildMeshcoreDedupeIndex(
      identityId,
      trimmed.map((message) => ({ id: String(message.id), message })),
    );
  } else {
    upsertMessageRecordsForIdentity(identityId, records);
  }
}

type IdentityHydratorFn = (
  identityId: IdentityId,
  opts: HydrateIdentityStoresOptions,
) => Promise<void>;

async function hydrateMeshtasticIdentity(
  identityId: IdentityId,
  opts: HydrateIdentityStoresOptions,
): Promise<void> {
  const loadNodes = opts.nodes !== false;
  const loadMessages = opts.messages !== false;
  const messagesMode = opts.messagesMode ?? 'upsert';
  if (loadNodes && loadMessages) {
    await Promise.all([
      hydrateMeshtasticNodesFromDb(identityId),
      hydrateMeshtasticMessagesFromDb(identityId, messagesMode),
    ]);
  } else if (loadNodes) {
    await hydrateMeshtasticNodesFromDb(identityId);
  } else if (loadMessages) {
    await hydrateMeshtasticMessagesFromDb(identityId, messagesMode);
  }
}

async function hydrateMeshcoreIdentity(
  identityId: IdentityId,
  opts: HydrateIdentityStoresOptions,
): Promise<void> {
  const loadNodes = opts.nodes !== false;
  const loadMessages = opts.messages !== false;
  const messagesMode = opts.messagesMode ?? 'upsert';
  if (loadNodes && loadMessages) {
    await Promise.all([
      hydrateMeshcoreNodesFromDb(identityId),
      hydrateMeshcoreMessagesFromDb(identityId, messagesMode),
    ]);
  } else if (loadNodes) {
    await hydrateMeshcoreNodesFromDb(identityId);
  } else if (loadMessages) {
    await hydrateMeshcoreMessagesFromDb(identityId, messagesMode);
  }
}

function hydrateReticulumIdentity(
  identityId: IdentityId,
  opts: HydrateIdentityStoresOptions,
): Promise<void> {
  const loadNodes = opts.nodes !== false;
  const loadMessages = opts.messages !== false;
  return (async () => {
    if (loadNodes) {
      try {
        const rows = (await window.electronAPI.db.getReticulumDestinations()) as {
          destination_hash: string;
          display_name?: string | null;
          last_heard?: number | null;
          favorited?: number | null;
        }[];
        const { reticulumHashToNodeId, registerReticulumDestinationHash } =
          await import('./reticulum/destHash');
        const records: NodeRecord[] = rows.map((row) => {
          const nodeId = reticulumHashToNodeId(row.destination_hash);
          registerReticulumDestinationHash(nodeId, row.destination_hash);
          return {
            nodeId,
            longName: row.display_name ?? row.destination_hash.slice(0, 16),
            shortName: row.display_name?.slice(0, 4) ?? 'RT',
            lastHeardAt: row.last_heard ?? undefined,
          };
        });
        upsertNodeRecordsForIdentity(identityId, records);
      } catch (e) {
        console.warn('[hydrateReticulumIdentity] destinations ' + errLikeToLogString(e));
      }
    }
    if (loadMessages) {
      try {
        const rows = (await window.electronAPI.db.getReticulumMessages(identityId, 500)) as {
          sender_id: string;
          sender_name?: string;
          payload: string;
          timestamp: number;
          to_hash?: string;
        }[];
        replaceMessageRecordsForIdentity(
          identityId,
          rows.map((row) => reticulumDbRowToMessageRecord(row)),
        );
      } catch (e) {
        console.warn('[hydrateReticulumIdentity] messages ' + errLikeToLogString(e));
      }
    }
  })();
}

const IDENTITY_STORE_HYDRATORS: Record<MeshProtocol, IdentityHydratorFn> = {
  meshtastic: hydrateMeshtasticIdentity,
  meshcore: hydrateMeshcoreIdentity,
  reticulum: hydrateReticulumIdentity,
};

/**
 * Loads SQLite history into identity-scoped Zustand stores for UI ([#375] / hook deconstruction).
 * No-ops are avoided by callers checking `identityId` before invoke.
 */
export async function hydrateIdentityStoresFromDb(
  protocol: MeshProtocol,
  identityId: IdentityId,
  opts: HydrateIdentityStoresOptions = { nodes: true, messages: true },
): Promise<void> {
  const loadNodes = opts.nodes !== false;
  const loadMessages = opts.messages !== false;
  if (!loadNodes && !loadMessages) return;

  const hydrator = IDENTITY_STORE_HYDRATORS[protocol];
  if (!hydrator) return;

  const isCurrent = beginIdentityHydration(protocol, identityId);
  try {
    await hydrator(identityId, opts);
    if (!isCurrent()) return;
  } catch (e) {
    if (!isCurrent()) return;
    console.warn(`[hydrateIdentityStoresFromDb] ${protocol} failed ` + errLikeToLogString(e));
  }
}

/** @internal Exported for tests that assert row mapping without IPC. */
export { buildMeshtasticNodeMapFromDbRows };
