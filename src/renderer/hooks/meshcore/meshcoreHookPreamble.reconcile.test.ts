import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHCORE_UNKNOWN_SENDER_STUB_ID } from '../../lib/meshcoreUtils';
import type { ChatMessage } from '../../lib/types';
import {
  mapMeshcoreDbRowsToChatMessages,
  type MeshcoreMessageDbRow,
  meshcoreReconcileChannelSenderIds,
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

  it('does not call IPC when mapped senders match DB rows', async () => {
    const rows: MeshcoreMessageDbRow[] = [
      row({ id: 3, sender_id: 42, sender_name: 'Alice', payload: 'hi' }),
    ];
    const mapped = mapMeshcoreDbRowsToChatMessages(rows);
    await persistMeshcoreMessageSenderRepairs(rows, mapped);
    expect(updateMeshcoreMessageSender).not.toHaveBeenCalled();
  });
});
