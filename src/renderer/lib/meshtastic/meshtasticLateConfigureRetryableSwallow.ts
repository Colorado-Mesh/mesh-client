import { errLikeToLogString } from '../errLikeToLogString';

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
