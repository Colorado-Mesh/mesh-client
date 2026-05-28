import { afterEach, describe, expect, it } from 'vitest';

import { useConnectionStore } from '../../stores/connectionStore';
import { useMessageStore } from '../../stores/messageStore';
import { useNodeStore } from '../../stores/nodeStore';
import type { DomainEvent } from '../protocols/Protocol';
import { packetRouter } from './PacketRouter';

const ID = 'packet-router-test';

describe('PacketRouter', () => {
  afterEach(() => {
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    useConnectionStore.setState({ connections: {} });
  });

  const cases: { event: DomainEvent; assert: () => void }[] = [
    {
      event: {
        type: 'text_message',
        payload: {
          id: '42',
          from: 1,
          to: 2,
          payload: 'hello',
          channelIndex: 0,
          timestamp: 5000,
        },
      },
      assert: () => {
        expect(useMessageStore.getState().messages[ID]['42'].payload).toBe('hello');
        expect(useMessageStore.getState().messages[ID]['42'].senderName).toBe('!00000001');
      },
    },
    {
      event: {
        type: 'node_info',
        payload: { nodeId: 9, longName: 'Alpha', shortName: 'AL' },
      },
      assert: () => {
        expect(useNodeStore.getState().nodes[ID][9].longName).toBe('Alpha');
      },
    },
    {
      event: {
        type: 'queue_status',
        payload: { free: 3, maxlen: 16 },
      },
      assert: () => {
        expect(useConnectionStore.getState().connections[ID].queueFree).toBe(3);
        expect(useConnectionStore.getState().connections[ID].queueMax).toBe(16);
      },
    },
    {
      event: {
        type: 'device_status',
        payload: { status: 'configured' },
      },
      assert: () => {
        expect(useConnectionStore.getState().connections[ID].status).toBe('configured');
      },
    },
  ];

  it.each(cases)('dispatches $event.type into identity stores', ({ event, assert }) => {
    packetRouter.dispatch(event, ID);
    assert();
  });

  it('upserts text_message by id (dedupe optimistic echo)', () => {
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: '99',
          from: 1,
          to: 0xffffffff,
          payload: 'first',
          channelIndex: 0,
          timestamp: 1,
        },
      },
      ID,
    );
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: '99',
          from: 1,
          to: 0xffffffff,
          payload: 'first',
          channelIndex: 0,
          timestamp: 1,
          rxSnr: 8,
        },
      },
      ID,
    );
    expect(useMessageStore.getState().messages[ID]['99'].rxSnr).toBe(8);
    expect(Object.keys(useMessageStore.getState().messages[ID])).toHaveLength(1);
  });

  it('ignores unknown event types without throwing', () => {
    expect(() => {
      packetRouter.dispatch({ type: 'nonexistent' } as unknown as DomainEvent, ID);
    }).not.toThrow();
  });
});
