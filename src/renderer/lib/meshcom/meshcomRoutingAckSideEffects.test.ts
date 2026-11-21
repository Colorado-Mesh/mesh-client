import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { packetRouter } from '@/renderer/lib/drivers/PacketRouter';
import {
  attachMeshcomRoutingAckSideEffects,
  clearAllMeshcomDmAckTimeouts,
  MESHCOM_DM_ACK_TIMEOUT_MS,
  scheduleMeshcomDmAckTimeout,
} from '@/renderer/lib/meshcom/meshcomRoutingAckSideEffects';
import { upsertMessage, useMessageStore } from '@/renderer/stores/messageStore';

describe('attachMeshcomRoutingAckSideEffects', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    clearAllMeshcomDmAckTimeouts();
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearAllMeshcomDmAckTimeouts();
    vi.useRealTimers();
  });

  it('marks matching outbound DM acked and stamps proof', () => {
    const identityId = 'meshcom:test';
    upsertMessage(identityId, {
      id: '42',
      from: 1,
      to: 2,
      payload: 'hi',
      channelIndex: -1,
      timestamp: 1,
      status: 'sending',
    });
    const detach = attachMeshcomRoutingAckSideEffects(identityId);
    packetRouter.dispatch(
      {
        type: 'meshtastic_routing_ack',
        payload: { requestId: 42, ackProofStatus: 1, isAck: true },
      },
      identityId,
    );
    const row = useMessageStore.getState().messages[identityId]['42'];
    expect(row.status).toBe('acked');
    expect(row.ackProofStatus).toBe('valid');
    detach();
  });

  it('marks nack as failed', () => {
    const identityId = 'meshcom:test';
    upsertMessage(identityId, {
      id: '7',
      from: 1,
      to: 2,
      payload: 'hi',
      channelIndex: -1,
      timestamp: 1,
      status: 'sending',
    });
    const detach = attachMeshcomRoutingAckSideEffects(identityId);
    packetRouter.dispatch(
      {
        type: 'meshtastic_routing_ack',
        payload: { requestId: 7, ackProofStatus: 0, isAck: false },
      },
      identityId,
    );
    expect(useMessageStore.getState().messages[identityId]['7'].status).toBe('failed');
    detach();
  });

  it('fails DM after ACK timeout', () => {
    const identityId = 'meshcom:timeout';
    upsertMessage(identityId, {
      id: '99',
      from: 1,
      to: 2,
      payload: 'hi',
      channelIndex: -1,
      timestamp: 1,
      status: 'sending',
    });
    scheduleMeshcomDmAckTimeout(identityId, '99');
    vi.advanceTimersByTime(MESHCOM_DM_ACK_TIMEOUT_MS);
    expect(useMessageStore.getState().messages[identityId]['99'].status).toBe('failed');
  });
});
