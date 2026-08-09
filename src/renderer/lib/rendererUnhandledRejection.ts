import { shouldSwallowLateMeshtasticConfigureRetryableRejection } from './meshtastic/meshtasticConfigureRetry';

/** Log renderer-wide unhandled promise rejections without throwing a second error. */
export function logRendererUnhandledRejection(reason: unknown): void {
  console.error(
    '[renderer] Unhandled rejection:',
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  );
}

/** Route every renderer-wide unhandled rejection into the log. Returns an unsubscribe callback. */
export function installRendererUnhandledRejectionLogger(target: Window = window): () => void {
  const handler = (event: PromiseRejectionEvent) => {
    // Capture-phase Meshtastic handler may have already preventDefault'd queue rejections.
    if (event.defaultPrevented) return;
    // Only swallow disconnect mid-send `Packet does not exist` during the short post-teardown
    // window (armed at safeDisconnect and when the Meshtastic session handler unsubscribes).
    // Outside that window these stay logged so real anomalies remain visible.
    if (shouldSwallowLateMeshtasticConfigureRetryableRejection(event.reason)) {
      console.debug(
        '[renderer] Ignoring Meshtastic disconnect mid-send rejection:',
        event.reason instanceof Error ? event.reason.message : String(event.reason),
      );
      event.preventDefault();
      return;
    }
    logRendererUnhandledRejection(event.reason);
  };
  target.addEventListener('unhandledrejection', handler);
  return () => {
    target.removeEventListener('unhandledrejection', handler);
  };
}
