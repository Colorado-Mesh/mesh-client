import type { MeshProtocol } from './types';

/**
 * Outcomes of sends that finish after the user left the view they started in, by switching to
 * another view or by closing the conversation (the compact layout unmounts the composer on Back to
 * list). A failure's reason is held for its view until a composer shows that view again. A success
 * is announced, so a composer already showing that view can drop the sent text.
 */
export type LateSendOutcome =
  | { kind: 'failed'; protocol: MeshProtocol; viewKey: string }
  | { kind: 'sent'; protocol: MeshProtocol; viewKey: string; text: string };

const heldByView = new Map<string, string>();
const listeners = new Set<(outcome: LateSendOutcome) => void>();

function viewId(protocol: MeshProtocol, viewKey: string): string {
  return JSON.stringify([protocol, viewKey]);
}

function notify(outcome: LateSendOutcome): void {
  for (const listener of listeners) listener(outcome);
}

/** Hold a failed send's reason for its view and tell the composers that are mounted. */
export function holdSendError(protocol: MeshProtocol, viewKey: string, message: string): void {
  heldByView.set(viewId(protocol, viewKey), message);
  notify({ kind: 'failed', protocol, viewKey });
}

/** Tell the composers that are mounted that a send from `viewKey` went through. */
export function announceLateSend(protocol: MeshProtocol, viewKey: string, text: string): void {
  notify({ kind: 'sent', protocol, viewKey, text });
}

/** Remove and return the reason held for this view, if there is one. */
export function takeHeldSendError(protocol: MeshProtocol, viewKey: string): string | undefined {
  const id = viewId(protocol, viewKey);
  const message = heldByView.get(id);
  heldByView.delete(id);
  return message;
}

/** Call `listener` for each late outcome. Returns the function that stops it. */
export function subscribeLateSendOutcomes(
  listener: (outcome: LateSendOutcome) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: drop held reasons and listeners between cases. */
export function resetLateSendOutcomesForTests(): void {
  heldByView.clear();
  listeners.clear();
}
