/**
 * Schedule DeviceMetadata after configure with defer + one retry so NodeDB flood
 * is less likely to starve the admin getMetadata packet.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS,
  MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS,
} from '@/renderer/lib/timeConstants';

export interface GetMetadataAfterConfigureDevice {
  getMetadata: (myNode: number) => Promise<unknown>;
}

export interface GetMetadataAfterConfigureTimerRef {
  current: ReturnType<typeof setTimeout> | null;
}

export function cancelMeshtasticGetMetadataAfterConfigure(
  timerRef: GetMetadataAfterConfigureTimerRef,
): void {
  if (timerRef.current != null) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function runGetMetadataAttempt(
  device: GetMetadataAfterConfigureDevice,
  myNode: number,
  attempt: 1 | 2,
  timerRef: GetMetadataAfterConfigureTimerRef,
): void {
  void device.getMetadata(myNode).catch((e: unknown) => {
    console.debug(
      '[useMeshtasticRuntime] getMetadata after configure failed ' +
        errLikeToLogString(e) +
        (attempt === 2 ? ' (retry)' : ''),
    );
    if (attempt === 1) {
      cancelMeshtasticGetMetadataAfterConfigure(timerRef);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        runGetMetadataAttempt(device, myNode, 2, timerRef);
      }, MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS);
    }
  });
}

/**
 * Defer the first getMetadata, then retry once after a longer gap on failure.
 * Cancel via {@link cancelMeshtasticGetMetadataAfterConfigure} on disconnect/teardown.
 */
export function scheduleMeshtasticGetMetadataAfterConfigure(
  device: GetMetadataAfterConfigureDevice,
  myNode: number,
  timerRef: GetMetadataAfterConfigureTimerRef,
  opts?: { deferMs?: number },
): void {
  cancelMeshtasticGetMetadataAfterConfigure(timerRef);
  const deferMs = opts?.deferMs ?? MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS;
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    runGetMetadataAttempt(device, myNode, 1, timerRef);
  }, deferMs);
}
