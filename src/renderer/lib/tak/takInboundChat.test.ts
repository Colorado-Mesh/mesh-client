import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeshProtocol } from '@/shared/meshProtocol';
import type { TAKInboundChat } from '@/shared/tak-types';

import {
  getTakChannels,
  setTakChannels,
  setTakRadio,
  useTakChannelStore,
} from '../../stores/takChannelStore';
import { useTakRelayPrefsStore } from '../../stores/takRelayPrefsStore';
import { consumeTakEcho, resetTakEchoForTests } from './takEchoGuard';
import {
  enqueueTakChatRelay,
  findTakSendTargets,
  formatTakMeshText,
  relayTakChatToMesh,
  TAK_MESH_SEND_MAX_BYTES,
  TAK_MESH_SEND_TIMEOUT_MS,
  type TakMeshSendFn,
} from './takInboundChat';

/** The identity each protocol's tab uses now, as the identity store resolves it. */
const currentIdentity: Partial<Record<MeshProtocol, string>> = {
  meshcore: 'mc',
  meshtastic: 'mt',
  reticulum: 'rn',
};
/** Reticulum peers whose LXMF destination is known under their own node id. */
const ownLxmf = new Set<number>();
vi.mock('./takDirectMessages', () => ({
  hasOwnLxmfDestination: (nodeId: number) => ownLxmf.has(nodeId),
}));

vi.mock('../identityByProtocol', () => ({
  getIdentityIdForProtocol: (protocol: MeshProtocol) => currentIdentity[protocol] ?? null,
}));

const NOW = Date.parse('2026-10-11T12:00:00Z');
const OPS = '0123456789abcdef';
const OTHER = 'fedcba9876543210';

/** An inbound TAK chat message with overridable fields. */
function message(overrides: Partial<TAKInboundChat> = {}): TAKInboundChat {
  return {
    target: { kind: 'channel', channelKey: OPS },
    senderCallsign: 'VIPER',
    text: 'on scene',
    clientId: 'client-1',
    timeMs: NOW,
    ...overrides,
  };
}

const channel = (channelKey: string) => ({ kind: 'channel' as const, channelKey });
const direct = (protocol: 'meshcore' | 'meshtastic', nodeId: number) => ({
  kind: 'direct' as const,
  protocol,
  nodeId,
});

/** Serve one channel of a radio to TAK, with sending allowed or not. */
function serve(
  identityId: string,
  protocol: 'meshcore' | 'meshtastic',
  index: number,
  key: string,
  send: boolean,
): void {
  setTakChannels(identityId, [
    ...getTakChannels(identityId),
    { protocol, index, key, name: `Ch ${index}`, atakName: `#Ch ${index}` },
  ]);
  const { setChannelMode, setChatChannel, setChatSend } = useTakRelayPrefsStore.getState();
  setChannelMode(identityId, 'selected');
  setChatChannel(identityId, key, true);
  setChatSend(identityId, key, send);
}

beforeEach(() => {
  resetTakEchoForTests();
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  useTakChannelStore.setState({ channelsByIdentity: {}, radioByProtocol: {} });
});

afterEach(() => {
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  useTakChannelStore.setState({ channelsByIdentity: {}, radioByProtocol: {} });
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
  it('returns the served channel with that key that allows sending, on every radio serving it', () => {
    serve('mc', 'meshcore', 2, OPS, true);
    serve('mc', 'meshcore', 3, OTHER, true);
    serve('mc2', 'meshcore', 5, OPS, true);
    serve('mt', 'meshtastic', 0, OPS, false);
    expect(findTakSendTargets(channel(OPS))).toEqual([
      { identityId: 'mc', protocol: 'meshcore', channelIndex: 2 },
      { identityId: 'mc2', protocol: 'meshcore', channelIndex: 5 },
    ]);
  });

  it('finds nothing for a receive-only channel, an unserved one, or an unknown key', () => {
    serve('mc', 'meshcore', 2, OPS, false);
    setTakChannels('mt', [
      { protocol: 'meshtastic', index: 1, key: OTHER, name: 'x', atakName: '#MT x' },
    ]);
    useTakRelayPrefsStore.getState().setChatSend('mt', OTHER, true);
    expect(findTakSendTargets(channel(OPS))).toEqual([]);
    expect(findTakSendTargets(channel(OTHER))).toEqual([]);
    expect(findTakSendTargets(channel('0000000000000000'))).toEqual([]);
  });
});

describe('relayTakChatToMesh', () => {
  it('sends nothing for a channel that does not allow sending', async () => {
    serve('mc', 'meshcore', 2, OPS, false);
    const send = vi.fn<TakMeshSendFn>().mockResolvedValue(undefined);
    expect(await relayTakChatToMesh(message(), send, NOW)).toBe(0);
    expect(await relayTakChatToMesh(message({ target: channel(OTHER) }), send, NOW)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('transmits the prefixed text on each radio serving the channel and remembers it as an echo', async () => {
    serve('mc', 'meshcore', 2, OPS, true);
    serve('mc2', 'meshcore', 0, OPS, true);
    const send = vi.fn<TakMeshSendFn>().mockResolvedValue(undefined);

    expect(await relayTakChatToMesh(message(), send, NOW)).toBe(2);

    expect(send).toHaveBeenCalledWith(
      { identityId: 'mc', protocol: 'meshcore', channelIndex: 2 },
      '[VIPER] on scene',
    );
    expect(send).toHaveBeenCalledWith(
      { identityId: 'mc2', protocol: 'meshcore', channelIndex: 0 },
      '[VIPER] on scene',
    );
    expect(consumeTakEcho('mc', 2, '[VIPER] on scene', NOW + 1000)).toBe(true);
    expect(consumeTakEcho('mc2', 0, '[VIPER] on scene', NOW + 1000)).toBe(true);
  });

  it('keeps going when one channel fails and forgets the echo for the failed send', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    serve('mc', 'meshcore', 2, OPS, true);
    serve('mc2', 'meshcore', 0, OPS, true);
    const send = vi
      .fn<TakMeshSendFn>()
      .mockRejectedValueOnce(new Error('MeshCore not connected'))
      .mockResolvedValue(undefined);

    expect(await relayTakChatToMesh(message(), send, NOW)).toBe(1);

    expect(send).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mesh send failed'));
    expect(consumeTakEcho('mc', 2, '[VIPER] on scene', NOW + 1000)).toBe(false);
    expect(consumeTakEcho('mc2', 0, '[VIPER] on scene', NOW + 1000)).toBe(true);
    warn.mockRestore();
  });
});

describe('enqueueTakChatRelay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('finishes each message before starting the next, in arrival order', async () => {
    serve('mc', 'meshcore', 2, OPS, true);
    const started: string[] = [];
    const releases: (() => void)[] = [];
    const send: TakMeshSendFn = (_target, text) =>
      new Promise<void>((resolve) => {
        started.push(text);
        releases.push(resolve);
      });

    const first = enqueueTakChatRelay(message({ text: 'one' }), send);
    const second = enqueueTakChatRelay(message({ text: 'two' }), send);
    await vi.waitFor(() => {
      expect(started).toEqual(['[VIPER] one']);
    });

    releases[0]?.();
    expect(await first).toBe(1);
    await vi.waitFor(() => {
      expect(started).toEqual(['[VIPER] one', '[VIPER] two']);
    });
    releases[1]?.();
    expect(await second).toBe(1);
  });

  it('times out a send that never settles and carries on with the next message', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    serve('mc', 'meshcore', 2, OPS, true);
    const send = vi
      .fn<TakMeshSendFn>()
      .mockImplementationOnce(() => new Promise<void>(() => {}))
      .mockResolvedValue(undefined);

    const hung = enqueueTakChatRelay(message({ text: 'stuck' }), send);
    const next = enqueueTakChatRelay(message({ text: 'after' }), send);
    await vi.advanceTimersByTimeAsync(TAK_MESH_SEND_TIMEOUT_MS + 1);

    expect(await hung).toBe(0);
    expect(await next).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mesh send timed out'));
    expect(consumeTakEcho('mc', 2, '[VIPER] stuck')).toBe(false);
    warn.mockRestore();
  });
});

describe('direct messages from TAK', () => {
  it("goes to the companion on the protocol's TAK radio when it has direct messages on", () => {
    setTakRadio('meshcore', 'mc');
    setTakRadio('meshtastic', 'mt');
    useTakRelayPrefsStore.getState().setDirectMessages('mc', true);
    expect(findTakSendTargets(direct('meshcore', 123))).toEqual([
      { identityId: 'mc', protocol: 'meshcore', channelIndex: 0, destination: 123 },
    ]);
    // Direct messages are off for the Meshtastic radio, and there may be no radio at all.
    expect(findTakSendTargets(direct('meshtastic', 456))).toEqual([]);
    setTakRadio('meshcore', null);
    expect(findTakSendTargets(direct('meshcore', 123))).toEqual([]);
  });

  it('sends to a Reticulum peer only while its LXMF destination is its own', () => {
    setTakRadio('reticulum', 'rn');
    useTakRelayPrefsStore.getState().setDirectMessages('rn', true);
    const peer = { kind: 'direct' as const, protocol: 'reticulum' as const, nodeId: 789 };
    ownLxmf.add(789);
    expect(findTakSendTargets(peer)).toEqual([
      { identityId: 'rn', protocol: 'reticulum', channelIndex: 0, destination: 789 },
    ]);
    // Its address now remaps to another destination: nothing is sent.
    ownLxmf.delete(789);
    expect(findTakSendTargets(peer)).toEqual([]);
  });

  it('sends nothing while the recorded radio is no longer the one in use for the protocol', () => {
    setTakRadio('meshcore', 'mc');
    useTakRelayPrefsStore.getState().setDirectMessages('mc', true);
    // Another MeshCore radio has just become active; the recorded radio catches up a render later.
    currentIdentity.meshcore = 'mc-2';
    expect(findTakSendTargets(direct('meshcore', 123))).toEqual([]);
    currentIdentity.meshcore = 'mc';
    expect(findTakSendTargets(direct('meshcore', 123))).toHaveLength(1);
  });

  it('sends the prefixed text as a direct message, with no echo to wait for', async () => {
    setTakRadio('meshtastic', 'mt');
    useTakRelayPrefsStore.getState().setDirectMessages('mt', true);
    const send = vi.fn<TakMeshSendFn>().mockResolvedValue(undefined);
    expect(
      await relayTakChatToMesh(message({ target: direct('meshtastic', 456) }), send, NOW),
    ).toBe(1);
    expect(send).toHaveBeenCalledWith(
      { identityId: 'mt', protocol: 'meshtastic', channelIndex: 0, destination: 456 },
      '[VIPER] on scene',
    );
    expect(consumeTakEcho('mt', 0, '[VIPER] on scene', NOW + 1000)).toBe(false);
  });

  describe('outcomes', () => {
    const DM_REF = '0c2f8e1a-5b3d-4c7e-9a10-2b4d6f8a0c1e';
    const dmStatus = vi.fn().mockResolvedValue(undefined);
    beforeEach(() => {
      dmStatus.mockClear();
      vi.stubGlobal('window', { electronAPI: { tak: { dmStatus } } });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('hands the message reference on to the send, for its outcome', async () => {
      setTakRadio('meshtastic', 'mt');
      useTakRelayPrefsStore.getState().setDirectMessages('mt', true);
      const send = vi.fn<TakMeshSendFn>().mockResolvedValue(undefined);
      await relayTakChatToMesh(
        message({ target: direct('meshtastic', 456), dmRef: DM_REF }),
        send,
        NOW,
      );
      expect(send.mock.calls[0]?.[0]).toMatchObject({ destination: 456, dmRef: DM_REF });
      expect(dmStatus).not.toHaveBeenCalled();
    });

    it('reports a direct message not sent when the send fails or no radio can send it', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setTakRadio('meshtastic', 'mt');
      useTakRelayPrefsStore.getState().setDirectMessages('mt', true);
      const failing = vi.fn<TakMeshSendFn>().mockRejectedValue(new Error('rf down'));
      const msg = message({ target: direct('meshtastic', 456), dmRef: DM_REF });
      expect(await relayTakChatToMesh(msg, failing, NOW)).toBe(0);
      expect(dmStatus).toHaveBeenLastCalledWith({ dmRef: DM_REF, outcome: 'not-sent' });

      dmStatus.mockClear();
      useTakRelayPrefsStore.getState().setDirectMessages('mt', false);
      expect(await relayTakChatToMesh(msg, failing, NOW)).toBe(0);
      expect(dmStatus).toHaveBeenCalledWith({ dmRef: DM_REF, outcome: 'not-sent' });
      warn.mockRestore();
    });
  });
});
