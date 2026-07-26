import { afterEach, describe, expect, it, vi } from 'vitest';

import { packetRouter } from '../drivers/PacketRouter';
import { attachMeshtasticModulePortSideEffects } from './meshtasticModulePortSideEffects';

describe('attachMeshtasticModulePortSideEffects', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends audio module payloads into the per-node map', () => {
    const setAudioMessages = vi.fn();
    const touchLastData = vi.fn();
    const noop = vi.fn();
    const detach = attachMeshtasticModulePortSideEffects('id-1', {
      touchLastData,
      setRemoteHardwareMessages: noop,
      setAudioMessages,
      setDetectionSensorEvents: noop,
      setPingResponses: noop,
      setIpTunnelMessages: noop,
      setPaxCounterData: noop,
      setSerialMessages: noop,
      setRangeTestPackets: noop,
      setZpsMessages: noop,
      setSimulatorPackets: noop,
      setAtakMessages: noop,
      setMapReports: noop,
      setPrivateMessages: noop,
    });
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
    expect(touchLastData).toHaveBeenCalled();
    expect(setAudioMessages).toHaveBeenCalled();
    detach();
  });
});
