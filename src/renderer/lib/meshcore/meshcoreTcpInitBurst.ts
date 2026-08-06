/**
 * MeshCore TCP init tolerates peer FIN after the contacts burst is captured.
 * Shared predicates for initConn / getChannels skip paths and reconnect deferral.
 */

import { isMeshcoreTcpTransportDeadError } from '@/renderer/lib/bleConnectErrors';
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

/**
 * SoftAP/OpenHop often FINs a reconnect that starts immediately after the prior session.
 * Match reconnect attempt-1 backoff so the companion accepts a new TCP live window for chat TX.
 */
export const MESHCORE_TCP_SOFTAP_USER_TX_REOPEN_DELAY_MS = 2 * MS_PER_SECOND;

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
 *
 * Ordering vs `ensureTcpLiveForUserTx` / `useSendMessage`:
 * 1. initConn calls `notifyMeshcoreTcpLiveForUserTx()` (resolves waiters),
 * 2. then `yieldToMeshcoreTcpUserTxSends()`.
 * Waiters resume in `ensureTcpLiveForUserTx`, which returns into a nested `useSendMessage`
 * async IIFE that only then calls `trackMeshcoreTcpUserTxSend`. That is **three** microtask
 * hops (notify → ensureTcpLive → useSendMessage), not two — SoftAP reopen used to snapshot
 * an empty send list and start getContacts before track registered.
 */
export async function yieldToMeshcoreTcpUserTxSends(opts?: {
  /** SoftAP user-TX reopen: wait briefly for a late-tracked send after the microtask hops. */
  waitForFirstSendMs?: number;
}): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  const waitMs = opts?.waitForFirstSendMs ?? 0;
  if (waitMs > 0 && inFlightUserTxSends.length === 0) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      // length mutates via trackMeshcoreTcpUserTxSend while we poll.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- module-level array
      if (inFlightUserTxSends.length > 0) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
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

/**
 * SoftAP user TX: ensure live TCP, run op, retry once on dead-bridge write errors.
 * Non-transport failures are not retried.
 */
export async function runWithMeshcoreTcpDeadWriteRetry<T>(
  ensureLive: () => Promise<void>,
  op: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    await ensureLive();
    try {
      return await op();
    } catch (e: unknown) {
      lastErr = e;
      if (!isMeshcoreTcpTransportDeadError(e)) throw e;
    }
  }
  throw lastErr;
}

interface SoftApPendingUserTx {
  run: () => Promise<void>;
  reject: (reason?: unknown) => void;
}

let softApPendingUserTx: SoftApPendingUserTx | null = null;

/**
 * Park a SoftAP user command so SoftAP `initConn` can run it as the first companion RPC
 * (before getSelfInfo / contacts). Returns a promise that settles when that run completes.
 */
export function setMeshcoreSoftApPendingUserTx<T>(op: () => Promise<T>): Promise<T> {
  clearMeshcoreSoftApPendingUserTx(new Error('MeshCore SoftAP pending TX superseded'));
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const resultPromise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Avoid unhandled rejection if open fails before the waiter attaches.
  void resultPromise.then(
    () => undefined,
    () => undefined,
  );
  softApPendingUserTx = {
    reject,
    run: async () => {
      try {
        const value = await op();
        resolve(value);
      } catch (e: unknown) {
        reject(e);
        throw e;
      }
    },
  };
  return resultPromise;
}

/** SoftAP initConn: run and clear the parked user TX (if any). */
export async function runMeshcoreSoftApPendingUserTx(): Promise<boolean> {
  const pending = softApPendingUserTx;
  softApPendingUserTx = null;
  if (!pending) return false;
  await pending.run();
  return true;
}

/** Clear a parked SoftAP TX that will never run (open aborted / superseded). */
export function clearMeshcoreSoftApPendingUserTx(err?: Error): void {
  const pending = softApPendingUserTx;
  if (!pending) return;
  softApPendingUserTx = null;
  pending.reject(err ?? new Error('MeshCore SoftAP pending TX cleared'));
}

export function hasMeshcoreSoftApPendingUserTx(): boolean {
  return softApPendingUserTx != null;
}

/** Error message matching {@link isMeshcoreTcpTransportDeadError} for SoftAP latch-retry. */
export const MESHCORE_TCP_SOFTAP_BRIDGE_DIED_DURING_OP = 'meshcore:tcp-write: no active socket';

/**
 * SoftAP first-RPC: if the write-dead latch flipped during the parked user op, throw a
 * transport-dead error so ensure's live wait rejects. {@link runMeshcoreUserTxWithLiveTcp}
 * must still return a fulfilled parked result (no re-run) — late latch after Ok must not
 * double-send chat.
 */
export function throwIfMeshcoreTcpBridgeDiedDuringSoftApOp(
  bridgeDeadBefore: boolean,
  bridgeDeadAfter: boolean,
): void {
  if (bridgeDeadAfter && !bridgeDeadBefore) {
    throw new Error(MESHCORE_TCP_SOFTAP_BRIDGE_DIED_DURING_OP);
  }
}

export type SoftApOpSettlement<T> =
  { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown };

/** Settle a parked SoftAP result without throwing (for ensure-failure decision). */
export async function settleSoftApPendingResult<T>(
  resultPromise: Promise<T>,
): Promise<SoftApOpSettlement<T>> {
  try {
    return { status: 'fulfilled', value: await resultPromise };
  } catch (reason: unknown) {
    // catch-no-log-ok settle helper returns rejected status to caller for SoftAP retry decision
    return { status: 'rejected', reason };
  }
}

export type SoftApEnsureFailureDecision<T> =
  { action: 'return'; value: T } | { action: 'retry' } | { action: 'throw'; error: unknown };

/**
 * After SoftAP `ensureTcpLiveForUserTx` fails: never re-run a parked op that already
 * completed (would double-send). Retry only when the op never succeeded and rejected
 * with a transport-dead error (including clear-with-ensure when ensure was transport-dead).
 */
export function decideSoftApUserTxAfterEnsureFailure<T>(opts: {
  opSettlement: SoftApOpSettlement<T>;
}): SoftApEnsureFailureDecision<T> {
  if (opts.opSettlement.status === 'fulfilled') {
    return { action: 'return', value: opts.opSettlement.value };
  }
  const opErr = opts.opSettlement.reason;
  if (isMeshcoreTcpTransportDeadError(opErr)) {
    return { action: 'retry' };
  }
  return { action: 'throw', error: opErr };
}
