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
    logRendererUnhandledRejection(event.reason);
  };
  target.addEventListener('unhandledrejection', handler);
  return () => {
    target.removeEventListener('unhandledrejection', handler);
  };
}
