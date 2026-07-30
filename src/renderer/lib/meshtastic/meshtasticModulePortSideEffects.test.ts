import { afterEach, describe, expect, it, vi } from 'vitest';

import { packetRouter } from '../drivers/PacketRouter';
import {
  attachMeshtasticModulePortSideEffects,
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
});
