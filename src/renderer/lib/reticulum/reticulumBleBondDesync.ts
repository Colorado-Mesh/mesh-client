/**
 * Sticky flag while sidecar latched `bleBondRemoved` — yield watcher must not
 * re-contend for Noble, and reconnect thrash should not hold the scan mutex.
 */

let bondDesyncActive = false;
const listeners = new Set<() => void>();

export function getReticulumBleBondDesyncActive(): boolean {
  return bondDesyncActive;
}

export function setReticulumBleBondDesyncActive(active: boolean): void {
  if (bondDesyncActive === active) return;
  bondDesyncActive = active;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeReticulumBleBondDesync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
