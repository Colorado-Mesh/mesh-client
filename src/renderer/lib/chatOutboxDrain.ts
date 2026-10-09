import type { MeshProtocol } from '@/shared/meshProtocol';

type DrainListener = () => void;

const listeners = new Map<MeshProtocol, Set<DrainListener>>();

/** Register a drain callback for a protocol (typically from ChatPanel + useChatOutbox). */
export function registerChatOutboxDrainListener(
  protocol: MeshProtocol,
  listener: DrainListener,
): () => void {
  let set = listeners.get(protocol);
  if (!set) {
    set = new Set();
    listeners.set(protocol, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(protocol);
  };
}

const drainLocks = new Map<MeshProtocol, Promise<void>>();

/**
 * Serialize outbox drains per protocol so ChatPanel's `useChatOutbox` and the App-level
 * emergency drain cannot both send the same row. Callers queue behind the in-flight drain and
 * must re-list rows from SQLite once they hold the lock.
 */
export function withChatOutboxDrainLock<T>(
  protocol: MeshProtocol,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = drainLocks.get(protocol) ?? Promise.resolve();
  const run = prev.then(fn);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  drainLocks.set(protocol, settled);
  void settled.then(() => {
    if (drainLocks.get(protocol) === settled) drainLocks.delete(protocol);
  });
  return run;
}

/** Drop lock chains so a drain left pending by a previous test cannot block the next one. */
export function resetChatOutboxDrainLocksForTests(): void {
  drainLocks.clear();
}

const rowsChangedListeners = new Map<MeshProtocol, Set<DrainListener>>();

/** Subscribe to out-of-band outbox row changes (e.g. App-level drain sent or failed a row). */
export function subscribeChatOutboxRowsChanged(
  protocol: MeshProtocol,
  listener: DrainListener,
): () => void {
  let set = rowsChangedListeners.get(protocol);
  if (!set) {
    set = new Set();
    rowsChangedListeners.set(protocol, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) rowsChangedListeners.delete(protocol);
  };
}

/** Tell mounted outbox views to reload rows without triggering another drain. */
export function notifyChatOutboxRowsChanged(protocol: MeshProtocol): void {
  const set = rowsChangedListeners.get(protocol);
  if (!set) return;
  for (const listener of set) {
    try {
      listener();
    } catch (e) {
      console.warn('[chatOutboxDrain] rows-changed listener failed', e);
    }
  }
}

const inFlightRowAborts = new Map<number, AbortController>();
const awaitingAckRowIds = new Set<number>();
const awaitingAckListeners = new Set<() => void>();

function notifyAwaitingAckListeners(): void {
  for (const listener of [...awaitingAckListeners]) {
    try {
      listener();
    } catch (e) {
      console.warn('[chatOutboxDrain] awaiting-ack listener failed', e);
    }
  }
}

/** Register the abort handle for an outbox row the drain is currently sending. */
export function beginOutboxRowSend(rowId: number): AbortSignal {
  inFlightRowAborts.get(rowId)?.abort();
  const controller = new AbortController();
  inFlightRowAborts.set(rowId, controller);
  return controller.signal;
}

export function endOutboxRowSend(rowId: number): void {
  inFlightRowAborts.delete(rowId);
  setOutboxRowAwaitingAck(rowId, false);
}

/** Stop an in-flight send / network-ACK wait (user cancelled the row). */
export function abortOutboxRowSend(rowId: number): void {
  inFlightRowAborts.get(rowId)?.abort();
  setOutboxRowAwaitingAck(rowId, false);
}

export function setOutboxRowAwaitingAck(rowId: number, awaiting: boolean): void {
  const had = awaitingAckRowIds.has(rowId);
  if (awaiting === had) return;
  if (awaiting) awaitingAckRowIds.add(rowId);
  else awaitingAckRowIds.delete(rowId);
  notifyAwaitingAckListeners();
}

/** True while the drain has transmitted the row and waits for the network to acknowledge it. */
export function isOutboxRowAwaitingAck(rowId: number): boolean {
  return awaitingAckRowIds.has(rowId);
}

export function subscribeOutboxAwaitingAck(listener: () => void): () => void {
  awaitingAckListeners.add(listener);
  return () => {
    awaitingAckListeners.delete(listener);
  };
}

export function resetOutboxRowSendStateForTests(): void {
  inFlightRowAborts.clear();
  awaitingAckRowIds.clear();
}

/** Request an immediate outbox drain for the given protocol (e.g. after peer announce). */
export function requestChatOutboxDrain(protocol: MeshProtocol): void {
  const set = listeners.get(protocol);
  if (!set) return;
  for (const listener of set) {
    try {
      listener();
    } catch (e) {
      console.warn('[chatOutboxDrain] listener failed', e);
    }
  }
}
