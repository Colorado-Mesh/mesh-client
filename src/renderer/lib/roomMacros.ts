import { resolveMeshcoreRoomNodeId } from '@/renderer/lib/meshcoreRoomNodeLookup';
import type { RoomMacroTarget } from '@/renderer/stores/chatMacrosStore';

export type RoomMacroPlan =
  | { protocol: 'meshcore'; identityId: string; roomNodeId: number }
  | { protocol: 'reticulum'; hubDestHash: string; room: string };

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

/** Pure: target → plan (null when the room cannot be resolved right now). */
export function resolveRoomMacroPlan(
  target: RoomMacroTarget,
  deps: RoomMacroResolveDeps,
): RoomMacroPlan | null {
  if (target.kind === 'meshcore-room') {
    const roomNodeId = deps.resolveMeshcoreRoomNodeId(target.identityId, target.roomPubKeyHex);
    if (roomNodeId == null) return null;
    return { protocol: 'meshcore', identityId: target.identityId, roomNodeId };
  }
  return {
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
