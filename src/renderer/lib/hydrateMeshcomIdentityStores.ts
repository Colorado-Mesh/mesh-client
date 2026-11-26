/**
 * MeshCom SQLite → Zustand hydration (lazy-imported from the shared hydrate entry).
 */

import { getConnection } from '../stores/connectionStore';
import {
  type MessageRecord,
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
import type { ChatMessage, IdentityId, MeshNode } from './types';

export interface HydrateMeshcomIdentityOptions {
  nodes?: boolean;
  messages?: boolean;
  messagesMode?: 'upsert' | 'replace';
  nodesMode?: 'upsert' | 'replace';
}

/** @internal Exported for hydrate merge tests. */
export interface MeshcomDbMessageRow {
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

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function meshcomRowStatus(value: unknown): ChatMessage['status'] {
  if (value === 'sending' || value === 'failed' || value === 'queued' || value === 'blocked') {
    return value;
  }
  return 'acked';
}

function meshcomRowReceivedVia(value: unknown): ChatMessage['receivedVia'] {
  if (value === 'mqtt' || value === 'both' || value === 'rf') return value;
  return 'rf';
}

function meshcomRowStoreId(row: MeshcomDbMessageRow, senderId: number, ts: number): string {
  const msgId = optionalString(row.msg_id);
  if (msgId) return msgId;
  const id = optionalNumber(row.id);
  return id != null ? `meshcom-db:${id}` : `meshcom:${senderId}:${ts}`;
}

/** @internal Exported for hydrate merge tests. */
export function rowsToMessageRecords(rows: MeshcomDbMessageRow[]): MessageRecord[] {
  return rows.map((row) => {
    const fromCall = optionalString(row.from_call) ?? '';
    const senderId = fromCall ? callsignToNodeId(fromCall) : 0;
    const toCall = optionalString(row.to_call_or_group) ?? '';
    const channel = optionalNumber(row.channel_idx) ?? 0;
    const ts = optionalNumber(row.timestamp) ?? Date.now();
    return chatMessageToMessageRecord({
      storeId: meshcomRowStoreId(row, senderId, ts),
      id: optionalNumber(row.id),
      sender_id: senderId,
      sender_name: fromCall || 'Unknown',
      payload: optionalString(row.text) ?? '',
      channel,
      timestamp: ts,
      receivedAt: optionalNumber(row.received_at),
      to: toCall && toCall !== '*' ? callsignToNodeId(toCall) : undefined,
      status: meshcomRowStatus(row.status),
      receivedVia: meshcomRowReceivedVia(row.received_via),
      rxRssi: optionalNumber(row.rssi),
      rxSnr: optionalNumber(row.snr),
    });
  });
}

function isSameLogicalMeshcomRecord(a: MessageRecord, b: MessageRecord): boolean {
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.payload === b.payload &&
    a.channelIndex === b.channelIndex &&
    a.timestamp === b.timestamp
  );
}

/**
 * Merge offline + session rows after a failed rebind. Same store id with the same logical
 * payload collapses; same msg_id with different content remints via meshcom-db:{row.id}.
 */
export function mergeMeshcomHydrateMessageRecords(
  primary: MessageRecord[],
  secondary: MessageRecord[],
  secondaryRows: MeshcomDbMessageRow[],
): MessageRecord[] {
  const byId = new Map<string, MessageRecord>();
  for (const row of primary) byId.set(row.id, row);
  for (let i = 0; i < secondary.length; i++) {
    const rec = secondary[i];
    const existing = byId.get(rec.id);
    if (!existing) {
      byId.set(rec.id, rec);
      continue;
    }
    if (isSameLogicalMeshcomRecord(existing, rec)) continue;
    const dbId = secondaryRows[i]?.id;
    const safeId =
      typeof dbId === 'number' && Number.isFinite(dbId)
        ? `meshcom-db:${dbId}`
        : `${rec.id}-rb-${i}`;
    byId.set(safeId, { ...rec, id: safeId });
  }
  return [...byId.values()];
}

interface MeshcomContactRow {
  callsign?: string | null;
  node_id?: number | null;
  lat?: number | null;
  lon?: number | null;
  batt?: number | null;
  hw_id?: number | null;
  last_heard?: number | null;
  favorited?: number | null;
}

function meshcomContactNode(c: MeshcomContactRow): MeshNode | null {
  const callsign = typeof c.callsign === 'string' ? c.callsign.trim() : '';
  if (!callsign) return null;
  const nodeId =
    typeof c.node_id === 'number' && Number.isFinite(c.node_id) && c.node_id > 0
      ? c.node_id >>> 0
      : callsignToNodeId(callsign);
  return {
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
  };
}

async function loadMeshcomNodes(
  persistId: IdentityId,
  identityId: IdentityId,
  rebindFailed: boolean,
): Promise<MeshNode[]> {
  const contacts = (await window.electronAPI.db.getMeshcomContacts(
    persistId,
  )) as MeshcomContactRow[];
  const nodes = contacts.map(meshcomContactNode).filter((node): node is MeshNode => node != null);
  if (!rebindFailed || identityId === persistId) return nodes;
  const legacyContacts = (await window.electronAPI.db.getMeshcomContacts(
    identityId,
  )) as MeshcomContactRow[];
  nodes.push(
    ...legacyContacts.map(meshcomContactNode).filter((node): node is MeshNode => node != null),
  );
  return nodes;
}

async function loadMeshcomMessageRecords(
  persistId: IdentityId,
  identityId: IdentityId,
  rebindFailed: boolean,
): Promise<MessageRecord[]> {
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
    combined = mergeMeshcomHydrateMessageRecords(
      combined,
      rowsToMessageRecords(legacyRows),
      legacyRows,
    );
  }
  return combined;
}

async function rebindMeshcomIdentity(
  identityId: IdentityId,
  persistId: IdentityId,
): Promise<boolean> {
  try {
    if (identityId !== persistId) {
      await window.electronAPI.db.rebindMeshcomIdentity(identityId, persistId);
    }
    await window.electronAPI.db.rebindMeshcomIdentity('*', persistId);
    return false;
  } catch (e: unknown) {
    // Failed rebind may leave orphaned id-* (or empty-identity) rows unread. Do not
    // replace in-memory stores with a possibly incomplete offline-only snapshot —
    // force upsert and also load the session identity bucket when it differs.
    console.warn('mcL1505 [hydrateMeshcom] rebindMeshcomIdentity ' + errLikeToLogString(e));
    return true;
  }
}

function resolveHydrateModes(
  rebindFailed: boolean,
  nodesMode: 'upsert' | 'replace',
  messagesMode: 'upsert' | 'replace',
): { applyNodesMode: 'upsert' | 'replace'; applyMessagesMode: 'upsert' | 'replace' } {
  // Never wipe the live bucket after a failed rebind (incomplete offline read).
  return {
    applyNodesMode: rebindFailed && nodesMode === 'replace' ? 'upsert' : nodesMode,
    applyMessagesMode: rebindFailed && messagesMode === 'replace' ? 'upsert' : messagesMode,
  };
}

function applyHydratedMeshcomNodes(
  identityId: IdentityId,
  nodes: MeshNode[],
  mode: 'upsert' | 'replace',
): void {
  const records = nodes.map((node) => meshNodeToNodeRecord(node));
  if (mode === 'replace') replaceNodeRecordsForIdentity(identityId, records);
  else upsertNodeRecordsForIdentity(identityId, records);
}

function applyHydratedMeshcomMessages(
  identityId: IdentityId,
  combined: MessageRecord[],
  mode: 'upsert' | 'replace',
): void {
  const finalRecords = trimChatMessagesToMax(combined, MAX_IN_MEMORY_CHAT_MESSAGES);
  if (mode === 'replace') replaceMessageRecordsForIdentity(identityId, finalRecords);
  else upsertMessageRecordsForIdentity(identityId, finalRecords);

  // Settings may have learned self before hydrate finished — repair from:0 / Unknown now.
  const my = getConnection(identityId)?.myNodeNum ?? 0;
  const selfCall = meshcomSelfCallsignForIdentity(identityId);
  if (my > 0 && selfCall) repairMeshcomZeroFromRows(identityId, selfCall, my);
}

export async function hydrateMeshcomIdentity(
  identityId: IdentityId,
  opts: HydrateMeshcomIdentityOptions,
  isCurrent: () => boolean,
): Promise<void> {
  const loadNodes = opts.nodes !== false;
  const loadMessages = opts.messages !== false;
  const persistId = meshcomPersistIdentityId();
  const rebindFailed = await rebindMeshcomIdentity(identityId, persistId);
  if (!isCurrent()) return;
  const { applyNodesMode, applyMessagesMode } = resolveHydrateModes(
    rebindFailed,
    opts.nodesMode ?? 'upsert',
    opts.messagesMode ?? 'upsert',
  );

  if (loadNodes) {
    const nodes = await loadMeshcomNodes(persistId, identityId, rebindFailed);
    if (!isCurrent()) return;
    applyHydratedMeshcomNodes(identityId, nodes, applyNodesMode);
  }
  if (loadMessages) {
    const combined = await loadMeshcomMessageRecords(persistId, identityId, rebindFailed);
    if (!isCurrent()) return;
    applyHydratedMeshcomMessages(identityId, combined, applyMessagesMode);
  }
}
