import { MESHCORE_TEXT_CHUNK_SEND_INTERVAL_MS } from './timeConstants';

/**
 * Shared completion timestamp for MeshCore chat chunk sends (channel / DM / room).
 * Module-level so ChatComposer multi-chunk sends and useChatOutbox drain share one clock
 * and cannot race into a back-to-back flood burst through busy repeaters.
 */
let lastMeshcoreTextSendAtMs = 0;

/**
 * Serializes concurrent pacing callers (Composer + outbox drain) so two waiters cannot
 * both pass the gap check and hit the radio inside the inter-chunk window.
 */
let meshcoreTextSendChain: Promise<unknown> = Promise.resolve();

/** Test-only: clear the shared pacing clock between cases. */
export function resetMeshcoreTextSendPacingForTests(): void {
  lastMeshcoreTextSendAtMs = 0;
  meshcoreTextSendChain = Promise.resolve();
}

/**
 * Wait until the MeshCore chunk-send slot is free, run `send`, then stamp completion.
 * Stamping after `send` settles (not before) keeps the next gap measured from when the
 * prior attempt finished — including IPC / companion TX work — so a slow write cannot
 * shrink the radio-visible interval below the inter-chunk pacing window.
 *
 * Concurrent callers are queued on a module-level promise chain so ChatComposer and
 * useChatOutbox cannot race the shared clock.
 */
export async function withMeshcoreTextSendPacing<T>(send: () => Promise<T> | T): Promise<T> {
  const run = async (): Promise<T> => {
    if (lastMeshcoreTextSendAtMs > 0) {
      const wait = MESHCORE_TEXT_CHUNK_SEND_INTERVAL_MS - (Date.now() - lastMeshcoreTextSendAtMs);
      if (wait > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, wait);
        });
      }
    }
    try {
      return await send();
    } finally {
      lastMeshcoreTextSendAtMs = Date.now();
    }
  };

  const next = meshcoreTextSendChain.then(run, run);
  // Keep the chain alive after rejections so later callers still serialize.
  meshcoreTextSendChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
