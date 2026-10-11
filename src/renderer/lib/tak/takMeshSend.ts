import { useIdentityStore } from '../../stores/identityStore';
import { connectionDriver } from '../drivers/ConnectionDriver';
import { tryGetMeshtasticSession } from '../sessions/meshtasticSession';
import type { TakMeshSendFn } from './takInboundChat';

/** Send channel text on one identity through the normal send path for its protocol. */
export const sendTakTextOnMesh: TakMeshSendFn = async (target, text) => {
  if (target.protocol === 'meshtastic') {
    const session = tryGetMeshtasticSession();
    if (!session) throw new Error('Meshtastic session not mounted');
    session.sendChatMessage(text, target.channelIndex, undefined, undefined);
    return;
  }
  const identity = useIdentityStore.getState().identities[target.identityId];
  const handle = connectionDriver.getHandle(target.identityId);
  if (!handle) throw new Error('MeshCore not connected');
  await identity.protocol.sendMessage(handle, { text, channelIndex: target.channelIndex });
};
