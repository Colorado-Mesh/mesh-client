import { Portnums } from '@meshtastic/protobufs';
import { describe, expect, it } from 'vitest';

import { meshtasticProtocol } from './MeshtasticProtocol';
import type { DomainEvent } from './Protocol';

function mockMeshDevice() {
  const subs = new Map<string, (payload: unknown) => void>();
  const subscribe = (name: string) => ({
    subscribe: (fn: (payload: unknown) => void) => {
      subs.set(name, fn);
      return () => subs.delete(name);
    },
  });
  return {
    device: {
      events: new Proxy(
        {},
        {
          get: (_target, prop) => {
            if (typeof prop !== 'string') return undefined;
            return subscribe(prop);
          },
        },
      ),
    },
    emit: (name: string, payload: unknown) => subs.get(name)?.(payload),
  };
}

describe('MeshtasticProtocol.subscribe', () => {
  it('emits text_message for decoded TEXT_MESSAGE_APP port', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (e) => events.push(e));
    emit('onMeshPacket', {
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
          payload: new TextEncoder().encode('ping'),
        },
      },
      from: 0xabcd,
      to: 0xffffffff,
      id: 77,
      channel: 1,
      rxTime: 1_700_000_000,
      rxSnr: 5,
      rxRssi: -90,
    });
    const text = events.find((e) => e.type === 'text_message');
    expect(text).toMatchObject({
      type: 'text_message',
      payload: {
        id: '77',
        from: 0xabcd,
        payload: 'ping',
        channelIndex: 1,
        rxSnr: 5,
        rxRssi: -90,
      },
    });
    teardown();
  });

  it('computes hopCount from hopStart/hopLimit on RF text', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (e) => events.push(e));
    emit('onMeshPacket', {
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
          payload: new TextEncoder().encode('hop'),
        },
      },
      from: 1,
      to: 0xffffffff,
      id: 1,
      hopStart: 7,
      hopLimit: 4,
      viaMqtt: false,
    });
    const text = events.find((e) => e.type === 'text_message');
    expect(text?.type === 'text_message' && text.payload.hopCount).toBe(3);
    teardown();
  });

  it('omits hopCount key for viaMqtt packets and hopStart zero', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (e) => events.push(e));
    emit('onMeshPacket', {
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
          payload: new TextEncoder().encode('mqtt'),
        },
      },
      from: 1,
      to: 0xffffffff,
      id: 2,
      hopStart: 7,
      hopLimit: 4,
      viaMqtt: true,
    });
    const mqttText = events.find((e) => e.type === 'text_message');
    expect(mqttText?.type === 'text_message' && mqttText.payload.hopCount).toBeUndefined();
    expect(mqttText?.type === 'text_message' && !('hopCount' in mqttText.payload)).toBe(true);
    events.length = 0;
    emit('onMeshPacket', {
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
          payload: new TextEncoder().encode('zero'),
        },
      },
      from: 1,
      to: 0xffffffff,
      id: 3,
      hopStart: 0,
      hopLimit: 0,
    });
    const zero = events.find((e) => e.type === 'text_message');
    expect(zero?.type === 'text_message' && zero.payload.hopCount).toBeUndefined();
    expect(zero?.type === 'text_message' && !('hopCount' in zero.payload)).toBe(true);
    teardown();
  });

  it('emits node_info from onNodeInfoPacket', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (e) => events.push(e));
    emit('onNodeInfoPacket', {
      num: 4242,
      user: { longName: 'Test Node', shortName: 'TN', hwModel: 1, role: 0 },
      lastHeard: 1_700_000_100,
    });
    expect(events).toContainEqual({
      type: 'node_info',
      payload: expect.objectContaining({
        nodeId: 4242,
        longName: 'Test Node',
        shortName: 'TN',
      }),
    });
    teardown();
  });

  it('emits node_info on onMyNodeInfo when myNodeNum is set', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (e) => events.push(e));
    emit('onMyNodeInfo', { myNodeNum: 99 });
    expect(events).toContainEqual({
      type: 'node_info',
      payload: { nodeId: 99 },
    });
    teardown();
  });
});
