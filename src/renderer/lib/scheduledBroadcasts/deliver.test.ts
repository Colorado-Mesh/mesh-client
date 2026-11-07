import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ScheduledBroadcastRow,
  ScheduledBroadcastTarget,
} from '@/shared/scheduledBroadcastTypes';

import { useConnectionStore } from '../../stores/connectionStore';
import { useNodeStore } from '../../stores/nodeStore';
import type * as ChatComposerLimits from '../chatComposerLimits';
import { MESHCORE_WIRE_MAX } from '../chatComposerLimits';
import { isMeshcoreSendTooFast, resetMeshcoreSendRateForTests } from '../meshcoreSendRateNotice';
import { SCHEDULED_BROADCAST_RUN_MAX_MS, SCHEDULED_BROADCAST_TARGET_GAP_MS } from './constants';
import { type DeliverDeps, deliverScheduledBroadcast } from './deliver';

const pacing = vi.hoisted(() => ({
  withMeshtasticTextSendPacing: vi.fn(<T>(send: () => Promise<T> | T) => Promise.resolve(send())),
}));
vi.mock('../meshtasticTextSendPacing', () => pacing);

vi.mock('../sendChatOnIdentity', () => ({ sendChatOnIdentity: vi.fn() }));

const splitSpy = vi.hoisted(() => vi.fn());
vi.mock('../chatComposerLimits', async (importOriginal) => ({
  ...(await importOriginal<typeof ChatComposerLimits>()),
  splitChatMessage: splitSpy,
}));

function target(over: Partial<ScheduledBroadcastTarget>): ScheduledBroadcastTarget {
  return {
    kind: 'meshtastic-channel',
    identityId: 'mt',
    label: 'Primary',
    enabled: true,
    channelIndex: 0,
    ...over,
  };
}

function slot(
  targets: ScheduledBroadcastTarget[],
  text = 'hello mesh',
): Pick<ScheduledBroadcastRow, 'text' | 'targets'> {
  return { text, targets };
}

interface Harness {
  deps: Partial<DeliverDeps>;
  sendChat: ReturnType<typeof vi.fn>;
  sendRoomPost: ReturnType<typeof vi.fn>;
  sendRrc: ReturnType<typeof vi.fn>;
  joinRrcRoom: ReturnType<typeof vi.fn>;
  sleep: ReturnType<typeof vi.fn>;
  clock: { now: number };
}

function harness(over: Partial<DeliverDeps> = {}): Harness {
  const clock = { now: 1_000_000 };
  const sendChat = vi.fn(() => 'msg-1');
  const sendRoomPost = vi.fn(() => Promise.resolve());
  const sendRrc = vi.fn(() => Promise.resolve({ ok: true }));
  const joinRrcRoom = vi.fn(() => Promise.resolve({ ok: true }));
  const sleep = vi.fn((ms: number) => {
    clock.now += ms;
    return Promise.resolve();
  });
  const deps: Partial<DeliverDeps> = {
    sendChat,
    waitForSettlement: vi.fn(() => Promise.resolve(true)),
    sendRoomPost,
    sendRrc,
    joinRrcRoom,
    getRrcHubRoomState: vi.fn(() => ({ active: true, joined: true })),
    isIdentityConnected: vi.fn(() => true),
    resolveRoomNodeId: vi.fn(() => 0xabcd),
    getSenderDisplayName: vi.fn(() => 'Alice'),
    now: () => clock.now,
    sleep,
    ...over,
  };
  return { deps, sendChat, sendRoomPost, sendRrc, joinRrcRoom, sleep, clock };
}

describe('deliverScheduledBroadcast', () => {
  beforeEach(() => {
    pacing.withMeshtasticTextSendPacing.mockClear();
    splitSpy.mockClear();
    resetMeshcoreSendRateForTests();
    useConnectionStore.setState({ connections: {} });
    useNodeStore.setState({ nodes: {} });
  });

  it('skips with no-targets when nothing is enabled', async () => {
    const h = harness();
    const r = await deliverScheduledBroadcast(slot([target({ enabled: false })]), h.deps);
    expect(r).toEqual({ outcome: 'skipped', targets: [], reason: 'no-targets' });
    expect(h.sendChat).not.toHaveBeenCalled();
  });

  it('skips with empty-text', async () => {
    const h = harness();
    const r = await deliverScheduledBroadcast(slot([target({})], '   '), h.deps);
    expect(r.reason).toBe('empty-text');
    expect(h.sendChat).not.toHaveBeenCalled();
  });

  it('sends a Meshtastic channel through pacing and settlement', async () => {
    const h = harness();
    const r = await deliverScheduledBroadcast(slot([target({ channelIndex: 2 })]), h.deps);
    expect(r.outcome).toBe('sent');
    expect(r.targets).toEqual([{ kind: 'meshtastic-channel', label: 'Primary', ok: true }]);
    expect(pacing.withMeshtasticTextSendPacing).toHaveBeenCalledTimes(1);
    expect(h.sendChat).toHaveBeenCalledWith('mt', { text: 'hello mesh', channelIndex: 2 });
  });

  it('never splits or chunks long text', async () => {
    const h = harness();
    const r = await deliverScheduledBroadcast(slot([target({})], 'x'.repeat(229)), h.deps);
    expect(r).toMatchObject({
      outcome: 'failed',
      targets: [{ ok: false, reason: 'text-too-long' }],
    });
    expect(h.sendChat).not.toHaveBeenCalled();
    expect(splitSpy).not.toHaveBeenCalled();
  });

  it('counts UTF-8 bytes, not characters, against the limit', async () => {
    const h = harness();
    // 100 × 3-byte chars = 300 bytes > 228
    const r = await deliverScheduledBroadcast(slot([target({})], '日'.repeat(100)), h.deps);
    expect(r.targets[0]?.reason).toBe('text-too-long');
  });

  it('reports not-connected as skipped without sending', async () => {
    const h = harness({ isIdentityConnected: vi.fn(() => false) });
    const r = await deliverScheduledBroadcast(slot([target({})]), h.deps);
    expect(r).toMatchObject({ outcome: 'skipped', targets: [{ reason: 'not-connected' }] });
    expect(h.sendChat).not.toHaveBeenCalled();
  });

  it('fails when settlement reports failure', async () => {
    const h = harness({ waitForSettlement: vi.fn(() => Promise.resolve(false)) });
    const r = await deliverScheduledBroadcast(slot([target({})]), h.deps);
    expect(r).toMatchObject({ outcome: 'failed', targets: [{ reason: 'send-failed' }] });
  });

  it('fails when sendChat returns no message id', async () => {
    const h = harness({ sendChat: vi.fn(() => undefined) });
    const r = await deliverScheduledBroadcast(slot([target({})]), h.deps);
    expect(r.targets[0]?.reason).toBe('send-failed');
  });

  it('records a MeshCore send after a channel success, but not on failure', async () => {
    const t = target({ kind: 'meshcore-channel', identityId: 'mc' });
    const ok = harness();
    await deliverScheduledBroadcast(slot([t]), ok.deps);
    expect(isMeshcoreSendTooFast(ok.clock.now)).toBe(true);
    expect(pacing.withMeshtasticTextSendPacing).not.toHaveBeenCalled();

    resetMeshcoreSendRateForTests();
    const bad = harness({ waitForSettlement: vi.fn(() => Promise.resolve(false)) });
    await deliverScheduledBroadcast(slot([t]), bad.deps);
    expect(isMeshcoreSendTooFast(bad.clock.now)).toBe(false);
  });

  it('applies the MeshCore channel limit including the sender name prefix', async () => {
    const t = target({ kind: 'meshcore-channel', identityId: 'mc' });
    // "Alice: " = 7 bytes → 153 left; 154 must be rejected.
    const h = harness();
    const over = await deliverScheduledBroadcast(
      slot([t], 'a'.repeat(MESHCORE_WIRE_MAX - 7 + 1)),
      h.deps,
    );
    expect(over.targets[0]?.reason).toBe('text-too-long');
    const fits = await deliverScheduledBroadcast(
      slot([t], 'a'.repeat(MESHCORE_WIRE_MAX - 7)),
      h.deps,
    );
    expect(fits.outcome).toBe('sent');
  });

  it('reserves the max sender name when the name is unknown', async () => {
    const t = target({ kind: 'meshcore-channel', identityId: 'mc' });
    const h = harness({ getSenderDisplayName: vi.fn(() => '') });
    const r = await deliverScheduledBroadcast(slot([t], 'a'.repeat(140)), h.deps);
    expect(r.targets[0]?.reason).toBe('text-too-long');
  });

  describe('meshcore-room', () => {
    const room = target({
      kind: 'meshcore-room',
      identityId: 'mc',
      label: 'Room',
      roomPubKeyHex: 'ab'.repeat(32),
      roomNodeId: 1,
    });

    it('resolves the live node id and posts', async () => {
      const h = harness();
      const r = await deliverScheduledBroadcast(slot([room]), h.deps);
      expect(r.outcome).toBe('sent');
      expect(h.deps.resolveRoomNodeId).toHaveBeenCalledWith('mc', 'ab'.repeat(32));
      expect(h.sendRoomPost).toHaveBeenCalledWith(0xabcd, 'hello mesh');
      expect(isMeshcoreSendTooFast(h.clock.now)).toBe(true);
    });

    it('reports room-unknown when the key resolves to no node (ignores cached roomNodeId)', async () => {
      const h = harness({ resolveRoomNodeId: vi.fn(() => undefined) });
      const r = await deliverScheduledBroadcast(slot([room]), h.deps);
      expect(r.targets[0]?.reason).toBe('room-unknown');
      expect(h.sendRoomPost).not.toHaveBeenCalled();
    });

    it('maps Room session expired to room-login-required', async () => {
      const h = harness();
      h.sendRoomPost.mockRejectedValueOnce(
        new Error('Room session expired — log in again to post'),
      );
      const r = await deliverScheduledBroadcast(slot([room]), h.deps);
      expect(r).toMatchObject({ outcome: 'failed', targets: [{ reason: 'room-login-required' }] });
      expect(isMeshcoreSendTooFast(h.clock.now)).toBe(false);
    });

    it('maps other post errors to send-failed', async () => {
      const h = harness();
      vi.spyOn(console, 'debug').mockImplementation(() => {});
      h.sendRoomPost.mockRejectedValueOnce(new Error('timeout'));
      const r = await deliverScheduledBroadcast(slot([room]), h.deps);
      expect(r.targets[0]?.reason).toBe('send-failed');
    });

    it('rejects over-long room text', async () => {
      const h = harness();
      const r = await deliverScheduledBroadcast(slot([room], 'a'.repeat(157)), h.deps);
      expect(r.targets[0]?.reason).toBe('text-too-long');
      expect(h.sendRoomPost).not.toHaveBeenCalled();
    });

    it('reports not-connected before resolving the room', async () => {
      const h = harness({ isIdentityConnected: vi.fn(() => false) });
      const r = await deliverScheduledBroadcast(slot([room]), h.deps);
      expect(r.targets[0]?.reason).toBe('not-connected');
    });
  });

  describe('rrc-room', () => {
    const rrc = target({
      kind: 'rrc-room',
      identityId: 'rt',
      label: '#lobby',
      hubDestHash: 'ab'.repeat(16),
      room: 'lobby',
    });

    it('sends to a connected, joined room', async () => {
      const h = harness();
      const r = await deliverScheduledBroadcast(slot([rrc]), h.deps);
      expect(r.outcome).toBe('sent');
      expect(h.sendRrc).toHaveBeenCalledWith({
        hub_dest_hash: 'ab'.repeat(16),
        room: 'lobby',
        body: 'hello mesh',
        type: 'msg',
      });
      expect(h.joinRrcRoom).not.toHaveBeenCalled();
    });

    it('tries one join when not joined, then sends', async () => {
      let joined = false;
      const h = harness({
        getRrcHubRoomState: vi.fn(() => ({ active: true, joined })),
        joinRrcRoom: vi.fn(() => {
          joined = true;
          return Promise.resolve({ ok: true });
        }),
      });
      const r = await deliverScheduledBroadcast(slot([rrc]), h.deps);
      expect(r.outcome).toBe('sent');
      expect(h.deps.joinRrcRoom).toHaveBeenCalledTimes(1);
    });

    it('reports rrc-not-connected when the single join fails', async () => {
      const h = harness({
        getRrcHubRoomState: vi.fn(() => ({ active: false, joined: false })),
        joinRrcRoom: vi.fn(() => Promise.resolve({ ok: false })),
      });
      const r = await deliverScheduledBroadcast(slot([rrc]), h.deps);
      expect(r).toMatchObject({ outcome: 'skipped', targets: [{ reason: 'rrc-not-connected' }] });
      expect(h.deps.joinRrcRoom).toHaveBeenCalledTimes(1);
      expect(h.sendRrc).not.toHaveBeenCalled();
    });

    it('reports rrc-not-connected when join succeeds but the hub is still inactive', async () => {
      const h = harness({
        getRrcHubRoomState: vi.fn(() => ({ active: false, joined: false })),
      });
      const r = await deliverScheduledBroadcast(slot([rrc]), h.deps);
      expect(r.targets[0]?.reason).toBe('rrc-not-connected');
    });

    it('maps a dead-session send error to rrc-not-connected', async () => {
      const h = harness();
      h.sendRrc.mockResolvedValueOnce({ ok: false, error: 'Not connected to an RRC hub' });
      const r = await deliverScheduledBroadcast(slot([rrc]), h.deps);
      expect(r.targets[0]?.reason).toBe('rrc-not-connected');
    });

    it('maps other send failures to send-failed', async () => {
      const h = harness();
      h.sendRrc.mockResolvedValueOnce({ ok: false, error: 'rate limited' });
      const r = await deliverScheduledBroadcast(slot([rrc]), h.deps);
      expect(r).toMatchObject({ outcome: 'failed', targets: [{ reason: 'send-failed' }] });
    });

    it('maps a thrown send (deadline) to send-failed', async () => {
      const h = harness();
      vi.spyOn(console, 'debug').mockImplementation(() => {});
      h.sendRrc.mockRejectedValueOnce(new Error('RETICULUM_IPC_SEND_TIMEOUT'));
      const r = await deliverScheduledBroadcast(slot([rrc]), h.deps);
      expect(r.targets[0]?.reason).toBe('send-failed');
    });

    it('enforces the hub body limit', async () => {
      const h = harness({
        getRrcHubRoomState: vi.fn(() => ({ active: true, joined: true, maxMsgBodyBytes: 5 })),
      });
      const r = await deliverScheduledBroadcast(slot([rrc]), h.deps);
      expect(r.targets[0]?.reason).toBe('text-too-long');
      expect(h.sendRrc).not.toHaveBeenCalled();
    });
  });

  describe('fan-out', () => {
    it('sends sequentially with the gap between targets, not before the first', async () => {
      const order: string[] = [];
      const h = harness({
        sendChat: vi.fn((id: string) => {
          order.push(`send:${id}`);
          return 'm';
        }),
        sleep: (ms: number) => {
          order.push(`sleep:${ms}`);
          h.clock.now += ms;
          return Promise.resolve();
        },
      });
      const r = await deliverScheduledBroadcast(
        slot([
          target({ identityId: 'a' }),
          target({ identityId: 'b' }),
          target({ identityId: 'c' }),
        ]),
        h.deps,
      );
      expect(r.outcome).toBe('sent');
      expect(order).toEqual([
        'send:a',
        `sleep:${SCHEDULED_BROADCAST_TARGET_GAP_MS}`,
        'send:b',
        `sleep:${SCHEDULED_BROADCAST_TARGET_GAP_MS}`,
        'send:c',
      ]);
    });

    it('ignores disabled targets', async () => {
      const h = harness();
      const r = await deliverScheduledBroadcast(
        slot([target({ identityId: 'a', enabled: false }), target({ identityId: 'b' })]),
        h.deps,
      );
      expect(r.targets).toHaveLength(1);
      expect(h.sendChat).toHaveBeenCalledTimes(1);
      expect(h.sendChat).toHaveBeenCalledWith('b', expect.anything());
    });

    it('is partial when some targets fail', async () => {
      const h = harness({ isIdentityConnected: vi.fn((id: string) => id !== 'b') });
      const r = await deliverScheduledBroadcast(
        slot([target({ identityId: 'a' }), target({ identityId: 'b' })]),
        h.deps,
      );
      expect(r.outcome).toBe('partial');
      expect(r.targets.map((t) => t.ok)).toEqual([true, false]);
    });

    it('defers remaining targets once the run cap is hit', async () => {
      const h = harness();
      // Each settlement burns the whole cap.
      h.deps.waitForSettlement = vi.fn(() => {
        h.clock.now += SCHEDULED_BROADCAST_RUN_MAX_MS;
        return Promise.resolve(true);
      });
      const r = await deliverScheduledBroadcast(
        slot([
          target({ identityId: 'a' }),
          target({ identityId: 'b' }),
          target({ identityId: 'c' }),
        ]),
        h.deps,
      );
      expect(r.outcome).toBe('partial');
      expect(r.targets.map((t) => t.reason)).toEqual([undefined, 'deferred', 'deferred']);
      expect(h.sendChat).toHaveBeenCalledTimes(1);
    });

    it('is skipped when every target is deferred or unconnected', async () => {
      const h = harness({ isIdentityConnected: vi.fn(() => false) });
      const r = await deliverScheduledBroadcast(
        slot([target({ identityId: 'a' }), target({ identityId: 'b' })]),
        h.deps,
      );
      expect(r.outcome).toBe('skipped');
    });

    it('keeps going after one target throws', async () => {
      vi.spyOn(console, 'debug').mockImplementation(() => {});
      const h = harness();
      h.sendChat.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      const r = await deliverScheduledBroadcast(
        slot([target({ identityId: 'a' }), target({ identityId: 'b' })]),
        h.deps,
      );
      expect(r.outcome).toBe('partial');
      expect(r.targets[0]?.reason).toBe('send-failed');
    });
  });
});
