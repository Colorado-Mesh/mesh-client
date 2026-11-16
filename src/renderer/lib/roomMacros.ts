import { resolveMeshcoreRoomNodeId } from '@/renderer/lib/meshcoreRoomNodeLookup';
import { resolveChannelTargetIndex } from '@/renderer/lib/scheduledBroadcasts/resolveChannelTarget';
import type { RoomMacroTarget } from '@/renderer/stores/chatMacrosStore';

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
    const resolved = resolveChannelTargetIndex(target);
    const channelIndex = resolved.ok ? resolved.channelIndex : target.channelIndex;
    if (!Number.isInteger(channelIndex) || channelIndex < 0) return null;
    return {
      kind: 'meshcore-channel',
      protocol: 'meshcore',
      identityId: target.identityId,
      channelIndex,
    };
  }
  if (target.kind === 'meshtastic-channel') {
    const resolved = resolveChannelTargetIndex(target);
    const channelIndex = resolved.ok ? resolved.channelIndex : target.channelIndex;
    if (!Number.isInteger(channelIndex) || channelIndex < 0) return null;
    return {
      kind: 'meshtastic-channel',
      protocol: 'meshtastic',
      identityId: target.identityId,
      channelIndex,
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
