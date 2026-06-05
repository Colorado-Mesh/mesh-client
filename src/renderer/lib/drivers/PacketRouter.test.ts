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

  it('upgrades receivedVia to both when RF follows MQTT on the same id', () => {
    useMessageStore.setState({
      messages: {
        [ID]: {
          msg1: {
            id: 'msg1',
            from: 1,
            to: 0xffffffff,
            payload: 'hello',
            channelIndex: 0,
            timestamp: 1000,
            receivedVia: 'mqtt',
          },
        },
      },
    });
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: 'msg1',
          from: 1,
          to: 0xffffffff,
          payload: 'hello',
          channelIndex: 0,
          timestamp: 1000,
          rxSnr: 10,
        },
      },
      ID,
    );
    expect(useMessageStore.getState().messages[ID].msg1.receivedVia).toBe('both');
    expect(useMessageStore.getState().messages[ID].msg1.rxSnr).toBe(10);
  });

  it('preserves receivedVia both when RF re-upserts the same id', () => {
    useMessageStore.setState({
      messages: {
        [ID]: {
          msg1: {
            id: 'msg1',
            from: 1,
            to: 0xffffffff,
            payload: 'hello',
            channelIndex: 0,
            timestamp: 1000,
            receivedVia: 'both',
          },
        },
      },
    });
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: 'msg1',
          from: 1,
          to: 0xffffffff,
          payload: 'hello',
          channelIndex: 0,
          timestamp: 1000,
        },
      },
      ID,
    );
    expect(useMessageStore.getState().messages[ID].msg1.receivedVia).toBe('both');
  });

  it('re-keys optimistic tapback row when RF echo arrives (no duplicate)', () => {
    const tempId = '289800531';
    const realId = '672866887';
    const ts = Date.now();
    useMessageStore.setState({
      messages: {
        [ID]: {
          [tempId]: {
            id: tempId,
            from: 649425065,
            to: 0xffffffff,
            payload: '✈️',
            channelIndex: 0,
            timestamp: ts,
            status: 'sending',
            tapback: true,
            replyTo: '3608225609',
          },
        },
      },
    });
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: realId,
          from: 649425065,
          to: 0xffffffff,
          payload: '✈️',
          channelIndex: 0,
          timestamp: ts,
          tapback: true,
          replyTo: '3608225609',
        },
      },
      ID,
    );
    const byId = useMessageStore.getState().messages[ID] ?? {};
    expect(Object.keys(byId)).toHaveLength(1);
    expect(byId[realId]).toBeDefined();
    expect(byId[tempId]).toBeUndefined();
    expect(byId[realId].tapback).toBe(true);
  });

  it('ignores unknown event types without throwing', () => {
    expect(() => {
      packetRouter.dispatch({ type: 'nonexistent' } as unknown as DomainEvent, ID);
    }).not.toThrow();
  });
});
