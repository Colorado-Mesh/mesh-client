import { create, toBinary } from '@bufbuild/protobuf';
import { Mesh } from '@meshtastic/protobufs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { packetRouter } from '../drivers/PacketRouter';
import { encodeMeshBeacon } from './meshBeaconCodec';
import type { HeardMeshBeacon, NodeStatusEntry } from './meshtasticModuleEvents';
import {
  attachMeshtasticModulePortSideEffects,
  decodeNodeStatus,
  type MeshtasticModulePortSideEffectsDeps,
} from './meshtasticModulePortSideEffects';

function makeDeps(): MeshtasticModulePortSideEffectsDeps {
  return {
    touchLastData: vi.fn(),
    setRemoteHardwareMessages: vi.fn(),
    setAudioMessages: vi.fn(),
    setDetectionSensorEvents: vi.fn(),
    setPingResponses: vi.fn(),
    setIpTunnelMessages: vi.fn(),
    setPaxCounterData: vi.fn(),
    setSerialMessages: vi.fn(),
    setRangeTestPackets: vi.fn(),
    setZpsMessages: vi.fn(),
    setSimulatorPackets: vi.fn(),
    setAtakMessages: vi.fn(),
    setMapReports: vi.fn(),
    setPrivateMessages: vi.fn(),
    setMeshBeacons: vi.fn(),
    setNodeStatuses: vi.fn(),
  };
}

describe('attachMeshtasticModulePortSideEffects', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends audio module payloads into the per-node map', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
    packetRouter.dispatch(
      {
        type: 'meshtastic_module_port',
        payload: {
          portLabel: 'audio',
          from: 9,
          data: new Uint8Array([1, 2, 3]),
          timestamp: Date.now(),
        },
      },
      'id-1',
    );
    expect(deps.touchLastData).toHaveBeenCalled();
    expect(deps.setAudioMessages).toHaveBeenCalled();
    detach();
  });

  it.each([
    ['remoteHardware', 'setRemoteHardwareMessages'],
    ['detectionSensor', 'setDetectionSensorEvents'],
    ['ping', 'setPingResponses'],
    ['ipTunnel', 'setIpTunnelMessages'],
    ['paxcounter', 'setPaxCounterData'],
    ['serial', 'setSerialMessages'],
    ['rangeTest', 'setRangeTestPackets'],
    ['zps', 'setZpsMessages'],
    ['simulator', 'setSimulatorPackets'],
    ['atakPlugin', 'setAtakMessages'],
    ['atakForwarder', 'setAtakMessages'],
    ['mapReport', 'setMapReports'],
    ['private', 'setPrivateMessages'],
  ] as const)('routes %s payloads to %s', (portLabel, setter) => {
    const deps = makeDeps();
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
    packetRouter.dispatch(
      {
        type: 'meshtastic_module_port',
        payload: {
          portLabel,
          from: 9,
          data: portLabel === 'paxcounter' ? { wifi: 3, ble: 2 } : new Uint8Array([1]),
          timestamp: Date.now(),
        },
      },
      'id-1',
    );

    expect(deps[setter]).toHaveBeenCalledOnce();
    detach();
  });

  it('totals paxcounter wifi and ble device counts', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
    let history = new Map<number, { from: number; count: number; timestamp: number }[]>();
    deps.setPaxCounterData = vi.fn((updater) => {
      history = typeof updater === 'function' ? updater(history) : updater;
    });

    packetRouter.dispatch(
      {
        type: 'meshtastic_module_port',
        payload: {
          portLabel: 'paxcounter',
          from: 9,
          data: { wifi: 3, ble: 2, uptime: 900 },
          timestamp: 1000,
        },
      },
      'id-1',
    );

    expect(history.get(9)?.at(-1)?.count).toBe(5);
    detach();
  });

  it('prefers an explicit paxcounter count and floors malformed values at zero', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
    let history = new Map<number, { from: number; count: number; timestamp: number }[]>();
    deps.setPaxCounterData = vi.fn((updater) => {
      history = typeof updater === 'function' ? updater(history) : updater;
    });

    packetRouter.dispatch(
      {
        type: 'meshtastic_module_port',
        payload: { portLabel: 'paxcounter', from: 9, data: { count: 12 }, timestamp: 1000 },
      },
      'id-1',
    );
    expect(history.get(9)?.at(-1)?.count).toBe(12);

    packetRouter.dispatch(
      {
        type: 'meshtastic_module_port',
        payload: {
          portLabel: 'paxcounter',
          from: 9,
          data: { wifi: Number.NaN, ble: undefined },
          timestamp: 2000,
        },
      },
      'id-1',
    );
    expect(history.get(9)?.at(-1)?.count).toBe(0);
    detach();
  });

  it('caps the per-node raw payload ring at its retention limit', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
    let audio = new Map<number, { from: number; data: Uint8Array; timestamp: number }[]>();
    deps.setAudioMessages = vi.fn((updater) => {
      audio = typeof updater === 'function' ? updater(audio) : updater;
    });

    for (let i = 0; i < 60; i++) {
      packetRouter.dispatch(
        {
          type: 'meshtastic_module_port',
          payload: {
            portLabel: 'audio',
            from: 9,
            data: new Uint8Array([i]),
            timestamp: i,
          },
        },
        'id-1',
      );
    }

    const entries = audio.get(9) ?? [];
    expect(entries).toHaveLength(50);
    expect(entries.at(-1)?.timestamp).toBe(59);
    detach();
  });

  it('ignores unknown module labels after touching liveness', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
    packetRouter.dispatch(
      {
        type: 'meshtastic_module_port',
        payload: {
          portLabel: 'future-module',
          from: 9,
          data: new Uint8Array([1]),
          timestamp: Date.now(),
        },
      },
      'id-1',
    );
    expect(deps.touchLastData).toHaveBeenCalledOnce();
    expect(deps.setAudioMessages).not.toHaveBeenCalled();
    detach();
  });

  function dispatchPort(portLabel: string, from: number, data: Uint8Array, timestamp = 1000) {
    packetRouter.dispatch(
      { type: 'meshtastic_module_port', payload: { portLabel, from, data, timestamp } },
      'id-1',
    );
  }

  it('decodes MeshBeacon payloads into the latest-per-node map', () => {
    const deps = makeDeps();
    let beacons = new Map<number, HeardMeshBeacon>();
    deps.setMeshBeacons = vi.fn((updater) => {
      beacons = typeof updater === 'function' ? updater(beacons) : updater;
    });
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);

    dispatchPort('meshBeacon', 5, encodeMeshBeacon({ message: 'first' }), 1);
    dispatchPort(
      'meshBeacon',
      5,
      encodeMeshBeacon({ message: 'second', offerPreset: 3, offerRegion: 1 }),
      2,
    );

    expect(beacons.size).toBe(1);
    expect(beacons.get(5)).toMatchObject({
      from: 5,
      message: 'second',
      offerPreset: 3,
      offerRegion: 1,
      timestamp: 2,
    });
    detach();
  });

  it('drops malformed MeshBeacon payloads', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const deps = makeDeps();
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
    dispatchPort('meshBeacon', 5, new Uint8Array([0x0a, 0xff, 0xff]));
    expect(deps.setMeshBeacons).not.toHaveBeenCalled();
    detach();
  });

  it('stores node status strings and clears them when emptied', () => {
    const deps = makeDeps();
    let statuses = new Map<number, NodeStatusEntry>();
    deps.setNodeStatuses = vi.fn((updater) => {
      statuses = typeof updater === 'function' ? updater(statuses) : updater;
    });
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
    const encode = (status: string) =>
      toBinary(Mesh.StatusMessageSchema, create(Mesh.StatusMessageSchema, { status }));

    dispatchPort('nodeStatus', 8, encode('On patrol'), 10);
    expect(statuses.get(8)).toEqual({ from: 8, status: 'On patrol', timestamp: 10 });

    dispatchPort('nodeStatus', 8, encode(''), 11);
    expect(statuses.has(8)).toBe(false);
    detach();
  });

  it('decodeNodeStatus returns null for malformed bytes', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(decodeNodeStatus(new Uint8Array([0x0a, 0xff]))).toBeNull();
  });

  it.each(['paging', 'storeForwardPlusPlus', 'loraOta', 'groupAlarm'])(
    'accepts label-only port %s without side effects',
    (portLabel) => {
      const deps = makeDeps();
      const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
      dispatchPort(portLabel, 1, new Uint8Array([1]));
      expect(deps.touchLastData).toHaveBeenCalledOnce();
      expect(deps.setMeshBeacons).not.toHaveBeenCalled();
      expect(deps.setNodeStatuses).not.toHaveBeenCalled();
      detach();
    },
  );
});
