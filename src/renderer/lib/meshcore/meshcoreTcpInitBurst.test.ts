import { afterEach, describe, expect, it, vi } from 'vitest';

import { isMeshcoreTcpTransportDeadError } from '../bleConnectErrors';
import {
  clearMeshcoreSoftApPendingUserTx,
  decideSoftApUserTxAfterEnsureFailure,
  hasMeshcoreSoftApPendingUserTx,
  isMeshcoreTcpBurstDeadBridge,
  isMeshcoreTcpSoftApDeadAccepted,
  MESHCORE_TCP_SOFTAP_BRIDGE_DIED_DURING_OP,
  notifyMeshcoreTcpLiveForUserTx,
  notifyMeshcoreTcpWriteDead,
  rejectMeshcoreTcpLiveForUserTx,
  runMeshcoreSoftApPendingUserTx,
  runWithMeshcoreTcpDeadWriteRetry,
  setMeshcoreSoftApPendingUserTx,
  setMeshcoreTcpSoftApDeadAccepted,
  setMeshcoreTcpWriteDeadListener,
  settleSoftApPendingResult,
  shouldDeferMeshcoreTcpReconnectAfterBurst,
  throwIfMeshcoreTcpBridgeDiedDuringSoftApOp,
  trackMeshcoreTcpUserTxSend,
  waitForMeshcoreTcpLiveForUserTx,
  yieldToMeshcoreTcpUserTxSends,
} from './meshcoreTcpInitBurst';

describe('isMeshcoreTcpBurstDeadBridge', () => {
  it('is true only for tcp with burst captured and bridge dead', () => {
    expect(
      isMeshcoreTcpBurstDeadBridge({
        transportType: 'tcp',
        burstCaptured: true,
        bridgeDead: true,
      }),
    ).toBe(true);
    expect(
      isMeshcoreTcpBurstDeadBridge({
        transportType: 'ble',
        burstCaptured: true,
        bridgeDead: true,
      }),
    ).toBe(false);
    expect(
      isMeshcoreTcpBurstDeadBridge({
        transportType: 'tcp',
        burstCaptured: false,
        bridgeDead: true,
      }),
    ).toBe(false);
  });
});

describe('shouldDeferMeshcoreTcpReconnectAfterBurst', () => {
  it('defers when burst held and everConfigured is still false (late IPC after deviceConfigured)', () => {
    expect(
      shouldDeferMeshcoreTcpReconnectAfterBurst({
        burstCaptured: true,
        everConfigured: false,
        deviceConfigured: true,
      }),
    ).toBe(true);
  });

  it('defers on reconnect opens when deviceConfigured is still false', () => {
    expect(
      shouldDeferMeshcoreTcpReconnectAfterBurst({
        burstCaptured: true,
        everConfigured: true,
        deviceConfigured: false,
      }),
    ).toBe(true);
  });

  it('defers mid-reconnect FIN that races ahead of burstCaptured', () => {
    expect(
      shouldDeferMeshcoreTcpReconnectAfterBurst({
        burstCaptured: false,
        everConfigured: true,
        deviceConfigured: false,
      }),
    ).toBe(true);
  });

  it('defers while initConn is still finishing after configure-before-dump', () => {
    expect(
      shouldDeferMeshcoreTcpReconnectAfterBurst({
        burstCaptured: true,
        everConfigured: true,
        deviceConfigured: true,
        initConnInFlight: true,
      }),
    ).toBe(true);
  });

  it('defers while initConn is in flight during contacts dump before burstCaptured', () => {
    expect(
      shouldDeferMeshcoreTcpReconnectAfterBurst({
        burstCaptured: false,
        everConfigured: true,
        deviceConfigured: true,
        initConnInFlight: true,
      }),
    ).toBe(true);
  });

  it('does not defer once both everConfigured and deviceConfigured are true', () => {
    expect(
      shouldDeferMeshcoreTcpReconnectAfterBurst({
        burstCaptured: true,
        everConfigured: true,
        deviceConfigured: true,
      }),
    ).toBe(false);
  });

  it('does not defer before burst capture on first connect', () => {
    expect(
      shouldDeferMeshcoreTcpReconnectAfterBurst({
        burstCaptured: false,
        everConfigured: false,
        deviceConfigured: false,
      }),
    ).toBe(false);
  });
});

describe('meshcoreTcpSoftApDeadAccepted', () => {
  afterEach(() => {
    setMeshcoreTcpSoftApDeadAccepted(false);
  });

  it('defaults false and toggles', () => {
    expect(isMeshcoreTcpSoftApDeadAccepted()).toBe(false);
    setMeshcoreTcpSoftApDeadAccepted(true);
    expect(isMeshcoreTcpSoftApDeadAccepted()).toBe(true);
    setMeshcoreTcpSoftApDeadAccepted(false);
    expect(isMeshcoreTcpSoftApDeadAccepted()).toBe(false);
  });
});

describe('SoftAP user-TX live window', () => {
  afterEach(() => {
    setMeshcoreTcpSoftApDeadAccepted(false);
    rejectMeshcoreTcpLiveForUserTx(new Error('test cleanup'));
  });

  it('notifies waiters and yields tracked sends before continuing', async () => {
    const order: string[] = [];
    const live = waitForMeshcoreTcpLiveForUserTx(5_000).then(() => {
      order.push('live');
      const send = Promise.resolve().then(() => {
        order.push('sent');
      });
      trackMeshcoreTcpUserTxSend(send);
      return send;
    });
    await Promise.resolve();
    notifyMeshcoreTcpLiveForUserTx();
    await yieldToMeshcoreTcpUserTxSends();
    order.push('after-yield');
    await live;
    expect(order).toEqual(['live', 'sent', 'after-yield']);
  });

  it('waits for nested ensureTcpLive→send track (SoftAP chat reopen race)', async () => {
    const order: string[] = [];
    // Mirrors useSendMessage: await ensureTcpLive (wait), then another async hop, then track.
    const ensureTcpLive = waitForMeshcoreTcpLiveForUserTx(5_000);
    const sendPath = (async () => {
      await ensureTcpLive;
      order.push('live');
      await Promise.resolve(); // nested IIFE hop
      order.push('track');
      const send = Promise.resolve().then(() => {
        order.push('sent');
      });
      trackMeshcoreTcpUserTxSend(send);
    })();
    await Promise.resolve();
    notifyMeshcoreTcpLiveForUserTx();
    await yieldToMeshcoreTcpUserTxSends({ waitForFirstSendMs: 50 });
    order.push('after-yield');
    await sendPath;
    expect(order).toEqual(['live', 'track', 'sent', 'after-yield']);
  });
});

describe('runWithMeshcoreTcpDeadWriteRetry', () => {
  it('retries once on meshcore tcp-write dead errors', async () => {
    const ensureLive = vi.fn(() => Promise.resolve());
    let attempts = 0;
    const result = await runWithMeshcoreTcpDeadWriteRetry(ensureLive, () => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new Error('meshcore:tcp-write: no active socket'));
      }
      return Promise.resolve('ok');
    });
    expect(result).toBe('ok');
    expect(ensureLive).toHaveBeenCalledTimes(2);
    expect(attempts).toBe(2);
  });

  it('does not retry non-transport errors', async () => {
    const ensureLive = vi.fn(() => Promise.resolve());
    await expect(
      runWithMeshcoreTcpDeadWriteRetry(ensureLive, () =>
        Promise.reject(new Error('channel name too long')),
      ),
    ).rejects.toThrow('channel name too long');
    expect(ensureLive).toHaveBeenCalledTimes(1);
  });

  it('caps attempts at 2 and rethrows the last dead-write error', async () => {
    const ensureLive = vi.fn(() => Promise.resolve());
    await expect(
      runWithMeshcoreTcpDeadWriteRetry(ensureLive, () =>
        Promise.reject(new Error("Error invoking remote method 'meshcore:tcp-write'")),
      ),
    ).rejects.toThrow(/meshcore:tcp-write/);
    expect(ensureLive).toHaveBeenCalledTimes(2);
  });
});

describe('SoftAP pending user TX slot', () => {
  afterEach(() => {
    clearMeshcoreSoftApPendingUserTx();
  });

  it('runs parked op as first SoftAP RPC and settles the result promise', async () => {
    const order: string[] = [];
    const resultPromise = setMeshcoreSoftApPendingUserTx(() => {
      order.push('op');
      return Promise.resolve(42);
    });
    expect(hasMeshcoreSoftApPendingUserTx()).toBe(true);
    const ran = await runMeshcoreSoftApPendingUserTx();
    expect(ran).toBe(true);
    await expect(resultPromise).resolves.toBe(42);
    expect(order).toEqual(['op']);
    expect(hasMeshcoreSoftApPendingUserTx()).toBe(false);
  });

  it('clear rejects a parked TX that never ran', async () => {
    const resultPromise = setMeshcoreSoftApPendingUserTx(() => Promise.resolve('never'));
    clearMeshcoreSoftApPendingUserTx(new Error('aborted'));
    await expect(resultPromise).rejects.toThrow('aborted');
    expect(hasMeshcoreSoftApPendingUserTx()).toBe(false);
  });
});

describe('throwIfMeshcoreTcpBridgeDiedDuringSoftApOp', () => {
  it('throws a transport-dead error when the latch flips during the parked op', () => {
    expect(() => {
      throwIfMeshcoreTcpBridgeDiedDuringSoftApOp(false, true);
    }).toThrow(MESHCORE_TCP_SOFTAP_BRIDGE_DIED_DURING_OP);
    try {
      throwIfMeshcoreTcpBridgeDiedDuringSoftApOp(false, true);
    } catch (e: unknown) {
      expect(isMeshcoreTcpTransportDeadError(e)).toBe(true);
    }
  });

  it('is a no-op when the latch was already dead or stayed live', () => {
    expect(() => {
      throwIfMeshcoreTcpBridgeDiedDuringSoftApOp(true, true);
    }).not.toThrow();
    expect(() => {
      throwIfMeshcoreTcpBridgeDiedDuringSoftApOp(false, false);
    }).not.toThrow();
    expect(() => {
      throwIfMeshcoreTcpBridgeDiedDuringSoftApOp(true, false);
    }).not.toThrow();
  });
});

describe('decideSoftApUserTxAfterEnsureFailure', () => {
  it('returns the parked value when the op already fulfilled (late latch — no double-send)', () => {
    expect(
      decideSoftApUserTxAfterEnsureFailure({
        opSettlement: { status: 'fulfilled', value: 42 },
      }),
    ).toEqual({ action: 'return', value: 42 });
  });

  it('retries only when the parked op rejected with transport-dead', () => {
    expect(
      decideSoftApUserTxAfterEnsureFailure({
        opSettlement: {
          status: 'rejected',
          reason: new Error(MESHCORE_TCP_SOFTAP_BRIDGE_DIED_DURING_OP),
        },
      }),
    ).toEqual({ action: 'retry' });
  });

  it('rethrows non-transport parked-op failures without retry', () => {
    const err = new Error('channel name too long');
    expect(
      decideSoftApUserTxAfterEnsureFailure({
        opSettlement: { status: 'rejected', reason: err },
      }),
    ).toEqual({ action: 'throw', error: err });
  });
});

describe('settleSoftApPendingResult', () => {
  it('reports fulfilled and rejected settlements', async () => {
    await expect(settleSoftApPendingResult(Promise.resolve('ok'))).resolves.toEqual({
      status: 'fulfilled',
      value: 'ok',
    });
    const boom = new Error('meshcore:tcp-write: no active socket');
    const rejected = Promise.reject(boom);
    // Attach early so vitest does not flag an unhandled rejection before settle.
    void rejected.catch(() => undefined);
    await expect(settleSoftApPendingResult(rejected)).resolves.toEqual({
      status: 'rejected',
      reason: boom,
    });
  });
});

describe('notifyMeshcoreTcpWriteDead', () => {
  afterEach(() => {
    setMeshcoreTcpWriteDeadListener(null);
  });

  it('invokes the registered listener', () => {
    const listener = vi.fn();
    setMeshcoreTcpWriteDeadListener(listener);
    notifyMeshcoreTcpWriteDead();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without a listener', () => {
    expect(() => {
      notifyMeshcoreTcpWriteDead();
    }).not.toThrow();
  });
});
