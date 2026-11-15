import type { MeshDevice } from '@meshtastic/core';

import { errLikeToLogString } from '../errLikeToLogString';
import {
  armMeshtasticLateConfigureRetryableSwallow,
  isMeshtasticConfigureRetryableError,
  MESHTASTIC_LATE_CONFIGURE_RETRYABLE_SWALLOW_MS,
  resetMeshtasticLateConfigureRetryableSwallowForTests,
  shouldSwallowLateMeshtasticConfigureRetryableRejection,
} from './meshtasticLateConfigureRetryableSwallow';

export const MESHTASTIC_CONFIGURE_RETRY_MAX_ATTEMPTS = 6;

export {
  armMeshtasticLateConfigureRetryableSwallow,
  isMeshtasticConfigureRetryableError,
  MESHTASTIC_LATE_CONFIGURE_RETRYABLE_SWALLOW_MS,
  resetMeshtasticLateConfigureRetryableSwallowForTests,
  shouldSwallowLateMeshtasticConfigureRetryableRejection,
};

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
