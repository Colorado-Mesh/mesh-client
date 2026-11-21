import { withTimeout } from '@/shared/withTimeout';

import {
  clearSerialPostWakeUntrusted,
  noteSerialDeliveryFailure,
  noteSerialPostWakeUntrusted,
} from './serialDeliveryHealth';
import {
  SERIAL_DEAD_THRESHOLD_MS,
  SERIAL_POST_WAKE_DEAD_THRESHOLD_MS,
  SERIAL_POST_WAKE_PROBE_TIMEOUT_MS,
} from './serialPortRecovery';

export type SerialDeliveryProbeResult = 'healthy' | 'failed';

/**
 * Run a short post-wake / post-reopen companion probe. Callers supply the protocol-specific
 * RPC (getSelfInfo, getMetadata, refresh settings, etc.).
 */
export async function runSerialDeliveryProbe(
  label: string,
  probe: () => Promise<unknown>,
  opts?: { timeoutMs?: number },
): Promise<SerialDeliveryProbeResult> {
  const timeoutMs = opts?.timeoutMs ?? SERIAL_POST_WAKE_PROBE_TIMEOUT_MS;
  try {
    await withTimeout(Promise.resolve(probe()), timeoutMs, `serialDeliveryProbe:${label}`);
    console.warn(`[serialDeliveryProbe] OK label=${label}`);
    clearSerialPostWakeUntrusted();
    return 'healthy';
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[serialDeliveryProbe] FAILED label=${label} detail=${detail}`);
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
