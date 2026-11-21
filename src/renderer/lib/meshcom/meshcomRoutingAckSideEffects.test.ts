/**
 * @vitest-environment jsdom
 */
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
  const updateMeshcomMessageStatus = vi.fn().mockResolvedValue({ changes: 1 });

  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    clearAllMeshcomDmAckTimeouts();
    updateMeshcomMessageStatus.mockClear();
    window.electronAPI = {
      db: { updateMeshcomMessageStatus },
    } as unknown as typeof window.electronAPI;
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
    // MeshCom never claims Meshtastic cryptographic `valid` proof.
    expect(row.ackProofStatus).toBe('absent');
    expect(updateMeshcomMessageStatus).toHaveBeenCalledWith({
      identity_id: identityId,
      msg_id: '42',
      status: 'acked',
    });
    detach();
  });

  it('ignores ACK from a mismatched peer when from is present', () => {
    const identityId = 'meshcom:spoof';
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
        payload: { requestId: 42, ackProofStatus: 0, isAck: true, from: 99 },
      },
      identityId,
    );
    expect(useMessageStore.getState().messages[identityId]['42'].status).toBe('sending');
    expect(updateMeshcomMessageStatus).not.toHaveBeenCalled();
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
    expect(updateMeshcomMessageStatus).toHaveBeenCalledWith({
      identity_id: identityId,
      msg_id: '7',
      status: 'failed',
    });
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
    expect(updateMeshcomMessageStatus).toHaveBeenCalledWith({
      identity_id: identityId,
      msg_id: '99',
      status: 'failed',
    });
  });
});
