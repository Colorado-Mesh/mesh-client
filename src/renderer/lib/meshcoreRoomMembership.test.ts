import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildMeshcoreRoomMembershipContext,
  isMeshcoreRoomJoined,
  type MeshcoreRoomMembershipContext,
  meshcoreRoomPostCountsFromMessages,
  partitionMeshcoreRoomServers,
} from './meshcoreRoomMembership';
import type { ChatMessage, MeshNode } from './types';

vi.mock('./meshcoreRoomCredentialStorage', () => ({
  meshcoreRoomHasSavedGuestCredential: vi.fn(() => false),
}));

vi.mock('./meshcoreRoomSession', () => ({
  meshcoreIsRoomLoggedIn: vi.fn(() => false),
}));

vi.mock('./meshcoreRoomSyncStorage', () => ({
  getMeshcoreRoomLastPostAt: vi.fn(() => null),
  getMeshcoreRoomSyncConfig: vi.fn(() => ({
    enabled: false,
    intervalMinutes: 30,
    lastSyncAt: null,
    autoLoginOnConnect: false,
  })),
}));

import { meshcoreRoomHasSavedGuestCredential } from './meshcoreRoomCredentialStorage';
import { meshcoreIsRoomLoggedIn } from './meshcoreRoomSession';
import { getMeshcoreRoomLastPostAt, getMeshcoreRoomSyncConfig } from './meshcoreRoomSyncStorage';

function room(nodeId: number, favorited = false): MeshNode {
  return {
    node_id: nodeId,
    long_name: `Room ${nodeId}`,
    short_name: `R${nodeId}`,
    hw_model: 'Room',
    favorited,
    last_heard: 0,
  } as MeshNode;
}

function noneCtx(
  overrides: Partial<MeshcoreRoomMembershipContext> = {},
): MeshcoreRoomMembershipContext {
  return {
    isLoggedIn: () => false,
    hasSavedGuestCredential: () => false,
    isFavorited: () => false,
    hasLocalPosts: () => false,
    hasLastRead: () => false,
    isAutoSyncEnabled: () => false,
    isAutoLoginOnConnect: () => false,
    ...overrides,
  };
}

describe('isMeshcoreRoomJoined', () => {
  it('rejects non-positive ids', () => {
    expect(isMeshcoreRoomJoined(0, noneCtx({ isLoggedIn: () => true }))).toBe(false);
  });

  it.each([
    ['session', { isLoggedIn: () => true }],
    ['credential', { hasSavedGuestCredential: () => true }],
    ['favorite', { isFavorited: () => true }],
    ['posts', { hasLocalPosts: () => true }],
    ['lastRead', { hasLastRead: () => true }],
    ['autoSync', { isAutoSyncEnabled: () => true }],
    ['autoLogin', { isAutoLoginOnConnect: () => true }],
  ] as const)('is true for %s', (_label, override) => {
    expect(isMeshcoreRoomJoined(42, noneCtx(override))).toBe(true);
  });

  it('is false for a bare advert with no engage signals', () => {
    expect(isMeshcoreRoomJoined(42, noneCtx())).toBe(false);
  });
});

describe('partitionMeshcoreRoomServers', () => {
  it('splits Room nodes and ignores non-rooms', () => {
    const nodes = [room(1, true), room(2, false), { ...room(3), hw_model: 'Repeater' }];
    const { joined, discovered } = partitionMeshcoreRoomServers(
      nodes,
      noneCtx({
        isFavorited: (id) => id === 1,
      }),
    );
    expect(joined.map((n) => n.node_id)).toEqual([1]);
    expect(discovered.map((n) => n.node_id)).toEqual([2]);
  });
});

describe('meshcoreRoomPostCountsFromMessages', () => {
  it('counts by roomServerId', () => {
    const messages = [
      { roomServerId: 10, timestamp: 1 },
      { roomServerId: 10, timestamp: 2 },
      { roomServerId: 11, timestamp: 3 },
      { roomServerId: undefined, timestamp: 4 },
    ] as ChatMessage[];
    expect(meshcoreRoomPostCountsFromMessages(messages).get(10)).toBe(2);
    expect(meshcoreRoomPostCountsFromMessages(messages).get(11)).toBe(1);
  });
});

describe('buildMeshcoreRoomMembershipContext', () => {
  beforeEach(() => {
    vi.mocked(meshcoreRoomHasSavedGuestCredential).mockReturnValue(false);
    vi.mocked(meshcoreIsRoomLoggedIn).mockReturnValue(false);
    vi.mocked(getMeshcoreRoomLastPostAt).mockReturnValue(null);
    vi.mocked(getMeshcoreRoomSyncConfig).mockReturnValue({
      enabled: false,
      intervalMinutes: 30,
      lastSyncAt: null,
      autoLoginOnConnect: false,
    });
  });

  it('reads favorited, posts, last-read, and storage flags', () => {
    vi.mocked(meshcoreRoomHasSavedGuestCredential).mockImplementation((id) => id === 2);
    vi.mocked(getMeshcoreRoomSyncConfig).mockImplementation((id) => ({
      enabled: id === 3,
      intervalMinutes: 30,
      lastSyncAt: null,
      autoLoginOnConnect: id === 4,
    }));
    const ctx = buildMeshcoreRoomMembershipContext({
      nodes: [room(1, true), room(2), room(3), room(4), room(5)],
      messages: [{ roomServerId: 5, timestamp: 1 } as ChatMessage],
      roomsLastRead: { 5: 100 },
    });
    expect(isMeshcoreRoomJoined(1, ctx)).toBe(true);
    expect(isMeshcoreRoomJoined(2, ctx)).toBe(true);
    expect(isMeshcoreRoomJoined(3, ctx)).toBe(true);
    expect(isMeshcoreRoomJoined(4, ctx)).toBe(true);
    expect(isMeshcoreRoomJoined(5, ctx)).toBe(true);
    expect(isMeshcoreRoomJoined(99, ctx)).toBe(false);
  });

  it('treats stored last-post watermark as local posts', () => {
    vi.mocked(getMeshcoreRoomLastPostAt).mockImplementation((id) => (id === 7 ? 123 : null));
    const ctx = buildMeshcoreRoomMembershipContext({ nodes: [room(7)] });
    expect(isMeshcoreRoomJoined(7, ctx)).toBe(true);
  });
});
