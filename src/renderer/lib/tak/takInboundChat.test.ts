import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TAKInboundChat } from '@/shared/tak-types';

import { getTakChannels, setTakChannels, useTakChannelStore } from '../../stores/takChannelStore';
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

const NOW = Date.parse('2026-10-11T12:00:00Z');
const OPS = '0123456789abcdef';
const OTHER = 'fedcba9876543210';

/** An inbound TAK chat message with overridable fields. */
function message(overrides: Partial<TAKInboundChat> = {}): TAKInboundChat {
  return {
    channelKey: OPS,
    senderCallsign: 'VIPER',
    text: 'on scene',
    clientId: 'client-1',
    timeMs: NOW,
    ...overrides,
  };
}

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
  setChatChannel(identityId, index, true);
  setChatSend(identityId, index, send);
}

beforeEach(() => {
  resetTakEchoForTests();
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  useTakChannelStore.setState({ channelsByIdentity: {} });
});

afterEach(() => {
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  useTakChannelStore.setState({ channelsByIdentity: {} });
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
    expect(findTakSendTargets(OPS)).toEqual([
      { identityId: 'mc', protocol: 'meshcore', channelIndex: 2 },
      { identityId: 'mc2', protocol: 'meshcore', channelIndex: 5 },
    ]);
  });

  it('finds nothing for a receive-only channel, an unserved one, or an unknown key', () => {
    serve('mc', 'meshcore', 2, OPS, false);
    setTakChannels('mt', [
      { protocol: 'meshtastic', index: 1, key: OTHER, name: 'x', atakName: '#MT x' },
    ]);
    useTakRelayPrefsStore.getState().setChatSend('mt', 1, true);
    expect(findTakSendTargets(OPS)).toEqual([]);
    expect(findTakSendTargets(OTHER)).toEqual([]);
    expect(findTakSendTargets('0000000000000000')).toEqual([]);
  });
});

describe('relayTakChatToMesh', () => {
  it('sends nothing for a channel that does not allow sending', async () => {
    serve('mc', 'meshcore', 2, OPS, false);
    const send = vi.fn<TakMeshSendFn>().mockResolvedValue(undefined);
    expect(await relayTakChatToMesh(message(), send, NOW)).toBe(0);
    expect(await relayTakChatToMesh(message({ channelKey: OTHER }), send, NOW)).toBe(0);
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
