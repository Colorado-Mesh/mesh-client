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
        payload: { requestId: 42, ackProofStatus: 1, isAck: true, from: 2 },
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

  it('ignores sender-less BLE ACK for DMs without peer attribution', () => {
    const identityId = 'meshcom:ble-no-src';
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
        payload: { requestId: 42, ackProofStatus: 0, isAck: true },
      },
      identityId,
    );
    expect(useMessageStore.getState().messages[identityId]['42'].status).toBe('sending');
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

  it('settles a pending row when direct storage id is an ineligible completed row', () => {
    const identityId = 'meshcom:direct-block';
    const fullId = 0x00abcd0c;
    upsertMessage(identityId, {
      id: String(fullId),
      from: 1,
      to: 2,
      payload: 'pending dm',
      channelIndex: -1,
      timestamp: 1,
      status: 'sending',
    });
    upsertMessage(identityId, {
      id: String(fullId & 0x3ff),
      from: 1,
      to: 2,
      payload: 'old',
      channelIndex: -1,
      timestamp: 1,
      status: 'acked',
    });
    const detach = attachMeshcomRoutingAckSideEffects(identityId);
    packetRouter.dispatch(
      {
        type: 'meshtastic_routing_ack',
        payload: { requestId: fullId, ackProofStatus: 0, isAck: true, from: 2 },
      },
      identityId,
    );
    expect(useMessageStore.getState().messages[identityId][String(fullId)].status).toBe('acked');
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
        payload: { requestId: 7, ackProofStatus: 0, isAck: false, from: 2 },
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
