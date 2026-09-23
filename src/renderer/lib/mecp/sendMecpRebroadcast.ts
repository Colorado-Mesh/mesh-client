import { connectionDriver } from '@/renderer/lib/drivers/ConnectionDriver';
import type { MecpRebroadcastSendFn } from '@/renderer/lib/mecp/mecpRebroadcast';
import { tryGetMeshtasticSession } from '@/renderer/lib/sessions/meshtasticSession';
import { getDevice } from '@/renderer/stores/deviceStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';

function findIdentityForProtocol(protocol: 'meshtastic' | 'meshcore') {
  return (
    Object.values(useIdentityStore.getState().identities).find(
      (i) => i.protocol.type === protocol,
    ) ?? null
  );
}

/**
 * Resolve a human channel name for the source endpoint (never emit a bare index).
 */
export function resolveMecpSourceChannelName(
  protocol: 'meshtastic' | 'meshcore',
  channelIndex: number,
): string {
  const identity = findIdentityForProtocol(protocol);
  if (!identity) {
    return protocol === 'meshtastic' && channelIndex === 0 ? 'Primary' : 'unnamed';
  }
  const device = getDevice(identity.id);
  if (protocol === 'meshtastic') {
    const fromChannels = device.channels.find((c) => c.index === channelIndex)?.name.trim();
    const fromConfigs = device.channelConfigs.find((c) => c.index === channelIndex)?.name.trim();
    const named = fromChannels || fromConfigs;
    if (named) return named;
    return channelIndex === 0 ? 'Primary' : 'unnamed';
  }
  const named = device.meshcoreChannels?.find((c) => c.index === channelIndex)?.name.trim();
  if (named) return named;
  return 'unnamed';
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
