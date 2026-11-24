/**
 * MeshCom SQLite → Zustand hydration (lazy-imported from the shared hydrate entry).
 */

import { getConnection } from '../stores/connectionStore';
import {
  replaceMessageRecordsForIdentity,
  upsertMessageRecordsForIdentity,
} from '../stores/messageStore';
import { replaceNodeRecordsForIdentity, upsertNodeRecordsForIdentity } from '../stores/nodeStore';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from './chatInMemoryBuffer';
import { errLikeToLogString } from './errLikeToLogString';
import { callsignToNodeId } from './meshcom/meshcomCallsign';
import { meshcomHwLabel } from './meshcom/meshcomHwIds';
import { meshcomPersistIdentityId } from './meshcom/meshcomPersistIdentity';
import {
  meshcomSelfCallsignForIdentity,
  repairMeshcomZeroFromRows,
} from './meshcom/meshcomSelfCallsign';
import { chatMessageToMessageRecord, meshNodeToNodeRecord } from './storeRecordAdapters';
import type { IdentityId, MeshNode } from './types';

export interface HydrateMeshcomIdentityOptions {
  nodes?: boolean;
  messages?: boolean;
  messagesMode?: 'upsert' | 'replace';
  nodesMode?: 'upsert' | 'replace';
}

interface MeshcomDbMessageRow {
  id?: number;
  msg_id?: string | null;
  from_call?: string | null;
  to_call_or_group?: string | null;
  text?: string | null;
  channel_idx?: number | null;
  timestamp?: number | null;
  status?: string | null;
  rssi?: number | null;
  snr?: number | null;
  received_at?: number | null;
  received_via?: string | null;
}

function rowsToMessageRecords(rows: MeshcomDbMessageRow[]) {
  return rows.map((row) => {
    const fromCall = typeof row.from_call === 'string' ? row.from_call : '';
    const senderId = fromCall ? callsignToNodeId(fromCall) : 0;
    const toCall = typeof row.to_call_or_group === 'string' ? row.to_call_or_group : '';
    const channel = typeof row.channel_idx === 'number' ? row.channel_idx : 0;
    const ts = typeof row.timestamp === 'number' ? row.timestamp : Date.now();
    const storeId =
      (typeof row.msg_id === 'string' && row.msg_id) ||
      (typeof row.id === 'number' ? `meshcom-db:${row.id}` : `meshcom:${senderId}:${ts}`);
    return chatMessageToMessageRecord({
      storeId,
      id: typeof row.id === 'number' ? row.id : undefined,
      sender_id: senderId,
      sender_name: fromCall || 'Unknown',
      payload: typeof row.text === 'string' ? row.text : '',
      channel,
      timestamp: ts,
      receivedAt: typeof row.received_at === 'number' ? row.received_at : undefined,
      to: toCall && toCall !== '*' ? callsignToNodeId(toCall) : undefined,
      status:
        row.status === 'sending' ||
        row.status === 'failed' ||
        row.status === 'queued' ||
        row.status === 'blocked'
          ? row.status
          : 'acked',
      receivedVia:
        row.received_via === 'mqtt' || row.received_via === 'both' || row.received_via === 'rf'
          ? row.received_via
          : 'rf',
      rxRssi: typeof row.rssi === 'number' ? row.rssi : undefined,
      rxSnr: typeof row.snr === 'number' ? row.snr : undefined,
    });
  });
}

export async function hydrateMeshcomIdentity(
  identityId: IdentityId,
  opts: HydrateMeshcomIdentityOptions,
  isCurrent: () => boolean,
): Promise<void> {
  const loadNodes = opts.nodes !== false;
  const loadMessages = opts.messages !== false;
  const messagesMode = opts.messagesMode ?? 'upsert';
  const nodesMode = opts.nodesMode ?? 'upsert';

  // SQLite is always keyed by the stable offline slot; apply rows into the session bucket.
  const persistId = meshcomPersistIdentityId();
  let rebindFailed = false;
  try {
    if (identityId !== persistId) {
      await window.electronAPI.db.rebindMeshcomIdentity(identityId, persistId);
    }
    await window.electronAPI.db.rebindMeshcomIdentity('*', persistId);
  } catch (e: unknown) {
    // Failed rebind may leave orphaned id-* (or empty-identity) rows unread. Do not
    // replace in-memory stores with a possibly incomplete offline-only snapshot —
    // force upsert and also load the session identity bucket when it differs.
    rebindFailed = true;
    console.warn('mcL1505 [hydrateMeshcom] rebindMeshcomIdentity ' + errLikeToLogString(e));
  }
  if (!isCurrent()) return;

  // Never wipe the live bucket after a failed rebind (incomplete offline read).
  const applyNodesMode = rebindFailed && nodesMode === 'replace' ? 'upsert' : nodesMode;
  const applyMessagesMode = rebindFailed && messagesMode === 'replace' ? 'upsert' : messagesMode;

  if (loadNodes) {
    const contacts = (await window.electronAPI.db.getMeshcomContacts(persistId)) as {
      callsign?: string | null;
      node_id?: number | null;
      lat?: number | null;
      lon?: number | null;
      batt?: number | null;
      hw_id?: number | null;
      last_heard?: number | null;
      favorited?: number | null;
    }[];
    if (!isCurrent()) return;
    const nodes: MeshNode[] = [];
    for (const c of contacts) {
      const callsign = typeof c.callsign === 'string' ? c.callsign.trim() : '';
      if (!callsign) continue;
      const nodeId =
        typeof c.node_id === 'number' && Number.isFinite(c.node_id) && c.node_id > 0
          ? c.node_id >>> 0
          : callsignToNodeId(callsign);
      nodes.push({
        node_id: nodeId,
        long_name: callsign,
        short_name: callsign.slice(0, 4),
        hw_model: meshcomHwLabel(c.hw_id) || '',
        snr: 0,
        rssi: 0,
        battery: typeof c.batt === 'number' ? c.batt : 0,
        last_heard: typeof c.last_heard === 'number' ? c.last_heard : 0,
        latitude: typeof c.lat === 'number' ? c.lat : null,
        longitude: typeof c.lon === 'number' ? c.lon : null,
        favorited: c.favorited === 1,
        source: 'rf',
      });
    }
    if (rebindFailed && identityId !== persistId) {
      const legacyContacts = (await window.electronAPI.db.getMeshcomContacts(identityId)) as {
        callsign?: string | null;
        node_id?: number | null;
        lat?: number | null;
        lon?: number | null;
        batt?: number | null;
        hw_id?: number | null;
        last_heard?: number | null;
        favorited?: number | null;
      }[];
      for (const c of legacyContacts) {
        const callsign = typeof c.callsign === 'string' ? c.callsign.trim() : '';
        if (!callsign) continue;
        const nodeId =
          typeof c.node_id === 'number' && Number.isFinite(c.node_id) && c.node_id > 0
            ? c.node_id >>> 0
            : callsignToNodeId(callsign);
        nodes.push({
          node_id: nodeId,
          long_name: callsign,
          short_name: callsign.slice(0, 4),
          hw_model: meshcomHwLabel(c.hw_id) || '',
          snr: 0,
          rssi: 0,
          battery: typeof c.batt === 'number' ? c.batt : 0,
          last_heard: typeof c.last_heard === 'number' ? c.last_heard : 0,
          latitude: typeof c.lat === 'number' ? c.lat : null,
          longitude: typeof c.lon === 'number' ? c.lon : null,
          favorited: c.favorited === 1,
          source: 'rf',
        });
      }
    }
    if (!isCurrent()) return;
    const records = nodes.map((node) => meshNodeToNodeRecord(node));
    if (applyNodesMode === 'replace') {
      replaceNodeRecordsForIdentity(identityId, records);
    } else {
      upsertNodeRecordsForIdentity(identityId, records);
    }
  }

  if (loadMessages) {
    const rows = (await window.electronAPI.db.getMeshcomMessages(
      persistId,
      undefined,
      500,
    )) as MeshcomDbMessageRow[];
    let combined = rowsToMessageRecords(rows);
    if (rebindFailed && identityId !== persistId) {
      const legacyRows = (await window.electronAPI.db.getMeshcomMessages(
        identityId,
        undefined,
        500,
      )) as MeshcomDbMessageRow[];
      combined = [...combined, ...rowsToMessageRecords(legacyRows)];
    }
    if (!isCurrent()) return;
    const finalRecords = trimChatMessagesToMax(combined, MAX_IN_MEMORY_CHAT_MESSAGES);
    if (applyMessagesMode === 'replace') {
      replaceMessageRecordsForIdentity(identityId, finalRecords);
    } else {
      upsertMessageRecordsForIdentity(identityId, finalRecords);
    }

    // Settings may have learned self before hydrate finished — repair from:0 / Unknown now.
    const my = getConnection(identityId)?.myNodeNum ?? 0;
    const selfCall = meshcomSelfCallsignForIdentity(identityId);
    if (my > 0 && selfCall) {
      repairMeshcomZeroFromRows(identityId, selfCall, my);
    }
  }
}
