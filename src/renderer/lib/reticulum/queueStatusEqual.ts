import type { ProtocolRuntimeQueueStatus } from '@/renderer/runtime/protocolRuntime';

/** Shallow equality for Reticulum/Meshtastic queue badge aggregates. */
export function queueStatusEqual(
  a: ProtocolRuntimeQueueStatus | null,
  b: ProtocolRuntimeQueueStatus | null,
): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return (
    a.free === b.free &&
    a.maxlen === b.maxlen &&
    a.res === b.res &&
    a.interfaceName === b.interfaceName &&
    a.buffering === b.buffering
  );
}
