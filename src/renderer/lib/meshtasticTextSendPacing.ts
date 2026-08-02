import { MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS } from './timeConstants';

/**
 * Shared completion timestamp for Meshtastic TEXT_MESSAGE_APP sends.
 * Module-level so ChatComposer multi-chunk sends and useChatOutbox drain share one clock
 * and cannot race the firmware's ~2s PhoneAPI rate limit.
 */
let lastMeshtasticTextSendAtMs = 0;

/**
 * Serializes concurrent pacing callers (Composer + outbox drain) so two waiters cannot
 * both pass the gap check and hit the radio inside the firmware rate-limit window.
 */
let meshtasticTextSendChain: Promise<unknown> = Promise.resolve();

/** Test-only: clear the shared pacing clock between cases. */
export function resetMeshtasticTextSendPacingForTests(): void {
  lastMeshtasticTextSendAtMs = 0;
  meshtasticTextSendChain = Promise.resolve();
}

/**
 * Wait until the Meshtastic text-send slot is free, run `send`, then stamp completion.
 * Stamping after `send` settles (not before) keeps the next gap measured from when the
 * prior attempt finished — including IPC / SDK work — so a slow write cannot shrink the
 * radio-visible interval under firmware's 2s RATE_LIMIT_EXCEEDED window.
 *
 * Concurrent callers are queued on a module-level promise chain so ChatComposer and
 * useChatOutbox cannot race the shared clock.
 */
export async function withMeshtasticTextSendPacing<T>(send: () => Promise<T> | T): Promise<T> {
  const run = async (): Promise<T> => {
    if (lastMeshtasticTextSendAtMs > 0) {
      const wait =
        MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS - (Date.now() - lastMeshtasticTextSendAtMs);
      if (wait > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, wait);
        });
      }
    }
    try {
      return await send();
    } finally {
      lastMeshtasticTextSendAtMs = Date.now();
    }
  };

  const next = meshtasticTextSendChain.then(run, run);
  // Keep the chain alive after rejections so later callers still serialize.
  meshtasticTextSendChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
