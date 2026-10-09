/** Automatic resends for a regular (non-MECP) message after its first failure. */
export const REGULAR_MESSAGE_MAX_AUTO_RESENDS = 3;

/** Backoff before auto-resend attempt N (1-based): 15s, 60s, 3m. */
export const AUTO_RESEND_DELAYS_MS: readonly number[] = [15_000, 60_000, 180_000];

export function autoResendDelayMs(attempt: number): number {
  const idx = Math.min(Math.max(attempt, 1), AUTO_RESEND_DELAYS_MS.length) - 1;
  return AUTO_RESEND_DELAYS_MS[idx];
}
