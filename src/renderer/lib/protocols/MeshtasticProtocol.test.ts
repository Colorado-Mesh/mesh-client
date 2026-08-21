import { create, toBinary } from '@bufbuild/protobuf';
import { Mesh, Portnums } from '@meshtastic/protobufs';
import { describe, expect, it, vi } from 'vitest';

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

  it('emits live UserPacket identity through node_info', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (event) => events.push(event));

    emit('onUserPacket', {
      from: 0x1234,
      rxTime: 1_700_000_100,
      data: {
        longName: 'Live Node',
        shortName: 'LIVE',
        role: 2,
        publicKey: new Uint8Array(32).fill(7),
      },
    });

    expect(events).toContainEqual({
      type: 'node_info',
      payload: expect.objectContaining({
        nodeId: 0x1234,
        longName: 'Live Node',
        shortName: 'LIVE',
        role: 2,
        fromUserPacket: true,
      }),
    });
    teardown();
  });

  it('emits Store & Forward and module-port events with normalized metadata', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (event) => events.push(event));
    const bytes = Uint8Array.from([1, 2, 3]);

    emit('onStoreForwardPacket', { from: 42, channel: 3, data: bytes });
    emit('onAudioPacket', { from: 42, channel: 3, data: bytes });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'meshtastic_store_forward',
          payload: expect.objectContaining({ from: 42, channel: 3 }),
        }),
        expect.objectContaining({
          type: 'meshtastic_module_port',
          payload: expect.objectContaining({
            portLabel: 'audio',
            from: 42,
            channel: 3,
            data: bytes,
          }),
        }),
      ]),
    );
    teardown();
  });

  it('rejects malformed sender numbers before emitting text', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (event) => events.push(event));

    emit('onMeshPacket', {
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
          payload: new TextEncoder().encode('bad sender'),
        },
      },
      from: -1,
      to: 0xffffffff,
      id: 9,
    });

    expect(events.some((event) => event.type === 'text_message')).toBe(false);
    teardown();
  });

  it('emits one trace_route per packet id when the SDK double-dispatches', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (event) => events.push(event));
    const routeDiscovery = toBinary(
      Mesh.RouteDiscoverySchema,
      create(Mesh.RouteDiscoverySchema, { route: [11, 22] }),
    );

    // The SDK dispatches onMeshPacket for every packet and then the typed
    // onTraceRoutePacket for the same wire packet.
    emit('onMeshPacket', {
      payloadVariant: {
        case: 'decoded',
        value: { portnum: Portnums.PortNum.TRACEROUTE_APP, payload: routeDiscovery, dest: 555 },
      },
      from: 1,
      to: 2,
      id: 4242,
    });
    emit('onTraceRoutePacket', { id: 4242, from: 1, to: 2, data: { route: [11, 22] } });

    const traces = events.filter((event) => event.type === 'trace_route');
    expect(traces).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
    expect(traces[0]?.type === 'trace_route' && traces[0].payload.dataLayerDest).toBe(555);
    teardown();
  });

  it('still emits traceroutes for distinct packet ids and for id 0', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (event) => events.push(event));

    emit('onTraceRoutePacket', { id: 1, from: 1, to: 2, data: { route: [3] } });
    emit('onTraceRoutePacket', { id: 2, from: 1, to: 2, data: { route: [3] } });
    emit('onTraceRoutePacket', { id: 0, from: 1, to: 2, data: { route: [3] } });
    emit('onTraceRoutePacket', { id: 0, from: 1, to: 2, data: { route: [3] } });

    expect(events.filter((event) => event.type === 'trace_route')).toHaveLength(4);
    teardown();
  });

  it('caps an implausibly long route and drops non-numeric hops', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (event) => events.push(event));

    emit('onTraceRoutePacket', {
      id: 5,
      from: 1,
      to: 2,
      data: { route: [...Array.from({ length: 100 }, (_, i) => i + 1), Number.NaN] },
    });

    const trace = events.find((event) => event.type === 'trace_route');
    expect(trace?.type === 'trace_route' && trace.payload.route).toHaveLength(32);
    teardown();
  });

  it('drops malformed UTF-8 text payloads', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (event) => events.push(event));
    emit('onMeshPacket', {
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
          payload: Uint8Array.from([0xc3, 0x28]),
        },
      },
      from: 1,
      to: 0xffffffff,
      id: 9,
    });
    expect(events.some((event) => event.type === 'text_message')).toBe(false);
    teardown();
  });
});

describe('MeshtasticProtocol outbound guards', () => {
  it('rejects unavailable handles before calling device APIs', async () => {
    await expect(
      meshtasticProtocol.sendMessage(null, { text: 'hello', channelIndex: 0 }),
    ).rejects.toThrow('device handle is unavailable');
    await expect(meshtasticProtocol.setConfig(undefined, {})).rejects.toThrow(
      'device handle is unavailable',
    );
    await expect(meshtasticProtocol.setModuleConfig(null, {})).rejects.toThrow(
      'device handle is unavailable',
    );
  });

  it('rejects invalid coordinates and oversized outbound text', async () => {
    const device = {
      sendText: vi.fn(),
      setPosition: vi.fn(),
    };
    await expect(
      meshtasticProtocol.sendPosition(device, { latitude: Number.NaN, longitude: 1 }),
    ).rejects.toThrow('finite');
    await expect(
      meshtasticProtocol.sendPosition(device, { latitude: 91, longitude: 1 }),
    ).rejects.toThrow('out of range');
    await expect(
      meshtasticProtocol.sendMessage(device, { text: 'x'.repeat(1025), channelIndex: 0 }),
    ).rejects.toThrow('1-1024');
    expect(device.sendText).not.toHaveBeenCalled();
    expect(device.setPosition).not.toHaveBeenCalled();
  });
});

describe('MeshtasticProtocol position outbound guards', () => {
  function positionDevice() {
    const calls: unknown[] = [];
    return {
      calls,
      device: {
        setPosition: (position: unknown) => {
          calls.push(position);
          return Promise.resolve();
        },
      },
    };
  }

  it('sendPosition and sendPositionToDevice build the same protobuf position', async () => {
    const viaOptions = positionDevice();
    const viaArgs = positionDevice();

    await meshtasticProtocol.sendPosition(viaOptions.device, {
      latitude: 39.7392,
      longitude: -104.9903,
      altitude: 1609,
    });
    await meshtasticProtocol.sendPositionToDevice(viaArgs.device, 39.7392, -104.9903, 1609);

    const [first] = viaOptions.calls as { latitudeI: number; longitudeI: number }[];
    const [second] = viaArgs.calls as { latitudeI: number; longitudeI: number }[];
    expect(first.latitudeI).toBe(second.latitudeI);
    expect(first.longitudeI).toBe(second.longitudeI);
    expect(first.latitudeI).toBe(Math.round(39.7392 * 1e7));
  });

  it('rejects non-finite and out-of-range coordinates', async () => {
    const { device, calls } = positionDevice();
    await expect(
      meshtasticProtocol.sendPosition(device, { latitude: Number.NaN, longitude: 0 }),
    ).rejects.toThrow(TypeError);
    await expect(
      meshtasticProtocol.sendPosition(device, { latitude: 0, longitude: 999 }),
    ).rejects.toThrow(RangeError);
    await expect(
      meshtasticProtocol.sendPositionToDevice(device, 0, Number.POSITIVE_INFINITY),
    ).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

  it('rejects empty text and invalid destinations before calling the SDK', async () => {
    const sent: unknown[][] = [];
    const device = {
      sendText: (...args: unknown[]) => {
        sent.push(args);
        return Promise.resolve(1);
      },
    };

    await expect(meshtasticProtocol.sendMessage(device, { text: '' })).rejects.toThrow(TypeError);
    await expect(
      meshtasticProtocol.sendMessage(device, { text: 'hi', destination: Number.NaN }),
    ).rejects.toThrow(TypeError);
    expect(sent).toHaveLength(0);

    await meshtasticProtocol.sendMessage(device, { text: 'hi' });
    expect(sent[0]?.[1]).toBe('broadcast');
  });

  it('rejects traceroute and position requests for invalid node numbers', async () => {
    const device = {
      traceRoute: () => Promise.resolve(),
      requestPosition: () => Promise.resolve(),
    };
    await expect(meshtasticProtocol.sendTraceRoute(device, 0)).rejects.toThrow(TypeError);
    await expect(meshtasticProtocol.requestPosition(device, Number.NaN)).rejects.toThrow(TypeError);
  });
});

/**
 * SDK `@meshtastic/core` PacketMetadata.rxTime is a Date (already ms).
 * Naive `rxTime * 1000` double-converts to ~1e15 and poisons last_heard / export.
 */
describe('MeshtasticProtocol Date-shaped rxTime', () => {
  const RADIO_SEC = 1_787_340_581;
  const EXPECTED_MS = RADIO_SEC * 1000;
  const DOUBLE_CONVERTED = RADIO_SEC * 1_000_000;

  it('maps text_message rxTime Date to epoch ms (not Date×1000)', () => {
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
      channel: 0,
      rxTime: new Date(EXPECTED_MS),
    });
    const text = events.find((e) => e.type === 'text_message');
    expect(text?.type === 'text_message' && text.payload.timestamp).toBe(EXPECTED_MS);
    expect(text?.type === 'text_message' && text.payload.timestamp).not.toBe(DOUBLE_CONVERTED);
    teardown();
  });

  it('maps UserPacket rxTime Date to lastHeardAt epoch ms', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (e) => events.push(e));
    emit('onUserPacket', {
      from: 0x1234,
      rxTime: new Date(EXPECTED_MS),
      data: { longName: 'Live', shortName: 'LV' },
    });
    const info = events.find((e) => e.type === 'node_info');
    expect(info?.type === 'node_info' && info.payload.lastHeardAt).toBe(EXPECTED_MS);
    expect(info?.type === 'node_info' && info.payload.lastHeardAt).not.toBe(DOUBLE_CONVERTED);
    teardown();
  });

  it('maps position and telemetry rxTime Date to epoch ms', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (e) => events.push(e));
    emit('onPositionPacket', {
      from: 42,
      rxTime: new Date(EXPECTED_MS),
      data: { latitudeI: 400_000_000, longitudeI: -1_050_000_000 },
    });
    emit('onTelemetryPacket', {
      from: 42,
      rxTime: new Date(EXPECTED_MS),
      data: { deviceMetrics: { batteryLevel: 80 } },
    });
    const position = events.find((e) => e.type === 'position');
    const telemetry = events.find((e) => e.type === 'telemetry');
    expect(position?.type === 'position' && position.payload.timestamp).toBe(EXPECTED_MS);
    expect(telemetry?.type === 'telemetry' && telemetry.payload.timestamp).toBe(EXPECTED_MS);
    teardown();
  });

  it('maps traceroute rxTime Date to epoch ms', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (e) => events.push(e));
    emit('onTraceRoutePacket', {
      id: 99,
      from: 1,
      to: 2,
      rxTime: new Date(EXPECTED_MS),
      data: { route: [11, 22] },
    });
    const tr = events.find((e) => e.type === 'trace_route');
    expect(tr?.type === 'trace_route' && tr.payload.timestamp).toBe(EXPECTED_MS);
    expect(tr?.type === 'trace_route' && tr.payload.timestamp).not.toBe(DOUBLE_CONVERTED);
    teardown();
  });

  it('still converts numeric unix-second rxTime to epoch ms', () => {
    const { device, emit } = mockMeshDevice();
    const events: DomainEvent[] = [];
    const teardown = meshtasticProtocol.subscribe(device, (e) => events.push(e));
    emit('onUserPacket', {
      from: 0x55,
      rxTime: RADIO_SEC,
      data: { longName: 'Sec', shortName: 'SC' },
    });
    const info = events.find((e) => e.type === 'node_info');
    expect(info?.type === 'node_info' && info.payload.lastHeardAt).toBe(EXPECTED_MS);
    teardown();
  });
});
