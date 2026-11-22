/**
 * Combined SQLite snapshots for cold identity hydration (one IPC round-trip per protocol).
 * Production ships this as sibling `identity-hydration.js` so it stays out of measured index.js.
 */

import type { IpcMain } from 'electron';

import { clampQueryLimit } from '../shared/clampQueryLimit';
import { effectiveMessageTimestampMs } from '../shared/messageTimestampSkew';
import { sanitizeUnicodeReactionScalar } from '../shared/reactionEmoji';
import type { NodeSqliteDB } from './db-compat';
import {
  type MeshcoreHydrationLoadLimits,
  selectMeshcoreMessagesForHydration,
} from './meshcoreHydrationSelect';

export { type MeshcoreHydrationLoadLimits, selectMeshcoreMessagesForHydration };

const MESHTASTIC_MESSAGE_COLUMNS = `id, sender_id, sender_name, payload, channel, timestamp,
         packet_id AS packetId, status, error, emoji, reply_id AS replyId, to_node,
         mqtt_status AS mqttStatus, received_via AS receivedVia,
         reply_preview_text AS replyPreviewText, reply_preview_sender AS replyPreviewSender,
         rx_hops AS rxHops, via_store_forward AS viaStoreForward,
         radio_node_id AS radioNodeId, channel_key AS channelKey, received_at AS receivedAt`;

function mapMeshtasticMessageRow(r: Record<string, unknown>): Record<string, unknown> {
  const { to_node, emoji: emojiRaw, viaStoreForward: viaSfRaw, ...rest } = r;
  const emoji =
    emojiRaw != null ? (sanitizeUnicodeReactionScalar(emojiRaw) ?? undefined) : undefined;
  const viaStoreForward = viaSfRaw === 1 || viaSfRaw === true;
  return {
    ...rest,
    emoji,
    to: to_node ?? undefined,
    ...(viaStoreForward ? { viaStoreForward: true } : {}),
  };
}

/**
 * Newest Meshtastic chat rows, newest first. "Newest" is by receipt (`received_at`), not by a
 * radio's `timestamp`: a packet stamped by another radio's clock (MQTT gateway, Store & Forward)
 * must not fall out of the window it arrived in. Rows saved before receipt times were kept, and
 * rows copied in by a database merge, keep their `timestamp` as the key.
 */
export function readMeshtasticMessages(
  db: NodeSqliteDB,
  channel?: unknown,
  limit?: unknown,
): Record<string, unknown>[] {
  const safeLimit = clampQueryLimit(limit, { default: 1000, max: 10000 });
  const order = 'ORDER BY COALESCE(received_at, timestamp) DESC, id DESC LIMIT ?';
  let rows: Record<string, unknown>[];
  if (channel != null) {
    const ch = Number(channel);
    if (!Number.isFinite(ch) || ch < 0) throw new Error('Invalid non-negative integer');
    rows = db
      .prepareOnce(`SELECT ${MESHTASTIC_MESSAGE_COLUMNS} FROM messages WHERE channel = ? ${order}`)
      .all(ch >>> 0, safeLimit) as Record<string, unknown>[];
  } else {
    rows = db
      .prepareOnce(`SELECT ${MESHTASTIC_MESSAGE_COLUMNS} FROM messages ${order}`)
      .all(safeLimit) as Record<string, unknown>[];
  }
  return rows.map(mapMeshtasticMessageRow);
}

/** One-shot Meshtastic cold hydrate: nodes + MeshCore contact hops + newest messages. */
export function readMeshtasticIdentityHydration(
  db: NodeSqliteDB,
  messageLimit?: number,
): {
  nodes: unknown[];
  meshcoreContacts: unknown[];
  messages: unknown[];
} {
  const nodes = db.prepareOnce('SELECT * FROM nodes ORDER BY last_heard DESC').all();
  const meshcoreContacts = db.prepareOnce('SELECT * FROM meshcore_contacts').all();
  return { nodes, meshcoreContacts, messages: readMeshtasticMessages(db, undefined, messageLimit) };
}

/** One-shot MeshCore cold hydrate: contacts + nodes + hop history + fair message window. */
export function readMeshcoreIdentityHydration(
  db: NodeSqliteDB,
  limits?: {
    globalLimit?: number;
    perChannelLimit?: number;
    roomLimit?: number;
  },
): {
  contacts: unknown[];
  nodes: unknown[];
  hopHistory: unknown[];
  messages: unknown[];
} {
  const contacts = db.prepareOnce('SELECT * FROM meshcore_contacts').all();
  const nodes = db.prepareOnce('SELECT * FROM nodes ORDER BY last_heard DESC').all();
  const hopHistory = db.prepareOnce('SELECT * FROM meshcore_hop_history').all();
  const rows = selectMeshcoreMessagesForHydration(db, {
    globalLimit: clampQueryLimit(limits?.globalLimit, { default: 500, max: 10000 }),
    perChannelLimit: clampQueryLimit(limits?.perChannelLimit, { default: 100, max: 10000 }),
    roomLimit: clampQueryLimit(limits?.roomLimit, { default: 200, max: 10000 }),
  });
  return {
    contacts,
    nodes,
    hopHistory,
    messages: rows.map((row) => ({
      ...row,
      timestamp: effectiveMessageTimestampMs(Number(row.timestamp)),
    })),
  };
}

export interface IdentityHydrationIpcDeps {
  ipcMain: IpcMain;
  assertIpcSender: (event: unknown, channel: string) => void;
  getDbForIpc: (channel: string) => NodeSqliteDB | null;
  finishDbIpcHandler: (channel: string, err: unknown) => void;
  /** `wasDatabaseCreatedThisLaunch` from database.ts (first-run setup, issue #1542). */
  wasDatabaseCreatedThisLaunch: () => boolean;
}

/** Register batched identity-hydration IPC (called from main after sibling load). */
export function registerIdentityHydrationIpcHandlers(deps: IdentityHydrationIpcDeps): void {
  const { ipcMain, assertIpcSender, getDbForIpc, finishDbIpcHandler } = deps;

  // Lives in this sibling (not index.js) to keep the measured main bundle under budget. Lets the
  // renderer offer first-run protocol setup only on a fresh install.
  ipcMain.handle('db:wasCreatedThisLaunch', (event) => {
    assertIpcSender(event, 'db:wasCreatedThisLaunch');
    return deps.wasDatabaseCreatedThisLaunch();
  });

  ipcMain.handle('db:getMessages', (event, channel?: unknown, limit: unknown = 200) => {
    try {
      assertIpcSender(event, 'db:getMessages');
      const db = getDbForIpc('db:getMessages');
      if (!db) return [];
      return readMeshtasticMessages(db, channel, limit);
    } catch (err) {
      finishDbIpcHandler('db:getMessages', err);
    }
  });

  ipcMain.handle('db:getMeshtasticIdentityHydration', (event, messageLimit?: number) => {
    try {
      assertIpcSender(event, 'db:getMeshtasticIdentityHydration');
      const db = getDbForIpc('db:getMeshtasticIdentityHydration');
      if (!db) return { nodes: [], meshcoreContacts: [], messages: [] };
      return readMeshtasticIdentityHydration(db, messageLimit);
    } catch (err) {
      finishDbIpcHandler('db:getMeshtasticIdentityHydration', err);
    }
  });

  ipcMain.handle(
    'db:getMeshcoreIdentityHydration',
    (
      event,
      limits?: {
        globalLimit?: number;
        perChannelLimit?: number;
        roomLimit?: number;
      },
    ) => {
      try {
        assertIpcSender(event, 'db:getMeshcoreIdentityHydration');
        const db = getDbForIpc('db:getMeshcoreIdentityHydration');
        if (!db) return { contacts: [], nodes: [], hopHistory: [], messages: [] };
        return readMeshcoreIdentityHydration(db, limits);
      } catch (err) {
        finishDbIpcHandler('db:getMeshcoreIdentityHydration', err);
      }
    },
  );
}
