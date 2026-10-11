import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TAKInboundChat } from '@/shared/tak-types';

import { type IdentityRecord, useIdentityStore } from '../../stores/identityStore';
import { useTakRelayPrefsStore } from '../../stores/takRelayPrefsStore';
import { consumeTakEcho, resetTakEchoForTests } from './takEchoGuard';
import {
  findTakSendTargets,
  formatTakMeshText,
  relayTakChatToMesh,
  TAK_MESH_SEND_MAX_BYTES,
  type TakMeshSendFn,
} from './takInboundChat';

const NOW = Date.parse('2026-10-11T12:00:00Z');

function identity(id: string, type: string): IdentityRecord {
  return { id, protocol: { type }, signature: id, transports: [] } as unknown as IdentityRecord;
}

function message(overrides: Partial<TAKInboundChat> = {}): TAKInboundChat {
  return {
    room: 'Mesh Ops',
    senderCallsign: 'VIPER',
    text: 'on scene',
    clientId: 'client-1',
    timeMs: NOW,
    ...overrides,
  };
}

function bridge(identityId: string, channel: number, room: string, send: boolean): void {
  const { setChatBridge, setChatSend } = useTakRelayPrefsStore.getState();
  setChatBridge(identityId, channel, room);
  setChatSend(identityId, channel, send);
}

beforeEach(() => {
  resetTakEchoForTests();
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  useIdentityStore.setState({
    identities: {
      mc: identity('mc', 'meshcore'),
      mt: identity('mt', 'meshtastic'),
      rn: identity('rn', 'reticulum'),
    },
    activeIdentityId: null,
  });
});

afterEach(() => {
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  useIdentityStore.setState({ identities: {}, activeIdentityId: null });
});

describe('formatTakMeshText', () => {
  it('prefixes the sender callsign', () => {
    expect(formatTakMeshText(' VIPER ', '  on scene ')).toBe('[VIPER] on scene');
  });

  it('cuts an overlong message to the byte budget with an ellipsis', () => {
    const out = formatTakMeshText('VIPER', 'x'.repeat(500));
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(TAK_MESH_SEND_MAX_BYTES);
    expect(out.startsWith('[VIPER] xxx')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  it('never splits a multi-byte character', () => {
    const out = formatTakMeshText('V', '😀'.repeat(100), 40);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(40);
    expect(out).toMatch(/^\[V\] (😀)+…$/u);
  });
});

describe('findTakSendTargets', () => {
  it('returns bridged channels that allow sending, on every protocol that has them', () => {
    bridge('mc', 2, 'Mesh Ops', true);
    bridge('mc', 3, 'Mesh Ops', false);
    bridge('mc', 4, 'Other', true);
    bridge('mt', 0, 'Mesh Ops', true);
    bridge('rn', 1, 'Mesh Ops', true);
    expect(findTakSendTargets('Mesh Ops')).toEqual([
      { identityId: 'mc', protocol: 'meshcore', channelIndex: 2 },
      { identityId: 'mt', protocol: 'meshtastic', channelIndex: 0 },
    ]);
  });

  it('matches the room name exactly', () => {
    bridge('mc', 2, 'Mesh Ops', true);
    expect(findTakSendTargets('mesh ops')).toEqual([]);
    expect(findTakSendTargets('Mesh')).toEqual([]);
  });

  it('ignores prefs for an identity that is no longer loaded', () => {
    bridge('gone', 2, 'Mesh Ops', true);
    expect(findTakSendTargets('Mesh Ops')).toEqual([]);
  });
});

describe('relayTakChatToMesh', () => {
  it('sends nothing for a room that is not bridged or does not allow sending', async () => {
    bridge('mc', 2, 'Mesh Ops', false);
    const send = vi.fn<TakMeshSendFn>().mockResolvedValue(undefined);
    expect(await relayTakChatToMesh(message(), send, NOW)).toBe(0);
    expect(await relayTakChatToMesh(message({ room: 'Elsewhere' }), send, NOW)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('transmits the prefixed text on each allowed channel and remembers it as an echo', async () => {
    bridge('mc', 2, 'Mesh Ops', true);
    bridge('mt', 0, 'Mesh Ops', true);
    const send = vi.fn<TakMeshSendFn>().mockResolvedValue(undefined);

    expect(await relayTakChatToMesh(message(), send, NOW)).toBe(2);

    expect(send).toHaveBeenCalledWith(
      { identityId: 'mc', protocol: 'meshcore', channelIndex: 2 },
      '[VIPER] on scene',
    );
    expect(send).toHaveBeenCalledWith(
      { identityId: 'mt', protocol: 'meshtastic', channelIndex: 0 },
      '[VIPER] on scene',
    );
    expect(consumeTakEcho('mc', 2, '[VIPER] on scene', NOW + 1000)).toBe(true);
    expect(consumeTakEcho('mt', 0, '[VIPER] on scene', NOW + 1000)).toBe(true);
  });

  it('keeps going when one channel fails and forgets the echo for the failed send', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge('mc', 2, 'Mesh Ops', true);
    bridge('mt', 0, 'Mesh Ops', true);
    const send = vi
      .fn<TakMeshSendFn>()
      .mockRejectedValueOnce(new Error('MeshCore not connected'))
      .mockResolvedValue(undefined);

    expect(await relayTakChatToMesh(message(), send, NOW)).toBe(1);

    expect(send).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mesh send failed'));
    expect(consumeTakEcho('mc', 2, '[VIPER] on scene', NOW + 1000)).toBe(false);
    expect(consumeTakEcho('mt', 0, '[VIPER] on scene', NOW + 1000)).toBe(true);
    warn.mockRestore();
  });
});
