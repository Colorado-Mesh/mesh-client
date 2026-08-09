import { errLikeToLogString } from '../errLikeToLogString';
import {
  armMeshtasticLateConfigureRetryableSwallow,
  beginMeshtasticSessionRejectionSwallow,
  endMeshtasticSessionRejectionSwallow,
  isMeshtasticConfigureRetryableError,
} from './meshtasticConfigureRetry';
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
 * Also swallows disconnect mid-send `Packet does not exist` so teardown races are not logged
 * as unhandled rejections.
 */
export function installMeshtasticSdkRoutingErrorUnhandledRejectionHandler(
  onQueueRejection: (reason: unknown) => boolean,
): () => void {
  const handler = (event: PromiseRejectionEvent) => {
    if (parseMeshtasticSdkQueueRejection(event.reason)) {
      const applied = onQueueRejection(event.reason);
      if (applied) event.preventDefault();
      return;
    }
    if (isMeshtasticConfigureRetryableError(event.reason)) {
      console.debug(
        '[Meshtastic] Ignoring disconnect mid-send rejection: ' + errLikeToLogString(event.reason),
      );
      event.preventDefault();
    }
  };
  // Capture phase so preventDefault runs before the bubble-phase renderer logger.
  window.addEventListener('unhandledrejection', handler, { capture: true });
  // Mark a session swallow active so the app-lifetime renderer logger defers to this handler
  // even though at_target listeners fire in registration order (renderer logger is installed first).
  beginMeshtasticSessionRejectionSwallow();
  return () => {
    window.removeEventListener('unhandledrejection', handler, { capture: true });
    endMeshtasticSessionRejectionSwallow();
    // Late SDK queue rejects can settle after wire-effects teardown removes this handler.
    armMeshtasticLateConfigureRetryableSwallow();
  };
}
