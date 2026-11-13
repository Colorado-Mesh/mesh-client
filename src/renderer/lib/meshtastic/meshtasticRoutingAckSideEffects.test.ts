import { beforeEach, describe, expect, it } from 'vitest';

import { packetRouter } from '@/renderer/lib/drivers/PacketRouter';
import { attachMeshtasticRoutingAckSideEffects } from '@/renderer/lib/meshtastic/meshtasticRoutingAckSideEffects';
import { upsertMessage, useMessageStore } from '@/renderer/stores/messageStore';

describe('attachMeshtasticRoutingAckSideEffects', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('stamps ackProofStatus on the matching outbound message', () => {
    const identityId = 'meshtastic:test';
    upsertMessage(identityId, {
      id: '42',
      from: 1,
      to: 2,
      payload: 'hi',
      channelIndex: 0,
      timestamp: 1,
      status: 'acked',
    });
    const detach = attachMeshtasticRoutingAckSideEffects(identityId);
    packetRouter.dispatch(
      {
        type: 'meshtastic_routing_ack',
        payload: { requestId: 42, ackProofStatus: 1, isAck: true },
      },
      identityId,
    );
    expect(useMessageStore.getState().messages[identityId]['42'].ackProofStatus).toBe('valid');
    detach();
  });

  it('does not overwrite a valid receipt with a later absent proof', () => {
    const identityId = 'meshtastic:test';
    upsertMessage(identityId, {
      id: '7',
      from: 1,
      to: 2,
      payload: 'hi',
      channelIndex: 0,
      timestamp: 1,
      status: 'acked',
      ackProofStatus: 'valid',
    });
    const detach = attachMeshtasticRoutingAckSideEffects(identityId);
    packetRouter.dispatch(
      {
        type: 'meshtastic_routing_ack',
        payload: { requestId: 7, ackProofStatus: 0, isAck: true },
      },
      identityId,
    );
    expect(useMessageStore.getState().messages[identityId]['7'].ackProofStatus).toBe('valid');
    detach();
  });
});
