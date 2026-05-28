import { sanitizeUnicodeReactionScalar } from '../../shared/reactionEmoji';
import {
  buildMeshcoreNodeMapFromDb,
  mapMeshcoreDbRowsToChatMessages,
  type MeshcoreSavedNodeHopRow,
} from '../hooks/meshcore/meshcoreHookPreamble';
import { upsertMessage } from '../stores/messageStore';
import { upsertNode, upsertNodeRecordsForIdentity } from '../stores/nodeStore';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from './chatInMemoryBuffer';
import { errLikeToLogString } from './errLikeToLogString';
import { getMeshtasticMessageLoadLimit } from './legacySideEffects/meshtasticDbHydration';
import type { MeshcoreContactDbRow, MeshcoreMessageDbRow } from './meshcore/meshcoreHookTypes';
import { chatMessageToMessageRecord, meshNodeToNodeRecord } from './storeRecordAdapters';
import type { IdentityId, MeshNode, MeshProtocol } from './types';

/** MeshCore SQLite message load cap (matches runtime mount hydration). */
export const MESHCORE_DB_MESSAGE_LOAD_LIMIT = 500;

export interface HydrateIdentityStoresOptions {
  nodes?: boolean;
  messages?: boolean;
}

export async function hydrateMeshtasticNodesFromDb(identityId: IdentityId): Promise<void> {
  const rows = await window.electronAPI.db.getNodes();
  for (const row of rows) {
    upsertNode(identityId, meshNodeToNodeRecord(row));
  }
}

export async function hydrateMeshtasticMessagesFromDb(identityId: IdentityId): Promise<void> {
  const msgs = await window.electronAPI.db.getMessages(undefined, getMeshtasticMessageLoadLimit());
  const sanitized = msgs.map((m) => ({
    ...m,
    emoji: m.emoji != null ? sanitizeUnicodeReactionScalar(m.emoji) : undefined,
  }));
  const reversed = sanitized.reverse();
  const trimmed = trimChatMessagesToMax(reversed, MAX_IN_MEMORY_CHAT_MESSAGES);
  for (const msg of trimmed) {
    upsertMessage(identityId, chatMessageToMessageRecord(msg));
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
  for (const node of nodeMap.values()) {
    upsertNode(identityId, meshNodeToNodeRecord(node));
  }
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

export async function hydrateMeshcoreMessagesFromDb(identityId: IdentityId): Promise<void> {
  const dbMsgs = await window.electronAPI.db.getMeshcoreMessages(
    undefined,
    MESHCORE_DB_MESSAGE_LOAD_LIMIT,
  );
  const mapped = mapMeshcoreDbRowsToChatMessages(dbMsgs as MeshcoreMessageDbRow[]);
  const trimmed = trimChatMessagesToMax(mapped, MAX_IN_MEMORY_CHAT_MESSAGES);
  for (const msg of trimmed) {
    upsertMessage(identityId, chatMessageToMessageRecord(msg));
  }
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
  try {
    if (protocol === 'meshtastic') {
      if (loadNodes) await hydrateMeshtasticNodesFromDb(identityId);
      if (loadMessages) await hydrateMeshtasticMessagesFromDb(identityId);
      return;
    }
    if (loadNodes) await hydrateMeshcoreNodesFromDb(identityId);
    if (loadMessages) await hydrateMeshcoreMessagesFromDb(identityId);
  } catch (e) {
    console.warn(`[hydrateIdentityStoresFromDb] ${protocol} failed ` + errLikeToLogString(e));
  }
}
