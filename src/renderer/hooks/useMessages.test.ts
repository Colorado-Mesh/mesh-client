import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SavedMessage } from '@/shared/electron-api.types';

import { packetRouter } from '../lib/drivers/PacketRouter';
import {
  hydrateMeshcoreMessagesFromDb,
  hydrateMeshtasticMessagesFromDb,
  meshcoreHydratedMessageRecords,
} from '../lib/hydrateIdentityStoresFromDb';
import { attachMeshcoreIngest } from '../lib/ingest/meshcoreIngest';
import { attachMeshtasticIngest } from '../lib/ingest/meshtasticIngest';
import {
  ingestReticulumLxmfPayload,
  ingestReticulumLxmfPayloadWithSideEffects,
} from '../lib/ingest/reticulumIngest';
import { meshcoreChatMessagesForDisplay } from '../lib/meshcoreChannelText';
import { decodeMeshcoreDirectMessageEvents } from '../lib/meshcoreDirectMessageDecode';
import { pubKeyPrefixHex } from '../lib/meshcoreUtils';
import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import { reticulumProtocol } from '../lib/protocols/ReticulumProtocol';
import {
  messageRecordsToChatMessages,
  reticulumDbRowToMessageRecord,
} from '../lib/storeRecordAdapters';
import type { ChatMessage, IdentityId } from '../lib/types';
import { addIdentity } from '../stores/identityStore';
import {
  mergeMessageRecordsFromDbForIdentity,
  replaceMessageRecordsForIdentity,
  upsertMessage,
  useMessageStore,
} from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import {
  mapMeshcoreDbRowsToChatMessages,
  type MeshcoreMessageDbRow,
} from './meshcore/meshcoreHookPreamble';
import { useMessages } from './useMessages';

/** First local receipt, in ms; every later receipt in a test adds a minute. */
const RECEIVED = 1_700_000_100_000;
const MINUTE = 60_000;
/** A sender whose clock runs two hours behind this computer. */
const TWO_HOURS = 2 * 60 * MINUTE;

let now = RECEIVED;

function receiveAt(ms: number): void {
  now = ms;
}

function registerIdentity(
  id: IdentityId,
  protocol: typeof meshcoreProtocol | typeof meshtasticProtocol | typeof reticulumProtocol,
) {
  addIdentity({
    id,
    protocol,
    signature: `${protocol.type}:receive-order-${id}`,
    transports: [],
    createdAt: RECEIVED,
    lastSeenAt: RECEIVED,
  });
}

/** What App renders for Meshtastic and Reticulum: the store through useMessages. */
function shownRows(id: IdentityId): ChatMessage[] {
  const { result } = renderHook(() => useMessages(id));
  return messageRecordsToChatMessages(result.current);
}

/** What App renders for MeshCore: the store through useMessages, then the MeshCore display pass. */
function shownMeshcoreRows(id: IdentityId): ChatMessage[] {
  return meshcoreChatMessagesForDisplay(shownRows(id));
}

/** SQLite keeps a row's first insert and later saves only update it, so keep each row's first save. */
function firstSaves<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const rowKey = key(row);
    if (seen.has(rowKey)) return false;
    seen.add(rowKey);
    return true;
  });
}

/** A companion channel event shaped as MeshCoreProtocol.decodeChannelMessage builds it. */
function meshcoreChannelEvent(text: string, senderTimestampSec: number) {
  return {
    type: 'text_message' as const,
    payload: {
      id: `ch:0:${senderTimestampSec}:${text}`,
      from: 0,
      to: 0,
      payload: text,
      channelIndex: 0,
      timestamp: senderTimestampSec * 1000,
    },
  };
}

beforeEach(() => {
  now = RECEIVED;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  for (const save of ['saveMeshcoreMessage', 'saveMessage', 'saveReticulumMessage'] as const) {
    vi.spyOn(window.electronAPI.db, save).mockClear().mockResolvedValue(undefined);
  }
  useMessageStore.setState({ messages: {} });
  useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
});

afterEach(() => {
  useMessageStore.setState({ messages: {} });
  useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
  vi.restoreAllMocks();
});

describe('MeshCore chat order', () => {
  const ID = 'receive-order-meshcore';

  beforeEach(() => {
    registerIdentity(ID, meshcoreProtocol);
  });

  it('puts a channel message received later below an earlier one, even when its sender clock is behind', () => {
    const detach = attachMeshcoreIngest(ID);
    const firstSentSec = RECEIVED / 1000;
    const laggingSentSec = (RECEIVED - TWO_HOURS) / 1000;
    receiveAt(RECEIVED);
    packetRouter.dispatch(meshcoreChannelEvent('Alice: first in', firstSentSec), ID);
    receiveAt(RECEIVED + MINUTE);
    packetRouter.dispatch(meshcoreChannelEvent('Bob: second in', laggingSentSec), ID);
    detach();

    const rows = shownMeshcoreRows(ID);
    expect(rows.map((m) => m.payload)).toEqual(['first in', 'second in']);
    // The bubble still carries the time the sender's radio stamped.
    expect(rows.map((m) => m.timestamp)).toEqual([RECEIVED, RECEIVED - TWO_HOURS]);
  });

  it('puts a DM received later below an earlier one, even when its sender clock is behind', () => {
    const detach = attachMeshcoreIngest(ID);
    const peerKey = new Uint8Array(32).fill(7);
    const peerPrefix = peerKey.slice(0, 6);
    const nodeIdByPrefix = new Map<string, number>([[pubKeyPrefixHex(peerPrefix), 0x0707]]);
    const dispatchDm = (text: string, senderTimestamp: number) => {
      for (const event of decodeMeshcoreDirectMessageEvents(
        { pubKeyPrefix: peerPrefix, text, senderTimestamp },
        nodeIdByPrefix,
        new Set<number>(),
      )) {
        packetRouter.dispatch(event, ID);
      }
    };
    receiveAt(RECEIVED);
    dispatchDm('first in', RECEIVED / 1000);
    receiveAt(RECEIVED + MINUTE);
    dispatchDm('second in', (RECEIVED - TWO_HOURS) / 1000);
    detach();

    const rows = shownMeshcoreRows(ID);
    expect(rows.map((m) => m.payload)).toEqual(['first in', 'second in']);
    expect(rows.map((m) => m.timestamp)).toEqual([RECEIVED, RECEIVED - TWO_HOURS]);
  });

  it('keeps a re-delivered channel message in its first position', () => {
    const detach = attachMeshcoreIngest(ID);
    const firstSentSec = RECEIVED / 1000;
    receiveAt(RECEIVED);
    packetRouter.dispatch(meshcoreChannelEvent('Alice: first in', firstSentSec), ID);
    receiveAt(RECEIVED + MINUTE);
    packetRouter.dispatch(
      meshcoreChannelEvent('Bob: second in', (RECEIVED - TWO_HOURS) / 1000),
      ID,
    );
    receiveAt(RECEIVED + 2 * MINUTE);
    packetRouter.dispatch(meshcoreChannelEvent('Alice: first in', firstSentSec), ID);
    detach();

    // Position only: the row's sender time identifies it whatever the re-delivery does to its text.
    expect(shownMeshcoreRows(ID).map((m) => m.timestamp)).toEqual([RECEIVED, RECEIVED - TWO_HOURS]);
  });

  it('places an own send between the messages received before and after it', () => {
    const detach = attachMeshcoreIngest(ID);
    receiveAt(RECEIVED);
    packetRouter.dispatch(meshcoreChannelEvent('Alice: first in', RECEIVED / 1000), ID);
    receiveAt(RECEIVED + MINUTE);
    upsertMessage(ID, {
      id: 'own-send',
      from: 0xabc,
      to: 0,
      payload: 'my reply',
      channelIndex: 0,
      timestamp: RECEIVED + MINUTE,
      status: 'sending',
    });
    receiveAt(RECEIVED + 2 * MINUTE);
    packetRouter.dispatch(
      meshcoreChannelEvent('Bob: late clock', (RECEIVED - TWO_HOURS) / 1000),
      ID,
    );
    detach();

    expect(shownMeshcoreRows(ID).map((m) => m.payload)).toEqual([
      'first in',
      'my reply',
      'late clock',
    ]);
  });

  it('saves each receipt and keeps the order when the saved rows are loaded again', () => {
    const detach = attachMeshcoreIngest(ID);
    receiveAt(RECEIVED);
    packetRouter.dispatch(meshcoreChannelEvent('Alice: first in', RECEIVED / 1000), ID);
    receiveAt(RECEIVED + MINUTE);
    packetRouter.dispatch(
      meshcoreChannelEvent('Bob: second in', (RECEIVED - TWO_HOURS) / 1000),
      ID,
    );
    detach();

    const saved = firstSaves(
      vi.mocked(window.electronAPI.db.saveMeshcoreMessage).mock.calls.map(([row]) => row),
      (row) => `${row.sender_id}|${row.timestamp}|${row.channel_idx}|${row.payload}`,
    );
    expect(saved.map((row) => typeof row.received_at)).toEqual(['number', 'number']);
    const rows = saved.map((row, index) => ({ ...row, id: index + 1 })) as MeshcoreMessageDbRow[];
    useMessageStore.setState({ messages: {} });
    replaceMessageRecordsForIdentity(
      ID,
      meshcoreHydratedMessageRecords(mapMeshcoreDbRowsToChatMessages(rows)),
    );

    const reloaded = shownMeshcoreRows(ID);
    expect(reloaded.map((m) => m.payload)).toEqual(['first in', 'second in']);
    expect(reloaded.map((m) => m.timestamp)).toEqual([RECEIVED, RECEIVED - TWO_HOURS]);
  });

  it('keeps history saved before receipt times in its old order, with new messages below it', () => {
    const legacy = [
      { id: 1, sender_name: 'Alice', payload: 'old first', timestamp: RECEIVED - 3 * MINUTE },
      { id: 2, sender_name: 'Bob', payload: 'old second', timestamp: RECEIVED - 2 * MINUTE },
    ].map((row) => ({ ...row, sender_id: null, channel_idx: 0, status: 'acked' }));
    replaceMessageRecordsForIdentity(
      ID,
      meshcoreHydratedMessageRecords(
        mapMeshcoreDbRowsToChatMessages(legacy as unknown as MeshcoreMessageDbRow[]),
      ),
    );
    const detach = attachMeshcoreIngest(ID);
    receiveAt(RECEIVED);
    packetRouter.dispatch(meshcoreChannelEvent('Carol: new in', (RECEIVED - TWO_HOURS) / 1000), ID);
    detach();

    expect(shownMeshcoreRows(ID).map((m) => m.payload)).toEqual([
      'old first',
      'old second',
      'new in',
    ]);
  });

  it('loads saved history without receipts through the launch hydrate without stamping it', async () => {
    receiveAt(RECEIVED);
    const legacy = [
      { id: 1, sender_name: 'Alice', payload: 'old first', timestamp: RECEIVED - 3 * MINUTE },
      { id: 2, sender_name: 'Bob', payload: 'old second', timestamp: RECEIVED - 2 * MINUTE },
    ].map((row) => ({ ...row, sender_id: null, channel_idx: 0, status: 'acked' }));
    vi.spyOn(window.electronAPI.db, 'getMeshcoreIdentityHydration').mockResolvedValue({
      contacts: [],
      nodes: [],
      hopHistory: [],
      messages: legacy,
    });
    await hydrateMeshcoreMessagesFromDb(ID, 'upsert');

    const stored = Object.values(useMessageStore.getState().messages[ID] ?? {});
    expect(stored.map((record) => record.receivedAt)).toEqual([undefined, undefined]);
    expect(shownMeshcoreRows(ID).map((m) => m.payload)).toEqual(['old first', 'old second']);
  });
});

describe('Meshtastic chat order', () => {
  const ID = 'receive-order-meshtastic';

  beforeEach(() => {
    registerIdentity(ID, meshtasticProtocol);
  });

  it('puts a packet received later below an earlier one when its radio time is older', () => {
    const session = attachMeshtasticIngest(ID, {
      getIsConfiguring: () => false,
      getMyNodeNum: () => 0xbbbb,
    });
    const textEvent = (id: string, payload: string, timestamp: number) => ({
      type: 'text_message' as const,
      payload: { id, from: 0xaaaa, to: 0xffffffff, payload, channelIndex: 0, timestamp },
    });
    receiveAt(RECEIVED);
    packetRouter.dispatch(textEvent('101', 'first in', RECEIVED), ID);
    receiveAt(RECEIVED + MINUTE);
    // A Store & Forward replay or MQTT gateway copy carries the time another radio heard it.
    packetRouter.dispatch(textEvent('102', 'second in', RECEIVED - TWO_HOURS), ID);
    session.detach();

    const rows = shownRows(ID);
    expect(rows.map((m) => m.payload)).toEqual(['first in', 'second in']);
    expect(rows.map((m) => m.timestamp)).toEqual([RECEIVED, RECEIVED - TWO_HOURS]);
  });

  it('saves each receipt and keeps the order when the saved rows are loaded again', async () => {
    const session = attachMeshtasticIngest(ID, {
      getIsConfiguring: () => false,
      getMyNodeNum: () => 0xbbbb,
    });
    const textEvent = (id: string, payload: string, timestamp: number) => ({
      type: 'text_message' as const,
      payload: { id, from: 0xaaaa, to: 0xffffffff, payload, channelIndex: 0, timestamp },
    });
    receiveAt(RECEIVED);
    packetRouter.dispatch(textEvent('201', 'first in', RECEIVED), ID);
    receiveAt(RECEIVED + MINUTE);
    packetRouter.dispatch(textEvent('202', 'second in', RECEIVED - TWO_HOURS), ID);
    session.detach();

    const saved = firstSaves(
      vi.mocked(window.electronAPI.db.saveMessage).mock.calls.map(([row]) => row),
      (row) => `${row.sender_id}|${row.packetId}`,
    );
    expect(saved.map((row) => typeof row.receivedAt)).toEqual(['number', 'number']);
    // The main process answers newest first by stored row id.
    const rows: SavedMessage[] = saved
      .map((row, index) => ({
        id: index + 1,
        sender_id: row.sender_id,
        sender_name: row.sender_name,
        payload: row.payload,
        channel: row.channel,
        timestamp: row.timestamp,
        packetId: row.packetId ?? null,
        status: row.status ?? 'acked',
        error: null,
        emoji: null,
        replyId: null,
        to: row.to,
        mqttStatus: null,
        receivedVia: row.receivedVia ?? null,
        receivedAt: row.receivedAt ?? null,
      }))
      .reverse();
    vi.spyOn(window.electronAPI.db, 'getMessages').mockResolvedValue(rows);
    useMessageStore.setState({ messages: {} });
    await hydrateMeshtasticMessagesFromDb(ID, 'replace');

    const reloaded = shownRows(ID);
    expect(reloaded.map((m) => m.payload)).toEqual(['first in', 'second in']);
    expect(reloaded.map((m) => m.timestamp)).toEqual([RECEIVED, RECEIVED - TWO_HOURS]);
  });
});

describe('Reticulum chat order', () => {
  const ID = 'receive-order-reticulum';
  const PEER = 'a1'.repeat(16);
  const SELF = 'b2'.repeat(16);

  beforeEach(() => {
    registerIdentity(ID, reticulumProtocol);
  });

  it('puts an LXMF message received later below an earlier one, even when its sender clock is behind', () => {
    receiveAt(RECEIVED);
    ingestReticulumLxmfPayload(ID, {
      sender_hash: PEER,
      sender_name: 'Peer',
      to_hash: SELF,
      text: 'first in',
      timestamp: RECEIVED,
      message_hash: 'c3'.repeat(16),
      direction: 'inbound',
    });
    receiveAt(RECEIVED + MINUTE);
    ingestReticulumLxmfPayload(ID, {
      sender_hash: PEER,
      sender_name: 'Peer',
      to_hash: SELF,
      text: 'second in',
      timestamp: RECEIVED - TWO_HOURS,
      message_hash: 'd4'.repeat(16),
      direction: 'inbound',
    });

    const rows = shownRows(ID);
    expect(rows.map((m) => m.payload)).toEqual(['first in', 'second in']);
    expect(rows.map((m) => m.timestamp)).toEqual([RECEIVED, RECEIVED - TWO_HOURS]);
  });

  it('saves each receipt and keeps the order when the saved rows are loaded again', async () => {
    vi.spyOn(window.electronAPI.db, 'upsertReticulumDestination').mockResolvedValue(undefined);
    const inbound = (text: string, timestamp: number, hash: string) => ({
      sender_hash: PEER,
      sender_name: 'Peer',
      to_hash: SELF,
      text,
      timestamp,
      message_hash: hash,
      direction: 'inbound',
    });
    receiveAt(RECEIVED);
    ingestReticulumLxmfPayloadWithSideEffects(ID, inbound('first in', RECEIVED, 'e5'.repeat(16)));
    receiveAt(RECEIVED + MINUTE);
    ingestReticulumLxmfPayloadWithSideEffects(
      ID,
      inbound('second in', RECEIVED - TWO_HOURS, 'f6'.repeat(16)),
    );
    await Promise.resolve();

    const saved = firstSaves(
      vi.mocked(window.electronAPI.db.saveReticulumMessage).mock.calls.map(([row]) => row),
      (row) => row.message_hash ?? '',
    );
    expect(saved.map((row) => typeof row.received_at)).toEqual(['number', 'number']);
    useMessageStore.setState({ messages: {} });
    replaceMessageRecordsForIdentity(
      ID,
      saved.map((row) => reticulumDbRowToMessageRecord(row)),
    );

    const reloaded = shownRows(ID);
    expect(reloaded.map((m) => m.payload)).toEqual(['first in', 'second in']);
    expect(reloaded.map((m) => m.timestamp)).toEqual([RECEIVED, RECEIVED - TWO_HOURS]);
  });

  it('merges saved history without receipts on connect without stamping it', () => {
    receiveAt(RECEIVED);
    const row = (text: string, timestamp: number, hash: string) => ({
      sender_id: PEER,
      sender_name: 'Peer',
      payload: text,
      timestamp,
      to_hash: SELF,
      message_hash: hash,
      delivery_status: 'delivered',
    });
    mergeMessageRecordsFromDbForIdentity(ID, [
      reticulumDbRowToMessageRecord(row('old second', RECEIVED - 2 * MINUTE, 'a7'.repeat(16))),
      reticulumDbRowToMessageRecord(row('old first', RECEIVED - 3 * MINUTE, 'b8'.repeat(16))),
    ]);

    const stored = Object.values(useMessageStore.getState().messages[ID] ?? {});
    expect(stored.map((record) => record.receivedAt)).toEqual([undefined, undefined]);
    expect(shownRows(ID).map((m) => m.payload)).toEqual(['old first', 'old second']);
  });
});
