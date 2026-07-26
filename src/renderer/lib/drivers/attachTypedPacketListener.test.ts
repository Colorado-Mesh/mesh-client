import { afterEach, describe, expect, it } from 'vitest';

import { useMessageStore } from '../../stores/messageStore';
import { useNodeStore } from '../../stores/nodeStore';
import { attachTypedPacketListener, attachTypedPacketListeners } from './attachTypedPacketListener';
import { packetRouter } from './PacketRouter';

const ID = 'typed-listener-identity';
const OTHER_ID = 'typed-listener-other-identity';

function textMessage(id: string) {
  return {
    type: 'text_message' as const,
    payload: { id, from: 1, to: 2, payload: 'hi', channelIndex: 0, timestamp: 1000 },
  };
}

describe('attachTypedPacketListener', () => {
  afterEach(() => {
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
  });

  it('delivers only the requested event type for the requested identity', () => {
    const seen: string[] = [];
    const detach = attachTypedPacketListener(ID, 'text_message', (payload) => {
      seen.push(payload.payload);
    });

    packetRouter.dispatch(textMessage('1'), ID);
    packetRouter.dispatch(textMessage('2'), OTHER_ID);
    packetRouter.dispatch({ type: 'node_info', payload: { nodeId: 5 } }, ID);

    expect(seen).toEqual(['hi']);
    detach();
  });

  it('runs after the store mutation for the same event', () => {
    let payloadInStore: string | undefined;
    const detach = attachTypedPacketListener(ID, 'text_message', (payload) => {
      payloadInStore = useMessageStore.getState().messages[ID]?.[payload.id]?.payload;
    });

    packetRouter.dispatch(textMessage('42'), ID);

    expect(payloadInStore).toBe('hi');
    detach();
  });

  it('detach removes the listener', () => {
    let calls = 0;
    const detach = attachTypedPacketListener(ID, 'text_message', () => {
      calls += 1;
    });
    const before = packetRouter.listenerCount();
    detach();
    expect(packetRouter.listenerCount()).toBe(before - 1);

    packetRouter.dispatch(textMessage('3'), ID);
    expect(calls).toBe(0);
  });
});

describe('attachTypedPacketListeners', () => {
  afterEach(() => {
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
  });

  it('routes each event type to its handler and ignores unmapped types', () => {
    const seen: string[] = [];
    const detach = attachTypedPacketListeners(ID, {
      text_message: (payload) => seen.push(`text:${payload.id}`),
      node_info: (payload) => seen.push(`node:${payload.nodeId}`),
    });

    packetRouter.dispatch(textMessage('7'), ID);
    packetRouter.dispatch({ type: 'node_info', payload: { nodeId: 9 } }, ID);
    packetRouter.dispatch({ type: 'queue_status', payload: { free: 1, maxlen: 2 } }, ID);

    expect(seen).toEqual(['text:7', 'node:9']);
    detach();
  });

  it('registers a single router listener for the whole handler map', () => {
    const before = packetRouter.listenerCount();
    const detach = attachTypedPacketListeners(ID, {
      text_message: () => {},
      node_info: () => {},
      waypoint: () => {},
    });
    expect(packetRouter.listenerCount()).toBe(before + 1);
    detach();
    expect(packetRouter.listenerCount()).toBe(before);
  });

  it('preserves registration order across modules', () => {
    const order: string[] = [];
    const detachFirst = attachTypedPacketListeners(ID, {
      text_message: () => order.push('first'),
    });
    const detachSecond = attachTypedPacketListener(ID, 'text_message', () => order.push('second'));

    packetRouter.dispatch(textMessage('8'), ID);

    expect(order).toEqual(['first', 'second']);
    detachFirst();
    detachSecond();
  });
});
