import {
  MESHCORE_DB_MESSAGE_LOAD_LIMIT,
  MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT,
  MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT,
} from '@/shared/meshcoreMessageHydration';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

import {
  buildMeshcoreNodeMapFromDb,
  isMeshcoreRoomChatMessage,
  mapMeshcoreDbRowsToChatMessages,
  type MeshcoreSavedNodeHopRow,
  persistMeshcoreMessageSenderRepairs,
} from '../hooks/meshcore/meshcoreHookPreamble';
import {
  replaceMessageRecordsForIdentity,
  upsertMessageRecordsForIdentity,
} from '../stores/messageStore';
import {
  type NodeRecord,
  replaceNodeRecordsForIdentity,
  upsertNodeRecordsForIdentity,
  useNodeStore,
} from '../stores/nodeStore';
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
import { trimMeshcoreChatMessages } from './meshcoreMessageMemoryWindow';
import { meshcoreMessageStoreId } from './meshcoreStoreDedup';
import { ensureMeshtasticChatSenderInNodeStore } from './meshtastic/meshtasticChatSenderNode';
import {
  buildMeshtasticNodeMapFromDbRows,
  dedupeMeshtasticHydrationOrphanSends,
  loadMeshtasticNodeMapFromDb,
  savedMessageToChatMessage,
} from './meshtasticDbCacheHydration';
import { getMeshtasticMessageLoadLimit } from './meshtasticMessageLoadLimit';
import { lastHeardToUnixSeconds } from './nodeStatus';
import {
  chatMessageToMessageRecord,
  meshNodeToNodeRecord,
  reticulumDbRowToMessageRecord,
} from './storeRecordAdapters';
import type { IdentityId, MeshNode, MeshProtocol } from './types';

export {
  MESHCORE_DB_MESSAGE_LOAD_LIMIT,
  MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT,
  MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT,
};

/** Merge hydration SQLite row lists (dedupe by row id; oldest-first). */
export function mergeMeshcoreDbMessageRowsForHydration(
  ...rowLists: MeshcoreMessageDbRow[][]
): MeshcoreMessageDbRow[] {
  const byId = new Map<number, MeshcoreMessageDbRow>();
  for (const rows of rowLists) {
    for (const row of rows) {
      if (typeof row.id === 'number') byId.set(row.id, row);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

export async function loadMeshcoreMessagesForHydration(): Promise<MeshcoreMessageDbRow[]> {
  const rows = await window.electronAPI.db.getMeshcoreMessagesForHydration({
    globalLimit: MESHCORE_DB_MESSAGE_LOAD_LIMIT,
    perChannelLimit: MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT,
    roomLimit: MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT,
  });
  return rows as MeshcoreMessageDbRow[];
}

/**
 * MeshCore chat rows → store records.
 * Channel / room / packetless DM ids must match live ingest (`meshcoreMessageStoreId`), not
 * `chatMessageToMessageRecord`'s `${sender}-${ts}-${channel}` fallback — otherwise RF merges
 * that prefer PacketRouter `ch:…:wire` ids leave orphan hydrate rows (perfect UI duplicates).
 */
export function meshcoreHydratedMessageRecords(
  messages: ReturnType<typeof mapMeshcoreDbRowsToChatMessages>,
) {
  const usedIds = new Set<string>();
  return messages.map((msg) => {
    const record = chatMessageToMessageRecord(msg);
    if (
      isMeshcoreRoomChatMessage(msg) ||
      msg.channel >= 0 ||
      (msg.channel === -1 && msg.packetId == null)
    ) {
      let id = msg.storeId ?? meshcoreMessageStoreId(msg);
      // Same sender + UTC second share one meshcoreMessageStoreId; keep later DB rows distinct.
      if (usedIds.has(id) && msg.id != null) {
        id = `${id}:${msg.id}`;
      }
      usedIds.add(id);
      record.id = id;
    }
    return record;
  });
}

export interface HydrateIdentityStoresOptions {
  nodes?: boolean;
  messages?: boolean;
  /** `replace` reloads the store slice from SQLite (post-delete); default upserts only. */
  messagesMode?: 'upsert' | 'replace';
  /** `replace` reloads the node bucket from SQLite (post-delete); default upserts only. */
  nodesMode?: 'upsert' | 'replace';
}

/** Options for post-delete message refresh (runtime + store). */
export interface MessageClearRefreshOptions {
  replaceFromDb?: boolean;
  messagesMode?: 'upsert' | 'replace';
  clearedChannel?: number;
  clearedAll?: boolean;
}

/** Apply Meshtastic node rows (+ MeshCore hop overlays) into the identity node store. */
function applyMeshtasticNodesFromRows(
  identityId: IdentityId,
  savedNodes: Awaited<ReturnType<typeof window.electronAPI.db.getNodes>>,
  meshcoreContacts: { node_id: number; hops_away: number | null }[],
  nodesMode: 'upsert' | 'replace',
): void {
  const nodeMap = buildMeshtasticNodeMapFromDbRows(savedNodes, meshcoreContacts);
  if (nodesMode === 'replace') {
    replaceNodesMapInIdentityStore(identityId, nodeMap);
  } else {
    syncNodesMapToIdentityStore(identityId, nodeMap);
  }
}

/** Apply Meshtastic SavedMessage rows into the identity message store (orphan-send dedupe). */
function applyMeshtasticMessagesFromRows(
  identityId: IdentityId,
  msgs: Awaited<ReturnType<typeof window.electronAPI.db.getMessages>>,
  messagesMode: 'upsert' | 'replace',
): void {
  const sanitized = dedupeMeshtasticHydrationOrphanSends(msgs.map(savedMessageToChatMessage));
  const reversed = sanitized.toReversed();
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

export async function hydrateMeshtasticNodesFromDb(
  identityId: IdentityId,
  nodesMode: 'upsert' | 'replace' = 'upsert',
  isCurrent?: () => boolean,
): Promise<void> {
  const nodeMap = await loadMeshtasticNodeMapFromDb();
  if (isCurrent && !isCurrent()) return;
  if (nodesMode === 'replace') {
    replaceNodesMapInIdentityStore(identityId, nodeMap);
  } else {
    syncNodesMapToIdentityStore(identityId, nodeMap);
  }
}

export async function hydrateMeshtasticMessagesFromDb(
  identityId: IdentityId,
  messagesMode: 'upsert' | 'replace' = 'upsert',
  isCurrent?: () => boolean,
): Promise<void> {
  const msgs = await window.electronAPI.db.getMessages(undefined, getMeshtasticMessageLoadLimit());
  if (isCurrent && !isCurrent()) return;
  applyMeshtasticMessagesFromRows(identityId, msgs, messagesMode);
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

/** Build hop rows for MeshCore node map from nodes-table + hop-history snapshot parts. */
export function meshcoreSavedHopRowsFromHydrationParts(
  nodesTableRows: Awaited<ReturnType<typeof window.electronAPI.db.getNodes>>,
  hopHistoryRows: readonly { node_id: number; hops: number | null }[],
): MeshcoreSavedNodeHopRow[] {
  const hopRows: MeshcoreSavedNodeHopRow[] = nodesTableRows.map((row) => ({
    node_id: row.node_id,
    hops_away: row.hops_away ?? null,
    hops: row.hops ?? null,
  }));
  return mergeMeshcoreSavedHopRowsForHydration(hopRows, hopHistoryRows);
}

export async function loadMeshcoreSavedHopRowsForHydration(): Promise<MeshcoreSavedNodeHopRow[]> {
  const [nodesTableRows, hopHistoryRows] = await Promise.all([
    window.electronAPI.db.getNodes(),
    window.electronAPI.db.getAllMeshcoreHopHistory(),
  ]);
  return meshcoreSavedHopRowsFromHydrationParts(nodesTableRows, hopHistoryRows);
}

/** Fetch MeshCore contacts, hops, and fair message window in one IPC round-trip. */
export async function loadMeshcoreIdentityHydrationSnapshot(): Promise<{
  contacts: MeshcoreContactDbRow[];
  savedNodes: MeshcoreSavedNodeHopRow[];
  messages: MeshcoreMessageDbRow[];
}> {
  const snap = await window.electronAPI.db.getMeshcoreIdentityHydration({
    globalLimit: MESHCORE_DB_MESSAGE_LOAD_LIMIT,
    perChannelLimit: MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT,
    roomLimit: MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT,
  });
  return {
    contacts: snap.contacts as MeshcoreContactDbRow[],
    savedNodes: meshcoreSavedHopRowsFromHydrationParts(snap.nodes, snap.hopHistory),
    messages: snap.messages as MeshcoreMessageDbRow[],
  };
}

/** Hydrate MeshCore node map from the combined identity snapshot (contacts + hops + msgs). */
export async function hydrateMeshcoreNodesFromDb(
  identityId: IdentityId,
  nodesMode: 'upsert' | 'replace' = 'upsert',
  isCurrent?: () => boolean,
): Promise<void> {
  const snap = await loadMeshcoreIdentityHydrationSnapshot();
  const mapped = mapMeshcoreDbRowsToChatMessages(snap.messages);
  const nodeMap = buildMeshcoreNodeMapFromDb(snap.contacts, snap.savedNodes, mapped);
  if (isCurrent && !isCurrent()) return;
  if (nodesMode === 'replace') {
    replaceNodesMapInIdentityStore(identityId, nodeMap);
  } else {
    syncNodesMapToIdentityStore(identityId, nodeMap);
  }
}

/** Push an in-memory node map into identity-scoped Zustand (e.g. after radio contact sync). */
export interface SyncNodesMapToIdentityStoreOpts {
  /**
   * Never lower an existing `lastHeardAt`. Other ingress paths (MeshCore RF RX, PacketRouter)
   * bump the store directly, so a stale runtime Map must not roll that freshness back.
   */
  monotonicLastHeard?: boolean;
}

export function syncNodesMapToIdentityStore(
  identityId: IdentityId,
  nodes: Map<number, MeshNode>,
  opts?: SyncNodesMapToIdentityStoreOpts,
): void {
  const records = Array.from(nodes.values(), (node) => meshNodeToNodeRecord(node));
  if (opts?.monotonicLastHeard) {
    const existingById = useNodeStore.getState().nodes[identityId] as
      Record<number, NodeRecord | undefined> | undefined;
    for (const record of records) {
      const existingLastHeard = existingById?.[record.nodeId]?.lastHeardAt;
      if (existingLastHeard == null) continue;
      const existingSec = lastHeardToUnixSeconds(existingLastHeard);
      const incomingSec = lastHeardToUnixSeconds(record.lastHeardAt ?? 0);
      if (existingSec > incomingSec) record.lastHeardAt = existingLastHeard;
    }
  }
  upsertNodeRecordsForIdentity(identityId, records);
}

/** Replace identity node bucket from a full map (post-delete DB reload). */
export function replaceNodesMapInIdentityStore(
  identityId: IdentityId,
  nodes: Map<number, MeshNode>,
): void {
  replaceNodeRecordsForIdentity(
    identityId,
    Array.from(nodes.values(), (node) => meshNodeToNodeRecord(node)),
  );
}

/** Apply MeshCore DB message rows (with room repairs) into the identity message store. */
function applyMeshcoreMessagesFromSnapshot(
  identityId: IdentityId,
  dbMsgs: MeshcoreMessageDbRow[],
  contactRows: MeshcoreContactDbRow[],
  messagesMode: 'upsert' | 'replace',
): void {
  const roomServerIds = meshcoreRoomServerIdsFromContacts(contactRows);
  const mapped = repairMeshcoreHydratedMessages(
    mapMeshcoreDbRowsToChatMessages(dbMsgs),
    roomServerIds,
    loadPersistedMeshcoreSelfNodeId(),
  );
  void Promise.resolve(persistMeshcoreMessageSenderRepairs(dbMsgs, mapped)).catch((e: unknown) => {
    console.warn(
      '[hydrateMeshcoreMessagesFromDb] sender repair persist failed ' + errLikeToLogString(e),
    );
  });
  const trimmed = trimMeshcoreChatMessages(mapped);
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

export async function hydrateMeshcoreMessagesFromDb(
  identityId: IdentityId,
  messagesMode: 'upsert' | 'replace' = 'upsert',
  isCurrent?: () => boolean,
): Promise<void> {
  const snap = await loadMeshcoreIdentityHydrationSnapshot();
  if (isCurrent && !isCurrent()) return;
  applyMeshcoreMessagesFromSnapshot(identityId, snap.messages, snap.contacts, messagesMode);
}

type IdentityHydratorFn = (
  identityId: IdentityId,
  opts: HydrateIdentityStoresOptions,
  isCurrent: () => boolean,
) => Promise<void>;

/** Meshtastic identity hydrator: batched snapshot when both slices load, else single-path. */
async function hydrateMeshtasticIdentity(
  identityId: IdentityId,
  opts: HydrateIdentityStoresOptions,
  isCurrent: () => boolean,
): Promise<void> {
  const loadNodes = opts.nodes !== false;
  const loadMessages = opts.messages !== false;
  const messagesMode = opts.messagesMode ?? 'upsert';
  const nodesMode = opts.nodesMode ?? 'upsert';
  if (loadNodes && loadMessages) {
    const snap = await window.electronAPI.db.getMeshtasticIdentityHydration(
      getMeshtasticMessageLoadLimit(),
    );
    if (!isCurrent()) return;
    applyMeshtasticNodesFromRows(
      identityId,
      snap.nodes,
      snap.meshcoreContacts as { node_id: number; hops_away: number | null }[],
      nodesMode,
    );
    if (!isCurrent()) return;
    applyMeshtasticMessagesFromRows(identityId, snap.messages, messagesMode);
  } else if (loadNodes) {
    await hydrateMeshtasticNodesFromDb(identityId, nodesMode, isCurrent);
  } else if (loadMessages) {
    await hydrateMeshtasticMessagesFromDb(identityId, messagesMode, isCurrent);
  }
}

/** MeshCore identity hydrator: one snapshot covers nodes and/or messages. */
async function hydrateMeshcoreIdentity(
  identityId: IdentityId,
  opts: HydrateIdentityStoresOptions,
  isCurrent: () => boolean,
): Promise<void> {
  const loadNodes = opts.nodes !== false;
  const loadMessages = opts.messages !== false;
  const messagesMode = opts.messagesMode ?? 'upsert';
  const nodesMode = opts.nodesMode ?? 'upsert';
  if (loadNodes || loadMessages) {
    const snap = await loadMeshcoreIdentityHydrationSnapshot();
    if (!isCurrent()) return;
    if (loadNodes) {
      const mapped = mapMeshcoreDbRowsToChatMessages(snap.messages);
      const nodeMap = buildMeshcoreNodeMapFromDb(snap.contacts, snap.savedNodes, mapped);
      if (!isCurrent()) return;
      if (nodesMode === 'replace') {
        replaceNodesMapInIdentityStore(identityId, nodeMap);
      } else {
        syncNodesMapToIdentityStore(identityId, nodeMap);
      }
    }
    if (loadMessages) {
      if (!isCurrent()) return;
      applyMeshcoreMessagesFromSnapshot(identityId, snap.messages, snap.contacts, messagesMode);
    }
  }
}

/** Map Reticulum destination rows into node records (skips invalid hashes). */
async function applyReticulumDestinationRows(
  identityId: IdentityId,
  rows: {
    destination_hash: string;
    display_name?: string | null;
    last_heard?: number | null;
    favorited?: number | null;
  }[],
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) return;
  const { reticulumHashToNodeId, registerReticulumDestinationHash } =
    await import('./reticulum/destHash');
  const records: NodeRecord[] = [];
  for (const row of rows) {
    // A row without a canonical hash cannot be keyed or displayed; skipping it
    // keeps one bad SQLite row from failing the whole hydration pass.
    const destinationHash = canonicalizeReticulumDestinationHash(row.destination_hash);
    if (!destinationHash) {
      console.warn('[hydrateReticulumIdentity] skipped destination row with invalid hash');
      continue;
    }
    const nodeId = reticulumHashToNodeId(destinationHash);
    registerReticulumDestinationHash(nodeId, destinationHash);
    records.push({
      nodeId,
      longName: row.display_name ?? destinationHash.slice(0, 16),
      shortName: row.display_name?.slice(0, 4) ?? 'RT',
      lastHeardAt: row.last_heard ?? undefined,
      reticulumDestinationHash: destinationHash,
    });
  }
  if (!isCurrent()) return;
  upsertNodeRecordsForIdentity(identityId, records);
}

/** Reticulum identity hydrator: destinations + messages (parallel existing IPCs). */
function hydrateReticulumIdentity(
  identityId: IdentityId,
  opts: HydrateIdentityStoresOptions,
  isCurrent: () => boolean,
): Promise<void> {
  const loadNodes = opts.nodes !== false;
  const loadMessages = opts.messages !== false;
  return (async () => {
    const tasks: Promise<void>[] = [];
    if (loadNodes) {
      tasks.push(
        (async () => {
          try {
            const rows = (await window.electronAPI.db.getReticulumDestinations()) as {
              destination_hash: string;
              display_name?: string | null;
              last_heard?: number | null;
              favorited?: number | null;
            }[];
            await applyReticulumDestinationRows(identityId, rows, isCurrent);
          } catch (e) {
            console.warn('[hydrateReticulumIdentity] destinations ' + errLikeToLogString(e));
          }
        })(),
      );
    }
    if (loadMessages) {
      tasks.push(
        (async () => {
          try {
            const rows = (await window.electronAPI.db.getReticulumMessages(identityId, 500)) as {
              sender_id: string;
              sender_name?: string;
              payload: string;
              timestamp: number;
              to_hash?: string;
            }[];
            if (!isCurrent()) return;
            replaceMessageRecordsForIdentity(
              identityId,
              rows.map((row) => reticulumDbRowToMessageRecord(row)),
            );
          } catch (e) {
            console.warn('[hydrateReticulumIdentity] messages ' + errLikeToLogString(e));
          }
        })(),
      );
    }
    await Promise.all(tasks);
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
  opts: HydrateIdentityStoresOptions = {},
): Promise<void> {
  const loadNodes = opts.nodes !== false;
  const loadMessages = opts.messages !== false;
  if (!loadNodes && !loadMessages) return;

  const hydrator = IDENTITY_STORE_HYDRATORS[protocol];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (!hydrator) return;

  const isCurrent = beginIdentityHydration(protocol, identityId);
  try {
    await hydrator(identityId, opts, isCurrent);
    if (!isCurrent()) return;
  } catch (e) {
    if (!isCurrent()) return;
    console.warn(`[hydrateIdentityStoresFromDb] ${protocol} failed ` + errLikeToLogString(e));
  }
}

/** @internal Exported for tests that assert row mapping without IPC. */
export { buildMeshtasticNodeMapFromDbRows };
