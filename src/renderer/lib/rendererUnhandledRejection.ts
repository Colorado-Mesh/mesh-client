import {
  isMeshtasticConfigureRetryableError,
  isMeshtasticSessionRejectionSwallowActive,
  shouldSwallowLateMeshtasticConfigureRetryableRejection,
} from './meshtastic/meshtasticConfigureRetry';

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
    // While a Meshtastic session swallow handler is installed, it owns the mid-send
    // `Packet does not exist` teardown race. This bubble handler is registered first, so it runs
    // before the capture handler at_target — defer (no error log) and let it log + preventDefault.
    if (
      isMeshtasticSessionRejectionSwallowActive() &&
      isMeshtasticConfigureRetryableError(event.reason)
    ) {
      event.preventDefault();
      return;
    }
    // Only during a short post-teardown window (armed when Meshtastic session handler unsubscribes).
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
