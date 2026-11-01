import type { MeshProtocol } from './types';

/**
 * Reasons for sends that failed after their ChatComposer unmounted (the compact conversation
 * layout unmounts it on Back to list). Each waits, by protocol and view, for the next composer that
 * shows that view, so the user who reopens it sees why the kept text was not sent.
 */
const heldByView = new Map<string, string>();
const listeners = new Set<() => void>();

function viewId(protocol: MeshProtocol, viewKey: string): string {
  return JSON.stringify([protocol, viewKey]);
}

/** Hold a failed send's reason for its view and tell the composers that are mounted. */
export function holdSendError(protocol: MeshProtocol, viewKey: string, message: string): void {
  heldByView.set(viewId(protocol, viewKey), message);
  for (const listener of listeners) listener();
}

/** Remove and return the reason held for this view, if there is one. */
export function takeHeldSendError(protocol: MeshProtocol, viewKey: string): string | undefined {
  const id = viewId(protocol, viewKey);
  const message = heldByView.get(id);
  heldByView.delete(id);
  return message;
}

/** Call `listener` each time a reason is held. Returns the function that stops it. */
export function subscribeHeldSendErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: drop held reasons and listeners between cases. */
export function resetHeldSendErrorsForTests(): void {
  heldByView.clear();
  listeners.clear();
}
