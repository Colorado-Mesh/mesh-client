/**
 * Regression: MeshCore chat history must hydrate from SQLite on mount (no device
 * connection). Previously getMeshcoreMessages only ran in initConn, so restarts
 * showed an empty thread until a radio connected.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMeshCore } from './useMeshCore';

const SENDER_ID = 0x12345678;

/** Transport metadata line that must not appear as channel chat (regression: DB hydration must filter). */
const ACK_TRANSPORT_PAYLOAD =
  'ack @[Digi Mobile] | ca,18,9c,72,97,69,0a | SNR: 12.0 dB | RSSI: -25 dBm | Received at: 12:56:35';

function sampleMeshcoreDbRow() {
  return {
    id: 42,
    sender_id: SENDER_ID,
    sender_name: 'Alice',
    payload: 'Hello from DB',
    channel_idx: 0,
    timestamp: 1_700_000_000_000,
    status: 'acked',
    packet_id: null as number | null,
    emoji: null as number | null,
    reply_id: null as number | null,
    to_node: null as number | null,
    received_via: 'mqtt' as const,
  };
}

function sampleAckOnlyMeshcoreDbRow() {
  return {
    ...sampleMeshcoreDbRow(),
    id: 99,
    payload: ACK_TRANSPORT_PAYLOAD,
  };
}

function sampleIncomingDmMeshcoreDbRow() {
  return {
    ...sampleMeshcoreDbRow(),
    id: 55,
    channel_idx: -1,
    to_node: 0x11111111,
    payload: 'Incoming DM from DB',
  };
}

describe('useMeshCore mount hydration', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([sampleMeshcoreDbRow()]);
  });

  afterEach(() => {
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
  });

  it('loads persisted meshcore messages from SQLite on mount without connecting a device', async () => {
    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(result.current.messages.length).toBe(1);
    });

    const m = result.current.messages[0];
    expect(m.payload).toBe('Hello from DB');
    expect(m.sender_name).toBe('Alice');
    expect(m.sender_id).toBe(SENDER_ID);
    expect(m.isHistory).toBe(true);
    expect(m.receivedVia).toBe('mqtt');

    expect(result.current.nodes.has(SENDER_ID)).toBe(true);
    expect(result.current.nodes.get(SENDER_ID)?.long_name).toBe('Alice');
  });

  it('leaves messages empty when the DB returns no rows', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(window.electronAPI.db.getMeshcoreMessages).toHaveBeenCalled();
    });

    expect(result.current.messages).toEqual([]);
  });

  it('does not surface persisted ack transport-status lines as chat messages', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([
      sampleAckOnlyMeshcoreDbRow(),
    ]);

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(window.electronAPI.db.getMeshcoreMessages).toHaveBeenCalled();
    });

    expect(result.current.messages).toEqual([]);
  });

  it('filters ack transport lines from DB but keeps normal messages', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([
      sampleAckOnlyMeshcoreDbRow(),
      { ...sampleMeshcoreDbRow(), id: 43 },
    ]);

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(result.current.messages.length).toBe(1);
    });

    expect(result.current.messages[0].payload).toBe('Hello from DB');
    expect(result.current.messages[0].sender_name).toBe('Alice');
  });

  it('hydrates persisted incoming DMs with to_node for DM filtering', async () => {
    const dmRow = sampleIncomingDmMeshcoreDbRow();
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([dmRow]);

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(result.current.messages.length).toBe(1);
    });

    const dm = result.current.messages[0];
    expect(dm.payload).toBe('Incoming DM from DB');
    expect(dm.to).toBe(dmRow.to_node);
    expect(dm.channel).toBe(-1);
  });

  it('hydrates payloads containing colons as-is when sender_name is set (not wire re-parse)', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([
      {
        ...sampleMeshcoreDbRow(),
        id: 60,
        payload: 'Re: see below — 12:30 meet',
      },
    ]);

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(result.current.messages.length).toBe(1);
    });

    expect(result.current.messages[0].payload).toBe('Re: see below — 12:30 meet');
    expect(result.current.messages[0].sender_name).toBe('Alice');
  });

  it('hydrates reaction rows with emoji, reply_id, and numeric coercion from DB', async () => {
    const parentTs = 1_700_000_000_100;
    const likeCode = 0x1f44d;
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([
      {
        ...sampleMeshcoreDbRow(),
        id: 61,
        payload: 'parent text',
        timestamp: parentTs,
        packet_id: 77 as number | null,
      },
      {
        ...sampleMeshcoreDbRow(),
        id: 62,
        sender_id: SENDER_ID + 1,
        sender_name: 'Bob',
        payload: String.fromCodePoint(likeCode),
        timestamp: parentTs + 1000,
        emoji: likeCode,
        reply_id: 77 as number | null,
      },
    ]);

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(result.current.messages.length).toBe(2);
    });

    const reaction = result.current.messages.find((m) => m.emoji != null);
    expect(reaction).toBeDefined();
    expect(reaction!.emoji).toBe(likeCode);
    expect(reaction!.replyId).toBe(77);
    expect(reaction!.payload).toBe(String.fromCodePoint(likeCode));
  });

  it('coerces string emoji and reply_id from DB drivers into numbers', async () => {
    const parentTs = 1_700_000_000_200;
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([
      {
        ...sampleMeshcoreDbRow(),
        id: 70,
        payload: 'x',
        timestamp: parentTs,
        packet_id: 99 as number | null,
      },
      {
        ...sampleMeshcoreDbRow(),
        id: 71,
        sender_name: 'Bob',
        payload: '👍',
        timestamp: parentTs + 500,
        emoji: '128077' as unknown as number | null,
        reply_id: '99' as unknown as number | null,
      },
    ]);

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(result.current.messages.length).toBe(2);
    });

    const reaction = result.current.messages.find((m) => m.emoji === 128077);
    expect(reaction?.replyId).toBe(99);
  });

  it('legacy DB: Unknown sender + long wire-style line still normalizes once', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([
      {
        ...sampleMeshcoreDbRow(),
        id: 80,
        sender_id: null,
        sender_name: 'Unknown',
        payload: 'NVON 01: legacy full line body',
        timestamp: 1_700_000_000_300,
      },
    ]);

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(result.current.messages.length).toBe(1);
    });

    const m = result.current.messages[0];
    expect(m.payload).toBe('legacy full line body');
    expect(m.sender_name).toBe('NVON 01');
  });

  /**
   * Regression: inbound mesh chat must call `saveMeshcoreMessage` (same `addMessage` path as RF).
   * MQTT subscription exercises this without a radio; `flushSync` keeps persist aligned with state.
   */
  it('synthetic mqtt onMeshcoreChat invokes saveMeshcoreMessage (shared path with RF inbound)', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    let meshcoreChatHandler: ((raw: unknown) => void) | undefined;
    vi.mocked(window.electronAPI.mqtt.onMeshcoreChat).mockImplementation((cb) => {
      meshcoreChatHandler = cb as (raw: unknown) => void;
      return () => {};
    });

    renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(meshcoreChatHandler).toBeDefined();
    });

    const ts = Date.now();
    act(() => {
      meshcoreChatHandler!({
        text: 'SynthUser: synthetic inbound body',
        channelIdx: 0,
        senderName: 'SynthUser',
        senderNodeId: 0xabcd1234,
        timestamp: ts,
      });
    });

    await waitFor(() => {
      expect(window.electronAPI.db.saveMeshcoreMessage).toHaveBeenCalled();
    });

    expect(vi.mocked(window.electronAPI.db.saveMeshcoreMessage).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        received_via: 'mqtt',
        channel_idx: 0,
        payload: 'synthetic inbound body',
        timestamp: ts,
      }),
    );
  });
});
