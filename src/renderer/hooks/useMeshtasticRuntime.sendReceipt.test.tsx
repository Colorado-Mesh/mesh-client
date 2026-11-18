import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nextChatReceivedAt, resetChatReceiptClockForTests } from '@/renderer/lib/chatReceiveOrder';
import { MESHTASTIC_MQTT_SECRET_KEY, setSecureSecret } from '@/renderer/lib/secureSecretStorage';

import { useMeshtasticRuntime } from '../runtime/useMeshtasticRuntime';
import { resetMeshtasticMqttElectronMocks } from '../vitestClearHelpers';

vi.mock('../lib/connection', () => ({
  createBleConnection: vi.fn(),
  createConnection: vi.fn(),
  reconnectSerial: vi.fn(),
  safeDisconnect: vi.fn().mockResolvedValue(undefined),
}));

const VIRTUAL_ID = 0x0b2f75f3;
/** Valid 16-byte AES-128 manual PSK line for MQTT-only publish in tests. */
const MQTT_PSK_LINE = 'LongFast@0=AAAAAAAAAAAAAAAAAAAAAA==';
const HOUR = 3_600_000;

type MqttStatusHandler = (args: { status: string; protocol: string }) => void;

describe('useMeshtasticRuntime own sends save their receipt', () => {
  let mqttStatusHandler: MqttStatusHandler | undefined;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    resetMeshtasticMqttElectronMocks();
    localStorage.clear();
    mqttStatusHandler = undefined;
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    localStorage.setItem('mesh-client:mqttVirtualNodeId', String(VIRTUAL_ID));
    await setSecureSecret(
      MESHTASTIC_MQTT_SECRET_KEY,
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
    vi.mocked(window.electronAPI.db.saveMessage).mockClear();
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
    resetChatReceiptClockForTests();
  });

  it('saves a sent line with the receipt the live row holds', async () => {
    const { result } = renderHook(() => useMeshtasticRuntime());
    act(() => {
      mqttStatusHandler?.({ status: 'connected', protocol: 'meshtastic' });
    });
    await waitFor(() => {
      expect(result.current.state.myNodeNum).toBe(VIRTUAL_ID);
    });

    // Receipts run ahead of the wall clock after a set-back (or a same-millisecond backlog), so
    // a saved stamp of Date.now() would not hold the place the live row has.
    nextChatReceivedAt(Date.now() + HOUR);
    act(() => {
      result.current.sendMessage('receipt over mqtt');
    });

    await waitFor(() => {
      expect(window.electronAPI.db.saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: 'receipt over mqtt' }),
      );
    });
    const saved = vi
      .mocked(window.electronAPI.db.saveMessage)
      .mock.calls.map(([row]) => row)
      .find((row) => row.payload === 'receipt over mqtt');
    const live = result.current.messages.find((m) => m.payload === 'receipt over mqtt');
    expect(live?.receivedAt).toBeGreaterThan(Date.now());
    expect(saved?.receivedAt).toBe(live?.receivedAt);
  });
});
