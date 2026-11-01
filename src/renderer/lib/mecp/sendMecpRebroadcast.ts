import { connectionDriver } from '@/renderer/lib/drivers/ConnectionDriver';
import type {
  MecpRebroadcastSendFn,
  MecpReticulumEndpoint,
} from '@/renderer/lib/mecp/mecpRebroadcast';
import { withReticulumIpcSendDeadline } from '@/renderer/lib/reticulum/reticulumIpcDeadline';
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
  protocol: 'meshtastic' | 'meshcore' | 'reticulum',
  channelIndex: number,
): string {
  // Reticulum has no channel names; the bridge notice names the LXMF transport instead.
  if (protocol === 'reticulum') return 'LXMF';
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

/** Throws unless the Reticulum sidecar stack is live (rebroadcast must not silently queue). */
async function assertReticulumStackLive(): Promise<void> {
  const status = await window.electronAPI.reticulum.getStatus();
  if (!status.running || status.healthy === false) {
    throw new Error('Reticulum stack not running');
  }
}

/**
 * Send a MECP payload (or bridge notice) into Reticulum: an RRC hub room, or an LXMF direct
 * message. Requires the sidecar stack to be running; failures propagate so
 * `executeMecpRebroadcast` logs and skips the notice.
 */
export async function sendMecpRebroadcastToReticulum(
  target: MecpReticulumEndpoint,
  payload: string,
): Promise<void> {
  await assertReticulumStackLive();
  if (target.kind === 'rrc') {
    const res = await withReticulumIpcSendDeadline(
      window.electronAPI.reticulum.rrc.send({
        hub_dest_hash: target.hubDestHash,
        room: target.room,
        body: payload,
        type: 'msg',
      }),
    );
    if (!res.ok) throw new Error(res.error ?? 'RRC send rejected');
    return;
  }
  // Sidecar LxmfSendRequest requires `text` (not `content`).
  const res = (await withReticulumIpcSendDeadline(
    window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/send', {
      destination_hash: target.destinationHash,
      text: payload,
    }),
  )) as { ok?: boolean; error?: string };
  if (res.ok === false) throw new Error(res.error ?? 'LXMF send rejected');
}

/**
 * Default send implementation for MECP cross-protocol rebroadcast.
 * Channel broadcast only (to = broadcast / unset).
 */
export const sendMecpRebroadcastOnProtocol: MecpRebroadcastSendFn = async (target, payload) => {
  if (target.protocol === 'reticulum') {
    if (!target.reticulum) throw new Error('Reticulum rebroadcast target missing');
    await sendMecpRebroadcastToReticulum(target.reticulum, payload);
    return;
  }
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
