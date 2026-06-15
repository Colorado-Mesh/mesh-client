import { create, fromBinary } from '@bufbuild/protobuf';
import { Mesh } from '@meshtastic/protobufs';
import { describe, expect, it, vi } from 'vitest';

import {
  buildToRadioMqttClientProxyBytes,
  type FromRadioMqttProxyCarrier,
  MeshtasticMqttClientProxyBridge,
  parseMqttClientProxyFromFromRadio,
} from './meshtasticMqttClientProxy';

describe('meshtasticMqttClientProxy', () => {
  it('parses FromRadio mqtt_client_proxy_message with data payload', () => {
    const proxy = create(Mesh.MqttClientProxyMessageSchema, {
      topic: 'msh/US/2/e/ChannelName/!abcd1234',
      retained: true,
      payloadVariant: { case: 'data', value: new Uint8Array([1, 2, 3]) },
    });
    const fromRadio = create(Mesh.FromRadioSchema, {
      payloadVariant: { case: 'mqttClientProxyMessage', value: proxy },
    });
    const parsed = parseMqttClientProxyFromFromRadio(
      fromRadio as unknown as FromRadioMqttProxyCarrier,
    );
    expect(parsed).toEqual({
      topic: 'msh/US/2/e/ChannelName/!abcd1234',
      retained: true,
      payloadVariant: { case: 'data', value: new Uint8Array([1, 2, 3]) },
    });
  });

  it('encodes broker downlink as ToRadio mqtt_client_proxy_message', () => {
    const bytes = buildToRadioMqttClientProxyBytes({
      topic: 'msh/US/2/e/LongFast/!abcd1234',
      retained: false,
      payloadVariant: { case: 'data', value: new Uint8Array([0xde, 0xad]) },
    });
    const decoded = fromBinary(Mesh.ToRadioSchema, bytes) as unknown as {
      payloadVariant: {
        case: 'mqttClientProxyMessage';
        value: {
          topic: string;
          retained: boolean;
          payloadVariant: { case: string };
        };
      };
    };
    expect(decoded.payloadVariant.case).toBe('mqttClientProxyMessage');
    if (decoded.payloadVariant.case !== 'mqttClientProxyMessage') return;
    expect(decoded.payloadVariant.value.topic).toBe('msh/US/2/e/LongFast/!abcd1234');
    expect(decoded.payloadVariant.value.retained).toBe(false);
    expect(decoded.payloadVariant.value.payloadVariant.case).toBe('data');
  });

  it('forwards device publish request to broker', async () => {
    const publishToBroker = vi.fn().mockResolvedValue(undefined);
    const bridge = new MeshtasticMqttClientProxyBridge({
      isProxyActive: () => true,
      isDeviceConfigured: () => true,
      publishToBroker,
      writeToRadio: vi.fn(),
    });
    const proxy = create(Mesh.MqttClientProxyMessageSchema, {
      topic: 'msh/test',
      retained: false,
      payloadVariant: { case: 'text', value: 'hello' },
    });
    const fromRadio = create(Mesh.FromRadioSchema, {
      payloadVariant: { case: 'mqttClientProxyMessage', value: proxy },
    });
    await bridge.handleFromRadio(fromRadio as unknown as FromRadioMqttProxyCarrier);
    expect(publishToBroker).toHaveBeenCalledWith({
      topic: 'msh/test',
      text: 'hello',
      retained: false,
    });
  });

  it('buffers ToRadio proxy until device configured, then flushes', async () => {
    let configured = false;
    const writeToRadio = vi.fn().mockResolvedValue(undefined);
    const bridge = new MeshtasticMqttClientProxyBridge({
      isProxyActive: () => true,
      isDeviceConfigured: () => configured,
      publishToBroker: vi.fn(),
      writeToRadio,
    });
    await bridge.handleBrokerRaw('msh/down', new Uint8Array([9]), true);
    expect(writeToRadio).not.toHaveBeenCalled();

    configured = true;
    bridge.flushPendingToDevice();
    expect(writeToRadio).toHaveBeenCalledTimes(1);
    const sent = writeToRadio.mock.calls[0][0] as Uint8Array;
    const decoded = fromBinary(Mesh.ToRadioSchema, sent) as unknown as {
      payloadVariant: { case: string };
    };
    expect(decoded.payloadVariant.case).toBe('mqttClientProxyMessage');
  });

  it('sends broker raw to device when already configured', async () => {
    const writeToRadio = vi.fn().mockResolvedValue(undefined);
    const bridge = new MeshtasticMqttClientProxyBridge({
      isProxyActive: () => true,
      isDeviceConfigured: () => true,
      publishToBroker: vi.fn(),
      writeToRadio,
    });
    await bridge.handleBrokerRaw('msh/in', new Uint8Array([4, 5]), false);
    expect(writeToRadio).toHaveBeenCalledTimes(1);
  });

  it('ignores traffic when proxy inactive', async () => {
    const publishToBroker = vi.fn();
    const writeToRadio = vi.fn();
    const bridge = new MeshtasticMqttClientProxyBridge({
      isProxyActive: () => false,
      isDeviceConfigured: () => true,
      publishToBroker,
      writeToRadio,
    });
    const proxy = create(Mesh.MqttClientProxyMessageSchema, {
      topic: 'msh/test',
      payloadVariant: { case: 'data', value: new Uint8Array([1]) },
    });
    const fromRadio = create(Mesh.FromRadioSchema, {
      payloadVariant: { case: 'mqttClientProxyMessage', value: proxy },
    });
    await bridge.handleFromRadio(fromRadio as unknown as FromRadioMqttProxyCarrier);
    await bridge.handleBrokerRaw('msh/in', new Uint8Array([1]), false);
    expect(publishToBroker).not.toHaveBeenCalled();
    expect(writeToRadio).not.toHaveBeenCalled();
  });
});
