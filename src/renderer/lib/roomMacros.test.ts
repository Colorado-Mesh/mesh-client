import { beforeEach, describe, expect, it } from 'vitest';

import { resolveMeshcoreRoomNodeId } from '@/renderer/lib/meshcoreRoomNodeLookup';
import {
  navigateRoomMacro,
  registerRoomMacroNavigator,
  resetRoomMacroNavigatorForTests,
  resolveRoomMacroPlan,
  type RoomMacroPlan,
} from '@/renderer/lib/roomMacros';
import { useNodeStore } from '@/renderer/stores/nodeStore';

describe('roomMacros registry', () => {
  beforeEach(() => {
    resetRoomMacroNavigatorForTests();
  });

  it('register → navigate returns true; unregister → false', () => {
    const seen: RoomMacroPlan[] = [];
    const unregister = registerRoomMacroNavigator((plan) => {
      seen.push(plan);
      return true;
    });
    const plan: RoomMacroPlan = {
      kind: 'rrc-room',
      protocol: 'reticulum',
      hubDestHash: 'aa',
      room: '#x',
    };
    expect(navigateRoomMacro(plan, 0)).toBe(true);
    expect(seen).toEqual([plan]);
    unregister();
    expect(navigateRoomMacro(plan, 1)).toBe(false);
  });
});

describe('resolveRoomMacroPlan', () => {
  it('returns meshcore plan when pubkey resolves', () => {
    const plan = resolveRoomMacroPlan(
      {
        kind: 'meshcore-room',
        identityId: 'mc1',
        roomPubKeyHex: 'ab'.repeat(32),
        label: 'Room',
      },
      {
        resolveMeshcoreRoomNodeId: (id, hex) =>
          id === 'mc1' && hex === 'ab'.repeat(32) ? 42 : undefined,
      },
    );
    expect(plan).toEqual({
      kind: 'meshcore-room',
      protocol: 'meshcore',
      identityId: 'mc1',
      roomNodeId: 42,
    });
  });

  it('returns null for unknown meshcore pubkey', () => {
    const plan = resolveRoomMacroPlan(
      {
        kind: 'meshcore-room',
        identityId: 'mc1',
        roomPubKeyHex: 'cd'.repeat(32),
        label: 'Gone',
      },
      { resolveMeshcoreRoomNodeId: () => undefined },
    );
    expect(plan).toBeNull();
  });

  it('resolves index-only chat channel targets when no live map is owned', () => {
    const plan = resolveRoomMacroPlan(
      {
        kind: 'meshcore-channel',
        identityId: 'mc1',
        channelIndex: 2,
        label: '#weather',
      },
      { resolveMeshcoreRoomNodeId: () => undefined },
    );
    expect(plan).toEqual({
      kind: 'meshcore-channel',
      protocol: 'meshcore',
      identityId: 'mc1',
      channelIndex: 2,
    });
  });

  it('returns null when a keyed channel target cannot resolve against a live map', () => {
    const plan = resolveRoomMacroPlan(
      {
        kind: 'meshcore-channel',
        identityId: 'mc1',
        channelIndex: 2,
        channelKey: 'missing-key',
        label: '#weather',
      },
      { resolveMeshcoreRoomNodeId: () => undefined },
    );
    expect(plan).toBeNull();
  });

  it('lowercases RRC hub hash', () => {
    const plan = resolveRoomMacroPlan(
      {
        kind: 'rrc-room',
        hubDestHash: 'AABBCC',
        room: '#weather',
        label: 'Wx',
      },
      { resolveMeshcoreRoomNodeId: () => undefined },
    );
    expect(plan).toEqual({
      kind: 'rrc-room',
      protocol: 'reticulum',
      hubDestHash: 'aabbcc',
      room: '#weather',
    });
  });
});

describe('resolveMeshcoreRoomNodeId lookup', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {} });
  });

  it('matches publicKey bytes and publicKeyHex', () => {
    const hex = '11'.repeat(32);
    const bytes = Uint8Array.from({ length: 32 }, () => 0x11);
    useNodeStore.setState({
      nodes: {
        mc1: {
          7: {
            nodeId: 7,
            publicKey: bytes,
            longName: 'A',
          },
          8: {
            nodeId: 8,
            publicKeyHex: hex.toUpperCase(),
            longName: 'B',
          },
        },
      },
    });
    expect(resolveMeshcoreRoomNodeId('mc1', hex)).toBe(7);
    expect(resolveMeshcoreRoomNodeId('mc1', '22'.repeat(32))).toBeUndefined();
    useNodeStore.setState({
      nodes: {
        mc1: {
          8: {
            nodeId: 8,
            publicKeyHex: hex.toUpperCase(),
            longName: 'B',
          },
        },
      },
    });
    expect(resolveMeshcoreRoomNodeId('mc1', hex)).toBe(8);
  });
});
