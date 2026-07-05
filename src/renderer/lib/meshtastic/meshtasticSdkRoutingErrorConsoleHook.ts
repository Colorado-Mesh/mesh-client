import { parseMeshtasticSdkRoutingErrorLog } from './meshtasticSdkRoutingErrorLog';

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
  onRoutingErrorLog: (message: string) => void,
): () => void {
  const priorError = console.error;
  const priorWarn = console.warn;

  const dispatch = (args: unknown[]) => {
    const line = routingErrorLogFromConsoleArgs(args);
    if (line) onRoutingErrorLog(line);
  };

  console.error = (...args: unknown[]) => {
    priorError.apply(console, args);
    dispatch(args);
  };
  console.warn = (...args: unknown[]) => {
    priorWarn.apply(console, args);
    dispatch(args);
  };

  return () => {
    console.error = priorError;
    console.warn = priorWarn;
  };
}
