import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  selectEnvironmentSeries,
  useEnvironmentTelemetryStore,
} from '../../stores/environmentTelemetryStore';
import { upsertMessage, useMessageStore } from '../../stores/messageStore';
import { useNodeStore } from '../../stores/nodeStore';
import { packetRouter } from '../drivers/PacketRouter';
import { callsignToNodeId } from '../meshcom/meshcomCallsign';
import {
  clearAllMeshcomLocallyDeletedContactsForTests,
  markMeshcomLocallyDeletedContact,
} from '../meshcom/meshcomLocallyDeletedContacts';
import { clearRadioSelfPosition, readRadioSelfPosition } from '../radioSelfPosition';
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
    clearAllMeshcomLocallyDeletedContactsForTests();
    vi.spyOn(window.electronAPI.db, 'saveMeshcomMessage')
      .mockReset()
      .mockResolvedValue({ changes: 1 });
    vi.spyOn(window.electronAPI.db, 'saveMeshcomContact')
      .mockReset()
      .mockResolvedValue({ changes: 1 });
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    useEnvironmentTelemetryStore.setState({ history: new Map() });
    clearRadioSelfPosition('meshcom');
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

  it('records radio self position when position event is for myNodeNum', () => {
    const selfId = callsignToNodeId('OE1ABC-1');
    const detach = attachMeshcomIngest(ID, { getMyNodeNum: () => selfId });
    packetRouter.dispatch(
      {
        type: 'position',
        payload: {
          nodeId: selfId,
          latitude: 48.2,
          longitude: 16.37,
          timestamp: Date.now(),
        },
      },
      ID,
    );
    expect(readRadioSelfPosition('meshcom')).toMatchObject({ lat: 48.2, lon: 16.37 });
    detach();
  });

  it('node_info merges POS fields (hops, snr, battery, hardware) into the node store', () => {
    const call = 'OE9XYZ-7';
    const nodeId = callsignToNodeId(call);
    const detach = attachMeshcomIngest(ID);
    packetRouter.dispatch(
      {
        type: 'node_info',
        payload: {
          nodeId,
          longName: call,
          shortName: 'OE9X',
          lastHeardAt: 1_700_000_100,
          latitude: 47.1,
          longitude: 15.2,
          batteryLevel: 88,
          snr: 7.5,
          rssi: -85,
          hopsAway: 2,
          hwModel: 'HELTEC-V3',
          firmwareVersion: '4.35p',
        },
      },
      ID,
    );
    const node = useNodeStore.getState().nodes[ID][nodeId];
    expect(node).toMatchObject({
      longName: call,
      latitude: 47.1,
      longitude: 15.2,
      batteryLevel: 88,
      snr: 7.5,
      rssi: -85,
      hopsAway: 2,
      hwModel: 'HELTEC-V3',
      firmwareVersion: '4.35p',
      source: 'rf',
    });
    detach();
  });

  it('skips node_info upsert and contact persist for tombstoned callsigns', () => {
    const call = 'OE1DEL-1';
    const nodeId = callsignToNodeId(call);
    markMeshcomLocallyDeletedContact(call);
    const detach = attachMeshcomIngest(ID);
    packetRouter.dispatch(
      {
        type: 'node_info',
        payload: {
          nodeId,
          longName: call,
          shortName: 'OE1D',
          lastHeardAt: 1_700_000_100,
        },
      },
      ID,
    );
    expect(useNodeStore.getState().nodes[ID][nodeId]).toBeUndefined();
    expect(window.electronAPI.db.saveMeshcomContact).not.toHaveBeenCalled();
    detach();
  });

  it('telemetry updates battery and records environment history', () => {
    const call = 'OE1TEL-1';
    const nodeId = callsignToNodeId(call);
    useNodeStore.setState({
      nodes: {
        [ID]: {
          [nodeId]: { nodeId, longName: call, lastHeardAt: 1 },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    const detach = attachMeshcomIngest(ID);
    packetRouter.dispatch(
      {
        type: 'telemetry',
        payload: {
          nodeId,
          timestamp: 1_700_000_200_000,
          batteryLevel: 66,
          voltage: 3.9,
          temperature: 17.5,
          relativeHumidity: 44,
          barometricPressure: 1002,
          co2: 480,
        },
      },
      ID,
    );
    expect(useNodeStore.getState().nodes[ID][nodeId]).toMatchObject({
      batteryLevel: 66,
      voltage: 3.9,
    });
    const series = selectEnvironmentSeries(
      useEnvironmentTelemetryStore.getState(),
      'meshcom',
      ID,
      nodeId,
    );
    expect(series.at(-1)?.reading).toMatchObject({
      temperature: 17.5,
      relativeHumidity: 44,
      barometricPressure: 1002,
      co2: 480,
    });
    expect(window.electronAPI.db.saveMeshcomContact).toHaveBeenCalledWith(
      expect.objectContaining({ callsign: call, batt: 66 }),
    );
    detach();
  });
});
