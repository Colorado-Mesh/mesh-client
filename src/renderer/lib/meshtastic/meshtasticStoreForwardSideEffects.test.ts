// @vitest-environment jsdom
import { create, toBinary } from '@bufbuild/protobuf';
import { StoreForward } from '@meshtastic/protobufs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageStore } from '../../stores/messageStore';
import { packetRouter } from '../drivers/PacketRouter';
import { getIdentityChatMessages } from '../identityStoreReads';
import {
  attachMeshtasticStoreForwardSideEffects,
  type MeshtasticStoreForwardSideEffectsDeps,
} from './meshtasticStoreForwardSideEffects';

const IDENTITY = 'id-sf-se';
const SERVER = 0x1111;

function sfPacket(rr: number, variant: { case: string; value: unknown }): Uint8Array {
  const msg = create(StoreForward.StoreAndForwardSchema, { rr, variant } as Parameters<
    typeof create<typeof StoreForward.StoreAndForwardSchema>
  >[1]);
  return toBinary(StoreForward.StoreAndForwardSchema, msg);
}

function makeDeps(overrides: Partial<MeshtasticStoreForwardSideEffectsDeps> = {}) {
  const deps: MeshtasticStoreForwardSideEffectsDeps = {
    touchLastData: vi.fn(),
    getNodeName: (n) => `Node ${n}`,
    getIsDeviceConfigured: () => true,
    recordHeartbeat: vi.fn(),
    requestStoreForwardHistory: vi.fn(),
    setStoreForwardMessages: vi.fn(),
    ...overrides,
  };
  return deps;
}

describe('attachMeshtasticStoreForwardSideEffects', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    window.electronAPI = {
      db: { saveMessage: vi.fn().mockResolvedValue(undefined) },
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a primary router heartbeat and auto-requests history when configured', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticStoreForwardSideEffects(IDENTITY, deps);
    const data = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HEARTBEAT, {
      case: 'heartbeat',
      value: create(StoreForward.StoreAndForward_HeartbeatSchema, { period: 120, secondary: 0 }),
    });
    packetRouter.dispatch(
      {
        type: 'meshtastic_store_forward',
        payload: { from: SERVER, channel: 0, timestamp: Date.now(), raw: { data } },
      },
      IDENTITY,
    );
    expect(deps.touchLastData).toHaveBeenCalled();
    expect(deps.setStoreForwardMessages).toHaveBeenCalled();
    expect(deps.recordHeartbeat).toHaveBeenCalledWith({
      serverNodeId: SERVER,
      channel: 0,
      period: 120,
    });
    expect(deps.requestStoreForwardHistory).toHaveBeenCalledWith({
      serverNodeId: SERVER,
      manual: false,
    });
    detach();
  });

  it('records a secondary heartbeat without requesting history', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticStoreForwardSideEffects(IDENTITY, deps);
    const data = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HEARTBEAT, {
      case: 'heartbeat',
      value: create(StoreForward.StoreAndForward_HeartbeatSchema, { period: 60, secondary: 1 }),
    });
    packetRouter.dispatch(
      {
        type: 'meshtastic_store_forward',
        payload: { from: SERVER, channel: 1, timestamp: Date.now(), raw: { data } },
      },
      IDENTITY,
    );
    expect(deps.recordHeartbeat).toHaveBeenCalled();
    expect(deps.requestStoreForwardHistory).not.toHaveBeenCalled();
    detach();
  });

  it('skips auto history when the radio has not finished configure', () => {
    const deps = makeDeps({ getIsDeviceConfigured: () => false });
    const detach = attachMeshtasticStoreForwardSideEffects(IDENTITY, deps);
    const data = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HEARTBEAT, {
      case: 'heartbeat',
      value: create(StoreForward.StoreAndForward_HeartbeatSchema, { period: 90, secondary: 0 }),
    });
    packetRouter.dispatch(
      {
        type: 'meshtastic_store_forward',
        payload: { from: SERVER, channel: 0, timestamp: Date.now(), raw: { data } },
      },
      IDENTITY,
    );
    expect(deps.recordHeartbeat).toHaveBeenCalled();
    expect(deps.requestStoreForwardHistory).not.toHaveBeenCalled();
    detach();
  });

  it('replays ROUTER_TEXT_BROADCAST into messageStore with viaStoreForward', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticStoreForwardSideEffects(IDENTITY, deps);
    const data = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_TEXT_BROADCAST, {
      case: 'text',
      value: new TextEncoder().encode('  summit check-in  '),
    });
    packetRouter.dispatch(
      {
        type: 'meshtastic_store_forward',
        payload: { from: SERVER, channel: 2, timestamp: Date.now(), raw: { data } },
      },
      IDENTITY,
    );
    const messages = getIdentityChatMessages(IDENTITY);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      sender_id: SERVER,
      sender_name: `Node ${SERVER}`,
      payload: 'summit check-in',
      channel: 2,
      isHistory: true,
      viaStoreForward: true,
      receivedVia: 'rf',
    });
    expect(window.electronAPI.db.saveMessage).toHaveBeenCalled();
    detach();
  });

  it('does not duplicate replayed history within the dedup window', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticStoreForwardSideEffects(IDENTITY, deps);
    const data = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_TEXT_BROADCAST, {
      case: 'text',
      value: new TextEncoder().encode('same payload'),
    });
    const event = {
      type: 'meshtastic_store_forward' as const,
      payload: { from: SERVER, channel: 0, timestamp: Date.now(), raw: { data } },
    };
    packetRouter.dispatch(event, IDENTITY);
    packetRouter.dispatch(event, IDENTITY);
    expect(getIdentityChatMessages(IDENTITY)).toHaveLength(1);
    detach();
  });

  it('appends a retransmitted frame to the ring buffer only once', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticStoreForwardSideEffects(IDENTITY, deps);
    const data = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_TEXT_BROADCAST, {
      case: 'text',
      value: new TextEncoder().encode('retransmit me'),
    });
    const event = {
      type: 'meshtastic_store_forward' as const,
      payload: { from: SERVER, channel: 0, timestamp: Date.now(), raw: { data } },
    };
    packetRouter.dispatch(event, IDENTITY);
    packetRouter.dispatch(event, IDENTITY);
    expect(deps.setStoreForwardMessages).toHaveBeenCalledTimes(1);
    detach();
  });

  it('keeps recording heartbeats but rate-limits repeated auto history requests', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticStoreForwardSideEffects(IDENTITY, deps);
    const data = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_HEARTBEAT, {
      case: 'heartbeat',
      value: create(StoreForward.StoreAndForward_HeartbeatSchema, { period: 120, secondary: 0 }),
    });
    const event = {
      type: 'meshtastic_store_forward' as const,
      payload: { from: SERVER, channel: 0, timestamp: Date.now(), raw: { data } },
    };
    packetRouter.dispatch(event, IDENTITY);
    packetRouter.dispatch(event, IDENTITY);
    packetRouter.dispatch(event, IDENTITY);
    expect(deps.recordHeartbeat).toHaveBeenCalledTimes(3);
    expect(deps.requestStoreForwardHistory).toHaveBeenCalledTimes(1);
    detach();
  });

  it('keeps distinct frames from the same router', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticStoreForwardSideEffects(IDENTITY, deps);
    for (const text of ['first', 'second']) {
      packetRouter.dispatch(
        {
          type: 'meshtastic_store_forward',
          payload: {
            from: SERVER,
            channel: 0,
            timestamp: Date.now(),
            raw: {
              data: sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_TEXT_BROADCAST, {
                case: 'text',
                value: new TextEncoder().encode(text),
              }),
            },
          },
        },
        IDENTITY,
      );
    }
    expect(deps.setStoreForwardMessages).toHaveBeenCalledTimes(2);
    detach();
  });

  it('ignores events routed for a different identity', () => {
    const deps = makeDeps();
    const detach = attachMeshtasticStoreForwardSideEffects(IDENTITY, deps);
    const data = sfPacket(StoreForward.StoreAndForward_RequestResponse.ROUTER_TEXT_BROADCAST, {
      case: 'text',
      value: new TextEncoder().encode('nope'),
    });
    packetRouter.dispatch(
      {
        type: 'meshtastic_store_forward',
        payload: { from: SERVER, channel: 0, timestamp: Date.now(), raw: { data } },
      },
      'other-id',
    );
    expect(deps.touchLastData).not.toHaveBeenCalled();
    expect(getIdentityChatMessages(IDENTITY)).toHaveLength(0);
    detach();
  });
});
