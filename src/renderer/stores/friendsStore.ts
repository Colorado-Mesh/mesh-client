import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { MeshProtocol } from '@/renderer/lib/types';

import { omitRecordKey } from './storeUtils';

export const FRIENDS_STORAGE_KEY = 'mesh-client:friends';

/** Friend peer ids keyed by protocol identity id. */
export type FriendsByIdentity = Record<string, number[]>;

interface FriendsPersisted {
  byIdentity: FriendsByIdentity;
}

interface FriendsState extends FriendsPersisted {
  addFriend: (identityId: string, nodeId: number) => void;
  removeFriend: (identityId: string, nodeId: number) => void;
  isFriend: (identityId: string, nodeId: number) => boolean;
  listFriends: (identityId: string) => number[];
}

function sanitizeNodeId(nodeId: number): number | null {
  if (!Number.isInteger(nodeId) || nodeId <= 0) return null;
  return nodeId >>> 0;
}

function sanitizeByIdentity(raw: unknown): FriendsByIdentity {
  if (raw === null || typeof raw !== 'object') return {};
  const out: FriendsByIdentity = {};
  for (const [identityId, peers] of Object.entries(raw as Record<string, unknown>)) {
    if (!identityId.trim() || !Array.isArray(peers)) continue;
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const peer of peers) {
      if (typeof peer !== 'number') continue;
      const id = sanitizeNodeId(peer);
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length > 0) out[identityId] = ids;
  }
  return out;
}

export const useFriendsStore = create<FriendsState>()(
  persist(
    (set, get) => ({
      byIdentity: {},
      addFriend: (identityId, nodeId) => {
        const id = sanitizeNodeId(nodeId);
        if (!identityId.trim() || id == null) return;
        set((s) => {
          const prev = s.byIdentity[identityId] ?? [];
          if (prev.includes(id)) return s;
          return {
            byIdentity: { ...s.byIdentity, [identityId]: [...prev, id] },
          };
        });
      },
      removeFriend: (identityId, nodeId) => {
        const id = sanitizeNodeId(nodeId);
        if (!identityId.trim() || id == null) return;
        set((s) => {
          const prev = s.byIdentity[identityId];
          if (!prev?.includes(id)) return s;
          const next = prev.filter((n) => n !== id);
          if (next.length === 0) {
            return { byIdentity: omitRecordKey(s.byIdentity, identityId) };
          }
          return { byIdentity: { ...s.byIdentity, [identityId]: next } };
        });
      },
      isFriend: (identityId, nodeId) => {
        const id = sanitizeNodeId(nodeId);
        if (!identityId.trim() || id == null) return false;
        return (get().byIdentity[identityId] ?? []).includes(id);
      },
      listFriends: (identityId) => {
        if (!identityId.trim()) return [];
        return get().byIdentity[identityId] ?? [];
      },
    }),
    {
      name: FRIENDS_STORAGE_KEY,
      version: 1,
      partialize: (s): FriendsPersisted => ({ byIdentity: s.byIdentity }),
      merge: (persisted, current) => {
        const raw =
          persisted && typeof persisted === 'object'
            ? (persisted as { byIdentity?: unknown }).byIdentity
            : undefined;
        return { ...current, byIdentity: sanitizeByIdentity(raw) };
      },
    },
  ),
);

export function resetFriendsStoreForTests(): void {
  useFriendsStore.setState({ byIdentity: {} });
}

/** Friend node-id set for an identity (empty when missing). */
export function friendNodeIdSet(identityId: string | null | undefined): Set<number> {
  if (!identityId) return new Set();
  return new Set(useFriendsStore.getState().listFriends(identityId));
}

/** Touch helper so callers can depend on friend list revision in useMemo. */
export function friendsListKey(identityId: string | null | undefined): string {
  if (!identityId) return '';
  return useFriendsStore.getState().listFriends(identityId).join(',');
}

export type FriendsProtocol = MeshProtocol;
