/**
 * Committed visible mesh protocol for background work gates (no React subscription required).
 * Written once from AppContent; Reticulum runtime timers read via getVisibleMeshProtocol().
 */

import type { MeshProtocol } from './types';

type Listener = () => void;

let visible: MeshProtocol | null = null;
const listeners = new Set<Listener>();

export function getVisibleMeshProtocol(): MeshProtocol | null {
  return visible;
}

export function setVisibleMeshProtocol(next: MeshProtocol): void {
  if (visible === next) return;
  visible = next;
  for (const listener of listeners) listener();
}

export function subscribeVisibleMeshProtocol(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** @internal Reset between tests. */
export function resetVisibleMeshProtocolForTests(): void {
  visible = null;
  listeners.clear();
}
