import type { MeshDevice } from '@meshtastic/core';

import { errLikeToLogString } from '../errLikeToLogString';

export const MESHTASTIC_CONFIGURE_RETRY_MAX_ATTEMPTS = 6;

/** Window for late SDK "Packet does not exist" rejects after the session handler is removed. */
export const MESHTASTIC_LATE_CONFIGURE_RETRYABLE_SWALLOW_MS = 5_000;

const CONFIGURE_RETRYABLE_PATTERN = /packet does not exist/i;

let lateConfigureRetryableSwallowUntilMs = 0;

export function isMeshtasticConfigureRetryableError(err: unknown): boolean {
  return CONFIGURE_RETRYABLE_PATTERN.test(errLikeToLogString(err));
}

/** Arm a short post-teardown window so the global logger can swallow late SDK rejects. */
export function armMeshtasticLateConfigureRetryableSwallow(
  durationMs: number = MESHTASTIC_LATE_CONFIGURE_RETRYABLE_SWALLOW_MS,
): void {
  lateConfigureRetryableSwallowUntilMs = Date.now() + Math.max(0, durationMs);
}

/** True only while a post-teardown swallow window is active (not app-lifetime). */
export function shouldSwallowLateMeshtasticConfigureRetryableRejection(err: unknown): boolean {
  return (
    Date.now() < lateConfigureRetryableSwallowUntilMs && isMeshtasticConfigureRetryableError(err)
  );
}

/** Test-only: clear the late-swallow window. */
export function resetMeshtasticLateConfigureRetryableSwallowForTests(): void {
  lateConfigureRetryableSwallowUntilMs = 0;
}

/** Retry configure when the radio is still booting after a settings commit reboot. */
export async function configureMeshtasticDeviceWithRetry(
  device: MeshDevice,
  options?: { maxAttempts?: number; logTag?: string },
): Promise<void> {
  const maxAttempts = options?.maxAttempts ?? MESHTASTIC_CONFIGURE_RETRY_MAX_ATTEMPTS;
  const logTag = options?.logTag ?? 'configureMeshtasticDeviceWithRetry';
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await device.configure();
      if (attempt > 1) {
        console.debug(`[${logTag}] configure succeeded on attempt ${attempt}`);
      }
      return;
    } catch (e: unknown) {
      lastErr = e;
      if (!isMeshtasticConfigureRetryableError(e) || attempt === maxAttempts) {
        throw e;
      }
      const delayMs = Math.min(2000 * attempt, 10_000);
      console.debug(
        `[${logTag}] configure retry ${attempt}/${maxAttempts} in ${delayMs}ms: ` +
          errLikeToLogString(e),
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
