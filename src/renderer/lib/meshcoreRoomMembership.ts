import { meshcoreRoomHasSavedGuestCredential } from './meshcoreRoomCredentialStorage';
import { meshcoreIsRoomLoggedIn } from './meshcoreRoomSession';
import { getMeshcoreRoomLastPostAt, getMeshcoreRoomSyncConfig } from './meshcoreRoomSyncStorage';
import type { ChatMessage, MeshNode } from './types';

/** Injectable signals for Chat Rooms vs Network Room servers partition. */
export interface MeshcoreRoomMembershipContext {
  isLoggedIn: (nodeId: number) => boolean;
  hasSavedGuestCredential: (nodeId: number) => boolean;
  isFavorited: (nodeId: number) => boolean;
  hasLocalPosts: (nodeId: number) => boolean;
  hasLastRead: (nodeId: number) => boolean;
  isAutoSyncEnabled: (nodeId: number) => boolean;
  isAutoLoginOnConnect: (nodeId: number) => boolean;
}

/**
 * Engaged / joined room: persistent relationship or an active BBS session.
 * Bare mesh adverts without these signals stay on Network → Room servers.
 */
export function isMeshcoreRoomJoined(nodeId: number, ctx: MeshcoreRoomMembershipContext): boolean {
  if (!Number.isInteger(nodeId) || nodeId <= 0) return false;
  return (
    ctx.isLoggedIn(nodeId) ||
    ctx.hasSavedGuestCredential(nodeId) ||
    ctx.isFavorited(nodeId) ||
    ctx.hasLocalPosts(nodeId) ||
    ctx.hasLastRead(nodeId) ||
    ctx.isAutoSyncEnabled(nodeId) ||
    ctx.isAutoLoginOnConnect(nodeId)
  );
}

export function partitionMeshcoreRoomServers(
  rooms: readonly MeshNode[],
  ctx: MeshcoreRoomMembershipContext,
): { joined: MeshNode[]; discovered: MeshNode[] } {
  const joined: MeshNode[] = [];
  const discovered: MeshNode[] = [];
  for (const room of rooms) {
    if (room.hw_model !== 'Room') continue;
    if (isMeshcoreRoomJoined(room.node_id, ctx)) joined.push(room);
    else discovered.push(room);
  }
  return { joined, discovered };
}

/** Count local BBS posts per room server id (any status). */
export function meshcoreRoomPostCountsFromMessages(
  messages: readonly ChatMessage[],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const m of messages) {
    if (m.roomServerId == null) continue;
    counts.set(m.roomServerId, (counts.get(m.roomServerId) ?? 0) + 1);
  }
  return counts;
}

export interface BuildMeshcoreRoomMembershipContextOpts {
  nodes: Iterable<MeshNode>;
  messages?: readonly ChatMessage[];
  roomsLastRead?: Readonly<Record<number, number>>;
  /** Override session check (tests). Defaults to `meshcoreIsRoomLoggedIn`. */
  isLoggedIn?: (nodeId: number) => boolean;
  /** Override credential check (e.g. in-memory storedRoomIds). */
  hasSavedGuestCredential?: (nodeId: number) => boolean;
}

/** Live membership context from nodes, messages, last-read, and room storage. */
export function buildMeshcoreRoomMembershipContext(
  opts: BuildMeshcoreRoomMembershipContextOpts,
): MeshcoreRoomMembershipContext {
  const favorited = new Set<number>();
  for (const n of opts.nodes) {
    if (n.hw_model === 'Room' && n.favorited) favorited.add(n.node_id);
  }
  const postCounts = meshcoreRoomPostCountsFromMessages(opts.messages ?? []);
  const lastRead = opts.roomsLastRead ?? {};
  const isLoggedIn = opts.isLoggedIn ?? meshcoreIsRoomLoggedIn;
  const hasSavedGuestCredential =
    opts.hasSavedGuestCredential ?? meshcoreRoomHasSavedGuestCredential;

  return {
    isLoggedIn,
    hasSavedGuestCredential,
    isFavorited: (nodeId) => favorited.has(nodeId),
    hasLocalPosts: (nodeId) =>
      (postCounts.get(nodeId) ?? 0) > 0 || getMeshcoreRoomLastPostAt(nodeId) != null,
    hasLastRead: (nodeId) => (lastRead[nodeId] ?? 0) > 0,
    isAutoSyncEnabled: (nodeId) => getMeshcoreRoomSyncConfig(nodeId).enabled,
    isAutoLoginOnConnect: (nodeId) => getMeshcoreRoomSyncConfig(nodeId).autoLoginOnConnect === true,
  };
}
