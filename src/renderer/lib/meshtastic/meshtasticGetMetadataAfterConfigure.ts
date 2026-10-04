/**
 * Schedule DeviceMetadata after configure with defer + one retry so NodeDB flood
 * is less likely to starve the admin getMetadata packet.
 *
 * The local admin response often arrives without the routing ACK that resolves
 * `getMetadata()`, so the promise times out even though metadata was delivered.
 * A DeviceMetadata packet therefore counts as success and ends the schedule.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS,
  MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS,
} from '@/renderer/lib/timeConstants';

export interface GetMetadataAfterConfigureDevice {
  getMetadata: (myNode: number) => Promise<unknown>;
  events?: {
    onDeviceMetadataPacket?: {
      subscribe: (cb: (packet: unknown) => void) => () => void;
    };
  };
}

export interface GetMetadataAfterConfigureTimerRef {
  current: ReturnType<typeof setTimeout> | null;
  /** Bumped on cancel/replace so stale getMetadata rejections cannot schedule retries. */
  scheduleGeneration?: number;
  unsubscribeMetadata?: (() => void) | null;
}

function bumpScheduleGeneration(timerRef: GetMetadataAfterConfigureTimerRef): number {
  timerRef.scheduleGeneration = (timerRef.scheduleGeneration ?? 0) + 1;
  return timerRef.scheduleGeneration;
}

export function cancelMeshtasticGetMetadataAfterConfigure(
  timerRef: GetMetadataAfterConfigureTimerRef,
): void {
  if (timerRef.current != null) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
  timerRef.unsubscribeMetadata?.();
  timerRef.unsubscribeMetadata = null;
  bumpScheduleGeneration(timerRef);
}

function runGetMetadataAttempt(
  device: GetMetadataAfterConfigureDevice,
  myNode: number,
  attempt: 1 | 2,
  timerRef: GetMetadataAfterConfigureTimerRef,
  scheduleGeneration: number,
): void {
  void device.getMetadata(myNode).catch((e: unknown) => {
    // Cancelled, replaced, or metadata already arrived — nothing to log or retry.
    if ((timerRef.scheduleGeneration ?? 0) !== scheduleGeneration) return;
    console.debug(
      '[useMeshtasticRuntime] getMetadata after configure failed ' +
        errLikeToLogString(e) +
        (attempt === 2 ? ' (retry)' : ''),
    );
    if (attempt !== 1) return;
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if ((timerRef.scheduleGeneration ?? 0) !== scheduleGeneration) return;
      runGetMetadataAttempt(device, myNode, 2, timerRef, scheduleGeneration);
    }, MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS);
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
  const scheduleGeneration = timerRef.scheduleGeneration ?? 0;
  const subscribe = device.events?.onDeviceMetadataPacket?.subscribe;
  if (subscribe) {
    timerRef.unsubscribeMetadata = subscribe(() => {
      if ((timerRef.scheduleGeneration ?? 0) !== scheduleGeneration) return;
      cancelMeshtasticGetMetadataAfterConfigure(timerRef);
    });
  }
  const deferMs = opts?.deferMs ?? MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_DEFER_MS;
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    if ((timerRef.scheduleGeneration ?? 0) !== scheduleGeneration) return;
    runGetMetadataAttempt(device, myNode, 1, timerRef, scheduleGeneration);
  }, deferMs);
}
