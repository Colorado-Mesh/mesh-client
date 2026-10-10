import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHCORE_UNKNOWN_SENDER_STUB_ID } from '../../lib/meshcoreUtils';
import { MESHCORE_ROOM_POST_DEDUP_WINDOW_MS } from '../../lib/timeConstants';
import type { ChatMessage } from '../../lib/types';
import {
  mapMeshcoreDbRowsToChatMessages,
  mergeMeshcoreDbHydrationWithLive,
  type MeshcoreMessageDbRow,
  meshcoreReconcileChannelSenderIds,
  meshcoreReconcileRoomSenderIds,
  persistMeshcoreMessageSenderRepairs,
} from './meshcoreHookPreamble';

function row(
  partial: Partial<MeshcoreMessageDbRow> & Pick<MeshcoreMessageDbRow, 'id'>,
): MeshcoreMessageDbRow {
  return {
    sender_id: null,
    sender_name: 'Unknown',
    payload: 'T',
    channel_idx: 6,
    timestamp: 1,
    status: 'acked',
    packet_id: null,
    emoji: null,
    reply_id: null,
    to_node: null,
    received_via: 'rf',
    rx_packet_fingerprint: null,
    reply_preview_text: null,
    reply_preview_sender: null,
    rx_hops: null,
    ...partial,
  };
}

describe('meshcoreReconcileChannelSenderIds', () => {
  it('relinks Unknown-stub rows to named sender on same channel+payload', () => {
    const namedId = 0xa9ba4a2a;
    const messages: ChatMessage[] = [
      {
        id: 1,
        sender_id: MESHCORE_UNKNOWN_SENDER_STUB_ID,
        sender_name: 'Unknown',
        payload: 'T',
        channel: 6,
        timestamp: 1000,
        status: 'acked',
      },
      {
        id: 2,
        sender_id: namedId,
        sender_name: '10th mountain division',
        payload: 'T',
        channel: 6,
        timestamp: 2000,
        status: 'acked',
      },
    ];
    const out = meshcoreReconcileChannelSenderIds(messages);
    expect(out[0]?.sender_id).toBe(namedId);
    expect(out[0]?.sender_name).toBe('10th mountain division');
  });
});

describe('meshcoreReconcileRoomSenderIds', () => {
  it('relinks Unknown room rows to a named twin within the room post dedup window', () => {
    const roomId = 0x6c08b3d9;
    const namedId = 1429514792;
    const ts = 1_786_817_958_000;
    const out = meshcoreReconcileRoomSenderIds([
      {
        id: 1,
        sender_id: 0,
        sender_name: 'Unknown',
        payload: 'Test 12:19',
        channel: -2,
        timestamp: ts,
        status: 'acked',
        roomServerId: roomId,
        to: roomId,
      },
      {
        id: 2,
        sender_id: namedId,
        sender_name: '🛜 NV0N 01',
        payload: 'Test 12:19',
        channel: -2,
        timestamp: ts + 5_000,
        status: 'acked',
        roomServerId: roomId,
        to: roomId,
      },
    ]);
    expect(out[0]?.sender_id).toBe(namedId);
    expect(out[0]?.sender_name).toBe('🛜 NV0N 01');
  });

  it('does not reconcile room Unknown outside the room post dedup window', () => {
    const roomId = 0x6c08b3d9;
    const ts = 1_786_817_958_000;
    const out = meshcoreReconcileRoomSenderIds([
      {
        id: 1,
        sender_id: 0,
        sender_name: 'Unknown',
        payload: 'Greetings from Loveland!',
        channel: -2,
        timestamp: ts,
        status: 'acked',
        roomServerId: roomId,
        to: roomId,
      },
      {
        id: 2,
        sender_id: 1429514792,
        sender_name: '🛜 NV0N 01',
        payload: 'Greetings from Loveland!',
        channel: -2,
        timestamp: ts + MESHCORE_ROOM_POST_DEDUP_WINDOW_MS + 1,
        status: 'acked',
        roomServerId: roomId,
        to: roomId,
      },
    ]);
    expect(out[0]?.sender_id).toBe(0);
    expect(out[0]?.sender_name).toBe('Unknown');
  });

  it('does not reconcile Unknown when two different resolved senders share room/body/timestamp', () => {
    const roomId = 0x6c08b3d9;
    const ts = 1_786_900_000_000;
    const out = meshcoreReconcileRoomSenderIds([
      {
        id: 1,
        sender_id: 0,
        sender_name: 'Unknown',
        payload: 'hello room',
        channel: -2,
        timestamp: ts,
        status: 'acked',
        roomServerId: roomId,
        to: roomId,
      },
      {
        id: 2,
        sender_id: 0x11111111,
        sender_name: 'Alice',
        payload: 'hello room',
        channel: -2,
        timestamp: ts,
        status: 'acked',
        roomServerId: roomId,
        to: roomId,
      },
      {
        id: 3,
        sender_id: 0x22222222,
        sender_name: 'Bob',
        payload: 'hello room',
        channel: -2,
        timestamp: ts,
        status: 'acked',
        roomServerId: roomId,
        to: roomId,
      },
    ]);
    expect(out[0]?.sender_id).toBe(0);
    expect(out[0]?.sender_name).toBe('Unknown');
    expect(out[1]?.sender_name).toBe('Alice');
    expect(out[2]?.sender_name).toBe('Bob');
  });
});

describe('mapMeshcoreDbRowsToChatMessages', () => {
  it('does not reconcile shared long phrases like "good morning!" across different speakers', () => {
    const mapped = mapMeshcoreDbRowsToChatMessages([
      row({ id: 100, sender_id: MESHCORE_UNKNOWN_SENDER_STUB_ID, payload: 'good morning!' }),
      row({
        id: 101,
        sender_id: 2911272666,
        sender_name: 'W5KV Mobile',
        payload: 'good morning!',
      }),
    ]);
    expect(mapped[0]?.sender_id).toBe(MESHCORE_UNKNOWN_SENDER_STUB_ID);
    expect(mapped[0]?.sender_name).toBe('Unknown');
  });

  it('reconciles persisted Unknown-stub T messages with named row on ch6', () => {
    const mapped = mapMeshcoreDbRowsToChatMessages([
      row({ id: 1210, sender_id: MESHCORE_UNKNOWN_SENDER_STUB_ID, timestamp: 1000 }),
      row({
        id: 1243,
        sender_id: 0xa9ba4a2a,
        sender_name: '10th mountain division',
        payload: '10th mountain division: T',
        timestamp: 2000,
      }),
    ]);
    const ambiguous = mapped.find((m) => m.id === 1210);
    expect(ambiguous?.sender_id).toBe(0xa9ba4a2a);
    expect(ambiguous?.sender_name).toBe('10th mountain division');
    expect(ambiguous?.payload).toBe('T');
  });

  it('keeps firmware bot test replies instead of dropping them as transport status', () => {
    const mapped = mapMeshcoreDbRowsToChatMessages([
      row({
        id: 300,
        sender_id: 0xa1234567,
        sender_name: 'CO Bot',
        payload: 'CO Bot: [111b] @[alice] | 2 hops, 2-byte hashes, SNR -1.25 | recv 21:25:45',
      }),
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.payload).toBe(
      '[111b] @[alice] | 2 hops, 2-byte hashes, SNR -1.25 | recv 21:25:45',
    );
  });
});

describe('persistMeshcoreMessageSenderRepairs', () => {
  const updateMeshcoreMessageSender = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.spyOn(window.electronAPI.db, 'updateMeshcoreMessageSender').mockImplementation(
      updateMeshcoreMessageSender,
    );
    updateMeshcoreMessageSender.mockClear();
  });

  it('persists sender repairs for reconciled rows and skips Unknown stub ids', async () => {
    const namedId = 0xa9ba4a2a;
    const rows: MeshcoreMessageDbRow[] = [
      row({ id: 1, sender_id: MESHCORE_UNKNOWN_SENDER_STUB_ID, payload: 'T' }),
      row({
        id: 2,
        sender_id: namedId,
        sender_name: '10th mountain division',
        payload: 'T',
      }),
    ];
    const mapped = mapMeshcoreDbRowsToChatMessages(rows);
    await persistMeshcoreMessageSenderRepairs(rows, mapped);
    expect(updateMeshcoreMessageSender).toHaveBeenCalledTimes(1);
    expect(updateMeshcoreMessageSender).toHaveBeenCalledWith(1, namedId, '10th mountain division');
  });

  it('persists room Unknown sender repairs after twin reconcile', async () => {
    const roomId = 0x6c08b3d9;
    const namedId = 1429514792;
    const ts = 1_786_817_958_000;
    const rows: MeshcoreMessageDbRow[] = [
      row({
        id: 10,
        sender_id: null,
        sender_name: 'Unknown',
        payload: 'Test 12:19',
        channel_idx: -2,
        timestamp: ts,
        room_server_id: roomId,
        to_node: roomId,
      }),
      row({
        id: 11,
        sender_id: namedId,
        sender_name: '🛜 NV0N 01',
        payload: 'Test 12:19',
        channel_idx: -2,
        timestamp: ts,
        room_server_id: roomId,
        to_node: roomId,
      }),
    ];
    const mapped = mapMeshcoreDbRowsToChatMessages(rows);
    await persistMeshcoreMessageSenderRepairs(rows, mapped);
    expect(updateMeshcoreMessageSender).toHaveBeenCalledWith(10, namedId, '🛜 NV0N 01');
  });

  it('does not call IPC when mapped senders match DB rows', async () => {
    const rows: MeshcoreMessageDbRow[] = [
      row({ id: 3, sender_id: 42, sender_name: 'Alice', payload: 'hi' }),
    ];
    const mapped = mapMeshcoreDbRowsToChatMessages(rows);
    await persistMeshcoreMessageSenderRepairs(rows, mapped);
    expect(updateMeshcoreMessageSender).not.toHaveBeenCalled();
  });
});

describe('mergeMeshcoreDbHydrationWithLive', () => {
  const prev: ChatMessage[] = [
    {
      id: 1,
      sender_id: 2,
      sender_name: 'Alice',
      payload: 'stale',
      channel: 0,
      timestamp: 1000,
      status: 'acked',
    },
  ];
  const fromDb: ChatMessage[] = [];

  it('replaceFromDb drops in-flight prev messages after SQLite delete', () => {
    expect(mergeMeshcoreDbHydrationWithLive(prev, fromDb, { replaceFromDb: true })).toEqual([]);
  });

  it('default merge keeps in-flight prev messages not yet in DB', () => {
    expect(mergeMeshcoreDbHydrationWithLive(prev, fromDb)).toEqual(prev);
  });
});
