/**
 * MeshCore TCP init tolerates peer FIN after the contacts burst is captured.
 * Shared predicates for initConn / getChannels skip paths and reconnect deferral.
 */

import { MS_PER_SECOND } from '@/shared/timeConstants';

export function isMeshcoreTcpBurstDeadBridge(opts: {
  transportType: string;
  burstCaptured: boolean;
  bridgeDead: boolean;
}): boolean {
  return opts.transportType === 'tcp' && opts.burstCaptured && opts.bridgeDead;
}

/**
 * Defer reconnect while this open can still finish from the contacts burst / remaining init.
 * Uses !everConfigured so a late tcp-disconnected after a premature deviceConfigured
 * (Neal: getChannels raced ahead of IPC) cannot abort before connect() latches everConfigured.
 * Uses !deviceConfigured so mid-reconnect opens (everConfigured already true) still defer.
 * Mid-reconnect FIN often races getContacts resolve (burst flag not set yet) — defer whenever
 * everConfigured && !deviceConfigured even without burstCaptured.
 * Configure-before-dump: deviceConfigured+everConfigured are both true during getChannels /
 * the contacts-dump window (burstCaptured may still be false) — still defer while initConn is
 * in flight so peer FIN does not bump setup gen.
 */
export function shouldDeferMeshcoreTcpReconnectAfterBurst(opts: {
  burstCaptured: boolean;
  everConfigured: boolean;
  deviceConfigured: boolean;
  initConnInFlight?: boolean;
}): boolean {
  if (opts.initConnInFlight) {
    return true;
  }
  if (opts.deviceConfigured && opts.everConfigured) {
    return false;
  }
  if (opts.everConfigured && !opts.deviceConfigured) {
    return true;
  }
  return opts.burstCaptured;
}

type MeshcoreTcpWriteDeadListener = () => void;

let meshcoreTcpWriteDeadListener: MeshcoreTcpWriteDeadListener | null = null;

/**
 * SoftAP/OpenHop: peer FIN after contacts dump left a configured session with a dead bridge.
 * Background writes (flood advert, outbox) must not call handleConnectionLost — that reconnects,
 * companion FINs again after contacts, and loops forever.
 */
let meshcoreTcpSoftApDeadAccepted = false;

export function setMeshcoreTcpSoftApDeadAccepted(accepted: boolean): void {
  meshcoreTcpSoftApDeadAccepted = accepted;
}

export function isMeshcoreTcpSoftApDeadAccepted(): boolean {
  return meshcoreTcpSoftApDeadAccepted;
}

/** SoftAP user TX: wait for getSelfInfo live window before getContacts / peer FIN. */
export const MESHCORE_TCP_USER_TX_LIVE_TIMEOUT_MS = 20 * MS_PER_SECOND;

interface TcpLiveWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let tcpLiveWaiters: TcpLiveWaiter[] = [];
let inFlightUserTxSends: Promise<unknown>[] = [];

/** Chat send waits here until initConn releases the SoftAP live window (post-getSelfInfo). */
export function waitForMeshcoreTcpLiveForUserTx(
  timeoutMs: number = MESHCORE_TCP_USER_TX_LIVE_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const waiter: TcpLiveWaiter = {
      resolve: () => {},
      reject: () => {},
      timer: setTimeout(() => {
        tcpLiveWaiters = tcpLiveWaiters.filter((w) => w !== waiter);
        reject(new Error('MeshCore TCP live window timed out'));
      }, timeoutMs),
    };
    waiter.resolve = () => {
      clearTimeout(waiter.timer);
      resolve();
    };
    waiter.reject = (err) => {
      clearTimeout(waiter.timer);
      reject(err);
    };
    tcpLiveWaiters.push(waiter);
  });
}

/** initConn: unblock SoftAP user-TX waiters while the TCP socket is still live. */
export function notifyMeshcoreTcpLiveForUserTx(): void {
  const waiters = tcpLiveWaiters;
  tcpLiveWaiters = [];
  for (const w of waiters) {
    w.resolve();
  }
}

/** Reject waiters (reconnect exhausted / aborted). */
export function rejectMeshcoreTcpLiveForUserTx(err: Error): void {
  const waiters = tcpLiveWaiters;
  tcpLiveWaiters = [];
  for (const w of waiters) {
    w.reject(err);
  }
}

/** Track an in-flight SoftAP user send so initConn can await it before getContacts. */
export function trackMeshcoreTcpUserTxSend(sendPromise: Promise<unknown>): void {
  // Attach immediately so mockRejectedValue / sync rejects are not unhandled before await.
  void sendPromise.then(
    () => undefined,
    () => undefined,
  );
  inFlightUserTxSends.push(sendPromise);
  void sendPromise.finally(() => {
    inFlightUserTxSends = inFlightUserTxSends.filter((p) => p !== sendPromise);
  });
}

/**
 * After notifying live waiters, yield microtasks then await any tracked user sends.
 * SoftAP companions often FIN immediately after getContacts — send must finish first.
 */
export async function yieldToMeshcoreTcpUserTxSends(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  const pending = inFlightUserTxSends.slice();
  if (pending.length > 0) {
    await Promise.allSettled(pending);
  }
}

/** Runtime registers a latch so IpcTcpConnection write failures mark the bridge dead without waiting for IPC. */
export function setMeshcoreTcpWriteDeadListener(
  listener: MeshcoreTcpWriteDeadListener | null,
): void {
  meshcoreTcpWriteDeadListener = listener;
}

/** Called from IpcTcpConnection when meshcore:tcp-write fails (no active socket / peer FIN). */
export function notifyMeshcoreTcpWriteDead(): void {
  meshcoreTcpWriteDeadListener?.();
}
