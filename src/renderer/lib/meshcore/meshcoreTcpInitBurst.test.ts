import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isMeshcoreTcpBurstDeadBridge,
  isMeshcoreTcpSoftApDeadAccepted,
  notifyMeshcoreTcpLiveForUserTx,
  notifyMeshcoreTcpWriteDead,
  rejectMeshcoreTcpLiveForUserTx,
  setMeshcoreTcpSoftApDeadAccepted,
  setMeshcoreTcpWriteDeadListener,
  shouldDeferMeshcoreTcpReconnectAfterBurst,
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
