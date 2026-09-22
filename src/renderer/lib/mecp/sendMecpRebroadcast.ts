import { connectionDriver } from '@/renderer/lib/drivers/ConnectionDriver';
import type { MecpRebroadcastSendFn } from '@/renderer/lib/mecp/mecpRebroadcast';
import { tryGetMeshtasticSession } from '@/renderer/lib/sessions/meshtasticSession';
import { useIdentityStore } from '@/renderer/stores/identityStore';

function findIdentityForProtocol(protocol: 'meshtastic' | 'meshcore') {
  return (
    Object.values(useIdentityStore.getState().identities).find(
      (i) => i.protocol.type === protocol,
    ) ?? null
  );
}

/**
 * Default send implementation for MECP cross-protocol rebroadcast.
 * Channel broadcast only (to = broadcast / unset).
 */
export const sendMecpRebroadcastOnProtocol: MecpRebroadcastSendFn = async (target, payload) => {
  if (target.protocol === 'meshtastic') {
    const session = tryGetMeshtasticSession();
    if (!session) {
      throw new Error('Meshtastic session not mounted');
    }
    session.sendChatMessage(payload, target.channelIndex, undefined, undefined);
    return;
  }

  const identity = findIdentityForProtocol('meshcore');
  if (!identity) {
    throw new Error('MeshCore identity not found');
  }
  const handle = connectionDriver.getHandle(identity.id);
  if (!handle) {
    throw new Error('MeshCore not connected');
  }
  await identity.protocol.sendMessage(handle, {
    text: payload,
    channelIndex: target.channelIndex,
  });
};
