import { beforeEach, describe, expect, it, vi } from 'vitest';

import { upsertMessage, useMessageStore } from '../../stores/messageStore';
import { useNodeStore } from '../../stores/nodeStore';
import { packetRouter } from '../drivers/PacketRouter';
import { callsignToNodeId } from '../meshcom/meshcomCallsign';
import { chatMessageToMessageRecord } from '../storeRecordAdapters';
import {
  attachMeshcomIngest,
  ingestMeshcomExtUdpFrame,
  meshcomIngestHandleTextMessage,
} from './meshcomIngest';

vi.mock('../dbPersistRetry', () => ({
  persistDbWrite: (_label: string, fn: () => unknown) => {
    void fn();
  },
}));

const ID = 'offline-meshcom';

describe('meshcomIngest', () => {
  beforeEach(() => {
    vi.spyOn(window.electronAPI.db, 'saveMeshcomMessage')
      .mockReset()
      .mockResolvedValue({ changes: 1 });
    vi.spyOn(window.electronAPI.db, 'saveMeshcomContact')
      .mockReset()
      .mockResolvedValue({ changes: 1 });
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
  });

  it('attachMeshcomIngest returns a detach function', () => {
    const detach = attachMeshcomIngest(ID);
    expect(typeof detach).toBe('function');
    detach();
  });

  it('ingestMeshcomExtUdpFrame persists a msg frame', () => {
    ingestMeshcomExtUdpFrame(ID, {
      type: 'msg',
      src: 'OE1KFR-1',
      dst: '*',
      msg: 'cq',
      msg_id: 'abc123',
      rssi: -90,
      snr: 5,
      hw_id: 1,
    });
    expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalled();
    expect(window.electronAPI.db.saveMeshcomContact).toHaveBeenCalledWith(
      expect.objectContaining({
        callsign: 'OE1KFR-1',
        node_id: callsignToNodeId('OE1KFR-1'),
      }),
    );
  });

  it('text_message persist path writes via electronAPI.db.saveMeshcomMessage', () => {
    const from = callsignToNodeId('DH1FR-2');
    const msgId = 'meshcom-tm-1';
    upsertMessage(
      ID,
      chatMessageToMessageRecord({
        storeId: msgId,
        sender_id: from,
        sender_name: 'DH1FR-2',
        payload: 'hello meshcom',
        channel: 0,
        timestamp: 1_700_000_000_000,
        receivedVia: 'rf',
      }),
    );
    useNodeStore.setState({
      nodes: {
        [ID]: {
          [from]: { nodeId: from, longName: 'DH1FR-2', lastHeardAt: 1_700_000_000 },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });

    meshcomIngestHandleTextMessage(
      ID,
      {
        type: 'text_message',
        payload: {
          id: msgId,
          from,
          to: 0,
          payload: 'hello meshcom',
          channelIndex: 0,
          timestamp: 1_700_000_000_000,
          rxRssi: -88,
          rxSnr: 4,
        },
      },
      { getMyNodeNum: () => 0 },
    );

    expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        identity_id: ID,
        msg_id: msgId,
        from_call: 'DH1FR-2',
        text: 'hello meshcom',
      }),
    );
  });

  it('packetRouter text_message reaches ingest when attached', () => {
    const from = callsignToNodeId('OE3BEF-1');
    const msgId = 'meshcom-router-1';
    upsertMessage(
      ID,
      chatMessageToMessageRecord({
        storeId: msgId,
        sender_id: from,
        sender_name: 'OE3BEF-1',
        payload: 'via router',
        channel: 0,
        timestamp: Date.now(),
      }),
    );
    useNodeStore.setState({
      nodes: {
        [ID]: {
          [from]: { nodeId: from, longName: 'OE3BEF-1', lastHeardAt: 1 },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });

    const detach = attachMeshcomIngest(ID);
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: msgId,
          from,
          to: 0,
          payload: 'via router',
          channelIndex: 0,
          timestamp: Date.now(),
        },
      },
      ID,
    );
    expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalled();
    detach();
  });
});
