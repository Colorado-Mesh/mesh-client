import { resolveMeshcoreRoomNodeId } from '@/renderer/lib/meshcoreRoomNodeLookup';
import { resolveChannelTargetIndex } from '@/renderer/lib/scheduledBroadcasts/resolveChannelTarget';
import { ROOM_MACRO_TEXT_APPLY_TTL_MS } from '@/renderer/lib/timeConstants';
import { type RoomMacroTarget, useChatMacrosStore } from '@/renderer/stores/chatMacrosStore';
import { getConnection } from '@/renderer/stores/connectionStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';
import { getLiveChannelKeys } from '@/renderer/stores/liveChannelKeyStore';

export { ROOM_MACRO_TEXT_APPLY_TTL_MS };

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
  // New jump invalidates any prior queued text so a later destination cannot consume it.
  roomMacroJumpId += 1;
  clearPendingRoomMacroTextApply(true);
  if (!navigatorFn) return false;
  return navigatorFn(plan, slotIndex);
}

export function resetRoomMacroNavigatorForTests(): void {
  navigatorFn = null;
}

/**
 * Session-only: after a room jump, destination composers consume this to insert/send text.
 * `text` is captured at queue time so later slot edits cannot change what applies.
 * `jumpId` scopes the record to one navigation; `expiresAt` drops stale queues.
 */
export interface PendingRoomMacroTextApply {
  slotIndex: number;
  plan: RoomMacroPlan;
  text: string;
  jumpId: number;
  expiresAt: number;
}

export type RoomMacroPlanMatcher = (plan: RoomMacroPlan) => boolean;

let pendingTextApply: PendingRoomMacroTextApply | null = null;
let roomMacroJumpId = 0;
const textApplyListeners = new Set<() => void>();

function notifyRoomMacroTextApplyListeners(): void {
  for (const listener of textApplyListeners) listener();
}

function clearPendingRoomMacroTextApply(notify: boolean): void {
  if (!pendingTextApply) return;
  pendingTextApply = null;
  if (notify) notifyRoomMacroTextApplyListeners();
}

function dropExpiredPendingRoomMacroTextApply(): void {
  if (!pendingTextApply) return;
  if (Date.now() <= pendingTextApply.expiresAt) return;
  clearPendingRoomMacroTextApply(true);
}

/**
 * Queue optional post-jump text for `slotIndex` when the slot has non-empty text.
 * Captures the trimmed text at queue time. Replaces any prior pending apply.
 * No-op when the slot text is blank (prior pending already cleared by navigate).
 */
export function queueRoomMacroTextApply(slotIndex: number, plan: RoomMacroPlan): void {
  const text = useChatMacrosStore.getState().slots[slotIndex]?.text.trim() ?? '';
  if (text === '') return;
  pendingTextApply = {
    slotIndex,
    plan,
    text,
    jumpId: roomMacroJumpId,
    expiresAt: Date.now() + ROOM_MACRO_TEXT_APPLY_TTL_MS,
  };
  notifyRoomMacroTextApplyListeners();
}

/**
 * Re-queue a taken pending apply (e.g. composer rejected the text — keep for retry).
 * Pass `{ notify: false }` when restoring inside a subscribe listener to avoid re-entry.
 */
export function restorePendingRoomMacroTextApply(
  pending: PendingRoomMacroTextApply,
  opts?: { notify?: boolean },
): void {
  pendingTextApply = {
    ...pending,
    expiresAt: Date.now() + ROOM_MACRO_TEXT_APPLY_TTL_MS,
  };
  if (opts?.notify !== false) notifyRoomMacroTextApplyListeners();
}

export function subscribeRoomMacroTextApply(listener: () => void): () => void {
  textApplyListeners.add(listener);
  return () => {
    textApplyListeners.delete(listener);
  };
}

export function peekPendingRoomMacroTextApply(): PendingRoomMacroTextApply | null {
  dropExpiredPendingRoomMacroTextApply();
  return pendingTextApply;
}

/**
 * Take and clear the pending apply when `matcher` accepts its plan; otherwise leave it.
 * Returns the captured text + slot (not a live slot re-read). Rejects expired / mismatched.
 */
export function takePendingRoomMacroTextApplyIfMatch(
  matcher: RoomMacroPlanMatcher,
): PendingRoomMacroTextApply | null {
  dropExpiredPendingRoomMacroTextApply();
  if (!pendingTextApply || !matcher(pendingTextApply.plan)) return null;
  const taken = pendingTextApply;
  pendingTextApply = null;
  return taken;
}

export function resetRoomMacroTextApplyForTests(): void {
  pendingTextApply = null;
  roomMacroJumpId = 0;
  textApplyListeners.clear();
}

/** Navigate, then queue post-jump text when the slot has any. Returns navigate success. */
export function navigateRoomMacroAndMaybeQueueText(
  plan: RoomMacroPlan,
  slotIndex: number,
): boolean {
  if (!navigateRoomMacro(plan, slotIndex)) return false;
  queueRoomMacroTextApply(slotIndex, plan);
  return true;
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
