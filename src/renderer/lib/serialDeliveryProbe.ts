import { withTimeout } from '@/shared/withTimeout';

import {
  clearSerialPostWakeUntrusted,
  getSerialPostWakeGeneration,
  isSerialPostWakeGenerationCurrent,
  noteSerialDeliveryFailure,
  noteSerialPostWakeUntrusted,
} from './serialDeliveryHealth';
import {
  SERIAL_DEAD_THRESHOLD_MS,
  SERIAL_POST_WAKE_DEAD_THRESHOLD_MS,
  SERIAL_POST_WAKE_PROBE_TIMEOUT_MS,
} from './serialPortRecovery';

export type SerialDeliveryProbeResult = 'healthy' | 'failed' | 'stale';

/**
 * Run a short post-wake / post-reopen companion probe. Callers supply the protocol-specific
 * RPC (getSelfInfo, getMetadata, refresh settings, etc.).
 *
 * Success/failure side effects apply only when the post-wake generation (and optional
 * `isCurrent`) still match, so a superseded wake or session cannot clear/nudge the new one.
 */
export async function runSerialDeliveryProbe(
  label: string,
  probe: () => Promise<unknown>,
  opts?: { timeoutMs?: number; isCurrent?: () => boolean },
): Promise<SerialDeliveryProbeResult> {
  const timeoutMs = opts?.timeoutMs ?? SERIAL_POST_WAKE_PROBE_TIMEOUT_MS;
  const wakeGeneration = getSerialPostWakeGeneration();
  const stillCurrent = (): boolean =>
    isSerialPostWakeGenerationCurrent(wakeGeneration) && (opts?.isCurrent?.() ?? true);
  try {
    await withTimeout(Promise.resolve(probe()), timeoutMs, `serialDeliveryProbe:${label}`);
    if (!stillCurrent()) {
      console.warn(`mcL1134 [serialDeliveryProbe] STALE OK label=${label}`);
      return 'stale';
    }
    console.warn(`mcL1135 [serialDeliveryProbe] OK label=${label}`);
    clearSerialPostWakeUntrusted();
    return 'healthy';
  } catch (err: unknown) {
    if (!stillCurrent()) {
      console.warn(`mcL1136 [serialDeliveryProbe] STALE FAILED label=${label}`);
      return 'stale';
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`mcL1137 [serialDeliveryProbe] FAILED label=${label} detail=${detail}`);
    noteSerialDeliveryFailure({ reason: 'probe-failed', connectionType: 'serial' });
    return 'failed';
  }
}

/** Mark serial untrusted for the accelerated post-wake dead window. */
export function beginSerialPostWakeUntrustedWindow(): void {
  noteSerialPostWakeUntrusted(SERIAL_POST_WAKE_DEAD_THRESHOLD_MS);
}

/**
 * Effective dead threshold: after wake, silence is treated as dead sooner until a probe clears
 * the untrusted window (see {@link isSerialPostWakeUntrusted}).
 */
export function serialDeadThresholdMs(isPostWakeUntrusted: boolean): number {
  return isPostWakeUntrusted ? SERIAL_POST_WAKE_DEAD_THRESHOLD_MS : SERIAL_DEAD_THRESHOLD_MS;
}
