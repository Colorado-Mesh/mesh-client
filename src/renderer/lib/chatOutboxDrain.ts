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
