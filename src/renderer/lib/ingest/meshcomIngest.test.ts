import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  selectEnvironmentSeries,
  useEnvironmentTelemetryStore,
} from '../../stores/environmentTelemetryStore';
import { addIdentity } from '../../stores/identityStore';
import { upsertMessage, useMessageStore } from '../../stores/messageStore';
import { useNodeStore } from '../../stores/nodeStore';
import { packetRouter } from '../drivers/PacketRouter';
import { clearMeshcomCallRegistry, registerMeshcomCallsign } from '../meshcom/meshcomCallRegistry';
import { callsignToNodeId } from '../meshcom/meshcomCallsign';
import * as meshcomCallsignWatchlist from '../meshcom/meshcomCallsignWatchlist';
import {
  clearAllMeshcomLocallyDeletedContactsForTests,
  markMeshcomLocallyDeletedContact,
} from '../meshcom/meshcomLocallyDeletedContacts';
import {
  getMeshcomNetworkTime,
  resetMeshcomNetworkTimeForTests,
} from '../meshcom/meshcomNetworkTime';
import { meshcomProtocol } from '../protocols/MeshComProtocol';
import { clearRadioSelfPosition, readRadioSelfPosition } from '../radioSelfPosition';
import { chatMessageToMessageRecord } from '../storeRecordAdapters';
import { attachMeshcomIngest, meshcomIngestHandleTextMessage } from './meshcomIngest';

vi.mock('../dbPersistRetry', () => ({
  persistDbWrite: (_label: string, fn: () => unknown) => {
    void fn();
  },
}));

const ID = 'offline-meshcom';

describe('meshcomIngest', () => {
  beforeEach(() => {
    resetMeshcomNetworkTimeForTests();
    clearAllMeshcomLocallyDeletedContactsForTests();
    clearMeshcomCallRegistry();
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

  it('resolves from_call from the callsign registry when node_info has not landed yet', () => {
    const from = registerMeshcomCallsign('OE1NEW-1');
    const msgId = 'meshcom-tm-first-contact';
    upsertMessage(
      ID,
      chatMessageToMessageRecord({
        storeId: msgId,
        sender_id: from,
        sender_name: '',
        payload: 'first',
        channel: 0,
        timestamp: 1_700_000_000_000,
        receivedVia: 'rf',
      }),
    );

    meshcomIngestHandleTextMessage(
      ID,
      {
        type: 'text_message',
        payload: {
          id: msgId,
          from,
          to: 0xffffffff,
          payload: 'first',
          channelIndex: 0,
          timestamp: 1_700_000_000_000,
        },
      },
      { getMyNodeNum: () => 0 },
    );

    expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        from_call: 'OE1NEW-1',
        msg_id: msgId,
        to_call_or_group: '*',
      }),
    );
    expect(window.electronAPI.db.saveMeshcomContact).toHaveBeenCalledWith(
      expect.objectContaining({ callsign: 'OE1NEW-1', node_id: from }),
    );
  });

  it('persists ALL broadcast as to_call_or_group=* not NFFFFFFFF', () => {
    const from = registerMeshcomCallsign('SP2ONG-1');
    const msgId = 'meshcom-all-broadcast';
    upsertMessage(
      ID,
      chatMessageToMessageRecord({
        storeId: msgId,
        sender_id: from,
        sender_name: 'SP2ONG-1',
        payload: 'cq',
        channel: 0,
        timestamp: 1_700_000_000_000,
      }),
    );

    meshcomIngestHandleTextMessage(
      ID,
      {
        type: 'text_message',
        payload: {
          id: msgId,
          from,
          to: 0xffffffff,
          payload: 'cq',
          channelIndex: 0,
          timestamp: 1_700_000_000_000,
        },
      },
      { getMyNodeNum: () => callsignToNodeId('ME-1') },
    );

    expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to_call_or_group: '*',
        channel_idx: 0,
      }),
    );
    expect(window.electronAPI.db.saveMeshcomContact).not.toHaveBeenCalledWith(
      expect.objectContaining({ callsign: expect.stringMatching(/^N/i) }),
    );
  });

  it('persists GRC group as digit to_call_or_group and DM as peer callsign', () => {
    const from = registerMeshcomCallsign('SP2ONG-1');
    const me = registerMeshcomCallsign('ME-9');
    const groupId = 'meshcom-grc-312';
    const dmId = 'meshcom-dm-1';

    upsertMessage(
      ID,
      chatMessageToMessageRecord({
        storeId: groupId,
        sender_id: from,
        sender_name: 'SP2ONG-1',
        payload: 'group hi',
        channel: 312,
        timestamp: 1,
      }),
    );
    meshcomIngestHandleTextMessage(
      ID,
      {
        type: 'text_message',
        payload: {
          id: groupId,
          from,
          to: 0xffffffff,
          payload: 'group hi',
          channelIndex: 312,
          timestamp: 1,
        },
      },
      { getMyNodeNum: () => me },
    );
    expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to_call_or_group: '312', channel_idx: 312 }),
    );

    upsertMessage(
      ID,
      chatMessageToMessageRecord({
        storeId: dmId,
        sender_id: from,
        sender_name: 'SP2ONG-1',
        payload: 'dm hi',
        channel: -1,
        to: me,
        timestamp: 2,
      }),
    );
    meshcomIngestHandleTextMessage(
      ID,
      {
        type: 'text_message',
        payload: {
          id: dmId,
          from,
          to: me,
          payload: 'dm hi',
          channelIndex: -1,
          timestamp: 2,
        },
      },
      { getMyNodeNum: () => me },
    );
    expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to_call_or_group: 'ME-9',
        channel_idx: -1,
      }),
    );
  });

  it('keeps chat lines that mention {CET} but are not beacons', () => {
    const from = callsignToNodeId('OE3BEF-1');
    const msgId = 'meshcom-cet-negative';
    upsertMessage(
      ID,
      chatMessageToMessageRecord({
        storeId: msgId,
        sender_id: from,
        sender_name: 'OE3BEF-1',
        payload: 'FYI gateway sends {CET} beacons',
        channel: 0,
        timestamp: Date.now(),
      }),
    );
    meshcomIngestHandleTextMessage(
      ID,
      {
        type: 'text_message',
        payload: {
          id: msgId,
          from,
          to: 0,
          payload: 'FYI gateway sends {CET} beacons',
          channelIndex: 0,
          timestamp: Date.now(),
        },
      },
      { getMyNodeNum: () => 0 },
    );
    expect(useMessageStore.getState().messages[ID][msgId]).toBeDefined();
    expect(getMeshcomNetworkTime()).toBeNull();
  });

  it('strips prefix {CET} beacons in ingest after PacketRouter skipped the store write', () => {
    const from = callsignToNodeId('GW1-1');
    const msgId = 'meshcom-cet-beacon';
    // Rare path when a row exists before ingest deletes it.
    upsertMessage(
      ID,
      chatMessageToMessageRecord({
        storeId: msgId,
        sender_id: from,
        sender_name: 'GW1-1',
        payload: '{CET}2026-11-21 20:15:00',
        channel: 0,
        timestamp: Date.now(),
      }),
    );
    meshcomIngestHandleTextMessage(
      ID,
      {
        type: 'text_message',
        payload: {
          id: msgId,
          from,
          to: 0,
          payload: '{CET}2026-11-21 20:15:00',
          channelIndex: 0,
          timestamp: Date.now(),
        },
      },
      { getMyNodeNum: () => 0 },
    );
    expect(useMessageStore.getState().messages[ID][msgId]).toBeUndefined();
    expect(getMeshcomNetworkTime()).toMatchObject({ text: '2026-11-21 20:15:00' });
  });

  it('PacketRouter does not store MeshCom {CET} prefix beacons', () => {
    const meshcomId = 'meshcom-packet-router-cet';
    addIdentity({
      id: meshcomId,
      protocol: meshcomProtocol,
      signature: 'sig',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    const msgId = 'cet-only';
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: msgId,
          from: 1,
          to: 0,
          payload: '{CET}2026-11-21 20:15:00',
          channelIndex: 0,
          timestamp: Date.now(),
        },
      },
      meshcomId,
    );
    expect(useMessageStore.getState().messages[meshcomId]).toBeUndefined();
    expect(getMeshcomNetworkTime()).toMatchObject({ text: '2026-11-21 20:15:00' });
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

  it('does not watchlist-alert on bare node_info refreshes', () => {
    const call = 'OE9XYZ-7';
    const nodeId = callsignToNodeId(call);
    const alert = vi.spyOn(meshcomCallsignWatchlist, 'maybeAlertMeshcomWatchlistCallsign');
    const detach = attachMeshcomIngest(ID);
    packetRouter.dispatch(
      {
        type: 'node_info',
        payload: {
          nodeId,
          longName: call,
          shortName: 'OE9X',
          lastHeardAt: 1_700_000_100,
        },
      },
      ID,
    );
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
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
