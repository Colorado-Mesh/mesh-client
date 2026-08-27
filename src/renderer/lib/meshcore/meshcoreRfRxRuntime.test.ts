import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import {
  markMeshcoreLocallyDeletedContact,
  resetMeshcoreLocallyDeletedContactsForTests,
} from '../meshcoreLocallyDeletedContacts';
import * as meshcorePathChainDisplay from '../meshcorePathChainDisplay';
import { pubkeyToNodeId } from '../meshcoreUtils';
import { setMeshtasticConnectedMyNodeNum } from '../meshtasticConnectedNodeRef';
import { useRelayCoverageStore } from '../relayCoverage/relayCoverageStore';
import { meshNodeToNodeRecord } from '../storeRecordAdapters';
import type { MeshNode, TelemetryPoint } from '../types';
import { openHeardRepeatWindow, resetHeardRepeatWindowsForTests } from './heardRepeatTracker';
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
    expect(window.electronAPI.db.saveMeshcoreContact).toHaveBeenCalledWith(
      expect.objectContaining({ adv_name: name, contact_type: 3 }),
    );
  });

  it('persists a fresh non-tombstoned RF advert via saveMeshcoreContact', () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => (i + 7) & 0xff);
    const nodeId = pubkeyToNodeId(publicKey);
    const { deps } = makeDeps({ myNodeNumRef: ref(1) });
    vi.mocked(window.electronAPI.db.saveMeshcoreContact).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.db.updateMeshcoreContactAdvert).mockResolvedValue(undefined);

    handleMeshcoreRfRx(
      {
        lastSnr: 8,
        lastRssi: -30,
        raw: buildFloodAdvertPacket({ publicKey, name: 'Alice', deviceRole: 1 }),
      },
      deps,
    );

    expect(useNodeStore.getState().nodes[ID][nodeId].longName).toBe('Alice');
    expect(window.electronAPI.db.saveMeshcoreContact).toHaveBeenCalledWith(
      expect.objectContaining({ adv_name: 'Alice', contact_type: 1, on_radio: 1 }),
    );
    expect(window.electronAPI.db.updateMeshcoreContactAdvert).not.toHaveBeenCalled();
  });

  it('persists an on-air rename for an existing contact via updateMeshcoreContactAdvert', () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => (i + 9) & 0xff);
    const nodeId = pubkeyToNodeId(publicKey);
    upsertNodeRecord(ID, {
      nodeId,
      longName: 'Alice',
      hwModel: 'Companion',
      lastHeardAt: 1_699_000_000,
      publicKey,
    });
    const { deps } = makeDeps({ myNodeNumRef: ref(1) });
    vi.mocked(window.electronAPI.db.saveMeshcoreContact).mockClear();
    vi.mocked(window.electronAPI.db.updateMeshcoreContactAdvert).mockClear();
    vi.mocked(window.electronAPI.db.saveMeshcoreContact).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.db.updateMeshcoreContactAdvert).mockResolvedValue(undefined);

    handleMeshcoreRfRx(
      {
        lastSnr: 7,
        lastRssi: -28,
        raw: buildFloodAdvertPacket({ publicKey, name: 'Bob', deviceRole: 1 }),
      },
      deps,
    );

    expect(useNodeStore.getState().nodes[ID][nodeId].longName).toBe('Bob');
    expect(window.electronAPI.db.updateMeshcoreContactAdvert).toHaveBeenCalledWith(
      nodeId,
      1_700_000_000,
      null,
      null,
      'Bob',
    );
    expect(window.electronAPI.db.saveMeshcoreContact).not.toHaveBeenCalled();
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

/** FLOOD + GRP_TXT: path hashes 0x88, 0x07 (see meshcoreRfPacketParse.test.ts). */
const FLOOD_GRP_TXT_HEX =
  '15028807111337a709eb7f50a1a94d8ee7e5ded8672cef2660e88c976c9782bf520ae1bf08b564ccd2c1afb5960e211a671a1282587e5836d0e80d46879a9069f08465733f5c79';
/** Same flood with path_len=0 so heard-repeat skips path resolution. */
const FLOOD_GRP_TXT_EMPTY_PATH_HEX = `1500${FLOOD_GRP_TXT_HEX.slice(8)}`;

function hexToU8(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('handleMeshcoreRfRx heard-repeat coverage', () => {
  const MSG = 'ch:0:heard-repeat';
  /** Node ids whose 1-byte meshcoreNodeHash matches path bytes 0x88 / 0x07. */
  const REPEATER_88 = 0x88;
  const CHAT_07 = 0x07;

  beforeEach(() => {
    useRelayCoverageStore.setState({ coverage: {} });
    resetHeardRepeatWindowsForTests();
  });

  afterEach(() => {
    useNodeStore.setState({ nodes: {} });
    setMeshtasticConnectedMyNodeNum(0);
    resetHeardRepeatWindowsForTests();
    useRelayCoverageStore.setState({ coverage: {} });
    vi.restoreAllMocks();
  });

  it('credits Repeater path hashes on GRP_TXT flood overhear without cleartext originator', () => {
    const nodes = new Map<number, MeshNode>([
      [REPEATER_88, makeNode(REPEATER_88, { hw_model: 'Repeater', long_name: 'Hill 88' })],
      [CHAT_07, makeNode(CHAT_07, { hw_model: 'Chat', long_name: 'Chat 07' })],
    ]);
    const { deps } = makeDeps({
      myNodeNumRef: ref(1),
      readNodes: () => nodes,
      selfInfoRef: ref({ name: 'Me', publicKey: new Uint8Array(32).fill(9) } as MeshCoreSelfInfo),
    });
    openHeardRepeatWindow(ID, MSG);

    // Realistic flood path: forwarders only (0x88 repeater, 0x07 chat) — originator is never in path.
    handleMeshcoreRfRx({ lastSnr: 6, lastRssi: -50, raw: hexToU8(FLOOD_GRP_TXT_HEX) }, deps);

    expect(useRelayCoverageStore.getState().coverageFor(ID, MSG)?.heardRepeaters).toEqual([
      { nodeId: REPEATER_88, name: 'Hill 88', snr: 6, rssi: -50 },
    ]);
  });

  it('does not credit Chat path hops; unresolved forwarder hashes still count', () => {
    const nodes = new Map<number, MeshNode>([
      [CHAT_07, makeNode(CHAT_07, { hw_model: 'Chat', long_name: 'Chat 07' })],
    ]);
    const { deps } = makeDeps({
      myNodeNumRef: ref(1),
      readNodes: () => nodes,
      selfInfoRef: ref({ name: 'Me', publicKey: new Uint8Array(32).fill(9) } as MeshCoreSelfInfo),
    });
    openHeardRepeatWindow(ID, MSG);

    handleMeshcoreRfRx({ lastSnr: 6, lastRssi: -50, raw: hexToU8(FLOOD_GRP_TXT_HEX) }, deps);

    const heard = useRelayCoverageStore.getState().coverageFor(ID, MSG)?.heardRepeaters ?? [];
    // Path 0x88 (unknown forwarder) → hex credit; 0x07 (Chat) → ignored.
    expect(heard).toHaveLength(1);
    expect(heard[0]?.name).toBe('88');
    expect(heard.some((r) => r.nodeId === CHAT_07)).toBe(false);
  });

  it('does not credit GRP_TXT path hashes when no listen window is open', () => {
    const pathSpy = vi.spyOn(meshcorePathChainDisplay, 'buildMeshcorePathResolutionFromNodes');
    const nodes = new Map<number, MeshNode>([
      [REPEATER_88, makeNode(REPEATER_88, { hw_model: 'Repeater', long_name: 'Hill 88' })],
    ]);
    const { deps } = makeDeps({
      myNodeNumRef: ref(1),
      readNodes: () => nodes,
    });

    handleMeshcoreRfRx({ lastSnr: 6, lastRssi: -50, raw: hexToU8(FLOOD_GRP_TXT_HEX) }, deps);

    expect(useRelayCoverageStore.getState().coverageFor(ID, MSG)).toBeUndefined();
    expect(pathSpy).not.toHaveBeenCalled();
  });

  it('skips path resolution when GRP_TXT path is empty even with an open window', () => {
    const pathSpy = vi.spyOn(meshcorePathChainDisplay, 'buildMeshcorePathResolutionFromNodes');
    const nodes = new Map<number, MeshNode>([
      [REPEATER_88, makeNode(REPEATER_88, { hw_model: 'Repeater', long_name: 'Hill 88' })],
    ]);
    const { deps } = makeDeps({
      myNodeNumRef: ref(1),
      readNodes: () => nodes,
    });
    openHeardRepeatWindow(ID, MSG);

    handleMeshcoreRfRx(
      { lastSnr: 6, lastRssi: -50, raw: hexToU8(FLOOD_GRP_TXT_EMPTY_PATH_HEX) },
      deps,
    );

    expect(useRelayCoverageStore.getState().coverageFor(ID, MSG)?.heardRepeaters).toEqual([]);
    expect(pathSpy).not.toHaveBeenCalled();
  });

  it('does not treat FLOOD ADVERT as channel-flood credit without self-origin', () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => (i + 11) & 0xff);
    const advertId = pubkeyToNodeId(publicKey);
    const nodes = new Map<number, MeshNode>([
      [advertId, makeNode(advertId, { hw_model: 'Repeater', long_name: 'AdvertRep' })],
    ]);
    const { deps } = makeDeps({
      myNodeNumRef: ref(1),
      readNodes: () => nodes,
      selfInfoRef: ref({
        name: 'Me',
        publicKey: new Uint8Array(32).fill(0xaa),
      } as MeshCoreSelfInfo),
    });
    openHeardRepeatWindow(ID, MSG);

    handleMeshcoreRfRx(
      {
        lastSnr: 4,
        lastRssi: -40,
        raw: buildFloodAdvertPacket({ publicKey, name: 'Other', deviceRole: 2 }),
      },
      deps,
    );

    expect(useRelayCoverageStore.getState().coverageFor(ID, MSG)?.heardRepeaters).toEqual([]);
  });

  it('credits 2-byte path hashes via pubKeyMapRef when MeshNode omits public_key_hex', () => {
    // Mirrors production: contacts live in pubKeyMapRef; MeshNode often has no public_key_hex.
    const repPub = new Uint8Array(32);
    repPub[0] = 0x06;
    repPub[1] = 0x47;
    const repId = 0x0647abcd;
    const nodes = new Map<number, MeshNode>([
      [repId, makeNode(repId, { hw_model: 'Repeater', long_name: 'FNL-0647' })],
    ]);
    const pubKeyMap = new Map<number, Uint8Array>([[repId, repPub]]);
    // FLOOD GRP_TXT, path_len=0x41 → 1 hop × 2-byte hash, path=06 47
    const raw = hexToU8(`15410647${FLOOD_GRP_TXT_HEX.slice(8)}`);
    const { deps } = makeDeps({
      myNodeNumRef: ref(1),
      readNodes: () => nodes,
      pubKeyMapRef: ref(pubKeyMap),
      selfInfoRef: ref({ name: 'Me', publicKey: new Uint8Array(32).fill(9) } as MeshCoreSelfInfo),
    });
    openHeardRepeatWindow(ID, MSG);

    handleMeshcoreRfRx({ lastSnr: 7, lastRssi: -60, raw }, deps);

    expect(useRelayCoverageStore.getState().coverageFor(ID, MSG)?.heardRepeaters).toEqual([
      { nodeId: repId, name: 'FNL-0647', snr: 7, rssi: -60 },
    ]);
  });
});
