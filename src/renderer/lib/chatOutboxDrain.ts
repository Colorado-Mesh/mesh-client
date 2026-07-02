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
    set?.delete(listener);
    if (set?.size === 0) listeners.delete(protocol);
  };
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
