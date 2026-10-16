import {
  type MessageRecord,
  subscribeMessageStoreEvents,
  useMessageStore,
} from '../../stores/messageStore';
import { sendChatOnIdentity } from '../sendChatOnIdentity';
import type { IdentityId } from '../types';
import { TAK_MESH_SEND_TIMEOUT_MS, type TakMeshSendFn } from './takInboundChat';

export type OutboundSettlement = 'acked' | 'failed' | 'timeout';

/**
 * Wait for an outbound message to leave `sending`, following the id through a re-key (a
 * provisional id replaced by the radio's packet id). Resolves `timeout` when it has not settled
 * within `timeoutMs`, so a waiter never outlives the send.
 */
export function waitForOutboundSettled(
  identityId: IdentityId,
  storeId: string,
  timeoutMs: number = TAK_MESH_SEND_TIMEOUT_MS,
): Promise<OutboundSettlement> {
  let trackedId = storeId;
  const read = (): OutboundSettlement | undefined => {
    // Either level can miss: no messages yet for the identity, or the row is mid re-key.
    const byId = useMessageStore.getState().messages[identityId] as
      Record<string, MessageRecord | undefined> | undefined;
    const status = byId?.[trackedId]?.status;
    return status === 'acked' || status === 'failed' ? status : undefined;
  };
  const immediate = read();
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      unsubEvents();
      unsubStore();
    };
    const settle = (outcome: OutboundSettlement): void => {
      cleanup();
      resolve(outcome);
    };
    const check = (): void => {
      const outcome = read();
      if (outcome) settle(outcome);
    };
    const timer = setTimeout(() => {
      settle('timeout');
    }, timeoutMs);
    const unsubEvents = subscribeMessageStoreEvents((event) => {
      if (event.type !== 'renamed' || event.identityId !== identityId) return;
      if (event.fromId === trackedId) {
        trackedId = event.toId;
        check();
      }
    });
    const unsubStore = useMessageStore.subscribe(check);
  });
}

/**
 * Send a TAK client's channel text on one identity through the same path as Chat, so it shows
 * in Chat, is stored, and gets "Heard by" on MeshCore. Resolves once the message is on its way:
 * for MeshCore when the companion accepts it, for Meshtastic once it is queued (its ack arrives
 * later, as for any Chat message). Rejects when nothing was sent or the send failed.
 */
export const sendTakTextOnMesh: TakMeshSendFn = async (target, text) => {
  const storeId = sendChatOnIdentity(target.identityId, {
    text,
    channelIndex: target.channelIndex,
  });
  if (storeId == null) throw new Error(`${target.protocol} send was not started`);
  if (target.protocol === 'meshtastic') return;
  const outcome = await waitForOutboundSettled(target.identityId, storeId);
  if (outcome === 'failed') throw new Error('MeshCore send failed');
  if (outcome === 'timeout') throw new Error('mesh send timed out');
};
