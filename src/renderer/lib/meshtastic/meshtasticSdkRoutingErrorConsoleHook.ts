import { armMeshtasticLateConfigureRetryableSwallow } from './meshtasticConfigureRetry';
import {
  parseMeshtasticSdkQueueRejection,
  parseMeshtasticSdkRoutingErrorLog,
} from './meshtasticSdkRoutingErrorLog';

function routingErrorLogFromConsoleArgs(args: unknown[]): string | null {
  for (const arg of args) {
    if (typeof arg === 'string') {
      const parsed = parseMeshtasticSdkRoutingErrorLog(arg);
      if (parsed) return arg;
    }
  }
  const joined = args
    .map((arg) => (typeof arg === 'string' ? arg : ''))
    .filter(Boolean)
    .join(' ');
  return joined && parseMeshtasticSdkRoutingErrorLog(joined) ? joined : null;
}

/** Tap console.error/warn for SDK queue routing failures (timeouts use warn in queue.js). */
export function installMeshtasticSdkRoutingErrorConsoleHook(
  onRoutingErrorLog: (message: string) => boolean,
): () => void {
  const priorError = console.error;
  const priorWarn = console.warn;

  const handleConsoleRoutingLog = (args: unknown[]): boolean => {
    const line = routingErrorLogFromConsoleArgs(args);
    if (!line) return false;
    const applied = onRoutingErrorLog(line);
    if (applied) {
      console.debug('[Meshtastic] SDK routing failure:', line);
      return true;
    }
    return false;
  };

  console.error = (...args: unknown[]) => {
    if (handleConsoleRoutingLog(args)) return;
    priorError.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    if (handleConsoleRoutingLog(args)) return;
    priorWarn.apply(console, args);
  };

  return () => {
    console.error = priorError;
    console.warn = priorWarn;
  };
}

/**
 * Swallow unhandled `@meshtastic/core` queue rejections (`{ id, error }`) after applying
 * outbound chat failure state when a matching row exists.
 *
 * Disconnect mid-send `Packet does not exist` rejects are intentionally NOT swallowed for the
 * whole session — only during the short post-teardown window (armed here on cleanup and at
 * `safeDisconnect`). The renderer-wide logger owns that window, so genuine mid-session
 * `Packet does not exist` anomalies stay visible instead of being hidden as "disconnect mid-send".
 */
export function installMeshtasticSdkRoutingErrorUnhandledRejectionHandler(
  onQueueRejection: (reason: unknown) => boolean,
): () => void {
  const handler = (event: PromiseRejectionEvent) => {
    if (parseMeshtasticSdkQueueRejection(event.reason)) {
      const applied = onQueueRejection(event.reason);
      if (applied) event.preventDefault();
    }
  };
  // Capture phase so preventDefault runs before the bubble-phase renderer logger.
  window.addEventListener('unhandledrejection', handler, { capture: true });
  return () => {
    window.removeEventListener('unhandledrejection', handler, { capture: true });
    // Late SDK queue rejects can settle after wire-effects teardown removes this handler.
    armMeshtasticLateConfigureRetryableSwallow();
  };
}
