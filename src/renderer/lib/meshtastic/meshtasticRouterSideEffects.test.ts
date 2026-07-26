// @vitest-environment jsdom
vi.mock('@/renderer/lib/i18n', () => ({
  default: {
    t: (key: string, opts?: { sender?: string }) => {
      if (key === 'chatPanel.notificationDmTitle') return `DM from ${opts?.sender ?? ''}`;
      if (key === 'chatPanel.notificationMessageTitle') return `Message from ${opts?.sender ?? ''}`;
      return key;
    },
  },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { packetRouter } from '../drivers/PacketRouter';
import {
  attachMeshtasticRouterSideEffects,
  type MeshtasticRouterSideEffectsDeps,
} from './meshtasticRouterSideEffects';

vi.mock('../meshtasticMqttPublish', () => ({
  loadMeshtasticMqttManualChannelPsks: () => [],
  resolveMeshtasticMqttPublishFieldsForChannel: () => ({
    channelName: 'LongFast',
    pskBase64: 'AQ==',
    publishJsonMirror: false,
  }),
}));

describe('attachMeshtasticRouterSideEffects', () => {
  beforeEach(() => {
    window.electronAPI = {
      mqtt: { publish: vi.fn().mockResolvedValue(1) },
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests NodeInfo and uplinks broadcast text when MQTT uplink is enabled', () => {
    const publish = window.electronAPI.mqtt.publish as ReturnType<typeof vi.fn>;
    const requestNodeInfoForNode = vi.fn();
    const deps: MeshtasticRouterSideEffectsDeps = {
      getMyNodeNum: () => 1,
      getMqttStatus: () => 'connected',
      getChannelConfigs: () => [
        {
          index: 0,
          name: 'LongFast',
          role: 1,
          psk: new Uint8Array(16),
          uplinkEnabled: true,
          downlinkEnabled: true,
          positionPrecision: 0,
        },
      ],
      hasRfDevice: () => true,
      getNodeName: () => 'Self',
      registerMqttEchoPacketId: vi.fn(),
      requestNodeInfoForNode,
      applyForeignLoraFromLog: vi.fn(),
      applyRoutingErrorFromLog: vi.fn(),
      setFirmwareVersion: vi.fn(),
    };
    const detach = attachMeshtasticRouterSideEffects('mesh-id', deps);
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: '7:1',
          from: 7,
          to: 0xffffffff,
          payload: 'hello mqtt',
          channelIndex: 0,
          timestamp: Date.now(),
        },
      },
      'mesh-id',
    );
    expect(requestNodeInfoForNode).toHaveBeenCalledWith(7);
    expect(publish).toHaveBeenCalled();
    detach();
  });

  it('forwards device_log lines to foreign LoRa and routing-error helpers', () => {
    const applyForeignLoraFromLog = vi.fn();
    const applyRoutingErrorFromLog = vi.fn();
    const deps: MeshtasticRouterSideEffectsDeps = {
      getMyNodeNum: () => 1,
      getMqttStatus: () => 'disconnected',
      getChannelConfigs: () => [],
      hasRfDevice: () => true,
      getNodeName: () => 'Self',
      registerMqttEchoPacketId: vi.fn(),
      requestNodeInfoForNode: vi.fn(),
      applyForeignLoraFromLog,
      applyRoutingErrorFromLog,
      setFirmwareVersion: vi.fn(),
    };
    const detach = attachMeshtasticRouterSideEffects('mesh-id', deps);
    packetRouter.dispatch(
      {
        type: 'device_log',
        payload: {
          message: 'Error received for packet 9: TIMEOUT',
          time: Date.now(),
          source: 'radio',
          level: 0,
        },
      },
      'mesh-id',
    );
    expect(applyRoutingErrorFromLog).toHaveBeenCalled();
    expect(applyForeignLoraFromLog).toHaveBeenCalled();
    detach();
  });

  it('uses i18n for hidden-window notification titles', () => {
    const NotificationMock = vi.fn();
    vi.stubGlobal('Notification', NotificationMock);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });

    const deps: MeshtasticRouterSideEffectsDeps = {
      getMyNodeNum: () => 1,
      getMqttStatus: () => 'disconnected',
      getChannelConfigs: () => [],
      hasRfDevice: () => true,
      getNodeName: () => 'Alpha',
      registerMqttEchoPacketId: vi.fn(),
      requestNodeInfoForNode: vi.fn(),
      applyForeignLoraFromLog: vi.fn(),
      applyRoutingErrorFromLog: vi.fn(),
      setFirmwareVersion: vi.fn(),
    };
    const detach = attachMeshtasticRouterSideEffects('mesh-id', deps);
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: '7:2',
          from: 7,
          to: 1,
          payload: 'secret dm',
          channelIndex: 0,
          timestamp: Date.now(),
        },
      },
      'mesh-id',
    );
    expect(NotificationMock).toHaveBeenCalledWith('DM from Alpha', {
      body: 'secret dm',
      silent: true,
    });

    NotificationMock.mockClear();
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: '7:3',
          from: 7,
          to: 0xffffffff,
          payload: 'hello channel',
          channelIndex: 0,
          timestamp: Date.now(),
        },
      },
      'mesh-id',
    );
    expect(NotificationMock).toHaveBeenCalledWith('Message from Alpha', {
      body: 'hello channel',
      silent: true,
    });
    detach();
  });
});
