import { sanitizeUnicodeReactionScalar } from '../../shared/reactionEmoji';
import {
  buildMeshcoreNodeMapFromDb,
  mapMeshcoreDbRowsToChatMessages,
  type MeshcoreSavedNodeHopRow,
  persistMeshcoreMessageSenderRepairs,
} from '../hooks/meshcore/meshcoreHookPreamble';
import { upsertMessageRecordsForIdentity } from '../stores/messageStore';
import { upsertNodeRecordsForIdentity } from '../stores/nodeStore';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from './chatInMemoryBuffer';
import { errLikeToLogString } from './errLikeToLogString';
import { beginIdentityHydration } from './identityHydrationCoordinator';
import type { MeshcoreContactDbRow, MeshcoreMessageDbRow } from './meshcore/meshcoreHookTypes';
import {
  meshcoreRoomServerIdsFromContacts,
  repairMeshcoreHydratedMessages,
} from './meshcoreDbCacheHydration';
import { ensureMeshtasticChatSenderInNodeStore } from './meshtastic/meshtasticChatSenderNode';
import {
  buildMeshtasticNodeMapFromDbRows,
  dedupeMeshtasticHydrationOrphanSends,
  loadMeshtasticNodeMapFromDb,
} from './meshtasticDbCacheHydration';
import { getMeshtasticMessageLoadLimit } from './meshtasticMessageLoadLimit';
import { chatMessageToMessageRecord, meshNodeToNodeRecord } from './storeRecordAdapters';
import type { IdentityId, MeshNode, MeshProtocol } from './types';

/** MeshCore SQLite message load cap (matches runtime mount hydration). */
export const MESHCORE_DB_MESSAGE_LOAD_LIMIT = 500;

export interface HydrateIdentityStoresOptions {
  nodes?: boolean;
  messages?: boolean;
}

export async function hydrateMeshtasticNodesFromDb(identityId: IdentityId): Promise<void> {
  const nodeMap = await loadMeshtasticNodeMapFromDb();
  syncMeshtasticNodesMapToIdentityStore(identityId, nodeMap);
}

export async function hydrateMeshtasticMessagesFromDb(identityId: IdentityId): Promise<void> {
  const msgs = await window.electronAPI.db.getMessages(undefined, getMeshtasticMessageLoadLimit());
  const sanitized = dedupeMeshtasticHydrationOrphanSends(
    msgs.map((m) => ({
      ...m,
      emoji: m.emoji != null ? sanitizeUnicodeReactionScalar(m.emoji) : undefined,
    })),
  );
  const reversed = sanitized.reverse();
  const trimmed = trimChatMessagesToMax(reversed, MAX_IN_MEMORY_CHAT_MESSAGES);
  upsertMessageRecordsForIdentity(
    identityId,
    trimmed.map((msg) => chatMessageToMessageRecord(msg)),
  );
  for (const msg of trimmed) {
    if (msg.sender_id <= 0) continue;
    ensureMeshtasticChatSenderInNodeStore(identityId, msg.sender_id, {
      lastHeardAt: msg.timestamp,
      source: msg.receivedVia === 'mqtt' ? 'mqtt' : 'rf',
    });
  }
}

export async function hydrateMeshcoreNodesFromDb(identityId: IdentityId): Promise<void> {
  const [rows, savedNodes] = await Promise.all([
    window.electronAPI.db.getMeshcoreContacts(),
    window.electronAPI.db.getNodes(),
  ]);
  const dbMsgs = await window.electronAPI.db.getMeshcoreMessages(
    undefined,
    MESHCORE_DB_MESSAGE_LOAD_LIMIT,
  );
  const mapped = mapMeshcoreDbRowsToChatMessages(dbMsgs as MeshcoreMessageDbRow[]);
  const nodeMap = buildMeshcoreNodeMapFromDb(
    rows as MeshcoreContactDbRow[],
    savedNodes as MeshcoreSavedNodeHopRow[],
    mapped,
  );
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

export async function hydrateMeshcoreMessagesFromDb(identityId: IdentityId): Promise<void> {
  const [dbMsgs, contactRows] = await Promise.all([
    window.electronAPI.db.getMeshcoreMessages(undefined, MESHCORE_DB_MESSAGE_LOAD_LIMIT),
    window.electronAPI.db.getMeshcoreContacts(),
  ]);
  const rows = dbMsgs as MeshcoreMessageDbRow[];
  const roomServerIds = meshcoreRoomServerIdsFromContacts(contactRows as MeshcoreContactDbRow[]);
  const mapped = repairMeshcoreHydratedMessages(
    mapMeshcoreDbRowsToChatMessages(rows),
    roomServerIds,
  );
  void persistMeshcoreMessageSenderRepairs(rows, mapped);
  const trimmed = trimChatMessagesToMax(mapped, MAX_IN_MEMORY_CHAT_MESSAGES);
  upsertMessageRecordsForIdentity(
    identityId,
    trimmed.map((msg) => chatMessageToMessageRecord(msg)),
  );
}

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

  const isCurrent = beginIdentityHydration(protocol, identityId);
  try {
    if (protocol === 'meshtastic') {
      if (loadNodes && loadMessages) {
        await Promise.all([
          hydrateMeshtasticNodesFromDb(identityId),
          hydrateMeshtasticMessagesFromDb(identityId),
        ]);
      } else if (loadNodes) {
        await hydrateMeshtasticNodesFromDb(identityId);
      } else if (loadMessages) {
        await hydrateMeshtasticMessagesFromDb(identityId);
      }
      if (!isCurrent()) return;
      return;
    }
    if (loadNodes && loadMessages) {
      await Promise.all([
        hydrateMeshcoreNodesFromDb(identityId),
        hydrateMeshcoreMessagesFromDb(identityId),
      ]);
    } else if (loadNodes) {
      await hydrateMeshcoreNodesFromDb(identityId);
    } else if (loadMessages) {
      await hydrateMeshcoreMessagesFromDb(identityId);
    }
    if (!isCurrent()) return;
  } catch (e) {
    if (!isCurrent()) return;
    console.warn(`[hydrateIdentityStoresFromDb] ${protocol} failed ` + errLikeToLogString(e));
  }
}

/** @internal Exported for tests that assert row mapping without IPC. */
export { buildMeshtasticNodeMapFromDbRows };
