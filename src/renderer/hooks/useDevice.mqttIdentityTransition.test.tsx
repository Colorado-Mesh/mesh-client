import type { MeshDevice } from '@meshtastic/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from '@/renderer/lib/appSettingsStorage';
import {
  MESHTASTIC_LAST_RF_SELF_NODE_ID_KEY,
  resolveMeshtasticOutboundFromNodeId,
} from '@/renderer/lib/meshtasticMqttIdentity';
import { MESHTASTIC_MQTT_SETTINGS_KEY } from '@/renderer/lib/meshtasticMqttSettingsStorage';

import * as connection from '../lib/connection';
import { useDevice } from './useDevice';

vi.mock('../lib/connection', () => ({
  createBleConnection: vi.fn(),
  createConnection: vi.fn(),
  reconnectSerial: vi.fn(),
  safeDisconnect: vi.fn().mockResolvedValue(undefined),
}));

const VIRTUAL_ID = 0x0b2f75f3;
const REAL_ID = 0x88cb6530;
const MQTT_PSK_LINE = 'LongFast@0=AQ==';

type MqttStatusHandler = (args: { status: string; protocol: string }) => void;
type MyNodeInfoHandler = (info: { myNodeNum: number }) => void;

function createStubDevice(
  configure: MeshDevice['configure'],
  onMyNodeInfoSubscribe?: (cb: MyNodeInfoHandler) => void,
): MeshDevice {
  const onMyNodeInfoSub = {
    subscribe: (cb: MyNodeInfoHandler) => {
      onMyNodeInfoSubscribe?.(cb);
      return () => {};
    },
  };
  const events = new Proxy({} as MeshDevice['events'], {
    get: (_target, prop) => {
      if (prop === 'onMyNodeInfo') return onMyNodeInfoSub;
      return { subscribe: () => () => {} };
    },
  });
  return {
    configure,
    events,
    transport: {},
    sendText: vi.fn().mockResolvedValue(9001),
  } as unknown as MeshDevice;
}

describe('useDevice — MQTT-first virtual id handoff', () => {
  let mqttStatusHandler: MqttStatusHandler | undefined;
  let myNodeInfoHandler: MyNodeInfoHandler | undefined;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mqttStatusHandler = undefined;
    myNodeInfoHandler = undefined;
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    localStorage.setItem('mesh-client:mqttVirtualNodeId', String(VIRTUAL_ID));
    localStorage.setItem(
      MESHTASTIC_MQTT_SETTINGS_KEY,
      JSON.stringify({ channelPsks: [MQTT_PSK_LINE] }),
    );

    vi.mocked(window.electronAPI.mqtt.onStatus).mockImplementation((cb) => {
      mqttStatusHandler = cb as MqttStatusHandler;
      return () => {};
    });
    vi.mocked(window.electronAPI.mqtt.onNodeUpdate).mockReturnValue(() => {});
    vi.mocked(window.electronAPI.mqtt.onMessage).mockReturnValue(() => {});
    vi.mocked(window.electronAPI.mqtt.onError).mockReturnValue(() => {});
    vi.mocked(window.electronAPI.mqtt.onWarning).mockReturnValue(() => {});
    vi.mocked(window.electronAPI.mqtt.onTraceRouteReply).mockReturnValue(() => {});
    vi.mocked(window.electronAPI.mqtt.onClientId).mockReturnValue(() => {});
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue({});
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
  });

  it('MQTT connect publishes NodeInfo with virtual from when no last RF', async () => {
    const { result } = renderHook(() => useDevice());

    act(() => {
      mqttStatusHandler?.({ status: 'connected', protocol: 'meshtastic' });
    });

    await waitFor(() => {
      expect(result.current.state.myNodeNum).toBe(VIRTUAL_ID);
    });

    expect(window.electronAPI.mqtt.publishNodeInfo).toHaveBeenCalledWith(
      expect.objectContaining({ from: VIRTUAL_ID }),
    );
    expect(window.electronAPI.db.deleteNode).not.toHaveBeenCalledWith(VIRTUAL_ID);
  });

  it('MQTT connect with persisted last RF uses real id and removes stale virtual node', async () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ [MESHTASTIC_LAST_RF_SELF_NODE_ID_KEY]: String(REAL_ID) }),
    );

    const { result } = renderHook(() => useDevice());

    act(() => {
      mqttStatusHandler?.({ status: 'connected', protocol: 'meshtastic' });
    });

    await waitFor(() => {
      expect(result.current.state.myNodeNum).toBe(REAL_ID);
    });

    expect(window.electronAPI.mqtt.publishNodeInfo).toHaveBeenCalledWith(
      expect.objectContaining({ from: REAL_ID }),
    );
    expect(window.electronAPI.db.deleteNode).toHaveBeenCalledWith(VIRTUAL_ID);
    expect(result.current.virtualNodeId).toBe(VIRTUAL_ID);
    expect(result.current.lastRfSelfNodeId).toBe(REAL_ID);
  });

  it('after device onMyNodeInfo, sendMessage MQTT publish uses real id not virtual', async () => {
    const device = createStubDevice(
      vi.fn().mockImplementation(() => {
        myNodeInfoHandler?.({ myNodeNum: REAL_ID });
        return Promise.resolve();
      }),
      (cb) => {
        myNodeInfoHandler = cb;
      },
    );
    vi.mocked(connection.createConnection).mockResolvedValue(device);

    const { result } = renderHook(() => useDevice());

    act(() => {
      mqttStatusHandler?.({ status: 'connected', protocol: 'meshtastic' });
    });
    await waitFor(() => {
      expect(result.current.state.myNodeNum).toBe(VIRTUAL_ID);
    });

    vi.mocked(window.electronAPI.mqtt.publish).mockClear();
    vi.mocked(window.electronAPI.mqtt.publishNodeInfo).mockClear();

    await act(async () => {
      await result.current.connect('http', 'http://127.0.0.1');
    });

    await waitFor(() => {
      expect(result.current.state.myNodeNum).toBe(REAL_ID);
    });

    expect(window.electronAPI.db.deleteNode).toHaveBeenCalledWith(VIRTUAL_ID);

    vi.mocked(window.electronAPI.mqtt.publish).mockClear();
    act(() => {
      result.current.sendMessage('hello after radio');
    });

    await waitFor(() => {
      expect(window.electronAPI.mqtt.publish).toHaveBeenCalled();
    });

    expect(window.electronAPI.mqtt.publish).toHaveBeenCalledWith(
      expect.objectContaining({ from: REAL_ID }),
    );
    expect(window.electronAPI.mqtt.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ from: VIRTUAL_ID }),
    );

    // Race guard: stale virtual myNodeNum + device must not yield virtual MQTT from
    expect(
      resolveMeshtasticOutboundFromNodeId({
        hasDevice: true,
        myNodeNum: VIRTUAL_ID,
        lastRfSelfNodeId: 0,
        virtualNodeId: VIRTUAL_ID,
      }),
    ).toBe(0);
  });
});
