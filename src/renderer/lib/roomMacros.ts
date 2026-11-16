import { resolveMeshcoreRoomNodeId } from '@/renderer/lib/meshcoreRoomNodeLookup';
import { resolveChannelTargetIndex } from '@/renderer/lib/scheduledBroadcasts/resolveChannelTarget';
import type { RoomMacroTarget } from '@/renderer/stores/chatMacrosStore';
import { getConnection } from '@/renderer/stores/connectionStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';
import { getLiveChannelKeys } from '@/renderer/stores/liveChannelKeyStore';

/** Live slot map only when `identityId` owns the connected radio for that protocol. */
function liveKeyByIndexForTargetIdentity(
  identityId: string,
  kind: 'meshcore-channel' | 'meshtastic-channel',
): Readonly<Record<number, string>> | null {
  const protocol = kind === 'meshcore-channel' ? 'meshcore' : 'meshtastic';
  const identity = useIdentityStore.getState().identities[identityId] as
    { protocol: { type: string } } | undefined;
  if (identity?.protocol.type !== protocol) return null;
  const conn = getConnection(identityId);
  if (!conn || (conn.status !== 'connected' && conn.status !== 'configured')) return null;
  return getLiveChannelKeys(protocol)?.keyByIndex ?? null;
}

export type RoomMacroPlan =
  | { kind: 'meshcore-room'; protocol: 'meshcore'; identityId: string; roomNodeId: number }
  | { kind: 'meshcore-channel'; protocol: 'meshcore'; identityId: string; channelIndex: number }
  | {
      kind: 'meshtastic-channel';
      protocol: 'meshtastic';
      identityId: string;
      channelIndex: number;
    }
  | { kind: 'rrc-room'; protocol: 'reticulum'; hubDestHash: string; room: string };

/** App registers a navigator once; F-keys and macro clicks call through this. */
export type RoomMacroNavigator = (plan: RoomMacroPlan, slotIndex: number) => boolean;

let navigatorFn: RoomMacroNavigator | null = null;

export function registerRoomMacroNavigator(fn: RoomMacroNavigator): () => void {
  navigatorFn = fn;
  return () => {
    if (navigatorFn === fn) navigatorFn = null;
  };
}

/** Returns false when no navigator is registered (key must not be swallowed). */
export function navigateRoomMacro(plan: RoomMacroPlan, slotIndex: number): boolean {
  if (!navigatorFn) return false;
  return navigatorFn(plan, slotIndex);
}

export function resetRoomMacroNavigatorForTests(): void {
  navigatorFn = null;
}

export interface RoomMacroResolveDeps {
  /** MeshCore pubkey → live node id (same logic as scheduled-broadcast delivery). */
  resolveMeshcoreRoomNodeId: (identityId: string, roomPubKeyHex: string) => number | undefined;
}

/** Pure: target → plan (null when the room/channel cannot be resolved right now). */
export function resolveRoomMacroPlan(
  target: RoomMacroTarget,
  deps: RoomMacroResolveDeps,
): RoomMacroPlan | null {
  if (target.kind === 'meshcore-room') {
    const roomNodeId = deps.resolveMeshcoreRoomNodeId(target.identityId, target.roomPubKeyHex);
    if (roomNodeId == null) return null;
    return {
      kind: 'meshcore-room',
      protocol: 'meshcore',
      identityId: target.identityId,
      roomNodeId,
    };
  }
  if (target.kind === 'meshcore-channel') {
    const resolved = resolveChannelTargetIndex(
      target,
      liveKeyByIndexForTargetIdentity(target.identityId, 'meshcore-channel'),
    );
    if (!resolved.ok) return null;
    return {
      kind: 'meshcore-channel',
      protocol: 'meshcore',
      identityId: target.identityId,
      channelIndex: resolved.channelIndex,
    };
  }
  if (target.kind === 'meshtastic-channel') {
    const resolved = resolveChannelTargetIndex(
      target,
      liveKeyByIndexForTargetIdentity(target.identityId, 'meshtastic-channel'),
    );
    if (!resolved.ok) return null;
    return {
      kind: 'meshtastic-channel',
      protocol: 'meshtastic',
      identityId: target.identityId,
      channelIndex: resolved.channelIndex,
    };
  }
  // Remaining variant is rrc-room (RoomMacroTarget exhaustiveness).
  return {
    kind: 'rrc-room',
    protocol: 'reticulum',
    hubDestHash: target.hubDestHash.toLowerCase(),
    room: target.room,
  };
}

/** Default MeshCore lookup used by App / shortcuts / composer. */
export function resolveMeshcoreRoomNodeIdDefault(
  identityId: string,
  roomPubKeyHex: string,
): number | undefined {
  return resolveMeshcoreRoomNodeId(identityId, roomPubKeyHex);
}
