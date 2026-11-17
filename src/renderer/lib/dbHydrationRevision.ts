/**
 * Bumps when identity stores are successfully rehydrated from SQLite.
 * UI that must re-query DB-derived lists (e.g. NodeList DM peers) subscribes here
 * instead of reacting to every in-memory message insert.
 */

type Listener = () => void;

let revision = 0;
const listeners = new Set<Listener>();

export function getDbHydrationRevision(): number {
  return revision;
}

export function bumpDbHydrationRevision(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeDbHydrationRevision(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** @internal Reset between tests. */
export function resetDbHydrationRevisionForTests(): void {
  revision = 0;
  listeners.clear();
}
