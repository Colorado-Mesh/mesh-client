/**
 * Optimistic rail protocol selection outside AppContent so the highlight can
 * paint without waiting for a full shell render.
 */

import type { MeshProtocol } from './types';

type Listener = () => void;

let pending: MeshProtocol | null = null;
const listeners = new Set<Listener>();

export function getPendingProtocolSelection(): MeshProtocol | null {
  return pending;
}

export function setPendingProtocolSelection(next: MeshProtocol | null): void {
  if (pending === next) return;
  pending = next;
  for (const listener of listeners) listener();
}

export function subscribePendingProtocolSelection(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** @internal Reset between tests. */
export function resetProtocolSwitchUiForTests(): void {
  pending = null;
  listeners.clear();
}
