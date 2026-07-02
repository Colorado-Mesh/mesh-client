import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import { useProtocolDbRefresh } from './useDbRefresh';

const ID = 'id-db-refresh';

describe('useProtocolDbRefresh', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {} });
    useMessageStore.setState({ messages: {} });
    vi.restoreAllMocks();
  });

  it('no-ops when identityId is null', async () => {
    const getNodes = vi.spyOn(window.electronAPI.db, 'getNodes');
    const { result } = renderHook(() => useProtocolDbRefresh('meshtastic', null));
    await result.current.refreshAllFromDb();
    expect(getNodes).not.toHaveBeenCalled();
  });

  it('refreshAllFromDb loads Meshtastic store slice', async () => {
    vi.spyOn(window.electronAPI.db, 'getNodes').mockResolvedValue([
      {
        node_id: 9,
        long_name: 'Node9',
        short_name: 'N9',
        hw_model: 'Heltec',
        battery: 50,
        snr: 0,
        rssi: -90,
        last_heard: 1,
        latitude: null,
        longitude: null,
        role: null,
        hops_away: null,
        via_mqtt: null,
        voltage: null,
        channel_utilization: null,
        air_util_tx: null,
        altitude: null,
        favorited: 0,
        source: 'rf',
        num_packets_rx_bad: null,
        num_rx_dupe: null,
        num_packets_rx: null,
        num_packets_tx: null,
        hops: null,
        path: null,
      },
    ]);
    vi.spyOn(window.electronAPI.db, 'getMessages').mockResolvedValue([]);

    const { result } = renderHook(() => useProtocolDbRefresh('meshtastic', ID));
    await result.current.refreshAllFromDb();

    await waitFor(() => {
      expect(useNodeStore.getState().nodes[ID]?.[9]).toBeDefined();
    });
  });

  it('refreshMessagesFromDb loads MeshCore messages only', async () => {
    vi.spyOn(window.electronAPI.db, 'getMeshcoreContacts').mockResolvedValue([]);
    vi.spyOn(window.electronAPI.db, 'getNodes').mockResolvedValue([]);
    vi.spyOn(window.electronAPI.db, 'getMeshcoreMessages').mockResolvedValue([
      {
        id: 1,
        sender_id: 0x11,
        sender_name: 'X',
        payload: 'test',
        channel_idx: 0,
        timestamp: 100,
        status: 'acked',
        packet_id: null,
        emoji: null,
        reply_id: null,
        to_node: null,
      },
    ]);

    const { result } = renderHook(() => useProtocolDbRefresh('meshcore', ID));
    await result.current.refreshMessagesFromDb();

    await waitFor(() => {
      expect(Object.keys(useMessageStore.getState().messages[ID] ?? {})).toHaveLength(1);
    });
    expect(useNodeStore.getState().nodes[ID]).toBeUndefined();
  });

  it('refreshAllFromDb loads Reticulum messages from SQLite', async () => {
    vi.spyOn(window.electronAPI.db, 'getReticulumDestinations').mockResolvedValue([]);
    vi.spyOn(window.electronAPI.db, 'getReticulumMessages').mockResolvedValue([
      {
        sender_id: 'aa'.repeat(16),
        sender_name: 'Peer',
        payload: 'hi',
        timestamp: 1000,
        to_hash: null,
        reply_to_hash: null,
        message_hash: 'bb'.repeat(16),
        received_via: 'network',
        delivery_status: 'delivered',
      },
    ]);

    const { result } = renderHook(() => useProtocolDbRefresh('reticulum', ID));
    await result.current.refreshAllFromDb();

    await waitFor(() => {
      expect(Object.keys(useMessageStore.getState().messages[ID] ?? {})).toHaveLength(1);
    });
  });
});
