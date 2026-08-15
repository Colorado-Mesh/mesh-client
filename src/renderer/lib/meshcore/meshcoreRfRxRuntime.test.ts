import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import {
  markMeshcoreLocallyDeletedContact,
  resetMeshcoreLocallyDeletedContactsForTests,
} from '../meshcoreLocallyDeletedContacts';
import { pubkeyToNodeId } from '../meshcoreUtils';
import { setMeshtasticConnectedMyNodeNum } from '../meshtasticConnectedNodeRef';
import { meshNodeToNodeRecord } from '../storeRecordAdapters';
import type { MeshNode, TelemetryPoint } from '../types';
import type { DeviceLogEntry, MeshCoreSelfInfo, RxPacketEntry } from './meshcoreHookTypes';
import { createMeshcoreMqttPacketLogBucket } from './meshcoreMqttPacketLogThrottle';
import {
  applyMeshcoreRfHopsAwayUpdate,
  handleMeshcoreRfRx,
  type MeshcoreRfRxDeps,
} from './meshcoreRfRxRuntime';

const ID = 'meshcore-rf-rx-runtime-test';

function ref<T>(current: T) {
  return { current };
}

function makeNode(nodeId: number, overrides?: Partial<MeshNode>): MeshNode {
  return {
    node_id: nodeId,
    long_name: `Node-${nodeId}`,
    short_name: `N${nodeId}`,
    hw_model: 'Companion',
    snr: 0,
    battery: 100,
    last_heard: 0,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<MeshcoreRfRxDeps>): {
  deps: MeshcoreRfRxDeps;
  deviceLogs: DeviceLogEntry[];
  rawPackets: RxPacketEntry[];
} {
  const deviceLogs: DeviceLogEntry[] = [];
  const rawPackets: RxPacketEntry[] = [];
  const signal: TelemetryPoint[] = [];

  const deps: MeshcoreRfRxDeps = {
    myNodeNumRef: ref(1),
    meshcoreIdentityIdRef: ref<string | null>(ID),
    readNodes: () => new Map<number, MeshNode>(),
    pubKeyMapRef: ref(new Map<number, Uint8Array>()),
    pubKeyPrefixMapRef: ref(new Map<string, number>()),
    nicknameMapRef: ref(new Map<number, string>()),
    selfInfoRef: ref<MeshCoreSelfInfo | null>(null),
    rawPacketsRef: ref(rawPackets),
    mqttStatusRef: ref('disconnected' as const),
    lastPacketLogPublishFailureLogAtRef: ref(0),
    mqttPacketLogBucket: createMeshcoreMqttPacketLogBucket(),
    setDeviceLogs: (updater) => {
      const next = typeof updater === 'function' ? updater(deviceLogs) : updater;
      deviceLogs.splice(0, deviceLogs.length, ...next);
    },
    setSignalTelemetry: (updater) => {
      const next = typeof updater === 'function' ? updater(signal) : updater;
      signal.splice(0, signal.length, ...next);
    },
    setRawPackets: (updater) => {
      const next = typeof updater === 'function' ? updater(rawPackets) : updater;
      rawPackets.splice(0, rawPackets.length, ...next);
    },
    ...overrides,
  };

  return { deps, deviceLogs, rawPackets };
}

describe('handleMeshcoreRfRx', () => {
  afterEach(() => {
    useNodeStore.setState({ nodes: {} });
    setMeshtasticConnectedMyNodeNum(0);
    resetMeshcoreLocallyDeletedContactsForTests();
    vi.restoreAllMocks();
  });

  it('updates a known Meshtastic-class node last_heard/snr/rssi from the node map', () => {
    const nodes = new Map<number, MeshNode>([[2, makeNode(2, { last_heard: 100 })]]);
    const { deps } = makeDeps({
      myNodeNumRef: ref(1),
      readNodes: () => nodes,
    });

    // Meshtastic wire shape: dest=16129 (bytes 0-3, byte1=0x3F forces the MeshCore path-length
    // field to overrun the buffer so parseMeshCoreRfPacket fails), sender=2 (bytes 4-7); an
    // 8-byte buffer with no MeshCore parse and non-zero/non-broadcast dest+sender always
    // classifies as Meshtastic (no hop-flags byte to check).
    const raw = Uint8Array.from([1, 0x3f, 0, 0, 2, 0, 0, 0]);

    handleMeshcoreRfRx({ lastSnr: 5.5, lastRssi: -55, raw }, deps);

    const record = useNodeStore.getState().nodes[ID][2];
    expect(record).toMatchObject({ snr: 5.5, rssi: -55 });
    expect(record.lastHeardAt).toBeGreaterThanOrEqual(100);
  });

  it('does not update the sending node itself (senderId === myNodeNum)', () => {
    const nodes = new Map<number, MeshNode>([[2, makeNode(2, { last_heard: 100 })]]);
    const { deps } = makeDeps({
      myNodeNumRef: ref(2),
      readNodes: () => nodes,
    });
    // Same Meshtastic-classifying shape as above (byte1=0x3F forces MeshCore parse failure);
    // sender (bytes 4-7) equals myNodeNum, so the sender-is-self guard should skip the update.
    const raw = Uint8Array.from([1, 0x3f, 0, 0, 2, 0, 0, 0]);

    handleMeshcoreRfRx({ lastSnr: 5.5, lastRssi: -55, raw }, deps);

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- store bucket optional at runtime
    expect(useNodeStore.getState().nodes[ID]?.[2]).toBeUndefined();
  });

  it('skips foreign-LoRa recording when the MeshCore RF bridge proximity gate fails', () => {
    setMeshtasticConnectedMyNodeNum(99);
    const recordSpy = vi.spyOn(useDiagnosticsStore.getState(), 'recordForeignLora');
    const { deps } = makeDeps();

    // raw[0] = 0x3c is the legacy MeshCore marker, so classifyPayload always returns
    // 'meshcore' regardless of full-packet parse success.
    const raw = Uint8Array.from([0x3c, 1, 2, 3, 4, 5, 6, 7, 8]);

    handleMeshcoreRfRx({ lastSnr: 1, lastRssi: -100, raw }, deps);

    expect(recordSpy).not.toHaveBeenCalled();
  });

  it('records foreign-LoRa when the MeshCore RF bridge proximity is nearby', () => {
    setMeshtasticConnectedMyNodeNum(99);
    const recordSpy = vi.spyOn(useDiagnosticsStore.getState(), 'recordForeignLora');
    const { deps } = makeDeps();

    const raw = Uint8Array.from([0x3c, 1, 2, 3, 4, 5, 6, 7, 8]);

    handleMeshcoreRfRx({ lastSnr: 5, lastRssi: -60, raw }, deps);

    // rfSenderId (arg 5) resolves from the packet's path/pubkey hash; rfFingerprint and
    // rfDisplayName (args 8-9) stay undefined once a concrete sender id is resolved.
    // arg 6 is the per-packet cached node reader (snapshot of deps.readNodes), not the raw ref.
    expect(recordSpy).toHaveBeenCalledWith(
      99,
      'meshcore',
      -60,
      5,
      expect.anything(),
      expect.any(Function),
      'meshcore-radio-rf',
      undefined,
      undefined,
    );
    const cachedReader = recordSpy.mock.calls[0][5] as () => Map<number, MeshNode>;
    expect(cachedReader()).toBeInstanceOf(Map);
    // Stable per-packet snapshot: repeated reads return the same Map, not a fresh materialization.
    expect(cachedReader()).toBe(cachedReader());
  });

  it('publishes an MQTT packet log when MQTT is connected and the throttle allows it', () => {
    const { deps } = makeDeps({ mqttStatusRef: ref('connected' as const) });
    const publish = vi.mocked(window.electronAPI.mqtt.publishMeshcorePacketLog);
    publish.mockClear();

    handleMeshcoreRfRx({ lastSnr: 3, lastRssi: -70, raw: null }, deps);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ snr: 3, rssi: -70 }));
  });

  it('does not publish an MQTT packet log when MQTT is disconnected', () => {
    const { deps } = makeDeps({ mqttStatusRef: ref('disconnected' as const) });
    const publish = vi.mocked(window.electronAPI.mqtt.publishMeshcorePacketLog);
    publish.mockClear();

    handleMeshcoreRfRx({ lastSnr: 3, lastRssi: -70, raw: null }, deps);

    expect(publish).not.toHaveBeenCalled();
  });

  it('clears MQTT-only flags on RF hear even when hops/snr/rssi/last_heard are unchanged', () => {
    const nowMs = 1_700_000_000_000;
    const nowSec = Math.floor(nowMs / 1000);
    vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    const node = makeNode(7, {
      last_heard: nowSec,
      snr: 4,
      rssi: -70,
      hops_away: 1,
      source: 'mqtt',
      heard_via_mqtt_only: true,
      via_mqtt: true,
    });
    upsertNodeRecord(ID, meshNodeToNodeRecord(node));
    const nodes = new Map<number, MeshNode>([[7, node]]);
    const { deps } = makeDeps({
      myNodeNumRef: ref(1),
      readNodes: () => nodes,
    });

    applyMeshcoreRfHopsAwayUpdate(7, 1, nowMs, 4, -70, deps);

    expect(useNodeStore.getState().nodes[ID][7]).toMatchObject({
      source: 'rf',
      heardViaMqttOnly: false,
      viaMqtt: false,
      hopsAway: 1,
      snr: 4,
      rssi: -70,
      lastHeardAt: nowSec,
    });
  });

  it('skips Meshtastic-sender store writes when last_heard/snr/rssi are unchanged', () => {
    const nowMs = 1_700_000_000_000;
    const nowSec = Math.floor(nowMs / 1000);
    vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    const nodes = new Map<number, MeshNode>([
      [2, makeNode(2, { last_heard: nowSec, snr: 5.5, rssi: -55 })],
    ]);
    upsertNodeRecord(ID, meshNodeToNodeRecord(nodes.get(2)!));
    const { deps } = makeDeps({
      myNodeNumRef: ref(1),
      readNodes: () => nodes,
    });
    const setStateSpy = vi.spyOn(useNodeStore, 'setState');
    const raw = Uint8Array.from([1, 0x3f, 0, 0, 2, 0, 0, 0]);

    handleMeshcoreRfRx({ lastSnr: 5.5, lastRssi: -55, raw }, deps);

    expect(setStateSpy).not.toHaveBeenCalled();
  });
});

function buildFloodAdvertPacket(opts: {
  publicKey: Uint8Array;
  name: string;
  deviceRole: number;
}): Uint8Array {
  const nameBytes = new TextEncoder().encode(opts.name);
  const raw = new Uint8Array(2 + 32 + 4 + 64 + 1 + nameBytes.length);
  raw[0] = (4 << 2) | 1; // ADVERT + FLOOD
  raw[1] = 0; // 0 hops
  raw.set(opts.publicKey, 2);
  new DataView(raw.buffer).setUint32(34, 1_700_000_000, true);
  raw[102] = 0x80 | (opts.deviceRole & 0x0f);
  raw.set(nameBytes, 103);
  return raw;
}

describe('handleMeshcoreRfRx advert identity', () => {
  afterEach(() => {
    useNodeStore.setState({ nodes: {} });
    resetMeshcoreLocallyDeletedContactsForTests();
    vi.restoreAllMocks();
  });

  it('upserts advert name and Room hw_model from an on-air ADVERT packet', () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => (i + 3) & 0xff);
    const nodeId = pubkeyToNodeId(publicKey);
    const name = '🛜 NV0N PW=hello';
    const { deps } = makeDeps({ myNodeNumRef: ref(1) });
    vi.mocked(window.electronAPI.db.saveMeshcoreContact).mockResolvedValue(undefined);

    handleMeshcoreRfRx(
      {
        lastSnr: 12,
        lastRssi: -22,
        raw: buildFloodAdvertPacket({ publicKey, name, deviceRole: 3 }),
      },
      deps,
    );

    expect(useNodeStore.getState().nodes[ID][nodeId]).toMatchObject({
      longName: name,
      hwModel: 'Room',
    });
  });

  it('revives a locally deleted contact when a live RF advert is heard', () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => (i + 5) & 0xff);
    const nodeId = pubkeyToNodeId(publicKey);
    markMeshcoreLocallyDeletedContact(nodeId);
    const { deps } = makeDeps({ myNodeNumRef: ref(1) });
    vi.mocked(window.electronAPI.db.saveMeshcoreContact).mockResolvedValue(undefined);

    handleMeshcoreRfRx(
      {
        lastSnr: 12,
        lastRssi: -22,
        raw: buildFloodAdvertPacket({ publicKey, name: 'NV0N Room', deviceRole: 3 }),
      },
      deps,
    );

    expect(useNodeStore.getState().nodes[ID][nodeId].longName).toBe('NV0N Room');
    expect(window.electronAPI.db.saveMeshcoreContact).toHaveBeenCalledWith(
      expect.objectContaining({ adv_name: 'NV0N Room', contact_type: 3 }),
    );
  });
});
